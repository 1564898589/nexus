// Replay Intelligence — per-match analysis on cached real match data.
import { icon } from '../icons.js';
import { esc, asset, pct, fx, modal, sourceTag, toast } from '../util.js';
import { navigate } from '../store.js';
import { accountBar, champBy, taggedReport, aiBlock, bindAi, matchRow, modeFilterRow, inMode, modeLabelFor } from './intel-common.js';

let puuid = null;
let modeFilter = 'all';
let lastSelfFetch = 0;

export async function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('chart', 26, 'accent')} 赛后复盘 <span class="accent">REPLAY</span></div>
      <div class="page-sub">自动加载本人缓存战绩 · 按模式分类逐场复盘 · 基准只与同模式对比 · 不读内存 / 不截屏</div>
    </div>
    <div class="panel tight mb-4" id="intel-account"></div>
    <div class="grid" style="grid-template-columns:380px 1fr;gap:16px;align-items:start">
      <div class="panel"><div class="panel-h"><div class="panel-title">缓存对局</div><div class="flex gap-2 items-center">${sourceTag('lcu')}<button class="btn ghost sm" id="replay-refresh" title="从已登录客户端拉取本人最新战绩">${icon('sync', 12)} 刷新</button></div></div><div id="replay-list"></div></div>
      <div id="replay-detail"></div>
    </div>`;
  // 默认分析本人：优先 selfPuuid，其次上次 intel 选择。连接且登录时自动补齐缓存，无需先手动搜索。
  const cfg = await window.nexus.config.get().catch(() => ({}));
  const self = (cfg && (cfg.selfPuuid || cfg.intelPuuid)) || null;
  if (self) await ensureSelfCache(self);
  puuid = await accountBar(root, self || puuid, (p) => { puuid = p; loadList(root); });
  const rb = root.querySelector('#replay-refresh');
  if (rb) rb.addEventListener('click', async () => {
    if (!puuid) { toast('请先选择分析账号', 'info'); return; }
    rb.disabled = true;
    const av = await window.nexus.player.available().catch(() => null);
    if (!av || !av.loggedIn) { toast('刷新需要已登录的国服客户端；当前仅浏览本地缓存。', 'info', 4000); rb.disabled = false; return; }
    toast('正在拉取最新战绩…', 'info', 2500);
    await window.nexus.player.profile(puuid, { refresh: true, count: 50 }).catch(() => {});
    lastSelfFetch = Date.now();
    rb.disabled = false;
    await loadList(root);
    toast('战绩已刷新', 'success', 1800);
  });
  await loadList(root);
}

// 进入复盘时确保本人近期战绩已缓存：缓存为空或超过 5 分钟未刷新且客户端在线时自动拉取。
async function ensureSelfCache(self) {
  try {
    const cached = await window.nexus.replay.list(self, 1).catch(() => []);
    const fresh = Date.now() - lastSelfFetch < 5 * 60 * 1000;
    if (cached.length && fresh) return;
    const av = await window.nexus.player.available().catch(() => null);
    if (!av || !av.loggedIn) return;
    await window.nexus.player.profile(self, { refresh: true, count: 50 }).catch(() => {});
    lastSelfFetch = Date.now();
  } catch { /* 静默回退到本地缓存 */ }
}

async function loadList(root) {
  const list = root.querySelector('#replay-list');
  const detail = root.querySelector('#replay-detail');
  if (!puuid) {
    list.innerHTML = '<div class="empty-state">' + icon('chart', 40) + '<div class="es-title">暂无可复盘账号</div><div>连接并登录国服客户端后进入本页会自动加载本人战绩；也可在玩家战绩中心查询任意账号。</div></div>';
    detail.innerHTML = '';
    return;
  }
  const matches = await window.nexus.replay.list(puuid, 100).catch(() => []);
  if (!matches.length) {
    list.innerHTML = '<div class="empty-state">' + icon('chart', 40) + '<div class="es-title">该账号暂无缓存对局</div><div>连接并登录国服客户端后点击右上角「刷新」拉取战绩。</div></div>';
    detail.innerHTML = '';
    return;
  }
  if (modeFilter !== 'all' && !matches.some(m => inMode(m, modeFilter))) modeFilter = 'all';
  const filtered = matches.filter(m => inMode(m, modeFilter));
  list.innerHTML = '';
  list.appendChild(modeFilterRow(matches, modeFilter, (k) => { modeFilter = k; loadList(root); }));
  const wrap = document.createElement('div');
  const catLabel = modeLabelFor(matches, modeFilter);
  wrap.innerHTML = `<div class="fs-12 text-3 mb-2">${filtered.length} 场「${esc(catLabel)}」缓存真实对局（点击复盘）</div>` + filtered.map(m => matchRow(m)).join('');
  list.appendChild(wrap);
  list.querySelectorAll('[data-game]').forEach(r => r.addEventListener('click', () => openReplay(root, r.dataset.game)));
  if (filtered.length) openReplay(root, filtered[0].gameId);
  else detail.innerHTML = `<div class="panel"><div class="empty-state">${icon('chart', 40)}<div class="es-title">该模式下暂无对局</div><div>切换其他模式筛选，或点击「刷新」拉取更多战绩。</div></div></div>`;
}

// 上下文化知识库：按本场真实问题（死亡/参团/伤害/视野）推送一条相关方法论，KB 不再只躺在 AI 中心。
async function drawKbTip(detail, r) {
  const node = detail.querySelector('#replay-kb');
  if (!node) return;
  let q = '复盘';
  if (r.facts && r.facts.some(f => /死亡/.test(f)) && r.inferences && r.inferences.some(f => /死亡/.test(f))) q = '死亡 复盘';
  else if (r.team && r.team.kp != null && r.team.kp < 0.4) q = '资源 交换 团战';
  else if (r.team && r.team.damageShare != null && r.team.damageShare < 0.15) q = '边线 施压';
  else if (r.facts && r.facts.some(f => /视野/.test(f))) q = '视野';
  const hits = await window.nexus.kb.search(q, 'replay', 1).catch(() => []);
  if (!hits.length) { node.innerHTML = ''; return; }
  const h = hits[0];
  node.innerHTML = `<details class="mb-3" style="border:1px solid var(--line);border-radius:var(--r-md);padding:8px 10px">
    <summary class="fs-12 fw-6" style="cursor:pointer;color:var(--ice)">${icon('book', 12)} 复盘方法论参考 · ${esc(h.title)} <span class="badge gray" style="font-size:10px">curated 非实时</span></summary>
    <div class="fs-12 text-2 mt-2" style="line-height:1.7">${esc(h.body)}</div>
  </details>`;
}

async function openReplay(root, gameId) {
  const detail = root.querySelector('#replay-detail');
  detail.innerHTML = '<div class="panel"><div class="empty-state">' + icon('sync', 36) + '<div class="es-title">分析中…</div></div></div>';
  let r;
  try { r = await window.nexus.replay.analyze(gameId, puuid); } catch (e) { r = { __error: String(e.message || e) }; }
  if (!r || r.__error) { detail.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 36)}<div class="es-title">无法复盘</div><div>${esc(r && r.__error || '未知错误')}</div></div></div>`; return; }
  const ch = r.championId ? champBy(r.championId) : null;
  detail.innerHTML = `
    <div class="panel">
      <div class="panel-h"><div class="panel-title">${ch ? esc(ch.nameCn) : '英雄未知'} · ${r.win === true ? '胜利' : r.win === false ? '失败' : '结果未知'}</div>
        <div class="flex gap-2">${sourceTag('lcu')}${sourceTag('heuristic')}</div></div>
      <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
        <span class="badge ${r.win === true ? 'green' : 'red'}">${r.win === true ? '胜' : '负'}</span>
        ${r.mode ? `<span class="badge gold">${esc(r.mode)}${r.queueId ? ' · 队列' + r.queueId : ''}</span>` : ''}
        <span class="badge gray">KDA ${r.kda != null ? fx(r.kda, 2) : '—'}</span>
        ${r.csPerMin != null ? `<span class="badge gray">补刀 ${fx(r.csPerMin)}/分</span>` : ''}
        ${r.goldPerMin != null ? `<span class="badge gray">经济 ${Math.round(r.goldPerMin)}/分</span>` : ''}
        ${r.damagePerMin != null ? `<span class="badge gray">伤害 ${Math.round(r.damagePerMin)}/分</span>` : ''}
        <span class="badge ${r.dataCoverage && r.dataCoverage.hasBaseline ? 'green' : 'amber'}">${r.dataCoverage && r.dataCoverage.hasBaseline ? `同模式基准 ${r.baselineGames || 0} 场` : '同模式基准样本不足'}</span>
      </div>
      ${r.team && (r.team.kp != null || r.team.damageShare != null || r.team.laneCsDiff != null) ? `
      <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
        ${r.team.kp != null ? `<span class="badge teal" title="我方团队击杀合计为分母（真实十人数据）">参团 ${(r.team.kp * 100).toFixed(0)}%</span>` : ''}
        ${r.team.damageShare != null ? `<span class="badge teal" title="团队总伤害为分母（真实十人数据）">伤害占比 ${(r.team.damageShare * 100).toFixed(0)}%</span>` : ''}
        ${r.team.laneCsDiff != null ? `<span class="badge ${r.team.laneCsDiff >= 0 ? 'green' : 'red'}" title="对位同位置选手补刀/经济差（真实十人数据）">对位补刀 ${r.team.laneCsDiff >= 0 ? '+' : ''}${r.team.laneCsDiff}</span>` : ''}
        ${r.team.laneGoldDiff != null ? `<span class="badge ${r.team.laneGoldDiff >= 0 ? 'green' : 'red'}">对位经济 ${r.team.laneGoldDiff >= 0 ? '+' : ''}${r.team.laneGoldDiff}</span>` : ''}
        <span class="fs-11 text-3">十人团队口径${r.team.note ? ' · ' + esc(r.team.note) : ''}</span>
      </div>` : ''}
      ${taggedReport(r)}
      <div id="replay-kb"></div>
      ${aiBlock('replay-ai')}
    </div>`;
  drawKbTip(detail, r);
  const matchCharts = [];
  if (r.csPerMin != null) matchCharts.push({ label: '补刀/分', value: fx(r.csPerMin), pct: Math.min(100, r.csPerMin * 10) });
  if (r.goldPerMin != null) matchCharts.push({ label: '经济/分', value: Math.round(r.goldPerMin), pct: Math.min(100, r.goldPerMin / 8) });
  if (r.damagePerMin != null) matchCharts.push({ label: '伤害/分', value: Math.round(r.damagePerMin), pct: Math.min(100, r.damagePerMin / 1200) });
  bindAi(detail, 'replay-ai', 'replay', () => ({
    data: { match: { win: r.win, kda: r.kda, csPerMin: r.csPerMin, goldPerMin: r.goldPerMin, damagePerMin: r.damagePerMin, position: r.position, champion: ch ? ch.nameCn : null }, facts: r.facts, inferences: r.inferences },
    rules: r,
  }), {
    variant: 'replay', subject: puuid + ':' + gameId, subjectName: (ch ? ch.nameCn : '本场') + ' · ' + (r.win === true ? '胜利' : r.win === false ? '失败' : '结果未知'),
    dataRange: `单场缓存真实对局（${r.mode || '模式未知'}）` + (r.dataCoverage && r.dataCoverage.hasBaseline ? ` · 同模式个人基准 ${r.baselineGames || 0} 场（≥3）` : ' · 同模式基准样本不足'),
    charts: matchCharts.length ? { match: matchCharts, matchNote: '条形刻度：补刀×10 / 经济÷8 / 伤害÷1200，仅示意相对水平；数值为真实场均。' } : null,
  });
}