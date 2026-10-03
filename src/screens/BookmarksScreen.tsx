import { useState, useMemo } from 'react';
import { readBookmarks, toggleBookmark } from '../lib/bookmarks';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { useQuranSources, type QuranSources } from '../content/quran-sources-lazy';
import { inhDisplayText, readShowInh } from '../lib/inhTranslation';
import { Bookmark as BookmarkIcon, ICON_SIZE } from '../components/icons';
import { ScreenHeader, screenHeaderOffset } from '../components/ScreenHeader';
import type { Theme } from '../hooks/useTheme';

type Props = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onBack: () => void;
  onOpen: (surah: number, ayah: number) => void;
};

type Entry = { surah: number; ayah: number; key: string };

/**
 * Единственная форма капс-подписи на экране: и «Сура 002», и «Аят 2:255».
 *
 * До этого две подписи одной роли расходились и по кеглю (10 и 11), и по
 * весу (700 и 600), и по разряду (0.14 и 0.08em).  Разряд задан числом,
 * а не токеном: `--tracking-loose` (0.01em) в шкале предназначен мелкому
 * СТРОЧНОМУ тексту и на капсе слипается.
 */
const CAP_LABEL: React.CSSProperties = {
  fontSize: 'var(--font-caption2)',
  lineHeight: 'var(--leading-caption2)',
  fontWeight: 'var(--weight-semibold)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * Bookmarks list — every saved ayah, grouped by surah in natural mushaf
 * order.  Each row is a button that opens the corresponding surah in
 * SurahScreen via the initialAyah prop (lib/recents drives the scroll
 * restore once the QCF feed has rendered).
 */
export function BookmarksScreen({ onBack, onOpen }: Props) {
  // Re-read on every toggle so removal updates the list without a route
  // change.  Bookmarks are a Set on disk; we materialise it once per
  // render here.
  const [tick, setTick] = useState(0);
  // Один хук на весь список, а не по одному на строку: переводы приезжают
  // отдельным чанком, и строке достаточно получить готовый словарь пропом.
  const quranSources = useQuranSources();

  const entries: Entry[] = useMemo(() => {
    const set = readBookmarks();
    const list: Entry[] = [];
    for (const key of set) {
      const [s, a] = key.split(':').map(Number);
      if (Number.isFinite(s) && Number.isFinite(a)) {
        list.push({ surah: s, ayah: a, key });
      }
    }
    list.sort((x, y) => x.surah - y.surah || x.ayah - y.ayah);
    return list;
  }, [tick]);

  // Group consecutive entries by surah for the section headers.
  const groups = useMemo(() => {
    const out: Array<{ surah: number; items: Entry[] }> = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last.surah === e.surah) last.items.push(e);
      else out.push({ surah: e.surah, items: [e] });
    }
    return out;
  }, [entries]);

  const handleRemove = (surah: number, ayah: number) => {
    toggleBookmark(surah, ayah);
    setTick(t => t + 1);
  };

  return (
    <>
      <ScreenHeader title="Закладки" onBack={onBack} />
      <main style={{
        minHeight: '100dvh',
        background: 'transparent',
        maxWidth: 'min(100%, 760px)',
        margin: '0 auto',
        padding: `${screenHeaderOffset(24)} var(--space-margin) calc(var(--space-section) + var(--space-cozy) + env(safe-area-inset-bottom))`,
        position: 'relative',
        boxSizing: 'border-box',
      }}>
        {entries.length === 0 ? (
        <section style={{
          textAlign: 'center',
          padding: 'calc(var(--space-section) * 2) var(--space-margin)',
          border: '1px dashed var(--hairline-strong)',
          borderRadius: 'var(--radius-shell)',
          background: 'rgb(var(--surface-rgb) / 0.68)',
        }}>
          <div style={{
            width: 48, height: 48,
            margin: '0 auto var(--space-margin)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
          }}>
            <BookmarkIcon size={ICON_SIZE.lg} />
          </div>
          <p style={{
            margin: 0,
            fontSize: 'var(--font-subhead)',
            lineHeight: 'var(--leading-subhead)',
            color: 'var(--text-secondary)',
            maxWidth: '360px',
            marginInline: 'auto',
          }}>
            Сохранённые аяты появятся здесь. Откройте любую суру и нажмите на иконку закладки рядом с аятом.
          </p>
        </section>
        ) : (
        <div>
          {groups.map((g, idx) => {
            const meta = SURAH_BY_NUMBER[g.surah];
            return (
              <section key={g.surah} style={{ marginTop: idx === 0 ? 0 : 'var(--space-section)' }}>
                {/* Surah header — same visual rhythm as the picker's
                    Juz dividers: tight tabular cap-label + hairline. */}
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--space-cozy)',
                  paddingBottom: 'var(--space-snug)',
                }}>
                  <span style={{
                    ...CAP_LABEL,
                    color: 'var(--text-tertiary)',
                    flexShrink: 0,
                  }}>
                    Сура {String(g.surah).padStart(3, '0')}
                  </span>
                  <span
                    className="display-serif"
                    style={{
                      fontSize: 'var(--font-subhead)',
                      color: 'var(--text-secondary)',
                      letterSpacing: 'var(--tracking-tight)',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    {meta?.transliteration ?? `Surah ${g.surah}`}
                  </span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--hairline)' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-snug)' }}>
                  {g.items.map(e => (
                    <BookmarkRow
                      key={e.key}
                      entry={e}
                      sources={quranSources}
                      onOpen={() => onOpen(e.surah, e.ayah)}
                      onRemove={() => handleRemove(e.surah, e.ayah)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        )}
      </main>
    </>
  );
}

function BookmarkRow({
  entry, sources, onOpen, onRemove,
}: {
  entry: Entry;
  /** null, пока словарь переводов ещё грузится отдельным чанком. */
  sources: QuranSources | null;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const verseKey = `${entry.surah}:${entry.ayah}`;
  const source = sources?.[verseKey];
  // Превью — тот перевод, который человек читает первым: ингушский, если
  // он не скрыт в настройках чтения (ключ `showInh`, тот же, что у экрана
  // суры), иначе русский.  Ингушский — через тот же фильтр, что и в ленте
  // (lib/inhTranslation.ts).  Arabic is shown right-aligned in a smaller,
  // dimmer hint row so the saved verse is still recognisable as a
  // citation, not just a number.
  const inh = readShowInh() ? inhDisplayText(verseKey, source?.translations.inh) : undefined;
  const preview = inh ?? source?.translations.ru ?? '';
  const previewLang = inh ? 'inh' : 'ru';

  return (
    <div style={{
      position: 'relative',
      border: '1px solid var(--hairline)',
      borderRadius: 'var(--radius-card)',
      background: 'rgb(var(--ink-rgb) / 0.04)',
      overflow: 'hidden',
    }}>
      <button
        onClick={onOpen}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          // Правое поле — под кнопку «убрать», а не произвольное число:
          // 44 зоны касания плюс шаг отступа.
          padding: 'var(--space-cozy) calc(var(--hit-min) + var(--space-cozy)) var(--space-cozy) var(--space-margin)',
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-snug)',
          marginBottom: source ? 'var(--space-snug)' : 0,
        }}>
          <span style={{ ...CAP_LABEL, color: 'var(--text-tertiary)' }}>
            Аят {entry.surah}:{entry.ayah}
          </span>
          {source?.arabic && (
            <span lang="ar" dir="rtl" style={{
              flex: 1,
              // Ступень Subhead, а не Footnote: у арабского при равном
              // кегле меньшая оптическая высота, и на 13px огласовки в
              // однострочном превью уже не читаются.  Межстрочный
              // оставлен коэффициентом, чтобы не срезать надстрочные.
              fontSize: 'var(--font-subhead)',
              color: 'var(--text-tertiary)',
              opacity: 0.7,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'right',
              lineHeight: 1.2,
            }}>
              {source.arabic}
            </span>
          )}
        </div>
        {preview && (
          <p lang={previewLang} style={{
            margin: 0,
            fontSize: 'var(--font-subhead)',
            lineHeight: 'var(--leading-subhead)',
            color: 'var(--text-secondary)',
            letterSpacing: 'var(--tracking-tight)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {preview}
          </p>
        )}
      </button>
      <button
        onClick={onRemove}
        aria-label="Убрать из закладок"
        className="icon-btn"
        style={{
          position: 'absolute',
          // 44×44 вместо прежних 36×36 при том же положении глифа:
          // центр иконки как был на 26px от угла карточки, так и остался
          // (4 + 44/2 = 8 + 36/2), а зона касания дотянута до минимума
          // Apple и целиком помещается внутрь карточки.
          top: 'var(--space-tight)',
          right: 'var(--space-tight)',
          width: 'var(--hit-min)',
          height: 'var(--hit-min)',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <BookmarkIcon size={ICON_SIZE.md} isFilled />
      </button>
    </div>
  );
}
