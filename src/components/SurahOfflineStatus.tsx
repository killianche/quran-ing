/**
 * Скачана ли сура — на экране плеера и в шторке «Суры».
 *
 * Владелец 2026-10-06: «в плеере хорошо бы видеть, какая сура скачана, какая
 * докачивается — микроинформацию, значок рядом со скачанной».
 *
 * Как в Музыке iOS:
 * - `OfflinePill` — кнопка-статус в нижнем ряду плеера: «Скачать · 54 МБ»
 *   (тап — загрузка этой суры), кольцо с процентом во время загрузки (тап —
 *   пауза), «Докачать» после паузы или обрыва, «Скачано» с галочкой — просто
 *   статус. Удаление сюда сознательно НЕ вынесено: оно в настройках чтения
 *   (OfflineAudioCard), а случайный тап по «Скачано» не должен стирать суру.
 * - `OfflineMark` — маленький значок у строки суры в шторке: галочка у
 *   скачанной, кольцо у качающейся; у нескачанной — ничего, чтобы список из
 *   114 строк не превратился в ряд кнопок.
 *
 * На сайте офлайна нет (`isOfflineSupported`), и значков нет вовсе. Если у
 * чтеца нет этой суры или загрузка у него невозможна — тоже ничего.
 *
 * Пока идёт загрузка другого задания того же чтеца (весь Коран, другая
 * сура), кнопки «Скачать» нет: новое задание оборвало бы текущее.
 */

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { CheckCircle, Download, ICON_SIZE } from './icons';
import {
  estimateSurahBytes, formatBytes, getDownloadState, pauseDownload, startDownload,
  subscribeDownloads,
} from '../lib/audioDownloads';
import { hasSurahFile, isOfflineSupported, isSurahComplete, subscribeAudioStore } from '../lib/audioStore';
import { hasSurahAudio, reciterHasSurah, supportsAyahOffline, type ReciterId } from '../lib/reciters';

export type SurahOffline =
  | { kind: 'hidden' }
  | { kind: 'done' }
  /** `background` — сура качается в составе задания «весь Коран»: паузу
   *  отсюда не даём, она остановила бы всю загрузку. */
  | { kind: 'running'; fraction: number; background?: boolean }
  | { kind: 'paused'; fraction: number }
  | { kind: 'failed'; message: string | null }
  | { kind: 'none' }
  /** Идёт другое задание этого чтеца — новое не начинаем. */
  | { kind: 'busy' };

/** Перерисовка на любое изменение реестра файлов или хода загрузки. */
export function useOfflineTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    const un1 = subscribeAudioStore(bump);
    const un2 = subscribeDownloads(bump);
    return () => { un1(); un2(); };
  }, []);
}

export function surahOffline(reciter: ReciterId, surah: number): SurahOffline {
  if (!isOfflineSupported()) return { kind: 'hidden' };
  if (!(supportsAyahOffline(reciter) || hasSurahAudio(reciter))) return { kind: 'hidden' };
  if (!reciterHasSurah(reciter, surah)) return { kind: 'hidden' };
  if (hasSurahFile(reciter, surah) || isSurahComplete(reciter, surah)) return { kind: 'done' };
  const st = getDownloadState(reciter);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  // Сура внутри задания «весь Коран» — свой ход по `current`.
  const inAll = st.scope?.kind === 'all' && st.current?.surah === surah;
  if (inAll && st.current) {
    const f = st.current.total > 0 ? clamp(st.current.done / st.current.total) : 0;
    if (st.status === 'running') return { kind: 'running', fraction: Math.min(0.99, f), background: true };
    if (st.status === 'paused') return { kind: 'paused', fraction: f };
  }
  const here = st.scope?.kind === 'surah' && st.scope.surah === surah;
  const fraction = clamp(st.bytesTotal > 0 ? st.bytes / st.bytesTotal
    : st.total > 0 ? st.done / st.total : 0);
  if (st.status === 'running') {
    return here ? { kind: 'running', fraction } : { kind: 'busy' };
  }
  if (here && st.status === 'paused') return { kind: 'paused', fraction };
  if (here && st.status === 'error') return { kind: 'failed', message: st.error };
  return { kind: 'none' };
}

/** Кольцо прогресса — без своего тика, доля приходит снаружи. */
function Ring({ fraction, size = 16 }: { fraction: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={2} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0.02, fraction) * c} ${c}`}
        style={{ transition: 'stroke-dasharray 300ms linear' }}
      />
    </svg>
  );
}

const pillBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '7px',
  minHeight: '44px', padding: '0 14px',
  borderRadius: 'var(--radius-pill)',
  border: 'none',
  background: 'rgb(var(--ink-rgb) / 0.07)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 'var(--font-subhead)',
  fontWeight: 'var(--weight-semibold)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  WebkitTapHighlightColor: 'transparent',
};

const tap = () => {
  if (Capacitor.getPlatform() === 'ios') void Haptics.impact({ style: ImpactStyle.Light });
};

/** Кнопка-статус в нижнем ряду плеера. */
export function OfflinePill({ reciter, surah }: { reciter: ReciterId; surah: number }) {
  useOfflineTick();
  const s = surahOffline(reciter, surah);
  if (s.kind === 'hidden' || s.kind === 'busy') return null;

  if (s.kind === 'done') {
    return (
      <span
        role="status"
        aria-label="Сура скачана — слушается без интернета"
        style={{ ...pillBase, background: 'transparent', color: 'var(--text-secondary)', fontWeight: 'var(--weight-regular)' }}
      >
        <span style={{ display: 'inline-flex', color: 'var(--brand)' }}><CheckCircle size={ICON_SIZE.md} /></span>
        Скачано
      </span>
    );
  }

  if (s.kind === 'running' && s.background) {
    // Качается в составе «всего Корана» — только статус: пауза отсюда
    // остановила бы всю загрузку, это решение для настроек.
    const pct = Math.round(s.fraction * 100);
    return (
      <span
        role="status"
        aria-label={`Сура скачивается вместе со всем Кораном, ${pct} процентов`}
        style={{ ...pillBase, background: 'transparent', color: 'var(--text-secondary)' }}
      >
        <span style={{ display: 'inline-flex', color: 'var(--brand)' }}><Ring fraction={s.fraction} size={18} /></span>
        {pct}&nbsp;%
      </span>
    );
  }

  if (s.kind === 'running') {
    const pct = Math.round(s.fraction * 100);
    return (
      <button
        onClick={() => { tap(); pauseDownload(reciter); }}
        aria-label={`Сура скачивается, ${pct} процентов. Поставить на паузу`}
        className="player-press"
        style={{ ...pillBase, cursor: 'pointer' }}
      >
        <span style={{ display: 'inline-flex', color: 'var(--brand)' }}><Ring fraction={s.fraction} size={18} /></span>
        {pct}&nbsp;%
      </button>
    );
  }

  const resume = s.kind === 'paused' || s.kind === 'failed';
  const size = estimateSurahBytes(reciter, surah);
  return (
    <button
      onClick={() => { tap(); void startDownload(reciter, { kind: 'surah', surah }); }}
      aria-label={s.kind === 'failed'
        ? `Загрузка не удалась${s.message ? `: ${s.message}` : ''}. Повторить`
        : resume ? 'Докачать суру на устройство' : `Скачать суру на устройство, ${formatBytes(size)}`}
      title={s.kind === 'failed' && s.message ? s.message : undefined}
      className="player-press"
      style={{ ...pillBase, cursor: 'pointer', color: s.kind === 'failed' ? 'var(--danger, var(--text-primary))' : pillBase.color }}
    >
      <Download size={ICON_SIZE.md} />
      {s.kind === 'failed' ? 'Повторить' : resume ? 'Докачать' : formatBytes(size)}
    </button>
  );
}

/** Значок у строки суры в шторке: только «скачана» и «качается». */
export function OfflineMark({ state }: { state: SurahOffline }) {
  if (state.kind === 'done') {
    return (
      <span aria-label="скачана" role="img" style={{ display: 'inline-flex', color: 'var(--brand)', flexShrink: 0 }}>
        <CheckCircle size={ICON_SIZE.sm} />
      </span>
    );
  }
  if (state.kind === 'running' || state.kind === 'paused') {
    return (
      <span
        aria-label={state.kind === 'running' ? 'скачивается' : 'загрузка на паузе'}
        role="img"
        style={{ display: 'inline-flex', color: 'var(--brand)', opacity: state.kind === 'paused' ? 0.55 : 1, flexShrink: 0 }}
      >
        <Ring fraction={state.fraction} size={14} />
      </span>
    );
  }
  return null;
}
