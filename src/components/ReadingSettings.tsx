import { GLASS_BLUR } from '../lib/glass';
import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ALL_THEMES, THEME_LABELS, isLightTheme, type Theme } from '../hooks/useTheme';
import {
  AURORA_COLOURS, readAuroraPalette, writeAuroraPalette,
  type AuroraColourId, type AuroraVariant,
} from '../lib/cosmic';
import {
  LATIN_FONTS, ARABIC_FONTS, SCALE_OPTIONS, SCALE_FONT_PX,
  type LatinFontId, type ArabicFontId,
} from '../lib/typography';
import { RECITERS, type ReciterId } from '../lib/reciters';
import {
  getAutoScroll, setAutoScrollPref,
  getHighlightEnabled, setHighlightEnabled,
  getHighlightStyle, setHighlightStylePref, type HighlightStyle,
  getHighlightColor, setHighlightColorPref,
  HIGHLIGHT_COLORS, type HighlightColor,
  getGlowPalette, setGlowPalettePref, type GlowPalette,
  AURORA_PALETTES, GLOW_PALETTES_ORDER,
} from '../lib/audioPrefs';
// Раньше тут sync-импортился весь 10-МБ QURAN_SEGMENTS только ради
// проверки `!!QURAN_SEGMENTS[reciter]`.  Заменено на сет-константу
// в reciters.ts — тот же sync-чек, ноль bundle-overhead.
import { RECITERS_WITH_SEGMENTS, usesWholeAyahHighlight } from '../lib/reciters';
import { Microphone, Close, ICON_SIZE } from './icons';
import { OfflineAudioCard } from './OfflineAudioCard';
import { AudioSpinner } from './BottomDock';
import { INH_FONT_OPTIONS, INH_SOURCE_APP, INH_SOURCE_TITLE } from '../lib/inhTranslation';
import { suppressNativeTabBar } from '../lib/nativeTabBar';

const sectionTitle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 'var(--font-caption2)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.10em',
};

// ─── Shared bottom-sheet shell ────────────────────────────────────────────
//
// Both ThemeSettings and TypographySettings render inside the same
// bottom-anchored translucent sheet. Extracted here so the two
// menus stay visually identical and we only adjust the chrome in one
// place (border-radius, blur, drag-handle, close button, slide-in
// animation, edge-to-edge width on mobile).

type SheetPlacement = 'bottom-sheet' | 'top-popover';

/** Отступ нижней шторки от краёв экрана и её верхний радиус (см. ниже). */
const SHEET_INSET = 8;
const SHEET_RADIUS = 32;

/**
 * Узкий экран — телефон.  Граница 640 px: до неё «привязанная к кнопке
 * карточка» занимает почти весь экран и перестаёт быть карточкой.
 */
function useNarrowViewport(): boolean {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

export function SettingsSheet({
  onClose,
  children,
  title,
  placement = 'bottom-sheet',
  anchorEl,
}: {
  onClose: () => void;
  children: ReactNode;
  /** Заголовок панели.  Раньше попап открывался вовсе без подписи, и
   *  единственным способом его закрыть был тап по невидимой подложке
   *  или повторный тап по той же кнопке в шапке — этого никто не
   *  угадывает.  Теперь у панели есть строка «название + ✕». */
  title?: string;
  /** 'bottom-sheet' (default) — full-width pull-up on the bottom edge.
   *  'top-popover' — anchored top-right under the chrome, narrow card.
   *   Use top-popover when the trigger lives in the header (palette icon)
   *   so the menu reads as belonging to that button rather than as a
   *   modal overlay. */
  placement?: SheetPlacement;
  /** When provided (top-popover only), the sheet anchors directly under
   *  this element instead of the default top:60px right:12px slot.
   *  Required for the picker screen, where the trigger lives mid-page in
   *  the search row, not in a sticky header. Captured once on mount;
   *  scroll/resize updates re-read the rect so the popover stays glued. */
  anchorEl?: HTMLElement | null;
}) {
  // Both placements share the same React-state-driven entrance animation;
  // bottom-sheet additionally supports swipe-down dismissal.
  const [open, setOpen]         = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragY, setDragY]       = useState(0);
  const dragStartY              = useRef<number | null>(null);

  // На телефоне «привязанная к кнопке карточка» вырождается: панель
  // занимает почти весь экран, и закрыть её можно только крестиком или
  // тапом по узкой полоске подложки.  Системный «назад» тут не помогает
  // — WKWebView гасит edge-swipe, — поэтому на узком экране показываем
  // нижний шит: у него есть хваталка и привычный смах вниз.  На широком
  // карточка остаётся карточкой.
  const narrow = useNarrowViewport();
  const isBottom = placement === 'bottom-sheet' || narrow;

  useEffect(() => {
    // rAF so the first paint commits the offscreen position before we
    // flip to `open`, otherwise React batches and the slide animation
    // never plays.
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Системный «назад» (edge-swipe на iOS, аппаратная кнопка на Android)
  // должен закрывать панель, а не уводить с экрана.  Кладём в историю
  // фиктивную запись и снимаем её при закрытии — так жест «назад»
  // тратится на попап, как и ожидает человек.
  //
  // Флаг closedByPop нужен, чтобы не вызвать history.back() второй раз
  // уже после того, как запись сняли самим жестом: иначе закрытие
  // попапа заодно уводило бы на предыдущий экран.
  const closedByPop = useRef(false);
  useEffect(() => {
    history.pushState({ sheet: true }, '');
    const onPop = () => { closedByPop.current = true; onClose(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByPop.current && history.state?.sheet) history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Системная панель вкладок iOS 26 лежит над веб-вью и закрыла бы низ
  // шторки — на время шторки она уходит (lib/nativeTabBar.ts).
  useEffect(() => suppressNativeTabBar(), []);

  // Esc — для десктопа и внешней клавиатуры.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Скорость последнего движения — чтобы короткий резкий смах закрывал
  // панель так же, как медленное протягивание на треть экрана.  Без
  // этого быстрый флик «не считается», и жест ощущается тугим.
  const lastMove = useRef<{ y: number; t: number } | null>(null);
  const velocity = useRef(0);

  const sheetRef = useRef<HTMLDivElement>(null);
  // dragY нужен и в обработчике конца жеста, и в нативном touchmove —
  // держим копию в ref, чтобы не пересоздавать слушатель на каждый кадр.
  const dragYRef = useRef(0);

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isBottom) return;
    if (e.currentTarget.scrollTop > 0) return;
    const y = e.touches[0].clientY;
    dragStartY.current = y;
    lastMove.current = { y, t: e.timeStamp };
    velocity.current = 0;
    setDragging(true);
  };

  /**
   * touchmove вешаем вручную с `passive: false`.
   *
   * Почему не onTouchMove у React: React подписывается пассивно, а
   * панель — сама скролл-контейнер.  WebKit, увидев вертикальный жест,
   * решает, что это прокрутка (точнее — оверскролл, ведь мы уже
   * наверху), забирает касание себе и присылает touchcancel.  Смах
   * вниз просто не срабатывал: тапы внутри панели проходили, а
   * перетаскивание — нет.  Проверено на симуляторе.
   *
   * preventDefault на движении вниз оставляет жест нам.  Вверх не
   * перехватываем — там начинается обычная прокрутка содержимого.
   */
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !isBottom) return;

    const onMove = (e: TouchEvent) => {
      if (dragStartY.current == null) return;
      const y = e.touches[0].clientY;
      const dy = y - dragStartY.current;

      if (dy <= 0) {
        // Палец пошёл вверх — отдаём жест прокрутке и забываем drag.
        if (dragYRef.current === 0) {
          dragStartY.current = null;
          setDragging(false);
        }
        return;
      }
      if (e.cancelable) e.preventDefault();

      const prev = lastMove.current;
      if (prev) {
        const dt = e.timeStamp - prev.t;
        if (dt > 0) velocity.current = (y - prev.y) / dt;   // px/ms, вниз > 0
      }
      lastMove.current = { y, t: e.timeStamp };
      dragYRef.current = dy;
      setDragY(dy);
    };

    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, [isBottom]);

  /**
   * Проглотить один клик после перетаскивания.
   *
   * WebKit после touchend с preventDefault всё равно синтезирует клик по
   * элементу под пальцем.  Поймано на симуляторе: смах вниз закрывал
   * панель и заодно переключал тему на ту карточку, над которой палец
   * оторвался.  Жест не должен ничего нажимать.
   *
   * Слушатель на фазе перехвата и одноразовый; таймер снимает его, если
   * клика так и не пришло (палец оторвали вне интерактивного элемента).
   */
  const swallowNextClick = () => {
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.clearTimeout(timer);
    };
    const timer = window.setTimeout(() => {
      document.removeEventListener('click', swallow, true);
    }, 400);
    document.addEventListener('click', swallow, { capture: true, once: true });
  };

  const onTouchEnd = () => {
    if (!isBottom || dragStartY.current == null) return;
    const dy = dragYRef.current;
    if (dy > 6) swallowNextClick();
    if (dy > 100 || (velocity.current > 0.5 && dy > 12)) {
      onClose();
    } else {
      setDragY(0);
    }
    dragYRef.current = 0;
    dragStartY.current = null;
    lastMove.current = null;
    setDragging(false);
  };

  // Track the anchor's viewport rect so the popover follows when the
  // user scrolls or rotates the device. We refresh on scroll/resize
  // rather than reading once on mount because mid-scroll close is fine
  // but a popover frozen 200px above its origin button is not.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(() =>
    anchorEl ? anchorEl.getBoundingClientRect() : null,
  );
  useEffect(() => {
    if (!anchorEl) return;
    let frame: number | null = null;
    // Раньше setAnchorRect звался на КАЖДОЕ событие прокрутки, а новый
    // DOMRect никогда не равен предыдущему по ссылке — React перерисовывал
    // всю панель настроек десятки раз в секунду. Якорь при этом обычно
    // живёт в фиксированной шапке и вовсе не двигается. Теперь: одно
    // измерение на кадр и запись в state только при реальном сдвиге.
    const measure = () => {
      frame = null;
      const next = anchorEl.getBoundingClientRect();
      setAnchorRect(prev => (
        prev
        && prev.top === next.top
        && prev.left === next.left
        && prev.width === next.width
        && prev.height === next.height
      ) ? prev : next);
    };
    const update = () => {
      if (frame == null) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', update);
    };
  }, [anchorEl]);

  // Per-placement positioning. Bottom-sheet centres horizontally and
  // slides up from below. Top-popover sits under its anchor (or under
  // the sticky-header right slot when no anchor was passed) and slides
  // down from above.
  const positionStyles: React.CSSProperties = isBottom
    ? {
        // Шторка iOS 26 на частичной высоте (владелец 2026-10-04, стиль
        // xtrud; docs/IOS26_DESIGN_GUIDE.md § 3): не прилипает к краям, а
        // висит над ними стеклянной карточкой, и нижние углы повторяют
        // скругление экрана. Числа Apple не публикует — отступ 8 и верхний
        // радиус 32 подобраны на глаз по системным шторкам.
        left: '50%',
        bottom: `${SHEET_INSET}px`,
        // Закрытая — уезжает целиком, вместе с отступом и тенью: сдвиг на
        // 100 % своей высоты оставил бы над краем полоску в 8 px.
        transform: `translate(-50%, ${!open ? `calc(100% + ${SHEET_INSET + 32}px)` : `${dragY}px`})`,
        width: `min(480px, calc(100vw - ${SHEET_INSET * 2}px))`,
        // 86dvh, а не 70vh: в панели чтения живут чтец, офлайн-загрузки
        // и шрифты — на 70 % экрана из них видно полтора блока, и панель
        // читается как «обрезанная».  dvh, чтобы адресная строка и
        // системные панели не отрезали низ.
        maxHeight: `calc(86dvh - ${SHEET_INSET}px)`,
        border: '1px solid var(--hairline)',
        // Нижние углы концентричны углам экрана. Радиус экрана из веба не
        // узнать; у iPhone с домашней полосой (зона 34) он около 47–62, без
        // полосы углы почти прямые — поэтому считаем от безопасной зоны.
        borderRadius: `${SHEET_RADIUS}px ${SHEET_RADIUS}px `
          + `max(${SHEET_RADIUS}px, calc(env(safe-area-inset-bottom) + 12px)) `
          + `max(${SHEET_RADIUS}px, calc(env(safe-area-inset-bottom) + 12px))`,
        padding: `8px 16px max(12px, calc(env(safe-area-inset-bottom) - ${SHEET_INSET}px)) 16px`,
        boxShadow: 'rgba(0,0,0,0.08) 0 2px 12px, rgba(0,0,0,0.18) 0 16px 48px',
      }
    : anchorRect
    ? (() => {
        // Anchored directly under the trigger element. 8 px gap.
        //
        // Strategy: centre the panel horizontally on the screen,
        // opening just below the trigger button. Screen-centred is
        // more predictable than button-centred (buttons sit at various
        // x-positions in the header pill depending on content).
        const panelWidth = Math.min(380, window.innerWidth - 24);
        const left       = Math.round((window.innerWidth - panelWidth) / 2);
        return {
          top: `${anchorRect.bottom + 8}px`,
          left: `${left}px`,
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(-8px)',
          width: `${panelWidth}px`,
          maxHeight: `calc(100dvh - ${anchorRect.bottom + 24}px)`,
          border: '1px solid var(--hairline)',
          borderRadius: '16px',
          padding: '14px',
          boxShadow: 'rgba(0,0,0,0.06) 0 2px 8px, rgba(0,0,0,0.16) 0 16px 40px',
        };
      })()
    : {
        // Fallback: top-right slot under a presumed sticky header.
        top: '60px',
        right: '12px',
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0)' : 'translateY(-8px)',
        width: 'min(380px, calc(100vw - 24px))',
        maxHeight: 'calc(100dvh - 80px)',
        border: '1px solid var(--hairline)',
        borderRadius: '16px',
        padding: '14px',
        boxShadow: 'rgba(0,0,0,0.06) 0 2px 8px, rgba(0,0,0,0.16) 0 16px 40px',
      };

  // Render through a portal mounted on document.body. Critical because
  // the parent of <SurahPicker> in App.tsx wraps the picker/azkar pair
  // in a `transform: translateX(...)` slide container — and CSS spec
  // says any ancestor with a non-`none` transform becomes the
  // containing block for `position: fixed` descendants. Without the
  // portal the sheet's `top:60px right:12px` anchors to the 200%-wide
  // slide container instead of the viewport, landing entirely off-
  // screen to the right. The portal escapes that ancestry so fixed
  // positioning resolves against the viewport as expected.
  return createPortal(
    <>
      {/* Подложка.  Раньше была полностью прозрачной — «чтобы видеть
          изменения на живом тексте».  Идея верная, но невидимая
          подложка не подсказывает, что тап мимо панели её закроет, и
          вообще не отделяет панель от страницы.  Компромисс: едва
          заметное затемнение — текст под ней по-прежнему читается и
          смена шрифта видна, но панель теперь явно «поверх». */}
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 39,
          background: 'rgba(0,0,0,0.18)',
          // Пока шит тянут вниз, подложка светлеет: движение пальца
          // сразу видно на всём экране, и понятно, что жест «сработает».
          opacity: open ? Math.max(0, 1 - dragY / 240) : 0,
          transition: dragging ? 'none' : 'opacity 200ms ease',
        }}
      />

      <div
        ref={sheetRef}
        data-reading-sheet=""
        className="liquid-glass"
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          position: 'fixed',
          zIndex: 40,
          // Материал, грань, блик и тени приходят классом `.liquid-glass`;
          // размытие — инлайном оттуда же, где и у остальных панелей: из CSS
          // его съедает минификатор (см. `src/lib/glass.ts`).
          ...GLASS_BLUR,
          overflowY: 'auto',
          touchAction: 'pan-y',
          transition: dragging
            ? 'none'
            : 'transform 240ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease',
          ...positionStyles,
        }}
      >
        {/* Хваталка.  Без неё смах вниз — тайное знание: человек видит
            панель, но не видит, что её можно стянуть.  Полоска и есть
            подсказка, поэтому она рисуется только там, где жест
            работает. */}
        {isBottom && (
          <div
            aria-hidden
            style={{
              display: 'flex', justifyContent: 'center',
              padding: '2px 0 10px',
            }}
          >
            <span style={{
              width: '38px', height: '5px', borderRadius: '3px',
              background: 'var(--hairline-strong, var(--hairline))',
              opacity: dragging ? 1 : 0.75,
              transition: 'opacity 140ms ease',
            }} />
          </div>
        )}

        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            marginBottom: '12px',
          }}>
            <span style={{
              flex: 1, minWidth: 0,
              fontSize: isBottom ? '17px' : '13px',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--text-primary)',
              letterSpacing: isBottom ? '-0.01em' : '0.005em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {title}
            </span>
            <SheetCloseButton onClose={onClose} />
          </div>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}

/**
 * Кнопка закрытия панели.
 *
 * Была квадратом 32×32 без фона — почти невидимая и мимо неё легко
 * промахнуться.  Apple просит минимум 44×44 pt на касание, и это не
 * придирка: палец накрывает пятно около 9 мм, а 32 px — это 8.5 мм,
 * то есть попадание «впритык» даже когда целишься.
 *
 * Разведены зона нажатия и вид: кликается весь квадрат 44×44, а рисуется
 * круг 34×34 с мягкой подложкой — так кнопка читается как кнопка, но не
 * перетягивает внимание с заголовка.  Круг, а не скруглённый квадрат:
 * это стандартная форма закрытия в системных панелях iOS, глаз узнаёт
 * её без чтения.
 */
export function SheetCloseButton({ onClose }: { onClose: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClose}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      aria-label="Закрыть"
      title="Закрыть"
      style={{
        // Зона нажатия — вся кнопка; отрицательный правый отступ
        // возвращает круг на оптическую границу панели, чтобы
        // увеличенная зона не сдвинула его внутрь.
        width: '44px', height: '44px', flexShrink: 0,
        marginRight: '-6px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', background: 'transparent', padding: 0,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '34px', height: '34px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '9999px',
          background: pressed
            ? 'rgb(var(--ink-rgb) / 0.16)'
            : 'rgb(var(--ink-rgb) / 0.08)',
          color: pressed ? 'var(--text-primary)' : 'var(--text-secondary)',
          transform: pressed ? 'scale(0.92)' : 'scale(1)',
          transition: 'background 140ms ease, transform 140ms ease, color 140ms ease',
        }}
      >
        <Close size={ICON_SIZE.md} />
      </span>
    </button>
  );
}

// ─── ThemeSettings — palette button (⊙) ───────────────────────────────────
//
// Выбор одной из трёх тем + настройка подсветки читаемого слова.
// В прежнем QuranIng здесь дополнительно жили панели «бумажные паттерны» для
// светлых тем и «атмосфера» для космических; вместе с самими темами
// они сняты — тема теперь не конструктор, а готовый вид.

type ThemeProps = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onClose: () => void;
  /** Trigger button element — popover anchors directly under it.
   *  Required on screens where the trigger isn't in a sticky-header
   *  top-right slot (e.g. SurahPicker has the palette button mid-page
   *  in the search row). */
  anchorEl?: HTMLElement | null;
  /** Current reciter — needed by HighlightCard to gate the highlight
   *  controls behind reciters that ship word-level timing segments.
   *  Optional so callers that don't have an audio context (e.g. the
   *  picker's palette button) can omit it; HighlightCard is hidden in
   *  that case. */
  reciter?: ReciterId;
};

export function ThemeSettings(p: ThemeProps) {
  return (
    <SettingsSheet onClose={p.onClose} title="Оформление" placement="top-popover" anchorEl={p.anchorEl}>
      <div style={{ display: 'grid', gap: '10px' }}>
        {/* Шрифт страницы переехал в поповер «Чтение» под кнопкой «Аа»:
            там же теперь и выбор чтеца, а здесь остался только вид. */}
        <ThemePicker theme={p.theme} setTheme={p.setTheme} />
        {/* Цвет сияния есть только у «Авроры 2». */}
        {p.theme === 'aurora2' && (
          <AuroraColourCard variant={p.theme} />
        )}
        {p.reciter && <HighlightCard reciter={p.reciter} />}
      </div>
    </SettingsSheet>
  );
}

/**
 * ReciterCard — выбор чтеца.
 *
 * Отдельный компонент, потому что тот же выбор нужен и листу «Чтение»
 * экрана суры, и полному плееру (PlayerScreen): держать две копии одной
 * сетки — верный способ однажды добавить чтеца в одном месте и забыть про
 * другое.
 */
export function ReciterCard({ reciter, onPick }: {
  reciter: ReciterId;
  onPick: (id: ReciterId) => void;
}) {
  return (
    <section style={settingCard}>
      <p style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Microphone size={ICON_SIZE.sm} />
        Чтец
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {RECITERS.map(r => {
          const active = reciter === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onPick(r.id)}
              aria-pressed={active}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minHeight: '38px',
                padding: '8px 10px',
                borderRadius: '10px',
                border: `1px solid ${active ? 'var(--text-primary)' : 'var(--hairline)'}`,
                background: active
                  ? 'rgb(var(--ink-rgb) / 0.08)'
                  : 'rgb(var(--ink-rgb) / 0.03)',
                boxShadow: active ? 'inset 0 0 0 1px var(--text-primary)' : 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                overflow: 'hidden',
                fontSize: 'var(--font-caption1)',
                fontWeight: 'var(--weight-regular)',
                letterSpacing: '0.005em',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                transition: 'box-shadow 140ms ease, background 140ms ease',
              }}
            >
              {/* 🔴 Имя переносится на вторую строку, а не обрезается.
                  «Мухаммад Аль-Люхайдан» требует 180 px, а плитка в две
                  колонки даёт 158: при `nowrap` хвост имени просто срезало
                  краем, причём без многоточия — `text-overflow` не работает
                  на прямом потомке flex-контейнера. Имя чтеца обрезать
                  нельзя: по нему его и выбирают.

                  Обе плитки в ряду тянутся до одной высоты сами: у грид-строк
                  выравнивание stretch по умолчанию. */}
              <span style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: 1.2,
              }}>
                {r.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Цвет сияния «Авроры».
 *
 * Кружки, а не подписи: цвет выбирают глазами.  Подпись всё равно есть —
 * в `aria-label` и `title`, чтобы работали и скринридер, и наведение.
 *
 * Изменение применяется сразу: CosmicLayer слушает событие и
 * перерисовывает сияние, не дожидаясь закрытия попапа, — иначе цвет
 * приходилось бы выбирать вслепую.
 */
function AuroraColourCard({ variant }: { variant: AuroraVariant }) {
  const [current, setCurrent] = useState(() => readAuroraPalette(variant));
  useEffect(() => setCurrent(readAuroraPalette(variant)), [variant]);

  const pick = (id: AuroraColourId) => {
    writeAuroraPalette(variant, id);
    setCurrent(id);
  };

  return (
    <section style={settingCard}>
      <p style={cardTitle}>Цвет сияния</p>
      <div style={{
        display: 'flex', gap: '10px', flexWrap: 'wrap',
        paddingTop: '2px',
      }}>
        {AURORA_COLOURS.map(({ id, spec, swatch }) => {
          const on = id === current;
          return (
            <button
              key={id}
              onClick={() => pick(id)}
              aria-label={spec.label}
              aria-pressed={on}
              title={spec.label}
              style={{
                width: '40px', height: '40px', borderRadius: '9999px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: `2px solid ${on ? 'var(--text-primary)' : 'transparent'}`,
                background: 'transparent',
                cursor: 'pointer', padding: 0, flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: '26px', height: '26px', borderRadius: '9999px',
                  // Свечение вокруг кружка — чтобы образец показывал не
                  // просто цвет, а то, как он светит.
                  background: swatch,
                  boxShadow: `0 0 12px ${swatch}`,
                }}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Превью темы на карточке.
 *
 * Карточка не подписана цветом, а показывает уменьшённую сцену: канва
 * темы, строка «текста» её цветом чернил и характерный фон.
 * Пользователь выбирает глазами,
 * а не читает ярлык.
 *
 * В прежнем QuranIng тут был грид из одиннадцати пресетов на четыре ряда с
 * отдельной функцией-диорамой на каждый; теперь тем три, и превью
 * описывается одной таблицей.
 */
const THEME_PREVIEW: Record<Theme,
  { canvas: string; ink: string; glow?: string; glowSize?: string }> = {
  light:  { canvas: '#ffffff', ink: '#111111' },
  dark:   { canvas: '#000000', ink: '#ececec' },
  aurora: {
    canvas: '#f7f4ec',
    ink: '#1f1b17',
    glow: 'radial-gradient(circle, rgba(116,106,92,0.20) 1.15px, transparent 1.4px)',
    glowSize: '20px 20px',
  },
  cosmos: {
    canvas: '#000000',
    ink: '#f4f4f5',
    // Звёзды разной величины: на карточке 96×64 движение не показать, а
    // «россыпь на чёрном» отличает эту тему от «Тёмной» и от «Авроры 2»
    // с одного взгляда.
    glow:
      'radial-gradient(circle, rgba(255,255,255,0.90) 1.1px, transparent 1.4px),'
      + ' radial-gradient(circle, rgba(255,255,255,0.55) 0.7px, transparent 1.0px),'
      + ' radial-gradient(circle, rgba(190,215,255,0.70) 0.9px, transparent 1.2px)',
    glowSize: '37px 29px, 19px 23px, 53px 41px',
  },
  aurora2: {
    canvas: '#000000',
    ink: '#f4f4f5',
    // Занавес снизу вверх, а не сияние сверху: превью должно показывать
    // именно то, чем эта тема отличается от первой «Авроры».  Два луча
    // разной высоты плюс общий подъём — на карточке 96×64 больше не
    // помещается, а суть передаётся.
    glow:
      'radial-gradient(ellipse 30% 95% at 32% 100%, rgba(90,210,150,0.50) 0%, transparent 68%),' +
      ' radial-gradient(ellipse 26% 75% at 70% 100%, rgba(150,225,175,0.42) 0%, transparent 68%),' +
      ' linear-gradient(to top, rgba(90,210,150,0.34) 0%, rgba(90,210,150,0.10) 40%, transparent 92%)',
  },
};

function ThemePicker({ theme, setTheme }: {
  theme: Theme;
  setTheme: (t: Theme) => void;
}) {
  return (
    <section>
      <p style={sectionTitle}>Оформление</p>
      {/* Две колонки, а не пять в ряд: на 380-px попапе колонка
          шириной 70 px превращает превью в марку, и отличить белую
          бумагу от белой с фактурой становится невозможно.  Пятая
          тема просто уходит на третий ряд в одиночку — это честнее,
          чем ужимать все ради симметрии. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px',
      }}>
        {ALL_THEMES.map(id => {
          const preview = THEME_PREVIEW[id];
          const active = theme === id;
          return (
            <button
              key={id}
              onClick={() => setTheme(id)}
              aria-pressed={active}
              aria-label={THEME_LABELS[id]}
              style={{
                display: 'grid',
                gap: '6px',
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {/* Сцена-превью */}
              <span
                aria-hidden
                style={{
                  position: 'relative',
                  display: 'block',
                  height: '64px',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  background: preview.canvas,
                  // Активная карточка обводится чернилами темы попапа, а
                  // не темы превью — иначе на белой карточке в тёмном
                  // интерфейсе обводка исчезает.
                  boxShadow: active
                    ? 'inset 0 0 0 2px var(--text-primary), 0 0 0 3px rgb(var(--ink-rgb) / 0.12)'
                    : 'inset 0 0 0 1px var(--hairline-strong)',
                  transition: 'box-shadow 140ms ease',
                }}
              >
                {preview.glow && (
                  <span style={{
                    position: 'absolute', inset: 0,
                    background: preview.glow,
                    backgroundSize: preview.glowSize,
                    backgroundPosition: 'center',
                  }} />
                )}
                {/* Три «строки текста» — дают почувствовать контраст
                    чернил на канве ещё до применения темы. */}
                <span style={{
                  position: 'absolute',
                  left: '10px', right: '10px', bottom: '12px',
                  display: 'grid', gap: '4px',
                }}>
                  {[100, 84, 62].map(w => (
                    <span key={w} style={{
                      display: 'block',
                      height: '3px',
                      width: `${w}%`,
                      borderRadius: '2px',
                      background: preview.ink,
                      opacity: w === 100 ? 0.85 : 0.45,
                    }} />
                  ))}
                </span>
              </span>

              <span style={{
                fontSize: 'var(--font-caption2)',
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                letterSpacing: '0.005em',
                lineHeight: 1,
              }}>
                {THEME_LABELS[id]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}


// ─── TypographySettings — `[A]` button ────────────────────────────────────
//
// Reciter picker + per-language tabs (Arabic / Ingush / Russian) with
// visibility toggle, scale and font.  Each translation has its own
// settings — they are read side by side and tuned separately.

type TypographyProps = {
  reciter: ReciterId;
  setReciter: (v: ReciterId) => void;
  /** Открыто с экрана суры — тогда в секции «Офлайн» первой строкой
   *  идёт именно она.  На других экранах не передаётся. */
  surahNumber?: number;

  showArabic: boolean;
  setShowArabic: (v: boolean) => void;
  showRu: boolean;
  setShowRu: (v: boolean) => void;

  arabicScale: number;
  setArabicScale: (v: number) => void;
  ruScale: number;
  setRuScale: (v: number) => void;

  ruFont: LatinFontId;
  setRuFont: (v: LatinFontId) => void;

  showInh: boolean;
  setShowInh: (v: boolean) => void;
  inhScale: number;
  setInhScale: (v: number) => void;
  inhFont: LatinFontId;
  setInhFont: (v: LatinFontId) => void;

  arabicFont: ArabicFontId;
  setArabicFont: (v: ArabicFontId) => void;
  tajweedStatus?: 'idle' | 'loading' | 'ready' | 'failed';
  onClose: () => void;
  /** Trigger button element — popover anchors directly under it. */
  anchorEl?: HTMLElement | null;
};

type LangTab = 'arabic' | 'ingush' | 'russian';

const KEY_LANG_TAB = 'typography.langTab';
function readLangTab(): LangTab {
  const v = localStorage.getItem(KEY_LANG_TAB);
  return v === 'arabic' || v === 'ingush' || v === 'russian' ? v : 'arabic';
}
function writeLangTab(v: LangTab) {
  localStorage.setItem(KEY_LANG_TAB, v);
}

export function TypographySettings(p: TypographyProps) {
  // Вкладка языка внутри блока «Текст и шрифты».
  // См. readLangTab() — почему выбор запоминается.
  const [tab, setTabS] = useState<LangTab>(readLangTab);
  const setTab = (v: LangTab) => { setTabS(v); writeLangTab(v); };

  return (
    // Same top-popover treatment as ThemeSettings — anchored under the
    // [A] button in the header. Keeps the menu visually paired with its
    // trigger and leaves the lower portion of the surah uncovered for
    // live preview of font / size changes.
    //
    // В прежнем QuranIng попап был разбит на две внешние вкладки «Текст / Чтец»,
    // потому что восемь чтецов в сетке 2×4 не помещались рядом с
    // типографикой на 4.7" экране.  Чтецов теперь два — они занимают
    // одну строку, и весь попап снова читается одним куском без
    // переключения вкладок.
    <SettingsSheet onClose={p.onClose} title="Чтение" placement="top-popover" anchorEl={p.anchorEl}>
      <ReciterCard reciter={p.reciter} onPick={p.setReciter} />

      {/* ── Офлайн-загрузка ────────────────────────────────────────── */}
      <OfflineAudioCard reciter={p.reciter} surahNumber={p.surahNumber} />

      {/* ── Текст и шрифты ─────────────────────────────────────────── */}
      <section style={{ ...settingCard, marginTop: '10px' }}>
        <p style={cardTitle}>Текст и шрифты</p>

        {/* Вкладки языка */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px',
          background: 'var(--bg)', border: '1px solid var(--hairline)',
          borderRadius: '10px', padding: '3px',
          marginBottom: '14px',
        }}>
          {([
            { id: 'arabic',  label: 'Арабский' },
            { id: 'ingush',  label: 'Ингушский' },
            { id: 'russian', label: 'Русский'  },

          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                minHeight: '36px',
                padding: '9px 0', borderRadius: '7px',
                border: 'none',
                background: tab === t.id
                  ? 'linear-gradient(rgb(var(--ink-rgb) / 0.08), rgb(var(--ink-rgb) / 0.08)), var(--surface)'
                  : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'var(--font-footnote)',
                fontWeight: tab === t.id ? 600 : 500,
                boxShadow: tab === t.id
                  ? 'inset 0 0 0 1.5px var(--text-primary), 0 0 0 3px rgb(var(--ink-rgb) / 0.1)'
                  : 'none',
                transition: 'box-shadow 140ms ease, background 140ms ease',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Тело активного языка */}
        {tab === 'arabic' && (
          <LangBody
            visible={p.showArabic}
            onToggleVisible={() => p.setShowArabic(!p.showArabic)}
            scale={p.arabicScale}
            onScale={p.setArabicScale}
            font={p.arabicFont}
            onFont={p.setArabicFont}
            fontStatus={p.arabicFont === 'qpc-v4-tajweed' ? p.tajweedStatus : undefined}
            options={ARABIC_FONTS}
            preview="بسم الله"
            dir="rtl"
          />
        )}
        {tab === 'ingush' && (
          <>
            <LangBody
              visible={p.showInh}
              onToggleVisible={() => p.setShowInh(!p.showInh)}
              scale={p.inhScale}
              onScale={p.setInhScale}
              font={p.inhFont}
              onFont={p.setInhFont}
              options={INH_FONT_OPTIONS}
              preview="ГӀалгӀай"
            />
            {/* Источник перевода — подписью, как его называет сам автор.
                Атрибуция обязательна для любого перевода смыслов. */}
            <p style={{
              margin: '12px 0 0',
              fontSize: 'var(--font-caption2)',
              lineHeight: 1.4,
              color: 'var(--text-tertiary)',
            }}>
              {INH_SOURCE_TITLE}
              <br />
              Источник: приложение {INH_SOURCE_APP}
            </p>
          </>
        )}
        {tab === 'russian' && (
          <LangBody
            visible={p.showRu}
            onToggleVisible={() => p.setShowRu(!p.showRu)}
            scale={p.ruScale}
            onScale={p.setRuScale}
            font={p.ruFont}
            onFont={p.setRuFont}
            options={LATIN_FONTS}
            preview="Благословен"
          />
        )}
      </section>

      {/* Автопрокрутка — глобальная настройка воспроизведения: лента
          сама доезжает до звучащего аята.  Стоит последней строкой,
          отдельно от карточек. */}
      <div style={{ marginTop: '10px' }}>
        <AutoScrollToggleRow />
      </div>

    </SettingsSheet>
  );
}

/** Mirror the live data-theme attribute on :root into React state so
 *  components inside the settings sheet can react to theme changes
 *  without prop-drilling. Updates synchronously on each attribute
 *  mutation via MutationObserver. */
function useRootDataTheme(): string {
  const [t, setT] = useState<string>(() =>
    document.documentElement.getAttribute('data-theme') ?? '',
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const next = document.documentElement.getAttribute('data-theme') ?? '';
      setT(prev => (prev === next ? prev : next));
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => obs.disconnect();
  }, []);
  return t;
}

function HighlightCard({ reciter }: { reciter: ReciterId }) {
  const [on, setOnS]       = useState<boolean>(getHighlightEnabled);
  const [style, setStyleS] = useState<HighlightStyle>(getHighlightStyle);
  const [color, setColorS] = useState<HighlightColor>(getHighlightColor);
  const [glow,  setGlowS]  = useState<GlowPalette>(getGlowPalette);
  // Live theme — when it flips between light/dark/cosmic we re-render
  // and either show or hide the style tabs. On the light theme glow is
  // force-resolved to color by audioPrefs anyway, so showing a
  // "Свечение" tab there would be a dead choice.
  const themeAttr = useRootDataTheme();
  // Светлых тем две — «Светлая» и «Мусхаф».  Сравнение с одной строкой
  // тут уже приводило к багу: на «Мусхафе» показывались вкладки
  // «Цвет / Свечение», хотя свечение на бумаге сводится к 'color'
  // в audioPrefs и выбор был мёртвым.
  const isLight = isLightTheme(themeAttr as Theme);

  const onToggle = () => {
    const next = !on;
    setOnS(next);
    setHighlightEnabled(next);
  };

  // Some reciters (Maher Al-Muaiqly) aren't on quran.com so we have no
  // word-level segments for them — show a notice instead of dead
  // controls. Detection is just "is the reciter bucket present in the
  // generated segments map?"
  const hasSegments = RECITERS_WITH_SEGMENTS.has(reciter);
  if (!hasSegments) {
    if (usesWholeAyahHighlight(reciter)) {
      return (
        <section style={{
          paddingTop: '10px',
          borderTop: '1px solid var(--hairline)',
        }}>
          <div
            onClick={onToggle}
            role="button"
            aria-label="Подсветка читаемого аята"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span style={{
              fontSize: 'var(--font-caption2)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}>
              Подсветка аята
            </span>
            <Switch on={on} />
          </div>
          <p style={{
            margin: '8px 0 0',
            fontSize: 'var(--font-caption1)',
            fontWeight: 'var(--weight-regular)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
            У этого чтеца нет пословных таймингов, поэтому читаемый аят
            аккуратно подсвечивается целиком.
          </p>
        </section>
      );
    }
    return (
      <section style={settingCard}>
        <p style={{
          margin: 0,
          fontSize: 'var(--font-caption1)',
          fontWeight: 'var(--weight-regular)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          У этого чтеца подсветка слов недоступна — quran.com не отдаёт
          тайминги для него. Выбери другого чтеца, чтобы включить подсветку.
        </p>
      </section>
    );
  }

  const onPickColor = (c: HighlightColor) => {
    setColorS(c);
    setHighlightColorPref(c);
  };
  const onPickGlow = (p: GlowPalette) => {
    setGlowS(p);
    setGlowPalettePref(p);
  };
  const onPickStyle = (s: HighlightStyle) => {
    setStyleS(s);
    setHighlightStylePref(s);
  };
  return (
    // Секция-«футер»: никакого card-chrome (border / fill / большой
    // padding) — темы остаются основной площадью, подсветка
    // второстепенный регулятор.  Только hairline-разделитель сверху
    // для визуальной отбивки от грида пресетов.
    <section style={{
      paddingTop: '10px',
      borderTop: '1px solid var(--hairline)',
    }}>
      <div
        onClick={onToggle}
        role="button"
        aria-label="Подсветка читаемого слова"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          cursor: 'pointer',
          userSelect: 'none',
          marginBottom: on ? '8px' : 0,
        }}
      >
        {/* Uppercase eyebrow-label — даёт понять что это вспомогательная
            секция, не пункт первого уровня. */}
        <span style={{
          fontSize: 'var(--font-caption2)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          Подсветка слова
        </span>
        <Switch on={on} />
      </div>

      {on && (
        <>
          {/* Style tabs — only shown on dark/cosmic themes where both
              modes make visual sense. On light themes the glow effect
              is force-resolved to color (see audioPrefs.applyHighlightVars),
              so we hide the picker entirely and just show the colour
              swatches — same surface area as before the glow feature
              landed. */}
          {!isLight && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px',
              background: 'var(--bg)', border: '1px solid var(--hairline)',
              borderRadius: '10px', padding: '3px',
              marginBottom: '12px',
            }}>
              {([
                { id: 'color', label: 'Цвет'     },
                { id: 'glow',  label: 'Свечение' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => onPickStyle(t.id)}
                  style={{
                    minHeight: '32px',
                    padding: '7px 0', borderRadius: '7px',
                    border: 'none',
                    background: style === t.id
                      ? 'linear-gradient(rgb(var(--ink-rgb) / 0.08), rgb(var(--ink-rgb) / 0.08)), var(--surface)'
                      : 'transparent',
                    color: style === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 'var(--font-caption1)',
                    fontWeight: style === t.id ? 600 : 500,
                    boxShadow: style === t.id
                      ? 'inset 0 0 0 1.5px var(--text-primary), 0 0 0 3px rgb(var(--ink-rgb) / 0.1)'
                      : 'none',
                    transition: 'box-shadow 140ms ease, background 140ms ease',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {(isLight || style === 'color') && (
            // 6 colour swatches — same compact row as before.
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${HIGHLIGHT_COLORS.length}, 1fr)`,
              gap: '6px',
            }}>
              {HIGHLIGHT_COLORS.map(c => {
                const active = color === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => onPickColor(c.id)}
                    aria-label={c.label}
                    title={c.label}
                    style={{
                      minHeight: '24px',
                      height: '24px',
                      border: `1px solid ${active ? 'var(--text-primary)' : 'rgba(0,0,0,0.18)'}`,
                      background: c.swatch,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      padding: 0,
                      boxShadow: active
                        ? 'inset 0 0 0 2px var(--text-primary)'
                        : 'none',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  />
                );
              })}
            </div>
          )}

          {!isLight && style === 'glow' && (
            // 6 glow-palette swatches. Each chip is taller (32px) than
            // the colour swatches so the radial-gradient inside can
            // breathe — a 24px flat-paint square is enough for a hue,
            // but a glow halo needs a bit more canvas to read as one.
            // The chip preview is the palette's own ayahGlow gradient
            // on a dark backdrop so the user sees the actual visual,
            // not just the swatch hex. Hidden on light themes where
            // glow is force-resolved away — see the !isLight tab gate.
            <div style={{
              display: 'grid',
              // От длины списка, а не жёстко шесть: после снятия золота
              // палитр стало пять, и фиксированная шестая колонка оставляла
              // справа пустоту.
              gridTemplateColumns: `repeat(${GLOW_PALETTES_ORDER.length}, 1fr)`,
              gap: '6px',
            }}>
              {GLOW_PALETTES_ORDER.map(id => {
                const pal = AURORA_PALETTES[id];
                const active = glow === id;
                return (
                  <button
                    key={id}
                    onClick={() => onPickGlow(id)}
                    aria-label={pal.label}
                    title={pal.label}
                    style={{
                      minHeight: '32px',
                      height: '32px',
                      border: `1px solid ${active ? 'var(--text-primary)' : 'rgba(0,0,0,0.18)'}`,
                      // Dark backdrop with the palette's own
                      // radial-gradient layered on top — closest
                      // miniature of how the glow reads at runtime.
                      background: `${pal.ayahGlow}, #14141c`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      padding: 0,
                      boxShadow: active
                        ? 'inset 0 0 0 2px var(--text-primary)'
                        : 'none',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AutoScrollToggleRow() {
  const [on, setOn] = useState<boolean>(getAutoScroll);
  const onToggle = () => {
    const next = !on;
    setOn(next);
    setAutoScrollPref(next);
  };
  return (
    <div
      onClick={onToggle}
      role="button"
      aria-label="Автопрокрутка при чтении"
      style={{
        ...settingCard,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <span style={{
        fontSize: 'var(--font-footnote)',
        fontWeight: 'var(--weight-regular)',
        color: 'var(--text-primary)',
        letterSpacing: '0.005em',
      }}>
        Автопрокрутка при чтении
      </span>
      <Switch on={on} />
    </div>
  );
}

// Card chrome shared by all settings sections — frame each visually
// distinct group so the dense menu reads as a stack of related panels
// rather than one wall of controls.
export const settingCard: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: '14px',
  background: 'rgb(var(--ink-rgb) / 0.03)',
  padding: '14px',
};

export const cardTitle: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 'var(--font-caption2)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.10em',
};

// ─── Internal helper components ───────────────────────────────────────────

export function Switch({ on }: { on: boolean }) {
  return (
    <span style={{
      position: 'relative', display: 'inline-block',
      width: '30px', height: '17px', borderRadius: '999px',
      background: on ? 'var(--brand)' : 'var(--hairline-strong)',
      transition: 'background 0.18s ease',
      flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: '2px',
        left: on ? '15px' : '2px',
        width: '13px', height: '13px', borderRadius: '50%',
        background: 'var(--surface)', transition: 'left 0.18s ease',
      }} />
    </span>
  );
}

/**
 * ScalePicker — размер текста плюсом и минусом.
 *
 * Было четыре кнопки «А» разного кегля в ряд. Владелец 07.09.2026 попросил
 * десять ступеней — а десять кнопок в ряд не помещаются даже на широком
 * телефоне, и разложить их в две строки значит превратить выбор в таблицу.
 *
 * Поэтому шаговый переключатель: минус, образец с номером ступени, плюс.
 * Образец показывает букву тем кеглем, который сейчас выбран, — то есть
 * результат виден до того, как закроешь настройки.
 */
export function ScalePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const шаги = SCALE_OPTIONS.map(o => o.value);
  // Ближайшая ступень, а не строгое равенство: в localStorage может лежать
  // значение из старой сборки, и тогда индекс был бы -1.
  const индекс = шаги.reduce(
    (лучший, v, i) => Math.abs(v - value) < Math.abs(шаги[лучший] - value) ? i : лучший,
    0,
  );
  const шаг = (куда: -1 | 1) => {
    const следующий = Math.min(шаги.length - 1, Math.max(0, индекс + куда));
    if (следующий !== индекс) onChange(шаги[следующий]);
  };

  const кнопка: React.CSSProperties = {
    flexShrink: 0,
    width: '52px', height: '48px',
    borderRadius: '12px',
    border: '1px solid var(--hairline)',
    background: 'rgb(var(--ink-rgb) / 0.03)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '22px',
    lineHeight: 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <button
        onClick={() => шаг(-1)}
        disabled={индекс === 0}
        aria-label="Меньше"
        style={{ ...кнопка, opacity: индекс === 0 ? 0.35 : 1 }}
      >
        −
      </button>

      {/* Образец: буква тем кеглем, что выбран, и номер ступени под ней. */}
      <span style={{
        flex: 1, minWidth: 0,
        height: '48px',
        borderRadius: '12px',
        border: '1px solid var(--hairline)',
        background: 'rgb(var(--ink-rgb) / 0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '10px',
        overflow: 'hidden',
      }}>
        <span aria-hidden style={{
          fontSize: `${SCALE_FONT_PX[индекс]}px`,
          lineHeight: 1,
          color: 'var(--text-primary)',
        }}>
          A
        </span>
        <span style={{
          fontSize: 'var(--font-caption2)',
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {индекс + 1} / {шаги.length}
        </span>
      </span>

      <button
        onClick={() => шаг(1)}
        disabled={индекс === шаги.length - 1}
        aria-label="Больше"
        style={{ ...кнопка, opacity: индекс === шаги.length - 1 ? 0.35 : 1 }}
      >
        +
      </button>
    </div>
  );
}

export function FontChips<T extends string>({
  value, options, onChange, preview, dir = 'ltr', activeStatus,
}: {
  value: T;
  options: { id: T; label: string; stack: string; weight?: number }[];
  onChange: (v: T) => void;
  preview: string;
  dir?: 'ltr' | 'rtl';
  activeStatus?: 'idle' | 'loading' | 'ready' | 'failed';
}) {
  // Equal-width grid so every font gets the same airtime — horizontal
  // scroll hid Plex behind the edge fade and made it feel like a
  // second-class option. 2 cols for Arabic (qpc + nastaleeq), 3 cols
  // for Latin (inter-semibold + inter-regular + plex). The preview
  // glyphs are now the dominant visual; the label sits below as a
  // muted caption, mirroring how the theme-preset cards put the
  // colour first and the label second.
  const cols = options.length >= 3 ? 3 : 2;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: '6px',
    }}>
      {options.map(opt => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            style={{
              minHeight: '64px',
              padding: '10px 8px',
              borderRadius: '12px',
              border: `1px solid ${active ? 'var(--text-primary)' : 'var(--hairline)'}`,
              background: active
                ? 'rgb(var(--ink-rgb) / 0.08)'
                : 'rgb(var(--ink-rgb) / 0.03)',
              boxShadow: active ? 'inset 0 0 0 1px var(--text-primary)' : 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              overflow: 'hidden',
            }}
          >
            <span
              dir={dir}
              style={{
                fontFamily: opt.stack,
                fontSize: 'var(--font-body)',
                fontWeight: opt.weight ?? 400,
                color: 'var(--text-primary)',
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {preview}
            </span>
            <span style={{
              fontSize: 'var(--font-caption2)',
              color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: 'var(--weight-regular)',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              textTransform: 'uppercase',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}>
              {active && activeStatus === 'loading' && <AudioSpinner size={10} />}
              {active && activeStatus === 'loading'
                ? 'Загрузка…'
                : active && activeStatus === 'failed'
                  ? 'Ошибка загрузки'
                  : opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}


/** Per-language settings body.  `font/onFont/options` are optional so
 *  the Arabic tab can omit the font-picker (Arabic is rendered through
 *  QCF V4 PUA glyphs and has no user-pickable family any more — the
 *  three legacy web-fonts were removed). */
export function LangBody<T extends string>({
  visible, onToggleVisible, scale, onScale, font, onFont, options, preview,
  dir = 'ltr', fontStatus,
}: {
  visible: boolean;
  onToggleVisible: () => void;
  scale: number;
  onScale: (v: number) => void;
  font?: T;
  onFont?: (v: T) => void;
  options?: { id: T; label: string; stack: string; weight?: number }[];
  preview?: string;
  dir?: 'ltr' | 'rtl';
  fontStatus?: 'idle' | 'loading' | 'ready' | 'failed';
}) {
  const hasFontPicker = !!font && !!onFont && !!options && !!preview;
  return (
    <div>
      <div
        onClick={onToggleVisible}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 'var(--font-caption2)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}>
          {visible ? 'Видно' : 'Скрыто'}
        </span>
        <Switch on={visible} />
      </div>

      {/* Font picker above Size — the choice of font reshapes the
          page more dramatically than the size step, so it reads as
          the primary control and Size sits beneath it as a quick
          adjustment of the chosen face. */}
      {hasFontPicker && (
        <>
          <p style={sectionTitle}>Шрифт</p>
          <FontChips
            value={font!}
            options={options!}
            onChange={onFont!}
            preview={preview!}
            dir={dir}
            activeStatus={fontStatus}
          />
        </>
      )}

      <div style={{ marginTop: hasFontPicker ? '12px' : 0 }}>
        <p style={sectionTitle}>Размер</p>
        <ScalePicker value={scale} onChange={onScale} />
      </div>
    </div>
  );
}
