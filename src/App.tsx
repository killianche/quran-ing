import {
  useState, useEffect, useLayoutEffect, useRef, lazy, Suspense,
  type ReactNode,
} from 'react';
import { useTheme, themeMode } from './hooks/useTheme';
import { SurahPicker } from './screens/SurahPicker';
import type { DocumentId } from './screens/DocumentScreen';

import { CosmicLayer } from './components/CosmicLayer';
import { PaperLayer } from './components/PaperLayer';
import { StatusBarScrim } from './components/StatusBarScrim';
import { AudioErrorPlate } from './components/AudioErrorPlate';
import { MiniPlayer } from './components/MiniPlayer';
import {
  IosEdgeBackGesture,
  type IosBackPreview,
} from './components/IosEdgeBackGesture';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar, type TabId } from './components/TabBar';
import { applyHighlightVars } from './lib/audioPrefs';
import { applyPaletteToDocument } from './lib/tajweedPalette';
import { syncStatusBarToTheme } from './lib/nativeStatusBar';
import { hideSplashAfterFirstPaint } from './lib/nativeSplash';
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
const SurahScreen = lazy(() => import('./screens/SurahScreen').then(m => ({ default: m.SurahScreen })));
const AzkarScreen = lazy(() => import('./screens/AzkarScreen').then(m => ({ default: m.AzkarScreen })));
const DuaScreen = lazy(() => import('./screens/DuaScreen').then(m => ({ default: m.DuaScreen })));
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
 * В QuranIng разделов было два и они жили горизонтальной слайд-парой:
 * контейнер шириной 200% с translateX, оба экрана всегда смонтированы.
 * С четырьмя разделами приём не масштабируется (контейнер на 400% и
 * четыре живых дерева), поэтому активный раздел теперь ровно один.
 * Побочный эффект — браузер не вернёт позицию прокрутки при возврате
 * на вкладку, поэтому она сохраняется вручную (tabScrollRef ниже).
 */
type Screen =
  | { name: 'tabs'; tab: TabId }
  | { name: 'azkar-category'; category: AzkarCategoryId }
  | { name: 'bookmarks' }
  | { name: 'account' }
  | { name: 'surah'; number: number; initialAyah?: number }
  // Кибла ушла из вкладок: открывается с экрана намаза и имеет свою
  // запись в истории, поэтому системная «назад» возвращает к намазу.
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
   */
  const stackRef = useRef<Screen[]>([INITIAL_SCREEN]);
  const applyStack = (next: Screen[]) => {
    stackRef.current = next;
    setStack(next);
  };
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
  const isPaper = theme === 'mushaf';
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

    setAnimateEnter(true);
    const current = stackRef.current;
    history.pushState({ depth: current.length }, '');
    applyStack([...current, next]);
  };

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
      applyStack(next);
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
  // что осталась незамеченной в QuranIng.
  useEffect(() => { hideSplashAfterFirstPaint(); }, []);

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
  // Активная вкладка одна, остальные размонтированы, поэтому браузер
  // сам позицию не вернёт.  Запоминаем scrollY уходящей вкладки и
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
  if (screen.name === 'surah') {
    return (
      <Shell key="surah" isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={goQuranHome} edgeBackPreview={backPreview}>
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
      </Shell>
    );
  }

  if (screen.name === 'qibla') {
    return (
      <Shell key="qibla" isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={goBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="QiblaScreen" onReset={goBack}>
          <QiblaScreen theme={theme} setTheme={setTheme} onBack={goBack} />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  if (screen.name === 'player') {
    return (
      <Shell key="player" isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={goBack} edgeBackPreview={backPreview}>
        <Suspense fallback={<ScreenFallback />}>
        <ErrorBoundary name="PlayerScreen" onReset={goBack}>
          <PlayerScreen onBack={goBack} />
        </ErrorBoundary>
        </Suspense>
      </Shell>
    );
  }

  if (screen.name === 'document') {
    return (
      <Shell key="document" isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={goBack} edgeBackPreview={backPreview}>
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
    return (
      <Shell key="account" isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={goBack} edgeBackPreview={backPreview}>
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

  if (screen.name === 'bookmarks') {
    return (
      <Shell key="bookmarks" isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={goBack} edgeBackPreview={backPreview}>
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
    return (
      <Shell key="azkar-category" isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter} onEdgeBack={goBack} edgeBackPreview={backPreview}>
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
  const tab = screen.tab;
  return (
    <Shell key={`tabs-${tab}`} isCosmic={isCosmic} isPaper={isPaper} isDotted={isDotted} cosmicVariant={cosmicVariant} animateEnter={animateEnter}>
      {/* Вкладки под одним Suspense, а TabBar снаружи: иначе панель
          вкладок пропадала бы на время подгрузки чанка экрана. */}
      <Suspense fallback={<ScreenFallback />}>
      {tab === 'quran' && (
        <ErrorBoundary name="SurahPicker">
          <SurahPicker
            onSelectSurah={(n, ayah) => navigate({ name: 'surah', number: n, initialAyah: ayah })}
            onBookmarks={() => navigate({ name: 'bookmarks' })}
            onAccount={() => navigate({ name: 'account' })}
            theme={theme}
            setTheme={setTheme}
          />
        </ErrorBoundary>
      )}
      {tab === 'azkar' && (
        <ErrorBoundary name="AzkarScreen">
          <AzkarScreen
            theme={theme}
            setTheme={setTheme}
            onOpenCategory={c => navigate({ name: 'azkar-category', category: c })}
          />
        </ErrorBoundary>
      )}
      {tab === 'prayer' && (
        <ErrorBoundary name="PrayerTimesScreen">
          <PrayerTimesScreen
            theme={theme}
            setTheme={setTheme}
            onOpenQibla={() => navigate({ name: 'qibla' })}
          />
        </ErrorBoundary>
      )}
      {tab === 'dua' && (
        <ErrorBoundary name="DuaScreen">
          <DuaScreen theme={theme} setTheme={setTheme} />
        </ErrorBoundary>
      )}
      </Suspense>
      {/* Полоска звучащей суры. Только на вкладках: в ленте и мусхафе свой
          плеер, и две панели разом были бы лишними. */}
      <MiniPlayer onOpen={() => navigate({ name: 'player' })} />
      {/* Отказ звука говорит словами: чтение идёт из сети, и молчаливая
          остановка читается как поломка приложения. */}
      <AudioErrorPlate />
      <TabBar
        active={tab}
        onSelect={next => {
          if (next === tab) {
            // TabBar вызывает этот путь только после двух быстрых тапов
            // по активной вкладке «Коран» или «Дуа» — прокручиваем к началу.
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }
          navigate({ name: 'tabs', tab: next });
        }}
      />
    </Shell>
  );
}

/** Общая обёртка: фон темы под контентом, контент над ним.
 *  Космос и бумага взаимоисключающи — это разные темы, — но проверки
 *  независимы, чтобы добавление третьего фона не требовало правки
 *  условий. */
function Shell({
  isCosmic,
  isPaper,
  isDotted,
  cosmicVariant,
  onEdgeBack,
  edgeBackPreview,
  animateEnter,
  children,
}: {
  isCosmic: boolean;
  isPaper: boolean;
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
        data-app-screen="current"
        className={animateEnter ? 'app-screen-enter' : undefined}
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100dvh',
          isolation: 'isolate',
          background: isDotted
            ? 'radial-gradient(circle, rgba(116, 106, 92, 0.16) 1.45px, transparent 1.7px) 18px 9px / 60px 60px, var(--surface)'
            : (isCosmic || isPaper ? 'transparent' : 'var(--surface)'),
        }}
      >
        {isCosmic && <CosmicLayer variant={cosmicVariant} />}
        {isPaper && <PaperLayer />}
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
        {/* Крышка под системной строкой входит в уходящий экран и движется
            вместе с ним во время интерактивного edge-pop. */}
        <StatusBarScrim />
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
