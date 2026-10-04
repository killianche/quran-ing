/**
 * OfflineAudioCard — загрузка только открытой суры в попапе чтения.
 *
 * Полные загрузки по чтецам вынесены в AccountScreen через
 * FullQuranAudioManager, чтобы настройки чтения не превращались в
 * отдельный экран управления файлами.
 *
 * Состояние не в компоненте: задание выполняется в
 * lib/audioDownloads.ts и продолжается при закрытом попапе.  Здесь
 * только подписка и перерисовка.
 *
 * В браузере офлайн-хранилища нет (чтобы `<audio>` читал Cache API,
 * нужен service worker с перехватом запросов), поэтому вместо кнопок
 * показываем честное пояснение.
 */

import { useEffect, useState } from 'react';
import { RECITERS, hasSurahAudio, reciterById, reciterHasSurah, supportsAyahOffline, type ReciterId } from '../lib/reciters';
import {
  getDownloadState, startDownload, pauseDownload, resetDownloadState,
  subscribeDownloads, estimateBytes, estimateSurahBytes, formatBytes, remainingAllBytes,
  type DownloadScope,
} from '../lib/audioDownloads';
import { optOutOfAutoDownload } from '../lib/audioAutoDownload';
import { ayahsInSurah } from '../lib/ayahNumbering';
import { TOTAL_SURAHS, clearAyahFiles, clearReciter, clearSurah, completeSurahCount, downloadedCount, downloadedInSurah, hasSurahFile, isOfflineSupported, isSurahComplete, subscribeAudioStore, surahFileCount } from '../lib/audioStore';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { settingCard, cardTitle } from './ReadingSettings';
import { Download, Trash, CheckCircle, Pause, ICON_SIZE } from './icons';

/** Перерисовка на любое изменение реестра или прогресса задания. */
function useDownloadsTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    const un1 = subscribeAudioStore(bump);
    const un2 = subscribeDownloads(bump);
    return () => { un1(); un2(); };
  }, []);
}

export function OfflineAudioCard({ reciter, surahNumber }: {
  reciter: ReciterId;
  surahNumber?: number;
}) {
  useDownloadsTick();
  const supported = isOfflineSupported();
  // Скачать можно и поаятные записи, и целую суру одним файлом — у чтецов
  // вроде Хьусейна Мержоева есть только второе. Прежде проверка смотрела лишь
  // на поаятные, и у него на каждой суре стояло «загрузка недоступна»
  // (владелец 2026-10-04: «эту информацию надо убрать»).
  const canDownload = supportsAyahOffline(reciter) || hasSurahAudio(reciter);
  // Без открытой суры или у чтеца без загрузки сказать нечего — карточки нет.
  if (surahNumber == null || !canDownload) return null;
  const recorded = reciterHasSurah(reciter, surahNumber);

  return (
    <section style={{ ...settingCard, marginTop: '10px' }}>
      <p style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Download size={ICON_SIZE.sm} />
        Скачать эту суру
      </p>

      {!supported ? (
        <p style={{
          margin: 0, fontSize: 'var(--font-caption1)', lineHeight: 1.5,
          color: 'var(--text-secondary)',
        }}>
          Скачивание доступно в приложении для iPhone.
        </p>
      ) : recorded ? (
        <SurahRow reciter={reciter} surah={surahNumber} />
      ) : (
        // Сура, которой у чтеца нет (`availableSurahs`): скачивать нечего.
        <p style={{ margin: 0, fontSize: 'var(--font-caption1)', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          У чтеца {reciterById(reciter).label} пока нет записи этой суры.
        </p>
      )}
    </section>
  );
}

/** Управление полными записями Корана — отдельный раздел «Аккаунта». */
export function FullQuranAudioManager() {
  useDownloadsTick();

  if (!isOfflineSupported()) {
    return (
      <p style={{ margin: 0, padding: '14px 16px', fontSize: 'var(--font-caption1)', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        Полные записи можно скачать в приложении для iPhone.
      </p>
    );
  }

  return (
    <div>
      {RECITERS.filter(r => supportsAyahOffline(r.id) || hasSurahAudio(r.id)).map((r, index, list) => (
        <div
          key={r.id}
          style={{
            padding: '14px 16px',
            borderBottom: index < list.length - 1 ? '1px solid var(--hairline)' : 'none',
          }}
        >
          <ReciterRow id={r.id} label={r.label} />
        </div>
      ))}
      <p style={{ margin: 0, padding: '0 16px 14px', fontSize: 'var(--font-caption2)', lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
        Здесь скачивается весь Коран выбранного чтеца. Отдельную суру можно скачать в настройках её чтения.
      </p>
    </div>
  );
}

// ─── Строка текущей суры ────────────────────────────────────────────────

function SurahRow({ reciter, surah }: { reciter: ReciterId; surah: number }) {
  const meta = SURAH_BY_NUMBER[surah];
  const total = ayahsInSurah(surah);
  const have = downloadedInSurah(reciter, surah);
  // 🔴 Сура считается скачанной и тогда, когда лежит СПЛОШНОЙ записью.
  //
  // Прежняя проверка смотрела только на поаятные файлы. После перехода на
  // сплошную запись их не появляется вовсе, и успешно скачанная сура
  // показывалась бы пустой — человек скачал бы её второй раз.
  const asSurahFile = hasSurahFile(reciter, surah);
  const complete = asSurahFile || isSurahComplete(reciter, surah);
  const st = getDownloadState(reciter);
  const running = st.status === 'running';
  const busyOnThis = running && st.scope?.kind === 'surah' && st.scope.surah === surah;
  // Отказ или обрыв загрузки ЭТОЙ суры — сказать, иначе нажатие на
  // «Скачать» выглядело бы как ничего не сделавшее.
  const failedHere = !running && st.error != null
    && st.scope?.kind === 'surah' && st.scope.surah === surah;
  // Пауза посреди файла этой суры: часть уже на диске, «Скачать» продолжит
  // с того же места — так и показываем, а не пустой шкалой и полным объёмом.
  const pausedHere = !running && !complete && st.status === 'paused'
    && st.scope?.kind === 'surah' && st.scope.surah === surah && st.bytesTotal > 0;

  return (
    <div style={{
      display: 'grid', gap: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 'var(--font-caption1)', fontWeight: 'var(--weight-regular)',
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {meta?.transliteration ?? `Сура ${surah}`}
          <span style={{ display: 'block', marginTop: '3px', fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-regular)', color: 'var(--text-tertiary)' }}>
            {reciterById(reciter).label}
          </span>
        </span>

        {complete ? (
          <ActionButton
            label="Удалить с устройства"
            icon={<Trash size={ICON_SIZE.sm} />}
            onClick={() => { void clearSurah(reciter, surah); }}
          />
        ) : running ? (
          <ActionButton
            label="Пауза"
            icon={<Pause size={ICON_SIZE.sm} />}
            onClick={() => {
              pauseDownload(reciter);
              // Если человек останавливает НЕ ту загрузку, которую сам
              // затеял для этой суры, значит он останавливает фоновую
              // автозагрузку всего Корана. Тогда это отказ от неё — иначе
              // она вернётся при следующем появлении Wi-Fi, и кнопка будет
              // выглядеть неработающей (правило записано в
              // `audioAutoDownload.ts`, но здесь раньше не соблюдалось).
              //
              // А вот паузу СВОЕЙ загрузки суры отказом считать нельзя:
              // человек остановил одну суру, а не отказался от офлайна.
              if (!busyOnThis) void optOutOfAutoDownload();
            }}
          />
        ) : (
          <ActionButton
            label={have > 0 || pausedHere ? 'Докачать суру' : 'Скачать суру'}
            icon={<Download size={ICON_SIZE.sm} />}
            onClick={() => { void startDownload(reciter, { kind: 'surah', surah }); }}
          />
        )}
      </div>

      {/* Во время сплошной загрузки поаятных отметок не появляется, и шкала
          по аятам стояла бы на нуле все несколько минут — человек решил бы,
          что зависло. Пока идёт эта сура, показываем байты. */}
      {(busyOnThis || pausedHere) && st.bytesTotal > 0
        ? <Meter value={st.bytes} max={st.bytesTotal} />
        : <Meter value={asSurahFile ? total : have} max={total} />}

      <span style={{ ...meta_, color: failedHere && st.status === 'error' ? 'var(--danger)' : meta_.color }}>
        {failedHere && !complete
          ? st.error
          : pausedHere
          ? `На паузе: ${formatBytes(st.bytes)} из ${formatBytes(st.bytesTotal)}`
          : busyOnThis && st.bytesTotal > 0
          ? `Качаю одной записью: ${formatBytes(st.bytes)} из ${formatBytes(st.bytesTotal)}`
          : asSurahFile
          ? 'Эта сура есть офлайн одной записью — читается без стыков'
          : complete
          ? 'Эта сура есть офлайн'
          : running && !busyOnThis
          ? 'Для этого чтеца уже идёт другая загрузка. Управление — в разделе «Аккаунт».'
          : !supportsAyahOffline(reciter)
          // Только целыми сурами — счёт по аятам здесь ничего не значит.
          ? `Скачается одной записью · ${formatBytes(estimateSurahBytes(reciter, surah))}`
          : `${have} из ${total} аятов · ≈ ${formatBytes(estimateBytes(reciter, total - have))} осталось`}
      </span>
    </div>
  );
}

// ─── Строка чтеца ───────────────────────────────────────────────────────

function ReciterRow({ id, label }: {
  id: ReciterId; label: string;
}) {
  const have = downloadedCount(id);
  const suras = completeSurahCount(id);
  const сплошных = surahFileCount(id);
  // 🔴 Считаем СУРАМИ, а не аятами.
  //
  // Фонотека собирается сплошными записями — 114 файлов вместо 6236. Шкала
  // по аятам после перехода стояла бы почти на нуле у человека, у которого
  // на диске уже полКорана: поаятных отметок сплошная запись не создаёт.
  //
  // Складывать напрямую нельзя: сура, скачанная и поаятно, и сплошной
  // записью, посчиталась бы дважды — получилось бы «115 из 114».
  // Сколько сур у чтеца вообще записано: у Хьусейна Мержоева 80 из 114, и
  // «собрано» для него — 80, а не недостижимые 114.
  const всего = reciterById(id).availableSurahs?.length ?? TOTAL_SURAHS;
  const целиком = Math.min(всего, suras + сплошных);
  const непрерывно = hasSurahAudio(id);
  // 🔴 «Собрано» — это собрано СПЛОШНЫМИ записями, а не «есть хоть как-то».
  //
  // Ревью поймало тупик: у человека со старой поаятной фонотекой (114 полных
  // сур из 6236 файлов) строка считалась завершённой, и оставалась одна
  // кнопка — «Удалить». Автозагрузка ему тоже не полагается, чтобы не класть
  // рядом второй комплект. Получалось, что именно тот, ради кого делалась
  // правка, не мог получить чтение без швов, не стерев сперва 1.4 ГБ.
  //
  // Теперь у него есть обе кнопки: «Скачать сплошными» и «Удалить старое».
  const собрано = непрерывно ? сплошных >= всего : целиком >= всего;
  const естьЧтоУдалить = целиком > 0 || have > 0;
  const st = getDownloadState(id);
  const running = st.status === 'running';
  // Полоса показывает то, что реально даёт чтение без швов.
  const шкала = непрерывно ? сплошных : целиком;
  // Точный остаток в байтах — только у чтеца с известными размерами файлов.
  //
  // Пока идёт или стоит на паузе задание «все записи», остаток берём из него:
  // там учтены и уже пришедшие куски недокачанной суры. Иначе — по отметкам
  // целых файлов на диске.
  const заданиеВсех = st.scope?.kind === 'all' && st.bytesTotal > 0
    && (st.status === 'running' || st.status === 'paused');
  const осталосьБайт = заданиеВсех
    ? Math.max(0, st.bytesTotal - st.bytes)
    : remainingAllBytes(id);
  const осталось = осталосьБайт != null && осталосьБайт > 0
    ? `осталось ${formatBytes(осталосьБайт)}`
    : null;

  const ALL: DownloadScope = { kind: 'all' };

  return (
    <div style={{ display: 'grid', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 'var(--font-caption1)', fontWeight: 'var(--weight-regular)',
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label}
        </span>

        {собрано && !running && (
          <span aria-hidden style={{ display: 'inline-flex', color: 'var(--text-tertiary)' }}>
            <CheckCircle size={ICON_SIZE.sm} />
          </span>
        )}

        {running ? (
          <ActionButton
            label="Пауза"
            icon={<Pause size={ICON_SIZE.sm} />}
            onClick={() => {
              pauseDownload(id);
              // Ручная пауза = отказ от автозагрузки: раз человек
              // остановил, приложение больше не начинает само.
              void optOutOfAutoDownload();
            }}
          />
        ) : (
          <>
            {!собрано && (
              <ActionButton
                label={шкала > 0 ? 'Докачать' : всего < TOTAL_SURAHS ? 'Скачать все записи' : 'Скачать весь Коран'}
                icon={<Download size={ICON_SIZE.sm} />}
                onClick={() => { void startDownload(id, ALL); }}
              />
            )}
            {естьЧтоУдалить && (
              <ActionButton
                label="Удалить"
                icon={<Trash size={ICON_SIZE.sm} />}
                onClick={() => {
                  void clearReciter(id).then(() => resetDownloadState(id));
                }}
              />
            )}
          </>
        )}
      </div>

      {/* 🔴 Предложение заменить старую поаятную фонотеку.
          Владелец 09.09.2026 разрешил предложить это людям.

          У тех, кто качал до 06.09.2026, на диске лежат тысячи поаятных
          файлов — до 1.4 ГБ, которые больше ничего не дают: играет сплошная
          запись. Сами мы их не удаляем и никогда не удалим молча: это данные
          человека, и он их однажды сознательно скачал. Поэтому здесь ровно
          два шага, и оба делает он сам.

          Шаг первый показывается, пока сплошных записей нет; шаг второй —
          когда они уже скачаны и старые файлы стали лишними. */}
      {have > 0 && непрерывно && !running && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-snug)',
          padding: 'var(--space-snug) 0 0',
        }}>
          <span style={{ ...meta_, flex: 1, minWidth: 0 }}>
            {собрано
              ? `Старые файлы больше не нужны: ${have} аятов, ≈ ${formatBytes(estimateBytes(id, have))}`
              : `${have} аятов скачаны по-старому — они играют со стыками`}
          </span>
          {собрано ? (
            <ActionButton
              label="Освободить"
              icon={<Trash size={ICON_SIZE.sm} />}
              onClick={() => { void clearAyahFiles(id); }}
            />
          ) : (
            <ActionButton
              label="Заменить"
              icon={<Download size={ICON_SIZE.sm} />}
              onClick={() => { void startDownload(id, ALL); }}
            />
          )}
        </div>
      )}

      <Meter value={шкала} max={всего} />

      <span style={{
        ...meta_,
        color: st.status === 'error' ? 'var(--danger)' : 'var(--text-tertiary)',
      }}>
        {st.status === 'error'
          ? st.error
          : собрано
          ? (всего < TOTAL_SURAHS
            ? `Все записи чтеца офлайн · ${всего} сур`
            : `Весь Коран офлайн · ${всего} сур одной записью`)
          : running
          // Единицы задания зависят от того, что качается: сплошные записи
          // считаются сурами, аварийный поаятный путь — аятами. Одна подпись
          // на оба случая давала «0 из 1 сур» и «12 из 286 сур».
          ? `Качаю ${st.done} из ${st.total} ${st.scope?.kind === 'all' && непрерывно ? 'сур' : 'файлов'} · ${formatBytes(st.bytes)}${заданиеВсех && осталось ? ` · ${осталось}` : ''}`
          : шкала > 0
          ? `${шкала} из ${всего} сур одной записью${have > 0 ? ` · и ${have} аятов по старому` : ''}${осталось ? ` · ${осталось}` : ''}`
          : have > 0
          // Старая фонотека: играет офлайн, но со стыками на границах аятов.
          ? `${suras} сур по аятам — офлайн есть, но со стыками. «Скачать» даст чтение без них`
          : `Не скачано — играет стримом${осталосьБайт ? ` · ${formatBytes(осталосьБайт)}` : ''}`}
      </span>
    </div>
  );
}

// ─── Мелочи ─────────────────────────────────────────────────────────────

const meta_: React.CSSProperties = {
  fontSize: 'var(--font-caption2)',
  color: 'var(--text-tertiary)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.35,
};

function ActionButton({ label, icon, onClick }: {
  label: string; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        flexShrink: 0, minHeight: '30px', padding: '0 10px',
        borderRadius: '8px',
        border: '1px solid var(--hairline-strong)',
        background: 'transparent',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-regular)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/** Полоса прогресса.  Не рисуем пустой жёлоб на нетронутом чтеце —
 *  он читается как ошибка, а не как «ещё ничего нет». */
function Meter({ value, max }: { value: number; max: number }) {
  if (value <= 0 || max <= 0) return null;
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      style={{
        height: '3px', borderRadius: '2px',
        background: 'var(--hairline)', overflow: 'hidden',
      }}
    >
      <div style={{
        height: '100%', width: `${pct}%`,
        background: 'var(--text-primary)', opacity: 0.7,
        transition: 'width 240ms ease',
      }} />
    </div>
  );
}
