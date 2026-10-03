/**
 * Время позиции в записи — для чтеца без границ аятов.
 *
 * У него место в суре можно назвать только временем: ползунок полного
 * плеера и плашка отказа («оборвалось на 12:30») говорят одним форматом.
 * Не путать с `formatTime` из `prayerTimes.ts` — там время суток.
 */

/** 75 → «1:15», 3725 → «1:02:05». Длинные суры звучат дольше часа. */
export function formatPlaybackTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
