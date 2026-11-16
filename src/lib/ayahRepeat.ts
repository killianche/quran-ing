/**
 * ayahRepeat — режим повтора аята при воспроизведении.
 *
 * Решение владельца 2026-11-15 (голосовое): отдельная кнопка с тремя
 * режимами — выключено, каждый аят три раза, один аят по кругу.
 * 2026-11-16 (редизайн плеера, вариант G1 «Михраб»): вместо кнопки, которая
 * листает режимы, — строка выбора «1 · 2 · 3 · 5 · ∞». Ещё в первой постановке
 * задачи владелец называл «2, 3, постоянно»; пять раз — привычная норма
 * заучивания, поэтому в ряду тоже есть.
 *
 *   off   — «1»: каждый аят читается один раз, потом следующий (как было);
 *   two / three / five — каждый аят читается 2 / 3 / 5 раз подряд, потом
 *           следующий, и тот столько же (заучивание);
 *   loop  — «∞»: один аят повторяется без остановки, пока человек сам не
 *           переключит режим, аят или не остановит чтение.
 *
 * Здесь только чистая логика без DOM: повторять ли аят после очередного
 * прочтения, как считать прочтения, что хранить. Звук перематывает
 * `src/hooks/useAyahAudio.ts` (ветка «повтор» в `step` и в
 * `advanceOrStop`). Проверки — `scripts/test-audio-model.mjs`, группа
 * «Повтор аята».
 *
 * У чтецов без границ аятов (`usesTimelineSeek`) аят не выделить из
 * записи суры: выбор там не показывается, режим не действует.
 */

export type AyahRepeatMode = 'off' | 'two' | 'three' | 'five' | 'loop';

/** Порядок режимов в строке выбора плеера. */
export const AYAH_REPEAT_MODES: readonly AyahRepeatMode[] = ['off', 'two', 'three', 'five', 'loop'];

/** Сколько раз читается каждый аят в режиме; у `loop` — бесконечно. */
export const AYAH_REPEAT_TIMES: Readonly<Record<AyahRepeatMode, number>> = {
  off: 1,
  two: 2,
  three: 3,
  five: 5,
  loop: Infinity,
};

/** Ключ localStorage, рядом с `audio.playbackRate`. */
export const KEY_AYAH_REPEAT = 'audio.ayahRepeat';

/**
 * Читать ли аят ещё раз.
 *
 * `playsFinished` — сколько раз этот аят уже дочитан, включая только что
 * закончившееся прочтение. Если режим сменили посреди аята, счёт не
 * обнуляется: из «∞» на десятом круге в «3» — сразу дальше.
 */
export function shouldRepeatAyah(mode: AyahRepeatMode, playsFinished: number): boolean {
  return playsFinished < AYAH_REPEAT_TIMES[mode];
}

/** Счёт прочтений одного аята. `key` — `чтец:сура:аят`. */
export type AyahRepeatTally = { key: string; done: number };

/** Отметить дочитанное прочтение. На другом аяте (или чтеце) счёт с единицы. */
export function countFinishedPlay(tally: AyahRepeatTally | null, key: string): AyahRepeatTally {
  return tally && tally.key === key ? { key, done: tally.done + 1 } : { key, done: 1 };
}

/**
 * Режим из localStorage.
 *
 * Переживают перезапуск только счётные режимы (2, 3, 5). `loop` действует
 * один сеанс: забытый «∞» после перезапуска выглядел бы поломкой — «слушать
 * суру целиком» навсегда оставалось бы на первом аяте.
 */
export function parseStoredAyahRepeat(raw: string | null): AyahRepeatMode {
  return raw === 'two' || raw === 'three' || raw === 'five' ? raw : 'off';
}

export function readStoredAyahRepeat(): AyahRepeatMode {
  try {
    return parseStoredAyahRepeat(localStorage.getItem(KEY_AYAH_REPEAT));
  } catch {
    return 'off';
  }
}

export function storeAyahRepeat(mode: AyahRepeatMode): void {
  try {
    localStorage.setItem(KEY_AYAH_REPEAT, mode === 'loop' ? 'off' : mode);
  } catch {
    // Приватный режим Safari и т. п.: режим действует до конца сеанса.
  }
}

/** Короткая подпись в строке выбора: «1», «2», «3», «5», «∞». */
export function ayahRepeatShort(mode: AyahRepeatMode): string {
  return mode === 'loop' ? '∞' : String(AYAH_REPEAT_TIMES[mode]);
}

/** Подпись для VoiceOver/TalkBack и всплывающей подсказки. */
export function ayahRepeatLabel(mode: AyahRepeatMode): string {
  if (mode === 'off') return 'Каждый аят один раз';
  if (mode === 'loop') return 'Один аят по кругу';
  const n = AYAH_REPEAT_TIMES[mode];
  return `Каждый аят ${n} ${n === 5 ? 'раз' : 'раза'}`;
}

/** Пометка в мини-плеере и строке состояния; при «1» её нет. */
export function ayahRepeatBadge(mode: AyahRepeatMode): string | null {
  if (mode === 'off') return null;
  if (mode === 'loop') return 'по кругу';
  return `×${AYAH_REPEAT_TIMES[mode]}`;
}
