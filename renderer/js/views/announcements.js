// 官方公告中心 — NEXUS Official Announcements（开发者：竖）.
import { icon } from '../icons.js';
import { el, esc, fmtTime, toast, modal } from '../util.js';
import { store } from '../store.js';

const TYPE_COLOR = { '版本更新': 'gold', '新功能上线': 'teal', '功能优化': 'green', '数据源调整': 'purple', '兼容性说明': 'amber', '已知问题': 'red', '重要通知': 'red', '产品更新': 'teal', '系统维护': 'gray' };

export async function render(root) {
  const list = await window.nexus.ann.list();
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('book', 26, 'accent')} 官方公告中心 <span class="accent">ANNOUNCEMENTS</span></div>
      <div class="page-sub">开发者：竖 · 本地公告管理，不依赖云服务器</div>
    </div>
    <div class="flex items-center justify-between mb-4" style="flex-wrap:wrap;gap:8px">
      <div class="fs-12 text-3">${list.length} 条公告 · ${list.filter(a => !a.read).length} 条未读</div>
      <div class="flex gap-2 items-center">
        <input class="nx-input" id="ann-q" type="text" placeholder="搜索标题/内容/类型…" autocomplete="off" style="width:200px" />
        <button class="btn ghost sm" id="ann-readall">${icon('check', 14)} 全部已读</button>
        <button class="btn ghost sm" id="ann-import">${icon('upload', 14)} 导入公告</button>
      </div>
    </div>
    <div id="ann-list" class="flex-col gap-3"></div>
  `;
  const wrap = root.querySelector('#ann-list');
  const drawList = (q) => {
    const ql = (q || '').trim().toLowerCase();
    const rows = ql ? list.filter(a => [a.title, a.body, a.type, a.version].join(' ').toLowerCase().includes(ql)) : list;
    wrap.innerHTML = '';
    if (!rows.length) { wrap.innerHTML = `<div class="empty-state">${icon('book', 36)}<div class="es-title">无匹配公告</div><div>没有包含「${esc(q)}」的公告。</div></div>`; return; }
    for (const a of rows) {
      const card = el('div', { class: 'panel', style: { cursor: 'pointer', borderLeft: `3px solid ${a.read ? 'var(--line)' : 'var(--teal)'}` }, html: `
        <div class="flex items-center gap-3">
          <span class="badge ${TYPE_COLOR[a.type] || 'gray'}">${esc(a.type)}</span>
          ${a.important ? '<span class="badge red">重要</span>' : ''}
          <div class="fw-6 fs-16" style="flex:1;color:${a.read ? 'var(--text-2)' : 'var(--gold-bright)'}">${esc(a.title)}</div>
          ${!a.read ? '<span class="lcu-dot on"></span>' : ''}
        </div>
        <div class="fs-12 text-3 mt-2">v${esc(a.version || '')} · ${fmtTime(a.createdAt)} · 开发者：竖</div>
        <div class="fs-13 text-2 mt-2" style="line-height:1.7">${esc((a.body || '').slice(0, 120))}${(a.body || '').length > 120 ? '…' : ''}</div>
      ` });
      card.addEventListener('click', () => openAnn(a.id));
      wrap.appendChild(card);
    }
  };
  drawList('');
  root.querySelector('#ann-q').addEventListener('input', (e) => drawList(e.target.value));
  root.querySelector('#ann-readall').addEventListener('click', async () => { await window.nexus.ann.readAll(); render(root); toast('已全部标记已读', 'success'); });
  root.querySelector('#ann-import').addEventListener('click', () => {
    const ta = el('textarea', { class: 'nx-textarea', placeholder: '粘贴公告 JSON（数组或 {announcements:[...]}）', style: { minHeight: '160px' } });
    const m = modal({ title: '导入本地公告', body: ta, foot: el('button', { class: 'btn primary', text: '导入', onClick: async () => { try { const j = JSON.parse(ta.value); const n = await window.nexus.ann.import(j); m.close(); toast('已导入 ' + n + ' 条公告', 'success'); render(root); } catch (e) { toast('JSON 解析失败：' + e.message, 'error'); } } }) });
  });
  return {};
}

export async function openAnn(id) {
  const a = await window.nexus.ann.get(id);
  if (!a) return;
  await window.nexus.ann.read(id);
  const sec = (title, arr, color) => arr && arr.length ? `<div class="mb-3"><div class="fs-12 fw-6 mb-2" style="color:${color}">${title}</div>${arr.map(x => `<div class="fs-13 text-2 mb-1" style="line-height:1.7">· ${esc(x)}</div>`).join('')}</div>` : '';
  const body = el('div', { html: `
    <div class="flex items-center gap-2 mb-3"><span class="badge ${TYPE_COLOR[a.type] || 'gray'}">${esc(a.type)}</span>${a.important ? '<span class="badge red">重要</span>' : ''}<span class="fs-12 text-3">v${esc(a.version || '')} · ${fmtTime(a.createdAt)}</span></div>
    <div class="fs-13 text-2 mb-4" style="line-height:1.9">${esc(a.body || '')}</div>
    ${sec('新增功能', a.added, 'var(--teal)')}
    ${sec('优化内容', a.improved, 'var(--green)')}
    ${sec('修复问题', a.fixed, 'var(--gold)')}
    ${sec('已知问题', a.known, 'var(--amber)')}
    <div class="divider"></div>
    <div class="fs-12 text-3">开发者：竖</div>
  ` });
  const foot = el('div', { class: 'flex gap-2' });
  if (a.requireAck && !a.acked) foot.appendChild(el('button', { class: 'btn primary', text: '我已阅读并确认', onClick: async () => { await window.nexus.ann.ack(id); m.close(); } }));
  else foot.appendChild(el('button', { class: 'btn ghost', text: '关闭', onClick: () => m.close() }));
  const m = modal({ title: a.title, body, foot, wide: true });
}