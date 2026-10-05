/**
 * Последнее прослушивание — что звучало и где остановились.
 *
 * Владелец 2026-10-05: «если я послушал какую-то суру, вышел из приложения,
 * даже если полностью закрыл, чтобы плеер помнил, на каком месте я
 * остановился». Вкладка «Плеер» после перезапуска показывает эту суру на
 * паузе, и кнопка воспроизведения продолжает с того же места, а не пишет
 * «Ничего не звучит».
 *
 * Пишет AudioProvider: на смене суры, аята или чтеца, а у чтеца без границ
 * аятов (`usesTimelineSeek`) ещё и секунду записи — не чаще раза в 5 с, чтобы
 * не писать в хранилище на каждом кадре. Хранится только на устройстве
 * (ключ — в LOCAL_DATA_KEYS, «удалить мои данные» его чистит).
 */

import { RECITERS, type ReciterId } from './reciters';
import { TOTAL_SURAHS } from './ayahNumbering';
import { SURAH_BY_NUMBER } from '../content/surahs';

const KEY = 'player.last';

export type LastPlayback = {
  surah: number;
  ayah: number;
  reciter: ReciterId;
  /** Секунда записи суры — только у чтеца без границ аятов. */
  seconds?: number;
  /** Длина записи, с — чтобы после перезапуска показать полосу на месте. */
  duration?: number;
  /** Сура дослушана до конца: продолжать нечего, начнём сначала. */
  done?: boolean;
};

export function readLastPlayback(): LastPlayback | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!v || typeof v !== 'object') return null;
    const surah = Number(v.surah), ayah = Number(v.ayah);
    if (!Number.isInteger(surah) || surah < 1 || surah > TOTAL_SURAHS) return null;
    if (!Number.isInteger(ayah) || ayah < 1 || ayah > (SURAH_BY_NUMBER[surah]?.ayahs ?? 0)) return null;
    if (!RECITERS.some(r => r.id === v.reciter)) return null;
    const seconds = typeof v.seconds === 'number' && Number.isFinite(v.seconds) && v.seconds >= 0
      ? v.seconds : undefined;
    const duration = typeof v.duration === 'number' && Number.isFinite(v.duration) && v.duration > 0
      ? v.duration : undefined;
    return { surah, ayah, reciter: v.reciter as ReciterId, seconds, duration, done: v.done === true };
  } catch {
    return null;
  }
}

export function writeLastPlayback(p: LastPlayback): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* приватный режим или переполнение — просто не запомним */ }
}

export const LAST_PLAYBACK_KEY = KEY;
