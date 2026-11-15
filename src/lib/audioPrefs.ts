/**
 * audioPrefs — small persistent toggles for the audio player and the
 * karaoke-highlight that don't justify their own hook + provider chain.
 *
 *   - autoScroll: viewport snaps to the active ayah when the queue
 *     advances. Default true.
 *   - highlightEnabled: word-by-word marker under the active word
 *     during playback. Default true.
 *   - highlightStyle: 'color' (default) — repaints the active word in
 *     a picked colour; 'glow' — keeps the base text colour and adds a
 *     vertical aurora-style text-shadow + a soft radial-gradient
 *     "dome" under the word (rendered by AyahGlowLayer).
 *   - highlightColor: which colour the active-word TEXT becomes in
 *     'color' mode. 6 picks (rose/green/teal/blue/violet/grey), each
 *     with a deeper light-theme shade and a brighter dark-theme shade
 *     so contrast holds across all light/* and dark/* themes.
 *   - glowPalette: which aurora palette the 'glow' mode uses. 6 picks
 *     (ice/mint/violet/rose/silver). Each palette ships pre-baked
 *     rgba strings for text-shadow + a radial-gradient string for the
 *     under-word "dome" — no color-mix() so iOS Safari <16.4 and old
 *     Android Chrome render correctly.
 *
 * Cross-component sync via the `audio-prefs-changed` window event —
 * setters dispatch it, consumers (SurahScreen, TypographySettings,
 * applyHighlightVars()) listen and re-read on demand.
 */

import { isLightTheme, type Theme } from '../hooks/useTheme';

const KEY_AUTO_SCROLL       = 'audio.autoScroll';
const KEY_HIGHLIGHT_ENABLED = 'highlight.enabled';
const KEY_HIGHLIGHT_STYLE   = 'highlight.style';
const KEY_HIGHLIGHT_COLOR   = 'highlight.color';
const KEY_GLOW_PALETTE      = 'highlight.glowPalette';
const EVENT = 'audio-prefs-changed';

export type HighlightStyle = 'color' | 'glow';

export type HighlightColor =
  | 'rose'    // default
  | 'grey'
  | 'green'
  | 'teal'
  | 'blue'
  | 'violet';

export type GlowPalette = 'ice' | 'mint' | 'violet' | 'rose' | 'silver';

// Swatch in HIGHLIGHT_COLORS is the LIGHT-theme value (used as the chip
// preview in the picker — the picker lives on the light surface of the
// settings sheet on every theme).
// Ordered as a rainbow ramp (warm → cool): rose → green → teal → blue →
// violet, нейтральный серый замыкает. Rose sits first because it doubles
// as the default — a calm warm marker for the active word.
// Note on label ↔ id drift: 'teal' renders as a sky blue (sky-500). The
// earlier cyan-600 pick made the picker read as "two greens" next to
// green; the brighter mid-ramp pick pushes it firmly into the sky-blue
// region of the hue wheel.
//
// Оранжевого здесь больше нет — решение владельца; на его месте серый.
// Сохранённый у прежних читателей 'amber' не сломает экран:
// getHighlightColorPref сверяет значение со списком и откатывается к
// дефолту.
export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string; swatch: string }[] = [
  { id: 'rose',   label: 'Роза',       swatch: '#e11d48' },
  { id: 'green',  label: 'Зелёный',    swatch: '#16a34a' },
  { id: 'teal',   label: 'Голубой',    swatch: '#0ea5e9' },
  { id: 'blue',   label: 'Синий',      swatch: '#2563eb' },
  { id: 'violet', label: 'Фиолет',     swatch: '#7c3aed' },
  { id: 'grey',   label: 'Серый',      swatch: '#64748b' },
];

// Hand-picked from Tailwind's ramps — each passes WCAG AA contrast on
// the corresponding theme background.
//   - light: deeper end of the ramp (500–600), so text reads as solid
//     coloured on near-white surfaces (warm-gray, classic, warm-brown).
//   - dark:  lighter end of the ramp (300–400), so text glows softly on
//     near-black surfaces (cool-blue, true, warm, deep).
// 'teal' uses sky-500 / sky-400 — a clearly blue-leaning sky tone that
// doesn't compete with green.  'grey' взят из ветки slate, а не из
// чистой серой: у slate есть холодная примесь, и на тёмном фоне слово
// читается как подсвеченное, а не как выцветшее.
const COLOR_LIGHT: Record<HighlightColor, string> = {
  rose:   '#e11d48',  // tw rose-600
  green:  '#16a34a',  // tw green-600
  teal:   '#0ea5e9',  // tw sky-500
  blue:   '#2563eb',  // tw blue-600
  violet: '#7c3aed',  // tw violet-600
  grey:   '#64748b',  // tw slate-500
};
const COLOR_DARK: Record<HighlightColor, string> = {
  rose:   '#fb7185',  // tw rose-400
  green:  '#4ade80',  // tw green-400
  teal:   '#38bdf8',  // tw sky-400
  blue:   '#60a5fa',  // tw blue-400
  violet: '#a78bfa',  // tw violet-400
  grey:   '#cbd5e1',  // tw slate-300
};

// ─── Aurora palettes (glow mode) ──────────────────────────────────────────
//
// Each palette is a self-contained kit:
//   - swatch:       single solid hex used by the palette picker chip
//                   (the user sees this on the settings card).
//   - wordShadow:   five-stop text-shadow that imitates aurora streaks
//                   (centred core + ±16px vertical cores + ±40px halo).
//                   Applied to [data-active-word] in CSS.
//   - ayahGlow:     four-stop radial-gradient for the under-word "dome"
//                   span (AyahGlowLayer). Wide vertical bleed.
//
// All values are pre-baked rgba() strings — no color-mix() — so the
// gradient renders on iOS Safari <16.4 and old Android Chrome (those
// engines silently drop color-mix() inside gradient stops and the layer
// vanishes).
//
// Alpha tuning notes (matches reference spec):
//   - wordShadow centre/cores 0.84, outer halo 0.76
//   - ayahGlow stops 0.48 / 0.20 / 0.06 / transparent at 0/30/55/80%
//   - 'silver' damped (0.76 / 0.64 cores, 0.44 dome) — neutral grey is
//     a "quiet" pick for users who find chromatic glow distracting
export const AURORA_PALETTES: Record<
  GlowPalette,
  { label: string; swatch: string; wordShadow: string; ayahGlow: string }
> = {
  ice: {
    label: 'Лёд',
    swatch: '#78c8f0',
    wordShadow:
      '0 -16px 36px rgba(150,215,245,0.42), ' +
      '0  16px 36px rgba(150,215,245,0.42), ' +
      '0   0px 30px rgba(150,215,245,0.42), ' +
      '0 -40px 110px rgba(100,180,225,0.38), ' +
      '0  40px 110px rgba(100,180,225,0.38)',
    ayahGlow:
      'radial-gradient(ellipse at 50% 50%, ' +
      'rgba(120,200,240,0.24) 0%, ' +
      'rgba(120,200,240,0.1) 30%, ' +
      'rgba(120,200,240,0.03) 55%, ' +
      'transparent 80%)',
  },
  mint: {
    label: 'Мята',
    swatch: '#48beaa',
    wordShadow:
      '0 -16px 36px rgba(80,200,140,0.42), ' +
      '0  16px 36px rgba(80,200,140,0.42), ' +
      '0   0px 30px rgba(80,200,140,0.42), ' +
      '0 -40px 110px rgba(50,170,110,0.38), ' +
      '0  40px 110px rgba(50,170,110,0.38)',
    ayahGlow:
      'radial-gradient(ellipse at 50% 50%, ' +
      'rgba(72,190,170,0.24) 0%, ' +
      'rgba(72,190,170,0.1) 30%, ' +
      'rgba(72,190,170,0.03) 55%, ' +
      'transparent 80%)',
  },
  violet: {
    label: 'Фиолет',
    swatch: '#8c64dc',
    wordShadow:
      '0 -16px 36px rgba(170,120,230,0.42), ' +
      '0  16px 36px rgba(170,120,230,0.42), ' +
      '0   0px 30px rgba(170,120,230,0.42), ' +
      '0 -40px 110px rgba(125,85,200,0.38), ' +
      '0  40px 110px rgba(125,85,200,0.38)',
    ayahGlow:
      'radial-gradient(ellipse at 50% 50%, ' +
      'rgba(140,100,220,0.24) 0%, ' +
      'rgba(140,100,220,0.1) 30%, ' +
      'rgba(140,100,220,0.03) 55%, ' +
      'transparent 80%)',
  },
  rose: {
    label: 'Роза',
    swatch: '#c86482',
    wordShadow:
      '0 -16px 36px rgba(220,120,150,0.42), ' +
      '0  16px 36px rgba(220,120,150,0.42), ' +
      '0   0px 30px rgba(220,120,150,0.42), ' +
      '0 -40px 110px rgba(190,90,125,0.38), ' +
      '0  40px 110px rgba(190,90,125,0.38)',
    ayahGlow:
      'radial-gradient(ellipse at 50% 50%, ' +
      'rgba(200,100,130,0.24) 0%, ' +
      'rgba(200,100,130,0.1) 30%, ' +
      'rgba(200,100,130,0.03) 55%, ' +
      'transparent 80%)',
  },
  // Раньше называлось «Уголёк», хотя цвет всегда был нейтрально-серый:
  // имя обещало оранжевый и путало в выборе.  Значения не тронуты, только
  // имя и ключ.
  silver: {
    label: 'Серебро',
    swatch: '#d2d2da',
    wordShadow:
      '0 -16px 36px rgba(210,210,220,0.38), ' +
      '0  16px 36px rgba(210,210,220,0.38), ' +
      '0   0px 30px rgba(210,210,220,0.38), ' +
      '0 -40px 110px rgba(170,170,180,0.32), ' +
      '0  40px 110px rgba(170,170,180,0.32)',
    ayahGlow:
      'radial-gradient(ellipse at 50% 50%, ' +
      'rgba(210,210,218,0.22) 0%, ' +
      'rgba(190,190,200,0.09) 30%, ' +
      'rgba(180,180,190,0.03) 55%, ' +
      'transparent 80%)',
  },
};

/** Порядок в пикере: холодные, тёплый, нейтральное серебро замыкает. */
export const GLOW_PALETTES_ORDER: GlowPalette[] =
  ['ice', 'mint', 'violet', 'rose', 'silver'];

export function getAutoScroll(): boolean {
  return localStorage.getItem(KEY_AUTO_SCROLL) !== '0';
}
export function setAutoScrollPref(on: boolean) {
  localStorage.setItem(KEY_AUTO_SCROLL, on ? '1' : '0');
  window.dispatchEvent(new Event(EVENT));
}

export function getHighlightEnabled(): boolean {
  return localStorage.getItem(KEY_HIGHLIGHT_ENABLED) !== '0';
}
export function setHighlightEnabled(on: boolean) {
  localStorage.setItem(KEY_HIGHLIGHT_ENABLED, on ? '1' : '0');
  applyHighlightVars();
  window.dispatchEvent(new Event(EVENT));
}

export function getHighlightStyle(): HighlightStyle {
  // Raw user preference — the "what the user picked in settings" value.
  // Default 'glow' so first-run users on dark/cosmic themes get the
  // signature aurora effect right away. On light themes this value is
  // overridden by applyHighlightVars() to 'color' for legibility — soft
  // glows against a near-white page read as dirty smudges, not light.
  // Use getEffectiveHighlightStyle(theme) when you need the resolved
  // value that's actually painted to :root.
  const v = localStorage.getItem(KEY_HIGHLIGHT_STYLE);
  if (v === 'color' || v === 'glow') return v;
  return 'glow';
}

/**
 * Resolved highlight style, accounting for theme.  Светлая тема всегда
 * сводится к 'color', какой бы ни была сохранённая настройка: свечение
 * на белой бумаге читается как грязное пятно, а не как сияние.  Тёмная
 * и «Аврора 2» используют выбор пользователя как есть.
 *
 * Pass `theme` explicitly (from useTheme) when known — falls back to
 * reading the data-theme attribute on :root when not.
 */
export function getEffectiveHighlightStyle(theme?: string | null): HighlightStyle {
  const t = theme ?? document.documentElement.getAttribute('data-theme') ?? '';
  // На светлых темах свечение читается как грязное пятно, поэтому все
  // они сводятся к 'color'.  Какие темы светлые — знает только
  // isLightTheme(); дублировать список здесь нельзя, на этом уже
  // споткнулись в HighlightCard.
  if (isLightTheme(t as Theme)) return 'color';
  // Тёмные темы — только свечение. Владелец 2026-11-15: «в тёмных темах
  // подсветку слов можно переключать между свечением и цветом — давай
  // уберём цвета, только свечение». Сохранённый когда-то выбор 'color'
  // на тёмной теме больше не действует; светлые по-прежнему 'color'.
  return 'glow';
}
export function setHighlightStylePref(s: HighlightStyle) {
  localStorage.setItem(KEY_HIGHLIGHT_STYLE, s);
  applyHighlightVars();
  window.dispatchEvent(new Event(EVENT));
}

export function getHighlightColor(): HighlightColor {
  const v = localStorage.getItem(KEY_HIGHLIGHT_COLOR) as HighlightColor | null;
  // Fallback to 'teal' (sky-blue) — спокойный и хорошо различимый
  // стандарт на светлой и тёмной теме.
  if (!v || !(v in COLOR_LIGHT)) return 'teal';
  return v;
}
export function setHighlightColorPref(c: HighlightColor) {
  localStorage.setItem(KEY_HIGHLIGHT_COLOR, c);
  applyHighlightVars();
  window.dispatchEvent(new Event(EVENT));
}

export function getGlowPalette(): GlowPalette {
  const v = localStorage.getItem(KEY_GLOW_PALETTE) as GlowPalette | null;
  if (!v || !(v in AURORA_PALETTES)) return 'mint';
  return v;
}
export function setGlowPalettePref(p: GlowPalette) {
  localStorage.setItem(KEY_GLOW_PALETTE, p);
  applyHighlightVars();
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Paint highlight CSS variables on :root.
 *
 *   - 'color' mode: --ayah-word-color-light/-dark drive the [data-active-word]
 *     text repaint via CSS rules gated on [data-highlight-style="color"].
 *   - 'glow' mode: --ayah-word-shadow drives the text-shadow on
 *     [data-active-word]; --ayah-glow-bg drives the radial-gradient inside
 *     the AyahGlowLayer span.
 *
 * Theme gate: on light themes we ALWAYS resolve to 'color' regardless
 * of the user pick. Glow on near-white reads as smudge, not light.
 * The user's raw pick is preserved in localStorage so flipping back
 * to a dark theme restores their previous glow choice without re-asking.
 *
 * Also sets the data-highlight-style attribute on :root so CSS can branch
 * the rules per mode (and so AyahGlowLayer / hooks can read the active
 * mode without prop-drilling).
 *
 * Pass `theme` (from useTheme) when calling from a React effect that
 * already knows the current theme — avoids the race where applyHighlightVars
 * runs before useTheme's effect has written the data-theme attribute.
 *
 * When the user disables the highlight entirely, --highlight-disabled flips
 * to '1' and dedicated CSS rules neutralise both color and shadow.
 */
export function applyHighlightVars(theme?: string | null): void {
  const root = document.documentElement;
  const enabled = getHighlightEnabled();
  const effective = getEffectiveHighlightStyle(theme);

  const prevEffective = root.getAttribute('data-highlight-style');
  root.setAttribute('data-highlight-style', effective);
  root.style.setProperty('--highlight-disabled', enabled ? '0' : '1');

  // Fire the prefs-changed event when the effective style flips so
  // useAyahGlow (and any future subscribers that care about the live
  // mode) re-evaluate. Without this a theme change from cosmic→light
  // would leave the hook still measuring word boxes for glow even
  // though the CSS has already gated the dome away.
  if (prevEffective !== effective) {
    window.dispatchEvent(new Event(EVENT));
  }

  if (!enabled) return;

  // Color-mode tokens — always written so a future switch to a dark
  // theme can pick them up instantly without us re-running.
  const c = getHighlightColor();
  root.style.setProperty('--ayah-word-color-light', COLOR_LIGHT[c]);
  root.style.setProperty('--ayah-word-color-dark',  COLOR_DARK[c]);

  // Glow-mode tokens — same: keep them current even when effective='color'
  // so the in-settings glow-palette swatches still preview correctly,
  // and a theme flip needs no recomputation on the CSS side.
  const pal = AURORA_PALETTES[getGlowPalette()];
  root.style.setProperty('--ayah-word-shadow', pal.wordShadow);
  root.style.setProperty('--ayah-glow-bg',     pal.ayahGlow);
  root.style.setProperty('--qcf-glow-bg',      qcfGlow(pal.swatch));
}

/**
 * Свечение под активным словом мусхафа (QPC V4) — мягкое пятно цвета
 * выбранной палитры, которое сходит на нет к краям.
 *
 * Шрифт мусхафа на iOS нельзя подсвечивать text-shadow (WebKit теряет части
 * глифа), поэтому раньше под словом лежала сплошная плашка — владелец
 * 2026-11-15: «свечение аята в тёмной теме работает неправильно» (на снимке
 * зелёный прямоугольник). Теперь это градиент на отдельном слое позади
 * слова (index.css, `.qcf-word-glyph[data-active-word]::before`): сам глиф
 * не меняется. Значения — готовая rgba-строка, без color-mix: старый
 * WebKit отбрасывает color-mix внутри градиента.
 */
function qcfGlow(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  return `radial-gradient(closest-side, rgba(${rgb},0.50) 0%, rgba(${rgb},0.30) 45%, rgba(${rgb},0.10) 75%, rgba(${rgb},0) 100%)`;
}

export function subscribeAudioPrefs(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  // 'storage' fires for cross-tab changes too.
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
