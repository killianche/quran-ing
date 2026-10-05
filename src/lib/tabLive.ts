/**
 * tabLive — вкладка под пальцем, пока лента вкладок едет (TabPager).
 *
 * Внешний стор, а не состояние App: подсветка в нижнем меню меняется на
 * первом событии прокрутки каждого свайпа и на середине пути, и через
 * `useState` в App это перерисовывало все три экрана вкладок, вместе со
 * 114 строками сур (ревью 2026-10-05; замер в Chromium — 3–4 перерисовки
 * списка сур за свайп). Подписана только панель вкладок (TabBar, она же
 * ведёт системную панель iOS 26); App и экраны о ходе ленты не знают и
 * перерисовываются один раз — когда вкладка принята.
 *
 * `null` — лента стоит, подсвечена принятая вкладка.
 */

import type { TabId } from '../components/TabBar';

let liveTab: TabId | null = null;
const listeners = new Set<() => void>();

export function getLiveTab(): TabId | null {
  return liveTab;
}

export function setLiveTab(id: TabId | null): void {
  if (id === liveTab) return;
  liveTab = id;
  listeners.forEach(fn => fn());
}

export function subscribeLiveTab(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
