'use strict';
/**
 * NEXUS DATA SOURCE MANAGER — unified registry for every data source.
 * Each source: independent config / health / version / last-update / license.
 * Failure NEVER destroys old data (collectors commit transactionally); the
 * registry records the failure and the UI shows stale/failed honestly.
 * KR OP.GG keeps its existing update-engine state machine; this manager
 * orchestrates the additional sources (CN stats, LCU).
 */

const SEEDS = [
  {
    id: 'kr-opgg', name: 'OP.GG 韩服统计', kind: 'web', region: 'kr', mode: 'ranked',
    enabled: 1, autoUpdate: 1, intervalHours: 6,
    license: '公开页面解析（非官方，个人研究用途）', attribution: 'OP.GG', homepage: 'https://op.gg',
  },
  {
    id: 'cn-101', name: '国服 101 攻略中心', kind: 'web', region: 'cn', mode: 'ranked',
    enabled: 1, autoUpdate: 1, intervalHours: 12,
    license: '腾讯官方公开资料', attribution: '英雄联盟官方 101 攻略中心', homepage: 'https://101.qq.com/',
  },
  {
    id: 'kr-opgg-matchups', name: 'OP.GG 韩服对位样本库', kind: 'web', region: 'kr', mode: 'ranked',
    enabled: 1, autoUpdate: 0, intervalHours: 24,
    license: '公开页面解析（非官方，个人研究用途）', attribution: 'OP.GG', homepage: 'https://op.gg',
  },
];

function createSourceManager({ db, logger, config, events, assets }) {
  const log = logger.child('sources');
  const collectors = new Map(); // id -> { collect(ctx,opts), check?(ctx) }
  const running = new Map();    // id -> progress
  let timers = [];

  // seed registry rows (never overwrite user changes on existing rows)
  db.transaction(() => {
    for (const s of SEEDS) {
      db.run(`INSERT INTO data_sources(id,name,kind,region,mode,enabled,autoUpdate,intervalHours,license,attribution,homepage)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        [s.id, s.name, s.kind, s.region, s.mode, s.enabled, s.autoUpdate, s.intervalHours, s.license, s.attribution, s.homepage]);
    }
    // 海克斯大乱斗功能已按用户要求整体移除，清掉旧库里的数据源注册行
    db.run("DELETE FROM data_sources WHERE mode='mayhem'");
  });

  function emit() { if (events) events.emit('sources-state', list()); }
  function row(id) { return db.get('SELECT * FROM data_sources WHERE id=?', [id]); }

  function list() {
    return db.all('SELECT * FROM data_sources ORDER BY mode, region, id').map(r => ({
      ...r,
      enabled: !!r.enabled, autoUpdate: !!r.autoUpdate,
      registered: collectors.has(r.id),
      running: running.has(r.id),
      progress: running.get(r.id) || null,
      meta: r.meta ? safeJson(r.meta) : null,
    }));
  }
  function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

  function register(id, fns) { collectors.set(id, fns); }

  function logTask(id, startedAt, result) {
    const endedAt = new Date().toISOString();
    db.run('INSERT INTO collection_logs(task,source,startedAt,endedAt,fetched,success,failed,status,error,durationMs) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ['source:' + id, id, startedAt, endedAt, result.fetched || 0, result.success || 0, result.failed || 0,
        result.ok ? 'ok' : 'failed', result.error || null, new Date(endedAt) - new Date(startedAt)]);
  }

  async function refresh(id, opts = {}) {
    const r = row(id);
    if (!r) return { ok: false, error: '数据源不存在：' + id };
    if (!r.enabled) return { ok: false, error: '数据源已停用：' + r.name };
    const fns = collectors.get(id);
    if (!fns) return { ok: false, error: '数据源适配器尚未接入：' + r.name };
    if (running.has(id)) return { ok: false, error: '该数据源已有更新任务在进行中' };
    const startedAt = new Date().toISOString();
    running.set(id, { phase: 'start', message: '开始更新…', done: 0, total: 1 });
    db.run('UPDATE data_sources SET status=?, lastCheckAt=? WHERE id=?', ['updating', startedAt, id]);
    emit();
    let result;
    try {
      result = await fns.collect({ db, logger, config, events, assets }, {
        ...opts,
        progress: (p) => { running.set(id, p); emit(); },
      });
    } catch (e) {
      result = { ok: false, error: String(e.message || e) };
    }
    running.delete(id);
    const now = new Date().toISOString();
    if (result && result.ok) {
      db.run(`UPDATE data_sources SET status='ok', lastCheckAt=?, lastSuccessAt=?, lastError=NULL,
        version=COALESCE(?,version), fetchedAt=?, sampleSize=COALESCE(?,sampleSize), meta=COALESCE(?,meta) WHERE id=?`,
        [now, now, result.version || null, now, result.sampleSize != null ? result.sampleSize : null,
          result.meta ? JSON.stringify(result.meta) : null, id]);
      log.info('source refreshed', { id, version: result.version, sampleSize: result.sampleSize });
    } else {
      // keep-old-data semantics: only status/error change, cached rows untouched
      db.run(`UPDATE data_sources SET status=?, lastCheckAt=?, lastError=? WHERE id=?`,
        [r.lastSuccessAt ? 'stale' : 'failed', now, (result && result.error) || '未知错误', id]);
      log.warn('source refresh failed', { id, error: result && result.error });
    }
    try { logTask(id, startedAt, result || { ok: false }); db.persist(); } catch (e) { log.error('logTask failed', e); }
    emit();
    return result;
  }

  async function check(id) {
    const r = row(id);
    if (!r) return { ok: false, error: '数据源不存在' };
    const fns = collectors.get(id);
    const now = new Date().toISOString();
    let health = { ok: false, detail: '适配器未接入' };
    if (fns && fns.check) {
      try { health = await fns.check({ db, logger, config }); } catch (e) { health = { ok: false, detail: String(e.message || e) }; }
    } else if (fns) {
      health = { ok: !!r.lastSuccessAt, detail: r.lastSuccessAt ? '最近一次采集成功于 ' + r.lastSuccessAt : '尚未成功采集' };
    }
    db.run('UPDATE data_sources SET lastCheckAt=? WHERE id=?', [now, id]);
    emit();
    return { id, ...health };
  }

  function setEnabled(id, v) {
    db.run('UPDATE data_sources SET enabled=? WHERE id=?', [v ? 1 : 0, id]);
    db.persist();
    if (!v) { const t = timers.find(t => t.id === id); if (t) { clearTimeout(t.handle); timers = timers.filter(x => x !== t); } }
    else schedule(id);
    emit();
    return row(id);
  }

  function schedule(id) {
    const r = row(id);
    if (!r || !r.enabled || !r.autoUpdate || id === 'kr-opgg') return; // kr keeps update-engine scheduling
    if (!collectors.has(id)) return;
    const existing = timers.find(t => t.id === id);
    if (existing) clearTimeout(existing.handle);
    const hours = r.intervalHours || 24;
    const handle = setTimeout(() => { refresh(id).catch(() => {}).finally(() => schedule(id)); }, hours * 36e5);
    timers = timers.filter(t => t.id !== id);
    timers.push({ id, handle });
  }

  function start() {
    for (const s of SEEDS) {
      schedule(s.id);
      const r = row(s.id);
      // first-run: fetch once shortly after boot if enabled, registered and never succeeded
      if (r && r.enabled && r.autoUpdate && !r.lastSuccessAt && collectors.has(s.id) && s.id !== 'kr-opgg') {
        setTimeout(() => { refresh(s.id).catch(() => {}); }, 6000 + SEEDS.indexOf(s) * 4000);
      }
    }
  }
  function stop() { for (const t of timers) clearTimeout(t.handle); timers = []; }

  return { list, row, register, refresh, check, setEnabled, start, stop, SEEDS };
}

module.exports = { createSourceManager, SEEDS };
