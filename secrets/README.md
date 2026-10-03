# Каталог для ключа App Store Connect

Сюда кладётся файл `AuthKey_XXXXXXXXXX.p8`, скачанный в App Store Connect →
Users and Access → Integrations → App Store Connect API.

**Содержимое каталога в git не попадает** — он целиком в `.gitignore`, как и
любые файлы `*.p8`. Этот README — единственное исключение, он добавлен
принудительно, чтобы каталог существовал и было видно, что сюда класть.

Apple даёт скачать ключ **один раз**. Потеряли — выпускайте новый и отзывайте
старый там же.

## Файл доступов

Рядом с ключом лежит `asc.env` — из него скрипты выпуска берут идентификаторы.
До 07.09.2026 они были вписаны прямо в скрипты; когда репозиторий сделали
публичным, их оттуда убрали. Сами по себе они никуда не пускают — без `.p8`
подписать запрос нечем, — но и публиковать их незачем.

```bash
# secrets/asc.env
export ASC_ISSUER_ID=<issuer id>
export ASC_KEY_ID=<key id>
export ASC_KEY_PATH=secrets/AuthKey_<key id>.p8
# Apple ID приложения Quran Ing (App Store Connect → App Information).
# Не 6802455200 — это an-Nur, скрипты такой id отвергают.
export ASC_APP_ID=<apple id приложения>
```

Без этого файла скрипты выпуска останавливаются с понятной ошибкой, а не
пытаются работать без доступа.

Запуск проверки доступа:

```bash
ASC_ISSUER_ID=<issuer id> \
ASC_KEY_ID=<key id> \
ASC_KEY_PATH=secrets/AuthKey_XXXXXXXXXX.p8 \
npm run asc:status
```

Подробности — `RELEASE.md`, раздел «Доступ к App Store Connect».
