// NEXUS LIVE — lightweight always-on-top floating intel window.
// Read-only: polls the same warroom:live intel as the main window. No client writes.
import { icon } from './icons.js';
import { esc, asset, pct, POS_CN } from './util.js';

const GRADE_COLOR = { S: 'var(--t1)', A: 'var(--teal)', B: 'var(--blue)', C: 'var(--purple)', D: 'var(--red)' };
const body = document.getElementById('live-body');
let champs = [];
let polling = false;
let lastActive = null;

function champBy(id) { return champs.find(c => c.id === id) || null; }

function gradeBadge(r) {
  if (!r || !r.grade) return '<span class="badge gray" style="font-size:11px">?</span>';
  return `<span class="tier-badge" style="background:${GRADE_COLOR[r.grade]};width:22px;height:22px;font-size:11px">${r.grade}</span>`;
}

function row(p) {
  if (!p) return '';
  const ch = p.championId ? champBy(p.championId) : null;
  const sig = p.stats && p.stats.signature && ch && p.stats.signature.some(s => s.championId === ch.id);
  return `<div class="live-row" data-puuid="${esc(p.puuid || '')}" title="点击回到主窗口查看完整情报">
    ${ch ? `<img src="${asset(ch.imageUrl)}"/>` : '<div style="width:30px;height:30px;border-radius:var(--r-sm);background:var(--panel-3)"></div>'}
    <div class="nm"><b>${esc(p.name || '未知玩家')}${p.isSelf ? ' <span class="badge teal" style="font-size:11px">我</span>' : ''}</b>
    <span>${ch ? esc(ch.nameCn) : '英雄未知'}${p.position ? ' · ' + esc(POS_CN[p.position.toUpperCase()] || p.position) : ''}${sig ? ' · <span style="color:var(--gold-bright)">绝活</span>' : ''}${p.stats ? ' · ' + p.stats.total + '场 ' + pct(p.stats.winRate) : ''}</span></div>
    ${gradeBadge(p.rating)}
  </div>`;
}

function drawInactive(s) {
  const title = !s ? '正在读取客户端状态' : !s.loggedIn ? '等待客户端登录' : '当前不在选人阶段';
  body.innerHTML = `<div class="empty-state" style="padding:26px 10px">${icon('lcu', 36)}
    <div class="es-title" style="font-size:13px">${esc(title)}</div>
    <div class="fs-12 text-3" style="line-height:1.8">进入英雄选择后，这里会实时显示双方十人评级。<br/>快捷键 F9 开关本窗口 · 拖动顶栏移动 · 滑杆调透明度。</div>
    ${s && s.tencent ? '<div class="badge purple mt-2">腾讯国服客户端</div>' : ''}
  </div>`;
}

function drawActive(s) {
  const section = (team, label, color) => `<div class="live-side" style="color:${color}">${label}</div>${team.map(row).join('')}`;
  body.innerHTML = `<div class="fs-12 text-3 mb-1">阶段 ${esc(s.phase || '')}${s.platformId ? ' · ' + esc(s.platformId) : ''} · 评级基于本地缓存的真实战绩，样本不足显示 ?</div>
    ${section(s.myTeam || [], '我方', '#0AC8B9')}
    ${section(s.theirTeam || [], '敌方', '#E84057')}`;
  body.querySelectorAll('.live-row').forEach(r => r.addEventListener('click', () => window.nexus.live.focusMain()));
}

async function tick() {
  if (polling) return;
  polling = true;
  try {
    const s = await window.nexus.warroom.live();
    if (s && s.active) { lastActive = true; drawActive(s); }
    else { lastActive = false; drawInactive(s); }
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="padding:26px 10px">${icon('warn', 36)}<div class="es-title" style="font-size:13px">读取失败</div><div class="fs-12 text-3">${esc(String(e.message || e))}</div></div>`;
  }
  polling = false;
}

async function init() {
  document.getElementById('focus-main').innerHTML = icon('home', 13);
  document.getElementById('close-live').innerHTML = icon('close', 13);
  document.getElementById('focus-main').addEventListener('click', () => window.nexus.live.focusMain());
  document.getElementById('close-live').addEventListener('click', () => window.nexus.live.toggle());
  const op = document.getElementById('op');
  try {
    const cfg = await window.nexus.config.get();
    const saved = (cfg && cfg.liveWindow && cfg.liveWindow.opacity) || 0.96;
    op.value = Math.round(saved * 100);
  } catch {}
  op.addEventListener('input', () => window.nexus.live.opacity(op.value / 100));
  try { champs = (await window.nexus.data.champions()) || []; } catch { champs = []; }
  // global img fallback (CSP-safe, same as main window)
  document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.style.opacity = '0.25'; }, true);
  tick();
  setInterval(tick, 5000);
  window.nexus.on('lcu-state', () => { if (!polling) tick(); });
}
init();