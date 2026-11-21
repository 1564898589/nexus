// 指挥中枢 — Command Center home.
import { icon } from '../icons.js';
import { el, esc, pct, num, asset, timeAgo, fmtBytes, tierClass, POS_CN, POSITIONS, sourceTag, champImg, TIER_FILTERS, TIER_FILTERS_CN } from '../util.js';
import { store, navigate, getChamp } from '../store.js';
import { gauge } from '../charts.js';

const isCn = () => store.filter.region === 'cn';
const srcKind = () => isCn() ? 'cn101' : 'opgg';
const srcName = () => isCn() ? '国服 101 官方' : 'OP.GG 韩服';
const tierLabel = () => { const t = (isCn() ? TIER_FILTERS_CN : TIER_FILTERS).find(x => x.v === store.filter.tierFilter); return t ? t.l : store.filter.tierFilter; };

function statCard(label, value, sub, iconName) {
  return `<div class="stat-card">${icon(iconName, 28, 'sc-icon')}<div class="sc-label">${esc(label)}</div><div class="sc-value num">${esc(value)}</div><div class="sc-sub">${esc(sub)}</div></div>`;
}

function champMini(key, tier, wr) {
  const c = getChamp(key);
  if (!c) return '';
  return `<div class="champ-mini" data-key="${esc(key)}" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:var(--r-md);cursor:pointer;border:1px solid var(--line);background:rgba(0,0,0,0.15)">
    <img src="${asset(c.imageUrl)}" style="width:40px;height:40px;border-radius:var(--r-md);border:1px solid var(--line)" alt=""/>
    <div style="flex:1;min-width:0"><div class="fw-6 truncate">${esc(c.nameCn || c.name)}</div><div class="fs-12 text-3">${esc(POS_CN[wr && wr.position] || '')}</div></div>
    ${tier != null ? `<span class="tier-badge ${tierClass(tier)}" style="width:26px;height:26px;font-size:11px">T${tier}</span>` : ''}
  </div>`;
}

export async function render(root) {
  root.innerHTML = `<div class="skeleton" style="height:64px"></div><div class="grid grid-3 gap-2 mt-3">${'<div class="skeleton" style="height:96px"></div>'.repeat(3)}</div><div class="skeleton mt-3" style="height:220px"></div>`;
  const [meta, state, favKeys] = await Promise.all([
    window.nexus.data.meta(), window.nexus.data.state(), window.nexus.favorites.list(),
  ]);
  const counts = state || {};
  const topWin = meta.highestWin, topBan = meta.highestBan;

  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('home', 26, 'accent')} 指挥中枢 <span class="accent">COMMAND</span></div>
      <div class="page-sub">欢迎回来，指挥官。这里是你的英雄联盟战术情报总览 · 数据源 ${esc(srcName())} + Riot 官方资料库</div>
    </div>

    <div class="grid grid-4 mb-4">
      ${statCard('当前版本', meta.patch || '—', (isCn() ? '国服排位 · ' : '韩服排位 · ') + tierLabel(), 'bolt')}
      ${statCard('收录英雄', num(counts.championCount), '完整技能 / 出装 / 符文', 'champion')}
      ${statCard('统计条目', num(counts.statsCount), '样本 ' + num(counts.sampleSize || meta.sampleSize), 'chart')}
      ${statCard('数据状态', ({ fresh: '最新', cached: '缓存', stale: '陈旧', updating: '更新中', failed: '失败', empty: '空' })[state.state] || state.state, '采集 ' + timeAgo(state.fetchedAt), 'sync')}
    </div>

    <div id="home-focus" class="mb-4"></div>

    <div class="grid" style="grid-template-columns: 1.6fr 1fr; gap:16px">
      <div class="panel">
        <div class="panel-h"><div class="panel-title">版本强势英雄 · 各位置 T1</div>${sourceTag(srcKind())}</div>
        <div id="meta-positions" class="grid" style="grid-template-columns:repeat(5,1fr);gap:12px"></div>
        <div class="divider"></div>
        <div class="grid grid-2">
          <div>
            <div class="section-title" style="font-size:13px">最高胜率</div>
            <div id="top-win"></div>
          </div>
          <div>
            <div class="section-title" style="font-size:13px">最高禁用率</div>
            <div id="top-ban"></div>
          </div>
        </div>
      </div>

      <div class="flex-col gap-4">
        <div class="panel tight">
          <div class="panel-h"><div class="panel-title">快速行动</div></div>
          <div class="flex-col gap-2">
            <button class="btn ghost w-full" data-go="tier" style="justify-content:flex-start">${icon('tier', 16)} 查看完整强度榜</button>
            <button class="btn ghost w-full" data-go="bp" style="justify-content:flex-start">${icon('bp', 16)} 进入 BP 模拟器</button>
            <button class="btn ghost w-full" data-go="counter" style="justify-content:flex-start">${icon('counter', 16)} 查询对线克制</button>
            <button class="btn ghost w-full" data-go="coach" style="justify-content:flex-start">${icon('bolt', 16)} 实时教练</button>
            <button class="btn ghost w-full" data-go="warroom" style="justify-content:flex-start">${icon('target', 16)} 对局情报室</button>
            <button class="btn ghost w-full" data-go="replay" style="justify-content:flex-start">${icon('chart', 16)} 赛后复盘</button>
            <button class="btn ghost w-full" data-go="growth" style="justify-content:flex-start">${icon('arrowUp', 16)} 个人成长</button>
            <button class="btn ghost w-full" data-go="meta" style="justify-content:flex-start">${icon('chart', 16)} 版本趋势</button>
            <button class="btn ghost w-full" data-go="vault" style="justify-content:flex-start">${icon('vault', 16)} 数据备份 / 恢复</button>
          </div>
        </div>
        <div class="panel tight">
          <div class="panel-h"><div class="panel-title">LCU 客户端引擎</div>${sourceTag('lcu')}</div>
          <div id="lcu-home" class="fs-13 text-2"></div>
        </div>
      </div>
    </div>

    <div class="grid grid-2 mt-4">
      <div class="panel">
        <div class="panel-h"><div class="panel-title">版本上升最快</div>${sourceTag(srcKind())}</div>
        <div id="risers" class="flex-col gap-2"></div>
      </div>
      <div class="panel">
        <div class="panel-h"><div class="panel-title">我的收藏</div><button class="btn ghost sm" data-go="favorites">管理</button></div>
        <div id="fav-home" class="grid" style="grid-template-columns:repeat(2,1fr);gap:8px"></div>
      </div>
    </div>

    <div class="fs-12 text-3" style="text-align:center;margin-top:26px;letter-spacing:.14em;opacity:.62">开发者：竖</div>
  `;

  // positions
  const posWrap = root.querySelector('#meta-positions');
  for (const p of POSITIONS) {
    const data = (meta.positions || []).find(x => x.position === p);
    const col = el('div', { class: 'flex-col gap-2' });
    col.appendChild(el('div', { class: 'fs-12 text-3 fw-6', style: { letterSpacing: '1px' }, text: POS_CN[p] }));
    if (data && data.top.length) {
      for (const t of data.top) {
        const node = el('div', { html: champMini(t.key, t.tier, { position: p }) });
        node.firstChild.addEventListener('click', () => navigate('detail', { key: t.key, position: p }));
        col.appendChild(node.firstChild);
      }
    } else col.appendChild(el('div', { class: 'fs-12 text-3', text: '暂无' }));
    posWrap.appendChild(col);
  }

  const big = (s, metric) => {
    if (!s) return '<div class="text-3 fs-13">暂无数据</div>';
    const c = getChamp(s.championKey);
    return `<div class="flex items-center gap-3" data-key="${esc(s.championKey)}" style="cursor:pointer">
      <img src="${asset(c ? c.imageUrl : '')}" style="width:52px;height:52px;border-radius:var(--r-md);border:1px solid var(--line-strong)" alt=""/>
      <div><div class="fw-6 fs-16">${esc(c ? (c.nameCn || c.name) : s.championKey)}</div>
      <div class="num fs-13 ${metric === 'win' ? 'text-green' : 'text-red'}">${metric === 'win' ? pct(s.winRate) : pct(s.banRate)} <span class="text-3 fs-12">${esc(POS_CN[s.position] || '')}</span></div></div>
    </div>`;
  };
  root.querySelector('#top-win').innerHTML = big(topWin, 'win');
  root.querySelector('#top-ban').innerHTML = big(topBan, 'ban');
  root.querySelectorAll('#top-win [data-key], #top-ban [data-key]').forEach(n => n.addEventListener('click', () => {
    const s = n.closest('#top-win') ? topWin : topBan;
    navigate('detail', { key: n.dataset.key, position: s && s.position });
  }));

  // risers
  const risers = [];
  for (const p of meta.positions || []) for (const r of p.risers || []) risers.push({ ...r, position: p.position });
  risers.sort((a, b) => b.up - a.up);
  const riserWrap = root.querySelector('#risers');
  if (risers.length) {
    for (const r of risers.slice(0, 6)) {
      const c = getChamp(r.key);
      const node = el('div', { class: 'flex items-center gap-3', style: { padding: '6px 8px', borderRadius: '8px', cursor: 'pointer' }, html: `
        <img src="${asset(c ? c.imageUrl : '')}" style="width:34px;height:34px;border-radius:var(--r-sm)" alt=""/>
        <div style="flex:1"><span class="fw-6">${esc(c ? (c.nameCn || c.name) : '未知英雄')}</span> <span class="fs-12 text-3">${esc(POS_CN[r.position] || '')}</span></div>
        <span class="badge green">${icon('arrowUp', 12)} +${r.up}</span>` });
      node.addEventListener('click', () => navigate('detail', { key: r.key, position: r.position }));
      riserWrap.appendChild(node);
    }
  } else riserWrap.innerHTML = '<div class="text-3 fs-13">本版本暂无显著上升英雄（需上一版本排名数据）。</div>';

  // favorites
  const favWrap = root.querySelector('#fav-home');
  if (favKeys && favKeys.length) {
    for (const k of favKeys.slice(0, 6)) {
      const node = el('div', { html: champMini(k, null, null) });
      node.firstChild.addEventListener('click', () => navigate('detail', { key: k }));
      favWrap.appendChild(node.firstChild);
    }
  } else favWrap.innerHTML = '<div class="text-3 fs-13" style="grid-column:1/-1">还没有收藏英雄。在英雄详情页点击 ☆ 收藏。</div>';

  // lcu
  renderLcuHome(root.querySelector('#lcu-home'));
  drawFocus(root);

  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.go)));

  return {
    onLcuState: () => renderLcuHome(root.querySelector('#lcu-home')),
  };
}

// 个人态势 proactive strip：主动洞察(带行动入口) + 本人近期形态 + 池覆盖 + 训练进度。
// 把 analyst/池/训练/战绩联动送到首屏，洞察不再是死胡同文本。
async function drawFocus(root) {
  const node = root.querySelector('#home-focus');
  if (!node) return;
  const cfg = await window.nexus.config.get().catch(() => ({}));
  const self = cfg && (cfg.selfPuuid || cfg.intelPuuid);
  if (!self) { node.innerHTML = ''; return; }
  const [insights, cov, reports] = await Promise.all([
    window.nexus.analyst.list(2).catch(() => []),
    window.nexus.pool.coverage(self).catch(() => null),
    window.nexus.ai.reports('tactic', self, 1).catch(() => []),
  ]);
  // form from cached real matches
  let form = null;
  try {
    const ms = await window.nexus.replay.list(self, 30);
    if (ms && ms.length) {
      const w = ms.filter(m => m.win === true).length;
      let streak = 0, st = null;
      for (const m of ms) { if (m.win == null) break; const t = m.win ? 'W' : 'L'; if (st == null) { st = t; streak = 1; } else if (t === st) streak++; else break; }
      form = { games: ms.length, winRate: w / ms.length, streak, st };
    }
  } catch {}
  // training progress from latest report checklist
  let train = null;
  if (reports && reports.length) {
    const rid = reports[0].id;
    const done = (cfg['rpTrain:' + rid] || []).length;
    const full = await window.nexus.ai.reportGet(rid).catch(() => null);
    const total = full && full.report && full.report.training_plan ? full.report.training_plan.length : 0;
    if (total) train = { done, total, title: reports[0].title };
  }
  const KIND = { 'analyst:winrate': ['胜率异常', 'red'], 'analyst:champion': ['英雄下滑', 'amber'], 'analyst:position': ['位置短板', 'amber'], 'analyst:training': ['训练停滞', 'purple'], 'analyst:pool': ['池结构', 'teal'] };
  const insightHtml = insights.length ? insights.map(a => {
    const k = KIND[a.kind] || ['洞察', 'gray'];
    const act = a.meta && a.meta.action;
    return `<div class="flex items-center gap-2" style="padding:7px 9px;border-radius:var(--r-md);border:1px solid var(--line);border-left:3px solid var(--${k[1] === 'red' ? 'red' : k[1] === 'amber' ? 'gold' : k[1] === 'purple' ? 'purple' : 'teal'})">
      <span class="badge ${k[1]}" style="flex-shrink:0">${k[0]}</span>
      <div style="flex:1;min-width:0"><div class="fw-6 fs-13 truncate">${esc(a.title)}</div><div class="fs-12 text-3 truncate">${esc(a.body)}</div></div>
      ${act ? `<button class="btn ghost sm focus-act" data-view="${esc(act.view)}" style="flex-shrink:0">${esc(act.label)}</button>` : ''}
    </div>`;
  }).join('') : '<div class="fs-12 text-3">当前未触发主动洞察阈值；状态变化时会自动提示。</div>';
  node.innerHTML = `<div class="panel tight">
    <div class="panel-h"><div class="panel-title">${icon('bolt', 15, 'accent')} 个人态势 · 主动洞察</div>
      <div class="flex gap-2 items-center">
        ${form ? `<span class="badge ${form.winRate >= 0.5 ? 'green' : 'red'}">近${form.games}场 ${pct(form.winRate)}</span>` : ''}
        ${form && form.streak ? `<span class="badge ${form.st === 'W' ? 'green' : 'red'}">${form.streak}连${form.st === 'W' ? '胜' : '败'}</span>` : ''}
        ${cov && !cov.__error ? `<span class="badge ${cov.covered ? 'green' : 'amber'}">池${cov.poolDepth} · 主力${cov.mains}</span>` : ''}
        ${train ? `<span class="badge purple">训练 ${train.done}/${train.total}</span>` : ''}
        <button class="btn ghost sm" data-go="warroom">全部洞察</button>
      </div></div>
    <div class="flex-col gap-2">${insightHtml}</div>
  </div>`;
  node.querySelectorAll('.focus-act').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  node.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.go)));
}

function renderLcuHome(node) {
  if (!node) return;
  const s = store.lcuState;
  if (!s || !s.running) {
    node.innerHTML = `<div class="flex items-center gap-2 mb-2"><span class="lcu-dot"></span> 未检测到英雄联盟客户端</div>
      <div class="fs-12 text-3 mb-3">启动游戏客户端后，NEXUS 会自动连接本地 LCU 接口，提供选人辅助与符文推荐。</div>
      <button class="btn ghost sm" id="lcu-go">${icon('lcu', 14)} 前往 LCU 引擎</button>`;
  } else if (s.loggedIn) {
    node.innerHTML = `<div class="flex items-center gap-2 mb-2"><span class="lcu-dot on"></span> 已连接${s.tencent ? '（国服）' : ''} · ${esc(s.summoner ? s.summoner.displayName : '')}</div>
      <div class="fs-12 text-3">当前阶段：${esc(s.phase)}${s.champSelect ? ' · 正在选人' : ''}</div>`;
  } else {
    node.innerHTML = `<div class="flex items-center gap-2 mb-2"><span class="lcu-dot warn"></span> 客户端已连接，等待登录</div><div class="fs-12 text-3">阶段：${esc(s.phase)}</div>`;
  }
  const go = node.querySelector('#lcu-go');
  if (go) go.addEventListener('click', () => navigate('lcu'));
}