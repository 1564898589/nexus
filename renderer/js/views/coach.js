// Live Coaching — phase-aware real-time coach. Honest about compliance limits:
// no memory reads, no screen capture => in-game live telemetry is unavailable.
import { icon } from '../icons.js';
import { esc, asset, pct, sourceTag, toast, POS_CN } from '../util.js';
import { store, navigate, loadChampions } from '../store.js';
import { renderRunes, renderSpells } from './detail.js';
import { champBy, taggedReport, aiBlock, bindAi } from './intel-common.js';

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
          <div class="mt-3 fs-12 text-3">严格只读：NEXUS 不写入客户端符文/选择。</div>
        ` : `<div class="empty-state">${icon('rune', 40)}<div class="es-title">等待你选定英雄</div><div>选定后显示符文、技能与对位建议。</div></div>`}
      </div>
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">敌方已知选人</div>${sourceTag('lcu')}</div>
          ${enemies.length ? enemies.map(p => { const c = champBy(p.championId); return `<div class="flex items-center gap-2 fs-13 mb-1">${c ? `<img src="${asset(c.imageUrl)}" style="width:26px;height:26px;border-radius:var(--r-sm)"/>` : ''}<span>${c ? esc(c.nameCn) : '#' + p.championId}</span>${p.rating && p.rating.grade ? `<span class="badge gold" style="font-size:11px">${p.rating.grade}</span>` : ''}</div>`; }).join('') : '<div class="fs-12 text-3">敌方尚未展示英雄。</div>'}
          <div class="flex gap-2 mt-3"><button class="btn ghost sm" id="coach-warroom">完整情报室</button><button class="btn ghost sm" id="coach-bp">BP 模拟</button></div>
        </div>
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