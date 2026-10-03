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
 * ── Что здесь НЕ показывается ─────────────────────────────────────────
 *
 * Нет полосы прокрутки по времени. Непрерывная запись суры — это один файл
 * на десятки минут, и «перемотать на 12:30» для Корана бессмысленная
 * единица: человек мыслит аятами. Поэтому позиция показана аятом, а
 * перемотка — по аятам.
 *
 * Нет текста аята: для чтения есть лента, и дублировать её здесь значило
 * бы сделать второй, худший читатель.
 */

import { useEffect, useRef, useState } from 'react';
import { ScreenHeader, screenHeaderOffset } from '../components/ScreenHeader';
import { ReciterCard } from '../components/ReadingSettings';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, ICON_SIZE } from '../components/icons';
import { useAudioActions, useAudioState } from '../hooks/AudioProvider';
import { SURAH_BY_NUMBER, SURAHS } from '../content/surahs';
import { TOTAL_SURAHS } from '../lib/ayahNumbering';

export function PlayerScreen({ onBack }: { onBack: () => void }) {
  const { currentSurah, currentAyah, audioState, playbackRate, reciter } = useAudioState();
  const audio = useAudioActions();
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const playSurah = (n: number) => {
    const m = SURAH_BY_NUMBER[n];
    if (m) audio.playSurah(n, m.ayahs);
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader
        visible
        title="Слушать"
        subtitle={meta ? `${meta.transliteration} · ${meta.ayahs} аятов` : undefined}
        onBack={onBack}
        actions={[]}
      />

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-section)',
        padding: `${screenHeaderOffset(24)} var(--space-margin) calc(env(safe-area-inset-bottom) + var(--space-section))`,
        maxWidth: '560px',
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}>
        {!surah && (
          <p style={{
            margin: 'auto', textAlign: 'center',
            fontSize: 'var(--font-caption1)', color: 'var(--text-tertiary)',
          }}>
            Ничего не звучит. Включите суру в списке — плеер откроется здесь.
          </p>
        )}

        {surah && (<>
        {/*
          ── Карточка плеера ───────────────────────────────────────────

          Владелец: «верхнее меню сильно выделено, а сам плеер не выделен,
          странно выглядит». Так и было: шапка — плотная карточка во всю
          ширину, блок чтеца и кнопка выбора суры — тоже на карточках, а
          главное (название, полоса, кнопки, скорость) висело в воздухе.
          Единственная часть без опоры оказывалась самой важной.

          Собираем её в одну плоскость с тем же скруглением и той же
          волосяной рамкой, что у карточки чтеца, — экран читается стопкой
          панелей, и вес распределён по смыслу, а не случайно.
        */}
        <div style={{
          display: 'grid',
          gap: 'var(--space-margin)',
          padding: 'var(--space-margin) var(--space-cozy) var(--space-cozy)',
          borderRadius: 'var(--radius-card)',
          background: 'rgb(var(--ink-rgb) / 0.03)',
          border: '1px solid var(--hairline)',
        }}>
        {/* ── Что звучит ─────────────────────────────────────────────── */}
        <section style={{ textAlign: 'center' }}>
          <p
            dir="rtl"
            lang="ar"
            style={{
              margin: 0,
              fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
              fontSize: 'clamp(30px, 9vw, 44px)',
              lineHeight: 1.7,
              color: 'var(--text-primary)',
            }}
          >
            {meta?.arabic}
          </p>
          <p style={{
            margin: 'var(--space-tight) 0 0',
            fontSize: 'var(--font-title3)',
            fontWeight: 'var(--weight-regular)',
            color: 'var(--text-primary)',
          }}>
            {meta?.transliteration}
          </p>
          <p style={{
            margin: 'var(--space-hair) 0 0',
            fontSize: 'var(--font-caption1)',
            color: 'var(--text-tertiary)',
          }}>
            {meta?.russian}
          </p>
        </section>

        {/* ── Где мы в суре ──────────────────────────────────────────
            Позиция аятом, а не временем: человек, слушающий Коран,
            мыслит аятами, а не минутами записи. */}
        <section style={{ display: 'grid', gap: 'var(--space-tight)' }}>
          <div style={{
            height: '4px',
            borderRadius: '2px',
            background: 'rgb(var(--ink-rgb) / 0.1)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(100, (ayah / Math.max(1, total)) * 100)}%`,
              height: '100%',
              background: 'var(--text-secondary)',
              transition: 'width 240ms var(--ease-standard)',
            }} />
          </div>
          <p style={{
            margin: 0, textAlign: 'center',
            fontSize: 'var(--font-caption1)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {loading ? 'Загрузка…' : finished ? 'Сура дочитана' : `Аят ${ayah} из ${total}`}
          </p>
        </section>

        {/* ── Управление ─────────────────────────────────────────────── */}
        <section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 'var(--space-cozy)',
        }}>
          <button
            onClick={() => audio.prev()}
            aria-label="Предыдущий аят"
            className="icon-btn"
            style={{ width: '52px', height: '52px', color: 'var(--text-secondary)' }}
          >
            <SkipBack size={ICON_SIZE.lg} />
          </button>

          <button
            onClick={() => {
              if (playing) audio.pause();
              // Сура дочитана — начинаем её заново, а не продолжаем с
              // последнего аята: продолжать там уже нечего.
              else if (finished) audio.playSurah(surah, total);
              // Продолжаем с места паузы, а не с начала аята.
              else audio.resume();
            }}
            aria-label={playing ? 'Пауза' : 'Слушать'}
            style={{
              width: '72px', height: '72px',
              borderRadius: '50%',
              border: 'none',
              background: 'var(--text-primary)',
              color: 'var(--surface)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {playing ? <Pause size={28} /> : <Play size={28} />}
          </button>

          <button
            onClick={() => audio.next()}
            aria-label="Следующий аят"
            className="icon-btn"
            style={{ width: '52px', height: '52px', color: 'var(--text-secondary)' }}
          >
            <SkipForward size={ICON_SIZE.lg} />
          </button>
        </section>

        {/* ── Соседние суры и скорость ───────────────────────────────── */}
        <section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-tight)',
        }}>
          <button
            onClick={() => playSurah(Math.max(1, surah - 1))}
            disabled={surah <= 1}
            aria-label="Предыдущая сура"
            className="icon-btn"
            style={{ width: 'var(--hit-min)', height: 'var(--hit-min)', opacity: surah <= 1 ? 0.35 : 1 }}
          >
            <ChevronLeft size={ICON_SIZE.md} />
          </button>

          <button
            onClick={() => audio.cyclePlaybackRate()}
            aria-label={`Скорость ${playbackRate}×`}
            style={{
              minWidth: '76px', height: '38px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--hairline)',
              background: 'rgb(var(--ink-rgb) / 0.04)',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              fontSize: 'var(--font-caption1)',
              fontVariantNumeric: 'tabular-nums',
              cursor: 'pointer',
            }}
          >
            {playbackRate}×
          </button>

          <button
            onClick={() => playSurah(Math.min(TOTAL_SURAHS, surah + 1))}
            disabled={surah >= TOTAL_SURAHS}
            aria-label="Следующая сура"
            className="icon-btn"
            style={{
              width: 'var(--hit-min)', height: 'var(--hit-min)',
              opacity: surah >= TOTAL_SURAHS ? 0.35 : 1,
            }}
          >
            <ChevronRight size={ICON_SIZE.md} />
          </button>
        </section>

        </div>

        {/* ── Чтец ───────────────────────────────────────────────────── */}
        <ReciterCard reciter={reciter} onPick={audio.setReciter} />

        {/* ── Выбрать другую суру ────────────────────────────────────── */}
        <section>
          <button
            onClick={() => setPickerOpen(v => !v)}
            aria-expanded={pickerOpen}
            style={{
              width: '100%', minHeight: '44px',
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--hairline)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
              fontSize: 'var(--font-caption1)',
              cursor: 'pointer',
            }}
          >
            {pickerOpen ? 'Скрыть список сур' : 'Выбрать другую суру'}
          </button>

          {pickerOpen && (
            <div style={{
              marginTop: 'var(--space-tight)',
              maxHeight: '46vh',
              overflowY: 'auto',
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--hairline)',
            }}>
              {SURAHS.map(s => (
                <button
                  key={s.number}
                  onClick={() => { playSurah(s.number); setPickerOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-tight)',
                    width: '100%', minHeight: '44px',
                    padding: '0 var(--space-snug)',
                    border: 'none',
                    borderBottom: '1px solid var(--hairline-soft, var(--hairline))',
                    background: s.number === surah
                      ? 'rgb(var(--ink-rgb) / 0.06)'
                      : 'transparent',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    fontSize: 'var(--font-caption1)',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{
                    minWidth: '26px',
                    color: 'var(--text-tertiary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {s.number}
                  </span>
                  <span style={{
                    flex: 1, minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {s.transliteration}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        </>)}
      </div>
    </div>
  );
}
