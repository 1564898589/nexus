// Shared helpers for the intelligence views (replay / growth / coach).
import { icon } from '../icons.js';
import { esc, asset, fmtTime, timeAgo, num, sourceTag, fx, pct, POS_CN } from '../util.js';
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

// 装备/技能/符文图标映射（懒加载缓存），供 OP.GG 式历史行与复盘视觉面板共用
let _itemMap = null, _spellMap = null, _runeMap = null, _styleMap = null;
export async function ensureIconMaps() {
  if (_itemMap && _spellMap && _runeMap && _styleMap) return;
  try {
    const [its, sps, runes, styles] = await Promise.all([window.nexus.data.items(), window.nexus.data.spells(), window.nexus.data.runes(), window.nexus.data.styles()]);
    _itemMap = {}; for (const it of its || []) _itemMap[it.id] = it;
    _spellMap = {}; for (const sp of sps || []) _spellMap[sp.id] = sp;
    _runeMap = {}; for (const r of runes || []) _runeMap[r.id] = r;
    _styleMap = {}; for (const s of styles || []) _styleMap[s.id] = s;
  } catch { _itemMap = _itemMap || {}; _spellMap = _spellMap || {}; _runeMap = _runeMap || {}; _styleMap = _styleMap || {}; }
}
const itemIcon = (id, size = 20) => { const it = _itemMap && _itemMap[id]; return it && it.imageUrl ? `<img src="${asset(it.imageUrl)}" title="${esc(it.nameCn || it.name || id)}" style="width:${size}px;height:${size}px;border-radius:3px"/>` : `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:3px;background:var(--panel-3)" title="${id}"></span>`; };
const spellIcon = (id, size = 20) => { const sp = _spellMap && _spellMap[id]; return sp && sp.icon ? `<img src="${asset(sp.icon)}" title="${esc(sp.nameCn || sp.name || id)}" style="width:${size}px;height:${size}px;border-radius:3px"/>` : ''; };
const runeIcon = (id, size = 20) => { const r = _runeMap && _runeMap[id]; return r && r.icon ? `<img src="${asset(r.icon)}" title="${esc(r.nameCn || r.name || id)}" style="width:${size}px;height:${size}px;border-radius:50%"/>` : ''; };
const styleIcon = (id, size = 20) => { const s = _styleMap && _styleMap[id]; return s && s.icon ? `<img src="${asset(s.icon)}" title="${esc(s.nameCn || s.name || id)}" style="width:${size}px;height:${size}px;border-radius:50%"/>` : ''; };
export { itemIcon, spellIcon, runeIcon, styleIcon };

// 五路对位经济对比（离线可用）：用缓存 participants 的真实总经济，按位置配对 my vs enemy。
export function laneGoldTable(parts, myTeamId) {
  const norm = (x) => String(x || '').toUpperCase().replace('MIDDLE', 'MID').replace('BOTTOM', 'ADC').replace('UTILITY', 'SUPPORT');
  const POS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
  const mine = (parts || []).filter(p => p.teamId === myTeamId);
  const enemy = (parts || []).filter(p => p.teamId !== myTeamId);
  const rows = POS.map(pos => {
    const m = mine.find(p => norm(p.position) === pos);
    const e = enemy.find(p => norm(p.position) === pos);
    const mg = m && m.gold != null ? m.gold : null;
    const eg = e && e.gold != null ? e.gold : null;
    return { pos, my: mg, en: eg, diff: (mg != null && eg != null) ? mg - eg : null, myName: m && m.name, enName: e && e.name, myChamp: m && m.championId, enChamp: e && e.championId };
  });
  const myTotal = mine.reduce((a, p) => a + (p.gold || 0), 0);
  const enTotal = enemy.reduce((a, p) => a + (p.gold || 0), 0);
  return { rows, myTotal, enTotal, diff: myTotal - enTotal };
}
export function laneGoldTableHTML(parts, myTeamId, tl) {
  const t = laneGoldTable(parts, myTeamId);
  const hasEnemy = t.rows.some(r => r.en != null);
  if (!t.rows.some(r => r.my != null || r.en != null) || !hasEnemy) {
    // 旧缓存仅含本人：用已缓存团队曲线终局值给出敌方团队经济与差距（真实数据），逐路待刷新补全
    const tg = ((tl && tl.teamGold) || []).filter(x => x.my != null && x.enemy != null);
    if (!tg.length) return '<div class="fs-12 text-3 mt-2">对位经济对比：该缓存缺少敌方经济数据，连接客户端后「刷新」补全十人真实经济（不伪造）。</div>';
    const last = tg[tg.length - 1];
    const my = last.my, en = last.enemy, d = my - en;
    return `<div class="fs-12 fw-6 mb-1 mt-2">团队经济对比（终局 · 真实缓存曲线） <span class="badge ${d >= 0 ? 'green' : 'red'}">${d >= 0 ? '我领先' : '我落后'} ${d >= 0 ? '+' : ''}${num(d)}</span></div>
      <div class="flex gap-3 fs-12" style="flex-wrap:wrap;padding:8px 10px;border-radius:var(--r-md);background:rgba(0,0,0,0.16);border:1px solid var(--line)">
        <span><span style="display:inline-block;width:12px;height:3px;background:var(--teal);vertical-align:middle"></span> 我方团队 <b class="num text-teal">${num(my)}</b></span>
        <span><span style="display:inline-block;width:12px;height:3px;background:var(--red);vertical-align:middle"></span> 敌方团队 <b class="num text-red">${num(en)}</b></span>
      </div>
      <div class="fs-11 text-3 mt-1">逐路对位经济需连接客户端后「刷新」补全十人数据（当前缓存仅含本人，不伪造逐路数值）。</div>`;
  }
  const cell = (v) => v != null ? num(v) : '—';
  const body = t.rows.map(r => {
    const mc = r.myChamp ? champBy(r.myChamp) : null; const ec = r.enChamp ? champBy(r.enChamp) : null;
    const d = r.diff;
    return `<tr>
      <td class="fs-12">${POS_CN[r.pos] || r.pos}</td>
      <td class="fs-12">${mc ? `<img src="${asset(mc.imageUrl)}" style="width:18px;height:18px;border-radius:3px;vertical-align:middle"/> ` : ''}${esc(mc ? mc.nameCn : (r.myName || '—'))}</td>
      <td class="num fs-12">${cell(r.my)}</td>
      <td class="fs-12">${ec ? `<img src="${asset(ec.imageUrl)}" style="width:18px;height:18px;border-radius:3px;vertical-align:middle"/> ` : ''}${esc(ec ? ec.nameCn : (r.enName || '—'))}</td>
      <td class="num fs-12">${cell(r.en)}</td>
      <td class="num fs-12 ${d == null ? 'text-3' : d >= 0 ? 'text-green' : 'text-red'}">${d == null ? '—' : (d >= 0 ? '+' : '') + num(d)}</td>
    </tr>`;
  }).join('');
  const td = t.diff;
  return `<div class="fs-12 fw-6 mb-1 mt-2">对位经济对比（真实总经济 · 离线可用） <span class="badge ${td >= 0 ? 'green' : 'red'}">团队 ${td >= 0 ? '+' : ''}${num(td)}</span></div>
    <table class="nx-table"><thead><tr><th>位置</th><th>我方</th><th>经济</th><th>敌方</th><th>经济</th><th>差值</th></tr></thead><tbody>${body}</tbody></table>`;
}

// 机制级对线指南面板：强势期 + 换血/兵线/防Gank/取胜路径四区，冠军专属（启发式）
export function laneGuideHTML(g) {
  if (!g || !g.sections) return '';
  const vBadge = g.verdict === 'advantage' ? 'green' : g.verdict === 'disadvantage' ? 'red' : 'amber';
  const vLabel = g.verdict === 'advantage' ? '占优' : g.verdict === 'disadvantage' ? '偏劣' : '均势';
  const head = `<div class="flex gap-2 items-center mb-2" style="flex-wrap:wrap">
    <span class="badge ${vBadge}">${vLabel}</span>
    <span class="fs-12 text-2">${esc(g.verdictText || '')}</span>
    ${g.myWinRate != null ? `<span class="badge teal">真实对位胜率 ${pct(g.myWinRate)}</span>` : ''}
    ${sourceTag('heuristic')}
  </div>
  <div class="fs-12 text-2 mb-3" style="line-height:1.7;padding:8px 10px;border-radius:var(--r-md);background:rgba(0,0,0,0.16);border:1px solid var(--line)">${icon('clock', 13, 'text-gold')} ${esc(g.spike ? g.spike.text : '')}</div>`;
  const cards = g.sections.map(s => `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:10px 12px;background:rgba(0,0,0,0.12)">
    <div class="fs-13 fw-6 mb-2 flex items-center gap-2">${icon(s.icon || 'spark', 15, 'text-teal')} ${esc(s.title)}</div>
    <div class="flex-col gap-2">${(s.lines || []).map(l => `<div class="fs-12 text-2 flex gap-2" style="line-height:1.7"><span class="text-teal" style="flex-shrink:0">·</span><span>${esc(l)}</span></div>`).join('')}</div>
  </div>`).join('');
  return `<div class="panel tight mb-3">
    <div class="fs-13 fw-6 mb-2 flex items-center gap-2">${icon('counter', 16, 'accent')} 对线指南 · ${esc(POS_CN[g.position] || g.position || '')}</div>
    ${head}
    <div class="grid grid-2" style="gap:10px">${cards}</div>
    <div class="fs-11 text-3 mt-2">${esc(g.note || '')}</div>
  </div>`;
}

// 打野刷野路线面板：原型 + 真实营序 + 首抓时机 + 入侵风险 + 资源优先级（启发式）
export function jungleRouteHTML(r) {
  if (!r || !r.route) return '';
  const riskBadge = r.invade && r.invade.risk === 'low' ? 'green' : r.invade && r.invade.risk === 'high' ? 'red' : 'amber';
  const riskLabel = r.invade && r.invade.risk === 'low' ? '可入侵' : r.invade && r.invade.risk === 'high' ? '慎遭遇' : '均势';
  const route = r.route.map((c, i) => `<span class="flex items-center gap-1" style="flex-shrink:0"><span class="badge gray" style="font-size:11px">${i + 1}</span><span class="fs-12 text-2">${esc(c)}</span></span>${i < r.route.length - 1 ? `<span class="text-3" style="flex-shrink:0">${icon('chevron', 12)}</span>` : ''}`).join('');
  const block = (ic, title, body, badge) => `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:10px 12px;background:rgba(0,0,0,0.12)">
    <div class="fs-13 fw-6 mb-1 flex items-center gap-2">${icon(ic, 15, 'text-teal')} ${esc(title)} ${badge || ''}</div>
    <div class="fs-12 text-2" style="line-height:1.7">${body}</div>
  </div>`;
  return `<div class="panel tight mb-3">
    <div class="fs-13 fw-6 mb-2 flex items-center gap-2">${icon('bolt', 16, 'accent')} 刷野路线 · ${esc(r.archetypeName || '')} <span class="badge gold">${esc(r.champion || '')}</span>${sourceTag('heuristic')}</div>
    <div class="fs-12 text-3 mb-2">${esc(r.routeReason || '')}</div>
    <div class="flex items-center gap-1 mb-3" style="flex-wrap:wrap;padding:8px 10px;border-radius:var(--r-md);background:rgba(0,0,0,0.16);border:1px solid var(--line)">${route}</div>
    <div class="grid grid-2" style="gap:10px">
      ${block('sword', '首抓时机', `<b class="text-gold">${esc(r.firstGank ? r.firstGank.timing : '')}</b><br/>${esc(r.firstGank ? r.firstGank.text : '')}`)}
      ${block('eye', '入侵 / 遭遇', esc(r.invade ? r.invade.text : ''), `<span class="badge ${riskBadge}" style="font-size:10px">${riskLabel}</span>`)}
      ${block('target', '资源优先级', `<b class="text-teal">${esc(r.objective ? r.objective.priority : '')}</b><br/>${esc(r.objective ? r.objective.text : '')}`)}
      ${block('spark', '打野要点', `<div class="flex-col gap-1">${(r.tips || []).map(t => `<div class="flex gap-2"><span class="text-teal" style="flex-shrink:0">·</span><span>${esc(t)}</span></div>`).join('')}</div>`)}
    </div>
    <div class="fs-11 text-3 mt-2">${esc(r.note || '')}</div>
  </div>`;
}

// 经济曲线图：时间轴 + 我方/敌方团队曲线 + 关键节点（龙/男爵/塔/击杀）标记。真实 SGP DETAILS 数据。
export function goldChartSVG(tl) {
  if (!tl) return '';
  const team = (tl.teamGold || []).filter(x => x.my != null || x.enemy != null);
  const me = tl.goldSeries || [];
  const hasEnemyCurve = team.some(x => x.enemy != null);
  const useTeam = team.length > 1 && hasEnemyCurve;
  // 敌方终局总经济（真实 SUMMARY 十人合计）：无逐分钟敌方曲线时作参考线，让对面经济离线可见
  const enemyFinal = (tl.enemyFinal != null && tl.enemyFinal > 0) ? tl.enemyFinal : null;
  const teamFallback = !useTeam && team.length > 1 && team.some(x => x.my != null) && enemyFinal != null;
  const showMyTeam = useTeam || teamFallback;
  const series = showMyTeam ? team : me.map(x => ({ t: x.t, my: x.gold, enemy: null }));
  if (!series.length) return '';
  const maxT = Math.max(...series.map(x => x.t), 1);
  const maxG = Math.max(...series.flatMap(x => [x.my || 0, x.enemy || 0]), enemyFinal || 0, 1);
  const W = 640, H = 190, L = 46, R = 10, T = 14, B = 26;
  const X = (t) => L + (t / maxT) * (W - L - R);
  const Y = (g) => H - B - (g / maxG) * (H - T - B);
  const line = (key) => series.filter(x => x[key] != null).map(x => `${X(x.t).toFixed(1)},${Y(x[key]).toFixed(1)}`).join(' ');
  // 时间轴刻度（每 5 分钟）
  let ticks = '';
  for (let t = 0; t <= maxT; t += 5) ticks += `<line x1="${X(t)}" y1="${H - B}" x2="${X(t)}" y2="${H - B + 4}" stroke="var(--line-strong)"/><text x="${X(t)}" y="${H - 8}" fill="var(--text-3)" font-size="10" text-anchor="middle">${t}分</text>`;
  // 经济轴刻度
  let gy = '';
  for (let i = 0; i <= 2; i++) { const g = (maxG / 2) * i; gy += `<line x1="${L}" y1="${Y(g)}" x2="${W - R}" y2="${Y(g)}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="${L - 6}" y="${Y(g) + 3}" fill="var(--text-3)" font-size="10" text-anchor="end">${(g / 1000).toFixed(0)}k</text>`; }
  // 关键节点标记
  const MON = { DRAGON: '龙', BARON_NASHOR: '男爵', RIFTHERALD: '先锋', HORDE: '虫', ATAKHAN: '厄塔汗' };
  let marks = '';
  for (const e of (tl.events || [])) {
    const x = X(e.t);
    if (e.kind === 'monster') {
      const label = MON[e.monster] || e.monster || '野怪';
      const col = e.mine ? 'var(--teal)' : 'var(--red)';
      marks += `<g><line x1="${x}" y1="${T}" x2="${x}" y2="${H - B}" stroke="${col}" stroke-dasharray="2 3" opacity="0.5"/><rect x="${x - 9}" y="${T}" width="18" height="14" rx="3" fill="${col}"/><text x="${x}" y="${T + 10}" fill="#04141c" font-size="9" text-anchor="middle" font-weight="700">${esc(label)}</text><title>${e.t}分 ${e.mine ? '我方' : '敌方'}拿下${label}</title></g>`;
    } else if (e.kind === 'tower') {
      const col = e.mine ? 'var(--teal)' : 'var(--red)';
      marks += `<g><rect x="${x - 4}" y="${H - B - 8}" width="8" height="8" rx="1" fill="${col}" opacity="0.85"/><title>${e.t}分 ${e.mine ? '我方' : '敌方'}推塔</title></g>`;
    }
  }
  // 对位经济差曲线（我 - 对位对手），零轴上方=领先
  const ld = (tl.laneDiff || []).filter(x => x.diff != null);
  let laneSvg = '', laneSummary = '';
  // 退化检测：旧缓存缺对位对手时差值会恒等于本人经济（对手=0），此时不得显示「领先」
  const mySeries = tl.goldSeries || [];
  const myFinal = mySeries.length ? mySeries[mySeries.length - 1].gold : null;
  const degenerate = myFinal != null && myFinal > 0 && ld.length > 0 && ld[ld.length - 1].diff === myFinal;
  if (degenerate || !hasEnemyCurve) {
    laneSvg = '<div class="fs-12 text-3 mt-1">对位经济差 / 敌方经济：该缓存缺少敌方数据，连接客户端后「刷新」补全十人真实经济（不伪造领先/落后）。</div>';
  } else if (ld.length > 1) {
    const maxD = Math.max(...ld.map(x => Math.abs(x.diff)), 1);
    const LH = 90, LT = 10, LB = 18;
    const LY = (d) => LT + (1 - (d / maxD + 1) / 2) * (LH - LT - LB);
    const zeroY = LY(0);
    const lpts = ld.map(x => `${X(x.t).toFixed(1)},${LY(x.diff).toFixed(1)}`).join(' ');
    const last = ld[ld.length - 1].diff;
    const lead = ld.filter(x => x.diff > 0).length / ld.length;
    // 领先/落后以终局差值符号为准（正=我领先），避免误判
    laneSummary = `<div class="fs-12 mt-1">对位经济：终局 <b class="${last >= 0 ? 'text-green' : 'text-red'}">${last >= 0 ? '+' : ''}${num(last)}</b>（${last >= 0 ? '我领先' : '我落后'}） · 过程中 ${Math.round(lead * 100)}% 时间领先${tl.laneOpponent ? ' · 对位 ' + esc(tl.laneOpponent.name || '') : ''}</div>`;
    laneSvg = `<div class="fs-12 fw-6 mt-2 mb-1">对位经济差（我 − 对位对手）</div><svg viewBox="0 0 ${W} ${LH}" style="width:100%;height:${LH}px"><line x1="${L}" y1="${zeroY}" x2="${W - R}" y2="${zeroY}" stroke="var(--line-strong)" stroke-dasharray="4 3"/><polyline points="${lpts}" fill="none" stroke="var(--gold)" stroke-width="2"/><text x="${L - 6}" y="${LY(maxD) + 3}" fill="var(--text-3)" font-size="10" text-anchor="end">+${(maxD / 1000).toFixed(1)}k</text><text x="${L - 6}" y="${LY(-maxD) + 3}" fill="var(--text-3)" font-size="10" text-anchor="end">-${(maxD / 1000).toFixed(1)}k</text></svg>${laneSummary}`;
  }
  const enemyLegend = useTeam ? '<span><span style="display:inline-block;width:14px;height:3px;background:var(--red);vertical-align:middle"></span> 敌方经济</span>'
    : enemyFinal != null ? '<span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed var(--red);vertical-align:middle"></span> 敌方终局（参考线）</span>' : '';
  const legend = `<div class="flex gap-3 fs-11 text-3 mt-1" style="flex-wrap:wrap"><span><span style="display:inline-block;width:14px;height:3px;background:${showMyTeam ? 'var(--teal)' : 'var(--gold)'};vertical-align:middle"></span> ${showMyTeam ? '我方团队经济' : '本人经济'}</span>${enemyLegend}<span>竖线=龙/男爵/先锋 · 方块=推塔（青=我方 红=敌方）</span></div>`;
  const myCol = showMyTeam ? 'var(--teal)' : 'var(--gold)';
  const enemyRef = (!useTeam && enemyFinal != null) ? `<line x1="${L}" y1="${Y(enemyFinal).toFixed(1)}" x2="${W - R}" y2="${Y(enemyFinal).toFixed(1)}" stroke="var(--red)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - R}" y="${(Y(enemyFinal) - 4).toFixed(1)}" fill="var(--red)" font-size="10" text-anchor="end">敌方终局 ${(enemyFinal / 1000).toFixed(0)}k</text>` : '';
  const enemyNote = teamFallback ? '<div class="fs-11 text-3 mt-1">敌方为终局总经济参考线（真实十人合计）；逐分钟敌方曲线需连接客户端后「刷新」补全。</div>' : '';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">${gy}${ticks}<polyline points="${line('my')}" fill="none" stroke="${myCol}" stroke-width="2"/>${useTeam ? `<polyline points="${line('enemy')}" fill="none" stroke="var(--red)" stroke-width="2"/>` : enemyRef}${marks}</svg>${legend}${enemyNote}${laneSvg}`;
}

// OP.GG 式历史对局行：胜负+英雄+等级+技能+符文+KDA+补刀+六神装+经济/伤害/视野，一行看全
export function matchRow(m, onClick) {
  const ch = m.championId ? champBy(m.championId) : null;
  const kdaRatio = m.deaths ? (m.kills + m.assists) / m.deaths : (m.kills + m.assists);
  const kda = fx(kdaRatio, 2);
  const cat = modeCat(m.queueId, m.mode);
  const modeCls = cat.key === 'solo' || cat.key === 'flex' ? 'gold' : cat.key === 'aram' ? 'purple' : cat.key === 'bot' ? 'gray' : 'teal';
  const items = (m.items || []).slice(0, 6);
  const spells = (m.spells || []).slice(0, 2);
  const perks = m.perks || null;
  const csMin = m.duration ? fx(m.cs / (m.duration / 60)) : null;
  const winCls = m.win === true ? 'var(--green)' : m.win === false ? 'var(--red)' : 'var(--line-strong)';
  return `<div class="flex items-center gap-2 fs-12" data-game="${m.gameId}" style="padding:8px;border-radius:var(--r-md);border:1px solid var(--line);border-left:3px solid ${winCls};cursor:pointer;margin-bottom:5px;background:rgba(0,0,0,0.12)">
    <div class="flex-col items-center gap-1" style="flex-shrink:0">
      ${ch ? `<img src="${asset(ch.imageUrl)}" style="width:36px;height:36px;border-radius:var(--r-sm)"/>` : '<div style="width:36px;height:36px;border-radius:var(--r-sm);background:var(--panel-3)"></div>'}
      <span class="badge ${m.win === true ? 'green' : m.win === false ? 'red' : 'gray'}" style="font-size:10px;padding:0 5px">${m.win === true ? '胜' : m.win === false ? '负' : '?'}</span>
    </div>
    <div class="flex-col gap-1" style="flex-shrink:0">
      <div class="flex gap-1">${spells.map(id => spellIcon(id, 18)).join('') || '<span style="width:18px;height:18px"></span>'}</div>
      <div class="flex gap-1">${perks ? runeIcon(perks.keystone, 18) + styleIcon(perks.primary, 18) + styleIcon(perks.sub, 18) : '<span style="width:18px;height:18px"></span>'}</div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="fw-6 truncate">${ch ? esc(ch.nameCn) : '英雄未知'} <span class="badge ${modeCls}" style="font-size:10px;padding:0 5px;vertical-align:middle">${esc(cat.label)}</span>${m.level != null ? ` <span class="text-3">Lv${m.level}</span>` : ''}</div>
      <div class="text-3 truncate">${m.gameCreation ? timeAgo(m.gameCreation) : '时间未知'} · ${m.duration ? Math.round(m.duration / 60) + '分钟' : '时长未知'}</div>
      <div class="num" style="margin-top:2px"><b style="color:${m.win === true ? 'var(--green)' : m.win === false ? 'var(--red)' : 'var(--text-2)'}">${m.kills ?? '—'}/${m.deaths ?? '—'}/${m.assists ?? '—'}</b> <span class="text-3">KDA ${kda}</span></div>
      <div class="text-3">${m.cs != null ? `补刀 ${m.cs}${csMin != null ? ' (' + csMin + '/分)' : ''}` : ''}</div>
    </div>
    <div class="flex gap-1" style="flex-shrink:0;flex-wrap:wrap;max-width:132px">${items.map(id => itemIcon(id, 20)).join('') || '<span class="text-3">—</span>'}</div>
    <div class="flex-col gap-1 text-3 num" style="flex-shrink:0;text-align:right;font-size:11px">
      ${m.gold != null ? `<span title="总经济">金 ${num(m.gold)}</span>` : ''}
      ${m.damage != null ? `<span title="对英雄伤害">伤 ${num(m.damage)}</span>` : ''}
      ${m.vision != null ? `<span title="视野得分">视 ${m.vision}</span>` : ''}
    </div>
  </div>`;
}