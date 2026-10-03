/**
 * AzkarTypographySettings — text settings popover for the Azkar reading
 * screen.  Mirrors the Quran's TypographySettings "Text" pane visually
 * (same SettingsSheet shell, same LangBody, same Switch/Scale/FontChips
 * controls) so the two surfaces feel like one product.
 *
 * Differences vs the Quran-side TypographySettings:
 *   • Three language tabs instead of two — Azkar carries a 3rd block,
 *     the cyrillic transliteration of the Arabic (entry.header_label
 *     in the source JSON).
 *   • No "Reciter" pane — Azkar audio is a single OGG per entry, not a
 *     pickable list of reciters.
 *   • No "Auto-scroll" toggle — Azkar shows one entry per fullscreen
 *     card, there's no ayah-feed to follow during playback.
 *
 * State is owned by AzkarCategoryScreen and threaded down through props;
 * this component only renders and forwards setter calls.  Persistence
 * is the caller's responsibility (writeAzkarPref / writeAzkarScale /
 * writeAzkarFont in lib/azkarPrefs.ts).
 */

import { useState } from 'react';
import {
  SettingsSheet, Switch, ScalePicker, FontChips,
  settingCard, cardTitle,
} from './ReadingSettings';
import { AZKAR_FONTS, type AzkarFontId } from '../lib/azkarFonts';
import { LATIN_FONTS, type LatinFontId } from '../lib/typography';

type AzkarLangTab = 'arabic' | 'russian' | 'translit';

// Persist the last-active language tab so reopening the popover lands
// on whatever the user was tweaking last — same UX as the Quran-side
// typography menu.
const KEY_AZKAR_LANG_TAB = 'azkar.langTab';
function readLangTab(): AzkarLangTab {
  if (typeof window === 'undefined') return 'arabic';
  const v = window.localStorage.getItem(KEY_AZKAR_LANG_TAB);
  // Легаси-значение 'ingush' (из прежнего QuranIng) больше не существует —
  // предикат отправит такого пользователя на вкладку арабского.
  return v === 'arabic' || v === 'russian' || v === 'translit'
    ? v
    : 'arabic';
}
function writeLangTab(v: AzkarLangTab) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY_AZKAR_LANG_TAB, v);
}

export type AzkarTypographyProps = {
  showArabic: boolean;
  setShowArabic: (v: boolean) => void;
  showRussian: boolean;
  setShowRussian: (v: boolean) => void;
  showTranslit: boolean;
  setShowTranslit: (v: boolean) => void;

  arabicScale: number;
  setArabicScale: (v: number) => void;
  russianScale: number;
  setRussianScale: (v: number) => void;
  translitScale: number;
  setTranslitScale: (v: number) => void;

  arabicFont: AzkarFontId;
  setArabicFont: (v: AzkarFontId) => void;
  russianFont: LatinFontId;
  setRussianFont: (v: LatinFontId) => void;
  translitFont: LatinFontId;
  setTranslitFont: (v: LatinFontId) => void;

  onClose: () => void;
  anchorEl?: HTMLElement | null;
  /** Заголовок листа.  Раздел «Дуа» переиспользует этот же попап со
   *  своими настройками, и подпись обязана называть то, на что он
   *  реально влияет. */
  title?: string;
};

export function AzkarTypographySettings(p: AzkarTypographyProps) {
  const [tab, setTabS] = useState<AzkarLangTab>(readLangTab);
  const setTab = (v: AzkarLangTab) => { setTabS(v); writeLangTab(v); };

  return (
    <SettingsSheet onClose={p.onClose} title={p.title ?? 'Текст азкара'} placement="top-popover" anchorEl={p.anchorEl}>
      <section style={settingCard}>
        <p style={cardTitle}>Текст и шрифты</p>

        {/* Inner language tabs — three columns on the Azkar screen.
            Раньше их было четыре (с ингушским) и подписи приходилось
            резать до «Араб.» / «Инг.»; теперь на 375 px каждая вкладка
            получает ~113 px и полные слова помещаются свободно. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 'var(--space-tight)',
          background: 'var(--bg)', border: '1px solid var(--hairline)',
          borderRadius: 'var(--radius-control)', padding: 'var(--space-tight)',
          marginBottom: 'var(--space-margin)',
        }}>
          {([
            { id: 'arabic',   label: 'Арабский'      },
            { id: 'russian',  label: 'Русский'       },
            { id: 'translit', label: 'Транскрипция'  },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={
                t.id === 'arabic'   ? 'Арабский' :
                t.id === 'russian'  ? 'Русский перевод' :
                                      'Транскрипция арабского кириллицей'
              }
              style={{
                minHeight: '36px',
                padding: 'var(--space-snug) 0', borderRadius: 'var(--radius-chip)',
                border: 'none',
                background: tab === t.id
                  ? 'linear-gradient(rgb(var(--ink-rgb) / 0.08), rgb(var(--ink-rgb) / 0.08)), var(--surface)'
                  : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'var(--font-caption1)',
                fontWeight: tab === t.id
                  ? 'var(--weight-semibold)'
                  : 'var(--weight-regular)',
                boxShadow: tab === t.id
                  ? 'inset 0 0 0 1.5px var(--text-primary), 0 0 0 3px rgb(var(--ink-rgb) / 0.1)'
                  : 'none',
                transition: 'box-shadow 140ms ease, background 140ms ease',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'arabic' && (
          <LangPane
            visible={p.showArabic}
            onToggleVisible={() => p.setShowArabic(!p.showArabic)}
            scale={p.arabicScale}
            onScale={p.setArabicScale}
            fontPicker={
              <FontChips<AzkarFontId>
                value={p.arabicFont}
                options={AZKAR_FONTS.map(f => ({ id: f.id, label: f.label, stack: f.stack }))}
                onChange={p.setArabicFont}
                preview="بسم الله"
                dir="rtl"
              />
            }
          />
        )}
        {tab === 'russian' && (
          <LangPane
            visible={p.showRussian}
            onToggleVisible={() => p.setShowRussian(!p.showRussian)}
            scale={p.russianScale}
            onScale={p.setRussianScale}
            fontPicker={
              <FontChips<LatinFontId>
                value={p.russianFont}
                options={LATIN_FONTS}
                onChange={p.setRussianFont}
                preview="Благословен"
              />
            }
          />
        )}
        {tab === 'translit' && (
          <LangPane
            visible={p.showTranslit}
            onToggleVisible={() => p.setShowTranslit(!p.showTranslit)}
            scale={p.translitScale}
            onScale={p.setTranslitScale}
            fontPicker={
              <FontChips<LatinFontId>
                value={p.translitFont}
                options={LATIN_FONTS}
                onChange={p.setTranslitFont}
                preview="Аллахумма"
              />
            }
          />
        )}
      </section>
    </SettingsSheet>
  );
}

/** Per-tab body: Visibility toggle → (optional) Font picker → Size.
 *  Same vertical rhythm as the Quran's LangBody but with Azkar-specific
 *  font catalog passed in as a ReactNode so the picker can be omitted
 *  cleanly for the three non-Arabic tabs (they all share the same
 *  system fonts and have no per-language family choice). */
function LangPane({
  visible, onToggleVisible, scale, onScale, fontPicker,
}: {
  visible: boolean;
  onToggleVisible: () => void;
  scale: number;
  onScale: (v: number) => void;
  fontPicker?: React.ReactNode;
}) {
  return (
    <div>
      <div
        onClick={onToggleVisible}
        role="button"
        aria-label={visible ? 'Скрыть' : 'Показать'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-cozy)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 'var(--font-caption2)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}>
          {visible ? 'Видно' : 'Скрыто'}
        </span>
        <Switch on={visible} />
      </div>

      {fontPicker && (
        <>
          <p style={sectionLabel}>Шрифт</p>
          {fontPicker}
        </>
      )}

      <div style={{ marginTop: fontPicker ? 'var(--space-cozy)' : 0 }}>
        <p style={sectionLabel}>Размер</p>
        <ScalePicker value={scale} onChange={onScale} />
      </div>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  margin: '0 0 var(--space-snug)',
  fontSize: 'var(--font-caption2)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.10em',
};
