// 出装符文中心 — Builds & Runes Center.
import { icon } from '../icons.js';
import { el, esc, asset, POS_CN, sourceTag, toast } from '../util.js';
import { store, navigate, getChamp, loadChampions } from '../store.js';
import { renderRunes, renderBuilds, renderSpells } from './detail.js';
import { renderPlanAll } from '../buildplan-ui.js';
import { aiBlock, bindAi } from './intel-common.js';

let curKey = 'ahri', curPos = 'MID', q = '';
let planSrc = 'none', bpHandler = null, bpTimer = null;

export async function render(root, params) {
  await loadChampions();
  if (params.key) curKey = params.key;
  if (params.position) curPos = params.position;
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('build', 26, 'accent')} 出装符文中心 <span class="accent">BUILDS</span></div>
      <div class="page-sub">OP.GG 韩服 / 腾讯 101 官方出装与符文 · 含胜率 / 登场率 / 样本量（韩服）· 随顶部服务器口径切换</div>
    </div>
    <div class="grid" style="grid-template-columns:280px 1fr;gap:16px;align-items:start">
      <div class="panel tight" style="position:sticky;top:0">
        <div class="search-box mb-3" style="width:100%">${icon('search', 16)}<input id="build-search" placeholder="搜索英雄…" value="${esc(q)}"/></div>
        <div id="build-list" class="flex-col gap-1" style="max-height:64vh;overflow-y:auto"></div>
      </div>
      <div id="build-content"></div>
    </div>
  `;
  root.querySelector('#build-search').addEventListener('input', (e) => { q = e.target.value; drawList(root); });
  drawList(root);
  await drawContent(root);
  return { destroy: () => { if (bpHandler) { window.removeEventListener('nexus-bp-board', bpHandler); bpHandler = null; } clearTimeout(bpTimer); } };
}

function drawList(root) {
  const list = root.querySelector('#build-list');
  const ql = q.trim().toLowerCase();
  const champs = store.champions.filter(c => !ql || (c.nameCn || '').toLowerCase().includes(ql) || (c.name || '').toLowerCase().includes(ql) || c.key.includes(ql));
  list.innerHTML = champs.map(c => `<div class="flex items-center gap-2 ${c.key === curKey ? 'active' : ''}" data-key="${esc(c.key)}" style="padding:7px 8px;border-radius:var(--r-md);cursor:pointer;${c.key === curKey ? 'background:var(--teal-dim)' : ''}">
    <img src="${asset(c.imageUrl)}" style="width:32px;height:32px;border-radius:var(--r-sm)"/><span class="fs-13 truncate ${c.key === curKey ? 'text-teal' : ''}">${esc(c.nameCn || c.name)}</span></div>`).join('');
  list.querySelectorAll('[data-key]').forEach(n => n.addEventListener('click', () => { curKey = n.dataset.key; drawList(root); drawContent(root); }));
}

async function drawContent(root) {
  const wrap = root.querySelector('#build-content');
  wrap.innerHTML = '<div class="panel"><div class="skeleton" style="height:200px"></div></div>';
  let data;
  try { data = await window.nexus.data.champion(curKey); }
  catch (e) { wrap.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 40)}<div class="es-title">加载失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary sm mt-3" id="b-retry">重试</button></div></div>`; wrap.querySelector('#b-retry').addEventListener('click', () => drawContent(root)); return; }
  const c = getChamp(curKey);
  const positions = data.stats.map(s => s.position);
  if (!positions.includes(curPos)) curPos = positions[0] || 'MID';
  let build = (data.builds[curPos] && data.builds[curPos].data) || null;
  // 国服详情懒加载 / 韩服旧缓存形状懒刷新（技能组合 + 18 级加点解析）
  const needFetch = data.filter && ((!build && data.filter.region === 'cn') || (build && data.filter.region === 'kr' && !(build.summonerSpellPairs || []).length));
  if (needFetch) { const b2 = await window.nexus.data.build(curKey, curPos); build = (b2 && b2.data) || build; }
  wrap.innerHTML = `
    <div class="panel mb-4">
      <div class="flex items-center gap-3">
        <img src="${asset(c.imageUrl)}" style="width:64px;height:64px;border-radius:var(--r-md);border:1px solid var(--line-strong)"/>
        <div style="flex:1"><div class="fw-6 fs-16" style="color:var(--gold-bright)">${esc(c.nameCn)} <span class="fs-12 text-3">${esc(c.titleCn || '')}</span></div>
        <div class="chip-row mt-2" id="build-pos">${positions.map(p => `<button class="chip ${p === curPos ? 'active' : ''}" data-pos="${p}">${POS_CN[p]}</button>`).join('')}</div></div>
        <button class="btn ghost sm" id="go-detail">${icon('champion', 14)} 完整详情</button>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="panel"><div class="panel-h"><div class="panel-title">符文推荐</div>${sourceTag(build && build.provider === '101-official' ? 'cn101' : 'opgg')}</div><div id="b-runes"></div></div>
      <div class="panel"><div class="panel-h"><div class="panel-title">召唤师技能 & 加点</div>${sourceTag(build && build.provider === '101-official' ? 'cn101' : 'opgg')}</div><div id="b-spells"></div></div>
    </div>
    <div class="panel mt-4"><div class="panel-h"><div class="panel-title">装备规划 2.0 · 敌方阵容来源</div></div>
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <select class="nx-select" id="plan-src" style="width:300px">
          <option value="none">不选敌方阵容（通用规划）</option>
          <option value="bp">当前 BP 棋盘（随棋盘自动更新）</option>
        </select>
        <span class="fs-12 text-3" id="plan-src-note"></span>
      </div>
    </div>
    <div id="b-plan"></div>
    <details class="mt-4"><summary class="fs-12 text-3" style="cursor:pointer">OP.GG 原始行（出门 / 鞋子 / 核心 / 后续，含样本量）</summary><div class="panel mt-3"><div id="b-builds"></div></div></details>
    <div class="panel mt-4"><div class="panel-h"><div class="panel-title">AI 出装解读</div>${sourceTag('heuristic')}</div><div id="b-ai" class="fs-13 text-2"></div></div>
    ${aiBlock('builds-ai', { title: 'AI 出装与英雄解读', hint: '基于该英雄当前版本真实出装/符文/加点统计生成结构化解读。' })}
  `;
  wrap.querySelectorAll('#build-pos .chip').forEach(ch => ch.addEventListener('click', () => { curPos = ch.dataset.pos; drawContent(root); }));
  wrap.querySelector('#go-detail').addEventListener('click', () => navigate('detail', { key: curKey, position: curPos }));
  renderRunes(wrap.querySelector('#b-runes'), build);
  renderSpells(wrap.querySelector('#b-spells'), build, data);
  renderBuilds(wrap.querySelector('#b-builds'), build);
  const saves = await window.nexus.prep.list().catch(() => []);
  const sel = wrap.querySelector('#plan-src');
  (saves || []).forEach(s => { const o = document.createElement('option'); o.value = 'prep:' + s.id; o.textContent = '对局准备：' + (s.name || s.id); sel.appendChild(o); });
  if ([...sel.options].some(o => o.value === planSrc)) sel.value = planSrc;
  sel.addEventListener('change', () => { planSrc = sel.value; drawPlan(root); });
  if (bpHandler) window.removeEventListener('nexus-bp-board', bpHandler);
  bpHandler = () => { if (planSrc !== 'bp') return; clearTimeout(bpTimer); bpTimer = setTimeout(() => drawPlan(root), 300); };
  window.addEventListener('nexus-bp-board', bpHandler);
  await drawPlan(root);
  const ai = await window.nexus.analysis.build(curKey, curPos);
  wrap.querySelector('#b-ai').innerHTML = ai && ai.reason && ai.reason.length
    ? `<div class="flex-col gap-2">${ai.reason.map(r => `<div class="flex gap-2">${icon('spark', 14, 'text-teal')}<span style="line-height:1.7">${esc(r)}</span></div>`).join('')}</div><div class="mt-3 fs-12 text-3">${esc(ai.note || '')}</div>`
    : '<div class="text-3 fs-13">暂无可解读数据。</div>';
  const region = (data.filter && data.filter.region) || 'kr';
  bindAi(wrap, 'builds-ai', 'query', () => ({
    data: {
      champion: c.nameCn, position: curPos, region,
      tierFilter: data.filter && data.filter.tierFilter, patch: build && build.patch,
      build: build ? { coreItems: build.coreItems, boots: build.boots, starter: build.starter, lastItems: build.lastItems, summonerSpellPairs: (build.summonerSpellPairs || []).slice(0, 3), skillOrder: build.skillOrder, runes: build.runes } : null,
      ruleReasons: ai && ai.reason || [],
    },
    rules: { facts: ai && ai.reason || [], inferences: [], advice: [] },
  }), {
    variant: 'build', subject: curKey + ':' + curPos, subjectName: c.nameCn + ' · ' + (POS_CN[curPos] || curPos),
    dataRange: `${region === 'cn' ? '国服 101 官方' : 'OP.GG 韩服'} · ${curPos} · 版本 ${(build && build.patch) || '未知'}`,
  });
}

async function drawPlan(root) {
  const wrap = root.querySelector('#b-plan');
  const note = root.querySelector('#plan-src-note');
  if (!wrap) return;
  let enemyKeys = [], label = '未选择';
  if (planSrc === 'bp') {
    const b = store.bpBoard;
    enemyKeys = b ? b.enemyPicks.map(p => p.key) : [];
    label = b && b.enemyPicks.length ? `当前 BP · 敌方 ${b.enemyPicks.length} 名英雄` : '当前 BP（棋盘为空，先去 BP 页选人）';
  } else if (planSrc.startsWith('prep:')) {
    const s = await window.nexus.prep.load(planSrc.slice(5)).catch(() => null);
    const bp = s && s.data && s.data.bp;
    enemyKeys = bp ? (bp.red || []).map(p => p.key).filter(Boolean) : [];
    label = s ? `对局准备：${s.name || s.id}（默认蓝方为我方）` : '准备方案加载失败';
  }
  if (note) note.textContent = label;
  wrap.innerHTML = '<div class="panel mt-4"><div class="skeleton" style="height:160px"></div></div>';
  const plan = await window.nexus.analysis.buildPlan(curKey, curPos, enemyKeys).catch(() => null);
  if (!plan) { wrap.innerHTML = '<div class="panel mt-4"><div class="empty-state">' + icon('build', 40) + '<div class="es-title">暂无该位置的出装样本</div><div>切换位置或等待数据更新；不会显示伪造出装。</div></div></div>'; return; }
  renderPlanAll(wrap, plan, label);
}