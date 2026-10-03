#!/usr/bin/env python3
"""
build-saadi-tafsir — тафсир ас-Саади на русском (перевод Э. Кулиева) для
кнопки «Тафсир» у аята: public/tafsir/saadi-ru/NNN.json, по файлу на суру.

── Откуда текст и откуда границы ─────────────────────────────────────────

Готового источника, где хорошо и то и другое, нет — проверено 2026-10-03:

* Quran Foundation, ресурс 170 (`ru-tafseer-al-saddi`, api.quran.com/v4) —
  чистый текст, но привязка к аятам непоследовательная: запись группы
  лежит то на последнем аяте группы, то на первом, а иногда толкование
  нескольких аятов разложено по соседним записям (51:1–6 — в 51:1…51:4).
  Ни правило «назад», ни «вперёд» не верно целиком.
* QUL 310 (`tafsir-as-saadi-russian`, через spa5k/tafsir_api) — точные
  блоки с диапазонами «(1-6)», как в книге, но текст набран с разрывами
  строк печатного издания («Свое- го», «лю- дям» — 24 278 мест) и местами
  со слипшимися словами. Править такой текст нельзя (verbatim).

Поэтому: ТЕКСТ — из ресурса 170, дословно; ГРАНИЦЫ — из QUL 310. Каждая
запись 170 относится к блоку QUL по содержанию: семь проб по 40 букв
вдоль записи ищутся в соседних блоках (сравниваются только буквы, так что
разрывы QUL не мешают), блок выбирается голосованием. Затем:

1. запись, чьи пробы уверенно попали в два блока (две пробы на блок или
   первая/последняя проба), объединяет их;
2. блок QUL, где есть только перевод аятов и нет толкования (в книге их
   толкуют в предыдущем фрагменте — проверено: из 49 таких блоков все,
   где это определимо, относятся к предыдущему), присоединяется к
   предыдущей группе. Если такой блок окажется ПЕРВЫМ в суре, присоединять
   его не к чему — скрипт падает с «группа без текста»: такой случай
   нужно разобрать руками (в текущих данных его нет).

Текст группы — её записи 170 в порядке аятов, через пустую строку. Ни одна
буква не меняется.

── Проверки (скрипт падает при нарушении) ───────────────────────────────

* каждая непустая запись 170 использована ровно один раз;
* группы суры идут подряд и покрывают аяты 1…N без дыр и нахлёстов;
* у каждой группы есть текст.

── Условия использования ─────────────────────────────────────────────────

Developer Terms Quran Foundation (§2.1) запрещают хранить их данные
дольше 7 дней без письменного разрешения. Хранение в приложении требует
разрешения — см. STATUS.md → Блокеры. Атрибуция обязательна.

Запуск:  python3 scripts/gen/build-saadi-tafsir.py
"""

from __future__ import annotations

import collections
import hashlib
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "public/tafsir/saadi-ru"
REPORT = ROOT / "scripts/gen/data/saadi-tafsir-report.json"

QF_RESOURCE = 170
QF_URL = "https://api.quran.com/api/v4/tafsirs/{rid}/by_chapter/{surah}?per_page=50&page={page}"
QUL_COMMIT = "eb82bb6294efe30ad5c135c03b1864afaa70e855"
QUL_URL = ("https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@" + QUL_COMMIT
           + "/tafsir/tafsir-as-saadi-russian/{surah}.json")

PROBE = 40
NPROBES = 7
WINDOW = 20


def fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def get_json(url: str) -> object:
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "quran-ing-build/1"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as error:  # noqa: BLE001 — сеть: повторяем, потом падаем
            if attempt == 4:
                fail(f"{url}: {error}")
            time.sleep(2 * (attempt + 1))
    raise AssertionError


def fetch_qf() -> dict[str, str]:
    out: dict[str, str] = {}
    for surah in range(1, 115):
        page = 1
        while True:
            data = get_json(QF_URL.format(rid=QF_RESOURCE, surah=surah, page=page))
            for item in data["tafsirs"]:  # type: ignore[index]
                out[item["verse_key"]] = item["text"]
            nxt = data["pagination"]["next_page"]  # type: ignore[index]
            if not nxt:
                break
            page = nxt
    return out


def fetch_qul() -> dict[str, str]:
    out: dict[str, str] = {}
    for surah in range(1, 115):
        for item in get_json(QUL_URL.format(surah=surah)):  # type: ignore[union-attr]
            out[f"{item['surah']}:{item['ayah']}"] = item["text"]
    return out


def letters(text: str) -> str:
    """Только буквы и цифры — для сопоставления, не для показа."""
    return re.sub(r"[^а-яa-z0-9]", "", text.lower().replace("ё", "е"))


def qul_blocks(qul: dict[str, str], surah: int, count: int) -> list[list]:
    """Блоки QUL: соседние аяты с одинаковым текстом — один блок."""
    blocks: list[list] = []
    start, prev = 1, None
    for ayah in range(1, count + 1):
        text = qul[f"{surah}:{ayah}"]
        if prev is not None and text != prev:
            blocks.append([start, ayah - 1, prev])
            start = ayah
        prev = text
    blocks.append([start, count, prev])
    return blocks


def has_commentary(block_text: str) -> bool:
    """В блоке QUL сначала перевод аятов, затем — после пустой строки — толкование."""
    parts = block_text.split("\n\n", 1)
    return len(parts) > 1 and bool(parts[1].strip())


def build_surah(surah: int, count: int, qf: dict[str, str], qul: dict[str, str], report: dict) -> list[dict]:
    blocks = qul_blocks(qul, surah, count)
    norm = [letters(text) for *_, text in blocks]
    parent = list(range(len(blocks)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    owner: dict[int, int] = {}
    for ayah in range(1, count + 1):
        text = qf.get(f"{surah}:{ayah}", "")
        if not text.strip():
            continue
        n = letters(text)
        nearby = [i for i, (a, b, _) in enumerate(blocks) if b >= ayah - WINDOW and a <= ayah + WINDOW]
        if len(n) <= PROBE:
            probes = [n]
        else:
            step = (len(n) - PROBE) / (NPROBES - 1)
            probes = [n[round(k * step):round(k * step) + PROBE] for k in range(NPROBES)]
        votes: collections.Counter = collections.Counter()
        edges: set[int] = set()
        for k, probe in enumerate(probes):
            hits = [i for i in nearby if probe in norm[i]]
            if len(hits) == 1:
                votes[hits[0]] += 1
                # Начало и конец записи надёжны сами по себе: короткое
                # толкование соседнего блока (11:102 внутри записи 11:104)
                # ловит всего одна проба, и порог «две пробы» его пропустил бы.
                if k in (0, len(probes) - 1):
                    edges.add(hits[0])
            elif hits:
                best = min(hits, key=lambda i: 0 if blocks[i][0] <= ayah <= blocks[i][1]
                           else min(abs(blocks[i][0] - ayah), abs(blocks[i][1] - ayah)))
                votes[best] += 0.5
        if not votes:
            home = next(i for i, (a, b, _) in enumerate(blocks) if a <= ayah <= b)
            owner[ayah] = home
            report["positional"].append(f"{surah}:{ayah}")
            continue
        strong = sorted({i for i, c in votes.items() if c >= 2} | edges)
        if len(strong) > 1:
            for i in range(strong[0], strong[-1] + 1):
                union(strong[0], i)
            report["spanMerged"].append(
                f"{surah}:{ayah} → {blocks[strong[0]][0]}-{blocks[strong[-1]][1]} ({len(strong)} бл.)")
        owner[ayah] = votes.most_common(1)[0][0]

    # Блок без толкования — к предыдущей группе (каскадом).
    for i in range(1, len(blocks)):
        if not has_commentary(blocks[i][2]) and i not in owner.values():
            union(i - 1, i)
            report["translationOnlyMerged"].append(f"{surah}:{blocks[i][0]}-{blocks[i][1]}")

    groups: dict[int, dict] = {}
    for i, (a, b, _) in enumerate(blocks):
        g = groups.setdefault(find(i), {"from": a, "to": b, "ayahs": []})
        g["from"], g["to"] = min(g["from"], a), max(g["to"], b)
    for ayah in sorted(owner):
        groups[find(owner[ayah])]["ayahs"].append(ayah)

    out = []
    for g in sorted(groups.values(), key=lambda g: g["from"]):
        if not g["ayahs"]:
            fail(f"{surah}:{g['from']}-{g['to']}: группа без текста")
        out.append({
            "from": g["from"],
            "to": g["to"],
            "text": "\n\n".join(qf[f"{surah}:{a}"] for a in g["ayahs"]),
            "_ayahs": g["ayahs"],
        })
    # Подряд, без дыр, 1…N; записи в порядке аятов.
    expected = 1
    seq: list[int] = []
    for g in out:
        if g["from"] != expected:
            fail(f"сура {surah}: дыра или нахлёст перед {g['from']}")
        expected = g["to"] + 1
        seq += g.pop("_ayahs")
    if expected != count + 1:
        fail(f"сура {surah}: группы кончаются на {expected - 1}, аятов {count}")
    if seq != sorted(seq):
        fail(f"сура {surah}: записи перемешаны между группами")
    if len(seq) != len(set(seq)):
        fail(f"сура {surah}: запись использована дважды")
    report["_used"] += len(seq)
    return out


def main() -> None:
    print("→ Quran Foundation, ресурс 170…")
    qf = fetch_qf()
    print("→ QUL 310 @", QUL_COMMIT[:10], "…")
    qul = fetch_qul()

    counts: dict[int, int] = collections.Counter()
    for key in qul:
        s, a = map(int, key.split(":"))
        counts[s] = max(counts[s], a)
    if sum(counts.values()) != 6236:
        fail(f"QUL: {sum(counts.values())} аятов вместо 6236")

    report = {"positional": [], "spanMerged": [], "translationOnlyMerged": [], "_used": 0}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total_groups = 0
    digest = hashlib.sha256()
    for surah in range(1, 115):
        groups = build_surah(surah, counts[surah], qf, qul, report)
        total_groups += len(groups)
        payload = {"surah": surah, "groups": groups}
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        digest.update(body.encode("utf-8"))
        (OUT_DIR / f"{surah:03d}.json").write_text(body, encoding="utf-8")

    nonempty = sum(1 for t in qf.values() if t.strip())
    used = report.pop("_used")
    if used != nonempty:
        fail(f"использовано записей {used}, непустых в ресурсе 170 — {nonempty}")

    meta = {
        "title": "Тафсир ас-Саади «Облегчение от Великодушного и Милостивого»",
        "translator": "Эльмир Кулиев",
        "text": {"provider": "Quran Foundation (quran.com)", "resource": QF_RESOURCE,
                 "slug": "ru-tafseer-al-saddi"},
        "boundaries": {"provider": "QUL (Tarteel) via spa5k/tafsir_api", "resource": 310,
                       "commit": QUL_COMMIT},
        "fetchedAt": date.today().isoformat(),
        "groups": total_groups,
        "sha256": digest.hexdigest(),
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"✓ 114 сур, {total_groups} групп, записей 170: {used}/{nonempty}")
    print(f"  объединено по охвату: {len(report['spanMerged'])}, блоков без толкования: "
          f"{len(report['translationOnlyMerged'])}, по позиции: {len(report['positional'])}")


if __name__ == "__main__":
    main()
