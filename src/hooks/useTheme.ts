import { useState, useEffect } from 'react';

/**
 * Пять тем.
 *
 *   light   — белая бумага, чёрные чернила
 *   dark    — мягкий графит #1a1a1c
 *   aurora  — светло-бежевое поле с редкой сеткой точек
 *   aurora2 — чёрная канва + зелёное свечение, растекающееся из центра
 *
 * В прежнем QuranIng было двенадцать тем и одиннадцать пресетов поверх них,
 * плюс бумажные паттерны и фото-обои.  Здесь модель плоская: id темы
 * это и есть всё её состояние.  `themeMode` сохранён отдельной
 * функцией, потому что весь остальной код рассуждает в терминах
 * «светлая / тёмная / космос», а не конкретных id — и когда/если тем
 * снова станет больше, менять придётся только эту функцию.
 */

export type ThemeMode = 'light' | 'dark' | 'cosmic';

export type Theme = 'light' | 'dark' | 'aurora' | 'aurora2' | 'cosmos';

/*
 * Порядок в списке оформления.  «Бежевая» первой — она и так дефолт
 * первого запуска (FIRST_RUN_DEFAULT ниже), и стоять четвёртой ей
 * было незачем: пункт по умолчанию читается первым. Дальше космическая,
 * тёмная и две другие светлые темы.
 *
 * Массив используется и как порядок в интерфейсе, и как список
 * допустимых значений при чтении localStorage — перестановка ничей
 * сохранённый выбор не ломает.
 */
export const ALL_THEMES: Theme[] = ['aurora', 'aurora2', 'cosmos', 'dark', 'light'];

export const THEME_LABELS: Record<Theme, string> = {
  light:  'Светлая',
  dark:   'Тёмная',
  // Внутренний id оставлен прежним: сохранённый выбор пользователей
  // автоматически получает новый фон, без сброса настроек при обновлении.
  aurora: 'Бежевая',
  aurora2: 'Аврора 2',
  // Звёздное небо. Тема существовала до 09.08.2026, потом её убрали вместе
  // с летящими звёздами; владелец попросил вернуть 07.09.2026 — отдельной
  // темой, чтобы у тех, кто выбрал «Тёмную» ради спокойного фона, ничего не
  // изменилось само.
  cosmos: 'Космос',
};

/** Первый запуск открывается на светло-бежевой теме — это визуальная подпись
 *  приложения, и новый пользователь должен увидеть её сразу.  Дальше
 *  читается сохранённый выбор. */
export const FIRST_RUN_DEFAULT: Theme = 'aurora';

const STORAGE_KEY = 'theme';

/**
 * Миграция сохранённых значений из прежнего QuranIng: там id темы был вида
 * `light-ivory` / `dark-velvet` / `cosmic-night`.  Сводим всё
 * семейство к одной из трёх новых тем по префиксу, чтобы человек,
 * открывший приложение поверх старого localStorage, не улетел на
 * дефолт и не потерял «светлая была светлой».
 */
// ⚠️ Эта же логика продублирована инлайн-скриптом в index.html: тему надо
// поставить ДО первого кадра, а к тому моменту модуль ещё не выполнен.
// Меняешь правила миграции здесь — поменяй и там, иначе холодный старт
// даст один кадр не с той темой, и человек увидит вспышку.
function migrateLegacy(v: string): Theme | null {
  // Тема «Бумага» (id `mushaf`) снята владельцем 2026-10-04 — светлая
  // ближе всего; туда же уходят кремовые и пергаментные темы прошлого.
  if (v === 'mushaf') return 'light';
  if (v.startsWith('cosmic')) return 'aurora2';
  if (v.startsWith('light'))  return 'light';
  if (v.startsWith('dark'))   return 'dark';
  // Совсем древние значения без префикса.
  if (v === 'parchment' || v === 'sepia') return 'light';
  return null;
}

export function themeMode(t: Theme): ThemeMode {
  if (t === 'aurora2' || t === 'cosmos') return 'cosmic';
  if (t === 'aurora') return 'light';
  return t;
}

/** Светлая ли тема по существу.  Отдельная функция, потому что
 *  светлых тем теперь три и сравнение `t === 'light'` то и дело
 *  оказывалось бы неполным — именно так и появлялись бы баги вида
 *  «на Мусхафе подсветка ведёт себя как на тёмной». */
export function isLightTheme(t: Theme): boolean {
  return themeMode(t) === 'light';
}

function readStoredTheme(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  if (!v) return FIRST_RUN_DEFAULT;
  if ((ALL_THEMES as string[]).includes(v)) return v as Theme;
  return migrateLegacy(v) ?? FIRST_RUN_DEFAULT;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  return { theme, setTheme };
}
