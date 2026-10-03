import { SkipBack, SkipForward, Play as PlayIc, Pause as PauseIc, Close as CloseIc } from './icons';
import { GLASS_BLUR } from '../lib/glass';

type AudioState = 'idle' | 'loading' | 'playing' | 'paused';

/** Размер глифа плеера — ступень `--icon-dock` из общей шкалы.  Иконки
 *  принимают размер числом, поэтому значение дублируется здесь и в
 *  CSS-токене; менять их нужно вместе.  Крестик «закрыть» раньше был на
 *  два пикселя мельче остальных без причины. */
const DOCK_ICON = 22;

type Props = {
  audioState: AudioState;
  currentAyah: number | null;
  totalAyahs?: number;
  /** 0..1 — playback progress within the current ayah; resets on each new ayah. */
  progress?: number;
  /** Current playback rate (0.75 / 1.0 / 1.25). Shown as a pill in the dock. */
  playbackRate?: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCyclePlaybackRate: () => void;
  onClose: () => void;
};

/**
 * Floating audio dock — appears only when an ayah is queued/playing.
 * Minimal layout: [speed] [prev] [play/pause] [next] [×]   with a 2px
 * progress hairline pinned to the bottom edge of the pill.
 */
export function BottomDock({
  audioState, progress = 0, playbackRate = 1,
  onPlayPause, onPrev, onNext, onCyclePlaybackRate, onClose,
}: Props) {
  const playing = audioState === 'playing';
  const loading = audioState === 'loading';
  const pct = Math.min(1, Math.max(0, progress));

  return (
    <div
      role="region"
      aria-label="Audio player"
      className="liquid-glass"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'max(var(--space-margin), env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        zIndex: 25,
        height: '76px',
        borderRadius: 'var(--radius-pill)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-snug)',
        padding: '0 var(--space-cozy)',
        // Материал, грань, блик и тени — из общего класса `.liquid-glass`,
        // размытие — инлайном оттуда же, где и у остальных панелей: из CSS
        // его съедает минификатор (см. `src/lib/glass.ts`).
        ...GLASS_BLUR,
        maxWidth: 'min(96vw, 400px)',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Progress hairline — bottom edge of the pill, clipped by overflow:hidden */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          height: '2px',
          background: 'var(--hairline-soft)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            height: '100%',
            // useAyahAudio обновляет значение с умеренной частотой — без CSS
            // transition, чтобы easing не догонял каждую новую точку.
            width: `${pct * 100}%`,
            background: 'var(--ink, var(--text-primary))',
            willChange: 'width',
          }}
        />
      </div>

      {/* Playback rate cycler — shows the current value without a filled
          active background: the number itself is enough to communicate
          the non-default speed and does not compete with Play/Pause. */}
      <DockBtn
        aria-label={`Скорость ${playbackRate}×`}
        title={`Скорость ${playbackRate}×`}
        onClick={onCyclePlaybackRate}
      >
        <span style={{
          fontSize: 'var(--font-caption1)',
          fontWeight: 'var(--weight-semibold)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 'var(--tracking-tight)',
          // lineHeight: 1 — глиф центрируется флексом самой кнопки,
          // ступень межстрочного здесь только сдвинула бы его вниз.
          lineHeight: 1,
        }}>
          {playbackRate === 1 ? '1×' : `${playbackRate}×`}
        </span>
      </DockBtn>

      <DockBtn aria-label="Previous ayah" onClick={onPrev}>
        <SkipBack size={DOCK_ICON} />
      </DockBtn>

      {/* Play / pause — used to be a 56 px filled-ink CTA that visually
          dominated the dock and pulled the eye away from the surah. The
          user reads the verse, the player is just a control surface, so
          this button now matches the other DockBtns: same 48 px, no
          filled background, just text-secondary. Slight emphasis when
          playing (data-active) so the state stays glanceable. */}
      <DockBtn
        onClick={onPlayPause}
        aria-label={loading ? 'Загрузка аята' : playing ? 'Pause' : 'Play'}
        disabled={loading}
        data-active={playing}
        style={{ opacity: loading ? 0.6 : 1, cursor: loading ? 'wait' : 'pointer' }}
      >
        {loading
          ? <AudioSpinner size={DOCK_ICON} />
          : playing
            ? <PauseIc size={DOCK_ICON} />
            : <PlayIc size={DOCK_ICON} />}
      </DockBtn>

      <DockBtn aria-label="Next ayah" onClick={onNext}>
        <SkipForward size={DOCK_ICON} />
      </DockBtn>

      <DockBtn aria-label="Закрыть плеер" onClick={onClose}>
        <CloseIc size={DOCK_ICON} />
      </DockBtn>
    </div>
  );
}

/** Shared loading state for every ayah play button. */
export function AudioSpinner({ size = 20 }: { size?: number }) {
  return (
    <span
      aria-hidden
      data-audio-spinner
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: '2px solid color-mix(in srgb, currentColor 24%, transparent)',
        borderTopColor: 'currentColor',
        animation: 'audio-spinner 0.75s linear infinite',
        boxSizing: 'border-box',
      }}
    />
  );
}

function DockBtn({
  children, style, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
  'data-active'?: boolean;
}) {
  const active = (rest as { 'data-active'?: boolean })['data-active'];
  return (
    <button
      {...rest}
      // Класс держит прозрачный «доводчик» зоны касания до 44×44.  Был
      // нужен компактному 40×40 варианту встроенного плеера мусхафа;
      // кнопки 48×48 его не требуют, но и не мешает.
      className="dock-btn"
      style={{
        width: '48px', height: '48px',
        borderRadius: 'var(--radius-pill)',
        border: 'none',
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        flexShrink: 0,
        transition:
          'color var(--dur-fast) var(--ease-standard),'
          + ' background var(--dur-fast) var(--ease-standard)',
        // Merge caller's style last so per-call overrides (e.g. cursor:
        // wait while loading) win against the base.
        ...style,
      }}
    >
      {children}
    </button>
  );
}
