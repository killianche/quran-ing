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
import { createPortal } from 'react-dom';
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
 * Крупный заголовок корневой вкладки (Large Title iOS) — тот же кегль, что
 * был у отдельной строки под панелью: Title 1…Large Title, решает 8vw.
 */
const ROOT_TITLE_SIZE = 'clamp(var(--font-title1), 8vw, var(--font-largetitle))';
/** До какого кегля он сжимается при прокрутке — Title 2, px. */
const ROOT_TITLE_MIN_PX = 22;
/** За сколько пикселей прокрутки крупный заголовок сжимается до Title 2. */
const ROOT_TITLE_SHRINK = 44;

/** Где слушать прокрутку: у вкладки — её страница, у экрана «поверх» — окно. */
type ScrollSource = HTMLElement | null | undefined;

/**
 * CollapsingNavBar — строка навигационной панели над экраном с крупным
 * заголовком.
 *
 * Сверху — стеклянный «назад» и группы действий; компактный заголовок по
 * центру проявляется, когда крупный ушёл под панель; растворение под
 * строкой включается, только когда под неё заехал контент (на самом верху
 * панель чистая, как в системе).
 *
 * У корневой вкладки (`rootTitle`) отдельного компактного заголовка нет:
 * крупный стоит в самой строке, слева, на уровне кнопок, и при прокрутке тот
 * же элемент плавно сжимается до Title 2, оставаясь на месте (владелец
 * 2026-10-05: «чтобы они были в левом верхнем углу, как у айфонов»).
 *
 * Прокрутка пишется прямо в style через ref — без setState, чтобы экран не
 * перерисовывался на каждом кадре прокрутки. Сжатие — только `transform`:
 * смена `font-size` перекладывала бы строку на каждом кадре.
 *
 * Геометрия строки — та же, что у `ScreenHeader`: кнопки «назад» и действий
 * стоят на одном месте на всех экранах приложения.
 */
export function CollapsingNavBar({
  title, onBack, actionGroups = [], headerRef, active = true, scroller, host, rootTitle = false,
}: {
  /** false — экран припаркован (не виден): замер границы откладывается до
   *  возвращения, иначе он считался бы по нулевой геометрии. */
  active?: boolean;
  title: string;
  onBack?: () => void;
  /** Группы действий справа: каждая — своя стеклянная капсула. */
  actionGroups?: HeaderAction[][];
  /** Ref на саму панель — экрану, которому нужна её кромка (поднять поле
   *  поиска к панели, начать под ней дорожку быстрой прокрутки). Своя
   *  ссылка надёжнее поиска `header.screen-header` по документу: копия
   *  шапки в предпросмотре жеста или вторая панель сбили бы замер. */
  headerRef?: React.MutableRefObject<HTMLElement | null>;
  /**
   * Своя прокрутка экрана (страница вкладки, TabPager). Не задана — окно,
   * как у экранов «поверх»; null — прокрутки ещё нет (первый кадр
   * вкладки), слушать нечего.
   */
  scroller?: ScrollSource;
  /**
   * Слой страницы, в который встаёт панель (TabPager, `data-tab-header-host`):
   * панель едет со страницей при листании и не уезжает при прокрутке. Не
   * задан — панель закреплена у окна; null — слоя ещё нет, панель не рисуем.
   */
  host?: HTMLElement | null;
  /** Корневая вкладка: крупный заголовок в строке, сжимается на месте. */
  rootTitle?: boolean;
}) {
  const compactRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const ownRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || scroller === null) return;
    const target: HTMLElement | Window = scroller ?? window;
    const readY = () => (scroller ? scroller.scrollTop : window.scrollY);
    // Во сколько раз крупный заголовок меньше на Title 2. Кегль крупного
    // плавает с шириной экрана (8vw), поэтому меряется, а не берётся числом.
    let minScale = 1;
    const measure = () => {
      const el = titleRef.current;
      const px = el ? parseFloat(getComputedStyle(el).fontSize) : NaN;
      minScale = Number.isFinite(px) && px > ROOT_TITLE_MIN_PX ? ROOT_TITLE_MIN_PX / px : 1;
    };
    const apply = () => {
      const y = Math.max(0, readY());
      if (rootTitle) {
        const t = Math.min(1, y / ROOT_TITLE_SHRINK);
        if (titleRef.current) titleRef.current.style.transform = `scale(${1 + (minScale - 1) * t})`;
        // Кромка — как только контент заехал под строку: у корневой вкладки
        // он начинается сразу под ней.
        if (edgeRef.current) edgeRef.current.style.opacity = String(Math.min(1, y / COMPACT_FROM));
        return;
      }
      // Порог постоянный: крупный заголовок всегда в начале экрана.
      const start = COMPACT_FROM;
      const compact = Math.min(1, Math.max(0, (y - start) / COMPACT_LENGTH));
      const edge = Math.min(1, Math.max(0, (y - start + COMPACT_FROM) / COMPACT_FROM));
      if (compactRef.current) compactRef.current.style.opacity = String(compact);
      if (edgeRef.current) edgeRef.current.style.opacity = String(edge);
    };
    const onResize = () => { measure(); apply(); };
    measure();
    apply();
    target.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      target.removeEventListener('scroll', apply);
      window.removeEventListener('resize', onResize);
    };
  }, [active, scroller, rootTitle]);

  const groups = actionGroups.filter(g => g.length > 0);

  // Слой страницы ещё не готов (первый коммит вкладки) — панели нет; кадр
  // с ней не отрисуется: TabPager отдаёт слой до первой отрисовки.
  if (host === null) return null;

  const header = (
    <header
      ref={el => {
        ownRef.current = el;
        if (headerRef) headerRef.current = el;
      }}
      role="banner"
      className="screen-header"
      style={{
        // В слое страницы — по нему; без слоя — закреплена у окна.
        position: host ? 'absolute' : 'fixed',
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
        {onBack && <HeaderBackButton onBack={onBack} />}
        {rootTitle ? (
          // Крупный заголовок корневой вкладки — в строке кнопок, слева, на
          // линии поля страницы. Ширина — до капсулы действий, длинное
          // название уходит в многоточие, а не под кнопки. Сжатие — scale от
          // левого края, поэтому буква стоит на месте.
          <div style={{
            flex: 1, minWidth: 0,
            paddingLeft: `calc(var(--space-margin) - ${CAPSULE_SIDE}px)`,
          }}>
            <h1
              ref={titleRef}
              className="display-serif"
              style={{
                margin: 0,
                fontSize: ROOT_TITLE_SIZE,
                fontWeight: 'var(--weight-regular)',
                letterSpacing: '-0.03em',
                // 1.2, а не 1.05, как было у отдельной строки: тут заголовок
                // режется по ширине (многоточие), и при тесной строке
                // `overflow: hidden` срезал бы выносные элементы букв.
                lineHeight: 1.2,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                transformOrigin: 'left center',
              }}
            >
              {title}
            </h1>
          </div>
        ) : (
          /* Компактный заголовок проявляется по прокрутке. С «назад» — по
             центру строки, как в системной навигационной панели. Без него —
             слева, на линии крупного заголовка: центрированный между пустым
             местом под «назад» и капсулой действий, он висел посреди экрана
             без опоры (владелец 2026-10-05: «должен быть слева вверху»). */
          <div
            ref={compactRef}
            aria-hidden
            className="display-serif"
            style={{
              flex: 1, minWidth: 0,
              textAlign: onBack ? 'center' : 'left',
              // Поля строки — CAPSULE_SIDE; добираем до поля страницы, чтобы
              // буква встала ровно над крупным заголовком.
              paddingLeft: onBack ? 0 : `calc(var(--space-margin) - ${CAPSULE_SIDE}px)`,
              opacity: 0,
              // Title 2, а не Headline: у системной панели компактный заголовок
              // — 17 pt SF Pro, но наша антиква на тех же 17 читалась на
              // полкегля мельче (владелец 2026-10-04: «заголовок Коран
              // слишком мелкий при прокрутке»).
              fontSize: 'var(--font-title2)',
              lineHeight: 'var(--leading-title2)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
        )}
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
  return host ? createPortal(header, host) : header;
}

/**
 * LargeTitleHeader — шапка экрана с крупным заголовком (Large Title iOS).
 *
 * Экран «поверх» (с «назад»): как в xtrud и в «Настройках» iOS 26 — сверху
 * строка панели (`CollapsingNavBar`), под ней в потоке страницы — крупный
 * заголовок. При прокрутке он уходит вверх, а в строке на 24–60 pt
 * проявляется компактный.
 *
 * Корневая вкладка (`frame` от TabPager): крупный заголовок стоит в самой
 * строке панели, слева вверху, и сжимается на месте (см. CollapsingNavBar).
 * Отдельной строки нет — в потоке остаётся только отступ под панель, и
 * содержимое начинается сразу под ней. На всех трёх вкладках заголовок в
 * одной точке: при перелистывании он не прыгает.
 */
export function LargeTitleHeader({
  title, onBack, actions = [], actionGroups, headerRef, bottomGap = 'var(--space-margin)', active = true, frame,
}: {
  /** false — экран припаркован: панель не слушает прокрутку. */
  active?: boolean;
  title: string;
  onBack?: () => void;
  actions?: HeaderAction[];
  /** Несколько стеклянных групп вместо одной (`actions` тогда не нужен). */
  actionGroups?: HeaderAction[][];
  /** Ref на панель — см. CollapsingNavBar. */
  headerRef?: React.MutableRefObject<HTMLElement | null>;
  /** Отступ под крупным заголовком до содержимого экрана. */
  bottomGap?: string;
  /**
   * Корневая вкладка: её прокрутка и слой шапки (TabPager). `null` — слой
   * ещё не готов (первый коммит); не задан — экран «поверх» на окне.
   */
  frame?: { scroller: HTMLElement; headerHost: HTMLElement } | null;
}) {
  if (frame !== undefined) {
    return (
      <>
        <CollapsingNavBar
          title={title}
          onBack={onBack}
          actionGroups={actionGroups ?? [actions]}
          active={active}
          headerRef={headerRef}
          scroller={frame ? frame.scroller : null}
          host={frame ? frame.headerHost : null}
          rootTitle
        />
        {/* Место панели в потоке: содержимое начинается сразу под строкой с
            заголовком. Есть и в первом кадре, когда самой панели ещё нет, —
            иначе содержимое подпрыгнуло бы. */}
        <div aria-hidden style={{ height: screenHeaderOffset(), marginBottom: 'var(--space-snug)' }} />
      </>
    );
  }
  return (
    <>
      <CollapsingNavBar title={title} onBack={onBack} actionGroups={actionGroups ?? [actions]} active={active} headerRef={headerRef} />
      <h1
        className="display-serif"
        style={{
          margin: 0,
          paddingTop: screenHeaderOffset(4),
          paddingBottom: bottomGap,
          // Кегль плавает между Title 1 и Large Title: на телефоне решает
          // 8vw, ступени шкалы держат границы. Межстрочный — доля от кегля:
          // фиксированная ступень не умеет следовать за clamp.
          fontSize: ROOT_TITLE_SIZE,
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
