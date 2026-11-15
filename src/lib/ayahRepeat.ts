/**
 * ayahRepeat — режим повтора аята при воспроизведении.
 *
 * Решение владельца 2026-11-15 (голосовое): отдельная кнопка с тремя
 * режимами.
 *
 *   off   — как было: каждый аят читается один раз, потом следующий;
 *   three — каждый аят читается три раза подряд, потом следующий, и тот
 *           тоже три раза (заучивание);
 *   loop  — один аят повторяется без остановки, пока человек сам не
 *           переключит режим, аят или не остановит чтение.
 *
 * Здесь только чистая логика без DOM: какой режим следующий, повторять ли
 * аят после очередного прочтения, как считать прочтения, что хранить.
 * Звук перематывает `src/hooks/useAyahAudio.ts` (ветка «повтор» в `step` и
 * в `advanceOrStop`). Проверки — `scripts/test-audio-model.mjs`, группа
 * «Повтор аята».
 *
 * У чтецов без границ аятов (`usesTimelineSeek`) аят не выделить из
 * записи суры: кнопка там не показывается, режим не действует.
 */

export type AyahRepeatMode = 'off' | 'three' | 'loop';

/** Порядок режимов на кнопке: каждое нажатие — следующий. */
export const AYAH_REPEAT_MODES: readonly AyahRepeatMode[] = ['off', 'three', 'loop'];

/** Сколько раз читается каждый аят в режиме `three`. */
export const AYAH_REPEAT_TIMES = 3;

/** Ключ localStorage, рядом с `audio.playbackRate`. */
export const KEY_AYAH_REPEAT = 'audio.ayahRepeat';

export function nextAyahRepeatMode(mode: AyahRepeatMode): AyahRepeatMode {
  const at = AYAH_REPEAT_MODES.indexOf(mode);
  return AYAH_REPEAT_MODES[(at + 1) % AYAH_REPEAT_MODES.length];
}

/**
 * Читать ли аят ещё раз.
 *
 * `playsFinished` — сколько раз этот аят уже дочитан, включая только что
 * закончившееся прочтение. Если режим сменили посреди аята, счёт не
 * обнуляется: из «по кругу» на десятом круге в «три раза» — сразу дальше.
 */
export function shouldRepeatAyah(mode: AyahRepeatMode, playsFinished: number): boolean {
  if (mode === 'loop') return true;
  if (mode === 'three') return playsFinished < AYAH_REPEAT_TIMES;
  return false;
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
 * Переживает перезапуск только `three`. `loop` действует один сеанс:
 * забытый «по кругу» после перезапуска выглядел бы поломкой — «слушать суру
 * целиком» навсегда оставалось бы на первом аяте.
 */
export function parseStoredAyahRepeat(raw: string | null): AyahRepeatMode {
  return raw === 'three' ? 'three' : 'off';
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
    localStorage.setItem(KEY_AYAH_REPEAT, mode === 'three' ? 'three' : 'off');
  } catch {
    // Приватный режим Safari и т. п.: режим действует до конца сеанса.
  }
}

/** Подпись для VoiceOver/TalkBack и всплывающей подсказки. */
export function ayahRepeatLabel(mode: AyahRepeatMode): string {
  if (mode === 'three') return `Каждый аят ${AYAH_REPEAT_TIMES} раза`;
  if (mode === 'loop') return 'Один аят по кругу';
  return 'Повтор аята выключен';
}
