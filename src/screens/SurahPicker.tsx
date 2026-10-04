/**
 * SurahPicker — главный экран: обложка, «Продолжить чтение», поиск, 114 сур.
 *
 * ── Новая главная (владелец 2026-10-04) ───────────────────────────────
 *
 * «Сверху фотография, какая-то обложка фоновая, какая-то последние суры…
 * поиск… потом снизу идут суры… в современном стиле, как сделали бы в
 * Apple либо в Airbnb». Порядок блоков — ровно этот:
 *
 *   1. Обложка — фото ковров владельца во всю ширину, «Коран» на ней
 *      (`Cover`); над ней стеклянная панель (`CollapsingNavBar`): при
 *      прокрутке обложка уходит, и в панели проявляется компактный «Коран».
 *   2. «Продолжить чтение» — лента карточек недавних сур (`Recents`).
 *   3. Поиск — капсула; при фокусе поднимается к панели.
 *   4. «Все суры» — список строками (ниже: почему не карточки).
 *
 * Прежняя шапка — заголовок и четыре квадратные кнопки в одной строке — на
 * узком экране теснила «Коран»; теперь кнопки в стеклянной капсуле панели,
 * а заголовок на обложке.
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
 * ── Почему список сур без деления на джузы ────────────────────────────
 *
 * Пробовали подписи «Джуз N» между строками — выходило «1 → 3 → 4 → 6»,
 * потому что джузы 2 и 5 начинаются посреди Аль-Бакары и Ан-Нисы.
 * Потом был переключатель «Суры / Джузы» с честными границами.  Снят
 * по решению владельца: экран открывают, чтобы найти суру, и лишний
 * орган управления над списком только отвлекает.  Разрез по джузам
 * лежит в истории git — вернуть можно одним коммитом.
 *
 * ── Типографика ───────────────────────────────────────────────────────
 *
 * Все кегли, веса, радиусы и отступы — ступени шкалы из src/index.css.
 * Строки списка и заголовки секций выровнены по одному отступу
 * (--space-hair), чтобы номер суры стоял ровно под словом «Суры».
 */

import { useState, useMemo, useRef, useDeferredValue, useLayoutEffect, forwardRef } from 'react';
import { FastScrubber } from '../components/FastScrubber';
import { FAST_SCROLL } from '../lib/fastScroll';
import { SURAHS, SURAH_BY_NUMBER, type SurahMeta } from '../content/surahs';
import { juzOfSurah } from '../lib/ayahNumbering';
import { readRecents } from '../lib/recents';
import { AYAH_LANG_LABEL, search, snippet, visibleSearchLangs, warmSearchIndex, type AyahHit } from '../lib/search';
import { useQuranSources } from '../content/quran-sources-lazy';
import { Appearance, Search, Close, Bookmark as BookmarkIcon, Person, TabPrayer, ICON_SIZE, Play, Pause } from '../components/icons';
import { ThemeSettings } from '../components/ReadingSettings';
import { useAudioActions, useAudioState } from '../hooks/AudioProvider';
import { TAB_BAR_SPACE } from '../components/TabBar';
import { tabBarTopPx } from '../lib/nativeTabBar';
import { prefetchSurahFeed } from '../hooks/useQcfAyahFeed';
import type { Theme } from '../hooks/useTheme';
import { HitArea } from '../components/HitArea';
import { CollapsingNavBar, type HeaderAction } from '../components/ScreenHeader';

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

export function SurahPicker({ onSelectSurah, onBookmarks, onPrayer, onAccount, theme, setTheme }: Props) {
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

  const recents = useMemo(
    () => readRecents().map(r => ({ ...r, meta: SURAH_BY_NUMBER[r.surah] })).filter(r => r.meta),
    [],
  );
  const coverRef = useRef<HTMLDivElement>(null);
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

  /** Где компактный «Коран» начинает проявляться: обложка ушла под панель. */
  const collapseStart = (bar: number) => {
    const cover = coverRef.current?.getBoundingClientRect();
    return cover ? cover.bottom + window.scrollY - bar : 24;
  };

  /**
   * Поднять поле поиска к панели: клавиатура закроет половину экрана, а
   * поле стоит под обложкой и «Недавними» — выдача должна быть видна над
   * клавиатурой, как в системных списках iOS.
   */
  const raiseSearch = (smooth: boolean) => {
    const field = searchRef.current;
    if (!field) return;
    const top = field.getBoundingClientRect().top + window.scrollY - barBottom() - 8;
    if (Math.abs(window.scrollY - top) < 1) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  };

  /**
   * Первая буква убирает «Недавние» и список сур — документ укорачивается,
   * и браузер срезал бы прокрутку до нуля: поле уехало бы обратно под
   * обложку, под клавиатуру. Поэтому у блока выдачи минимальная высота в
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

      <CollapsingNavBar
        title="Коран"
        actionGroups={[actions, accountGroup]}
        collapseStart={collapseStart}
        headerRef={barRef}
      />

      <Cover ref={coverRef} />

      <div style={{
        maxWidth: 'min(100%, 720px)',
        margin: '0 auto',
        padding: `0 var(--space-margin) calc(${TAB_BAR_SPACE} + var(--space-section) + var(--mini-player-space, 0px) + env(safe-area-inset-bottom))`,
      }}>
        {!searching && (
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
              <SectionTitle>Все суры</SectionTitle>
              <SurahList surahs={SURAHS} onSelect={onSelectSurah} />
              {/* Быстрая прокрутка: удержание на номере суры и протяжка
                  вверх-вниз. Только при полном списке — в результатах поиска номера
                  идут вразбивку, и прокрутка по ним была бы бессмыслицей. */}
              <FastScrubber
                enabled={FAST_SCROLL.surahList}
                count={SURAHS.length}
                // Колонка номеров начинается с поля экрана (16 px) и занимает 26.
                left={10}
                width={44}
                // От нижней кромки закреплённой панели: строка под стеклом
                // не должна запускать прокрутку.
                topInset={() => barBottom() + 8}
                // Функция: высота системной панели iOS 26 известна только
                // по факту, её меряют в момент жеста.
                bottomInset={() => tabBarTopPx() + 24}
                startAt={сураПодПальцем}
                onScrub={кСуре}
                // Только со строки суры. Полоса по координатам ловила и мини-плеер
                // над панелью вкладок, и шапку, и заголовки джузов (ревью 10.09.2026);
                // владелец просил именно «удержание на номере».
                canStart={t => !!t?.closest('[data-surah]')}
                label={n => ({ big: String(n), small: SURAH_BY_NUMBER[n]?.transliteration })}
              />
            </>
          )}
      </div>
    </div>
  );
}

// ─── Обложка ──────────────────────────────────────────────────────────────

/**
 * Обложка главной — фотография ковров владельца (решение 2026-10-04:
 * «сверху была фотография, какая-то обложка фоновая»). Тот же источник, что
 * у иконки и заставки (scripts/brand/design-logo.py → public/brand/cover.webp):
 * приложение открывается медальоном ковра и продолжается его полем.
 *
 * Во всю ширину и под строку состояния — как обложки в «Музыке» и
 * Airbnb. Часы читаются за счёт штатной «крышки» (StatusBarScrim): мягкая
 * полоса цвета фона под системной строкой. Светлый статус-бар над фото
 * здесь НЕ включается: стиль статус-бара заодно задаёт оформление
 * системной панели вкладок (MainViewController), и на светлой теме она
 * стала бы тёмной.
 *
 * Нижние углы скруглены — обложка лежит над списком отдельным листом.
 * Затемнение снизу держит контраст подписи на пёстром узоре; цвет подписи —
 * кремовый с заставки, а не цвет темы: фон под ней всегда тёмно-красный.
 * Пока фото не декодировано — поле ковра #440505, без белой вспышки.
 */
const Cover = forwardRef<HTMLDivElement>(function Cover(_props, ref) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: 'calc(env(safe-area-inset-top) + 236px)',
        overflow: 'hidden',
        borderRadius: '0 0 32px 32px',
        background: '#440505',
        marginBottom: 'var(--space-section)',
      }}
    >
      <img
        src="/brand/cover.webp"
        alt=""
        aria-hidden
        decoding="async"
        onLoad={() => setLoaded(true)}
        ref={img => { if (img?.complete && img.naturalWidth > 0 && !loaded) setLoaded(true); }}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          objectPosition: 'center 30%',
          opacity: loaded ? 1 : 0,
          transition: 'opacity var(--dur-slow) var(--ease-standard)',
        }}
      />
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        // Тёмная часть начинается с середины: подпись «Quran Ing» над
        // светлыми нитями узора иначе проваливалась до ~2.5:1 (ревью).
        background: 'linear-gradient(180deg, rgba(26, 3, 3, 0.18) 0%, rgba(26, 3, 3, 0.06) 30%, rgba(26, 3, 3, 0.5) 55%, rgba(26, 3, 3, 0.78) 100%)',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        maxWidth: 'min(100%, 720px)',
        margin: '0 auto',
        padding: '0 var(--space-margin) var(--space-margin)',
        color: '#f6e7d0',
      }}>
        <div style={{
          fontSize: 'var(--font-caption1)',
          lineHeight: 'var(--leading-caption1)',
          fontWeight: 'var(--weight-semibold)',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          textShadow: '0 1px 10px rgba(20, 0, 0, 0.7)',
        }}>
          Quran Ing
        </div>
        <h1
          className="display-serif"
          style={{
            margin: '2px 0 0',
            fontSize: 'clamp(38px, 11vw, 48px)',
            fontWeight: 'var(--weight-regular)',
            letterSpacing: '-0.03em',
            lineHeight: 1.02,
            color: '#fff7ec',
            textShadow: '0 2px 18px rgba(20, 0, 0, 0.45)',
          }}
        >
          Коран
        </h1>
        <div style={{
          marginTop: 'var(--space-tight)',
          fontSize: 'var(--font-subhead)',
          lineHeight: 'var(--leading-subhead)',
          opacity: 0.92,
          textShadow: '0 1px 10px rgba(20, 0, 0, 0.6)',
        }}>
          Ингушский и русский переводы
        </div>
      </div>
    </div>
  );
});

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
 * первой), листается вбок с прилипанием, как полки в App Store и Airbnb.
 *
 * Первая карточка помечена «Продолжить» фирменным цветом — это главное
 * действие экрана. Прогресс — полоса того же цвета.
 *
 * Пусто (первый запуск) — одна карточка «Начать с Аль-Фатихи»: пустая
 * секция ничего не объясняла бы, а с этого чтение и начинают.
 */
function Recents({ recents, onOpen }: {
  recents: RecentWithMeta[];
  onOpen: (surah: number, ayah?: number) => void;
}) {
  const fatiha = SURAH_BY_NUMBER[1];
  return (
    <section style={{ marginBottom: 'var(--space-section)' }}>
      <SectionTitle>{recents.length > 0 ? 'Продолжить чтение' : 'Начать чтение'}</SectionTitle>
      <div
        className="no-scrollbar"
        style={{
          display: 'flex',
          gap: 'var(--space-cozy)',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          // Карточки выходят к краям экрана, а прилипают к полю: лента
          // читается как продолжающаяся за край.
          margin: '0 calc(var(--space-margin) * -1)',
          padding: '4px var(--space-margin) 14px',
          scrollPaddingInline: 'var(--space-margin)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {recents.length > 0
          ? recents.map((r, i) => r.meta && (
            <RecentCard
              key={r.surah}
              meta={r.meta}
              ayah={r.ayah}
              lead={i === 0}
              onClick={() => onOpen(r.surah, r.ayah)}
            />
          ))
          : fatiha && <RecentCard meta={fatiha} lead onClick={() => onOpen(1)} />}
      </div>
    </section>
  );
}

function RecentCard({ meta, ayah, lead = false, onClick }: {
  meta: SurahMeta;
  /** Аят, на котором остановились; нет — карточка «начать». */
  ayah?: number;
  lead?: boolean;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const prefetch = usePressPrefetch(meta.number);
  const pct = ayah ? Math.min(100, Math.round((ayah / meta.ayahs) * 100)) : 0;
  return (
    <button
      onClick={onClick}
      onPointerDown={() => { setPressed(true); prefetch.start(); }}
      onPointerUp={() => { setPressed(false); prefetch.commit(); }}
      onPointerLeave={() => { setPressed(false); prefetch.cancel(); }}
      onPointerCancel={() => { setPressed(false); prefetch.cancel(); }}
      aria-label={ayah
        ? `Продолжить: ${meta.transliteration}, аят ${ayah} из ${meta.ayahs}`
        : `Начать чтение: ${meta.transliteration}`}
      style={{
        flex: '0 0 min(264px, 74vw)',
        scrollSnapAlign: 'start',
        display: 'flex', flexDirection: 'column',
        minHeight: '148px',
        padding: 'var(--space-margin)',
        textAlign: 'left',
        borderRadius: '22px',
        border: '1px solid var(--hairline)',
        background: 'var(--surface)',
        boxShadow: '0 10px 28px -14px rgb(0 0 0 / 0.22), 0 2px 6px -2px rgb(0 0 0 / 0.06)',
        cursor: 'pointer',
        fontFamily: 'inherit', color: 'inherit',
        WebkitTapHighlightColor: 'transparent',
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform var(--dur-base) var(--ease-panel)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-snug)' }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 'var(--font-caption2)',
          lineHeight: 'var(--leading-caption2)',
          fontWeight: 'var(--weight-semibold)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: lead ? 'var(--brand)' : 'var(--text-tertiary)',
        }}>
          {ayah ? (lead ? 'Продолжить' : `Сура ${meta.number}`) : `Сура ${meta.number}`}
        </span>
        <span
          dir="rtl"
          lang="ar"
          style={{
            flexShrink: 0,
            fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
            fontSize: '24px',
            lineHeight: 1.2,
            color: 'var(--text-secondary)',
          }}
        >
          {meta.arabic}
        </span>
      </span>

      <span style={{
        marginTop: 'auto',
        paddingTop: 'var(--space-cozy)',
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
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {ayah
          ? `Аят ${ayah} из ${meta.ayahs}`
          : `${meta.russian}\u00A0· ${meta.ayahs}\u00A0${ayahWord(meta.ayahs)}`}
      </span>
      <span aria-hidden style={{
        display: 'block',
        marginTop: 'var(--space-snug)',
        height: '4px',
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

/** Прыжок к строке суры: по центру экрана, без плавности — палец ведёт сам. */
function кСуре(n: number) {
  document.querySelector<HTMLElement>(`[data-surah="${n}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'auto' });
}

function SurahList({ surahs, onSelect, grouped = true }: {
  surahs: SurahMeta[];
  onSelect: (n: number) => void;
  /** Группировать по джузам. В результатах поиска выключено: заголовки
   *  джузов над разрозненными находками только мешают. */
  grouped?: boolean;
}) {
  // Группируем по джузу, в котором сура НАЧИНАЕТСЯ. Границы джузов не совпадают
  // с границами сур, поэтому это приближение — и оно названо честно в
  // `juzOfSurah`. Для заголовков в списке его достаточно.
  const секции = useMemo(() => {
    if (!grouped) return [{ juz: 0, items: surahs }];
    const out: { juz: number; items: SurahMeta[] }[] = [];
    for (const m of surahs) {
      const juz = juzOfSurah(m.number);
      const последняя = out[out.length - 1];
      if (последняя && последняя.juz === juz) последняя.items.push(m);
      else out.push({ juz, items: [m] });
    }
    return out;
  }, [surahs, grouped]);

  // 🔴 Подписка на звук — ОДНА на весь список, а не в каждой карточке.
  //
  // Раньше `useAudioState()` вызывался внутри карточки, и на каждой границе
  // аята перерисовывались все 114 карточек с арабской типографикой. Теперь
  // список знает, что звучит, и передаёт карточке готовый ответ; React
  // перерисует только ту, у которой он изменился.
  const { currentSurah, audioState } = useAudioState();
  const звучит = audioState === 'playing' ? currentSurah : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-section)' }}>
      {секции.map(({ juz, items }) => (
        <section key={juz || 'all'} style={{ display: 'grid', gap: 'var(--space-snug)' }}>
          {juz > 0 && <JuzHeading juz={juz} />}
          {/* 🔴 Островка с заливкой больше НЕТ.
              Владелец 10.09.2026: «не нравится, как суры написаны, тёмный фон
              не нравится». Заливка была `rgb(ink / 0.04)` — на светлой теме
              это серый прямоугольник на белом листе, и весь экран читался
              как набор серых плашек, а не как оглавление книги.

              Строки теперь лежат прямо на фоне, разделённые волоском с
              отступом слева. Это тот же приём, что в списках «Музыки» и
              «Подкастов»: содержимое несёт себя само, а фон не спорит с
              текстом. Заодно исчезла рамка — на светлой теме она давала
              вторую линию рядом с волоском.

              Один столбец сохранён намеренно (владелец 08.09.2026): в 175 px
              не помещается ни смысл суры, ни длинное название, а у джузов
              3, 4, 6, 7 подряд идёт по одной суре — вторая колонка пустовала. */}
          <div>
            {items.map((m, i) => (
              <SurahRow
                key={m.number}
                meta={m}
                onClick={() => onSelect(m.number)}
                last={i === items.length - 1}
                sounding={звучит === m.number}
              />
            ))}
          </div>
        </section>
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

function JuzHeading({ juz }: { juz: number }) {
  return (
    <p style={{
      // 🔴 Без черты справа. В сгруппированных списках iOS заголовок группы —
      // это просто подпись капителью над островком; линия во всю ширину
      // осталась от прежней вёрстки и выдавала «не системный» вид.
      // Владелец 09.09.2026 попросил привести главную к языку iOS 26.
      margin: 0,
      padding: '0 var(--space-cozy) var(--space-tight)',
      fontSize: 'var(--font-caption1)',
      lineHeight: 'var(--leading-caption1)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
    }}>
      Джуз {juz}
    </p>
  );
}

/**
 * Карточка суры.
 *
 * Пришла на смену строке во всю ширину: в два столбца строка не помещается,
 * и содержимое пересобрано под вертикальный порядок — знак и воспроизведение
 * сверху, арабское название крупно, ниже название и перевод.
 *
 * Оформление — то же «жидкое стекло», что у нижней панели: полупрозрачная
 * поверхность, волосяная рамка и светлая кромка сверху. Цвета взяты токенами,
 * поэтому карточка одинаково работает на всех пяти темах, включая тёмные и
 * фотографическую «бумагу».
 */
/**
 * SurahRow — строка суры в сгруппированном списке.
 *
 * ── История, чтобы не ходить по кругу ─────────────────────────────────
 *
 * Список сур переделывался трижды за двое суток. Сначала были высокие
 * карточки в две колонки (владелец: «максимально плох»), потом компактные в
 * две колонки (владелец: «также ужасен»), и только потом стало ясно, что
 * дело не в оформлении карточки, а в самой сетке: в колонку 175 px не
 * помещается ни смысл суры, ни длинное название, а у джузов 3, 4, 6, 7 подряд
 * идёт по одной суре и половина ряда пустует.
 *
 * 08.09.2026 владелец попросил вернуть один столбец и заодно довести вид «как
 * в последней iOS». Это одна и та же работа: строка во всю ширину и есть тот
 * самый вид.
 *
 * ── Из чего собрана строка ────────────────────────────────────────────
 *
 * Слева — номер в ромбе: форма из мусхафа, где номер аята стоит в розетке.
 * Дальше имя и под ним смысл с числом аятов — обе строки получают всю ширину
 * и больше не обрываются. Справа арабское название: оно и есть настоящее имя
 * суры, поэтому стоит на своём месте — у правого края, как в книге. Кнопка
 * «слушать» замыкает строку.
 *
 * Волоски между строками отступают от левого края на ширину ромба — так же
 * ведёт себя сгруппированная таблица в iOS: разделитель начинается под
 * текстом, а не под иконкой.
 */
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

/** Ширина колонки номеров и высота строки — в одном месте: их использует и волосок. */
const NUMBER_COLUMN = 26;
const ROW_HEIGHT = 64;

function SurahRow({ meta, onClick, last = false, sounding = false }: {
  meta: SurahMeta;
  onClick: () => void;
  /** Последняя в разделе — под ней волоска нет. */
  last?: boolean;
  /** Звучит ли именно эта сура. Приходит сверху: подписка на звук одна на
   *  весь список, иначе перерисовывались бы все 114 строк. */
  sounding?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const audio = useAudioActions();
  const prefetch = usePressPrefetch(meta.number);

  return (
    <div
      // По номеру строку находит быстрая прокрутка: и чтобы понять, откуда
      // палец начал, и чтобы к ней прыгнуть.
      data-surah={meta.number}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        // Подсветка нажатия скруглена и не доходит до краёв: без островка
        // прямоугольник во всю ширину выглядел бы как вернувшаяся плашка.
        borderRadius: 'var(--radius-control)',
        background: pressed
          ? 'rgb(var(--ink-rgb) / 0.05)'
          : sounding
            ? 'rgb(var(--ink-rgb) / 0.03)'
            : 'transparent',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <button
        onClick={onClick}
        // Касание — сигнал, что суру сейчас откроют: страницы начинают
        // качаться до клика (usePressPrefetch).
        onPointerDown={() => { setPressed(true); prefetch.start(); }}
        onPointerUp={() => { setPressed(false); prefetch.commit(); }}
        onPointerLeave={() => { setPressed(false); prefetch.cancel(); }}
        onPointerCancel={() => { setPressed(false); prefetch.cancel(); }}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)',
          padding: 'var(--space-cozy) 0',
          minHeight: `${ROW_HEIGHT}px`,
          border: 'none', background: 'transparent',
          cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit', color: 'inherit',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* 🔴 Номер — просто цифра, без ромба.
            Ромб-розетка был декорацией: на 28 px он читался как значок, а не
            как номер, и вместе с заливкой островка добавлял экрану третий
            графический слой. В колонке одинаковой ширины с табличными
            цифрами номера выстраиваются по правому краю сами, и глаз идёт
            по списку без зацепок. */}
        <span aria-hidden style={{
          flexShrink: 0,
          width: `${NUMBER_COLUMN}px`,
          textAlign: 'right',
          fontSize: 'var(--font-footnote)',
          lineHeight: 'var(--leading-footnote)',
          fontWeight: 'var(--weight-semibold)',
          color: sounding ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {meta.number}
        </span>

        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: '2px' }}>
          {/* Имя суры выросло с 15 px до 17 — это базовый кегль системы, и
              именно по нему человек ищет суру. Прежние 15 полужирных рядом
              с 11-пиксельной подписью читались как заголовок карточки, а не
              как строка оглавления. */}
          <span style={{
            fontSize: 'var(--font-body)',
            lineHeight: 'var(--leading-body)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-primary)',
            letterSpacing: 'var(--tracking-tight)',
            ...TWO_LINES,
          }}>
            {meta.transliteration}
          </span>
          {/* Подпись — 13 px вместо 11: 11 это нижняя граница шкалы, она для
              счётчиков и меток, а не для строки, которую читают. */}
          <span style={{
            fontSize: 'var(--font-footnote)',
            lineHeight: 'var(--leading-footnote)',
            color: 'var(--text-tertiary)',
            ...TWO_LINES,
          }}>
            {/* Два неразрывных пробела, и оба по делу. Число склеено с
                «аятов»: при переносе «200» оставалось на первой строке, а
                «аятов» уезжало на вторую. Точка-разделитель склеена с
                предыдущим словом: иначе вторая строка начиналась с «· 7
                аятов», а разделитель по правилам набора остаётся в конце
                строки. */}
            {`${meta.russian}\u00A0· ${meta.ayahs}\u00A0${ayahWord(meta.ayahs)}`}
          </span>
        </span>

        {/* Арабское название — единственное украшение строки, и теперь оно
            им и работает: крупнее прежнего и заметнее по тону. */}
        <span
          dir="rtl"
          lang="ar"
          style={{
            flexShrink: 0,
            maxWidth: '34%',
            paddingInlineStart: 'var(--space-snug)',
            fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
            // От ширины экрана: на 320 px полные 22 px отъедали у имени
            // столько места, что обрезались 7 названий и 41 подпись из 114.
            fontSize: 'clamp(17px, 5.4vw, 22px)',
            lineHeight: 1.3,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {meta.arabic}
        </span>
      </button>

      <button
        onClick={() => {
          if (sounding) audio.pause();
          else audio.playSurah(meta.number, meta.ayahs);
        }}
        aria-label={sounding
          ? `Пауза: ${meta.transliteration}`
          : `Слушать суру ${meta.transliteration} целиком`}
        className="icon-btn"
        style={{
          flexShrink: 0,
          width: '40px', height: '40px',
          marginInlineStart: 'var(--space-tight)',
          color: sounding ? 'var(--text-primary)' : 'var(--text-tertiary)',
        }}
      >
        {sounding ? <Pause size={ICON_SIZE.sm} /> : <Play size={ICON_SIZE.sm} />}
      </button>

      {/* Волосок начинается там же, где имя суры: колонка номеров остаётся
          свободной, и список читается как один столбец, а не как таблица. */}
      {!last && (
        <span aria-hidden style={{
          position: 'absolute',
          left: `calc(${NUMBER_COLUMN}px + var(--space-cozy))`,
          right: 0, bottom: 0, height: '1px',
          background: 'var(--hairline)',
        }} />
      )}
    </div>
  );
}

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
