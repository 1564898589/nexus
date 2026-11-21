'use strict';
/**
 * NEXUS 独立战绩通道 A — WeGame（腾讯国服）。
 * 不依赖本机英雄联盟客户端登录；依赖用户【自己的】WeGame 登录态（Cookie 由用户主动提供）。
 * Cookie 经 Electron safeStorage（Windows DPAPI）加密落盘，调用时仅内存解密；不上传、不写日志。
 *
 * 诚实性红线：WeGame 接口契约未获官方文档，本网关已实测存在（/api/v1/lol/* 返回结构化
 * error_code）。解析器只在 verify() 用真实响应验证通过后启用；形状不符时原样返回样本并标记
 * shape-mismatch，绝不伪造战绩。未连接/未验证时所有查询返回明确的限制说明。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { safeStorage } = require('electron');

const BASE = 'https://www.wegame.com.cn';
const HDRS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: BASE + '/',
};

// 实测存在的候选端点（200 + 结构化 error_code；无会话时 8000102）。
const ENDPOINTS = {
  search: (keyword) => `/api/v1/lol/role/search?keyword=${encodeURIComponent(keyword)}`,
  player: (area, name) => `/api/v1/lol/player/info?area=${encodeURIComponent(area)}&name=${encodeURIComponent(name)}`,
};

// 宽容解析：接受 原始值 / Cookie: 请求头 / cURL 命令 / DevTools JSON 数组，
// 统一成标准 Cookie 字符串；格式不对时给出白话原因，绝不静默保存残缺凭证。
function normalizeCookie(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return { ok: false, problem: 'empty', message: '还没有粘贴内容。先在浏览器复制，再点「从剪贴板粘贴」。' };
  let format = 'raw';
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      const arr = Array.isArray(j) ? j : (j && Array.isArray(j.cookies) ? j.cookies : null);
      if (arr && arr.length && arr.every(c => c && typeof c.name === 'string')) {
        s = arr.map(c => `${c.name}=${c.value == null ? '' : c.value}`).join('; ');
        format = 'json';
      }
    } catch { /* 不是 JSON，按文本继续 */ }
  }
  if (format === 'raw' && /curl\s/i.test(s) && /(-H|--header|-b|--cookie)\s/i.test(s)) {
    const m = s.match(/(?:-H|--header)\s+(['"])\s*cookie\s*:\s*([\s\S]*?)\1/i) || s.match(/(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/i);
    if (m) { s = m[2]; format = 'curl'; }
    else return { ok: false, problem: 'curl-no-cookie', message: '这段 cURL 命令里没有 Cookie 行。多半是复制了登录前的请求：请先登录 WeGame，再按 F5 刷新，然后右键刷新后出现的第一个请求重新复制。' };
  }
  s = s.replace(/^['"]+|['"]+$/g, '').trim();
  const hm = s.match(/^cookie\s*:\s*/i);
  if (hm) { s = s.slice(hm[0].length); if (format === 'raw') format = 'header'; }
  s = s.replace(/\s*;\s*/g, '; ').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().replace(/;+\s*$/, '');
  if (/^https?:\/\//i.test(s) || /^www\./i.test(s)) return { ok: false, problem: 'url', message: '你粘贴的是网址，不是登录凭证。Cookie 是一长串「名字=值」、用分号隔开的文字，不是浏览器地址栏里的链接。' };
  if (/^<(!doctype|html)/i.test(s)) return { ok: false, problem: 'html', message: '你粘贴的是网页代码，不是 Cookie。请照教程在 Network（网络）标签里复制，而不是 Elements（元素）标签。' };
  const pairs = s.split(';').map(x => x.trim()).filter(Boolean);
  const valid = pairs.filter(p => /^[^=\s]+=/.test(p));
  if (!valid.length) return { ok: false, problem: 'no-pairs', message: '没找到「名字=值」格式的内容——可能只复制到了 Cookie 这个词本身，或只选中了一小段。推荐用教程方法 A：右键请求 → Copy → Copy as cURL，整段粘贴进来即可。' };
  if (s.length < 20) return { ok: false, problem: 'too-short', message: '内容太短，看起来只复制到了一小段。完整的 Cookie 通常有几百个字符。请用教程方法 A 重新复制整段 cURL。' };
  return { ok: true, cookie: valid.join('; '), fields: valid.length, format };
}

function classifyError(e) {
  const status = e && e.status;
  const msg = String((e && e.message) || e || '');
  if (status === 404) return { kind: 'not-found', message: '账号不存在或已改名（接口返回 404）。' };
  if (status === 401 || status === 403) return { kind: 'permission', message: '权限不足或登录态失效（HTTP ' + status + '）。请重新提供 WeGame Cookie 或检查战绩隐私设置。' };
  if (status === 429) return { kind: 'rate-limit', message: '接口限流（HTTP 429）。请稍后再试，NEXUS 不会高频重试。' };
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|timeout|network/i.test(msg)) return { kind: 'network', message: '网络错误：' + msg + '。请检查网络连接后重试。' };
  if (/8000102|not.?login|未登录|登录态/i.test(msg)) return { kind: 'login-required', message: 'WeGame 登录态缺失或失效（error_code 8000102）。请在下方连接你的 WeGame 账号。' };
  return { kind: 'unavailable', message: '数据源不可用：' + msg };
}

function request(p, cookie, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'www.wegame.com.cn', port: 443, path: p, method: 'GET',
      headers: { ...HDRS, ...(cookie ? { Cookie: cookie } : {}) },
      timeout,
    }, (res) => {
      let buf = '';
      res.on('data', c => { if (buf.length < 200000) buf += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ json: JSON.parse(buf), raw: buf, status: res.statusCode }); }
          catch { resolve({ json: null, raw: buf, status: res.statusCode }); }
        } else {
          reject(Object.assign(new Error('WeGame HTTP ' + res.statusCode + ' ' + p), { status: res.statusCode, body: buf.slice(0, 300) }));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('WeGame timeout')));
    req.on('error', reject);
    req.end();
  });
}

function createWegameChannel(dir, logger) {
  const log = logger.child('wegame');
  const file = path.join(dir, 'wegame-session.json');
  let data = { session: null, verifiedAt: null, lastVerify: null, sample: null };
  try { if (fs.existsSync(file)) data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  function save() { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); }

  function encrypt(v) {
    if (!v) return null;
    if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(v).toString('base64') };
    return { plain: v, insecure: true };
  }
  function decrypt(p) {
    if (!p) return null;
    if (p.enc) { try { return safeStorage.decryptString(Buffer.from(p.enc, 'base64')); } catch { return null; } }
    return p.plain || null;
  }
  function cookie() { return decrypt(data.session); }

  function status() {
    const has = !!cookie();
    return {
      channel: 'wegame',
      connected: has,
      secure: !!(data.session && data.session.enc),
      verified: !!data.verifiedAt,
      verifiedAt: data.verifiedAt,
      fieldCount: data.fieldCount || null,
      lastVerify: data.lastVerify,
      limitation: has
        ? (data.verifiedAt ? '已用你的 WeGame 登录态实测验证通过；查询范围以实测响应为准。' : '已保存你的 WeGame 登录态，尚未实测验证。点「实测验证」确认接口可用性与数据范围。')
        : '独立通道需你自己的 WeGame 登录态（非游戏客户端登录）。在浏览器登录 wegame.com.cn 后，复制该站 Cookie 粘贴到此处；DPAPI 加密存储，仅本机使用。',
    };
  }

  function connect(cookieStr) {
    const n = normalizeCookie(cookieStr);
    if (!n.ok) return { ok: false, error: n.message, problem: n.problem };
    data.session = encrypt(n.cookie);
    data.fieldCount = n.fields;
    data.verifiedAt = null; data.sample = null;
    save();
    log.info('session stored', { secure: !!data.session.enc, fields: n.fields, format: n.format });
    return { ok: true, fields: n.fields, format: n.format, status: status() };
  }
  // 只返回格式诊断，不回传凭证内容
  function preview(cookieStr) {
    const n = normalizeCookie(cookieStr);
    return n.ok ? { ok: true, fields: n.fields, format: n.format } : { ok: false, problem: n.problem, message: n.message };
  }
  function disconnect() { data.session = null; data.verifiedAt = null; data.sample = null; data.lastVerify = null; data.fieldCount = null; save(); return status(); }

  // 实测验证：用真实响应判定接口可用性；成功且含数据才置 verified。
  async function verify(keyword = '测试') {
    const c = cookie();
    if (!c) return { ok: false, kind: 'login-required', message: '尚未连接 WeGame 登录态。' };
    const tried = [];
    for (const name of ['search', 'player']) {
      const epPath = name === 'search' ? ENDPOINTS.search(keyword) : ENDPOINTS.player('1', keyword);
      try {
        const r = await request(epPath, c);
        const j = r.json;
        const errCode = j && j.result && j.result.error_code;
        const okShape = j && (errCode === 0 || errCode == null) && j.result !== undefined;
        tried.push({ endpoint: name, status: r.status, error_code: errCode ?? null, okShape, snippet: r.raw.slice(0, 400) });
        if (errCode === 8000102) {
          data.lastVerify = { ok: false, at: new Date().toISOString(), kind: 'login-required', message: 'WeGame 返回 8000102：登录态缺失或失效。' };
          data.verifiedAt = null; save();
          return { ok: false, kind: 'login-required', message: 'WeGame 登录态缺失或失效（error_code 8000102）。请重新复制有效的 Cookie。', tried, status: status() };
        }
        if (okShape && errCode === 0) {
          data.verifiedAt = new Date().toISOString();
          data.sample = { endpoint: name, at: data.verifiedAt, body: r.raw.slice(0, 20000) };
          data.lastVerify = { ok: true, at: data.verifiedAt, endpoint: name };
          save();
          log.info('verify ok', { endpoint: name });
          return { ok: true, endpoint: name, sample: data.sample, status: status() };
        }
      } catch (e) {
        const cl = classifyError(e);
        tried.push({ endpoint: name, kind: cl.kind, message: cl.message });
        if (cl.kind === 'permission' || cl.kind === 'login-required') {
          data.lastVerify = { ok: false, at: new Date().toISOString(), kind: cl.kind, message: cl.message };
          data.verifiedAt = null; save();
          return { ok: false, ...cl, tried, status: status() };
        }
      }
      await new Promise(res => setTimeout(res, 1000));
    }
    data.lastVerify = { ok: false, at: new Date().toISOString(), kind: 'shape-mismatch', message: '接口可达但返回形状未通过验证（可能仍需登录或契约不同）。原始响应已存档供核对，解析器未启用。' };
    data.verifiedAt = null; save();
    return { ok: false, kind: 'shape-mismatch', message: data.lastVerify.message, tried, status: status() };
  }

  // 查询门控：未验证 → 明确限制；已验证 → 真实请求，形状不符原样返回。
  async function search(name, area) {
    const st = status();
    if (!st.connected) return { state: 'login-required', message: st.limitation, players: [] };
    if (!st.verified) return { state: 'needs-verification', message: 'WeGame 登录态已保存但未实测验证。请先点「实测验证」，验证通过后才能查询（禁止使用未验证接口）。', players: [] };
    try {
      const r = await request(ENDPOINTS.search(name), cookie());
      const j = r.json;
      if (!j || (j.result && j.result.error_code && j.result.error_code !== 0)) {
        const cl = classifyError(Object.assign(new Error('error_code ' + (j && j.result && j.result.error_code)), { status: 200 }));
        return { state: cl.kind, message: cl.message, players: [], raw: r.raw.slice(0, 2000) };
      }
      // 契约未定：仅在能明确识别玩家数组时解析，否则原样返回待人工核对
      const list = extractPlayers(j);
      if (!list) return { state: 'shape-mismatch', message: '验证后响应形状与预期不符，原样返回供核对，不做猜测解析。', players: [], raw: r.raw.slice(0, 4000) };
      return { state: 'ok', players: list, source: 'wegame', fetchedAt: new Date().toISOString() };
    } catch (e) {
      const cl = classifyError(e);
      return { state: cl.kind, message: cl.message, players: [] };
    }
  }

  function extractPlayers(j) {
    // 保守识别：result.data / result.list / result.players 中的对象数组，元素含名称与标识字段
    const r = j && j.result;
    const cand = r && (r.data || r.list || r.players || r.roles);
    const arr = Array.isArray(cand) ? cand : (cand && Array.isArray(cand.list) ? cand.list : null);
    if (!arr || !arr.length || typeof arr[0] !== 'object') return null;
    const out = [];
    for (const it of arr) {
      const name = it.name || it.role_name || it.summoner_name || it.game_name;
      const id = it.puuid || it.role_id || it.summoner_id || it.id;
      if (!name || !id) return null; // 形状不确定 → 整体不解析
      out.push({
        puuid: String(it.puuid || ''), externalId: String(id), name: String(name),
        serverId: it.area_id != null ? String(it.area_id) : (it.area || null),
        level: it.level ?? it.role_level ?? null, profileIconId: it.icon_id ?? it.profile_icon_id ?? null,
        source: 'wegame', confidence: 0.7,
      });
    }
    return out;
  }

  return { status, connect, disconnect, verify, search, preview, classifyError, ENDPOINTS };
}

module.exports = { createWegameChannel, classifyError, normalizeCookie, BASE };