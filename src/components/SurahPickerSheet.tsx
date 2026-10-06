/**
 * SurahPickerSheet — выбор суры из плеера.
 *
 * Владелец 2026-10-04: «выбор суры сделать простым и удобным… стрелочки
 * вправо-влево не нужны, лучше выбор суры доработать». Прежде это был
 * раскрывающийся список под карточкой чтеца: 114 мелких строк в окне на
 * 46 % экрана, без поиска, и текущую суру приходилось искать прокруткой.
 *
 * Что здесь:
 * - шторка iOS (смах вниз, «назад», тап мимо) — та же `SettingsSheet`, что
 *   у всех панелей приложения;
 * - поиск по названию, переводу названия, арабскому и номеру — те же
 *   правила, что у поиска на главной (`findSurahs`);
 * - у чтеца с неполным набором записей (Мержоев) по умолчанию показаны
 *   только суры, которые у него ЕСТЬ: выбор из 114 строк, где треть
 *   приглушена, — это поиск исключением. Переключатель «Все 114» рядом;
 * - текущая сура отмечена и при открытии стоит в середине списка;
 * - строка — той же типографики, что строка суры на главной: человек
 *   узнаёт список, а не учит второй.
 *
 * Тап по строке сразу включает суру: шторку открывают ради того, чтобы
 * слушать другую суру, и второе подтверждение было бы лишним шагом.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { SettingsSheet, SheetCloseButton } from './ReadingSettings';
import { OfflineMark, surahOffline, useOfflineTick, type SurahOffline } from './SurahOfflineStatus';
import { Close, Search, ICON_SIZE } from './icons';
import { SURAHS, type SurahMeta } from '../content/surahs';
import { findSurahs } from '../lib/search';
import { availableSurahCount, reciterHasSurah, type ReciterId } from '../lib/reciters';
import { TOTAL_SURAHS } from '../lib/ayahNumbering';

type Scope = 'reciter' | 'all';

function ayahWord(n: number): string {
  const two = n % 100, one = n % 10;
  if (two >= 11 && two <= 14) return 'аятов';
  if (one === 1) return 'аят';
  if (one >= 2 && one <= 4) return 'аята';
  return 'аятов';
}

const NUMBER_COLUMN = 26;

export function SurahPickerSheet({
  current, reciter, playing, onPick, onClose,
}: {
  /** Сура в плеере; null — ничего ещё не звучало. */
  current: number | null;
  reciter: ReciterId;
  /** Звучит ли текущая сура прямо сейчас — для подписи у её строки. */
  playing: boolean;
  onPick: (surah: number) => void;
  onClose: () => void;
}) {
  // Значки «скачана / качается» у строк обновляются по ходу загрузки.
  useOfflineTick();
  const partial = availableSurahCount(reciter) < TOTAL_SURAHS;
  // «Есть у чтеца» — по умолчанию, но не когда текущей суры у чтеца нет
  // (сменили чтеца на Мержоева посреди суры 10): иначе список спрятал бы
  // ту самую суру, с которой человек пришёл.
  const [scope, setScope] = useState<Scope>(
    partial && (current == null || reciterHasSurah(reciter, current)) ? 'reciter' : 'all',
  );
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const matched: SurahMeta[] = useMemo(
    () => (trimmed ? findSurahs(trimmed) : SURAHS),
    [trimmed],
  );
  const shown = useMemo(
    () => (scope === 'reciter' ? matched.filter(s => reciterHasSurah(reciter, s.number)) : matched),
    [matched, scope, reciter],
  );
  // Нашлось, но только среди сур, которых у чтеца нет, — сказать об этом
  // прямо, а не показывать пустоту.
  const hiddenByScope = scope === 'reciter' && shown.length === 0 && matched.length > 0;

  // Текущая сура — в середине видимой части при открытии. Прокручиваем
  // саму шторку, а не через scrollIntoView: тот заодно двигает и экран под
  // ней.
  useEffect(() => {
    if (current == null) return;
    const id = window.setTimeout(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-picker-surah="${current}"]`);
      const sheet = row?.closest<HTMLElement>('[data-reading-sheet]');
      if (!row || !sheet) return;
      // Центр — между прилипающей шапкой и кнопкой «Закрыть», а не по всей
      // высоте шторки: иначе на коротком экране строка вставала бы у края
      // видимой полосы, под шапкой или кнопкой.
      const head = sheet.querySelector<HTMLElement>('[data-sheet-head]')?.offsetHeight ?? 0;
      const foot = sheet.querySelector<HTMLElement>('[data-sheet-foot]')?.offsetHeight ?? 0;
      const rowTop = row.getBoundingClientRect().top - sheet.getBoundingClientRect().top + sheet.scrollTop;
      const visible = sheet.clientHeight - head - foot;
      sheet.scrollTop = Math.max(0, rowTop - head - visible / 2 + row.offsetHeight / 2);
    }, 0);
    return () => window.clearTimeout(id);
    // Только при открытии: смена чтеца или поиск не должны дёргать список.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SettingsSheet onClose={onClose}>
      {/* Заголовок с ✕, поиск и область — одна прилипающая шапка.

          Заголовок раньше был у самой шторки (проп `title`) и уезжал вверх
          вместе со списком: шторка открывается сразу прокрученной к текущей
          суре, и кнопки «закрыть» на экране не оставалось вовсе (владелец
          2026-10-05, iPhone). Фон полностью непрозрачный: внутри стекла
          шторки (backdrop-filter) даже 97 % давали заметный просвет — строки
          списка читались поверх поля поиска (замер в Chromium; на iPhone
          владелец видел то же при прежних 86 %). */}
      <div data-sheet-head="" style={{
        position: 'sticky', top: '-8px', zIndex: 1,
        margin: '0 -16px', padding: '4px 16px 10px',
        background: 'var(--surface)',
        boxShadow: '0 1px 0 var(--hairline)',
        display: 'grid', gap: '10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
          <span style={{
            flex: 1, minWidth: 0,
            fontSize: '17px',
            fontWeight: 'var(--weight-semibold)',
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
          }}>
            Суры
          </span>
          <SheetCloseButton onClose={onClose} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          minHeight: '40px', padding: '0 12px',
          borderRadius: 'var(--radius-pill)',
          background: 'rgb(var(--ink-rgb) / 0.07)',
        }}>
          <span aria-hidden style={{ color: 'var(--text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
            <Search size={ICON_SIZE.sm} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Название или номер"
            aria-label="Найти суру"
            enterKeyHint="search"
            inputMode="search"
            style={{
              flex: 1, minWidth: 0,
              border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: 'inherit', fontSize: 'var(--font-body)',
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Очистить"
              className="icon-btn"
              style={{ width: '32px', height: '32px', marginRight: '-8px', flexShrink: 0, color: 'var(--text-tertiary)' }}
            >
              <Close size={ICON_SIZE.sm} />
            </button>
          )}
        </div>

        {partial && (
          <div
            role="radiogroup"
            aria-label="Какие суры показать"
            style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              padding: '2px', gap: '2px',
              borderRadius: 'var(--radius-pill)',
              background: 'rgb(var(--ink-rgb) / 0.07)',
            }}
          >
            {([
              { id: 'reciter' as Scope, label: `Есть у чтеца · ${availableSurahCount(reciter)}` },
              { id: 'all' as Scope, label: `Все ${TOTAL_SURAHS}` },
            ]).map(t => {
              const on = scope === t.id;
              return (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setScope(t.id)}
                  style={{
                    minHeight: '32px',
                    border: 'none',
                    borderRadius: 'var(--radius-pill)',
                    background: on ? 'var(--surface)' : 'transparent',
                    boxShadow: on ? '0 1px 4px rgba(0,0,0,0.14)' : 'none',
                    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontFamily: 'inherit',
                    fontSize: 'var(--font-footnote)',
                    fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                    fontVariantNumeric: 'tabular-nums',
                    cursor: 'pointer',
                    transition: 'background var(--dur-fast) var(--ease-standard)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div ref={listRef} role="list" aria-label="Суры">
        {shown.map((s, i) => (
          <PickerRow
            key={s.number}
            meta={s}
            current={s.number === current}
            playing={playing && s.number === current}
            has={reciterHasSurah(reciter, s.number)}
            offline={surahOffline(reciter, s.number)}
            last={i === shown.length - 1}
            onPick={onPick}
          />
        ))}
      </div>

      {shown.length === 0 && (
        <div style={{
          padding: '40px 8px 32px', textAlign: 'center',
          fontSize: 'var(--font-subhead)', lineHeight: 'var(--leading-subhead)',
          color: 'var(--text-tertiary)',
          display: 'grid', gap: '12px', justifyItems: 'center',
        }}>
          <span>
            {hiddenByScope
              ? 'У этого чтеца нет записи такой суры.'
              : 'Такой суры не нашлось.'}
          </span>
          {hiddenByScope && (
            <button
              onClick={() => setScope('all')}
              style={{
                minHeight: '36px', padding: '0 16px',
                border: 'none', borderRadius: 'var(--radius-pill)',
                background: 'rgb(var(--ink-rgb) / 0.07)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit', fontSize: 'var(--font-footnote)',
                cursor: 'pointer',
              }}
            >
              Показать все {TOTAL_SURAHS}
            </button>
          )}
        </div>
      )}
      {/* «Закрыть» внизу, под большим пальцем: тянуться к ✕ наверху высокой
          шторки неудобно (владелец 2026-10-05). Прилипает к низу шторки;
          отрицательный bottom снимает её нижнее поле (padding шторки —
          max(12px, safe-area − 8px), см. SettingsSheet). */}
      <div data-sheet-foot="" style={{
        position: 'sticky',
        bottom: 'calc(-1 * max(12px, calc(env(safe-area-inset-bottom) - 8px)))',
        zIndex: 1,
        margin: '8px -16px 0',
        padding: '16px 16px max(12px, calc(env(safe-area-inset-bottom) - 8px))',
        background: 'linear-gradient(to bottom, transparent, var(--surface) 40%)',
      }}>
        <button
          onClick={onClose}
          className="player-press"
          style={{
            width: '100%', minHeight: '50px',
            border: 'none', borderRadius: 'var(--radius-pill)',
            background: 'rgb(var(--ink-rgb) / 0.08)',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            fontSize: 'var(--font-body)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Закрыть
        </button>
      </div>
    </SettingsSheet>
  );
}

function PickerRow({
  meta, current, playing, has, offline, last, onPick,
}: {
  meta: SurahMeta;
  current: boolean;
  playing: boolean;
  has: boolean;
  /** Скачана ли сура у этого чтеца — значок у названия (SurahOfflineStatus). */
  offline: SurahOffline;
  last: boolean;
  onPick: (n: number) => void;
}) {
  return (
    <div role="listitem" data-picker-surah={meta.number} style={{ position: 'relative' }}>
      <button
        onClick={() => { if (has) onPick(meta.number); }}
        disabled={!has}
        aria-current={current ? 'true' : undefined}
        aria-label={has
          ? `${meta.number}. ${meta.transliteration}${current ? ', сейчас в плеере' : ''}${offline.kind === 'done' ? ', скачана' : offline.kind === 'running' ? ', скачивается' : offline.kind === 'paused' ? ', загрузка на паузе' : ''}`
          : `${meta.number}. ${meta.transliteration} — у этого чтеца нет записи`}
        className="picker-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)',
          width: 'calc(100% + 16px)', minHeight: '60px',
          margin: '0 -8px', padding: '8px',
          border: 'none', borderRadius: 'var(--radius-control)',
          background: current ? 'rgb(var(--ink-rgb) / 0.06)' : 'transparent',
          cursor: has ? 'pointer' : 'default',
          opacity: has ? 1 : 0.4,
          textAlign: 'left', fontFamily: 'inherit', color: 'inherit',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span aria-hidden style={{
          flexShrink: 0, width: `${NUMBER_COLUMN}px`,
          display: 'inline-flex', justifyContent: 'flex-end',
          fontSize: 'var(--font-footnote)',
          lineHeight: 'var(--leading-footnote)',
          fontWeight: 'var(--weight-semibold)',
          color: current ? 'var(--brand)' : 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {current
            ? <span className="mini-eq" data-state={playing ? 'playing' : 'paused'}><i /><i /><i /></span>
            : meta.number}
        </span>

        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: '1px' }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0,
          }}>
            <span style={{
              minWidth: 0,
              fontSize: 'var(--font-body)',
              lineHeight: 'var(--leading-body)',
              fontWeight: 'var(--weight-semibold)',
              letterSpacing: 'var(--tracking-tight)',
              color: current ? 'var(--brand)' : 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {meta.transliteration}
            </span>
            <OfflineMark state={offline} />
          </span>
          <span style={{
            fontSize: 'var(--font-footnote)',
            lineHeight: 'var(--leading-footnote)',
            color: 'var(--text-tertiary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {has
              ? `${meta.russian} · ${meta.ayahs} ${ayahWord(meta.ayahs)}`
              : 'нет записи у этого чтеца'}
          </span>
        </span>

        <span dir="rtl" lang="ar" style={{
          flexShrink: 0, maxWidth: '34%',
          fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
          fontSize: 'clamp(17px, 5.2vw, 21px)',
          lineHeight: 1.3,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {meta.arabic}
        </span>
      </button>

      {!last && (
        <span aria-hidden style={{
          position: 'absolute',
          left: `calc(${NUMBER_COLUMN}px + var(--space-cozy))`,
          right: 0, bottom: 0, height: '1px',
          background: 'var(--hairline)',
        }} />
      )}
    </div>
  );
}
