/**
 * SurahScreen — ayah-feed reading view (QCF V4 glyphs).
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │ [header pill: back / title / settings]   │  (fixed, floating)
 *   ├──────────────────────────────────────────┤
 *   │                                          │
 *   │   Surah header  (QCF surah_header)       │
 *   │   Bismillah     (QCF basmala)            │
 *   │   ─────────────────────────────          │
 *   │                                          │
 *   │   ﴿ 1 ﴾  بِسْمِ ٱللَّهِ … ﴾١﴿              │  ← QcfAyahLine
 *   │   Во имя Аллаха, Милостивого…           │  ← Russian
 *   │   [1:1] [bookmark] [play]                │  ← action row
 *   │   ─────────────────────────────          │
 *   │                                          │
 *   │   ﴿ 2 ﴾  ٱلْحَمْدُ لِلَّهِ … ﴾٢﴿              │
 *   │   …                                      │
 *   └──────────────────────────────────────────┘
 *   [BottomDock — audio controls]                (fixed, when playing)
 *
 * ── Как приезжает текст ───────────────────────────────────────────────
 *
 * Данные: страницы суры качаются параллельно, но начало показывается,
 * не дожидаясь остальных (useQcfAyahFeed, showStartEarly) — и только
 * когда человек читает сверху: пришедшему по закладке в середину нужна
 * полная лента, иначе восстановление прокрутки промахнётся.
 *
 * Шрифты: мусхаф нарезан по страницам, около 71 КБ на страницу.  Просит
 * их QcfAyahLine, но только для аятов вблизи экрана (useNearViewport) —
 * сура смонтирована целиком, и без этого Ан-Ниса разом запрашивала 32
 * подмножества.  Первые EAGER_AYAHS от места чтения просят сразу, минуя
 * наблюдатель, иначе первый экран ждал бы его вердикта.  Шрифт первой
 * страницы заказывается здесь же, до готовности ленты.
 *
 * Пока шрифт не приехал, на месте аята стоит скелет, а не текст: у
 * PUA-глифов нет запасного шрифта, и «текст без шрифта» — это ряды
 * квадратов вместо слов Корана.
 */

import {
  useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo,
  type ReactNode, type PointerEvent as ReactPointerEvent,
} from 'react';
import { FastScrubber, isScrubbing } from '../components/FastScrubber';
import { FAST_SCROLL } from '../lib/fastScroll';
import { useQuranSources } from '../content/quran-sources-lazy';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { useAudioActions, useAudioState, useAudioTick } from '../hooks/AudioProvider';
import { useQcfAyahFeed, type QcfAyahEntry } from '../hooks/useQcfAyahFeed';
import { useQcfFont, preloadQcfFonts } from '../hooks/useQcfFont';
import { ensurePage } from '../hooks/useQcfPage';
import { preloadTajweedPage, useTajweedPage } from '../hooks/useTajweedPage';
import {
  getTajweedFontStatus,
  preloadTajweedFont,
  TAJWEED_FONT_SAMPLE,
  useTajweedFont,
} from '../hooks/useTajweedFont';
import { qcfPageFamily, distinctFontRefs } from '../lib/qcf4';
import { useChunkedRender } from '../hooks/useChunkedRender';
import { ArabicAyahRouter } from '../components/ArabicAyahRouter';
import { FontErrorBanner } from '../components/FontErrorBanner';
import { loadArabicEditions } from '../lib/arabicEditions';
import { ThemeSettings, TypographySettings } from '../components/ReadingSettings';
import { AudioSpinner, BottomDock } from '../components/BottomDock';
import {
  Typography, Appearance,
  Bookmark as BookmarkIcon, Play, Pause, ICON_SIZE } from '../components/icons';
import { ScreenHeader, screenHeaderOffset } from '../components/ScreenHeader';
import { type Theme } from '../hooks/useTheme';
import { getAutoScroll, subscribeAudioPrefs } from '../lib/audioPrefs';
import { pushRecent, updateRecentAyah, readRecents } from '../lib/recents';
import { pageOfAyah } from '../lib/mushafPages';
import { isBookmarked, toggleBookmark } from '../lib/bookmarks';
import {
  readPref, readNumber,
  latinStack, latinWeight, latinIsSerif, ARABIC_FONT_IDS,
  arabicFontConfig,
  type LatinFontId, type ArabicFontId,
} from '../lib/typography';
import { usesWholeAyahHighlight } from '../lib/reciters';
import { INH_FONT_FEATURES, INH_VISIBLE_KEY, inhDisplayText, inhFontStack, readShowInh } from '../lib/inhTranslation';
import { fontFamilyForPage } from '../content/quran-tajweed-meta';

type Props = {
  surahNumber: number;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onBack: () => void;
  /**
   * Explicit ayah to scroll to on mount.  Set when the surah was opened
   * from the bookmarks list (the user clicked a specific saved verse) —
   * it overrides the "last read" position normally restored from recents.
   * Honoured once per surah change.
   */
  initialAyah?: number;
};

/**
 * Сколько аятов от места, где человек начнёт читать, просят шрифт сразу.
 *
 * Восемь с запасом покрывают первый экран при любом кегле.  Меньше —
 * нижние аяты первого экрана ждали бы наблюдателя; больше — вернулась бы
 * гурьба одновременных запросов, из-за которой шрифт первого экрана и
 * приходил последним.
 */
const EAGER_AYAHS = 8;

const LATIN_IDS:   LatinFontId[]  = ['inter-semibold', 'inter-regular', 'garamond', 'alice'];
const ARABIC_IDS:  ArabicFontId[] = ARABIC_FONT_IDS;
// Белый список для readPref: сохранённый id чтеца, которого больше нет
// в каталоге (прежний QuranIng знал восемь), молча падает на DEFAULT_RECITER.

function migrateLegacyScale() {
  // Режим «Только арабский» снят владельцем. Старый ключ больше ни на
  // что не влияет и удаляется, чтобы обновление всегда открыло обычную ленту.
  localStorage.removeItem('quran.feedMode');
  const legacy = localStorage.getItem('fontScale');
  if (!legacy) return;
  if (!localStorage.getItem('arabicScale')) localStorage.setItem('arabicScale', legacy);
  if (!localStorage.getItem('ruScale'))     localStorage.setItem('ruScale',     legacy);
  localStorage.removeItem('fontScale');
}

export function SurahScreen({
  surahNumber, theme, setTheme, onBack, initialAyah,
}: Props) {
  migrateLegacyScale();

  // ── Audio ──────────────────────────────────────────────────────────────────
  // Звук общий на всё приложение (`AudioProvider`), а не свой у экрана:
  // иначе уход из ленты обрывал бы чтение суры. Собираем привычный объект
  // `audio` из двух контекстов, чтобы места вызова ниже не менялись.
  const audioActions = useAudioActions();
  const audioState = useAudioState();
  const reciter = audioState.reciter;
  const setReciter = audioActions.setReciter;
  const audio = { ...audioState, ...audioActions };
  // Прогресс и позиция слова приходят отдельным контекстом: они меняются
  // несколько раз в секунду, и подписан на них только тот, кому они правда
  // нужны — караоке-подсветка и полоса плеера. Список сур на главном экране
  // их не получает и на тиках не перерисовывается.
  const tick = useAudioTick();

  // ── Typography prefs ───────────────────────────────────────────────────────
  const [arabicScale, setArabicScaleS] = useState<number>(() => readNumber('arabicScale', 1.0));
  const [ruScale,     setRuScaleS]     = useState<number>(() => readNumber('ruScale',     1.0));
  const [ruFont,      setRuFontS]      = useState<LatinFontId>(()  => readPref('ruFont',     'inter-regular', LATIN_IDS));
  // Ингушский — свой набор настроек, независимый от русского: человек может
  // читать один перевод крупно, а второй держать мельче или скрыть вовсе.
  const [inhScale,    setInhScaleS]    = useState<number>(() => readNumber('inhScale',    1.0));
  const [inhFont,     setInhFontS]     = useState<LatinFontId>(()  => readPref('inhFont',    'inter-regular', LATIN_IDS));
  // Дефолт — «Мусхаф» (QCF V4), а не юникодный «Усмани»: это глифы
  // мединского мусхафа от King Fahd Complex, то самое начертание, к
  // которому человек привык в печатном Коране.  Юникодный текст рядом
  // с ним читается как «набрано в текстовом редакторе».
  //
  // Решение владельца.  У тех, кто уже выбирал шрифт руками, ничего не
  // изменится: `readPref` сначала смотрит в localStorage.
  const [arabicFont,  setArabicFontS]  = useState<ArabicFontId>(() => readPref('arabicFont', 'qcf-v4', ARABIC_IDS));
  const [showArabic,  setShowArabicS]  = useState<boolean>(() => localStorage.getItem('showArabic') !== '0');
  const [showRu,      setShowRuS]      = useState<boolean>(() => localStorage.getItem('showRu')     !== '0');
  const [showInh,     setShowInhS]     = useState<boolean>(readShowInh);

  const persist = <T extends string | number | boolean>(key: string) => (v: T) => {
    localStorage.setItem(key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  };
  const setArabicScale = (v: number)       => { setArabicScaleS(v); persist<number>('arabicScale')(v); };
  const setRuScale     = (v: number)       => { setRuScaleS(v);     persist<number>('ruScale')(v); };
  const setRuFont      = (v: LatinFontId)  => { setRuFontS(v);      persist<string>('ruFont')(v); };
  const setInhScale    = (v: number)       => { setInhScaleS(v);    persist<number>('inhScale')(v); };
  const setInhFont     = (v: LatinFontId)  => { setInhFontS(v);     persist<string>('inhFont')(v); };
  const setArabicFont  = (v: ArabicFontId) => {
    // Начинаем текущую страницу прямо в обработчике тапа, до закрытия
    // настроек и до следующего React-эффекта. JSON и шрифт едут параллельно.
    if (v === 'qpc-v4-tajweed') {
      const recentAyah = readRecents().find(r => r.surah === surahNumber)?.ayah
        ?? initialAyah
        ?? 1;
      const currentPage = pageOfAyah(surahNumber, recentAyah);
      const family = fontFamilyForPage(currentPage);
      preloadTajweedPage(currentPage);
      if (family) preloadTajweedFont(currentPage, family, TAJWEED_FONT_SAMPLE);
    }
    setArabicFontS(v);
    persist<string>('arabicFont')(v);
  };
  const setShowArabic  = (v: boolean)      => { setShowArabicS(v);  persist<boolean>('showArabic')(v); };
  const setShowRu      = (v: boolean)      => { setShowRuS(v);      persist<boolean>('showRu')(v); };
  const setShowInh     = (v: boolean)      => { setShowInhS(v);     persist<boolean>(INH_VISIBLE_KEY)(v); };

  // ── Header popovers ────────────────────────────────────────────────────────
  const [jumpOpen,       setJumpOpen]       = useState(false);
  const [themeOpen,      setThemeOpen]      = useState(false);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [headerVisible,  setHeaderVisible]  = useState(true);
  const themeBtnRef      = useRef<HTMLButtonElement>(null);
  const typographyBtnRef = useRef<HTMLButtonElement>(null);
  const readerTapRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startedAt: number;
    /** Позиция ленты в момент касания — чтобы отличить тап от остановки прокрутки. */
    scrollY: number;
    moved: boolean;
  } | null>(null);
  const closeAll = () => { setJumpOpen(false); setThemeOpen(false); setTypographyOpen(false); };
  /** Когда лента последний раз прокручивалась. */
  const lastScrollAtRef = useRef(0);

  const onReaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    // Кнопки, ссылки и поля ввода тап не переключают.
    //
    // `[aria-disabled]` здесь работает, а `:disabled` работать не мог бы:
    // если WebKit отдаёт событие предку заблокированной кнопки, то closest
    // идёт от предка ВВЕРХ, а кнопка лежит ниже — совпадения не будет
    // никогда; если же событие приходит на саму кнопку, хватает и `button`.
    // Поэтому кнопка воспроизведения помечается aria-disabled, а не
    // disabled, и остаётся полноценной целью события.
    if (target?.closest(
      'button, a, input, textarea, select, [role="button"], [aria-disabled="true"]',
    )) return;
    readerTapRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startedAt: performance.now(),
      scrollY: window.scrollY,
      moved: false,
    };
  };
  const onReaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = readerTapRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) start.moved = true;
  };
  const onReaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = readerTapRef.current;
    readerTapRef.current = null;
    if (!start || start.pointerId !== e.pointerId || start.moved) return;
    if (performance.now() - start.startedAt > 340) return;
    // Удержание у края включило быструю прокрутку — это не тап, даже если
    // палец отпустили, не сдвинув: панели прятать никто не просил.
    if (isScrubbing()) return;
    // Панель переключает только «необработанный» тап — так же, как у
    // системного hidesBarsOnTap. Касание, которое ГАСИТ прокрутку, тапом
    // не считается: в WKWebView оно даёт полноценные pointerdown/up (клик
    // при этом подавляется), палец не двигается, и прежний распознаватель
    // честно видел тап. Человек же всего лишь тормозил уезжающий текст —
    // особенно заметно сразу после запуска аудио, когда лента едет к
    // звучащему аяту сама.
    if (isAutoScrollingRef.current) return;
    if (performance.now() - lastScrollAtRef.current < 250) return;
    if (Math.abs(window.scrollY - start.scrollY) > 2) return;
    closeAll();
    setHeaderVisible(v => !v);
  };

  // ── Desktop responsive ─────────────────────────────────────────────────────
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(min-width: 1024px)').matches
      : false,
  );
  useLayoutEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Датасет альтернативных начертаний греем ТОЛЬКО когда человек уже
  // читает одним из них.  Он весит 3.9 МБ, а раньше тянулся при каждом
  // открытии суры «чтобы переключение было мгновенным» — и на медленной
  // сети занимал канал, пока шрифт страницы мусхафа ждал своей очереди.
  //
  // Цена отказа — первое переключение на Усмани или V1 будет с паузой.
  // Это честный обмен: переключают шрифт редко и осознанно, а суру
  // открывают каждый раз.
  useEffect(() => {
    const kind = arabicFontConfig(arabicFont).kind;
    if (kind === 'qcf-v4' || kind === 'tajweed') return;
    loadArabicEditions();
  }, [arabicFont]);

  // ── Surah metadata + QCF feed ──────────────────────────────────────────────
  const meta = SURAH_BY_NUMBER[surahNumber];

  // ── Стабильные значения для строк ленты ───────────────────────────────────
  // Прогресс аудио обновляется ~12 раз в секунду, и каждый раз SurahScreen
  // перерисовывается. Пока тело строки жило инлайном в .map, React пересобирал
  // и сверял все смонтированные аяты (у Аль-Бакары — 286 статей, в каждой по
  // span на слово) на том же потоке, который должен обрабатывать прокрутку.
  // AyahRow ниже обёрнут в memo, поэтому на тик перерисовывается только
  // звучащая строка — но лишь при условии, что все пропсы стабильны по ссылке.
  const wholeAyahHighlight = usesWholeAyahHighlight(reciter);
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const handleAyahPlay = useCallback((surah: number, ayah: number) => {
    updateRecentAyah(surah, ayah);
    audioRef.current.handlePlay(surah, ayah, metaRef.current?.ayahs ?? 9999);
  }, []);

  /**
   * Аят, с которого человек начнёт читать, — он и несколько следующих
   * просят шрифт сразу, минуя наблюдатель видимости (см. `eager` в
   * QcfAyahLine).  Считается тем же правилом, что и восстановление
   * прокрутки ниже, иначе «сразу» пришлось бы не на тот экран.
   */
  const eagerAnchor = useMemo(() => {
    const prior = readRecents().find(r => r.surah === surahNumber);
    return initialAyah ?? prior?.ayah ?? 1;
  }, [surahNumber, initialAyah]);

  const [readingAyah, setReadingAyah] = useState(eagerAnchor);
  useEffect(() => setReadingAyah(eagerAnchor), [surahNumber, eagerAnchor]);

  // Состояние первой видимой страницы управляет общей плашкой. Шрифт
  // заказывается фиксированным PUA-глифом сразу, не ожидая JSON.
  const tajweedMode = arabicFontConfig(arabicFont).kind === 'tajweed';
  const priorityTajweedPage = pageOfAyah(surahNumber, readingAyah);
  const priorityTajweedFamily = fontFamilyForPage(priorityTajweedPage);
  const priorityTajweed = useTajweedPage(priorityTajweedPage, tajweedMode);
  const priorityTajweedFontReady = useTajweedFont(
    priorityTajweedPage,
    priorityTajweedFamily,
    TAJWEED_FONT_SAMPLE,
    tajweedMode,
  );
  const priorityTajweedFontStatus = priorityTajweedFamily
    ? getTajweedFontStatus(priorityTajweedFamily)
    : 'idle';
  const tajweedLoading = tajweedMode
    && !priorityTajweed.error
    && priorityTajweedFontStatus !== 'failed'
    && (priorityTajweed.loading || !priorityTajweedFontReady);
  const tajweedUiStatus = !tajweedMode
    ? 'idle'
    : priorityTajweed.error || priorityTajweedFontStatus === 'failed'
      ? 'failed'
      : tajweedLoading
        ? 'loading'
        : 'ready';

  // Начало суры показываем, не дожидаясь всех её страниц, — но только
  // когда читать начинают сверху.  Если человек пришёл по закладке в
  // середину, ждём полную ленту: в неполной его аята ещё нет, и
  // восстановление прокрутки поставило бы его не на то место.
  // Переводы приезжают отдельным чанком (см. quran-sources-lazy.ts).
  // Пока их нет, показываем тот же скелет, что и для самой ленты: иначе
  // аяты отрисовались бы без перевода и подпрыгнули, когда он доедет.
  const quranSources = useQuranSources();
  const { feed, loading: feedLoading, error: feedError } =
    useQcfAyahFeed(surahNumber, eagerAnchor === 1);

  // Шрифт первого экрана заказываем, не дожидаясь всей суры.
  //
  // useQcfAyahFeed собирает ленту из ВСЕХ страниц суры (у Бакары их сорок
  // пять) и отдаёт результат, когда приехала последняя.  Только после этого
  // становилось известно, какое подмножество нужно первому аяту, и шрифт
  // начинал качаться — то есть ожидание шло последовательно: сначала
  // данные всей суры, потом шрифт.
  //
  // Номер первой страницы известен без сети — из таблицы mushafPages.
  // Забираем её json (единицы килобайт) и сразу просим её шрифты, поэтому
  // они едут одновременно с остальными страницами, а не после них.
  useEffect(() => {
    let cancelled = false;
    const page = pageOfAyah(surahNumber, 1);
    if (!page) return;
    ensurePage(page)
      .then(data => {
        if (cancelled) return;
        preloadQcfFonts(distinctFontRefs(data.lines.flatMap(l => l.words), 'qcf-v4'));
      })
      .catch(() => { /* лента загрузится обычным путём и покажет ошибку */ });
    return () => { cancelled = true; };
  }, [surahNumber]);

  // Inject fonts for surah header / basmala (the ayah lines inject their own)
  useQcfFont(feed?.decor.fonts ?? []);

  // ── On-enter: push recent + remember where to restore scroll ──────────────
  // priorAyahToRestoreRef holds the ayah we should scroll to *once* after the
  // QCF feed has loaded its DOM anchors.  Captured here (before pushRecent
  // overwrites the timestamp) and consumed by the restore-effect below.
  //
  // Priority for the restore target:
  //   1. `initialAyah` prop (set when opened from the bookmarks list)
  //   2. last-read ayah for this surah from recents
  //   3. nothing (start at the surah header)
  const priorAyahToRestoreRef = useRef<number | null>(null);
  /** Аят, к которому человек попросил перейти и который ещё не в DOM. */
  const [pendingJump, setPendingJump] = useState<number | null>(null);
  /** То же значение для эффектов, которым нельзя перезапускаться. */
  const pendingJumpRef = useRef<number | null>(null);
  pendingJumpRef.current = pendingJump;

  // Новый экран не должен унаследовать scrollY списка сур даже на один
  // кадр: на iPhone это выглядело как скачок шапки после открытия.
  // useLayoutEffect выполняется до показа кадра; точную позицию аята
  // восстановит эффект ниже, когда его DOM-якорь будет готов.
  useLayoutEffect(() => {
    const prior = readRecents().find(r => r.surah === surahNumber);
    priorAyahToRestoreRef.current = initialAyah ?? prior?.ayah ?? null;
    window.scrollTo(0, 0);
  }, [surahNumber, initialAyah]);

  useEffect(() => {
    const target = priorAyahToRestoreRef.current;
    pushRecent(surahNumber, target ?? 1);
    closeAll();
  }, [surahNumber, initialAyah]);

  // ── Restore scroll to the last-read ayah once the feed is in the DOM ──────
  // App.tsx fires `window.scrollTo(0, 0)` on screen change.  Effects run
  // child-first, so a synchronous scroll here would be wiped by App's
  // effect that runs afterwards.  Double-rAF defers our restore past
  // App's reset *and* gives the browser one frame to lay out anchors.
  // Use the ayah-count as a stable primitive signal — `feed` itself is a
  // fresh object on every render of the parent hook, which would re-run
  // this effect every time and let its cleanup `cancelAnimationFrame`
  // the raf we just scheduled, so the inner callback never fires.
  //
  // SurahScreen owns the page scroll position on mount: it either scrolls
  // to the last-read / bookmarked ayah, or — when there is nothing to
  // restore — explicitly resets to the top.  App.tsx deliberately does
  // NOT call window.scrollTo(0,0) on navigation into a surah for this
  // reason, so any leftover scroll from the previous screen would persist
  // unless we handle it here.
  // Проверяем не только «лента загружена», но и «загружена ИМЕННО ЭТА
  // сура».  Переход между сурами не размонтирует экран: меняется проп,
  // а компонент тот же.  Из-за этого было две беды сразу.
  //
  // Первая: `feedReady` при переходе оставался true (лента предыдущей
  // суры уже в кэше), зависимость не менялась, эффект не перезапускался
  // — и переход «открыть аят 46 суры Йусуф» приводил на её начало.
  // Поймано живым прогоном поиска по всему Корану.
  //
  // Вторая опаснее: пока новая лента грузится, в DOM ещё висят якоря
  // СТАРОЙ суры.  У Аль-Бакары 286 аятов, значит `[data-ayah-anchor=46]`
  // там есть — и мы бы уехали к 46-му аяту не той суры, молча и
  // правдоподобно.  Сверка номера суры в самой ленте это исключает.
  const feedSurah = feed?.ayahs[0]?.surah ?? null;
  const feedReady = !feedLoading && (feed?.ayahs.length ?? 0) > 0 && feedSurah === surahNumber;
  useLayoutEffect(() => {
    if (!feedReady) return;
    // Человек уже попросил перейти к конкретному аяту — восстановление
    // здесь лишнее.  Раньше оно молча выигрывало: прыжок, сделанный до
    // готовности ленты, тут же затирался прокруткой в начало суры, и
    // выглядело это как «кнопка перехода не работает».
    if (pendingJumpRef.current != null) {
      priorAyahToRestoreRef.current = null;
      return;
    }
    const target = priorAyahToRestoreRef.current;
    priorAyahToRestoreRef.current = null;
    if (!target || target <= 1) {
      window.scrollTo(0, 0);
      return;
    }
    // Ждём появления самого якоря, а не просто пары кадров.
    //
    // Лента рендерится порциями (useChunkedRender): к моменту, когда
    // «лента готова», в DOM есть только первые аяты.  Прежний код после
    // двух кадров не находил, скажем, 46-й, молча уходил в «наверх» и
    // ЗАБЫВАЛ цель — она уже была вынута из ref.  Снаружи это выглядело
    // так: переход к найденному аяту открывает начало суры.  Поймано
    // живым прогоном поиска по всему Корану.
    //
    // Ждём появления якоря на таймере, а не на requestAnimationFrame.
    //
    // rAF не тикает в скрытой вкладке.  На это я потратил несколько
    // итераций отладки: цикл ожидания не запускался ни разу, и переход
    // «открыть найденный аят» приводил на начало суры — хотя ручной
    // вызов scrollIntoView в той же вкладке отрабатывал мгновенно.
    // Для пользователя это тот же случай: открыл ссылку, ушёл в другое
    // приложение, вернулся — и позиция потеряна.  setTimeout тикает
    // всегда, а 50 мс на проверку для разовой прокрутки более чем
    // достаточно.
    //
    // Ждать приходится потому, что лента рендерится порциями: в момент
    // готовности данных в DOM есть только первые аяты, и 46-го ещё нет.
    //
    // Пять секунд — с запасом на медленный телефон и заведомо конечны,
    // если аята с таким номером в суре нет вовсе.
    const deadline = Date.now() + 5000;
    let timer = 0;
    // Человек важнее восстановления.
    //
    // Ждать якорь можно до пяти секунд, и всё это время лента живая: аяты
    // домонтируются, читать уже можно. Если за это время человек тронул
    // экран сам — восстановление обязано молча уступить. Прежде оно
    // уступало только явному прыжку к аяту, а прикосновение игнорировало:
    // человек начинал листать, а через секунду его уносило к сохранённой
    // позиции. Хуже того, по истечении дедлайна стоял `scrollTo(0, 0)` —
    // то есть читающего выбрасывало в начало суры.
    //
    // Это третья грабля проекта из CLAUDE.md: два механизма прокрутки
    // дерутся, и побеждает тот, кто позже. Явное действие человека должно
    // побеждать всегда.
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    // pointerdown, а не scroll: инерционную прокрутку от нашего же
    // scrollIntoView мы бы приняли за действие человека и отменили сами
    // себя. Касание однозначно принадлежит человеку.
    window.addEventListener('pointerdown', cancel, { passive: true, capture: true });
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('keydown', cancel);

    const tryScroll = () => {
      if (cancelled) return;
      // Прыжок мог появиться, пока мы ждали якорь: уступаем ему.
      if (pendingJumpRef.current != null) return;
      const el = document.querySelector(`[data-ayah-anchor="${target}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
        return;
      }
      if (Date.now() > deadline) {
        // Молча сдаёмся. Прежний `scrollTo(0, 0)` был хуже, чем ничего:
        // если аята с таким номером в суре нет, человек всё равно уже
        // где-то читает, и прыжок в начало — потеря его места.
        return;
      }
      timer = window.setTimeout(tryScroll, 50);
    };
    tryScroll();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', cancel, { capture: true } as EventListenerOptions);
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('keydown', cancel);
    };
  }, [feedReady, surahNumber]);

  // ── Track the ayah currently at the top of the viewport on user scroll ───
  // Without this, recent-ayah only ever updated on play / jump / auto-scroll,
  // so reading silently by scrolling never saved progress — the recents
  // strip on the picker always re-opened the surah at ayah 1.
  const lastTrackedAyahRef = useRef<number | null>(null);
  useEffect(() => {
    lastTrackedAyahRef.current = null;
  }, [surahNumber]);
  useEffect(() => {
    let rafId: number | null = null;
    let persistTimer: number | null = null;
    const onScroll = () => {
      // Отметка нужна распознавателю тапа: касание, останавливающее
      // инерционную прокрутку, не должно переключать панель.
      lastScrollAtRef.current = performance.now();
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        // Skip while audio auto-scroll is mid-flight: it already calls
        // updateRecentAyah explicitly, and its scrollIntoView fires
        // scroll events that would otherwise race this listener.
        if (isAutoScrollingRef.current) return;
        const anchors = document.querySelectorAll<HTMLElement>('[data-ayah-anchor]');
        if (anchors.length === 0) return;
        // Threshold sits just below the floating header (88px) so the
        // "active" ayah is whichever one's top edge has crossed it most
        // recently — i.e. the one the reader is looking at.
        const threshold = 110;
        let bestAyah: number | null = null;
        for (let i = 0; i < anchors.length; i++) {
          const el = anchors[i];
          const top = el.getBoundingClientRect().top;
          // Якоря идут в порядке документа, их top монотонно растёт: как
          // только первый ушёл ниже порога, все следующие тоже ниже.
          // Прежний `continue` читал getBoundingClientRect у ВСЕХ якорей —
          // на Аль-Бакаре это 286 принудительных пересчётов лейаута на
          // каждом кадре прокрутки там, где хватает двух-трёх чтений.
          // Нужен последний якорь выше порога — он же ближайший к нему.
          if (top > threshold) break;
          bestAyah = Number(el.dataset.ayahAnchor);
        }
        // Edge case: page is above the first anchor (top of surah header).
        // Fall back to ayah 1 so re-entry from the picker still lands at
        // the start instead of leaving whatever previous value sat in
        // localStorage.
        if (bestAyah == null) bestAyah = 1;
        if (bestAyah !== lastTrackedAyahRef.current) {
          lastTrackedAyahRef.current = bestAyah;
          // Во время инерционной прокрутки не перерисовываем всю тяжёлую
          // ленту и не пишем localStorage на каждой пересечённой строке.
          // Сохраняем позицию после короткой остановки пальца.
          if (persistTimer !== null) window.clearTimeout(persistTimer);
          const ayahToPersist = bestAyah;
          persistTimer = window.setTimeout(() => {
            setReadingAyah(ayahToPersist);
            updateRecentAyah(surahNumber, ayahToPersist);
            persistTimer = null;
          }, 160);
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (persistTimer !== null) window.clearTimeout(persistTimer);
    };
  }, [surahNumber]);

  // ── Auto-scroll to currently-playing ayah ──────────────────────────────────
  const autoScrollRef = useRef<boolean>(getAutoScroll());
  useEffect(() => subscribeAudioPrefs(() => {
    autoScrollRef.current = getAutoScroll();
  }), []);

  const lastAutoAyahRef = useRef<{ surah: number; ayah: number } | null>(null);
  // Set just before a programmatic scroll so the chrome-visibility
  // listener (further down) can ignore the resulting scroll events —
  // otherwise auto-scrolling triggers the "scrolled down → hide
  // header" branch and the floating pill flickers in/out on every
  // ayah change.  Cleared after the smooth scroll has had time to
  // settle (~700 ms covers most auto-scrolls; the listener is back
  // in time for the next user interaction).
  const isAutoScrollingRef = useRef(false);
  /** Таймер снятия флага автопрокрутки. Один на экран, перезаводится. */
  const autoScrollTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (autoScrollTimerRef.current != null) {
      window.clearTimeout(autoScrollTimerRef.current);
    }
  }, []);
  useEffect(() => {
    if (!autoScrollRef.current) return;
    // Пока палец ведёт быструю прокрутку, звучащий аят не уносит страницу
    // к себе: иначе в пузыре один номер, а на экране другой.
    if (isScrubbing()) return;
    const ayah  = audio.currentAyah;
    const surah = audio.currentSurah;
    if (!ayah || !surah || surah !== surahNumber) return;

    const last = lastAutoAyahRef.current;
    if (last && last.surah === surah && last.ayah === ayah) return;
    lastAutoAyahRef.current = { surah, ayah };

    const el = document.querySelector(`[data-ayah-anchor="${ayah}"]`) as HTMLElement | null;
    if (!el) return;

    // Pick smooth vs. instant based on how far the target is from where
    // the user's eye already is.  Instant feels less seasick on rapid-
    // fire short ayahs (e.g. surah 56:1-4); smooth feels natural for
    // longer ayahs where the camera has to travel a noticeable distance.
    //
    // Header compensation lives on the article itself via
    // `scrollMarginTop: 88px` (see the JSX further down).  Earlier
    // versions chained a `window.scrollBy({ top: -88, behavior: 'auto' })`
    // after the smooth scrollIntoView — that instant nudge ran in
    // parallel with the ongoing smooth animation, so the page jumped
    // ~88px up, then smoothly drifted past the target, then snapped
    // back.  scroll-margin-top makes the browser do the right thing in
    // a single coherent animation.
    const rect = el.getBoundingClientRect();
    const distance = Math.abs(rect.top - 120);
    const behavior: ScrollBehavior = distance > 200 ? 'smooth' : 'auto';
    isAutoScrollingRef.current = true;
    el.scrollIntoView({ behavior, block: 'start' });
    // Smooth scrolls take ~300-600 ms in browsers; give a generous
    // window before re-enabling the user-scroll handler.  Instant
    // scrolls finish in one frame but we still wait so any settling
    // events don't trip the listener either.
    const settle = behavior === 'smooth' ? 700 : 120;
    // Прежний таймер не отменялся ничем. При быстрой смене аятов короткая
    // прокрутка (120 мс) снимала флаг, пока следующая, плавная (700 мс),
    // была ещё в пути — и обработчик прокрутки успевал принять её за
    // действие человека. Держим один таймер и перезаводим его.
    if (autoScrollTimerRef.current != null) {
      window.clearTimeout(autoScrollTimerRef.current);
    }
    autoScrollTimerRef.current = window.setTimeout(() => {
      autoScrollTimerRef.current = null;
      isAutoScrollingRef.current = false;
    }, settle);
    updateRecentAyah(surah, ayah);
  }, [audio.currentAyah, audio.currentSurah, surahNumber]);

  useEffect(() => {
    lastAutoAyahRef.current = null;
  }, [surahNumber]);

  // Уход из ленты БОЛЬШЕ НЕ ГЛУШИТ звук.
  //
  // Здесь стоял `stopAll()` на размонтировании: пока аудио принадлежало
  // экрану, «ушёл с суры — выключили» было единственным разумным поведением.
  // Теперь звук общий на приложение, и это ровно тот сценарий, ради которого
  // делался провайдер: включил суру, зашёл почитать, вернулся — чтение
  // продолжается. Мусхаф звук при уходе не глушил, и поведение двух режимов
  // разошлось бы.
  //
  // Остановка осталась явным действием: крестик в плеере (`stopAll`).
  // ── Jump to a specific ayah by number ──────────────────────────────────────
  // Instant scroll, not smooth: animating across hundreds of ayahs (e.g.
  // 286 → 1 in Al-Baqarah) takes several seconds and reads as "the jump
  // popover is frozen".  Jumping is an explicit "take me there now"
  // intent — instant lands the eye on the target ayah immediately.
  // Header overlap is handled by `scrollMarginTop: 88px` on every
  // article (see the JSX further down), so no follow-up scrollBy
  // compensation is needed.
  // useCallback + closeJump below keep the props passed to JumpPopover
  // referentially stable, so the memoised popover doesn't get re-rendered
  // by every audio-progress tick of SurahScreen (rAF-driven, 60×/s while
  // audio plays) — which is what made the slider feel sluggish.
  //
  // Цель прыжка запоминается, а не ищется один раз в следующем кадре.
  // Раньше искали сразу: `querySelector` по якорю, и если узла в DOM ещё
  // нет — прыжок молча пропадал.  А его там может не быть по двум
  // причинам: аяты монтируются батчами в простое, и лента теперь отдаёт
  // начало суры, не дожидаясь остальных страниц.  Человек выбирал аят
  // 200 и оставался на первом экране, не понимая, почему.
  //
  // Теперь номер живёт в состоянии: он поднимает границу монтирования
  // (forceUpTo ниже) и ждёт, пока узел появится, — эффект следом
  // доводит прокрутку до конца.
  const jumpToAyahNumber = useCallback((ayahNum: number) => {
    setJumpOpen(false);
    setPendingJump(ayahNum);
  }, []);
  const closeJump = useCallback(() => setJumpOpen(false), []);

  // ── Быстрая прокрутка по аятам ──────────────────────────────────────
  //
  // Если аят уже в DOM — прыгаем прямо к нему, мимо состояния React:
  // протяжка идёт каждый кадр, и `jumpToAyahNumber` на каждом шаге
  // перерисовывал бы весь экран суры. Через него — только когда аят ещё не
  // домонтирован: там он и нужен, он поднимает границу монтирования и
  // дожидается узла.
  const scrubToAyah = useCallback((n: number, final: boolean) => {
    const el = document.querySelector<HTMLElement>(`[data-ayah-anchor="${n}"]`);
    if (el) {
      // 🔴 Прямой прыжок отменяет отложенный. Иначе (ревью 10.09.2026):
      // протянул до 160, которого ещё нет, — ушёл отложенный прыжок; вернул
      // палец на 120, который есть, — прыгнули прямо; отпустил — через
      // 100 мс опрос нашёл 160 и увёз страницу туда. Пузырь показывал 120.
      // Только если он есть: протяжка идёт каждый кадр, и лишний setState
      // на каждом шаге будил бы рендер всего экрана суры.
      if (pendingJumpRef.current != null) setPendingJump(null);
      el.scrollIntoView({ behavior: 'auto', block: 'start' });
      return true;
    }
    // Аят ещё не смонтирован. Окончательно (палец отпущен) — прыгаем
    // по-настоящему: поднимаем границу монтирования и ждём узел.
    if (final) { jumpToAyahNumber(n); return true; }
    // Во время протяжки — не монтируем: каждый такой шаг был бы
    // перерисовкой всего экрана и монтажом сотни тяжёлых аятов посреди
    // жеста. Докручиваем до последнего готового; номер в пузыре остаётся
    // верным, а при отпускании прыжок доведётся.
    const готовые = document.querySelectorAll<HTMLElement>('[data-ayah-anchor]');
    готовые[готовые.length - 1]?.scrollIntoView({ behavior: 'auto', block: 'start' });
    return false;
  }, [jumpToAyahNumber]);

  /** Содержимое ленты — только отсюда можно начать быструю прокрутку. */
  const feedRef = useRef<HTMLDivElement>(null);
  // Полоса по координатам ловит и то, что поверх ленты: нижний лист
  // «Чтение»/«Оформление» на телефоне, ползунок перехода к аяту. Удержание
  // на них прокручивало ленту под ними и глотало клик (ревью 10.09.2026).
  const canStartScrub = useCallback((t: Element | null) =>
    !!t && !!feedRef.current?.contains(t)
    && !t.closest('button, a, input, textarea, select, [role="button"], [role="dialog"], [role="slider"]'),
  []);

  /** Аят под пальцем — по середине ширины экрана, на высоте пальца. */
  const ayahUnderFinger = useCallback((y: number): number => {
    const el = document.elementFromPoint(window.innerWidth / 2, y)
      ?.closest<HTMLElement>('[data-ayah-anchor]');
    const n = Number(el?.dataset.ayahAnchor);
    if (Number.isFinite(n) && n > 0) return n;
    // Над заголовком суры или между аятами — ближайший смонтированный.
    let лучший = 1, дистанция = Infinity;
    for (const row of Array.from(document.querySelectorAll<HTMLElement>('[data-ayah-anchor]'))) {
      const r = row.getBoundingClientRect();
      const d = r.top <= y && r.bottom >= y ? 0 : Math.min(Math.abs(r.top - y), Math.abs(r.bottom - y));
      if (d < дистанция) { дистанция = d; лучший = Number(row.dataset.ayahAnchor) || 1; }
    }
    return лучший;
  }, []);

  // Доводим отложенный прыжок, как только нужный аят появился в DOM.
  //
  // Опрашиваем по таймеру, а не «на изменение ленты»: аяты монтируются
  // батчами внутри AyahFeedList, и снаружи это не отражается ни в одном
  // пропе — эффект, завязанный на feed, срабатывал ровно один раз, когда
  // узла ещё не было, и прыжок так и не доезжал.
  //
  // Таймер, а не requestAnimationFrame: rAF не тикает в скрытой вкладке,
  // и прыжок, начатый перед переключением вкладки, зависал бы до
  // возвращения.
  useEffect(() => {
    if (pendingJump == null) return;

    const started = Date.now();
    let timer = 0;

    const tryScroll = () => {
      const el = document.querySelector(
        `[data-ayah-anchor="${pendingJump}"]`,
      ) as HTMLElement | null;

      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
        updateRecentAyah(surahNumber, pendingJump);
        setPendingJump(null);
        return;
      }

      // Десяти секунд хватает и на догрузку последних страниц Бакары, и
      // на монтирование всех её аятов.  Дальше держать цель незачем:
      // либо номер вне суры, либо что-то пошло не так, и вечно ждущий
      // прыжок сработал бы невпопад.
      if (Date.now() - started > 10_000) {
        setPendingJump(null);
        return;
      }
      timer = window.setTimeout(tryScroll, 100);
    };

    tryScroll();
    return () => window.clearTimeout(timer);
  }, [pendingJump, surahNumber]);

  // Смена суры отменяет незавершённый прыжок: номер принадлежал прошлой.
  useEffect(() => { setPendingJump(null); }, [surahNumber]);

  // ── Клавиатура ─────────────────────────────────────────────────────────────
  //
  // Железное правило: экран НЕ забирает клавиши, которыми прокручивают
  // страницу.  Пробел, стрелки вверх/вниз, PageUp/PageDown остаются
  // браузеру всегда.
  //
  // Так было не сразу.  Пробел перехватывался безусловно — `preventDefault`
  // стоял до всяких проверок, — и на экране чтения он вообще перестал
  // прокручивать: на длинной суре человек жмёт пробел, а вместо
  // страницы вниз включается чтение с первого аята.  Стрелки вверх/вниз
  // отбирались, пока в очереди есть аят, а очередь после ПАУЗЫ не
  // очищается (это правильно — из паузы надо уметь продолжить), и
  // прокрутка стрелками оставалась мёртвой до перезагрузки страницы.
  // Ровно это и поймал владелец: «включил аят, выключил — прокрутка
  // перестала работать».
  //
  // Что осталось: горизонтальные стрелки листают аяты (по вертикали они
  // не прокручивают, отбирать их не жалко) и Escape останавливает
  // чтение.  Обе — только когда аудио реально в работе.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Комбинации с модификаторами — не наши: Cmd+стрелка это «в начало
      // документа», Alt+стрелка — навигация по истории.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Читаем аудио из ref, а не из замыкания: useAyahAudio отдаёт новый
      // объект на каждый рендер, а прогресс обновляется ~12 раз в секунду.
      // С `audio` в зависимостях этот эффект снимал и вешал слушатель
      // клавиатуры двенадцать раз в секунду всё время воспроизведения.
      const current = audioRef.current;
      const audioActive = !!(current.currentSurah && current.currentAyah);
      if (!audioActive) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        current.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        current.prev();
      } else if (e.key === 'Escape') {
        current.stopAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Derived: which ayah is "active" right now (playing) ────────────────────
  const activeVerseKey = (audio.currentSurah && audio.currentAyah)
    ? `${audio.currentSurah}:${audio.currentAyah}`
    : null;

  // ── Play/pause helper for the dock ─────────────────────────────────────────
  const handlePlayPause = () => {
    if (audio.audioState === 'playing') {
      audio.pause();
    } else if (audio.currentSurah && audio.currentAyah) {
      // Возобновление идёт через `resume`, и это важно дважды. Оно
      // сохраняет режим (прервали непрерывное чтение — продолжаем им же,
      // иначе вернулись бы швы между аятами) и берёт границы у ЗВУЧАЩЕЙ
      // суры, а не у открытой: звук общий на приложение, и в ленте суры 1
      // может звучать сура 18. Прежний расчёт брал длину открытой суры,
      // очередь считала, что сура кончилась, и чтение обрывалось.
      audio.resume();
    } else {
      // Запуск с начала суры — это намерение слушать её целиком, значит
      // непрерывная запись: склейка из поаятных даёт паузу на каждой границе.
      audio.playFrom(surahNumber, 1, meta?.ayahs ?? 9999, 'surah');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: 'transparent', minHeight: '100dvh', position: 'relative' }}>
      {/* ── Верхняя панель ───────────────────────────────────────────────
          Обычная панель во всю ширину вместо плавающей пилюли — см.
          шапку components/ScreenHeader.tsx. Чистый тап визуально прячет
          панель, но она не размонтируется: геометрия тяжёлого текста
          остаётся постоянной. */}
      <ScreenHeader
          visible={headerVisible}
          title={meta?.transliteration ?? `Сура ${surahNumber}`}
          // Подзаголовка нет намеренно: перевод названия и число аятов
          // крупно стоят в блоке заголовка сразу под панелью, и в
          // первом экране получалось два одинаковых текста подряд.
          onBack={onBack}
          actions={[
            {
              key: 'type',
              label: 'Текст и шрифты',
              icon: <Typography size={ICON_SIZE.lg} />,
              active: typographyOpen,
              ref: typographyBtnRef,
              onClick: () => { setTypographyOpen(v => !v); setJumpOpen(false); setThemeOpen(false); },
            },
            {
              key: 'theme',
              label: 'Оформление',
              icon: <Appearance size={ICON_SIZE.lg} />,
              active: themeOpen,
              ref: themeBtnRef,
              onClick: () => { setThemeOpen(v => !v); setJumpOpen(false); setTypographyOpen(false); },
            },
          ]}
      />

      {/* ── Popovers ──────────────────────────────────────────────────────── */}
      {jumpOpen && meta && (
        <JumpPopover
          maxAyah={meta.ayahs}
          onClose={closeJump}
          onJump={jumpToAyahNumber}
        />
      )}
      {themeOpen && (
        <ThemeSettings
          theme={theme} setTheme={setTheme}
          reciter={reciter}
          onClose={() => setThemeOpen(false)}
          anchorEl={themeBtnRef.current}
        />
      )}
      {typographyOpen && (
        <TypographySettings
          reciter={reciter} setReciter={setReciter}
          surahNumber={surahNumber}
          showArabic={showArabic} setShowArabic={setShowArabic}
          showRu={showRu}         setShowRu={setShowRu}
          arabicScale={arabicScale} setArabicScale={setArabicScale}
          ruScale={ruScale}         setRuScale={setRuScale}
          ruFont={ruFont}         setRuFont={setRuFont}
          showInh={showInh}       setShowInh={setShowInh}
          inhScale={inhScale}     setInhScale={setInhScale}
          inhFont={inhFont}       setInhFont={setInhFont}
          arabicFont={arabicFont} setArabicFont={setArabicFont}
          tajweedStatus={tajweedUiStatus}
          onClose={() => setTypographyOpen(false)}
          anchorEl={typographyBtnRef.current}
        />
      )}

      {/* Быстрая прокрутка по аятам: удержание у левого края и протяжка
          вверх-вниз, номер аята крупно по центру. Полоса начинается с
          22 px: первые 22 принадлежат системному жесту «назад» на iOS
          (IosEdgeBackGesture), и за одно касание они спорить не должны. */}
      {meta && (
        <FastScrubber
          enabled={FAST_SCROLL.ayahFeed}
          count={meta.ayahs}
          left={22}
          width={36}
          topInset={96}
          bottomInset={128}
          startAt={ayahUnderFinger}
          onScrub={scrubToAyah}
          canStart={canStartScrub}
          label={n => ({ big: String(n), small: `аят из ${meta.ayahs}` })}
        />
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div
        ref={feedRef}
        onPointerDown={onReaderPointerDown}
        onPointerMove={onReaderPointerMove}
        onPointerUp={onReaderPointerUp}
        onPointerCancel={() => { readerTapRef.current = null; }}
        style={{
          maxWidth: isDesktop ? '1200px' : '700px',
          margin: '0 auto',
          // Верхний отступ = высота панели + safe-area + воздух.
          // Раньше тут стояли «магические» 88/112 px под плавающую
          // пилюлю; теперь высота панели импортируется из самого
          // компонента и не может разъехаться с ним.
          paddingTop: screenHeaderOffset(28),
          paddingLeft: isDesktop ? '48px' : '18px',
          paddingRight: isDesktop ? '48px' : '18px',
          paddingBottom: isDesktop ? '160px' : '140px',
          position: 'relative', zIndex: 1,
        }}
      >
        {/* Surah header — Arabic surah_header glyph from QCF (real mushaf header) */}
        {meta && (
          <SurahTitleBlock meta={meta} decor={feed?.decor ?? null} />
        )}

        {/* Шрифт не приехал — объясняем и даём повтор.  Без этого на
            месте аятов остались бы одни заготовки строк без причины. */}
        <FontErrorBanner source={arabicFont === 'qpc-v4-tajweed' ? 'both' : 'qcf'} />

        {tajweedMode && (
          <TajweedLoadNotice
            loading={tajweedLoading}
            error={priorityTajweed.error}
            onRetry={priorityTajweed.retry}
          />
        )}

        {/* Loading state */}
        {(feedLoading || !quranSources) && <AyahFeedSkeleton />}

        {feedError && (
          <div style={{
            textAlign: 'center', padding: '60px 16px',
            fontSize: 'var(--font-subhead)', color: 'var(--text-tertiary)',
          }}>
            Ошибка загрузки суры<br />
            <span style={{ fontSize: 'var(--font-caption1)', opacity: 0.7 }}>{feedError}</span>
          </div>
        )}

        {/* Feed of ayahs — progressive disclosure через AyahFeedList.
            Первые 30 ayah'ей mount'ятся сразу, остальные подъезжают
            батчами по 30 через requestIdleCallback.  Бакара first
            paint: 1.5-2 сек → ~200 мс на iPhone 12.
            forceUpTo учитывает initialAyah + активный аят озвучки —
            гарантия, что scroll-to-anchor + word-highlight найдут
            DOM-ноду. */}
        {!feedLoading && quranSources && feed && feed.ayahs.length > 0 && (() => {
          const targetAyah = initialAyah ?? null;
          const activeAyahNum = activeVerseKey
            ? parseInt(activeVerseKey.split(':')[1] ?? '0', 10) || null
            : null;
          // Цель прыжка тоже поднимает границу: без неё аят, до которого
          // не дошёл постепенный монтаж, никогда не появится в DOM, и
          // прыжок будет ждать вечно.
          const forceTarget = Math.max(
            targetAyah ?? 0, activeAyahNum ?? 0, pendingJump ?? 0,
          );
          return (
          <AyahFeedList
            totalAyahs={feed.ayahs.length}
            forceUpTo={forceTarget}
            resetKey={surahNumber}
          >
          {(visibleCount) => (
          <div>
            {feed.ayahs.slice(0, visibleCount).map(entry => {
              const isActiveAyah = activeVerseKey === entry.verseKey;
              return (
                <AyahRow
                  key={entry.verseKey}
                  entry={entry}
                  translation={quranSources[entry.verseKey]?.translations.ru}
                  inhTranslation={inhDisplayText(entry.verseKey, k => quranSources[k]?.translations.inh)}
                  showArabic={showArabic}
                  showRu={showRu}
                  showInh={showInh}
                  arabicFont={arabicFont}
                  arabicScale={arabicScale}
                  ruFont={ruFont}
                  ruScale={ruScale}
                  inhFont={inhFont}
                  inhScale={inhScale}
                  wholeAyahHighlight={wholeAyahHighlight}
                  isActive={isActiveAyah}
                  // Неактивной строке позиция слова и состояние плеера не
                  // нужны — иначе memo срабатывал бы вхолостую на каждом
                  // тике аудио у всех 286 аятов сразу.
                  activeWordPos={isActiveAyah ? tick.currentWordPos : null}
                  audioState={isActiveAyah ? audio.audioState : 'idle'}
                  eager={entry.ayah >= eagerAnchor && entry.ayah < eagerAnchor + EAGER_AYAHS}
                  onPlay={handleAyahPlay}
                />
              );
            })}
          </div>
          )}
          </AyahFeedList>
          );
        })()}
      </div>

      {/* ── BottomDock ────────────────────────────────────────────────────── */}
      {audio.currentSurah && audio.currentAyah && (
        <BottomDock
          audioState={audio.audioState}
          currentAyah={audio.currentAyah}
          progress={tick.progress}
          playbackRate={audio.playbackRate}
          onPlayPause={handlePlayPause}
          onPrev={audio.prev}
          onNext={audio.next}
          onCyclePlaybackRate={audio.cyclePlaybackRate}
          onClose={audio.stopAll}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TajweedLoadNotice({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (!loading && !error) return null;

  return (
    // Плашка лежит ПОВЕРХ ленты, а не в её потоке.
    //
    // В потоке она появлялась и исчезала прямо во время чтения: цветной
    // таджвид грузится постранично, человек прокручивает на новую страницу
    // мусхафа — плашка монтируется и сдвигает весь текст ниже, потом данные
    // приезжают, плашка пропадает, и текст возвращается. Читать в это время
    // невозможно.
    //
    // Фиксированное положение под шапкой снимает вопрос: геометрия ленты не
    // меняется вовсе. `pointer-events` включены только у самой плашки —
    // кнопка повтора должна нажиматься, а остальная площадь остаётся
    // прозрачной для тапа по аяту.
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: screenHeaderOffset(8),
        left: 'var(--space-margin)',
        right: 'var(--space-margin)',
        zIndex: 40,
        maxWidth: 'min(100%, 760px)',
        marginInline: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '11px 13px',
        borderRadius: 'var(--radius-control)',
        border: '1px solid var(--hairline-strong)',
        background: 'linear-gradient(rgb(var(--gold-rgb) / 0.08), rgb(var(--gold-rgb) / 0.08)), var(--surface)',
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.10)',
        color: 'var(--text-secondary)',
        fontSize: 'var(--font-footnote)',
        lineHeight: 1.4,
      }}
    >
      {loading && <AudioSpinner size={ICON_SIZE.md} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        {error
          ? 'Не удалось загрузить данные цветного таджвида. Пока показан обычный мусхаф.'
          : 'Загружаем цветной таджвид для текущего аята…'}
      </span>
      {error && (
        <button
          onClick={onRetry}
          style={{
            flexShrink: 0,
            minHeight: '32px',
            padding: '0 12px',
            borderRadius: '9999px',
            border: '1px solid var(--hairline-strong)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            fontSize: 'var(--font-footnote)',
            cursor: 'pointer',
          }}
        >
          Повторить
        </button>
      )}
    </div>
  );
}

/** Title block — transliteration, meaning, Bismillah (QCF basmala glyph row).
 *  The Bismillah here is intentionally NOT scaled by the user's arabicScale
 *  pref: the glyph is one wide ligature, and at scale=1.4 on a 320-360 px
 *  phone it overflows the screen edge (the user reported it cropping out
 *  of the left margin on Al-Anfal).  Fixed 40 px keeps it stable across
 *  all themes / pickers / screen sizes; the body ayahs continue to scale
 *  freely in QcfAyahLine. */
/**
 * AyahFeedList — thin wrapper, который держит хук useChunkedRender
 * (хук должен быть в стабильном render-path; внутри conditional IIFE
 * родителя — нарушит rules-of-hooks).  Children — render-prop, получает
 * текущий visibleCount.
 */
function AyahFeedList({
  totalAyahs,
  forceUpTo,
  resetKey,
  children,
}: {
  totalAyahs: number;
  forceUpTo: number;
  resetKey: number;
  children: (visibleCount: number) => ReactNode;
}) {
  const visibleCount = useChunkedRender(totalAyahs, {
    // Первым заходом ставили 30 — тогда это был выбор между «весь Коран
    // сразу» и «хоть что-то».  Сейчас узкое место другое: до первой
    // отрисовки React монтирует все 30 аятов, а на экране их два-три, и у
    // Аш-Шуара (227 аятов) это стоило почти две секунды ожидания.
    //
    // Шесть покрывают первый экран при любом кегле, остальные подъезжают
    // батчами в простое — человек этого уже не замечает.
    initial: 6,
    batch: 30,
    forceUpTo,
    resetKey,
  });
  return <>{children(visibleCount)}</>;
}

function SurahTitleBlock({ meta, decor }: {
  meta: { number: number; transliteration: string; russian: string; ayahs: number; arabic: string };
  decor: import('../hooks/useQcfAyahFeed').QcfSurahDecor | null;
}) {
  // Surah 1 (Al-Fatiha) has the basmala AS ayah 1 — don't show a separate basmala.
  // Surah 9 (At-Tawba) has no basmala at all — QCF data reflects this (decor.basmala empty).
  //
  // Басмала ждёт свой шрифт: до его прихода на её месте был бы кубик, а
  // здесь всего одна строка — скелет ради неё выглядел бы навязчиво,
  // поэтому просто держим место пустым до готовности.
  const decorReady = useQcfFont(decor?.fonts ?? []);
  const hasBasmala =
    meta.number !== 1 && !!decor && decor.basmala.length > 0;

  return (
    <div style={{ textAlign: 'center', padding: '4px 0 24px' }}>
      <div
        className="display-serif"
        style={{
          fontSize: 'var(--font-title1)', fontWeight: 'var(--weight-regular)',
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {meta.transliteration}
      </div>
      <div style={{
        marginTop: '4px',
        fontSize: 'var(--font-footnote)',
        color: 'var(--text-tertiary)',
        letterSpacing: '0.02em',
      }}>
        {meta.russian} · {meta.ayahs} аят{meta.ayahs === 1 ? '' : (meta.ayahs < 5 ? 'а' : 'ов')}
      </div>

      {/* Bismillah row — rendered with QCF glyphs (real mushaf basmala).
          FIXED 40 px regardless of the user's arabicScale.  The glyph is
          one continuous ligature, and at higher scales (1.2 / 1.4) it
          ran off the left edge on narrow phones — the user reported
          cropping on Al-Anfal at scale 1.4.  Plus a `max-width: 100%` +
          horizontal padding cushion guards against any future mushaf
          rendering with an even wider basmala glyph. */}
      {hasBasmala && decor && (
        <div
          dir="rtl"
          style={{
            direction: 'rtl',
            textAlign: 'center',
            marginTop: '28px',
            paddingLeft: '12px',
            paddingRight: '12px',
            fontSize: '40px',
            lineHeight: 1.8,
            height: '72px',
            color: 'var(--text-primary)',
            maxWidth: '100%',
            overflow: 'hidden',
            opacity: decorReady ? 1 : 0,
          }}
        >
          {decorReady && decor.basmala.map((w, i) => (
            <span
              key={i}
              dir="rtl"
              style={{
                // Семейство с суффиксом страницы — см. qcfPageFamily.
                // `?? ''` — только ради типа: у слов V4 шрифт назван всегда.
                fontFamily: `'${qcfPageFamily(w.font ?? '', w.page ?? 0)}', serif`,
                whiteSpace: 'nowrap',
                letterSpacing: '0',
                wordSpacing: '0',
                // QCF PUA codepoints are strong-LTR; without per-word bidi
                // isolation the spans collapse into one LTR run and render in
                // DOM order (left-to-right) instead of the parent's RTL order.
                // See web/src/components/QcfAyahLine.tsx header for full notes.
                unicodeBidi: 'isolate',
              }}
            >
              {w.char}
            </span>
          ))}
        </div>
      )}

      {/* Decorative divider */}
      <div style={{
        height: '1px',
        margin: '28px auto 4px',
        width: '64px',
        background: 'var(--hairline-strong)',
        opacity: 0.6,
      }} />
    </div>
  );
}

/** Skeleton placeholder while QCF feed loads. */
/**
 * Одна строка ленты: арабский, перевод, ссылка и кнопки.
 *
 * Вынесена из инлайнового .map и обёрнута в memo ради аудио: прогресс
 * обновляется ~12 раз в секунду, и без этого React на каждый тик пересобирал
 * все смонтированные аяты. Пропсы намеренно примитивные, а `entry` приходит
 * из кэша ленты и стабилен по ссылке — иначе memo не даёт ничего.
 *
 * Неактивная строка получает activeWordPos = null и audioState = 'idle', то
 * есть её пропсы во время воспроизведения не меняются вовсе.
 */
const AyahRow = memo(function AyahRow({
  entry, translation, inhTranslation, showArabic, showRu, showInh, arabicFont, arabicScale,
  ruFont, ruScale, inhFont, inhScale, wholeAyahHighlight, isActive, activeWordPos, audioState,
  eager, onPlay,
}: {
  entry: QcfAyahEntry;
  translation: string | undefined;
  /** Уже отфильтрован inhDisplayText — показывать как есть. */
  inhTranslation: string | undefined;
  showArabic: boolean;
  showRu: boolean;
  showInh: boolean;
  arabicFont: ArabicFontId;
  arabicScale: number;
  ruFont: LatinFontId;
  ruScale: number;
  inhFont: LatinFontId;
  inhScale: number;
  wholeAyahHighlight: boolean;
  isActive: boolean;
  activeWordPos: number | null;
  audioState: 'idle' | 'loading' | 'playing' | 'paused';
  eager: boolean;
  onPlay: (surah: number, ayah: number) => void;
}) {
  // Per-scale bump for serif faces (EB Garamond + Alice):
  //   scales 0.85 / 1.0 / 1.2 → +5px   (gentle lift over Inter)
  //   scale  1.4              → +10px  (one extra at the largest reading
  //                                     step so the increase reads as
  //                                     deliberate)
  // Inter faces stay at the pure scale-based calc.
  const serifBump = (v: number): number => (v >= 1.4 ? 10 : 5);
  const translationFontSize = (font: LatinFontId, scale: number) => latinIsSerif(font)
    ? `calc(16px * ${scale} + ${serifBump(scale)}px)`
    : `calc(16px * ${scale})`;
  const ruFontSize = translationFontSize(ruFont, ruScale);
  const inhFontSize = translationFontSize(inhFont, inhScale);
  const ruLineHeight = 1.48;
  const inhVisible = showInh && !!inhTranslation;

  return (
    <article
      data-ayah-anchor={entry.ayah}
      className={`ayah-row${isActive ? ' active' : ''}`}
      style={{ scrollMarginTop: screenHeaderOffset(12) }}
    >
      {/* Arabic — QCF V4 default; ArabicAyahRouter switches to V1 or
          Uthmani rendering based on the reader's font preference. */}
      {showArabic && (
        <div
          className="arabic-ayah-audio-frame"
          data-whole-ayah-active={
            isActive && wholeAyahHighlight ? 'true' : undefined
          }
        >
          <ArabicAyahRouter
            verseKey={entry.verseKey}
            ayahNumber={entry.ayah}
            pageNum={entry.pageNum}
            words={entry.words}
            fonts={entry.fonts}
            arabicFont={arabicFont}
            activeWordPos={activeWordPos}
            isActive={isActive}
            scale={arabicScale}
            eager={eager}
          />
        </div>
      )}

      {/* Ingush — первый перевод под арабским: приложение ингушское.
          Цвет основного текста, чтобы два перевода подряд не сливались:
          русский ниже остаётся вторичным. */}
      {inhVisible && (
        <p lang="inh" style={{
          margin: showArabic ? '14px 0 0' : 0,
          fontFamily: inhFontStack(inhFont),
          fontFeatureSettings: INH_FONT_FEATURES,
          fontSize: inhFontSize,
          fontWeight: latinWeight(inhFont),
          lineHeight: ruLineHeight,
          color: 'var(--text-primary)',
          letterSpacing: '-0.005em',
        }}>
          {inhTranslation}
        </p>
      )}

      {/* Russian */}
      {showRu && translation && (
        <p lang="ru" style={{
          margin: showArabic || inhVisible ? (inhVisible ? '10px 0 0' : '14px 0 0') : 0,
          fontFamily: latinStack(ruFont),
          fontSize: ruFontSize,
          fontWeight: latinWeight(ruFont),
          lineHeight: ruLineHeight,
          color: 'var(--text-secondary)',
          letterSpacing: '-0.005em',
        }}>
          {translation}
        </p>
      )}

      <div style={{
        display: 'flex', alignItems: 'center',
        gap: '8px', marginTop: '12px',
      }}>
        <span style={{
          fontSize: 'var(--font-caption1)', fontWeight: 'var(--weight-regular)',
          color: 'var(--text-tertiary)', letterSpacing: '0.04em',
          fontVariantNumeric: 'tabular-nums',
          padding: '5px 12px',
          border: '1px solid var(--hairline)',
          borderRadius: '9999px', lineHeight: 1,
        }}>
          {entry.surah}:{entry.ayah}
        </span>

        <span style={{
          fontSize: 'var(--font-caption2)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.04em',
          opacity: 0.7,
          lineHeight: 1,
        }}>
          стр.&nbsp;{entry.pageNum}
        </span>

        <BookmarkBtn surah={entry.surah} ayah={entry.ayah} />

        <PlayBtn
          isActive={isActive}
          audioState={audioState}
          onPlay={() => onPlay(entry.surah, entry.ayah)}
        />
      </div>
    </article>
  );
});

function AyahFeedSkeleton() {
  return (
    <div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: '14px 0',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div className="skeleton" style={{
            height: '34px', borderRadius: '4px',
            width: i % 2 === 0 ? '92%' : '78%',
            marginBottom: '14px',
          }} />
          <div className="skeleton" style={{
            height: '16px', borderRadius: '4px',
            width: '88%', marginBottom: '8px',
          }} />
          <div className="skeleton" style={{
            height: '16px', borderRadius: '4px',
            width: '70%',
          }} />
        </div>
      ))}
    </div>
  );
}

/** Bookmark button — manages its own local state */
function BookmarkBtn({ surah, ayah }: { surah: number; ayah: number }) {
  const [marked, setMarked] = useState(() => isBookmarked(surah, ayah));
  return (
    <button
      aria-label={marked ? 'Убрать из закладок' : 'В закладки'}
      onClick={e => { e.stopPropagation(); setMarked(toggleBookmark(surah, ayah)); }}
      className="icon-btn"
      data-active={marked}
      style={{
        width: '40px', height: '40px', marginInlineStart: 'auto',
        color: marked ? 'var(--text-primary)' : 'var(--text-tertiary)',
      }}
    >
      <BookmarkIcon isFilled={marked} />
    </button>
  );
}

/** Play/pause button for a single ayah */
function PlayBtn({
  isActive, audioState, onPlay,
}: {
  isActive: boolean;
  audioState: 'idle' | 'loading' | 'playing' | 'paused';
  onPlay: () => void;
}) {
  const playing = isActive && audioState === 'playing';
  const loading = isActive && audioState === 'loading';
  return (
    <button
      aria-label={loading ? 'Загрузка аята' : playing ? 'Пауза' : 'Слушать аят'}
      // aria-disabled, а не disabled. У заблокированного контрола WebKit
      // не доставляет указательные события самому контролу, и распознаватель
      // тапа по области чтения видел нажатие на <article> — панель прыгала
      // от нетерпеливого второго нажатия во время загрузки аята. С
      // aria-disabled кнопка остаётся целью события, её ловит фильтр, а
      // повторное нажатие гасится проверкой в обработчике.
      onClick={e => {
        e.stopPropagation();
        if (loading) return;
        onPlay();
      }}
      className="icon-btn"
      data-active={isActive}
      aria-disabled={loading || undefined}
      style={{
        width: '40px', height: '40px',
        color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
        cursor: loading ? 'wait' : 'pointer',
      }}
    >
      {loading
        ? <AudioSpinner size={ICON_SIZE.md} />
        : playing
          ? <Pause size={ICON_SIZE.md} />
          : <Play size={ICON_SIZE.md} />}
    </button>
  );
}

/**
 * Jump-to-ayah popover — scrolls the feed to the chosen ayah's anchor.
 */
const JumpPopover = memo(function JumpPopover({
  maxAyah, onJump, onClose,
}: {
  maxAyah: number;
  onJump: (n: number) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(1);
  // Direct-edit mode: clicking the big number turns it into a text
  // input so the user can type the target ayah number instead of
  // dragging the slider or hunting through chips.  Confirmed on
  // Enter / blur; Esc cancels.  Clamped to [1, maxAyah] on commit.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('1');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(String(val));
    setEditing(true);
  };
  const commitEdit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 1) {
      setVal(Math.min(maxAyah, Math.max(1, n)));
    }
    setEditing(false);
  };
  const cancelEdit = () => {
    setEditing(false);
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 39 }} />
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: '60px', right: '12px', zIndex: 40,
          background: 'rgb(var(--surface-rgb) / 0.92)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          border: '1px solid var(--hairline)', borderRadius: '16px',
          padding: '20px', width: 'min(300px, calc(100vw - 24px))',
          boxShadow: 'rgba(0,0,0,0.04) 0 1px 2px, rgba(0,0,0,0.10) 0 16px 40px',
        }}
      >
        <p style={{
          margin: '0 0 4px', fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.10em',
        }}>
          Перейти к аяту
        </p>

        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft}
            onChange={e => {
              // Allow only digits while typing
              const cleaned = e.target.value.replace(/[^\d]/g, '');
              setDraft(cleaned);
            }}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            className="display-serif"
            aria-label="Номер аята"
            style={{
              display: 'block', width: '100%', boxSizing: 'border-box',
              fontSize: '64px', fontWeight: 'var(--weight-regular)', lineHeight: 1,
              color: 'var(--text-primary)', textAlign: 'center',
              fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
              margin: '12px 0',
              background: 'transparent', border: 'none', outline: 'none',
              padding: 0,
              fontFamily: 'inherit',
              // Hide the native number-spinner ticks in WebKit
              MozAppearance: 'textfield',
            }}
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={startEdit}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                startEdit();
              }
            }}
            aria-label={`Текущий номер ${val}. Кликни, чтобы ввести вручную`}
            className="display-serif"
            style={{
              fontSize: '64px', fontWeight: 'var(--weight-regular)', lineHeight: 1,
              color: 'var(--text-primary)', textAlign: 'center',
              fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
              margin: '12px 0',
              cursor: 'text',
              userSelect: 'none',
              outline: 'none',
            }}
          >
            {val}
          </div>
        )}

        <input
          className="range-slider"
          type="range"
          min={1} max={maxAyah} value={val}
          onChange={e => setVal(parseInt(e.target.value, 10))}
        />
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: '6px', fontSize: 'var(--font-caption2)', color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>1</span><span>{maxAyah}</span>
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '6px',
          marginTop: '14px', justifyContent: 'center',
        }}>
          {quickChips(maxAyah).map(n => (
            <button
              key={n}
              onClick={() => setVal(n)}
              style={{
                minWidth: '40px', padding: '7px 12px', borderRadius: '9999px',
                border: `1px solid ${val === n ? 'var(--text-primary)' : 'var(--hairline-strong)'}`,
                background: val === n ? 'var(--accent-dim)' : 'transparent',
                color: 'var(--text-primary)', fontFamily: 'inherit',
                fontSize: 'var(--font-footnote)', fontWeight: 'var(--weight-regular)', cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {n}
            </button>
          ))}
        </div>

        <button
          onClick={() => onJump(val)}
          style={{
            marginTop: '16px', width: '100%', minHeight: '44px',
            padding: '11px 0', borderRadius: '9999px', border: 'none',
            background: 'var(--ink, #0c0a09)', color: 'var(--surface)',
            fontFamily: 'inherit', fontSize: 'var(--font-subhead)', fontWeight: 'var(--weight-regular)',
            cursor: 'pointer', letterSpacing: '0.005em',
          }}
        >
          К аяту {val}
        </button>
      </div>
    </>
  );
});

function quickChips(max: number): number[] {
  if (max <= 12) return [1, Math.ceil(max / 2), max];
  const step = max <= 50 ? 10 : max <= 120 ? 25 : 50;
  const chips: number[] = [1];
  for (let n = step; n < max; n += step) chips.push(n);
  chips.push(max);
  return chips;
}
