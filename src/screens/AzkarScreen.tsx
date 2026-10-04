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
import { Appearance, ICON_SIZE, Sunrise, Sunset } from '../components/icons';
import { ThemeSettings } from '../components/ReadingSettings';
import { LargeTitleHeader } from '../components/ScreenHeader';
import { TAB_BAR_SPACE } from '../components/TabBar';
import { loadAzkarData, type AzkarCategoryId, type AzkarData } from '../lib/azkar';

type Props = {
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

export function AzkarScreen({ theme, setTheme, onOpenCategory }: Props) {
  const [data, setData] = useState<AzkarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
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
      // Колонка на всю высоту: свободное место достаётся карточкам,
      // и они опускаются к нижней кромке.
      display: 'flex',
      flexDirection: 'column',
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
        <div style={{
          flex: 1,
          display: 'grid',
          // Строк ровно столько, сколько категорий: две — значит по
          // половине свободной высоты каждой.
          gridTemplateRows: `repeat(${visibleCats.length}, minmax(120px, 1fr))`,
          // Потолок нужен на планшете и в альбомной ориентации: без
          // него карточка растянулась бы на пол-экрана и превратилась
          // в баннер.
          gridAutoRows: 'minmax(120px, 1fr)',
          gap: 'var(--space-margin)',
          alignContent: 'end',
          paddingTop: 'var(--space-snug)',
        }}>
          {visibleCats.map(cat => (
            <CategoryCard
              key={cat.id}
              id={cat.id}
              title={cat.title_ru || (cat.id === 'morning' ? 'Утренние азкары' : 'Вечерние азкары')}
              count={data.by_category[cat.id] ?? 0}
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
 * Крупная карточка категории.
 *
 * Занимает половину свободной высоты — промахнуться невозможно даже на
 * ходу.  Прижата к низу экрана: тянуться пальцем в верхнюю треть
 * телефона неудобно, а пунктов тут всего два.
 *
 * ── Почему карточки цветные ───────────────────────────────────────────
 *
 * Сначала обе были одинаковыми серыми прямоугольниками и читались как
 * строки таблицы: чтобы понять, куда жмёшь, приходилось читать текст.
 * Теперь у утренних тёплый рассветный тон, у вечерних холодный
 * закатный — категория узнаётся боковым зрением, до чтения.
 *
 * Тон задан фиксированными rgb с малой прозрачностью, а не переменными
 * темы: смысл именно в «тепло против холода», и он должен сохраняться
 * на всех пяти темах одинаково.  Прозрачность низкая (0.05–0.12), так
 * что подложка остаётся подложкой и не спорит с текстом ни на белой
 * бумаге, ни на чёрной канве.
 *
 * Крупный знак времени суток в углу — не украшение, а способ заполнить
 * площадь: карточка высотой 300 px с одной строкой текста выглядит
 * пустой, а дорисовывать в неё содержание нечего.  Он обрезается
 * краем и уведён почти в прозрачность, чтобы работать как фактура,
 * а не как вторая иконка.
 *
 * Чего здесь СОЗНАТЕЛЬНО нет: отметки «сейчас читать эти».  Время
 * азкаров привязано к намазу (утренние — после фаджра, вечерние —
 * после асра), а расписания в приложении пока нет.  Подсказка по
 * часам была бы религиозным утверждением наугад.  Вернуться к этому
 * после раздела «Намаз».
 */
function CategoryCard({
  id, title, count, onClick,
}: {
  id: AzkarCategoryId;
  title: string;
  count: number;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);
  const evening = id === 'evening';
  const Icon = evening ? Sunset : Sunrise;

  // Рассвет — тёплый янтарь, закат — холодный индиго.
  const tint = evening ? '86, 108, 190' : '214, 150, 74';

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-margin)',
        width: '100%',
        height: '100%',
        padding: 'var(--space-section)',
        borderRadius: 'var(--radius-card)',
        border: `1px solid rgba(${tint}, 0.22)`,
        background: `
          radial-gradient(120% 90% at 100% 0%, rgba(${tint}, 0.16) 0%, rgba(${tint}, 0.05) 45%, transparent 78%),
          var(--surface)
        `,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'inherit',
        transform: pressed ? 'scale(0.985)' : 'scale(1)',
        transition: 'transform 180ms cubic-bezier(0.4,0,0.2,1)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Знак времени суток фактурой в углу. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: '-26px',
          bottom: '-30px',
          color: `rgba(${tint}, 0.5)`,
          opacity: 0.28,
          pointerEvents: 'none',
          display: 'inline-flex',
        }}
      >
        <Icon size={168} />
      </span>

      <span
        aria-hidden
        style={{
          position: 'relative',
          flexShrink: 0,
          width: '54px', height: '54px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-pill)',
          background: `rgba(${tint}, 0.16)`,
          border: `1px solid rgba(${tint}, 0.28)`,
          color: 'var(--text-primary)',
        }}
      >
        <Icon size={ICON_SIZE.lg} />
      </span>

      <span style={{ position: 'relative', minWidth: 0 }}>
        <span
          className="display-serif"
          style={{
            display: 'block',
            fontSize: 'clamp(22px, 6vw, 27px)',
            fontWeight: 'var(--weight-regular)',
            letterSpacing: '-0.015em',
            color: 'var(--text-primary)',
            lineHeight: 1.15,
          }}
        >
          {title}
        </span>
        <span style={{
          display: 'block', marginTop: 'var(--space-snug)',
          fontSize: 'var(--font-footnote)',
          lineHeight: 'var(--leading-footnote)',
          color: 'var(--text-secondary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {count} {azkarWord(count)}
        </span>
      </span>
    </button>
  );
}

/** Заглушка на время загрузки azkar.json.  Повторяет и геометрию, и
 *  положение карточек, чтобы при появлении данных ничего не прыгнуло. */
function CategorySkeleton() {
  return (
    <div style={{
      flex: 1,
      display: 'grid',
      gridTemplateRows: 'repeat(2, minmax(120px, 1fr))',
      gap: 'var(--space-margin)',
      alignContent: 'end',
      paddingTop: 'var(--space-snug)',
    }}>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ borderRadius: 'var(--radius-card)' }} />
      ))}
    </div>
  );
}
