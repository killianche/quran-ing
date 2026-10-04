import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor — нативная обёртка веб-приложения.
 *
 * Сборка:
 *   npm run sync            # build + cap sync (обновить обе платформы)
 *   npx cap open ios        # Xcode
 *   npx cap open android    # Android Studio
 *
 * webDir: 'dist' — Capacitor берёт ровно вывод vite build.
 */
const config: CapacitorConfig = {
  // ВНИМАНИЕ: appId после первой публикации в сторах не меняется.
  // ing.quran.app — решение владельца 2026-10-03 (у an-Nur был
  // ru.annur.quran; его в другом аккаунте не зарегистрировать).
  appId: 'ing.quran.app',
  appName: 'Quran Ing',
  webDir: 'dist',
  server: {
    // Без этого Android грузит WebView по http://, что блокирует
    // mixed-content и ломает MediaSession.
    androidScheme: 'https',
  },
  ios: {
    // contentInset='never': WebView занимает весь экран, включая
    // область под чёлкой и домашним индикатором, а отступы делает сама
    // страница через env(safe-area-inset-*).
    //
    // Было 'always' — и отступ считался дважды: Capacitor сдвигал
    // вьюшку под статус-бар, а вёрстка сверху добавляла ещё
    // env(safe-area-inset-top).  На экране это выглядело как лишние
    // ~60 pt пустоты над заголовком.  Один источник истины надёжнее:
    // теперь safe-area знает только CSS.
    contentInset: 'never',
    // Поле ковра вокруг медальона (scripts/brand/design-logo.py): совпадает
    // с LaunchScreen и с копией заставки #launch — без вспышки на старте.
    backgroundColor: '#440505',
  },
  android: {
    // Как на iOS: поле ковра — цвет под заставкой и её копией #launch.
    backgroundColor: '#440505',
  },
  plugins: {
    LocalNotifications: {
      sound: 'prayer_reminder.wav',
      iconColor: '#9B7B2F',
      presentationOptions: ['sound', 'banner', 'list'],
    },
    SplashScreen: {
      // launchAutoHide: false — сплэш убирает приложение само, из
      // App.tsx, когда дерево смонтировано.  Так пользователь не видит
      // пустой канвы между скрытием сплэша и первым кадром.
      //
      // ВАЖНО: в QuranIng здесь стоял тот же флаг, но вызова
      // SplashScreen.hide() в коде не было ВООБЩЕ — нативное
      // приложение зависало бы на сплэше навсегда.  В QuranRu вызов
      // есть, см. lib/nativeSplash.ts и App.tsx.
      launchShowDuration: 1000,
      launchAutoHide: false,
      // Android гасит стартовую заставку сам за 200 мс, и hide({fadeOutDuration})
      // на неё не действует — только эта настройка. 0: под заставкой уже её
      // копия #launch, плавность даёт анимация копии (lib/launchReveal.ts).
      launchFadeOutDuration: 0,
      backgroundColor: '#440505',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      // Тон статус-бара синхронится с темой в App.tsx через
      // StatusBar.setStyle().  Дефолт — под тёмную «Аврору».
      style: 'DARK',
      backgroundColor: '#0a0a14',
    },
  },
};

export default config;
