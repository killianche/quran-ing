/**
 * AzkarNavBar — нижняя панель ленты азкаров: «Предыдущий», выход,
 * «Следующий».
 *
 * Владелец 2026-11-15: «в азкарах, неважно утренние или вечерние, внизу
 * сделай нижнее меню с кнопками, которые переключают следующий и
 * предыдущий азкар, и с выходом на главное меню». Свайп по карточкам
 * остаётся; панель — для тех, кто листает кнопками, и для одной руки.
 *
 * Вид iOS 26 (docs/IOS26_DESIGN_GUIDE.md): плавающие стеклянные элементы
 * над домашней полосой, как нижнее меню вкладок; кнопки 56 pt, круг выхода 48 (больше 44 —
 * их жмут вслепую, не глядя вниз). Подписи словами, а не одни стрелки:
 * «следующий» без подписи легко спутать с «назад» в шапке.
 *
 *  • На первой карточке «Предыдущий» недоступна (приглушена, не исчезает —
 *    раскладка не прыгает).
 *  • На последней «Следующий» становится «Готово» и выводит к списку
 *    азкаров: дочитал — выход там же, где палец.
 *  • Средняя круглая кнопка — выход к списку азкаров (тот же путь, что
 *    «назад» в шапке).
 */

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { ChevronLeft, ChevronRight, Check, Close, ICON_SIZE } from './icons';
import { GLASS_BLUR } from '../lib/glass';

/** Высота кнопок панели, pt. */
const BAR_HEIGHT = 56;
/** Круг выхода посередине, pt (не меньше 44). */
const EXIT_SIZE = 48;

/**
 * Сколько места снизу держать под панелью в прокрутке карточки — чтобы
 * последняя строка азкара не уходила под стекло.
 */
export const AZKAR_NAV_SPACE = `calc(${BAR_HEIGHT}px + max(var(--space-margin), env(safe-area-inset-bottom)) + var(--space-section))`;

function tap() {
  if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
}

export function AzkarNavBar({
  index, total, onPrev, onNext, onExit,
}: {
  /** Номер видимой карточки, с нуля. */
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const atStart = index <= 0;
  const atEnd = index >= total - 1;

  const pill: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: `${BAR_HEIGHT}px`,
    borderRadius: 'var(--radius-pill)',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    // У шеврона свои поля внутри квадрата иконки — со стороны стрелки
    // отступ меньше, со стороны слова больше.
    padding: '0 10px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    // «Предыдущий» должен влезать целиком и на 375 pt: кегль ступени
    // Subhead, на узком экране — чуть мельче, а не многоточие.
    fontSize: 'min(var(--font-subhead), 3.6vw)',
    fontWeight: 'var(--weight-semibold)',
    letterSpacing: 'var(--tracking-tight)',
    cursor: 'pointer',
    pointerEvents: 'auto',
    WebkitTapHighlightColor: 'transparent',
    ...GLASS_BLUR,
  };

  return (
    <nav
      aria-label="Переход между азкарами"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'max(var(--space-margin), env(safe-area-inset-bottom))',
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 var(--space-margin)',
        maxWidth: '560px',
        margin: '0 auto',
        // Пустые места панели пропускают касания к карточке.
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        className="liquid-glass azkar-nav-btn"
        onClick={() => { if (atStart) return; tap(); onPrev(); }}
        aria-disabled={atStart}
        aria-label="Предыдущий азкар"
        style={{
          ...pill,
          justifyContent: 'flex-start',
          opacity: atStart ? 0.4 : 1,
          cursor: atStart ? 'default' : 'pointer',
        }}
      >
        <ChevronLeft size={ICON_SIZE.md} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Предыдущий</span>
      </button>

      <button
        type="button"
        className="liquid-glass azkar-nav-btn"
        onClick={() => { tap(); onExit(); }}
        aria-label="Выйти к списку азкаров"
        title="Выйти"
        style={{
          ...pill,
          flex: '0 0 auto',
          // Круг выхода чуть уже строки: место — подписям соседей.
          width: `${EXIT_SIZE}px`,
          height: `${EXIT_SIZE}px`,
          padding: 0,
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <Close size={ICON_SIZE.md} />
      </button>

      <button
        type="button"
        className="liquid-glass azkar-nav-btn"
        onClick={() => { tap(); if (atEnd) onExit(); else onNext(); }}
        aria-label={atEnd ? 'Готово, выйти к списку азкаров' : 'Следующий азкар'}
        style={{
          ...pill,
          justifyContent: 'flex-end',
          ...(atEnd ? { background: 'var(--brand)', color: 'var(--on-brand)', borderColor: 'transparent' } : {}),
        }}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{atEnd ? 'Готово' : 'Следующий'}</span>
        {atEnd ? <Check size={ICON_SIZE.md} /> : <ChevronRight size={ICON_SIZE.md} />}
      </button>
    </nav>
  );
}
