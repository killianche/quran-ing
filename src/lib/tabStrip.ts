/**
 * tabStrip — геометрия ленты корневых вкладок на нативной прокрутке.
 *
 * ── Почему листает сам iOS (решение 2026-10-05) ───────────────────────
 *
 * Владелец на iPhone (TestFlight, сборка 7): «когда свайпаю вправо-влево
 * между Плеером, Кораном, Азкарами, происходит дёргание». Своя физика жеста
 * (палец → transform листов, доводка CSS-переходом, src/lib/tabSwipe.ts) в
 * Chromium шла ровно, а в WKWebView дёргалась. Тот же путь an-Nur прошёл с
 * мусхафом 14.09.2026 (STATUS.md, «Мусхаф листает системная прокрутка iOS»):
 * в WKWebView контейнер с CSS `scroll-snap` прокручивается настоящим
 * `UIScrollView` (WebKit, `ScrollingTreeScrollingNodeDelegateIOS.mm`) —
 * палец, инерция, резинка и привязка системные, 120 Гц и ноль JS на кадр.
 *
 * Поэтому здесь нет ни порогов, ни скоростей, ни пружин — только перевод
 * «прокрутка ↔ номер вкладки» и признак «лента стоит». Сама лента и её
 * события — в src/components/TabPager.tsx. Самодельную физику не
 * возвращать: страж в scripts/test-tab-swipe.mjs ловит её возврат.
 */

/**
 * Шаг ленты — целая ширина страницы, px.
 *
 * 🔴 Целый. Дробная ширина области (412.5 на части Android) давала у
 * мусхафа набегающую ошибку: каждая следующая страница вставала на долю
 * пикселя дальше точки привязки. Ширина страницы и шаг — одно число:
 * `clientWidth` контейнера (оно уже целое), пересчитываемое на resize и
 * повороте.
 */
export function tabStep(clientWidth: number): number {
  return Number.isFinite(clientWidth) && clientWidth > 0 ? Math.floor(clientWidth) : 0;
}

/** Координата прокрутки, при которой вкладка стоит ровно в кадре. */
export function scrollLeftForTab(index: number, step: number): number {
  return Math.max(0, index) * step;
}

/**
 * Какая вкладка ближе к кадру при данной прокрутке (индекс слева направо).
 *
 * Середина между страницами решает в пользу той, что занимает больше
 * экрана: подсветка в нижнем меню меняется ровно тогда, когда глаз уже
 * видит новую страницу. За краями (резинка) — крайняя вкладка.
 */
export function tabAtScrollLeft(scrollLeft: number, step: number, count: number): number {
  if (!(step > 0) || !Number.isFinite(scrollLeft) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / step)));
}

/**
 * Где лента между двумя вкладками: левая `from`, правая `to` и доля пути
 * `t` от 0 до 1. Нужно для панелей, видимых не на всех вкладках
 * (мини-плеер): они проявляются и гаснут вместе с перелистыванием.
 */
export function tabProgress(scrollLeft: number, step: number, count: number): {
  from: number; to: number; t: number;
} {
  if (!(step > 0) || !Number.isFinite(scrollLeft) || count <= 0) return { from: 0, to: 0, t: 0 };
  const x = Math.min((count - 1) * step, Math.max(0, scrollLeft)) / step;
  const from = Math.min(count - 1, Math.floor(x));
  const to = Math.min(count - 1, from + 1);
  return { from, to, t: to === from ? 0 : x - from };
}

/**
 * Допуск, в котором лента считается стоящей на вкладке, px.
 *
 * 🔴 Не пиксель. WebKit на iOS отдаёт странице положение прокрутки с
 * запаздыванием: после остановки последнее значение застывает в −10…+7 px
 * от точки привязки, хотя страница на экране стоит ровно (замер свайпами в
 * iOS-симуляторе на мусхафе, 14.09.2026). А палец, замерший посреди
 * перелистывания, — это десятки и сотни пикселей. Пять процентов шага, но
 * не меньше 16 px, разделяют эти два случая.
 */
export function tabSettleTolerance(step: number): number {
  return Math.max(16, step * 0.05);
}

/** Лента стоит на вкладке, а не посередине между страницами. */
export function isTabAligned(scrollLeft: number, step: number, tolerance = 1): boolean {
  if (!(step > 0) || !Number.isFinite(scrollLeft)) return true;
  const r = scrollLeft / step;
  return Math.abs(r - Math.round(r)) * step < tolerance;
}

/**
 * Досадить ленту на страницу, пока она ещё доезжает после отпускания.
 *
 * Владелец 2026-10-07: «перешёл на Азкары, вернулся на Коран — первая
 * попытка прокрутить список вверх-вниз не работает, он пытается свайпнуть
 * вправо-влево». Стенд в iOS-симуляторе (ветка lab/tab-swipe) показал
 * причину: после отпускания привязка UIScrollView доводит ленту почти
 * секунду — за 0,23 с до ~20 px от страницы и ещё ~0,6 с ползёт последние
 * пиксели. Пока лента движется, iOS отдаёт касание ей (палец сначала
 * останавливает прокрутку), и вертикальный жест становится горизонтальным.
 *
 * Поэтому, как только пальца нет и лента ДОЕЗЖАЕТ до ближайшей страницы —
 * осталось не больше хвоста и расстояние сокращается, — её ставят ровно на
 * страницу сразу. Именно «доезжает»: сразу после отпускания лента бывает
 * в паре десятков пикселей от исходной страницы, но летит от неё по
 * инерции на соседнюю; оборвать такой бросок — значит отменить свайп
 * (поймано тем же стендом). `prevScrollLeft` — положение на прошлом
 * событии прокрутки. Возвращает координату страницы или null.
 */
export function snapTailTarget(
  scrollLeft: number, step: number, count: number, prevScrollLeft: number,
): number | null {
  if (!(step > 0) || !Number.isFinite(scrollLeft) || count <= 0) return null;
  const max = (count - 1) * step;
  if (scrollLeft < 0 || scrollLeft > max) return null;
  const target = scrollLeftForTab(tabAtScrollLeft(scrollLeft, step, count), step);
  const d = Math.abs(scrollLeft - target);
  if (d < 0.5 || d > Math.max(24, step * 0.06)) return null;
  // Приближается ли лента к странице (а не улетает от неё броском).
  if (!Number.isFinite(prevScrollLeft) || Math.abs(prevScrollLeft - target) <= d) return null;
  return target;
}

