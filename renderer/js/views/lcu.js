// LCU 客户端引擎 — local client integration panel.
import { icon } from '../icons.js';
import { el, esc, asset, POS_CN, sourceTag, toast, confirmDialog, fmtTime } from '../util.js';
import { store, navigate, getChamp, loadChampions } from '../store.js';
import { renderRunes } from './detail.js';

let unsub = null;

export async function render(root) {
  await loadChampions();
  const s = await window.nexus.lcu.state();
  store.lcuState = s;
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('lcu', 26, 'accent')} LCU 客户端引擎 <span class="accent">CLIENT</span> <span class="badge amber">实验性 · 知情启用</span></div>
      <div class="page-sub">仅访问本机英雄联盟客户端暴露的本地接口 · 不读内存 / 不注入 / 不改文件 · 严格只读</div>
    </div>
    <div class="grid" style="grid-template-columns:340px 1fr;gap:16px;align-items:start">
      <div class="flex-col gap-4">
        <div class="panel" id="lcu-status"></div>
        <div class="panel tight">
          <div class="panel-h"><div class="panel-title">端点可用性</div>${sourceTag('lcu')}</div>
          <div id="lcu-endpoints" class="flex-col gap-1"></div>
          <div class="mt-3 fs-12 text-3" style="line-height:1.7">国服（腾讯）兼容性需在你的客户端上独立验证。非腾讯服连接成功不代表国服可用；此处如实显示每个端点的探测结果。</div>
        </div>
        <div class="panel tight">
          <div class="panel-h"><div class="panel-title">安全边界</div></div>
          <div class="fs-12 text-2" style="line-height:1.9">
            ✓ 只调用本地 LCU HTTP 接口（全部 GET 只读）<br/>
            ✓ 符文写入已被产品策略禁用<br/>
            ✗ 不读取游戏进程内存<br/>
            ✗ 不注入 / 不修改游戏文件<br/>
            ✗ 不绕过反作弊或权限<br/>
            ⚠ 腾讯未确认第三方调用合规性：正式包首装默认不自动连接，手动开启视为知情同意
          </div>
        </div>
      </div>
      <div class="flex-col gap-4">
        <div class="panel" id="lcu-champselect"></div>
        <div class="panel" id="lcu-assist"></div>
      </div>
    </div>
  `;
  drawStatus(root, s);
  drawEndpoints(root, s);
  drawChampSelect(root, s);
  drawAssist(root, s);
  if (unsub) unsub();
  unsub = window.nexus.on('lcu-state', (ns) => { store.lcuState = ns; drawStatus(root, ns); drawEndpoints(root, ns); drawChampSelect(root, ns); drawAssist(root, ns); });
  return { onLcuState: (ns) => { drawStatus(root, ns); drawEndpoints(root, ns); drawChampSelect(root, ns); drawAssist(root, ns); }, destroy: () => { if (unsub) { unsub(); unsub = null; } } };
}

function drawStatus(root, s) {
  const node = root.querySelector('#lcu-status');
  if (!node) return;
  const stateText = !s || !s.running ? '未检测到客户端' : !s.connected ? '连接中' : s.loggedIn ? '已连接 · 已登录' : '已连接 · 未登录';
  const dotCls = !s || !s.running ? '' : s.loggedIn ? 'on' : 'warn';
  node.innerHTML = `
    <div class="panel-h"><div class="panel-title">连接状态</div><span class="lcu-dot ${dotCls}"></span></div>
    <div class="fw-6 fs-16 mb-2">${esc(stateText)}</div>
    ${s && s.tencent ? '<div class="badge purple mb-2">检测到腾讯国服客户端</div>' : ''}
    ${s && s.summoner ? `<div class="fs-13 text-2 mb-1">召唤师：${esc(s.summoner.displayName || '')} ${s.summoner.tagLine ? '#' + esc(s.summoner.tagLine) : ''}</div><div class="fs-12 text-3 mb-1">等级 ${s.summoner.level || '—'}</div>` : ''}
    <div class="fs-12 text-3 mb-1">阶段：${esc(s ? s.phase : 'None')}</div>
    ${s && s.installDir ? `<div class="fs-12 text-3 truncate mb-1" title="${esc(s.installDir)}">目录：${esc(s.installDir)}</div>` : ''}
    ${s && s.lastError ? `<div class="fs-12 text-red mb-1">${esc(s.lastError)}</div>` : ''}
    ${s && s.lastDiscovery && !s.lastDiscovery.ok ? `<div class="fs-12 text-3 mb-1" style="line-height:1.7">检测诊断（${fmtTime(s.lastDiscovery.at)}）：${esc(s.lastDiscovery.reason)}</div>` : ''}
    ${s && s.lastDiscovery && s.lastDiscovery.ok ? `<div class="fs-12 text-3 mb-1">最近检测：${fmtTime(s.lastDiscovery.at)} · 来源 ${esc(s.lastDiscovery.source || '')} · 端口 ${s.lastDiscovery.port || '—'}</div>` : ''}
    <div class="flex gap-2 mt-3">
      <button class="btn primary sm" id="lcu-connect">${icon('sync', 14)} 立即连接</button>
      <button class="btn ghost sm" id="lcu-toggle">${s && s.running ? '停止监听' : '开始监听'}</button>
    </div>
  `;
  node.querySelector('#lcu-connect').addEventListener('click', async () => {
    const ok = await window.nexus.lcu.connect();
    if (ok) toast('已尝试连接客户端', 'success');
    else { const ns = await window.nexus.lcu.state(); toast((ns && ns.lastDiscovery && ns.lastDiscovery.reason) || '未检测到运行中的客户端', 'warn', 7000); }
  });
  node.querySelector('#lcu-toggle').addEventListener('click', async () => { if (s && s.running) { await window.nexus.lcu.stop(); toast('已停止 LCU 监听', 'info'); } else { await window.nexus.lcu.start(); toast('已开始 LCU 监听', 'success'); } });
}

function drawEndpoints(root, s) {
  const node = root.querySelector('#lcu-endpoints');
  if (!node) return;
  const health = (s && s.endpointHealth) || {};
  const names = { summoner: '召唤师信息', gameflow: '游戏阶段', perks: '符文页', champSelect: '选人会话', matchHistory: '战绩首页（LCU）', entitlements: 'SGP 凭据' };
  const keys = Object.keys(names);
  node.innerHTML = keys.map(k => {
    const v = health[k];
    const badge = !s || !s.connected ? '<span class="badge gray">未探测</span>'
      : v === 'ok' ? '<span class="badge green">可用</span>'
      : v === 'idle' ? '<span class="badge gray">空闲 · 不在 BP</span>'
      : v === 'login-required' ? '<span class="badge purple">需登录</span>'
      : v === 'unavailable' ? '<span class="badge amber">不可用</span>'
      : `<span class="badge red">${esc(v || '不可用')}</span>`;
    return `<div class="flex items-center justify-between fs-13"><span class="text-2">${names[k]}</span>${badge}</div>`;
  }).join('');
}

function drawChampSelect(root, s) {
  const node = root.querySelector('#lcu-champselect');
  if (!node) return;
  const cs = s && s.champSelect;
  if (!cs) {
    node.innerHTML = `<div class="panel-h"><div class="panel-title">实时选人</div>${sourceTag('lcu')}</div>
      <div class="empty-state">${icon('bp', 44)}<div class="es-title">${s && s.loggedIn ? '当前不在选人阶段' : '等待客户端进入选人'}</div><div>进入英雄选择后，这里会实时显示双方阵容与禁用。</div></div>`;
    return;
  }
  const teamHtml = (team, label, color) => `<div><div class="fw-6 mb-2" style="color:${color}">${label}</div><div class="flex-col gap-1">${
    team.map(p => { const c = p.championId ? champById(p.championId) : null; const intent = p.championPickIntent ? champById(p.championPickIntent) : null;
      return `<div class="flex items-center gap-2 fs-13" style="padding:5px 8px;border-radius:var(--r-sm);${p.isSelf ? 'background:var(--teal-dim)' : ''}">
        ${c ? `<img src="${asset(c.imageUrl)}" style="width:28px;height:28px;border-radius:var(--r-sm)"/>` : '<div style="width:28px;height:28px;border-radius:var(--r-sm);background:var(--panel-3)"></div>'}
        <span style="flex:1">${c ? esc(c.nameCn) : (intent ? esc(intent.nameCn) + '（预选）' : '未选择')}</span>
        ${p.assignedPosition ? `<span class="fs-12 text-3">${esc(p.assignedPosition)}</span>` : ''}${p.isSelf ? '<span class="badge teal">我</span>' : ''}</div>`; }).join('')
  }</div></div>`;
  node.innerHTML = `<div class="panel-h"><div class="panel-title">实时选人 · ${esc(cs.phase || '')}</div>${sourceTag('lcu')}</div>
    <div class="grid grid-2">${teamHtml(cs.myTeam, '我方', '#0AC8B9')}${teamHtml(cs.theirTeam, '敌方', '#E84057')}</div>
    <div class="mt-3 fs-12 text-3">禁用：我方 [${(cs.bans.myTeam || []).map(id => { const c = champById(id); return c ? esc(c.nameCn) : id; }).join(', ') || '无'}] · 敌方 [${(cs.bans.theirTeam || []).map(id => { const c = champById(id); return c ? esc(c.nameCn) : id; }).join(', ') || '无'}]</div>`;
}

function champById(id) {
  if (!id) return null;
  return store.champions.find(c => c.id === id) || null;
}

async function drawAssist(root, s) {
  const node = root.querySelector('#lcu-assist');
  if (!node) return;
  const cs = s && s.champSelect;
  const myPick = cs && cs.myPick;
  const champ = myPick && myPick.championId ? champById(myPick.championId) : null;
  const opggState = store.dataState || {};
  const timeBar = `<div class="flex gap-4 fs-12 text-3 mb-3" style="flex-wrap:wrap">
    <span>${sourceTag('lcu')} 客户端更新：${s && s.updatedAt ? fmtTime(s.updatedAt) : '—'}</span>
    <span>${sourceTag('opgg')} 统计采集：${opggState.fetchedAt ? fmtTime(opggState.fetchedAt) : '—'}（版本 ${esc(opggState.patch || '—')}）</span>
    <span class="text-gold">两类数据更新时间独立，客户端状态变化不代表 OP.GG 统计实时刷新。</span>
  </div>`;
  if (!champ) {
    node.innerHTML = `<div class="panel-h"><div class="panel-title">智能 BP 辅助 · 对局实时准备</div>${sourceTag('opgg')}</div>${timeBar}
      <div class="empty-state">${icon('rune', 44)}<div class="es-title">${s && s.loggedIn ? '等待你的选人' : '等待客户端进入选人'}</div><div>选定英雄后，NEXUS 会结合 OP.GG 韩服数据给出对位克制、补位/针对建议、推荐符文与召唤师技能，经你确认后一键应用。</div></div>`;
    return;
  }
  const pos = (myPick.assignedPosition || 'MID').toUpperCase();
  const posMap = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', MID: 'MID', BOTTOM: 'ADC', ADC: 'ADC', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT' };
  const position = posMap[pos] || 'MID';
  const build = await window.nexus.data.build(champ.key, position);
  // enemy known picks
  const enemies = (cs.theirTeam || []).filter(p => p.championId).map(p => champById(p.championId)).filter(Boolean);
  const myTeam = (cs.myTeam || []).filter(p => p.championId).map(p => ({ key: (champById(p.championId) || {}).key, position: p.assignedPosition })).filter(x => x.key);
  const enemyTeam = enemies.map(c => ({ key: c.key }));
  // counters of my pick vs each enemy (real OP.GG)
  const counterRows = [];
  for (const en of enemies.slice(0, 5)) {
    const r = await window.nexus.analysis.counter(champ.key, en.key, position);
    counterRows.push({ en, real: r.real && r.real[0], reason: r.reason && r.reason[0] });
  }
  const banKeys = [...((cs.bans && cs.bans.myTeam) || []), ...((cs.bans && cs.bans.theirTeam) || [])].map(id => (champById(id) || {}).key).filter(Boolean);
  const advice = await window.nexus.analysis.pickAdvice(myTeam, enemyTeam, null, { position, banned: banKeys }).catch(() => null);
  const comp = await window.nexus.analysis.composition(myTeam).catch(() => null);

  node.innerHTML = `<div class="panel-h"><div class="panel-title">智能 BP 辅助 · ${esc(champ.nameCn)} ${POS_CN[position] || ''}</div><div class="flex gap-2">${sourceTag('opgg')}${sourceTag('lcu')}${sourceTag('heuristic')}</div></div>
    ${timeBar}
    <div class="grid grid-2">
      <div>
        <div class="section-title" style="font-size:13px">对位克制（真实胜率）</div>
        <div id="assist-counters" class="flex-col gap-1 mb-3"></div>
        <div class="section-title" style="font-size:13px">推荐召唤师技能</div>
        <div id="assist-spells" class="flex gap-2 mb-3"></div>
        <div class="section-title" style="font-size:13px">推荐符文</div>
        <div id="assist-runes"></div>
      </div>
      <div>
        <div class="section-title" style="font-size:13px">己方阵容短板</div>
        <div id="assist-weak" class="fs-12 text-2 mb-3" style="line-height:1.8"></div>
        <div class="section-title" style="font-size:13px">补位 / 针对建议（${POS_CN[position] || position}统计）</div>
        <div id="assist-advice" class="flex-col gap-2"></div>
      </div>
    </div>
    <div class="flex gap-2 mt-4"><button class="btn ghost" id="view-detail">${icon('champion', 15)} 英雄详情</button>
    <button class="btn ghost" id="save-prep">${icon('prep', 15)} 存入对局准备</button></div>
    <div class="mt-3 fs-12 text-3">NEXUS V1.0 采用严格只读模式：仅提供分析与推荐，不写入客户端符文/选择。请在游戏内手动配置符文。</div>`;

  // counters
  const cw = node.querySelector('#assist-counters');
  cw.innerHTML = counterRows.length ? counterRows.map(r => `<div class="flex items-center gap-2 fs-12" style="padding:5px 7px;border-radius:var(--r-sm);background:rgba(0,0,0,0.15)">
    <img src="${asset(r.en.imageUrl)}" style="width:26px;height:26px;border-radius:var(--r-sm)"/><span style="flex:1" class="truncate">${esc(r.en.nameCn)}</span>
    <span class="text-3 truncate" style="max-width:160px" title="${esc(r.real || '')}">${esc(r.real || '无样本')}</span></div>`).join('') : '<div class="text-3 fs-12">敌方尚未展示英雄。</div>';
  // spells
  const sw = node.querySelector('#assist-spells');
  const spells = build && build.data && build.data.summonerSpells || [];
  sw.innerHTML = spells.length ? spells.map(sp => `<div class="flex-col items-center gap-1"><img class="item-icon sm" src="${sp.icon ? asset(sp.icon) : ''}" alt="${esc(sp.name)}"/><span class="fs-12 text-2">${esc(sp.name)}</span></div>`).join('') : '<span class="text-3 fs-12">暂无</span>';
  // runes
  const rw = node.querySelector('#assist-runes');
  if (build && build.data) renderRunes(rw, build.data); else rw.innerHTML = '<div class="text-3 fs-13">暂无该位置的 OP.GG 符文数据。</div>';
  // weaknesses
  node.querySelector('#assist-weak').innerHTML = comp && comp.weaknesses && comp.weaknesses.length ? comp.weaknesses.map(w => '· ' + esc(w)).join('<br/>') : '阵容尚未选满或无明显短板。';
  // advice
  const aw = node.querySelector('#assist-advice');
  aw.innerHTML = advice && advice.suggestions && advice.suggestions.length ? advice.suggestions.slice(0, 4).map(sg => `<div class="flex items-center gap-2 fs-12" style="padding:6px 8px;border-radius:var(--r-md);border:1px solid var(--line)">
    <img src="${asset(sg.champion.imageUrl)}" style="width:30px;height:30px;border-radius:var(--r-sm)"/><div style="flex:1;min-width:0"><div class="fw-6">${esc(sg.champion.nameCn || sg.champion.name)} ${sg.tier != null ? `<span class="badge gold" style="font-size:11px">T${sg.tier}</span>` : ''}</div><div class="text-3 truncate">${esc((sg.reasons || [])[0] || '')}</div></div>${sg.risky ? '<span class="badge red" style="font-size:11px">风险</span>' : ''}</div>`).join('') : '<div class="text-3 fs-12">暂无建议。</div>';

  node.querySelector('#view-detail').addEventListener('click', () => navigate('detail', { key: champ.key, position }));
  node.querySelector('#save-prep').addEventListener('click', async () => {
    await window.nexus.prep.save('实时准备 ' + champ.nameCn + ' ' + new Date().toLocaleTimeString('zh-CN'), { bp: { blue: myTeam.map((m, i) => ({ key: m.key, position: ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'][i] })), red: enemyTeam, blueBans: (cs.bans.myTeam || []).map(id => (champById(id) || {}).key).filter(Boolean), redBans: (cs.bans.theirTeam || []).map(id => (champById(id) || {}).key).filter(Boolean) }, note: '来自 LCU 实时选人' });
    toast('已存入对局准备', 'success');
  });
}