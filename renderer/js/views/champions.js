// 英雄资料库 — Champion Database grid.
import { icon } from '../icons.js';
import { el, esc, asset, POS_CN, POSITIONS, TAG_CN, sourceTag } from '../util.js';
import { store, navigate, loadChampions } from '../store.js';

let q = '', pos = 'all', tag = 'all';

export async function render(root) {
  root.innerHTML = `<div class="skeleton" style="height:64px"></div><div class="grid grid-3 gap-2 mt-3">${'<div class="skeleton" style="height:120px"></div>'.repeat(6)}</div>`;
  await loadChampions();
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('champion', 26, 'accent')} 英雄资料库 <span class="accent">DATABASE</span></div>
      <div class="page-sub">Riot 官方中文资料 · ${store.champions.length} 位英雄 · 背景故事 / 技能 / 出装 / 符文</div>
    </div>
    <div class="panel tight mb-4">
      <div class="flex items-center gap-3" style="flex-wrap:wrap">
        <div class="search-box" style="width:260px">${icon('search', 16)}<input id="db-search" placeholder="搜索英雄…" value="${esc(q)}"/></div>
        <div class="chip-row" id="db-pos"></div>
        <div class="chip-row" id="db-tag"></div>
      </div>
    </div>
    <div class="flex items-center justify-between mb-3"><div class="fs-12 text-3" id="db-count"></div>${sourceTag('datadragon')}</div>
    <div id="db-grid" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px"></div>
  `;
  const posWrap = root.querySelector('#db-pos');
  for (const p of ['all', ...POSITIONS]) posWrap.appendChild(el('button', { class: 'chip' + (pos === p ? ' active' : ''), text: POS_CN[p], onClick: () => { pos = p; draw(root); } }));
  const tagWrap = root.querySelector('#db-tag');
  for (const t of ['all', 'Tank', 'Fighter', 'Mage', 'Assassin', 'Marksman', 'Support']) tagWrap.appendChild(el('button', { class: 'chip' + (tag === t ? ' active' : ''), text: t === 'all' ? '全部定位' : TAG_CN[t], onClick: () => { tag = t; draw(root); } }));
  root.querySelector('#db-search').addEventListener('input', (e) => { q = e.target.value; draw(root); });
  draw(root);
  return {};
}

function draw(root) {
  const grid = root.querySelector('#db-grid');
  const ql = q.trim().toLowerCase();
  let list = store.champions.filter(c => {
    if (ql && !((c.nameCn || '').toLowerCase().includes(ql) || (c.name || '').toLowerCase().includes(ql) || (c.key || '').includes(ql))) return false;
    if (pos !== 'all' && !(c.positions || []).includes(pos)) return false;
    if (tag !== 'all' && !(c.tags || []).includes(tag)) return false;
    return true;
  });
  root.querySelector('#db-count').textContent = `${list.length} 位英雄`;
  root.querySelectorAll('#db-pos .chip').forEach((c, i) => c.classList.toggle('active', ['all', ...POSITIONS][i] === pos));
  root.querySelectorAll('#db-tag .chip').forEach((c, i) => c.classList.toggle('active', ['all', 'Tank', 'Fighter', 'Mage', 'Assassin', 'Marksman', 'Support'][i] === tag));
  grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${icon('champion', 48)}<div class="es-title">无匹配英雄</div></div>`; return; }
  for (const c of list) {
    const card = el('div', { class: 'champ-card', 'data-key': c.key, html: `
      <div style="position:relative;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line);aspect-ratio:1;transition:transform .18s,border-color .18s">
        <img src="${asset(c.imageUrl)}" alt="${esc(c.nameCn)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"/>
        <div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(1,10,19,0.9),transparent 55%)"></div>
        <div style="position:absolute;bottom:8px;left:10px;right:10px">
          <div class="fw-6" style="color:var(--gold-bright)">${esc(c.nameCn || c.name)}</div>
          <div class="fs-12 text-3 truncate">${esc(c.titleCn || '')}</div>
        </div>
        <div style="position:absolute;top:6px;right:6px;display:flex;gap:3px">${(c.positions || []).slice(0, 2).map(p => `<span class="badge gray" style="font-size:11px;padding:1px 5px">${esc(POS_CN[p] || p)}</span>`).join('')}</div>
      </div>` });
    card.style.cursor = 'pointer';
    const inner = card.firstElementChild;
    card.addEventListener('mouseenter', () => inner.style.transform = 'translateY(-3px)');
    card.addEventListener('mouseleave', () => inner.style.transform = 'none');
    card.addEventListener('click', () => navigate('detail', { key: c.key }));
    grid.appendChild(card);
  }
}