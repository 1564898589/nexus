// 装备规划 2.0 渲染层：六神装 / 购买顺序 / 热门独立区 / 敌方针对 / 6 阶段时间线。
// 所有胜率/登场率/样本量来自 OP.GG 真实行；规则推导单独标 heuristic。
import { icon } from './icons.js';
import { esc, pct, num, asset, sourceTag, TIER_FILTERS, REGIONS } from './util.js';

const SRC_CN = { core: '核心行', boots: '鞋子行', single: '热门单件', combo: '其他组合行', 'single-assembled': '单件组装', empty: '无样本' };
function meta(plan, id) { return (plan.items || {})[id] || { id, name: '#' + id, imageUrl: `item/${id}.png` }; }
function iconHtml(plan, id, cls = 'item-icon') {
  const m = meta(plan, id);
  return `<img class="${cls}" src="${asset(m.imageUrl)}" alt="${esc(m.nameCn || m.name)}" title="${esc(m.nameCn || m.name)}" data-noimg="1"/>`;
}
function statsHtml(row) {
  if (row && row.heuristic) return '<span class="badge amber" style="font-size:11px">规则推导</span>';
  if (!row || row.winRate == null) return '<span class="text-3 fs-12">无样本</span>';
  return `<span class="num text-green">${pct(row.winRate)}</span> <span class="text-3 fs-12">/ ${pct(row.pickRate)}</span>${row.games != null ? `<div class="text-3 num fs-12">${num(row.games)} 场</div>` : ''}${row.games != null && row.games < 100 ? '<span class="badge amber" style="font-size:11px">小样本</span>' : ''}`;
}

export function renderSix(wrap, plan) {
  const swapAt = {};
  (plan.swaps || []).forEach(s => { swapAt[s.slot] = s; });
  wrap.innerHTML = `
    <div class="six-row">${plan.adjustedSix.map((id, i) => {
      const sw = swapAt[i];
      if (id == null) return `<div class="six-slot empty"><div class="ss-empty">${icon('plus', 16)}</div><div class="ss-name text-3">无样本留空</div><div class="ss-src badge gray">${SRC_CN.empty}</div></div>`;
      const m = meta(plan, id);
      const row = i < 3 ? plan.coreRow : i === 3 ? plan.bootsRow : (plan.followRows || {})[id];
      return `<div class="six-slot ${sw ? 'swapped' : ''}" title="${esc(m.nameCn || m.name)}">
        ${iconHtml(plan, id)}
        <div class="ss-name">${esc(m.nameCn || m.name)}</div>
        <div class="ss-src badge ${sw ? 'amber' : 'teal'}">${sw ? '针对替换' : SRC_CN[plan.sixSources[i]] || '真实行'}</div>
        ${sw ? `<div class="ss-out text-3">原：${esc(meta(plan, sw.outId).nameCn || meta(plan, sw.outId).name)}</div>`
          : row && row.winRate != null ? `<div class="ss-stats num text-3">${pct(row.winRate)} 胜 · ${num(row.games)} 场</div>` : ''}
      </div>`;
    }).join('')}</div>
    <div class="fs-12 text-3 mt-3">${esc(plan.note)}</div>`;
}

export function renderPurchase(wrap, plan) {
  wrap.innerHTML = `<div class="purchase-row">${plan.purchase.map((p, i) => `
    ${i ? `<span class="pr-arrow">${icon('chevron', 14)}</span>` : ''}
    <div class="purchase-step">
      <div class="ps-stage num">${p.stage}</div>
      <div class="ps-label">${esc(p.label)}</div>
      <div class="flex gap-1" style="justify-content:center">${p.ids.length ? p.ids.map(id => iconHtml(plan, id, 'item-icon sm')).join('') : '<span class="text-3 fs-12">—</span>'}</div>
      <div class="ps-stats">${statsHtml(p.row)}</div>
    </div>`).join('')}</div>
    <div class="fs-12 text-3 mt-3">购买顺序含出门装与鞋子时机；最终六格组合见上方「六神装」，两者口径不同、分别展示。</div>`;
}

export function renderPopular(wrap, plan) {
  if (!plan.popular.length) { wrap.innerHTML = '<div class="text-3 fs-13">暂无热度样本。</div>'; return; }
  wrap.innerHTML = `<div class="flex-col gap-2">${plan.popular.map(r => `
    <div class="flex items-center gap-3" style="padding:8px;border-radius:var(--r-md);border:1px solid var(--line);background:rgba(0,0,0,0.15)">
      <div class="flex gap-1">${r.items.map(it => iconHtml(plan, it.id, 'item-icon sm')).join('')}</div>
      <div style="flex:1;min-width:0"><div class="fs-12 truncate">${esc(r.items.map(it => (meta(plan, it.id).nameCn || meta(plan, it.id).name)).join(' → '))}</div><div class="fs-11 text-3">${esc(r.kind)} · 独立热度行</div></div>
      <div class="text-right">${statsHtml(r)}</div>
    </div>`).join('')}</div>
    ${plan.popularNote ? `<div class="fs-12 text-3 mt-3">${esc(plan.popularNote)}</div>` : ''}`;
}

export function renderEnemy(wrap, plan, srcLabel) {
  const dims = plan.dims || [];
  const hasEnemy = dims.some(d => d.value > 0);
  wrap.innerHTML = `
    <div class="fs-12 text-3 mb-3">敌方阵容来源：${esc(srcLabel)}${hasEnemy ? '' : ' · 未选择敌方阵容，仅展示通用规划'}</div>
    <div class="grid grid-2" style="gap:8px 24px">${dims.map(d => `
      <div><div class="flex justify-between fs-12 mb-1"><span class="text-2">${esc(d.label)} <span class="text-3">· ${esc(d.note)}</span></span><span class="num text-3">${Math.round(d.value * 100)}%</span></div>
      <div class="bar-track"><div class="bar-fill ${d.value >= 0.4 ? '' : 'dim'}" style="width:${Math.round(d.value * 100)}%"></div></div></div>`).join('')}</div>
    ${(plan.swaps || []).length ? `<div class="divider"></div><div class="section-title" style="font-size:13px">智能替换建议 ${sourceTag('heuristic')}</div>
      <div class="flex-col gap-2">${plan.swaps.map(s => `
        <div class="flex items-center gap-3" style="padding:8px;border-radius:var(--r-md);border:1px solid var(--line)">
          ${s.outId != null ? iconHtml(plan, s.outId, 'item-icon sm') : '<span class="badge gray">空槽</span>'}
          <span class="text-3">${icon('chevron', 14)}</span>
          ${iconHtml(plan, s.inId, 'item-icon sm')}
          <div style="flex:1" class="fs-12 text-2">${esc(s.reason)} <span class="badge amber" style="font-size:11px">规则推导 · 无胜率样本</span></div>
        </div>`).join('')}</div>` : '<div class="fs-12 text-3 mt-3">当前敌方阵容未触发替换阈值，沿用真实统计组合。</div>'}`;
}

export function renderTimeline(wrap, plan) {
  wrap.innerHTML = `<div class="timeline-row">${plan.timeline.map((t, i) => `
    <div class="tl-stage ${t.ids.length ? '' : 'empty'}">
      <div class="tl-dot num">${t.stage}</div>
      <div class="tl-label">${esc(t.label)}</div>
      <div class="flex gap-1" style="justify-content:center">${t.ids.length ? t.ids.map(id => iconHtml(plan, id, 'item-icon sm')).join('') : '<span class="text-3 fs-12">—</span>'}</div>
      <div class="tl-stats">${statsHtml(t.row)}${t.lowSample ? '' : ''}</div>
    </div>`).join('')}</div>
    <div class="fs-12 text-3 mt-3">六阶段购买时间线：出门 → 鞋子 → 核心三件 → 针对/后续。阶段 3–5 样本为核心组合行整体统计。</div>`;
}

export function renderPlanAll(wrap, plan, srcLabel) {
  const regionLabel = (REGIONS.find(r => r.v === plan.region) || {}).l || plan.region || '—';
  const tierLabel = (TIER_FILTERS.find(t => t.v === plan.tier) || {}).l || plan.tier || '—';
  const isCn = plan.provider === '101-official';
  const srcKind = isCn ? 'cn101' : 'opgg';
  const caliber = `数据口径：${regionLabel} · ${tierLabel} · 版本 ${plan.patch || '—'} · 采集 ${plan.fetchedAt ? new Date(plan.fetchedAt).toLocaleString('zh-CN') : '—'} · ${isCn ? '腾讯 101 官方攻略中心（官方未提供样本量）' : '与 OP.GG 该口径页面逐行一致'}`;
  wrap.innerHTML = `
    <div class="fs-12 text-3 mt-4" style="margin-bottom:-8px">${esc(caliber)}</div>
    <div class="panel mt-4"><div class="panel-h"><div class="panel-title">六神装 · 最终组合</div>${sourceTag(srcKind)}</div><div id="pl-six"></div></div>
    <div class="grid grid-2 mt-4">
      <div class="panel"><div class="panel-h"><div class="panel-title">购买顺序</div>${sourceTag(srcKind)}</div><div id="pl-purchase"></div></div>
      <div class="panel"><div class="panel-h"><div class="panel-title">热门装备 · 独立热度区</div>${sourceTag(srcKind)}</div><div id="pl-popular"></div></div>
    </div>
    <div class="panel mt-4"><div class="panel-h"><div class="panel-title">敌方阵容针对 · 10 维分析</div>${sourceTag('heuristic')}</div><div id="pl-enemy"></div></div>
    <div class="panel mt-4"><div class="panel-h"><div class="panel-title">对局装备规划 · 6 阶段时间线</div>${sourceTag(srcKind)}${sourceTag('heuristic')}</div><div id="pl-timeline"></div></div>`;
  renderSix(wrap.querySelector('#pl-six'), plan);
  renderPurchase(wrap.querySelector('#pl-purchase'), plan);
  renderPopular(wrap.querySelector('#pl-popular'), plan);
  renderEnemy(wrap.querySelector('#pl-enemy'), plan, srcLabel);
  renderTimeline(wrap.querySelector('#pl-timeline'), plan);
}