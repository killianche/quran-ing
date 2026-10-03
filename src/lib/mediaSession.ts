/**
 * MediaSession — Lock Screen / Control Center / system media controls.
 *
 * Pure Web API (navigator.mediaSession) — работает:
 *  • в Safari iOS из коробки в браузере (если страница играет audio)
 *  • в Capacitor iOS WebView (после Info.plist:UIBackgroundModes=audio)
 *  • в Capacitor Android (после foreground service + WAKE_LOCK)
 *
 * Без вызова setMediaSessionMetadata Lock Screen покажет дефолтную
 * иконку Safari/«Quran Ing» без обложки — это и так работает, но
 * пользователь не видит, какая сура играет.  С полным metadata + artwork
 * получаем proper Now Playing card с обложкой, названием суры, ayah'ем.
 *
 * Action handlers (play/pause/prev/next) пропагируются в наш аудио-стейт
 * — без этого Lock Screen кнопки серые и неактивные.
 */

export type MediaSessionMetadata = {
  /** Сура — название, напр. «Аль-Бакара». */
  title: string;
  /** Что-то типа «Аят 5 / 286». */
  album?: string;
  /** Имя чтеца. */
  artist?: string;
  /** Прямой URL обложки (PNG / JPG / SVG).  Apple Music Lock Screen
   *  использует это поле. */
  artworkUrl: string;
};

export type MediaSessionHandlers = {
  onPlay?: () => void;
  onPause?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSeekTo?: (positionSec: number) => void;
};

let handlersBound = false;

/** Установить metadata Now Playing card. */
export function setMediaSessionMetadata(meta: MediaSessionMetadata) {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.title,
    artist: meta.artist ?? 'Quran Ing',
    album: meta.album ?? '',
    artwork: [
      // Несколько размеров — система подберёт лучшую под Lock Screen.
      { src: meta.artworkUrl, sizes: '96x96',   type: 'image/png' },
      { src: meta.artworkUrl, sizes: '192x192', type: 'image/png' },
      { src: meta.artworkUrl, sizes: '512x512', type: 'image/png' },
    ],
  });
}

/** Очистить metadata (когда аудио не играет, чтобы card исчез). */
export function clearMediaSessionMetadata() {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
}

/** Установить состояние playback — system'у нужно для UI. */
export function setMediaSessionPlaybackState(
  state: 'playing' | 'paused' | 'none',
) {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  navigator.mediaSession.playbackState = state;
}

/**
 * Привязать наши play/pause/prev/next handlers к Lock Screen controls.
 * Вызывается один раз при mount'е App.tsx; handlers'ы можно re-bind на
 * лету.  Без этого Lock Screen кнопки не работают.
 */
export function bindMediaSessionHandlers(h: MediaSessionHandlers) {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  const ms = navigator.mediaSession;

  ms.setActionHandler('play',  h.onPlay  ? () => h.onPlay!()  : null);
  ms.setActionHandler('pause', h.onPause ? () => h.onPause!() : null);
  ms.setActionHandler('previoustrack', h.onPrev ? () => h.onPrev!() : null);
  ms.setActionHandler('nexttrack',     h.onNext ? () => h.onNext!() : null);

  // 'seekto' (с granular position) — поддержан современным WebKit/iOS.
  if (h.onSeekTo) {
    try {
      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) h.onSeekTo!(details.seekTime);
      });
    } catch {
      // Старые браузеры — игнор, базовые кнопки всё равно работают.
    }
  }
  handlersBound = true;
}

/** Обновить только position info — для прогресс-бара в Now Playing. */
export function setMediaSessionPosition(
  positionSec: number,
  durationSec: number,
  playbackRate = 1.0,
) {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  if (!('setPositionState' in navigator.mediaSession)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec || 0,
      playbackRate,
      position: Math.min(positionSec, durationSec || 0),
    });
  } catch {
    // setPositionState может бросать на старых WebKit — игнор.
  }
}

export function areMediaSessionHandlersBound(): boolean {
  return handlersBound;
}
