#!/usr/bin/env python3
"""
design-logo — фирменный знак Quran Ing из фотографии ковров владельца.

── Решение владельца (2026-10-04) ─────────────────────────────────────────

«Я тебе отправил фотографию ковров. Вот её используй как иконку везде …
чтобы это был стиль. Возьми оттуда тёмно-красный». Прежний знак (слово
«قرآن» на плитке) снят. Источник — scripts/brand/source/carpets.png
(720×1280, присланная владельцем фотография).

── Что строит ─────────────────────────────────────────────────────────────

  logo.png              — 1254×1254 без прозрачности: центральный медальон
                          ковра крупно, лёгкая виньетка к краям. Из него
                          `npm run brand:generate` режет иконки App Store,
                          iOS, Android и сайта.
  logo-wordmark.png     — тот же медальон кругом с мягким краем (RGBA): знак
                          заставки и передний слой адаптивной иконки Android.
  public/brand/medallion.webp — он же для анимации появления в приложении
                          (src/lib/launchReveal.ts, блок #launch в index.html): тот же кадр, что
                          и системная заставка, чтобы переход был без шва.
  brand.json            — цвет поля вокруг медальона (фон заставки и
                          адаптивной иконки) и доля экрана под медальон.

── Качество ───────────────────────────────────────────────────────────────

Кадр иконки — 200 точек исходника (медальон ~125); иконка 1024 — это
увеличение ~5×, поэтому после LANCZOS идёт мягкая нерезкая маска. Когда
появится фото крупнее — заменить source/carpets.png и поправить
MEDALLION_CENTER / ICON_HALF: всё остальное соберётся заново.

Запуск:  python3 scripts/brand/design-logo.py && npm run brand:generate
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/brand/source/carpets.png"
SIZE = 1254

# Центр медальона нижнего левого ковра — снят по сетке на увеличенном кадре
# (центроид светлых точек тянуло орнаментом вокруг, он давал (152, 1102)).
MEDALLION_CENTER = (137, 1130)
# Полусторона кадра иконки в точках исходника: кайма ковра начинается около
# x ≈ 240, поэтому не больше ~100 — иначе она полосой входит в иконку.
ICON_HALF = 100
# Радиус круга медальона для заставки и мягкость края (в точках исходника).
MEDALLION_RADIUS = 74
MEDALLION_FEATHER = 10
# Цвет поля ковра вокруг медальона: медиана кольца 70–100 точек от центра.
# Тот же цвет — фон заставки, поэтому мягкий край круга растворяется без шва.
FIELD_COLOR = "#440505"
# Доля меньшей стороны экрана под медальон на заставке. Меньше прежних 24 %:
# медальон в исходнике мал, крупнее — заметно мылится.
SPLASH_SCALE = 0.20


def sharpen(image: Image.Image) -> Image.Image:
    return image.filter(ImageFilter.UnsharpMask(radius=2.2, percent=70, threshold=2))


def vignette(image: Image.Image, strength: float = 0.22) -> Image.Image:
    """Мягкое затемнение к краям — глубина, как у ткани под светом."""
    w, h = image.size
    mask = Image.radial_gradient("L").resize((w, h), Image.Resampling.BICUBIC)
    mask = mask.point(lambda v: int(min(255, max(0, (v - 90) * 1.6)) * strength))
    dark = Image.new("RGB", (w, h), (8, 0, 0))
    return Image.composite(dark, image, mask)


def build_icon(source: Image.Image) -> Image.Image:
    cx, cy = MEDALLION_CENTER
    box = (cx - ICON_HALF, cy - ICON_HALF, cx + ICON_HALF, cy + ICON_HALF)
    icon = source.crop(box).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return vignette(sharpen(icon))


# Сторона медальона на выходе. Анимация увеличивает его до ×1.34: на iPhone
# 0.2 × 932 pt × 3 × 1.34 ≈ 750 px, на iPad ≈ 730 — с 640 последние кадры
# растягивал бы браузер. Увеличение исходника делает LANCZOS + резкость здесь.
MEDALLION_PX = 1024


def build_medallion(source: Image.Image, out_px: int = MEDALLION_PX) -> Image.Image:
    cx, cy = MEDALLION_CENTER
    r = MEDALLION_RADIUS + MEDALLION_FEATHER
    crop = source.crop((cx - r, cy - r, cx + r, cy + r))
    crop = sharpen(crop.resize((out_px, out_px), Image.Resampling.LANCZOS)).convert("RGBA")
    scale = out_px / (2 * r)
    inner = MEDALLION_RADIUS * scale
    feather = MEDALLION_FEATHER * scale
    mask = Image.new("L", (out_px, out_px), 0)
    ImageDraw.Draw(mask).ellipse(
        (out_px / 2 - inner, out_px / 2 - inner, out_px / 2 + inner, out_px / 2 + inner), fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    crop.putalpha(mask)
    return crop


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    build_icon(source).save(ROOT / "logo.png", "PNG", optimize=True)
    medallion = build_medallion(source)
    medallion.save(ROOT / "logo-wordmark.png", "PNG", optimize=True)
    (ROOT / "public/brand").mkdir(parents=True, exist_ok=True)
    medallion.save(ROOT / "public/brand/medallion.webp", "WEBP", quality=88, method=6)
    (ROOT / "brand.json").write_text(json.dumps({
        "variant": "carpet",
        "background": FIELD_COLOR,
        "opticalLift": 0,
        "splashScale": SPLASH_SCALE,
    }, indent=2) + "\n", encoding="utf-8")
    print("✓ logo.png, logo-wordmark.png, public/brand/medallion.webp, brand.json")


if __name__ == "__main__":
    main()
