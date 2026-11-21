// Shared helpers for the intelligence views (replay / growth / coach).
import { esc, asset, fmtTime, sourceTag, fx } from '../util.js';
import { store, loadChampions } from '../store.js';
import { reportBlock, bindReport } from '../report-ui.js';

export const GRADE_COLOR = { S: 'var(--t1)', A: 'var(--teal)', B: 'var(--blue)', C: 'var(--purple)', D: 'var(--red)' };

export function champBy(id) { return store.champions.find(c => c.id === id) || null; }

// ---- 模式分类（与后端 analytics/replay.js 同一口径）----
const QUEUE_CAT = {
  420: ['solo', '单双排'], 440: ['flex', '灵活组排'], 450: ['aram', '大乱斗'],
  400: ['normal', '匹配'], 430: ['normal', '匹配'],
  480: ['swift', '快速模式'], 870: ['swift', '快速模式'], 880: ['swift', '快速模式'],
  800: ['bot', '人机'], 810: ['bot', '人机'], 820: ['bot', '人机'], 830: ['bot', '人机'], 840: ['bot', '人机'], 850: ['bot', '人机'],
  1700: ['arena', '竞技场'], 1710: ['arena', '竞技场'], 2400: ['arena', '竞技场'], 2410: ['arena', '竞技场'],
  900: ['urf', '无限火力'], 1900: ['urf', '无限火力'], 1200: ['blitz', '极限闪击'], 1300: ['blitz', '极限闪击'],
  1400: ['ultbook', '终极魔典'], 1410: ['ultbook', '终极魔典'], 1420: ['ultbook', '终极魔典'], 1430: ['ultbook', '终极魔典'],
  3140: ['practice', '训练模式'],
  700: ['tutorial', '教程'], 2000: ['tutorial', '教程'], 2010: ['tutorial', '教程'], 2020: ['tutorial', '教程'],
};
const CORE_KEYS = ['solo', 'flex', 'aram', 'bot', 'normal', 'swift', 'arena'];
const MODE_ORDER = ['solo', 'flex', 'normal', 'swift', 'aram', 'bot', 'practice', 'arena', 'urf', 'blitz', 'ultbook', 'classic', 'tutorial', 'other'];
export function modeCat(queueId, mode) {
  const q = QUEUE_CAT[queueId];
  if (q) return { key: q[0], label: q[1] };
  const ms = String(mode || '').toUpperCase();
  if (ms === 'ARAM') return { key: 'aram', label: '大乱斗' };
  if (ms === 'SWIFTPLAY') return { key: 'swift', label: '快速模式' };
  if (ms === 'PRACTICETOOL') return { key: 'practice', label: '训练模式' };
  if (ms === 'TUTORIAL') return { key: 'tutorial', label: '教程' };
  if (ms === 'URF') return { key: 'urf', label: '无限火力' };
  if (ms === 'NEXUSBLITZ') return { key: 'blitz', label: '极限闪击' };
  if (ms === 'ULTBOOK') return { key: 'ultbook', label: '终极魔典' };
  if (ms === 'CHERRY' || ms === 'KIWI') return { key: 'arena', label: '竞技场' };
  if (ms === 'CLASSIC') return { key: 'classic', label: '召唤师峡谷' };
  return { key: 'other', label: mode || '其他' };
}
export function inMode(m, key) {
  if (!key || key === 'all') return true;
  const c = modeCat(m.queueId, m.mode);
  if (key === 'other') return !CORE_KEYS.includes(c.key);
  return c.key === key;
}
// 当前筛选 key 的中文标签（从真实对局推导）。
export function modeLabelFor(matches, key) {
  if (!key || key === 'all') return '全部模式';
  if (key === 'other') return '其他模式';
  const m = (matches || []).find(x => inMode(x, key));
  return m ? modeCat(m.queueId, m.mode).label : key;
}
function chipRow() { const row = document.createElement('div'); row.className = 'chip-row mb-2'; row.style.flexWrap = 'wrap'; return row; }
function chip(key, label, n, current, onPick) {
  const b = document.createElement('button');
  b.className = 'chip' + (key === current ? ' active' : '');
  b.dataset.mode = key;
  b.textContent = `${label} ${n}`;
  b.addEventListener('click', () => onPick(key));
  return b;
}
// 复盘列表：按真实出现的模式动态生成筛选 chips（含计数），排位优先。
export function modeFilterRow(matches, current, onPick) {
  const map = {};
  for (const m of matches) { const c = modeCat(m.queueId, m.mode); const e = map[c.key] || (map[c.key] = { label: c.label, n: 0 }); e.n++; }
  const rank = (k) => { const i = MODE_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  const keys = Object.keys(map).sort((a, b) => rank(a) - rank(b));
  const row = chipRow();
  row.appendChild(chip('all', '全部', matches.length, current, onPick));
  for (const k of keys) row.appendChild(chip(k, map[k].label, map[k].n, current, onPick));
  return row;
}
// 成长页：后端已算好 modes=[{key,label,n}]，直接渲染。
export function modeChipsFromCounts(modes, current, onPick) {
  const row = chipRow();
  for (const f of (modes || [])) row.appendChild(chip(f.key, f.key === 'all' ? '全部' : f.label, f.n, current, onPick));
  return row;
}

// Account picker: recent queried + favorited players + self. Persisted selection.
export async function accountBar(root, current, onPick) {
  await loadChampions();
  const [recent, favs, cfg] = await Promise.all([window.nexus.player.recent(), window.nexus.player.favorites(), window.nexus.config.get()]);
  const selfPuuid = cfg.selfPuuid || null;
  const seen = new Set(); const list = [];
  for (const p of [...recent, ...favs]) { if (p.puuid && !seen.has(p.puuid)) { seen.add(p.puuid); list.push(p); } }
  const sel = current || cfg.intelPuuid || selfPuuid || (list[0] && list[0].puuid) || null;
  const bar = root.querySelector('#intel-account');
  if (!bar) return sel;
  bar.innerHTML = `
    <div class="flex items-center gap-2" style="flex-wrap:wrap">
      <span class="fs-12 text-3">分析账号</span>
      <select class="nx-select" id="intel-sel" style="max-width:280px">
        ${list.length ? list.map(p => `<option value="${esc(p.puuid)}" ${p.puuid === sel ? 'selected' : ''}>${esc(p.name || p.puuid.slice(0, 8))}${p.puuid === selfPuuid ? '（自己）' : ''}${p.serverId ? ' · ' + esc(p.serverId) : ''}</option>`).join('') : '<option value="">暂无已查询账号</option>'}
      </select>
      ${sel ? `<button class="btn ghost sm" id="intel-self">${sel === selfPuuid ? '✓ 已设为自己' : '设为自己'}</button>` : ''}
      <span class="fs-12 text-3">账号来自你在玩家战绩中心的真实查询记录；无记录时请先查询。</span>
    </div>`;
  const s = bar.querySelector('#intel-sel');
  if (s) s.addEventListener('change', async () => { await window.nexus.config.set('intelPuuid', s.value); onPick(s.value); });
  const selfBtn = bar.querySelector('#intel-self');
  if (selfBtn) selfBtn.addEventListener('click', async () => { await window.nexus.config.set('selfPuuid', sel); onPick(sel); });
  return sel;
}

export function tagSection(title, items, cls) {
  if (!items || !items.length) return '';
  return `<div class="mb-3"><div class="section-title" style="font-size:13px">${title}</div>
    <div class="fs-12 text-2" style="line-height:1.9">${items.map(t => `<div class="flex gap-2"><span class="badge ${cls}" style="font-size:11px;flex-shrink:0;margin-top:2px">${cls === 'green' ? '事实' : cls === 'amber' ? '推断' : '建议'}</span><span>${esc(t)}</span></div>`).join('')}</div></div>`;
}

export function taggedReport(r) {
  return tagSection('事实（真实数据）', r.facts, 'green') + tagSection('推断（基于数据的推理）', r.inferences, 'amber') + tagSection('建议（可执行）', r.advice, 'teal');
}

// Unified AI report engine (structured JSON + safe markdown fallback + rule fallback).
export function aiBlock(id, opts) { return reportBlock(id, opts); }
export function bindAi(root, id, task, payloadFn, opts) { return bindReport(root, id, task, payloadFn, opts); }

export function matchRow(m, onClick) {
  const ch = m.championId ? champBy(m.championId) : null;
  const kda = fx(m.deaths ? (m.kills + m.assists) / m.deaths : (m.kills + m.assists), 2);
  const cat = modeCat(m.queueId, m.mode);
  const modeCls = cat.key === 'solo' || cat.key === 'flex' ? 'gold' : cat.key === 'aram' ? 'purple' : cat.key === 'bot' ? 'gray' : 'teal';
  return `<div class="flex items-center gap-2 fs-12" data-game="${m.gameId}" style="padding:7px 8px;border-radius:var(--r-md);border:1px solid var(--line);cursor:pointer;margin-bottom:4px">
    <span class="badge ${m.win === true ? 'green' : m.win === false ? 'red' : 'gray'}" style="width:34px;justify-content:center">${m.win === true ? '胜' : m.win === false ? '负' : '?'}</span>
    ${ch ? `<img src="${asset(ch.imageUrl)}" style="width:28px;height:28px;border-radius:var(--r-sm)"/>` : '<div style="width:28px;height:28px;border-radius:var(--r-sm);background:var(--panel-3)"></div>'}
    <div style="flex:1;min-width:0"><div class="fw-6 truncate">${ch ? esc(ch.nameCn) : '英雄未知'} <span class="badge ${modeCls}" style="font-size:10px;padding:0 5px;vertical-align:middle">${esc(cat.label)}</span></div><div class="text-3">${m.gameCreation ? fmtTime(m.gameCreation) : '时间未知'} · ${m.duration ? Math.round(m.duration / 60) + '分钟' : '时长未知'}</div></div>
    <span class="num">${m.kills ?? '—'}/${m.deaths ?? '—'}/${m.assists ?? '—'}</span>
    <span class="text-3">KDA ${kda}</span>
  </div>`;
}