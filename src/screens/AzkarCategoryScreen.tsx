/**
 * AzkarCategoryScreen — horizontal swipe-carousel of azkar cards.
 *
 *  • One azkar = one full-viewport card.  Horizontal CSS scroll-snap
 *    gives native finger-swipe on touch and 2-finger horizontal scroll
 *    on trackpads; the bottom AzkarNavBar's prev/next also scrolls
 *    the carousel programmatically (so it works on plain mice too).
 *  • Each card has its own vertical scroll for overflow content — the
 *    horizontal swipe is owned by the OUTER container, the vertical
 *    scroll by each individual card body.
 *  • Default visibility (from lib/azkarPrefs.ts): Arabic + Russian
 *    translation + cyrillic transliteration — все три включены.
 *    Каждый блок отключается в попапе настроек текста.
 *  • Arabic font: KFGQPC Uthmanic Hafs v22 (already loaded for the
 *    Quran's text renderers).  The Unity export sometimes shipped TWO
 *    Arabic variants per entry — one pre-shaped (presentation-forms),
 *    one normal Unicode — and only the normal-Unicode line shapes
 *    correctly in a Naskh font; build_json.py strips the pre-shaped
 *    sibling so we only render the well-shaped one here.
 */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type { Theme } from '../hooks/useTheme';
import {
  loadAzkarData,
  pickAudio,
  azkarAudioUrl,
  type AzkarCategoryId,
  type AzkarEntry,
  type AzkarData,
  type AzkarAyah,
} from '../lib/azkar';
import { SourceDisclosure, TasbihPill } from '../components/DevotionalBits';
import { useAzkarAudio, type AzkarTrack } from '../hooks/useAzkarAudio';
import { ayahAudioUrl } from '../lib/quranUtils';
import {
  orderAzkar, readAzkarOrder, subscribeAzkarOrder,
  readAzkarPrefs, writeAzkarPref, writeAzkarScale,
  writeAzkarFont, writeAzkarLatinFont,
} from '../lib/azkarPrefs';
import { azkarFontConfig, type AzkarFontId } from '../lib/azkarFonts';
import {
  latinStack, latinWeight, latinSizeBump, type LatinFontId,
} from '../lib/typography';
import { ThemeSettings } from '../components/ReadingSettings';
import { AzkarTypographySettings } from '../components/AzkarSettings';
import {
  Appearance, ICON_SIZE, Play, Pause, Typography,
} from '../components/icons';
import { ScreenHeader, screenHeaderOffset } from '../components/ScreenHeader';
import { AzkarNavBar, AZKAR_NAV_SPACE } from '../components/AzkarNavBar';

type Props = {
  category: AzkarCategoryId;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onBack: () => void;
};

/** Strip the simple <b>…</b> / <i>…</i> tags the source ships with. */
function stripTags(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/<\/?[bi]>/g, '');
}

export function AzkarCategoryScreen({ category, theme, setTheme, onBack }: Props) {
  const [data, setData] = useState<AzkarData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Live typography prefs ─────────────────────────────────────────
  // Seed from localStorage, then keep in React state so the popover
  // can mutate them in place and the carousel re-renders.  Each setter
  // persists to localStorage so the choice survives a reload.
  const initial = useState(() => readAzkarPrefs())[0];
  const [showArabic,   setShowArabicS]   = useState(initial.showArabic);
  const [showRussian,  setShowRussianS]  = useState(initial.showRussian);
  const [showTranslit, setShowTranslitS] = useState(initial.showTranslit);
  const [arabicScale,   setArabicScaleS]   = useState(initial.arabicScale);
  const [russianScale,  setRussianScaleS]  = useState(initial.russianScale);
  const [translitScale, setTranslitScaleS] = useState(initial.translitScale);
  const [arabicFont,    setArabicFontS]    = useState<AzkarFontId>(initial.arabicFont);
  const [russianFont,   setRussianFontS]   = useState<LatinFontId>(initial.russianFont);
  const [translitFont,  setTranslitFontS]  = useState<LatinFontId>(initial.translitFont);
  const fontConfig = azkarFontConfig(arabicFont);

  const setShowArabic = (v: boolean) => {
    setShowArabicS(v); writeAzkarPref('showArabic', v);
  };
  const setShowRussian = (v: boolean) => {
    setShowRussianS(v); writeAzkarPref('showRussian', v);
  };
  const setShowTranslit = (v: boolean) => {
    setShowTranslitS(v); writeAzkarPref('showTranslit', v);
  };
  const setArabicScale = (v: number) => {
    setArabicScaleS(v); writeAzkarScale('arabicScale', v);
  };
  const setRussianScale = (v: number) => {
    setRussianScaleS(v); writeAzkarScale('russianScale', v);
  };
  const setTranslitScale = (v: number) => {
    setTranslitScaleS(v); writeAzkarScale('translitScale', v);
  };
  const setArabicFont = (v: AzkarFontId) => {
    setArabicFontS(v); writeAzkarFont(v);
  };
  const setRussianFont = (v: LatinFontId) => {
    setRussianFontS(v); writeAzkarLatinFont('russianFont', v);
  };
  const setTranslitFont = (v: LatinFontId) => {
    setTranslitFontS(v); writeAzkarLatinFont('translitFont', v);
  };

  const audio = useAzkarAudio();

  const [themeOpen, setThemeOpen] = useState(false);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  // Typography popover — anchored under the [A] icon in the header.
  const [typoOpen, setTypoOpen] = useState(false);
  const typoBtnRef = useRef<HTMLButtonElement>(null);
  // Shared open/closed state for the "Источник" disclosure across ALL
  // cards in the carousel — opening it on one card means it's open on
  // every other card the user swipes to (and vice versa).  Lifted out
  // of the native <details> per-element state into one boolean here.
  const [sourceOpen, setSourceOpen] = useState(false);

  // Tap-counter ("tasbih") per azkar.  Each entry with
  // `recommended_count > 1` shows a chip with current count / target;
  // tapping the card body increments by 1, long-press resets to 0.
  // Persists only during the current screen mount — resets when the
  // user backs out of the category.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const incCount = (entryId: string) => {
    setCounts(prev => ({ ...prev, [entryId]: (prev[entryId] ?? 0) + 1 }));
  };
  const resetCount = (entryId: string) => {
    setCounts(prev => ({ ...prev, [entryId]: 0 }));
  };
  // Press-feedback: which entry is currently being pressed.  Only used
  // on entries with `recommended_count > 1` so non-tasbih cards don't
  // get the haptic squish.  Cleared on pointer up / cancel.
  const [pressedId, setPressedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadAzkarData()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, []);

  // Stop audio when leaving the category — without this the OGG keeps
  // playing in the background after the user hits Back and there's no
  // UI to pause it from the index.
  const stopAllRef = useRef(audio.stopAll);
  stopAllRef.current = audio.stopAll;
  useEffect(() => () => stopAllRef.current(), []);

  // ── Filter + sort entries for this category, build the audio queue ──
  //
  // Порядок выбирает человек в настройках аккаунта: «по номерам» (как было)
  // или «как в исходнике». Правило — в `orderAzkar`, здесь только подписка:
  // настройка меняется на другом экране, и список обязан её увидеть без
  // перезахода. Тексты азкаров это не затрагивает никак — меняется только
  // очерёдность обхода одного и того же массива.
  const [azkarOrder, setAzkarOrder] = useState(readAzkarOrder);
  useEffect(() => subscribeAzkarOrder(() => setAzkarOrder(readAzkarOrder())), []);

  const entries: AzkarEntry[] = useMemo(() => {
    if (!data) return [];
    return orderAzkar(data.entries.filter(e => e.category === category), azkarOrder);
  }, [data, category, azkarOrder]);

  // Per-entry track queue.  Two paths:
  //
  //   • Quranic azkar (`entry.surah_number` + `entry.ayahs[]` set) —
  //     build a per-ayah queue using the same Mishari Alafasy CDN the
  //     Quran reader streams from.  Each ayah becomes its own AzkarTrack
  //     with the SAME `id: entry.id` so that `audio.activeId` stays
  //     pinned to the card while the queue auto-advances through verses;
  //     keeps card-sync, restart and auto-stop-on-leave intact.
  //
  //   • Non-Quranic azkar — fall back to the legacy single OGG/M4A from
  //     `pickAudio()` (one-element queue, no auto-advance).
  //
  // Entries with no audio at all are absent from the map.
  const tracksByEntry = useMemo(() => {
    const m = new Map<string, AzkarTrack[]>();
    for (const e of entries) {
      if (e.surah_number && e.ayahs && e.ayahs.length > 0) {
        const start = e.start_ayah ?? 1;
        const list: AzkarTrack[] = e.ayahs.map((_, i) => ({
          id: e.id,
          url: ayahAudioUrl(e.surah_number!, start + i, 'alafasy'),
        }));
        m.set(e.id, list);
        continue;
      }
      const f = pickAudio(e, category);
      if (f) m.set(e.id, [{ id: e.id, url: azkarAudioUrl(f) }]);
    }
    return m;
  }, [entries, category]);

  const entryHasAudio = (e: AzkarEntry) => tracksByEntry.has(e.id);

  // Category title (Russian) — pulled from source if loaded; static
  // fallback so the floating pill has a label during initial fetch.
  // (Название категории показывается только на индексе Азкаров;
  // внутри категории каждая карточка и так несёт свой заголовок,
  // поэтому дублировать название категории в пилюле было бы
  // redundant.)
  const catMeta = data?.categories.find(c => c.id === category);
  const titleRu = catMeta?.title_ru ?? (
    category === 'morning' ? 'Утренние' :
    category === 'evening' ? 'Вечерние' :
    'Азкары'
  );

  // ── Carousel state ───────────────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Track current visible card via scroll position.  Read scrollLeft
  // and divide by container width; rAF-throttled so fast swipes don't
  // schedule a setState per frame.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const w = el.clientWidth;
        if (w <= 0) return;
        const idx = Math.round(el.scrollLeft / w);
        setCurrentIndex(prev => prev === idx ? prev : idx);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [entries.length]);

  // Helper: scroll to a card index programmatically.  Used by prev/next
  // buttons, by keyboard arrows, and when audio queue advances.
  const scrollToIndex = (idx: number, behavior: ScrollBehavior = 'smooth') => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(entries.length - 1, idx));
    el.scrollTo({ left: clamped * el.clientWidth, behavior });
  };

  // When audio advances (or starts on a different card), sync the
  // carousel to that card so the user always sees what's playing.
  const lastSyncedActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!audio.activeId) return;
    if (audio.activeId === lastSyncedActiveIdRef.current) return;
    const idx = entries.findIndex(e => e.id === audio.activeId);
    if (idx < 0) return;
    lastSyncedActiveIdRef.current = audio.activeId;
    scrollToIndex(idx, 'smooth');
  }, [audio.activeId, entries]);

  // Auto-stop audio when the visible card no longer matches the one
  // being played.  User explicitly asked: «играй только пока я на этой
  // карточке» — swipe to a sibling card or hit «Выход» kills the
  // current track instead of letting it keep running off-screen.
  //
  // Debounced by 600 ms so the auto-scroll-to-active (above) can
  // settle without false-positive stops during its smooth transition.
  // If the mismatch resolves itself (carousel finishes scrolling to
  // the active card), we cancel the pending stop.
  const stopOnLeaveRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!audio.activeId) {
      if (stopOnLeaveRef.current !== undefined) {
        clearTimeout(stopOnLeaveRef.current);
        stopOnLeaveRef.current = undefined;
      }
      return;
    }
    const visible = entries[currentIndex];
    if (!visible || visible.id === audio.activeId) {
      if (stopOnLeaveRef.current !== undefined) {
        clearTimeout(stopOnLeaveRef.current);
        stopOnLeaveRef.current = undefined;
      }
      return;
    }
    // Mismatch: schedule stop. Don't pile up timers if one is already pending.
    if (stopOnLeaveRef.current !== undefined) return;
    stopOnLeaveRef.current = window.setTimeout(() => {
      audio.stopAll();
      stopOnLeaveRef.current = undefined;
    }, 600);
  }, [currentIndex, audio.activeId, entries, audio]);

  // Snap to first card whenever the category changes (defensive — the
  // route key normally remounts AzkarCategoryScreen so the carousel
  // restarts at 0 anyway, but if the parent ever holds it mounted while
  // swapping categories this keeps state coherent).
  useLayoutEffect(() => {
    scrollToIndex(0, 'auto');
    setCurrentIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Keyboard navigation between cards.  Skipped while focus is in an
  // input — there isn't one on this screen today, but cheap to guard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); scrollToIndex(currentIndex + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToIndex(currentIndex - 1); }
      else if (e.key === 'Escape' && audio.activeId) { audio.stopAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, entries.length, audio.activeId]);

  // ── Audio handlers ───────────────────────────────────────────────────
  // Play this card's audio.  For non-Quranic azkars the queue is one
  // OGG track, so `onended → advanceOrStop` falls through to idle and
  // never jumps to the next card (per explicit user request: «не надо
  // переходить к следующей карточке»).  For Quranic azkars the queue
  // is the per-ayah Mishari Alafasy URLs; auto-advance walks the verses
  // of the SAME card (all tracks share `id: entry.id`) and idles after
  // the final ayah without leaving the card.
  const handlePlayEntry = (entryId: string) => {
    const queue = tracksByEntry.get(entryId);
    if (!queue || queue.length === 0) return;
    audio.handlePlay(queue, 0);
  };

  // Chrome (header + кнопки + scrim) — всегда видимы.  Прошлый
  // auto-hide (тап/скролл) откачен по запросу пользователя: при чтении
  // ничего не должно прятаться без явного действия.

  return (
    <div style={{
      background: 'transparent',
      minHeight: '100dvh',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* ── Верхняя панель ───────────────────────────────────────────────
          Обычная панель во всю ширину, как в чтении суры и как нижние
          вкладки — см. шапку components/ScreenHeader.tsx.  Номер
          карточки ушёл в подзаголовок, а прогресс по ленте рисуется
          полосой по нижней кромке самой панели: раньше это была
          отдельная плавающая плашка, второй кусок chrome без нужды. */}
      <ScreenHeader
        title={titleRu}
        subtitle={entries.length > 0 ? `${currentIndex + 1} из ${entries.length}` : undefined}
        onBack={onBack}
        progress={entries.length > 0 ? (currentIndex + 1) / entries.length : undefined}
        actions={[
          {
            key: 'type',
            label: 'Настройки текста',
            icon: <Typography size={ICON_SIZE.md} />,
            active: typoOpen,
            ref: typoBtnRef,
            onClick: () => setTypoOpen(v => !v),
          },
          {
            key: 'theme',
            label: 'Оформление',
            icon: <Appearance size={ICON_SIZE.md} />,
            active: themeOpen,
            ref: themeBtnRef,
            onClick: () => setThemeOpen(v => !v),
          },
        ]}
      />

      {themeOpen && (
        <ThemeSettings
          theme={theme} setTheme={setTheme}
          onClose={() => setThemeOpen(false)}
          anchorEl={themeBtnRef.current}
        />
      )}

      {typoOpen && (
        <AzkarTypographySettings
          showArabic={showArabic}     setShowArabic={setShowArabic}
          showRussian={showRussian}   setShowRussian={setShowRussian}
          showTranslit={showTranslit} setShowTranslit={setShowTranslit}
          arabicScale={arabicScale}     setArabicScale={setArabicScale}
          russianScale={russianScale}   setRussianScale={setRussianScale}
          translitScale={translitScale} setTranslitScale={setTranslitScale}
          arabicFont={arabicFont}       setArabicFont={setArabicFont}
          russianFont={russianFont}     setRussianFont={setRussianFont}
          translitFont={translitFont}   setTranslitFont={setTranslitFont}
          onClose={() => setTypoOpen(false)}
          anchorEl={typoBtnRef.current}
        />
      )}

      {/* ── States: loading / error ──────────────────────────────────── */}
      {!data && !error && (
        <div style={{
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div className="skeleton" style={{
            height: '60%',
            width: 'min(96vw, 560px)',
            maxHeight: '600px',
            borderRadius: 'var(--radius-card)',
          }} />
        </div>
      )}

      {error && (
        <div style={{
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--font-subhead)', color: 'var(--text-tertiary)',
          padding: '0 var(--space-section)', textAlign: 'center',
        }}>
          <div>
            Не удалось загрузить азкары<br />
            <span style={{ fontSize: 'var(--font-caption1)', opacity: 0.7 }}>{error}</span>
          </div>
        </div>
      )}

      {data && entries.length === 0 && (
        <p style={{
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 'var(--font-subhead)',
        }}>
          В этой категории пока нет азкаров.
        </p>
      )}

      {/* ── Horizontal swipe carousel ────────────────────────────────── */}
      {data && entries.length > 0 && (
        <div
          ref={scrollerRef}
          role="region"
          aria-label="Azkar carousel"
          style={{
            display: 'flex',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            // iOS momentum scrolling — without this the swipe ends with
            // an abrupt stop instead of decelerating naturally.
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            height: '100dvh',
            width: '100%',
            // Desktop cap: centre the carousel inside a 1200-px column
            // so the floating bottom controls (whose `left`/`right` are
            // also pinned to this column via leftEdge/rightEdge) align
            // with the card edges and nothing flies to the viewport
            // corners on wide displays.
            maxWidth: '1200px',
            marginInline: 'auto',
            position: 'relative',
            zIndex: 1,
          }}
          // Hide scrollbar in WebKit too — `scrollbar-width: none` is the
          // standard but Safari ignores it.
          className="azkar-carousel"
        >
          {entries.map((entry, idx) => {
            const isActive = audio.activeId === entry.id;
            const hasAudio = entryHasAudio(entry);
            const isVisible = idx === currentIndex;
            return (
              <article
                key={entry.id}
                data-azkar-card={entry.id}
                aria-current={isVisible ? 'true' : undefined}
                onClick={e => {
                  // Tap-counter (tasbih): tap on the card body
                  // increments by 1.  Clicks on interactive children
                  // are ignored.  Chrome NEVER hides on tap per user
                  // request — the controls stay put.
                  if (!entry.recommended_count || entry.recommended_count <= 1) return;
                  const t = e.target as HTMLElement | null;
                  if (!t) return;
                  if (t.closest('button, summary, a, details, [role="button"], input, [data-no-count]')) return;
                  incCount(entry.id);
                }}
                onPointerDown={e => {
                  if (!entry.recommended_count || entry.recommended_count <= 1) return;
                  const t = e.target as HTMLElement | null;
                  if (t && t.closest('button, summary, a, details, [role="button"], input, [data-no-count]')) return;
                  setPressedId(entry.id);
                }}
                onPointerUp={() => setPressedId(null)}
                onPointerCancel={() => setPressedId(null)}
                onPointerLeave={() => setPressedId(null)}
                style={{
                  flex: '0 0 100%',
                  width: '100%',
                  height: '100dvh',
                  scrollSnapAlign: 'center',
                  scrollSnapStop: 'always',
                  // Each card owns its OWN vertical scroll for overflow
                  // content (long supplications spill below the fold on
                  // small phones).  The outer flex handles horizontal,
                  // this handles vertical.
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  // Сверху — высота панели из самого компонента плюс
                  // воздух; раньше тут складывались вручную «56 + 56»
                  // под плавающую пилюлю и её отдельную плашку
                  // прогресса, и при правке высоты числа разъезжались.
                  // Снизу — место под нижней панелью (AzkarNavBar), чтобы
                  // последняя строка не уходила под стекло.
                  paddingTop: screenHeaderOffset(28),
                  paddingLeft: '22px',
                  paddingRight: '22px',
                  paddingBottom: AZKAR_NAV_SPACE,
                  boxSizing: 'border-box',
                  // Tasbih press-feedback: card content slightly
                  // squishes and dims while the finger is held, then
                  // springs back on release.  Only on entries with a
                  // recommended_count so non-tasbih cards stay still.
                  transition: 'transform 140ms cubic-bezier(0.4, 0, 0.2, 1), filter 140ms ease',
                  transform: pressedId === entry.id ? 'scale(0.985)' : 'scale(1)',
                  filter: pressedId === entry.id ? 'brightness(0.92)' : 'brightness(1)',
                }}
              >
                <div style={{
                  maxWidth: '680px',
                  margin: '0 auto',
                }}>
                  {/* Сура из нескольких аятов.
                      Под каждым аятом — ссылка и кнопка «слушать аят», как
                      в Коране; счётчик повторов один на карточку и стоит
                      ниже, под всей сурой: три раза читают суру целиком, а
                      не каждый аят по три раза. */}
                  {entry.ayahs && entry.ayahs.length > 0 ? (
                    <SuraAyahs
                      ayahs={entry.ayahs}
                      surahNumber={entry.surah_number ?? 0}
                      startAyah={entry.start_ayah ?? 1}
                      showArabic={showArabic}
                      showRussian={showRussian}
                      arabicScale={arabicScale}
                      russianScale={russianScale}
                      fontConfig={fontConfig}
                      russianFont={russianFont}
                      onPlayAyah={entryHasAudio(entry) ? (i => {
                        const queue = tracksByEntry.get(entry.id);
                        if (!queue || !queue[i]) return;
                        // handlePlay сам различает «тот же трек» и ставит
                        // на паузу — отдельная проверка не нужна.
                        audio.handlePlay(queue, i);
                      }) : undefined}
                      playingIndex={audio.audioState === 'playing'
                        ? ayahIndexOf(tracksByEntry.get(entry.id), audio.activeUrl) : null}
                      loadingIndex={audio.audioState === 'loading'
                        ? ayahIndexOf(tracksByEntry.get(entry.id), audio.activeUrl) : null}
                    />
                  ) : null}

                  {/* Arabic — RTL, large, with the selected Naskh face.
                      Pre-shaped presentation-form duplicates were filtered
                      out at build time so this always shapes correctly.
                      `arabicScale` is the user's size pick from the
                      typography popover (0.85 / 1.0 / 1.2 / 1.4); it
                      stacks with the per-face `sizeMul` so different
                      faces stay optically balanced at the same step. */}
                  {!entry.ayahs && showArabic && entry.arabic && (
                    <div
                      dir="rtl"
                      lang="ar"
                      style={{
                        direction: 'rtl',
                        textAlign: 'right',
                        fontFamily: fontConfig.stack,
                        // Arabic gets a flat +17px reading bump across every
                        // size step — applied to each value of the clamp()
                        // so the bump shows up at min, preferred, and max.
                        fontSize: `clamp(${26 * fontConfig.sizeMul * arabicScale + 17}px, calc(${6.5 * fontConfig.sizeMul * arabicScale}vw + 17px), ${38 * fontConfig.sizeMul * arabicScale + 17}px)`,
                        lineHeight: fontConfig.lineHeight,
                        color: 'var(--text-primary)',
                        whiteSpace: 'pre-line',
                        letterSpacing: 0,
                        wordSpacing: 0,
                        // OpenType features for proper Naskh joining and
                        // contextual alternates — all four candidate faces
                        // expose ligature + calt tables.
                        fontFeatureSettings: '"liga" 1, "calt" 1, "kern" 1',
                        marginBottom: '24px',
                      }}
                    >
                      {stripTags(entry.arabic)}
                    </div>
                  )}

                  {/* Flat-mode play+tasbih row — один экземпляр между
                      арабским и переводами.

                      Для суры из нескольких аятов этот ряд — один на всю
                      карточку и стоит под последним аятом: счётчик считает
                      прочтения СУРЫ (её читают три раза), а кнопка играет
                      суру целиком, аят за аятом.  Отдельные аяты слушаются
                      своими кнопками внутри SuraAyahs. */}
                  {(
                    <PlayTasbihRow
                      hasAudio={entryHasAudio(entry)}
                      isPlaying={audio.activeId === entry.id && audio.audioState === 'playing'}
                      isActive={audio.activeId === entry.id && audio.audioState !== 'idle'}
                      isLoading={audio.activeId === entry.id && audio.audioState === 'loading'}
                      playbackRate={audio.playbackRate}
                      onPlayToggle={() => {
                        if (audio.activeId === entry.id && audio.audioState === 'playing') {
                          audio.pause();
                        } else {
                          handlePlayEntry(entry.id);
                        }
                      }}
                      onCycleRate={audio.cyclePlaybackRate}
                      tasbihCount={entry.recommended_count}
                      tasbihCurrent={counts[entry.id] ?? 0}
                      onTasbihTap={() => incCount(entry.id)}
                      onTasbihReset={() => resetCount(entry.id)}
                    />
                  )}

                  {/* Display order:
                        1. Arabic          (above this block)
                        2. Russian translation
                        3. Cyrillic transliteration of the Arabic
                      Каждый блок можно скрыть в попапе настроек;
                      дефолты — в lib/azkarPrefs.ts.  */}

                  {/* 2. Russian translation */}
                  {!entry.ayahs && showRussian && entry.russian && (
                    <p style={{
                      margin: '0 0 18px',
                      fontFamily: latinStack(russianFont),
                      fontSize: `${15 * russianScale + latinSizeBump(russianFont)}px`,
                      fontWeight: latinWeight(russianFont),
                      lineHeight: 1.55,
                      color: 'var(--text-secondary)',
                      letterSpacing: '-0.005em',
                      whiteSpace: 'pre-line',
                    }}>
                      {stripTags(entry.russian)}
                    </p>
                  )}

                  {/* 3. Cyrillic transliteration of the Arabic.
                       Lives in `entry.header_label` in the source data
                       (the Unity export named the field oddly — it's NOT
                       a section header, it's the cyrillic phonetic
                       rendition of the supplication). */}
                  {!entry.ayahs && showTranslit && entry.header_label && (
                    <p style={{
                      margin: '0 0 18px',
                      fontFamily: latinStack(translitFont),
                      fontSize: `${15 * translitScale + latinSizeBump(translitFont)}px`,
                      fontWeight: latinWeight(translitFont),
                      lineHeight: 1.55,
                      color: 'var(--text-tertiary)',
                      letterSpacing: '-0.005em',
                      whiteSpace: 'pre-line',
                    }}>
                      {stripTags(entry.header_label)}
                    </p>
                  )}

                  {/* Source / Rewards — collapsible.
                      `entry.rewards` (when present) lists structured
                      rewards with hadith refs; renders inside a native
                      <details> element so collapse/expand is handled by
                      the browser (a11y for free, no JS state).  If
                      there are no rewards, fall back to a tiny one-line
                      `entry.source` chip — preserves the previous look
                      for entries that haven't been upgraded yet. */}
                  {entry.rewards && entry.rewards.length > 0 ? (
                    <SourceDisclosure
                      rewards={entry.rewards}
                      legacy={entry.source}
                      open={sourceOpen}
                      onToggle={setSourceOpen}
                    />
                  ) : entry.source ? (
                    <p
                      style={{
                        margin: '0 0 var(--space-snug)',
                        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                        fontSize: 'var(--font-caption1)',
                        fontWeight: 'var(--weight-regular)',
                        lineHeight: 'var(--leading-caption1)',
                        color: 'var(--text-tertiary)',
                        letterSpacing: '0.01em',
                        opacity: 0.75,
                      }}
                    >
                      <span style={{
                        display: 'inline-block',
                        marginInlineEnd: 'var(--space-snug)',
                        fontWeight: 'var(--weight-semibold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        fontSize: 'var(--font-caption2)',
                      }}>
                        Источник
                      </span>
                      {entry.source}
                    </p>
                  ) : null}

                  {/* Action row — hidden globally per user request.
                      The play button is suppressed on every azkar card.
                      Code kept intact in case audio surfaces again. */}
                  {false && hasAudio && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      marginTop: '18px',
                      paddingTop: '18px',
                      borderTop: '1px solid var(--hairline)',
                    }}>
                      <PlayBtn
                        isActive={isActive}
                        audioState={audio.audioState}
                        disabled={false}
                        onPlay={() => handlePlayEntry(entry.id)}
                      />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Нижняя панель: предыдущий / выход / следующий (владелец
          2026-11-15). Только когда есть карточки. */}
      {data && entries.length > 0 && (
        <AzkarNavBar
          index={currentIndex}
          total={entries.length}
          onPrev={() => scrollToIndex(currentIndex - 1)}
          onNext={() => scrollToIndex(currentIndex + 1)}
          onExit={onBack}
        />
      )}
    </div>
  );
}

/**
 * InlinePlay — пара кнопок [▶ play] [1× speed] для inline-ряда
 * внутри карточки.  Не оборачивает себя во внешний контейнер
 * (Fragment) — родитель сам кладёт их в общий flex-row с tasbih'ом.
 *
 *   • Play / Pause — всегда виден, когда у карточки есть аудио.
 *   • Speed — появляется fade'ом рядом, только когда трек активен.
 *
 * Стиль кнопок: 36×36 / 44×36, hairline-border, лёгкая ink-подложка,
 * никакого blur/тени — выглядят как часть текста.
 */
function InlinePlay({
  isPlaying, isActive, isLoading, playbackRate, onPlayToggle, onCycleRate,
}: {
  isPlaying: boolean;
  isActive: boolean;
  isLoading: boolean;
  playbackRate: number;
  onPlayToggle: () => void;
  onCycleRate: () => void;
}) {
  const tile: React.CSSProperties = {
    height: '32px',
    borderRadius: 'var(--radius-chip)',
    border: '1px solid var(--hairline)',
    background: 'rgb(var(--ink-rgb) / 0.04)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    transition: 'opacity 220ms ease, transform 180ms ease, background 160ms ease',
  };
  return (
    <>
      <button
        onClick={onCycleRate}
        aria-label={`Скорость ${playbackRate}×`}
        title={`Скорость ${playbackRate}×`}
        aria-hidden={!isActive}
        tabIndex={isActive ? 0 : -1}
        style={{
          ...tile,
          width: '40px',
          color: 'var(--text-secondary)',
          opacity: isActive ? 1 : 0,
          transform: isActive ? 'scale(1)' : 'scale(0.86)',
          pointerEvents: isActive ? 'auto' : 'none',
        }}
      >
        <span style={{
          fontSize: 'var(--font-caption2)',
          fontWeight: 'var(--weight-semibold)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 'var(--tracking-tight)',
          lineHeight: 1,
          opacity: 0.7,
        }}>
          {playbackRate}×
        </span>
      </button>

      {(() => {
        // Мода кнопки — ключ React'а: при смене size/icon/label старый
        // span размонтируется, новый монтируется → CSS-keyframe
        // `inlinePlaySwap` отрабатывает мягкий fade+lift в 180 мс.
        const mode: 'play' | 'pause' | 'loading' =
          isLoading ? 'loading' : isPlaying ? 'pause' : 'play';
        const label =
          mode === 'loading' ? 'Загрузка' :
          mode === 'pause'   ? 'Пауза'    :
                               'Слушать';
        const ariaLabel =
          mode === 'loading' ? 'Загрузка' :
          mode === 'pause'   ? 'Пауза'    :
                               'Слушать азкар';
        return (
          <button
            onClick={onPlayToggle}
            aria-label={ariaLabel}
            title={ariaLabel}
            style={{
              ...tile,
              // width: auto — текстовая подпись рядом с иконкой
              // («Слушать» / «Пауза» / «Загрузка»), фиксированная
              // ширина не работает; padding по бокам даёт стабильный
              // отступ от рамки до текста.
              padding: '0 var(--space-snug)',
              gap: 'var(--space-tight)',
              transform: isLoading ? 'scale(0.96)' : 'scale(1)',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            <span
              key={mode}
              className="inline-play-swap"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-tight)',
              }}
            >
              <span aria-hidden style={{
                opacity: 0.75,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {/* Play / Pause берутся из общего набора.  Раньше здесь
                    жила вторая, своя пара — контур в толщине 2 — и
                    стояла на одном экране с залитой парой набора. */}
                {mode === 'pause'
                  ? <Pause size={ICON_SIZE.sm} />
                  : <Play size={ICON_SIZE.sm} />}
              </span>
              <span style={{
                fontSize: 'var(--font-caption2)',
                fontWeight: 'var(--weight-semibold)',
                letterSpacing: '-0.005em',
                lineHeight: 1,
                opacity: 0.7,
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            </span>
          </button>
        );
      })()}
    </>
  );
}

/**
 * PlayTasbihRow — общий ряд под арабским текстом азкара.  Слева —
 * капсула tasbih'а (если у карточки есть recommended_count > 1),
 * справа — кластер [speed][play] из InlinePlay (если у карточки есть
 * аудио).  Используется и в flat-mode (один экземпляр под единственным
 * Arabic-блоком), и в sura-mode (по экземпляру под каждым ayah'ом).
 *
 * Все инстансы одной карточки шарят ОДИН и тот же стейт (audio
 * activeId + tasbih counter — оба per-entry), поэтому работают
 * синхронно: тап по любой play-кнопке любого ayah'а запускает то же
 * самое аудио, инкремент tasbih'а на любом ряду обновляет все ряды.
 */
type PlayTasbihRowProps = {
  hasAudio: boolean;
  isPlaying: boolean;
  isActive: boolean;
  isLoading: boolean;
  playbackRate: number;
  onPlayToggle: () => void;
  onCycleRate: () => void;
  tasbihCount?: number;
  tasbihCurrent?: number;
  onTasbihTap?: () => void;
  onTasbihReset?: () => void;
};
function PlayTasbihRow(props: PlayTasbihRowProps) {
  const hasTasbih = props.tasbihCount != null && props.tasbihCount > 1;
  if (!props.hasAudio && !hasTasbih) return null;
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-tight)',
      alignItems: 'center',
      margin: 'var(--space-tight) 0 var(--space-section)',
    }}>
      {hasTasbih && (
        <TasbihPill
          current={props.tasbihCurrent ?? 0}
          target={props.tasbihCount!}
          onTap={props.onTasbihTap ?? (() => {})}
          onReset={props.onTasbihReset ?? (() => {})}
        />
      )}
      {props.hasAudio && (
        <div style={{
          display: 'flex',
          gap: 'var(--space-tight)',
          alignItems: 'center',
          marginLeft: 'auto',
        }}>
          <InlinePlay
            isPlaying={props.isPlaying}
            isActive={props.isActive}
            isLoading={props.isLoading}
            playbackRate={props.playbackRate}
            onPlayToggle={props.onPlayToggle}
            onCycleRate={props.onCycleRate}
          />
        </div>
      )}
    </div>
  );
}

/** Play/pause button for a single azkar card. */
function PlayBtn({
  isActive, audioState, disabled, onPlay,
}: {
  isActive: boolean;
  audioState: 'idle' | 'loading' | 'playing' | 'paused';
  disabled?: boolean;
  onPlay: () => void;
}) {
  const playing = isActive && audioState === 'playing';
  return (
    <button
      aria-label={playing ? 'Пауза' : 'Слушать'}
      onClick={e => { e.stopPropagation(); onPlay(); }}
      className="icon-btn"
      data-active={isActive}
      disabled={disabled}
      style={{
        width: 'var(--hit-min)',
        height: 'var(--hit-min)',
        color: disabled
          ? 'var(--text-tertiary)'
          : isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {playing ? <Pause size={ICON_SIZE.md} /> : <Play size={ICON_SIZE.md} />}
    </button>
  );
}

/**
 * TasbihPill — small inline counter pill that lives under the Arabic
 * body of an azkar with `recommended_count > 1`.  Compact "game"-style
 * capsule: current / target on the left, a thin progress bar that fills
 * as the user taps; on completion the pill flips into a soft "Готово ✓"
 * state.  Tap = +1; right-click / long-press equivalent = reset.
 */
/**
 * Какой аят карточки звучит.
 *
 * У кораничных азкаров все аяты одной суры делят `activeId` карточки,
 * поэтому различить их можно только по URL дорожки.  -1 значит «не этот
 * азкар»: сравнение `playingIndex === i` тогда никогда не сойдётся.
 */
function ayahIndexOf(queue: AzkarTrack[] | undefined, activeUrl: string | null): number {
  if (!queue || !activeUrl) return -1;
  return queue.findIndex(t => t.url === activeUrl);
}

function SuraAyahs({
  ayahs, surahNumber, startAyah,
  showArabic, showRussian,
  arabicScale, russianScale,
  fontConfig, russianFont,
  onPlayAyah, playingIndex, loadingIndex,
}: {
  ayahs: AzkarAyah[];
  surahNumber: number;
  startAyah: number;
  showArabic: boolean;
  showRussian: boolean;
  arabicScale: number;
  russianScale: number;
  fontConfig: ReturnType<typeof azkarFontConfig>;
  russianFont: LatinFontId;
  /**
   * Воспроизведение одного аята.
   *
   * Раньше под каждым аятом стоял общий ряд [tasbih] … [play]: счётчик
   * «0 / 3» повторялся у всех аятов, хотя три раза читается ВСЯ сура, а
   * кнопки делили состояние и загорались все разом.  Теперь под аятом —
   * то же, что в Коране: ссылка сура:аят и компактная кнопка, которая
   * играет именно этот аят.  Счётчик остался один, под всей сурой.
   */
  onPlayAyah?: (index: number) => void;
  playingIndex?: number | null;
  loadingIndex?: number | null;
}) {
  const активен = (i: number) => playingIndex === i || loadingIndex === i;

  return (
    <div style={{ marginBottom: '20px' }}>
      {/* 🔴 Сура идёт СПЛОШНЫМ арабским, потом сплошным переводом.
          Владелец 07.09.2026: «чтобы шёл полностью арабский текст, потом
          полностью перевод». Прежде аяты чередовались с переводом через
          разделители, и сура читалась рвано — не как сура, а как список.

          Аяты внутри блока разделяет номер-маркер, как в мусхафе. Он же
          кнопка: тап играет именно этот аят, поэтому чтение по одному
          аяту не потерялось вместе с прежним рядом кнопок.

          Шейпинг это не ломает: маркер стоит МЕЖДУ аятами, на границе
          слов, а не внутри слова (`CLAUDE.md`, сакральное правило §7). */}
      {showArabic && (
        <div
          dir="rtl"
          lang="ar"
          style={{
            direction: 'rtl',
            textAlign: 'right',
            fontFamily: fontConfig.stack,
            fontSize: `clamp(${28 * fontConfig.sizeMul * arabicScale + 17}px, calc(${7 * fontConfig.sizeMul * arabicScale}vw + 17px), ${44 * fontConfig.sizeMul * arabicScale + 17}px)`,
            lineHeight: fontConfig.lineHeight,
            color: 'var(--text-primary)',
            fontFeatureSettings: '"liga" 1, "calt" 1, "kern" 1',
            marginBottom: '16px',
          }}
        >
          {ayahs.map((a, i) => (
            <span key={i}>
              {a.arabic}
              {onPlayAyah ? (
                <button
                  onClick={() => onPlayAyah(i)}
                  aria-label={активен(i)
                    ? `Пауза, аят ${surahNumber}:${startAyah + i}`
                    : `Слушать аят ${surahNumber}:${startAyah + i}`}
                  title={`${surahNumber}:${startAyah + i}`}
                  style={{
                    ...маркер,
                    color: активен(i) ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    borderColor: активен(i) ? 'var(--text-primary)' : 'var(--hairline-strong)',
                    background: активен(i) ? 'rgb(var(--ink-rgb) / 0.06)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  {startAyah + i}
                </button>
              ) : (
                <span aria-hidden style={маркер}>{startAyah + i}</span>
              )}
              {' '}
            </span>
          ))}
        </div>
      )}

      {/* Перевод — тоже сплошным блоком. Номер перед строкой сохраняет
          связь с аятом: правило видимости требует и арабский, и перевод,
          и ссылку сура:аят на одном экране. */}
      {showRussian && (
        <div>
          {ayahs.map((a, i) => a.russian ? (
            <p key={i} style={{
              margin: '0 0 10px',
              fontFamily: latinStack(russianFont),
              fontSize: `${15 * russianScale + latinSizeBump(russianFont)}px`,
              fontWeight: latinWeight(russianFont),
              lineHeight: 1.55,
              color: 'var(--text-secondary)',
              letterSpacing: '-0.005em',
            }}>
              <span style={{
                fontSize: 'var(--font-caption1)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.02em',
                color: 'var(--text-tertiary)',
                marginInlineEnd: '8px',
              }}>
                {surahNumber}:{startAyah + i}
              </span>
              {a.russian}
            </p>
          ) : null)}
        </div>
      )}
    </div>
  );
}

/** Номер аята в сплошном арабском — кружок, как маркер в мусхафе. */
const маркер: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '1.55em',
  height: '1.55em',
  padding: '0 0.25em',
  margin: '0 0.3em',
  borderRadius: '50%',
  border: '1px solid var(--hairline-strong)',
  background: 'transparent',
  // Кегль номера не тянется за арабским: при крупном шрифте кружок
  // размером с букву выглядел бы кляксой посреди аята.
  fontSize: 'var(--font-caption1)',
  // 🔴 Цифры набираются интерфейсным шрифтом, а НЕ арабским.
  // Маркер стоит внутри арабского блока и унаследовал бы Naskh: в
  // кораничных начертаниях латинских цифр может не быть вовсе, и вместо
  // номера аята встал бы пустой прямоугольник посреди суры.
  fontFamily: latinStack('inter-regular'),
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1,
  verticalAlign: 'middle',
  color: 'var(--text-tertiary)',
  WebkitTapHighlightColor: 'transparent',
};

/**
 * SourceDisclosure — collapsible "Источник и награды" panel.
 *
 * Uses native <details>/<summary>: the browser owns the open/close
 * state, keyboard handling, and ARIA semantics; no React state needed.
 * The custom summary chrome (hairline border, leading icon, trailing
 * chevron that rotates when open) is pure CSS — see the inline style
 * blocks below and the global rule `details[open] summary svg.chev`
 * which we add to `index.css` separately.
 */