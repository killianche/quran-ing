/**
 * Тафсир ас-Саади на русском (перевод Эльмира Кулиева) — данные для окна
 * «Тафсир» у аята.
 *
 * Файлы `public/tafsir/saadi-ru/NNN.json` собирает
 * `scripts/gen/build-saadi-tafsir.py`: текст — дословно из Quran Foundation
 * (ресурс 170), границы фрагментов — из QUL 310, как в книге. Почему так, а
 * не из одного источника, — в шапке скрипта.
 *
 * Ас-Саади толкует не каждый аят отдельно, а фрагментами: «аяты 1–6»,
 * историю Мусы в суре 7 — одним куском на 69 аятов. Поэтому по аяту
 * находится ФРАГМЕНТ, и окно показывает весь фрагмент целиком.
 *
 * Файл суры грузится, только когда открыли тафсир этой суры: все 114 —
 * около 9 МБ. Повторное открытие берётся из памяти.
 *
 * 🔴 Условия Quran Foundation (Developer Terms §2.1) запрещают хранить их
 * данные в приложении дольше 7 дней без письменного разрешения. Пока
 * разрешения нет, публиковать сборку с этими файлами нельзя — см.
 * STATUS.md → Блокеры. Если разрешения не будет, достаточно поменять
 * TAFSIR_BASE на сетевой адрес (и учесть офлайн-состояние в окне).
 */

export type TafsirGroup = {
  /** Первый аят фрагмента. */
  from: number;
  /** Последний аят фрагмента (включительно). */
  to: number;
  /** Текст толкования; абзацы разделены пустой строкой. */
  text: string;
};

export type TafsirSurah = {
  surah: number;
  groups: TafsirGroup[];
};

/** Откуда грузить файлы сур. Единственное место, где задан адрес. */
export const TAFSIR_BASE = '/tafsir/saadi-ru';

export const TAFSIR_TITLE = 'Тафсир ас-Саади';
export const TAFSIR_ATTRIBUTION =
  'Абдуррахман ас-Саади, «Облегчение от Великодушного и Милостивого», '
  + 'перевод Эльмира Кулиева. Текст — Quran Foundation (quran.com).';

const cache = new Map<number, Promise<TafsirSurah>>();

/**
 * Загрузить тафсир суры. Неудачная загрузка из кэша убирается, чтобы
 * «Повторить» действительно шло в сеть, а не возвращало ту же ошибку.
 */
export function loadSurahTafsir(surah: number): Promise<TafsirSurah> {
  const cached = cache.get(surah);
  if (cached) return cached;
  const promise = fetch(`${TAFSIR_BASE}/${String(surah).padStart(3, '0')}.json`)
    .then(response => {
      if (!response.ok) throw new Error(`тафсир суры ${surah}: HTTP ${response.status}`);
      return response.json() as Promise<TafsirSurah>;
    })
    .then(data => {
      if (data.surah !== surah || !Array.isArray(data.groups)) {
        throw new Error(`тафсир суры ${surah}: неожиданный формат`);
      }
      return data;
    });
  cache.set(surah, promise);
  promise.catch(() => cache.delete(surah));
  return promise;
}

/** Фрагмент, в который входит аят, или undefined, если такого нет. */
export function tafsirGroupFor(data: TafsirSurah, ayah: number): TafsirGroup | undefined {
  // Фрагменты идут подряд по возрастанию — двоичный поиск.
  let lo = 0;
  let hi = data.groups.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const group = data.groups[mid];
    if (ayah < group.from) hi = mid - 1;
    else if (ayah > group.to) lo = mid + 1;
    else return group;
  }
  return undefined;
}

/** Абзацы текста толкования — для вёрстки, текст не меняется. */
export function tafsirParagraphs(text: string): string[] {
  return text.split('\n\n').filter(part => part.trim() !== '');
}
