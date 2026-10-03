/**
 * FontErrorBanner — «шрифт мусхафа не приехал, попробовать ещё раз».
 *
 * ── Почему это отдельное состояние, а не молчание ─────────────────────
 *
 * Слова мусхафа — готовые глифы в приватной области Unicode.  Если файл
 * не загрузился, показать текст нечем: системные шрифты этих кодов не
 * знают и рисуют ряды пустых квадратов.  Кубики на месте аята выглядят
 * как испорченный Коран, поэтому текст в таком случае не рисуется вовсе
 * (см. useQcfFont) — а человеку нужно объяснить, почему на экране
 * заготовки строк, и дать кнопку.
 *
 * ── Почему одна плашка на экран ───────────────────────────────────────
 *
 * Не приезжает обычно не один файл, а страница целиком, то есть сразу
 * десяток аятов.  Сообщение у каждого превратило бы чтение в список
 * ошибок; общая строка сверху говорит то же самое один раз.
 *
 * Повтор общий: он пересоздаёт правила для всех неудавшихся семейств
 * разом, потому что причина у них одна — сеть.
 */

import { useQcfFontFailure } from '../hooks/useQcfFont';
import type { QcfEdition } from '../lib/qcf4';
import { useTajweedFontFailure } from '../hooks/useTajweedFont';

type Props = {
  source?: 'qcf' | 'both';
  /**
   * Показывать неудачи только этого издания мусхафа.
   *
   * Лента издание не передаёт — она рисует оба, и там честнее показывать
   * любую неудачу.  (Раньше издание передавал полноэкранный мусхаф; в
   * Quran Ing этого режима нет.)
   */
  edition?: QcfEdition;
};

export function FontErrorBanner({ source = 'qcf', edition }: Props) {
  const qcf = useQcfFontFailure(edition);
  const tajweed = useTajweedFontFailure();
  const tajweedFailed = source === 'both' && tajweed.failed;
  const failed = qcf.failed || tajweedFailed;
  if (!failed) return null;

  const retry = () => {
    if (qcf.failed) qcf.retry();
    if (tajweedFailed) tajweed.retry();
  };

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        margin: '8px 0 16px',
        padding: '12px 14px',
        borderRadius: '14px',
        border: '1px solid var(--hairline-strong)',
        background: 'rgb(var(--ink-rgb) / 0.05)',
      }}
    >
      <span style={{
        flex: 1,
        minWidth: 0,
        fontSize: '14px',
        lineHeight: 1.4,
        color: 'var(--text-secondary)',
      }}>
        {tajweedFailed
          ? 'Не удалось загрузить цветной шрифт таджвида. Пока показан обычный шрифт мусхафа.'
          : 'Не удалось загрузить шрифт мусхафа. Арабский текст появится, когда файл дойдёт.'}
      </span>
      <button
        onClick={retry}
        style={{
          flexShrink: 0,
          minHeight: '34px',
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
    </div>
  );
}
