/**
 * Глобальный перехват ошибок.
 *
 * ErrorBoundary ловит только то, что упало во время рендера React.
 * Всё остальное — ошибка в обработчике события, отвалившийся промис,
 * падение внутри setTimeout — проходит мимо него: приложение либо
 * продолжает работать в неверном состоянии, либо показывает пустой
 * экран без единого следа.
 *
 * Ровно это и случилось при прогоне на симуляторе: WebView ушёл в
 * чёрный экран, и восстановить причину было нечем — ни сообщения на
 * экране, ни записи в системном логе.  Чтобы такое больше не
 * повторялось молча, вешаем два слушателя и рисуем поверх страницы
 * плашку с текстом ошибки.
 *
 * Плашка нарочно сделана на голом DOM, без React: если сломался
 * React-рендер, компонент показать уже нельзя.  По той же причине
 * стили инлайновые — CSS-переменные темы могут быть недоступны.
 *
 * Показываем только ПЕРВУЮ ошибку: каскад из двадцати одинаковых
 * сообщений ничего не добавляет, а прочитать их невозможно.
 */

import { captureError } from './sentry';
import { hideSplashNow } from './nativeSplash';
import { releaseLaunchStatusBar } from './nativeStatusBar';

const OVERLAY_ID = 'global-error-overlay';
let shown = false;

function describe(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function showOverlay(title: string, detail: string) {
  if (typeof document === 'undefined') return;
  // Ошибку надо увидеть: снимаем нативную заставку и её копию #launch,
  // статус-бару возвращаем тон темы.
  void hideSplashNow();
  document.getElementById('launch')?.remove();
  releaseLaunchStatusBar();
  if (shown) return;
  shown = true;

  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  root.setAttribute('role', 'alert');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:24px',
    'background:#101014', 'color:#f4f4f5',
    'font-family:system-ui,-apple-system,sans-serif',
    '-webkit-user-select:text', 'user-select:text',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = 'max-width:420px;text-align:center';

  const h = document.createElement('div');
  h.textContent = 'Что-то пошло не так';
  h.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:10px';

  const p = document.createElement('div');
  p.textContent = 'Приложение столкнулось с ошибкой. Перезапустите его — '
    + 'прочитанное и скачанное сохранены.';
  p.style.cssText = 'font-size:13px;line-height:1.5;opacity:.75;margin-bottom:18px';

  const code = document.createElement('div');
  code.textContent = `${title}\n${detail}`;
  code.style.cssText = [
    'font-family:ui-monospace,SFMono-Regular,monospace',
    'font-size:11px', 'line-height:1.45', 'opacity:.6',
    'white-space:pre-wrap', 'word-break:break-word',
    'margin-bottom:20px', 'max-height:38vh', 'overflow:auto',
  ].join(';');

  const btn = document.createElement('button');
  btn.textContent = 'Перезапустить';
  btn.style.cssText = [
    'padding:11px 20px', 'border-radius:10px',
    'border:1px solid rgba(255,255,255,.18)',
    'background:rgba(255,255,255,.08)', 'color:inherit',
    'font:inherit', 'font-size:14px', 'cursor:pointer',
  ].join(';');
  btn.onclick = () => window.location.reload();

  card.append(h, p, code, btn);
  root.append(card);
  document.body.append(root);
}

/** Повесить перехватчики.  Идемпотентно. */
export function initGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', e => {
    // Ошибки загрузки ресурсов (картинка, шрифт, аудио) тоже приходят
    // сюда, но у них нет `error` и есть `target` — их пропускаем:
    // не приезжает шрифт — это не повод закрывать приложение.
    if (!(e instanceof ErrorEvent) || !e.error) return;
    captureError(e.error, { source: 'window.onerror' });
    showOverlay(
      describe(e.error),
      `${e.filename ?? '?'}:${e.lineno ?? 0}:${e.colno ?? 0}`,
    );
  });

  window.addEventListener('unhandledrejection', e => {
    const reason = (e as PromiseRejectionEvent).reason;
    captureError(
      reason instanceof Error ? reason : new Error(describe(reason)),
      { source: 'unhandledrejection' },
    );
    showOverlay(describe(reason), 'необработанный промис');
  });
}
