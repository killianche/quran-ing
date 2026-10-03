#!/usr/bin/env python3
"""
design-logo — исходник логотипа Quran Ing: слово «قرآن» (Коран) на плитке.

── Зачем скрипт, а не картинка ───────────────────────────────────────────

Логотип собирается кодом, чтобы его можно было воспроизвести и поправить:
цвет, кегль, отступы — параметры, а не пиксели. Результат — два файла,
которые читает `scripts/generate-brand-assets.py` (`npm run brand:generate`):

  logo.png           — квадрат 1254×1254 без прозрачности: иконка App Store,
                       iOS, Android и сайта (App Store запрещает alpha);
  logo-wordmark.png  — то же слово на прозрачном фоне, обрезанное по
                       содержимому: его ставят на заставку.
  brand.json         — цвет фона плитки: им же заливается заставка и фон
                       адаптивной иконки Android.

── Арабский ──────────────────────────────────────────────────────────────

«قرآن» — одно слово, название Книги, а не цитата аята: обычная современная
орфография, без огласовок (так его пишут на обложках). Набирается шрифтом
Amiri 1.000 Bold (SIL OFL, scripts/brand/fonts/OFL-Amiri.txt; источник —
https://github.com/aliftype/amiri/releases/download/1.000/Amiri-1.000.zip,
SHA-256 архива 926fe1bd7dfde8e55178281f645258bfced6420c951c6f2fd532fd21691bca30),
а не кораническими
шрифтами King Fahd Complex — их разрешено использовать только для текста
Корана. Буквы обязаны соединяться (CLAUDE.md, сакральные правила § 7),
поэтому текст рисуется через raqm (HarfBuzz): без него Pillow рисует
отдельные несоединённые буквы. Скрипт проверяет, что raqm есть, и падает,
если нет.

Запуск:
    python3 scripts/brand/design-logo.py --preview      # лист вариантов
    python3 scripts/brand/design-logo.py --variant paper  # записать logo.png
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "scripts/brand/fonts/Amiri-Bold.ttf"
WORD = "قرآن"
SIZE = 1254
PREVIEW_DIR = ROOT / "brand-preview"
# Насколько слово поднято над геометрическим центром, в долях стороны:
# у «قرآن» тяжёлый низ (хвосты ر и ن), и по центру оно кажется низким.
# То же смещение берёт адаптивная иконка Android (через brand.json).
OPTICAL_LIFT = 1 / 40


@dataclass(frozen=True)
class Variant:
    id: str
    title: str
    background: str          # основной цвет плитки (и заставки)
    background_edge: str     # цвет к краям — мягкая виньетка
    ink: str                 # цвет слова
    plate: str | None = None  # тёмная плашка под словом (как у an-Nur)


VARIANTS = {
    "paper": Variant(
        id="paper", title="Бумага: чернила на тёплой плитке",
        background="#f4dfc0", background_edge="#e9cc9f", ink="#211d18",
    ),
    "night": Variant(
        id="night", title="Ночь: золото на глубоком зелёном",
        background="#123327", background_edge="#0a1f17", ink="#d9b968",
    ),
    "plate": Variant(
        id="plate", title="Плашка: светлое слово на тёмной плашке",
        background="#f4dfc0", background_edge="#e9cc9f", ink="#f6ead6",
        plate="#211d18",
    ),
}


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def require_shaping() -> None:
    if not features.check("raqm"):
        raise SystemExit("Нет raqm: арабские буквы не соединятся. Установите libraqm.")


def vignette(size: int, center: str, edge: str) -> Image.Image:
    """Плитка с едва заметным затемнением к краям — как бумага под лампой."""
    c, e = hex_rgb(center), hex_rgb(edge)
    mask = Image.radial_gradient("L").resize((size, size), Image.Resampling.BICUBIC)
    base = Image.new("RGB", (size, size), c)
    dark = Image.new("RGB", (size, size), e)
    # radial_gradient: 0 в центре, 255 у краёв; смягчаем, чтобы край не «звенел».
    mask = mask.point(lambda v: int(v * 0.85))
    return Image.composite(dark, base, mask)


def word_layer(font_px: int, ink: str) -> Image.Image:
    """Слово на прозрачном фоне, обрезанное по фактическим пикселям."""
    font = ImageFont.truetype(str(FONT), font_px, layout_engine=ImageFont.Layout.RAQM)
    pad = font_px
    canvas = Image.new("RGBA", (font_px * 4, font_px * 3), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.text((pad, pad // 2), WORD, font=font, fill=ink, direction="rtl", language="ar")
    bbox = canvas.getbbox()
    if bbox is None:
        raise SystemExit("Слово не отрисовалось — проверить шрифт.")
    return canvas.crop(bbox)


def compose(variant: Variant) -> tuple[Image.Image, Image.Image]:
    """Вернуть (иконка 1254×1254 RGB, знак для заставки RGBA)."""
    tile = vignette(SIZE, variant.background, variant.background_edge)
    if variant.plate is None:
        word = word_layer(560, variant.ink)
        # Оптический центр чуть выше геометрического: у арабского слова
        # «тяжёлая» нижняя часть (хвост нун), и по центру оно кажется низким.
        x = (SIZE - word.width) // 2
        y = (SIZE - word.height) // 2 - round(SIZE * OPTICAL_LIFT)
        tile.paste(word, (x, y), word)
        wordmark = word
    else:
        word = word_layer(470, variant.ink)
        pad_x, pad_y = 120, 90
        plate = Image.new("RGBA", (word.width + pad_x * 2, word.height + pad_y * 2), (0, 0, 0, 0))
        ImageDraw.Draw(plate).rounded_rectangle(
            (0, 0, plate.width - 1, plate.height - 1), radius=70, fill=variant.plate,
        )
        plate.paste(word, (pad_x, pad_y), word)
        # Мягкая тень плашки — чтобы она лежала на плитке, а не была вырезана.
        shadow = Image.new("RGBA", (plate.width + 120, plate.height + 120), (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 70), (60, 80, 60 + plate.width, 80 + plate.height), plate.split()[3])
        shadow = shadow.filter(ImageFilter.GaussianBlur(24))
        x = (SIZE - plate.width) // 2
        y = (SIZE - plate.height) // 2
        tile.paste(shadow, (x - 60, y - 60), shadow)
        tile.paste(plate, (x, y), plate)
        wordmark = plate
    return tile, wordmark


def preview_sheet(path: Path) -> None:
    """Лист: каждый вариант крупно, в размерах иконки и на заставке."""
    rows = []
    # Подписи — системным шрифтом: в Amiri нет кириллицы. Лист — только
    # для глаз, в логотип эти подписи не попадают.
    try:
        label_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
    except OSError:
        label_font = ImageFont.load_default(size=30)
    for variant in VARIANTS.values():
        icon, wordmark = compose(variant)
        row = Image.new("RGB", (1500, 470), "#ffffff")
        draw = ImageDraw.Draw(row)
        draw.text((24, 10), f"{variant.id} — {variant.title}", font=label_font, fill="#333333")
        big = rounded(icon.resize((360, 360), Image.Resampling.LANCZOS), 80)
        row.paste(big, (24, 70), big)
        x = 420
        for px in (180, 120, 60):
            small = rounded(icon.resize((px, px), Image.Resampling.LANCZOS), int(px * 0.22))
            row.paste(small, (x, 70 + (360 - px) // 2), small)
            x += px + 40
        splash = Image.new("RGB", (220, 400), variant.background)
        mark = wordmark.copy()
        mark.thumbnail((110, 110), Image.Resampling.LANCZOS)
        splash.paste(mark, ((220 - mark.width) // 2, (400 - mark.height) // 2), mark)
        row.paste(splash, (x + 40, 50))
        rows.append(row)
    sheet = Image.new("RGB", (1500, 470 * len(rows)), "#ffffff")
    for i, row in enumerate(rows):
        sheet.paste(row, (0, 470 * i))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG", optimize=True)


def rounded(image: Image.Image, radius: int) -> Image.Image:
    """Скруглить углы для предпросмотра — как iOS маскирует иконку."""
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width - 1, image.height - 1), radius=radius, fill=255)
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def write_variant(variant: Variant) -> None:
    icon, wordmark = compose(variant)
    icon.convert("RGB").save(ROOT / "logo.png", "PNG", optimize=True)
    wordmark.save(ROOT / "logo-wordmark.png", "PNG", optimize=True)
    (ROOT / "brand.json").write_text(
        json.dumps({
            "variant": variant.id,
            "background": variant.background,
            "opticalLift": OPTICAL_LIFT if variant.plate is None else 0,
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"✓ logo.png, logo-wordmark.png, brand.json — вариант {variant.id}")


def main() -> None:
    require_shaping()
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--variant", choices=sorted(VARIANTS))
    args = parser.parse_args()
    if args.preview:
        preview_sheet(PREVIEW_DIR / "logo-variants.png")
        for variant in VARIANTS.values():
            icon, _ = compose(variant)
            icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(PREVIEW_DIR / f"icon-{variant.id}.png")
        print(f"✓ предпросмотр: {PREVIEW_DIR.relative_to(ROOT)}/")
    if args.variant:
        write_variant(VARIANTS[args.variant])
    if not args.preview and not args.variant:
        parser.error("нужен --preview или --variant")


if __name__ == "__main__":
    main()
