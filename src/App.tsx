import {
  useState, useEffect, useLayoutEffect, useRef, lazy, Suspense,
  type ReactNode,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { useTheme, themeMode } from './hooks/useTheme';
import { SurahPicker } from './screens/SurahPicker';
import type { DocumentId } from './screens/DocumentScreen';

import { CosmicLayer } from './components/CosmicLayer';
import { StatusBarScrim } from './components/StatusBarScrim';
import { AudioErrorPlate } from './components/AudioErrorPlate';
import { MiniPlayer } from './components/MiniPlayer';
import {
  IosEdgeBackGesture,
  type IosBackPreview,
} from './components/IosEdgeBackGesture';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar, TAB_ORDER, type TabId } from './components/TabBar';
import { TabPager } from './components/TabPager';
import { applyHighlightVars } from './lib/audioPrefs';
import { applyPaletteToDocument } from './lib/tajweedPalette';
import { syncStatusBarToTheme } from './lib/nativeStatusBar';
import { runLaunchReveal } from './lib/launchReveal';
import { initNativeTabBar } from './lib/nativeTabBar';
import { runNavTransition } from './lib/navTransition';
import { wireAndroidBackButton } from './lib/androidBack';
import { warmQuranSources } from './content/quran-sources-lazy';
import { readActiveId, readCities } from './lib/prayerCities';
import { startPrayerAlarmScheduler } from './lib/prayerNotifications';
import type { AzkarCategoryId } from './lib/azkar';
import { reconcile, stepsToQuranHome } from './lib/screenStack';

/*
 * Экраны, кроме списка сур, грузятся отдельными чанками.
 *
 * Раньше все 11 экранов лежали в главном бандле, и WKWebView разбирал их
 * до первого кадра вместе с 3.7 МБ текста Корана. Список сур — первое, что
 * человек видит, поэтому он остаётся обычным импортом; всё остальное
 * приезжает по факту перехода. Экспорты именованные, поэтому default
 * подставляем вручную.
 */
/** Загрузчик модуля суры отдельно от lazy: его же зовёт прогрев после
 *  запуска (warmReading), и первое открытие суры не ждёт сеть/разбор. */
const loadSurahScreen = () => import('./screens/SurahScreen');
const SurahScreen = lazy(() => loadSurahScreen().then(m => ({ default: m.SurahScreen })));
const AzkarScreen = lazy(() => import('./screens/AzkarScreen').then(m => ({ default: m.AzkarScreen })));
const AzkarCategoryScreen = lazy(() => import('./screens/AzkarCategoryScreen').then(m => ({ default: m.AzkarCategoryScreen })));
const PlayerScreen = lazy(() => import('./screens/PlayerScreen').then(m => ({ default: m.PlayerScreen })));
const BookmarksScreen = lazy(() => import('./screens/BookmarksScreen').then(m => ({ default: m.BookmarksScreen })));
const PrayerTimesScreen = lazy(() => import('./screens/PrayerTimesScreen').then(m => ({ default: m.PrayerTimesScreen })));
const QiblaScreen = lazy(() => import('./screens/QiblaScreen').then(m => ({ default: m.QiblaScreen })));
const AccountScreen = lazy(() => import('./screens/AccountScreen').then(m => ({ default: m.AccountScreen })));
const DocumentScreen = lazy(() => import('./screens/DocumentScreen').then(m => ({ default: m.DocumentScreen })));

/**
 * Навигация приложения — два уровня.
 *
 *   • `tabs` — корневые разделы, переключает нижняя панель.
 *   • Экраны «поверх» (сура, закладки, лента азкаров) — панель вкладок
 *     скрыта, назад ведёт плавающий хедер самого экрана.
 *
 * В прежнем QuranIng разделов было два и они жили горизонтальной слайд-парой:
 * контейнер шириной 200% с translateX, оба экрана всегда смонтированы.
 * С четырьмя разделами приём не масштабировался, и активный раздел стал
 * ровно один. Теперь разделов три — «Плеер», «Коран», «Азкары» (решения
 * владельца 2026-10-04 и 2026-10-05), и ради свайпа между ними все вкладки
 * снова живут в DOM — но не слайд-парой:
 * скрытая лежит отдельным слоем (components/TabPager.tsx), потому что
 * transform на контейнере ломал fixed-шапки. Окно по-прежнему прокручивает
 * только видимую вкладку, поэтому позиция каждой хранится вручную
 * (tabScrollRef ниже).
 */
type Screen =
  | { name: 'tabs'; tab: TabId }
  | { name: 'azkar-category'; category: AzkarCategoryId }
  | { name: 'bookmarks' }
  | { name: 'account' }
  | { name: 'surah'; number: number; initialAyah?: number }
  // Кибла ушла из вкладок: открывается с экрана намаза и имеет свою
  // запись в истории, поэтому системная «назад» возвращает к намазу.
  // Намаз — отдельный экран по кнопке на главной (владелец 2026-10-04: в
  // нижнем меню только «Коран» и «Азкары»), со своей записью в истории.
  | { name: 'prayer' }
  | { name: 'qibla' }
  // Плеер — отдельный экран, а не лист поверх: слушают Коран иначе, чем
  // читают, и у слушания своя запись в истории. Что именно звучит, экран
  // не хранит — это состояние общего аудио, иначе оно разошлось бы с
  // полоской на вкладках.
  | { name: 'player' }
  // Юридические документы — вложенный экран, а не ссылка наружу: они
  // лежат в пакете и обязаны открываться без интернета.
  | { name: 'document'; doc: DocumentId };

/**
 * Заглушка на время подгрузки чанка экрана.
 *
 * Пустой блок в полную высоту, без спиннера: чанки лежат в пакете
 * приложения и приезжают за десятки миллисекунд, а мелькнувший индикатор
 * читается как сбой. Высоту держим, чтобы фон темы не схлопывался.
 */
function ScreenFallback() {
  return <div style={{ minHeight: '100dvh' }} aria-hidden="true" />;
}

const INITIAL_SCREEN: Screen = { name: 'tabs', tab: 'quran' };

export default function App() {
  const { theme, setTheme } = useTheme();
  /**
   * Стек экранов — источник истины. History API от него производен.
   *
   * Раньше в состоянии жил ровно один `screen`, а история была
   * единственной памятью о том, откуда пришли. Из этого следовали три
   * дефекта:
   *
   *   • стрелка «назад» из режимов чтения делала `pushState`, а не возврат
   *     (она обязана вести к выбору суры, а не по истории), поэтому цикл
   *     «вошёл в суру → вышел» добавлял ДВЕ записи и стек рос без предела;
   *   • метка «мы в корне» оставалась только на записи 0, и аппаратная
   *     «назад» на Android с главного экрана проваливалась обратно в суру
   *     вместо сворачивания приложения;
   *   • жест возврата и кнопка вели себя по-разному на внешне одинаковых
   *     экранах: у части `goBack`, у части `goQuranHome`.
   *
   * Со стеком всё три уходят структурно. В историю кладётся только глубина;
   * `popstate` приводит стек к ней идемпотентно, поэтому флаги «не
   * реагировать на собственный переход» не нужны — главный источник ошибок
   * в таких схемах снимается дизайном.
   */
  const [stack, setStack] = useState<Screen[]>([INITIAL_SCREEN]);
  const screen = stack[stack.length - 1];
  /**
   * Синхронное зеркало стека.
   *
   * Нужно потому, что `history.pushState` — побочный эффект, а обновляющая
   * функция `setStack` обязана быть чистой: в строгом режиме React вызывает
   * её дважды, и запись истории добавилась бы два раза. Ref даёт актуальную
   * длину прямо в обработчике события, до того как React перерисует.
   * Переходы снимками (lib/navTransition.ts) откладывают перерисовку на
   * кадр, поэтому зеркало обновляется сразу, а `setStack` — внутри
   * перехода.
   */
  const stackRef = useRef<Screen[]>([INITIAL_SCREEN]);
  const [backPreview, setBackPreview] = useState<IosBackPreview | null>(null);
  /**
   * Проигрывать ли короткое появление у следующего экрана.
   *
   * Только на переходах ВПЕРЁД. Возврат — свайпом, кнопкой или системной
   * «назад» — не анимируется: экран, к которому вернулись, уже был виден
   * человеку, и повторное проявление читается как мигание. На первом кадре
   * приложения тоже не анимируем: там ещё стоит нативная заставка.
   *
   * Раньше это решалось атрибутом `data-ios-edge-back-commit` на <html> и
   * правилом `animation: none` в CSS. Приём давал ровно тот дефект, от
   * которого защищал: снятие атрибута меняло вычисленное `animation-name`
   * с `none` на имя, и по спецификации CSS Animations запускалась НОВАЯ
   * анимация — через пару кадров после жеста экран гас до 72% и проявлялся
   * заново.
   */
  const [animateEnter, setAnimateEnter] = useState(false);
  const quranHomePreviewRef = useRef<IosBackPreview | null>(null);
  const isCosmic = themeMode(theme) === 'cosmic';
  const cosmicVariant = theme === 'cosmos'
    ? 'cosmos' as const
    : theme === 'aurora2' ? 'aurora2' as const : 'aurora' as const;
  const isDotted = theme === 'aurora';

  // ── History-API routing ──────────────────────────────────────────────────
  // Каждый переход вперёд кладёт в history запись со следующим Screen.
  // Системный «назад» (edge-swipe на iOS, аппаратная кнопка на Android,
  // кнопка браузера) прилетает как popstate и превращается обратно в
  // setScreen — отдельной проводки не нужно.  Кнопки «назад» внутри
  // экранов обычно зовут goBack() (= history.back()). Исключение — экран
  // суры: его стрелка всегда ведёт к выбору суры.
  //
  // Переключение вкладки — тоже переход вперёд: системный «назад»
  // возвращает на предыдущую вкладку, а не выбрасывает из приложения
  // сразу.  На Android это ожидаемое поведение.
  /**
   * Переход между экранами.
   *
   * Всегда вперёд: кладёт экран на вершину стека и добавляет запись в
   * историю. Возвраты идут через `goBack` и `goQuranHome` — они не
   * добавляют записей, а снимают их.
   */
  const navigate = (next: Screen) => {
    // Позицию уходящей вкладки снимаем ЗДЕСЬ, а не в эффекте: к моменту
    // эффекта новый экран уже мог сбросить скролл (SurahScreen делает
    // это, когда восстанавливать нечего), и мы записали бы ноль.
    // Тот же экран уже наверху — второй тап по той же строке (двойной тап,
    // дребезг) не открывает суру второй раз поверх первой.
    const top = stackRef.current[stackRef.current.length - 1];
    if (JSON.stringify(top) === JSON.stringify(next)) return;

    rememberTabScroll();

    // Для интерактивного iOS edge-pop сохраняем настоящий DOM уходящего
    // экрана. Во время жеста он будет виден под текущим — как предыдущий
    // UIViewController под верхним экраном UINavigationController.
    // Клонируем узел, а не сериализуем в outerHTML: строка потом заново
    // разбиралась WebKit'ом в первом кадре жеста, и это была самая дорогая
    // часть свайпа назад. Атрибут data-app-screen с копии снимаем, иначе
    // следующий querySelector нашёл бы клон вместо настоящего экрана.
    //
    // Клон нужен только экранам «поверх»: у корневых вкладок нет жеста
    // возврата от края, и preview им показывать негде. Раньше клонировали
    // всегда — и выход из суры к списку тратил длинную синхронную задачу
    // ровно в кадре перехода, копируя сотни статей с span'ом на каждое
    // слово. Это и ощущалось как рывок при нажатии «назад».
    // Поле поиска главной остаётся в DOM (вкладка паркуется, а не
    // размонтируется): без явного снятия фокуса клавиатура iOS могла бы
    // остаться открытой поверх суры.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();

    const needsPreview = next.name !== 'tabs';
    const node = needsPreview
      ? document.querySelector<HTMLElement>('[data-app-screen="current"]')
      : null;
    let captured: IosBackPreview | null = null;
    if (node) {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-app-screen');
      // Класс анимации появления с копии тоже снимаем. Вставка элемента с
      // непустым animation-name запускает анимацию заново — и preview под
      // пальцем гас до 72% и проявлялся. Тот самый дефект, от которого
      // избавились на самом экране, переезжал в его копию.
      clone.classList.remove('app-screen-enter');
      // Скрытую вкладку (TabPager держит обе в DOM) из копии убираем: жест
      // поднимает закреплённые элементы копии на свой слой, и шапка скрытой
      // вкладки, оторванная от скрывающего её родителя, всплыла бы в
      // предпросмотре поверх видимой.
      clone.querySelectorAll('[data-tab-parked]').forEach(parkedTab => parkedTab.remove());
      captured = { node: clone, scrollY: window.scrollY };
    }
    if (screen.name === 'tabs' && screen.tab === 'quran' && captured) {
      quranHomePreviewRef.current = captured;
    }
    const returnsToQuran = next.name === 'surah';
    setBackPreview(
      returnsToQuran
        ? (quranHomePreviewRef.current ?? captured)
        : captured,
    );

    edgeBackRef.current = false;
    const current = stackRef.current;
    history.pushState({ depth: current.length }, '');
    // Экран «поверх» выезжает справа, как в UINavigationController
    // (lib/navTransition.ts). Смена вкладки — без выезда, коротким
    // проявлением, как и там, где View Transitions нет.
    // Зеркало стека — сразу, перерисовка — внутри перехода (она там
    // откладывается на кадр). Иначе второй тап в том же кадре прочитал бы
    // старую глубину и записал в историю ту же.
    const nextStack = [...current, next];
    stackRef.current = nextStack;
    // В колбэке — текущее зеркало, а не замкнутое значение: если до
    // колбэка успел прийти popstate, побеждает самое свежее состояние,
    // в каком бы порядке браузер ни вызвал колбэки.
    const animated = runNavTransition(next.name === 'tabs' ? 'none' : 'push', () => {
      setAnimateEnter(false);
      setStack(stackRef.current);
    });
    if (!animated) setAnimateEnter(true);
  };

  /**
   * Возврат свайпом от края уже показан жестом. Метка говорит обработчику
   * popstate не проигрывать его второй раз снимками.
   */
  const edgeBackRef = useRef(false);
  const edgeBack = () => { edgeBackRef.current = true; goBack(); };
  const edgeQuranHome = () => { edgeBackRef.current = true; goQuranHome(); };

  /** Шаг назад: снимаем одну запись истории, стек выровняет popstate. */
  const goBack = () => {
    rememberTabScroll();
    setAnimateEnter(false);
    history.back();
  };

  /**
   * Возврат к выбору суры из режимов чтения.
   *
   * Не переход вперёд: ищем в стеке ближайшую снизу запись «вкладка Коран»
   * и снимаем ровно столько записей истории, сколько до неё. Раньше здесь
   * был `pushState`, и выход из суры добавлял запись вместо того, чтобы
   * её снять.
   */
  const goQuranHome = () => {
    rememberTabScroll();
    setAnimateEnter(false);
    // Открыт попап — его запись лежит сверху. Один шаг назад закроет его,
    // а не уведёт с экрана; арифметику по глубине в этот момент применять
    // нельзя, она считает только экраны.
    if (history.state?.sheet) {
      history.back();
      return;
    }
    // Обратный цикл, а не findLastIndex: цель сборки — ES2020, где его нет.
    const steps = stepsToQuranHome(stackRef.current);
    if (steps > 0) {
      history.go(-steps);
      return;
    }
    // steps === 0 — либо мы уже на выборе суры, либо его нет в стеке
    // (состояние восстановилось из чужой истории). Во втором случае идём
    // вперёд, в первом делать нечего.
    if (screen.name !== 'tabs' || screen.tab !== 'quran') {
      navigate({ name: 'tabs', tab: 'quran' });
    }
  };

  useEffect(() => {
    // Привязываем текущую запись истории к стартовому экрану, чтобы
    // последующие history.back() не откатились в состояние, оставшееся
    // от прошлой перезагрузки или hot-reload'а.
    // `root: true` помечает самую первую запись истории.  По ней
    // обработчик аппаратной «назад» на Android отличает «мы в корне,
    // выходить» от «есть куда возвращаться» — см. lib/androidBack.ts.
    // Глубина 0 помечает корень. По ней обработчик аппаратной «назад» на
    // Android отличает «мы в корне, сворачиваться» от «есть куда
    // возвращаться» — см. lib/androidBack.ts. Раньше признаком был флаг
    // `root`, и он оставался только на записи 0, хотя корневым экраном
    // приложение считало любую вкладку.
    history.replaceState({ depth: 0 }, '');
    const onPop = (e: PopStateEvent) => {
      // popstate прилетает ДО перерисовки, поэтому window.scrollY здесь
      // ещё принадлежит уходящему экрану — момент снять его позицию.
      rememberTabScroll();
      setAnimateEnter(false);
      const fromEdge = edgeBackRef.current;
      edgeBackRef.current = false;
      // Запись попапа не несёт глубины и экраном не является: её обработает
      // сам попап, он закроется и снимет запись.
      if (e.state?.sheet) return;
      const depth = typeof e.state?.depth === 'number' ? e.state.depth : 0;
      const current = stackRef.current;
      const next = reconcile(current, depth, INITIAL_SCREEN);
      // Приведение идемпотентно: тот же массив означает «менять нечего».
      // На этом держится отсутствие флагов «это мой собственный переход» —
      // главного источника ошибок в подобных схемах.
      if (next === current) return;
      // Глубина оказалась больше стека — человек нажал «вперёд» в браузере
      // либо страница перезагрузилась поверх чужой истории. reconcile
      // свернул нас в корень; чиним и историю, чтобы дальше стек и глубина
      // снова совпадали.
      if (depth + 1 > current.length) history.replaceState({ depth: 0 }, '');
      // Возврат кнопкой «назад», системной «назад» Android или браузера —
      // экран уезжает вправо; свайп от края свою анимацию уже показал.
      stackRef.current = next;
      runNavTransition(fromEdge ? 'none' : 'pop', () => setStack(stackRef.current));
    };
    window.addEventListener('popstate', onPop);
    const unwireBack = wireAndroidBackButton();
    return () => {
      window.removeEventListener('popstate', onPop);
      unwireBack();
    };
  }, []);

  // Обновляем <style id="tajweed-palette">. В нём только реально
  // запрошенные в этой сессии постраничные семейства, не все 604.
  // Пересобирается на смену темы: базовая палитра переключается между
  // тёмной и светлой, иначе на светлой странице каллиграфия рисовалась
  // бы белым по белому.
  useEffect(() => { applyPaletteToDocument(); }, [theme]);

  // Переменные подсветки — на первый кадр и на каждую смену темы.
  // Светлая тема принудительно сводит стиль подсветки к 'color'
  // независимо от сохранённого выбора, поэтому результат зависит от
  // темы и пересчитывается вместе с ней.
  useEffect(() => { applyHighlightVars(theme); }, [theme]);

  // Нативный статус-бар (iOS + Android) под тему.  В вебе no-op.
  useEffect(() => { syncStatusBarToTheme(theme); }, [theme]);

  // Снять нативный сплэш после первого отрисованного кадра.  Конфиг
  // держит заставку до явного вызова (launchAutoHide: false), поэтому
  // без этого эффекта приложение зависло бы на ней — ровно та ошибка,
  // что осталась незамеченной в прежнем QuranIng.
  // Снятие заставки и анимация появления — lib/launchReveal.ts.
  useEffect(() => { runLaunchReveal(); }, []);

  // Системная панель вкладок iOS 26 (lib/nativeTabBar.ts): выяснить режим и
  // подготовить вкладки, пока экран закрыт заставкой.
  useEffect(() => { void initNativeTabBar(); }, []);

  // Прогрев чтения (2026-10-04, плавность открытия суры). Замер: первое
  // открытие Аль-Бакары — 835 мс до первого аята, повторное — 203: разница
  // — модуль экрана суры и карта аятов verses.json (1,4 МБ разбора). Берём
  // их заранее, когда заставка уже ушла и главная отрисована, — а не в
  // момент тапа. Таймер, а не rAF/idle: в WKWebView нет
  // requestIdleCallback, а rAF не тикает в фоне.
  useEffect(() => {
    const id = window.setTimeout(() => {
      // Модуль — только в нативной сборке: там он лежит в пакете. На сайте
      // неудачная загрузка чанка (плохая сеть) могла бы запомниться
      // браузером и сломать и настоящее открытие суры.
      if (Capacitor.isNativePlatform()) void loadSurahScreen().catch(() => undefined);
      // Динамически: qcf4 живёт в чанке чтения и не должен утяжелять главный.
      void import('./lib/qcf4').then(m => m.loadVersesJson()).catch(() => undefined);
    }, 1800);
    return () => window.clearTimeout(id);
  }, []);

  // Переводы Корана лежат отдельным чанком, чтобы не задерживать первый
  // кадр. Прогреваем их в простое сразу после него: к моменту, когда
  // человек откроет суру или начнёт искать, словарь обычно уже готов.
  useEffect(() => { warmQuranSources(); }, []);

  // Локальные напоминания живут независимо от вкладки «Намаз»: при каждом
  // запуске и возврате приложения обновляем ближайшие даты по основному
  // расписанию. Разрешение здесь не запрашивается — только после явного тапа
  // человека по колокольчику на экране намаза.
  useEffect(() => {
    let stop = () => {};
    let disposed = false;
    void startPrayerAlarmScheduler(() => {
      const list = readCities();
      const id = readActiveId(list);
      return list.find(city => city.id === id) ?? list[0] ?? null;
    }).then(unwire => {
      if (disposed) unwire();
      else stop = unwire;
    });
    return () => {
      disposed = true;
      stop();
    };
  }, []);

  // ── Позиция прокрутки вкладок ────────────────────────────────────────────
  // Окно прокручивает только видимую вкладку (скрытая — отдельный слой,
  // TabPager), поэтому браузер сам позицию не вернёт.  Запоминаем scrollY уходящей вкладки и
  // восстанавливаем при возврате — иначе список сур каждый раз
  // открывается сверху, хотя человек читал середину.
  //
  // Экраны «поверх» тут не участвуют: SurahScreen сам решает, куда
  // встать (последний прочитанный аят либо аят из закладки).
  const tabScrollRef = useRef<Partial<Record<TabId, number>>>({});
  const currentTab = screen.name === 'tabs' ? screen.tab : null;
  // Держим активную вкладку в ref'е, чтобы rememberTabScroll могла
  // работать синхронно из обработчика, не завися от замыкания рендера.
  const currentTabRef = useRef<TabId | null>(currentTab);
  currentTabRef.current = currentTab;

  function rememberTabScroll() {
    const t = currentTabRef.current;
    if (t) tabScrollRef.current[t] = window.scrollY;
  }

  useLayoutEffect(() => {
    if (!currentTab) return;
    // Ставим сохранённую позицию до первого видимого кадра. Прежний
    // двойной rAF сначала показывал начало списка, а через два кадра
    // резко переставлял его на сохранённую позицию — это и выглядело
    // как рывок при возврате из суры.
    const saved = tabScrollRef.current[currentTab] ?? 0;
    window.scrollTo(0, saved);
  }, [currentTab]);

  // Экраны «поверх» всегда открываются с начала.  Исключение — сура:
  // она сама восстанавливает позицию чтения, и сброс здесь гонялся бы
  // с её эффектом.
  //
  // Ключ зависимости — не только имя экрана. Раньше стояло `screen.name`, и
  // переход «документ → другой документ» сбросом не считался: имя то же,
  // эффект не срабатывал, и второй документ открывался на прокрутке
  // первого. То же касается двух разных лент азкаров.
  const overlayKey = screen.name === 'document' ? `document:${screen.doc}`
    : screen.name === 'azkar-category' ? `azkar:${screen.category}`
    : screen.name;
  useLayoutEffect(() => {
    if (screen.name === 'tabs' || screen.name === 'surah') return;
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey]);

  // ── Экраны «поверх» ──────────────────────────────────────────────────────
  //
  // Экран «поверх» рисуется НАД припаркованной вкладкой (см. ниже), а не
  // вместо неё.
  let overlay: ReactNode = null;
  if (screen.name === 'surah') {
    overlay = (
      <Shell key="surah" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeQuranHome} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="SurahScreen" onReset={goQuranHome}>
          <SurahScreen
            surahNumber={screen.number}
            initialAyah={screen.initialAyah}
            theme={theme}
            setTheme={setTheme}
            onBack={goQuranHome}
          />
        </ErrorBoundary>
        </Suspense>
        {/* Та же капсула звука, что на вкладках (владелец 2026-10-04): тап
            или свайп вверх открывает полный плеер. Панели вкладок здесь
            нет — капсула над домашней полосой. */}
        <MiniPlayer placement="screen" onOpen={() => navigate({ name: 'player' })} />
        <AudioErrorPlate placement="screen" />
      </Shell>
    );
  }

  if (screen.name === 'qibla') {
    overlay = (
      <Shell key="qibla" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="QiblaScreen" onReset={goBack}>
          <QiblaScreen theme={theme} setTheme={setTheme} onBack={goBack} />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  if (screen.name === 'player') {
    overlay = (
      <Shell key="player" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="PlayerScreen" onReset={goBack}>
          <PlayerScreen onBack={goBack} />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  if (screen.name === 'document') {
    overlay = (
      <Shell key="document" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="DocumentScreen" onReset={goBack}>
          <DocumentScreen doc={screen.doc} onBack={goBack} />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  // Аккаунт — обычный экран-пуш, а не вкладка: с ним работают редко, и место
  // в нижней панели ему не по чину. Открывается кнопкой в шапке главной.
  if (screen.name === 'account') {
    overlay = (
      <Shell key="account" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="AccountScreen" onReset={goBack}>
          <AccountScreen
            theme={theme}
            setTheme={setTheme}
            onBack={goBack}
            onOpenDocument={doc => navigate({ name: 'document', doc })}
          />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  if (screen.name === 'prayer') {
    overlay = (
      <Shell key="prayer" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="PrayerTimesScreen" onReset={goBack}>
          <PrayerTimesScreen
            theme={theme}
            setTheme={setTheme}
            onBack={goBack}
            onOpenQibla={() => navigate({ name: 'qibla' })}
          />
        </ErrorBoundary>
        </Suspense>
        {/* Намаз ушёл из нижнего меню в отдельный экран, и полоска звучащей
            суры пропала вместе с меню. Возвращаем её: включённую суру надо
            уметь остановить и здесь. Панели вкладок нет — полоска над
            домашней полосой. */}
        <MiniPlayer placement="screen" onOpen={() => navigate({ name: 'player' })} />
        <AudioErrorPlate placement="screen" />
      </Shell>
    );
  }

  if (screen.name === 'bookmarks') {
    overlay = (
      <Shell key="bookmarks" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="BookmarksScreen" onReset={goBack}>
          <BookmarksScreen
            theme={theme}
            setTheme={setTheme}
            onBack={goBack}
            onOpen={(number, ayah) => navigate({ name: 'surah', number, initialAyah: ayah })}
          />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  if (screen.name === 'azkar-category') {
    overlay = (
      <Shell key="azkar-category" isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={edgeBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="AzkarCategoryScreen" onReset={goBack}>
          <AzkarCategoryScreen
            category={screen.category}
            theme={theme}
            setTheme={setTheme}
            onBack={goBack}
          />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  // ── Корневые вкладки ─────────────────────────────────────────────────────
  //
  // 🔴 Вкладка под экраном «поверх» не размонтируется, а паркуется
  // (Quran Ing, 2026-10-04, плавность закрытия суры).
  //
  // Замер: закрытие суры упиралось в перерисовку главной — смонтировать 114
  // строк, разложить их с арабским шрифтом заново (~100 мс без замедления
  // процессора, ×4 — 330). Теперь вкладка остаётся в DOM под классом
  // `.app-screen-parked` (content-visibility: hidden): браузер её не
  // рисует, но хранит раскладку, и возврат — это снять класс и вернуть
  // прокрутку. Заодно сохраняются запрос в поиске и лента недавних (они
  // обновляются при возврате).
  //
  // Что припаркованная вкладка НЕ держит: нижнюю панель (системная
  // панель iOS спряталась бы только с её размонтированием), мини-плеер и
  // плашку звука (у экранов «поверх» свои), слой космической темы (его
  // анимация крутилась бы впустую). Атрибут `data-app-screen` у неё
  // `parked`: клон для жеста «назад» снимается только с видимого экрана.
  //
  // Сами вкладки — в TabPager: все три живут в DOM, скрытые — листами за краем экрана,
  // и между ними листают свайпом. Поэтому у Shell постоянный key: смена
  // вкладки больше не пересоздаёт экран вместе с панелями. Смена вкладки
  // тапом мгновенная, как в iOS (почему без проявления — TabPager).
  const baseTabEntry = [...stack].reverse().find(s => s.name === 'tabs');
  const tab: TabId = baseTabEntry && baseTabEntry.name === 'tabs' ? baseTabEntry.tab : 'quran';
  const parked = overlay != null;
  /** Выбор вкладки — один путь для тапа по панели и свайпа по странице. */
  const selectTab = (next: TabId) => {
    if (next === tab) {
      // TabBar вызывает этот путь только после двух быстрых тапов
      // по активной вкладке «Коран» — прокручиваем к началу.
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate({ name: 'tabs', tab: next });
  };
  return (
    <>
    <Shell key="tabs" parked={parked} isCosmic={isCosmic} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={false}>
      {/* TabBar снаружи пейджера: иначе панель вкладок пропадала бы на
          время подгрузки чанка экрана. */}
      <TabPager
        order={TAB_ORDER}
        active={tab}
        enabled={!parked}
        scrollOf={id => tabScrollRef.current[id] ?? 0}
        onSwipe={selectTab}
        fallback={<ScreenFallback />}
        renderTab={(id, isActive) => (id === 'player'
          ? (
            <ErrorBoundary name="PlayerScreen">
              <PlayerScreen
                placement="tab"
                active={isActive && !parked}
                theme={theme}
                setTheme={setTheme}
              />
            </ErrorBoundary>
          )
          : id === 'quran'
          ? (
            <ErrorBoundary name="SurahPicker">
              <SurahPicker
                active={isActive && !parked}
                onSelectSurah={(n, ayah) => navigate({ name: 'surah', number: n, initialAyah: ayah })}
                onBookmarks={() => navigate({ name: 'bookmarks' })}
                onPrayer={() => navigate({ name: 'prayer' })}
                onAccount={() => navigate({ name: 'account' })}
                theme={theme}
                setTheme={setTheme}
              />
            </ErrorBoundary>
          )
          : (
            <ErrorBoundary name="AzkarScreen">
              <AzkarScreen
                active={isActive && !parked}
                theme={theme}
                setTheme={setTheme}
                onOpenCategory={c => navigate({ name: 'azkar-category', category: c })}
              />
            </ErrorBoundary>
          ))}
      />
      {!parked && (
        <>
          {/* Полоска звучащей суры. Только на вкладках: в ленте и мусхафе свой
              плеер, и две панели разом были бы лишними. Тап по ней —
              вкладка «Плеер», а не экран поверх: панель вкладок остаётся.
              На самой вкладке «Плеер» полоска скрыта — она повторяла бы
              экран. Скрыта, а не размонтирована: на свайпе к плееру и
              обратно TabPager плавно гасит и проявляет её по
              `data-tab-chrome` (список вкладок, где она видна). */}
          <div
            data-tab-chrome="quran azkar"
            data-chrome-off={tab === 'player' ? '' : undefined}
            style={{ display: 'contents' }}
          >
            <MiniPlayer onOpen={() => selectTab('player')} hidden={tab === 'player'} />
          </div>
          {/* Отказ звука говорит словами: чтение идёт из сети, и молчаливая
              остановка читается как поломка приложения. */}
          <AudioErrorPlate />
          <TabBar
            active={tab}
            theme={theme}
            onSelect={selectTab}
          />
        </>
      )}
    </Shell>
    {overlay}
    </>
  );
}

/** Общая обёртка: фон темы под контентом, контент над ним.
 *  Космос и бумага взаимоисключающи — это разные темы, — но проверки
 *  независимы, чтобы добавление третьего фона не требовало правки
 *  условий. */
function Shell({
  isCosmic,
  isDotted,
  cosmicVariant,
  onEdgeBack,
  edgeBackPreview,
  animateEnter,
  parked = false,
  children,
}: {
  /** Вкладка под экраном «поверх»: в DOM, но не рисуется (см. App). */
  parked?: boolean;
  isCosmic: boolean;
  isDotted: boolean;
  cosmicVariant: 'aurora' | 'aurora2' | 'cosmos';
  onEdgeBack?: () => void;
  edgeBackPreview?: IosBackPreview | null;
  /** Проигрывать короткое появление. Только на переходах вперёд. */
  animateEnter?: boolean;
  children: ReactNode;
}) {
  const currentScreenRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        ref={currentScreenRef}
        data-app-screen={parked ? 'parked' : 'current'}
        className={parked ? 'app-screen-parked' : (animateEnter ? 'app-screen-enter' : undefined)}
        aria-hidden={parked || undefined}
        // inert: припаркованная вкладка не ловит фокус и касания.
        // React 18 атрибута не знает — передаём пустой строкой. 🔴 При
        // переходе на React 19 заменить на `inert={parked}`: там пустая
        // строка значит false, и парковка молча перестанет блокировать.
        {...(parked ? { inert: '' } : {})}
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: parked ? 0 : '100dvh',
          isolation: 'isolate',
          background: isDotted
            ? 'radial-gradient(circle, rgba(116, 106, 92, 0.16) 1.45px, transparent 1.7px) 18px 9px / 60px 60px, var(--surface)'
            : (isCosmic ? 'transparent' : 'var(--surface)'),
        }}
      >
        {isCosmic && !parked && <CosmicLayer variant={cosmicVariant} />}
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
        {/* Крышка под системной строкой входит в уходящий экран и движется
            вместе с ним во время интерактивного edge-pop. */}
        {!parked && <StatusBarScrim />}
      </div>
      {onEdgeBack && (
        <IosEdgeBackGesture
          onBack={onEdgeBack}
          currentScreenRef={currentScreenRef}
          preview={edgeBackPreview}
        />
      )}
    </>
  );
}
