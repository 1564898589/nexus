// NEXUS unified AI report render engine.
// Structured JSON reports (preferred) + safe Markdown fallback + rule fallback.
// Shared spec, per-module layout variants. Charts only from real local data.
import { icon } from './icons.js';
import { esc, fmtTime, toast, modal, confirmDialog, pct } from './util.js';
import { sparkline, hbar, gauge, radar } from './charts.js';
import { renderMarkdown } from './markdown.js';

const SEV = { high: { cn: '严重', cls: 'red' }, medium: { cn: '中等', cls: 'amber' }, low: { cn: '轻微', cls: 'blue' } };
const IMP = { high: { cn: '高', cls: 'red' }, medium: { cn: '中', cls: 'amber' }, low: { cn: '低', cls: 'gray' } };
const HORIZONS = [
  { k: 'now', cn: '立即改进', ic: 'bolt', cls: 'gold' },
  { k: 'short', cn: '短期训练', ic: 'target', cls: 'teal' },
  { k: 'long', cn: '长期提升', ic: 'arrowUp', cls: 'blue' },
];
const last = {}; // id -> last result (for regenerate / toolbar)

export function reportBlock(id, opts = {}) {
  return `<div class="panel rp-panel mt-3" id="${id}">
    <div class="panel-h">
      <div class="panel-title">${icon('cpu', 16, 'text-teal')} ${esc(opts.title || 'AI 战术分析')} <span class="badge gray">可选</span></div>
      <div class="rp-tools" data-rp-tools style="display:none">
        <button class="btn ghost sm" data-rp-copy title="复制报告文本">${icon('copy', 13)} 复制</button>
        <button class="btn ghost sm" data-rp-md title="导出 Markdown 文件">${icon('download', 13)} MD</button>
        <button class="btn ghost sm" data-rp-html title="导出 HTML 文件">${icon('download', 13)} HTML</button>
        <button class="btn ghost sm" data-rp-history title="历史报告与对比">${icon('clock', 13)} 历史</button>
        <button class="btn ghost sm" data-rp-regen title="重新生成">${icon('sync', 13)} 重新生成</button>
      </div>
    </div>
    <div class="fs-12 text-3 mb-2" data-rp-hint>${esc(opts.hint || '基于上方真实数据生成结构化报告；未配置模型或调用失败时显示本地规则分析并明确标注，不会冒充 AI。')}</div>
    <button class="btn primary sm" data-report-run="${id}">${icon('spark', 14)} 生成 AI 报告</button>
    <div data-report-out class="mt-3"></div>
  </div>`;
}

export function bindReport(root, id, task, payloadFn, opts = {}) {
  const panel = root.querySelector('#' + id);
  if (!panel) return;
  const out = panel.querySelector('[data-report-out]');
  const runBtn = panel.querySelector(`[data-report-run="${id}"]`);
  const tools = panel.querySelector('[data-rp-tools]');
  out.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ext]');
    if (a) { e.preventDefault(); window.nexus.shell.open(a.getAttribute('data-ext')); }
  });
  async function run() {
    runBtn.style.display = 'none';
    tools.style.display = 'none';
    out.innerHTML = `<div class="rp-loading">
      <div class="skeleton" style="height:52px"></div>
      <div class="grid grid-3 gap-2 mt-2"><div class="skeleton" style="height:74px"></div><div class="skeleton" style="height:74px"></div><div class="skeleton" style="height:74px"></div></div>
      <div class="skeleton mt-2" style="height:110px"></div>
      <div class="fs-12 text-3 mt-2" data-rp-phase>${icon('sync', 13)} 正在调用模型…（结构化报告约需 10–40 秒）</div>
    </div>`;
    let res;
    try {
      const base = payloadFn() || {};
      const payload = { ...base, variant: opts.variant || task, subject: opts.subject || base.subject || 'global', dataRange: opts.dataRange || base.dataRange || null };
      res = await window.nexus.ai.report(task, payload);
    } catch (e) { res = { __error: String(e.message || e) }; }
    const phase = out.querySelector('[data-rp-phase]');
    if (phase) phase.innerHTML = icon('check', 13) + ' 解析报告中…';
    if (res && res.__error) {
      out.innerHTML = `<div class="rp-error">${icon('warn', 16, 'text-red')} 生成失败：${esc(res.__error)}<div class="mt-2"><button class="btn primary sm" data-rp-retry>${icon('sync', 13)} 重试</button></div></div>`;
      out.querySelector('[data-rp-retry]').addEventListener('click', run);
      runBtn.style.display = '';
      return;
    }
    if (res.fallback) {
      renderRules(out, res.rules, res.reason);
      runBtn.style.display = '';
      runBtn.innerHTML = icon('sync', 14) + ' 重试 AI 报告';
      last[id] = null;
      return;
    }
    last[id] = res;
    const charts = typeof opts.charts === 'function' ? opts.charts() : opts.charts;
    renderReport(out, res, { ...opts, charts });
    runBtn.style.display = 'none';
    if (res.id) {
      tools.style.display = '';
      panel.querySelector('[data-rp-copy]').onclick = async () => {
        try {
          const t = await window.nexus.ai.reportText(res.id);
          await window.nexus.clip.write(t && t.md || '');
          toast('报告已复制到剪贴板', 'success');
        } catch (e) { toast('复制失败：' + String(e.message || e), 'error'); }
      };
      const doExport = async (fmt) => {
        const r = await window.nexus.ai.exportReport(res.id, fmt);
        if (r && r.ok) toast('已导出 ' + r.file, 'success', 5000);
        else if (r && r.error) toast(r.error, 'error');
      };
      panel.querySelector('[data-rp-md]').onclick = () => doExport('md');
      panel.querySelector('[data-rp-html]').onclick = () => doExport('html');
      panel.querySelector('[data-rp-history]').onclick = () => openHistory(task, opts.subject || 'global', opts);
    }
    panel.querySelector('[data-rp-regen]').onclick = run;
  }
  runBtn.addEventListener('click', run);
  if (opts.autoRun) run();
}

// ---- structured report ----
export function renderReport(out, res, opts = {}) {
  const structured = res.mode === 'structured' && res.report;
  const title = structured ? res.report.report_title : (opts.title || 'AI 分析报告');
  const head = `<div class="rp-head">
    <div class="rp-title">${esc(title)}</div>
    <div class="rp-meta">
      ${opts.subjectName ? `<span class="rp-chip">${icon('champion', 12)} ${esc(opts.subjectName)}</span>` : ''}
      ${res.dataRange ? `<span class="rp-chip">${icon('chart', 12)} 数据范围 ${esc(res.dataRange)}</span>` : ''}
      ${res.context && res.context.memoryCount ? `<span class="rp-chip" title="本次分析回灌了历史报告结论与训练进度，保持连续性、不重复建议">${icon('book', 12)} 记忆 ${res.context.memoryCount} 条历史结论</span>` : ''}
      <span class="rp-chip model">${icon('cpu', 12)} AI · ${esc(res.model || '未知模型')}${res.backup ? '（备用服务商）' : ''}</span>
      <span class="rp-chip">${icon('clock', 12)} ${res.createdAt ? fmtTime(res.createdAt) : ''}</span>
      <span class="badge ${structured ? 'teal' : 'amber'}">${structured ? '结构化报告' : 'Markdown 兼容模式'}</span>
    </div>
    ${res.parseNote ? `<div class="fs-12 text-3 mt-1">${esc(res.parseNote)} · 原文完整保留，未丢失内容。</div>` : ''}
  </div>`;

  const charts = chartsHtml(opts.charts);
  if (!structured) {
    out.innerHTML = head + (charts ? sec('charts', '真实数据图表', 'chart', null, charts) : '') +
      `<div class="md-body mt-3">${renderMarkdown(res.content || '')}</div>`;
    bindToc(out);
    return;
  }
  const r = res.report;
  const es = r.executive_summary || {};
  const summary = (es.overall || es.biggest_strength || es.biggest_issue || es.priority_direction) ? `
    ${es.overall ? `<p class="rp-overall">${esc(es.overall)}</p>` : ''}
    <div class="grid grid-3 gap-2">
      ${miniCard('优势', es.biggest_strength, 'arrowUp', 'green')}
      ${miniCard('问题', es.biggest_issue, 'warn', 'red')}
      ${miniCard('优先方向', es.priority_direction, 'target', 'teal')}
    </div>` : '';
  const metrics = r.key_metrics && r.key_metrics.length ? `<div class="rp-metrics">${r.key_metrics.map(metricCard).join('')}</div>` : '';
  const facts = r.facts && r.facts.length ? r.facts.map(f => {
    const imp = IMP[f.importance] || IMP.medium;
    return `<div class="rp-fact imp-${f.importance || 'medium'}">
      <div class="flex items-center gap-2"><span class="badge ${imp.cls}" style="font-size:11px">重要度 ${imp.cn}</span>${f.title ? `<b class="fs-13">${esc(f.title)}</b>` : ''}${f.confidence != null ? `<span class="fs-12 text-3">可信度 ${Math.round(f.confidence * 100)}%</span>` : ''}</div>
      <div class="fs-13 text-2 mt-1" style="line-height:1.7">${esc(f.content)}</div>
      ${f.basis ? `<div class="rp-basis">${icon('chart', 11)} 数据依据：${esc(f.basis)}</div>` : ''}
    </div>`;
  }).join('') : '';
  const diagnoses = r.diagnoses && r.diagnoses.length ? r.diagnoses.map(d => {
    const sv = SEV[d.severity] || SEV.medium;
    return `<div class="rp-diag sev-${d.severity || 'medium'}">
      <div class="flex items-center gap-2" style="flex-wrap:wrap"><b class="fs-13">${esc(d.title || '问题')}</b><span class="badge ${sv.cls}">${sv.cn}</span>
        ${d.confidence != null ? `<span class="rp-conf"><span class="rp-conf-track"><span class="rp-conf-fill" style="width:${Math.round(d.confidence * 100)}%"></span></span><span class="fs-12 text-3">可信度 ${Math.round(d.confidence * 100)}%</span></span>` : ''}</div>
      ${d.basis ? `<div class="rp-diag-row"><span class="rp-diag-label">依据</span><span>${esc(d.basis)}</span></div>` : ''}
      ${d.cause ? `<div class="rp-diag-row"><span class="rp-diag-label">原因</span><span>${esc(d.cause)}</span></div>` : ''}
      ${d.impact ? `<div class="rp-diag-row"><span class="rp-diag-label">影响</span><span>${esc(d.impact)}</span></div>` : ''}
    </div>`;
  }).join('') : '';
  const recs = r.recommendations && r.recommendations.length ? HORIZONS.map(h => {
    const items = r.recommendations.filter(x => x.horizon === h.k);
    if (!items.length) return '';
    return `<div class="rp-horizon">
      <div class="rp-horizon-title ${h.cls}">${icon(h.ic, 14)} ${h.cn} <span class="badge gray">${items.length}</span></div>
      ${items.map(x => `<div class="rp-rec">
        <b class="fs-13">${esc(x.title || x.action)}</b>
        ${x.title && x.action ? `<div class="fs-13 text-2 mt-1" style="line-height:1.7">${esc(x.action)}</div>` : ''}
        ${x.steps && x.steps.length ? `<ol class="rp-steps">${x.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
        ${x.expected_effect ? `<div class="rp-effect">${icon('check', 11)} 预期效果：${esc(x.expected_effect)}</div>` : ''}
      </div>`).join('')}
    </div>`;
  }).join('') : '';
  const training = r.training_plan && r.training_plan.length ? trainingHtml(r.training_plan, res.id) : '';
  const risks = r.risk_assessment && r.risk_assessment.length ? `<div class="flex-col gap-1">${r.risk_assessment.map(x => `<div class="flex gap-2 fs-13 text-2">${icon('warn', 13, 'text-gold')}<span style="line-height:1.7">${esc(x)}</span></div>`).join('')}</div>` : '';
  const limits = r.data_limitations && r.data_limitations.length ? `<div class="flex-col gap-1">${r.data_limitations.map(x => `<div class="flex gap-2 fs-13 text-3">${icon('info', 13)}<span style="line-height:1.7">${esc(x)}</span></div>`).join('')}</div>` : '';
  const coach = r.coach_summary ? `<div class="rp-coach">${icon('spark', 18, 'text-teal')}<div style="flex:1;min-width:0"><div class="rp-coach-label">教练总结</div><div class="fs-13 text-2" style="line-height:1.85">${esc(r.coach_summary)}</div></div></div>` : '';
  const strengths = r.strengths && r.strengths.length ? `<div class="flex-col gap-2">${r.strengths.map(s => `<div class="rp-strength">
    <div class="flex items-center gap-2">${icon('arrowUp', 14, 'text-green')}<b class="fs-13">${esc(s.title || '优势')}</b></div>
    <div class="fs-13 text-2 mt-1" style="line-height:1.7">${esc(s.content)}</div>
    ${s.basis ? `<div class="rp-basis">${icon('chart', 11)} 数据依据：${esc(s.basis)}</div>` : ''}
    ${s.leverage ? `<div class="rp-leverage">${icon('target', 11)} 扩大优势：${esc(s.leverage)}</div>` : ''}
  </div>`).join('')}</div>` : '';
  const inferences = r.inferences && r.inferences.length ? `<div class="flex-col gap-2">${r.inferences.map(x => `<div class="rp-infer">
    <div class="flex items-center gap-2" style="flex-wrap:wrap"><span class="badge amber" style="font-size:11px">推断</span><b class="fs-13">${esc(x.title || '深度推断')}</b>
      ${x.confidence != null ? `<span class="rp-conf"><span class="rp-conf-track"><span class="rp-conf-fill" style="width:${Math.round(x.confidence * 100)}%"></span></span><span class="fs-12 text-3">可信度 ${Math.round(x.confidence * 100)}%</span></span>` : ''}</div>
    <div class="fs-13 text-2 mt-1" style="line-height:1.7">${esc(x.content)}</div>
    ${x.basis ? `<div class="rp-diag-row"><span class="rp-diag-label">现象</span><span>${esc(x.basis)}</span></div>` : ''}
    ${x.reasoning ? `<div class="rp-diag-row"><span class="rp-diag-label">推理</span><span>${esc(x.reasoning)}</span></div>` : ''}
    ${x.alternative ? `<div class="rp-diag-row"><span class="rp-diag-label">其他可能</span><span class="text-3">${esc(x.alternative)}</span></div>` : ''}
  </div>`).join('')}</div>` : '';
  const warnings = r.risk_warnings && r.risk_warnings.length ? `<div class="flex-col gap-2">${r.risk_warnings.map(w => { const sv = SEV[w.severity] || SEV.medium; return `<div class="rp-diag sev-${w.severity || 'medium'}">
    <div class="flex items-center gap-2" style="flex-wrap:wrap">${icon('warn', 14, 'text-gold')}<b class="fs-13">${esc(w.title || '风险')}</b><span class="badge ${sv.cls}">${sv.cn}</span></div>
    ${w.trigger ? `<div class="rp-diag-row"><span class="rp-diag-label">触发</span><span>${esc(w.trigger)}</span></div>` : ''}
    ${w.consequence ? `<div class="rp-diag-row"><span class="rp-diag-label">后果</span><span>${esc(w.consequence)}</span></div>` : ''}
    ${w.mitigation ? `<div class="rp-diag-row"><span class="rp-diag-label">规避</span><span>${esc(w.mitigation)}</span></div>` : ''}
  </div>`; }).join('')}</div>` : '';

  const risksInner = warnings || risks;
  const risksCount = (r.risk_warnings && r.risk_warnings.length) || (r.risk_assessment ? r.risk_assessment.length : 0);
  const secs = [
    sec('summary', '执行摘要', 'spark', null, summary + coach),
    sec('metrics', '关键指标', 'chart', r.key_metrics ? r.key_metrics.length : 0, metrics),
    charts ? sec('charts', '真实数据图表', 'chart', null, charts) : '',
    sec('facts', '事实（真实数据）', 'check', r.facts ? r.facts.length : 0, facts),
    sec('strengths', '优势分析', 'arrowUp', r.strengths ? r.strengths.length : 0, strengths),
    sec('diagnoses', '问题诊断', 'warn', r.diagnoses ? r.diagnoses.length : 0, diagnoses),
    sec('inferences', '深度推断', 'spark', r.inferences ? r.inferences.length : 0, inferences),
    sec('recs', '改进建议', 'target', r.recommendations ? r.recommendations.length : 0, recs),
    sec('training', '训练计划', 'book', r.training_plan ? r.training_plan.length : 0, training),
    sec('risks', warnings ? '风险预警' : '风险评估', 'shield', risksCount, risksInner, false),
    sec('limits', '数据局限', 'info', r.data_limitations ? r.data_limitations.length : 0, limits, false),
  ].filter(Boolean);
  const toc = secs.length > 2 ? `<div class="rp-toc">${tocChips(r, charts)}</div>` : '';
  out.innerHTML = head + toc + (secs.length ? secs.join('') : `<div class="empty-state">${icon('warn', 36)}<div class="es-title">模型未返回有效报告内容</div><div>请点击「重新生成」重试；原文不会丢失。</div></div>`);
  bindToc(out);
  bindTraining(out, res.id);
}

function tocChips(r, charts) {
  const items = [
    ['summary', '摘要', (r.executive_summary && r.executive_summary.overall)],
    ['metrics', '指标', r.key_metrics && r.key_metrics.length],
    ['charts', '图表', charts],
    ['facts', '事实', r.facts && r.facts.length],
    ['strengths', '优势', r.strengths && r.strengths.length],
    ['diagnoses', '诊断', r.diagnoses && r.diagnoses.length],
    ['inferences', '推断', r.inferences && r.inferences.length],
    ['recs', '建议', r.recommendations && r.recommendations.length],
    ['training', '训练', r.training_plan && r.training_plan.length],
    ['risks', '风险', (r.risk_warnings && r.risk_warnings.length) || (r.risk_assessment && r.risk_assessment.length)],
    ['limits', '局限', r.data_limitations && r.data_limitations.length],
  ];
  return items.filter(x => x[2]).map(x => `<button class="rp-toc-chip" data-goto="${x[0]}">${x[1]}</button>`).join('');
}
function bindToc(out) {
  out.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    const d = out.querySelector(`details[data-sec="${b.dataset.goto}"]`);
    if (d) { d.open = true; d.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }));
}

function sec(key, title, ic, count, inner, open = true) {
  if (!inner) return '';
  return `<details class="rp-sec" data-sec="${key}" ${open ? 'open' : ''}>
    <summary>${icon(ic, 14)} <span>${title}</span>${count ? ` <span class="badge gray">${count}</span>` : ''}${icon('chevronDown', 13, 'rp-chev')}</summary>
    <div class="rp-sec-body">${inner}</div>
  </details>`;
}
function miniCard(label, text, ic, cls) {
  if (!text) return `<div class="rp-mini empty"><div class="rp-mini-label">${label}</div><div class="fs-12 text-3">未提供</div></div>`;
  return `<div class="rp-mini ${cls}"><div class="rp-mini-label">${icon(ic, 12)} ${label}</div><div class="fs-12 text-2" style="line-height:1.6">${esc(text)}</div></div>`;
}
function metricCard(m) {
  const numVal = parseFloat(String(m.value).replace(/[%,，\s]/g, ''));
  const isPct = /%|胜率/.test(m.value + m.label) && Number.isFinite(numVal) && numVal <= 100;
  const trend = m.trend ? `<span class="rp-trend ${m.good === true ? 'good' : m.good === false ? 'bad' : ''}">${m.trend === 'up' ? '▲' : m.trend === 'down' ? '▼' : '◆'} ${m.trend === 'up' ? '上升' : m.trend === 'down' ? '下降' : '持平'}</span>` : '';
  const visual = isPct
    ? `<div class="rp-ring" style="--p:${Math.max(0, Math.min(100, numVal))}"><span class="num">${esc(m.value)}</span></div>`
    : `<div class="rp-big num">${esc(m.value)}<span class="rp-unit">${esc(m.unit || '')}</span></div>`;
  return `<div class="rp-metric">
    <div class="rp-metric-label">${esc(m.label)} ${trend}</div>
    ${visual}
    ${m.compare ? `<div class="fs-12 text-3 mt-1">对比：${esc(m.compare)}</div>` : ''}
    ${m.basis ? `<div class="rp-basis">${esc(m.basis)}</div>` : ''}
  </div>`;
}

// ---- real-data charts (never fabricated; each block only when data exists) ----
function chartsHtml(c) {
  if (!c) return '';
  const boxes = [];
  const box = (title, inner, note) => boxes.push(`<div class="rp-chart-box"><div class="rp-chart-title">${title} <span class="badge teal" style="font-size:11px">真实数据</span></div>${inner}${note ? `<div class="fs-12 text-3 mt-1">${note}</div>` : ''}</div>`);
  if (c.winSeries && c.winSeries.length) {
    const wr = c.winSeries.filter(Boolean).length / c.winSeries.length;
    box(`胜负走势（旧 → 新 · ${c.winSeries.length} 场）`, `<div class="flex gap-1" style="flex-wrap:wrap">${c.winSeries.map(w => `<span class="rp-wl" style="background:${w ? 'var(--green)' : 'var(--red)'}" title="${w ? '胜' : '负'}"></span>`).join('')}</div><div class="fs-12 text-3 mt-1">区间胜率 ${pct(wr)}</div>`);
  }
  if (c.kdaSeries && c.kdaSeries.length >= 2) box('KDA 走势', sparkline(c.kdaSeries, { width: 300, height: 56, color: '#C8AA6E' }), `最低 ${Math.min(...c.kdaSeries).toFixed(1)} · 最高 ${Math.max(...c.kdaSeries).toFixed(1)}`);
  if (c.recent) {
    let inner = hbar('近期胜率 ' + pct(c.recent.winRate), c.recent.winRate * 100, 100, { color: 'var(--teal)', suffix: '%' });
    if (c.older) inner += hbar('此前胜率 ' + pct(c.older.winRate), c.older.winRate * 100, 100, { color: 'var(--blue)', suffix: '%' });
    inner += hbar('近期 KDA ' + c.recent.kda.toFixed(2), Math.min(100, c.recent.kda * 15), 100, { color: 'var(--gold)' });
    if (c.older) inner += hbar('此前 KDA ' + c.older.kda.toFixed(2), Math.min(100, c.older.kda * 15), 100, { color: 'var(--purple)' });
    box('近期 vs 此前', inner, `近期 ${c.recent.games} 场${c.older ? ' · 此前 ' + c.older.games + ' 场' : ''} · KDA 条为示意刻度（×15）`);
  }
  if (c.match && c.match.length) {
    const inner = c.match.map(x => hbar(x.label + ' ' + x.value, Math.min(100, x.pct != null ? x.pct : 50), 100, { color: 'var(--teal)' }) + (x.baseline != null ? `<div class="fs-12 text-3" style="margin:-4px 0 6px">个人基准 ${x.baseline}</div>` : '')).join('');
    box('本场 vs 个人基准', inner, c.matchNote || '基准来自缓存真实对局；样本不足时不显示基准。');
  }
  if (c.pool && c.pool.length) box('英雄池（场次）', c.pool.slice(0, 6).map(p => hbar(`${p.name} · ${pct(p.winRate)}`, p.games, Math.max(...c.pool.map(x => x.games)), { color: p.winRate >= 0.55 ? 'var(--green)' : 'var(--blue)', suffix: '场' })).join(''));
  if (c.diffs && c.diffs.length) box('两服胜率差（Top ' + Math.min(6, c.diffs.length) + '）', c.diffs.slice(0, 6).map(d => `<div class="mb-2"><div class="fs-12 text-2 mb-1">${esc(d.label)}</div>${hbar('韩服 ' + pct(d.kr), d.kr * 100, 100, { color: 'var(--teal)', suffix: '%' })}${hbar('国服 ' + pct(d.cn), d.cn * 100, 100, { color: 'var(--gold)', suffix: '%' })}</div>`).join(''), '两服口径独立，未混合计算。');
  if (c.radar && c.radar.scores && c.radar.dims && c.radar.dims.length >= 3) box('能力雷达', radar(c.radar.scores, c.radar.dims, { size: 260, compare: c.radar.compare || null }), c.radar.note || '');
  return boxes.length ? `<div class="rp-charts">${boxes.join('')}</div>` : '';
}

// ---- training plan with real user progress ----
function trainingHtml(plan, reportId) {
  return `<div class="rp-training" data-training="${reportId || ''}">
    <div class="flex items-center gap-3 mb-2"><div class="rp-ring sm" data-train-ring style="--p:0"><span class="num" data-train-pct>0%</span></div><div class="fs-12 text-3">勾选完成项记录真实训练进度（保存在本机）。</div></div>
    ${plan.map((t, i) => `<label class="rp-train-item">
      <input type="checkbox" data-train-i="${i}"/>
      <div style="flex:1;min-width:0">
        <b class="fs-13">${esc(t.goal || '训练 ' + (i + 1))}</b>
        <div class="fs-13 text-2 mt-1" style="line-height:1.7">${esc(t.content)}</div>
        ${t.completion_criteria ? `<div class="fs-12 text-3 mt-1">完成标准：${esc(t.completion_criteria)}</div>` : ''}
        ${t.metric ? `<div class="fs-12 text-3">评估指标：${esc(t.metric)}</div>` : ''}
      </div>
    </label>`).join('')}
  </div>`;
}
function bindTraining(out, reportId) {
  const wrap = out.querySelector('[data-training]');
  if (!wrap || !reportId) return;
  const key = 'rpTrain:' + reportId;
  let touched = false;
  window.nexus.config.get().then(cfg => {
    if (touched) { updateRing(wrap); return; }
    const checked = (cfg && cfg[key]) || [];
    wrap.querySelectorAll('[data-train-i]').forEach(cb => { cb.checked = checked.includes(+cb.dataset.trainI); });
    updateRing(wrap);
  }).catch(() => {});
  wrap.addEventListener('change', async (e) => {
    const cb = e.target.closest('[data-train-i]');
    if (!cb) return;
    touched = true;
    const all = [...wrap.querySelectorAll('[data-train-i]')].filter(x => x.checked).map(x => +x.dataset.trainI);
    try { await window.nexus.config.set(key, all); } catch {}
    updateRing(wrap);
  });
}
function updateRing(wrap) {
  const boxes = [...wrap.querySelectorAll('[data-train-i]')];
  const p = boxes.length ? Math.round(boxes.filter(x => x.checked).length / boxes.length * 100) : 0;
  const ring = wrap.querySelector('[data-train-ring]');
  if (ring) { ring.style.setProperty('--p', p); ring.querySelector('[data-train-pct]').textContent = p + '%'; }
}

// ---- rule fallback (clearly flagged, never impersonates AI) ----
export function renderRules(out, rules, reason) {
  const tag = (title, items, cls, label) => items && items.length ? `<div class="mb-3"><div class="section-title" style="font-size:13px">${title}</div><div class="fs-12 text-2" style="line-height:1.9">${items.map(t => `<div class="flex gap-2"><span class="badge ${cls}" style="font-size:11px;flex-shrink:0;margin-top:2px">${label}</span><span>${esc(t)}</span></div>`).join('')}</div></div>` : '';
  out.innerHTML = `<div class="badge amber mb-2">规则分析（AI 不可用：${esc(reason || '未配置模型')}）</div>
    ${rules ? tag('事实（真实数据）', rules.facts, 'green', '事实') + tag('推断（基于数据的推理）', rules.inferences, 'amber', '推断') + tag('建议（可执行）', rules.advice, 'teal', '建议') : '<div class="fs-13 text-3">数据不足，暂无规则结论。</div>'}
    <div class="fs-12 text-3 mt-2">配置模型后可点击「重试 AI 报告」生成完整结构化报告。</div>`;
}

// ---- history & compare ----
async function openHistory(task, subject, opts) {
  const list = await window.nexus.ai.reports(task, subject, 20).catch(() => []);
  const body = document.createElement('div');
  const draw = async () => {
    const items = await window.nexus.ai.reports(task, subject, 20).catch(() => []);
    if (!items.length) { body.innerHTML = '<div class="empty-state">' + icon('clock', 36) + '<div class="es-title">暂无历史报告</div><div>同一账号/主题生成报告后会自动存档于此。</div></div>'; return; }
    body.innerHTML = `<div class="flex-col gap-2">${items.map(it => `<div class="flex items-center gap-2" style="padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-md)">
      <div style="flex:1;min-width:0"><div class="fw-6 fs-13 truncate">${esc(it.title)}</div><div class="fs-12 text-3">${fmtTime(it.createdAt)} · ${esc(it.model || '')} · ${it.mode === 'structured' ? '结构化' : 'Markdown'}</div></div>
      <button class="btn ghost sm" data-open="${it.id}">打开</button>
      <button class="btn danger sm icon" data-del="${it.id}">${icon('trash', 13)}</button>
    </div>`).join('')}</div>
    ${items.length >= 2 ? `<button class="btn primary sm mt-3" data-cmp>${icon('compare', 14)} 对比最近两份报告</button>` : ''}`;
    body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
      const r = await window.nexus.ai.reportGet(+b.dataset.open);
      if (!r) return;
      const m2 = modal({ title: '历史报告 · ' + r.title, body: '<div class="skeleton" style="height:200px"></div>', wide: true });
      const charts = typeof opts.charts === 'function' ? opts.charts() : opts.charts;
      renderReport(m2.body, { mode: r.mode, report: r.report, content: r.content, model: r.model, backup: r.meta && r.meta.backup, createdAt: r.createdAt, dataRange: r.meta && r.meta.dataRange, context: r.meta && r.meta.context, id: r.id }, { ...opts, charts });
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (await confirmDialog({ title: '删除报告', message: '确定删除这份历史报告？', danger: true, confirmText: '删除' })) { await window.nexus.ai.reportDelete(+b.dataset.del); draw(); }
    }));
    const cmp = body.querySelector('[data-cmp]');
    if (cmp) cmp.addEventListener('click', async () => {
      const [a, b] = await Promise.all([window.nexus.ai.reportGet(items[0].id), window.nexus.ai.reportGet(items[1].id)]);
      const m2 = modal({ title: '报告对比', body: compareHtml(a, b), wide: true });
    });
  };
  await draw();
  modal({ title: '历史报告 · ' + (opts.subjectName || subject), body, wide: true });
}

function compareHtml(a, b) {
  const col = (r) => {
    if (!r) return '<div class="text-3">报告不存在</div>';
    const rep = r.report;
    const es = rep && rep.executive_summary || {};
    return `<div class="rp-cmp-col">
      <div class="fw-6 fs-13">${esc(r.title)}</div>
      <div class="fs-12 text-3 mb-2">${fmtTime(r.createdAt)} · ${esc(r.model || '')}</div>
      ${r.mode === 'structured' ? `
        ${es.overall ? `<p class="fs-12 text-2" style="line-height:1.7">${esc(es.overall)}</p>` : ''}
        ${rep.key_metrics && rep.key_metrics.length ? `<table class="nx-table mt-2"><thead><tr><th>指标</th><th>数值</th><th>对比</th></tr></thead><tbody>${rep.key_metrics.map(m => `<tr><td class="fs-12">${esc(m.label)}</td><td class="num fs-12">${esc(m.value)}${esc(m.unit || '')}</td><td class="fs-12 text-3">${esc(m.compare || '—')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${rep.diagnoses && rep.diagnoses.length ? `<div class="fs-12 text-3 mt-2">诊断：${rep.diagnoses.map(d => esc(d.title)).join('、')}</div>` : ''}
        ${rep.recommendations ? `<div class="fs-12 text-3 mt-1">建议 ${rep.recommendations.length} 条 · 训练 ${rep.training_plan ? rep.training_plan.length : 0} 项</div>` : ''}
      ` : `<div class="md-body fs-12">${renderMarkdown((r.content || '').slice(0, 1200))}</div>`}
    </div>`;
  };
  return `<div class="rp-cmp">${col(a)}${col(b)}</div>`;
}

// Debug/test hook (renderer-side unit access).
window.__reportUI = { renderMarkdown, renderReport, renderRules, reportBlock, bindReport, chartsHtml };