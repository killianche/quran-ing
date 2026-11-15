import { QURANCOM_AYAH_RANGES_MS } from '../content/qurancom-ayah-ranges';
import type { ReciterId } from './reciters';

export type AyahAudioRange = {
  startSeconds: number;
  endSeconds: number;
};

/**
 * Physical range of an ayah inside a full-surah recording.
 *
 * Границы получены из Quran.com. Таблица Люхайдана
 * (`content/luhaidan-ayah-ranges.ts`, из MP3Quran) осталась только для
 * генератора нарезки: сам чтец отключён 15.11.2026 (см. `reciters.ts`).
 */
export function ayahAudioRange(
  reciter: ReciterId,
  surah: number,
  ayah: number,
): AyahAudioRange | null {
  const range = QURANCOM_AYAH_RANGES_MS[reciter]?.[surah]?.[ayah - 1];
  if (!range) return null;
  const [startMs, endMs] = range;
  if (startMs < 0 || endMs <= startMs) return null;
  return { startSeconds: startMs / 1000, endSeconds: endMs / 1000 };
}
