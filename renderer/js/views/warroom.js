// 对局情报室 — Matchup War Room + in-game quick player intelligence.
import { icon } from '../icons.js';
import { el, esc, pct, fx, asset, timeAgo, fmtTime, sourceTag, toast, modal } from '../util.js';
import { store, navigate, getChamp } from '../store.js';
import { aiBlock, bindAi } from './intel-common.js';

const POS_CN = { TOP: '上路', JUNGLE: '打野', MID: '中路', ADC: '下路', SUPPORT: '辅助', top: '上路', jungle: '打野', mid: '中路', bottom: '下路', utility: '辅助' };
const GRADE_COLOR = { S: 'var(--t1)', A: 'var(--teal)', B: 'var(--blue)', C: 'var(--purple)', D: 'var(--red)' };
let live = null, report = null, focusSet = new Set();

function champBy(id) { return store.champions.find(c => c.id === id) || null; }
function gradeBadge(r, size = 26) {
  if (!r || !r.grade) return `<span class="badge gray" style="font-size:11px">?</span>`;
  return `<span class="tier-badge" style="background:${GRADE_COLOR[r.grade]};width:${size}px;height:${size}px;font-size:${size * 0.5}px">${r.grade}</span>`;
}

export async function render(root) {
  focusSet = new Set((await window.nexus.player.focus()).map(f => f.puuid));
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('target', 26, 'accent')} 对局情报室 <span class="accent">WAR ROOM</span></div>
      <div class="page-sub">双方十人侦察 · 实力评级 · 绝活识别 · 对位压力 · 战术重心 · 点击任意玩家查看快速情报</div>
    </div>
    <div class="panel tight mb-4">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <button class="btn primary sm" id="wr-scan">${icon('sync', 15)} 读取当前选人</button>
        <button class="btn ghost sm" id="wr-report">${icon('chart', 15)} 生成侦察报告</button>
        <div style="flex:1"></div>
        <span class="fs-12 text-3" id="wr-status"></span>
      </div>
    </div>
    <div id="wr-analyst" class="mb-4"></div>
    <div id="wr-alerts" class="mb-4"></div>
    <div id="wr-teams" class="bp-board mb-4"></div>
    <div id="wr-report"></div>
  `;
  root.querySelector('#wr-scan').addEventListener('click', () => scan(root));
  root.querySelector('#wr-report').addEventListener('click', () => genReport(root));
  await drawAnalyst(root);
  await drawAlerts(root);
  await scan(root);
  return { onLcuState: () => { if (store.route.name === 'warroom') scan(root); }, onAlert: () => { drawAlerts(root); drawAnalyst(root); } };
}

const ANALYST_KIND = { 'analyst:winrate': ['胜率异常', 'red'], 'analyst:champion': ['英雄下滑', 'amber'], 'analyst:position': ['位置短板', 'amber'], 'analyst:training': ['训练停滞', 'purple'], 'analyst:pool': ['池结构', 'teal'] };
async function drawAnalyst(root) {
  const node = root.querySelector('#wr-analyst');
  if (!node) return;
  const enabled = await window.nexus.analyst.enabled().catch(() => true);
  const items = enabled ? await window.nexus.analyst.list(8).catch(() => []) : [];
  node.innerHTML = `<div class="panel tight">
    <div class="panel-h"><div class="panel-title">${icon('chart', 15, 'accent')} 主动分析师</div>
      <div class="flex gap-2 items-center">
        <button class="btn ghost sm" id="wr-an-eval">${icon('sync', 12)} 重新评估</button>
        <button class="chip ${enabled ? 'active' : ''}" id="wr-an-toggle">${enabled ? '已开启' : '已关闭'}</button>
      </div></div>
    <div class="fs-12 text-3 mb-2">基于本人缓存真实战绩的阈值触发（胜率异常/英雄下滑/位置短板/训练停滞/池结构），去重节流，不联网。</div>
    ${!enabled ? '<div class="fs-12 text-3">主动分析已关闭；开启后将在启动与战绩更新时自动评估。</div>' : items.length ? items.map(a => {
      const k = ANALYST_KIND[a.kind] || ['洞察', 'gray'];
      return `<div class="flex gap-2 fs-12 mb-2" style="padding:7px 9px;border-radius:var(--r-md);border:1px solid var(--line);border-left:3px solid var(--${k[1] === 'red' ? 'red' : k[1] === 'amber' ? 'gold' : k[1] === 'purple' ? 'purple' : 'teal'})">
        <span class="badge ${k[1]}" style="flex-shrink:0">${k[0]}</span>
        <div style="flex:1"><div class="fw-6">${esc(a.title)}</div><div class="text-3" style="line-height:1.6">${esc(a.body)}</div></div>
        ${a.meta && a.meta.action ? `<button class="btn ghost sm wr-an-act" data-view="${esc(a.meta.action.view)}" style="flex-shrink:0">${esc(a.meta.action.label)}</button>` : ''}
        <button class="btn icon sm ghost wr-an-x" data-id="${a.id}" title="忽略此条">${icon('close', 12)}</button></div>`;
    }).join('') : '<div class="fs-12 text-3">当前缓存数据未触发任何阈值（或样本不足）；打得更多或状态变化时会自动提示。</div>'}
  </div>`;
  node.querySelector('#wr-an-toggle').addEventListener('click', async () => { await window.nexus.analyst.setEnabled(!enabled); drawAnalyst(root); });
  node.querySelector('#wr-an-eval').addEventListener('click', async () => { const r = await window.nexus.analyst.evaluate('manual'); toast(r && r.emitted ? `新触发 ${r.emitted} 条洞察` : '无新触发（去重/节流或样本不足）', 'info', 3000); drawAnalyst(root); });
  node.querySelectorAll('.wr-an-x').forEach(b => b.addEventListener('click', async () => { await window.nexus.analyst.dismiss(b.dataset.id); drawAnalyst(root); }));
  node.querySelectorAll('.wr-an-act').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
}

async function drawAlerts(root) {
  const node = root.querySelector('#wr-alerts');
  if (!node) return;
  const items = await window.nexus.alerts.list(10);
  if (!items.length) { node.innerHTML = ''; return; }
  node.innerHTML = `<div class="panel tight">
    <div class="panel-h"><div class="panel-title">${icon('warn', 15, 'text-gold')} 情报提醒</div>
      <button class="btn ghost sm" id="wr-alerts-read">全部已读</button></div>
    ${items.map(a => `<div class="flex gap-2 fs-12 mb-2" style="padding:7px 9px;border-radius:var(--r-md);border:1px solid ${a.read ? 'var(--line)' : 'var(--gold)'};background:${a.read ? 'transparent' : 'var(--gold-dim)'}">
      <div style="flex:1"><div class="fw-6">${esc(a.title)}</div><div class="text-3" style="line-height:1.6">${esc(a.body)}</div></div>
      <span class="text-3" style="flex-shrink:0">${fmtTime(a.at)}</span></div>`).join('')}
  </div>`;
  node.querySelector('#wr-alerts-read').addEventListener('click', async () => { await window.nexus.alerts.readAll(); drawAlerts(root); });
}

async function scan(root) {
  const status = root.querySelector('#wr-status');
  status.textContent = '读取中…';
  try { live = await window.nexus.warroom.live({ refresh: true }); }
  catch (e) { status.textContent = '读取失败：' + String(e.message || e); return; }
  const teams = root.querySelector('#wr-teams');
  if (!live || !live.active) {
    status.textContent = live && live.loggedIn ? '当前不在选人阶段' : '需连接并登录客户端';
    teams.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="empty-state">${icon('bp', 48)}<div class="es-title">${live && live.loggedIn ? '等待进入英雄选择' : '未连接客户端'}</div><div>进入 BP 后点击「读取当前选人」，NEXUS 会自动列出双方十人并关联战绩。也可在下方手动输入名称进行侦察。</div>
      <div class="mt-4"><button class="btn ghost sm" id="wr-manual">${icon('plus', 14)} 手动侦察模式</button></div></div></div>`;
    const mb = teams.querySelector('#wr-manual'); if (mb) mb.addEventListener('click', () => manualMode(root));
    return;
  }
  status.textContent = `选人阶段 · ${live.tencent ? '国服 ' + (live.platformId || '') : ''} · 已解析 ${[...live.myTeam, ...live.theirTeam].filter(p => p && p.puuid).length}/10 人 · ${live.refreshed ? '实时战绩评级' : '本地缓存'}`;
  const side = (team, label, color, cls) => `<div class="bp-side ${cls}"><div class="bp-side-title">${label}</div><div class="flex-col gap-2">${
    team.map((p, i) => playerRow(p, i)).join('')
  }</div></div>`;
  teams.innerHTML = side(live.myTeam, '我方 BLUE', '#0AC8B9', 'blue') + side(live.theirTeam, '敌方 RED', '#E84057', 'red');
  teams.querySelectorAll('[data-cell]').forEach(n => n.addEventListener('click', () => {
    const [sideKey, idx] = n.dataset.cell.split(':');
    const p = (sideKey === 'my' ? live.myTeam : live.theirTeam)[+idx];
    openIntel(p);
  }));
}

function playerRow(p, i) {
  if (!p) return `<div class="bp-slot"><span class="slot-pos">${Object.values(POS_CN)[i] || ''}</span><span class="slot-empty">未选择</span></div>`;
  const ch = champBy(p.championId);
  const focused = p.puuid && focusSet.has(p.puuid);
  return `<div class="bp-slot filled" data-cell="${p.isSelf ? 'my' : (live.myTeam.includes(p) ? 'my' : 'their')}:${i}" style="cursor:pointer;${focused ? 'border-color:var(--gold)' : ''}">
    <span class="slot-pos">${POS_CN[p.position] || Object.values(POS_CN)[i] || ''}</span>
    ${ch ? `<img src="${asset(ch.imageUrl)}"/>` : '<div class="item-icon"></div>'}
    <div style="flex:1;min-width:0"><div class="slot-name truncate">${esc(p.name || '未知玩家')}</div><div class="fs-12 text-3 truncate">${ch ? esc(ch.nameCn) : '英雄未知'}${p.isSelf ? ' · 我' : ''}</div></div>
    ${gradeBadge(p.rating)}
    ${focused ? icon('star', 14, 'text-gold') : ''}
  </div>`;
}

async function openIntel(p) {
  if (!p) return;
  const ch = champBy(p.championId);
  const m = modal({ title: '快速情报卡', body: '<div class="skeleton" style="height:160px"></div>', wide: false });
  // fetch fresh profile if puuid known
  let prof = null;
  if (p.puuid) { try { prof = await window.nexus.player.profile(p.puuid, { refresh: false, count: 20 }); } catch {} }
  const rating = (prof && prof.rating) || p.rating;
  const stats = (prof && prof.stats) || p.stats;
  const name = (prof && prof.player && prof.player.name) || p.name || '未知玩家';
  const focused = p.puuid && focusSet.has(p.puuid);
  const champPerf = stats && ch ? stats.byChampion.find(c => c.championId === ch.id) : null;
  m.body.innerHTML = `
    <div class="flex items-center gap-3 mb-3">
      ${ch ? `<img src="${asset(ch.imageUrl)}" style="width:52px;height:52px;border-radius:var(--r-md);border:1px solid var(--line-strong)"/>` : ''}
      <div style="flex:1"><div class="fw-6 fs-16">${esc(name)}</div><div class="fs-12 text-3">${esc(p.position ? POS_CN[p.position] : '')} · ${ch ? esc(ch.nameCn) : '英雄未知'} ${p.puuid ? '' : '· 身份未确认'}</div></div>
      ${gradeBadge(rating, 44)}
    </div>
    ${rating && rating.grade ? `
      <div class="grid grid-2 mb-3">
        <div><div class="fs-12 text-3">长期实力</div><div class="num fs-16 text-gold">${rating.longTerm}/100</div></div>
        <div><div class="fs-12 text-3">近期状态</div><div class="num fs-16 text-gold">${rating.recent}/100</div></div>
      </div>
      <div class="fs-12 text-2 mb-3" style="line-height:1.7">${(rating.reasons || []).slice(0, 3).map(r => '· ' + esc(r)).join('<br/>')}</div>
    ` : '<div class="fs-13 text-3 mb-3">数据不足，暂无法评级。点击下方「查询战绩」获取真实数据。</div>'}
    ${stats ? `<div class="flex gap-3 mb-3 fs-12">
      <span class="badge teal">${stats.total}场 ${pct(stats.winRate)}</span>
      <span class="badge gray">KDA ${fx(stats.avgKDA, 2)}</span>
      ${stats.signature.length ? `<span class="badge gold">绝活 ${stats.signature.length}</span>` : ''}
      <span class="badge ${rating && rating.confidence >= 0.6 ? 'green' : 'amber'}">可信度 ${Math.round((rating ? rating.confidence : 0) * 100)}%</span>
    </div>` : ''}
    ${champPerf ? `<div class="panel tight mb-3 fs-12 text-2">当前英雄 ${esc(ch.nameCn)}：${champPerf.games} 场 · 胜率 ${pct(champPerf.winRate)} · KDA ${fx(champPerf.kda, 2)}${stats.signature.some(s => s.championId === ch.id) ? ' <span class="badge gold">绝活！威胁上调</span>' : ''}</div>` : ''}
    ${stats && stats.signature.length ? `<div class="fs-12 text-3 mb-3">绝活英雄：${stats.signature.map(s => { const c = champBy(s.championId); return c ? esc(c.nameCn) : '#' + s.championId; }).join('、')}</div>` : ''}
    <div class="flex gap-2" style="flex-wrap:wrap">
      <button class="btn primary sm" id="intel-full">${icon('champion', 14)} 完整资料</button>
      <button class="btn ghost sm" id="intel-search">${icon('search', 14)} 查询战绩</button>
      <button class="btn ghost sm" id="intel-focus">${icon('star', 14)} ${focused ? '取消重点' : '重点关注'}</button>
      <button class="btn ghost sm" id="intel-threat">${icon('warn', 14)} 标记威胁</button>
    </div>
    <div class="mt-3 fs-12 text-3">数据来自本地缓存/客户端只读接口 · ${prof && prof.player && prof.player.fetchedAt ? '更新 ' + timeAgo(prof.player.fetchedAt) : '未刷新'}</div>
  `;
  m.body.querySelector('#intel-full').addEventListener('click', () => { m.close(); if (p.puuid) navigate('player', { puuid: p.puuid }); else toast('身份未确认，请先查询战绩', 'info'); });
  m.body.querySelector('#intel-search').addEventListener('click', async () => {
    if (!p.puuid && !p.name) { toast('无名称/身份，无法查询', 'info'); return; }
    m.close();
    if (p.puuid) navigate('player', { puuid: p.puuid });
    else {
      navigate('player', {});
      // poll until the player view's search box exists (render is async), then auto-query
      let tries = 0;
      const t = setInterval(() => {
        const inp = document.querySelector('#player-search');
        if (inp) { clearInterval(t); inp.value = p.name; const go = document.querySelector('#player-go'); if (go) go.click(); }
        else if (++tries > 25) clearInterval(t);
      }, 200);
    }
  });
  m.body.querySelector('#intel-focus').addEventListener('click', async () => {
    if (!p.puuid) { toast('身份未确认', 'info'); return; }
    if (focusSet.has(p.puuid)) { await window.nexus.player.removeFocus(p.puuid); focusSet.delete(p.puuid); toast('已取消重点', 'info'); }
    else { await window.nexus.player.setFocus(p.puuid, name, false, ''); focusSet.add(p.puuid); toast('已加入重点关注', 'success'); }
    m.close();
  });
  m.body.querySelector('#intel-threat').addEventListener('click', async () => {
    if (!p.puuid) { toast('身份未确认', 'info'); return; }
    await window.nexus.player.setFocus(p.puuid, name, true, '重点威胁对象'); focusSet.add(p.puuid); toast('已标记为威胁对象', 'success'); m.close();
  });
}

async function genReport(root) {
  const wrap = root.querySelector('#wr-report');
  if (!live || !live.active) { toast('请先读取当前选人，或使用手动模式', 'info'); return; }
  wrap.innerHTML = '<div class="panel"><div class="skeleton" style="height:200px"></div></div>';
  const toCell = (p) => p ? { puuid: p.puuid, name: p.name, championId: p.championId, position: p.position } : null;
  try { report = await window.nexus.scouting.report(live.myTeam.map(toCell), live.theirTeam.map(toCell), { refresh: true }); }
  catch (e) { wrap.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 40)}<div class="es-title">侦察报告生成失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary sm mt-3" id="wr-retry">重试</button></div></div>`; wrap.querySelector('#wr-retry').addEventListener('click', () => genReport(root)); return; }
  if (!report || report.__error) { wrap.innerHTML = `<div class="panel text-3">${esc(report && report.__error || '未知错误')}</div>`; return; }
  const section = (title, items, color) => items.length ? `<div class="mb-4"><div class="section-title" style="font-size:13px">${title}</div><div class="flex-col gap-2">${items.map(it => `<div class="flex gap-2 fs-13" style="line-height:1.7"><span class="badge ${it.kind === 'fact' ? 'teal' : it.kind === 'inference' ? 'purple' : 'gold'}" style="flex-shrink:0">${it.kind === 'fact' ? '事实' : it.kind === 'inference' ? '推断' : '建议'}</span><span class="text-2">${esc(it.text)}</span></div>`).join('')}</div></div>` : '';
  wrap.innerHTML = `<div class="panel">
    <div class="panel-h"><div class="panel-title">PRE-MATCH SCOUTING REPORT</div><div class="flex gap-2">${sourceTag('lcu')}${sourceTag('opgg')}${sourceTag('heuristic')}<span class="badge gray">数据覆盖 ${report.dataCoverage}/10</span></div></div>
    ${section('事实（真实数据）', report.facts)}
    ${section('推断（启发式判断）', report.inferences)}
    ${section('战术建议', report.advice)}
    <div class="divider"></div>
    <div class="section-title" style="font-size:13px">五路对位</div>
    <div class="flex-col gap-1">${report.laneResults.map(l => `<div class="flex items-center gap-3 fs-12" style="padding:6px 0;border-bottom:1px solid var(--line-soft)"><span style="width:48px" class="text-3">${POS_CN[l.position]}</span><span class="badge ${l.verdict === 'blue' ? 'teal' : l.verdict === 'red' ? 'red' : 'gray'}">${l.verdict === 'blue' ? '我优' : l.verdict === 'red' ? '敌优' : l.verdict === 'even' ? '均势' : '未选满'}</span><span class="text-2" style="flex:1">${esc(l.detail)}</span></div>`).join('')}</div>
    <div class="mt-3 fs-12 text-3">${esc(report.note)}</div>
  </div>`;
  wrap.insertAdjacentHTML('beforeend', aiBlock('warroom-ai', { title: 'AI 战术推演' }));
  bindAi(wrap, 'warroom-ai', 'bp', () => ({
    data: { myTeam: live.myTeam.map(toCell), theirTeam: live.theirTeam.map(toCell), ruleReport: { facts: report.facts, inferences: report.inferences, advice: report.advice, lanes: report.laneResults } },
    rules: { facts: report.facts.map(f => f.text), inferences: report.inferences.map(f => f.text), advice: report.advice.map(f => f.text) },
  }), { variant: 'bp', subject: 'warroom', dataRange: `选人阶段 · 数据覆盖 ${report.dataCoverage}/10` });
}

function manualMode(root) {
  const teams = root.querySelector('#wr-teams');
  const inputs = (side) => Array.from({ length: 5 }, (_, i) => `<div class="flex gap-2 items-center mb-2"><span class="fs-12 text-3" style="width:40px">${Object.values(POS_CN)[i]}</span><input class="nx-input manual-name" data-side="${side}" data-i="${i}" placeholder="玩家名称（可选）" style="flex:1"/></div>`).join('');
  teams.innerHTML = `<div class="bp-side blue"><div class="bp-side-title">我方</div>${inputs('my')}</div><div class="bp-side red"><div class="bp-side-title">敌方</div>${inputs('their')}</div>`;
  const btn = el('button', { class: 'btn primary mt-3', html: `${icon('search', 15)} 按名称侦察`, onClick: async () => {
    const POS_KEYS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
    const collect = (side) => [...teams.querySelectorAll(`.manual-name[data-side="${side}"]`)].map((inp, i) => ({ name: inp.value.trim() || null, position: POS_KEYS[i] }));
    const my = collect('my'), their = collect('their');
    // 解析名称：search 返回 {state, player|players}；仅唯一命中才确认身份，同名候选不自动挑选
    const resolve = async (arr) => {
      const out = [];
      for (const c of arr) {
        if (!c.name) { out.push(null); continue; }
        try {
          const r = await window.nexus.player.search(c.name);
          if (r && r.state === 'ok' && r.player) out.push({ puuid: r.player.puuid, name: r.player.name, position: c.position });
          else if (r && r.state === 'candidates') out.push({ name: c.name, position: c.position, unresolved: true, note: `找到 ${r.players.length} 个同名候选，需到战绩查询页确认身份` });
          else out.push({ name: c.name, position: c.position, unresolved: true, note: (r && r.message) || '未查询到该玩家' });
        } catch { out.push({ name: c.name, position: c.position, unresolved: true, note: '查询失败' }); }
      }
      return out;
    };
    live = { active: true, myTeam: await resolve(my), theirTeam: await resolve(their) };
    const all = [...live.myTeam, ...live.theirTeam].filter(Boolean);
    const okc = all.filter(p => p.puuid).length, un = all.filter(p => p.unresolved).length;
    toast(okc ? `已确认 ${okc} 人身份${un ? `，${un} 人待确认（同名或未查到）` : ''}，生成报告` : '未能确认任何玩家身份，报告仅含名称占位', okc ? 'success' : 'info', 5000);
    genReport(root);
  } });
  teams.appendChild(btn);
}