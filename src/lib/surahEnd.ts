/**
 * surahEnd — что делать, когда сура дочитана («Повтор суры» в плеере).
 *
 * Владелец 2026-11-16: прежний «повтор суры» по логике неверен — это не
 * число повторов, а выбор, что будет после последнего аята:
 *
 *   stop  — «Стоп» (значок «въезд запрещён»): чтение останавливается;
 *   next  — «Дальше» (стрелка вправо): включается следующая сура, которая
 *           есть у чтеца. Так плеер работал и раньше — это режим по
 *           умолчанию;
 *   again — «Заново» (значок повтора): эта же сура с первого аята, по кругу.
 *
 * Режим действует только при «слушать суру целиком» (`startedWholeSurah` в
 * `useAyahAudio.ts`): тап по одному аяту по-прежнему останавливается на
 * конце суры — решение владельца 09.09.2026.
 *
 * Чистая логика без DOM; звук — `src/hooks/useAyahAudio.ts`
 * (`advanceOrStop`, ветка конца суры в `step`). Проверки —
 * `scripts/test-audio-model.mjs`, группа «Повтор суры».
 */

export type SurahEndMode = 'stop' | 'next' | 'again';

/** Порядок в строке выбора плеера. */
export const SURAH_END_MODES: readonly SurahEndMode[] = ['stop', 'next', 'again'];

export const DEFAULT_SURAH_END: SurahEndMode = 'next';

export const KEY_SURAH_END = 'audio.surahEnd';

/**
 * Режим из localStorage. Сохраняются все три: это осознанный выбор, как
 * «повтор» в Музыке, и «Заново» после перезапуска ничего не ломает — сура
 * просто читается снова.
 */
export function parseStoredSurahEnd(raw: string | null): SurahEndMode {
  return raw === 'stop' || raw === 'next' || raw === 'again' ? raw : DEFAULT_SURAH_END;
}

export function readStoredSurahEnd(): SurahEndMode {
  try {
    return parseStoredSurahEnd(localStorage.getItem(KEY_SURAH_END));
  } catch {
    return DEFAULT_SURAH_END;
  }
}

export function storeSurahEnd(mode: SurahEndMode): void {
  try {
    localStorage.setItem(KEY_SURAH_END, mode);
  } catch {
    // Приватный режим Safari: режим действует до конца сеанса.
  }
}

/** Слово на кнопке выбора. */
export function surahEndShort(mode: SurahEndMode): string {
  if (mode === 'stop') return 'Стоп';
  if (mode === 'again') return 'Заново';
  return 'Дальше';
}

/** Подпись для VoiceOver/TalkBack. */
export function surahEndLabel(mode: SurahEndMode): string {
  if (mode === 'stop') return 'После суры — остановить';
  if (mode === 'again') return 'После суры — читать её заново';
  return 'После суры — включить следующую';
}

/**
 * Подсказка под строкой выбора: что именно случится в конце этой суры.
 * `nextTitle` — название следующей доступной у чтеца суры; null — дальше
 * сур нет (последняя у чтеца), и «Дальше» на деле остановит чтение.
 * `wholeSurah` false — включено с аята в ленте, режим не действует.
 */
export function surahEndHint(mode: SurahEndMode, nextTitle: string | null, wholeSurah = true): string {
  // Чтение включено тапом по аяту в ленте суры, а не «слушать суру
  // целиком»: режим не действует, в конце суры чтение остановится — так
  // решил владелец 09.09.2026.
  if (!wholeSurah) return 'Включено с аята в тексте — в конце суры чтение остановится';
  if (mode === 'stop') return 'Сура закончится — чтение остановится';
  if (mode === 'again') return 'Сура закончится — начнётся сначала';
  return nextTitle
    ? `Сура закончится — включится следующая, ${nextTitle}`
    : 'Это последняя сура у чтеца — чтение остановится';
}
