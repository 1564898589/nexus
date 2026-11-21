// NEXUS UI utilities: DOM, formatting, toast, modal.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 数字展示去掉无意义尾零（86.0% → 86%、2.40 → 2.4），保留有效小数
export const fx = (v, d = 1) => v == null ? '—' : String(parseFloat(Number(v).toFixed(d)));
export const pct = (x, d = 1) => x == null ? '—' : fx(x * 100, d) + '%';
export const num = (x) => x == null ? '—' : Number(x).toLocaleString('en-US');
export const asset = (rel) => rel ? `nexus-asset://${rel}` : '';
export const tierClass = (t) => 't' + Math.min(5, Math.max(1, t || 5));
export const tierLabel = (t) => t == null ? '—' : 'T' + t;

export const POS_CN = { TOP: '上路', JUNGLE: '打野', MID: '中路', MIDDLE: '中路', ADC: '下路', BOTTOM: '下路', SUPPORT: '辅助', UTILITY: '辅助', all: '全部' };
export const POSITIONS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
export const TIER_FILTERS = [
  { v: 'challenger', l: '最强王者' }, { v: 'grandmaster', l: '傲世宗师' }, { v: 'master', l: '超凡大师' },
  { v: 'diamond_plus', l: '钻石+' }, { v: 'emerald_plus', l: '翡翠+' }, { v: 'platinum_plus', l: '铂金+' },
  { v: 'gold_plus', l: '黄金+' }, { v: 'silver_plus', l: '白银+' }, { v: 'all', l: '全部段位' },
];
export const REGIONS = [{ v: 'kr', l: '韩服 KR' }, { v: 'cn', l: '国服 CN' }];
export const TIER_FILTERS_CN = [
  { v: 'emerald_plus', l: '翡翠+' }, { v: 'all', l: '全段位' }, { v: 'summit', l: '峡谷之巅' },
];
export const DIM_CN = { engage: '开团', poke: '消耗', splitpush: '分推', waveclear: '清线', frontline: '前排', peel: '保护', cc: '控制', burst: '爆发', dps: '持续输出', mobility: '机动', sustain: '续航', early: '前期', late: '后期', ad: '物理', ap: '魔法' };
export const TAG_CN = { Tank: '坦克', Fighter: '战士', Mage: '法师', Assassin: '刺客', Marksman: '射手', Support: '辅助' };

export function timeAgo(iso) {
  if (!iso) return '从未';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  return d + ' 天前';
}
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}

// ---- Toast ----
export function toast(msg, type = 'info', ms = 3200) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = el('div', { id: 'toasts' }); document.body.appendChild(wrap); }
  const iconName = type === 'success' ? 'check' : type === 'error' || type === 'warn' ? 'warn' : 'info';
  const t = el('div', { class: `toast ${type}`, html: `${icon(iconName, 18, 't-icon')}<span>${esc(msg)}</span>` });
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---- Modal ----
export function modal({ title, body, foot, wide = false, onClose }) {
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  let closed = false;
  const close = () => { if (closed) return; closed = true; overlay.remove(); document.removeEventListener('keydown', escHandler); if (onClose) onClose(); };
  // Esc closes only the TOPMOST modal (nested previews must not collapse the picker beneath)
  function escHandler(e) {
    if (e.key !== 'Escape') return;
    const all = document.querySelectorAll('.modal-overlay');
    if (all[all.length - 1] !== overlay) return;
    close();
  }
  const head = el('div', { class: 'modal-head' }, [
    el('div', { class: 'modal-title', text: title }),
    el('button', { class: 'win-btn', html: icon('close', 16), onClick: close }),
  ]);
  const bodyEl = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  box.appendChild(head); box.appendChild(bodyEl);
  if (foot) { const f = el('div', { class: 'modal-foot' }); if (typeof foot === 'string') f.innerHTML = foot; else f.appendChild(foot); box.appendChild(f); }
  overlay.appendChild(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', escHandler);
  document.body.appendChild(overlay);
  return { close, overlay, body: bodyEl, box };
}

export function confirmDialog({ title = '确认操作', message, confirmText = '确认', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const foot = el('div', { class: 'flex gap-2' }, [
      el('button', { class: 'btn ghost', text: '取消', onClick: () => finish(false) }),
      el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), text: confirmText, onClick: () => finish(true) }),
    ]);
    const m = modal({ title, body: el('div', { class: 'text-2 fs-13', style: { lineHeight: '1.7' }, html: message }), foot, onClose: () => finish(false) });
  });
}

export function sourceTag(kind = 'opgg', label) {
  const map = { opgg: ['OP.GG 韩服', ''], datadragon: ['Riot 官方', ''], lcu: ['LCU 客户端', 'lcu'], heuristic: ['启发式分析', 'heuristic'], local: ['本地', ''], cn101: ['国服 101 官方', 'cn'] };
  const [text, cls] = map[kind] || [label || kind, ''];
  return `<span class="source-tag ${cls}"><span class="src-dot"></span>${esc(label || text)}</span>`;
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function champImg(c, cls = '') { return `<img class="${cls}" src="${asset(c.imageUrl)}" alt="${esc(c.nameCn || c.name)}" loading="lazy">`; }