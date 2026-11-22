// 英雄详情 — Champion Detail (stats / runes / builds / skills / counters / lore / AI).
import { icon } from '../icons.js';
import { el, esc, pct, fx, num, asset, tierClass, POS_CN, POSITIONS, TAG_CN, sourceTag, toast, timeAgo, modal } from '../util.js';
import { store, navigate, getChamp, refreshFavorites } from '../store.js';
import { gauge, hbar } from '../charts.js';
import { renderSix } from '../buildplan-ui.js';
import { jungleRouteHTML } from './intel-common.js';

const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

let curKey = null, curPos = null;
const srcKind = () => store.filter.region === 'cn' ? 'cn101' : 'opgg';
const srcName = () => store.filter.region === 'cn' ? '国服 101 官方' : 'OP.GG 韩服';

export async function render(root, params) {
  curKey = params.key;
  const data = await window.nexus.data.champion(curKey);
  if (!data || data.__error) {
    root.innerHTML = `<div class="empty-state">${icon('warn', 56)}<div class="es-title">未找到该英雄</div><button class="btn ghost mt-3" id="back">返回资料库</button></div>`;
    root.querySelector('#back').addEventListener('click', () => navigate('champions'));
    return {};
  }
  await window.nexus.profile.recent(curKey);
  const positions = data.stats.map(s => s.position);
  curPos = params.position && positions.includes(params.position) ? params.position : (positions[0] || (data.positions && data.positions[0]) || 'MID');

  root.innerHTML = `
    <div class="champ-hero mb-4">
      <div class="splash" style="background-image:url('${asset(data.splashUrl)}')"></div>
      <div class="hero-content">
        <div class="flex items-center justify-between">
          <div>
            <div class="hero-title">${esc(data.titleCn || '')}</div>
            <div class="hero-name">${esc(data.nameCn || data.name)}</div>
            <div class="hero-en">${esc(data.name)} ${data.attackType ? '· ' + esc(data.attackType) : ''}</div>
            <div class="hero-tags">${(data.tags || []).map(t => `<span class="badge gold">${esc(TAG_CN[t] || t)}</span>`).join('')}
              ${(data.positions || []).map(p => `<span class="badge teal">${esc(POS_CN[p] || p)}</span>`).join('')}</div>
          </div>
          <div class="flex gap-2">
            <button class="btn ghost" id="btn-counter">${icon('counter', 16)} 克制查询</button>
            <button class="btn ${data.favorite ? 'primary' : 'ghost'}" id="btn-fav">${icon('star', 16)} ${data.favorite ? '已收藏' : '收藏'}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2 mb-4" style="flex-wrap:wrap">
      <span class="fs-12 text-3">位置：</span>
      <div class="chip-row" id="pos-tabs"></div>
      <div style="flex:1"></div>
      <button class="btn ghost sm" id="btn-back">${icon('chevron', 14)} 资料库</button>
    </div>

    <div id="detail-body"></div>
  `;

  const posTabs = root.querySelector('#pos-tabs');
  const avail = positions.length ? positions : (data.positions || []);
  for (const p of avail) posTabs.appendChild(el('button', { class: 'chip' + (curPos === p ? ' active' : ''), text: POS_CN[p] || p, onClick: async () => { curPos = p; await ensureBuild(data); drawBody(root, data); root.querySelectorAll('#pos-tabs .chip').forEach(c => c.classList.toggle('active', c.textContent === (POS_CN[p] || p))); } }));

  root.querySelector('#btn-back').addEventListener('click', () => navigate('champions'));
  root.querySelector('#btn-counter').addEventListener('click', () => navigate('counter', { key: curKey, position: curPos }));
  root.querySelector('#btn-fav').addEventListener('click', async (e) => {
    const now = await window.nexus.favorites.toggle(curKey);
    await refreshFavorites();
    e.currentTarget.className = 'btn ' + (now ? 'primary' : 'ghost');
    e.currentTarget.innerHTML = `${icon('star', 16)} ${now ? '已收藏' : '收藏'}`;
    toast(now ? '已收藏' : '已取消收藏', 'success');
  });

  await ensureBuild(data);
  drawBody(root, data);
  return {};
}

function statFor(data) { return data.stats.find(s => s.position === curPos) || data.stats[0] || null; }
function buildFor(data) { return (data.builds[curPos] && data.builds[curPos].data) || null; }
// 国服详情懒加载 / 韩服旧缓存形状懒刷新（技能组合 + 18 级加点解析）
async function ensureBuild(data) {
  if (!data.filter) return;
  const b = buildFor(data);
  const staleKr = data.filter.region === 'kr' && b && !(b.summonerSpellPairs || []).length;
  const lackSkill = b && !(b.skillOrder && b.skillOrder.length);
  if (b && !staleKr && !lackSkill) return;
  if (!b && data.filter.region !== 'cn' && data.filter.region !== 'kr') return;
  const nb = await window.nexus.data.build(curKey, curPos).catch(() => null);
  if (nb) data.builds[curPos] = nb;
}

function drawBody(root, data) {
  const body = root.querySelector('#detail-body');
  const st = statFor(data);
  const build = buildFor(data);
  const counters = st ? st.counters : [];

  // 攻略速览：主升优先级 + 核心装 + 最强counter + 最高登场召唤师组合，一屏读懂
  const order = build && build.skillOrder;
  let mainPri = '';
  if (order && order.length) { const cnt = { Q: 0, W: 0, E: 0 }; order.forEach(k => { if (cnt[k] != null) cnt[k]++; }); const pri = Object.keys(cnt).filter(k => cnt[k] > 0).sort((a, b) => cnt[b] - cnt[a]); mainPri = pri.join(' > '); }
  const coreFirst = build && build.coreItems && build.coreItems[0];
  const counterTop = (counters || []).slice().sort((a, b) => (b.winRate || 0) - (a.winRate || 0))[0];
  const spellTop = build && build.summonerSpellPairs && build.summonerSpellPairs[0];
  const guideStrip = `<div class="panel tight mb-4"><div class="flex gap-3 items-center" style="flex-wrap:wrap">
    <span class="fs-12 fw-6 text-gold">${icon('bolt', 13)} 攻略速览</span>
    ${mainPri ? `<span class="badge teal">主升 ${esc(mainPri)}</span>` : ''}
    ${coreFirst ? `<span class="flex items-center gap-1 fs-12">${coreFirst.items.slice(0, 3).map(it => `<img class="item-icon sm" src="${it.imageUrl ? asset(it.imageUrl) : ''}" title="${esc(it.name)}" data-noimg="1"/>`).join('')}<span class="text-3">核心</span></span>` : ''}
    ${spellTop ? `<span class="fs-12 text-3">召唤师 ${(spellTop.spells || []).map(s => esc(s.name)).join('+')} <span class="num text-green">${pct(spellTop.pickRate)}</span></span>` : ''}
    ${counterTop ? `<span class="fs-12 text-3">优势对位 ${esc(getChamp(counterTop.key) ? getChamp(counterTop.key).nameCn : counterTop.key)} <span class="num text-green">${pct(counterTop.winRate)}</span></span>` : ''}
    <div style="flex:1"></div>
    <button class="btn ghost sm" id="btn-items">${icon('vault', 13)} 装备库</button>
  </div></div>`;

  body.innerHTML = guideStrip + `
    <!-- 数据概览 -->
    <div class="panel mb-4">
      <div class="panel-h"><div class="panel-title">数据概览 · ${esc(POS_CN[curPos] || curPos)}</div><div class="flex gap-2 items-center">${sourceTag(srcKind())}<span class="fs-12 text-3">采集 ${timeAgo(st && st.fetchedAt)}</span></div></div>
      ${st ? `<div class="grid" style="grid-template-columns:auto 1fr 1fr 1fr 1fr;gap:20px;align-items:center">
        <div class="flex-col items-center gap-2"><span class="tier-badge lg ${tierClass(st.tier)}">T${st.tier || '?'}</span><span class="fs-12 text-3">排名 #${st.rank || '—'}</span></div>
        <div>${gauge(st.winRate)}</div>
        <div class="flex-col gap-3">
          ${hbar('登场率', +fx(st.pickRate * 100, 2), 30, { color: 'gold', suffix: '%' })}
          ${hbar('禁用率', +fx(st.banRate * 100, 2), 30, { color: 'red', suffix: '%' })}
        </div>
        <div class="flex-col gap-3">
          ${hbar('位置占比', +fx(st.roleRate * 100), 100, { suffix: '%' })}
          <div class="fs-12 text-3">样本量 <span class="num text-2">${num(st.sampleSize)}</span></div>
        </div>
        <div class="flex-col gap-2">
          <div class="fs-12 text-3">排名变化</div>
          ${rankTrend(st)}
        </div>
      </div>` : `<div class="empty-state">${icon('chart', 48)}<div class="es-title">该位置暂无统计</div><div>${esc(srcName())} 未提供此英雄在 ${esc(POS_CN[curPos] || curPos)} 的数据。</div></div>`}
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
      <!-- 符文 -->
      <div class="panel">
        <div class="panel-h"><div class="panel-title">符文推荐</div>${sourceTag(srcKind())}</div>
        <div id="runes-wrap"></div>
      </div>
      <!-- 召唤师技能 + 加点 -->
      <div class="panel">
        <div class="panel-h"><div class="panel-title">召唤师技能 & 加点</div>${sourceTag(srcKind())}</div>
        <div id="spells-wrap"></div>
      </div>
    </div>

    <!-- 出装 -->
    <div class="panel mt-4">
      <div class="panel-h"><div class="panel-title">出装推荐</div>${sourceTag(srcKind())}</div>
      <div id="builds-wrap"></div>
    </div>

    <!-- 技能 -->
    <div class="panel mt-4">
      <div class="panel-h"><div class="panel-title">技能介绍</div>${sourceTag('datadragon')}</div>
      <div id="skills-wrap"></div>
    </div>

    <!-- 克制 -->
    <div class="panel mt-4">
      <div class="panel-h"><div class="panel-title">对线克制 · ${esc(POS_CN[curPos] || curPos)}</div><div class="flex gap-2 items-center">${sourceTag(srcKind())}<button class="btn ghost sm" id="more-counter">完整克制中心 ${icon('chevron', 13)}</button></div></div>
      <div id="counters-wrap" class="grid grid-2"></div>
    </div>

    ${curPos === 'JUNGLE' ? '<div id="detail-jungle" class="mt-4"></div>' : ''}

    <!-- AI 解读 -->
    <div class="panel mt-4">
      <div class="panel-h"><div class="panel-title">AI 战术解读</div>${sourceTag('heuristic')}</div>
      <div id="ai-wrap" class="fs-13 text-2"></div>
    </div>

    <!-- 背景 -->
    ${data.blurb ? `<div class="panel mt-4"><div class="panel-h"><div class="panel-title">背景故事</div>${sourceTag('datadragon')}</div><div class="fs-13 text-2" style="line-height:1.9;white-space:pre-line">${esc(stripHtml(data.blurb))}</div></div>` : ''}
  `;

  renderRunes(body.querySelector('#runes-wrap'), build);
  renderSpells(body.querySelector('#spells-wrap'), build, data);
  renderBuilds(body.querySelector('#builds-wrap'), build, { key: curKey, position: curPos });
  renderSkills(body.querySelector('#skills-wrap'), data);
  // 完整对位页样本优先 → 强度榜双向摘要 → 原始行数据，逐级回退
  window.nexus.counter.matchup(curKey, curPos)
    .then(md => {
      if (md && md.rows && md.rows.length) {
        renderCounters(body.querySelector('#counters-wrap'), md.rows.map(r => ({ championKey: r.opponentKey, winRate: r.winRate, play: r.play })));
        return;
      }
      return window.nexus.data.counters(curKey, curPos)
        .then(cd => renderCounters(body.querySelector('#counters-wrap'), cd && cd.all && cd.all.length ? cd.all : counters));
    })
    .catch(() => renderCounters(body.querySelector('#counters-wrap'), counters));
  body.querySelector('#more-counter').addEventListener('click', () => navigate('counter', { key: curKey, position: curPos }));
  const itemsBtn = body.querySelector('#btn-items');
  if (itemsBtn) itemsBtn.addEventListener('click', () => openItemLibrary());
  renderAI(body.querySelector('#ai-wrap'), data);
  const jg = body.querySelector('#detail-jungle');
  if (jg) {
    jg.innerHTML = '<div class="panel tight"><div class="fs-12 text-3">生成刷野路线…</div></div>';
    window.nexus.analysis.jungleRoute(curKey, null)
      .then(r => { jg.innerHTML = (r && !r.__error) ? jungleRouteHTML(r) : ''; })
      .catch(() => { jg.innerHTML = ''; });
  }
}

// 装备库 browse：搜索+tag过滤+完整属性/被动描述
async function openItemLibrary() {
  const items = await window.nexus.data.items().catch(() => []);
  const m = modal({ title: '装备库', body: el('div', {}), wide: true });
  const body = m.body;
  const tags = [...new Set(items.flatMap(i => i.tags || []))].slice(0, 14);
  body.innerHTML = `<div class="flex gap-2 mb-3" style="flex-wrap:wrap">
    <input class="nx-input" id="il-q" placeholder="搜索装备名…" style="flex:1;min-width:160px"/>
    <select class="nx-select" id="il-tag" style="width:140px"><option value="">全部类型</option>${tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
  </div><div id="il-grid" class="grid" style="grid-template-columns:repeat(4,1fr);gap:10px;max-height:60vh;overflow:auto"></div>`;
  const draw = () => {
    const q = (body.querySelector('#il-q').value || '').trim().toLowerCase();
    const tag = body.querySelector('#il-tag').value;
    const rows = items.filter(i => (!q || (i.nameCn || '').toLowerCase().includes(q) || (i.name || '').toLowerCase().includes(q)) && (!tag || (i.tags || []).includes(tag)));
    body.querySelector('#il-grid').innerHTML = rows.slice(0, 120).map(i => `<div class="flex gap-2" style="padding:8px;border:1px solid var(--line);border-radius:var(--r-md);background:rgba(0,0,0,0.15)" title="${esc(stripHtml(i.description || ''))}">
      <img class="item-icon sm" src="${i.imageUrl ? asset(i.imageUrl) : ''}" data-noimg="1"/>
      <div style="flex:1;min-width:0"><div class="fs-12 fw-6 truncate">${esc(i.nameCn || i.name)}</div><div class="fs-11 text-3 num">${i.gold != null ? i.gold + ' 金' : ''}</div></div>
    </div>`).join('') || '<div class="text-3 fs-13" style="grid-column:1/-1">无匹配装备</div>';
  };
  body.querySelector('#il-q').addEventListener('input', draw);
  body.querySelector('#il-tag').addEventListener('change', draw);
  draw();
}

function rankTrend(st) {
  const delta = st.rankPrev != null && st.rank != null ? st.rankPrev - st.rank : null;
  const deltaPatch = st.rankPrevPatch != null && st.rank != null ? st.rankPrevPatch - st.rank : null;
  const badge = (d, label) => {
    if (d == null) return `<div class="fs-12 text-3">${label}：—</div>`;
    if (d > 0) return `<div class="fs-12 text-green">${label}：${icon('arrowUp', 12)} +${d}</div>`;
    if (d < 0) return `<div class="fs-12 text-red">${label}：${icon('arrowDown', 12)} ${d}</div>`;
    return `<div class="fs-12 text-3">${label}：持平</div>`;
  };
  return badge(delta, '较昨日') + badge(deltaPatch, '较上版本');
}

function perkImg(p, cls = 'perk-icon') {
  const src = p && p.icon ? asset(p.icon) : (p && p.imageUrl ? p.imageUrl : '');
  return `<img class="${cls}" src="${src}" alt="${esc(p ? (p.nameCn || p.name || '') : '')}" title="${esc(p ? (p.nameCn || p.name || '') : '')}" data-noimg="1"/>`;
}

export function renderRunes(wrap, build) {
  if (!build || !build.runes || !build.runes.length) { wrap.innerHTML = '<div class="text-3 fs-13">暂无符文数据。</div>'; return; }
  wrap.innerHTML = '';
  build.runes.slice(0, 2).forEach((r, idx) => {
    const block = el('div', { class: 'mb-4', html: `
      <div class="flex items-center gap-3 mb-3">
        ${perkImg(r.primaryRune, 'perk-icon keystone')}
        <div style="flex:1">
          <div class="fw-6">${esc(r.primaryRune ? (r.primaryRune.nameCn || r.primaryRune.name) : '主系符文')}</div>
          <div class="fs-12 text-3">${esc(r.primaryStyle ? (r.primaryStyle.nameCn || r.primaryStyle.name) : '')} + ${esc(r.subStyle ? (r.subStyle.nameCn || r.subStyle.name) : '')}</div>
        </div>
        <div class="text-right"><div class="num text-green">${pct(r.winRate)}</div><div class="fs-12 text-3">登场 ${pct(r.pickRate)}</div></div>
      </div>
      <div class="flex items-center gap-3" style="flex-wrap:wrap">
        <div class="flex gap-1 items-center">${perkImg(r.primaryStyle, 'perk-icon sm')}${(r.primary || []).map(p => perkImg(p, 'perk-icon sm')).join('')}</div>
        <div class="text-3">|</div>
        <div class="flex gap-1 items-center">${perkImg(r.subStyle, 'perk-icon sm')}${(r.secondary || []).map(p => perkImg(p, 'perk-icon sm')).join('')}</div>
        <div class="text-3">|</div>
        <div class="flex gap-1 items-center">${(r.shards || []).map(p => perkImg(p, 'perk-icon sm')).join('')}</div>
      </div>
      ${idx === 0 ? '' : '<div class="divider"></div>'}
    ` });
    wrap.appendChild(block);
  });
}

export function renderSpells(wrap, build, data) {
  const pairs = build && build.summonerSpellPairs && build.summonerSpellPairs.length ? build.summonerSpellPairs : null;
  const spells = build && build.summonerSpells ? build.summonerSpells : [];
  const order = build ? build.skillOrder : null;
  // 召唤师技能按「组合」展示：主组合两个图标 + 登场/胜率/场次，备选组合小行；不拍平成单排
  const pairHtml = (p, main) => `<div class="flex items-center gap-2 ${main ? '' : 'mt-2'}" style="flex-wrap:wrap${main ? '' : ';opacity:.8'}">
    ${(p.spells || []).map(sp => `<img class="item-icon${main ? '' : ' sm'}" src="${sp.icon ? asset(sp.icon) : ''}" alt="${esc(sp.name)}" title="${esc(sp.name)}" data-noimg="1"/>`).join('<span class="text-3 fs-12">+</span>')}
    <span class="fs-12 text-2">${(p.spells || []).map(sp => esc(sp.name)).join(' + ')}</span>
    <span class="num fs-12 ${main ? 'text-green' : 'text-3'}">${pct(p.pickRate)}</span><span class="fs-12 text-3">登场</span>
    ${p.winRate != null ? `<span class="num fs-12 text-3">${pct(p.winRate)} 胜</span>` : ''}
    ${p.games != null ? `<span class="fs-12 text-3 num">${num(p.games)} 场</span>` : ''}
  </div>`;
  wrap.innerHTML = `
    <div class="fs-12 text-3 mb-2">召唤师技能${pairs ? '（按组合 · 首行为最高登场）' : ''}</div>
    <div class="mb-4">${pairs ? pairHtml(pairs[0], true) + pairs.slice(1, 3).map(p => pairHtml(p, false)).join('')
      : spells.length ? `<div class="flex gap-3">${spells.map(sp => `<div class="flex-col items-center gap-1"><img class="item-icon" src="${sp.icon ? asset(sp.icon) : ''}" alt="${esc(sp.name)}" data-noimg="1"/><span class="fs-12 text-2">${esc(sp.name)}</span></div>`).join('')}</div>`
      : '<span class="text-3 fs-13">暂无</span>'}</div>
    <div class="fs-12 text-3 mb-2">技能加点顺序 ${build && build.skillOrderSource === 'cn101-official' ? '<span class="badge teal" style="font-size:10px">国服官方加点</span>' : ''}</div>
    ${order && order.length ? skillOrderGrid(order)
      : `<div class="text-3 fs-13">该口径页面未提供完整加点顺序，暂不展示（不臆造）。${mainSkillHint(build)}</div>`}
  `;
}
// 加点顺序按「等级 × 技能」网格展示（韩服/国服同一版式）：列=等级，行=Q/W/E/R，命中格点亮
function skillOrderGrid(order) {
  const keys = ['Q', 'W', 'E', 'R'];
  const cnt = { Q: 0, W: 0, E: 0 };
  order.forEach(k => { if (cnt[k] != null) cnt[k]++; });
  const pri = Object.keys(cnt).filter(k => cnt[k] > 0).sort((a, b) => cnt[b] - cnt[a]);
  const head = `<tr><th></th>${order.map((_, i) => `<th class="num fs-11 text-3" style="text-align:center;padding:2px 5px;font-weight:500">${i + 1}</th>`).join('')}</tr>`;
  const rows = keys.map(k => `<tr><td style="padding:2px 6px 2px 0"><span class="badge ${k === 'R' ? 'gold' : 'teal'}" style="min-width:22px;justify-content:center">${k}</span></td>${order.map(o => `<td style="text-align:center;padding:2px 5px">${o === k ? `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${k === 'R' ? 'var(--gold)' : 'var(--teal)'}"></span>` : ''}</td>`).join('')}</tr>`).join('');
  return `<div class="flex gap-2 items-center mb-2" style="flex-wrap:wrap">
      ${pri.length ? `<span class="badge teal">主升 ${esc(pri[0])}</span>` : ''}
      ${order.length >= 3 ? `<span class="badge gray">前3级 ${esc(order.slice(0, 3).join(' '))}</span>` : ''}
      ${order.length < 18 ? `<span class="fs-12 text-3">官方口径提供前 ${order.length} 级</span>` : ''}
    </div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
function mainSkillHint(build) {
  const order = build && build.skillOrder;
  if (order && order.length) {
    const cnt = { Q: 0, W: 0, E: 0 };
    order.forEach(k => { if (cnt[k] != null) cnt[k]++; });
    const pri = Object.keys(cnt).filter(k => cnt[k] > 0).sort((a, b) => cnt[b] - cnt[a]);
    if (pri.length) return `按真实加点序列统计的主升优先级：${pri.join(' > ')}（R 有必点，具体以实战为准）。`;
  }
  return '该口径未提供加点优先级，不臆造主升顺序。';
}

function itemGroup(title, groups, build) {
  if (!groups || !groups.length) return '';
  return `<div class="mb-4"><div class="fs-12 text-3 mb-2 fw-6">${esc(title)}</div>
    <div class="flex-col gap-2">${groups.slice(0, 3).map((g, i) => `
      <div class="flex items-center gap-3" style="padding:8px;border-radius:var(--r-md);border:1px solid ${i === 0 ? 'var(--line-strong)' : 'var(--line)'};background:${i === 0 ? 'var(--gold-dim)' : 'rgba(0,0,0,0.15)'}">
        <div class="flex gap-1">${g.items.map(it => `<img class="item-icon sm" src="${it.imageUrl ? asset(it.imageUrl) : ''}" alt="${esc(it.name)}" title="${esc(it.name)}${it.gold ? ' · ' + it.gold + '金' : ''}" data-noimg="1"/>`).join('')}</div>
        <div style="flex:1;min-width:0"><div class="fs-12 truncate">${esc(g.items.map(it => it.name).join(' → '))}</div></div>
        <div class="text-right fs-12"><span class="num text-green">${pct(g.winRate)}</span> <span class="text-3">/ ${pct(g.pickRate)}</span>${g.games ? `<div class="text-3 num">${num(g.games)} 场</div>` : ''}</div>
      </div>`).join('')}</div></div>`;
}
export function renderBuilds(wrap, build, ctx) {
  if (!build) { wrap.innerHTML = '<div class="text-3 fs-13">暂无出装数据。</div>'; return; }
  wrap.innerHTML = itemGroup('出门装', build.starterItems) + itemGroup('鞋子', build.boots) + itemGroup('核心出装（按登场率）', build.coreItems) + itemGroup('后续 / situational', build.lastItems);
  if (!wrap.innerHTML) wrap.innerHTML = '<div class="text-3 fs-13">暂无出装数据。</div>';
  if (ctx) {
    const sixWrap = el('div', { class: 'mb-4' });
    wrap.prepend(sixWrap);
    window.nexus.analysis.buildPlan(ctx.key, ctx.position, [])
      .then(p => { if (p) renderSix(sixWrap, p); else sixWrap.remove(); })
      .catch(() => sixWrap.remove());
  }
}

function renderSkills(wrap, data) {
  const sk = data.skills;
  if (!sk || (!sk.passive && !(sk.spells || []).length)) { wrap.innerHTML = '<div class="text-3 fs-13">暂无技能资料。</div>'; return; }
  const cards = [];
  if (sk.passive) cards.push({ key: 'P', name: sk.passive.name, desc: sk.passive.description, img: `passive/${data.key}.png` });
  for (const sp of sk.spells || []) cards.push({ key: sp.key, name: sp.name, desc: sp.description, img: `ability/${data.key}_${sp.key}.png`, cd: sp.cooldown, cost: sp.cost, range: sp.range });
  wrap.innerHTML = `<div class="flex-col gap-3">${cards.map(c => `
    <div class="flex gap-3" style="padding:10px;border-radius:var(--r-md);border:1px solid var(--line);background:rgba(0,0,0,0.15)">
      <div class="flex-col items-center gap-1"><img class="item-icon" src="${asset(c.img)}" alt="${esc(c.name)}" data-noimg="1"/><span class="badge ${c.key === 'R' ? 'gold' : 'teal'}" style="min-width:24px;justify-content:center">${esc(c.key)}</span></div>
      <div style="flex:1;min-width:0"><div class="fw-6 mb-1 flex gap-2 items-center" style="flex-wrap:wrap">${esc(c.name)}
        ${c.cd ? `<span class="badge gray" style="font-size:10px">冷却 ${esc(c.cd)}</span>` : ''}
        ${c.cost ? `<span class="badge gray" style="font-size:10px">消耗 ${esc(c.cost)}</span>` : ''}
        ${c.range ? `<span class="badge gray" style="font-size:10px">射程 ${esc(c.range)}</span>` : ''}</div>
      <div class="fs-12 text-2" style="line-height:1.7;white-space:pre-line">${esc(stripHtml(c.desc))}</div></div>
    </div>`).join('')}</div>`;
}

function renderCounters(wrap, counters) {
  const strong = counters.filter(c => c.winRate != null && c.winRate >= 0.5).sort((a, b) => b.winRate - a.winRate).slice(0, 5);
  const weak = counters.filter(c => c.winRate != null && c.winRate < 0.5).sort((a, b) => a.winRate - b.winRate).slice(0, 5);
  const col = (title, list, cls) => {
    const inner = list.length ? list.map(c => {
      const ch = getChamp(c.championKey) || {};
      return `<div class="flex items-center gap-2" data-key="${esc(c.championKey)}" style="padding:6px;border-radius:var(--r-md);cursor:pointer">
        <img src="${asset(ch.imageUrl)}" style="width:32px;height:32px;border-radius:var(--r-sm)" alt=""/>
        <span style="flex:1" class="fs-13 truncate">${esc(ch.nameCn || c.name || c.championKey)}</span>
        <span class="num ${cls}">${pct(c.winRate)}</span><span class="fs-12 text-3 num">${c.play || 0}场</span></div>`;
    }).join('') : '<div class="text-3 fs-13">暂无样本</div>';
    return `<div><div class="section-title" style="font-size:13px">${title}</div><div class="flex-col gap-1">${inner}</div></div>`;
  };
  wrap.innerHTML = col('优势对线（我方胜率高）', strong, 'text-green') + col('劣势对线（需谨慎）', weak, 'text-red');
  wrap.querySelectorAll('[data-key]').forEach(n => n.addEventListener('click', () => navigate('counter', { key: curKey, enemy: n.dataset.key, position: curPos })));
}

async function renderAI(wrap, data) {
  wrap.innerHTML = '<div class="skeleton" style="height:60px"></div>';
  const res = await window.nexus.analysis.build(curKey, curPos);
  if (!res || res.__error || !res.reason || !res.reason.length) { wrap.innerHTML = '<div class="text-3 fs-13">暂无可解读的出装数据。</div>'; return; }
  wrap.innerHTML = `<div class="flex-col gap-2">${res.reason.map(r => `<div class="flex gap-2">${icon('spark', 15, 'text-teal')}<span style="line-height:1.7">${esc(r)}</span></div>`).join('')}</div>
    <div class="mt-3 fs-12 text-3">${esc(res.note || '')}</div>`;
}