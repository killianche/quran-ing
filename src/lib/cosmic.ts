/**
 * cosmic — фиксированные параметры атмосферы темы «Аврора».
 *
 * В прежнем QuranIng это был настраиваемый слой: пользователь выбирал режим
 * звёзд (полёт / мерцание), скорость, плотность, палитру сияния из
 * шести, направление и яркость — всё через localStorage-префы и
 * отдельную панель настроек.  Здесь «Аврора» — одна из трёх тем, а не
 * конструктор, поэтому её вид зашит константами: ровно тот пресет,
 * который в оригинале назывался `aurora-ice` и стоял дефолтом на
 * первом запуске.
 *
 * Что осталось настраиваемым: скорость дыхания и течения рамки
 * (lib/auroraPrefs.ts).  Что вернуть проще всего, если захочется:
 * палитру — добавить ещё запись в AURORA_COLOURS и прокинуть выбор
 * в CosmicLayer.
 */

export type AuroraDirection = 'top' | 'bottom' | 'frame' | 'rays';

export type AuroraPaletteSpec = {
  label: string;
  /** Два слоя градиента самого сияния. */
  layer1: string;
  layer2: string;
  /** Радиальный ореол под активным словом (AyahGlowLayer). */
  ayahGlow: string;
  /** Пятиступенчатый text-shadow активного слова в glow-режиме. */
  wordShadow: string;
};

/**
 * Палитра «Лёд» — единственная используемая.
 *
 * rgba-строки заранее развёрнуты, без color-mix(): iOS Safari < 16.4
 * не понимает color-mix и молча выбрасывает такой стоп градиента,
 * из-за чего сияние пропадало целиком.  Перенесено verbatim из
 * прежнего QuranIng, где эти значения подбирались вручную.
 */
export const AURORA_ICE: AuroraPaletteSpec = {
  label: 'Лёд',
  layer1: 'rgba(120,200,240,0.44)',
  layer2: 'rgba(180,220,240,0.36)',
  ayahGlow:
    'radial-gradient(ellipse at 50% 50%, rgba(120,200,240,0.48) 0%, ' +
    'rgba(120,200,240,0.20) 30%, rgba(120,200,240,0.06) 55%, transparent 80%)',
  wordShadow:
    '0 -16px 36px rgba(150,215,245,0.84), 0 16px 36px rgba(150,215,245,0.84), ' +
    '0 0 30px rgba(150,215,245,0.84), 0 -40px 110px rgba(100,180,225,0.76), ' +
    '0 40px 110px rgba(100,180,225,0.76)',
};

/**
 * Параметры сцены «Аврора».
 *
 * Звёзд нет.  Летящее звёздное поле выглядело эффектно на скриншоте,
 * но в кадре постоянно что-то двигалось, а читают тут длинные тексты
 * подолгу — движение на периферии зрения утомляет.  Убрано вместе с
 * компонентом CosmicWarp.
 *
 * direction 'frame' — свечение узкой рамкой по четырём краям, центр
 * чистый.  Ощущение сияния, идущего откуда-то издалека, а не лампы
 * над страницей.
 *
 * Рамка живая: очень медленно дышит и одной мягкой волной обходит
 * экран по кругу. Движутся только opacity/transform compositor-слоёв,
 * поэтому текст не перерисовывается и скролл не теряет плавность.
 */
/**
 * Палитра «Мох» — вторая «Аврора».
 *
 * Тот же приём, что у ледяной, но зелёный тон и свечение не от краёв,
 * а из центра экрана.  Значения alpha ниже, чем у AURORA_ICE: пятно в
 * центре лежит прямо под текстом, и то, что у кромки читается как
 * далёкое сияние, посреди страницы превратилось бы в подсветку из-под
 * букв.  Подобрано так, чтобы свечение угадывалось, а не светило.
 *
 * rgba развёрнуты заранее, без color-mix(), по той же причине, что и
 * у AURORA_ICE: iOS Safari < 16.4 молча выбрасывает такой стоп.
 */
export const AURORA_MOSS: AuroraPaletteSpec = {
  label: 'Мох',
  layer1: 'rgba(90,210,150,0.38)',
  layer2: 'rgba(150,225,175,0.30)',
  ayahGlow:
    'radial-gradient(ellipse at 50% 50%, rgba(90,210,150,0.44) 0%, ' +
    'rgba(90,210,150,0.18) 30%, rgba(90,210,150,0.05) 55%, transparent 80%)',
  wordShadow:
    '0 -16px 36px rgba(120,225,170,0.80), 0 16px 36px rgba(120,225,170,0.80), ' +
    '0 0 30px rgba(120,225,170,0.80), 0 -40px 110px rgba(80,190,140,0.72), ' +
    '0 40px 110px rgba(80,190,140,0.72)',
};

/*
 * Остальные цвета сияния.
 *
 * «Лёд» и «Мох» выше подбирались вручную и остаются как есть.  Эти
 * четыре собраны по тому же рецепту от одного базового тона: layer1 —
 * сам цвет, layer2 — его посветлевшая версия, ореол и тень слова
 * производные.  Одинаковая формула нужна, чтобы при переключении цвета
 * менялся оттенок, а не яркость и характер свечения.
 *
 * rgba развёрнуты заранее, без color-mix(): iOS Safari < 16.4 молча
 * выбрасывает такой стоп градиента, и сияние пропадает целиком.
 */

export const AURORA_VIOLET: AuroraPaletteSpec = {
  label: 'Сирень',
  layer1: 'rgba(168,140,245,0.42)',
  layer2: 'rgba(205,185,250,0.34)',
  ayahGlow:
    'radial-gradient(ellipse at 50% 50%, rgba(168,140,245,0.46) 0%, ' +
    'rgba(168,140,245,0.19) 30%, rgba(168,140,245,0.06) 55%, transparent 80%)',
  wordShadow:
    '0 -16px 36px rgba(205,185,250,0.80), 0 16px 36px rgba(205,185,250,0.80), ' +
    '0 0 30px rgba(205,185,250,0.80), 0 -40px 110px rgba(168,140,245,0.72), ' +
    '0 40px 110px rgba(168,140,245,0.72)',
};

export const AURORA_ROSE: AuroraPaletteSpec = {
  label: 'Роза',
  layer1: 'rgba(240,150,190,0.42)',
  layer2: 'rgba(248,195,218,0.34)',
  ayahGlow:
    'radial-gradient(ellipse at 50% 50%, rgba(240,150,190,0.46) 0%, ' +
    'rgba(240,150,190,0.19) 30%, rgba(240,150,190,0.06) 55%, transparent 80%)',
  wordShadow:
    '0 -16px 36px rgba(248,195,218,0.80), 0 16px 36px rgba(248,195,218,0.80), ' +
    '0 0 30px rgba(248,195,218,0.80), 0 -40px 110px rgba(240,150,190,0.72), ' +
    '0 40px 110px rgba(240,150,190,0.72)',
};

/**
 * Серебро — единственный нейтральный вариант.
 *
 * Тон уведён в холод (голубее красного канала), потому что чистый серый на
 * тёмном фоне читается не как свет, а как дымка или запачканное стекло.
 * Малейшая синева возвращает ощущение свечения, оставаясь серой.
 */
export const AURORA_SILVER: AuroraPaletteSpec = {
  label: 'Серебро',
  layer1: 'rgba(176,184,196,0.42)',
  layer2: 'rgba(216,222,230,0.34)',
  ayahGlow:
    'radial-gradient(ellipse at 50% 50%, rgba(176,184,196,0.46) 0%, ' +
    'rgba(176,184,196,0.19) 30%, rgba(176,184,196,0.06) 55%, transparent 80%)',
  wordShadow:
    '0 -16px 36px rgba(216,222,230,0.80), 0 16px 36px rgba(216,222,230,0.80), ' +
    '0 0 30px rgba(216,222,230,0.80), 0 -40px 110px rgba(176,184,196,0.72), ' +
    '0 40px 110px rgba(176,184,196,0.72)',
};

/** Идентификатор цвета сияния.  Не путать с AURORA_PALETTES из
 *  audioPrefs — те про подсветку слова при чтении, а не про фон. */
export type AuroraColourId = 'ice' | 'moss' | 'violet' | 'rose' | 'silver';

/**
 * Порядок в выборе цвета: холодные, потом тёплый, нейтральное замыкает.
 *
 * Золота и заката здесь больше нет — решение владельца.  Сохранённые у
 * прежних читателей `gold` и `ember` не сломают экран: readAuroraPalette
 * сверяет значение с этим списком и на незнакомом откатывается к цвету
 * темы по умолчанию.
 */
export const AURORA_COLOURS: { id: AuroraColourId; spec: AuroraPaletteSpec; swatch: string }[] = [
  { id: 'ice',    spec: AURORA_ICE,    swatch: '#78c8f0' },
  { id: 'moss',   spec: AURORA_MOSS,   swatch: '#5ad296' },
  { id: 'violet', spec: AURORA_VIOLET, swatch: '#a88cf5' },
  { id: 'rose',   spec: AURORA_ROSE,   swatch: '#f096be' },
  { id: 'silver', spec: AURORA_SILVER, swatch: '#b0b8c4' },
];

export function auroraPaletteById(id: AuroraColourId): AuroraPaletteSpec {
  return AURORA_COLOURS.find(p => p.id === id)?.spec ?? AURORA_ICE;
}


/**
 * Выбранный цвет сияния.
 *
 * Ключей два, по одному на тему, и это осознанно: «Аврора 2» — зелёная
 * по своей сути, и если бы цвет был один на обе темы, выбор синего в
 * первой молча превращал бы вторую в её копию.  Так у каждой темы свой
 * цвет по умолчанию, а человек меняет тот, который видит сейчас.
 */
const PALETTE_KEYS = {
  aurora: 'aurora.palette',
  aurora2: 'aurora2.palette',
} as const;

const PALETTE_DEFAULTS = {
  aurora: 'ice',
  aurora2: 'moss',
} as const;

export type AuroraVariant = keyof typeof PALETTE_KEYS;
export const AURORA_PALETTE_EVENT = 'aurora-palette-changed';

export function readAuroraPalette(variant: AuroraVariant): AuroraColourId {
  if (typeof window === 'undefined') return PALETTE_DEFAULTS[variant];
  const v = localStorage.getItem(PALETTE_KEYS[variant]);
  return AURORA_COLOURS.some(p => p.id === v)
    ? (v as AuroraColourId)
    : PALETTE_DEFAULTS[variant];
}

export function writeAuroraPalette(variant: AuroraVariant, id: AuroraColourId) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PALETTE_KEYS[variant], id);
  window.dispatchEvent(new Event(AURORA_PALETTE_EVENT));
}

export function onAuroraPaletteChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(AURORA_PALETTE_EVENT, fn);
  return () => window.removeEventListener(AURORA_PALETTE_EVENT, fn);
}

export const AURORA_SCENE = {
  // Насыщенность сохранена прежней. Спокойнее рамка становится за счёт
  // меньшей толщины градиента, а не обесцвечивания самого света.
  auroraBrightness: 0.62,
  auroraDirection: 'frame' as AuroraDirection,
} as const;

/**
 * Сцена второй «Авроры».
 *
 * direction 'rays' — занавес снизу вверх: свет поднимается от нижней
 * кромки, лучи доходят почти до верха и там гаснут.
 *
 * Была промежуточная версия со свечением из центра — заменена по
 * решению владельца.  Яркость чуть выше рамочной (0.38 против 0.42
 * у ледяной — сопоставимо), потому что верхняя половина у занавеса
 * слабая по построению: под текстом света почти нет, вся плотность
 * собрана у нижней кромки.
 */
/**
 * Сцена темы «Космос».
 *
 * Звёзды летели со скоростью 1.5, пока их не убрали 09.08.2026 вместе с
 * `CosmicWarp.tsx`. Причина была записана в коде: постоянное движение мешает
 * читать длинные тексты, а canvas с циклом кадров сажает батарею.
 *
 * Владелец 07.09.2026 попросил вернуть их — и именно летящие, отдельной темой,
 * а не в тёмную. Поэтому скорость восстановлена ровно прежняя: возвращать надо
 * то, что помнят, а не мою версию того же. Число вынесено сюда, чтобы правка
 * была в одну строку, если движение всё-таки окажется навязчивым.
 *
 * Тема одна и без настроек: «Аврора» и «Аврора 2» — это свет, «Космос» — это
 * звёзды. Смешивать их в одном слое незачем.
 */
export const COSMOS_SCENE = {
  starsSpeed: 1.5,
} as const;

export const AURORA2_SCENE = {
  auroraBrightness: 0.38,
  auroraDirection: 'rays' as AuroraDirection,
} as const;
