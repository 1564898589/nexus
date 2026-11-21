// 韩服国服对比 — 双服真实统计并排（各自版本/样本/来源），差异高亮 + 可选 AI 解释。
import { icon } from '../icons.js';
import { el, esc, pct, fx, num, asset, toast, timeAgo, sourceTag, POSITIONS, POS_CN, TIER_FILTERS } from '../util.js';
import { store, navigate, getChamp } from '../store.js';
import { aiBlock, bindAi } from './intel-common.js';

let opts = { position: 'all', search: '', tier: store.filter.tierFilter || 'emerald_plus' };
const tierLabel = () => { const t = TIER_FILTERS.find(x => x.v === opts.tier); return t ? t.l : opts.tier; };

export async function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('compare', 26, 'accent')} 韩服国服对比 <span class="accent">CROSS-REGION</span></div>
      <div class="page-sub">两服数据各自独立采集与标注 · 不混合计算 · 差异仅描述事实，解释由 AI 可选生成并标记</div>
    </div>
    <div class="panel tight mb-4">
      <div class="flex items-center justify-between gap-3" style="flex-wrap:wrap">
        <div class="chip-row" id="pos-chips">${['all', ...POSITIONS].map(p => `<button class="chip${opts.position === p ? ' active' : ''}" data-pos="${p}">${p === 'all' ? '全部' : POS_CN[p]}</button>`).join('')}</div>
        <div class="flex items-center gap-3">
          <div class="top-select"><label>段位口径</label><select class="nx-select" id="cmp-tier">${TIER_FILTERS.map(t => `<option value="${t.v}" ${t.v === opts.tier ? 'selected' : ''}>${t.l}</option>`).join('')}</select></div>
          <div class="search-box" style="width:200px">${icon('search', 16)}<input id="cmp-search" placeholder="筛选英雄…" value="${esc(opts.search)}"/></div>
        </div>
      </div>
    </div>
    <div id="cmp-head" class="grid grid-2 gap-3 mb-4"></div>
    <div class="panel" style="padding:8px 8px 0">
      <div style="overflow-x:auto">
        <table class="nx-table" id="cmp-table">
          <thead><tr><th>英雄</th><th>位置</th><th>KR 胜率</th><th>CN 胜率</th><th>胜率差</th><th>KR 登场</th><th>CN 登场</th><th>KR 梯队</th><th>CN 梯队</th><th>KR 样本</th><th>CN 样本</th></tr></thead>
          <tbody id="cmp-body"></tbody>
        </table>
      </div>
    </div>
    ${aiBlock('compare-ai', { title: 'AI 差异解读', hint: '仅基于上表两服真实统计；数据不足时 AI 会明确说明。结构化报告 + 真实数据图表。' })}
  `;

  let data = null;
  async function load() {
    const head = root.querySelector('#cmp-head');
    const body = root.querySelector('#cmp-body');
    head.innerHTML = '<div class="panel"><div class="skeleton" style="height:64px"></div></div><div class="panel"><div class="skeleton" style="height:64px"></div></div>';
    body.innerHTML = '<tr><td colspan="11"><div class="skeleton" style="height:220px"></div></td></tr>';
    try {
    data = await window.nexus.data.compare({ position: opts.position, tierFilter: opts.tier });
    if (!data || data.__error) throw new Error((data && data.__error) || '接口返回异常');
    head.innerHTML = [['kr', data.kr, 'OP.GG 韩服'], ['cn', data.cn, '国服 101 官方']].map(([r, d, label]) => `
      <div class="panel">
        <div class="panel-h"><div class="panel-title">${label}</div>${sourceTag(r === 'cn' ? 'cn101' : 'opgg')}</div>
        ${d.patch ? `<div class="fs-12 text-3">版本 <b class="num text-2">${esc(d.patch)}</b> · ${d.rows.length} 条统计 · 采集 ${timeAgo(d.rows[0] && d.rows[0].fetchedAt)}${r === 'cn' ? ' · 样本量官方未提供（未知）' : ''}</div>`
          : `<div class="fs-12 text-gold">该服暂无数据：请先在顶栏切换服务器并更新。不会用另一服数据顶替。</div>`}
      </div>`).join('');
    const krMap = {}; for (const r of data.kr.rows) krMap[r.championKey + '|' + r.position] = r;
    const cnMap = {}; for (const r of data.cn.rows) cnMap[r.championKey + '|' + r.position] = r;
    const keys = [...new Set([...Object.keys(krMap), ...Object.keys(cnMap)])];
    let rows = keys.map(k => ({ k, kr: krMap[k], cn: cnMap[k] }));
    if (opts.search) {
      const q = opts.search.toLowerCase();
      rows = rows.filter(x => { const c = (x.kr || x.cn).champion || {}; return (c.nameCn || '').toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q) || x.k.includes(q); });
    }
    rows.sort((a, b) => {
      const da = a.kr && a.cn ? Math.abs(a.kr.winRate - a.cn.winRate) : -1;
      const db2 = b.kr && b.cn ? Math.abs(b.kr.winRate - b.cn.winRate) : -1;
      return db2 - da;
    });
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="11"><div class="empty-state">${icon('compare', 44)}<div class="es-title">暂无可对比数据</div><div>需要两服都有数据才能对比；单服缺失时该行只展示存在的一侧。可在顶栏切换服务器并更新数据。</div></div></td></tr>`;
      return;
    }
    body.innerHTML = rows.slice(0, 120).map(x => {
      const c = (x.kr || x.cn).champion || getChamp(x.k.split('|')[0]) || {};
      const diff = x.kr && x.cn ? x.cn.winRate - x.kr.winRate : null;
      return `<tr>
        <td><div class="champ-cell"><img src="${asset(c.imageUrl)}" alt=""/><div><div class="champ-name">${esc(c.nameCn || x.k.split('|')[0])}</div></div></div></td>
        <td class="fs-12 text-3">${POS_CN[x.k.split('|')[1]] || x.k.split('|')[1]}</td>
        <td class="num">${x.kr ? pct(x.kr.winRate) : '<span class="text-3">—</span>'}</td>
        <td class="num">${x.cn ? pct(x.cn.winRate) : '<span class="text-3">—</span>'}</td>
        <td class="num ${diff == null ? 'text-3' : Math.abs(diff) >= 0.02 ? (diff > 0 ? 'text-teal' : 'text-red') : ''}">${diff == null ? '—' : (diff > 0 ? '+' : '') + fx(diff * 100) + 'pp'}</td>
        <td class="num text-3">${x.kr ? pct(x.kr.pickRate) : '—'}</td>
        <td class="num text-3">${x.cn ? pct(x.cn.pickRate) : '—'}</td>
        <td class="num">${x.kr && x.kr.tier != null ? 'T' + x.kr.tier : '—'}</td>
        <td class="num">${x.cn && x.cn.tier != null ? 'T' + x.cn.tier : '—'}</td>
        <td class="num text-3">${x.kr && x.kr.sampleSize != null ? num(x.kr.sampleSize) : '—'}</td>
        <td class="num text-3">${x.cn ? '未知' : '—'}</td>
      </tr>`;
    }).join('');
    } catch (e) {
      data = null;
      head.innerHTML = '';
      body.innerHTML = `<tr><td colspan="11"><div class="empty-state">${icon('warn', 44)}<div class="es-title">对比数据加载失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary sm mt-3" id="cmp-retry">${icon('sync', 14)} 重试</button></div></td></tr>`;
      const rt = body.querySelector('#cmp-retry'); if (rt) rt.addEventListener('click', load);
    }
  }

  root.querySelectorAll('#pos-chips .chip').forEach(ch => ch.addEventListener('click', () => {
    opts.position = ch.dataset.pos;
    root.querySelectorAll('#pos-chips .chip').forEach(x => x.classList.toggle('active', x === ch));
    load();
  }));
  let t = null;
  root.querySelector('#cmp-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { opts.search = e.target.value.trim(); load(); }, 200); });
  root.querySelector('#cmp-tier').addEventListener('change', (e) => { opts.tier = e.target.value; load(); });
  const topDiffs = () => {
    if (!data) return [];
    return data.kr.rows.filter(k => data.cn.rows.some(c => c.championKey === k.championKey && c.position === k.position))
      .map(k => { const c = data.cn.rows.find(x => x.championKey === k.championKey && x.position === k.position); return { key: k.championKey, pos: k.position, krWr: k.winRate, cnWr: c.winRate, krPick: k.pickRate, cnPick: c.pickRate }; })
      .sort((a, b) => Math.abs(b.cnWr - b.krWr) - Math.abs(a.cnWr - a.krWr)).slice(0, 15);
  };
  bindAi(root, 'compare-ai', 'tactic', () => ({
    data: { krPatch: data && data.kr.patch, cnPatch: data && data.cn.patch, topDiffs: topDiffs(), note: `CN 样本量官方未提供；KR 为 OP.GG 韩服${tierLabel()}，CN 为 101 ${tierLabel()}；两服口径独立不混合` },
    subject: 'compare:' + opts.position,
    dataRange: data ? `KR ${data.kr.patch || '未知版本'} / CN ${data.cn.patch || '未知版本'} · ${tierLabel()} · 胜率差 Top15` : null,
    rules: { facts: ['胜率差≥2pp 的行已在表格高亮。', '两服版本/段位口径各自标注，未混合计算。'], inferences: [], advice: ['差异解读见 AI 报告；事实差异以表格为准。'] },
  }), {
    variant: 'compare', subjectName: '韩服 vs 国服',
    charts: () => ({ diffs: topDiffs().slice(0, 6).map(x => ({ label: ((getChamp(x.key) || {}).nameCn || x.key) + ' · ' + (POS_CN[x.pos] || x.pos), kr: x.krWr, cn: x.cnWr })) }),
  });
  await load();
  return {};
}