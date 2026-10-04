/**
 * QiblaScreen — направление на Каабу.
 *
 * Азимут считает библиотека adhan (`Qibla`) — та же, что и время
 * намаза.  Своя формула большого круга уместилась бы в пять строк, но
 * это ровно тот случай, когда пять строк проверенного кода лучше пяти
 * своих: ошибка тут не падает, а тихо показывает не туда.
 *
 * ── Что показываем без компаса ────────────────────────────────────────
 *
 * Компас есть не у всех: в браузере на десктопе его нет вовсе, на iOS
 * он требует разрешения, на части Android-устройств магнитометра просто
 * не стоит.  Поэтому экран осмыслен и без него: азимут в градусах и
 * расстояние до Мекки видны всегда, а стрелка добавляется сверху, если
 * датчик доступен.  «Разрешите доступ, иначе тут ничего» — плохой
 * экран.
 *
 * ── Про истинный и магнитный север ────────────────────────────────────
 *
 * Азимут киблы отсчитывается от ИСТИННОГО севера, а магнитометр
 * показывает магнитный — разница (склонение) в Ингушетии около +7°, в
 * других местах доходит до десятков градусов.
 *
 * На iOS `webkitCompassHeading` уже приведён к истинному северу самой
 * системой — это её задокументированное поведение, и поправка не
 * нужна.  На Android `deviceorientationabsolute` даёт магнитный курс,
 * и честной поправки без модели геомагнитного поля (WMM) у нас нет.
 * Поэтому там стрелка помечена как приблизительная — врать точностью
 * хуже, чем признать её отсутствие.  Модель WMM — отдельная задача,
 * это таблица коэффициентов и своя арифметика.
 */

import { useEffect, useRef, useState } from 'react';
import * as adhan from 'adhan';
import { Compass, Appearance, ICON_SIZE } from '../components/icons';
import { ThemeSettings } from '../components/ReadingSettings';
import { LargeTitleHeader } from '../components/ScreenHeader';
import type { Theme } from '../hooks/useTheme';
import {
  CITIES, KAABA, distanceKm, locate, onPlaceChange, readPlace, writePlace,
  LOCATE_ERROR_TEXT, type LocateError, type Place,
} from '../lib/location';

type Props = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Кибла перестала быть вкладкой: теперь она открывается с экрана
   *  намаза, и ей нужен выход назад. */
  onBack: () => void;
};

/** Курс устройства: 0 = север, растёт по часовой. */
type Heading = { deg: number; trueNorth: boolean } | null;

export function QiblaScreen({ theme, setTheme, onBack }: Props) {
  const [place, setPlace] = useState<Place>(readPlace);
  const [themeOpen, setThemeOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heading, setHeading] = useState<Heading>(null);
  const [compassAsked, setCompassAsked] = useState(false);
  const themeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => onPlaceChange(() => setPlace(readPlace())), []);

  const qibla = adhan.Qibla(new adhan.Coordinates(place.lat, place.lon));
  const distance = distanceKm(place, KAABA);
  // У самой Каабы направление вырождается: расстояние ноль, а азимут
  // между двумя совпадающими точками — произвольное число.  Показывать
  // такую стрелку нельзя, она выглядит как ошибка (и, по сути, ею и
  // является).  Порог 2 км, а не ноль: координаты города — точка в
  // центре, и человек в Заповедной мечети попадёт под тот же случай.
  const atKaaba = distance < 2;

  // Куда повернуть стрелку: если курс известен — на разницу между
  // киблой и текущим направлением телефона, иначе просто на азимут
  // (север сверху).
  const arrowDeg = heading ? qibla - heading.deg : qibla;

  const onLocate = async () => {
    setError(null);
    setLocating(true);
    try {
      const p = await locate();
      writePlace(p);
      setPlace(p);
    } catch (e) {
      setError(LOCATE_ERROR_TEXT[e as LocateError] ?? 'Не удалось определить местоположение.');
    } finally {
      setLocating(false);
    }
  };

  // Компас.  Подписка ставится только по нажатию: на iOS разрешение
  // спрашивается исключительно из пользовательского жеста, а на
  // остальных платформах постоянно висящий слушатель магнитометра
  // расходует батарею на экране, куда заглядывают на десять секунд.
  const enableCompass = async () => {
    setCompassAsked(true);
    setError(null);
    type OrientationCtor = typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const Ctor = (window as unknown as { DeviceOrientationEvent?: OrientationCtor })
      .DeviceOrientationEvent;
    if (!Ctor) {
      setError('На этом устройстве нет компаса. Азимут ниже можно отложить по обычному компасу.');
      return;
    }
    if (typeof Ctor.requestPermission === 'function') {
      try {
        const res = await Ctor.requestPermission();
        if (res !== 'granted') {
          setError('Доступ к компасу запрещён. Разрешить можно в настройках Safari.');
          return;
        }
      } catch {
        setError('Не удалось запросить доступ к компасу.');
        return;
      }
    }

    const onOrient = (e: DeviceOrientationEvent) => {
      // iOS: webkitCompassHeading уже относительно истинного севера.
      const webkit = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkit === 'number' && !Number.isNaN(webkit)) {
        setHeading({ deg: webkit, trueNorth: true });
        return;
      }
      // Остальные: alpha отсчитывается против часовой от севера.
      if (typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
        setHeading({ deg: 360 - e.alpha, trueNorth: false });
      }
    };
    window.addEventListener('deviceorientationabsolute', onOrient as EventListener);
    window.addEventListener('deviceorientation', onOrient as EventListener);
  };

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: 'min(100%, 720px)',
      margin: '0 auto',
      padding: '0 var(--space-margin) calc(var(--space-section) + env(safe-area-inset-bottom))',
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {themeOpen && (
        <ThemeSettings
          theme={theme} setTheme={setTheme}
          onClose={() => setThemeOpen(false)}
          anchorEl={themeBtnRef.current}
        />
      )}

      <LargeTitleHeader
        title="Кибла"
        onBack={onBack}
        actions={[{
          key: 'theme', label: 'Оформление', ref: themeBtnRef, active: themeOpen,
          icon: <Appearance size={ICON_SIZE.md} />,
          onClick: () => setThemeOpen(v => !v),
        }]}
      />

      {/* Круг компаса */}
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-section)', paddingBottom: 'var(--space-cozy)',
      }}>
        <div style={{
          position: 'relative',
          width: 'min(74vw, 300px)',
          aspectRatio: '1',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--hairline)',
          background: 'rgb(var(--ink-rgb) / 0.03)',
          display: 'grid', placeItems: 'center',
        }}>
          {/* Отметки сторон света */}
          {[['С', 0], ['В', 90], ['Ю', 180], ['З', 270]].map(([label, deg]) => (
            <span
              key={label as string}
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid', placeItems: 'start center',
                paddingTop: 'var(--space-snug)',
                transform: `rotate(${(deg as number) - (heading?.deg ?? 0)}deg)`,
                transition: 'transform var(--dur-base) linear',
                fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)',
                letterSpacing: '0.08em',
                color: label === 'С' ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              }}
            >
              <span style={{ transform: `rotate(${-((deg as number) - (heading?.deg ?? 0))}deg)` }}>
                {label as string}
              </span>
            </span>
          ))}

          {/* Стрелка на киблу */}
          {!atKaaba && <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: '14%',
              transform: `rotate(${arrowDeg}deg)`,
              transition: 'transform var(--dur-base) linear',
              display: 'grid', placeItems: 'start center',
            }}
          >
            {/* Стрелка на киблу — не иконка интерфейса, а декоративная
                графика компаса: она обязана тянуться на всю высоту
                розы ветров, поэтому остаётся в своей вытянутой системе
                координат 42×200, а не в сетке 24×24 общего набора.
                С набором её роднит вес: древко доведено до той же
                толщины 1.75, что и штрих иконок, и получает те же
                круглые окончания.  Наконечник залит по правилу
                «метка-указатель»: контурный наконечник на этом размере
                не показывает направление, ради которого он и нужен. */}
            <svg width="42" height="100%" viewBox="0 0 42 200" fill="none" aria-hidden>
              <path d="M21 4 L33 40 L21 33 L9 40 Z" fill="currentColor" />
              <line
                x1="21" y1="33" x2="21" y2="150"
                stroke="currentColor" strokeWidth="1.75"
                strokeLinecap="round" opacity="0.35"
              />
            </svg>
          </span>}

          <div style={{
            textAlign: 'center', position: 'relative', padding: '0 var(--space-margin)',
          }}>
            {atKaaba ? (
              <div style={{
                fontSize: 'var(--font-body)', fontWeight: 'var(--weight-regular)',
                lineHeight: 'var(--leading-body)',
                color: 'var(--text-primary)',
              }}>
                Вы у Каабы
              </div>
            ) : (
              <>
                {/* Азимут — главная цифра экрана: ступень Large Title.
                    Межстрочный тут единица намеренно, как у крупных
                    одинарных чисел в плеере: парная ступень 41px увела бы
                    цифру вниз от центра розы ветров. */}
                <div style={{
                  fontSize: 'var(--font-largetitle)', fontWeight: 'var(--weight-semibold)',
                  color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums', lineHeight: 1,
                }}>
                  {qibla.toFixed(0)}°
                </div>
                <div style={{
                  marginTop: 'var(--space-snug)', fontSize: 'var(--font-caption1)',
                  color: 'var(--text-tertiary)',
                }}>
                  от севера
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-footnote)', color: 'var(--text-secondary)' }}>
            {atKaaba
              ? place.name
              : `${place.name} · до Мекки ${distance.toLocaleString('ru-RU')} км`}
          </div>
          {heading && !heading.trueNorth && (
            <div style={{
              marginTop: 'var(--space-snug)', fontSize: 'var(--font-caption1)',
              lineHeight: 'var(--leading-caption1)', color: 'var(--text-tertiary)',
            }}>
              Стрелка приблизительная: датчик показывает магнитный север,
              поправка на склонение не учтена.
            </div>
          )}
          {!heading && compassAsked && !error && (
            <div style={{
              marginTop: 'var(--space-snug)', fontSize: 'var(--font-caption1)',
              color: 'var(--text-tertiary)',
            }}>
              Жду данные компаса…
            </div>
          )}
        </div>
      </div>

      {error && (
        <p style={{
          margin: '0 0 var(--space-cozy)', padding: 'var(--space-cozy)',
          borderRadius: 'var(--radius-control)',
          background: 'rgb(var(--ink-rgb) / 0.05)',
          border: '1px solid var(--hairline)',
          fontSize: 'var(--font-caption1)', lineHeight: 'var(--leading-caption1)',
          color: 'var(--text-secondary)',
        }}>
          {error}
        </p>
      )}

      {/* Действия */}
      <div style={{ display: 'grid', gap: 'var(--space-snug)' }}>
        {!heading && (
          <ActionButton onClick={enableCompass} primary>
            Включить компас
          </ActionButton>
        )}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-snug)',
        }}>
          <ActionButton onClick={onLocate} disabled={locating}>
            {locating ? 'Определяю…' : 'Моё место'}
          </ActionButton>
          <ActionButton onClick={() => setPicking(v => !v)} active={picking}>
            Выбрать город
          </ActionButton>
        </div>
      </div>

      {picking && (
        <div style={{
          marginTop: 'var(--space-snug)',
          maxHeight: '38vh', overflowY: 'auto',
          border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)',
          background: 'var(--surface)',
        }}>
          {CITIES.map(c => (
            <button
              key={c.name}
              onClick={() => {
                writePlace({ ...c, source: 'manual' });
                setPlace({ ...c, source: 'manual' });
                setPicking(false);
                setError(null);
              }}
              style={{
                display: 'flex', width: '100%', minHeight: '46px',
                alignItems: 'center', justifyContent: 'space-between',
                padding: 'var(--space-snug) var(--space-cozy)',
                border: 'none',
                borderBottom: '1px solid var(--hairline-soft, var(--hairline))',
                background: place.name === c.name
                  ? 'rgb(var(--ink-rgb) / 0.06)'
                  : 'transparent',
                color: 'var(--text-primary)',
                fontFamily: 'inherit', fontSize: 'var(--font-subhead)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span>{c.name}</span>
              <span style={{
                fontSize: 'var(--font-caption2)', color: 'var(--text-tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {adhan.Qibla(new adhan.Coordinates(c.lat, c.lon)).toFixed(0)}°
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children, onClick, primary, active, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 'var(--hit-min)',
        padding: '0 var(--space-margin)',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${primary || active ? 'var(--text-primary)' : 'var(--hairline)'}`,
        background: primary
          ? 'rgb(var(--ink-rgb) / 0.1)'
          : active
          ? 'rgb(var(--ink-rgb) / 0.07)'
          : 'rgb(var(--ink-rgb) / 0.03)',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', fontSize: 'var(--font-subhead)',
        fontWeight: 'var(--weight-regular)',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** Иконка раздела нужна таб-бару; держим экспорт рядом, чтобы вкладка
 *  и экран не разъезжались при переименованиях. */
export const QIBLA_ICON = <Compass size={ICON_SIZE.lg} />;
