#!/usr/bin/env python3
"""Split Al-Luhaidan's official full-surah MP3s without external packages.

This server-friendly companion to split-luhaidan-ayahs.mjs parses MPEG Layer III
frame boundaries directly. It never decodes or re-encodes Quran audio: every
output is a contiguous sequence of original MP3 frames selected by the same
checked-in millisecond ranges.

Run from the repository root:
  python3 scripts/gen/split-luhaidan-ayahs.py --output /absolute/output/path
"""

from __future__ import annotations

import argparse
import bisect
import json
import re
import time
import urllib.request
from pathlib import Path


SOURCE_BASE = "https://server8.mp3quran.net/lhdan"
EMPTY_ID3V23 = b"ID3\x03\x00\x00\x00\x00\x00\x00"


def pad3(value: int) -> str:
    return f"{value:03d}"


def load_ranges(path: Path) -> list[list[list[int]]]:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"LUHAIDAN_AYAH_RANGES_MS[^=]*=\s*(\[.*\])\s*;", source, re.S)
    if not match:
        raise RuntimeError(f"Could not find timing array in {path}")
    without_comments = re.sub(r"//[^\n]*", "", match.group(1))
    without_comments = re.sub(r",\s*]", "]", without_comments)
    return json.loads(without_comments)


def id3_end(data: bytes) -> int:
    if not data.startswith(b"ID3") or len(data) < 10:
        return 0
    size_bytes = data[6:10]
    if any(value & 0x80 for value in size_bytes):
        raise RuntimeError("Invalid ID3 synchsafe size")
    size = sum(value << shift for value, shift in zip(size_bytes, (21, 14, 7, 0)))
    footer = 10 if data[5] & 0x10 else 0
    return 10 + size + footer


def frame_info(data: bytes, offset: int) -> tuple[int, float] | None:
    if offset + 4 > len(data):
        return None
    header = int.from_bytes(data[offset : offset + 4], "big")
    if header & 0xFFE00000 != 0xFFE00000:
        return None
    version_bits = (header >> 19) & 0b11
    layer_bits = (header >> 17) & 0b11
    bitrate_index = (header >> 12) & 0b1111
    sample_index = (header >> 10) & 0b11
    padding = (header >> 9) & 1
    if version_bits == 0b01 or layer_bits != 0b01:
        return None
    if bitrate_index in (0, 15) or sample_index == 3:
        return None

    mpeg1 = version_bits == 0b11
    bitrate_table = (
        (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
        if mpeg1
        else (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0)
    )
    sample_rate = (44100, 48000, 32000)[sample_index]
    if version_bits == 0b10:
        sample_rate //= 2
    elif version_bits == 0b00:
        sample_rate //= 4
    bitrate = bitrate_table[bitrate_index] * 1000
    samples = 1152 if mpeg1 else 576
    coefficient = 144 if mpeg1 else 72
    length = coefficient * bitrate // sample_rate + padding
    if length < 24 or offset + length > len(data):
        return None
    return length, samples / sample_rate


def scan_frames(data: bytes) -> tuple[list[int], list[float], float]:
    offsets: list[int] = []
    starts: list[float] = []
    elapsed = 0.0
    offset = id3_end(data)
    while offset + 4 <= len(data):
        info = frame_info(data, offset)
        if info is None:
            offset += 1
            continue
        length, duration = info
        offsets.append(offset)
        starts.append(elapsed)
        elapsed += duration
        offset += length
    if not offsets:
        raise RuntimeError("No valid MP3 frames found")
    offsets.append(offset)
    return offsets, starts, elapsed


def download(url: str, target: Path) -> None:
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "quran-ing-audio-builder/1"})
            with urllib.request.urlopen(request, timeout=60) as response:
                target.write_bytes(response.read())
            return
        except Exception as error:  # noqa: BLE001 - retry any network failure
            last_error = error
            if attempt < 4:
                time.sleep(attempt * 2)
    raise RuntimeError(f"Download failed after 4 attempts: {url}") from last_error


def split_surah(source: Path, ranges: list[list[int]], output_dir: Path) -> None:
    data = source.read_bytes()
    offsets, starts, total_duration = scan_frames(data)
    final_end = ranges[-1][1] / 1000
    if total_duration + 1 < final_end:
        raise RuntimeError(
            f"Source duration {total_duration:.3f}s is shorter than timing {final_end:.3f}s"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_dir.chmod(0o755)
    for index, (start_ms, end_ms) in enumerate(ranges, start=1):
        output = output_dir / f"{index:03d}.mp3"
        if output.exists() and output.stat().st_size > 512:
            continue
        first = min(bisect.bisect_left(starts, start_ms / 1000), len(starts) - 1)
        after_last = min(bisect.bisect_left(starts, end_ms / 1000), len(starts))
        if after_last <= first:
            after_last = first + 1
        payload = data[offsets[first] : offsets[after_last]]
        if len(payload) <= 512:
            raise RuntimeError(f"Ayah {index}: generated file is empty")
        output.write_bytes(EMPTY_ID3V23 + payload)
        output.chmod(0o644)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ranges", type=Path, default=Path("src/content/luhaidan-ayah-ranges.ts"))
    parser.add_argument("--from", dest="from_surah", type=int, default=1)
    parser.add_argument("--to", dest="to_surah", type=int, default=114)
    args = parser.parse_args()
    if not 1 <= args.from_surah <= args.to_surah <= 114:
        parser.error("--from and --to must describe a range inside 1..114")

    ranges_by_surah = load_ranges(args.ranges)
    args.output.mkdir(parents=True, exist_ok=True)
    args.output.chmod(0o755)
    for surah in range(args.from_surah, args.to_surah + 1):
        ranges = ranges_by_surah[surah]
        target_dir = args.output / pad3(surah)
        complete = all(
            (target_dir / f"{ayah:03d}.mp3").exists()
            and (target_dir / f"{ayah:03d}.mp3").stat().st_size > 512
            for ayah in range(1, len(ranges) + 1)
        )
        if complete:
            print(f"Luhaidan {surah:03d}: already complete ({len(ranges)} ayahs)", flush=True)
            continue
        source = args.output / f".source-{surah:03d}.mp3"
        print(f"Luhaidan {surah:03d}: downloading full surah", flush=True)
        if not source.exists() or source.stat().st_size <= 512:
            download(f"{SOURCE_BASE}/{surah:03d}.mp3", source)
        split_surah(source, ranges, target_dir)
        source.unlink(missing_ok=True)
        print(f"Luhaidan {surah:03d}: complete ({len(ranges)} ayahs)", flush=True)


if __name__ == "__main__":
    main()
