/**
 * PrayerTimesScreen — готовые расписания Назрани или расчёт для одного города.
 *
 * Считается офлайн (см. lib/prayerTimes.ts), список городов и их
 * настройки живут в lib/prayerCities.ts.
 *
 * «Назрань 1» и «Назрань 2» не зависят от города: это точные таблицы.
 * Город появляется только в третьем режиме «Расчёт», причём активен
 * всегда один — никакой карусели и скрытого смахивания между местами.
 *
 * ── Что на главной, а что за дверью ───────────────────────────────────
 *
 * На главной только то, зачем экран открывают: ближайший намаз и день
 * списком.  Метод расчёта убран отсюда по решению владельца — он
 * настраивается раз в жизни, а место на экране занимал каждый день.
 * Теперь он внутри города, в панели «Города»: настройка стоит рядом с
 * тем, к чему относится, и заодно перестаёт выглядеть общей для всех.
 *
 * ── Что показывает день ───────────────────────────────────────────────
 *
 * Прошедшие намазы приглушены, наступивший подсвечен, будущие обычные.
 * Раньше выделялся только следующий, и по списку нельзя было понять, где
 * ты в сутках — приходилось сверять с часами. Полоса под карточкой
 * показывает, сколько прошло от предыдущего намаза до следующего:
 * «через 2 ч 42 мин» отвечает «когда», полоса — «много ли осталось».
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Appearance, Bell, ChevronRight, Clock, Close, Compass, ICON_SIZE, Plus, Trash,
} from '../components/icons';
import { ThemeSettings } from '../components/ReadingSettings';
import { LargeTitleHeader } from '../components/ScreenHeader';
import type { Theme } from '../hooks/useTheme';
import {
  CITIES, locate, LOCATE_ERROR_TEXT, type LocateError,
} from '../lib/location';
import {
  addCity, moveCity, onCitiesChange, readActiveId, readCities,
  removeCity, setActiveId, updateCitySettings, MAX_CITIES,
  type PrayerCity,
} from '../lib/prayerCities';
import {
  METHODS, MADHAB_LABELS, PRAYER_LABELS, PRAYER_ORDER, IS_PRAYER,
  formatLeft, formatTime, hasTimetableDate, isTimetableSource,
  methodById, nextPrayer, timesFor,
  type DayTimes, type Madhab, type MethodId, type PrayerSettings,
  type PrayerTimeSource,
} from '../lib/prayerTimes';
import {
  readPrimaryPrayerSource,
  writePrimaryPrayerSource,
} from '../lib/prayerPreferences';
import {
  PRAYER_ALARM_KEYS,
  onPrayerAlarmsChange,
  readPrayerAlarms,
  requestExactPrayerAlarms,
  requestPrayerAlarmPermission,
  syncPrayerAlarms,
  writePrayerAlarms,
  type PrayerAlarmKey,
  type PrayerAlarmSyncStatus,
} from '../lib/prayerNotifications';
import { TIMETABLE_META } from '../content/nazranPrayerTimetables';
import { HitArea } from '../components/HitArea';

type Props = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Открыть киблу.  Она перестала быть вкладкой: её открывают редко, а
   *  вход логичнее там, где человек уже думает о молитве. */
  onOpenQibla: () => void;
  /** Намаз перестал быть вкладкой 07.09.2026 и открывается пушем — значит
   *  нужен возврат. Крупный заголовок сохранён: экран остаётся «своим». */
  onBack?: () => void;
};

export function PrayerTimesScreen({ theme, setTheme, onBack, onOpenQibla }: Props) {
  const [cities, setCities] = useState<PrayerCity[]>(readPrayerScreenCities);
  const [activeId, setActive] = useState<string>(() => readActiveId());
  const [primarySource, setPrimarySource] = useState(readPrimaryPrayerSource);
  const [themeOpen, setThemeOpen] = useState(false);
  const [citiesOpen, setCitiesOpen] = useState(false);
  const [alarms, setAlarms] = useState(readPrayerAlarms);
  const [alarmBusy, setAlarmBusy] = useState<PrayerAlarmKey | null>(null);
  const [alarmStatus, setAlarmStatus] = useState<PrayerAlarmSyncStatus | null>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => onCitiesChange(() => {
    const list = readCities();
    setCities(list);
    setActive(readActiveId(list));
  }), []);
  useEffect(() => onPrayerAlarmsChange(() => setAlarms(readPrayerAlarms())), []);

  // Первый кадр уже использует основное расписание (см.
  // readPrayerScreenCities), а здесь закрепляем его в настройках активного
  // города. Это важно и для фонового планировщика уведомлений.
  useEffect(() => {
    const list = readCities();
    const id = readActiveId(list);
    const active = list.find(item => item.id === id);
    if (active && active.settings.source !== primarySource) {
      updateCitySettings(id, { ...active.settings, source: primarySource });
    }
  }, []);

  // Минутный тик: обратный отсчёт идёт сам, без перезахода на экран.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const index = Math.max(0, cities.findIndex(c => c.id === activeId));
  const city = cities[index] ?? cities[0];
  const timetable = isTimetableSource(city.settings.source);
  // Колокольчики принадлежат не временному просмотру, а только источнику,
  // который человек явно назначил основным. Сам планировщик ниже всё равно
  // принудительно использует primarySource; этот флаг не даёт интерфейсу
  // создавать ложное впечатление, будто будильник относится к открытому
  // для сравнения расписанию.
  const viewingPrimarySource = city.settings.source === primarySource;
  const missingTimetableDate = timetable && !hasTimetableDate(city.settings.source, now);

  const times = useMemo(() => timesFor(city, now, city.settings), [city, now]);
  const next  = useMemo(() => nextPrayer(city, now, city.settings), [city, now]);
  const prevAt = useMemo(() => previousPrayerAt(city, times, now), [city, times, now]);

  // Любая смена основного расписания, метода, города или отдельного
  // колокольчика пересоздаёт только наши будущие уведомления. Старые времена
  // не остаются висеть в очереди устройства.
  useEffect(() => {
    let cancelled = false;
    void syncPrayerAlarms(city, alarms).then(result => {
      if (!cancelled) setAlarmStatus(result.status);
    });
    return () => { cancelled = true; };
  }, [city, primarySource, alarms]);

  const toggleAlarm = async (key: PrayerAlarmKey) => {
    if (alarmBusy) return;
    const enabling = !alarms[key];
    setAlarmBusy(key);
    try {
      if (enabling) {
        const permission = await requestPrayerAlarmPermission();
        if (permission !== 'scheduled') {
          setAlarmStatus(permission);
          return;
        }
      }

      const nextAlarms = { ...alarms, [key]: enabling };
      // Сохраняем до перехода в системные настройки точных будильников:
      // Android может перезапустить приложение после изменения разрешения.
      writePrayerAlarms(nextAlarms);
      setAlarms(nextAlarms);

      if (enabling) await requestExactPrayerAlarms();
      const result = await syncPrayerAlarms(city, nextAlarms);
      setAlarmStatus(result.status);
    } finally {
      setAlarmBusy(null);
    }
  };

  const span = next.at.getTime() - prevAt;
  const progress = span > 0
    ? Math.min(1, Math.max(0, (now.getTime() - prevAt) / span))
    : 0;

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: 'min(100%, 720px)',
      margin: '0 auto',
      // Экран «поверх» (кнопка «Намаз» на главной): нижнего меню здесь нет.
      padding: `0 var(--space-margin) calc(var(--space-section) + var(--mini-player-space, 0px) + env(safe-area-inset-bottom))`,
      position: 'relative',
      zIndex: 1,
    }}>
      {themeOpen && (
        <ThemeSettings
          theme={theme} setTheme={setTheme}
          onClose={() => setThemeOpen(false)}
          anchorEl={themeBtnRef.current}
        />
      )}

      <LargeTitleHeader
        title="Намаз"
        onBack={onBack}
        bottomGap="var(--space-snug)"
        actions={[
          {
            key: 'qibla', label: 'Кибла', title: 'Кибла — направление на Каабу',
            icon: <Compass size={ICON_SIZE.md} />,
            onClick: onOpenQibla,
          },
          {
            key: 'theme', label: 'Оформление', ref: themeBtnRef, active: themeOpen,
            icon: <Appearance size={ICON_SIZE.md} />,
            onClick: () => setThemeOpen(v => !v),
          },
        ]}
      />

      <div style={{ paddingTop: 'var(--space-cozy)' }}>
        <SourcePicker
          value={city.settings.source}
          primary={primarySource}
          onChange={source => {
            setCitiesOpen(false);
            updateCitySettings(city.id, { ...city.settings, source });
          }}
          onMakePrimary={() => {
            writePrimaryPrayerSource(city.settings.source);
            setPrimarySource(city.settings.source);
          }}
        />

        {city.settings.source === 'calculated' && (
          <CalculationCityButton city={city} onClick={() => setCitiesOpen(true)} />
        )}

        {missingTimetableDate && (
          <p role="status" style={{
            margin: '0 var(--space-hair) var(--space-cozy)',
            padding: 'var(--space-snug) var(--space-cozy)',
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--hairline-strong)',
            background: 'rgb(var(--ink-rgb) / 0.06)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
          }}>
            В исходном расписании «{sourceLabel(city.settings.source)}» нет
            этой даты. Сегодня показан расчёт по методу города.
          </p>
        )}

        <NextPrayerCard next={next} now={now} progress={progress} />

        <section style={{ marginTop: 'var(--space-margin)' }}>
          {PRAYER_ORDER.map(key => {
            const at = times[key].getTime();
            const isNext = IS_PRAYER[key] && key === next.key && !next.tomorrow;
            // «Идёт сейчас» — последний наступивший намаз. Именно он
            // отвечает на вопрос «какой намаз сейчас», а не следующий.
            const current = IS_PRAYER[key] && at <= now.getTime() && at === prevAt;
            return (
              <TimeRow
                key={key}
                label={PRAYER_LABELS[key]}
                time={formatTime(times[key])}
                isNext={isNext}
                isCurrent={current}
                past={at <= now.getTime() && !current}
                muted={!IS_PRAYER[key]}
                adjust={timetable ? 0 : city.settings.adjustments[key]}
                alarmEnabled={IS_PRAYER[key] && viewingPrimarySource
                  ? alarms[key as PrayerAlarmKey]
                  : false}
                alarmBusy={alarmBusy === key}
                onToggleAlarm={IS_PRAYER[key] && viewingPrimarySource
                  ? () => void toggleAlarm(key as PrayerAlarmKey)
                  : null}
              />
            );
          })}
        </section>

        <AlarmStatus
          status={alarmStatus}
          enabledCount={PRAYER_ALARM_KEYS.filter(key => alarms[key]).length}
          primaryLabel={sourceLabel(primarySource)}
        />
      </div>

      {!timetable && (
        <p style={{
          margin: 'var(--space-section) var(--space-tight) 0',
          fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
          color: 'var(--text-tertiary)',
        }}>
          <span style={{
            display: 'inline-flex', verticalAlign: '-3px',
            marginRight: 'var(--space-tight)',
          }}>
            <Clock size={ICON_SIZE.sm} />
          </span>
          Время считается на устройстве по координатам, без интернета. Сверьтесь с расписанием своей мечети: если оно расходится хотя бы на минуту — выставьте разницу в настройках города.
        </p>
      )}

      {citiesOpen && (
        <CitiesSheet
          cities={cities}
          activeId={city.id}
          now={now}
          onPick={id => {
            const picked = cities.find(item => item.id === id);
            if (picked) updateCitySettings(id, { ...picked.settings, source: 'calculated' });
            setActiveId(id);
            setCitiesOpen(false);
          }}
          onClose={() => setCitiesOpen(false)}
        />
      )}
    </div>
  );
}

const SOURCE_OPTIONS: readonly { id: PrayerTimeSource; label: string }[] = [
  { id: 'nazran-1', label: 'Назрань 1' },
  { id: 'nazran-2', label: 'Назрань 2' },
  { id: 'calculated', label: 'Расчёт' },
];

function sourceLabel(source: PrayerTimeSource): string {
  return isTimetableSource(source) ? TIMETABLE_META[source].label : 'Расчёт';
}

function CalculationCityButton({ city, onClick }: { city: PrayerCity; onClick: () => void }) {
  return (
    <section style={{ margin: 'calc(-1 * var(--space-hair)) 0 var(--space-cozy)' }}>
      <p style={{
        margin: '0 0 var(--space-snug) var(--space-hair)',
        fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
      }}>
        Город для расчёта
      </p>
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="dialog"
        aria-label={`Выбрать город для расчёта. Сейчас ${city.name}`}
        style={{
          width: '100%', minHeight: '48px',
          padding: '0 var(--space-cozy) 0 var(--space-margin)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
          borderRadius: 'var(--radius-control)', border: '1px solid var(--hairline)',
          background: 'rgb(var(--ink-rgb) / 0.04)',
          color: 'var(--text-primary)', fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{
          flex: 1, textAlign: 'left',
          fontSize: 'var(--font-subhead)', fontWeight: 'var(--weight-semibold)',
        }}>
          {city.name}
        </span>
        <span aria-hidden style={{
          display: 'inline-flex', color: 'var(--text-tertiary)', transform: 'rotate(90deg)',
        }}>
          <ChevronRight size={ICON_SIZE.sm} />
        </span>
      </button>
    </section>
  );
}

function SourcePicker({ value, primary, onChange, onMakePrimary }: {
  value: PrayerTimeSource;
  primary: PrayerTimeSource;
  onChange: (source: PrayerTimeSource) => void;
  onMakePrimary: () => void;
}) {
  const isPrimary = value === primary;
  return (
    <section aria-label="Источник времени намаза" style={{ marginBottom: 'var(--space-cozy)' }}>
      <p style={{
        margin: '0 0 var(--space-snug) var(--space-hair)',
        fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
      }}>
        Расписание
      </p>
      {/* Обойма и её сегменты держат концентричную геометрию: внешний
          радиус карточки минус собственное поле обоймы даёт ровно радиус
          контрола, поэтому углы вложены без «ступеньки». */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-tight)',
        padding: 'var(--space-tight)', borderRadius: 'var(--radius-card)',
        border: '1px solid var(--hairline)',
        background: 'rgb(var(--ink-rgb) / 0.04)',
      }}>
        {SOURCE_OPTIONS.map(option => {
          const on = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              aria-label={`${option.label}${primary === option.id ? ', основное расписание' : ''}`}
              onClick={() => onChange(option.id)}
              style={{
                minWidth: 0, minHeight: '38px', padding: 'var(--space-snug)',
                borderRadius: 'var(--radius-control)',
                border: `1px solid ${on ? 'var(--hairline-strong)' : 'transparent'}`,
                background: on ? 'var(--surface)' : 'transparent',
                boxShadow: on ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontFamily: 'inherit', fontSize: 'var(--font-footnote)',
                fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span>{option.label}</span>
              {primary === option.id && (
                <span aria-hidden style={{
                  display: 'inline-block', width: '4px', height: '4px',
                  marginLeft: 'var(--space-tight)', verticalAlign: '3px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'currentColor', opacity: 0.72,
                }} />
              )}
            </button>
          );
        })}
      </div>
      <div style={{
        minHeight: '30px', marginTop: 'var(--space-tight)', padding: '0 var(--space-hair)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      }}>
        {isPrimary ? (
          <span role="status" style={{
            fontSize: 'var(--font-caption1)', color: 'var(--text-tertiary)',
          }}>
            Основное расписание
          </span>
        ) : (
          <button
            type="button"
            onClick={onMakePrimary}
            style={{
              minHeight: '30px', padding: '0 var(--space-cozy)',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--hairline)', background: 'transparent',
              color: 'var(--text-secondary)', fontFamily: 'inherit',
              fontSize: 'var(--font-caption1)', fontWeight: 'var(--weight-regular)',
              cursor: 'pointer',
            }}
          >
            Сделать основным
          </button>
        )}
      </div>
    </section>
  );
}

function readPrayerScreenCities(): PrayerCity[] {
  const list = readCities();
  const activeId = readActiveId(list);
  const primary = readPrimaryPrayerSource();
  return list.map(city => city.id === activeId
    ? { ...city, settings: { ...city.settings, source: primary } }
    : city);
}

/**
 * Последний наступивший намаз, в миллисекундах.
 *
 * Нужен и полосе прогресса, и подсветке «идёт сейчас».  До фаджра
 * предыдущим считается вчерашняя иша — иначе ночью полоса считалась бы
 * от начала суток и всегда стояла почти полной.
 */
function previousPrayerAt(city: PrayerCity, times: DayTimes, now: Date): number {
  const t = now.getTime();
  let best = -Infinity;
  for (const key of PRAYER_ORDER) {
    if (!IS_PRAYER[key]) continue;
    const at = times[key].getTime();
    if (at <= t && at > best) best = at;
  }
  if (best !== -Infinity) return best;
  const yesterday = new Date(t - 24 * 60 * 60 * 1000);
  return timesFor(city, yesterday, city.settings).isha.getTime();
}

/**
 * Ближайший намаз крупно.
 *
 * Полоса внизу — доля пройденного от предыдущего намаза до следующего.
 * Она отвечает на то, чего не отвечает текст: «много ли осталось».
 * Тонкая и без цвета: это фон, а не индикатор загрузки.
 */
function NextPrayerCard({ next, now, progress }: {
  next: { key: keyof typeof PRAYER_LABELS; at: Date; tomorrow: boolean };
  now: Date;
  progress: number;
}) {
  return (
    <section style={{
      position: 'relative',
      overflow: 'hidden',
      padding: 'var(--space-margin)',
      borderRadius: 'var(--radius-card)',
      border: '1px solid var(--hairline)',
      background: `
        radial-gradient(120% 140% at 100% 0%,
          rgb(var(--ink-rgb) / 0.05) 0%,
          transparent 62%),
        var(--surface)
      `,
    }}>
      <div style={{
        fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--text-tertiary)',
      }}>
        {next.tomorrow ? 'Следующий — завтра' : 'Следующий намаз'}
      </div>

      <div style={{
        marginTop: 'var(--space-snug)',
        display: 'flex', alignItems: 'baseline', gap: 'var(--space-cozy)', flexWrap: 'wrap',
      }}>
        {/* Имя намаза — единственный намеренно крупный текст экрана.
            Кегль остаётся плавающим, но его границы теперь ступени шкалы;
            межстрочный при этом обязан остаться долей от кегля. */}
        <span className="display-serif" style={{
          fontSize: 'clamp(var(--font-title1), 8.5vw, var(--font-largetitle))',
          fontWeight: 'var(--weight-regular)',
          letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.1,
        }}>
          {PRAYER_LABELS[next.key]}
        </span>
        <span style={{
          fontSize: 'var(--font-title2)', fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
          letterSpacing: 'var(--tracking-tight)',
        }}>
          {formatTime(next.at)}
        </span>
      </div>

      <div style={{
        marginTop: 'var(--space-snug)', fontSize: 'var(--font-footnote)',
        color: 'var(--text-secondary)',
      }}>
        через {formatLeft(next.at.getTime() - now.getTime())}
      </div>

      <div
        aria-hidden
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: '3px',
          background: 'rgb(var(--ink-rgb) / 0.07)',
        }}
      >
        <div style={{
          width: `${(progress * 100).toFixed(1)}%`, height: '100%',
          background: 'rgb(var(--ink-rgb) / 0.34)',
          transition: 'width 0.6s ease',
        }} />
      </div>
    </section>
  );
}

function TimeRow({
  label, time, isNext, isCurrent, past, muted, adjust,
  alarmEnabled, alarmBusy, onToggleAlarm,
}: {
  label: string; time: string;
  isNext: boolean; isCurrent: boolean; past: boolean; muted: boolean;
  adjust: number;
  alarmEnabled: boolean;
  alarmBusy: boolean;
  onToggleAlarm: (() => void) | null;
}) {
  const strong = isNext || isCurrent;
  const colour = muted || past
    ? 'var(--text-tertiary)'
    : 'var(--text-primary)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
      minHeight: '50px', padding: 'var(--space-snug) var(--space-cozy)',
      borderRadius: 'var(--radius-control)',
      marginBottom: 'var(--space-hair)',
      background: strong ? 'rgb(var(--ink-rgb) / 0.06)' : 'transparent',
      border: `1px solid ${isNext ? 'var(--hairline-strong)' : 'transparent'}`,
      opacity: past && !isCurrent ? 0.62 : 1,
      transition:
        'opacity var(--dur-slow) var(--ease-standard),'
        + ' background var(--dur-slow) var(--ease-standard)',
    }}>
      {/* Метка «сейчас» вместо второго цвета: цвет уже занят под
          «прошло / не прошло», и третий оттенок не читался бы. */}
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 'var(--font-subhead)',
        fontWeight: strong ? 'var(--weight-semibold)' : 'var(--weight-regular)',
        color: colour,
      }}>
        {label}
        {isCurrent && (
          <span style={{
            marginLeft: 'var(--space-snug)', fontSize: 'var(--font-caption2)',
            fontWeight: 'var(--weight-semibold)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
          }}>
            идёт
          </span>
        )}
        {adjust !== 0 && (
          <span style={{
            marginLeft: 'var(--space-snug)', fontSize: 'var(--font-caption2)',
            color: 'var(--text-tertiary)',
          }}>
            {adjust > 0 ? `+${adjust}` : adjust} мин
          </span>
        )}
      </span>
      <span style={{
        fontSize: 'var(--font-callout)',
        fontWeight: strong ? 'var(--weight-semibold)' : 'var(--weight-regular)',
        color: colour,
        fontVariantNumeric: 'tabular-nums', letterSpacing: 'var(--tracking-tight)',
      }}>
        {time}
      </span>
      {onToggleAlarm && (
        <button
          type="button"
          onClick={onToggleAlarm}
          disabled={alarmBusy}
          aria-pressed={alarmEnabled}
          aria-label={`${alarmEnabled ? 'Выключить' : 'Включить'} напоминание: ${label}`}
          title={`${alarmEnabled ? 'Выключить' : 'Включить'} напоминание`}
          style={{
            position: 'relative',
            width: '34px', height: '34px',
            marginRight: 'calc(-1 * var(--space-tight))', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'var(--radius-pill)',
            border: `1px solid ${alarmEnabled ? 'var(--hairline-strong)' : 'transparent'}`,
            background: alarmEnabled
              ? 'rgb(var(--ink-rgb) / 0.08)'
              : 'transparent',
            color: alarmEnabled ? 'var(--text-primary)' : 'var(--text-tertiary)',
            cursor: alarmBusy ? 'wait' : 'pointer',
            opacity: alarmBusy ? 0.5 : 1,
            transition:
              'background var(--dur-base) var(--ease-standard),'
              + ' color var(--dur-base) var(--ease-standard),'
              + ' opacity var(--dur-base) var(--ease-standard)',
          }}
        >
          <Bell size={ICON_SIZE.sm} isFilled={alarmEnabled} />
          <HitArea />
        </button>
      )}
    </div>
  );
}

function AlarmStatus({ status, enabledCount, primaryLabel }: {
  status: PrayerAlarmSyncStatus | null;
  enabledCount: number;
  primaryLabel: string;
}) {
  if (enabledCount === 0 && status !== 'permission-denied'
    && status !== 'unsupported' && status !== 'error') return null;

  const text = status === 'permission-denied'
    ? 'Разрешите уведомления в настройках устройства, чтобы включить напоминания.'
    : status === 'exact-alarm-denied'
      ? 'Напоминания включены, но Android не разрешил точные будильники. Разрешите их в системных настройках Quran Ing.'
      : status === 'unsupported'
        ? 'Этот браузер не поддерживает уведомления. На iPhone и Android напоминания работают в фоне.'
        : status === 'error'
          ? 'Не удалось обновить напоминания. Нажмите колокольчик ещё раз.'
          : `Включено напоминаний: ${enabledCount}. Время берётся из основного расписания «${primaryLabel}».`;

  return (
    <p role="status" style={{
      margin: 'var(--space-snug) var(--space-tight) 0',
      fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
      color: 'var(--text-tertiary)',
    }}>
      {text}
    </p>
  );
}

/**
 * Панель городов.
 *
 * Три вещи в одном месте, потому что все три про «мои города»: выбрать,
 * настроить и упорядочить.  Настройки конкретного города раскрываются
 * внутри его строки — так видно, чему они принадлежат.
 *
 * Режим правки отдельной кнопкой, а не постоянными стрелками у каждой
 * строки: в обычном состоянии список читают, а не перекладывают, и
 * шесть кнопок на строке этому мешают.
 */
function CitiesSheet({ cities, activeId, now, onPick, onClose }: {
  cities: PrayerCity[];
  activeId: string;
  now: Date;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const editing = false;
  const [adding, setAdding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCity = cities.find(city => city.id === activeId);

  const onLocate = async () => {
    setError(null);
    setLocating(true);
    try {
      const p = await locate();
      const id = addCity(p);
      const picked = readCities().find(city => city.id === id);
      if (picked) updateCitySettings(id, { ...picked.settings, source: 'calculated' });
      setAdding(false);
      onClose();
    } catch (e) {
      setError(LOCATE_ERROR_TEXT[e as LocateError] ?? 'Не удалось определить местоположение.');
    } finally {
      setLocating(false);
    }
  };

  const title = adding ? 'Выберите город' : 'Город для расчёта';

  /*
   * Портал в body, а не рендер на месте.
   *
   * Экран задаёт `position: relative; z-index: 1` и тем самым создаёт
   * контекст наложения: внутри него `z-index: 45` листа ничего не
   * значит против таб-бара, который лежит снаружи с z-index 40.  Лист
   * уезжал под панель вкладок — поймано на симуляторе.
   */
  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 60,
          background: 'rgba(0,0,0,0.45)',
          animation: 'fade-in var(--dur-base) var(--ease-standard)',
        }}
      />
      <div
        role="dialog"
        aria-label="Город для расчёта"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61,
          maxHeight: '82vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface)',
          borderTopLeftRadius: 'var(--radius-shell)',
          borderTopRightRadius: 'var(--radius-shell)',
          borderTop: '1px solid var(--hairline)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.32)',
          animation: 'sheet-up var(--dur-slow) var(--ease-panel)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
          padding: 'var(--space-margin) var(--space-margin) var(--space-cozy)',
          borderBottom: '1px solid var(--hairline)',
        }}>
          <h2 className="display-serif" style={{
            margin: 0, flex: 1, minWidth: 0,
            fontSize: 'var(--font-title2)', lineHeight: 'var(--leading-title2)',
            fontWeight: 'var(--weight-regular)', letterSpacing: '-0.015em',
            color: 'var(--text-primary)',
          }}>
            {title}
          </h2>

          <button
            onClick={() => (adding ? setAdding(false) : onClose())}
            aria-label="Закрыть"
            className="icon-btn"
            style={{
              position: 'relative',
              width: '34px', height: '34px', flexShrink: 0,
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--hairline)', background: 'transparent',
              color: 'var(--text-secondary)',
            }}
          >
            <Close size={ICON_SIZE.sm} />
            <HitArea />
          </button>
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, WebkitOverflowScrolling: 'touch' }}>
          {!adding && (
            <>
              {cities.map((c, i) => (
                <CityRow
                  key={c.id}
                  city={c}
                  now={now}
                  active={c.id === activeId}
                  editing={editing}
                  first={i === 0}
                  last={i === cities.length - 1}
                  onlyOne={cities.length <= 1}
                  tuning={false}
                  onPick={() => onPick(c.id)}
                  onTune={() => {}}
                  onMove={d => moveCity(c.id, d)}
                  onRemove={() => removeCity(c.id)}
                />
              ))}

              <button
                onClick={() => { setAdding(true); setError(null); }}
                disabled={cities.length >= MAX_CITIES}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 'var(--space-snug)',
                  width: '100%', minHeight: '54px',
                  border: 'none', borderTop: '1px solid var(--hairline)',
                  background: 'transparent',
                  color: cities.length >= MAX_CITIES
                    ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  fontFamily: 'inherit', fontSize: 'var(--font-subhead)',
                  fontWeight: 'var(--weight-regular)',
                  cursor: cities.length >= MAX_CITIES ? 'default' : 'pointer',
                }}
              >
                <Plus size={ICON_SIZE.sm} />
                {cities.length >= MAX_CITIES
                  ? `Максимум ${MAX_CITIES} городов`
                  : 'Добавить город'}
              </button>

              {activeCity && (
                <div style={{ borderTop: '1px solid var(--hairline)' }}>
                  <p style={{
                    margin: 'var(--space-margin) var(--space-margin) 0',
                    fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: 'var(--text-tertiary)',
                  }}>
                    Настройки расчёта · {activeCity.name}
                  </p>
                  <CitySettings city={activeCity} />
                </div>
              )}
            </>
          )}

          {adding && (
            <div style={{
              padding: 'var(--space-cozy) var(--space-margin) var(--space-margin)',
            }}>
              <button
                onClick={onLocate}
                disabled={locating}
                style={{
                  width: '100%', minHeight: '48px',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--hairline)',
                  background: 'rgb(var(--ink-rgb) / 0.05)',
                  color: 'var(--text-primary)', cursor: locating ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: 'var(--font-subhead)',
                  fontWeight: 'var(--weight-regular)',
                  marginBottom: 'var(--space-cozy)',
                }}
              >
                {locating ? 'Определяю…' : 'Определить моё место'}
              </button>

              {error && (
                <p style={{
                  margin: '0 0 var(--space-cozy)',
                  fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
                  color: 'var(--text-secondary)',
                }}>
                  {error}
                </p>
              )}

              <p style={{
                margin: '0 0 var(--space-snug) var(--space-hair)',
                fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
              }}>
                Из списка
              </p>
              <div style={{
                border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)',
                overflow: 'hidden',
              }}>
                {CITIES.map((c, i) => {
                  const already = cities.some(x => x.name === c.name);
                  return (
                    <button
                      key={c.name}
                      disabled={already}
                      onClick={() => {
                        const id = addCity({ ...c, source: 'manual' });
                        const picked = readCities().find(city => city.id === id);
                        if (picked) updateCitySettings(id, { ...picked.settings, source: 'calculated' });
                        setAdding(false);
                        onClose();
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', minHeight: '46px',
                        padding: 'var(--space-snug) var(--space-cozy)',
                        border: 'none',
                        borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                        background: 'transparent',
                        color: already ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        textAlign: 'left', fontFamily: 'inherit',
                        fontSize: 'var(--font-subhead)',
                        cursor: already ? 'default' : 'pointer',
                      }}
                    >
                      <span>{c.name}</span>
                      {already && (
                        <span style={{ fontSize: 'var(--font-caption1)' }}>добавлен</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {/* Домашний индикатор: без запаса последняя строка списка
            оказывается прямо под ним и её не нажать. */}
        <div style={{ height: 'env(safe-area-inset-bottom)', flexShrink: 0 }} />
      </div>
    </>,
    document.body,
  );
}

function CityRow({
  city, now, active, editing, first, last, onlyOne, tuning,
  onPick, onTune, onMove, onRemove,
}: {
  city: PrayerCity;
  now: Date;
  active: boolean;
  editing: boolean;
  first: boolean;
  last: boolean;
  onlyOne: boolean;
  tuning: boolean;
  onPick: () => void;
  onTune: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const n = nextPrayer(city, now, city.settings);
  const method = methodById(city.settings.method);
  const tweaks = PRAYER_ORDER.filter(k => city.settings.adjustments[k] !== 0).length;
  const timetable = isTimetableSource(city.settings.source);

  return (
    <div style={{ borderTop: first ? 'none' : '1px solid var(--hairline)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
        padding: 'var(--space-snug) var(--space-cozy) var(--space-snug) var(--space-margin)',
        background: active ? 'rgb(var(--ink-rgb) / 0.05)' : 'transparent',
      }}>
        {editing && (
          <span style={{
            display: 'inline-flex', gap: 'var(--space-cozy)', flexShrink: 0,
            marginRight: 'var(--space-tight)',
          }}>
            <Mini label="Выше" disabled={first} onClick={() => onMove(-1)}>↑</Mini>
            <Mini label="Ниже" disabled={last} onClick={() => onMove(1)}>↓</Mini>
          </span>
        )}

        <button
          onClick={editing ? onTune : onPick}
          style={{
            flex: 1, minWidth: 0, display: 'block', textAlign: 'left',
            border: 'none', background: 'transparent', padding: 'var(--space-tight) 0',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <span style={{
            display: 'block',
            fontSize: 'var(--font-subhead)',
            fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {city.name}
          </span>
          <span style={{
            display: 'block', marginTop: 'var(--space-hair)',
            fontSize: 'var(--font-caption1)', color: 'var(--text-tertiary)',
          }}>
            {/* В обычном режиме — время, в правке — что настроено:
                это два разных вопроса, и оба нужны в своём режиме. */}
            {editing
              ? timetable
                ? `Готовое расписание · ${sourceLabel(city.settings.source)}`
                : `${method.label}${tweaks > 0 ? ` · поправок ${tweaks}` : ''}`
              : `${PRAYER_LABELS[n.key]} ${formatTime(n.at)}`}
          </span>
        </button>

        {editing ? (
          <>
            <button
              onClick={onTune}
              aria-label={`Настроить ${city.name}`}
              style={{
                minHeight: 'var(--hit-min)', padding: '0 var(--space-cozy)',
                borderRadius: 'var(--radius-pill)',
                border: `1px solid ${tuning ? 'var(--text-primary)' : 'var(--hairline)'}`,
                background: tuning ? 'rgb(var(--ink-rgb) / 0.08)' : 'transparent',
                color: 'var(--text-primary)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 'var(--font-footnote)', flexShrink: 0,
              }}
            >
              Настроить
            </button>
            <Mini label={`Удалить ${city.name}`} disabled={onlyOne} onClick={onRemove}>
              <Trash size={ICON_SIZE.sm} />
            </Mini>
          </>
        ) : (
          <span style={{
            display: 'inline-flex', color: 'var(--text-tertiary)', flexShrink: 0,
            paddingRight: 'var(--space-tight)',
          }}>
            <ChevronRight size={ICON_SIZE.sm} />
          </span>
        )}
      </div>

      {tuning && <CitySettings city={city} />}
    </div>
  );
}

/** Настройки конкретного города — источник, метод, мазхаб, поправки. */
function CitySettings({ city }: { city: PrayerCity }) {
  const method = methodById(city.settings.method);
  const update = (patch: Partial<PrayerSettings>) =>
    updateCitySettings(city.id, { ...city.settings, ...patch });

  return (
    <div style={{
      padding: 'var(--space-tight) var(--space-margin) var(--space-margin)',
      display: 'grid', gap: 'var(--space-margin)',
      background: 'rgb(var(--ink-rgb) / 0.03)',
    }}>
      {city.settings.source === 'calculated' ? (
        <>
      <div>
        <p style={groupTitle}>Углы фаджра и иши</p>
        <div style={{ display: 'grid', gap: 'var(--space-snug)' }}>
          {METHODS.map(m => {
            const on = city.settings.method === m.id;
            return (
              <button
                key={m.id}
                onClick={() => update({ method: m.id as MethodId })}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 'var(--space-snug)', minHeight: 'var(--hit-min)',
                  padding: 'var(--space-snug) var(--space-cozy)',
                  borderRadius: 'var(--radius-control)',
                  border: `1px solid ${on ? 'var(--text-primary)' : 'var(--hairline)'}`,
                  background: on ? 'rgb(var(--ink-rgb) / 0.07)' : 'transparent',
                  color: 'var(--text-primary)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 'var(--font-footnote)', textAlign: 'left',
                }}
              >
                <span>{m.label}</span>
                <span style={{
                  fontSize: 'var(--font-caption1)', color: 'var(--text-tertiary)',
                  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                  {m.fajr}° / {'angle' in m.isha ? `${m.isha.angle}°` : `${m.isha.minutes} мин`}
                </span>
              </button>
            );
          })}
        </div>
        <p style={hint}>{method.source}.</p>
        {method.caution && (
          <p style={{ ...hint, color: 'var(--text-secondary)' }}>{method.caution}</p>
        )}
      </div>

      <div>
        <p style={groupTitle}>Аср</p>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-snug)',
        }}>
          {(['shafi', 'hanafi'] as Madhab[]).map(m => {
            const on = city.settings.madhab === m;
            return (
              <button
                key={m}
                onClick={() => update({ madhab: m })}
                style={{
                  minHeight: 'var(--hit-min)', borderRadius: 'var(--radius-control)',
                  border: `1px solid ${on ? 'var(--text-primary)' : 'var(--hairline)'}`,
                  background: on ? 'rgb(var(--ink-rgb) / 0.07)' : 'transparent',
                  color: 'var(--text-primary)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 'var(--font-footnote)',
                }}
              >
                {MADHAB_LABELS[m]}
              </button>
            );
          })}
        </div>
        <p style={hint}>У ханафитов аср наступает позже — разница доходит до часа.</p>
      </div>

      <div>
        <p style={groupTitle}>Поправка, минуты</p>
        <div style={{ display: 'grid', gap: 'var(--space-tight)' }}>
          {PRAYER_ORDER.map(key => (
            <AdjustRow
              key={key}
              label={PRAYER_LABELS[key]}
              value={city.settings.adjustments[key]}
              onChange={v => update({
                adjustments: { ...city.settings.adjustments, [key]: v },
              })}
            />
          ))}
        </div>
        <p style={hint}>
          Если расписание вашей мечети отличается на пару минут — выставьте
          разницу здесь, она запомнится для этого города.
        </p>
      </div>
        </>
      ) : (
        <div style={{
          padding: 'var(--space-cozy)', borderRadius: 'var(--radius-control)',
          border: '1px solid var(--hairline)',
          color: 'var(--text-secondary)',
          fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
        }}>
          Используется «{sourceLabel(city.settings.source)}». Углы, мазхаб
          и ручные поправки не изменяют готовую таблицу. Вернитесь к «Расчёту»,
          чтобы снова использовать их.
        </div>
      )}
    </div>
  );
}

function Mini({ children, onClick, disabled, label }: {
  children: React.ReactNode; onClick: () => void; disabled: boolean; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        position: 'relative',
        width: '32px', height: '32px', borderRadius: 'var(--radius-control)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--hairline)', background: 'transparent',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        fontFamily: 'inherit', fontSize: 'var(--font-footnote)', lineHeight: 1,
        flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
      <HitArea />
    </button>
  );
}


const groupTitle: React.CSSProperties = {
  margin: 'var(--space-cozy) 0 var(--space-snug)',
  fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--text-tertiary)',
};

const hint: React.CSSProperties = {
  margin: 'var(--space-snug) 0 0',
  fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
  color: 'var(--text-tertiary)',
};

function AdjustRow({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  const step = (d: number) => onChange(Math.max(-60, Math.min(60, value + d)));
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 'var(--space-snug)', minHeight: 'var(--hit-min)',
    }}>
      <span style={{ fontSize: 'var(--font-footnote)', color: 'var(--text-primary)' }}>
        {label}
      </span>
      {/* Зазор между шаговыми кнопками — ступень «поле панели», а не
          «между контролами»: их расширенные до 44 зоны касания при
          меньшем зазоре наложились бы друг на друга, и край «минуса»
          отдавал бы нажатие «плюсу». */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-cozy)' }}>
        <StepButton onClick={() => step(-1)} label={`${label}: минус минута`}>−</StepButton>
        <span style={{
          minWidth: '46px', textAlign: 'center',
          fontSize: 'var(--font-footnote)', fontVariantNumeric: 'tabular-nums',
          color: value === 0 ? 'var(--text-tertiary)' : 'var(--text-primary)',
        }}>
          {value > 0 ? `+${value}` : value}
        </span>
        <StepButton onClick={() => step(1)} label={`${label}: плюс минута`}>+</StepButton>
      </span>
    </div>
  );
}

function StepButton({ children, onClick, label }: {
  children: React.ReactNode; onClick: () => void; label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        position: 'relative',
        width: '34px', height: '34px',
        borderRadius: 'var(--radius-control)',
        border: '1px solid var(--hairline)',
        background: 'rgb(var(--ink-rgb) / 0.04)',
        color: 'var(--text-primary)', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 'var(--font-callout)', lineHeight: 1,
      }}
    >
      {children}
      <HitArea />
    </button>
  );
}
