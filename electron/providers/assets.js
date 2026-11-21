'use strict';
const fs = require('fs');
const path = require('path');
const { fetchBuffer, sleep } = require('../core/net');

function createAssets(assetDir, logger) {
  const log = logger ? logger.child('assets') : { info() {}, warn() {} };
  fs.mkdirSync(assetDir, { recursive: true });
  function relPath(kind, name) { return `${kind}/${name}`; }
  function abs(rel) { return path.join(assetDir, rel); }
  function has(rel) { return fs.existsSync(abs(rel)); }
  async function download(url, rel, { delay = 0 } = {}) {
    const dest = abs(rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return rel;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const buf = await fetchBuffer(url, { delay, retries: 1, timeout: 20000 });
      fs.writeFileSync(dest + '.tmp', buf);
      fs.renameSync(dest + '.tmp', dest);
      return rel;
    } catch (e) {
      log.warn('asset download failed', { rel, error: String(e.message || e) });
      return null;
    }
  }
  return { dir: assetDir, relPath, abs, has, download };
}

module.exports = { createAssets };