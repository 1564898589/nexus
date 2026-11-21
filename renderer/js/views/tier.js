// 英雄强度榜 — Champion Strength Center.
import { icon } from '../icons.js';
import { el, esc, pct, num, asset, tierClass, POS_CN, POSITIONS, sourceTag, toast, modal, timeAgo } from '../util.js';
import { store, navigate, getChamp, refreshFavorites } from '../store.js';

let opts = { position: 'all', sort: 'tier', dir: 'asc', search: '' };
let selected = new Set();

const COLS = [
  { key: 'tier', label: '梯队', sort: 'tier' },
  { key: 'rank', label: '#', sort: 'rank' },
  { key: 'champ', label: '英雄', sort: 'name' },
  { key: 'winRate', label: '胜率', sort: 'winRate' },
  { key: 'pickRate', label: '登场率', sort: 'pickRate' },
  { key: 'banRate', label: '禁用率', sort: 'banRate' },
  { key: 'roleRate', label: '位置占比', sort: null },
  { key: 'sample', label: '样本', sort: null },
];

function rateCell(v, cls = '') {
  if (v == null) return '<span class="text-3">—</span>';
  const w = Math.min(100, v * 100 * (cls === 'gold' ? 4 : cls === 'red' ? 6 : 1.6));
  return `<span class="num">${pct(v)}</span><span class="rate-bar ${cls}"><i style="width:${w}%"></i></span>`;
}

export async function render(root) {
  selected = new Set();
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('tier', 26, 'accent')} 英雄强度榜 <span class="accent">TIER LIST</span></div>
      <div class="page-sub">${store.filter.region === 'cn' ? '国服 101 攻略中心官方排位统计 · 翡翠+/全段位/峡谷之巅独立口径 · 官方不提供样本量（标未知）' : 'OP.GG 韩服排位真实统计 · 按梯队 / 胜率 / 登场率排序 · 点击英雄查看详情'}</div>
    </div>
    <div class="panel tight mb-4">
      <div class="flex items-center justify-between gap-3" style="flex-wrap:wrap">
        <div class="chip-row" id="pos-chips"></div>
        <div class="flex items-center gap-2">
          <div class="search-box" style="width:220px">${icon('search', 16)}<input id="tier-search" placeholder="筛选英雄…" value="${esc(opts.search)}"/></div>
          <button class="btn ghost sm" id="btn-compare" disabled>${icon('compare', 15)} 对比 (<span id="cmp-count">0</span>)</button>
        </div>
      </div>
    </div>
    <div class="panel" style="padding:8px 8px 0">
      <div class="flex items-center justify-between" style="padding:8px 12px">
        <div class="fs-12 text-3" id="tier-meta"></div>
        ${sourceTag(store.filter.region === 'cn' ? 'cn101' : 'opgg')}
      </div>
      <div style="overflow-x:auto">
        <table class="nx-table" id="tier-table">
          <thead><tr>
            <th style="width:36px"></th>
            ${COLS.map(c => `<th data-sort="${c.sort || ''}" class="${opts.sort === c.sort ? 'sorted' : ''}">${esc(c.label)}${opts.sort === c.sort ? `<span class="arrow">${opts.dir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('')}
            <th style="width:50px"></th>
          </tr></thead>
          <tbody id="tier-body"></tbody>
        </table>
      </div>
    </div>
  `;

  const chips = root.querySelector('#pos-chips');
  for (const p of ['all', ...POSITIONS]) {
    const chip = el('button', { class: 'chip' + (opts.position === p ? ' active' : ''), text: POS_CN[p], onClick: () => { opts.position = p; load(root); } });
    chips.appendChild(chip);
  }
  root.querySelector('#tier-search').addEventListener('input', (e) => { opts.search = e.target.value; load(root); });
  root.querySelectorAll('#tier-table th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const s = th.dataset.sort; if (!s) return;
    if (opts.sort === s) opts.dir = opts.dir === 'asc' ? 'desc' : 'asc';
    else { opts.sort = s; opts.dir = s === 'name' ? 'asc' : (s === 'tier' || s === 'rank' ? 'asc' : 'desc'); }
    load(root);
  }));
  root.querySelector('#btn-compare').addEventListener('click', () => openCompare());

  await load(root);
  return {};
}

async function load(root) {
  const body = root.querySelector('#tier-body');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="10"><div class="skeleton" style="height:200px"></div></td></tr>`;
  const data = await window.nexus.data.tierList({ position: opts.position, sort: opts.sort, dir: opts.dir, search: opts.search, region: store.filter.region, tierFilter: store.filter.tierFilter });
  // re-render header sort indicators
  root.querySelectorAll('#tier-table th[data-sort]').forEach(th => {
    const s = th.dataset.sort;
    th.classList.toggle('sorted', opts.sort === s);
    const base = COLS.find(c => c.sort === s);
    th.innerHTML = `${esc(base ? base.label : '')}${opts.sort === s ? `<span class="arrow">${opts.dir === 'asc' ? '▲' : '▼'}</span>` : ''}`;
  });
  root.querySelector('#tier-meta').textContent = `${data.total} 条统计 · 版本 ${data.filter.patch || '—'} · ${data.sampleUnknown ? '样本量：官方未提供（未知）' : '样本 ' + num(data.sampleSize)} · 采集 ${timeAgo(data.fetchedAt)}`;
  // rebind chips active
  root.querySelectorAll('#pos-chips .chip').forEach((c, i) => { const p = ['all', ...POSITIONS][i]; c.classList.toggle('active', opts.position === p); });

  if (!data.rows.length) {
    body.innerHTML = `<tr><td colspan="10"><div class="empty-state">${icon('tier', 48)}<div class="es-title">暂无数据</div><div>${store.filter.region === 'cn' ? '国服数据尚未更新或该段位口径无数据。点击顶栏「更新数据」获取 101 官方统计；不会用韩服数据代替。' : '请先更新数据，或调整筛选条件。'}</div></div></td></tr>`;
    return;
  }
  body.innerHTML = '';
  for (const s of data.rows) {
    const c = getChamp(s.championKey) || {};
    const fav = store.favorites.has(s.championKey);
    const tr = el('tr', { html: `
      <td><input type="checkbox" class="cmp-check" data-key="${esc(s.championKey)}" ${selected.has(s.championKey) ? 'checked' : ''}/></td>
      <td><span class="tier-badge ${tierClass(s.tier)}">T${s.tier || '?'}</span></td>
      <td class="num text-3">${s.rank || '—'}</td>
      <td><div class="champ-cell"><img src="${asset(s.imageUrl || c.imageUrl)}" alt=""/><div><div class="champ-name">${esc(s.championName)}</div><div class="champ-en">${esc(s.nameEn || '')} · ${esc(POS_CN[s.position] || s.position)}</div></div></div></td>
      <td>${rateCell(s.winRate)}</td>
      <td>${rateCell(s.pickRate, 'gold')}</td>
      <td>${rateCell(s.banRate, 'red')}</td>
      <td class="num text-2">${pct(s.roleRate)}</td>
      <td class="num text-3">${s.sampleSize == null ? '未知' : num(s.sampleSize)}</td>
      <td><button class="btn icon sm ghost fav-btn ${fav ? 'text-gold' : ''}" data-key="${esc(s.championKey)}" title="收藏">${icon('star', 15)}</button></td>
    ` });
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.cmp-check') || e.target.closest('.fav-btn')) return;
      navigate('detail', { key: s.championKey, position: s.position });
    });
    tr.querySelector('.cmp-check').addEventListener('change', (e) => {
      const k = e.target.dataset.key;
      if (e.target.checked) { if (selected.size >= 2) { e.target.checked = false; toast('最多对比 2 个英雄', 'info'); return; } selected.add(k); }
      else selected.delete(k);
      updateCompareBtn(root);
    });
    tr.querySelector('.fav-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const k = e.currentTarget.dataset.key;
      const now = await window.nexus.favorites.toggle(k);
      await refreshFavorites();
      e.currentTarget.classList.toggle('text-gold', now);
      toast(now ? '已收藏 ' + (c.nameCn || k) : '已取消收藏', 'success');
    });
    body.appendChild(tr);
  }
  updateCompareBtn(root);
}

function updateCompareBtn(root) {
  const btn = root.querySelector('#btn-compare');
  root.querySelector('#cmp-count').textContent = selected.size;
  btn.disabled = selected.size !== 2;
}

async function openCompare() {
  const keys = [...selected];
  const [a, b] = await Promise.all(keys.map(k => window.nexus.data.champion(k)));
  const sa = a.stats.find(s => s.position === (a.stats[0] && a.stats[0].position)) || a.stats[0];
  const sb = b.stats[0];
  const row = (label, va, vb, fmt = (x) => x) => `<tr><td class="text-3">${esc(label)}</td><td class="num fw-6">${esc(fmt(va))}</td><td class="num fw-6">${esc(fmt(vb))}</td></tr>`;
  const body = el('div', { html: `
    <div class="grid grid-2 mb-4">
      ${[a, b].map(c => `<div class="flex items-center gap-3"><img src="${asset(c.imageUrl)}" style="width:56px;height:56px;border-radius:var(--r-md);border:1px solid var(--line-strong)"/><div><div class="fw-6 fs-16">${esc(c.nameCn)}</div><div class="fs-12 text-3">${esc(c.titleCn || '')}</div></div></div>`).join('')}
    </div>
    <table class="nx-table"><thead><tr><th>指标</th><th>${esc(a.nameCn)}</th><th>${esc(b.nameCn)}</th></tr></thead><tbody>
      ${row('梯队', sa && sa.tier, sb && sb.tier, x => x ? 'T' + x : '—')}
      ${row('胜率', sa && sa.winRate, sb && sb.winRate, pct)}
      ${row('登场率', sa && sa.pickRate, sb && sb.pickRate, pct)}
      ${row('禁用率', sa && sa.banRate, sb && sb.banRate, pct)}
      ${row('难度', a.difficulty, b.difficulty, x => x ?? '—')}
      ${row('定位', (a.tags || []).join('/'), (b.tags || []).join('/'))}
    </tbody></table>
    <div class="mt-3">${sourceTag(store.filter.region === 'cn' ? 'cn101' : 'opgg')}</div>` });
  modal({ title: '英雄对比', body, wide: true });
}