// NEXUS application shell: nav, topbar, routing, global events.
import { icon } from './icons.js';
import { $, el, esc, toast, debounce, timeAgo, POS_CN, TIER_FILTERS, TIER_FILTERS_CN, REGIONS } from './util.js';
import { store, subscribe, notify, navigate, loadChampions, refreshFavorites, getChamp } from './store.js';
import { ensureUnlocked } from './lock.js';
import './report-ui.js';

// CSP 禁内联事件：头像加载失败（离线/缺资源）用捕获阶段 error 统一占位
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && (t.getAttribute('src') || '').startsWith('nexus-asset://profileicon/')) {
    t.removeAttribute('src');
    t.classList.add('item-icon');
  }
}, true);

const NAV = [
  { group: '指挥中心' },
  { name: 'home', label: '指挥中枢', icon: 'home' },
  { name: 'tier', label: '英雄强度榜', icon: 'tier' },
  { name: 'champions', label: '英雄资料库', icon: 'champion' },
  { group: '战术中心' },
  { name: 'counter', label: 'Counter 克制', icon: 'counter' },
  { name: 'builds', label: '出装符文', icon: 'build' },
  { name: 'compare', label: '韩服国服对比', icon: 'compare' },
  { name: 'bp', label: 'BP 模拟器', icon: 'bp' },
  { name: 'prep', label: '对局准备', icon: 'prep' },
  { name: 'coach', label: '实时教练', icon: 'bolt' },
  { name: 'meta', label: '版本趋势', icon: 'chart' },
  { group: '国服情报' },
  { name: 'player', label: '玩家战绩中心', icon: 'champion' },
  { name: 'warroom', label: '对局情报室', icon: 'target' },
  { name: 'replay', label: '赛后复盘', icon: 'chart' },
  { name: 'growth', label: '个人成长', icon: 'arrowUp' },
  { group: '个人' },
  { name: 'favorites', label: '我的收藏', icon: 'star' },
  { group: '系统' },
  { name: 'announcements', label: '官方公告', icon: 'book' },
  { name: 'update', label: '版本更新', icon: 'download' },
  { name: 'aihub', label: 'AI 模型中心', icon: 'cpu' },
  { name: 'lcu', label: 'LCU 客户端引擎', icon: 'lcu' },
  { name: 'vault', label: '数据中枢', icon: 'vault' },
  { name: 'settings', label: '设置', icon: 'settings' },
];

const VIEWS = {
  home: () => import('./views/home.js'),
  tier: () => import('./views/tier.js'),
  champions: () => import('./views/champions.js'),
  detail: () => import('./views/detail.js'),
  counter: () => import('./views/counter.js'),
  builds: () => import('./views/builds.js'),
  bp: () => import('./views/bp.js'),
  prep: () => import('./views/prep.js'),
  player: () => import('./views/player.js'),
  warroom: () => import('./views/warroom.js'),
  favorites: () => import('./views/favorites.js'),
  lcu: () => import('./views/lcu.js'),
  vault: () => import('./views/vault.js'),
  settings: () => import('./views/settings.js'),
  announcements: () => import('./views/announcements.js'),
  aihub: () => import('./views/aihub.js'),
  coach: () => import('./views/coach.js'),
  meta: () => import('./views/meta.js'),
  replay: () => import('./views/replay.js'),
  growth: () => import('./views/growth.js'),
  update: () => import('./views/update.js'),
  compare: () => import('./views/compare.js'),
};

function buildSidebar() {
  const sb = $('#sidebar');
  sb.innerHTML = '';
  for (const item of NAV) {
    if (item.group) { sb.appendChild(el('div', { class: 'nav-group-label', text: item.group })); continue; }
    const btn = el('button', {
      class: 'nav-item' + (store.route.name === item.name ? ' active' : ''),
      'data-nav': item.name,
      html: `${icon(item.icon, 18)}<span>${esc(item.label)}</span>${item.name === 'warroom' ? '<span class="nav-badge hidden" data-alert-badge style="margin-left:auto">0</span>' : ''}${item.name === 'update' ? '<span class="nav-badge hidden" data-update-badge style="margin-left:auto">NEW</span>' : ''}`,
      onClick: () => navigate(item.name),
    });
    sb.appendChild(btn);
  }
  const footer = el('div', { class: 'sidebar-footer' });
  footer.appendChild(el('div', { class: 'lcu-pill', id: 'lcu-pill', html: `<span class="lcu-dot"></span><span id="lcu-pill-text">LCU 未连接</span>` }));
  sb.appendChild(footer);
}

function buildTopbar() {
  const tb = $('#topbar');
  tb.innerHTML = `
    <div class="search-box">
      ${icon('search', 16)}
      <input id="global-search" type="text" placeholder="搜索英雄（中文 / 英文）…" autocomplete="off" />
      <div class="search-results" id="search-results"></div>
    </div>
    <div class="topbar-spacer"></div>
    <button class="btn icon ghost" id="top-live" title="NEXUS LIVE 对局悬浮窗（F9）">${icon('eye', 17)}</button>
    <button class="btn icon ghost" id="top-ann" title="官方公告" style="position:relative">${icon('book', 17)}<span id="ann-badge" class="nav-badge hidden" style="position:absolute;top:-4px;right:-4px">0</span></button>
    <div class="top-select"><label>服务器</label><select class="nx-select" id="sel-region"></select></div>
    <div class="top-select" id="wrap-tier"><label>段位</label><select class="nx-select" id="sel-tier"></select></div>
    <div class="sync-status empty" id="sync-status" title="数据更新状态"><span class="dot"></span><span id="sync-text">未加载</span></div>
    <button class="btn primary sm" id="btn-sync">${icon('sync', 15)}<span>更新数据</span></button>
  `;
  const selRegion = $('#sel-region');
  for (const r of REGIONS) selRegion.appendChild(el('option', { value: r.v, text: r.l }));
  selRegion.value = store.filter.region;
  const selTier = $('#sel-tier');
  const fillTiers = () => {
    selTier.innerHTML = '';
    const list = store.filter.region === 'cn' ? TIER_FILTERS_CN : TIER_FILTERS;
    for (const t of list) selTier.appendChild(el('option', { value: t.v, text: t.l }));
    if (!list.some(t => t.v === store.filter.tierFilter)) store.filter.tierFilter = list[0].v;
    selTier.value = store.filter.tierFilter;
  };
  fillTiers();
  selRegion.addEventListener('change', () => { store.filter.region = selRegion.value; window.nexus.config.set('region', selRegion.value); fillTiers(); toast('已切换服务器，重新加载数据', 'info'); rerender(); });
  selTier.addEventListener('change', async () => {
    store.filter.tierFilter = selTier.value;
    await window.nexus.config.set('tier', selTier.value);
    toast('段位筛选已切换。强度榜按当前数据库版本展示；如需该段位精确数据请更新。', 'info', 4200);
    rerender();
  });

  $('#btn-sync').addEventListener('click', () => doRefresh());
  $('#sync-status').addEventListener('click', () => navigate('vault'));
  $('#top-ann').addEventListener('click', () => navigate('announcements'));
  $('#top-live').addEventListener('click', async () => { const on = await window.nexus.live.toggle(); toast(on ? 'NEXUS LIVE 悬浮窗已开启（F9 可开关）' : 'NEXUS LIVE 悬浮窗已关闭', 'info'); });
  refreshAnnBadge();

  const input = $('#global-search');
  const results = $('#search-results');
  const runSearch = debounce(async () => {
    const q = input.value.trim();
    if (!q) { results.classList.remove('open'); return; }
    await loadChampions();
    const ql = q.toLowerCase();
    const matches = store.champions.filter(c => (c.nameCn || '').toLowerCase().includes(ql) || (c.name || '').toLowerCase().includes(ql) || (c.key || '').toLowerCase().includes(ql)).slice(0, 12);
    results.innerHTML = matches.length ? matches.map(c => `
      <div class="search-result" data-key="${esc(c.key)}">
        <img src="nexus-asset://${esc(c.imageUrl)}" alt="" />
        <div><div class="sr-name">${esc(c.nameCn || c.name)}</div><div class="sr-en">${esc(c.name)} · ${esc(c.titleCn || '')}</div></div>
      </div>`).join('') : `<div class="search-result"><div class="sr-en">无匹配英雄</div></div>`;
    results.classList.add('open');
    results.querySelectorAll('.search-result[data-key]').forEach(node => node.addEventListener('click', () => {
      results.classList.remove('open'); input.value = '';
      navigate('detail', { key: node.dataset.key });
    }));
  }, 180);
  input.addEventListener('input', runSearch);
  input.addEventListener('focus', () => { if (input.value.trim()) runSearch(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) results.classList.remove('open'); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { results.classList.remove('open'); input.blur(); }
    if (e.key === 'Enter') { const first = results.querySelector('.search-result[data-key]'); if (first) first.click(); }
  });
}

async function refreshAnnBadge() {
  try { const n = await window.nexus.ann.unread(); const b = $('#ann-badge'); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } } catch {}
}

async function refreshAlertBadge() {
  try { const n = await window.nexus.alerts.unread(); const b = document.querySelector('[data-alert-badge]'); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } } catch {}
}

async function showBootAnnouncement() {
  try {
    const a = await window.nexus.ann.boot();
    if (!a) return;
    const { openAnn } = await import('./views/announcements.js');
    await openAnn(a.id);
    refreshAnnBadge();
  } catch (e) { console.error('boot announcement failed', e); }
}

const STATE_TEXT = { fresh: '数据最新', cached: '缓存数据', stale: '数据陈旧', updating: '更新中', failed: '更新失败', empty: '未加载' };
const SRC_STATE = { ok: 'fresh', updating: 'updating', stale: 'stale', failed: 'failed', pending: 'empty' };
function activeSource() {
  const id = store.filter.region === 'cn' ? 'cn-101' : null;
  return id ? (store.sources || []).find(s => s.id === id) : null;
}
function renderSyncStatus() {
  const node = $('#sync-status');
  if (!node) return;
  const src = activeSource();
  if (src) {
    const state = src.running ? 'updating' : (SRC_STATE[src.status] || 'empty');
    node.className = 'sync-status ' + state;
    let text = (STATE_TEXT[state] || state) + ' · ' + src.name;
    if (src.version && state !== 'updating') text += ` · ${src.version}`;
    if (src.running && src.progress && src.progress.message) text = src.progress.message;
    $('#sync-text').textContent = text;
    node.title = src.lastSuccessAt ? `上次成功：${timeAgo(src.lastSuccessAt)}${src.lastError ? '\n最近错误：' + src.lastError : ''}` : (src.lastError || '尚未成功采集');
    return;
  }
  const s = store.dataState;
  const state = s ? s.state : 'empty';
  node.className = 'sync-status ' + state;
  let text = STATE_TEXT[state] || state;
  if (s && s.patch && state !== 'updating') text += ` · ${s.patch}`;
  if (state === 'updating' && s && s.progress && s.progress.message) text = s.progress.message;
  $('#sync-text').textContent = text;
  node.title = s && s.fetchedAt ? `上次采集：${timeAgo(s.fetchedAt)}\n样本量：${s.statsCount || 0} 条统计` : '点击前往数据中枢';
}

function renderLcuPill() {
  const s = store.lcuState;
  const dot = $('#lcu-pill .lcu-dot');
  const text = $('#lcu-pill-text');
  if (!dot || !text) return;
  if (!s || !s.running) { dot.className = 'lcu-dot'; text.textContent = 'LCU 未检测到客户端'; }
  else if (!s.connected) { dot.className = 'lcu-dot warn'; text.textContent = 'LCU 连接中…'; }
  else if (s.loggedIn) { dot.className = 'lcu-dot on'; text.textContent = `LCU 已连接${s.tencent ? '（国服）' : ''} · ${s.phase}`; }
  else { dot.className = 'lcu-dot warn'; text.textContent = `LCU 已连接 · 未登录`; }
}

let currentView = null;
let renderSeq = 0;
async function rerender() {
  const mySeq = ++renderSeq;
  const { name, params } = store.route;
  buildSidebar();
  const loader = VIEWS[name] || VIEWS.home;
  const inner = $('#view-inner');
  try {
    const mod = await loader();
    if (mySeq !== renderSeq) return; // a newer navigation happened while loading
    if (currentView && currentView.destroy) { try { currentView.destroy(); } catch {} }
    inner.innerHTML = '';
    const view = await mod.render(inner, params);
    if (mySeq !== renderSeq) return;
    currentView = view;
  } catch (e) {
    if (mySeq !== renderSeq) return;
    console.error('view render failed', e);
    inner.innerHTML = `<div class="empty-state">${icon('warn', 56)}<div class="es-title">页面加载失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary mt-3" id="view-retry">重试</button></div>`;
    const r = inner.querySelector('#view-retry'); if (r) r.addEventListener('click', () => rerender());
  }
}

async function doRefresh(force = false) {
  if (!navigator.onLine) { toast('当前离线：无法更新数据，本地缓存仍可用。', 'warn', 4000); return; }
  const btn = $('#btn-sync');
  if (btn) { btn.disabled = true; }
  try {
    if (store.filter.region === 'cn') {
      toast('开始更新国服 101 官方数据…', 'info');
      const r = await window.nexus.sources.refresh('cn-101', { force });
      if (r && r.ok) { toast(`国服数据更新完成 · 版本 ${r.version}`, 'success'); rerender(); }
      else toast('更新失败：' + ((r && r.error) || '未知错误') + '（已保留原有数据）', 'error', 5000);
    } else {
      toast('开始更新 OP.GG 韩服数据…', 'info');
      const res = await window.nexus.data.refresh({ force });
      if (res && res.ok) { toast(`数据更新完成 · 版本 ${res.patch}`, 'success'); await loadChampions(true); rerender(); }
      else toast('更新失败：' + ((res && res.error) || '未知错误') + '（已保留原有数据）', 'error', 5000);
    }
  } catch (e) {
    toast('更新失败：' + String(e.message || e) + '（已保留原有数据）', 'error', 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireWindowControls() {
  // Graceful image fallback (CSP forbids inline onerror handlers).
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && !t.dataset.fallback) { t.dataset.fallback = '1'; t.style.opacity = '0.18'; }
  }, true);
  $('#win-min').innerHTML = icon('min', 12);
  $('#win-max').innerHTML = icon('max', 12);
  $('#win-close').innerHTML = icon('close', 12);
  $('#win-min').addEventListener('click', () => window.nexus.window.min());
  $('#win-max').addEventListener('click', () => window.nexus.window.max());
  $('#win-close').addEventListener('click', () => window.nexus.window.close());
}

// 离线感知：底部提示条 + online/offline 事件；配合主进程 net 离线快返，避免空等重试
function wireOfflineBanner() {
  const bar = el('div', {
    id: 'offline-banner',
    html: `${icon('warn', 14)}<span>当前离线：更新/联网查询会快速失败，本地缓存数据仍可正常使用。</span>`,
    style: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90, display: 'none', gap: '8px', alignItems: 'center', justifyContent: 'center', padding: '7px 12px', background: 'var(--amber-dim)', borderTop: '1px solid var(--gold)', color: 'var(--gold-bright)', fontSize: '12px' },
  });
  document.body.appendChild(bar);
  const sync = () => { bar.style.display = navigator.onLine ? 'none' : 'flex'; };
  window.addEventListener('offline', () => { sync(); toast('网络已断开，进入离线模式（本地缓存可用）', 'warn', 4000); });
  window.addEventListener('online', () => { sync(); toast('网络已恢复', 'success', 2500); });
  sync();
}

async function boot() {
  wireWindowControls();
  wireOfflineBanner();
  store.config = await window.nexus.config.get();
  if (store.config.dbRecovery && !store.config.dbRecoveryAck) {
    const rc = store.config.dbRecovery;
    toast(rc.kind === 'backup'
      ? '检测到数据库异常，已从最近一次有效备份自动恢复；原损坏文件已留存，可在数据中枢查看。'
      : '检测到数据库异常且无可用备份，已重建空库；原损坏文件已留存。建议重新更新一次数据。', 'error', 9000);
    try { await window.nexus.config.set('dbRecoveryAck', true); } catch {}
  }
  store.filter.region = store.config.region || 'kr';
  store.filter.tierFilter = store.config.tier || 'emerald_plus';
  if (store.config.reduceMotion) document.body.classList.add('reduce-motion');
  buildSidebar();
  buildTopbar();
  // 首屏互不依赖的 IPC 并行（P2-3），缩短冷启动
  const [sources, , , dataState, lcuState] = await Promise.all([
    window.nexus.sources.list(),
    refreshFavorites(),
    loadChampions(),
    window.nexus.data.state(),
    window.nexus.lcu.state(),
  ]);
  store.sources = sources;
  store.dataState = dataState;
  store.lcuState = lcuState;
  renderSyncStatus(); renderLcuPill();

  window.nexus.on('data-state', (s) => { store.dataState = s; renderSyncStatus(); if (currentView && currentView.onDataState) currentView.onDataState(s); });
  window.nexus.on('sources-state', (list) => { store.sources = list || []; renderSyncStatus(); if (currentView && currentView.onSourcesState) currentView.onSourcesState(list); });
  let prevPhase = store.lcuState ? store.lcuState.phase : 'None';
  let prevLoggedIn = !!(store.lcuState && store.lcuState.loggedIn);
  // 启动时若已登录，同步本人头像图标到缓存（离线也显示真实图标）
  if (store.lcuState && store.lcuState.loggedIn) window.nexus.player.syncSelfIcon().catch(() => {});
  window.nexus.on('lcu-state', (s) => {
    store.lcuState = s; renderLcuPill();
    if (s && s.loggedIn && !prevLoggedIn) window.nexus.player.syncSelfIcon().catch(() => {});
    prevLoggedIn = !!(s && s.loggedIn);
    if (s && s.phase === 'ChampSelect' && prevPhase !== 'ChampSelect') {
      toast('检测到英雄选择阶段，已打开对局实时准备面板', 'info', 4000);
      if (store.route.name !== 'lcu') navigate('lcu');
    }
    prevPhase = s ? s.phase : 'None';
    if (currentView && currentView.onLcuState) currentView.onLcuState(s);
  });

  subscribe(() => { renderSyncStatus(); renderLcuPill(); rerender(); });

  window.nexus.on('nexus-alert', (it) => {
    toast('情报提醒：' + it.title, 'warn', 6000);
    refreshAlertBadge();
    if (store.route.name === 'warroom' && currentView && currentView.onAlert) currentView.onAlert(it);
  });
  refreshAlertBadge();

  let updateToasted = false;
  window.nexus.on('update-state', (s) => {
    store.updateState = s;
    const b = document.querySelector('[data-update-badge]');
    if (b) b.classList.toggle('hidden', !(s && s.available));
    if (s && s.available && !updateToasted) {
      updateToasted = true;
      const lv = { major: '大版本', minor: '中版本', patch: '小版本' }[s.level] || '新版本';
      toast(`发现${lv}更新 v${s.latest.version}：${s.latest.title || ''} · 前往「版本更新」查看`, 'info', 7000);
    }
    if (store.route.name === 'update' && currentView && currentView.onUpdateState) currentView.onUpdateState(s);
  });

  // expose for debugging / tests
  window.__nexus = { store, navigate, doRefresh, rerender };
  await rerender();
  setTimeout(showBootAnnouncement, 600);
}

async function start() {
  const ok = await ensureUnlocked();
  if (ok) await boot();
}
start().catch(e => { console.error(e); toast('初始化失败：' + e.message, 'error', 8000); });