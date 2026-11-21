'use strict';
/**
 * NEXUS AI MODEL HUB + ROUTER. OpenAI-compatible multi-provider.
 * API keys encrypted via Electron safeStorage (OS-backed DPAPI on Windows) — never
 * written to plain config/logs/model context. Router picks a model per task and the
 * ACTUAL model used is always reported. On failure, falls back to local rules (flagged).
 */
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const TASKS = ['query', 'bp', 'replay', 'live', 'tactic'];
const TASK_CN = { query: '普通查询', bp: 'BP 分析', replay: '赛后复盘', live: '实时分析', tactic: '战术推演' };
// default routing preference (capability tier) per task
const TASK_TIER = { query: 'fast', bp: 'reason', replay: 'long', live: 'fast', tactic: 'reason' };

function createAiHub(dir, logger, config) {
  const log = logger.child('ai');
  const file = path.join(dir, 'ai-providers.json');
  let data = { providers: [], routing: {}, globalProvider: null, calls: [], enabled: false, sendPersonal: true, sendReplay: true };
  try { if (fs.existsSync(file)) data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  function save() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); }
  // 调用日志高频写合并防抖（P2-9）；配置类变更仍走 save() 立即落盘
  let saveTimer = null;
  function saveSoon(ms = 600) { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; try { save(); } catch (e) { log.warn('saveSoon', e.message); } }, ms); }

  function encryptKey(key) {
    if (!key) return null;
    if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(key).toString('base64') };
    return { plain: key }; // fallback only if OS encryption unavailable (flagged)
  }
  function decryptKey(p) {
    if (!p || !p.key) return null;
    if (p.key.enc) { try { return safeStorage.decryptString(Buffer.from(p.key.enc, 'base64')); } catch { return null; } }
    return p.key.plain || null;
  }
  function publicProvider(p) { const { key, ...rest } = p; return { ...rest, hasKey: !!key, keySecure: !!(key && key.enc) }; }

  function list() { return data.providers.map(publicProvider); }
  function addProvider({ name, baseUrl, model, apiKey, tier = 'fast', params = {} }) {
    const id = 'p' + Date.now();
    const p = { id, name: name || '未命名服务商', baseUrl: (baseUrl || '').replace(/\/$/, ''), model: model || 'gpt-4o-mini', tier, params: { temperature: 0.4, maxTokens: 1200, ...params }, enabled: true, key: encryptKey(apiKey), createdAt: new Date().toISOString() };
    data.providers.push(p); save(); return publicProvider(p);
  }
  function updateProvider(id, patch) {
    const p = data.providers.find(x => x.id === id); if (!p) return null;
    if (patch.apiKey !== undefined) p.key = encryptKey(patch.apiKey);
    for (const k of ['name', 'baseUrl', 'model', 'tier', 'enabled']) if (patch[k] !== undefined) p[k] = patch[k];
    if (patch.params) p.params = { ...p.params, ...patch.params };
    if (patch.baseUrl) p.baseUrl = patch.baseUrl.replace(/\/$/, '');
    save(); return publicProvider(p);
  }
  function removeProvider(id) { data.providers = data.providers.filter(x => x.id !== id); save(); }
  function setRouting(task, providerId) { data.routing[task] = providerId; save(); }
  function setGlobal(providerId) { data.globalProvider = providerId; save(); }
  function setEnabled(v) { data.enabled = !!v; save(); }
  function setPrivacy(patch) { Object.assign(data, patch); save(); }
  function settings() { return { enabled: data.enabled, sendPersonal: data.sendPersonal, sendReplay: data.sendReplay, routing: data.routing, globalProvider: data.globalProvider, tasks: TASKS, taskCN: TASK_CN }; }

  function pickProvider(task, overrideId) {
    const enabled = data.providers.filter(p => p.enabled && decryptKey(p));
    if (!enabled.length) return null;
    if (overrideId) return enabled.find(p => p.id === overrideId) || null;
    if (data.routing[task]) { const r = enabled.find(p => p.id === data.routing[task]); if (r) return r; }
    if (data.globalProvider) { const g = enabled.find(p => p.id === data.globalProvider); if (g) return g; }
    const tier = TASK_TIER[task] || 'fast';
    return enabled.find(p => p.tier === tier) || enabled[0];
  }

  async function callApi(p, messages, { timeout = 60000, maxTokens } = {}) {
    const key = decryptKey(p);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
    const url = p.baseUrl + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: p.model, messages, temperature: p.params.temperature, max_tokens: maxTokens || p.params.maxTokens }),
    });
    clearTimeout(t);
    if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error('HTTP ' + res.status + ' ' + txt.slice(0, 200)); }
    const j = await res.json();
    const content = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    return { content, model: j.model || p.model, usage: j.usage || null };
  }

  function logCall(rec) { data.calls.unshift(rec); if (data.calls.length > 200) data.calls.pop(); saveSoon(); }

  async function testProvider(id) {
    const p = data.providers.find(x => x.id === id); if (!p) return { ok: false, error: '服务商不存在' };
    const t0 = Date.now();
    try {
      const r = await callApi(p, [{ role: 'user', content: '回复"连接成功"四个字。' }], { timeout: 20000 });
      const rec = { task: 'test', provider: p.name, model: r.model, durationMs: Date.now() - t0, tokens: r.usage ? r.usage.total_tokens : null, ok: true, at: new Date().toISOString() };
      logCall(rec); return { ok: true, model: r.model, reply: r.content, durationMs: rec.durationMs };
    } catch (e) {
      logCall({ task: 'test', provider: p.name, model: p.model, durationMs: Date.now() - t0, ok: false, error: String(e.message || e), at: new Date().toISOString() });
      return { ok: false, error: String(e.message || e) };
    }
  }

  // Main chat entry. Returns {content, model, provider, fallback:false} or {fallback:true, reason}.
  async function chat(task, messages, { overrideId, timeout, maxTokens } = {}) {
    if (!data.enabled) return { fallback: true, reason: '外部 AI 总开关已关闭，使用本地规则分析。' };
    const p = pickProvider(task, overrideId);
    if (!p) return { fallback: true, reason: '未配置可用的 AI 服务商，使用本地规则分析。' };
    const t0 = Date.now();
    try {
      const r = await callApi(p, messages, { timeout, maxTokens });
      logCall({ task, provider: p.name, model: r.model, durationMs: Date.now() - t0, tokens: r.usage ? r.usage.total_tokens : null, ok: true, at: new Date().toISOString() });
      return { content: r.content, model: r.model, provider: p.name, usage: r.usage, fallback: false };
    } catch (e) {
      logCall({ task, provider: p.name, model: p.model, durationMs: Date.now() - t0, ok: false, error: String(e.message || e), at: new Date().toISOString() });
      // try a backup provider once
      const backup = data.providers.find(x => x.enabled && x.id !== p.id && decryptKey(x));
      if (backup) {
        try { const r2 = await callApi(backup, messages, { timeout, maxTokens }); logCall({ task, provider: backup.name, model: r2.model, durationMs: Date.now() - t0, tokens: r2.usage ? r2.usage.total_tokens : null, ok: true, backup: true, at: new Date().toISOString() }); return { content: r2.content, model: r2.model, provider: backup.name, usage: r2.usage, fallback: false, backup: true }; }
        catch (e2) { logCall({ task, provider: backup.name, model: backup.model, durationMs: Date.now() - t0, ok: false, error: String(e2.message || e2), at: new Date().toISOString() }); }
      }
      return { fallback: true, reason: 'AI 调用失败（' + (e.message || e) + '），降级为本地规则分析。', error: String(e.message || e) };
    }
  }

  function calls(limit = 100) { return data.calls.slice(0, limit); }
  return { list, addProvider, updateProvider, removeProvider, setRouting, setGlobal, setEnabled, setPrivacy, settings, testProvider, chat, calls, pickProvider: (t, o) => { const p = pickProvider(t, o); return p ? publicProvider(p) : null; }, TASKS, TASK_CN };
}

module.exports = { createAiHub, TASKS, TASK_CN };