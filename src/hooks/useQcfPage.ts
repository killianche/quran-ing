/**
 * useQcfPage — загружает и кэширует одну страницу мусхафа.
 *
 * Данные лежат в /qcf4/pages/NNN.json (издание V4) или /qcf1/pages/NNN.json
 * (издание V1 «Мадани 1405»), номер страницы дополнен нулями до трёх цифр.
 * Результат кладётся в кэш уровня модуля, поэтому возврат на уже
 * загруженную страницу происходит мгновенно.
 *
 * ── Почему ключ кэша составной ────────────────────────────────────────
 *
 * Страница 106 существует в обоих изданиях, но набрана разными глифами.
 * Кэш по одному номеру отдал бы данные V4 там, где просили V1, — и
 * страница показала бы красивый, но ЧУЖОЙ арабский. Такую ошибку не
 * поймают ни типы, ни сборка, ни беглый взгляд на экран: арабский на
 * месте, просто не тот. Отсюда ключ «издание|номер» и сверка издания
 * пришедшего файла с запрошенным.
 *
 * pageNum=null выключает хук (используется при подгрузке соседней
 * страницы, когда соседа не существует).
 */

import { useState, useEffect } from 'react';
import {
  type QcfPageData,
  type QcfEdition,
  DEFAULT_QCF_EDITION,
  pageJsonPath,
  hydratePage,
} from '../lib/qcf4';

/** Ключ кэша: издание и номер вместе, по отдельности они не различают страницу. */
function cacheKey(pageNum: number, edition: QcfEdition): string {
  return `${edition}|${pageNum}`;
}

// Кэш уровня модуля: «издание|номер» → загруженные данные
const pageCache = new Map<string, QcfPageData>();
// Дедупликация: один запрос в полёте на страницу издания
const pagePromises = new Map<string, Promise<QcfPageData>>();

function fetchPage(pageNum: number, edition: QcfEdition): Promise<QcfPageData> {
  const key = cacheKey(pageNum, edition);
  const existing = pagePromises.get(key);
  if (existing) return existing;

  const promise = fetch(pageJsonPath(pageNum, edition))
    .then(r => {
      if (!r.ok) throw new Error(`page ${pageNum} HTTP ${r.status}`);
      return r.json() as Promise<QcfPageData>;
    })
    .then(raw => {
      // Файл, назвавший себя чужим изданием, до кэша не доходит. Это не
      // паранойя: перепутанное издание выглядит как исправная страница
      // мусхафа, и отличить её от правильной можно только по глифам.
      //
      // У V4 поля может не быть — так лежат все файлы, написанные до
      // второго издания, и молчание там означает именно V4.  У любого
      // другого издания поле обязательно: файл, который себя не назвал,
      // этим изданием не является, чем бы он ни оказался на деле.
      const declared = raw.edition
        ?? (edition === DEFAULT_QCF_EDITION ? DEFAULT_QCF_EDITION : null);
      if (declared !== edition) {
        throw new Error(
          `page ${pageNum}: ожидалось издание ${edition}, `
          + `в файле ${raw.edition ?? 'издание не указано'}`,
        );
      }
      // Номер страницы нужен каждому слову: шрифты V4 нарезаны по
      // страницам, и семейство выбирается по паре (шрифт, страница).
      // Заодно проставляется издание — в файлах V4 его нет.
      const data = hydratePage(raw, edition);
      pageCache.set(key, data);
      pagePromises.delete(key);
      return data;
    })
    .catch(err => {
      pagePromises.delete(key);
      throw err;
    });

  pagePromises.set(key, promise);
  return promise;
}

/** Get cached page data synchronously, or null if not loaded yet. */
export function getPageSync(
  pageNum: number,
  edition: QcfEdition = DEFAULT_QCF_EDITION,
): QcfPageData | null {
  return pageCache.get(cacheKey(pageNum, edition)) ?? null;
}

/**
 * Дождаться одной страницы.
 *
 * Нужно, чтобы заказать шрифты ПЕРВОЙ страницы суры, не дожидаясь
 * остальных: у Бакары их сорок пять, и пока едут все, шрифт первого
 * экрана даже не начинал качаться.  Какие подмножества нужны странице,
 * известно только из её json — отсюда обещание, а не fire-and-forget.
 */
export function ensurePage(
  pageNum: number,
  edition: QcfEdition = DEFAULT_QCF_EDITION,
): Promise<QcfPageData> {
  const cached = pageCache.get(cacheKey(pageNum, edition));
  if (cached) return Promise.resolve(cached);
  return fetchPage(pageNum, edition);
}

export function useQcfPage(
  pageNum: number | null,
  edition: QcfEdition = DEFAULT_QCF_EDITION,
): {
  data: QcfPageData | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<QcfPageData | null>(
    () => (pageNum !== null ? pageCache.get(cacheKey(pageNum, edition)) ?? null : null),
  );
  const [loading, setLoading] = useState<boolean>(
    () => pageNum !== null && !pageCache.has(cacheKey(pageNum, edition)),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pageNum === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Already in cache — instant
    const cached = pageCache.get(cacheKey(pageNum, edition));
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetchPage(pageNum, edition)
      .then(page => {
        if (cancelled) return;
        setData(page);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Ошибка загрузки страницы');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pageNum, edition]);

  // После смены pageNum эффект обновит state только после первого кадра.
  // Не отдаём в этот кадр данные предыдущей страницы: иначе шапка уже
  // показывает новый номер, а под ней на мгновение остаётся старый текст.
  //
  // Издание проверяется наравне с номером: при смене шрифта номер
  // страницы не меняется, и без этой проверки в кадр переключения попали
  // бы данные прошлого издания — то есть чужие глифы.
  const currentData = pageNum === null
    ? null
    : data?.page === pageNum && (data.edition ?? DEFAULT_QCF_EDITION) === edition
      ? data
      : pageCache.get(cacheKey(pageNum, edition)) ?? null;

  return {
    data: currentData,
    loading: pageNum !== null && !currentData ? true : loading,
    error: currentData ? null : error,
  };
}
