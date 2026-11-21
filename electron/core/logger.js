'use strict';
const fs = require('fs');
const path = require('path');

/** File + ring-buffer logger. Never records secrets/tokens. */
function createLogger(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'nexus.log');
  const ring = [];
  const MAX = 2000;
  const LIMIT = 5 * 1024 * 1024, KEEP = 3;
  let bytes = 0; try { bytes = fs.statSync(file).size; } catch {}
  let chain = Promise.resolve();
  function rotate() {
    try {
      for (let i = KEEP - 1; i >= 1; i--) { const a = file + '.' + i, b = file + '.' + (i + 1); if (fs.existsSync(a)) fs.renameSync(a, b); }
      if (fs.existsSync(file)) fs.renameSync(file, file + '.1');
      bytes = 0;
    } catch { /* best effort */ }
  }
  function write(level, scope, msg, meta) {
    const rec = { ts: new Date().toISOString(), level, scope, msg, meta: meta || null };
    ring.push(rec);
    if (ring.length > MAX) ring.shift();
    const line = JSON.stringify(rec) + '\n';
    // 异步串行追加，避免每条日志同步写盘阻塞主进程；超 5MB 轮转，最多留 3 份。
    chain = chain.then(() => { if (bytes >= LIMIT) rotate(); bytes += Buffer.byteLength(line); return fs.promises.appendFile(file, line); }).catch(() => {});
  }
  return {
    info: (scope, msg, meta) => write('info', scope, msg, meta),
    warn: (scope, msg, meta) => write('warn', scope, msg, meta),
    error: (scope, msg, meta) => write('error', scope, msg, meta ? { error: String(meta && meta.message || meta) } : null),
    child: (scope) => ({
      info: (m, x) => write('info', scope, m, x),
      warn: (m, x) => write('warn', scope, m, x),
      error: (m, x) => write('error', scope, m, x),
    }),
    recent: (n = 300, level = null) => {
      const f = level ? ring.filter(r => r.level === level) : ring;
      return f.slice(-n).reverse();
    },
    export: () => ring.slice(),
    file,
  };
}

module.exports = { createLogger };