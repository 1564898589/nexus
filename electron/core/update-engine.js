'use strict';
/**
 * NEXUS DATA ENGINE update orchestrator. Owns freshness state, scheduled +
 * manual refresh, retry/backoff, and keep-old-data-on-failure semantics.
 */
const { collect } = require('../providers/collector');

const STATE = { FRESH: 'fresh', CACHED: 'cached', STALE: 'stale', UPDATING: 'updating', FAILED: 'failed', EMPTY: 'empty' };

function createUpdateEngine(ctx) {
  const { db, logger, config, events } = ctx;
  const log = logger.child('update-engine');
  let timer = null;
  let running = false;
  let state = STATE.EMPTY;
  let lastResult = null;
  let lastError = null;
  let progress = { phase: 'idle', message: '', done: 0, total: 0 };

  function emit() {
    if (events && events.emit) events.emit('data-state', snapshot());
  }

  function computeState() {
    const count = db.get('SELECT COUNT(*) c FROM champion_stats').c;
    if (running) return STATE.UPDATING;
    if (!count) return STATE.EMPTY;
    const fetchedAt = db.getMeta('fetchedAt');
    const lastSuccess = db.getMeta('lastSuccessAt');
    if (lastError && !lastSuccess) return STATE.FAILED;
    if (!fetchedAt) return STATE.CACHED;
    const ageH = (Date.now() - new Date(fetchedAt).getTime()) / 36e5;
    const interval = config.get('updateIntervalHours') || 6;
    if (ageH <= interval) return STATE.FRESH;
    if (ageH <= interval * 3) return STATE.CACHED;
    return STATE.STALE;
  }

  function snapshot() {
    state = computeState();
    return {
      state, running, progress, lastResult, lastError,
      patch: db.getMeta('patch') || null,
      region: db.getMeta('region') || config.get('region'),
      tier: db.getMeta('tier') || config.get('tier'),
      fetchedAt: db.getMeta('fetchedAt') || null,
      lastSuccessAt: db.getMeta('lastSuccessAt') || null,
      statsCount: db.get('SELECT COUNT(*) c FROM champion_stats').c,
      championCount: db.get('SELECT COUNT(*) c FROM champions').c,
      buildCount: db.get('SELECT COUNT(*) c FROM builds').c,
      autoUpdate: config.get('autoUpdate'),
      updateIntervalHours: config.get('updateIntervalHours'),
    };
  }

  async function refresh(opts = {}) {
    if (running) return { ok: false, error: '已有更新任务在进行中', snapshot: snapshot() };
    running = true; lastError = null;
    progress = { phase: 'start', message: '开始更新…', done: 0, total: 1 };
    emit();
    try {
      const res = await collect(ctx, { ...opts, progress: (p) => { progress = p; emit(); } });
      lastResult = res;
      if (!res.ok) { lastError = res.error; }
      return res;
    } catch (e) {
      lastError = String(e.message || e);
      log.error('refresh threw', e);
      return { ok: false, error: lastError };
    } finally {
      running = false;
      progress = { phase: 'idle', message: '', done: 0, total: 0 };
      emit();
    }
  }

  function scheduleNext() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!config.get('autoUpdate')) return;
    const hours = config.get('updateIntervalHours') || 6;
    timer = setTimeout(() => { refresh().finally(scheduleNext); }, hours * 36e5);
    log.info('next auto-update scheduled', { hours });
  }

  function start() {
    scheduleNext();
    // If empty on first launch and autoUpdate on, do an initial fetch.
    const count = db.get('SELECT COUNT(*) c FROM champion_stats').c;
    if (!count && config.get('autoUpdate')) {
      refresh().catch(e => log.error('initial refresh failed', e));
    }
  }
  function stop() { if (timer) { clearTimeout(timer); timer = null; } }

  return { refresh, start, stop, snapshot, scheduleNext, STATE };
}

module.exports = { createUpdateEngine, STATE };