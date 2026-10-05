/**
 * MiniPlayer — капсула звучащей суры внизу экрана.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────
 *
 * Включённая сура должна быть видна и управляема с любого экрана, где её
 * слушают: на вкладках, на «Намазе» и в открытой суре. Полоска появляется,
 * когда звук пошёл, и исчезает, когда его нет: она сама себе объяснение.
 *
 * ── Вид (владелец 2026-10-04: «в стиле iOS и очень удобным») ──────────
 *
 * Как нижний аксессуар iOS 26 (мини-плеер Музыки): стеклянная капсула,
 * слева круглая «обложка» с эквалайзером, название и вторая строка, справа
 * — только то, что нужно на ходу, крупными мишенями:
 *
 *   назад · пауза · вперёд · стоп
 *
 * Скорость отсюда снята: её трогают редко, и она есть в полном плеере.
 * Прежняя полоска несла шесть органов управления кеглем 11–12 — попадать
 * в них на ходу было трудно.
 *
 * Полный плеер открывается тапом по названию или свайпом капсулы вверх —
 * так же, как мини-плеер iOS.
 *
 * С 2026-10-04 эта же капсула стоит и в открытой суре вместо отдельного
 * `BottomDock` (владелец: «сделай нижний плеер в открытой суре такой же,
 * что и в главном меню, с возможностью открыть полноэкранно»).
 *
 * ── Что здесь НЕ делается ─────────────────────────────────────────────
 *
 * Сама капсула не подписывается на тик воспроизведения: каждый кадр
 * перерисовывал бы её поверх ленты. На тик подписан только тонкий
 * `TimelineProgress` внутри — и то лишь у чтеца без границ аятов; у
 * остальных прогресс — номер аята из общего состояния.
 */

import { useEffect, useRef } from 'react';
import {
  Pause, Play, SkipBack, SkipForward, SeekBack10, SeekForward10, Close, ICON_SIZE,
} from './icons';
import { useAudioActions, useAudioState, useAudioTick } from '../hooks/AudioProvider';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { reciterById, usesTimelineSeek } from '../lib/reciters';
import { GLASS_BLUR } from '../lib/glass';
import { accessoryBottom, type AccessoryPlacement } from './TabBar';

/** Высота капсулы и её зазор до панели вкладок. */
const HEIGHT = 64;
const GAP = 8;
/** Насколько провести капсулу вверх, чтобы открылся полный плеер. */
const SWIPE_OPEN = 28;

export function MiniPlayer({ onOpen, placement = 'tabs', hidden = false }: {
  onOpen: () => void;
  /** 'tabs' — над панелью вкладок; 'screen' — экран без панели (сура, намаз). */
  placement?: AccessoryPlacement;
  /** Капсула видимо скрыта снаружи (на вкладке «Плеер» её гасит App): тогда
   *  она и для фокуса, VoiceOver и Switch Control не существует. Иначе
   *  невидимая кнопка «Открыть плеер» ловила бы фокус (ревью 2026-10-05). */
  hidden?: boolean;
}) {
  const { currentSurah, currentAyah, audioState, reciter } = useAudioState();
  const audio = useAudioActions();

  // Капсула перекрывает низ экрана, а её высота известна только ей. Чтобы
  // последняя строка списка не пряталась под ней, она объявляет занятое
  // место переменной, а экраны добавляют его к своему отступу.
  const visible = Boolean(currentSurah) && audioState !== 'idle';
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.style.setProperty('--mini-player-space', `${HEIGHT + GAP}px`);
    else root.style.removeProperty('--mini-player-space');
    return () => { root.style.removeProperty('--mini-player-space'); };
  }, [visible]);

  // Свайп вверх — открыть полный плеер. Только явно вертикальный жест:
  // горизонтальное движение (например, листание вкладок) не считается.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - s.y;
    const dx = t.clientX - s.x;
    if (dy < -SWIPE_OPEN && Math.abs(dy) > Math.abs(dx) * 1.5) onOpen();
  };

  if (!visible || !currentSurah) return null;
  const meta = SURAH_BY_NUMBER[currentSurah];
  const playing = audioState === 'playing';
  const loading = audioState === 'loading';
  // Чтец без границ аятов: номер аята неизвестен, а соседние кнопки —
  // перемотка на 10 секунд (её делают те же `prev`/`next`).
  const timeline = usesTimelineSeek(reciter);
  const total = meta?.ayahs ?? 0;

  return (
    <div
      role="region"
      aria-label="Звучит сейчас"
      aria-hidden={hidden || undefined}
      // React 18 не знает атрибута inert — пустой строкой, как в TabPager.
      {...(hidden ? { inert: '' } : {})}
      className="liquid-glass mini-player"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { start.current = null; }}
      style={{
        ...GLASS_BLUR,
        position: 'fixed',
        left: '12px',
        right: '12px',
        // Ровно над панелью вкладок, с тем же зазором: две плавающие
        // панели должны читаться одной стопкой, а не случайной парой.
        bottom: accessoryBottom(placement, GAP),
        zIndex: 39,
        maxWidth: '560px',
        margin: '0 auto',
        height: `${HEIGHT}px`,
        // Капсула, как у системного аксессуара; обложка внутри — круг,
        // концентричный её скруглению.
        borderRadius: `${HEIGHT / 2}px`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 6px 0 10px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onOpen}
        aria-label={`Открыть плеер: ${meta?.transliteration ?? currentSurah}`}
        style={{
          flex: 1, minWidth: 0,
          alignSelf: 'stretch',
          display: 'flex', alignItems: 'center', gap: '10px',
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: '44px', height: '44px',
            borderRadius: '50%',
            background: 'rgb(var(--brand-rgb) / 0.16)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--brand)',
          }}
        >
          <span
            className="mini-eq"
            data-state={loading ? 'loading' : playing ? 'playing' : 'paused'}
          >
            <i /><i /><i />
          </span>
        </span>

        <span style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1px',
        }}>
          <span style={{
            maxWidth: '100%',
            fontSize: 'var(--font-subhead)',
            lineHeight: 'var(--leading-subhead)',
            fontWeight: 'var(--weight-semibold)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {meta?.transliteration ?? `Сура ${currentSurah}`}
          </span>
          {/* Аят впереди чтеца: он меняется всё время чтения, а чтец —
              раз в месяц. При нехватке ширины обрезается именно имя. */}
          <span style={{
            maxWidth: '100%',
            fontSize: 'var(--font-footnote)',
            lineHeight: 'var(--leading-footnote)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {loading
              ? 'Загрузка…'
              : `${currentAyah && !timeline ? `Аят ${currentAyah} · ` : ''}${reciterById(reciter).label}`}
          </span>
        </span>
      </button>

      <button
        onClick={() => audio.prev()}
        aria-label={timeline ? 'Назад на 10 секунд' : 'Предыдущий аят'}
        className="icon-btn player-press"
        style={{ flexShrink: 0, width: '42px', height: '48px', color: 'var(--text-primary)' }}
      >
        {timeline ? <SeekBack10 size={ICON_SIZE.md + 2} /> : <SkipBack size={ICON_SIZE.md} />}
      </button>

      <button
        disabled={loading}
        onClick={() => {
          // Во время загрузки кнопка не работает: повторный тап запускал бы
          // воспроизведение заново поверх ещё не начавшегося.
          if (loading) return;
          if (playing) audio.pause();
          // Продолжаем с места паузы: `resume` отпускает тот же элемент, а
          // не начинает аят заново.
          else audio.resume();
        }}
        aria-label={loading ? 'Загрузка' : playing ? 'Пауза' : 'Продолжить'}
        className="icon-btn player-press"
        style={{
          flexShrink: 0,
          width: '48px', height: '48px',
          color: 'var(--text-primary)',
          opacity: loading ? 0.45 : 1,
        }}
      >
        {playing ? <Pause size={26} /> : <Play size={26} />}
      </button>

      <button
        onClick={() => audio.next()}
        aria-label={timeline ? 'Вперёд на 10 секунд' : 'Следующий аят'}
        className="icon-btn player-press"
        style={{ flexShrink: 0, width: '42px', height: '48px', color: 'var(--text-primary)' }}
      >
        {timeline ? <SeekForward10 size={ICON_SIZE.md + 2} /> : <SkipForward size={ICON_SIZE.md} />}
      </button>

      <button
        onClick={() => audio.stopAll()}
        aria-label="Остановить чтение"
        title="Остановить чтение"
        className="icon-btn player-press"
        // Отодвинута от «вперёд»: промах по этой кнопке стоит дороже прочих
        // (звук выключается совсем). Цвет secondary, а не tertiary — тот не
        // дотягивал до контраста 3:1 для нетекстовых элементов.
        style={{
          flexShrink: 0, width: '40px', height: '48px',
          marginLeft: '2px',
          color: 'var(--text-secondary)',
        }}
      >
        <Close size={ICON_SIZE.sm} />
      </button>

      {timeline
        ? <TimelineProgress />
        : <ProgressLine fraction={total > 0 && currentAyah ? currentAyah / total : 0} />}
    </div>
  );
}

/** Тонкая полоса прогресса по нижней кромке, отступив от скруглений. */
function ProgressLine({ fraction }: { fraction: number }) {
  const pct = Math.min(1, Math.max(0, fraction)) * 100;
  return (
    <span aria-hidden style={{
      position: 'absolute',
      left: `${HEIGHT / 2}px`, right: `${HEIGHT / 2}px`, bottom: '5px',
      height: '2px', borderRadius: '1px',
      background: 'rgb(var(--ink-rgb) / 0.08)',
      overflow: 'hidden',
      pointerEvents: 'none',
    }}>
      <span style={{
        display: 'block', height: '100%', width: `${pct}%`,
        background: 'rgb(var(--ink-rgb) / 0.45)',
        transition: 'width 240ms var(--ease-standard)',
      }} />
    </span>
  );
}

/** Прогресс по времени — для чтеца без границ аятов. Подписан на тик
 *  только этот маленький элемент, а не вся капсула. */
function TimelineProgress() {
  const { progress } = useAudioTick();
  return <ProgressLine fraction={progress} />;
}
