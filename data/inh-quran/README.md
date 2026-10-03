# Ингушские (ГӀалгӀай) ресурсы Корана

Извлечено из Android-приложения **«Коран и Сунна»** v4.60 (`Коран+и+Сунна_4.60_apkcombo.com.apk`).
Package: `ing.galgaev.quran`. Скачано: 2026-05-16.

## Файлы

### `quran_translation_ing_smisl.db` (1.4 MB, SQLite)

Литературный смысловой перевод Корана на ингушский (2023).
В UI приложения подписан: «ГӀалгӀай — Сийдолча КъорӀан маӀана таржам (2023)».

```sql
CREATE TABLE translations (
  id INTEGER NOT NULL,
  sura INTEGER,
  aya INTEGER,
  translation TEXT,
  footnotes TEXT
);
```

Пример (`SELECT translation FROM translations WHERE sura=1 AND aya=1`):
> Алла́хӀа цӀерца, Къахетам беши Къахетам бергболаши волча.

Источник: `https://vmi653486.contaboserver.net/tdb/quran_translation_ing_smisl.db.zip`
Версия: `converted from xml 2024-08-10 08:08:44`

---

### `quran_translation_ing_tafs.db` (3.0 MB, SQLite)

Развёрнутый тафсир: литературный перевод + комментарии в скобках,
ссылки на хадисы, сноски на словарь терминов.
В UI приложения подписан: «ГӀалгӀай — Сийдолча КъорӀан тафсир (2023)».

Та же схема что и `_smisl`. В `translation` встречаются HTML-теги:
- `<b>...</b>` — собственно перевод аята;
- `<a href="footnote://dialog_snoski?tip=ing_tafs&snoska=N">...</a>` —
  ссылка на термин № `N` из `tafsir-glossary.json` (см. ниже);
- `<p>` — разделитель абзацев внутри длинного комментария.

Источник: `https://vmi653486.contaboserver.net/tdb/quran_translation_ing_tafs.db.zip`
Версия: `converted from xml 2024-08-10 08:08:44`

---

### `quran-wbw-translation-inh.db` (2.5 MB, SQLite)

Перевод **слово-за-слово** (word-by-word). Для каждого арабского слова
аята — короткий ингушский эквивалент. 77 429 строк, все 114 сур.

```sql
CREATE TABLE word_by_word_translation (
  sura INTEGER,
  ayat INTEGER,
  "order" INTEGER,  -- порядок слова в аяте, 1-based
  text TEXT          -- ингушский эквивалент; "*" = служебный/пустой
);
```

Источник: `https://vmi653486.contaboserver.net/tdb/quran-wbw-translation-inh.db.zip`
Дата файла: 2020-08-31 (старее литературного — у автора это первая версия).

---

### `asma-ul-husna.json` (99 имён Аллаха)

99 имён Аллаха с ингушским значением, арабской транслитерацией и арабской вязью.
Извлечено из `res/values-inh/arrays.xml > common_names`.

```json
{
  "n": 1,
  "raw": "1@АллахI @Аллóахl@الله",
  "parts": ["1", "АллахI", "Алл<b>оа</b>хI", "الله"]
}
```
Где `parts[1]` — ингушское имя/значение, `parts[2]` — транслитерация
с акцентом для огласовок (через `<b>гласная</b>`), `parts[3]` —
оригинальная арабская графема.

---

### `tafsir-glossary.json` (277 терминов)

Толковый словарь терминов на ингушском. Используется как сноски в
`quran_translation_ing_tafs.db` (см. формат `<a href="footnote://...">`).

Извлечено из `res/values/arrays.xml > snoski_ing_tafs`.

```json
{ "id": 1, "text": "азале – прошлое, вечность без начала." }
```

---

## Формат склейки в нашем `quran-sources.ts`

Для интеграции в проект каждый аят описывается как:

```ts
{
  surah: 1,
  ayah: 1,
  arabic: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
  translations: {
    inh:        '<smisl>',  // из quran_translation_ing_smisl.db
    inh_tafsir: '<tafs>',   // опционально, из quran_translation_ing_tafs.db
    ru:         '<kuliev>',
  },
  editions: {
    arabic: 'ar-quran-uthmani',
    ru:     'ru-kuliev',
    inh:    'inh-galgay-smisl-2023',
    inh_tafsir: 'inh-galgay-tafs-2023',
  },
  fetchedAt: '2026-05-16',
}
```

## Лицензия

Автор перевода / приложения «Коран и Сунна» (`ing.galgaev.quran`)
распространяет ресурсы бесплатно через свой CDN
(`vmi653486.contaboserver.net`), без авторизации/ключей.

Перед публичным использованием в нашем `l.asrbook.ru`
имеет смысл найти и явно указать имя переводчика (в самом UI приложения
встречается ссылка на блок «О приложении» — там должна быть атрибуция).

## Скрипт скачивания (для повторного импорта)

```bash
mkdir -p data/inh-quran && cd data/inh-quran
for f in quran-wbw-translation-inh.db quran_translation_ing_smisl.db quran_translation_ing_tafs.db; do
  curl -sLo "${f}.zip" "https://vmi653486.contaboserver.net/tdb/${f}.zip"
  unzip -oq "${f}.zip" && rm "${f}.zip"
done
```
