/**
 * AzkarScreen — главный экран раздела «Азкары».
 *
 * Шапка — как на главной Корана: то же название раздела тем же кеглем,
 * та же кнопка оформления справа. Переключение вкладки должно читаться
 * как переход внутри одного продукта, а не в другое приложение (раньше
 * тут был вордмарк «Azkar» латиницей высотой до 88 px).
 *
 * А вот список — намеренно НЕ как у сур.
 *
 * У Корана 114 строк, и там строка правильная: помещается много,
 * сканируется за взгляд. Здесь пунктов ровно два, и список из двух
 * строк у самого верха — худшее, что можно сделать на телефоне: экран
 * пустой на девять десятых, а тянуться пальцем надо в самый верх.
 *
 * Поэтому две большие карточки, поделившие свободную высоту и прижатые
 * к НИЗУ экрана — туда, куда большой палец дотягивается не глядя.
 * Промах по такой карточке невозможен.
 *
 * Иконка вместо номера: у категорий нет порядкового номера, которым бы
 * кто-то пользовался. Восход и закат различимы с одного взгляда и сразу
 * говорят, когда это читают.
 *
 * Арабских названий категорий в azkar.json нет, и придумывать их —
 * ровно то, чего нельзя делать с сакральным текстом. Поэтому правая
 * колонка, где у сур стоит арабское начертание, здесь пустая.
 *
 * Порядок категорий — как в azkar.json, показываются только те, где
 * есть хотя бы одна запись («Вступительные» пока пусты и скрыты).
 */

import { useEffect, useRef, useState } from 'react';
import type { Theme } from '../hooks/useTheme';
import { Appearance, ChevronRight, ICON_SIZE, Sunrise, Sunset } from '../components/icons';
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

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: 'min(100%, 720px)',
      margin: '0 auto',
      padding: `0 var(--space-margin) calc(${TAB_BAR_SPACE} + var(--space-section) + var(--mini-player-space, 0px) + env(safe-area-inset-bottom))`,
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

      {!data && !error && <CategorySkeleton />}

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

      {data && visibleCats.length > 0 && (
        <div role="list">
          {visibleCats.map((cat, i) => (
            <CategoryRow
              key={cat.id}
              id={cat.id}
              title={cat.title_ru || (cat.id === 'morning' ? 'Утренние азкары' : 'Вечерние азкары')}
              count={data.by_category[cat.id] ?? 0}
              last={i === visibleCats.length - 1}
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
 * Строка категории — как строка суры на главной (владелец 2026-10-04:
 * «страницу Азкары, их блоки… переделай под наш новый стиль»).
 *
 * Прежде были две карточки на полэкрана с градиентом и крупным знаком
 * времени суток фактурой — их сняли вместе с обложкой главной: «слишком
 * много всего». Осталось то, что работает: значок утра или вечера в
 * маленьком круге с тёплым (рассвет) или холодным (закат) тоном — так
 * категория узнаётся боковым зрением, — название, число азкаров и шеврон.
 *
 * Чего здесь СОЗНАТЕЛЬНО нет: отметки «сейчас читать эти». Время азкаров
 * привязано к намазу (утренние — после фаджра, вечерние — после асра);
 * подсказка по часам была бы религиозным утверждением наугад.
 */
function CategoryRow({
  id, title, count, last, onClick,
}: {
  id: AzkarCategoryId;
  title: string;
  count: number;
  last: boolean;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);
  const evening = id === 'evening';
  const Icon = evening ? Sunset : Sunrise;
  // Рассвет — тёплый янтарь, закат — холодный индиго; фиксированные rgb,
  // чтобы смысл «тепло против холода» был одинаков на всех темах.
  const tint = evening ? '86, 108, 190' : '214, 150, 74';

  return (
    <div role="listitem" style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        onPointerDown={() => setPressed(true)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)',
          minHeight: '68px',
          // Поля по бокам — чтобы подсветка нажатия не упиралась в значок и
          // шеврон; отрицательный отступ возвращает строку к краю колонки.
          padding: 'var(--space-cozy) var(--space-snug)',
          margin: '0 calc(var(--space-snug) * -1)',
          width: 'calc(100% + var(--space-snug) * 2)',
          border: 'none',
          borderRadius: 'var(--radius-control)',
          background: pressed ? 'rgb(var(--ink-rgb) / 0.05)' : 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          color: 'inherit',
          transition: 'background var(--dur-fast) var(--ease-standard)',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: '40px', height: '40px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'var(--radius-pill)',
            background: `rgba(${tint}, 0.16)`,
            color: 'var(--text-primary)',
          }}
        >
          <Icon size={ICON_SIZE.md} />
        </span>

        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: '2px' }}>
          <span style={{
            fontSize: 'var(--font-body)',
            lineHeight: 'var(--leading-body)',
            fontWeight: 'var(--weight-semibold)',
            letterSpacing: 'var(--tracking-tight)',
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

      {/* Волосок начинается под текстом, а не под значком — как в
          сгруппированных списках iOS и в списке сур. */}
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

/** Заглушка на время загрузки azkar.json — две строки той же высоты,
 *  чтобы при появлении данных ничего не прыгнуло. */
function CategorySkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)', minHeight: '68px' }}>
          <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-pill)' }} />
          <div style={{ flex: 1, display: 'grid', gap: '6px' }}>
            <div className="skeleton" style={{ height: '16px', width: '55%', borderRadius: '4px' }} />
            <div className="skeleton" style={{ height: '12px', width: '28%', borderRadius: '4px' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
