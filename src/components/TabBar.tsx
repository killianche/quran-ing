/**
 * TabBar — общая нижняя навигация Web / iOS / Android.
 *
 * Панель — плавающая стеклянная капсула, отделённая от краёв экрана.
 * Содержимое подтекает под неё, а не упирается в глухую полосу: это и
 * читается как стекло. Рецепт самого стекла общий с шапкой — класс
 * `.liquid-glass` в `index.css`, чтобы две панели не разъехались по
 * прозрачности и тени.
 *
 * 🔴 `TAB_BAR_HEIGHT` — не высота капсулы, а всё занятое ею место снизу,
 * вместе с зазором до края. Шесть экранов считают по нему нижний отступ
 * содержимого (`SurahPicker`, `AccountScreen`, `PrayerTimesScreen`,
 * `ComingSoonScreen` и другие). Если экспортировать
 * высоту самой капсулы, последняя строка списка окажется под стеклом —
 * молча, потому что стекло полупрозрачное и текст под ним «вроде виден».
 */

import { useRef, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { TabQuran, TabAzkar, TabPrayer } from './icons';
import { GLASS_BLUR } from '../lib/glass';

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
 * 🔴 Намаз здесь — и переносить его отсюда больше не нужно.
 *
 * 07.09.2026 владелец попросил убрать его во вкладку в шапку каждого раздела;
 * 08.09.2026, посмотрев вживую, попросил вернуть обратно вниз. Перенос
 * откачен целиком: и вкладка на месте, и кнопки из шапок убраны — два входа
 * в один раздел на одном экране это мусор, а не удобство.
 *
 * Прежний довод («вкладка занимает четверть самой дорогой полосы») оказался
 * слабее того, что время намаза смотрят из любого места и ищут его внизу.
 */
export type TabId = 'quran' | 'azkar' | 'prayer';

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
  { id: 'prayer', label: 'Намаз', icon: selected => <TabPrayer size={TAB_ICON} isFilled={selected} /> },
];

/**
 * Высота содержимого панели — без безопасной зоны внизу.
 *
 * 62 в развёрнутом виде и 44 в сжатом. Плавающая панель iOS 26 выше
 * системной: у неё есть собственные поля, и на 49 подпись прижималась к
 * кромке стекла. Безопасную зону прибавляют потребители этой константы сами
 * (`calc(TAB_BAR_HEIGHT + … + env(safe-area-inset-bottom))`), поэтому
 * включать её сюда нельзя — отступ удвоится.
 */
const BAR_HEIGHT = 62;
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
/** Зазор до нижнего края безопасной области и до боковых краёв.
 *
 * Владелец 07.09.2026: «нижнее меню слишком высоко, надо спустить». Было 10 px
 * ПОВЕРХ всей безопасной области — на iPhone с домашней полосой это 34 + 10,
 * то есть капсула висела в 44 px от края экрана и читалась как оторванная.
 *
 * Теперь от безопасной области отнимается 14 px: панель опускается на 24 px и
 * встаёт примерно в 20 px от края — ближе к домашней полосе, но не на ней.
 * На устройствах без полосы (`inset` = 0) остаётся минимум в 6 px. */
const BAR_INSET = 10;
/** Насколько поджимаем безопасную область снизу — см. комментарий выше. */
const BAR_SAFE_TRIM = 14;
/** Готовая нижняя координата капсулы. */
export const TAB_BAR_BOTTOM =
  `max(6px, calc(env(safe-area-inset-bottom) - ${BAR_SAFE_TRIM}px))`;
/* 21 pt — боковой отступ плавающей панели в iOS 26 (сверено по
   разбору спецификации, learnui.design). Было 14 «на глаз». */
const BAR_SIDE = 21;

/** Сколько места панель занимает снизу — см. предупреждение в шапке. */
export const TAB_BAR_HEIGHT = BAR_HEIGHT + BAR_INSET;

/** Максимальная пауза между двумя тапами по активной вкладке. */
const DOUBLE_TAP_MS = 420;

export function TabBar({ active, onSelect }: {
  active: TabId;
  onSelect: (id: TabId) => void;
}) {
  const lastActiveTapRef = useRef<{ id: TabId; at: number } | null>(null);

  return (
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
              onClick={() => {
                if (tab.id === active) {
                  // Двойной тап по активной вкладке возвращает длинный
                  // список наверх. «Коран» — оглавление из 114 сур, «Дуа» —
                  // сборник, который листают вниз (владелец 10.09.2026:
                  // «дважды кликаю на кнопку дуа — пускай прокручивается
                  // вверх»). Экраны прокручивают само окно, поэтому
                  // обработчик в App один на обе.
                  if (tab.id !== 'quran') return;
                  const now = performance.now();
                  const previous = lastActiveTapRef.current;
                  const isDoubleTap = previous?.id === tab.id
                    && now - previous.at <= DOUBLE_TAP_MS;

                  if (!isDoubleTap) {
                    lastActiveTapRef.current = { id: tab.id, at: now };
                    return;
                  }

                  lastActiveTapRef.current = null;
                  // 🔴 impact, а не selectionChanged. В плагине selectionChanged
                  // срабатывает, только если генератор создан через selectionStart —
                  // а его никто не вызывал, и вибрация на iOS молчала с самого начала
                  // (Haptics.swift, ревью 10.09.2026).
                  if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
                  onSelect(tab.id);
                  return;
                }

                lastActiveTapRef.current = null;
                if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
                onSelect(tab.id);
              }}
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
                color: selected ? 'var(--text-primary)' : 'var(--text-tertiary)',
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
                  // Подложки под выбранной вкладкой нет: в iOS выбранное
                  // отличается цветом и залитым глифом, а капсула под
                  // значком — приём Material, не системы Apple.
                  background: 'transparent',
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
  );
}
