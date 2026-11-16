/**
 * PlayerControls — части полного плеера в раскладке G1 «Михраб».
 *
 * Владелец 2026-11-16 выбрал макет G1 (`docs/design/player-redesign/
 * mihrab-G1.png`, исходник — `mihrab.html`): после серии вариантов
 * (A–D → «Пульт» D3 «Крестовина» → чтец E3 «Клавиша и список» → подачи
 * F1–F3 → доработки «Михраба» G1–G3). Главное в раскладке:
 *
 * - вся арка михраба — ОДНА кнопка «Слушать». Единственное золотое (`--brand`)
 *   пятно экрана: что нажимать, видно сразу;
 * - соседние аяты — круглые кнопки по бокам арки, с зазором, чтобы большим
 *   пальцем не задеть их вместо «Слушать»;
 * - соседние суры — две кнопки-капсулы под аркой, с подписью, какая сура;
 * - «Повтор аята» (1 · 2 · 3 · 5 · ∞) и «Повтор суры» (Стоп · Дальше ·
 *   Заново) — строки выбора, где все варианты видны сразу. Под «Повтором
 *   суры» — подсказка, что случится в конце этой суры;
 * - чтец — широкая клавиша с инициалами; тап открывает лист со всеми
 *   чтецами (вариант E3: одно касание — и звучит).
 *
 * Что куда ушло из прежнего плеера: скорость и список сур — в кнопки шапки;
 * «скачано» — подписью в клавише чтеца; кнопка загрузки — рядом с ней.
 * Так у нижней панели вкладок не осталось мелких кнопок, по которым легко
 * промахнуться.
 *
 * Цвета — только смысловые токены (`--brand`, `--on-brand`, `--ink-rgb`,
 * `--text-*`): одинаково работает во всех пяти темах.
 */

import { useId, type ReactNode } from 'react';
import { SettingsSheet } from './ReadingSettings';
import { CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Pause, Play, ICON_SIZE } from './icons';
import { RECITERS, availableSurahCount, type ReciterId } from '../lib/reciters';
import { TOTAL_SURAHS } from '../lib/ayahNumbering';

/**
 * Арка михраба — кнопка «Слушать» / «Пауза».
 *
 * Контур рисуется SVG в координатах 196×226 и растягивается под размер
 * кнопки (`preserveAspectRatio="none"`); обводка от растяжения не
 * толстеет (`vector-effect`). Зона нажатия — весь прямоугольник арки,
 * включая углы над плечами: промах мимо контура всё равно включает чтение,
 * а соседних кнопок там нет.
 *
 * Размер — от высоты экрана (`dvh`), чтобы на маленьком iPhone плеер
 * помещался без прокрутки, а на большом арка была крупной.
 */
export function MihrabButton({
  playing, loading, label, ariaLabel, onPress,
}: {
  playing: boolean;
  loading: boolean;
  /** Слово под значком: «Слушать», «Пауза», «Выбрать суру». */
  label: string;
  ariaLabel: string;
  onPress: () => void;
}) {
  const gradientId = useId();
  return (
    <button
      onClick={onPress}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className="mihrab-btn"
    >
      <svg
        aria-hidden
        viewBox="0 0 196 226"
        preserveAspectRatio="none"
        className="mihrab-shape"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="mihrab-stop-top" />
            <stop offset="0.55" className="mihrab-stop-mid" />
            <stop offset="1" className="mihrab-stop-bottom" />
          </linearGradient>
        </defs>
        <path
          d="M1 225V104C1 52 48 22 98 1c50 21 97 51 97 103v121z"
          fill={`url(#${gradientId})`}
          className="mihrab-edge"
          vectorEffect="non-scaling-stroke"
        />
        {/* Внутренняя линия — как рамка ниши в михрабе: тонко, тоном
            текста на золоте, чтобы не спорить со значком. */}
        <path
          d="M13 225V108C13 64 54 37 98 15c44 22 85 49 85 93v117"
          fill="none"
          className="mihrab-inner"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="mihrab-face">
        <span className={loading ? 'mihrab-icon is-loading' : 'mihrab-icon'}>
          {playing ? <Pause size={48} /> : <Play size={48} style={{ transform: 'translateX(2px)' }} />}
        </span>
        <span className="mihrab-label">{label}</span>
      </span>
    </button>
  );
}

/** Круглая кнопка соседнего аята (или ±10 с у чтеца без границ аятов). */
export function SideButton({
  icon, caption, ariaLabel, onPress, disabled = false,
}: {
  icon: ReactNode;
  /** Нечего листать: звука нет, а чтец без границ аятов. */
  disabled?: boolean;
  /** Подпись под кнопкой: «аят 18»; null — подписи нет (край суры). */
  caption: string | null;
  ariaLabel: string;
  onPress: () => void;
}) {
  return (
    <div className="side-btn-wrap">
      <button onClick={onPress} disabled={disabled} aria-label={ariaLabel} className="side-btn player-press">
        {icon}
      </button>
      {/* Подпись занимает место и когда её нет — кнопки не прыгают. */}
      <span aria-hidden className="side-btn-caption">{caption ?? ' '}</span>
    </div>
  );
}

/** Капсула соседней суры под аркой. `surah` null — соседней нет. */
export function SurahStepButton({
  direction, number, title, onPress,
}: {
  direction: 'prev' | 'next';
  number: number | null;
  title: string | null;
  onPress: () => void;
}) {
  const none = number == null || title == null;
  const label = direction === 'prev' ? 'Предыдущая сура' : 'Следующая сура';
  return (
    <button
      onClick={onPress}
      disabled={none}
      aria-label={none ? `${label}: нет` : `${label}: ${number}, ${title}`}
      className="surah-step player-press"
      data-direction={direction}
    >
      {direction === 'prev' && <ChevronLeft size={ICON_SIZE.sm} />}
      {!none && (
        direction === 'prev'
          ? <><span className="surah-step-num">{number}</span><span className="surah-step-title">{title}</span></>
          : <><span className="surah-step-title">{title}</span><span className="surah-step-num">{number}</span></>
      )}
      {direction === 'next' && <ChevronRight size={ICON_SIZE.sm} />}
    </button>
  );
}

export type ChoiceOption<T extends string> = {
  id: T;
  label: string;
  /** Полная подпись для VoiceOver/TalkBack. */
  ariaLabel: string;
  icon?: ReactNode;
};

/**
 * Строка выбора («сегменты»): все варианты видны сразу, выбранный выделен.
 *
 * Для «Повтора аята» выбранный — золотой (`tone="brand"`): это режим
 * заучивания, и он должен бросаться в глаза. Для «Повтора суры» —
 * нейтральный: «Дальше» стоит по умолчанию, и золото там звало бы туда, где
 * ничего не включено.
 *
 * Стрелки клавиатуры двигают выбор, как у системного radiogroup.
 */
export function ChoiceRow<T extends string>({
  label, icon, options, value, onChange, tone = 'neutral', hint,
}: {
  label: string;
  icon: ReactNode;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (id: T) => void;
  tone?: 'brand' | 'neutral';
  hint?: string;
}) {
  const labelId = useId();
  const hintId = useId();
  const move = (delta: number) => {
    const at = options.findIndex(o => o.id === value);
    const next = options[(at + delta + options.length) % options.length];
    onChange(next.id);
    // Фокус — за выбором, как у нативных радиокнопок.
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-choice="${labelId}:${next.id}"]`)?.focus();
    });
  };
  return (
    <div className="choice">
      <div id={labelId} className="choice-label">
        <span aria-hidden className="choice-label-icon">{icon}</span>
        {label}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        className="choice-track"
        data-tone={tone}
        onKeyDown={e => {
          const at = options.findIndex(o => o.id === value);
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
          else if (e.key === 'Home') { e.preventDefault(); move(-at); }
          else if (e.key === 'End') { e.preventDefault(); move(options.length - 1 - at); }
        }}
      >
        {options.map(o => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={on}
              aria-label={o.ariaLabel}
              tabIndex={on ? 0 : -1}
              data-choice={`${labelId}:${o.id}`}
              onClick={() => onChange(o.id)}
              className="choice-opt"
            >
              {o.icon && <span aria-hidden className="choice-opt-icon">{o.icon}</span>}
              <span aria-hidden>{o.label}</span>
            </button>
          );
        })}
      </div>
      {hint && <p id={hintId} className="choice-hint">{hint}</p>}
    </div>
  );
}

/** Инициалы чтеца для кружка: «Ясир Ад-Даусари» → «ЯД». Приставка
 *  артикля (Аль-, Ад-, Аш-…) пропускается: «Ахмад Аль-Аджми» → «АА». */
export function reciterInitials(label: string): string {
  const words = label.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const letter = (w: string) => w.replace(/^А[а-яё]{1,2}-/, '').charAt(0).toUpperCase();
  return words.length === 1 ? letter(words[0]) : letter(words[0]) + letter(words[words.length - 1]);
}

function surahWord(n: number): string {
  const two = n % 100, one = n % 10;
  if (two >= 11 && two <= 14) return 'сур';
  if (one === 1) return 'сура';
  if (one >= 2 && one <= 4) return 'суры';
  return 'сур';
}

/** «Махмуд Халиль Аль-Хусари (обучение)» → имя и пометка отдельно. */
function splitReciterNote(label: string): { name: string; note: string | null } {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(label);
  return m ? { name: m[1], note: m[2] } : { name: label, note: null };
}

/** Сколько сур есть у чтеца — подпись в листе. */
function reciterCoverage(id: ReciterId): string {
  const n = availableSurahCount(id);
  return n < TOTAL_SURAHS ? `${n} ${surahWord(n)} из ${TOTAL_SURAHS}` : `все ${TOTAL_SURAHS} сур`;
}

/**
 * Клавиша чтеца (вариант E3): широкая, с инициалами и именем. Тап — лист со
 * всеми чтецами. `downloaded` — сура этого чтеца скачана: пишем это в
 * подписи, отдельная кнопка «Скачано» больше не нужна.
 */
export function ReciterKey({
  name, initials, downloaded, open, onOpen,
}: {
  name: string;
  initials: string;
  downloaded: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Чтец: ${name}${downloaded ? ', сура скачана' : ''}. Выбрать другого`}
      className="reciter-key player-title-btn"
    >
      <span aria-hidden className="reciter-mono" data-on="true">{initials}</span>
      <span className="reciter-key-text">
        <span className="reciter-key-cap">
          Чтец
          {downloaded && <>
            {' · '}
            <span className="reciter-key-done"><CheckCircle size={12} /></span>
            {' скачано'}
          </>}
        </span>
        <span className="reciter-key-name">{name}</span>
      </span>
      <span aria-hidden className="reciter-key-chevron"><ChevronDown size={ICON_SIZE.sm} /></span>
    </button>
  );
}

/** Лист выбора чтеца: одно касание — и звучит этот чтец. */
export function ReciterSheet({
  current, onPick, onClose,
}: {
  current: ReciterId;
  onPick: (id: ReciterId) => void;
  onClose: () => void;
}) {
  return (
    <SettingsSheet title="Чтец" onClose={onClose}>
      {/* Стрелки двигают фокус по строкам (одна строка в порядке Tab —
          выбранная), а выбор — касанием или Enter/пробелом: стрелка не
          должна сразу переключать чтеца и звук. */}
      <div
        role="radiogroup"
        aria-label="Чтец"
        className="reciter-list"
        onKeyDown={e => {
          const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.reciter-row')];
          const at = rows.indexOf(document.activeElement as HTMLButtonElement);
          const go = (i: number) => { e.preventDefault(); rows[(i + rows.length) % rows.length]?.focus(); };
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(at + 1);
          else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(at - 1);
          else if (e.key === 'Home') go(0);
          else if (e.key === 'End') go(rows.length - 1);
        }}
      >
        {RECITERS.map(r => {
          const on = r.id === current;
          return (
            <button
              key={r.id}
              role="radio"
              aria-checked={on}
              aria-label={`${r.label}, ${reciterCoverage(r.id)}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onPick(r.id)}
              className="reciter-row"
              data-on={on || undefined}
            >
              <span aria-hidden className="reciter-mono" data-on={on || undefined}>{reciterInitials(r.label)}</span>
              <span className="reciter-row-text">
                {/* Пометка в скобках («обучение») — в подпись: иначе длинное
                    имя обрезается многоточием как раз на ней. */}
                <span className="reciter-row-name">{splitReciterNote(r.label).name}</span>
                <span className="reciter-row-detail">
                  {[splitReciterNote(r.label).note, reciterCoverage(r.id)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {on && <span aria-hidden className="reciter-row-check"><CheckCircle size={ICON_SIZE.md} /></span>}
            </button>
          );
        })}
      </div>
    </SettingsSheet>
  );
}
