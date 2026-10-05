/**
 * AzkarScreen — главный экран раздела «Азкары».
 *
 * Шапка — как на главной Корана: то же название раздела тем же кеглем,
 * та же кнопка оформления справа. Переключение вкладки должно читаться
 * как переход внутри одного продукта, а не в другое приложение.
 *
 * ── Две большие плитки (владелец 2026-10-04, вечер) ──────────────────
 *
 * «Давай сделаем на весь экран большие две кнопки, слева утренние, а
 * справа вечерние… в нашем iOS-стиле с светом… щас приходится вверх
 * тянуться к кнопкам, и их всего 2 и 90 % экрана пустое».
 *
 * Пунктов ровно два, и список из двух строк у самого верха — худшее, что
 * можно сделать на телефоне: экран пуст, а тянуться надо в самый верх.
 * Поэтому две высокие плитки рядом делят всю высоту между заголовком и
 * панелью вкладок: их нижняя половина — там, куда большой палец
 * дотягивается не глядя, и промахнуться невозможно.
 *
 * История, чтобы не ходить по кругу: утром того же дня тут уже были две
 * карточки «на полэкрана с градиентом и крупным знаком фактурой» — их
 * сняли как «слишком много всего» и заменили строками. Новые плитки — не
 * возврат к ним: без фактуры и подзаголовков, одна иллюстрация, название
 * и число, а «свет» — мягкое свечение времени суток (рассвет снизу, тёплый;
 * сумерки сверху, холодный), как подсветка виджетов iOS.
 *
 * Иллюстрации — свои (`DawnArt`, `DuskArt`), не значки из набора: на
 * плитке такого размера контурный значок 24×24 выглядел бы потерянным.
 *
 * Чего здесь СОЗНАТЕЛЬНО нет: отметки «сейчас читать эти». Время азкаров
 * привязано к намазу (утренние — после фаджра, вечерние — после асра);
 * подсказка по часам была бы религиозным утверждением наугад.
 *
 * Арабских названий категорий в azkar.json нет, и придумывать их —
 * ровно то, чего нельзя делать с сакральным текстом.
 *
 * Порядок: утренние слева, вечерние справа. Другие категории, если в
 * azkar.json появятся записи (сейчас «Вступительные» пусты и скрыты),
 * идут строками под плитками.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { Theme } from '../hooks/useTheme';
import { Appearance, ChevronRight, ICON_SIZE, Sparkle } from '../components/icons';
import { ThemeSettings } from '../components/ReadingSettings';
import { LargeTitleHeader } from '../components/ScreenHeader';
import { TAB_BAR_SPACE } from '../components/TabBar';
import { loadAzkarData, type AzkarCategoryId, type AzkarData } from '../lib/azkar';

type Props = {
  /** false — вкладка припаркована под экраном «поверх» (App.tsx). */
  active?: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  // onBack убран: возврат к Корану — это переключение вкладки в
  // нижней панели, отдельная ссылка в шапке была бы вторым путём.
  onOpenCategory: (category: AzkarCategoryId) => void;
};

/** Склонение слова «азкар». */
function azkarWord(n: number): string {
  const two = n % 100, one = n % 10;
  if (two >= 11 && two <= 14) return 'азкаров';
  if (one === 1) return 'азкар';
  if (one >= 2 && one <= 4) return 'азкара';
  return 'азкаров';
}

/** Плитки — только для утра и вечера, в этом порядке: слева направо, как
 *  идёт день. */
const TILE_ORDER: AzkarCategoryId[] = ['morning', 'evening'];

/**
 * Высота плиток — постоянная, от высоты экрана, а не «всё свободное место».
 *
 * Раньше сетка была `flex: 1` и делила высоту до панели вкладок: когда
 * панель или мини-плеер на миг пропадали (свайп, переход), плитки
 * растягивались до самого низа и сжимались обратно — владелец 2026-10-05:
 * «кнопки дергаются… чтобы не растягивались, не сокращались». `svh` — малая
 * высота окна: она не зависит ни от наших панелей, ни от адресной строки.
 * 330 px — шапка с крупным заголовком сверху плюс панель вкладок и
 * мини-плеер снизу на iPhone (390×844 → плитки 514 px и кончаются над
 * мини-плеером); границы 300–560 — маленький экран и планшет.
 */
const TILE_HEIGHT = 'clamp(300px, calc(100svh - 330px), 560px)';

export function AzkarScreen({ theme, setTheme, onOpenCategory, active = true }: Props) {
  const [data, setData] = useState<AzkarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  // Попап — портал в body: у припаркованной вкладки он висел бы над лентой.
  useEffect(() => { if (!active) setThemeOpen(false); }, [active]);
  const themeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    loadAzkarData()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, []);

  const visibleCats = (data?.categories ?? []).filter(
    c => (data?.by_category[c.id] ?? 0) > 0,
  );
  const tiles = TILE_ORDER
    .map(id => visibleCats.find(c => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const rest = visibleCats.filter(c => !TILE_ORDER.includes(c.id));

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: 'min(100%, 720px)',
      margin: '0 auto',
      padding: `0 var(--space-margin) calc(${TAB_BAR_SPACE} + var(--space-cozy) + var(--mini-player-space, 0px) + env(safe-area-inset-bottom))`,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      zIndex: 1,
    }}>
      {themeOpen && (
        <ThemeSettings
          theme={theme}
          setTheme={setTheme}
          onClose={() => setThemeOpen(false)}
          anchorEl={themeBtnRef.current}
        />
      )}

      {/* Шапка — один в один с главной Корана. */}
      <LargeTitleHeader
        active={active}
        title="Азкары"
        actions={[{
          key: 'theme', label: 'Оформление', ref: themeBtnRef, active: themeOpen,
          icon: <Appearance size={ICON_SIZE.md} />,
          onClick: () => setThemeOpen(v => !v),
        }]}
      />

      {!data && !error && <TilesSkeleton />}

      {error && (
        <div style={{
          textAlign: 'center', padding: '60px var(--space-margin)',
          fontSize: 'var(--font-subhead)', lineHeight: 'var(--leading-subhead)',
          color: 'var(--text-tertiary)',
        }}>
          Не удалось загрузить азкары<br />
          <span style={{ fontSize: 'var(--font-caption1)', opacity: 0.7 }}>{error}</span>
        </div>
      )}

      {data && tiles.length > 0 && (
        <div
          role="list"
          style={{
            height: TILE_HEIGHT,
            flexShrink: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`,
            gap: '12px',
          }}
        >
          {tiles.map(cat => (
            <TimeTile
              key={cat.id}
              evening={cat.id === 'evening'}
              title={cat.id === 'evening' ? 'Вечерние' : 'Утренние'}
              fullTitle={cat.title_ru || (cat.id === 'morning' ? 'Утренние азкары' : 'Вечерние азкары')}
              count={data.by_category[cat.id] ?? 0}
              onClick={() => onOpenCategory(cat.id)}
            />
          ))}
        </div>
      )}

      {data && rest.length > 0 && (
        <div role="list" style={{ marginTop: 'var(--space-cozy)' }}>
          {rest.map((cat, i) => (
            <CategoryRow
              key={cat.id}
              title={cat.title_ru || cat.id}
              count={data.by_category[cat.id] ?? 0}
              last={i === rest.length - 1}
              onClick={() => onOpenCategory(cat.id)}
            />
          ))}
        </div>
      )}

      {data && visibleCats.length === 0 && (
        <p style={{
          textAlign: 'center', padding: '64px 0',
          color: 'var(--text-tertiary)', fontSize: 'var(--font-subhead)',
        }}>
          Пока нет азкаров.
        </p>
      )}
    </div>
  );
}

/**
 * Плитка времени суток.
 *
 * Слои снизу вверх: подложка в тон темы → свечение времени суток
 * (`.azkar-tile-glow`, медленно «дышит») → иллюстрация по центру →
 * название и число внизу, ближе к пальцу. Цвета свечения — фиксированные
 * rgba: смысл «тёплый рассвет против холодных сумерек» одинаков на всех
 * темах, а прозрачность даёт ему лечь и на светлый, и на тёмный фон.
 */
function TimeTile({ evening, title, fullTitle, count, onClick }: {
  evening: boolean;
  title: string;
  fullTitle: string;
  count: number;
  onClick: () => void;
}) {
  const glow = evening
    ? 'radial-gradient(120% 70% at 75% 0%, rgba(118, 128, 236, 0.42) 0%, rgba(118, 128, 236, 0.12) 45%, transparent 75%)'
    : 'radial-gradient(130% 75% at 50% 100%, rgba(255, 176, 92, 0.46) 0%, rgba(255, 196, 120, 0.14) 48%, transparent 78%)';

  return (
    <div role="listitem" style={{ display: 'flex', minHeight: 0 }}>
      <button
        onClick={onClick}
        aria-label={`${fullTitle}, ${count} ${azkarWord(count)}`}
        className="azkar-tile"
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          padding: '20px 18px 20px',
          border: 'none',
          borderRadius: '32px',
          overflow: 'hidden',
          background: 'rgb(var(--ink-rgb) / 0.045)',
          // Волосяная грань и блик по верхней кромке — материал, а не
          // плоская заливка; без стекла: плитка — контент, не управление
          // (docs/IOS26_DESIGN_GUIDE.md § 2).
          boxShadow: 'inset 0 0 0 1px var(--hairline), inset 0 1px 0 rgba(255, 255, 255, 0.10)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          color: 'inherit',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span aria-hidden className="azkar-tile-glow" style={{
          position: 'absolute', inset: 0,
          background: glow,
          pointerEvents: 'none',
        }} />
        {evening && <StarField />}

        <span aria-hidden style={{
          position: 'relative',
          flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '120px',
        }}>
          {evening ? <DuskArt /> : <DawnArt />}
        </span>

        <span style={{ position: 'relative', display: 'grid', gap: '2px' }}>
          <span style={{
            fontSize: 'var(--font-title2)',
            lineHeight: 'var(--leading-title2)',
            fontWeight: 'var(--weight-semibold)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)',
          }}>
            {title}
          </span>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '8px',
            fontSize: 'var(--font-subhead)',
            lineHeight: 'var(--leading-subhead)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span>{count}&nbsp;{azkarWord(count)}</span>
            <span aria-hidden style={{
              flexShrink: 0,
              width: '30px', height: '30px',
              borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgb(var(--ink-rgb) / 0.08)',
              color: 'var(--text-primary)',
            }}>
              <ChevronRight size={ICON_SIZE.sm} />
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

/**
 * Рассвет: солнце наполовину над горизонтом, лучи веером, дымка у земли.
 * Градиенты по `useId`: на экране две плитки, и общий id тихо отдал бы
 * одной из них чужую заливку.
 */
function DawnArt() {
  const id = useId().replace(/:/g, '');
  const rays = [-70, -45, -22, 0, 22, 45, 70];
  return (
    <svg width="132" height="132" viewBox="0 0 120 120" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id={`${id}halo`} cx="50%" cy="72%" r="50%">
          <stop offset="0%" stopColor="#ffc472" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ffc472" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe3a3" />
          <stop offset="100%" stopColor="#f59a3c" />
        </linearGradient>
        <linearGradient id={`${id}ray`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#f7b259" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffd894" stopOpacity="0.15" />
        </linearGradient>
        <clipPath id={`${id}clip`}>
          <rect x="0" y="0" width="120" height="84" />
        </clipPath>
        <clipPath id={`${id}sky`}>
          <rect x="-20" y="-20" width="160" height="105" />
        </clipPath>
      </defs>
      {/* Свет — только над горизонтом: под ним он рисовался шаром. */}
      <g clipPath={`url(#${id}sky)`}>
        <circle cx="60" cy="84" r="56" fill={`url(#${id}halo)`} className="azkar-art-pulse" />
      </g>
      <g transform="translate(60 84)">
        {rays.map(a => (
          <rect
            key={a}
            x="-2.2" y="-54" width="4.4" height="16" rx="2.2"
            fill={`url(#${id}ray)`}
            transform={`rotate(${a})`}
          />
        ))}
      </g>
      <circle cx="60" cy="84" r="26" fill={`url(#${id}sun)`} clipPath={`url(#${id}clip)`} />
      <rect x="14" y="83" width="92" height="3" rx="1.5" fill="#f2a24d" opacity="0.9" />
      <rect x="26" y="92" width="68" height="2.6" rx="1.3" fill="#f2a24d" opacity="0.45" />
      <rect x="40" y="100" width="40" height="2.2" rx="1.1" fill="#f2a24d" opacity="0.22" />
    </svg>
  );
}

/** Сумерки: полумесяц в ореоле и три звезды разной величины. */
function DuskArt() {
  const id = useId().replace(/:/g, '');
  return (
    <svg width="132" height="132" viewBox="0 0 120 120" style={{ overflow: 'visible' }}>
      <defs>
        {/* Цвета луны — от темы (`--dusk-*` в index.css): светлая луна на
            светлой плитке растворялась бы в ней. */}
        <radialGradient id={`${id}halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{ stopColor: 'var(--dusk-halo)', stopOpacity: 0.6 }} />
          <stop offset="100%" style={{ stopColor: 'var(--dusk-halo)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={`${id}moon`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--dusk-moon-a)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--dusk-moon-b)' }} />
        </linearGradient>
        <mask id={`${id}cut`}>
          <rect width="120" height="120" fill="#fff" />
          <circle cx="74" cy="46" r="27" fill="#000" />
        </mask>
      </defs>
      <circle cx="58" cy="60" r="54" fill={`url(#${id}halo)`} className="azkar-art-pulse" />
      <circle cx="58" cy="60" r="32" fill={`url(#${id}moon)`} mask={`url(#${id}cut)`} />
      <Star x={92} y={30} r={8} />
      <Star x={98} y={70} r={4.5} />
      <Star x={30} y={26} r={5} />
    </svg>
  );
}

/** Четырёхлучевая звезда с вогнутыми сторонами — тот же силуэт, что у
 *  звезды азкаров в наборе (`Sparkle`), но залитый и со светом. */
function Star({ x, y, r }: { x: number; y: number; r: number }) {
  const k = r * 0.28;
  const d = `M ${x} ${y - r} Q ${x + k} ${y - k} ${x + r} ${y} Q ${x + k} ${y + k} ${x} ${y + r} `
    + `Q ${x - k} ${y + k} ${x - r} ${y} Q ${x - k} ${y - k} ${x} ${y - r} Z`;
  return <path d={d} style={{ fill: 'var(--dusk-star)' }} className="azkar-art-twinkle" />;
}

/** Россыпь мелких точек по вечерней плитке — едва заметная, только ради
 *  ощущения неба. Положения фиксированы: случайные прыгали бы при каждом
 *  рендере. */
function StarField() {
  const dots: [number, number, number][] = [
    [14, 12, 1.2], [30, 22, 0.9], [72, 9, 1.1], [86, 30, 0.8], [56, 34, 0.7],
    [20, 44, 0.8], [90, 52, 1], [8, 60, 0.7], [64, 58, 0.6],
  ];
  return (
    <svg aria-hidden width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.55 }}>
      {dots.map(([cx, cy, r], i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={r * 0.5} ry={r * 0.3} style={{ fill: 'var(--dusk-star)' }} />
      ))}
    </svg>
  );
}

/**
 * Строка категории — для категорий сверх утра и вечера (сейчас их нет).
 * Тот же вид, что у строки суры на главной.
 */
function CategoryRow({
  title, count, last, onClick,
}: {
  title: string;
  count: number;
  last: boolean;
  onClick: () => void;
}) {
  return (
    <div role="listitem" style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        className="picker-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)',
          minHeight: '64px',
          padding: 'var(--space-cozy) var(--space-snug)',
          margin: '0 calc(var(--space-snug) * -1)',
          width: 'calc(100% + var(--space-snug) * 2)',
          border: 'none',
          borderRadius: 'var(--radius-control)',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          color: 'inherit',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span aria-hidden style={{
          flexShrink: 0,
          width: '40px', height: '40px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-pill)',
          background: 'rgb(var(--brand-rgb) / 0.16)',
          color: 'var(--text-primary)',
        }}>
          <Sparkle size={ICON_SIZE.md} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: '2px' }}>
          <span style={{
            fontSize: 'var(--font-body)',
            lineHeight: 'var(--leading-body)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-primary)',
          }}>
            {title}
          </span>
          <span style={{
            fontSize: 'var(--font-footnote)',
            lineHeight: 'var(--leading-footnote)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {count} {azkarWord(count)}
          </span>
        </span>
        <span aria-hidden style={{ flexShrink: 0, display: 'inline-flex', color: 'var(--text-tertiary)' }}>
          <ChevronRight size={ICON_SIZE.sm} />
        </span>
      </button>
      {!last && (
        <span aria-hidden style={{
          position: 'absolute',
          left: 'calc(40px + var(--space-cozy))',
          right: 0, bottom: 0, height: '1px',
          background: 'var(--hairline)',
        }} />
      )}
    </div>
  );
}

/** Заглушка на время загрузки azkar.json — две плитки той же геометрии,
 *  чтобы при появлении данных ничего не прыгнуло. */
function TilesSkeleton() {
  return (
    <div aria-hidden style={{
      height: TILE_HEIGHT, flexShrink: 0,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
    }}>
      <div className="skeleton" style={{ borderRadius: '32px' }} />
      <div className="skeleton" style={{ borderRadius: '32px' }} />
    </div>
  );
}
