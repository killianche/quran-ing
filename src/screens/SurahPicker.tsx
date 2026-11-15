/**
 * SurahPicker — главный экран: «Коран», «Продолжить чтение», поиск, 114 сур.
 *
 * ── Главная (владелец 2026-10-04) ─────────────────────────────────────
 *
 * Порядок: крупный «Коран» со стеклянной панелью → «Продолжить чтение»
 * (карточки недавних сур) → поиск → суры.
 *
 * В тот же день была обложка-фото ковров с затемнением и подзаголовками —
 * владелец: «слишком много всего… привести к минималистичному виду».
 * Убрана; не возвращать. Стиль — как у остальных экранов (LargeTitleHeader).
 *
 * ── Что изменилось против прежней версии ──────────────────────────────
 *
 * Была сетка карточек 2×57 с крупным арабским названием по центру.
 * Красиво на скриншоте, но плохо работает как список: карточка
 * одинакова для «Аль-Фатихи» и для «Аль-Бакары», глазу не за что
 * зацепиться, а номер суры — то, чем люди реально пользуются, — стоял
 * мелко в подписи.  Заменено на строки: номер в рамке слева, название
 * и подпись, арабское начертание справа.  Строка сканируется за один
 * взгляд, помещается больше, и появилось место для перевода названия.
 *
 * ── Поиск ─────────────────────────────────────────────────────────────
 *
 * Ищет и суры, и текст перевода (см. lib/search.ts).  Результаты по
 * аятам показываются фрагментом с подсвеченным совпадением; тап
 * открывает суру сразу на нужном аяте.
 *
 * Поиск по переводу считается в `useDeferredValue`: набор текста
 * остаётся отзывчивым, а тяжёлый проход по 6236 аятам React выполняет
 * в фоне и не блокирует ввод.
 *
 * ── Иллюстрация и вид списка (владелец 15.11.2026) ────────────────────
 *
 * Над «Продолжить чтение» — векторная сцена с ингушскими башнями
 * (components/HomeScene.tsx): «не хватает сверху картинки, всё скучно».
 * Строка суры — вариант B «Арабское крупно» (см. SurahRow).
 *
 * ── Джузы ─────────────────────────────────────────────────────────────
 *
 * Подписи «Джуз N» над сурами давали «1 → 3 → 4 → 6»: джузы 2 и 5
 * начинаются посреди Аль-Бакары и Ан-Нисы. Переключатель «Суры / Джузы»
 * снят 10.08.2026. 15.11.2026 пробовали два столбца с честным делением по
 * джузам (продолжения сур диапазоном аятов) — владелец выбрал список B.
 * Пробная раскладка лежит в коммите b60a8a3, если понадобится вернуть.
 *
 * ── Типографика ───────────────────────────────────────────────────────
 *
 * Все кегли, веса, радиусы и отступы — ступени шкалы из src/index.css.
 * Строки списка и заголовки секций выровнены по одному отступу
 * (--space-hair), чтобы номер суры стоял ровно под словом «Суры».
 */

import { useState, useMemo, useRef, useDeferredValue, useLayoutEffect, useEffect, useCallback, memo } from 'react';
import { FastScrubber } from '../components/FastScrubber';
import { FAST_SCROLL } from '../lib/fastScroll';
import { SURAHS, SURAH_BY_NUMBER, type SurahMeta } from '../content/surahs';
import { readRecents } from '../lib/recents';
import { AYAH_LANG_LABEL, search, snippet, visibleSearchLangs, warmSearchIndex, type AyahHit } from '../lib/search';
import { useQuranSources } from '../content/quran-sources-lazy';
import { Appearance, Search, Close, Bookmark as BookmarkIcon, Person, TabPrayer, ICON_SIZE, Play, Pause } from '../components/icons';
import { ThemeSettings } from '../components/ReadingSettings';
import { useAudioActions, useAudioState } from '../hooks/AudioProvider';
import { reciterHasSurah } from '../lib/reciters';
import { TAB_BAR_SPACE } from '../components/TabBar';
import { tabBarTopPx } from '../lib/nativeTabBar';
import { prefetchSurahFeed } from '../hooks/useQcfAyahFeed';
import type { Theme } from '../hooks/useTheme';
import { HitArea } from '../components/HitArea';
import { LargeTitleHeader, type HeaderAction } from '../components/ScreenHeader';
import type { TabFrame } from '../components/TabPager';
import { HomeScene } from '../components/HomeScene';

/**
 * Единственная форма капс-подзаголовка на экране: «Продолжить чтение»
 * и заголовки секций выдачи.
 *
 * В шкале нет трекинга для прописных — `--tracking-loose` (0.01em)
 * рассчитан на мелкий строчный текст.  На капсе 11px он слипается,
 * поэтому разряд задан явно, одним значением на весь файл.
 */
const CAP_LABEL: React.CSSProperties = {
  fontSize: 'var(--font-caption2)',
  lineHeight: 'var(--leading-caption2)',
  fontWeight: 'var(--weight-semibold)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

type Props = {
  onSelectSurah: (number: number, ayah?: number) => void;
  onBookmarks?: () => void;
  /** Время намаза — кнопкой в шапке (в нижнем меню его больше нет). */
  onPrayer?: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Аккаунт переехал из нижнего меню сюда, в шапку. */
  onAccount?: () => void;
  /** false — главная припаркована под экраном «поверх» (App.tsx): она в
   *  DOM, но не видна; жесты и попапы выключены. */
  active?: boolean;
  /** Своя прокрутка вкладки и слой шапки (TabPager); null — первый кадр.
   *  Главная прокручивает не окно, а свою страницу. */
  frame?: TabFrame | null;
};

/** Склонение слова «аят». */
function ayahWord(n: number): string {
  const two = n % 100, one = n % 10;
  if (two >= 11 && two <= 14) return 'аятов';
  if (one === 1) return 'аят';
  if (one >= 2 && one <= 4) return 'аята';
  return 'аятов';
}

/**
 * Предзагрузка суры по касанию её строки или карточки.
 *
 * Не сразу на pointerdown: так начинается и прокрутка списка пальцем, и
 * свайп по «Аль-Бакаре» качал бы и собирал 48 страниц прямо во время
 * прокрутки (ревью 2026-10-04). Ждём 90 мс: если за это время началась
 * прокрутка, WKWebView пришлёт pointercancel, и загрузка не стартует.
 * Короткий тап (палец поднят раньше) запускает её на отпускании — до
 * клика, который придёт следом.
 */
function usePressPrefetch(surah: number) {
  const timer = useRef(0);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
  };
  return {
    start: () => {
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        prefetchSurahFeed(surah);
      }, 90);
    },
    /** Палец поднят — это тап: грузим, не дожидаясь таймера. */
    commit: () => {
      if (!timer.current) return;
      clear();
      prefetchSurahFeed(surah);
    },
    cancel: clear,
  };
}

export function SurahPicker({ onSelectSurah, onBookmarks, onPrayer, onAccount, theme, setTheme, active = true, frame }: Props) {
  const [query, setQuery] = useState('');
  const [themeOpen, setThemeOpen] = useState(false);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Поиск по 6236 переводам — работа заметная.  useDeferredValue
  // отдаёт вводу приоритет: буквы появляются сразу, список
  // догоняет следующим кадром.
  const deferredQuery = useDeferredValue(query);
  const searching = query.trim().length > 0;
  // Словарь переводов лежит отдельным чанком, чтобы не задерживать старт.
  // Начинаем тянуть его при первом же вводе; обычно он уже прогрет в простое
  // (см. warmQuranSources в App.tsx), и ждать не приходится.
  const sourcesReady = useQuranSources(searching) != null;
  const results = useMemo(
    () => search(deferredQuery, { langs: visibleSearchLangs() }),
    // sourcesReady в зависимостях намеренно: как только словарь доехал,
    // выдачу нужно пересчитать — сам запрос при этом не менялся.
    [deferredQuery, sourcesReady],
  );

  // Перечитываются при возврате на главную: она больше не монтируется
  // заново после суры (паркуется), а прочитанное только что должно стать
  // первой карточкой.
  const recents = useMemo(
    () => readRecents().map(r => ({ ...r, meta: SURAH_BY_NUMBER[r.surah] })).filter(r => r.meta),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active],
  );
  /** Докуда дочитана сура — полоса прогресса в строке списка. */
  const readAyah = useMemo(
    () => new Map(recents.map(r => [r.surah, r.ayah] as const)),
    [recents],
  );
  // Попап оформления — портал в body: у припаркованной главной он остался
  // бы висеть над сурой.
  useEffect(() => { if (!active) setThemeOpen(false); }, [active]);
  const searchRef = useRef<HTMLDivElement>(null);

  const actions: HeaderAction[] = [
    ...(onPrayer ? [{ key: 'prayer', label: 'Намаз', icon: <TabPrayer size={ICON_SIZE.md} />, onClick: onPrayer }] : []),
    ...(onBookmarks ? [{ key: 'bookmarks', label: 'Закладки', icon: <BookmarkIcon size={ICON_SIZE.md} />, onClick: onBookmarks }] : []),
    {
      key: 'theme', label: 'Оформление', ref: themeBtnRef, active: themeOpen,
      icon: <Appearance size={ICON_SIZE.md} />,
      onClick: () => setThemeOpen(v => !v),
    },
  ];
  // Аккаунт — отдельным кругом справа, как профиль в системных приложениях:
  // он о человеке, а не о чтении, и в одной капсуле с намазом и закладками
  // выглядел бы четвёртым равным действием.
  const accountGroup: HeaderAction[] = onAccount
    ? [{ key: 'account', label: 'Аккаунт', icon: <Person size={ICON_SIZE.md} />, onClick: onAccount }]
    : [];

  const barRef = useRef<HTMLElement | null>(null);
  /** Нижняя кромка панели в координатах окна. */
  const barBottom = () => barRef.current?.getBoundingClientRect().bottom ?? 0;

  /**
   * Поднять поле поиска к панели: клавиатура закроет половину экрана, а
   * поле стоит под заголовком и «Недавними» — выдача должна быть видна над
   * клавиатурой, как в системных списках iOS.
   */
  const raiseSearch = (smooth: boolean) => {
    const field = searchRef.current;
    if (!field) return;
    // Прокручивается страница вкладки (TabPager), а не окно; без неё —
    // окно, как прежде.
    const scroller = frame?.scroller;
    const current = scroller ? scroller.scrollTop : window.scrollY;
    const top = field.getBoundingClientRect().top + current - barBottom() - 8;
    if (Math.abs(current - top) < 1) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    (scroller ?? window).scrollTo({ top, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  };

  /**
   * Первая буква убирает «Недавние» и список сур — документ укорачивается,
   * и браузер срезал бы прокрутку до нуля: поле уехало бы обратно под
   * заголовок, под клавиатуру. Поэтому у блока выдачи минимальная высота в
   * экран (ниже), а здесь поле возвращается к панели сразу, до кадра.
   */
  useLayoutEffect(() => {
    if (searching) raiseSearch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100dvh' }}>
      {themeOpen && (
        <ThemeSettings
          theme={theme}
          setTheme={setTheme}
          onClose={() => setThemeOpen(false)}
          anchorEl={themeBtnRef.current}
        />
      )}

      <div style={{
        maxWidth: 'min(100%, 720px)',
        margin: '0 auto',
        padding: `0 var(--space-margin) calc(${TAB_BAR_SPACE} + var(--space-section) + var(--mini-player-space, 0px) + env(safe-area-inset-bottom))`,
      }}>
        {/* Крупный «Коран» — в строке панели, слева вверху, как у остальных
            вкладок; при прокрутке сжимается на месте. */}
        <LargeTitleHeader
          frame={frame}
          title="Коран"
          actionGroups={[actions, accountGroup]}
          headerRef={barRef}
          active={active}
        />
        {/* Иллюстрация — только на полном экране: при поиске выдаче нужно
            всё место над клавиатурой. */}
        {!searching && <HomeScene />}
        {!searching && recents.length > 0 && (
          <Recents
            recents={recents}
            onOpen={(surah, ayah) => onSelectSurah(surah, ayah)}
          />
        )}

        {/* ── Поиск ─────────────────────────────────────────────────────── */}
        <div
          ref={searchRef}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
            height: 'calc(var(--hit-min) + var(--space-tight))',
            padding: '0 var(--space-cozy)',
            // Капсула, а не скруглённый прямоугольник: в iOS 26 поле поиска
            // именно пилюля, той же формы, что и плавающие панели.
            borderRadius: 'var(--radius-pill)',
            background: 'rgb(var(--ink-rgb) / 0.06)',
            marginTop: searching ? 'var(--space-section)' : 0,
            marginBottom: 'var(--space-margin)',
          }}
        >
          <span aria-hidden style={{ color: 'var(--text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
            <Search size={ICON_SIZE.md} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            // Фокус — сигнал, что сейчас будут искать: готовим поисковый
            // словарь порциями, пока человек набирает первые буквы.
            onFocus={() => { warmSearchIndex(); raiseSearch(true); }}
            placeholder="Сура, номер или слово из перевода"
            aria-label="Поиск"
            enterKeyHint="search"
            style={{
              flex: 1, minWidth: 0,
              border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              // 17 px: Body — и заодно меньше 16 iOS увеличила бы страницу
              // при фокусе.
              fontSize: 'var(--font-body)',
              lineHeight: 'var(--leading-body)',
              letterSpacing: 'var(--tracking-tight)',
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Очистить"
              className="icon-btn"
              style={{
                position: 'relative',
                width: '30px', height: '30px', flexShrink: 0,
                color: 'var(--text-tertiary)',
              }}
            >
              <Close size={ICON_SIZE.sm} />
              <HitArea />
            </button>
          )}
        </div>

        {searching
          ? (
            // Высота в экран: короткая выдача не должна укорачивать документ
            // так, что поле съедет вниз (см. эффект подъёма поиска выше).
            <div style={{ minHeight: 'calc(100dvh - env(safe-area-inset-top) - 140px)' }}>
              <SearchResults results={results} onOpen={onSelectSurah} />
            </div>
          )
          : (
            <>
              <SurahList surahs={SURAHS} onSelect={onSelectSurah} readAyah={readAyah} />
              {/* Быстрая прокрутка: удержание на номере суры и протяжка
                  вверх-вниз. Только при полном списке — в результатах поиска номера
                  идут вразбивку, и прокрутка по ним была бы бессмыслицей. */}
              <FastScrubber
                // Припаркованная главная слушала бы касания экрана суры.
                enabled={FAST_SCROLL.surahList && active}
                count={SURAHS.length}
                // Полоса захвата — от самого края экрана до начала названия
                // суры (владелец 2026-10-04: «от края до главной буквы, чтобы
                // большую площадь занимал»). Прежде 10…54 px — у самого края
                // палец промахивался мимо полосы.
                left={0}
                width={scrubWidth}
                // От нижней кромки закреплённой панели: строка под стеклом
                // не должна запускать прокрутку.
                topInset={() => barBottom() + 8}
                // Функция: высота системной панели iOS 26 известна только
                // по факту, её меряют в момент жеста.
                bottomInset={() => tabBarTopPx() + 24}
                startAt={сураПодПальцем}
                onScrub={n => кСуре(n, frame?.scroller)}
                // Только со строки суры. Полоса по координатам ловила и мини-плеер
                // над панелью вкладок, и шапку, и заголовки джузов (ревью 10.09.2026);
                // владелец просил именно «удержание на номере».
                // Касание — на строке суры. У края под пальцем поле
                // колонки, а не строка, поэтому строку ищем и по высоте
                // касания: иначе у самого края жест не начинался.
                canStart={(t, _x, y) => !!t?.closest('[data-surah]') || сураНаВысоте(y) !== null}
                label={n => ({ big: String(n), small: SURAH_BY_NUMBER[n]?.transliteration })}
              />
            </>
          )}
      </div>
    </div>
  );
}

// ─── Заголовок секции ─────────────────────────────────────────────────────

/** Заголовок секции главной — как «Недавние» в «Музыке»: Title 3, полужирный. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      margin: '0 0 var(--space-snug)',
      padding: '0 var(--space-hair)',
      fontSize: 'var(--font-title3)',
      lineHeight: 'var(--leading-title3)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-primary)',
    }}>
      {children}
    </h2>
  );
}

// ─── Недавние ─────────────────────────────────────────────────────────────

type RecentWithMeta = { surah: number; ayah: number; meta?: SurahMeta };

/**
 * «Продолжить чтение» — лента карточек недавних сур (до четырёх, свежая
 * первой), листается вбок с прилипанием.
 *
 * Минимально (владелец 2026-10-04: «слишком много всего… привести к
 * минималистичному виду»): в карточке только название, место чтения и
 * тонкая полоса прогресса. Без капса-подписей и арабского названия; пусто —
 * секции нет вовсе.
 */
function Recents({ recents, onOpen }: {
  recents: RecentWithMeta[];
  onOpen: (surah: number, ayah?: number) => void;
}) {
  return (
    <section style={{ marginBottom: 'var(--space-margin)' }}>
      <SectionTitle>Продолжить чтение</SectionTitle>
      <div
        className="no-scrollbar"
        style={{
          display: 'flex',
          gap: 'var(--space-snug)',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          // Карточки выходят к краям экрана, а прилипают к полю: лента
          // читается как продолжающаяся за край.
          margin: '0 calc(var(--space-margin) * -1)',
          padding: '0 var(--space-margin) 4px',
          scrollPaddingInline: 'var(--space-margin)',
          WebkitOverflowScrolling: 'touch',
          // Дошли до края ленты — жест не переходит на ленту вкладок: листая
          // «Недавние», человек не просил менять вкладку.
          overscrollBehaviorX: 'contain',
        }}
      >
        {recents.map(r => r.meta && (
          <RecentCard
            key={r.surah}
            meta={r.meta}
            ayah={r.ayah}
            onClick={() => onOpen(r.surah, r.ayah)}
          />
        ))}
      </div>
    </section>
  );
}

function RecentCard({ meta, ayah, onClick }: {
  meta: SurahMeta;
  ayah: number;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const prefetch = usePressPrefetch(meta.number);
  const pct = Math.min(100, Math.round((ayah / meta.ayahs) * 100));
  return (
    <button
      onClick={onClick}
      onPointerDown={() => { setPressed(true); prefetch.start(); }}
      onPointerUp={() => { setPressed(false); prefetch.commit(); }}
      onPointerLeave={() => { setPressed(false); prefetch.cancel(); }}
      onPointerCancel={() => { setPressed(false); prefetch.cancel(); }}
      aria-label={`Продолжить: ${meta.transliteration}, аят ${ayah} из ${meta.ayahs}`}
      style={{
        flex: '0 0 min(200px, 56vw)',
        scrollSnapAlign: 'start',
        display: 'flex', flexDirection: 'column', gap: '2px',
        padding: 'var(--space-cozy) var(--space-margin)',
        textAlign: 'left',
        borderRadius: '18px',
        border: '1px solid var(--hairline)',
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'inherit', color: 'inherit',
        WebkitTapHighlightColor: 'transparent',
        opacity: pressed ? 0.6 : 1,
        transition: 'opacity var(--dur-fast) var(--ease-standard)',
      }}
    >
      <span style={{
        fontSize: 'var(--font-headline)',
        lineHeight: 'var(--leading-headline)',
        fontWeight: 'var(--weight-semibold)',
        letterSpacing: 'var(--tracking-tight)',
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {meta.transliteration}
      </span>
      <span style={{
        fontSize: 'var(--font-footnote)',
        lineHeight: 'var(--leading-footnote)',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        Аят {ayah} из {meta.ayahs}
      </span>
      <span aria-hidden style={{
        display: 'block',
        marginTop: 'var(--space-snug)',
        height: '3px',
        borderRadius: 'var(--radius-pill)',
        background: 'rgb(var(--ink-rgb) / 0.08)',
        overflow: 'hidden',
      }}>
        <span style={{
          display: 'block',
          height: '100%', width: `${pct}%`,
          borderRadius: 'inherit',
          background: 'var(--brand)',
        }} />
      </span>
    </button>
  );
}

// ─── Список сур ──────────────────────────────────────────────────────────

/**
 * Сура под пальцем — по строке в той же высоте экрана. Смотрим в середину
 * ширины, а не под сам палец: у края лежит только номер, а строка целиком
 * найдётся надёжнее по центру.
 */
function сураПодПальцем(y: number): number {
  const el = document.elementFromPoint(window.innerWidth / 2, y)
    ?.closest<HTMLElement>('[data-surah]');
  const n = Number(el?.dataset.surah);
  if (Number.isFinite(n) && n > 0) return n;
  // Палец над заголовком джуза или между строками — берём ближайшую строку.
  let лучшая = 1, дистанция = Infinity;
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('[data-surah]'))) {
    const r = row.getBoundingClientRect();
    const d = Math.abs((r.top + r.bottom) / 2 - y);
    if (d < дистанция) { дистанция = d; лучшая = Number(row.dataset.surah) || 1; }
  }
  return лучшая;
}

/** Строка суры на высоте `y` (по середине ширины экрана) или null. */
function сураНаВысоте(y: number): HTMLElement | null {
  return document.elementFromPoint(window.innerWidth / 2, y)?.closest<HTMLElement>('[data-surah]') ?? null;
}

/**
 * Ширина полосы быстрой прокрутки: от края экрана до правой кромки метки
 * «Сура N» (владелец 2026-10-04: «от края до главной буквы, чтобы большую
 * площадь занимал»). Номер теперь стоит над именем суры, поэтому меряем
 * метку, а не начало названия.
 */
function scrubWidth(): number {
  const num = document.querySelector<HTMLElement>('[data-surah-num]');
  return num ? Math.max(64, Math.round(num.getBoundingClientRect().right)) : 72;
}

/** Прыжок к строке суры: по центру экрана, без плавности — палец ведёт сам. */
function кСуре(n: number, scroller?: HTMLElement | null) {
  const row = document.querySelector<HTMLElement>(`[data-surah="${n}"]`);
  if (!row) return;
  // На вкладке прокручиваем только свою страницу. `scrollIntoView` двигает
  // ВСЕ прокручиваемые предки — и ленту вкладок тоже (TabPager).
  if (!scroller) {
    row.scrollIntoView({ block: 'center', behavior: 'auto' });
    return;
  }
  const r = row.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  scroller.scrollTop += r.top - view.top - (scroller.clientHeight - r.height) / 2;
}

function SurahList({ surahs, onSelect, readAyah }: {
  surahs: SurahMeta[];
  onSelect: (n: number, ayah?: number) => void;
  /** Сура → последний прочитанный аят (из «Продолжить чтение»). */
  readAyah?: ReadonlyMap<number, number>;
}) {

  // 🔴 Подписка на звук — ОДНА на весь список, а не в каждой строке.
  //
  // Раньше `useAudioState()` вызывался внутри карточки, и на каждой границе
  // аята перерисовывались все 114 карточек с арабской типографикой. Теперь
  // список знает, что звучит, и передаёт строке готовый ответ; React
  // перерисует только ту, у которой он изменился.
  const { currentSurah, audioState, reciter } = useAudioState();
  const звучит = audioState === 'playing' ? currentSurah : null;
  // Стабильный обработчик для мемоизированных строк: контекст звука
  // меняется на каждой границе аята, и без memo перерисовывались бы все
  // 114 строк — на главной во время чтения и под сурой, где главная теперь
  // припаркована, а не размонтирована.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const select = useCallback((n: number, ayah?: number) => selectRef.current(n, ayah), []);

  return (
    <div>
      {surahs.map((m, i) => (
        <SurahRow
          key={m.number}
          meta={m}
          onSelect={select}
          last={i === surahs.length - 1}
          sounding={звучит === m.number}
          hasRecording={reciterHasSurah(reciter, m.number)}
          readAyah={readAyah?.get(m.number)}
        />
      ))}
    </div>
  );
}

/** Заголовок раздела в результатах поиска. */
function SectionHeading({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)',
      padding: 'var(--space-section) var(--space-hair) var(--space-snug)',
    }}>
      <span style={{
        ...CAP_LABEL,
        color: 'var(--text-tertiary)',
        flexShrink: 0,
      }}>
        {text}
      </span>
      <span aria-hidden style={{ flex: 1, height: '1px', background: 'var(--hairline)' }} />
    </div>
  );
}

/**
 * Не больше двух строк — и перенос, а не многоточие.
 *
 * 🔴 Замер по всем 114 сурам: при одной строке с многоточием на 390 px
 * обрезались 3 подписи («Семейство Имрана · 200 а…»), а на 320 px — 41
 * подпись и 7 имён. Обрезанное имя суры — это потерянный смысл строки, и
 * одна строка подписи не стоит того. Строка, которой не хватило места,
 * становится выше на строку текста; остальные не меняются.
 */
const TWO_LINES = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  // Переносим по словам, а не внутри слова: `anywhere` разрешал рвать
  // русское слово посередине ради лишнего символа на строке.
  overflowWrap: 'break-word',
  // Две строки выравниваются по длине: иначе на второй оставалось одно
  // слово, и строка выглядела оборванной.
  textWrap: 'balance',
} as const;

/** Три полоски «звучит» у играющей суры. Анимация — только transform
 *  (компоновщик), при «Уменьшении движения» полоски стоят. */
function SoundingBars() {
  return (
    <span aria-hidden className="sounding-bars" style={{
      display: 'inline-flex', alignItems: 'flex-end', gap: '2px', height: '10px',
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '2.5px', height: '10px', borderRadius: '1.25px',
          background: 'currentColor', transformOrigin: 'bottom',
          animationDelay: `${i * -0.35}s`,
        }} />
      ))}
    </span>
  );
}

/** Сколько прочитано, в процентах (не меньше 4 — иначе полосы не видно). */
function readPercent(readAyah: number, from: number, to: number): number {
  const span = to - from + 1;
  return Math.max(4, Math.min(100, Math.round(((readAyah - from + 1) / span) * 100)));
}

/** Тонкая полоса прочитанного под подписью. */
function ReadBar({ pct, width }: { pct: number; width: string }) {
  return (
    <span aria-hidden style={{
      display: 'block', marginTop: '6px', width, height: '3px',
      borderRadius: 'var(--radius-pill)', background: 'rgb(var(--ink-rgb) / 0.08)', overflow: 'hidden',
    }}>
      <span style={{
        display: 'block', height: '100%', width: `${pct}%`,
        borderRadius: 'inherit', background: 'var(--brand)',
      }} />
    </span>
  );
}

/** Кнопка «слушать суру целиком» / «пауза» — общая для строки и плитки. */
function ListenButton({ meta, sounding, hasRecording, size }: {
  meta: SurahMeta; sounding: boolean; hasRecording: boolean; size: number;
}) {
  const audio = useAudioActions();
  return (
    <button
      onClick={() => {
        if (sounding) audio.pause();
        else audio.playSurah(meta.number, meta.ayahs);
      }}
      aria-label={sounding
        ? `Пауза: ${meta.transliteration}`
        : hasRecording
          ? `Слушать суру ${meta.transliteration} целиком`
          : `${meta.transliteration}: у выбранного чтеца нет записи`}
      className="icon-btn"
      style={{
        position: 'relative', flexShrink: 0,
        width: `${size}px`, height: `${size}px`, borderRadius: '50%',
        background: sounding ? 'rgb(var(--brand-rgb) / 0.16)' : 'rgb(var(--ink-rgb) / 0.06)',
        color: sounding ? 'var(--brand)' : 'var(--text-secondary)',
        opacity: hasRecording ? 1 : 0.35,
      }}
    >
      {sounding ? <Pause size={14} /> : <Play size={14} />}
      <HitArea />
    </button>
  );
}

/**
 * SurahRow — строка суры, вариант B «Арабское крупно» (выбран владельцем
 * 15.11.2026 из трёх: A «Оглавление», B, C «Островки»).
 *
 * ── История, чтобы не ходить по кругу ─────────────────────────────────
 *
 * 08.09.2026: высокие карточки в две колонки («максимально плох»), потом
 * компактные в две колонки («также ужасен») → строка во всю ширину.
 * 10.09.2026: снята серая заливка островков («тёмный фон не нравится») —
 * строки лежат прямо на фоне, между ними волосок.
 * 15.11.2026: вариант B — главное в строке арабское название суры, над
 * русским именем акцентом «Сура N», в подписи смысл, место ниспослания и
 * число аятов; у начатых сур полоса прочитанного, у звучащей — полоски.
 *
 * ── Быстрая прокрутка ─────────────────────────────────────────────────
 *
 * Метка «Сура N» несёт `data-surah-num`: её правая кромка — граница
 * полосы удержания у левого края (`scrubWidth`). Номер теперь стоит над
 * именем, и полоса по-прежнему «от края до номера».
 */
const SurahRow = memo(function SurahRow({
  meta, onSelect, last = false, sounding = false, hasRecording = true, readAyah,
}: {
  meta: SurahMeta;
  onSelect: (n: number, ayah?: number) => void;
  /** Последняя в списке — под ней волоска нет. */
  last?: boolean;
  /** Звучит ли именно эта сура. Приходит сверху: подписка на звук одна на
   *  весь список, иначе перерисовывались бы все 114 строк. */
  sounding?: boolean;
  /** Есть ли у выбранного чтеца запись этой суры. Нет — кнопка «слушать»
   *  приглушена. */
  hasRecording?: boolean;
  /** Докуда дочитана сура — полоса прогресса. */
  readAyah?: number;
}) {
  const [pressed, setPressed] = useState(false);
  const prefetch = usePressPrefetch(meta.number);
  const pct = readAyah ? readPercent(readAyah, 1, meta.ayahs) : 0;

  return (
    <div
      // По номеру строку находит быстрая прокрутка: и чтобы понять, откуда
      // палец начал, и чтобы к ней прыгнуть.
      data-surah={meta.number}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center',
        // Подсветка нажатия скруглена: прямоугольник во всю ширину выглядел
        // бы как вернувшаяся плашка.
        borderRadius: 'var(--radius-control)',
        background: pressed ? 'rgb(var(--ink-rgb) / 0.05)' : 'transparent',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <button
        onClick={() => onSelect(meta.number)}
        // Касание — сигнал, что суру сейчас откроют: страницы начинают
        // качаться до клика (usePressPrefetch).
        onPointerDown={() => { setPressed(true); prefetch.start(); }}
        onPointerUp={() => { setPressed(false); prefetch.commit(); }}
        onPointerLeave={() => { setPressed(false); prefetch.cancel(); }}
        onPointerCancel={() => { setPressed(false); prefetch.cancel(); }}
        aria-label={`${meta.number}. ${meta.transliteration}, ${meta.russian}, ${meta.ayahs} ${ayahWord(meta.ayahs)}${readAyah ? `, прочитано до аята ${readAyah}` : ''}`}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)',
          padding: '14px 0', minHeight: '76px',
          border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit', color: 'inherit', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: '1px' }}>
          <span aria-hidden data-surah-num="" style={{
            justifySelf: 'start',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
            fontWeight: 'var(--weight-semibold)', color: 'var(--brand)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {sounding && <SoundingBars />}
            Сура {meta.number}
          </span>
          <span data-surah-title="" style={{
            fontSize: 'var(--font-body)', lineHeight: 'var(--leading-body)',
            fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)',
            ...TWO_LINES,
          }}>
            {meta.transliteration}
          </span>
          <span style={{
            fontSize: 'var(--font-footnote)', lineHeight: 'var(--leading-footnote)',
            color: 'var(--text-tertiary)',
            ...TWO_LINES,
          }}>
            {/* Неразрывные пробелы: число склеено с «аятов», точка —
                с предыдущим словом (разделитель остаётся в конце строки). */}
            {`${meta.russian} · ${meta.type === 'meccan' ? 'Мекка' : 'Медина'} · ${meta.ayahs} ${ayahWord(meta.ayahs)}`}
          </span>
          {pct > 0 && <ReadBar pct={pct} width="96px" />}
        </span>
        <span dir="rtl" lang="ar" style={{
          flexShrink: 0, maxWidth: '42%',
          paddingInlineStart: 'var(--space-snug)',
          fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
          // От ширины экрана: на 320 px полный кегль отъедал бы у имени место.
          fontSize: 'clamp(22px, 7.4vw, 30px)',
          lineHeight: 1.35,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {meta.arabic}
        </span>
      </button>

      <span style={{ marginInlineStart: 'var(--space-snug)', display: 'inline-flex' }}>
        <ListenButton meta={meta} sounding={sounding} hasRecording={hasRecording} size={32} />
      </span>

      {!last && (
        <span aria-hidden style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: '1px',
          background: 'var(--hairline)',
        }} />
      )}
    </div>
  );
});

// ─── Результаты поиска ───────────────────────────────────────────────────

function SearchResults({ results, onOpen }: {
  results: ReturnType<typeof search>;
  onOpen: (surah: number, ayah?: number) => void;
}) {
  const { surahs, ayahs, truncated, tooShortForText, notReady } = results;
  const nothing = surahs.length === 0 && ayahs.length === 0;

  if (nothing) {
    return (
      <p style={{
        textAlign: 'center',
        padding: 'calc(var(--space-section) * 2) var(--space-margin)',
        fontSize: 'var(--font-subhead)',
        lineHeight: 'var(--leading-subhead)',
        color: 'var(--text-tertiary)',
      }}>
        {notReady
          ? 'Готовим перевод…'
          : tooShortForText
            ? 'Введите хотя бы три буквы, чтобы искать по переводу'
            : 'Ничего не найдено'}
      </p>
    );
  }

  return (
    <div>
      {surahs.length > 0 && (
        <>
          <SectionHeading text={`Суры · ${surahs.length}`} />
          <SurahList surahs={surahs} onSelect={onOpen} />
        </>
      )}

      {ayahs.length > 0 && (
        <>
          <SectionHeading
            text={`В переводе · ${ayahs.length}${truncated ? '+' : ''}`}
          />
          {ayahs.map(h => (
            <AyahHitRow
              key={`${h.surah}:${h.ayah}`}
              hit={h}
              onClick={() => onOpen(h.surah, h.ayah)}
            />
          ))}
          {truncated && (
            <p style={{
              padding: 'var(--space-cozy) var(--space-hair) 0',
              fontSize: 'var(--font-caption1)',
              lineHeight: 'var(--leading-caption1)',
              color: 'var(--text-tertiary)',
            }}>
              Показаны первые {ayahs.length}. Уточните запрос, чтобы
              совпадений стало меньше.
            </p>
          )}
        </>
      )}

      {tooShortForText && surahs.length > 0 && (
        <p style={{
          padding: 'var(--space-margin) var(--space-hair) 0',
          fontSize: 'var(--font-caption1)',
          lineHeight: 'var(--leading-caption1)',
          color: 'var(--text-tertiary)',
        }}>
          Для поиска по переводу введите хотя бы три буквы.
        </p>
      )}
    </div>
  );
}

function AyahHitRow({ hit, onClick }: { hit: AyahHit; onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const s = snippet(hit);
  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: 'var(--space-cozy) var(--space-hair)',
        border: 'none',
        borderBottom: '1px solid var(--hairline-soft, var(--hairline))',
        background: pressed
          ? 'rgb(var(--ink-rgb) / 0.05)'
          : 'transparent',
        cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <span style={{
        display: 'inline-block', marginBottom: 'var(--space-snug)',
        padding: 'var(--space-tight) var(--space-snug)',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--hairline)',
        fontSize: 'var(--font-caption2)',
        fontWeight: 'var(--weight-regular)',
        lineHeight: 1,
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {hit.surahTitle} · {hit.surah}:{hit.ayah} · {AYAH_LANG_LABEL[hit.lang]}
      </span>
      <span lang={hit.lang} style={{
        display: 'block',
        fontSize: 'var(--font-subhead)',
        lineHeight: 'var(--leading-subhead)',
        color: 'var(--text-secondary)',
        letterSpacing: 'var(--tracking-tight)',
      }}>
        {s.before}
        {/* Подсветка совпадения — фоном, а не цветом текста: цвет уже
            занят под караоке-подсветку в чтении, и два разных смысла
            одного приёма путали бы.

            Скругление 3px намеренно вне шкалы радиусов: она начинается
            с --radius-chip (8px), а это не плашка, а подложка под два-три
            слова внутри строки — на восьми пикселях она превращается в
            капсулу и рвёт строку на куски. */}
        <mark style={{
          background: 'rgb(var(--ink-rgb) / 0.14)',
          color: 'var(--text-primary)',
          borderRadius: '3px',
          padding: '0 var(--space-hair)',
          fontWeight: 'var(--weight-semibold)',
        }}>
          {s.match}
        </mark>
        {s.after}
      </span>
    </button>
  );
}
