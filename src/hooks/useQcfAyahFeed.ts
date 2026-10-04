/**
 * useQcfAyahFeed — loads QCF V4 data for an entire surah, grouped by ayah.
 *
 * Why a separate hook from useQcfPage / useQcfSurah:
 *   QcfMushafPage rendered ONE page at a time. The ayah-feed UX needs ALL
 *   ayahs of a surah in order. We load every page the surah spans, then
 *   walk the lines and bucket each word into its verse_key.
 *
 * What is preserved per ayah:
 *   - `words`: every QcfWord with this verse_key, in encounter order across pages
 *   - `fonts`: distinct font family names used by the ayah's words (for useQcfFont)
 *   - `pageNum`: first page the ayah appears on (used for "Page N" chip)
 *
 * Decorative items (surah_header, basmala) live in `headers` / `basmala`
 * because they don't have a verse_key.  Basmala for surah 1 (Al-Fatiha) is
 * part of ayah 1:1 and ends up inside the ayah's words instead.
 *
 * Loading strategy: kicks off fetches for every page of the surah in
 * parallel.  Начало суры отдаётся, как только приехала её первая
 * страница (см. buildFeed и showStartEarly) — у Бакары сорок восемь
 * страниц, и ждать все ради первого экрана незачем.  Полная лента
 * приходит следом и только она попадает в кэш.
 *
 * Re-uses the page cache from useQcfPage so already-loaded pages don't
 * round-trip.
 */

import { useState, useEffect } from 'react';
import type { QcfWord, QcfPageData, QcfFontRef } from '../lib/qcf4';
import { loadVersesJson, distinctFontRefs } from '../lib/qcf4';
import { ensurePage } from './useQcfPage';

/** One ayah's worth of QCF data, ready to render. */
export interface QcfAyahEntry {
  verseKey: string;
  surah: number;
  ayah: number;
  /** First page this ayah appears on */
  pageNum: number;
  /** All words in this ayah, in mushaf reading order */
  words: QcfWord[];
  /** Подмножества шрифтов, нужные словам аята — пары «шрифт + страница» */
  fonts: QcfFontRef[];
}

/** Decorative items that don't belong to any single ayah. */
export interface QcfSurahDecor {
  /** Words of type 'surah_header' (each line gets concatenated) */
  header: QcfWord[];
  /** Words of type 'basmala' — empty when the surah has no separate basmala
   *  (Al-Fatiha, At-Tawba), shown as a centered line when present */
  basmala: QcfWord[];
  /** Подмножества для заголовка и басмалы — пары «шрифт + страница» */
  fonts: QcfFontRef[];
}

export interface QcfAyahFeed {
  decor: QcfSurahDecor;
  /** Ayahs sorted by ayah number ascending */
  ayahs: QcfAyahEntry[];
}

// Module-level LRU cache: surah → loaded feed (макс 10 сур одновременно).
// Map сохраняет insertion order; touchFeedCache переставляет accessed
// surah в end чтобы не выселить, и эвиктует самые старые при превышении.
// 10 — достаточно для типичного reading-flow (текущая сура + 2-3 в
// истории + Аль-Фатиха + 3-5 любимых), но не даёт расти бесконечно
// (Бакара feed ~3 МБ JSON parsed, 50+ сур = 150+ МБ RAM на iPhone — easy OOM).
const FEED_CACHE_MAX = 10;
const feedCache = new Map<number, QcfAyahFeed>();

function touchFeedCache(surahNumber: number, feed: QcfAyahFeed) {
  if (feedCache.has(surahNumber)) feedCache.delete(surahNumber);
  feedCache.set(surahNumber, feed);
  while (feedCache.size > FEED_CACHE_MAX) {
    const oldest = feedCache.keys().next().value;
    if (oldest == null) break;
    feedCache.delete(oldest);
  }
}

function fetchPageData(pageNum: number): Promise<QcfPageData> {
  // Через ensurePage, а не своим fetch: у useQcfPage есть карта запросов в
  // полёте, и без неё первая страница суры качалась дважды — её просит
  // SurahScreen, чтобы заранее заказать шрифт, и тут же лента.
  return ensurePage(pageNum);
}

/**
 * Собрать ленту из уже загруженных страниц.
 *
 * Вынесено отдельно, потому что вызывается дважды: сначала на одной
 * первой странице суры, чтобы показать начало без ожидания, потом на
 * всех — см. buildFeed.
 *
 * Decorative items (surah_header, basmala) are collected separately from
 * verse-keyed words so the renderer can place them above the ayah list.
 */
function assembleFeed(surahNumber: number, pages: QcfPageData[]): QcfAyahFeed {
  const prefix = `${surahNumber}:`;

  // Buckets
  const ayahMap = new Map<string, QcfAyahEntry>();
  const headerWords: QcfWord[] = [];
  const basmalaWords: QcfWord[] = [];

  for (const page of pages) {
    for (const line of page.lines) {
      for (const word of line.words) {
        // Decorative — only for the current surah, skip if the page contains
        // another surah's header too (e.g. mid-page transitions)
        if (word.type === 'surah_header' && word.sura === surahNumber) {
          headerWords.push(word);
          continue;
        }
        // QCF V4 data uses the literal string `bismillah` for the Basmala
        // glyph row that precedes every surah except At-Tawba.  Earlier
        // versions of this code matched `basmala`, which never appears in
        // the source JSON — so the Basmala title row silently never rendered
        // for surahs 2..114.  Match the actual data string.
        if (word.type === 'bismillah' && word.sura === surahNumber) {
          basmalaWords.push(word);
          continue;
        }

        // Verse-keyed word
        if (!word.verse_key || !word.verse_key.startsWith(prefix)) continue;

        const existing = ayahMap.get(word.verse_key);
        if (existing) {
          existing.words.push(word);
        } else {
          const [, ayahStr] = word.verse_key.split(':');
          ayahMap.set(word.verse_key, {
            verseKey: word.verse_key,
            surah: surahNumber,
            ayah: parseInt(ayahStr, 10),
            pageNum: page.page,
            words: [word],
            fonts: [],
          });
        }
      }
    }
  }

  // Какие подмножества нужны каждому аяту.  Считаем по парам «шрифт +
  // страница»: аят на стыке страниц берёт слова из двух подмножеств.
  for (const entry of ayahMap.values()) {
    entry.fonts = distinctFontRefs(entry.words, 'qcf-v4');
  }

  const ayahs = Array.from(ayahMap.values()).sort((a, b) => a.ayah - b.ayah);

  const decorFonts = distinctFontRefs([...headerWords, ...basmalaWords], 'qcf-v4');

  return {
    decor: {
      header: headerWords,
      basmala: basmalaWords,
      fonts: decorFonts,
    },
    ayahs,
  };
}

/**
 * Загрузить суру целиком, по пути отдав её начало.
 *
 * Раньше лента ждала все страницы суры разом.  У Бакары их сорок восемь,
 * и хотя каждая — три килобайта, сорок восемь запросов по медленной сети
 * держали экран пустым четыре секунды: человек не видел ни текста, ни
 * даже скелета, хотя первая страница приехала за сто пятьдесят
 * миллисекунд.
 *
 * Теперь первая страница собирается в ленту сразу и уходит в `onPartial`.
 * Начало суры (и её заголовок с басмалой — они на первой странице) видно
 * почти мгновенно, остальное дополняется, когда приедет.
 *
 * В кэш идёт только полная лента: неполной нельзя, иначе следующий вход
 * в суру получил бы обрезанный текст Корана.
 */
/** Сборки ленты в полёте: предзагрузка по касанию и сам экран суры не
 *  должны собирать одну и ту же ленту дважды (для Аль-Бакары это заметная
 *  работа главного потока прямо во время выезда экрана). */
const feedInflight = new Map<number, Promise<QcfAyahFeed>>();

async function buildFeed(
  surahNumber: number,
  onPartial?: (feed: QcfAyahFeed) => void,
): Promise<QcfAyahFeed> {
  const cached = feedCache.get(surahNumber);
  if (cached) {
    // Свежий доступ — в конец LRU, иначе читаемую суру вытеснила бы
    // предзагрузка других.
    touchFeedCache(surahNumber, cached);
    return cached;
  }

  const verses = await loadVersesJson();
  const prefix = `${surahNumber}:`;

  // Collect distinct pages the surah spans, sorted ascending.
  const pageSet = new Set<number>();
  for (const [key, val] of Object.entries(verses)) {
    if (key.startsWith(prefix)) pageSet.add(val.page);
  }
  const pageNums = Array.from(pageSet).sort((a, b) => a - b);

  // Все страницы просим сразу — они и так качаются параллельно.  Разница
  // в том, что первую ещё и ждём отдельно, чтобы отдать начало суры.
  // ensurePage не качает страницу второй раз, если она уже в полёте.
  const all = pageNums.map(p => fetchPageData(p));

  if (onPartial && all.length > 1 && !feedCache.has(surahNumber)) {
    try {
      const first = await all[0];
      // Полная лента могла успеть собраться, пока ждали первую страницу.
      if (!feedCache.has(surahNumber)) onPartial(assembleFeed(surahNumber, [first]));
    } catch {
      // Ошибку первой страницы разберёт общий await ниже.
    }
  }

  const ready = feedCache.get(surahNumber);
  if (ready) return ready;
  let pending = feedInflight.get(surahNumber);
  if (!pending) {
    pending = Promise.all(all)
      .then(pages => {
        const feed = assembleFeed(surahNumber, pages);
        touchFeedCache(surahNumber, feed);
        return feed;
      })
      .finally(() => { feedInflight.delete(surahNumber); });
    feedInflight.set(surahNumber, pending);
  }
  return pending;
}

/**
 * Начать загрузку суры заранее — по касанию её строки, ещё до клика
 * (2026-10-04, плавность открытия). Касание и отпускание разделяет около
 * 100 мс; за это время уходят запросы страниц, и экран суры получает
 * ленту из кэша или из той же загрузки. Ошибки молчат: их покажет сам
 * экран, если загрузка не удастся и при открытии.
 */
export function prefetchSurahFeed(surahNumber: number): void {
  if (feedCache.has(surahNumber) || feedInflight.has(surahNumber)) return;
  void buildFeed(surahNumber).catch(() => undefined);
}

/**
 * Public hook — subscribes to the feed for a given surah.
 *
 * `showStartEarly` разрешает показать начало суры, не дожидаясь остальных
 * страниц.  Включать можно только когда человек читает с начала: если он
 * пришёл по закладке на аят 200, в неполной ленте этого аята ещё нет, и
 * восстановление прокрутки увело бы его не туда.
 */
export function useQcfAyahFeed(surahNumber: number, showStartEarly = false): {
  feed: QcfAyahFeed | null;
  loading: boolean;
  error: string | null;
} {
  const [feed, setFeed] = useState<QcfAyahFeed | null>(
    () => feedCache.get(surahNumber) ?? null,
  );
  const [loading, setLoading] = useState<boolean>(
    () => !feedCache.has(surahNumber),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = feedCache.get(surahNumber);
    if (cached) {
      setFeed(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setFeed(null);
    setLoading(true);
    setError(null);

    buildFeed(
      surahNumber,
      showStartEarly
        ? partial => {
            if (cancelled) return;
            setFeed(partial);
            setLoading(false);
          }
        : undefined,
    )
      .then(result => {
        if (cancelled) return;
        setFeed(result);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Ошибка загрузки суры');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [surahNumber, showStartEarly]);

  return { feed, loading, error };
}
