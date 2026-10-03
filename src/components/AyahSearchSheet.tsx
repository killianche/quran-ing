/**
 * AyahSearchSheet — поиск по переводу с экрана чтения.
 *
 * Открывается кнопкой в шапке суры и по умолчанию ищет ВНУТРИ этой
 * суры: человек уже читает конкретный текст, и «найти у себя» — самый
 * частый запрос.  Переключателем область расширяется на весь Коран.
 *
 * Почему область по умолчанию узкая, а не «везде»: поиск по всему
 * Корану уже есть на главном экране.  Дублировать его здесь означало
 * бы, что кнопка в шапке суры делает ровно то же самое, что кнопка
 * этажом выше, — тогда она не нужна.  Ценность именно в сужении.
 *
 * Переключатель не прячется, когда в текущей суре ничего не нашлось:
 * вместо пустого экрана человек видит подсказку «в этой суре ничего,
 * посмотреть везде» — то есть путь дальше, а не тупик.
 *
 * Результаты — та же строка, что и в поиске на главной (фрагмент с
 * подсвеченным совпадением), чтобы два поиска не выглядели как две
 * разные функции.
 */

import { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import { SettingsSheet } from './ReadingSettings';
import { AYAH_LANG_LABEL, search, snippet, visibleSearchLangs, warmSearchIndex, type AyahHit } from '../lib/search';
import { useQuranSources } from '../content/quran-sources-lazy';
import { Search, Close, ICON_SIZE } from './icons';

type Scope = 'surah' | 'all';

type Props = {
  /** Сура, из которой открыли поиск. */
  surahNumber: number;
  /** Название суры для подписи переключателя. */
  surahTitle: string;
  onClose: () => void;
  /** Совпадение в текущей суре — прокрутить к аяту. */
  onJumpInSurah: (ayah: number) => void;
  /** Совпадение в другой суре — открыть её на нужном аяте. */
  onOpenOtherSurah: (surah: number, ayah: number) => void;
};

export function AyahSearchSheet({
  surahNumber, surahTitle, onClose, onJumpInSurah, onOpenOtherSurah,
}: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('surah');
  const inputRef = useRef<HTMLInputElement>(null);

  // Фокус после появления панели: без задержки на кадр iOS иногда
  // открывает клавиатуру раньше, чем панель доехала, и она прыгает.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const deferred = useDeferredValue(query);
  // Панель поиска открывается явным действием — словарь переводов тянем
  // сразу при монтировании, не дожидаясь первой буквы.
  const sourcesReady = useQuranSources(true) != null;
  // Поисковый словарь — порциями в фоне, пока человек набирает запрос.
  useEffect(() => { warmSearchIndex(); }, []);
  // Ищем в тех переводах, что видны в ленте; читаются один раз за открытие.
  const langs = useMemo(visibleSearchLangs, []);
  const results = useMemo(
    () => search(deferred, scope === 'surah' ? { surah: surahNumber, langs } : { langs }),
    // sourcesReady намеренно в зависимостях: выдачу надо пересчитать, когда
    // словарь доехал, хотя сам запрос не менялся.
    [deferred, scope, surahNumber, sourcesReady],
  );

  // Сколько нашлось бы во всём Коране — нужно, чтобы честно предложить
  // расширить область, а не гнать наугад.  Считается только когда в
  // своей суре пусто, так что лишней работы нет.
  const allCount = useMemo(() => {
    if (scope !== 'surah' || results.ayahs.length > 0) return 0;
    if (deferred.trim().length < 3) return 0;
    return search(deferred, { langs }).ayahs.length;
  }, [deferred, scope, results.ayahs.length, sourcesReady, langs]);

  const searching = query.trim().length > 0;

  return (
    <SettingsSheet onClose={onClose} title="Поиск по переводу">
      {/* Поле ввода */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        height: '46px', padding: '0 13px',
        borderRadius: '13px',
        background: 'rgb(var(--ink-rgb) / 0.05)',
        border: '1px solid var(--hairline)',
        marginBottom: '12px',
      }}>
        <span aria-hidden style={{ color: 'var(--text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
          <Search size={ICON_SIZE.md} />
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Слово из перевода"
          aria-label="Поиск по переводу"
          enterKeyHint="search"
          style={{
            flex: 1, minWidth: 0,
            border: 'none', outline: 'none', background: 'transparent',
            color: 'var(--text-primary)',
            fontFamily: 'inherit', fontSize: 'var(--font-subhead)',
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            aria-label="Очистить"
            className="icon-btn"
            style={{ width: '28px', height: '28px', flexShrink: 0, color: 'var(--text-tertiary)' }}
          >
            <Close size={ICON_SIZE.sm} />
          </button>
        )}
      </div>

      {/* Область поиска */}
      <div
        role="tablist"
        aria-label="Где искать"
        style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: '4px', padding: '3px',
          borderRadius: '11px',
          background: 'rgb(var(--ink-rgb) / 0.05)',
          border: '1px solid var(--hairline)',
          marginBottom: '14px',
        }}
      >
        {([
          { id: 'surah' as Scope, label: surahTitle },
          { id: 'all' as Scope, label: 'Весь Коран' },
        ]).map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={scope === t.id}
            onClick={() => setScope(t.id)}
            style={{
              minHeight: '34px',
              padding: '0 8px',
              borderRadius: '9px',
              border: 'none',
              background: scope === t.id ? 'var(--surface)' : 'transparent',
              boxShadow: scope === t.id ? 'inset 0 0 0 1px var(--hairline)' : 'none',
              color: scope === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 'var(--font-footnote)',
              fontWeight: scope === t.id ? 600 : 500,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              transition: 'background 140ms ease, color 140ms ease',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Результаты */}
      {!searching && (
        <p style={{
          padding: '18px 4px 6px', fontSize: 'var(--font-footnote)', lineHeight: 1.55,
          color: 'var(--text-tertiary)',
        }}>
          Найдёт аят по любому слову из ингушского или русского перевода.
        </p>
      )}

      {searching && results.tooShortForText && (
        <p style={{ padding: '18px 4px 6px', fontSize: 'var(--font-footnote)', color: 'var(--text-tertiary)' }}>
          Введите хотя бы три буквы.
        </p>
      )}

      {searching && results.notReady && (
        <p style={{ padding: '18px 4px 6px', fontSize: 'var(--font-footnote)', color: 'var(--text-tertiary)' }}>
          Готовим перевод…
        </p>
      )}

      {searching && !results.notReady && !results.tooShortForText && results.ayahs.length === 0 && (
        <div style={{ padding: '18px 4px 6px' }}>
          <p style={{ margin: 0, fontSize: 'var(--font-footnote)', color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
            {scope === 'surah'
              ? `В суре «${surahTitle}» ничего не найдено.`
              : 'Ничего не найдено.'}
          </p>
          {scope === 'surah' && allCount > 0 && (
            <button
              onClick={() => setScope('all')}
              style={{
                marginTop: '10px', padding: '9px 14px',
                borderRadius: '10px',
                border: '1px solid var(--hairline)',
                background: 'rgb(var(--ink-rgb) / 0.05)',
                color: 'var(--text-primary)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--font-footnote)', fontWeight: 'var(--weight-regular)',
              }}
            >
              Искать во всём Коране — {allCount}
            </button>
          )}
        </div>
      )}

      {searching && results.ayahs.length > 0 && (
        <div>
          <p style={{
            margin: '0 0 6px', padding: '0 4px',
            fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-semibold)', letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--text-tertiary)',
          }}>
            Найдено · {results.ayahs.length}{results.truncated ? '+' : ''}
          </p>
          {results.ayahs.map(h => (
            <HitRow
              key={`${h.surah}:${h.ayah}`}
              hit={h}
              sameSurah={h.surah === surahNumber}
              onClick={() => {
                onClose();
                if (h.surah === surahNumber) onJumpInSurah(h.ayah);
                else onOpenOtherSurah(h.surah, h.ayah);
              }}
            />
          ))}
        </div>
      )}
    </SettingsSheet>
  );
}

function HitRow({ hit, sameSurah, onClick }: {
  hit: AyahHit;
  sameSurah: boolean;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const s = snippet(hit, 48);
  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '11px 6px',
        border: 'none',
        borderBottom: '1px solid var(--hairline-soft, var(--hairline))',
        background: pressed ? 'rgb(var(--ink-rgb) / 0.05)' : 'transparent',
        cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
        transition: 'background 120ms ease',
      }}
    >
      <span style={{
        display: 'inline-block', marginBottom: '5px',
        padding: '3px 8px', borderRadius: '9999px',
        border: '1px solid var(--hairline)',
        fontSize: 'var(--font-caption2)', fontWeight: 'var(--weight-regular)', lineHeight: 1,
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {/* Внутри своей суры номер суры не нужен — он и так известен. */}
        {sameSurah ? `Аят ${hit.ayah}` : `${hit.surahTitle} · ${hit.surah}:${hit.ayah}`}
        {' · '}{AYAH_LANG_LABEL[hit.lang]}
      </span>
      <span lang={hit.lang} style={{
        display: 'block',
        fontSize: 'var(--font-footnote)', lineHeight: 1.5,
        color: 'var(--text-secondary)',
      }}>
        {s.before}
        <mark style={{
          background: 'rgb(var(--ink-rgb) / 0.14)',
          color: 'var(--text-primary)',
          borderRadius: '3px', padding: '0 2px', fontWeight: 'var(--weight-semibold)',
        }}>
          {s.match}
        </mark>
        {s.after}
      </span>
    </button>
  );
}
