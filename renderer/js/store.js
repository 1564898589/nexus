// NEXUS shared state + cache.
const listeners = new Set();
export const store = {
  config: {},
  dataState: null,
  lcuState: null,
  favorites: new Set(),
  champions: [],       // full champion list cache
  championMap: {},
  route: { name: 'home', params: {} },
  filter: { region: 'kr', tierFilter: 'emerald_plus', position: 'all' },
  sources: [],
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { for (const fn of listeners) { try { fn(store); } catch (e) { console.error(e); } } }

export async function loadChampions(force = false) {
  if (store.champions.length && !force) return store.champions;
  const list = await window.nexus.data.champions({});
  store.champions = list || [];
  store.championMap = {};
  for (const c of store.champions) store.championMap[c.key] = c;
  return store.champions;
}

export function getChamp(key) { return store.championMap[key] || null; }

export async function refreshFavorites() {
  const list = await window.nexus.favorites.list();
  store.favorites = new Set(list || []);
  return store.favorites;
}

export function navigate(name, params = {}) {
  store.route = { name, params };
  notify();
  const view = document.querySelector('.view');
  if (view) view.scrollTop = 0;
}