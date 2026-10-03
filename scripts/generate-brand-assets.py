#!/usr/bin/env python3
"""Generate every Quran Ing app icon and splash image from ``logo.png``.

The source is intentionally kept as a regular opaque PNG: App Store icons
must not contain an alpha channel, and using one file prevents Web, iOS and
Android branding from drifting apart.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "logo.png"
RESAMPLE = Image.Resampling.LANCZOS

WORDMARK = ROOT / "logo-wordmark.png"
BRAND = ROOT / "brand.json"


def brand() -> dict:
    """Параметры знака из brand.json — его пишет scripts/brand/design-logo.py."""
    if not BRAND.is_file():
        raise SystemExit(f"Missing {BRAND.name}: run scripts/brand/design-logo.py --variant <id>")
    data = json.loads(BRAND.read_text(encoding="utf-8"))
    background = data.get("background", "")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", background):
        raise SystemExit(f"{BRAND.name}: background must be #RRGGBB, got {background!r}")
    return data


def brand_background() -> str:
    """Цвет плитки: фон заставок и адаптивной иконки Android."""
    return brand()["background"]


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


def load_wordmark() -> Image.Image:
    """Знак для заставки — готовый файл от design-logo.py.

    У an-Nur знак вырезался из logo.png по контуру, подогнанному под ту
    картинку; у Quran Ing исходник логотипа — код, и знак он отдаёт сам.
    """
    if not WORDMARK.is_file():
        raise SystemExit(f"Missing {WORDMARK.name}: run scripts/brand/design-logo.py --variant <id>")
    return Image.open(WORDMARK).convert("RGBA")


def splash_background(size: tuple[int, int]) -> Image.Image:
    """Фон заставки — цвет плитки логотипа (brand.json)."""
    return Image.new("RGB", size, brand_background())


def save_wordmark(wordmark: Image.Image) -> None:
    target = ROOT / "public/brand/wordmark.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    wordmark.save(target, "PNG", optimize=True)


def save_adaptive_foreground(wordmark: Image.Image, target: Path, size: int) -> None:
    """Передний слой адаптивной иконки Android: только знак, прозрачный фон.

    Лаунчер показывает центральные 72 из 108 dp (66,7%) и режет их маской —
    часто кругом. Целая плитка с крупным словом теряла бы края букв: углы
    рамки слова выходили за круг. Знак вписывается так, чтобы его
    полудиагональ была не больше 30% стороны — с запасом внутри круга
    радиуса 33,3%. Фон даёт отдельный слой цвета плитки.
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    limit = 0.30 * size
    half_diagonal = (wordmark.width ** 2 + wordmark.height ** 2) ** 0.5 / 2
    scale = limit / half_diagonal
    mark = wordmark.resize(
        (max(1, round(wordmark.width * scale)), max(1, round(wordmark.height * scale))), RESAMPLE,
    )
    # Тот же оптический подъём, что и в logo.png, — иначе адаптивная иконка
    # отличалась бы от обычной.
    lift = round(size * float(brand().get("opticalLift", 0)))
    canvas.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2 - lift), mark)
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target, "PNG", optimize=True)


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

    wordmark = load_wordmark()
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
        save_adaptive_foreground(wordmark, folder / "ic_launcher_foreground.png", adaptive_size)

        background = Image.new("RGB", (adaptive_size, adaptive_size), brand_background())
        background.save(folder / "ic_launcher_background.png", "PNG", optimize=True)

    # Цвет фонового слоя адаптивной иконки (mipmap-anydpi-v26 ссылается на
    # @color/ic_launcher_background). У an-Nur он оставался белым шаблонным:
    # его закрывал непрозрачный передний слой. Теперь передний слой
    # прозрачный, и фон обязан быть цветом плитки.
    (ROOT / "android/app/src/main/res/values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="ic_launcher_background">{brand_background().upper()}</color>\n'
        '</resources>\n',
        encoding="utf-8",
    )

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
