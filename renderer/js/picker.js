// 共享英雄选择器 — position-aware champion picker (BP / 任何选人场景).
// 所有候选与排序都来自真实 OP.GG 按位置统计；多位置英雄按数据出现在多个位置；
// 无统计样本但官方 meta 标注该位置的英雄标记「位置待确认」，绝不伪造数据。
import { icon } from './icons.js';
import { el, esc, pct, asset, POS_CN, POSITIONS, tierClass, modal, toast, sourceTag, timeAgo } from './util.js';
import { store, refreshFavorites } from './store.js';

const SORTS = [
  { v: 'tier', l: '版本梯度', defDir: 'asc' },
  { v: 'winRate', l: '胜率', defDir: 'desc' },
  { v: 'pickRate', l: '登场率', defDir: 'desc' },
  { v: 'banRate', l: '禁用率', defDir: 'desc' },
  { v: 'name', l: '名称', defDir: 'asc' },
];

// ---- personal pool (real cached LCU matches of the user's own account) ----
let personalCache = { puuid: null, map: {} };
export async function loadPersonal(force = false) {
  try {
    const cfg = await window.nexus.config.get();
    const puuid = cfg.selfPuuid || cfg.intelPuuid || null;
    if (!puuid) { personalCache = { puuid: null, map: {} }; return personalCache.map; }
    if (!force && personalCache.puuid === puuid) return personalCache.map;
    const r = await window.nexus.growth.report(puuid);
    const map = {};
    for (const c of ((r && r.stats && r.stats.byChampion) || [])) {
      const ch = store.champions.find(x => x.id === c.championId);
      if (ch) map[ch.key] = { games: c.games, winRate: c.winRate };
    }
    personalCache = { puuid, map };
    return map;
  } catch { return personalCache.map || {}; }
}

/**
 * openChampPicker({ title, position, taken, onPick, hint })
 *  position: 'all' | TOP/JUNGLE/MID/ADC/SUPPORT — initial filter (slot position)
 *  taken:    Map(key -> '已选'|'已禁') — disabled candidates with reason
 *  onPick:   (key, position) => void — confirmed selection
 */
export function openChampPicker({ title = '选择英雄', position = 'all', taken = new Map(), onPick, hint = '', onClose }) {
  const st = { pos: position || 'all', q: '', sort: 'tier', dir: 'asc', tier: 0, favOnly: false, personalOnly: false };
  let personal = {};
  let seq = 0;

  const posRow = el('div', { class: 'chip-row', id: 'pk-pos' });
  const modeBadge = el('span', { class: 'badge gold', id: 'pk-mode' });
  const search = el('input', { class: 'nx-input', placeholder: '在当前候选范围内搜索英雄…', style: { flex: '1', minWidth: '160px' } });
  const sortSel = el('select', { class: 'nx-select', style: { width: '118px' } });
  for (const s of SORTS) sortSel.appendChild(el('option', { value: s.v, text: s.l }));
  const dirBtn = el('button', { class: 'btn ghost sm', title: '切换升序/降序', html: '▲' });
  const tierRow = el('div', { class: 'chip-row', id: 'pk-tier' });
  const favBtn = el('button', { class: 'chip', html: `${icon('star', 12)} 只看收藏` });
  const perBtn = el('button', { class: 'chip', html: `${icon('target', 12)} 只看擅长` });
  const meta = el('div', { class: 'fs-12 text-3', id: 'pk-meta' });
  const grid = el('div', { class: 'pk-grid', id: 'pk-grid' });
  const hintEl = el('div', { class: 'fs-12 text-3 mt-2', id: 'pk-hint' });

  const body = el('div', {}, [
    el('div', { class: 'flex items-center gap-2 mb-2', style: { flexWrap: 'wrap' } }, [posRow, modeBadge]),
    el('div', { class: 'flex gap-2 mb-2', style: { flexWrap: 'wrap' } }, [search, sortSel, dirBtn]),
    el('div', { class: 'flex items-center gap-2 mb-2', style: { flexWrap: 'wrap' } }, [tierRow, favBtn, perBtn]),
    el('div', { class: 'flex items-center justify-between mb-2' }, [meta, el('span', { html: sourceTag('opgg') })]),
    grid, hintEl,
  ]);
  const m = modal({ title, body, wide: true, onClose });

  // position chips
  for (const p of ['all', ...POSITIONS]) {
    posRow.appendChild(el('button', { class: 'chip pk-pos-chip', 'data-pos': p, text: POS_CN[p], onClick: () => switchPos(p) }));
  }
  // tier chips
  for (const t of [0, 1, 2, 3, 4, 5]) {
    tierRow.appendChild(el('button', { class: 'chip pk-tier-chip', 'data-tier': String(t), text: t === 0 ? '全部梯度' : 'T' + t, onClick: () => { st.tier = t; syncChips(); draw(); } }));
  }
  function syncChips() {
    posRow.querySelectorAll('.pk-pos-chip').forEach(c => c.classList.toggle('active', c.dataset.pos === st.pos));
    tierRow.querySelectorAll('.pk-tier-chip').forEach(c => c.classList.toggle('active', +c.dataset.tier === st.tier));
    favBtn.classList.toggle('active', st.favOnly);
    perBtn.classList.toggle('active', st.personalOnly);
    modeBadge.textContent = st.pos === 'all' ? '全部位置模式' : POS_CN[st.pos] + '候选';
    modeBadge.className = 'badge ' + (st.pos === 'all' ? 'gold' : 'teal');
    dirBtn.innerHTML = st.dir === 'asc' ? '▲' : '▼';
  }
  function switchPos(p) {
    if (st.pos === p) return;
    st.pos = p;
    syncChips();
    hintEl.textContent = st.q
      ? `已切换到「${POS_CN[p]}」· 搜索「${st.q}」已保留，结果限定在当前候选范围`
      : `已切换到「${POS_CN[p]}」· 列表与排序已按该位置的真实统计更新`;
    draw();
  }

  search.addEventListener('input', () => { st.q = search.value.trim(); draw(); });
  sortSel.addEventListener('change', () => {
    st.sort = sortSel.value;
    st.dir = (SORTS.find(s => s.v === st.sort) || SORTS[0]).defDir;
    syncChips(); draw();
  });
  dirBtn.addEventListener('click', () => { st.dir = st.dir === 'asc' ? 'desc' : 'asc'; syncChips(); draw(); });
  favBtn.addEventListener('click', () => { st.favOnly = !st.favOnly; syncChips(); draw(); });
  perBtn.addEventListener('click', () => {
    if (!Object.keys(personal).length) { toast('暂无个人英雄池数据：先在玩家战绩中心查询并设为自己的账号', 'info', 5000); return; }
    st.personalOnly = !st.personalOnly; syncChips(); draw();
  });

  async function draw() {
    const mySeq = ++seq;
    grid.innerHTML = '<div class="skeleton" style="height:220px;grid-column:1/-1"></div>';
    let data;
    try {
      data = await window.nexus.data.picker({ position: st.pos, search: st.q, sort: st.sort, dir: st.dir, tier: st.tier || undefined, favOnly: st.favOnly });
    } catch (e) {
      if (mySeq !== seq) return;
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${icon('warn', 36)}<div class="es-title">候选加载失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary sm mt-3" id="pk-retry">重试</button></div>`;
      const r = grid.querySelector('#pk-retry'); if (r) r.addEventListener('click', draw);
      return;
    }
    if (mySeq !== seq) return; // stale response after a newer filter change
    let rows = data.rows || [];
    if (st.personalOnly) rows = rows.filter(x => personal[x.key]);
    meta.textContent = `${rows.length} 位候选 · 版本 ${data.filter.patch || '—'} · ${data.filter.region === 'kr' ? '韩服' : data.filter.region} ${data.filter.tierFilter || ''} · 采集 ${timeAgo(data.fetchedAt)}`;
    if (!rows.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${icon('champion', 40)}<div class="es-title">当前条件下无候选英雄</div><div>试试清空搜索、切换梯度或关闭「只看收藏/擅长」。</div></div>`;
      return;
    }
    grid.innerHTML = '';
    for (const x of rows) grid.appendChild(card(x));
    if (hint) hintEl.textContent = hint;
  }

  function card(x) {
    const reason = taken.get(x.key);
    const s = x.stat;
    const poss = [...new Set([...(x.positions || []), ...(x.statPositions || [])])];
    const per = personal[x.key];
    const node = el('div', { class: 'pk-card' + (reason ? ' disabled' : '') + (x.pending ? ' pending' : ''), 'data-key': x.key, html: `
      <div class="pk-top">
        <img src="${asset(x.imageUrl)}" alt=""/>
        <div class="pk-id">
          <div class="pk-name">${esc(x.nameCn || x.name)}</div>
          <div class="pk-sub">${s ? `<span class="tier-badge ${tierClass(s.tier)}" style="font-size:11px;padding:1px 5px">T${s.tier || '?'}</span> <span class="num">${pct(s.winRate)}</span> 胜 · <span class="num">${pct(s.pickRate)}</span> 登场` : '<span class="badge gray" style="font-size:11px">位置待确认</span>'}</div>
        </div>
        <button class="btn icon sm ghost pk-fav ${x.favorite ? 'text-gold' : ''}" title="${x.favorite ? '取消收藏' : '收藏'}">${icon('star', 13)}</button>
      </div>
      <div class="pk-tags">
        ${poss.map(p => `<span class="badge ${p === st.pos ? 'teal' : 'gray'}" style="font-size:11px;padding:1px 5px">${esc(POS_CN[p] || p)}</span>`).join('')}
        ${s && s.roleRate != null && st.pos !== 'all' ? `<span class="fs-11 text-3 num" title="该英雄出现在此位置的比例">${pct(s.roleRate, 0)} 占比</span>` : ''}
        ${per ? `<span class="badge gold" style="font-size:11px;padding:1px 5px" title="个人近期真实对局">${per.games}场 ${pct(per.winRate, 0)}</span>` : ''}
      </div>
      ${reason ? `<div class="pk-taken">${esc(reason)}</div>` : ''}
      <button class="btn icon sm ghost pk-info" title="查看各位置真实数据">${icon('eye', 13)}</button>
    ` });
    if (!reason) node.addEventListener('click', (e) => {
      if (e.target.closest('.pk-fav') || e.target.closest('.pk-info')) return;
      m.close();
      onPick(x.key, st.pos === 'all' ? null : st.pos);
    });
    node.querySelector('.pk-fav').addEventListener('click', async (e) => {
      e.stopPropagation();
      const now = await window.nexus.favorites.toggle(x.key);
      await refreshFavorites();
      x.favorite = now;
      e.currentTarget.classList.toggle('text-gold', now);
      toast(now ? '已收藏 ' + (x.nameCn || x.name || x.key) : '已取消收藏 ' + (x.nameCn || x.name || x.key), 'success', 1800);
      if (st.favOnly && !now) draw();
    });
    node.querySelector('.pk-info').addEventListener('click', (e) => { e.stopPropagation(); preview(x.key); });
    return node;
  }

  async function preview(key) {
    const pm = modal({ title: '英雄数据预览', body: el('div', { html: '<div class="skeleton" style="height:160px"></div>' }), wide: true });
    try {
      const c = await window.nexus.data.champion(key);
      if (!c) { pm.close(); return; }
      const rows = (c.stats || []).slice().sort((a, b) => (a.tier || 9) - (b.tier || 9));
      pm.body.innerHTML = `
        <div class="flex items-center gap-3 mb-3">
          <img src="${asset(c.imageUrl)}" style="width:56px;height:56px;border-radius:var(--r-md);border:1px solid var(--line-strong)"/>
          <div><div class="fw-6 fs-16">${esc(c.nameCn || c.name)}</div><div class="fs-12 text-3">${esc(c.titleCn || '')} · ${(c.tags || []).map(t => esc(t)).join(' / ')}</div></div>
          <div style="flex:1"></div>${sourceTag('opgg')}
        </div>
        ${rows.length ? `<table class="nx-table"><thead><tr><th>位置</th><th>梯度</th><th>胜率</th><th>登场率</th><th>禁用率</th><th>位置占比</th><th>样本</th></tr></thead><tbody>
          ${rows.map(s => `<tr><td>${esc(POS_CN[s.position] || s.position)}</td><td><span class="tier-badge ${tierClass(s.tier)}">T${s.tier || '?'}</span></td><td class="num">${pct(s.winRate)}</td><td class="num">${pct(s.pickRate)}</td><td class="num">${pct(s.banRate)}</td><td class="num">${pct(s.roleRate)}</td><td class="num text-3">${s.sampleSize ?? '—'}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty-state">' + icon('warn', 36) + '<div class="es-title">暂无统计样本</div><div>该英雄在当前服务器/段位下没有 OP.GG 数据，位置待确认。</div></div>'}
        <div class="fs-12 text-3 mt-3">同一英雄可出现在多个位置，全部以真实统计为准；点击选择器中的英雄卡片即可确认选人。</div>`;
    } catch (e) {
      pm.body.innerHTML = `<div class="empty-state">${icon('warn', 36)}<div class="es-title">预览加载失败</div><div>${esc(String(e.message || e))}</div></div>`;
    }
  }

  syncChips();
  draw();
  loadPersonal().then(map => {
    personal = map || {};
    if (Object.keys(personal).length) perBtn.title = '基于你账号的缓存真实对局';
    draw(); // personal badges / 只看擅长 need the pool data
  });
  setTimeout(() => search.focus(), 60);
  return m;
}