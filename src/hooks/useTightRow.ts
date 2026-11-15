/**
 * useTightRow — «не помещается ли ряд кнопок, если показать подпись».
 *
 * Нижний ряд полного плеера (PlayerScreen): скорость · повтор аята ·
 * состояние загрузки суры · «Суры». С кнопкой повтора (2026-11-15) на
 * телефонах шириной до ~410 pt ряд в худшем случае не помещается: кнопка
 * загрузки бывает от «Скачано» до «Повторить». Тогда у «Суры» убирается
 * подпись и остаётся значок списка — как кнопка очереди в Музыке iOS.
 *
 * Почему замер, а не медиа-запрос: ширина ряда зависит не только от экрана,
 * но и от того, что сейчас показывает кнопка загрузки и включён ли повтор
 * («3», «∞»). Порог по ширине экрана либо прятал бы подпись там, где она
 * помещается, либо пропускал бы худший случай.
 *
 * Подпись, которую можно убрать, помечается `data-collapsible-label`. Её
 * ширина запоминается, пока она видна, — так в свёрнутом виде известно,
 * хватит ли места вернуть её обратно.
 */

import { useLayoutEffect, useRef, useState } from 'react';

export function useTightRow(row: HTMLElement | null): boolean {
  const [tight, setTight] = useState(false);
  const tightRef = useRef(false);
  /** Ширина подписи вместе с отступом до значка, пока она была видна. */
  const labelExtra = useRef(0);

  useLayoutEffect(() => {
    if (!row) return;

    const measure = () => {
      const label = row.querySelector<HTMLElement>('[data-collapsible-label]');
      if (label && label.getClientRects().length > 0) {
        const parent = label.parentElement;
        const gap = parent ? parseFloat(getComputedStyle(parent).columnGap) || 0 : 0;
        labelExtra.current = label.getBoundingClientRect().width + gap;
      }
      const kids = Array.from(row.children) as HTMLElement[];
      const rowGap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const used = kids.reduce((sum, kid) => sum + kid.getBoundingClientRect().width, 0)
        + rowGap * Math.max(0, kids.length - 1);
      const needed = used + (tightRef.current ? labelExtra.current : 0);
      const next = needed > row.clientWidth + 0.5;
      if (next !== tightRef.current) {
        tightRef.current = next;
        setTight(next);
      }
    };

    const resize = new ResizeObserver(measure);
    const observeKids = () => {
      resize.disconnect();
      resize.observe(row);
      for (const kid of Array.from(row.children)) resize.observe(kid);
    };
    // Кнопка загрузки появляется и исчезает асинхронно — следим за составом
    // прямых детей. Смену текста внутри (проценты загрузки) видит
    // ResizeObserver по ширине, без перестройки наблюдателей на каждый шаг.
    const mutations = new MutationObserver(() => { observeKids(); measure(); });
    mutations.observe(row, { childList: true });
    observeKids();
    measure();
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [row]);

  return tight;
}
