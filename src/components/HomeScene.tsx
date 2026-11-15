/**
 * HomeScene — иллюстрация над списком сур на главной.
 *
 * Владелец 15.11.2026: «не хватает сверху картинки, иллюстрации — весь текст,
 * всё скучно». Прежде (04.10.2026) там была обложка-фото ковров с затемнением
 * и подзаголовками — снята как «слишком много всего». Поэтому здесь не фото,
 * а спокойная векторная сцена без текста: ингушские боевые башни на склоне
 * под горным хребтом. Это знак места, для которого сделано приложение, и он
 * не спорит с текстом Корана ниже — в сцене нет ни одной буквы.
 *
 * ── Почему вектор и токены ────────────────────────────────────────────
 *
 * Все цвета — переменные `--scene-*` из src/index.css: светлые темы
 * получают утро в тонах ковра, тёмные — ночь с месяцем, звёздами и тёплым
 * светом в бойницах. Солнце и облака гасятся `--scene-day`, месяц и звёзды —
 * `--scene-night`, поэтому один и тот же SVG без ветвлений в коде работает во
 * всех пяти темах. Вектор весит ~3 КБ и одинаково чёткий на любом экране.
 *
 * ── Движение ──────────────────────────────────────────────────────────
 *
 * Звёзды мерцают, облака медленно дрейфуют — только `opacity` и `transform`
 * (классы `.scene-star`, `.scene-cloud`), при «Уменьшении движения» всё стоит.
 *
 * Башни нарисованы по форме ингушской боевой башни: высокий сужающийся ствол,
 * машикули (выступы-балкончики) под верхом и ступенчатая пирамидальная
 * кровля с остроконечным камнем на вершине. Рядом — жилая башня с плоской
 * кровлей, как в башенных комплексах (Вовнушки, Эгикал).
 */

import { useId } from 'react';

/** Боевая башня: ствол-трапеция, машикули, ступенчатая кровля, шпиль. */
function battleTower(cx: number, baseY: number, h: number, wb: number, wt: number, steps = 7): string {
  const top = baseY - h;
  const parts: string[] = [];
  // Ствол слегка сужается кверху.
  parts.push(`M${cx - wb / 2},${baseY} L${cx - wt / 2},${top} L${cx + wt / 2},${top} L${cx + wb / 2},${baseY} Z`);
  // Машикули — выступы по обе стороны чуть ниже верха.
  const mY = top + 3.5;
  parts.push(`M${cx - wt / 2 - 2},${mY} h2.2 v4.6 h-2.2 Z`);
  parts.push(`M${cx + wt / 2 - 0.2},${mY} h2.2 v4.6 h-2.2 Z`);
  // Ступенчатая кровля: каждая ступень уже предыдущей.
  const stepH = 2.4;
  // Кровля чуть шире ствола и сходится к острию: ступени уменьшаются до трети.
  const roofBase = wt + 2.2;
  for (let i = 0; i < steps; i++) {
    const w = roofBase * (1 - (i / steps) * 0.72);
    const y = top - (i + 1) * stepH;
    parts.push(`M${cx - w / 2},${y + stepH + 0.2} L${cx - w / 2},${y} L${cx + w / 2},${y} L${cx + w / 2},${y + stepH + 0.2} Z`);
  }
  // Остроконечный камень на вершине.
  const peakBase = top - steps * stepH;
  parts.push(`M${cx - 1.4},${peakBase + 0.2} L${cx},${peakBase - 3.4} L${cx + 1.4},${peakBase + 0.2} Z`);
  return parts.join(' ');
}

/** Жилая башня: ниже и шире, плоская кровля с небольшим парапетом. */
function dwellingTower(cx: number, baseY: number, h: number, w: number): string {
  const top = baseY - h;
  return [
    `M${cx - w / 2},${baseY} L${cx - w / 2 + 0.8},${top} L${cx + w / 2 - 0.8},${top} L${cx + w / 2},${baseY} Z`,
    `M${cx - w / 2 + 0.2},${top + 0.4} L${cx - w / 2 + 0.2},${top - 2} L${cx + w / 2 - 0.2},${top - 2} L${cx + w / 2 - 0.2},${top + 0.4} Z`,
  ].join(' ');
}

/** Звёзды: координаты подобраны вручную — пустое небо над хребтом. */
const STARS: readonly (readonly [number, number, number])[] = [
  [24, 22, 0.9], [58, 38, 0.6], [96, 18, 1.1], [132, 34, 0.7], [168, 14, 0.8],
  [196, 40, 0.6], [214, 22, 1.0], [312, 20, 0.8], [338, 42, 0.6], [242, 58, 0.5],
  [150, 52, 0.5], [40, 58, 0.5], [118, 60, 0.4], [326, 64, 0.5],
];

/** Свет в бойницах башен ночью: [x, y, ширина, высота]. */
const WINDOWS: readonly (readonly [number, number, number, number])[] = [
  [71.1, 70, 1.8, 3.4], [71.1, 86, 2, 3.6],
  [102.1, 84, 1.8, 3.2], [121, 100, 2.2, 3], [127.6, 100, 2.2, 3],
];

export function HomeScene() {
  const id = useId().replace(/:/g, '');
  const sky = `${id}-sky`, glow = `${id}-glow`, snowClip = `${id}-snow`, moon = `${id}-moon`;
  const far = 'M0,96 L30,72 L52,84 L86,52 L116,80 L150,62 L186,86 L226,48 L262,78 L300,58 L336,82 L360,70 L360,150 L0,150 Z';

  return (
    <div
      aria-hidden
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--radius-card)',
        aspectRatio: '360 / 132',
        marginBottom: 'var(--space-section)',
        // Своя плоскость отрисовки: мерцание звёзд не перерисовывает экран.
        contain: 'paint',
        isolation: 'isolate',
      }}
    >
      <svg
        viewBox="0 12 360 132"
        preserveAspectRatio="xMidYMid slice"
        width="100%"
        height="100%"
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--scene-sky-top)' }} />
            <stop offset="1" style={{ stopColor: 'var(--scene-sky-bottom)' }} />
          </linearGradient>
          <radialGradient id={glow} cx="272" cy="44" r="120" gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: 'var(--scene-glow)', stopOpacity: 0.95 }} />
            <stop offset="1" style={{ stopColor: 'var(--scene-glow)', stopOpacity: 0 }} />
          </radialGradient>
          <clipPath id={snowClip}>
            <rect x="0" y="0" width="360" height="63" />
          </clipPath>
          {/* Месяц — круг, из которого вычтен смещённый круг. */}
          <mask id={moon}>
            <circle cx="272" cy="42" r="11" fill="#fff" />
            <circle cx="277.5" cy="38.5" r="10" fill="#000" />
          </mask>
        </defs>

        <rect x="0" y="0" width="360" height="150" fill={`url(#${sky})`} />
        <rect x="0" y="0" width="360" height="150" fill={`url(#${glow})`} />

        {/* День: солнце и облака. */}
        <g style={{ opacity: 'var(--scene-day)' }}>
          <circle cx="272" cy="44" r="17" style={{ fill: 'var(--scene-sun)' }} />
          <g className="scene-cloud" style={{ fill: 'var(--scene-snow)', opacity: 0.75 }}>
            <ellipse cx="74" cy="40" rx="26" ry="5.5" />
            <ellipse cx="88" cy="36" rx="14" ry="5" />
            <ellipse cx="196" cy="28" rx="20" ry="4" />
            <ellipse cx="206" cy="25" rx="10" ry="3.6" />
          </g>
        </g>

        {/* Ночь: месяц и звёзды. */}
        <g style={{ opacity: 'var(--scene-night)' }}>
          <rect x="240" y="10" width="64" height="64" mask={`url(#${moon})`} style={{ fill: 'var(--scene-sun)' }} />
          {STARS.map(([x, y, r], i) => (
            <circle
              key={i}
              className="scene-star"
              cx={x} cy={y} r={r}
              style={{ fill: 'var(--scene-sun)', animationDelay: `${(i * -0.73) % 3.6}s` }}
            />
          ))}
        </g>

        {/* Дальний хребет со снежными вершинами. */}
        <path d={far} style={{ fill: 'var(--scene-far)' }} />
        <path d={far} clipPath={`url(#${snowClip})`} style={{ fill: 'var(--scene-snow)' }} />

        {/* Средний хребет. */}
        <path
          d="M0,114 L38,94 L70,102 L112,84 L160,104 L204,90 L252,108 L300,90 L340,102 L360,96 L360,150 L0,150 Z"
          style={{ fill: 'var(--scene-mid)' }}
        />

        {/* Башенный комплекс на ближнем склоне. */}
        <path
          d={[
            battleTower(72, 112, 50, 14.5, 11),
            battleTower(103, 114, 38, 12.5, 9.5, 6),
            dwellingTower(125, 116, 22, 19),
          ].join(' ')}
          style={{ fill: 'var(--scene-tower)' }}
        />
        <g style={{ opacity: 'var(--scene-night)' }}>
          {WINDOWS.map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} rx="0.5" style={{ fill: 'var(--scene-window)' }} />
          ))}
        </g>

        {/* Ближний склон — закрывает основания башен. */}
        <path
          d="M0,150 L0,120 C30,110 70,104 112,107 C160,111 212,126 268,124 C306,122 336,116 360,118 L360,150 Z"
          style={{ fill: 'var(--scene-near)' }}
        />
      </svg>
    </div>
  );
}
