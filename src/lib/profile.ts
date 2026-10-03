/**
 * profile — имя пользователя и удаление своих данных.
 *
 * ── Почему имя локальное ──────────────────────────────────────────────
 *
 * У приложения нет ни сервера, ни авторизации: всё, что человек
 * настроил, лежит у него на устройстве.  Поэтому «имя пользователя»
 * здесь — подпись на этом устройстве, а не аккаунт: без входа, без
 * пароля, без синхронизации.  Экран говорит это прямым текстом, чтобы
 * никто не ждал, что его список дуа переедет на новый телефон.
 *
 * Настоящий аккаунт со входом — отдельная большая работа с бэкендом, и
 * начинать её без запроса нельзя.
 *
 * ── Почему удаление данных перечисляет ключи, а не чистит всё ──────────
 *
 * `localStorage.clear()` короче, но он молча унёс бы и то, что появится
 * в приложении завтра, включая чужие ключи, если их однажды добавит
 * библиотека.  Явный список — это ещё и документация: видно, что
 * приложение вообще о человеке помнит.
 *
 * Apple требует, чтобы данные можно было удалить (App Review 5.1.1).
 * Аккаунтов у нас нет, поэтому удалять нечего кроме локальных
 * настроек — но кнопка обязана быть и обязана работать честно.
 */

const NAME_KEY = 'profile.name';
export const PROFILE_EVENT = 'profile-changed';

/** Длиннее не нужно: имя показывается одной строкой. */
export const MAX_NAME_LENGTH = 40;

export function readUserName(): string {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(NAME_KEY) ?? '').slice(0, MAX_NAME_LENGTH);
}

export function writeUserName(name: string) {
  if (typeof window === 'undefined') return;
  const trimmed = name.slice(0, MAX_NAME_LENGTH);
  if (trimmed.trim()) localStorage.setItem(NAME_KEY, trimmed);
  else localStorage.removeItem(NAME_KEY);
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

export function onProfileChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PROFILE_EVENT, fn);
  return () => window.removeEventListener(PROFILE_EVENT, fn);
}

/**
 * Всё, что приложение помнит о человеке.
 *
 * Список сгруппирован по смыслу, чтобы при добавлении новой настройки
 * было видно, куда её дописать.  Если что-то забыть — кнопка «удалить
 * мои данные» соврёт, а это хуже, чем её отсутствие.
 */
export const LOCAL_DATA_KEYS: readonly string[] = [
  // Кто я
  'profile.name',
  // Что читал
  'recentReads', 'ayahBookmarks', 'bookmarks',
  // `mushaf.page` / `mushaf.font` — наследие: полноэкранного мусхафа в
  // Quran Ing нет, но установка поверх an-Nur (пока bundle ID общий)
  // принесёт эти ключи, и «удалить мои данные» обязано вычистить и их.
  'mushaf.page', 'mushaf.font',
  // Как читаю Коран
  'theme', 'reciter', 'arabicFont', 'ruFont', 'arabicScale', 'ruScale',
  'showArabic', 'showRu', 'fontScale', 'quran.feedMode',
  'showInh', 'inhFont', 'inhScale',
  // Азкары
  'azkar.showArabic', 'azkar.showRussian', 'azkar.showTranslit',
  'azkar.arabicFont', 'azkar.russianFont', 'azkar.translitFont',
  'azkar.arabicScale', 'azkar.russianScale', 'azkar.translitScale',
  'azkar.langTab',
  // Дуа
  'dua.list',
  // `dua.hidden` — наследие: скрытие дуа снято, но у тех, кто успел им
  // воспользоваться, ключ лежит в памяти телефона. Приложение его больше
  // не читает, а «удалить мои данные» обязано вычистить и его.
  'dua.hidden',
  'dua.showArabic', 'dua.showRussian', 'dua.showTranslit',
  'dua.arabicFont', 'dua.russianFont', 'dua.translitFont',
  'dua.arabicScale', 'dua.russianScale', 'dua.translitScale',
  // Намаз и кибла
  'prayer.cities', 'prayer.activeCity', 'prayer.settings', 'place',
  'prayer.primary-source.v1', 'prayer.alarms.v1',
];

/**
 * Удалить всё локальное.  Возвращает, сколько записей реально было —
 * экрану есть что показать вместо молчания.
 */
export function wipeLocalData(): number {
  if (typeof window === 'undefined') return 0;
  let removed = 0;
  for (const key of LOCAL_DATA_KEYS) {
    if (localStorage.getItem(key) !== null) removed++;
    localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event(PROFILE_EVENT));
  return removed;
}

/** Сколько записей о человеке лежит сейчас — для подписи под кнопкой. */
export function countLocalData(): number {
  if (typeof window === 'undefined') return 0;
  return LOCAL_DATA_KEYS.filter(k => localStorage.getItem(k) !== null).length;
}
