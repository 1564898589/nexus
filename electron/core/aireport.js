'use strict';
/**
 * NEXUS structured AI report contract: prompt builder + tolerant parser + serializers.
 * Additive layer over ai.chat — providers/routing/fallback untouched.
 * Parse NEVER throws: any format failure degrades to markdown mode (content preserved).
 */

const SCHEMA_SPEC = `{
  "report_title": "报告标题（简短专业）",
  "executive_summary": { "overall": "一段话总体结论（数据先行）", "biggest_strength": "最大优势", "biggest_issue": "最大问题", "priority_direction": "优先改进方向" },
  "key_metrics": [ { "label": "指标名", "value": "数值或文本", "unit": "单位(可空)", "compare": "对比基准描述(可空)", "trend": "up|down|flat(可空)", "good": true, "basis": "数据来源/口径" } ],
  "facts": [ { "title": "事实标题", "content": "具体内容", "basis": "数据依据(来自输入JSON的字段)", "importance": "high|medium|low", "confidence": 0.9 } ],
  "diagnoses": [ { "title": "问题名称", "severity": "high|medium|low", "basis": "数据依据", "cause": "可能原因(推断,注明不确定性)", "impact": "对胜负/表现的影响", "confidence": 0.6 } ],
  "recommendations": [ { "horizon": "now|short|long", "title": "建议标题", "action": "具体可执行做法", "steps": ["步骤1", "步骤2"], "expected_effect": "预期效果" } ],
  "inferences": [ { "title": "推断标题", "content": "推断结论", "basis": "观察到的数据现象", "reasoning": "从现象到结论的推理过程", "alternative": "其他可能解释(可空)", "confidence": 0.6 } ],
  "strengths": [ { "title": "优势标题", "content": "优势描述", "basis": "数据依据", "leverage": "如何扩大/利用该优势" } ],
  "coach_summary": "教练口吻的一段总结（肯定努力+点出核心瓶颈+下一步聚焦，白话不端着，可空）",
  "training_plan": [ { "goal": "训练目标", "content": "训练内容", "completion_criteria": "完成标准", "metric": "评估指标" } ],
  "risk_warnings": [ { "title": "风险标题", "severity": "high|medium|low", "trigger": "触发信号/条件", "consequence": "可能后果", "mitigation": "规避/缓解做法" } ],
  "risk_assessment": [ "风险点(字符串,兼容旧版)" ],
  "data_limitations": [ "数据局限与样本不足声明(字符串)" ]
}`;

const QUALITY_RULES = `内容质量铁律：
1. 数据先行：每个结论必须能追溯到输入 JSON 中的真实字段；输入没有的数据一律不得编造（胜率/经济/视野/敌方位置/操作细节等）。
2. 事实与推断严格分离：facts 只写输入数据直接支持的内容；因果解释放 diagnoses 并标 confidence；不得把相关当因果。
3. 不得无依据断言「操作失误」「意识差」等；只能基于数据描述现象并给出可能原因（标注推断）。
4. 样本不足（场次少/无基准/官方未提供样本量）必须在 data_limitations 明确声明，结论相应降级。
5. 建议必须可执行：给出具体做法/步骤/预期效果，禁止「多练习」「提高意识」类空话；按 now(立即改进)/short(短期训练)/long(长期提升) 分档。
6. 不重复、不堆砌、不写套话填充；术语专业但用白话解释关键概念；未知信息标「未知」，不猜测。
7. 全部用简体中文（英雄/装备名用国服官方中文名）。
8. 深度推断（inferences）：只写输入数据现象能支撑的推理，必须给 reasoning（现象→结论的推理链）与 confidence，并尽量给 alternative（其他可能解释）；推断不是事实，不得与 facts 混同，不得把相关当因果。
9. 优势分析（strengths）：基于真实数据指出可量化的长处（如某英雄胜率/对位/经济/视野领先），给 basis 与 leverage（如何扩大优势）；无数据支撑不写空泛夸奖。
10. 风险预警（risk_warnings）：指出可预见的成绩/对局风险，给 trigger（数据信号或条件）、consequence、mitigation，按 severity 分级；与 data_limitations（数据本身局限）区分。
11. 教练总结（coach_summary）：以教练口吻写一段话，先肯定真实努力与进步，再点出核心瓶颈，最后给下一步聚焦；白话、有温度、不端着、不写鸡汤套话。
12. 长期记忆连续性：若输入含「记忆/历史报告结论/训练完成度」，须对比上次结论指出已改善/仍存在/新出现，不得原样重复上次建议；已完成的训练项要升级难度而非重提；记忆与本次数据冲突时以本次真实数据为准并说明变化。`;

const TASK_FOCUS = {
  query: '侧重个人能力画像与英雄/出装解读：指标卡 + 事实 + 可执行建议。',
  bp: '侧重阵容对抗与 BP 博弈：对位压力、阵容曲线、ban/pick 针对建议（recommendations 为主，training_plan 可空）。',
  replay: '侧重单场复盘：本场关键指标与个人基准对比、逐问题诊断（diagnoses 为主）、下一场立即改进项。',
  live: '侧重选人阶段即时决策：紧凑结论、对位威胁、符文/召唤师技能/出装方向建议（executive_summary + recommendations 为主，training_plan 可空）。',
  tactic: '侧重成长趋势与训练：近期 vs 此前对比、问题诊断、分档建议 + 完整训练计划（training_plan 必填 2-4 项）。',
};

function buildPrompt(task, payload, contextBlock) {
  const variant = payload.variant || '';
  const sys = `你是 NEXUS 英雄联盟职业电竞数据分析师。只依据用户提供的真实数据分析，输出专业结构化报告。
${QUALITY_RULES}
输出格式：只输出一个 JSON 对象（不要 markdown 代码围栏、不要 JSON 之外的任何文字），严格遵循以下 schema（字段可省略空数组，但 executive_summary 与 report_title 必填）：
${SCHEMA_SPEC}
任务侧重：${TASK_FOCUS[task] || TASK_FOCUS.tactic}${variant ? ' 布局变体：' + variant + '。' : ''}`;
  const user = `任务类型：${task}
数据范围：${payload.dataRange || '未注明（请在 data_limitations 中说明）'}
真实数据与上下文（JSON，唯一事实来源）：
${JSON.stringify(payload.data || {}, null, 1)}
${payload.rules ? '本地规则引擎预分析（可参考，须用数据验证后才可引用）：\n' + JSON.stringify({ facts: payload.rules.facts, inferences: payload.rules.inferences, advice: payload.rules.advice }, null, 1) : ''}
${contextBlock ? '长期记忆与档案上下文（历史结论/训练进度/池管理/知识库，供连续性与方法论参考；与本次数据冲突时以本次为准）：\n' + contextBlock + '\n' : ''}
请输出结构化 JSON 报告。`;
  return { sys, user };
}

// ---- tolerant parsing ----
function stripFences(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}
function extractJson(t) {
  if (t.startsWith('{')) return t;
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return t.slice(a, b + 1);
  return t;
}
function tryParse(t) {
  try { return JSON.parse(t); } catch {}
  try { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); } catch {}
  return null;
}

const LEVEL_MAP = { high: 'high', medium: 'medium', low: 'low', '高': 'high', '中': 'medium', '低': 'low', '严重': 'high', '一般': 'medium', '轻微': 'low', critical: 'high', major: 'high', minor: 'low', moderate: 'medium' };
const LEVEL_RANK = { high: 3, medium: 2, low: 1 };
const byLevel = (a, b) => (LEVEL_RANK[b] || 0) - (LEVEL_RANK[a] || 0);
const HORIZON_MAP = { now: 'now', short: 'short', long: 'long', immediate: 'now', '立即': 'now', '短期': 'short', '长期': 'long', '立刻': 'now', mid: 'short', '中期': 'short' };
const TREND_MAP = { up: 'up', down: 'down', flat: 'flat', '上升': 'up', '下降': 'down', '持平': 'flat', increase: 'up', decrease: 'down', improved: 'up', worsened: 'down' };

const str = (v) => (v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const conf = (v) => { const n = Number(v); if (!Number.isFinite(n)) return null; return Math.max(0, Math.min(1, n > 1 ? n / 100 : n)); };
const level = (v, dflt) => LEVEL_MAP[String(v || '').toLowerCase()] || dflt;

function normalizeReport(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const es = r.executive_summary && typeof r.executive_summary === 'object' ? r.executive_summary : {};
  return {
    report_title: str(r.report_title) || 'NEXUS 战术分析报告',
    executive_summary: { overall: str(es.overall), biggest_strength: str(es.biggest_strength), biggest_issue: str(es.biggest_issue), priority_direction: str(es.priority_direction) },
    key_metrics: arr(r.key_metrics).map(m => (m && typeof m === 'object' ? m : { label: str(m) })).map(m => ({
      label: str(m.label || m.name || m.metric), value: str(m.value), unit: str(m.unit), compare: str(m.compare || m.baseline || m.history),
      trend: TREND_MAP[String(m.trend || '').toLowerCase()] || null, good: typeof m.good === 'boolean' ? m.good : null, basis: str(m.basis || m.source),
    })).filter(m => m.label || m.value),
    facts: arr(r.facts).map(f => (f && typeof f === 'object' ? f : { content: str(f) })).map(f => ({
      title: str(f.title), content: str(f.content || f.text || f.detail), basis: str(f.basis || f.evidence || f.data), importance: level(f.importance, 'medium'), confidence: conf(f.confidence),
    })).filter(f => f.content || f.title).sort((a, b) => byLevel(a.importance, b.importance)),
    diagnoses: arr(r.diagnoses || r.problems || r.issues).map(d => (d && typeof d === 'object' ? d : { title: str(d) })).map(d => ({
      title: str(d.title || d.problem || d.name), severity: level(d.severity || d.level, 'medium'), basis: str(d.basis || d.evidence), cause: str(d.cause || d.reason), impact: str(d.impact || d.effect), confidence: conf(d.confidence),
    })).filter(d => d.title || d.cause).sort((a, b) => byLevel(a.severity, b.severity)),
    recommendations: arr(r.recommendations || r.advice || r.suggestions).map(x => (x && typeof x === 'object' ? x : { action: str(x) })).map(x => ({
      horizon: HORIZON_MAP[String(x.horizon || x.term || x.priority || '').toLowerCase()] || 'short', title: str(x.title), action: str(x.action || x.content || x.text), steps: arr(x.steps).map(str).filter(Boolean), expected_effect: str(x.expected_effect || x.effect || x.goal),
    })).filter(x => x.action || x.title),
    inferences: arr(r.inferences || r.deep_inferences).map(x => (x && typeof x === 'object' ? x : { content: str(x) })).map(x => ({
      title: str(x.title), content: str(x.content || x.text || x.conclusion), basis: str(x.basis || x.evidence || x.observation), reasoning: str(x.reasoning || x.logic || x.chain), alternative: str(x.alternative || x.other), confidence: conf(x.confidence),
    })).filter(x => x.content || x.title).sort((a, b) => (b.confidence || 0) - (a.confidence || 0)),
    strengths: arr(r.strengths || r.advantages).map(x => (x && typeof x === 'object' ? x : { content: str(x) })).map(x => ({
      title: str(x.title), content: str(x.content || x.text || x.detail), basis: str(x.basis || x.evidence || x.data), leverage: str(x.leverage || x.how || x.expand),
    })).filter(x => x.content || x.title),
    coach_summary: str(r.coach_summary || r.coach_note || (typeof r.coach === 'string' ? r.coach : '')),
    training_plan: arr(r.training_plan || r.training).map(t => (t && typeof t === 'object' ? t : { content: str(t) })).map(t => ({
      goal: str(t.goal || t.title), content: str(t.content || t.action || t.detail), completion_criteria: str(t.completion_criteria || t.criteria || t.standard), metric: str(t.metric || t.evaluation || t.kpi),
    })).filter(t => t.goal || t.content),
    risk_warnings: arr(r.risk_warnings || r.warnings).map(x => (x && typeof x === 'object' ? x : { title: str(x) })).map(x => ({
      title: str(x.title || x.risk), severity: level(x.severity || x.level, 'medium'), trigger: str(x.trigger || x.signal || x.condition), consequence: str(x.consequence || x.impact || x.effect), mitigation: str(x.mitigation || x.avoid || x.action),
    })).filter(x => x.title || x.trigger || x.consequence).sort((a, b) => byLevel(a.severity, b.severity)),
    risk_assessment: arr(r.risk_assessment || r.risks).map(x => str(typeof x === 'object' ? (x.content || x.text || x.title || JSON.stringify(x)) : x)).filter(Boolean),
    data_limitations: arr(r.data_limitations || r.limitations).map(x => str(typeof x === 'object' ? (x.content || x.text || x.title || JSON.stringify(x)) : x)).filter(Boolean),
  };
}

// Returns {mode:'structured', report} | {mode:'markdown', content, note}. Never throws.
function parseResponse(content) {
  const text = String(content || '').trim();
  if (!text) return { mode: 'markdown', content: '', note: '模型返回为空' };
  const candidate = extractJson(stripFences(text));
  const obj = tryParse(candidate);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const report = normalizeReport(obj);
    const hasBody = report.executive_summary.overall || report.facts.length || report.diagnoses.length || report.recommendations.length || report.key_metrics.length || report.inferences.length || report.strengths.length || report.coach_summary || report.risk_warnings.length;
    if (hasBody) return { mode: 'structured', report };
    return { mode: 'markdown', content: text, note: 'JSON 缺少有效报告字段，按原文渲染' };
  }
  return { mode: 'markdown', content: text, note: candidate !== text || text.startsWith('{') ? 'JSON 解析失败，按 Markdown 原文渲染' : null };
}

// ---- serializers (copy / export) ----
function toMarkdown(report, meta) {
  const r = normalizeReport(report);
  const L = [];
  L.push(`# ${r.report_title}`);
  if (meta) L.push(`> 模型 ${meta.model || '未知'} · 生成 ${meta.createdAt || ''}${meta.dataRange ? ' · 数据范围 ' + meta.dataRange : ''}`);
  const es = r.executive_summary;
  if (es.overall) { L.push('', '## 执行摘要', es.overall); if (es.biggest_strength) L.push(`- 最大优势：${es.biggest_strength}`); if (es.biggest_issue) L.push(`- 最大问题：${es.biggest_issue}`); if (es.priority_direction) L.push(`- 优先方向：${es.priority_direction}`); }
  if (r.coach_summary) { L.push('', '## 教练总结', r.coach_summary); }
  if (r.key_metrics.length) { L.push('', '## 关键指标', '| 指标 | 数值 | 对比 | 依据 |', '|---|---|---|---|'); for (const m of r.key_metrics) L.push(`| ${m.label} | ${m.value}${m.unit} | ${m.compare || '—'} | ${m.basis || '—'} |`); }
  if (r.facts.length) { L.push('', '## 事实（真实数据）'); for (const f of r.facts) L.push(`- **${f.title || '事实'}**：${f.content}${f.basis ? `（依据：${f.basis}）` : ''}`); }
  if (r.strengths.length) { L.push('', '## 优势分析'); for (const s of r.strengths) L.push(`- **${s.title || '优势'}**：${s.content}${s.basis ? `（依据：${s.basis}）` : ''}${s.leverage ? `\n  - 扩大优势：${s.leverage}` : ''}`); }
  if (r.diagnoses.length) { L.push('', '## 问题诊断'); for (const d of r.diagnoses) L.push(`- **${d.title}**〔${d.severity === 'high' ? '严重' : d.severity === 'low' ? '轻微' : '中等'}〕${d.confidence != null ? ` 可信度 ${Math.round(d.confidence * 100)}%` : ''}\n  - 依据：${d.basis || '—'}\n  - 原因：${d.cause || '—'}\n  - 影响：${d.impact || '—'}`); }
  if (r.inferences.length) { L.push('', '## 深度推断（基于数据的推理，非事实）'); for (const x of r.inferences) L.push(`- **${x.title || '推断'}**：${x.content}${x.confidence != null ? ` 可信度 ${Math.round(x.confidence * 100)}%` : ''}\n  - 现象：${x.basis || '—'}\n  - 推理：${x.reasoning || '—'}${x.alternative ? `\n  - 其他可能：${x.alternative}` : ''}`); }
  if (r.recommendations.length) { L.push('', '## 改进建议'); const H = { now: '立即改进', short: '短期训练', long: '长期提升' }; for (const h of ['now', 'short', 'long']) { const items = r.recommendations.filter(x => x.horizon === h); if (!items.length) continue; L.push(`### ${H[h]}`); for (const x of items) { L.push(`- **${x.title || x.action}**${x.title && x.action ? '：' + x.action : ''}`); for (const s of x.steps) L.push(`  - ${s}`); if (x.expected_effect) L.push(`  - 预期效果：${x.expected_effect}`); } } }
  if (r.training_plan.length) { L.push('', '## 训练计划'); r.training_plan.forEach((t, i) => L.push(`${i + 1}. **${t.goal}**：${t.content}\n   - 完成标准：${t.completion_criteria || '—'}\n   - 评估指标：${t.metric || '—'}`)); }
  if (r.risk_warnings.length) { L.push('', '## 风险预警'); for (const x of r.risk_warnings) L.push(`- **${x.title || '风险'}**〔${x.severity === 'high' ? '高' : x.severity === 'low' ? '低' : '中'}〕\n  - 触发：${x.trigger || '—'}\n  - 后果：${x.consequence || '—'}\n  - 规避：${x.mitigation || '—'}`); }
  if (r.risk_assessment.length) { L.push('', '## 风险评估'); for (const x of r.risk_assessment) L.push(`- ${x}`); }
  if (r.data_limitations.length) { L.push('', '## 数据局限'); for (const x of r.data_limitations) L.push(`- ${x}`); }
  return L.join('\n');
}

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toHtml(report, meta) {
  const md = toMarkdown(report, meta);
  // minimal standalone styling; body rendered as preformatted markdown text is unsafe-free (escaped)
  const body = escHtml(md).replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^- (.*)$/gm, '<li>$1</li>').replace(/^\d+\. (.*)$/gm, '<li>$1</li>').replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${escHtml(report && report.report_title || 'NEXUS 报告')}</title>
<style>body{background:#101418;color:#DCE6EE;font:14px/1.8 system-ui,"Microsoft YaHei",sans-serif;max-width:860px;margin:32px auto;padding:0 20px}h1{color:#F0C75E;font-size:22px}h2{color:#7FD4C1;font-size:17px;border-bottom:1px solid #2A343E;padding-bottom:6px;margin-top:28px}h3{color:#9DB4C8;font-size:15px}blockquote{border-left:3px solid #F0C75E;margin:8px 0;padding:4px 12px;color:#9DB4C8}li{margin:4px 0}b{color:#F0E6D2}</style>
</head><body>${body}</body></html>`;
}

module.exports = { buildPrompt, parseResponse, normalizeReport, toMarkdown, toHtml, SCHEMA_SPEC };