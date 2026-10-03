/** Постраничные данные цветного QPC V4 Tajweed — лента берёт аят из страницы. */

import type { TajweedAyahData } from '../content/quran-tajweed-meta';

export type TajweedPageWordType = 'word' | 'end';

export type TajweedPageWord = {
  code: string;
  text: string;
  verseKey: string;
  /** Позиция элемента в данных цветного шрифта, с единицы. */
  position: number;
  type: TajweedPageWordType;
};

export type TajweedPageLine = {
  line: number;
  words: TajweedPageWord[];
};

export type TajweedPageData = {
  page: number;
  lines: TajweedPageLine[];
};

export function tajweedPageJsonPath(page: number): string {
  return `/tajweed/pages/${String(page).padStart(3, '0')}.json`;
}

/**
 * Собрать один аят из маленького постраничного JSON.
 *
 * Лента раньше загружала единый 3.3-МБ словарь всех 6236 аятов. Эти же
 * данные уже лежат по страницам для полноэкранного мусхафа, поэтому
 * текущему экрану достаточно 2–6 КБ одной страницы.
 */
export function tajweedAyahFromPage(
  data: TajweedPageData | null,
  verseKey: string,
): TajweedAyahData | null {
  if (!data) return null;
  const [surah, ayah] = verseKey.split(':').map(Number);
  if (!Number.isFinite(surah) || !Number.isFinite(ayah)) return null;

  const matches = data.lines
    .flatMap(line => line.words)
    .filter(word => word.verseKey === verseKey);
  if (matches.length === 0) return null;

  return {
    surah,
    ayah,
    page: data.page,
    words: matches
      .filter(word => word.type === 'word')
      .map(word => ({ code: word.code, text: word.text })),
    endMarker: matches.find(word => word.type === 'end')?.code ?? '',
  };
}
