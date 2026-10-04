/**
 * AudioErrorPlate — «чтение оборвалось, вот почему».
 *
 * ── Почему это нужно ──────────────────────────────────────────────────
 *
 * Сплошная запись чтеца идёт из сети. Когда связи нет, плеер раньше
 * просто останавливался: ни звука, ни слова о причине — со стороны это
 * выглядит как поломка приложения. На это же указал рецензент Apple.
 *
 * ── Почему плашка, а не молчаливый повтор ─────────────────────────────
 *
 * Повтор внутри уже есть: один раз тот же источник, потом поаятный файл,
 * если он лежит на устройстве. Сюда мы попадаем, когда исчерпано и это,
 * то есть играть действительно нечем. Тогда честнее сказать словами и
 * дать кнопку, чем бесконечно долбиться в мёртвую сеть.
 *
 * ── Почему над мини-плеером ───────────────────────────────────────────
 *
 * В момент отказа чтение остановлено, и мини-плеер уже исчез — место
 * свободно. Координата считается от той же точки, что у него, чтобы
 * плашка вставала ровно туда же, а не «примерно там».
 */

import { useAudioActions, useAudioState } from '../hooks/AudioProvider';
import { GLASS_BLUR } from '../lib/glass';
import { accessoryBottom, type AccessoryPlacement } from './TabBar';
import { SURAH_BY_NUMBER } from '../content/surahs';
import { formatPlaybackTime } from '../lib/playbackTime';

const GAP = 8;

export function AudioErrorPlate({ placement = 'tabs' }: { placement?: AccessoryPlacement } = {}) {
  const { failure } = useAudioState();
  const { handlePlay, dismissFailure } = useAudioActions();
  if (!failure) return null;

  const название = SURAH_BY_NUMBER[failure.surah]?.transliteration ?? `Сура ${failure.surah}`;
  // Две короткие строки, а не абзац: первая говорит ЧТО случилось, вторая —
  // про что именно. Длинный текст переносился на три строки и обрезался
  // многоточием, то есть сообщал меньше, чем короткий.
  const заголовок = failure.offline ? 'Нет связи' : 'Не удалось загрузить чтение';
  // У чтеца без границ аятов место обрыва — время записи: «аят 1» на
  // 25-й минуте был бы неправдой.
  const место = failure.positionSeconds !== undefined
    ? formatPlaybackTime(failure.positionSeconds)
    : `аят ${failure.ayah}`;
  const пояснение = failure.offline
    ? `«${название}» читается из сети`
    : `«${название}», ${место}`;

  return (
    <div
      role="alert"
      className="liquid-glass"
      style={{
        // Размытие обязательно: без него сквозь стекло читается карточка
        // суры, и сообщение об отказе тонет в тексте под ним.
        ...GLASS_BLUR,
        position: 'fixed',
        left: '12px',
        right: '12px',
        bottom: accessoryBottom(placement, GAP),
        zIndex: 40,
        maxWidth: '560px',
        margin: '0 auto',
        minHeight: '58px',
        borderRadius: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          lineHeight: 1.25,
          color: 'var(--text-primary)',
        }}>
          {заголовок}
        </div>
        <div style={{
          marginTop: '2px',
          fontSize: '12px',
          lineHeight: 1.3,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {пояснение}
        </div>
      </div>
      <button
        type="button"
        // Повтор — с места обрыва: у чтеца без границ аятов это секунда
        // записи, у остальных начало того же аята.
        onClick={() => handlePlay(
          failure.surah, failure.ayah, failure.lastAyah, failure.positionSeconds,
        )}
        style={{
          flexShrink: 0,
          minHeight: '38px',
          padding: '0 14px',
          borderRadius: '9999px',
          border: '1px solid var(--hairline-strong)',
          background: 'transparent',
          color: 'var(--text-primary)',
          fontFamily: 'inherit',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Повторить
      </button>
      <button
        type="button"
        aria-label="Скрыть сообщение"
        onClick={dismissFailure}
        style={{
          flexShrink: 0,
          width: '38px',
          height: '38px',
          display: 'grid',
          placeItems: 'center',
          borderRadius: '9999px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
          <path
            d="M2.5 2.5 12.5 12.5M12.5 2.5 2.5 12.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
