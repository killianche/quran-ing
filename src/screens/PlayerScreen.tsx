/**
 * PlayerScreen — полноэкранный плеер суры.
 *
 * ── Зачем отдельный экран ─────────────────────────────────────────────
 *
 * Слушают Коран иначе, чем читают. Читающему нужен текст и место, где он
 * остановился; слушающему — кто читает, с какой скоростью, что дальше и как
 * это переключить, не выцеливая мелкие кнопки в шапке экрана чтения.
 *
 * Экран в общем стеке, а не лист поверх: у него своя запись в истории,
 * поэтому системная «назад» и жест от края возвращают туда, откуда пришли,
 * без отдельной обработки.
 *
 * ── Два места: вкладка и экран поверх ────────────────────────────────
 *
 * С 2026-10-05 плеер — ещё и первая вкладка нижнего меню (владелец: «чтобы
 * можно было нажать и плеер показывался, и чтобы нижнее меню было видно
 * всегда»). Там (`placement="tab"`) у него крупный заголовок, как у «Корана»
 * и «Азкаров», кнопка оформления вместо «назад» и нижний отступ под панель
 * вкладок. Экраном поверх (`placement="screen"`, по умолчанию) он остаётся
 * для открытой суры: капсула звука там ведёт сюда, а «назад» — обратно в
 * суру. Содержимое у обоих одно.
 *
 * ── Раскладка G1 «Михраб» (владелец 2026-11-16) ──────────────────────
 *
 * Выбрана после серии макетов (`docs/design/player-redesign/`, история —
 * STATUS.md): владелец просил, чтобы повтор аята и повтор суры были видны и
 * различимы, суры переключались явными кнопками с подписью, а «Слушать» была
 * крупной и её нельзя было спутать с соседними кнопками. Части экрана —
 * `src/components/PlayerControls.tsx`, их стили — `.player-g1` и ниже в
 * `src/index.css`.
 *
 * - Сверху: название суры по-арабски, транслитерация с шевроном (тап —
 *   шторка выбора суры `SurahPickerSheet`), «Аят N из M» и тонкая полоса.
 * - Клавиша чтеца (вариант E3): инициалы и имя, «скачано» в подписи; тап —
 *   лист со всеми чтецами. Не скачано — рядом кнопка загрузки.
 * - Арка михраба — одна кнопка «Слушать» / «Пауза», единственное золотое
 *   на экране. По бокам — соседние аяты (у чтеца без границ аятов — ±10 с).
 * - Под аркой — соседние суры парой. Прежде (2026-10-04) стрелки сур сняли
 *   («лучше выбор суры удобным»); в редизайне владелец вернул их явными
 *   кнопками с подписью, какая сура. Шторка выбора суры осталась.
 * - «Повтор аята» (1 · 2 · 3 · 5 · ∞) и «Повтор суры» (Стоп · Дальше ·
 *   Заново) — строки выбора; под второй — что случится в конце суры.
 * - Скорость и список сур — в кнопках шапки, рядом с оформлением: у нижней
 *   панели вкладок не осталось мелких кнопок, по которым легко промахнуться.
 * - Без карточек-панелей; стекло — только у шапки, листов и шторки (слой
 *   управления, docs/IOS26_DESIGN_GUIDE.md § 2).
 *
 * ── Что здесь НЕ показывается ─────────────────────────────────────────
 *
 * Нет полосы прокрутки по времени. Непрерывная запись суры — это один файл
 * на десятки минут, и «перемотать на 12:30» для Корана бессмысленная
 * единица: человек мыслит аятами. Поэтому позиция показана аятом, а
 * перемотка — по аятам.
 *
 * Исключение — чтец без границ аятов (`usesTimelineSeek`). У него аята
 * узнать неоткуда, поэтому сура слушается как трек музыкального плеера:
 * ползунок по времени и перемотка на 10 секунд (решение владельца
 * 03.10.2026).
 *
 * Нет текста аята: для чтения есть лента, и дублировать её здесь значило
 * бы сделать второй, худший читатель.
 */

import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { LargeTitleHeader, ScreenHeader, screenHeaderOffset, type HeaderAction } from '../components/ScreenHeader';
import { ThemeSettings } from '../components/ReadingSettings';
import { TAB_BAR_SPACE } from '../components/TabBar';
import { SurahPickerSheet } from '../components/SurahPickerSheet';
import {
  SkipBack, SkipForward, SeekBack10, SeekForward10,
  ChevronDown, ListBullet, Appearance, Repeat, BookOpen, NoEntry, ArrowRight, ICON_SIZE,
} from '../components/icons';
import {
  ChoiceRow, MihrabButton, ReciterKey, ReciterSheet, SideButton, SurahStepButton, reciterInitials,
  type ChoiceOption,
} from '../components/PlayerControls';
import { AYAH_REPEAT_MODES, ayahRepeatLabel, ayahRepeatShort, type AyahRepeatMode } from '../lib/ayahRepeat';
import { SURAH_END_MODES, surahEndHint, surahEndLabel, surahEndShort, type SurahEndMode } from '../lib/surahEnd';
import { useAudioActions, useAudioState, useAudioTick } from '../hooks/AudioProvider';
import {
  TIMELINE_SEEK_STEP_SECONDS, nextAvailableSurah, prevAvailableSurah, reciterById,
  reciterHasSurah, usesTimelineSeek, type ReciterId,
} from '../lib/reciters';
import { formatPlaybackTime } from '../lib/playbackTime';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { readLastPlayback, type LastPlayback } from '../lib/lastPlayback';
import { OfflinePill, surahOffline, useOfflineTick } from '../components/SurahOfflineStatus';
import type { Theme } from '../hooks/useTheme';
import type { TabFrame } from '../components/TabPager';

type Props =
  | {
    /** Экран поверх (из открытой суры): своя шапка с «назад». */
    placement?: 'screen';
    onBack: () => void;
  }
  | {
    /** Вкладка нижнего меню: крупный заголовок, отступ под панель. */
    placement: 'tab';
    /** false — вкладка скрыта или под экраном поверх (App, TabPager). */
    active: boolean;
    /** Прокрутка вкладки и слой её шапки (TabPager); null — первый кадр. */
    frame: TabFrame | null;
    theme: Theme;
    setTheme: (t: Theme) => void;
  };

export function PlayerScreen(props: Props) {
  const isTab = props.placement === 'tab';
  const active = props.placement === 'tab' ? props.active : true;
  const { currentSurah, currentAyah, audioState, playbackRate, ayahRepeat, surahEnd, wholeSurah, reciter } = useAudioState();
  const audio = useAudioActions();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reciterOpen, setReciterOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  // Шторка, меню и оформление — порталы в body: у скрытой вкладки они
  // висели бы над соседней или над сурой. Закрываем, как только вкладка
  // перестала быть видимой.
  useEffect(() => {
    if (active) return;
    setPickerOpen(false);
    setReciterOpen(false);
    setThemeOpen(false);
  }, [active]);

  // 🔴 Когда ничего не звучит — последнее прослушивание, а не пустота и не
  // «первая сура по умолчанию».
  //
  // Владелец 2026-10-05: «послушал суру, вышел из приложения, даже полностью
  // закрыл — чтобы плеер помнил, на каком месте я остановился». Место пишет
  // AudioProvider (lib/lastPlayback.ts); здесь оно читается заново каждый
  // раз, когда звук обрывается, — в том числе после остановки крестиком.
  //
  // Прежде помнилась только сура текущего запуска, и любая остановка
  // показывалась как «Сура дочитана» — даже крестиком посреди суры. Теперь
  // «дочитана» — только если запись правда дослушана до конца (`done`).
  // История: ещё раньше здесь было `?? 1`, и пустой плеер подставлял
  // Аль-Фатиху, которая не звучала, — не возвращать.
  const [remembered, setRemembered] = useState<LastPlayback | null>(readLastPlayback);
  useEffect(() => {
    if (currentSurah) return;
    // Через задачу, а не сразу: итог («дочитана» или место остановки) пишет
    // AudioProvider в своём эффекте, а эффекты родителя идут ПОСЛЕ эффектов
    // потомков — прочитав сразу, экран получил бы запись предыдущего кадра.
    const id = window.setTimeout(() => setRemembered(readLastPlayback()), 0);
    return () => window.clearTimeout(id);
  }, [currentSurah]);
  const restored = currentSurah ? null : remembered;

  const surah = currentSurah ?? restored?.surah ?? null;
  const meta = surah ? SURAH_BY_NUMBER[surah] : undefined;
  const total = meta?.ayahs ?? 1;
  const ayah = currentAyah ?? restored?.ayah ?? 1;
  const finished = Boolean(restored?.done);
  // Остановились посреди суры — продолжать есть с чего.
  const paused = Boolean(restored && !restored.done);
  const playing = audioState === 'playing';
  const loading = audioState === 'loading';
  const timeline = usesTimelineSeek(reciter);
  // Сменили чтеца на того, у кого этой суры нет (Мержоев посреди суры 10):
  // звук останавливается, и «Сура дочитана» было бы неправдой. Говорим как
  // есть, а кнопка воспроизведения ведёт к выбору суры (ревью 2026-10-04).
  const missing = surah != null && !reciterHasSurah(reciter, surah);
  const status = loading ? 'Загрузка…'
    : missing ? 'У чтеца нет этой суры'
    : finished ? 'Сура дочитана'
    // Время пишем словами, только если полосы с ним нет (старая запись без
    // длины); иначе «3:12» стояло бы на экране дважды.
    : paused && timeline && restored?.seconds != null && restored.reciter === reciter && !restored.duration
      ? `Остановлено на ${formatPlaybackTime(restored.seconds)}`
    : paused ? 'На паузе'
    // Повтор аята словами здесь больше не пишется: строка «Повтор аята»
    // под аркой и так показывает выбранное (G1, 2026-11-16).
    : null;

  // Скорость и список сур — в шапке, рядом с оформлением (G1): внизу,
  // у панели вкладок, мелкие кнопки легко задеть вместо нужной.
  const playerActions: HeaderAction[] = [
    {
      key: 'rate',
      label: `Скорость ${playbackRate}×. Изменить`,
      icon: (
        <span style={{
          fontSize: 'var(--font-subhead)',
          fontWeight: 'var(--weight-semibold)',
          fontVariantNumeric: 'tabular-nums',
          color: playbackRate === 1 ? 'var(--text-secondary)' : 'var(--brand)',
        }}>
          {playbackRate}×
        </span>
      ),
      onClick: () => audio.cyclePlaybackRate(),
    },
    {
      key: 'surahs', label: 'Список сур', active: pickerOpen,
      icon: <ListBullet size={ICON_SIZE.md} />,
      onClick: () => setPickerOpen(true),
    },
  ];

  const playSurah = (n: number) => {
    const m = SURAH_BY_NUMBER[n];
    if (m) audio.playSurah(n, m.ayahs);
  };

  const reciterRow = (
    <ReciterRow
      reciter={reciter}
      surah={surah && !missing ? surah : null}
      open={reciterOpen}
      onOpen={() => setReciterOpen(true)}
    />
  );

  // Соседние суры — те, что ЕСТЬ у чтеца: у Мержоева после 9-й идёт 12-я.
  const prevSurah = surah ? prevAvailableSurah(reciter, surah) : null;
  const nextSurah = surah ? nextAvailableSurah(reciter, surah) : null;
  const prevMeta = prevSurah ? SURAH_BY_NUMBER[prevSurah] : undefined;
  const nextMeta = nextSurah ? SURAH_BY_NUMBER[nextSurah] : undefined;

  const onMihrab = () => {
    if (playing) audio.pause();
    // Записи нет — играть нечего, предлагаем выбрать другую.
    else if (missing) setPickerOpen(true);
    // Сура дочитана — начинаем её заново, а не продолжаем с
    // последнего аята: продолжать там уже нечего.
    else if (finished && surah) audio.playSurah(surah, total);
    // Звука нет, но место запомнено (в том числе с прошлого
    // запуска) — продолжаем оттуда. У чтеца с границами аятов — с
    // того же аята как «слушать суру целиком» (`playFrom` 'surah'):
    // после неё сработает «Повтор суры»; `handlePlay` эту цепочку
    // сбрасывал. У чтеца без границ аятов — с той же секунды
    // записи, если чтец тот же; иначе — с начала суры.
    else if (paused && restored && surah) {
      if (timeline) {
        audio.playFrom(
          surah, 1, 1, 'surah',
          restored.reciter === reciter ? restored.seconds : undefined,
        );
      } else {
        audio.playFrom(surah, restored.ayah, total, 'surah');
      }
    }
    // Продолжаем с места паузы, а не с начала аята.
    else audio.resume();
  };
  // Соседний аят, когда звука нет (запомненное место после перезапуска):
  // у `prev`/`next` нет очереди, и кнопки молчали бы. Включаем суру целиком
  // с соседнего аята — как «Продолжить», только на шаг в сторону. У чтеца
  // без границ аятов перематывать нечего — кнопки неактивны.
  const live = currentSurah != null;
  const sideIdle = !live && (timeline || missing || !surah);
  const stepAyah = (delta: -1 | 1) => {
    if (live) { if (delta < 0) audio.prev(); else audio.next(); return; }
    if (sideIdle || !surah) return;
    audio.playFrom(surah, Math.min(total, Math.max(1, ayah + delta)), total, 'surah');
  };

  const mihrabLabel = playing ? 'Пауза'
    : missing ? 'Выбрать суру'
    : loading ? 'Загрузка…'
    : (audioState === 'paused' || paused) ? 'Продолжить'
    : 'Слушать';

  const content: ReactNode = (<>
        {!surah && (
          <div style={{
            flex: 1,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 'var(--space-cozy)',
            textAlign: 'center',
          }}>
            <p style={{
              margin: 0,
              fontSize: 'var(--font-title3)',
              lineHeight: 'var(--leading-title3)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--text-primary)',
            }}>
              Ничего не звучит
            </p>
            <div style={{ width: '100%', maxWidth: '360px', display: 'flex' }}>{reciterRow}</div>
            <button
              onClick={() => setPickerOpen(true)}
              className="player-press"
              style={{
                marginTop: 'var(--space-tight)',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                minHeight: '48px', padding: '0 22px',
                border: 'none', borderRadius: 'var(--radius-pill)',
                background: 'var(--text-primary)', color: 'var(--surface)',
                fontFamily: 'inherit',
                fontSize: 'var(--font-body)',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <ListBullet size={ICON_SIZE.md} />
              Выбрать суру
            </button>
          </div>
        )}

        {surah && meta && (<div className="player-g1" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* ── Что звучит ─────────────────────────────────────────────
            Сверху и компактно: главное на экране — арка «Слушать». */}
        <section style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center',
        }}>
          <p
            dir="rtl"
            lang="ar"
            aria-hidden
            style={{
              margin: 0,
              fontFamily: "'KFGQPC Uthmanic Hafs v22', serif",
              fontSize: 'clamp(32px, min(11vw, 5.6dvh), 48px)',
              lineHeight: 1.35,
              color: 'var(--text-primary)',
            }}
          >
            {meta.arabic}
          </p>

          <button
            onClick={() => setPickerOpen(true)}
            aria-label={`Сура ${meta.transliteration}, ${meta.russian}, ${meta.number}-я. Выбрать другую суру`}
            aria-haspopup="dialog"
            className="player-title-btn"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              maxWidth: '100%',
              minHeight: '44px', padding: '0 12px',
              border: 'none', borderRadius: 'var(--radius-pill)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{
              minWidth: 0,
              fontSize: 'var(--font-title3)',
              lineHeight: 'var(--leading-title3)',
              fontWeight: 'var(--weight-semibold)',
              letterSpacing: 'var(--tracking-tight)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {meta.transliteration}
            </span>
            <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--text-tertiary)' }}>
              <ChevronDown size={ICON_SIZE.sm} />
            </span>
          </button>

          {/* Позиция аятом, а не временем: человек, слушающий Коран,
              мыслит аятами. У чтеца без границ аятов — ползунок ниже. */}
          {!timeline && (
            <p style={{
              margin: '-4px 0 0',
              fontSize: 'var(--font-footnote)',
              lineHeight: 'var(--leading-footnote)',
              color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              Аят {ayah} из {total}{status ? ` · ${status}` : ''}
            </p>
          )}
        </section>

        {timeline && paused && restored?.seconds != null && restored.duration && restored.reciter === reciter ? (
          // После перезапуска звука нет и ползунку не от чего брать позицию —
          // показываем запомненное место неподвижной полосой, а не «0:00»
          // рядом со словами «Остановлено на 3:12» (ревью 2026-10-05).
          <RestoredTimeBar seconds={restored.seconds} duration={restored.duration} status={status} />
        ) : timeline ? (
          <SeekBar
            // Своя сура — свой ползунок: незавершённое перетаскивание не
            // переезжает на следующую.
            key={surah}
            status={status}
            live={active}
          />
        ) : (
          <div
            role="progressbar"
            aria-label="Позиция в суре"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={ayah}
            aria-valuetext={`Аят ${ayah} из ${total}`}
            style={{ height: '16px', display: 'flex', alignItems: 'center', padding: '0 4px' }}
          >
            <div style={{
              flex: 1,
              height: '4px',
              borderRadius: '2px',
              background: 'var(--hairline)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(100, (ayah / Math.max(1, total)) * 100)}%`,
                height: '100%',
                borderRadius: '2px',
                background: 'var(--ink)',
                transition: 'width 240ms var(--ease-standard)',
              }} />
            </div>
          </div>
        )}

        {/* ── Чтец (вариант E3): клавиша и лист со всеми чтецами ─────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 'var(--space-cozy)' }}>
          {reciterRow}
        </div>

        {/* ── Арка «Слушать» и соседние аяты ─────────────────────────
            Аяты — по бокам, в своих колонках: между ними и аркой зазор,
            чтобы большой палец не задел их вместо «Слушать». Кнопки чуть
            ниже середины арки — там, где у неё плечи, а не купол. */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          marginTop: 'clamp(14px, 2.4dvh, 22px)',
        }}>
          <div style={{ justifySelf: 'start', transform: 'translateY(14%)' }}>
            <SideButton
              onPress={() => stepAyah(-1)}
              disabled={sideIdle}
              ariaLabel={timeline ? 'Назад на 10 секунд' : 'Предыдущий аят'}
              icon={timeline ? <SeekBack10 size={26} /> : <SkipBack size={24} />}
              caption={sideIdle ? null : timeline ? '−10 с' : ayah > 1 ? `аят ${ayah - 1}` : null}
            />
          </div>
          <MihrabButton
            playing={playing}
            loading={loading}
            label={mihrabLabel}
            ariaLabel={mihrabLabel === 'Загрузка…' ? 'Загрузка. Нажмите, чтобы продолжить' : mihrabLabel}
            onPress={onMihrab}
          />
          <div style={{ justifySelf: 'end', transform: 'translateY(14%)' }}>
            <SideButton
              onPress={() => stepAyah(1)}
              disabled={sideIdle}
              ariaLabel={timeline ? 'Вперёд на 10 секунд' : 'Следующий аят'}
              icon={timeline ? <SeekForward10 size={26} /> : <SkipForward size={24} />}
              caption={sideIdle ? null : timeline ? '+10 с' : ayah < total ? `аят ${ayah + 1}` : null}
            />
          </div>
        </section>

        {/* ── Соседние суры — парой под аркой ──────────────────────── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-cozy)',
          marginTop: 'clamp(12px, 2dvh, 18px)',
        }}>
          <SurahStepButton
            direction="prev"
            number={prevSurah}
            title={prevMeta?.transliteration ?? null}
            onPress={() => { if (prevSurah) playSurah(prevSurah); }}
          />
          <SurahStepButton
            direction="next"
            number={nextSurah}
            title={nextMeta?.transliteration ?? null}
            onPress={() => { if (nextSurah) playSurah(nextSurah); }}
          />
        </div>

        {/* ── Повтор аята и повтор суры ─────────────────────────────
            Все варианты видны сразу. У чтеца без границ аятов аят из
            записи не выделить — строки «Повтор аята» нет. */}
        <div style={{ display: 'grid', gap: 'var(--space-cozy)', marginTop: 'clamp(14px, 2.4dvh, 20px)' }}>
          {!timeline && (
            <ChoiceRow<AyahRepeatMode>
              label="Повтор аята"
              icon={<Repeat size={14} />}
              // Золото — только когда повтор включён: «1» — обычное чтение.
              tone={ayahRepeat === 'off' ? 'neutral' : 'brand'}
              options={AYAH_REPEAT_MODES.map(m => ({ id: m, label: ayahRepeatShort(m), ariaLabel: ayahRepeatLabel(m) }))}
              value={ayahRepeat}
              onChange={audio.setAyahRepeat}
            />
          )}
          <ChoiceRow<SurahEndMode>
            label="Повтор суры"
            icon={<BookOpen size={14} />}
            options={SURAH_END_OPTIONS}
            value={surahEnd}
            onChange={audio.setSurahEnd}
            // Пока ничего не звучит, арка включит суру целиком — режим
            // подействует. Звучит с аята из ленты — честно говорим, что нет.
            hint={surahEndHint(surahEnd, nextMeta?.transliteration ?? null, !currentSurah || wholeSurah)}
          />
        </div>
        </div>)}
  </>);

  // Колонка содержимого: управление внизу, «что звучит» — в оставшемся
  // месте. Ширина та же, что была у экрана поверх.
  const column: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '560px',
    width: '100%',
    margin: '0 auto',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {isTab ? (
        // Как у «Корана» и «Азкаров»: крупный заголовок в колонке 720 и
        // нижний отступ под панель вкладок. Капсулы звука на этой вкладке
        // нет (App прячет её — она повторяла бы экран), поэтому её места
        // в отступе тоже нет.
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          maxWidth: 'min(100%, 720px)',
          width: '100%',
          margin: '0 auto',
          padding: `0 var(--space-margin) calc(${TAB_BAR_SPACE} + var(--space-section) + env(safe-area-inset-bottom))`,
          boxSizing: 'border-box',
        }}>
          {themeOpen && (
            <ThemeSettings
              theme={props.theme}
              setTheme={props.setTheme}
              onClose={() => setThemeOpen(false)}
              anchorEl={themeBtnRef.current}
            />
          )}
          {/* Заголовок вкладки — её же подпись в нижнем меню, как у «Корана» и
              «Азкаров»: «Слушать» над вкладкой «Плеер» читалось как
              неправильный заголовок (владелец 2026-10-05). */}
          <LargeTitleHeader
            active={active}
            frame={props.frame}
            title="Плеер"
            actions={[...playerActions, {
              key: 'theme', label: 'Оформление', ref: themeBtnRef, active: themeOpen,
              icon: <Appearance size={ICON_SIZE.md} />,
              onClick: () => setThemeOpen(v => !v),
            }]}
          />
          <div style={column}>{content}</div>
        </div>
      ) : (<>
        <ScreenHeader
          visible
          title="Слушать"
          onBack={props.onBack}
          actions={playerActions}
        />
        <div style={{
          ...column,
          padding: `${screenHeaderOffset(16)} var(--space-margin) calc(env(safe-area-inset-bottom) + var(--space-section))`,
        }}>
          {content}
        </div>
      </>)}

      {pickerOpen && (
        <SurahPickerSheet
          current={surah}
          reciter={reciter}
          playing={playing}
          onPick={n => { playSurah(n); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {reciterOpen && (
        <ReciterSheet
          current={reciter}
          onPick={id => { if (id !== reciter) audio.setReciter(id); setReciterOpen(false); }}
          onClose={() => setReciterOpen(false)}
        />
      )}
    </div>
  );
}

/** Варианты «Повтора суры»: значок + короткое слово (владелец 2026-11-16 —
 *  «иконками и текстом», без «Следующая сура» целиком). */
const SURAH_END_ICONS: Record<SurahEndMode, ReactNode> = {
  stop: <NoEntry size={17} />,
  next: <ArrowRight size={17} />,
  again: <Repeat size={17} />,
};
const SURAH_END_OPTIONS: readonly ChoiceOption<SurahEndMode>[] = SURAH_END_MODES.map(m => ({
  id: m, label: surahEndShort(m), ariaLabel: surahEndLabel(m), icon: SURAH_END_ICONS[m],
}));

/**
 * Клавиша чтеца и, если сура не скачана, кнопка загрузки рядом.
 *
 * Отдельный компонент ради подписки на ход загрузки (`useOfflineTick`):
 * проценты обновляются часто, и перерисовываться должна только эта строка,
 * а не весь экран с аркой.
 */
function ReciterRow({ reciter, surah, open, onOpen }: {
  reciter: ReciterId;
  /** null — суры нет (ничего не звучит или у чтеца её нет): без загрузки. */
  surah: number | null;
  open: boolean;
  onOpen: () => void;
}) {
  useOfflineTick();
  const label = reciterById(reciter).label;
  const downloaded = surah != null && surahOffline(reciter, surah).kind === 'done';
  return (<>
    <ReciterKey
      name={label}
      initials={reciterInitials(label)}
      downloaded={downloaded}
      open={open}
      onOpen={onOpen}
    />
    {surah != null && !downloaded && (
      <OfflinePill key={`${reciter}:${surah}`} reciter={reciter} surah={surah} />
    )}
  </>);
}

/**
 * Ползунок времени — для чтеца без границ аятов.
 *
 * Живёт отдельным компонентом ради подписки на тик: прогресс меняется
 * ~12 раз в секунду, и перерисовываться с этой частотой должен только
 * ползунок, а не весь экран с названием, чтецом и кнопками.
 *
 * 🔴 Перемотка — по ОТПУСКАНИЮ, а не на каждое движение пальца. Пока палец
 * ведёт бегунок, показывается только время под ним (`drag`); звук прыгает
 * один раз. Иначе каждое движение запускало бы новую подгрузку сетевого
 * файла с середины, и звук заикался бы всё время, пока палец на ползунке.
 *
 * Отпускание ловится и нативным `change`, и концом касания. Одного
 * `change` мало: если палец сдвинул бегунок и вернул его на то же
 * значение, `input` пришёл, а `change` — нет, и ползунок застывал бы на
 * месте пальца, пока звук идёт дальше (ревью 03.10.2026).
 *
 * Клавиатура перематывает тем же шагом, что и кнопки (10 с): шаг самого
 * поля — `any`, иначе браузер округлял бы позицию до целых секунд, и
 * бегунок расходился бы с заливкой.
 */
function SeekBar({ status, live }: { status: string | null; live: boolean }) {
  // Скрытая вкладка «Плеер» смонтирована всегда (листание вкладок), а тик
  // идёт каждый кадр — в том числе пока человек читает суру и подсвечивается
  // слово. Скрытому плееру тик не нужен вовсе: подписан на него только
  // видимый (`LiveSeekBar`), скрытый показывает последнее увиденное значение.
  // Раньше скрытый пересчитывал полосу раз в секунду, а без
  // `content-visibility` у парковки это ещё и раскладка (ревью 2026-10-05).
  const last = useRef({ progress: 0, duration: 0 });
  return live
    ? <LiveSeekBar status={status} last={last} />
    : <SeekBarView status={status} progress={last.current.progress} duration={last.current.duration} />;
}

/** Ползунок видимой вкладки: подписан на тик и запоминает последнее. */
function LiveSeekBar({ status, last }: {
  status: string | null;
  last: React.MutableRefObject<{ progress: number; duration: number }>;
}) {
  const { progress, duration } = useAudioTick();
  last.current = { progress, duration };
  return <SeekBarView status={status} progress={progress} duration={duration} />;
}

const SeekBarView = memo(function SeekBarView({ status, progress, duration }: {
  status: string | null;
  progress: number;
  duration: number;
}) {
  const audio = useAudioActions();
  const [drag, setDrag] = useState<number | null>(null);
  // Копия для нативных обработчиков: они вешаются один раз и не видят
  // свежий state.
  const dragRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startDrag = (value: number) => {
    dragRef.current = value;
    setDrag(value);
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const commit = () => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      setDrag(null);
      audio.seekTo(Number(el.value));
    };
    const events = ['change', 'pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'];
    events.forEach(name => el.addEventListener(name, commit));
    return () => events.forEach(name => el.removeEventListener(name, commit));
  }, [audio]);

  // Новый файл (смена чтеца, автопереход) — незавершённое перетаскивание
  // не должно перенести старую позицию на другую запись.
  useEffect(() => {
    dragRef.current = null;
    setDrag(null);
  }, [duration]);

  const known = duration > 0;
  const current = Math.min(duration, drag ?? progress * duration);
  const pct = known ? (current / duration) * 100 : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = TIMELINE_SEEK_STEP_SECONDS;
    const deltas: Record<string, number> = {
      ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step,
      PageDown: -6 * step, PageUp: 6 * step,
    };
    if (e.key in deltas) {
      e.preventDefault();
      audio.seekBy(deltas[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      audio.seekTo(0);
    }
  };

  return (
    <section style={{ display: 'grid', gap: 'var(--space-hair)' }}>
      <input
        ref={inputRef}
        type="range"
        className="seek-slider"
        min={0}
        max={known ? duration : 1}
        step="any"
        value={known ? current : 0}
        disabled={!known}
        onChange={e => startDrag(Number(e.currentTarget.value))}
        onKeyDown={onKeyDown}
        aria-label="Позиция в записи суры"
        aria-valuetext={known
          ? `${formatPlaybackTime(current)} из ${formatPlaybackTime(duration)}`
          : undefined}
        style={{ '--seek-pct': `${pct}%` } as CSSProperties}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--space-tight)',
        fontSize: 'var(--font-caption2)',
        lineHeight: 'var(--leading-caption2)',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span>{known ? formatPlaybackTime(current) : '0:00'}</span>
        {status && <span>{status}</span>}
        {/* Остаток, а не общая длина: так считают системные плееры, и он
            отвечает на вопрос «сколько ещё слушать». */}
        <span>{known ? `\u2212${formatPlaybackTime(duration - current)}` : '--:--'}</span>
      </div>
    </section>
  );
});

/**
 * Запомненное место у чтеца без границ аятов — неподвижная полоса.
 *
 * Та же геометрия, что у ползунка (`SeekBar`), но без подписки на тик и без
 * перетаскивания: звука ещё нет, перематывать нечего. Кнопка
 * воспроизведения продолжит ровно с этой секунды.
 */
function RestoredTimeBar({ seconds, duration, status }: {
  seconds: number;
  duration: number;
  status: string | null;
}) {
  const pct = Math.min(100, Math.max(0, (seconds / duration) * 100));
  return (
    <section style={{ display: 'grid', gap: 'var(--space-hair)' }}>
      <div
        role="progressbar"
        aria-label="Запомненное место в записи суры"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(seconds)}
        aria-valuetext={`${formatPlaybackTime(seconds)} из ${formatPlaybackTime(duration)}`}
        style={{ height: '28px', display: 'flex', alignItems: 'center' }}
      >
        <div style={{
          flex: 1, height: '4px', borderRadius: '2px',
          background: `linear-gradient(to right, var(--ink) 0 ${pct}%, var(--hairline) ${pct}% 100%)`,
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--space-tight)',
        fontSize: 'var(--font-caption2)',
        lineHeight: 'var(--leading-caption2)',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span>{formatPlaybackTime(seconds)}</span>
        {status && <span>{status}</span>}
        <span>{`\u2212${formatPlaybackTime(duration - seconds)}`}</span>
      </div>
    </section>
  );
}
