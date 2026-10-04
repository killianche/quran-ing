import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AudioProvider } from './hooks/AudioProvider';
import { initSentry } from './lib/sentry';
import { initGlobalErrorHandlers } from './lib/globalErrors';
import { initAudioStore } from './lib/audioStore';
import { armAutoDownload } from './lib/audioAutoDownload';
import { Capacitor } from '@capacitor/core';
import { lockReaderOrientation } from './lib/screenOrientation';
import { armSplashFailsafe } from './lib/nativeSplash';

// Отметка «мы внутри нативной обёртки» на <html>.
//
// Нужна, чтобы правила, придуманные для приложения, не портили жизнь
// веб-версии.  Первый такой случай — запрет «резинки» прокрутки:
// в приложении он обязателен (без него уезжает закреплённая шапка),
// а на сайте это лишнее ограничение поведения, которое человек ждёт
// от обычной страницы.
if (Capacitor.isNativePlatform()) {
  document.documentElement.setAttribute('data-native', '');
  // Физический поворот телефона сам по себе ничего не меняет: приложение
  // читается в портрете.
  void lockReaderOrientation('portrait');
}

// Sentry init — no-op без VITE_SENTRY_DSN.  На прод DSN передаётся
// через .env.production.local (см. lib/sentry.ts header).
initSentry();

// Перехват всего, что проходит мимо ErrorBoundary: ошибок в
// обработчиках событий и отвалившихся промисов.  Ставим ПЕРВЫМ, до
// любого нашего кода, чтобы поймать в том числе падение на старте.
initGlobalErrorHandlers();

// Реестр скачанного аудио.  Стартуем до рендера, чтобы к первому
// нажатию play() путь к локальному файлу уже резолвился синхронно;
// промис не ждём — если реестр не успеет, плеер просто отработает
// первый аят со стрима.
//
// Автозагрузка чтеца по умолчанию ставится на взвод ПОСЛЕ реестра:
// иначе она не увидит уже скачанное и полезла бы качать заново.
void initAudioStore().then(() => armAutoDownload());

// AudioProvider стоит НАД App, а не внутри: у App несколько точек возврата
// по типу экрана, и провайдер внутри пересоздавался бы при смене экрана —
// то есть ровно тогда, когда звук обязан продолжаться.
// Страховка заставки — ДО первого рендера: если корень упадёт раньше
// эффекта App (там runLaunchReveal), нативная заставка с launchAutoHide:false
// иначе осталась бы навсегда.
armSplashFailsafe();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioProvider>
      <App />
    </AudioProvider>
  </StrictMode>,
);
