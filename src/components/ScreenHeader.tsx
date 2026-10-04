/**
 * ScreenHeader — верхняя панель экранов, открывающихся «поверх»
 * (чтение суры, закладки, лента азкаров, намаз, аккаунт).
 *
 * ── Вид iOS 26 (владелец 2026-10-04: «стиль xtrud … верхнее меню») ──
 *
 * В Liquid Glass навигационная панель сама прозрачна: стеклянными
 * становятся только кнопки, а контент под панелью мягко растворяется
 * (scroll edge effect). Поэтому здесь (docs/IOS26_DESIGN_GUIDE.md § 2–3):
 *
 *   [ ‹ ]  Заголовок …            [ действие  действие ]
 *    ↑ стеклянный круг           ↑ стеклянная капсула-группа
 *
 *  • «назад» — отдельный круг 48 (на ступень крупнее 44: его жмут вслепую
 *    у самого края);
 *  • действия — одна капсула, как системная группа кнопок панели;
 *  • заголовок — без подложки, поверх растворения;
 *  • под всем — растворение: фон экрана плотный у строки состояния и сходит
 *    на нет ниже кнопок, с лёгким размытием. Текст аята, уходя под
 *    панель, гаснет, а не просвечивает сквозь стекло.
 *
 * Прежде (an-Nur) всё лежало в одной стеклянной капсуле во всю ширину.
 *
 * Заголовок прижат к кнопке «назад», а не отцентрован: при трёх действиях
 * справа центрированный заголовок на узком экране наезжает на них.
 *
 * Пустые места панели касания пропускают — под ними живой текст.
 *
 * Геометрия прежняя (строка 64 + зазор от безопасной области): от неё
 * считается отступ контента всех экранов (`screenHeaderOffset`).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { ChevronLeft } from './icons';
import { GLASS_BLUR } from '../lib/glass';

/** Высота самой капсулы. */
export const SCREEN_HEADER_HEIGHT = 64;
/** Зазор между капсулой и верхней безопасной областью.
 *
 * Было 8. Владелец 07.09.2026: «как будто бы можно уменьшить отступ сверху,
 * чтобы оно немножко выше подтянуто было на всём сайте». Уменьшено до 4:
 * панель поднимается на четыре точки на ВСЕХ экранах разом, потому что от
 * этой константы считается и её положение, и отступ контента под ней
 * (`screenHeaderOffset`). Меньше четырёх ставить не стал — капсула начинает
 * липнуть к строке состояния, и стекло сливается с ней. */
const CAPSULE_TOP = 4;
/** Зазор от боковых краёв экрана. */
const CAPSULE_SIDE = 12;
/** Насколько растворение контента заходит ниже строки кнопок. */
const EDGE_FADE = 18;

/** Длительность выезда/ухода панели — держим рядом с разметкой, чтобы
 *  флаг will-change снимался ровно после перехода, а не «примерно». */
const HIDE_TRANSITION_MS = 180;

/**
 * Готовый отступ сверху для контента под панелью.
 *
 * 🔴 Считает ВСЁ занятое панелью место, вместе с зазором до безопасной
 * области: панель плавающая, и без зазора в расчёте первая строка экрана
 * уходила бы под стекло. Оно полупрозрачное, поэтому такая ошибка не
 * выглядит как ошибка — текст «вроде виден», просто не читается.
 */
export const screenHeaderOffset = (extra = 0) =>
  `calc(${SCREEN_HEADER_HEIGHT + CAPSULE_TOP + extra}px + env(safe-area-inset-top))`;

export type HeaderAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Кнопка в «нажатом» состоянии — открыт её попап. */
  active?: boolean;
  /** Ref нужен попаповам: они якорятся под своей кнопкой. */
  ref?: React.Ref<HTMLButtonElement>;
  /** Подсказка при наведении, если длиннее подписи. */
  title?: string;
};

export function ScreenHeader({
  title, subtitle, onBack, actions = [], progress, visible = true,
}: {
  title: string;
  /** Мелкая строка под заголовком — например «3 / 16». */
  subtitle?: string;
  onBack: () => void;
  actions?: HeaderAction[];
  /** 0..1 — тонкая полоса по нижней кромке (прогресс по ленте). */
  progress?: number;
  /** Визуально скрыть панель, не размонтируя её и не меняя геометрию контента. */
  visible?: boolean;
}) {
  // `will-change` живёт ровно столько, сколько идёт переход.  Постоянный
  // флаг на элементе с backdrop-filter заставляет WebKit держать слой с
  // размытием всё время, пока экран открыт, — а анимация случается на
  // единичные тапы.  Ожидание на setTimeout, а не на requestAnimationFrame:
  // в скрытой вкладке rAF не тикает и флаг остался бы висеть навсегда.
  const [animating, setAnimating] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setAnimating(true);
    const id = setTimeout(() => setAnimating(false), HIDE_TRANSITION_MS + 60);
    return () => clearTimeout(id);
  }, [visible]);

  return (
    <header
      role="banner"
      className="screen-header"
      data-animating={animating}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        height: `calc(env(safe-area-inset-top) + ${CAPSULE_TOP + SCREEN_HEADER_HEIGHT}px)`,
        boxSizing: 'border-box',
        paddingTop: `calc(env(safe-area-inset-top) + ${CAPSULE_TOP}px)`,
        // Касания проходят сквозь пустые места к тексту; кнопки включают
        // их себе сами.
        pointerEvents: 'none',
        // Уезжает выше собственной высоты — иначе край растворения
        // остаётся торчать под часами.
        transform: visible ? 'translate3d(0, 0, 0)' : 'translate3d(0, -100%, 0)',
        opacity: visible ? 1 : 0,
        transition:
          'transform var(--dur-base) var(--ease-panel),'
          + ' opacity var(--dur-fast) var(--ease-standard)',
      }}
      aria-hidden={!visible}
    >
      {/* Растворение контента под панелью (scroll edge effect). */}
      <HeaderEdge />
      <div style={{
        position: 'relative',
        height: `${SCREEN_HEADER_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-tight)',
        padding: `0 ${CAPSULE_SIDE}px`,
        // Тот же предел ширины, что у контента экранов, чтобы на
        // планшете кнопки не разъезжались по краям.
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <HeaderBackButton onBack={onBack} interactive={visible} />

        <div style={{ minWidth: 0, flex: 1, padding: '0 var(--space-tight)' }}>
          <div
            className="display-serif"
            style={{
              // Title 3 — ближайшая ступень iOS к прежним 19px.  Nav-bar
              // Headline (17) в панели высотой 64 читался бы потерянно.
              fontSize: 'var(--font-title3)',
              lineHeight: 'var(--leading-title3)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--text-primary)',
              letterSpacing: 'var(--tracking-tight)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{
              fontSize: 'var(--font-footnote)',
              lineHeight: 'var(--leading-footnote)',
              color: 'var(--text-tertiary)',
              letterSpacing: 'var(--tracking-loose)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {subtitle}
            </div>
          )}
        </div>

        <HeaderActionGroup actions={actions} interactive={visible} />
      </div>

      {progress != null && (
        <div
          aria-hidden
          style={{
            // Под строкой кнопок, в полях экрана: капсулы, к кромке которой
            // полоса прилегала прежде, больше нет.
            position: 'absolute', left: `${CAPSULE_SIDE + 8}px`, right: `${CAPSULE_SIDE + 8}px`, bottom: '-2px',
            height: '2px', borderRadius: '1px', overflow: 'hidden',
            background: 'rgb(var(--ink-rgb) / 0.08)',
          }}
        >
          {/* scaleX, а не width: ширина — свойство лейаута, и её анимация
              заставляет браузер пересчитывать раскладку на каждом кадре.
              Полоса живёт в шапке над лентой тяжёлого арабского текста и
              обновляется всё время воспроизведения — это ровно то место,
              где такой пересчёт стоит дорого. transform считается
              композитором и лейаут не трогает.

              transform-origin слева: полоса растёт от начала строки. */}
          <div style={{
            height: '100%',
            width: '100%',
            transformOrigin: 'left center',
            transform: `scaleX(${Math.min(1, Math.max(0, progress)).toFixed(4)})`,
            background: 'var(--text-primary)',
            opacity: 0.7,
            transition: 'transform var(--dur-base) var(--ease-standard)',
            willChange: 'transform',
          }} />
        </div>
      )}
    </header>
  );
}

// ─── Общие детали шапок ───────────────────────────────────────────────────

/** Ведущая кнопка «назад» — стеклянный круг 48. */
function HeaderBackButton({ onBack, interactive = true }: {
  onBack: () => void;
  /** false — шапка спрятана: кнопка не ловит касания. */
  interactive?: boolean;
}) {
  return (
    <button
      onClick={() => {
        // 🔴 impact, а не selectionChanged. В плагине selectionChanged
        // срабатывает, только если генератор создан через selectionStart —
        // а его никто не вызывал, и вибрация на iOS молчала с самого начала
        // (Haptics.swift, ревью 10.09.2026).
        if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
        onBack();
      }}
      aria-label="Назад"
      // Без `.icon-btn`: он объявлен в CSS позже `.liquid-glass` и
      // перебил бы стекло прозрачным фоном. Нужное от него — здесь.
      className="ios-header-button ios-header-back liquid-glass"
      style={{
        ...GLASS_BLUR,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        transition: 'transform var(--dur-fast) var(--ease-standard), opacity var(--dur-fast) var(--ease-standard)',
        // Ведущая кнопка на ступень крупнее минимальных 44×44:
        // «назад» жмут вслепую, у самого края экрана.
        width: '48px', height: '48px', flexShrink: 0,
        borderRadius: '50%',
        color: 'var(--text-primary)',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      <ChevronLeft size={24} />
    </button>
  );
}

/** Действия справа — одна стеклянная капсула, как группа кнопок панели iOS 26. */
function HeaderActionGroup({ actions, interactive = true }: {
  actions: HeaderAction[];
  interactive?: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <div
      className="ios-header-actions liquid-glass"
      style={{ ...GLASS_BLUR, pointerEvents: interactive ? 'auto' : 'none' }}
    >
      {actions.map(a => (
        <button
          key={a.key}
          ref={a.ref}
          onClick={() => {
            if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
            a.onClick();
          }}
          aria-label={a.label}
          title={a.title ?? a.label}
          className="icon-btn ios-header-button"
          data-active={a.active}
          style={{
            width: 'var(--hit-min)', height: 'var(--hit-min)', flexShrink: 0,
            color: a.active ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

/**
 * Растворение контента под панелью (scroll edge effect, мягкий стиль).
 * Ниже кнопок на EDGE_FADE px, чтобы граница не читалась линией. Размытие —
 * маской того же градиента: у кромки оно сходит на нет вместе с фоном.
 */
function HeaderEdge({ edgeRef, initialOpacity = 1 }: {
  edgeRef?: React.Ref<HTMLDivElement>;
  initialOpacity?: number;
}) {
  return (
    <div
      ref={edgeRef}
      aria-hidden
      className="screen-header-edge"
      style={{
        ...GLASS_BLUR,
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: `-${EDGE_FADE}px`,
        opacity: initialOpacity,
      }}
    />
  );
}

/** Прокрутка, на которой компактный заголовок проявляется (xtrud: 24–60 pt). */
const COMPACT_FROM = 24;
const COMPACT_LENGTH = 36;

/**
 * CollapsingNavBar — строка навигационной панели над экраном с крупным
 * заголовком или обложкой.
 *
 * Сверху — стеклянный «назад» и группы действий; компактный заголовок по
 * центру проявляется, когда крупный ушёл под панель; растворение под
 * строкой включается, только когда под неё заехал контент (на самом верху
 * панель чистая, как в системе).
 *
 * Прокрутка пишется прямо в style через ref — без setState, чтобы экран не
 * перерисовывался на каждом кадре прокрутки.
 *
 * Геометрия строки — та же, что у `ScreenHeader`: кнопки «назад» и действий
 * стоят на одном месте на всех экранах приложения.
 */
export function CollapsingNavBar({
  title, onBack, actionGroups = [], collapseStart, headerRef, active = true,
}: {
  /** false — экран припаркован (не виден): замер границы откладывается до
   *  возвращения, иначе он считался бы по нулевой геометрии. */
  active?: boolean;
  title: string;
  onBack?: () => void;
  /** Группы действий справа: каждая — своя стеклянная капсула. */
  actionGroups?: HeaderAction[][];
  /** С какой прокрутки (px) начинать сворачивание; получает нижнюю кромку
   *  самой панели в координатах окна. По умолчанию 24 — как у крупного
   *  заголовка; экрану с обложкой — низ обложки минус кромка панели. */
  collapseStart?: (barBottom: number) => number;
  /** Ref на саму панель — экрану, которому нужна её кромка (поднять поле
   *  поиска к панели, начать под ней дорожку быстрой прокрутки). Своя
   *  ссылка надёжнее поиска `header.screen-header` по документу: копия
   *  шапки в предпросмотре жеста или вторая панель сбили бы замер. */
  headerRef?: React.MutableRefObject<HTMLElement | null>;
}) {
  const compactRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const ownRef = useRef<HTMLElement | null>(null);
  const live = useRef({ collapseStart });
  live.current = { collapseStart };

  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const bar = ownRef.current?.getBoundingClientRect().bottom ?? 0;
      return live.current.collapseStart?.(bar) ?? COMPACT_FROM;
    };
    let start = measure();
    const apply = () => {
      const y = window.scrollY;
      const compact = Math.min(1, Math.max(0, (y - start) / COMPACT_LENGTH));
      const edge = Math.min(1, Math.max(0, (y - start + COMPACT_FROM) / COMPACT_FROM));
      if (compactRef.current) compactRef.current.style.opacity = String(compact);
      if (edgeRef.current) edgeRef.current.style.opacity = String(edge);
    };
    // Граница сворачивания зависит от раскладки (высота обложки) — её
    // пересчитываем при смене размера окна, а не на каждой прокрутке.
    const remeasure = () => {
      start = measure();
      apply();
    };
    apply();
    window.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('scroll', apply);
      window.removeEventListener('resize', remeasure);
    };
  }, [active]);

  const groups = actionGroups.filter(g => g.length > 0);

  return (
    <header
      ref={el => {
        ownRef.current = el;
        if (headerRef) headerRef.current = el;
      }}
      role="banner"
      className="screen-header"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        height: `calc(env(safe-area-inset-top) + ${CAPSULE_TOP + SCREEN_HEADER_HEIGHT}px)`,
        boxSizing: 'border-box',
        paddingTop: `calc(env(safe-area-inset-top) + ${CAPSULE_TOP}px)`,
        pointerEvents: 'none',
      }}
    >
      <HeaderEdge edgeRef={edgeRef} initialOpacity={0} />
      <div style={{
        position: 'relative',
        height: `${SCREEN_HEADER_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-tight)',
        padding: `0 ${CAPSULE_SIDE}px`,
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        {onBack ? <HeaderBackButton onBack={onBack} /> : <span style={{ width: '48px', flexShrink: 0 }} aria-hidden />}
        {/* Компактный заголовок — по центру строки, как в системной
            навигационной панели; проявляется по прокрутке. */}
        <div
          ref={compactRef}
          aria-hidden
          className="display-serif"
          style={{
            flex: 1, minWidth: 0,
            textAlign: 'center',
            opacity: 0,
            fontSize: 'var(--font-headline)',
            lineHeight: 'var(--leading-headline)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        {groups.length > 0
          ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', flexShrink: 0 }}>
              {groups.map(g => <HeaderActionGroup key={g.map(a => a.key).join('+')} actions={g} />)}
            </div>
          )
          : <span style={{ width: '48px', flexShrink: 0 }} aria-hidden />}
      </div>
    </header>
  );
}

/**
 * LargeTitleHeader — шапка экрана с крупным заголовком (Large Title iOS).
 *
 * Как в xtrud и в «Настройках» iOS 26: сверху строка панели
 * (`CollapsingNavBar`), под ней в потоке страницы — крупный заголовок. При
 * прокрутке он уходит вверх, а в строке на 24–60 pt проявляется компактный.
 */
export function LargeTitleHeader({
  title, onBack, actions = [], bottomGap = 'var(--space-margin)', active = true,
}: {
  /** false — экран припаркован: панель не слушает прокрутку. */
  active?: boolean;
  title: string;
  onBack?: () => void;
  actions?: HeaderAction[];
  /** Отступ под крупным заголовком до содержимого экрана. */
  bottomGap?: string;
}) {
  return (
    <>
      <CollapsingNavBar title={title} onBack={onBack} actionGroups={[actions]} active={active} />
      <h1
        className="display-serif"
        style={{
          margin: 0,
          paddingTop: screenHeaderOffset(4),
          paddingBottom: bottomGap,
          // Кегль плавает между Title 1 и Large Title: на телефоне решает
          // 8vw, ступени шкалы держат границы. Межстрочный — доля от кегля:
          // фиксированная ступень не умеет следовать за clamp.
          fontSize: 'clamp(var(--font-title1), 8vw, var(--font-largetitle))',
          fontWeight: 'var(--weight-regular)',
          letterSpacing: '-0.03em',
          color: 'var(--text-primary)',
          lineHeight: 1.05,
          overflowWrap: 'anywhere',
        }}
      >
        {title}
      </h1>
    </>
  );
}
