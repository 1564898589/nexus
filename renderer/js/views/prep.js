// 对局准备工作台 — Match Prep Workbench.
import { icon } from '../icons.js';
import { el, esc, asset, POS_CN, POSITIONS, sourceTag, toast, modal, confirmDialog, fmtTime } from '../util.js';
import { store, navigate, getChamp, loadChampions } from '../store.js';
import { renderRunes } from './detail.js';

export async function render(root) {
  await loadChampions();
  const list = await window.nexus.prep.list();
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('prep', 26, 'accent')} 对局准备工作台 <span class="accent">PREP</span></div>
      <div class="page-sub">保存你的 BP 方案与对局笔记 · 赛前快速回顾阵容思路与推荐符文</div>
    </div>
    <div class="flex items-center justify-between mb-4">
      <div class="fs-12 text-3">${list.length} 个准备方案</div>
      <button class="btn primary sm" id="prep-new">${icon('plus', 15)} 新建准备</button>
    </div>
    <div id="prep-list" class="grid grid-2"></div>
  `;
  root.querySelector('#prep-new').addEventListener('click', () => navigate('bp'));
  const wrap = root.querySelector('#prep-list');
  if (!list.length) {
    wrap.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="empty-state">${icon('prep', 48)}<div class="es-title">还没有准备方案</div><div>在 BP 模拟器中完成选人后，点击「存入对局准备」。</div><button class="btn primary mt-3" id="go-bp">前往 BP 模拟器</button></div></div>`;
    wrap.querySelector('#go-bp').addEventListener('click', () => navigate('bp'));
    return {};
  }
  for (const item of list) {
    const rec = await window.nexus.prep.load(item.id);
    const bp = rec.data && rec.data.bp;
    const blue = bp ? bp.blue.filter(Boolean) : [];
    const card = el('div', { class: 'panel', html: `
      <div class="panel-h"><div class="panel-title">${esc(item.name)}</div><button class="btn danger sm icon prep-del" title="删除">${icon('trash', 14)}</button></div>
      <div class="fs-12 text-3 mb-3">${fmtTime(item.createdAt)}</div>
      <div class="flex gap-1 mb-3">${blue.map(p => { const c = getChamp(p.key); return c ? `<img src="${asset(c.imageUrl)}" style="width:40px;height:40px;border-radius:var(--r-md);border:1px solid var(--line)" title="${esc(c.nameCn)} · ${POS_CN[p.position]}"/>` : ''; }).join('') || '<span class="text-3 fs-13">无阵容</span>'}</div>
      ${rec.data && rec.data.note ? `<div class="fs-13 text-2 mb-3" style="line-height:1.6">${esc(rec.data.note)}</div>` : ''}
      <button class="btn ghost sm prep-open">${icon('eye', 14)} 查看详情</button>
    ` });
    card.querySelector('.prep-del').addEventListener('click', async () => { if (await confirmDialog({ title: '删除准备方案', message: `确定删除「${esc(item.name)}」？`, danger: true, confirmText: '删除' })) { await window.nexus.prep.delete(item.id); render(root); } });
    card.querySelector('.prep-open').addEventListener('click', () => openPrep(rec));
    wrap.appendChild(card);
  }
  return {};
}

async function openPrep(rec) {
  const bp = rec.data && rec.data.bp;
  const body = el('div', {});
  if (bp) {
    const cmp = await window.nexus.analysis.compare(bp.blue, bp.red);
    const sideHtml = (side, label, color) => `<div class="mb-4"><div class="fw-6 mb-2" style="color:${color}">${label}</div>
      <div class="flex gap-2">${bp[side].map((p, i) => { const c = p ? getChamp(p.key) : null; return `<div class="flex-col items-center gap-1" style="width:64px">${c ? `<img src="${asset(c.imageUrl)}" style="width:48px;height:48px;border-radius:var(--r-md)"/>` : '<div class="item-icon"></div>'}<span class="fs-12 text-3">${POS_CN[POSITIONS[i]]}</span><span class="fs-12 truncate" style="max-width:64px">${c ? esc(c.nameCn) : '—'}</span></div>`; }).join('')}</div></div>`;
    body.innerHTML = sideHtml('blue', '蓝色方', '#0AC8B9') + sideHtml('red', '红色方', '#E84057');
    const sum = el('div', { class: 'panel tight mt-3', html: `<div class="fs-12 text-3 mb-2">阵容要点（启发式）</div>
      <div class="grid grid-2"><div><div class="fs-12 text-green fw-6 mb-1">蓝方优势</div>${cmp.blue.strengths.slice(0, 3).map(s => `<div class="fs-12 text-2">· ${esc(s)}</div>`).join('')}</div>
      <div><div class="fs-12 text-red fw-6 mb-1">蓝方短板</div>${cmp.blue.weaknesses.slice(0, 3).map(s => `<div class="fs-12 text-2">· ${esc(s)}</div>`).join('')}</div></div>` });
    body.appendChild(sum);
    // recommended runes for blue picks
    const runesWrap = el('div', { class: 'mt-4' });
    for (const p of bp.blue.filter(Boolean).slice(0, 2)) {
      const b = await window.nexus.data.build(p.key, p.position);
      if (b && b.data) {
        const c = getChamp(p.key);
        const sec = el('div', { class: 'panel tight mt-3', html: `<div class="fw-6 mb-2">${esc(c.nameCn)} · ${POS_CN[p.position]} 推荐符文 ${sourceTag('opgg')}</div>` });
        const rw = el('div', {}); sec.appendChild(rw); renderRunes(rw, b.data);
        runesWrap.appendChild(sec);
      }
    }
    body.appendChild(runesWrap);
  } else body.innerHTML = '<div class="text-3">无阵容数据</div>';
  // 笔记可编辑（P3-3）：textarea + 保存回写 prep_saves.data.note
  const noteSec = el('div', { class: 'panel tight mt-3' });
  noteSec.innerHTML = `<div class="flex items-center justify-between mb-1"><span class="fs-12 text-3">对局笔记（可编辑）</span><button class="btn ghost sm" id="prep-note-save">${icon('check', 12)} 保存笔记</button></div>`;
  const ta = el('textarea', { class: 'nx-textarea', style: { minHeight: '90px' }, placeholder: '记录这套阵容的思路、对线要点、出装/符文调整…' });
  ta.value = (rec.data && rec.data.note) || '';
  noteSec.appendChild(ta);
  body.appendChild(noteSec);
  const m = modal({ title: rec.name, body, wide: true });
  noteSec.querySelector('#prep-note-save').addEventListener('click', async () => {
    const data = { ...(rec.data || {}), note: ta.value };
    await window.nexus.prep.update(rec.id, data);
    rec.data = data;
    toast('笔记已保存', 'success', 1600);
  });
}