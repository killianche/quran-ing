import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Capacitor } from '@capacitor/core';

const EDGE_WIDTH = 22;
const COMMIT_PROGRESS = 0.34;
const FLICK_DISTANCE = 42;
const FLICK_VELOCITY = 0.55;
const SETTLE_MS = 260;
const SETTLE_EASING = 'cubic-bezier(.22,1,.36,1)';
const PARALLAX = 0.28;

/**
 * Что показать под уезжающим экраном.
 *
 *  • `node` — клон прежнего экрана «поверх» (закладки под сурой и т. п.):
 *    тот размонтирован, живого под рукой нет.
 *  • `live` — сам прежний экран, живой (вкладки, App): он припаркован за
 *    краем и на время жеста выезжает из-под уходящего. Клон вкладок не
 *    годился: копия DOM не уносит положений прокрутки ленты и страниц, а
 *    лента в копии теряла опору и схлопывалась в ноль — под жестом был
 *    пустой фон темы, на тёмной — чёрный (владелец, iPhone, 2026-10-05).
 */
export type IosBackPreview =
  | {
    /** Клон уходящего экрана. Готовится в navigate() до размонтирования. */
    node: HTMLElement;
    scrollY: number;
  }
  | {
    /** Живой экран, к которому вернёмся; ищется в момент жеста. */
    live: () => HTMLElement | null;
    /**
     * Его `transform` на парковке (App, PARKED_SHIFT) — куда вернуть экран,
     * если жест отменён. Берётся отсюда, а не со style в начале жеста: при
     * быстром повторе там лежало бы наше же промежуточное значение.
     */
    parkedTransform: string;
  };

/** Живой экран под жестом и что вернуть ему после. */
export type LiveLayer = {
  el: HTMLElement;
  dim: HTMLDivElement;
  /** Куда вернуть экран при отмене (parkedTransform). */
  parkedTransform: string;
};

/**
 * Вывести живой экран из-под уходящего (preview.live). Он припаркован за
 * краем `transform`ом (App, Shell) — на время жеста `transform` наш:
 * параллакс, как у клона. Раскладка, прокрутка ленты и страниц, шапки,
 * веб-панель — его собственные, с первого кадра.
 *
 * `prev` — слой прошлого жеста, если тот не успел вернуть экран на парковку
 * (быстрый повтор): берём его же — второе затемнение осталось бы висеть
 * навсегда. Вне компонента — ради проверки в браузере, где сам жест не
 * включается (CLAUDE.md, грабли 14).
 */
export function openLiveLayer(
  prev: LiveLayer | null,
  el: HTMLElement,
  parkedTransform: string,
  width: number,
): LiveLayer {
  if (prev && prev.el !== el) closeLiveLayer(prev);
  let layer = prev && prev.el === el ? prev : null;
  if (!layer) {
    const dim = document.createElement('div');
    dim.setAttribute('aria-hidden', 'true');
    // Затемнение — как у клона: 12 % в начале жеста, ноль у конца. Внутри
    // экрана, над всем его содержимым: экран изолирован (`isolation`), и
    // уровень выше его панелей (30–40).
    dim.style.cssText = 'position:absolute;inset:0;z-index:1000;pointer-events:none;'
      + 'background:rgba(0,0,0,0.12);';
    el.appendChild(dim);
    layer = { el, dim, parkedTransform };
  }
  el.style.willChange = 'transform';
  paintUnderLayer(el, 0, width, false);
  return layer;
}

/**
 * Обрезка слоя под уходящим экраном — по левому краю уходящего.
 *
 * 🔴 Уходящий экран больше не делают непрозрачным (`var(--canvas)`, как было
 * до 2026-10-05): на «Авроре 2» и «Космосе» небо — общий слой под всеми
 * экранами (App), и непрозрачный лист закрывал его в первом же кадре жеста.
 * Вместо этого то, что под ним, видно только левее его края — слева от
 * пальца, — и сквозь прозрачный экран ничего не просвечивает.
 *
 * Слой сдвинут на (−P + p·P)·W, край уходящего экрана — на p·W; в
 * координатах слоя край стоит на W·(P + p·(1 − P)), справа отрезаем
 * остальное. Обрезка и сдвиг линейны по p, поэтому при доводе один и тот же
 * переход ведёт их вместе, без щели на стыке.
 */
function underClip(progress: number, width: number): string {
  return `inset(0 ${Math.max(0, width * (1 - PARALLAX) * (1 - progress))}px 0 0)`;
}

/** Переход сдвига и обрезки слоя под жестом. */
function underTransition(settling: boolean): string {
  return settling
    ? `transform ${SETTLE_MS}ms ${SETTLE_EASING}, clip-path ${SETTLE_MS}ms ${SETTLE_EASING}`
    : 'none';
}

/** Положение слоя под жестом на кадре (`progress` 0…1): сдвиг и обрезка. */
export function paintUnderLayer(el: HTMLElement, progress: number, width: number, settling: boolean): void {
  el.style.transform = `translate3d(${(-PARALLAX + progress * PARALLAX) * width}px, 0, 0)`;
  el.style.clipPath = underClip(progress, width);
  el.style.transition = underTransition(settling);
}

/** Положение живого экрана на кадре жеста (`progress` 0…1). */
export function paintLiveLayer(layer: LiveLayer, progress: number, width: number, settling: boolean): void {
  paintUnderLayer(layer.el, progress, width, settling);
  layer.dim.style.opacity = String(1 - progress);
  layer.dim.style.transition = settling ? `opacity ${SETTLE_MS}ms ${SETTLE_EASING}` : 'none';
}

/**
 * Вернуть живой экран на парковку — жест отменён. Ровно как на парковке:
 * сдвиг из App, без наших служебных свойств — иначе вкладки при каждой
 * следующей парковке выезжали бы за 260 мс, а will-change держал бы слой
 * постоянно.
 */
export function closeLiveLayer(layer: LiveLayer | null): void {
  if (!layer) return;
  layer.dim.remove();
  layer.el.style.transform = layer.parkedTransform;
  layer.el.style.clipPath = '';
  layer.el.style.transition = '';
  layer.el.style.willChange = '';
}

type Gesture = {
  startX: number;
  startY: number;
  startedAt: number;
  lastX: number;
  width: number;
  mode: 'pending' | 'horizontal' | 'cancelled';
};

/**
 * Интерактивный iOS edge-pop для SPA внутри одного WKWebView.
 *
 * UINavigationController здесь не видит React-экраны как отдельные view
 * controllers, поэтому системный interactivePopGestureRecognizer применить
 * напрямую нельзя. Повторяем его визуальную модель: верхний экран следует за
 * пальцем вправо, предыдущий открывается из-под него с лёгким параллаксом,
 * отпускание завершает переход либо возвращает экран на место.
 *
 * Во время жеста React намеренно не участвует. Раньше каждый кадр писался
 * через setState, а useLayoutEffect с зависимостью от объекта motion успевал
 * отработать cleanup и setup: will-change и box-shadow снимались и ставились
 * заново 60 раз в секунду, то есть композитор пересоздавал слой с тяжёлым
 * арабским текстом на каждом кадре. Теперь состояние меняется дважды за жест
 * (смонтировать preview, снять его), а положение пишется прямо в style
 * готовых слоёв.
 *
 * Второе отличие от прежней версии: preview монтируется не на touchstart, а
 * только когда движение опознано как горизонтальное. Прежде любое вертикальное
 * касание в 22-пиксельной полосе у левого края вставляло в DOM полную копию
 * предыдущего экрана и тут же её выбрасывало — прокрутка у левого края платила
 * за это потерянными кадрами.
 */
export function IosEdgeBackGesture({
  onBack,
  currentScreenRef,
  preview,
}: {
  onBack: () => void;
  currentScreenRef: RefObject<HTMLDivElement | null>;
  preview?: IosBackPreview | null;
}) {
  const enabled = Capacitor.getPlatform() === 'ios';
  const edgeRef = useRef<HTMLDivElement>(null);
  const previewShellRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewDimRef = useRef<HTMLDivElement>(null);
  const onBackRef = useRef(onBack);
  const previewRef = useRef(preview);
  const gestureRef = useRef<Gesture | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const pendingXRef = useRef(0);
  // armed управляет только монтированием preview — не положением.
  const [armed, setArmed] = useState(false);

  onBackRef.current = onBack;
  previewRef.current = preview;

  /** Живой экран под жестом (preview.live), пока жест идёт. */
  const liveRef = useRef<LiveLayer | null>(null);
  /** Отменённый жест ещё доводит экран на место — слои не разобраны. */
  const cancelPendingRef = useRef(false);
  /** Подтверждённый жест доводит экран до конца — onBack строго один раз. */
  const committingRef = useRef(false);

  // Клон уходящего экрана вставляем узлом, а не строкой: innerHTML заставлял
  // WebKit заново разбирать сотни килобайт разметки в первом кадре жеста.
  useLayoutEffect(() => {
    const viewport = previewViewportRef.current;
    const shell = previewShellRef.current;
    const captured = preview;
    if (!armed || !viewport || !captured || !('node' in captured)) return;
    viewport.appendChild(captured.node);
    viewport.scrollTop = captured.scrollY;
    // Fixed-элементы (меню, мини-плеер, шапка) внутри transform+scroll
    // viewport перестают быть «относительно экрана» и якорятся к низу
    // всего прокрученного клона — меню уезжает за кадр или в середину.
    // Поднимаем их на shell: он равен экрану и не скроллится, параллакс
    // остаётся общим.
    //
    // 🔴 Панели именно ОДАЛЖИВАЕМ, а не забираем: клон переиспользуется —
    // один и тот же клон показывается на каждом жесте с этого экрана. Если
    // в очистке просто удалить поднятые узлы, они пропадут из клона
    // навсегда — и уже второй жест (например, после отменённого свайпа,
    // самый частый исход) покажет предпросмотр без панелей.
    // Ищем по самому признаку — `position: fixed` в инлайновом стиле, — а не
    // по списку подписей. Прежний селектор перечислял `nav[aria-label=
    // "Разделы"]` и «Звучит сейчас»: переименование подписи молча выключило
    // бы правку, и никакой тест этого не поймал бы. Заодно так находятся ВСЕ
    // закреплённые элементы, а не три перечисленных: слои темы (бумага,
    // аврора) и крышка под системной строкой страдали от того же дефекта, и
    // на этих темах предпросмотр терял фон, показывая плоскую заливку.
    // `.screen-header` добавлен отдельно: он закреплён классом, не стилем.
    const lifted: HTMLElement[] = [];
    if (shell) {
      captured.node
        .querySelectorAll<HTMLElement>(
          '[style*="position: fixed"], [style*="position:fixed"], .screen-header',
        )
        .forEach(el => {
          // 🔴 КОПИРУЕМ, а не переносим.
          //
          // Раньше узел переносился в `shell`, а в очистке возвращался на
          // место через `parent.insertBefore(el, next)`. На телефоне владельца
          // это уронило приложение: `NotFoundError: The object can not be
          // found here` — так `insertBefore` отвечает, когда запомненный сосед
          // больше не лежит в том же родителе. Сценарий: включить суру,
          // открыть плеер, выйти — по дороге меняется и клон, и набор панелей
          // (мини-плеер появляется вместе со звуком).
          //
          // Копия убирает саму возможность такой ошибки: возвращать нечего,
          // оригинал из клона никуда не девается, и клон остаётся пригодным
          // для следующих жестов. Снять копию нельзя «не туда» — `remove()`
          // не бросает исключение, даже если узел уже отцеплен.
          //
          // Оригинал при этом остаётся внутри прокручиваемого слоя и лежит
          // далеко ниже видимой области, под `overflow: hidden`, — его не
          // видно.
          const копия = el.cloneNode(true) as HTMLElement;
          shell.appendChild(копия);
          lifted.push(копия);
        });
    }

    // Первый кадр параллакса ставим здесь, а не в теле рендера: ширину знает
    // только активный жест, и читать её при рендере было бы нечисто.
    if (shell) {
      const width = gestureRef.current?.width ?? window.innerWidth;
      paintUnderLayer(shell, 0, width, false);
    }
    return () => {
      // Снимаем именно копии — оригиналы в клоне мы не трогали.
      lifted.forEach(копия => { копия.remove(); });
      if (captured.node.parentNode === viewport) viewport.removeChild(captured.node);
    };
  }, [armed, preview]);

  useEffect(() => () => {
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    if (motionFrameRef.current != null) cancelAnimationFrame(motionFrameRef.current);
    // Экран ушёл. Если это возврат к вкладкам — React уже снял их парковку:
    // убираем только своё (затемнение, обрезку, служебные свойства),
    // `transform` не трогаем — его выставил React. Если же вкладки всё ещё
    // припаркованы (жест отменён, и посреди довода тапом ушли на другой
    // экран «поверх»), возвращаем их на парковку целиком: иначе они так и
    // стояли бы со сдвигом −28 % и просвечивали сквозь прозрачный экран на
    // космических темах.
    const layer = liveRef.current;
    liveRef.current = null;
    if (layer) {
      if (layer.el.dataset.appScreen === 'parked') {
        closeLiveLayer(layer);
      } else {
        layer.dim.remove();
        layer.el.style.clipPath = '';
        layer.el.style.transition = '';
        layer.el.style.willChange = '';
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const edge = edgeRef.current;
    if (!edge) return;

    /** Положение кадра. Пишем только composited-свойства. */
    const paint = (x: number, width: number, settling: boolean) => {
      const screen = currentScreenRef.current;
      const shell = previewShellRef.current;
      const dim = previewDimRef.current;
      const transition = settling ? `transform ${SETTLE_MS}ms ${SETTLE_EASING}` : 'none';
      const progress = Math.min(1, x / Math.max(1, width));
      if (screen) {
        screen.style.transform = `translate3d(${x}px, 0, 0)`;
        screen.style.transition = transition;
      }
      const layer = liveRef.current;
      if (layer) paintLiveLayer(layer, progress, width, settling);
      // Клон прежнего экрана — так же: сдвиг и обрезка по краю уходящего.
      if (shell) paintUnderLayer(shell, progress, width, settling);
      if (dim) {
        dim.style.background = `rgba(0,0,0,${0.12 * (1 - progress)})`;
        dim.style.transition = settling ? `background ${SETTLE_MS}ms ${SETTLE_EASING}` : 'none';
      }
    };

    /** Слой создаём один раз за жест, а не на каждом кадре. */
    const openLayer = () => {
        const screen = currentScreenRef.current;
      if (!screen) return;
      screen.style.willChange = 'transform';
      screen.style.boxShadow = '-10px 0 28px rgba(0,0,0,0.16)';
      // На космических темах экран прозрачный — сквозь него видно общее
      // небо. Прежде на время жеста он становился непрозрачным (иначе сквозь
      // него просвечивал экран под ним: «страница суры становится
      // прозрачной»), но тогда небо пропадало в первом кадре. Теперь то, что
      // под ним, обрезано по его левому краю (underClip) — фон не нужен.
    };

    /** Живой экран — на свой слой под жестом (см. openLiveLayer). */
    const openLive = (width: number): boolean => {
      const captured = previewRef.current;
      if (!captured || !('live' in captured)) return false;
      const el = captured.live();
      if (!el) return false;
      liveRef.current = openLiveLayer(liveRef.current, el, captured.parkedTransform, width);
      return true;
    };

    /** Вернуть живой экран на парковку — жест отменён. */
    const closeLive = () => {
      closeLiveLayer(liveRef.current);
      liveRef.current = null;
    };

    const closeLayer = () => {
      closeLive();
      const screen = currentScreenRef.current;
      if (!screen) return;
      screen.style.transform = '';
      screen.style.transition = '';
      screen.style.willChange = '';
      screen.style.boxShadow = '';
    };

    const cancelFrame = () => {
      if (motionFrameRef.current != null) {
        cancelAnimationFrame(motionFrameRef.current);
        motionFrameRef.current = null;
      }
    };

    const finishCancel = () => {
      // Довод подтверждённого жеста не отменяется ничем: `touchcancel` от
      // касания, которое onTouchStart пропустил, снял бы его страховочный
      // таймер, и `committingRef` залип бы навсегда (ревью 2026-10-06).
      if (committingRef.current) return;
      const gesture = gestureRef.current;
      const width = gesture?.width ?? window.innerWidth;
      const wasHorizontal = gesture?.mode === 'horizontal';
      gestureRef.current = null;
      cancelFrame();
      if (!wasHorizontal) {
        // Жест так и не стал горизонтальным: ничего не монтировали и не
        // двигали, снимать нечего. Таймер прошлого жеста не трогаем — он
        // доведёт или разберёт его слой сам.
        return;
      }
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
      paint(0, width, true);
      cancelPendingRef.current = true;
      settleTimerRef.current = window.setTimeout(() => {
        cancelPendingRef.current = false;
        closeLayer();
        setArmed(false);
      }, SETTLE_MS);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      // Подтверждённый жест доводит экран до конца: новые касания у края
      // ждут. Иначе они сняли бы запасной таймер, а слушатель
      // transitionend первого жеста остался бы — и отменённый второй жест
      // всё равно увёл бы экран назад, а подтверждённый позвал бы onBack
      // дважды (двойной history.back()).
      if (committingRef.current) return;
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
      // Новое касание посреди возврата отменённого жеста: таймер, который
      // разобрал бы слои, мы только что сняли — разбираем сейчас. Иначе
      // экран и вкладки под ним остались бы с нашими стилями навсегда.
      if (cancelPendingRef.current) {
        cancelPendingRef.current = false;
        closeLayer();
        setArmed(false);
      }
      const touch = event.touches[0];
      gestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: performance.now(),
        lastX: touch.clientX,
        // Ширину снимаем один раз за жест: чтение window.innerWidth в теле
        // рендера заставляло WebKit считать лейаут на каждом кадре.
        width: window.innerWidth,
        mode: 'pending',
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      gesture.lastX = touch.clientX;

      if (gesture.mode === 'pending') {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.max(0, dx)) {
          gesture.mode = 'cancelled';
          finishCancel();
          return;
        }
        if (dx > 6 && dx > Math.abs(dy) * 1.15) {
          gesture.mode = 'horizontal';
          if (!previewRef.current) {
            // Возвращаться некуда — жест не начинаем, прокрутку не забираем.
            gesture.mode = 'cancelled';
            gestureRef.current = null;
            return;
          }
          openLayer();
          // Живой экран — сразу на свой слой; клон — смонтировать.
          if (!openLive(gesture.width)) setArmed(true);
        }
      }
      if (gesture.mode !== 'horizontal') return;

      // Не отдаём горизонтальный жест overscroll'у WKWebView.
      event.preventDefault();
      pendingXRef.current = Math.min(gesture.width, Math.max(0, dx));
      // iPhone может присылать touchmove чаще частоты экрана. Оставляем ровно
      // одно обновление на animation frame — экран следует за пальцем без
      // дрожи. Пишем напрямую в style: React здесь не участвует.
      if (motionFrameRef.current == null) {
        motionFrameRef.current = requestAnimationFrame(() => {
          motionFrameRef.current = null;
          paint(pendingXRef.current, gesture.width, false);
        });
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (gesture.mode !== 'horizontal') {
        gestureRef.current = null;
        cancelFrame();
        return;
      }
      const width = gesture.width;
      gestureRef.current = null;
      cancelFrame();
      const touch = event.changedTouches[0];
      const dx = Math.max(0, (touch?.clientX ?? gesture.lastX) - gesture.startX);
      const elapsed = Math.max(1, performance.now() - gesture.startedAt);
      const velocity = dx / elapsed;
      const commit = dx / Math.max(1, width) >= COMMIT_PROGRESS
        || (dx >= FLICK_DISTANCE && velocity >= FLICK_VELOCITY);

      if (!commit) {
        gestureRef.current = { ...gesture, mode: 'horizontal' };
        finishCancel();
        return;
      }

      const screen = currentScreenRef.current;
      let committed = false;
      committingRef.current = true;
      const commitBack = () => {
        if (committed) return;
        committed = true;
        if (settleTimerRef.current != null) {
          window.clearTimeout(settleTimerRef.current);
          settleTimerRef.current = null;
        }
        screen?.removeEventListener('transitionend', onSettleEnd);
        // Повторное появление подавляет сам App: переход, опознанный как
        // возврат, не ставит класс анимации. Прежний приём с атрибутом на
        // <html> давал ровно тот дефект, от которого защищал — снятие
        // атрибута перезапускало анимацию через два кадра после жеста.
        //
        // ВАЖНО: слой НЕ разбираем. Прежде здесь стоял closeLayer(), и он
        // обнулял transform уходящего экрана до того, как приезжал новый.
        // React батчит обновление и коммитит его отдельной задачей, а
        // между задачами браузер вправе отрисовать кадр — в нём уехавший
        // вправо экран рывком возвращался на место и закрывал собой всё.
        // Для экранов с history.back() промежуток гарантирован: popstate
        // приходит отдельной задачей. Это и есть «экран появляется,
        // исчезает и дёргается».
        //
        // Разбирать слой руками не нужно вовсе: у Shell уникальный key, и
        // при смене экрана React размонтирует всё поддерево вместе с этим
        // компонентом — узел с застрявшим transform просто исчезает, а
        // новый рождается чистым.
        onBackRef.current();
        // Страховка на случай, если экран так и не сменился (например,
        // history.back() упёрся в начало истории): вернуть страницу на
        // место, иначе она останется висеть за правым краем. setTimeout, а
        // не rAF — тот не тикает в свёрнутом WebView. Живой экран под ним
        // при этом возвращается на парковку; если же возврат состоялся,
        // этот компонент размонтирован вместе с экраном и таймер снят.
        settleTimerRef.current = window.setTimeout(() => {
          committingRef.current = false;
          closeLayer();
          setArmed(false);
        }, 400);
      };
      const onSettleEnd = (settleEvent: TransitionEvent) => {
        if (settleEvent.propertyName === 'transform') commitBack();
      };
      screen?.addEventListener('transitionend', onSettleEnd);
      paint(width, width, true);
      // transitionend может не прийти при системном Reduce Motion или если
      // WKWebView потерял кадр. Резерв позже, а не раньше CSS-перехода.
      settleTimerRef.current = window.setTimeout(commitBack, SETTLE_MS + 80);
    };

    edge.addEventListener('touchstart', onTouchStart, { passive: true });
    edge.addEventListener('touchmove', onTouchMove, { passive: false });
    edge.addEventListener('touchend', onTouchEnd, { passive: true });
    edge.addEventListener('touchcancel', finishCancel, { passive: true });
    return () => {
      edge.removeEventListener('touchstart', onTouchStart);
      edge.removeEventListener('touchmove', onTouchMove);
      edge.removeEventListener('touchend', onTouchEnd);
      edge.removeEventListener('touchcancel', finishCancel);
    };
  }, [enabled, currentScreenRef]);

  if (!enabled) return null;

  return (
    <>
      {armed && preview && (
        <div
          ref={previewShellRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            // Без своего фона: у клона он свой (фон темы экрана), а на
            // космических темах экраны прозрачны, и под клоном должно быть
            // видно общее небо (App), а не заливка.
            background: 'transparent',
            willChange: 'transform',
          }}
        >
          <div
            ref={previewViewportRef}
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              transform: 'translateZ(0)',
              // Явный уровень нужен поднятым элементам: слои темы с z-index 0
              // обязаны остаться ПОД содержимым, а панели с 30–40 и верхний
              // слой авроры с 900 — над ним. Без него всё решал бы порядок
              // вставки, и фон темы лёг бы поверх текста.
              zIndex: 1,
            }}
          />
          <div
            ref={previewDimRef}
            style={{
              position: 'absolute',
              inset: 0,
              // Выше всего поднятого: панели лежат на 30–40, верхний слой
              // авроры на 900. Иначе копия меню светилась бы ярче своего
              // экрана, а затемнение не накрыло бы аврору.
              zIndex: 1000,
              background: 'rgba(0,0,0,0.12)',
            }}
          />
        </div>
      )}

      <div
        ref={edgeRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          zIndex: 1000,
          top: 0,
          bottom: 0,
          left: 0,
          width: `${EDGE_WIDTH}px`,
          touchAction: 'pan-y',
        }}
      />
    </>
  );
}
