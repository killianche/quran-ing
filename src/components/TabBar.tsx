/**
 * TabBar — общая нижняя навигация Web / iOS / Android.
 *
 * 🔴 На iOS 26+ этот компонент ничего не рисует: внизу лежит настоящий
 * системный `UITabBar` с Liquid Glass (решение владельца 2026-10-04,
 * src/lib/nativeTabBar.ts). Компонент тогда только показывает и прячет
 * его вместе с экраном вкладок, отмечает выбранную вкладку и красит её
 * в цвет темы. Всё ниже про капсулу — веб-панель для Android, сайта и
 * iOS до 26.
 *
 * Панель — плавающая стеклянная капсула, отделённая от краёв экрана.
 * Содержимое подтекает под неё, а не упирается в глухую полосу: это и
 * читается как стекло. Рецепт самого стекла общий с шапкой — класс
 * `.liquid-glass` в `index.css`, чтобы две панели не разъехались по
 * прозрачности и тени.
 *
 * 🔴 Нижний отступ экранов вкладок — `TAB_BAR_SPACE`, а не высота капсулы:
 * это всё занятое панелью место снизу, вместе с зазором до края, и у
 * системной панели iOS 26 оно другое (0 сверх безопасной зоны). Если
 * считать от высоты капсулы, последняя строка списка окажется под
 * стеклом — молча, потому что стекло полупрозрачное и текст «вроде виден».
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { TabQuran, TabAzkar } from './icons';
import { GLASS_BLUR } from '../lib/glass';
import type { Theme } from '../hooks/useTheme';
import {
  WEB_BAR,
  getTabBarMode,
  selectNativeTab,
  setNativeTabBarVisible,
  setNativeTabSelectHandler,
  subscribeTabBarMode,
  tintNativeTabBar,
} from '../lib/nativeTabBar';

/**
 * Разделы нижнего меню.
 *
 * «Аккаунт» отсюда убран 05.09.2026 по решению владельца: настройки профиля
 * открывают редко, а место в панели — самое дорогое на экране. Кнопка
 * переехала в шапку главной, рядом с оформлением, а экран стал обычным
 * пушем с кнопкой «назад».
 */
/**
 * Разделы нижней панели.
 *
 * 🔴 Quran Ing, решение владельца 2026-10-04: внизу только «Коран» и
 * «Азкары». «Намаз» — кнопкой в шапке главной (экран `prayer` с «назад»),
 * раздела «Дуа» нет вовсе. (У an-Nur намаз возвращали вниз 08.09.2026 —
 * это история другого приложения, не повод возвращать вкладку здесь.)
 */
export type TabId = 'quran' | 'azkar';

/** Размер глифа вкладки — ступень `--icon-tab` из общей шкалы.  В JSX
 *  он приходит числом (иконки принимают `size`), поэтому значение здесь
 *  и в CSS-токене нужно держать одинаковым.
 *
 *  Было 28 при подписи в 11px — глиф перевешивал строку, и панель читалась
 *  тяжелее, чем весь остальной экран. 25 возвращает привычную для панели
 *  иерархию: сначала узнаётся значок, потом дочитывается подпись. */
const TAB_ICON = 25;

const TABS: { id: TabId; label: string; icon: (selected: boolean) => ReactNode }[] = [
  { id: 'quran', label: 'Коран', icon: selected => <TabQuran size={TAB_ICON} isFilled={selected} /> },
  { id: 'azkar', label: 'Азкары', icon: selected => <TabAzkar size={TAB_ICON} isFilled={selected} /> },
];

/**
 * Высота содержимого веб-панели — без безопасной зоны внизу.
 *
 * 62: плавающая панель iOS 26 выше системной, у неё собственные поля, и на
 * 49 подпись прижималась к кромке стекла. Безопасную зону прибавляют
 * потребители сами, поэтому включать её сюда нельзя — отступ удвоится.
 * Сами числа живут в `WEB_BAR` (lib/nativeTabBar.ts): по ним же считаются
 * CSS-переменные `--tabbar-space` и `--tabbar-top`.
 */
const BAR_HEIGHT = WEB_BAR.height;
/*
 * 🔴 Сжатия при прокрутке здесь БОЛЬШЕ НЕТ, и возвращать его не нужно.
 *
 * 05.09.2026 панель специально сделали сжимающейся — это черта нижнего меню
 * iOS 26 (`.tabBarMinimizeBehavior(.onScrollDown)`). 06.09.2026 владелец,
 * посмотрев вживую, попросил обратное, дословно: «и то, что нижнее меню при
 * прокрутке уменьшается — тоже убери, пускай оно стабильное».
 *
 * Причина понятна и без Apple: панель дёргалась на каждом движении пальца в
 * списке из 114 строк, а подписи то появлялись, то исчезали. Похожесть на
 * систему не стоит скачущего элемента под большим пальцем.
 */
/** Зазор до нижнего края безопасной области.
 *
 * Владелец 07.09.2026: «нижнее меню слишком высоко, надо спустить», и
 * 2026-10-04 ещё раз: «сделать ниже, ближе к краю». От безопасной области
 * отнимается 18 px (`WEB_BAR.bottom`): капсула стоит примерно в 16 px от
 * края — у домашней полосы (её верх ≈ 13 pt), но не на ней. На устройствах без полосы
 * (`inset` = 0) остаётся минимум в 6 px. Системную панель iOS 26 так же
 * опускает NATIVE_BAR_DROP_PT (lib/nativeTabBar.ts). */
const TAB_BAR_BOTTOM = WEB_BAR.bottom;
/* Боковой отступ капсулы. Apple числом его не задаёт (docs/IOS26_DESIGN_
   GUIDE.md, § 3): 21 — замер сторонних авторов, подобран на глаз. */
const BAR_SIDE = 21;

/**
 * Место панели снизу СВЕРХ env(safe-area-inset-bottom) — для нижнего
 * отступа экранов вкладок. CSS-выражение, а не число: у системной панели
 * iOS 26 оно 0 (её высота уже в безопасной зоне), у веб-капсулы — 72.
 */
export const TAB_BAR_SPACE = `var(--tabbar-space, ${WEB_BAR.height + WEB_BAR.inset}px)`;
/** Расстояние от низа экрана до верхней кромки панели (CSS). */
export const TAB_BAR_TOP = 'var(--tabbar-top, 80px)';

/**
 * Где плавающая полоска над низом экрана (мини-плеер, плашка отказа
 * звука): на экранах вкладок — над панелью с зазором `gap`, как нижний
 * аксессуар панели в iOS 26; на экранах без панели — над домашней полосой.
 */
export type AccessoryPlacement = 'tabs' | 'screen';
export function accessoryBottom(placement: AccessoryPlacement, gap: number): string {
  return placement === 'tabs'
    ? `calc(${TAB_BAR_TOP} + ${gap}px)`
    : `calc(max(12px, env(safe-area-inset-bottom)) + ${gap}px)`;
}

/** Максимальная пауза между двумя тапами по активной вкладке. */
const DOUBLE_TAP_MS = 420;

export function TabBar({ active, onSelect, theme }: {
  active: TabId;
  onSelect: (id: TabId) => void;
  theme: Theme;
}) {
  const mode = useSyncExternalStore(subscribeTabBarMode, getTabBarMode, getTabBarMode);
  const handleTap = useTabTap(active, onSelect, mode !== 'native');

  // Системная панель живёт столько же, сколько экран вкладок: ушли на
  // суру — спряталась, вернулись — показалась (lib/nativeTabBar.ts склеит
  // «спрятать-показать» при смене вкладки, чтобы панель не мигала).
  const tapRef = useRef(handleTap);
  tapRef.current = handleTap;
  useEffect(() => {
    if (mode !== 'native') return;
    setNativeTabSelectHandler(id => tapRef.current(id));
    setNativeTabBarVisible(true);
    return () => {
      setNativeTabSelectHandler(null);
      setNativeTabBarVisible(false);
    };
  }, [mode]);
  useEffect(() => { if (mode === 'native') selectNativeTab(active); }, [mode, active]);
  useEffect(() => { if (mode === 'native') tintNativeTabBar(theme); }, [mode, theme]);

  // pending — режим ещё выясняется (первые миллисекунды на iOS, под
  // заставкой): лучше без панели, чем веб-капсула, сменённая системной.
  if (mode === 'pending') return null;
  // Системная панель рисуется UIKit; от страницы — только кромка под ней.
  if (mode === 'native') return <TabBarEdge />;

  return (
    <>
    <TabBarEdge />
    <nav
      aria-label="Разделы"
      className="liquid-glass"
      style={{
        ...GLASS_BLUR,
        // Плавающая капсула «жидкого стекла» — как нижнее меню в iOS 26.
        //
        // Решения владельца по этой панели менялись: 04.09.2026 он выбрал
        // системную панель во всю ширину, 05.09 — вернуться к плавающей, но
        // «как в последней iOS». Поэтому здесь именно черты iOS 26: панель
        // висит НАД содержимым с отступами от краёв и полностью скруглена.
        // Сжатие при прокрутке было и снято владельцем 06.09.2026 — см.
        // комментарий у `BAR_HEIGHT`.
        //
        // Точных величин Apple не публикует — высоты и радиус подобраны на
        // глаз по отрисовке, а не взяты из документации.
        position: 'fixed',
        left: `${BAR_SIDE}px`,
        right: `${BAR_SIDE}px`,
        bottom: TAB_BAR_BOTTOM,
        zIndex: 40,
        height: `${BAR_HEIGHT}px`,
        boxSizing: 'border-box',
        borderRadius: `${BAR_HEIGHT / 2}px`,
        // Кромка стекла: светлая линия сверху ловит свет, общая рамка держит
        // форму на любом фоне.
        border: '1px solid rgb(var(--surface-rgb) / 0.55)',
        boxShadow:
          '0 8px 30px rgb(var(--ink-rgb) / 0.16),'
          + ' inset 0 1px 0 rgb(var(--surface-rgb) / 0.65)',
        maxWidth: '520px',
        margin: '0 auto',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))`,
        }}
      >
        {TABS.map(tab => {
          const selected = tab.id === active;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTap(tab.id)}
              aria-current={selected ? 'page' : undefined}
              aria-label={tab.label}
              className="ios-tab-item"
              data-active={selected}
              style={{
                minWidth: 0,
                height: '100%',
                padding: '0 var(--space-hair)',
                border: 'none',
                borderRadius: 0,
                background: 'transparent',
                color: selected ? 'var(--brand)' : 'var(--text-tertiary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-hair)',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                transition:
                  'color var(--dur-base) var(--ease-standard),'
                  + ' transform var(--dur-base) var(--ease-panel)',
              }}
            >
              <span
                aria-hidden="true"
                className="ios-tab-icon"
                style={{
                  // Подложка шире иконки: 42×34 давала почти круг, и
                  // залитый глиф выбранной вкладки читался в нём пятном.
                  // Вытянутая капсула возвращает иконке форму.
                  width: '52px',
                  height: '28px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-pill)',
                  // Мягкая «пилюля» под выбранной вкладкой — как индикатор
                  // панели вкладок iOS 26, окрашенный в мягкий акцент (так
                  // же в xtrud: indicatorColor = accent-soft).
                  background: selected ? 'var(--brand-soft)' : 'transparent',
                  transform: 'none',
                  transition:
                    'background var(--dur-base) var(--ease-standard),'
                    + ' transform var(--dur-slow) var(--ease-panel)',
                }}
              >
                {tab.icon(selected)}
              </span>
              <span
                style={{
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  // Caption 2 (11/13) — нижняя ступень iOS и одновременно
                  // минимальный кегль, который Apple разрешает в
                  // интерфейсе.  Начертания только те два, что реально
                  // подключены: 650 и 500 браузер всё равно сводил к 600
                  // и 400, просто менее предсказуемо.
                  fontSize: 'var(--font-caption2)',
                  lineHeight: 'var(--leading-caption2)',
                  fontWeight: selected
                    ? 'var(--weight-semibold)'
                    : 'var(--weight-regular)',
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
    </>
  );
}

/**
 * Кромка под нижней панелью — лёгкое размытие с тоном фона темы.
 *
 * Владелец 2026-10-04 (скриншоты сборки 3): «снизу это белое свечение…
 * давай небольшое размытие, а не свечение; затемнить или осветлить
 * материал под меню». Системный эффект края iOS 26 выключен
 * (MainViewController.swift), вместо него — эта полоса: контент под панелью
 * чуть размыт и слегка уходит в фон темы (на тёмной — темнее, на светлой —
 * светлее), без цветного ореола. Высота — от низа экрана до верхней кромки
 * панели и ещё 20 px мягкого перехода.
 */
function TabBarEdge() {
  return (
    <div
      aria-hidden
      className="tabbar-edge"
      style={{
        // Размытие — инлайном: из CSS его съедает минификатор (lib/glass.ts).
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: `calc(${TAB_BAR_TOP} + 20px)`,
        zIndex: 38,
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * Тап по вкладке — общий для веб-капсулы и системной панели.
 *
 * Другая вкладка — переход. Активная «Коран» — двойной тап возвращает
 * оглавление из 114 сур наверх (экран прокручивает само окно, поэтому
 * обработчик — в App); одиночный тап по активной ничего не делает.
 * Системная панель шлёт событие и на тап по уже выбранной вкладке, так что
 * логика одна на обе панели.
 */
function useTabTap(active: TabId, onSelect: (id: TabId) => void, haptic: boolean) {
  const lastActiveTapRef = useRef<{ id: TabId; at: number } | null>(null);
  // 🔴 impact, а не selectionChanged. В плагине selectionChanged срабатывает,
  // только если генератор создан через selectionStart — а его никто не
  // вызывал, и вибрация на iOS молчала с самого начала (Haptics.swift, ревью
  // 10.09.2026). Системная панель iOS при выборе вкладки не вибрирует —
  // и мы ей вибрацию не добавляем, чтобы не отличаться от других приложений.
  const tick = () => {
    if (haptic && Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
  };
  return (id: TabId) => {
    if (id !== active) {
      lastActiveTapRef.current = null;
      tick();
      onSelect(id);
      return;
    }
    if (id !== 'quran') return;
    const now = performance.now();
    const previous = lastActiveTapRef.current;
    if (!(previous?.id === id && now - previous.at <= DOUBLE_TAP_MS)) {
      lastActiveTapRef.current = { id, at: now };
      return;
    }
    lastActiveTapRef.current = null;
    tick();
    onSelect(id);
  };
}
