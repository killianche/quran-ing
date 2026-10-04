/**
 * DevotionalBits — части карточки азкара (счётчик, раскрывающийся
 * источник).
 *
 * Вынесены из AzkarCategoryScreen, когда их делил ещё раздел «Дуа»; в
 * Quran Ing раздела дуа нет, компонент остался общим для карточек
 * азкаров.
 */

import type { AzkarReward } from '../lib/azkar';
import { BookOpen, Check, ChevronDown, ICON_SIZE } from './icons';

export function TasbihPill({
  current, target, onTap, onReset,
}: {
  current: number;
  target: number;
  onTap: () => void;
  onReset: () => void;
}) {
  const done = current >= target;
  const progress = Math.min(1, current / target);
  return (
    <button
      data-no-count
      onClick={e => { e.stopPropagation(); done ? onReset() : onTap(); }}
      onContextMenu={e => { e.preventDefault(); onReset(); }}
      aria-label={done ? `Завершено ${target} из ${target} — клик чтобы сбросить` : `Счётчик: ${current} из ${target}, нажми чтобы добавить`}
      title={done ? `${current} / ${target} — клик чтобы сбросить` : `${current} / ${target}`}
      className={done ? 'tasbih-pill-done' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 12px 5px 10px',
        borderRadius: '9999px',
        // Done-стиль сделан в десять раз мягче: пользователь жаловался,
        // что в светлой теме «done»-состояние читается как алерт.
        // Раньше: bg 16%, border 55%, шадоу-хало 10/18%, scale(1.04).
        // Теперь: bg 6%, border 28%, без хало (только лёгкое drop-shadow),
        // без scale-overshoot.  Чекмарк остаётся как явный сигнал.
        border: done
          ? '1px solid rgb(var(--text-primary-rgb) / 0.28)'
          : '1px solid var(--hairline)',
        background: done
          ? 'rgb(var(--text-primary-rgb) / 0.06)'
          : 'rgb(var(--ink-rgb) / 0.04)',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        transform: 'scale(1)',
        boxShadow: done
          ? '0 1px 4px rgb(var(--text-primary-rgb) / 0.08)'
          : 'none',
        transition: 'background 240ms ease, box-shadow 240ms ease, border-color 240ms ease',
      }}
    >
      {/* Галочка выезжает при завершении.  Раскрытие анимирует обёртка,
          а не сама иконка: у иконки набора фиксированная сетка, и
          менять ей ширину значило бы сплющивать рисунок. */}
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          overflow: 'hidden',
          flexShrink: 0,
          color: 'var(--text-primary)',
          opacity: done ? 1 : 0,
          width: done ? `${ICON_SIZE.sm}px` : 0,
          marginRight: done ? 0 : '-8px',
          transition: 'opacity 200ms ease 60ms, width 220ms cubic-bezier(0.4, 0, 0.2, 1), margin-right 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <Check size={ICON_SIZE.sm} style={{ flexShrink: 0 }} />
      </span>

      {/* Current count — намеренно тот же размер/цвет/вес, что и
          у "/ target" справа: пользователь просил одинаковый стиль. */}
      <span style={{
        fontSize: '12px',
        fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
        color: done ? 'var(--text-primary)' : 'var(--text-tertiary)',
        minWidth: '14px',
        textAlign: 'right',
        transition: 'color 200ms ease',
      }}>
        {current}
      </span>
      <span style={{
        fontSize: '12px',
        fontWeight: 500,
        color: done ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
        transition: 'color 200ms ease',
      }}>
        / {target}
      </span>

      {/* Thin progress bar — fills to 100% on completion */}
      <span
        aria-hidden
        style={{
          width: '52px',
          height: '3px',
          borderRadius: '999px',
          background: 'rgb(var(--text-primary-rgb) / 0.1)',
          overflow: 'hidden',
          display: 'block',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${progress * 100}%`,
            height: '100%',
            background: 'var(--text-primary)',
            // Раньше при done бар становился solid 100% → в светлой
            // теме читался как чёрная отметка-алерт.  Снижено до 0.55,
            // чтобы прогресс ощущался как «полный, но мягкий».
            opacity: done ? 0.55 : 0.7,
            transition: 'width 240ms cubic-bezier(0.32, 0.72, 0, 1), opacity 240ms ease',
          }}
        />
      </span>
    </button>
  );
}

/**
 * SuraAyahs — Quran-style per-ayah render for azkars that are full
 * suras (Al-Ikhlas / Al-Falaq / An-Nas).  Each ayah is its own block:
 *   1. Arabic centred, large, with the same Naskh face the user
 *      picked in the popover.
 *   2. A small "N:M" chip in muted tone.
 *   3. Russian translation row underneath.
 *   4. A hairline separator before the next ayah.
 *
 * No bookmark or audio-per-ayah buttons — keeps focus on the text;
 * the carousel's existing play button still drives audio for the
 * whole sura recording.
 */

export function SourceDisclosure({
  rewards, legacy, open, onToggle,
}: {
  rewards: AzkarReward[];
  legacy?: string | null;
  /** Controlled open/closed state — shared across every card in the
   *  carousel so the user only needs to expand once. */
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      className="azkar-source-disclosure"
      open={open}
      onToggle={e => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (next !== open) onToggle(next);
      }}
      style={{
        margin: '0 0 6px',
        border: '1px solid var(--hairline)',
        borderRadius: '12px',
        background: 'rgb(var(--ink-rgb) / 0.03)',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          userSelect: 'none',
        }}
      >
        {/* Книга — знак «источник / наука».  Раньше здесь была вторая
            книга набора, нарисованная корешком; общая иконка «Коран»
            означает ровно то же и живёт в одном экземпляре. */}
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            color: 'var(--text-tertiary)',
          }}
        >
          <BookOpen size={ICON_SIZE.sm} />
        </span>
        <span style={{
          flex: 1,
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          Источник
        </span>
        {/* Шеврон набора.  Класс `chev` обязателен: правило
            `.azkar-source-disclosure[open] > summary svg.chev` в
            index.css поворачивает его на 180° при раскрытии. */}
        <ChevronDown
          size={ICON_SIZE.sm}
          className="chev"
          style={{
            color: 'var(--text-tertiary)',
            flexShrink: 0,
            transition: 'transform 180ms ease',
          }}
        />
      </summary>

      <div style={{
        padding: '0 14px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}>
        {rewards.map((reward, i) => (
          <div key={i} style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingTop: i === 0 ? '4px' : '14px',
            borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
          }}>
            <p style={{
              margin: 0,
              fontSize: '13px',
              lineHeight: 1.55,
              color: 'var(--text-secondary)',
              letterSpacing: '0.005em',
            }}>
              {reward.text}
            </p>
            {reward.hadiths.length > 0 && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                marginTop: '2px',
              }}>
                {reward.hadiths.map((h, j) => (
                  <span key={j} style={{
                    display: 'inline-block',
                    padding: '3px 9px',
                    borderRadius: '999px',
                    background: 'rgb(var(--ink-rgb) / 0.06)',
                    border: '1px solid var(--hairline)',
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.01em',
                    whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Legacy `entry.source` (the attribution line из исходных данных)
            — shown quietly below the rewards block when both are present,
            so we don't lose the historical attribution. */}
        {legacy && (
          <p
            style={{
              margin: '4px 0 0',
              paddingTop: '12px',
              borderTop: '1px solid var(--hairline)',
              fontSize: '11px',
              lineHeight: 1.45,
              color: 'var(--text-tertiary)',
              opacity: 0.8,
            }}
          >
            {legacy}
          </p>
        )}
      </div>
    </details>
  );
}

