/**
 * ComingSoonScreen — общий каркас для разделов, которые ещё не
 * реализованы: «Намаз» и «Кибла».
 *
 * Зачем ставить заглушки сейчас, а не добавлять вкладки потом:
 * панель вкладок с двумя пунктами и панель с четырьмя — это разная
 * вёрстка, разные отступы у экранов и разное поведение системной
 * кнопки «назад».  Дешевле заложить конечную форму навигации сразу,
 * чем переделывать её вместе с самими фичами.
 *
 * Экран честно говорит, что раздела ещё нет, и перечисляет, что в нём
 * будет, — пустая страница без объяснений читается как баг.
 *
 * ── Статус ────────────────────────────────────────────────────────────
 *
 * Сейчас компонент никем не импортируется: «Намаз» и «Кибла» уже
 * сделаны своими экранами (PrayerTimesScreen, QiblaScreen).  Каркас
 * оставлен как готовая форма для следующего незаконченного раздела и
 * приведён к общей шкале, чтобы к моменту возврата в навигацию он не
 * выпадал из типографики.
 *
 * ── Типографика ───────────────────────────────────────────────────────
 *
 * Заголовок был вдвое крупнее всех остальных экранов —
 * clamp(44px, 12vw, 88px) весом 300, которого у подключённых подсетов
 * Inter нет вовсе.  Приведён к форме «Коран» / «Аккаунт»:
 * clamp(30px, 8vw, 40px), Regular.
 */

import type { ReactNode } from 'react';
import { TAB_BAR_SPACE } from '../components/TabBar';

export function ComingSoonScreen({
  title, icon, lead, points,
}: {
  title: string;
  icon: ReactNode;
  /** Одна фраза о сути раздела. */
  lead: string;
  /** Что появится — короткие пункты, без обещаний по срокам. */
  points: string[];
}) {
  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: 'min(100%, 760px)',
      margin: '0 auto',
      padding: `0 var(--space-margin) calc(${TAB_BAR_SPACE} + var(--space-section) + var(--mini-player-space, 0px) + env(safe-area-inset-bottom))`,
      position: 'relative',
      zIndex: 1,
    }}>
      <header style={{
        paddingTop: 'calc(env(safe-area-inset-top) + var(--space-margin))',
        paddingBottom: 'var(--space-section)',
      }}>
        <h1
          className="display-serif"
          style={{
            margin: 0,
            fontSize: 'clamp(30px, 8vw, 40px)',
            fontWeight: 'var(--weight-regular)',
            letterSpacing: '-0.03em',
            color: 'var(--text-primary)',
            lineHeight: 1.05,
          }}
        >
          {title}
        </h1>
      </header>

      <section style={{
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--radius-card)',
        background: 'rgb(var(--ink-rgb) / 0.03)',
        padding: 'var(--space-section)',
        display: 'grid',
        gap: 'var(--space-margin)',
        justifyItems: 'center',
        textAlign: 'center',
      }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--hairline-strong)',
            color: 'var(--text-tertiary)',
          }}
        >
          {icon}
        </span>

        <div style={{ display: 'grid', gap: 'var(--space-snug)' }}>
          <p style={{
            margin: 0,
            fontSize: 'var(--font-subhead)',
            lineHeight: 'var(--leading-subhead)',
            fontWeight: 'var(--weight-regular)',
            color: 'var(--text-primary)',
          }}>
            Скоро
          </p>
          <p style={{
            margin: 0,
            fontSize: 'var(--font-footnote)',
            lineHeight: 'var(--leading-footnote)',
            color: 'var(--text-secondary)',
            maxWidth: '38ch',
          }}>
            {lead}
          </p>
        </div>

        <ul style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 'var(--space-snug)',
          justifyItems: 'start',
          textAlign: 'left',
          width: '100%',
          maxWidth: '38ch',
        }}>
          {points.map(p => (
            <li
              key={p}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 'var(--space-snug)',
                alignItems: 'start',
                fontSize: 'var(--font-footnote)',
                lineHeight: 'var(--leading-footnote)',
                color: 'var(--text-secondary)',
              }}
            >
              {/* Маркер выведен из шкалы, а не подобран на глаз:
                  середина первой строки минус половина точки. */}
              <span aria-hidden style={{
                marginTop: 'calc((var(--leading-footnote) - 4px) / 2)',
                width: '4px',
                height: '4px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--text-tertiary)',
              }} />
              {p}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
