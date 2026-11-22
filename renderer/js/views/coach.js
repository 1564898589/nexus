// Live Coaching — phase-aware real-time coach. Honest about compliance limits:
// no memory reads, no screen capture => in-game live telemetry is unavailable.
import { icon } from '../icons.js';
import { esc, asset, pct, sourceTag, toast, POS_CN } from '../util.js';
import { store, navigate, loadChampions } from '../store.js';
import { renderRunes, renderSpells } from './detail.js';
import { renderSix, renderEnemy } from '../buildplan-ui.js';
import { champBy, taggedReport, aiBlock, bindAi, laneGuideHTML, jungleRouteHTML } from './intel-common.js';

let unsub = null;

export async function render(root) {
  await loadChampions();
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('bolt', 26, 'accent')} 实时教练 <span class="accent">COACH</span></div>
      <div class="page-sub">按客户端阶段提供建议 · 合规边界：不读内存 / 不截屏，对局内实时遥测不可用</div>
    </div>
    <div id="coach-body"></div>`;
  const s = await window.nexus.lcu.state();
  await draw(root, s);
  if (unsub) unsub();
  unsub = window.nexus.on('lcu-state', (ns) => draw(root, ns));
  return { destroy: () => { if (unsub) { unsub(); unsub = null; } } };
}

async function draw(root, s) {
  const body = root.querySelector('#coach-body');
  if (!body) return;
  const phase = (s && s.phase) || 'None';
  if (!s || !s.running) {
    body.innerHTML = `<div class="panel"><div class="empty-state">${icon('lcu', 44)}<div class="es-title">LCU 未连接</div><div>实时教练依赖本机客户端状态。请先在 LCU 客户端引擎页连接。</div></div>
      <div class="flex gap-2 mt-3" style="justify-content:center"><button class="btn primary sm" id="go-lcu">前往连接</button></div></div>`;
    body.querySelector('#go-lcu').addEventListener('click', () => navigate('lcu'));
    return;
  }
  if (phase === 'ChampSelect') { await drawSelect(root, body, s); return; }
  if (phase === 'InProgress' || phase === 'GameStart') { drawInGame(body, s); return; }
  if (phase === 'EndOfGame' || phase === 'WaitingForStats' || phase === 'PreEndOfGame') {
    body.innerHTML = `<div class="panel"><div class="panel-h"><div class="panel-title">对局结束 · 复盘窗口</div>${sourceTag('lcu')}</div>
      <div class="empty-state">${icon('chart', 44)}<div class="es-title">本局已结束</div><div>现在查询战绩即可缓存本局数据，进入逐场复盘与成长分析。</div></div>
      <div class="flex gap-2 mt-3" style="justify-content:center"><button class="btn primary sm" id="go-player">查询战绩</button><button class="btn ghost sm" id="go-replay">前往复盘</button></div></div>`;
    body.querySelector('#go-player').addEventListener('click', () => navigate('player'));
    body.querySelector('#go-replay').addEventListener('click', () => navigate('replay'));
    return;
  }
  body.innerHTML = `<div class="panel"><div class="panel-h"><div class="panel-title">当前阶段：${esc(phase)}</div>${sourceTag('lcu')}</div>
    <div class="empty-state">${icon('clock', 44)}<div class="es-title">${s.loggedIn ? '等待进入选人' : '等待客户端登录'}</div><div>进入英雄选择后，实时教练会自动给出对位、符文与阵容建议。</div></div></div>`;
}

async function drawSelect(root, body, s) {
  const live = await window.nexus.warroom.live().catch(() => null);
  const me = live && live.myTeam && live.myTeam.find(p => p.isSelf);
  const myChamp = me && me.championId ? champBy(me.championId) : null;
  const pos = me && me.position ? String(me.position).toUpperCase() : 'MID';
  const posMap = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', MID: 'MID', BOTTOM: 'ADC', ADC: 'ADC', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT' };
  const position = posMap[pos] || 'MID';
  let build = null, champFull = null;
  if (myChamp) { try { build = await window.nexus.data.build(myChamp.key, position); champFull = await window.nexus.data.champion(myChamp.key); } catch {} }
  const enemies = ((live && live.theirTeam) || []).filter(p => p.championId);
  body.innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;align-items:start">
      <div class="panel">
        <div class="panel-h"><div class="panel-title">你的选人 · ${myChamp ? esc(myChamp.nameCn) : '未选定'} ${POS_CN[position] || ''}</div><div class="flex gap-2">${sourceTag('lcu')}${sourceTag('opgg')}</div></div>
        ${myChamp ? `
          <div class="flex items-center gap-3 mb-3"><img src="${asset(myChamp.imageUrl)}" style="width:52px;height:52px;border-radius:var(--r-md)"/>
            <div><div class="fw-6 fs-16">${esc(myChamp.nameCn)}</div><div class="fs-12 text-3">教练建议基于 OP.GG 韩服当前版本真实统计</div></div></div>
          <div class="section-title" style="font-size:13px">推荐召唤师技能</div><div id="coach-spells" class="flex gap-2 mb-3"></div>
          <div class="section-title" style="font-size:13px">推荐符文（游戏内手动配置）</div><div id="coach-runes"></div>
          <div class="section-title mt-3" style="font-size:13px">针对敌方阵容的出装 <span class="badge teal" style="font-size:10px">实时选人联动</span></div>
          <div id="coach-build"><div class="fs-12 text-3">结合敌方实时阵容计算针对性出装…</div></div>
          <div class="mt-3 fs-12 text-3">严格只读：NEXUS 不写入客户端符文/选择。出装随敌方选人/BP 棋盘实时联动。</div>
        ` : `<div class="empty-state">${icon('rune', 40)}<div class="es-title">等待你选定英雄</div><div>选定后显示符文、技能与对位建议。</div></div>`}
      </div>
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">推荐英雄 · ${POS_CN[position] || ''}</div><div class="flex gap-2">${sourceTag('opgg')}${sourceTag('heuristic')}</div></div>
          <div id="coach-rec"><div class="fs-12 text-3">结合敌方+队友阵容与你的位置/英雄池计算中…</div></div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">敌方已知选人</div>${sourceTag('lcu')}</div>
          ${enemies.length ? enemies.map(p => { const c = champBy(p.championId); return `<div class="flex items-center gap-2 fs-13 mb-1">${c ? `<img src="${asset(c.imageUrl)}" style="width:26px;height:26px;border-radius:var(--r-sm)"/>` : ''}<span>${c ? esc(c.nameCn) : '#' + p.championId}</span>${p.rating && p.rating.grade ? `<span class="badge gold" style="font-size:11px">${p.rating.grade}</span>` : ''}</div>`; }).join('') : '<div class="fs-12 text-3">敌方尚未展示英雄。</div>'}
          <div id="coach-bans" class="mt-3"></div>
          <div class="flex gap-2 mt-3"><button class="btn ghost sm" id="coach-warroom">完整情报室</button><button class="btn ghost sm" id="coach-bp">BP 模拟</button></div>
        </div>
        ${myChamp ? '<div id="coach-guide"></div>' : ''}
        ${aiBlock('coach-ai')}
      </div>
    </div>`;
  if (myChamp && build && build.data) {
    renderSpells(body.querySelector('#coach-spells'), build.data, champFull || {});
    renderRunes(body.querySelector('#coach-runes'), build.data);
  } else if (myChamp) {
    body.querySelector('#coach-spells').innerHTML = '<span class="text-3 fs-12">暂无该位置数据</span>';
    body.querySelector('#coach-runes').innerHTML = '<div class="text-3 fs-13">暂无该位置的 OP.GG 符文数据。</div>';
  }
  body.querySelector('#coach-warroom').addEventListener('click', () => navigate('warroom'));
  body.querySelector('#coach-bp').addEventListener('click', () => navigate('bp'));
  drawRecommend(body, live, position);
  if (myChamp) drawCoachGuide(body, live, myChamp, position);
  drawCoachBuild(body, live, myChamp, position);
  bindAi(body, 'coach-ai', 'live', () => ({
    data: {
      phase: 'ChampSelect', myChampion: myChamp ? myChamp.nameCn : null, position,
      myTeam: ((live && live.myTeam) || []).map(p => ({ name: p.name, champion: (champBy(p.championId) || {}).nameCn, grade: p.rating && p.rating.grade })),
      enemyTeam: ((live && live.theirTeam) || []).map(p => ({ name: p.name, champion: (champBy(p.championId) || {}).nameCn, grade: p.rating && p.rating.grade })),
      bans: live && live.bans,
    },
    rules: { inferences: ['建议结合情报室的十人评级与绝活检测做针对。'], advice: ['优先封锁敌方高评级玩家的绝活英雄。'] },
  }), { variant: 'live', subject: 'live', dataRange: '选人阶段 · 双方已知阵容（客户端只读）' });
  // remember plan for in-game recap
  try { await window.nexus.config.set('lastPlan', { at: new Date().toISOString(), myChampion: myChamp ? myChamp.nameCn : null, position, enemies: enemies.map(p => (champBy(p.championId) || {}).nameCn).filter(Boolean) }); } catch {}
}

// 可视化推荐英雄：结合敌方+队友阵容、自己位置、个人英雄池/常用，输出图标卡片+真实胜率+理由
async function drawRecommend(body, live, position) {
  const node = body.querySelector('#coach-rec');
  if (!node) return;
  const toCell = (p) => p && p.championId ? { key: (champBy(p.championId) || {}).key, championId: p.championId } : null;
  const myTeam = ((live && live.myTeam) || []).map(toCell);
  const enemyTeam = ((live && live.theirTeam) || []).map(toCell);
  // 个人英雄池证据（缓存真实场次/胜率）+ 常用英雄
  let personal = {}, signature = [];
  try {
    const cfg = await window.nexus.config.get();
    const pu = cfg.selfPuuid || cfg.intelPuuid;
    if (pu) {
      const prof = await window.nexus.player.profile(pu, { refresh: false, count: 50 }).catch(() => null);
      if (prof && prof.stats) {
        for (const c of prof.stats.byChampion || []) { const ch = champBy(c.championId); if (ch) personal[ch.key] = { games: c.games, winRate: c.winRate }; }
        signature = (prof.stats.signature || []).map(s => (champBy(s.championId) || {}).key).filter(Boolean);
      }
    }
  } catch {}
  let adv = null;
  try { adv = await window.nexus.analysis.pickAdvice(myTeam, enemyTeam, [], { position, personal, signature }); } catch (e) { adv = null; }
  if (!adv || !adv.suggestions || !adv.suggestions.length) { node.innerHTML = '<div class="fs-12 text-3">暂无可推荐英雄（需 OP.GG 强度数据；请先更新数据）。</div>'; return; }
  const cards = adv.suggestions.slice(0, 6).map(s => {
    const c = s.champion || {};
    return `<div class="flex items-center gap-2" style="padding:7px 8px;border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:6px;background:rgba(0,0,0,0.12)">
      ${c.imageUrl ? `<img src="${asset(c.imageUrl)}" style="width:34px;height:34px;border-radius:var(--r-sm)"/>` : '<div class="item-icon"></div>'}
      <div style="flex:1;min-width:0">
        <div class="fw-6 fs-13 truncate">${esc(c.nameCn || c.key)} ${s.tier != null ? `<span class="badge gold" style="font-size:10px">T${s.tier}</span>` : ''} ${s.signature ? '<span class="badge teal" style="font-size:10px">常用</span>' : ''} ${s.risky ? '<span class="badge red" style="font-size:10px">被克</span>' : ''}</div>
        <div class="fs-11 text-3 truncate">${(s.reasons || []).slice(0, 2).join(' · ') || '阵容契合'}</div>
      </div>
      <div class="num text-green fs-13" style="flex-shrink:0">${s.winRate != null ? pct(s.winRate) : '—'}</div>
    </div>`;
  }).join('');
  node.innerHTML = cards + `<div class="fs-11 text-3 mt-1">${esc(adv.note || '')}</div>`;
}

// 选人阶段对线指南：找到同位置敌方英雄 → 机制级换血/兵线/防Gank；打野位则给刷野路线
async function drawCoachGuide(body, live, myChamp, position) {
  const node = body.querySelector('#coach-guide');
  if (!node) return;
  const norm = (x) => ({ TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', MID: 'MID', BOTTOM: 'ADC', ADC: 'ADC', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT' }[String(x || '').toUpperCase()] || String(x || '').toUpperCase());
  const opp = ((live && live.theirTeam) || []).find(p => p.championId && norm(p.position) === position);
  const oppChamp = opp ? champBy(opp.championId) : null;
  node.innerHTML = '<div class="panel tight"><div class="fs-12 text-3">生成对线指南…</div></div>';
  let html = '';
  if (position === 'JUNGLE') {
    try { const r = await window.nexus.analysis.jungleRoute(myChamp.key, oppChamp ? oppChamp.key : null); if (r && !r.__error) html += jungleRouteHTML(r); } catch {}
  }
  if (oppChamp) {
    try { const g = await window.nexus.analysis.laneGuide(myChamp.key, oppChamp.key, position); if (g && !g.__error) html += laneGuideHTML(g); } catch {}
  }
  if (!html) { node.innerHTML = ''; return; }
  node.innerHTML = html + (oppChamp ? '' : '<div class="panel tight"><div class="fs-12 text-3">敌方同位置英雄尚未展示，选定后自动补全对线指南。</div></div>');
}

// 实时选人联动：双方 ban 展示 + 阵容同步 BP 棋盘 + 针对敌方阵容的出装（buildPlan 引擎）
async function drawCoachBuild(body, live, myChamp, position) {
  const bans = (live && live.bans) || {};
  const bansNode = body.querySelector('#coach-bans');
  const banChips = (ids, label, cls) => {
    const list = (ids || []).filter(id => id && id > 0);
    if (!list.length) return '';
    return `<div class="fs-11 text-3 mb-1">${label}</div><div class="flex gap-1 mb-2" style="flex-wrap:wrap">${list.map(id => { const c = champBy(id); return c ? `<span class="badge ${cls}" style="font-size:11px;padding:2px 6px"><img src="${asset(c.imageUrl)}" style="width:16px;height:16px;border-radius:3px;vertical-align:middle"/> ${esc(c.nameCn)}</span>` : ''; }).join('')}</div>`;
  };
  if (bansNode) bansNode.innerHTML = banChips(bans.theirTeam, '敌方 ban（实时）', 'red') + banChips(bans.myTeam, '我方 ban（实时）', 'teal') || '<div class="fs-11 text-3">暂无 ban 信息（选人阶段实时读取）。</div>';

  const toPick = (p) => { const c = p && p.championId ? champBy(p.championId) : null; return c ? { key: c.key, championId: p.championId, name: c.nameCn } : null; };
  const myPicks = ((live && live.myTeam) || []).map(toPick).filter(Boolean);
  const enemyPicks = ((live && live.theirTeam) || []).map(toPick).filter(Boolean);
  const toKeys = (ids) => (ids || []).map(id => { const c = champBy(id); return c ? c.key : null; }).filter(Boolean);
  const myBanKeys = toKeys(bans.myTeam), enBanKeys = toKeys(bans.theirTeam);
  // 实时阵容推入 BP 棋盘 → BP 模拟器/出装规划视图同步联动（bans 用 key，与 BP 模拟器一致）
  if (myPicks.length || enemyPicks.length) {
    store.bpBoard = { myPicks, enemyPicks, bans: [...myBanKeys, ...enBanKeys], fromLive: true, liveBans: { my: myBanKeys, enemy: enBanKeys } };
    window.dispatchEvent(new CustomEvent('nexus-bp-board', { detail: store.bpBoard }));
  }

  const node = body.querySelector('#coach-build');
  if (!node) return;
  if (!myChamp) { node.innerHTML = '<div class="fs-12 text-3">选定英雄后显示针对性出装。</div>'; return; }
  const enemyKeys = enemyPicks.map(p => p.key);
  let plan = null;
  try { plan = await window.nexus.analysis.buildPlan(myChamp.key, position, enemyKeys); } catch { plan = null; }
  if (!plan || !plan.adjustedSix) { node.innerHTML = '<div class="fs-12 text-3">暂无该位置出装数据（请先更新数据）。</div>'; return; }
  node.innerHTML = '<div id="coach-build-six"></div><div id="coach-build-enemy" class="mt-3"></div>';
  renderSix(node.querySelector('#coach-build-six'), plan);
  renderEnemy(node.querySelector('#coach-build-enemy'), plan, enemyKeys.length ? `实时选人 · 敌方 ${enemyKeys.length} 人` : '敌方未展示 · 通用规划');
}

function drawInGame(body, s) {
  let plan = null;
  window.nexus.config.get().then(cfg => {
    plan = cfg && cfg.lastPlan;
    const node = body.querySelector('#coach-plan');
    if (!node) return;
    node.innerHTML = plan ? `<div class="fs-12 text-2" style="line-height:1.9">
      · 你的英雄：${esc(plan.myChampion || '未知')} ${POS_CN[plan.position] || ''}<br/>
      · 敌方已知：${plan.enemies && plan.enemies.length ? esc(plan.enemies.join('、')) : '未知'}<br/>
      · 计划记录时间：${esc(plan.at || '')}</div>` : '<div class="fs-12 text-3">无赛前计划记录（选人阶段未打开过实时教练）。</div>';
  });
  body.innerHTML = `
    <div class="panel mb-4">
      <div class="panel-h"><div class="panel-title">对局进行中</div>${sourceTag('lcu')}</div>
      <div class="flex items-center gap-3 mb-3"><span class="lcu-dot on"></span><span class="fw-6">阶段 ${esc(s.phase)}</span></div>
      <div class="badge amber mb-3">对局内实时数据不可用</div>
      <div class="fs-12 text-2" style="line-height:1.9">合规边界：NEXUS 不读取游戏内存、不截屏、不做画面识别，因此无法获取对局内的实时经济/位置/技能冷却。任何声称能提供这些数据的做法都违反本产品安全边界。<br/>当前可用：赛前计划回顾 + 赛后立即复盘。</div>
    </div>
    <div class="panel"><div class="panel-h"><div class="panel-title">赛前计划回顾</div>${sourceTag('local')}</div><div id="coach-plan"></div></div>`;
}