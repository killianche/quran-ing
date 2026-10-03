#!/usr/bin/env python3
"""
build-inter-ingush — собирает public/latin-fonts/inter/Inter-ingush.woff2,
шрифт Inter для ингушского перевода смыслов Корана.

── Зачем отдельный файл ──────────────────────────────────────────────────

Русский текст набирается подмножествами Inter от Google Fonts (index.css).
Для ингушского они не годятся по двум причинам, обе видны глазами:

1. Знак ударения U+0301 над кириллицей встаёт над СЛЕДУЮЩЕЙ буквой:
   «Алла́хIа» читается как «Аллах́Ia». Причина — в самом Inter (4.1): в
   таблице GPOS письменности `cyrl` подключён только `kern`, а `mark` и
   `mkmk` — нет. Якоря у кириллических букв при этом нарисованы верно
   (у «а» — по центру), их просто никто не применяет: браузер берёт для
   кириллического текста набор правил `cyrl`. В EB Garamond и Alice
   `mark` для `cyrl` есть, там ударение на месте.
2. Ингушская палочка в источнике набрана латинской «I», а в Inter
   заглавная I без засечек неотличима от строчной «l». В Inter есть
   вариант cv08 — I с засечками, — но Google его из подмножеств вырезает.

── Что делает скрипт ─────────────────────────────────────────────────────

1. Берёт официальный релиз Inter 4.1 (SIL OFL 1.1) и сверяет SHA-256.
2. Закрепляет оптический размер opsz=14 (текстовый) и сужает ось веса до
   400–600 — это оба начертания Inter из настроек чтения.
3. Подключает к письменности `cyrl` те же lookup'ы `mark`/`mkmk`, что уже
   стоят у `latn` и `DFLT`. Глифы и якоря не меняются — только
   регистрация правил для кириллицы.
4. Оставляет латиницу, кириллицу, комбинирующие знаки и пунктуацию, а из
   правил — ccmp, locl, mark, mkmk, kern, calt, cv08.
5. Проверяет результат: все символы ингушского перевода (кроме ─ и ﷺ,
   которых нет ни в одном шрифте чтения) на месте, `cyrl` несёт `mark`,
   есть cv08. Любое расхождение — падение.

Запуск (нужны fontTools и brotli):
    python3 scripts/fonts/build-inter-ingush.py
"""

from __future__ import annotations

import hashlib
import io
import sqlite3
import sys
import urllib.request
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/latin-fonts/inter/Inter-ingush.woff2'
INH_DB = ROOT / 'data/inh-quran/quran_translation_ing_smisl.db'

RELEASE_URL = 'https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip'
RELEASE_SHA256 = '9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e'

UNICODES = (
    'U+0020-007E,U+00A0-00FF,U+0100-017F,U+0300-036F,U+0400-04FF,'
    'U+2010-2027,U+2030-203A,U+2116,U+2212'
)
LAYOUT_FEATURES = ['ccmp', 'locl', 'mark', 'mkmk', 'kern', 'calt', 'cv08']
# Символы источника, которых нет ни в одном шрифте чтения: ﷺ берётся из
# 'Inh Marks' (index.css), линия ─ — из системного шрифта.
KNOWN_ABSENT = {'─', 'ﷺ'}


def fail(msg: str) -> None:
    print(f'✗ {msg}', file=sys.stderr)
    sys.exit(1)


def download_release() -> bytes:
    print(f'→ {RELEASE_URL}')
    with urllib.request.urlopen(RELEASE_URL) as r:
        data = r.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != RELEASE_SHA256:
        fail(f'SHA-256 релиза не совпал: {digest}')
    return data


def register_marks_for_cyrillic(font: TTFont) -> None:
    """Подключить к `cyrl` lookup'ы mark/mkmk, уже зарегистрированные у `latn`."""
    gpos = font['GPOS'].table
    records = gpos.FeatureList.FeatureRecord
    scripts = {sr.ScriptTag: sr.Script for sr in gpos.ScriptList.ScriptRecord}
    if 'cyrl' not in scripts or 'latn' not in scripts:
        fail('в GPOS нет cyrl или latn — структура шрифта изменилась, проверить руками')
    latn = scripts['latn'].DefaultLangSys
    wanted = [i for i in latn.FeatureIndex if records[i].FeatureTag in ('mark', 'mkmk')]
    if len(wanted) != 2:
        fail(f'у latn ожидались mark и mkmk, найдено: {[records[i].FeatureTag for i in wanted]}')

    cyrl = scripts['cyrl']
    lang_systems = [cyrl.DefaultLangSys] + [r.LangSys for r in cyrl.LangSysRecord]
    for ls in lang_systems:
        if ls is None:
            continue
        have = {records[i].FeatureTag for i in ls.FeatureIndex}
        for i in wanted:
            if records[i].FeatureTag not in have:
                ls.FeatureIndex.append(i)
        ls.FeatureIndex.sort()
        ls.FeatureCount = len(ls.FeatureIndex)


def ingush_chars() -> set[str]:
    con = sqlite3.connect(INH_DB)
    chars: set[str] = set()
    for (text,) in con.execute('SELECT translation FROM translations'):
        chars |= set((text or '').split('<p>')[0])
    return {c for c in chars if not c.isspace()}


def verify(path: Path) -> None:
    font = TTFont(path)
    cmap = font.getBestCmap()
    missing = sorted(c for c in ingush_chars() - KNOWN_ABSENT if ord(c) not in cmap)
    if missing:
        fail(f'нет глифов для: {[hex(ord(c)) for c in missing]}')
    gpos = font['GPOS'].table
    records = gpos.FeatureList.FeatureRecord
    for sr in gpos.ScriptList.ScriptRecord:
        if sr.ScriptTag == 'cyrl':
            tags = {records[i].FeatureTag for i in sr.Script.DefaultLangSys.FeatureIndex}
            if not {'mark', 'mkmk'} <= tags:
                fail(f'у cyrl нет mark/mkmk: {sorted(tags)}')
    gsub_tags = {r.FeatureTag for r in font['GSUB'].table.FeatureList.FeatureRecord}
    if 'cv08' not in gsub_tags:
        fail('нет cv08')
    print(f'✓ проверено: {len(cmap)} символов, cyrl несёт mark/mkmk, cv08 на месте')


def main() -> None:
    data = download_release()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        variable = TTFont(io.BytesIO(z.read('InterVariable.ttf')))

    instanced = instancer.instantiateVariableFont(variable, {'opsz': 14, 'wght': (400, 600)})
    # Пересохранить и перечитать: после instancer таблица gvar ленивая, и
    # subsetter спотыкается о неё (KeyError '.notdef'). Через байты — чисто.
    buf = io.BytesIO()
    instanced.save(buf)
    buf.seek(0)
    font = TTFont(buf)
    register_marks_for_cyrillic(font)

    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = LAYOUT_FEATURES
    options.name_IDs = ['*']
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = 'woff2'
    font.save(OUT)
    print(f'✓ {OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} КБ')
    verify(OUT)


if __name__ == '__main__':
    main()
