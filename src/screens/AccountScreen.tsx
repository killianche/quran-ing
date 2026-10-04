/**
 * AccountScreen — раздел «Аккаунт».
 *
 * ── Что это на самом деле ─────────────────────────────────────────────
 *
 * Не аккаунт в привычном смысле: у приложения нет ни сервера, ни входа,
 * и всё, что человек настроил, лежит у него на устройстве.  Экран
 * говорит это прямым текстом — иначе люди будут ждать, что их список
 * дуа переедет на новый телефон, и обидятся, когда не переедет.
 *
 * Настоящий аккаунт со входом и синхронизацией — отдельная большая
 * работа с бэкендом; начинать её без запроса нельзя.
 *
 * ── Зачем раздел нужен для App Store ──────────────────────────────────
 *
 * App Review проверяет несколько вещей, и без них приложение не
 * пропустят:
 *
 *   • политика конфиденциальности должна быть доступна — здесь она
 *     открывается из приложения и работает офлайн;
 *   • условия использования — там же;
 *   • данные о пользователе должны удаляться по его требованию
 *     (Guideline 5.1.1) — кнопка ниже действительно стирает всё, а не
 *     делает вид;
 *   • версия сборки — чтобы поддержка понимала, о чём речь.
 *
 * Чего этот экран закрыть не может, потому что нужны данные владельца:
 * правообладатель, контактный e-mail и публичный URL документов для
 * App Store Connect.  Они перечислены в STATUS.md как блокеры релиза, и
 * подставлять сюда выдуманный e-mail нельзя — он попадёт в магазин.
 *
 * ── Типографика ───────────────────────────────────────────────────────
 *
 * Кегли, веса, радиусы и отступы берутся из шкалы в src/index.css —
 * своих чисел экран не заводит.  Заголовок «Аккаунт» набран той же
 * формой, что и «Коран» в SurahPicker: это корневой экран вкладки, а не
 * панель с кнопкой «назад».
 */

import { useEffect, useRef, useState } from 'react';
import {
  Appearance, ChevronRight, Document, ICON_SIZE, Person, Trash,
} from '../components/icons';
import { ThemeSettings } from '../components/ReadingSettings';
import { LargeTitleHeader } from '../components/ScreenHeader';
import { FullQuranAudioManager } from '../components/OfflineAudioCard';
import {
  AZKAR_ORDERS, readAzkarOrder, writeAzkarOrder, type AzkarOrder,
} from '../lib/azkarPrefs';
import { TAB_BAR_SPACE } from '../components/TabBar';
import type { Theme } from '../hooks/useTheme';
import { THEME_LABELS } from '../hooks/useTheme';
import {
  countLocalData, MAX_NAME_LENGTH, onProfileChange,
  readUserName, wipeLocalData, writeUserName,
} from '../lib/profile';
import type { DocumentId } from './DocumentScreen';

/** Версия из package.json, подставляется при сборке (см. vite.config.ts). */
declare const __APP_VERSION__: string;

/**
 * Единственная форма капс-подзаголовка на экране.
 *
 * В шкале нет трекинга для прописных: `--tracking-loose` (0.01em)
 * рассчитан на мелкий СТРОЧНЫЙ текст — им набрана подпись в
 * ScreenHeader.  На капсе 11px такой разряд слипается, поэтому значение
 * задано явно и ровно одно на весь файл.
 */
const CAP_LABEL: React.CSSProperties = {
  fontSize: 'var(--font-caption2)',
  lineHeight: 'var(--leading-caption2)',
  fontWeight: 'var(--weight-semibold)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

type Props = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onOpenDocument: (doc: DocumentId) => void;
  /** Экран открывается пушем из шапки главной, поэтому нужен возврат. */
  onBack?: () => void;
};

export function AccountScreen({ theme, setTheme, onBack, onOpenDocument }: Props) {
  const [name, setName] = useState(readUserName);
  const [themeOpen, setThemeOpen] = useState(false);
  const [wipeArmed, setWipeArmed] = useState(false);
  const [wiped, setWiped] = useState<number | null>(null);
  const [stored, setStored] = useState(countLocalData);
  const themeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => onProfileChange(() => setStored(countLocalData())), []);

  const commitName = (v: string) => {
    setName(v);
    writeUserName(v);
  };

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
          theme={theme} setTheme={setTheme}
          onClose={() => setThemeOpen(false)}
          anchorEl={themeBtnRef.current}
        />
      )}

      {/* Аккаунт открывается пушем — у шапки есть «назад»; крупный заголовок
          при этом сохранён: экран «свой», а не подраздел с узкой шапкой. */}
      <LargeTitleHeader
        title="Аккаунт"
        onBack={onBack}
        actions={[{
          key: 'theme', label: 'Оформление', ref: themeBtnRef, active: themeOpen,
          icon: <Appearance size={ICON_SIZE.md} />,
          onClick: () => setThemeOpen(v => !v),
        }]}
      />

      {/* ── Имя ──────────────────────────────────────────────────────── */}
      <Card>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-cozy)',
          padding: 'var(--space-margin) var(--space-margin) var(--space-cozy)',
        }}>
          <span style={{
            flexShrink: 0,
            width: '52px', height: '52px', borderRadius: 'var(--radius-pill)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--hairline)',
            background: 'rgb(var(--ink-rgb) / 0.05)',
            color: 'var(--text-secondary)',
          }}>
            <Person size={ICON_SIZE.lg} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{
              ...CAP_LABEL,
              display: 'block', marginBottom: 'var(--space-tight)',
              color: 'var(--text-tertiary)',
            }}>
              Имя
            </label>
            <input
              value={name}
              onChange={e => commitName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Как к вам обращаться"
              aria-label="Имя"
              style={{
                width: '100%', minHeight: '30px',
                border: 'none', background: 'transparent',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                fontSize: 'var(--font-body)',
                lineHeight: 'var(--leading-body)',
                fontWeight: 'var(--weight-regular)',
                letterSpacing: 'var(--tracking-tight)', padding: 0,
                outline: 'none',
              }}
            />
          </div>
        </div>
        <Hint>
          Имя хранится только на этом устройстве. Входа и синхронизации в
          приложении нет: ваши списки, закладки и настройки никуда не
          отправляются.
        </Hint>
      </Card>

      {/* ── Оформление ───────────────────────────────────────────────── */}
      <SectionTitle>Настройки</SectionTitle>
      <Card>
        <Row
          label="Оформление"
          value={THEME_LABELS[theme]}
          onClick={() => setThemeOpen(true)}
        />
        <Hint>
          Размер текста и шрифты настраиваются там, где читают: в Коране и
          азкарах — своей кнопкой в шапке.
        </Hint>
      </Card>

      {/* ── Порядок азкаров ──────────────────────────────────────────── */}
      <SectionTitle>Азкары</SectionTitle>
      <Card>
        <AzkarOrderPicker />
      </Card>

      {/* ── Полные записи чтецов ─────────────────────────────────────── */}
      <SectionTitle>Офлайн-аудио</SectionTitle>
      <Card>
        <FullQuranAudioManager />
      </Card>

      {/* ── Документы ────────────────────────────────────────────────── */}
      <SectionTitle>Документы</SectionTitle>
      <Card>
        <Row
          icon={<Document size={ICON_SIZE.md} />}
          label="Политика конфиденциальности"
          onClick={() => onOpenDocument('privacy')}
        />
        <Divider />
        <Row
          icon={<Document size={ICON_SIZE.md} />}
          label="Условия использования"
          onClick={() => onOpenDocument('terms')}
        />
        <Hint>Открываются без интернета — документы лежат в приложении.</Hint>
      </Card>

      {/* ── Данные ───────────────────────────────────────────────────── */}
      <SectionTitle>Мои данные</SectionTitle>
      <Card>
        {wiped === null ? (
          <>
            <button
              onClick={() => setWipeArmed(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
                width: '100%', minHeight: '50px',
                padding: 'var(--space-snug) var(--space-margin)',
                border: 'none', background: 'transparent',
                color: 'var(--danger)', cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'var(--font-subhead)',
                lineHeight: 'var(--leading-subhead)',
                textAlign: 'left',
              }}
            >
              <Trash size={ICON_SIZE.md} />
              <span style={{ flex: 1 }}>Удалить мои данные</span>
              <span style={{
                fontSize: 'var(--font-footnote)',
                lineHeight: 'var(--leading-footnote)',
                color: 'var(--text-tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {stored}
              </span>
            </button>

            {/*
              Второй шаг, а не диалог: тот же приём, что при удалении дуа.
              Но здесь потеря необратима — вернуть настройки будет нечем,
              поэтому текст говорит это прямо, а не «вы уверены?».
            */}
            {wipeArmed && (
              <div style={{
                padding: '0 var(--space-margin) var(--space-cozy)',
                animation: 'card-in var(--dur-base) var(--ease-standard) both',
              }}>
                <p style={{
                  margin: '0 0 var(--space-cozy)',
                  fontSize: 'var(--font-footnote)',
                  lineHeight: 'var(--leading-footnote)',
                  color: 'var(--text-secondary)',
                }}>
                  Удалятся имя, закладки, история чтения, города намаза и
                  все настройки текста. Отменить будет
                  нельзя. Скачанное аудио останется — его можно удалить в
                  разделе «Офлайн-аудио» выше.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-snug)' }}>
                  <button
                    onClick={() => { setWiped(wipeLocalData()); setWipeArmed(false); }}
                    style={{
                      flex: 1, minHeight: 'var(--hit-min)',
                      borderRadius: 'var(--radius-control)',
                      border: 'none', background: 'var(--danger)',
                      color: '#fff', cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 'var(--font-subhead)',
                      lineHeight: 'var(--leading-subhead)',
                      fontWeight: 'var(--weight-semibold)',
                    }}
                  >
                    Удалить
                  </button>
                  <button
                    onClick={() => setWipeArmed(false)}
                    style={{
                      flex: 1, minHeight: 'var(--hit-min)',
                      borderRadius: 'var(--radius-control)',
                      border: '1px solid var(--hairline)', background: 'transparent',
                      color: 'var(--text-primary)', cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 'var(--font-subhead)',
                      lineHeight: 'var(--leading-subhead)',
                      fontWeight: 'var(--weight-regular)',
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: 'var(--space-margin)' }}>
            <p style={{
              margin: 0,
              fontSize: 'var(--font-subhead)',
              lineHeight: 'var(--leading-subhead)',
              color: 'var(--text-primary)',
            }}>
              Удалено записей: {wiped}.
            </p>
            <p style={{
              margin: 'var(--space-snug) 0 0',
              fontSize: 'var(--font-footnote)',
              lineHeight: 'var(--leading-footnote)',
              color: 'var(--text-tertiary)',
            }}>
              Часть экранов покажет прежние значения, пока приложение не
              перезапустится — они уже стёрты из памяти устройства.
            </p>
          </div>
        )}
      </Card>

      {/* ── О приложении ─────────────────────────────────────────────── */}
      <SectionTitle>О приложении</SectionTitle>
      <Card>
        <Row label="Версия" value={__APP_VERSION__} />
        <Divider />
        <Row label="Перевод Корана" value="Эльмир Кулиев" />
        <Divider />
        <Row label="Арабский текст" value="Мусхаф Медины, QCF" />
        <Hint>
          Работает без интернета: текст, перевод и расчёт времени намаза
          лежат в приложении. Сеть нужна только для аудио и определения
          места.
        </Hint>
      </Card>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      ...CAP_LABEL,
      margin: 'var(--space-section) var(--space-hair) var(--space-snug)',
      color: 'var(--text-tertiary)',
    }}>
      {children}
    </p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section style={{
      borderRadius: 'var(--radius-card)',
      border: '1px solid var(--hairline)',
      background: `
        radial-gradient(120% 130% at 100% 0%,
          rgb(var(--ink-rgb) / 0.04) 0%,
          transparent 58%),
        var(--surface)
      `,
      overflow: 'hidden',
    }}>
      {children}
    </section>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{
        height: '1px', marginLeft: 'var(--space-margin)',
        background: 'rgb(var(--ink-rgb) / 0.08)',
      }}
    />
  );
}

/** Строка списка.  Без onClick — просто значение, не кнопка. */
function Row({ icon, label, value, onClick }: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon && (
        <span style={{
          flexShrink: 0, display: 'inline-flex',
          color: 'var(--text-tertiary)',
        }}>
          {icon}
        </span>
      )}
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: 'var(--font-subhead)',
        lineHeight: 'var(--leading-subhead)',
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </span>
      {value && (
        <span style={{
          flexShrink: 0,
          fontSize: 'var(--font-footnote)',
          lineHeight: 'var(--leading-footnote)',
          color: 'var(--text-tertiary)',
        }}>
          {value}
        </span>
      )}
      {onClick && (
        <span style={{ flexShrink: 0, display: 'inline-flex', color: 'var(--text-tertiary)' }}>
          <ChevronRight size={ICON_SIZE.sm} />
        </span>
      )}
    </>
  );

  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
    width: '100%', minHeight: '50px',
    padding: 'var(--space-snug) var(--space-margin)',
    fontFamily: 'inherit', textAlign: 'left',
  };

  if (!onClick) return <div style={style}>{content}</div>;

  return (
    <button
      onClick={onClick}
      style={{ ...style, border: 'none', background: 'transparent', cursor: 'pointer' }}
    >
      {content}
    </button>
  );
}

/**
 * Порядок азкаров — два варианта.
 *
 * 🔴 Почему их ровно два и откуда они взялись.
 *
 * Владелец помнил, что «изначально последовательность была другая», и
 * 07.09.2026 передал образец — приложение Jawziyya Azkar. Его порядок теперь
 * основной; прежняя сортировка по номеру осталась вторым вариантом, как он и
 * просил. Откуда взят образец и как сопоставлен с нашими записями —
 * `src/content/azkarAppOrder.ts`.
 *
 * Поэтому здесь не «сортировка» в общем смысле, а выбор одного из двух
 * порядков, которые уже есть в данных. Ни один текст азкара при переключении
 * не меняется — меняется только очерёдность карточек.
 */
function AzkarOrderPicker() {
  const [order, setOrder] = useState<AzkarOrder>(readAzkarOrder);

  const ОПИСАНИЕ: Record<AzkarOrder, { название: string; пояснение: string }> = {
    app:  { название: 'Привычный', пояснение: 'как в приложении Azkar' },
    book: { название: 'По номерам', пояснение: '1, 2, 3 … по нумерации книги' },
  };

  return (
    <>
      <div
        role="radiogroup"
        aria-label="Порядок азкаров"
        style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-tight)',
          padding: 'var(--space-cozy) var(--space-margin)',
        }}
      >
        {AZKAR_ORDERS.map(вариант => {
          const выбран = order === вариант;
          return (
            <button
              key={вариант}
              role="radio"
              aria-checked={выбран}
              onClick={() => { setOrder(вариант); writeAzkarOrder(вариант); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: '2px',
                minHeight: '58px', padding: 'var(--space-tight) var(--space-snug)',
                borderRadius: 'var(--radius-control)',
                border: `1px solid ${выбран ? 'var(--text-primary)' : 'var(--hairline)'}`,
                background: выбран ? 'rgb(var(--ink-rgb) / 0.05)' : 'transparent',
                color: 'var(--text-primary)',
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{
                fontSize: 'var(--font-subhead)',
                lineHeight: 'var(--leading-subhead)',
                fontWeight: выбран ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              }}>
                {ОПИСАНИЕ[вариант].название}
              </span>
              <span style={{
                fontSize: 'var(--font-caption2)',
                lineHeight: 'var(--leading-caption2)',
                color: 'var(--text-tertiary)',
              }}>
                {ОПИСАНИЕ[вариант].пояснение}
              </span>
            </button>
          );
        })}
      </div>
      <Hint>
        Меняется только очерёдность карточек в утренних и вечерних азкарах.
        Сами тексты, перевод и транскрипция остаются прежними.
      </Hint>
    </>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      margin: 0, padding: '0 var(--space-margin) var(--space-cozy)',
      fontSize: 'var(--font-caption1)',
      lineHeight: 'var(--leading-caption1)',
      color: 'var(--text-tertiary)',
    }}>
      {children}
    </p>
  );
}
