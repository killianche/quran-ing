/**
 * Единый набор иконок Quran Ing.
 *
 * Правила набора — они же причина, по которой файл выглядит однообразно:
 *
 * 1. ОДНА СЕТКА.  Все интерфейсные иконки нарисованы в `0 0 24 24`.
 *    Раньше в наборе жили пять систем координат (24, 16, 1024, 42×200,
 *    100×100), и одна и та же «толщина 1.5» означала в них разный вес на
 *    экране: в 16-й сетке штрих выходил в полтора раза жирнее, в 1024-й
 *    иконка вообще была залитой.  Ни один размер нельзя было выбрать
 *    осознанно, потому что «22» у одной иконки и «22» у соседней давали
 *    разную плотность.
 *
 * 2. ОДНА ТОЛЩИНА — {@link STROKE} = 1.75 при сетке 24.
 *    Почему 1.75, а не прежние 1.5.  Иконки в приложении стоят рядом с
 *    текстом кегля 13–17 и начертания 500–600.  При типичном размере
 *    иконки 20 px штрих 1.5/24 превращается в 1.25 CSS-px и рядом с
 *    таким текстом выглядит бледнее его — иконка «проваливается».
 *    1.75/24 даёт на тех же 20 px около 1.46 CSS-px: это тот же
 *    оптический вес, что у системных значков iOS в начертании Regular,
 *    и при этом заметно легче, чем 2/24 у веб-наборов, нарисованных под
 *    крупные размеры.  Восемь толщин (1.1 / 1.5 / 1.7 / 1.75 / 1.9 / 2 /
 *    2.1 / 2.4), которые были в файле, сведены к этой одной.
 *
 * 3. ОДИН НАБОР РАЗМЕРОВ — {@link ICON_SIZE}, три ступени.
 *    Вместо тринадцати произвольных чисел (13, 14, 15, 16, 17, 18, 19,
 *    20, 21, 22, 24, 27, 28) есть sm / md / lg.  Значение по умолчанию у
 *    каждой иконки — тоже ступень шкалы, поэтому вызов без `size`
 *    остаётся предсказуемым.
 *
 * 4. ОБВОДКА ПРОТИВ ЗАЛИВКИ.  Правило одно и применяется везде:
 *      • контур — состояние по умолчанию для всего, что является
 *        действием или навигацией;
 *      • сплошная заливка допустима ровно в трёх ролях:
 *        (а) выбранное / активное состояние — через проп `isFilled`,
 *            заливается ВЕСЬ силуэт (вкладки, закладка, будильник);
 *        (б) маленькая метка-указатель внутри контурной фигуры, которая
 *            в виде контура нечитаема, — стрелка компаса, сердцевина
 *            цветка, минус-круг удаления;
 *        (в) заливка сама несёт смысл — половина круга в «Оформлении»
 *            означает контраст светлой и тёмной тем.
 *    Внутри одной фигуры `fill` и `stroke` не смешиваются, и ни один
 *    контур не рисуется дважды (раньше так были сделаны «Компас» и
 *    «Оформление»).  У залитых состояний внутренние линии ВЫРУБАЮТСЯ
 *    маской (см. `useCutId`), а не закрашиваются цветом подложки: под
 *    иконкой не всегда `--surface`.
 *
 * 5. ОПТИЧЕСКОЕ ВЫРАВНИВАНИЕ.  Габарит каждого рисунка с учётом
 *    половины штриха уложен около центра 12/12; у направленных фигур
 *    (треугольник воспроизведения, шевроны) центр смещён к острию,
 *    иначе они кажутся сдвинутыми назад.
 */

import { useId } from 'react';
import type { CSSProperties } from 'react';

/**
 * Три допустимые ступени размера.  Больше ступеней в наборе нет — если
 * нужен промежуточный размер, это признак того, что элемент интерфейса
 * стоит поправить, а не иконку.
 *
 *   sm — плотные строки: чипы, счётчики, кнопки внутри карточек,
 *        иконка рядом с текстом кегля 11–13.
 *   md — базовый размер: круглые кнопки шапки, панели, строки списков,
 *        строки поповеров.  Значение по умолчанию у всех иконок.
 *   lg — таб-бар и пустые состояния, где иконка работает как картинка.
 */
export const ICON_SIZE = { sm: 16, md: 20, lg: 26 } as const;

/** Единственная толщина штриха набора при сетке 24×24. */
export const STROKE = 1.75;

type Props = {
  size?: number;
  /** Нужен там, где иконкой управляет CSS (например, поворот шеврона
   *  у раскрытого `<details>` — селектор `summary svg.chev`). */
  className?: string;
  style?: CSSProperties;
};
type SelectableProps = Props & { isFilled?: boolean };

const stroke = (size: number, className?: string, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: STROKE,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  style,
  'aria-hidden': true,
});

const solid = (size: number, className?: string, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  className,
  style,
  'aria-hidden': true,
});

/**
 * Идентификатор для маски-вырубки.
 *
 * 🔴 Вырубка делается маской, а НЕ закраской цветом подложки.
 *
 * Раньше внутренние линии залитых иконок рисовались цветом
 * `var(--surface)`, и в комментарии это называлось вырубкой. Вырубкой оно не
 * было: это непрозрачная краска цвета фона. Пока фон совпадал с `--surface`,
 * разницы не было видно. Но у выбранной вкладки под иконкой лежит
 * тонированная подложка, а сама панель — полупрозрачное стекло, и «вырубка»
 * оказывалась полоской чужого цвета поперёк глифа.
 *
 * Маска вырезает по-настоящему: сквозь неё видно то, что под иконкой, каким
 * бы оно ни было. Идентификатор берётся из `useId`, потому что на экране
 * одновременно бывает несколько таких иконок, а совпадение id тихо сломало бы
 * все, кроме первой. Двоеточия из него убираются: они допустимы в атрибуте
 * `id`, но ломают ссылку `url(#…)`.
 */
function useCutId(): string {
  return 'cut' + useId().replace(/:/g, '');
}

/* ── Навигация ──────────────────────────────────────────────────────
   Один шеврон под тремя углами: те же 45°, та же длина плеча.  Раньше
   левый и правый были нарисованы дугой Безье с радиусом на изломе, а
   в раскрывающемся блоке азкаров жила третья копия с толщиной 2 — три
   разных знака для одного смысла. */

export const ChevronLeft = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M15 5.25 8.25 12 15 18.75" />
  </svg>
);

export const ChevronRight = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M9 5.25 15.75 12 9 18.75" />
  </svg>
);

export const ChevronDown = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M5.25 9 12 15.75 18.75 9" />
  </svg>
);

/**
 * Звезда азкаров — четыре луча с вогнутыми сторонами плюс малая рядом.
 * Вогнутые стороны дают узнаваемый силуэт вспышки; правильный ромб на
 * мелком размере читался как «крестик».
 */
export const Sparkle = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => (
  <svg {...stroke(size, className, style)} fill={isFilled ? 'currentColor' : 'none'}>
    {/* Обе звезды подросли: по замеру глиф был легче среднего по набору на
        четверть, а малая звезда на кегле панели почти не читалась. */}
    <path d="M10.5 2.3c.55 4.6 2 6.95 5.45 7.9-3.45.95-4.9 3.3-5.45 7.9-.55-4.6-2-6.95-5.45-7.9 3.45-.95 4.9-3.3 5.45-7.9Z" />
    <path d="M18 13.2c.25 2.2.95 3.35 2.6 3.8-1.65.45-2.35 1.6-2.6 3.8-.25-2.2-.95-3.35-2.6-3.8 1.65-.45 2.35-1.6 2.6-3.8Z" />
  </svg>
);

/* ── Управление воспроизведением ────────────────────────────────────
   Все четыре знака — контур: это действия, а не состояние.  Раньше
   набор возил их залитыми в сетке 16×16, а экран азкаров рисовал свою
   контурную пару в сетке 24 с толщиной 2, и обе версии стояли на одном
   экране в полутора сантиметрах друг от друга. */

export const Play = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M7.25 5.5 17.5 12 7.25 18.5Z" />
  </svg>
);

export const Pause = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M9.25 5.75v12.5M14.75 5.75v12.5" />
  </svg>
);

export const SkipForward = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M6 6 15 12 6 18Z" />
    <path d="M18 5.75v12.5" />
  </svg>
);

export const SkipBack = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M18 6 9 12 18 18Z" />
    <path d="M6 5.75v12.5" />
  </svg>
);

/**
 * Перемотка на 10 секунд — круговая стрелка с числом внутри, как у
 * системных плееров. Нужна чтецу без границ аятов: у него «соседний аят»
 * означает шаг по времени, и треугольники «трек назад/вперёд» обещали бы
 * не то, что произойдёт.
 *
 * Число — текстом, а не контуром: семейство наследуется от интерфейса, и
 * цифры совпадают с остальными подписями плеера.
 */
const SEEK_LABEL = (
  <text
    x="12" y="16.1"
    textAnchor="middle"
    fontSize="7.4"
    fontWeight={600}
    fill="currentColor"
    stroke="none"
    fontFamily="inherit"
  >
    10
  </text>
);

export const SeekBack10 = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M12 5A8 8 0 1 1 6.34 7.34" />
    <path d="M14.25 2.75 12 5l2.25 2.25" />
    {SEEK_LABEL}
  </svg>
);

export const SeekForward10 = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M12 5A8 8 0 1 0 17.66 7.34" />
    <path d="M9.75 2.75 12 5 9.75 7.25" />
    {SEEK_LABEL}
  </svg>
);

/**
 * Закладка.  Единственная иконка, у которой значение по умолчанию —
 * `sm`: она стоит внутри строки аята, рядом с текстом, и на `md`
 * перевешивала бы номер аята.
 */
export const Bookmark = ({ size = ICON_SIZE.sm, isFilled = false, className, style }: SelectableProps) => (
  <svg {...stroke(size, className, style)} fill={isFilled ? 'currentColor' : 'none'}>
    <path d="M6.75 4.75h10.5a1 1 0 0 1 1 1v13.42a.6.6 0 0 1-.95.49L12 15.9l-5.3 3.76a.6.6 0 0 1-.95-.49V5.75a1 1 0 0 1 1-1Z" />
  </svg>
);

/** Закрыть.  Был жирный залитый крест в сетке 1024 — единственная
 *  иконка набора, нарисованная контуром буквы, а не штрихом. */
export const Close = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M6.75 6.75 17.25 17.25M17.25 6.75 6.75 17.25" />
  </svg>
);

export const Search = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <circle cx="10.75" cy="10.75" r="6.5" />
    <path d="m15.6 15.6 4.4 4.4" />
  </svg>
);

/**
 * Текст и шрифты — большая и малая «A».
 *
 * Пара букв разного кегля — устоявшийся знак размера текста, и на
 * мелком размере он остаётся разборчивым, потому что состоит из
 * четырёх линий.
 */
export const Typography = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="m3.95 17.7 4.1-11.4 4.1 11.4" />
    <path d="M5.45 14h5.2" />
    <path d="m14.85 17.7 2.6-7.2 2.6 7.2" />
    <path d="M15.75 15.4h3.4" />
  </svg>
);

/**
 * Оформление темы — круг, наполовину залитый.  Здесь заливка и есть
 * смысл знака: контраст светлой и тёмной половины.  Раньше тот же
 * контур рисовался дважды — залитым и обведённым.
 */
export const Appearance = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...solid(size, className, style)}>
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    <circle
      cx="12" cy="12" r="8.5"
      stroke="currentColor" strokeWidth={STROKE}
      strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

/** Микрофон — метка вкладки «Чтец» в настройках чтения. */
export const Microphone = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <rect x="9.25" y="2.75" width="5.5" height="10.5" rx="2.75" />
    <path d="M5.75 11.25a6.25 6.25 0 0 0 12.5 0" />
    <path d="M12 17.5v3.25" />
  </svg>
);

/** Список — «все суры» в плеере (как `list.bullet` в SF Symbols). */
export const ListBullet = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M9.25 6.5h10M9.25 12h10M9.25 17.5h10" />
    <circle cx="4.75" cy="6.5" r="0.9" fill="currentColor" />
    <circle cx="4.75" cy="12" r="0.9" fill="currentColor" />
    <circle cx="4.75" cy="17.5" r="0.9" fill="currentColor" />
  </svg>
);

/** Стрелка в лоток — «скачать в память устройства». */
export const Download = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M12 3.75v10.5" />
    <path d="m8 10.5 4 4 4-4" />
    <path d="M4.75 16.5v1.75a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V16.5" />
  </svg>
);

/** Будильник намаза.  Залитое состояние = будильник включён. */
export const Bell = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => (
  <svg {...stroke(size, className, style)} fill={isFilled ? 'currentColor' : 'none'}>
    <path d="M6.5 10.3c0-3.25 2.05-5.55 5.5-5.55s5.5 2.3 5.5 5.55v3.2l1.4 2.25c.27.44-.04 1-.56 1H5.66c-.52 0-.83-.56-.56-1l1.4-2.25z" />
    <path d="M10 19.25h4" />
  </svg>
);

export const Plus = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/**
 * Минус в залитом круге — то, чем Apple помечает удаление в режиме
 * правки списка.  Заливка обязательна: у пустого контура минус
 * читается как «свернуть», а не как «удалить».  Сам минус выбит
 * цветом подложки, это вырубка внутри залитой фигуры, а не второй
 * штрих поверх неё.
 */
export const MinusCircleFill = ({ size = ICON_SIZE.md, className, style }: Props) => {
  const cut = useCutId();
  return (
    <svg {...solid(size, className, style)}>
      <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        <path d="M8 12h8" stroke="black" strokeWidth={STROKE} strokeLinecap="round" />
      </mask>
      <circle cx="12" cy="12" r="9.25" fill="currentColor" mask={`url(#${cut})`} />
    </svg>
  );
};

/** Хват для перетаскивания — три полосы справа у строки в режиме правки. */
export const DragHandle = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M5 8.5h14M5 12h14M5 15.5h14" />
  </svg>
);

/** Глаз с чертой — «скрыть»: убрать с глаз, а не удалить. */
export const EyeOff = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M3 12s3.6-6 9-6c1.2 0 2.3.3 3.3.8" />
    <path d="M19.4 8.6C20.5 9.9 21 12 21 12s-3.6 6-9 6c-1.2 0-2.3-.3-3.3-.8" />
    <path d="M9.9 9.9a3 3 0 1 0 4.2 4.2" />
    <path d="M4 20 20 4" />
  </svg>
);

/** Глаз — «вернуть»: снова показать скрытое. Пара к EyeOff. */
export const Eye = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/**
 * Три точки — «ещё действия», как SF Symbols `ellipsis`.
 *
 * Точки залиты, а не обведены: обведённый кружок радиуса 1.75 при штрихе
 * 1.75 превращается в кляксу с дыркой, а залитый читается точкой.
 */
export const More = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...solid(size, className, style)}>
    <circle cx="5.5" cy="12" r="1.75" />
    <circle cx="12" cy="12" r="1.75" />
    <circle cx="18.5" cy="12" r="1.75" />
  </svg>
);

/** Галочка без круга — «уже добавлено». */
export const Check = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M5 12.8 9.4 17 19 7" />
  </svg>
);

/**
 * Вкладка «Плеер» — треугольник «слушать» в круге, как SF Symbols
 * `play.circle` / `play.circle.fill` (тот же символ у системной панели
 * iOS 26, lib/nativeTabBar.ts).
 *
 * Круг того же радиуса, что у часов (TabPrayer, 8.4): значки панели должны
 * весить одинаково. Треугольник смещён вправо от центра — оптически он
 * тяжелее слева, и строго по центру выглядел бы съехавшим влево.
 *
 * В контуре треугольник залит, как у системного символа: обведённый
 * треугольник внутри обведённого круга на 25 px сливается в кольцо. В
 * залитом виде он ВЫРЕЗАЕТСЯ маской (см. useCutId), а не рисуется цветом
 * фона.
 */
export const TabPlayer = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => {
  const cut = useCutId();
  const triangle = 'M10.4 8.7 15.5 12l-5.1 3.3Z';
  return (
    <svg {...stroke(size, className, style)}>
      {isFilled && (
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <path d={triangle} fill="black"
            stroke="black" strokeWidth={STROKE} strokeLinejoin="round" />
        </mask>
      )}
      <circle cx="12" cy="12" r="8.4" fill={isFilled ? 'currentColor' : 'none'}
        mask={isFilled ? `url(#${cut})` : undefined} />
      {!isFilled && <path d={triangle} fill="currentColor" />}
    </svg>
  );
};

export const TabQuran = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => (
  <svg {...stroke(size, className, style)}>
    {/* 🔴 Раскрытая книга, а не закрытая обложка.
        Прежний глиф был скруглённым прямоугольником с линией корешка: на
        25 px он читался как карточка или как заливка без смысла — владелец
        08.09.2026 попросил вернуть узнаваемые значки. Раскрытый разворот
        опознаётся мгновенно и остаётся книгой даже залитым. */}
    <path d="M12 7.1C10.1 5.7 7.8 5.1 5.2 5.3v11.9c2.6-.2 4.9.4 6.8 1.8"
      fill={isFilled ? 'currentColor' : 'none'} />
    <path d="M12 7.1c1.9-1.4 4.2-2 6.8-1.8v11.9c-2.6-.2-4.9.4-6.8 1.8"
      fill={isFilled ? 'currentColor' : 'none'} />
    <path d="M12 7.1V19" fill="none" />
  </svg>
);

export const TabAzkar = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => (
  <svg {...stroke(size, className, style)}>
    {/* 🔴 Полумесяц вместо чёток. Владелец 10.09.2026: «поставь луну как
        иконку азкаров». Азкары читают утром и вечером, и месяц говорит об
        этом прямее, чем нить бусин: её пробовали кольцом (читалось как
        индикатор загрузки), гроздью крупных бусин и разведённым рядом из
        пяти — последний хотя бы не слипался, но всё равно читался подвеской.

        Ближайший системный аналог — SF Symbols `moon` / `moon.fill`.

        Форма — разность двух окружностей: внешняя (12, 12) радиуса 8 —
        того же порядка, что круг часов рядом, — и вырезающая (18, 6)
        радиуса 7.4. Точки стыка посчитаны, а не подобраны на глаз:
        (10.85, 4.08) и (19.92, 13.15). Разные радиусы дают рожки потолще —
        у равных окружностей они сходятся в иглу и на 25 px пропадают. */}
    <path
      d="M10.85 4.08A8 8 0 1 0 19.92 13.15A7.4 7.4 0 0 1 10.85 4.08Z"
      fill={isFilled ? 'currentColor' : 'none'}
    />
  </svg>
);

/**
 * Часы — раздел «Намаз».
 *
 * 🔴 Был михраб, стали часы. Владелец 09.09.2026: «иконки сделать
 * стандартными iOS». Раздел показывает ВРЕМЯ намаза, и системный символ для
 * времени — `clock`: круг со стрелками. Михраб красивее и «исламичнее», но
 * на 25 px читался как арка или надгробие, а не как раздел расписания.
 *
 * Прежний михраб лежит в истории (коммит с ним — «нижнее меню iOS 26»),
 * вернуть — одна строка.
 */
export const TabPrayer = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => {
  const cut = useCutId();
  return (
    <svg {...stroke(size, className, style)}>
      {/* 🔴 В залитом виде стрелки ВЫРЕЗАЮТСЯ маской, а не рисуются белым.
          Белая обводка поверх заливки работает только на светлой теме: на
          тёмной заливка сама светлая, и стрелки исчезли бы. Тот же приём
          применён в значке Корана. */}
      {isFilled && (
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <path d="M12 7.3V12l3.1 1.9" fill="none"
            stroke="black" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
        </mask>
      )}
      <g mask={isFilled ? `url(#${cut})` : undefined}>
        <circle cx="12" cy="12" r="8.4" fill={isFilled ? 'currentColor' : 'none'} />
        {/* Стрелки на 10:10 — так их рисует и Apple: читается «часы», а не
            круг с крестом. */}
        {!isFilled && <path d="M12 7.3V12l3.1 1.9" fill="none" />}
      </g>
    </svg>
  );
};

/** Человек — раздел «Аккаунт». */
export const Person = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => (
  <svg {...stroke(size, className, style)} fill={isFilled ? 'currentColor' : 'none'}>
    {/* Немного крупнее прежнего (r 3.6, плечи 4.8…19.2): по замеру глиф
        был легче среднего по набору на четверть и проваливался в ряду. */}
    <circle cx="12" cy="7.9" r="4.05" />
    <path d="M4.2 20.2c0-3.95 3.5-6.5 7.8-6.5s7.8 2.55 7.8 6.5" />
  </svg>
);

/** Лист с загнутым углом — юридические документы. */
export const Document = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M6 3.5h7L18 8.5v12H6z" />
    <path d="M13 3.5v5h5" />
    <path d="M9 13h5M9 16.5h5" />
  </svg>
);

export const Trash = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M4.75 6.5h14.5" />
    <path d="M9.5 6.5V5.25a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V6.5" />
    <path d="M6.75 6.5l.7 11.4a2 2 0 0 0 2 1.85h5.1a2 2 0 0 0 2-1.85l.7-11.4" />
    <path d="M10.5 10.25v6M13.5 10.25v6" />
  </svg>
);

/** Галочка в круге — «скачано полностью». */
export const CheckCircle = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <circle cx="12" cy="12" r="8.25" />
    <path d="m8.5 12.25 2.4 2.4 4.6-5.05" />
  </svg>
);

/** Раскрытая книга — вкладка «Коран» и метка «источник» у азкаров. */
export const BookOpen = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => {
  const cut = useCutId();
  return (
    <svg {...stroke(size, className, style)} fill={isFilled ? 'currentColor' : 'none'}>
      {isFilled && (
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <path d="M12 6.75v11.4" stroke="black" strokeWidth={STROKE} strokeLinecap="round" />
        </mask>
      )}
      <g mask={isFilled ? `url(#${cut})` : undefined}>
        <path d="M12 6.75c-1.6-1.2-3.6-1.8-5.5-1.8-.6 0-1.15.05-1.75.15v11.4c.6-.1 1.15-.15 1.75-.15 1.9 0 3.9.6 5.5 1.8" />
        <path d="M12 6.75c1.6-1.2 3.6-1.8 5.5-1.8.6 0 1.15.05 1.75.15v11.4c-.6-.1-1.15-.15-1.75-.15-1.9 0-3.9.6-5.5 1.8" />
      </g>
      {!isFilled && <path d="M12 6.75v11.4" />}
    </svg>
  );
};

/** Восход — утренние азкары. */
export const Sunrise = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M4.5 18.5h15" />
    <path d="M7.75 18.5a4.25 4.25 0 0 1 8.5 0" />
    <path d="M12 5.4v2.3" />
    <path d="m6.4 7.9 1.6 1.6" />
    <path d="m17.6 7.9-1.6 1.6" />
  </svg>
);

/** Закат — вечерние азкары.  То же полусолнце, но лучи направлены вниз. */
export const Sunset = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...stroke(size, className, style)}>
    <path d="M4.5 18.5h15" />
    <path d="M7.75 18.5a4.25 4.25 0 0 1 8.5 0" />
    <path d="M12 7.8V5.5" />
    <path d="m9.4 6.1 2.6 2.6 2.6-2.6" />
  </svg>
);

/** Циферблат — вкладка «Намаз». */
export const Clock = ({ size = ICON_SIZE.md, isFilled = false, className, style }: SelectableProps) => {
  const cut = useCutId();
  return (
    <svg {...stroke(size, className, style)}>
      {isFilled && (
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <path d="M12 7.75V12l2.75 1.75" fill="none" stroke="black"
                strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
        </mask>
      )}
      <circle cx="12" cy="12" r="8.25" fill={isFilled ? 'currentColor' : 'none'}
              mask={isFilled ? `url(#${cut})` : undefined} />
      {!isFilled && <path d="M12 7.75V12l2.75 1.75" />}
    </svg>
  );
};

/**
 * Компас киблы.  Кольцо — контур, стрелка — залитая метка-указатель:
 * в виде контура на мелком размере она превращается в пятно и не даёт
 * понять, куда смотрит, а это единственное, ради чего иконка здесь.
 * Раньше стрелка рисовалась двумя одинаковыми path подряд — залитым и
 * обведённым.
 */
export const Compass = ({ size = ICON_SIZE.md, className, style }: Props) => (
  <svg {...solid(size, className, style)}>
    <circle
      cx="12" cy="12" r="8.5"
      stroke="currentColor" strokeWidth={STROKE}
      strokeLinecap="round" strokeLinejoin="round"
    />
    <path d="M15.6 8.4 13.2 13.2 8.4 15.6l2.4-4.8z" fill="currentColor" />
  </svg>
);
