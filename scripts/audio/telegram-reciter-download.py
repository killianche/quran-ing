#!/usr/bin/env python3
"""Скачать записи нового чтеца из публичного Telegram-канала.

Зачем так. Записи друга владельца (Хьусейн Мержоев) лежат в канале
t.me/khmerzhoev1111 — 80 файлов по 25–66 МБ. Веб-предпросмотр канала не
даёт ссылок на файлы, а Bot API отдаёт только до 20 МБ. Остаётся клиентский
API Telegram (MTProto, библиотека Telethon) под учётной записью человека.

Безопасность — главное в этом скрипте:
  • номер, код из Telegram, пароль 2FA и api_hash вводятся в терминале, а не
    в чат с ассистентом; api_hash и пароль — без эха;
  • сессия и ключи лежат в `secrets/telegram/` (закрыто в .gitignore,
    права 700/600);
  • `logout` завершает сессию на стороне Telegram и стирает её с диска —
    звать сразу после скачивания.

Порядок (из корня QuranIng):
  .venv/bin/python scripts/audio/telegram-reciter-download.py login
  .venv/bin/python scripts/audio/telegram-reciter-download.py download
  .venv/bin/python scripts/audio/telegram-reciter-download.py logout

Скачанное — в `reciter-audio/original/` (тоже вне git) под исходным именем
файла с номером поста впереди, плюс `manifest.json`: номер поста, имя,
исполнитель, длительность, размер, sha256. Повторный `download` докачивает
только недостающее.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import hashlib
import json
import os
import re
import sys
from pathlib import Path

from telethon import TelegramClient

ROOT = Path(__file__).resolve().parents[2]
SECRETS = ROOT / "secrets" / "telegram"
SESSION = SECRETS / "reciter"          # Telethon допишет .session
API_FILE = SECRETS / "api.json"
OUT = ROOT / "reciter-audio" / "original"
MANIFEST = OUT / "manifest.json"
DEFAULT_CHANNEL = "khmerzhoev1111"


def ensure_secrets_dir() -> None:
    SECRETS.mkdir(parents=True, exist_ok=True)
    os.chmod(SECRETS, 0o700)


def load_api() -> tuple[int, str]:
    if not API_FILE.exists():
        sys.exit("Нет ключей API. Сначала: … telegram-reciter-download.py login")
    data = json.loads(API_FILE.read_text(encoding="utf-8"))
    return int(data["api_id"]), str(data["api_hash"])


def safe_name(name: str) -> str:
    # Только то, что ломает путь; кириллицу и пробелы оставляем —
    # по исходному имени потом определяется номер суры.
    return re.sub(r'[/\\\0]', "_", name).strip() or "audio.mp3"


async def cmd_login() -> None:
    ensure_secrets_dir()
    print("Ключи берутся на https://my.telegram.org → API development tools.")
    api_id = int(input("api_id: ").strip())
    api_hash = getpass.getpass("api_hash (ввод не отображается): ").strip()
    API_FILE.write_text(json.dumps({"api_id": api_id, "api_hash": api_hash}), encoding="utf-8")
    os.chmod(API_FILE, 0o600)

    client = TelegramClient(str(SESSION), api_id, api_hash)
    # start() сам спросит номер, код из Telegram и, если включён, пароль 2FA
    # (пароль — без эха).
    await client.start()
    me = await client.get_me()
    session_file = Path(f"{SESSION}.session")
    if session_file.exists():
        os.chmod(session_file, 0o600)
    print(f"Вход выполнен: {me.first_name or ''}. Теперь можно запускать download.")
    await client.disconnect()


async def cmd_download(channel: str) -> None:
    api_id, api_hash = load_api()
    client = TelegramClient(str(SESSION), api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        await client.disconnect()
        sys.exit("Сессии нет или она закрыта. Сначала: … login")

    OUT.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    by_post = {item["post"]: item for item in manifest}

    entity = await client.get_entity(channel)
    audio = [m async for m in client.iter_messages(entity, reverse=True)
             if m.file and (m.file.mime_type or "").startswith("audio/")]
    print(f"В канале аудиофайлов: {len(audio)}")

    for index, msg in enumerate(audio, start=1):
        f = msg.file
        original = f.name or f"{f.title or 'audio'}{f.ext or '.mp3'}"
        target = OUT / f"{msg.id:04d} {safe_name(original)}"
        label = f"[{index}/{len(audio)}] пост {msg.id}: {original} ({f.size / 1e6:.1f} МБ)"

        if target.exists() and target.stat().st_size == f.size and msg.id in by_post:
            print(f"{label} — уже есть")
            continue

        part = target.with_name(target.name + ".part")
        last_pct = -1

        def progress(done: int, total: int) -> None:
            nonlocal last_pct
            pct = int(done * 100 / total) if total else 0
            if pct >= last_pct + 10:
                last_pct = pct
                print(f"\r{label} — {pct}%", end="", flush=True)

        saved = await client.download_media(msg, file=str(part), progress_callback=progress)
        # Берём путь, который вернула библиотека: она вправе поправить имя.
        part = Path(saved) if saved else part
        if not part.exists() or part.stat().st_size != f.size:
            got = part.stat().st_size if part.exists() else 0
            print(f"\n{label} — размер не совпал ({got} вместо {f.size}), файл оставлен как .part")
            continue
        part.rename(target)

        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        by_post[msg.id] = {
            "post": msg.id,
            "file": target.name,
            "original_name": original,
            "title": f.title,
            "performer": f.performer,
            "duration_s": f.duration,
            "size": f.size,
            "mime": f.mime_type,
            "date": msg.date.isoformat() if msg.date else None,
            "sha256": digest,
        }
        MANIFEST.write_text(
            json.dumps(sorted(by_post.values(), key=lambda x: x["post"]), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\r{label} — готово")

    await client.disconnect()
    print(f"Готово. Файлы: {OUT}")


async def cmd_logout() -> None:
    if API_FILE.exists() and Path(f"{SESSION}.session").exists():
        api_id, api_hash = load_api()
        client = TelegramClient(str(SESSION), api_id, api_hash)
        await client.connect()
        if await client.is_user_authorized():
            # Завершает сессию на стороне Telegram; Telethon при этом сам
            # удаляет файл сессии.
            await client.log_out()
        else:
            await client.disconnect()
    for leftover in (Path(f"{SESSION}.session"), Path(f"{SESSION}.session-journal"), API_FILE):
        if leftover.exists():
            leftover.unlink()
    print("Сессия закрыта, ключи и файл сессии удалены.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["login", "download", "logout"])
    parser.add_argument("--channel", default=DEFAULT_CHANNEL)
    args = parser.parse_args()
    if args.command == "login":
        asyncio.run(cmd_login())
    elif args.command == "download":
        asyncio.run(cmd_download(args.channel))
    else:
        asyncio.run(cmd_logout())


if __name__ == "__main__":
    main()
