'use strict';
/** Polite HTTP client: timeout, retry with backoff, browser UA, optional delay. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 离线快返：系统断网时立即失败（保留本地数据），不再空等 timeout×retries
let electronNet = null;
try { electronNet = require('electron').net; } catch {}
function offline() {
  try { return !!(electronNet && typeof electronNet.isOnline === 'function' && electronNet.isOnline() === false); }
  catch { return false; }
}
const OFFLINE_ERR = '网络离线：已跳过请求，本地缓存数据仍可用。';

async function fetchText(url, { retries = 2, timeout = 25000, headers = {}, delay = 0 } = {}) {
  if (offline()) throw new Error(OFFLINE_ERR);
  if (delay) await sleep(delay);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (offline()) throw new Error(OFFLINE_ERR);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function fetchJson(url, opts) {
  const txt = await fetchText(url, opts);
  return JSON.parse(txt);
}

async function fetchBuffer(url, { retries = 2, timeout = 25000, delay = 0 } = {}) {
  if (offline()) throw new Error(OFFLINE_ERR);
  if (delay) await sleep(delay);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (offline()) throw new Error(OFFLINE_ERR);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      clearTimeout(t); lastErr = e;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

module.exports = { fetchText, fetchJson, fetchBuffer, sleep, UA };