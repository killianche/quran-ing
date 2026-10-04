/**
 * TafsirSheet — окно «Тафсир ас-Саади» по кнопке у аята.
 *
 * Нижняя панель (SettingsSheet): смах вниз, системный «назад» и Esc её
 * закрывают, содержимое прокручивается.
 *
 * Что внутри — только толкование (владелец 2026-10-04: «открывалось только
 * толкование: для каких аятов оно и само толкование; повторять арабский,
 * ингушский и русский не нужно»):
 *   1. к каким аятам толкование — «Фуссилят · аяты 1–8» (ас-Саади толкует
 *      фрагментами; аят, по которому открыли, — в той же строке);
 *   2. текст толкования — шрифтом и кеглем русского перевода из настроек;
 *   3. подпись источника.
 *
 * Прежде здесь была карточка аята (арабский, ингушский, русский) и
 * «Все аяты фрагмента» — сняты, аят и так на экране под шторкой. Правило
 * видимости из CLAUDE.md здесь не нарушается: шторка не цитирует аят, а
 * ссылается на него номером; текст толкования — дословно из источника
 * (lib/tafsir.ts, QURAN_SOURCES.md).
 *
 * Данные — lib/tafsir.ts; грузится только файл открытой суры.
 */

import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { SettingsSheet } from './ReadingSettings';
import {
  TAFSIR_ATTRIBUTION, TAFSIR_TITLE,
  loadSurahTafsir, tafsirGroupFor, tafsirParagraphs,
  type TafsirGroup,
} from '../lib/tafsir';
import { latinIsSerif, latinStack, latinWeight, type LatinFontId } from '../lib/typography';

type Props = {
  surah: number;
  ayah: number;
  surahTitle: string;
  ruFont: LatinFontId;
  ruScale: number;
  onClose: () => void;
};

type State =
  | { status: 'loading' }
  | { status: 'ready'; group: TafsirGroup | undefined }
  | { status: 'error' };

/**
 * memo: экран суры перерисовывается на каждом тике аудио (~60 раз в секунду
 * во время чтения).  Без memo вместе с ним перерисовывалось бы и окно — до
 * 69 карточек аятов и 50 КБ толкования.  Все пропсы стабильны по ссылке
 * (колбэки — useCallback в SurahScreen).
 */
export const TafsirSheet = memo(function TafsirSheet(p: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    loadSurahTafsir(p.surah).then(
      data => { if (alive) setState({ status: 'ready', group: tafsirGroupFor(data, p.ayah) }); },
      () => { if (alive) setState({ status: 'error' }); },
    );
    return () => { alive = false; };
  }, [p.surah, p.ayah, attempt]);

  const group = state.status === 'ready' ? state.group : undefined;
  const isFragment = !!group && group.to > group.from;
  const paragraphs = useMemo(() => (group ? tafsirParagraphs(group.text) : []), [group]);

  return (
    <SettingsSheet onClose={p.onClose} title={TAFSIR_TITLE} placement="bottom-sheet">
      {/* К каким аятам толкование. Пока файл грузится — аят, по которому
          открыли; затем — весь фрагмент, который толкует ас-Саади. */}
      <p style={scope}>
        {p.surahTitle} · {isFragment ? `аяты ${group!.from}–${group!.to}` : `аят ${p.ayah}`}
      </p>

      <section aria-label="Толкование">

        {state.status === 'loading' && (
          <div aria-busy="true" aria-label="Загрузка тафсира" style={{ display: 'grid', gap: '10px' }}>
            {[96, 100, 88, 94, 62].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: '14px', borderRadius: '4px', width: `${w}%` }} />
            ))}
          </div>
        )}

        {state.status === 'error' && (
          <div role="alert" style={{ display: 'grid', gap: '10px', justifyItems: 'start' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-subhead)' }}>
              Не удалось загрузить тафсир.
            </p>
            <button type="button" onClick={() => setAttempt(n => n + 1)} style={retryButton}>
              Повторить
            </button>
          </div>
        )}

        {state.status === 'ready' && !group && (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-subhead)' }}>
            Для этого аята толкования в источнике нет.
          </p>
        )}

        {state.status === 'ready' && group && (
          <div lang="ru" style={{
            fontFamily: latinStack(p.ruFont),
            fontWeight: latinWeight(p.ruFont),
            fontSize: translationFontSize(p.ruFont, p.ruScale),
            lineHeight: 1.6,
            color: 'var(--text-primary)',
            letterSpacing: '-0.005em',
          }}>
            {paragraphs.map((paragraph, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : '0.85em 0 0' }}>{paragraph}</p>
            ))}
          </div>
        )}
      </section>

      <p style={{ ...caption, margin: '22px 0 4px', lineHeight: 1.45 }}>{TAFSIR_ATTRIBUTION}</p>
    </SettingsSheet>
  );
});

/** Кегль перевода — та же формула, что в ленте (SurahScreen/AyahRow). */
function translationFontSize(font: LatinFontId, scale: number): string {
  const serifBump = scale >= 1.4 ? 10 : 5;
  return latinIsSerif(font)
    ? `calc(16px * ${scale} + ${serifBump}px)`
    : `calc(16px * ${scale})`;
}

/** Строка «Сура · аяты от–до» — главный ориентир окна. */
const scope: CSSProperties = {
  margin: '0 0 14px',
  fontSize: 'var(--font-subhead)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--text-secondary)',
  letterSpacing: '-0.005em',
};

const caption: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 'var(--font-caption1)',
  color: 'var(--text-tertiary)',
  letterSpacing: '0.01em',
};

const retryButton: CSSProperties = {
  minHeight: '44px',
  padding: '0 18px',
  border: '1px solid var(--hairline)',
  borderRadius: '12px',
  background: 'rgb(var(--ink-rgb) / 0.05)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 'var(--font-footnote)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};
