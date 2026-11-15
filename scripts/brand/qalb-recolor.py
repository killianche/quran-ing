#!/usr/bin/env python3
"""Перекраска логотипа QALB в фирменные тона Quran Ing.

Решение владельца 2026-11-15: иконкой приложения становится логотип QALB
(латинское QALB, сквозь которое вплетено арабское قلب — «сердце»), но не в
исходных цветах (тёмно-синий фон, кремовые буквы, голубая вязь), а «в нашем
стиле»: тёплый коричневый фон и золото, как у ковра и токенов --brand.

── Как устроено ────────────────────────────────────────────────────────────

Исходник — растровая картинка 673×673 (JPEG, scripts/brand/source/
qalb-logo-original.jpg); векторного файла нет. Каждый пиксель раскладывается
на три «краски» исходника — фон, кремовая латиница, голубая вязь — как
выпуклая смесь (метод наименьших квадратов с суммой долей = 1). Так
сглаженные края между любыми двумя красками раскладываются честно, а не
бинаризуются. Доли увеличиваются до нужного размера и «подтягиваются»
сигмоидой: края снова резкие, без мыла от увеличения в 1,5–3 раза и без
ряби JPEG. Затем доли смешиваются уже с нашей палитрой.

Где буква переходит под или над вязью, исходник это уже нарисовал —
перекраска сохраняет переплетение как есть.

── Что пишет ───────────────────────────────────────────────────────────────

  logo.png            — непрозрачная плитка 1024×1024 (иконка iOS, PWA,
                        Android legacy), фон с мягким светом к центру;
  logo-wordmark.png   — только знак на прозрачном фоне, обрезанный по
                        краям (адаптивная иконка Android, знак заставки);
  launch-photo.jpg    — фото заставки (ряды молящихся, решение владельца
                        2026-11-15) в тёплой тонировке, 1440×2560, без знака:
                        знак кладёт generate-brand-assets.py;
  brand.json          — цвет плитки и параметры заставки для
                        scripts/generate-brand-assets.py.

Запуск: python3 scripts/brand/qalb-recolor.py [--preview /tmp/x.png]
Затем:  npm run brand:generate
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/brand/source/qalb-logo-original.jpg"
PHOTO = ROOT / "scripts/brand/source/launch-photo-original.jpg"
PHOTO_SIZE = (1440, 2560)  # 9:16, как исходник 720×1280

# Ширина знака на заставке — доля ширины фото (после aspectFill/cover).
# На iPhone фото 9:16 обрезается по бокам, и знак 0,56 ширины фото занимает
# около 68 % ширины экрана.
LAUNCH_MARK_SCALE = 0.56

# Краски исходника (замерены по плотным участкам картинки).
SRC_BG = (6, 36, 50)
SRC_LATIN = (246, 230, 218)
SRC_ARABIC = (38, 178, 214)

# Наша палитра. Фон — глубокий коричневый ковра (тёмный край --brand-soft
# тёмной темы, #2b241a, чуть теплее), латиница — кремовая подпись заставки
# (#f1dcbc), вязь — золото: светлее и насыщеннее --brand (#7c6340), чтобы
# на коричневом и рядом с кремом читалась так же ярко, как голубая.
BG_EDGE = (34, 26, 17)
BG_CENTER = (66, 51, 33)
LATIN = (241, 226, 201)
ARABIC_LIGHT = (236, 192, 104)
ARABIC_DEEP = (196, 142, 56)

TILE = 1024
WORK = 2048  # размер, в котором считаются доли; затем уменьшение до TILE


def unmix(rgb: np.ndarray) -> np.ndarray:
    """Доли трёх красок для каждого пикселя: (H, W, 3), сумма = 1, ≥ 0."""
    endmembers = np.array([SRC_BG, SRC_LATIN, SRC_ARABIC], dtype=np.float64).T  # 3×3
    # Сумма долей = 1 добавляется четвёртой строкой с большим весом.
    weight = 400.0
    a = np.vstack([endmembers, weight * np.ones((1, 3))])
    pinv = np.linalg.pinv(a)
    h, w, _ = rgb.shape
    b = np.concatenate([rgb.reshape(-1, 3).astype(np.float64), np.full((h * w, 1), weight)], axis=1)
    f = b @ pinv.T
    f = np.clip(f, 0, None)
    f /= np.maximum(f.sum(axis=1, keepdims=True), 1e-6)
    return f.reshape(h, w, 3)


def sharpen_alpha(channel: np.ndarray, size: int) -> np.ndarray:
    """Увеличить долю до size×size и вернуть резкость края сигмоидой."""
    img = Image.fromarray((channel * 255).astype(np.uint8), "L").resize((size, size), Image.Resampling.BICUBIC)
    img = img.filter(ImageFilter.GaussianBlur(size / 673 * 0.9))
    a = np.asarray(img, dtype=np.float64) / 255
    # Мёртвая зона по краям: в фоне исходника JPEG-шум даёт долю краски
    # 0,02–0,08 — без неё весь фон стал бы почти-прозрачным, а не
    # прозрачным. Середина (0,5 — линия края) не сдвигается.
    a = np.clip((a - 0.12) / 0.76, 0, 1)
    k = 9.0
    s = 1 / (1 + np.exp(-k * (a - 0.5)))
    # Сигмоида не доходит до 0 и 1 (на хвостах ≈ 0,011): без растяжки знак
    # на прозрачном фоне лёг бы на всё поле обрезки еле заметной плёнкой.
    lo, hi = 1 / (1 + np.exp(k * 0.5)), 1 / (1 + np.exp(-k * 0.5))
    return np.clip((s - lo) / (hi - lo), 0, 1)


def radial(size: int, inner: tuple, outer: tuple) -> np.ndarray:
    y, x = np.mgrid[0:size, 0:size] / (size - 1) - 0.5
    r = np.clip(np.sqrt(x * x + (y + 0.04) ** 2) / 0.72, 0, 1) ** 1.4
    inner_a, outer_a = np.array(inner, float), np.array(outer, float)
    return inner_a * (1 - r[..., None]) + outer_a * r[..., None]


def vertical(size: int, top: tuple, bottom: tuple) -> np.ndarray:
    t = np.linspace(0, 1, size)[:, None, None]
    return np.array(top, float) * (1 - t) + np.array(bottom, float) * t * np.ones((1, size, 1))


def build() -> tuple[Image.Image, Image.Image]:
    src = np.asarray(Image.open(SOURCE).convert("RGB"), dtype=np.float64)
    fractions = unmix(src)
    # Резкость возвращается общей маске знака (латиница + вязь), а не
    # каждой краске отдельно: иначе на стыке золота и крема обе доли
    # оказывались ниже половины, и сквозь стык просвечивал тёмный фон —
    # тонкий шов вокруг вязи. Внутри знака краски делятся по доле вязи,
    # подтянутой той же сигмоидой.
    sign = sharpen_alpha(fractions[..., 1] + fractions[..., 2], WORK)
    ratio_src = fractions[..., 2] / np.maximum(fractions[..., 1] + fractions[..., 2], 1e-3)
    ratio = sharpen_alpha(ratio_src, WORK)
    arabic = sign * ratio
    latin = sign * (1 - ratio)

    gold = vertical(WORK, ARABIC_LIGHT, ARABIC_DEEP)
    latin_rgb = np.array(LATIN, float)

    # Плитка: фон с мягким светом к центру.
    bg = radial(WORK, BG_CENTER, BG_EDGE)
    tile = bg * (1 - latin - arabic)[..., None] + latin_rgb * latin[..., None] + gold * arabic[..., None]
    tile_img = Image.fromarray(np.clip(tile, 0, 255).astype(np.uint8), "RGB").resize((TILE, TILE), Image.Resampling.LANCZOS)

    # Знак на прозрачном: цвет без примеси фона (premultiplied → straight).
    alpha = np.clip(latin + arabic, 0, 1)
    safe = np.maximum(alpha, 1e-6)[..., None]
    mark_rgb = (latin_rgb * latin[..., None] + gold * arabic[..., None]) / safe
    mark = np.dstack([np.clip(mark_rgb, 0, 255), alpha * 255]).astype(np.uint8)
    mark_img = Image.fromarray(mark, "RGBA")
    bbox = mark_img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    mark_img = mark_img.crop(bbox)
    return tile_img, mark_img


def grade_photo() -> Image.Image:
    """Фото заставки в нашем тоне: приглушённый цвет, тёплая коричневая
    тонировка, мягкая тень в центре под знаком и виньетка по краям.

    Исходник 720×1280; увеличение в 2 раза + лёгкая нерезкая маска. Фото
    тёмное и мелкое по фактуре, поэтому увеличение на телефоне не заметно.
    """
    w, h = PHOTO_SIZE
    img = Image.open(PHOTO).convert("RGB").resize(PHOTO_SIZE, Image.Resampling.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(2, 60, 2))
    a = np.asarray(img, dtype=np.float64) / 255
    lum = (a * [0.299, 0.587, 0.114]).sum(2, keepdims=True)
    a = a * 0.55 + lum * 0.45
    a = a * np.array([1.06, 0.96, 0.80])
    y, x = np.mgrid[0:h, 0:w]
    dx, dy = x / w - 0.5, (y / h - 0.5) * h / w * (w / h)
    r = np.sqrt(dx * dx + dy * dy)
    scrim = 0.48 * np.exp(-(r / 0.42) ** 2)
    vignette = np.clip((np.sqrt((x / w - 0.5) ** 2 + (y / h - 0.5) ** 2) - 0.35) / 0.5, 0, 1) * 0.45
    a = a * (1 - scrim[..., None]) * (1 - vignette[..., None])
    a = np.clip(a, 0, 1) ** 1.08
    return Image.fromarray((a * 255).astype(np.uint8), "RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", help="только записать плитку сюда, файлы проекта не трогать")
    args = parser.parse_args()
    tile, mark = build()
    if args.preview:
        tile.save(args.preview)
        print(f"preview → {args.preview}")
        return
    tile.save(ROOT / "logo.png", "PNG", optimize=True)
    mark.save(ROOT / "logo-wordmark.png", "PNG", optimize=True)
    grade_photo().save(ROOT / "launch-photo.jpg", "JPEG", quality=94, optimize=True)
    brand_path = ROOT / "brand.json"
    data = json.loads(brand_path.read_text(encoding="utf-8")) if brand_path.is_file() else {}
    data.update({
        "variant": "qalb",
        "background": "#%02x%02x%02x" % BG_EDGE,
        "launchPhoto": "launch-photo.jpg",
        "launchMarkScale": LAUNCH_MARK_SCALE,
    })
    brand_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"logo.png {tile.size}, logo-wordmark.png {mark.size}, brand.json background {data['background']}")


if __name__ == "__main__":
    main()
