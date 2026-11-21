// AI 模型中心 — NEXUS AI Model Hub + Router + privacy + call log.
import { icon } from '../icons.js';
import { el, esc, fmtTime, toast, modal, confirmDialog } from '../util.js';
import { store } from '../store.js';

const TIER_CN = { fast: '快速低成本', reason: '高推理', long: '长上下文' };

export async function render(root) {
  const [settings, providers, calls] = await Promise.all([window.nexus.ai.settings(), window.nexus.ai.providers(), window.nexus.ai.calls(50)]);
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('cpu', 26, 'accent')} AI 模型中心 <span class="accent">MODEL HUB</span></div>
      <div class="page-sub">OpenAI 兼容多服务商 · 按任务路由模型 · 密钥安全存储 · 失败降级本地规则（明确标注）</div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 340px;gap:16px;align-items:start">
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">服务商管理</div><button class="btn primary sm" id="ai-add">${icon('plus', 14)} 添加服务商</button></div>
          <div id="ai-providers" class="flex-col gap-2"></div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">模型路由（按任务）</div></div>
          <div class="fs-12 text-3 mb-3">为每类任务指定模型；未指定时用全局/能力 tier 自动选择。界面始终显示实际调用的模型。</div>
          <div id="ai-routing" class="flex-col gap-2"></div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">调用日志</div></div>
          <div style="overflow-x:auto"><table class="nx-table"><thead><tr><th>任务</th><th>服务商</th><th>实际模型</th><th>耗时</th><th>Token</th><th>状态</th></tr></thead><tbody id="ai-calls"></tbody></table></div>
        </div>
      </div>
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">总开关与隐私</div></div>
          <div class="flex items-center justify-between mb-3"><span class="fs-13">启用外部 AI</span><div class="toggle ${settings.enabled ? 'on' : ''}" id="ai-enabled"><div class="track"></div></div></div>
          <div class="flex items-center justify-between mb-3"><span class="fs-13">允许发送个人战绩</span><div class="toggle ${settings.sendPersonal ? 'on' : ''}" id="ai-personal"><div class="track"></div></div></div>
          <div class="flex items-center justify-between mb-3"><span class="fs-13">允许发送复盘数据</span><div class="toggle ${settings.sendReplay ? 'on' : ''}" id="ai-replay"><div class="track"></div></div></div>
          <div class="divider"></div>
          <div class="fs-12 text-3" style="line-height:1.8">仅发送完成当前任务必需的游戏数据（英雄/阵容/统计/对位/公开战绩）。<br/><b class="text-red">绝不发送</b>：LCU Token、客户端密码、API Key、Windows 凭据、无关本地文件。<br/>API Key 经操作系统加密存储，不写入日志/明文配置/模型上下文。</div>
        </div>
        <div class="panel tight">
          <div class="panel-h"><div class="panel-title">降级说明</div></div>
          <div class="fs-12 text-2" style="line-height:1.8">未配置/关闭/调用失败时，NEXUS 自动使用本地规则分析，并明确标注「规则分析」，不冒充 AI 结果。AI 不是软件运行的必要条件。</div>
        </div>
        <div class="panel tight">
          <div class="panel-h"><div class="panel-title">本地知识库</div><span class="badge gray">curated · 非实时</span></div>
          <div class="flex gap-2 mb-2"><input class="nx-input" id="kb-q" placeholder="搜索战术概念（兵线/视野/资源/英雄池…）" style="flex:1"/><button class="btn ghost sm" id="kb-go">${icon('search', 13)} 检索</button></div>
          <div id="kb-results" class="flex-col gap-2"></div>
          <div class="fs-12 text-3 mt-2">通用战术方法论（人工整理+版本标签），供 AI 报告作方法论参考；不与真实抓取统计混同。</div>
        </div>
      </div>
    </div>
  `;
  drawProviders(root, providers);
  drawRouting(root, settings, providers);
  drawCalls(root, calls);
  drawKb(root, '');
  root.querySelector('#kb-go').addEventListener('click', () => drawKb(root, root.querySelector('#kb-q').value));
  root.querySelector('#kb-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') drawKb(root, e.currentTarget.value); });

  root.querySelector('#ai-add').addEventListener('click', () => providerForm(root));
  const bindToggle = (id, fn) => root.querySelector(id).addEventListener('click', async (e) => { const now = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', now); await fn(now); toast('设置已保存', 'success'); });
  bindToggle('#ai-enabled', (v) => window.nexus.ai.setEnabled(v));
  bindToggle('#ai-personal', (v) => window.nexus.ai.setPrivacy({ sendPersonal: v }));
  bindToggle('#ai-replay', (v) => window.nexus.ai.setPrivacy({ sendReplay: v }));
  return {};
}

async function drawKb(root, q) {
  const wrap = root.querySelector('#kb-results');
  if (!wrap) return;
  const hits = await window.nexus.kb.search(q || '', 'tactic', 5).catch(() => []);
  if (!hits.length) { wrap.innerHTML = '<div class="fs-12 text-3">无匹配条目；试试「兵线」「视野」「资源」「英雄池」「死亡」。</div>'; return; }
  wrap.innerHTML = hits.map(h => `<div style="padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-md)">
    <div class="flex items-center gap-2 mb-1"><span class="fw-6 fs-13">${esc(h.title)}</span><span class="badge gray" style="font-size:11px">${esc(h.patch || '通用')}</span></div>
    <div class="fs-12 text-2" style="line-height:1.7">${esc(h.body)}</div>
    <div class="fs-11 text-3 mt-1">${(h.tags || []).map(t => '#' + esc(t)).join(' ')} · ${esc(h.source || 'curated')}</div>
  </div>`).join('');
}

function drawProviders(root, providers) {
  const wrap = root.querySelector('#ai-providers');
  if (!providers.length) { wrap.innerHTML = '<div class="text-3 fs-13">尚未添加服务商。点击「添加服务商」配置 OpenAI 兼容接口（Base URL + API Key + 模型）。</div>'; return; }
  wrap.innerHTML = '';
  for (const p of providers) {
    const row = el('div', { class: 'flex items-center gap-3', style: { padding: '10px', border: '1px solid var(--line)', borderRadius: '10px' }, html: `
      ${icon('cpu', 18, 'text-teal')}
      <div style="flex:1;min-width:0"><div class="fw-6">${esc(p.name)} <span class="badge gray">${TIER_CN[p.tier] || p.tier}</span> ${p.enabled ? '' : '<span class="badge red">禁用</span>'}</div>
      <div class="fs-12 text-3 truncate">${esc(p.baseUrl)} · ${esc(p.model)} · ${p.hasKey ? (p.keySecure ? '密钥已加密' : '密钥未加密') : '无密钥'}</div></div>
      <button class="btn ghost sm ai-test">测试</button>
      <button class="btn ghost sm ai-edit">编辑</button>
      <button class="btn danger sm icon ai-del">${icon('trash', 14)}</button>
    ` });
    row.querySelector('.ai-test').addEventListener('click', async (e) => { e.currentTarget.disabled = true; const r = await window.nexus.ai.test(p.id).catch(err => ({ ok: false, error: String(err.message || err) })); e.currentTarget.disabled = false; toast(r.ok ? `连接成功 · 实际模型 ${r.model} · ${r.durationMs}ms` : '连接失败：' + (r.error || r.__error || '未知错误'), r.ok ? 'success' : 'error', 5000); drawCalls(root, await window.nexus.ai.calls(50).catch(() => [])); });
    row.querySelector('.ai-edit').addEventListener('click', () => providerForm(root, p));
    row.querySelector('.ai-del').addEventListener('click', async () => { if (await confirmDialog({ title: '删除服务商', message: `确定删除「${esc(p.name)}」？`, danger: true, confirmText: '删除' })) { await window.nexus.ai.removeProvider(p.id); render(root); } });
    wrap.appendChild(row);
  }
}

function providerForm(root, existing) {
  const f = (label, id, val, ph, type = 'text') => `<div class="field"><label>${label}</label><input class="nx-input" id="${id}" type="${type}" value="${esc(val || '')}" placeholder="${esc(ph || '')}"/></div>`;
  const body = el('div', { html: `
    ${f('服务商名称', 'pf-name', existing && existing.name, '如：OpenAI / DeepSeek / 本地 Ollama')}
    ${f('Base URL', 'pf-url', existing && existing.baseUrl, 'https://api.openai.com/v1')}
    ${f('模型名称', 'pf-model', existing && existing.model, 'gpt-4o-mini')}
    ${f('API Key', 'pf-key', '', existing ? '留空则不修改' : 'sk-…（加密存储）', 'password')}
    <div class="field"><label>能力定位</label><select class="nx-select w-full" id="pf-tier"><option value="fast" ${existing && existing.tier === 'fast' ? 'selected' : ''}>快速低成本</option><option value="reason" ${existing && existing.tier === 'reason' ? 'selected' : ''}>高推理</option><option value="long" ${existing && existing.tier === 'long' ? 'selected' : ''}>长上下文</option></select></div>
  ` });
  const m = modal({ title: existing ? '编辑服务商' : '添加服务商', body, foot: el('button', { class: 'btn primary', text: '保存', onClick: async () => {
    const get = (id) => body.querySelector('#' + id).value.trim();
    const payload = { name: get('pf-name'), baseUrl: get('pf-url'), model: get('pf-model'), tier: body.querySelector('#pf-tier').value };
    const key = get('pf-key'); if (key || !existing) payload.apiKey = key;
    if (!payload.baseUrl || !payload.model) { toast('请填写 Base URL 与模型名称', 'info'); return; }
    if (existing) await window.nexus.ai.updateProvider(existing.id, payload); else await window.nexus.ai.addProvider(payload);
    m.close(); toast('已保存', 'success'); render(root);
  } }) });
}

function drawRouting(root, settings, providers) {
  const wrap = root.querySelector('#ai-routing');
  const opts = (sel) => `<option value="">自动（按能力）</option>` + providers.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.model)}</option>`).join('');
  wrap.innerHTML = `<div class="flex items-center gap-3 mb-2"><span class="fs-13" style="width:90px">全局默认</span><select class="nx-select" id="rt-global" style="flex:1">${opts(settings.globalProvider)}</select></div>` +
    settings.tasks.map(t => `<div class="flex items-center gap-3 mb-2"><span class="fs-13 text-2" style="width:90px">${settings.taskCN[t]}</span><select class="nx-select rt-task" data-task="${t}" style="flex:1">${opts(settings.routing[t])}</select></div>`).join('');
  wrap.querySelector('#rt-global').addEventListener('change', async (e) => { await window.nexus.ai.setGlobal(e.target.value || null); toast('全局模型已更新', 'success'); });
  wrap.querySelectorAll('.rt-task').forEach(s => s.addEventListener('change', async (e) => { await window.nexus.ai.setRouting(e.target.dataset.task, e.target.value || null); toast('路由已更新', 'success'); }));
}

function drawCalls(root, calls) {
  const body = root.querySelector('#ai-calls');
  body.innerHTML = calls.length ? calls.map(c => `<tr style="cursor:default"><td class="fs-12">${esc(c.task)}</td><td class="fs-12">${esc(c.provider)}</td><td class="fs-12 text-teal">${esc(c.model)}</td><td class="num fs-12">${c.durationMs}ms</td><td class="num fs-12">${c.tokens ?? '—'}</td><td><span class="badge ${c.ok ? 'green' : 'red'}">${c.ok ? (c.backup ? '备用' : '成功') : '失败'}</span></td></tr>`).join('') : '<tr><td colspan="6" class="text-3 fs-13" style="padding:14px">暂无调用记录</td></tr>';
}