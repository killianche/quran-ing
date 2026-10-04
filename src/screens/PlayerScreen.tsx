/**
 * PlayerScreen — полноэкранный плеер суры.
 *
 * ── Зачем отдельный экран ─────────────────────────────────────────────
 *
 * Слушают Коран иначе, чем читают. Читающему нужен текст и место, где он
 * остановился; слушающему — кто читает, с какой скоростью, что дальше и как
 * это переключить, не выцеливая мелкие кнопки в шапке экрана чтения.
 *
 * Экран в общем стеке, а не лист поверх: у него своя запись в истории,
 * поэтому системная «назад» и жест от края возвращают туда, откуда пришли,
 * без отдельной обработки.
 *
 * ── Раскладка (владелец 2026-10-04, стиль iOS 26) ─────────────────────
 *
 * Как экран «Исполняется» в Музыке и Подкастах: сверху — что звучит,
 * внизу, под большим пальцем, — управление.
 *
 * - Название суры с шевроном — тап открывает шторку выбора суры
 *   (`SurahPickerSheet`: поиск, только записанные у чтеца суры, текущая
 *   в середине). Стрелки «предыдущая/следующая сура» сняты: владелец —
 *   «не нужны, лучше выбор суры сделать прям удобным». Та же шторка — у
 *   кнопки-списка в нижнем ряду.
 * - Имя чтеца под названием, акцентным цветом, с шевроном — тап открывает
 *   выпадающее меню (`PullDownMenu`). Прежняя сетка из шести плиток
 *   занимала треть экрана ради выбора, который делают редко.
 * - Без карточек-панелей: экран сам по себе и есть плеер; стекло — только
 *   у меню и шторки (слой управления, docs/IOS26_DESIGN_GUIDE.md § 2).
 *
 * ── Что здесь НЕ показывается ─────────────────────────────────────────
 *
 * Нет полосы прокрутки по времени. Непрерывная запись суры — это один файл
 * на десятки минут, и «перемотать на 12:30» для Корана бессмысленная
 * единица: человек мыслит аятами. Поэтому позиция показана аятом, а
 * перемотка — по аятам.
 *
 * Исключение — чтец без границ аятов (`usesTimelineSeek`). У него аята
 * узнать неоткуда, поэтому сура слушается как трек музыкального плеера:
 * ползунок по времени и перемотка на 10 секунд (решение владельца
 * 03.10.2026).
 *
 * Нет текста аята: для чтения есть лента, и дублировать её здесь значило
 * бы сделать второй, худший читатель.
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ScreenHeader, screenHeaderOffset } from '../components/ScreenHeader';
import { PullDownMenu } from '../components/PullDownMenu';
import { SurahPickerSheet } from '../components/SurahPickerSheet';
import {
  Play, Pause, SkipBack, SkipForward, SeekBack10, SeekForward10,
  ChevronDown, ListBullet, ICON_SIZE,
} from '../components/icons';
import { useAudioActions, useAudioState, useAudioTick } from '../hooks/AudioProvider';
import {
  RECITERS, TIMELINE_SEEK_STEP_SECONDS, availableSurahCount, reciterById,
  reciterHasSurah, usesTimelineSeek, type ReciterId,
} from '../lib/reciters';
import { TOTAL_SURAHS } from '../lib/ayahNumbering';
import { formatPlaybackTime } from '../lib/playbackTime';
import { SURAH_BY_NUMBER } from '../content/surahs';

export function PlayerScreen({ onBack }: { onBack: () => void }) {
  const { currentSurah, currentAyah, audioState, playbackRate, reciter } = useAudioState();
  const audio = useAudioActions();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reciterAnchor, setReciterAnchor] = useState<HTMLElement | null>(null);

  // 🔴 Последняя звучавшая сура, а не «первая по умолчанию».
  //
  // Когда сура доиграна до конца, очередь обнуляется и `currentSurah`
  // становится null. Прежнее `?? 1` подставляло Аль-Фатиху: экран показывал
  // суру, которая не звучала, «Аят 1 из 7», и кнопка запускала именно её.
  // Дослушав Ан-Нас, человек получал бы Аль-Фатиху без всякой причины.
  const lastSurah = useRef<number | null>(null);
  useEffect(() => {
    if (currentSurah) lastSurah.current = currentSurah;
  }, [currentSurah]);

  const surah = currentSurah ?? lastSurah.current;
  const meta = surah ? SURAH_BY_NUMBER[surah] : undefined;
  const total = meta?.ayahs ?? 1;
  const ayah = currentAyah ?? 1;
  const finished = !currentSurah && Boolean(surah);
  const playing = audioState === 'playing';
  const loading = audioState === 'loading';
  const timeline = usesTimelineSeek(reciter);
  // Сменили чтеца на того, у кого этой суры нет (Мержоев посреди суры 10):
  // звук останавливается, и «Сура дочитана» было бы неправдой. Говорим как
  // есть, а кнопка воспроизведения ведёт к выбору суры (ревью 2026-10-04).
  const missing = surah != null && !reciterHasSurah(reciter, surah);
  const status = loading ? 'Загрузка…'
    : missing ? 'У чтеца нет этой суры'
    : finished ? 'Сура дочитана'
    : null;

  const playSurah = (n: number) => {
    const m = SURAH_BY_NUMBER[n];
    if (m) audio.playSurah(n, m.ayahs);
  };

  const reciterLine = (
    <ReciterTrigger
      reciter={reciter}
      open={reciterAnchor != null}
      onOpen={el => setReciterAnchor(el)}
    />
  );

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader
        visible
        title="Слушать"
        onBack={onBack}
        actions={[]}
      />

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: `${screenHeaderOffset(16)} var(--space-margin) calc(env(safe-area-inset-bottom) + var(--space-section))`,
        maxWidth: '560px',
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}>
        {!surah && (
          <div style={{
            flex: 1,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 'var(--space-cozy)',
            textAlign: 'center',
          }}>
            <p style={{
              margin: 0,
              fontSize: 'var(--font-title3)',
              lineHeight: 'var(--leading-title3)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--text-primary)',
            }}>
              Ничего не звучит
            </p>
            {reciterLine}
            <button
              onClick={() => setPickerOpen(true)}
              className="player-press"
              style={{
                marginTop: 'var(--space-tight)',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                minHeight: '48px', padding: '0 22px',
                border: 'none', borderRadius: 'var(--radius-pill)',
                background: 'var(--text-primary)', color: 'var(--surface)',
                fontFamily: 'inherit',
                fontSize: 'var(--font-body)',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <ListBullet size={ICON_SIZE.md} />
              Выбрать суру
            </button>
          </div>
        )}

        {surah && meta && (<>
        {/* ── Что звучит ─────────────────────────────────────────────
            Занимает всё свободное место и центрирует себя в нём: управление
            уходит вниз, под палец, как в системных плеерах. */}
        <section style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          textAlign: 'center',
          minHeight: '220px',
          paddingBottom: 'var(--space-section)',
        }}>
          <p
            dir="rtl"
            lang="ar"
            aria-hidden
            style={{
              margin: 0,
              fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
              fontSize: 'clamp(44px, 15vw, 72px)',
              lineHeight: 1.6,
              color: 'var(--text-primary)',
            }}
          >
            {meta.arabic}
          </p>

          <button
            onClick={() => setPickerOpen(true)}
            aria-label={`Сура ${meta.transliteration}. Выбрать другую суру`}
            aria-haspopup="dialog"
            className="player-title-btn"
            style={{
              marginTop: 'var(--space-tight)',
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              maxWidth: '100%',
              minHeight: '44px', padding: '0 12px',
              border: 'none', borderRadius: 'var(--radius-pill)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{
              minWidth: 0,
              fontSize: 'var(--font-title2)',
              lineHeight: 'var(--leading-title2)',
              fontWeight: 'var(--weight-semibold)',
              letterSpacing: 'var(--tracking-tight)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {meta.transliteration}
            </span>
            <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--text-tertiary)' }}>
              <ChevronDown size={ICON_SIZE.sm} />
            </span>
          </button>

          <p style={{
            margin: 0,
            fontSize: 'var(--font-subhead)',
            lineHeight: 'var(--leading-subhead)',
            color: 'var(--text-tertiary)',
          }}>
            {meta.russian}{' '}·{' '}{meta.number}-я сура
          </p>

          <div style={{ marginTop: 'var(--space-snug)' }}>{reciterLine}</div>
        </section>

        {/* ── Где мы в суре ──────────────────────────────────────────
            Позиция аятом, а не временем: человек, слушающий Коран,
            мыслит аятами, а не минутами записи. Кроме чтеца без
            границ аятов — у него ползунок времени. */}
        {timeline ? (
          <SeekBar
            // Своя сура — свой ползунок: незавершённое перетаскивание не
            // переезжает на следующую.
            key={surah}
            status={status}
          />
        ) : (
        <section style={{ display: 'grid', gap: 'var(--space-hair)' }}>
          <div
            role="progressbar"
            aria-label="Позиция в суре"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={ayah}
            aria-valuetext={`Аят ${ayah} из ${total}`}
            style={{
              height: '28px',
              display: 'flex', alignItems: 'center',
            }}
          >
            <div style={{
              flex: 1,
              height: '4px',
              borderRadius: '2px',
              background: 'var(--hairline)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(100, (ayah / Math.max(1, total)) * 100)}%`,
                height: '100%',
                borderRadius: '2px',
                background: 'var(--ink)',
                transition: 'width 240ms var(--ease-standard)',
              }} />
            </div>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            gap: 'var(--space-tight)',
            fontSize: 'var(--font-caption2)',
            lineHeight: 'var(--leading-caption2)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span>Аят {ayah}</span>
            {status && <span>{status}</span>}
            <span>из {total}</span>
          </div>
        </section>
        )}

        {/* ── Управление ─────────────────────────────────────────────── */}
        <section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 'clamp(20px, 9vw, 44px)',
          marginTop: 'var(--space-cozy)',
        }}>
          <button
            onClick={() => audio.prev()}
            aria-label={timeline ? 'Назад на 10 секунд' : 'Предыдущий аят'}
            className="icon-btn player-press"
            style={{ width: '56px', height: '56px', color: 'var(--text-primary)' }}
          >
            {timeline ? <SeekBack10 size={30} /> : <SkipBack size={30} />}
          </button>

          <button
            onClick={() => {
              if (playing) audio.pause();
              // Записи нет — играть нечего, предлагаем выбрать другую.
              else if (missing) setPickerOpen(true);
              // Сура дочитана — начинаем её заново, а не продолжаем с
              // последнего аята: продолжать там уже нечего.
              else if (finished) audio.playSurah(surah, total);
              // Продолжаем с места паузы, а не с начала аята.
              else audio.resume();
            }}
            aria-label={playing ? 'Пауза' : missing ? 'Выбрать суру' : 'Слушать'}
            className="player-press"
            style={{
              width: '76px', height: '76px',
              flexShrink: 0,
              borderRadius: '50%',
              border: 'none',
              background: 'var(--text-primary)',
              color: 'var(--surface)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {playing ? <Pause size={30} /> : <Play size={30} style={{ marginLeft: '3px' }} />}
          </button>

          <button
            onClick={() => audio.next()}
            aria-label={timeline ? 'Вперёд на 10 секунд' : 'Следующий аят'}
            className="icon-btn player-press"
            style={{ width: '56px', height: '56px', color: 'var(--text-primary)' }}
          >
            {timeline ? <SeekForward10 size={30} /> : <SkipForward size={30} />}
          </button>
        </section>

        {/* ── Нижний ряд: скорость и список сур ──────────────────────
            Как нижний ряд системного плеера: второстепенное — по краям,
            мелко, но с полной зоной нажатия. */}
        <section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 'var(--space-section)',
        }}>
          <button
            onClick={() => audio.cyclePlaybackRate()}
            aria-label={`Скорость ${playbackRate}×. Изменить`}
            className="player-press"
            style={{
              minWidth: '56px', minHeight: '44px', padding: '0 14px',
              borderRadius: 'var(--radius-pill)',
              border: 'none',
              background: 'rgb(var(--ink-rgb) / 0.07)',
              color: playbackRate === 1 ? 'var(--text-secondary)' : 'var(--text-primary)',
              fontFamily: 'inherit',
              fontSize: 'var(--font-subhead)',
              fontWeight: 'var(--weight-semibold)',
              fontVariantNumeric: 'tabular-nums',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {playbackRate}×
          </button>

          <button
            onClick={() => setPickerOpen(true)}
            aria-label="Список сур"
            aria-haspopup="dialog"
            className="player-press"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              minHeight: '44px', padding: '0 16px',
              borderRadius: 'var(--radius-pill)',
              border: 'none',
              background: 'rgb(var(--ink-rgb) / 0.07)',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              fontSize: 'var(--font-subhead)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <ListBullet size={ICON_SIZE.md} />
            Суры
          </button>
        </section>
        </>)}
      </div>

      {pickerOpen && (
        <SurahPickerSheet
          current={surah}
          reciter={reciter}
          playing={playing}
          onPick={n => { playSurah(n); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {reciterAnchor && (
        <PullDownMenu<ReciterId>
          anchor={reciterAnchor}
          label="Чтец"
          header="Чтец"
          items={RECITERS.map(r => {
            const count = availableSurahCount(r.id);
            return {
              id: r.id,
              label: r.label,
              detail: count < TOTAL_SURAHS ? `${count} ${surahWord(count)} из ${TOTAL_SURAHS}` : undefined,
              checked: r.id === reciter,
            };
          })}
          onSelect={id => { if (id !== reciter) audio.setReciter(id); }}
          onClose={() => setReciterAnchor(null)}
        />
      )}
    </div>
  );
}

function surahWord(n: number): string {
  const two = n % 100, one = n % 10;
  if (two >= 11 && two <= 14) return 'сур';
  if (one === 1) return 'сура';
  if (one >= 2 && one <= 4) return 'суры';
  return 'сур';
}

/**
 * Имя чтеца под названием суры — кнопка выпадающего меню.
 *
 * Акцентным цветом, как имя исполнителя в Музыке: это единственная
 * «ссылка» в блоке, и цвет сам говорит, что она нажимается.
 */
function ReciterTrigger({ reciter, open, onOpen }: {
  reciter: ReciterId;
  open: boolean;
  onOpen: (el: HTMLElement) => void;
}) {
  return (
    <button
      onClick={e => onOpen(e.currentTarget)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Чтец: ${reciterById(reciter).label}. Выбрать другого`}
      className="player-title-btn"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        maxWidth: '100%',
        minHeight: '44px', padding: '0 14px',
        border: 'none', borderRadius: 'var(--radius-pill)',
        background: 'transparent',
        color: 'var(--brand)',
        fontFamily: 'inherit',
        fontSize: 'var(--font-body)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {reciterById(reciter).label}
      </span>
      <span aria-hidden style={{
        display: 'inline-flex', flexShrink: 0,
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform var(--dur-fast) var(--ease-standard)',
      }}>
        <ChevronDown size={ICON_SIZE.sm} />
      </span>
    </button>
  );
}

/**
 * Ползунок времени — для чтеца без границ аятов.
 *
 * Живёт отдельным компонентом ради подписки на тик: прогресс меняется
 * ~12 раз в секунду, и перерисовываться с этой частотой должен только
 * ползунок, а не весь экран с названием, чтецом и кнопками.
 *
 * 🔴 Перемотка — по ОТПУСКАНИЮ, а не на каждое движение пальца. Пока палец
 * ведёт бегунок, показывается только время под ним (`drag`); звук прыгает
 * один раз. Иначе каждое движение запускало бы новую подгрузку сетевого
 * файла с середины, и звук заикался бы всё время, пока палец на ползунке.
 *
 * Отпускание ловится и нативным `change`, и концом касания. Одного
 * `change` мало: если палец сдвинул бегунок и вернул его на то же
 * значение, `input` пришёл, а `change` — нет, и ползунок застывал бы на
 * месте пальца, пока звук идёт дальше (ревью 03.10.2026).
 *
 * Клавиатура перематывает тем же шагом, что и кнопки (10 с): шаг самого
 * поля — `any`, иначе браузер округлял бы позицию до целых секунд, и
 * бегунок расходился бы с заливкой.
 */
function SeekBar({ status }: { status: string | null }) {
  const { progress, duration } = useAudioTick();
  const audio = useAudioActions();
  const [drag, setDrag] = useState<number | null>(null);
  // Копия для нативных обработчиков: они вешаются один раз и не видят
  // свежий state.
  const dragRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startDrag = (value: number) => {
    dragRef.current = value;
    setDrag(value);
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const commit = () => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      setDrag(null);
      audio.seekTo(Number(el.value));
    };
    const events = ['change', 'pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'];
    events.forEach(name => el.addEventListener(name, commit));
    return () => events.forEach(name => el.removeEventListener(name, commit));
  }, [audio]);

  // Новый файл (смена чтеца, автопереход) — незавершённое перетаскивание
  // не должно перенести старую позицию на другую запись.
  useEffect(() => {
    dragRef.current = null;
    setDrag(null);
  }, [duration]);

  const known = duration > 0;
  const current = Math.min(duration, drag ?? progress * duration);
  const pct = known ? (current / duration) * 100 : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = TIMELINE_SEEK_STEP_SECONDS;
    const deltas: Record<string, number> = {
      ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step,
      PageDown: -6 * step, PageUp: 6 * step,
    };
    if (e.key in deltas) {
      e.preventDefault();
      audio.seekBy(deltas[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      audio.seekTo(0);
    }
  };

  return (
    <section style={{ display: 'grid', gap: 'var(--space-hair)' }}>
      <input
        ref={inputRef}
        type="range"
        className="seek-slider"
        min={0}
        max={known ? duration : 1}
        step="any"
        value={known ? current : 0}
        disabled={!known}
        onChange={e => startDrag(Number(e.currentTarget.value))}
        onKeyDown={onKeyDown}
        aria-label="Позиция в записи суры"
        aria-valuetext={known
          ? `${formatPlaybackTime(current)} из ${formatPlaybackTime(duration)}`
          : undefined}
        style={{ '--seek-pct': `${pct}%` } as CSSProperties}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--space-tight)',
        fontSize: 'var(--font-caption2)',
        lineHeight: 'var(--leading-caption2)',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span>{known ? formatPlaybackTime(current) : '0:00'}</span>
        {status && <span>{status}</span>}
        {/* Остаток, а не общая длина: так считают системные плееры, и он
            отвечает на вопрос «сколько ещё слушать». */}
        <span>{known ? `\u2212${formatPlaybackTime(duration - current)}` : '--:--'}</span>
      </div>
    </section>
  );
}
