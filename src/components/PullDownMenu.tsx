/**
 * PullDownMenu — выпадающее меню в духе iOS (`UIMenu` у кнопки).
 *
 * Зачем: выбор из короткого списка (чтец в плеере) не стоит ни места на
 * экране, ни целой шторки. В iOS такой выбор — меню, которое вырастает из
 * самой кнопки, с галочкой у текущего пункта, и закрывается тапом мимо.
 * Владелец 2026-10-04: «чтобы чтецы выпадали… занимало мало место».
 *
 * Как устроено:
 * - портал в `document.body`: экраны лежат в контейнерах с `transform`,
 *   а для них `position: fixed` считается от контейнера, не от экрана
 *   (та же причина, что у `SettingsSheet`);
 * - стекло — только у самой панели меню (слой управления, HIG Materials);
 * - раскрывается под кнопкой, а если снизу тесно — над ней; по ширине не
 *   выходит за поля экрана;
 * - вырастает из кнопки (масштаб от её края) пружинной кривой; при
 *   «Уменьшении движения» — только растворение;
 * - системный «назад» (жест или кнопка Android) закрывает меню, а не
 *   уводит с экрана: та же фиктивная запись истории, что у шторок.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { GLASS_BLUR } from '../lib/glass';
import { Check, ICON_SIZE } from './icons';

export type PullDownItem<T extends string> = {
  id: T;
  label: string;
  /** Вторая строка мелким кеглем — например, «80 сур из 114». */
  detail?: string;
  checked?: boolean;
};

/** Поля меню от краёв экрана и зазор до кнопки. */
const EDGE = 12;
const GAP = 8;
const WIDTH = 300;

export function PullDownMenu<T extends string>({
  anchor, items, onSelect, onClose, label, header,
}: {
  /** Кнопка, из которой меню выросло; по ней считается положение. */
  anchor: HTMLElement;
  items: PullDownItem<T>[];
  onSelect: (id: T) => void;
  onClose: () => void;
  /** Подпись для скринридера: «Чтец». */
  label: string;
  /** Необязательная строка-заголовок над пунктами, как у меню iOS. */
  header?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headerId = useId();
  // Свежий onClose без переподписки слушателей на каждый рендер владельца.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{
    left: number; top: number; originX: string; originY: 'top' | 'bottom';
  } | null>(null);

  // Положение — до первой отрисовки, по фактической высоте панели: иначе
  // меню на кадр мелькнуло бы не там.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const a = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(WIDTH, vw - EDGE * 2);
    const height = panel.offsetHeight;
    // По центру кнопки, но не за краем экрана.
    const left = Math.round(Math.min(
      vw - EDGE - width,
      Math.max(EDGE, a.left + a.width / 2 - width / 2),
    ));
    const below = vh - a.bottom - GAP - EDGE;
    const openUp = below < height && a.top - GAP - EDGE > below;
    const top = openUp
      ? Math.max(EDGE, a.top - GAP - height)
      : Math.min(a.bottom + GAP, vh - EDGE - height);
    // Точка роста — та часть панели, что ближе к кнопке.
    const originX = `${Math.round(Math.min(width, Math.max(0, a.left + a.width / 2 - left)))}px`;
    setPlace({ left, top: Math.round(top), originX, originY: openUp ? 'bottom' : 'top' });
  }, [anchor]);

  // Раскрытие — со следующего кадра, чтобы сработал переход.
  useEffect(() => {
    if (!place) return;
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, [place]);

  // Системный «назад» закрывает меню (см. шапку).
  const closedByPop = useRef(false);
  useEffect(() => {
    history.pushState({ sheet: true }, '');
    const onPop = () => { closedByPop.current = true; closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByPop.current && history.state?.sheet) history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Фокус — на отмеченный пункт, как в системном меню, но только когда
  // панель уже видна: элемент с `visibility: hidden` фокус не принимает.
  // При закрытии фокус возвращается на кнопку, из которой меню выросло.
  useEffect(() => {
    if (!place) return;
    const panel = panelRef.current;
    const checked = panel?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?? panel?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    checked?.focus({ preventScroll: true });
  }, [place]);
  useEffect(() => () => anchor.focus({ preventScroll: true }), [anchor]);

  // Esc и стрелки — для внешней клавиатуры.
  useEffect(() => {
    const panel = panelRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = Array.from(panel?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      if (!all.length) return;
      e.preventDefault();
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Уход экрана (поворот, клавиатура) — меню больше не у своей кнопки.
  useEffect(() => {
    const onResize = () => closeRef.current();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pick = (id: T) => {
    if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
    onSelect(id);
    onClose();
  };

  return createPortal(
    <>
      {/* Ловушка тапа мимо. Прозрачная: системное меню не затемняет экран.
          Закрывает по click, а не по pointerdown: иначе подложка исчезала
          до клика, и он доставался кнопке под пальцем — тап «мимо» по
          «Слушать» заодно ставил паузу (ревью 2026-10-04). pointerdown
          гасится только ради фокуса. */}
      <div
        aria-hidden
        onPointerDown={e => e.preventDefault()}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 59 }}
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label={header ? undefined : label}
        aria-labelledby={header ? headerId : undefined}
        className="liquid-glass pulldown-menu"
        data-open={open ? '' : undefined}
        style={{
          ...GLASS_BLUR,
          position: 'fixed',
          zIndex: 60,
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          width: `min(${WIDTH}px, calc(100vw - ${EDGE * 2}px))`,
          maxHeight: `calc(100dvh - ${EDGE * 2}px)`,
          overflowY: 'auto',
          borderRadius: '22px',
          padding: '6px',
          transformOrigin: place ? `${place.originX} ${place.originY}` : 'center top',
          visibility: place ? 'visible' : 'hidden',
        }}
      >
        {header && (
          <div id={headerId} role="presentation" style={{
            padding: '6px 12px 8px',
            fontSize: 'var(--font-footnote)',
            lineHeight: 'var(--leading-footnote)',
            color: 'var(--text-tertiary)',
          }}>
            {header}
          </div>
        )}
        {items.map(item => (
          <button
            key={item.id}
            role="menuitemradio"
            aria-checked={item.checked ? 'true' : 'false'}
            onClick={() => pick(item.id)}
            className="pulldown-item"
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              width: '100%', minHeight: '44px',
              padding: '8px 12px',
              border: 'none', borderRadius: '14px',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: 'inherit', textAlign: 'left',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {/* Колонка галочки слева, как в меню iOS: имена выстраиваются
                в одну линию, отмечен пункт или нет. */}
            <span aria-hidden style={{
              flexShrink: 0, width: '18px',
              display: 'inline-flex', justifyContent: 'center',
              color: 'var(--text-primary)',
            }}>
              {item.checked && <Check size={ICON_SIZE.sm} />}
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: '1px' }}>
              <span style={{
                fontSize: 'var(--font-body)',
                lineHeight: 'var(--leading-body)',
                fontWeight: item.checked ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              }}>
                {item.label}
              </span>
              {item.detail && (
                <span style={{
                  fontSize: 'var(--font-footnote)',
                  lineHeight: 'var(--leading-footnote)',
                  color: 'var(--text-tertiary)',
                }}>
                  {item.detail}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
