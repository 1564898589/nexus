// Meta Watch — version meta from real OP.GG KR data; trends only when multiple patches exist.
import { icon } from '../icons.js';
import { esc, asset, pct, sourceTag, fmtTime, POS_CN } from '../util.js';
import { hbar } from '../charts.js';
import { store, loadChampions, navigate } from '../store.js';

function champBy(key) { return store.champions.find(c => c.key === key) || null; }

export async function render(root) {
  await loadChampions();
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('chart', 26, 'accent')} 版本趋势 <span class="accent">META</span></div>
      <div class="page-sub">OP.GG 韩服真实统计的版本生态 · 多版本数据随每次更新自然积累</div>
    </div>
    <div id="meta-body"><div class="panel"><div class="empty-state">${icon('sync', 36)}<div class="es-title">加载中…</div></div></div></div>`;
  const body = root.querySelector('#meta-body');
  let t;
  try { t = await window.nexus.metaTrends(); } catch (e) { t = { __error: String(e.message || e) }; }
  if (!t || t.__error) { body.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 36)}<div class="es-title">加载失败</div><div>${esc(t && t.__error || '')}</div></div></div>`; return; }
  const tierNames = { 1: 'T1 版本答案', 2: 'T2 强势', 3: 'T3 均衡', 4: 'T4 偏弱', 5: 'T5 冷门' };
  const tierColors = { 1: 'var(--t1)', 2: 'var(--teal)', 3: 'var(--blue)', 4: 'var(--purple)', 5: 'var(--t5)' };
  const total = Object.values(t.byTier).reduce((a, b) => a + b, 0) || 1;
  const rowList = (arr, metric) => arr.map(r => {
    const c = champBy(r.championKey);
    return `<div class="flex items-center gap-2 fs-12 mb-1" data-key="${esc(r.championKey)}" data-pos="${esc(r.position)}" style="cursor:pointer;padding:4px 6px;border-radius:var(--r-sm)">
      ${c ? `<img src="${asset(c.imageUrl)}" style="width:26px;height:26px;border-radius:var(--r-sm)"/>` : ''}
      <span style="flex:1" class="truncate">${c ? esc(c.nameCn) : esc(r.championKey)} <span class="text-3">${esc(POS_CN[r.position] || r.position)}</span></span>
      <span class="num ${metric === 'winRate' ? 'text-green' : 'text-2'}">${pct(r[metric])}</span>
      <span class="text-3 num" style="width:70px;text-align:right">${r.sampleSize} 场</span></div>`;
  }).join('') || '<div class="text-3 fs-12">样本不足（≥200 场门槛）。</div>';
  body.innerHTML = `
    <div class="grid" style="grid-template-columns:340px 1fr;gap:16px;align-items:start">
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">版本覆盖</div>${sourceTag('opgg')}</div>
          <div class="fw-6 fs-16 mb-2">当前 ${esc(t.currentPatch || '—')}</div>
          <div class="fs-12 text-3 mb-3">${esc(t.region)} · ${esc(t.tierFilter)} · ${total} 条位置统计</div>
          ${t.patches.map(p => `<div class="flex items-center justify-between fs-12 mb-1"><span class="badge ${p.patch === t.currentPatch ? 'teal' : 'gray'}">${esc(p.patch)}</span><span class="text-3">${p.rows} 条 · ${p.samples || 0} 样本</span></div>`).join('')}
          ${t.note ? `<div class="badge amber mt-2" style="white-space:normal;line-height:1.6">${esc(t.note)}</div>` : '<div class="badge green mt-2">已积累多版本数据，可对比趋势</div>'}
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">强度分布</div>${sourceTag('opgg')}</div>
          ${[1, 2, 3, 4, 5].map(k => hbar(tierNames[k] + ' ' + (t.byTier[k] || 0), (t.byTier[k] || 0) / total * 100, 100, { color: tierColors[k], suffix: '%' })).join('')}
        </div>
      </div>
      <div class="flex-col gap-4">
        <div class="grid grid-2">
          <div class="panel"><div class="panel-h"><div class="panel-title">胜率最高</div>${sourceTag('opgg')}</div>${rowList(t.topWin, 'winRate')}</div>
          <div class="panel"><div class="panel-h"><div class="panel-title">登场最高</div>${sourceTag('opgg')}</div>${rowList(t.topPick, 'pickRate')}</div>
        </div>
        <div class="panel"><div class="panel-h"><div class="panel-title">禁用最高（版本威胁）</div>${sourceTag('opgg')}</div>${rowList(t.topBan, 'banRate')}</div>
        <div class="panel tight"><div class="fs-12 text-3" style="line-height:1.8">所有榜单仅统计样本 ≥200 场的真实数据；点击英雄进入详情。不同服务器/段位/位置的数据不混合：当前筛选 ${esc(t.region)} · ${esc(t.tierFilter)}。</div></div>
      </div>
    </div>`;
  body.querySelectorAll('[data-key]').forEach(r => r.addEventListener('click', () => navigate('detail', { key: r.dataset.key, position: r.dataset.pos || undefined })));
}