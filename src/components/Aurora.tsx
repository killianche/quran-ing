/**
 * Aurora — полярное сияние: свечение сверху экрана либо мягкая живая
 * рамка по краям (direction: 'frame' — то, что использует QuranRu).
 *
 * Один DOM-слой свечения, ноль JS/RAF, GPU-only анимация. Имитирует
 * настоящее полярное сияние: мягкий цветной свет в верхней части
 * кадра, плавно тающий к низу. Свечение медленно дрейфует по
 * горизонтали — как будто мы летим сквозь него, и пятна аврор
 * проплывают мимо, как далёкие звёзды CosmicWarp.
 *
 * Реализация (полный режим):
 *  - Внешний div: fixed full-screen, opacity = brightness, hidden overflow.
 *  - Внутренний div: width 200%, шесть радиальных эллипсов у верхнего
 *    края (на 11/29/43% и 61/79/93% — два одинаковых сета) + общий
 *    вертикальный фейд сверху вниз. Composite background, ОДИН DOM-узел.
 *    Размеры эллипсов в `vw/vh`, чтобы при 200% ширине внутреннего div
 *    пятна не раздувались — каждое примерно 55vw × 90vh.
 *  - Анимация: `transform: translateX(0 → -50%)`, 90s linear infinite.
 *    Seamless loop: после смещения на −50% правый сет пятен оказывается
 *    в исходных позициях левого сета (22/58/86% viewport), шва нет.
 *  - Обычное alpha-наложение, БЕЗ `mix-blend-mode`. Раньше использовался
 *    `screen` для аддитивного эффекта на чёрном фоне (звёзды просвечивали
 *    через ядра авроры). Убран ради скролла: `mix-blend-mode` на
 *    `position: fixed` заставлял браузер пересчитывать blend на каждом
 *    scroll-кадре, прокрутка лагала. Визуальная потеря: в зонах ярких
 *    ядер авроры (alpha до 0.55) звёзды приглушаются; пятна мягкие,
 *    эффект едва заметен.
 *  - `transform` + `will-change: transform` идут в compositor → 0 мс
 *    main-thread на быстрых устройствах.
 *
 * Reduced-motion / слабая сеть (см. shouldReduceAurora):
 *  - `prefers-reduced-motion: reduce` ИЛИ `navigator.connection.saveData`
 *    ИЛИ `effectiveType: 2g/slow-2g` → упрощённая статичная версия:
 *      • без `transform: translateX` анимации;
 *      • без `will-change: transform` (экономим compositor-слой и VRAM);
 *      • ширина 100% вместо 200% (вдвое меньше текстура в GPU);
 *      • 3 пятна вместо 6.
 *  - Это та же проверка, что у CosmicWarp — единая политика
 *    «слабый девайс / экономия трафика → статика, без анимаций».
 *  - В полном режиме слой и так уже без `mix-blend-mode`, но в
 *    упрощённом дополнительно отключаем 200% ширину и 6 пятен,
 *    чтобы текстура в GPU была вдвое легче.
 *
 * Почему именно horizontal drift, а не radial-warp как у звёзд:
 *  - Звёзды летят НА камеру (z уменьшается), их видимая позиция
 *    радиально расходится от точки схождения.
 *  - Аврор «висит над нами» в небе. При полёте вперёд он не
 *    приближается, а проплывает мимо. Естественное движение —
 *    горизонтальный дрифт (как ветер шевелит занавес сияния),
 *    а не радиальная вытяжка.
 *
 * История решений:
 *  - V1: 2 анимированных слоя `radial-gradient`, облетающих viewport
 *    по 4 углам. Дёргалось, не давало ощущения сияния.
 *  - V2: статические warp-стримеры через `repeating-conic-gradient`,
 *    радиально из центра. Перекликалось со звёздами, но выглядело
 *    как «солнечные лучи», не как полярное сияние.
 *  - V3: статика, свечение сверху из 3 радиальных пятен.
 *  - V4: добавлен медленный горизонтальный дрифт.
 *  - V5: добавлен fallback на reduced-motion / saveData / 2g —
 *    статичный упрощённый рендер для слабых устройств и медленных сетей.
 *  - V6 (сейчас): убран `mix-blend-mode: screen`. Скролл страницы вызывал
 *    repaint blend'а на каждом кадре (даже с обёрткой `isolation: isolate`
 *    в App.tsx это не во всех браузерах кэшировалось). Сейчас обычное
 *    alpha-наложение — нулевая стоимость на скролл.
 *  - `speed` в Props оставлен deprecated — App.tsx всё ещё его
 *    передаёт, ползунок есть в профиле. Чтобы не ломать вызов
 *    и не править весь pipeline, проп просто игнорируется.
 *
 * Параметры:
 *  - Яркость (opacity контейнера)
 *  - Направление ('top' / 'bottom' / 'frame')
 *  Палитра больше не выбирается — в QuranRu «Аврора» это одна тема с
 *  фиксированным ледяным свечением (AURORA_ICE в lib/cosmic.ts), а не
 *  конструктор из шести палитр, как было в прежнем QuranIng.
 */

import { memo, useEffect, useState } from 'react';
import { AURORA_ICE, type AuroraDirection, type AuroraPaletteSpec } from '../lib/cosmic';

type Props = {
  brightness?: number;         // 0.1 – 1.0
  speed?: number;              // deprecated — дрифт фиксирован, не используется
  direction?: AuroraDirection; // 'top' (по умолч.) | 'bottom' | 'frame' | 'center'
  /** Палитра свечения.  По умолчанию ледяная — та, что у «Авроры». */
  palette?: AuroraPaletteSpec;
};

// Заменяет alpha в строке rgba(r,g,b,a) на новое значение.
// Палитра в unlocks.ts хранит готовые rgba-строки без color-mix(),
// потому что color-mix() ломается на iOS Safari < 16.4.
function withAlpha(rgba: string, alpha: number): string {
  return rgba.replace(/[\d.]+\)$/, `${alpha})`);
}

// Должна ли аврора рендериться в упрощённом статичном виде?
// Та же логика, что в CosmicWarp.tsx → prefersReducedMotion():
// либо пользовательская настройка ОС, либо медленная сеть / saveData
// (сигнал «бюджетное устройство / экономия трафика»).
function shouldReduceAurora(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (navigator as any).connection as
    | { saveData?: boolean; effectiveType?: string }
    | undefined;
  return !!(c?.saveData || c?.effectiveType === '2g' || c?.effectiveType === 'slow-2g');
}

// Стили внешнего контейнера авроры. Применяются во всех 3 режимах.
//
// Контейнер уже сидит внутри изолированной космической группы App.tsx
// (там `isolation: isolate` + `contain: paint` + `translateZ(0)`), но
// дополнительно изолируем САМ слой авроры:
//   • contain: 'layout paint style' — браузер знает, что layout/paint/
//     style внутри слоя независимы от страницы. Не трогаем `size`,
//     потому что размер задан `inset: 0` (требует доступа к размеру
//     родителя). Изменение содержимого страницы (новые карточки,
//     раскрытие аккордеонов) не повлечёт repaint авроры.
//   • transform: translateZ(0) — форсирует отдельный compositor-слой
//     даже без `will-change`. Текстура слоя растеризуется один раз
//     и хранится в VRAM; скролл / свайп просто двигают viewport
//     поверх неё без обращения к main-thread.
//   • backfaceVisibility: 'hidden' — старый трюк для iOS Safari
//     гарантирует промоцию слоя на устройствах, которые игнорируют
//     `translateZ(0)` (старые WebKit на iOS 12-13 ещё встречаются).
const AURORA_CONTAINER_STYLE_BASE = {
  contain: 'layout paint style',
  transform: 'translateZ(0)',
  backfaceVisibility: 'hidden',
} as const;

// Стили внутреннего div'а с тяжёлым background (6-10 radial-gradient).
// Тоже промоцируем в свой слой: при любом ре-рендере родителя
// (например, изменение brightness — opacity на внешнем контейнере)
// растеризованная текстура градиентов остаётся закэшированной,
// браузер не пересчитывает gradient.
const AURORA_INNER_STYLE_BASE = {
  transform: 'translateZ(0)',
  backfaceVisibility: 'hidden',
} as const;

function AuroraImpl({
  brightness = 0.45,
  direction = 'top',
  palette,
}: Props) {
  const colors = palette ?? AURORA_ICE;

  // SSR-безопасно: на сервере — без редукции, на клиенте — детектируем
  // после монтирования (matchMedia/navigator недоступны во время SSR).
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(shouldReduceAurora());
  }, []);

  // Тона свечения: ядро (layer1) — самые яркие пятна сверху,
  // accent (layer2) — второе цветовое пятно для лёгкого
  // оттеночного перелива, halo (layer1 совсем слабый) — общий
  // фон-ореол сверху, склеивающий пятна.
  const core = withAlpha(colors.layer1, 0.55);
  const accent = withAlpha(colors.layer2, 0.45);
  const halo = withAlpha(colors.layer1, 0.18);
  const drop1 = withAlpha(colors.layer1, 0.18);
  const drop2 = withAlpha(colors.layer2, 0.14);
  const drop3 = withAlpha(colors.layer1, 0.16);
  const haloFade = withAlpha(colors.layer1, 0.06);

  // Один эллипс пятна сверху. x — позиция в % внутри слоя.
  // Размер 55vw × 90vh держит пятно одинаковым относительно viewport
  // независимо от ширины контейнера. Высота 90vh (было 75vh, +20% по
  // запросу) — свечение тянется ниже половины экрана, мягко размываясь
  // (центр у верхнего/нижнего края, видимая часть ≈ нижняя/верхняя
  // половина эллипса).
  const edgeY = direction === 'bottom' ? '100%' : '0%';
  const patch = (x: number, color: string, f: string) =>
    `radial-gradient(ellipse 55vw 90vh at ${x}% ${edgeY},
      ${color} 0%,
      ${f} 30%,
      transparent 75%)`;

  const fadeDir = direction === 'bottom' ? 'to top' : 'to bottom';
  const fade = `linear-gradient(${fadeDir},
    ${halo} 0%,
    ${haloFade} 35%,
    transparent 75%)`;

  // Frame-режим: «запотевшее стекло» — тонкая дымка прямо у самых
  // краёв экрана, быстро тает к центру. Никаких больших ядер в углах:
  // эффект как конденсат, скопившийся у рамки окна — мягкий, узкий
  // ободок цвета вдоль всех 4 краёв.
  //
  // Композиция:
  //  - 4 линейных градиента от каждого края (top/bottom/left/right),
  //    максимум насыщенности у самой кромки (color 0%),
  //    быстрое затухание (~14-20% от viewport) → transparent;
  //  - 4 малых радиальных «пятнышка» по серединам краёв для лёгкой
  //    органической неравномерности (фог не идеально ровный);
  //  - рамка очень медленно дышит, а по самой кромке проходит одна
  //    рассеянная волна. Оба движения compositor-only; reduced-motion,
  //    Save Data и медленная сеть получают эту же сцену статичной.
  // ── Занавес снизу вверх ─────────────────────────────────────────────
  //
  // Вторая «Аврора»: свет поднимается от нижней кромки, лучи доходят
  // почти до верха и там гаснут.  Настоящее полярное сияние выглядит
  // именно так — вертикальный занавес, у основания плотный, к вершине
  // растворяющийся.
  //
  // Собрано из двух вещей:
  //
  //  1. Общий подъём — линейный градиент снизу вверх.  Он задаёт саму
  //     идею «свет идёт оттуда» и не даёт лучам висеть в пустоте.
  //  2. Четыре луча — очень высокие и узкие эллипсы, привязанные
  //     центром к нижней кромке (`at X% 100%`).  Видна их верхняя
  //     половина, то есть высота эллипса и есть длина луча.  Размеры
  //     и позиции нарочно неровные: одинаковые лучи через равные
  //     промежутки читаются как забор, а не как сияние.
  //
  // Высоты 96–126vh — больше высоты экрана.  Это не опечатка: у
  // эллипса, привязанного к нижней кромке, свет гаснет задолго до
  // границы фигуры, поэтому чтобы луч дотянулся почти до верха, сам
  // эллипс должен быть выше экрана.  Первая версия с высотами 74–96vh
  // гасла на середине.
  //
  // Прозрачность у основания заметно выше, чем у вершины, но и там
  // она невелика: над лучами идёт текст, и то, что у самой кромки
  // читается как свет, посреди страницы мешало бы читать.
  if (direction === 'rays') {
    const base = withAlpha(colors.layer1, 0.30);
    const rise = withAlpha(colors.layer1, 0.14);
    const fade = withAlpha(colors.layer1, 0.05);

    // Стопы у луча растянуты почти на весь радиус.  Первая версия
    // обрывалась на `transparent 66%`, и свет гас на двух третях
    // эллипса — то есть примерно на середине экрана, до верха лучи не
    // доходили.  Теперь хвост тянется до 94 % радиуса, а сама высота
    // эллипса больше высоты экрана, поэтому видимая часть луча
    // добирается почти до верхней кромки и там истончается.
    const ray = (x: number, w: number, h: number, alpha: number, accent = false) => {
      const tone = accent ? colors.layer2 : colors.layer1;
      return `radial-gradient(ellipse ${w}vw ${h}vh at ${x}% 100%,
        ${withAlpha(tone, alpha)} 0%,
        ${withAlpha(tone, alpha * 0.62)} 22%,
        ${withAlpha(tone, alpha * 0.38)} 48%,
        ${withAlpha(tone, alpha * 0.20)} 70%,
        ${withAlpha(tone, alpha * 0.09)} 86%,
        transparent 100%)`;
    };

    return (
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
        style={{ opacity: brightness, ...AURORA_CONTAINER_STYLE_BASE }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              ${ray(20, 28, 108, 0.26)},
              ${ray(43, 22, 126, 0.21, true)},
              ${ray(66, 32, 96, 0.24)},
              ${ray(87, 24, 116, 0.18, true)},
              linear-gradient(to top,
                ${base} 0%,
                ${rise} 22%,
                ${fade} 52%,
                ${withAlpha(colors.layer1, 0.035)} 78%,
                ${withAlpha(colors.layer1, 0.018)} 92%,
                transparent 100%)
            `,
            ...AURORA_INNER_STYLE_BASE,
          }}
        />
      </div>
    );
  }

  if (direction === 'frame') {
    /*
     * Дымка должна читаться как свет за пределами экрана, не как яркая
     * LED-рамка. Насыщенность у самой кромки сохранена, но градиент
     * теперь занимает только 8–9% экрана вместо прежних 22%.
     */
    const mistStrong = withAlpha(colors.layer1, 0.55);
    const mistMid = withAlpha(colors.layer1, 0.30);
    const mistAccent = withAlpha(colors.layer2, 0.36);

    // 4 ободка по краям. Узкие — ~8% viewport — чтобы остался большой
    // прозрачный центр. Кривая stop'ов: сильное у кромки, плавный спад.
    const topMist = `linear-gradient(to bottom,
      ${mistStrong} 0%,
      ${mistMid} 2.5%,
      ${withAlpha(colors.layer1, 0.07)} 5.5%,
      transparent 9%)`;
    const bottomMist = `linear-gradient(to top,
      ${mistStrong} 0%,
      ${mistMid} 2.5%,
      ${withAlpha(colors.layer1, 0.07)} 5.5%,
      transparent 9%)`;
    const leftMist = `linear-gradient(to right,
      ${mistAccent} 0%,
      ${withAlpha(colors.layer2, 0.18)} 2.5%,
      ${withAlpha(colors.layer2, 0.055)} 5.5%,
      transparent 8%)`;
    const rightMist = `linear-gradient(to left,
      ${mistAccent} 0%,
      ${withAlpha(colors.layer2, 0.18)} 2.5%,
      ${withAlpha(colors.layer2, 0.055)} 5.5%,
      transparent 8%)`;

    // Лёгкая органическая патчёвость: маленькие радиалы на серединах
    // краёв. Очень мягкие, дают ощущение «конденсат лёг неравномерно».
    const patchEdge = (x: string, y: string, w: string, h: string, color: string) =>
      `radial-gradient(ellipse ${w} ${h} at ${x} ${y},
        ${color} 0%,
        transparent 70%)`;

    return (
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
        style={{ opacity: brightness, ...AURORA_CONTAINER_STYLE_BASE }}
      >
        <div
          className={reduced ? undefined : 'aurora-frame-breathe'}
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              ${patchEdge('35%', '0%', '25vw', '4.5vh', mistMid)},
              ${patchEdge('70%', '0%', '22vw', '4vh', mistAccent)},
              ${patchEdge('30%', '100%', '24vw', '4.5vh', mistAccent)},
              ${patchEdge('72%', '100%', '25vw', '4vh', mistMid)},
              ${patchEdge('0%', '40%', '4vw', '22vh', mistMid)},
              ${patchEdge('100%', '65%', '4vw', '22vh', mistAccent)},
              ${topMist},
              ${bottomMist},
              ${leftMist},
              ${rightMist}
            `,
            ...AURORA_INNER_STYLE_BASE,
          }}
        />
        {!reduced && (
          <div
            className="aurora-frame-wave"
            style={{
              position: 'absolute',
              left: '-11vw',
              top: '-6vh',
              width: '22vw',
              height: '12vh',
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center,
                ${mistAccent} 0%,
                ${withAlpha(colors.layer1, 0.12)} 38%,
                transparent 72%)`,
              ...AURORA_INNER_STYLE_BASE,
              willChange: 'transform, opacity',
            }}
          />
        )}
      </div>
    );
  }

  // Упрощённый режим: 3 пятна, ширина 100%, без анимации, без will-change.
  // Тот же визуальный концепт «свечение сверху», но в 2 раза меньше
  // текстура в GPU и нулевая стоимость на кадр.
  if (reduced) {
    return (
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
        style={{ opacity: brightness, ...AURORA_CONTAINER_STYLE_BASE }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              ${patch(22, core, drop1)},
              ${patch(58, accent, drop2)},
              ${patch(86, core, drop3)},
              ${fade}
            `,
            ...AURORA_INNER_STYLE_BASE,
          }}
        />
      </div>
    );
  }

  // Полный режим: дрифт-анимация, 6 пятен, бесшовный цикл.
  // @keyframes auroraDrift живут в index.css — раньше был inline <style>,
  // который React пересоздавал при каждом ре-рендере (даже с memo это
  // случается при изменении brightness/palette/direction).
  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
      style={{ opacity: brightness, ...AURORA_CONTAINER_STYLE_BASE }}
    >
      <div
        className="aurora-drift"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '200%',
          height: '100%',
          background: `
            ${patch(11, core, drop1)},
            ${patch(29, accent, drop2)},
            ${patch(43, core, drop3)},
            ${patch(61, core, drop1)},
            ${patch(79, accent, drop2)},
            ${patch(93, core, drop3)},
            ${fade}
          `,
          willChange: 'transform',
          backfaceVisibility: 'hidden',
          animation: 'auroraDrift 90s linear infinite',
        }}
      />
    </div>
  );
}

// React.memo критически важен. App.tsx слушает 'asr-cosmic-changed' /
// 'storage' и при ЛЮБОМ событии обновляет все 8 стейтов сразу (звёзды +
// аврора), что без memo вызывает ре-рендер Aurora при каждом изменении
// ЗВЁЗДНЫХ настроек. Каждый ре-рендер пересоздаёт огромную background-
// строку (200vw × 100vh, 6 radial-gradient) → React видит новый inline
// style → DOM обновляет атрибут → браузер ре-растеризует compositor-слой.
// Для слабых девайсов это самый дорогой кадр, который можно совершенно
// бесплатно избежать: brightness/palette меняются редко, а props у
// Aurora ровно эти два + speed (deprecated). memo с дефолтным shallow-
// сравнением идеально подходит.
export const Aurora = memo(AuroraImpl);
