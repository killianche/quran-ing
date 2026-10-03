/**
 * MiniPlayer — полоска звучащей суры над нижней панелью.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────
 *
 * Плеер в разделах чтения (лента, мусхаф) уже есть — это `BottomDock`. Но
 * на вкладках его нет, и включённая с главного экрана сура звучала «из
 * ниоткуда»: остановить её было негде, вернуться к ней тоже.
 *
 * ── Почему появляется сам, а не живёт кнопкой ─────────────────────────
 *
 * Владелец предлагал добавить на главную кнопку плеера. Кнопка, которая
 * ничего не делает, пока ничего не играет, — это лишний элемент в списке
 * из 114 строк. Полоска появляется, когда звук пошёл, и исчезает, когда
 * его нет: она сама себе объяснение.
 *
 * ── Управление прямо в полоске ────────────────────────────────────────
 *
 * Владелец попросил не гонять его в полный плеер ради паузы и соседнего
 * аята. Поэтому здесь есть переход по аятам, пауза, скорость и остановка —
 * всё, что нужно на ходу, в один тап.
 *
 * Смена чтеца сюда НЕ вынесена намеренно: полоска и так несёт пять органов
 * управления. Чтец меняется тапом по названию — это открывает полный плеер,
 * где он и живёт, — и в листе «Чтение» экрана суры.
 *
 * ── Порядок веса на полоске (06.09.2026) ──────────────────────────────
 *
 * Владелец: «дизайн плеера улучши». На прежней полоске самым тяжёлым
 * элементом была рамка вокруг «1×» — то есть скорость, вещь, которую
 * трогают раз в месяц, кричала громче кнопки «пауза». Разложено по
 * важности:
 *
 *   эквалайзер и название → пауза → соседние аяты → скорость → остановка
 *
 * Скорость стала простым текстом без рамки; остановка отделена волоском,
 * чтобы её не задевали, целясь в «следующий аят».
 *
 * ── Что здесь НЕ делается ─────────────────────────────────────────────
 *
 * Полоска не подписывается на прогресс и позицию слова. Ей нужны только
 * номер суры, аят и состояние — иначе каждый кадр воспроизведения
 * перерисовывал бы её поверх списка сур. Поэтому «живость» показывает
 * анимированный эквалайзер (чистый CSS, ноль ре-рендеров), а не шкала.
 */

import { useEffect } from 'react';
import { Pause, Play, SkipBack, SkipForward, Close, ICON_SIZE } from './icons';
import { useAudioActions, useAudioState } from '../hooks/AudioProvider';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { reciterById } from '../lib/reciters';
import { GLASS_BLUR } from '../lib/glass';
import { TAB_BAR_HEIGHT, TAB_BAR_BOTTOM } from './TabBar';

/** Высота полоски и её зазор до панели вкладок. */
const HEIGHT = 58;
const GAP = 6;

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { currentSurah, currentAyah, audioState, reciter, playbackRate } = useAudioState();
  const audio = useAudioActions();

  // Полоска перекрывает низ экрана, а её высота известна только ей. Чтобы
  // последняя строка списка не пряталась под ней, она объявляет занятое
  // место переменной, а экраны вкладок добавляют его к своему отступу.
  // Иначе во время чтения сура 114 наполовину уходила под панель.
  const visible = Boolean(currentSurah) && audioState !== 'idle';
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.style.setProperty('--mini-player-space', `${HEIGHT + GAP}px`);
    else root.style.removeProperty('--mini-player-space');
    return () => { root.style.removeProperty('--mini-player-space'); };
  }, [visible]);

  if (!visible || !currentSurah) return null;
  const meta = SURAH_BY_NUMBER[currentSurah];
  const playing = audioState === 'playing';
  const loading = audioState === 'loading';

  return (
    <div
      role="region"
      aria-label="Звучит сейчас"
      className="liquid-glass"
      style={{
        ...GLASS_BLUR,
        position: 'fixed',
        left: '12px',
        right: '12px',
        // Ровно над капсулой вкладок, с тем же зазором: две плавающие
        // панели должны читаться одной стопкой, а не случайной парой.
        // Считаем от той же координаты, что и сама капсула: иначе панель
        // опустилась бы, а полоска плеера осталась висеть на прежнем месте.
        bottom: `calc(${TAB_BAR_BOTTOM} + ${TAB_BAR_HEIGHT - 10 + GAP}px)`,
        zIndex: 39,
        maxWidth: '560px',
        margin: '0 auto',
        height: `${HEIGHT}px`,
        borderRadius: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '0 8px 0 10px',
        boxSizing: 'border-box',
      }}
    >
      <button
        onClick={onOpen}
        aria-label={`Открыть плеер: ${meta?.transliteration ?? currentSurah}`}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: '10px',
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Якорь «звучит сейчас». Он же — понятная мишень для тапа по
            названию: попасть в квадрат легче, чем в строку текста. */}
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: '34px', height: '34px',
            borderRadius: '11px',
            background: 'rgb(var(--ink-rgb) / 0.05)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)',
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
            fontSize: 'var(--font-caption1)',
            lineHeight: 'var(--leading-caption1)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {meta?.transliteration ?? `Сура ${currentSurah}`}
          </span>
          {/* Аят впереди чтеца: он меняется всё время чтения, а чтец —
              раз в месяц. При нехватке ширины обрезается именно имя. */}
          <span style={{
            maxWidth: '100%',
            fontSize: 'var(--font-caption2)',
            lineHeight: 'var(--leading-caption2)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {currentAyah ? `Аят ${currentAyah} · ` : ''}{reciterById(reciter).label}
          </span>
        </span>
      </button>

      <button
        onClick={() => audio.prev()}
        aria-label="Предыдущий аят"
        className="icon-btn"
        style={{ flexShrink: 0, width: '38px', height: '44px', color: 'var(--text-secondary)' }}
      >
        <SkipBack size={ICON_SIZE.sm} />
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
        className="icon-btn"
        style={{
          flexShrink: 0,
          width: '44px', height: '44px',
          borderRadius: '50%',
          // Единственная заполненная кнопка на полоске: пауза важнее всего
          // остального, и глаз должен находить её без поиска.
          background: 'rgb(var(--ink-rgb) / 0.07)',
          color: 'var(--text-primary)',
          opacity: loading ? 0.45 : 1,
        }}
      >
        {playing ? <Pause size={ICON_SIZE.md} /> : <Play size={ICON_SIZE.md} />}
      </button>

      <button
        onClick={() => audio.next()}
        aria-label="Следующий аят"
        className="icon-btn"
        style={{ flexShrink: 0, width: '38px', height: '44px', color: 'var(--text-secondary)' }}
      >
        <SkipForward size={ICON_SIZE.sm} />
      </button>

      <button
        onClick={() => audio.cyclePlaybackRate()}
        aria-label={`Скорость ${playbackRate}×, изменить`}
        style={{
          flexShrink: 0,
          minWidth: '38px', height: '44px',
          borderRadius: 'var(--radius-pill)',
          // Без рамки: скорость — самая редкая из кнопок, и обведённая
          // капсула делала её самым тяжёлым пятном на полоске.
          border: 'none',
          background: 'transparent',
          color: 'var(--text-tertiary)',
          fontFamily: 'inherit',
          fontSize: 'var(--font-caption2)',
          fontVariantNumeric: 'tabular-nums',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {playbackRate}×
      </button>

      {/* Волосок-разделитель: остановка — не часть перемотки, и промах по
          ней стоит дороже прочих (звук выключается совсем). */}
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: '1px', height: '20px',
          margin: '0 4px',
          background: 'var(--hairline)',
        }}
      />

      <button
        onClick={() => audio.stopAll()}
        aria-label="Остановить чтение"
        title="Остановить чтение"
        className="icon-btn"
        // Мишень 40×44 и цвет secondary: промах по этой кнопке стоит дороже
        // прочих (звук выключается совсем), а третичный цвет не дотягивал до
        // контраста 3:1, который Apple просит для нетекстовых элементов.
        style={{ flexShrink: 0, width: '40px', height: '44px', color: 'var(--text-secondary)' }}
      >
        <Close size={ICON_SIZE.sm} />
      </button>
    </div>
  );
}
