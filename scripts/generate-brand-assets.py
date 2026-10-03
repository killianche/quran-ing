#!/usr/bin/env python3
"""Generate every Quran Ing app icon and splash image from ``logo.png``.

The source is intentionally kept as a regular opaque PNG: App Store icons
must not contain an alpha channel, and using one file prevents Web, iOS and
Android branding from drifting apart.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "logo.png"
RESAMPLE = Image.Resampling.LANCZOS

# Контур фирменной плашки внутри исходного logo.png. Он нужен только для
# заставки: иконка приложения остаётся исходным квадратным логотипом, а на
# заставке показывается чистый wordmark без белой подложки и большой плитки.
WORDMARK_POLYGON = (
    (234, 474),
    (1068, 474),
    (1106, 517),
    (1053, 744),
    (818, 744),
    (804, 809),
    (774, 810),
    (740, 746),
    (207, 746),
    (177, 708),
)


def opaque_rgb(image: Image.Image) -> Image.Image:
    """Return an opaque RGB image, flattening alpha onto white if needed."""
    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def save_square(source: Image.Image, target: Path, size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    source.resize((size, size), RESAMPLE).save(target, "PNG", optimize=True)


def extract_wordmark(source: Image.Image) -> Image.Image:
    """Вырезать точный wordmark из утверждённого logo.png."""
    rgba = source.convert("RGBA")
    mask = Image.new("L", source.size, 0)
    ImageDraw.Draw(mask).polygon(WORDMARK_POLYGON, fill=255)
    # Полупрозрачный край убирает ступеньки после масштабирования.
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    rgba.putalpha(mask)
    bbox = mask.getbbox()
    if bbox is None:
        raise SystemExit("Could not extract the wordmark from logo.png")
    return rgba.crop(bbox)


def splash_background(size: tuple[int, int]) -> Image.Image:
    """Бледно-бежевый фон фирменной плитки (унаследован от an-Nur)."""
    return Image.new("RGB", size, "#f4dfc0")


def save_wordmark(wordmark: Image.Image) -> None:
    target = ROOT / "public/brand/wordmark.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    wordmark.save(target, "PNG", optimize=True)


def save_splash(wordmark: Image.Image, target: Path, size: tuple[int, int]) -> None:
    width, height = size
    canvas = splash_background(size)
    # Storyboard показывает квадрат через aspectFill: на высоком iPhone
    # остаётся примерно 42% ширины исходника. Поэтому wordmark занимает 24%
    # квадрата и выглядит уверенно, но не превращается в огромную плитку.
    logo_width = max(150, round(min(width, height) * 0.24))
    logo_height = round(wordmark.height * logo_width / wordmark.width)
    logo = wordmark.resize((logo_width, logo_height), RESAMPLE)
    canvas.paste(
        logo,
        ((width - logo_width) // 2, (height - logo_height) // 2),
        logo,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--ios-splash-only",
        action="store_true",
        help="Generate only the iOS splash, shared splash previews and web wordmark",
    )
    args = parser.parse_args()

    if not SOURCE.is_file():
        raise SystemExit(f"Missing canonical logo: {SOURCE}")

    source = opaque_rgb(Image.open(SOURCE))
    if source.width != source.height:
        raise SystemExit(f"Logo must be square, got {source.size}")

    wordmark = extract_wordmark(source)
    save_wordmark(wordmark)

    splash = ROOT / "assets/splash.png"
    splash_dark = ROOT / "assets/splash-dark.png"
    save_splash(wordmark, splash, (2732, 2732))
    save_splash(wordmark, splash_dark, (2732, 2732))

    ios_splash = ROOT / "ios/App/App/Assets.xcassets/Splash.imageset"
    for scale in (1, 2, 3):
        save_splash(
            wordmark,
            ios_splash / f"Default@{scale}x~universal~anyany.png",
            (2732, 2732),
        )
        save_splash(
            wordmark,
            ios_splash / f"Default@{scale}x~universal~anyany-dark.png",
            (2732, 2732),
        )

    if args.ios_splash_only:
        print("Generated iOS splash and web wordmark from logo.png")
        return

    save_square(source, ROOT / "assets/icon.png", 1024)
    save_square(
        source,
        ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
        1024,
    )

    for size in (16, 32, 48, 72, 96, 128, 180, 192, 256, 512):
        save_square(source, ROOT / f"public/icons/icon-{size}.png", size)

    android_scales = {
        "ldpi": (36, 81),
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }
    for density, (legacy_size, adaptive_size) in android_scales.items():
        folder = ROOT / f"android/app/src/main/res/mipmap-{density}"
        save_square(source, folder / "ic_launcher.png", legacy_size)
        save_square(source, folder / "ic_launcher_round.png", legacy_size)
        save_square(source, folder / "ic_launcher_foreground.png", adaptive_size)

        # Kept for the generated Android project even though the opaque
        # supplied foreground fully covers it on current launchers.
        background = Image.new("RGB", (adaptive_size, adaptive_size), "#f4dfc0")
        background.save(folder / "ic_launcher_background.png", "PNG", optimize=True)

    android_splashes = {
        "drawable/splash.png": (320, 480),
        "drawable-night/splash.png": (320, 240),
        "drawable-port-ldpi/splash.png": (240, 320),
        "drawable-port-mdpi/splash.png": (320, 480),
        "drawable-port-hdpi/splash.png": (480, 800),
        "drawable-port-xhdpi/splash.png": (720, 1280),
        "drawable-port-xxhdpi/splash.png": (960, 1600),
        "drawable-port-xxxhdpi/splash.png": (1280, 1920),
        "drawable-land-ldpi/splash.png": (320, 240),
        "drawable-land-mdpi/splash.png": (480, 320),
        "drawable-land-hdpi/splash.png": (800, 480),
        "drawable-land-xhdpi/splash.png": (1280, 720),
        "drawable-land-xxhdpi/splash.png": (1600, 960),
        "drawable-land-xxxhdpi/splash.png": (1920, 1280),
    }
    android_res = ROOT / "android/app/src/main/res"
    for relative, size in android_splashes.items():
        save_splash(wordmark, android_res / relative, size)
        if relative.startswith("drawable-port-"):
            night = relative.replace("drawable-port-", "drawable-port-night-")
            save_splash(wordmark, android_res / night, size)
        elif relative.startswith("drawable-land-"):
            night = relative.replace("drawable-land-", "drawable-land-night-")
            save_splash(wordmark, android_res / night, size)

    print("Generated Web, PWA, iOS and Android brand assets from logo.png")


if __name__ == "__main__":
    main()
