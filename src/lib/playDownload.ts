/**
 * Слушаешь суру — она сама скачивается.
 *
 * Владелец 2026-10-07: «если я включил аудио какую-то суру, оно
 * проигрывается — пускай она сразу же скачивается». Следующее прослушивание
 * той же суры идёт уже с устройства, без интернета.
 *
 * Правила:
 *  • На любой сети, в том числе сотовой: эту суру человек и так слушает
 *    через интернет, и попросил именно «сразу». Цена — при первом
 *    прослушивании трафик на суру примерно двойной (поток + файл). Фоновая
 *    загрузка всего Корана (audioAutoDownload.ts) по-прежнему только по
 *    Wi-Fi — там речь о сотнях мегабайт без спроса.
 *  • Не обрывает чужое: если у этого чтеца уже идёт другое задание (весь
 *    Коран, другая сура), новое не начинаем — `startDownload` и так вышел бы,
 *    но мы не трогаем и состояние.
 *  • Уважает паузу: если человек сам остановил загрузку этой суры, сама она
 *    не возобновится. Повторяем не чаще раза за запуск на суру.
 *  • Только в приложении (на сайте офлайна нет) и только у чтецов, у которых
 *    загрузка вообще возможна.
 */

import { getDownloadState, startDownload } from './audioDownloads';
import { hasSurahFile, isOfflineSupported, isSurahComplete } from './audioStore';
import { hasSurahAudio, reciterHasSurah, supportsAyahOffline, type ReciterId } from './reciters';

/** Уже пробовали за этот запуск: `${reciter}:${surah}`. */
const tried = new Set<string>();

/**
 * Решение без побочных эффектов — для тестов и чтобы его было видно целиком.
 * `paused` — «человек нажал Паузу на загрузке этой суры».
 */
export function shouldDownloadWhilePlaying(o: {
  offline: boolean;
  downloadable: boolean;
  recorded: boolean;
  alreadyHave: boolean;
  otherJobRunning: boolean;
  pausedByUserHere: boolean;
  triedThisLaunch: boolean;
}): boolean {
  return o.offline && o.downloadable && o.recorded && !o.alreadyHave
    && !o.otherJobRunning && !o.pausedByUserHere && !o.triedThisLaunch;
}

/** Зовёт AudioProvider, когда сура заиграла. */
export function downloadWhilePlaying(reciter: ReciterId, surah: number): void {
  const key = `${reciter}:${surah}`;
  const st = getDownloadState(reciter);
  const ok = shouldDownloadWhilePlaying({
    offline: isOfflineSupported(),
    downloadable: supportsAyahOffline(reciter) || hasSurahAudio(reciter),
    recorded: reciterHasSurah(reciter, surah),
    alreadyHave: hasSurahFile(reciter, surah) || isSurahComplete(reciter, surah),
    otherJobRunning: st.status === 'running',
    pausedByUserHere: st.status === 'paused' && !st.error
      && st.scope?.kind === 'surah' && st.scope.surah === surah,
    triedThisLaunch: tried.has(key),
  });
  if (!ok) return;
  tried.add(key);
  void startDownload(reciter, { kind: 'surah', surah });
}
