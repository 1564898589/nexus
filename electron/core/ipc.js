'use strict';
/** IPC bridge: exposes the dual-engine backend to the renderer via window.nexus. */
const { ipcMain, shell, dialog, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const Q = require('./queries');
const comp = require('../analytics/composition');
const tactics = require('../analytics/tactics');
const { runQualityChecks } = require('./quality');

function registerIpc(ctx) {
  const { db, logger, config, assets, updateEngine, sources, backup, lcu, players, announcements, ai, auth, alerts, updater, events, kb, aicontext, analyst, paths, app, win } = ctx;
  const log = logger.child('ipc');
  const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
    try { return await fn(...args); }
    catch (e) { log.error(channel, e); return { __error: String(e.message || e) }; }
  });

  // ---- app / window ----
  handle('app:info', () => ({
    version: app.getVersion(), name: app.getName(), platform: process.platform,
    paths: { userData: paths.userData, db: db.file, assets: assets.dir, backups: backup.dir, logs: logger.file },
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
  }));
  handle('window:min', () => win.minimize());
  handle('window:max', () => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); });
  handle('window:close', () => win.close());
  handle('shell:open', (url) => { if (/^https?:\/\//.test(url) || /^mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(url)) shell.openExternal(url); return true; });
  handle('clip:write', (text) => { clipboard.writeText(String(text == null ? '' : text)); return true; });
  handle('clip:read', () => clipboard.readText());

  // ---- 私人访问密码门（验证全在主进程，renderer 拿不到哈希/明文） ----
  handle('auth:status', () => auth.status());
  handle('auth:verify', (pwd) => auth.verify(pwd));
  handle('auth:change', (oldPwd, newPwd) => auth.change(oldPwd, newPwd));
  handle('auth:revoke-trust', () => auth.revokeTrust());

  // ---- config / profile ----
  handle('config:get', () => config.all());
  handle('config:set', (k, v) => config.set(k, v));
  handle('config:patch', (obj) => config.patch(obj));

  // ---- data source registry (multi-server) ----
  handle('sources:list', () => sources.list());
  handle('sources:refresh', (id, opts) => sources.refresh(id, opts || {}));
  handle('sources:check', (id) => sources.check(id));
  handle('sources:setEnabled', (id, v) => { const r = sources.setEnabled(id, v); return r ? { ok: true, enabled: !!r.enabled } : { __error: '数据源不存在' }; });

  handle('cn:championDetail', (key, position, opts) => require('../providers/cn101').championDetail(ctx, key, position, opts || {}));
  handle('data:compare', (opts) => {
    const o = opts || {};
    const tierFilter = o.tierFilter || 'emerald_plus';
    const pick = (region) => {
      const p = db.get('SELECT patch FROM champion_stats WHERE region=? AND tierFilter=? ORDER BY patch DESC LIMIT 1', [region, tierFilter]);
      if (!p) return { patch: null, rows: [] };
      let rows = db.all('SELECT * FROM champion_stats WHERE region=? AND tierFilter=? AND patch=?', [region, tierFilter, p.patch]);
      if (o.position && o.position !== 'all') rows = rows.filter(r => r.position === o.position);
      return { patch: p.patch, rows };
    };
    const kr = pick('kr'), cn = pick('cn');
    const cm = {}; for (const c of db.all('SELECT * FROM champions')) cm[c.key] = c;
    const map = (rows) => rows.map(r => ({ championKey: r.championKey, position: r.position, winRate: r.winRate, pickRate: r.pickRate, banRate: r.banRate, tier: r.tier, rank: r.rank, sampleSize: r.sampleSize, source: r.source, fetchedAt: r.fetchedAt, champion: cm[r.championKey] || null }));
    return { tierFilter, kr: { ...kr, rows: map(kr.rows) }, cn: { ...cn, rows: map(cn.rows) } };
  });
  // ---- data engine ----
  handle('data:state', () => updateEngine.snapshot());
  handle('data:refresh', (opts) => updateEngine.refresh(opts || {}));
  handle('data:tierList', (opts) => Q.tierList(db, config, opts || {}));
  handle('data:champions', (opts) => Q.listChampions(db, opts || {}));
  handle('data:picker', (opts) => Q.pickerPool(db, config, opts || {}));
  handle('data:champion', (key) => Q.getChampion(db, config, key));
  handle('data:build', async (key, position, opts) => {
    const o = opts || {};
    let b = Q.getBuild(db, config, key, position, o);
    // 国服详情懒加载：无缓存时抓 101 官方出装/加点/符文并缓存，再归一返回
    if (!b && Q.currentFilter(db, config).region === 'cn' && !o.region) {
      try { await require('../providers/cn101').championDetail(ctx, key, position, { tierFilter: o.tierFilter }); } catch (e) { log.warn('cn detail lazy failed', { key, position, error: String(e.message || e) }); }
      b = Q.getBuild(db, config, key, position, o);
    }
    // 韩服旧缓存形状（无技能组合/18级加点解析）→ 单页懒刷新，避免全量重采
    const f = Q.currentFilter(db, config);
    if (b && b.data && (o.region || f.region) === 'kr' && b.data.shape !== 2) {
      try { await require('../providers/collector').refreshDetail(ctx, key, position, { region: 'kr', tierFilter: f.tierFilter }); } catch (e) { log.warn('kr detail refresh failed', { key, position, error: String(e.message || e) }); }
      b = Q.getBuild(db, config, key, position, o);
    }
    return b;
  });
  handle('data:counters', (key, position) => Q.countersFor(db, config, key, position));
  handle('data:meta', () => { const f = Q.currentFilter(db, config); return tactics.metaSummary(Q.metaStats(db, config), f.patch); });
  handle('data:items', () => Object.values(Q.itemMap(db)));
  handle('data:runes', () => Object.values(Q.runeMap(db)));
  handle('data:styles', () => Object.values(Q.styleMap(db)));
  handle('data:spells', () => Object.values(Q.spellMap(db)));
  handle('data:dims', () => comp.DIMS);

  // ---- favorites / profile ----
  handle('favorites:list', () => db.all('SELECT * FROM favorites ORDER BY addedAt DESC').map(r => r.championKey));
  handle('favorites:toggle', (key) => {
    const exists = db.get('SELECT 1 x FROM favorites WHERE championKey=?', [key]);
    if (exists) db.run('DELETE FROM favorites WHERE championKey=?', [key]);
    else db.run('INSERT INTO favorites(championKey,addedAt) VALUES(?,?)', [key, new Date().toISOString()]);
    db.persist();
    return !exists;
  });
  handle('profile:recent', (key) => {
    const cur = config.get('recentChampions') || [];
    const next = [key, ...cur.filter(k => k !== key)].slice(0, 12);
    config.set('recentChampions', next);
    return next;
  });

  // ---- BP saves / prep saves ----
  const saveApi = (table) => ({
    list: () => db.all(`SELECT id,name,createdAt FROM ${table} ORDER BY createdAt DESC`),
    save: (name, data) => {
      const createdAt = new Date().toISOString();
      db.run(`INSERT INTO ${table}(name,data,createdAt) VALUES(?,?,?)`, [name || '未命名', JSON.stringify(data), createdAt]);
      db.persist();
      return db.get(`SELECT id,name,createdAt FROM ${table} ORDER BY id DESC LIMIT 1`);
    },
    load: (id) => { const r = db.get(`SELECT * FROM ${table} WHERE id=?`, [id]); return r ? { id: r.id, name: r.name, createdAt: r.createdAt, data: Q.parseJson(r.data, null) } : null; },
    update: (id, data) => { db.run(`UPDATE ${table} SET data=? WHERE id=?`, [JSON.stringify(data), id]); db.persist(); return true; },
    delete: (id) => { db.run(`DELETE FROM ${table} WHERE id=?`, [id]); db.persist(); return true; },
  });
  const bp = saveApi('bp_saves'), prep = saveApi('prep_saves');
  handle('bp:list', bp.list); handle('bp:save', bp.save); handle('bp:load', bp.load); handle('bp:delete', bp.delete);
  handle('prep:list', prep.list); handle('prep:save', prep.save); handle('prep:load', prep.load); handle('prep:update', prep.update); handle('prep:delete', prep.delete);

  // ---- analysis (heuristic + real stats separated) ----
  const cmap = () => Q.championMap(db);
  const resolveTeam = (team) => (team || []).map(c => {
    if (!c) return null;
    if (typeof c === 'string') return cmap()[c] || { key: c };
    const full = cmap()[c.key];
    return full ? { ...full, ...c } : c;
  });
  handle('analysis:composition', (team) => comp.analyzeTeam(resolveTeam(team)));
  handle('analysis:compare', (blue, red) => tactics.compareTeams(resolveTeam(blue), resolveTeam(red), Q.metaStats(db, config)));
  handle('analysis:pickAdvice', (myTeam, enemyTeam, poolKeys, opts) => {
    const map = cmap();
    const pool = (poolKeys && poolKeys.length ? poolKeys.map(k => map[k]).filter(Boolean) : Object.values(map));
    return tactics.pickAdvice(resolveTeam(myTeam), resolveTeam(enemyTeam), pool, Q.metaStats(db, config), opts || {});
  });
  handle('analysis:pickAdviceByPosition', (myTeam, enemyTeam, bannedKeys, personal, signature) => {
    const map = cmap();
    return tactics.pickAdviceByPosition(resolveTeam(myTeam), resolveTeam(enemyTeam), Object.values(map), Q.metaStats(db, config), { banned: bannedKeys || [], personal: personal || {}, signature: signature || [] });
  });
  // 完整对位样本（counters 页缓存优先，按需懒采集）——六态区分，异常保留旧数据
  handle('counter:matchup', async (key, position, opts) => {
    const collector = require('../providers/collector');
    const o = opts || {};
    const f = Q.currentFilter(db, config);
    const region = o.region || f.region, tierFilter = o.tierFilter || f.tierFilter;
    const patch = Q.latestPatchFor(db, region, tierFilter);
    const statRow = patch ? db.get('SELECT * FROM champion_stats WHERE championKey=? AND position=? AND region=? AND tierFilter=? AND patch=?', [key, position, region, tierFilter, patch]) : null;
    const cached = patch ? db.all('SELECT * FROM matchups WHERE championKey=? AND position=? AND region=? AND tierFilter=? AND patch=? ORDER BY play DESC', [key, position, region, tierFilter, patch]) : [];
    const base = {
      championKey: key, position, region, tierFilter, patch,
      overallWinRate: statRow ? statRow.winRate : null,
      statSampleSize: statRow ? statRow.sampleSize : null,
      statFetchedAt: statRow ? statRow.fetchedAt : null,
    };
    const mapRows = (rs) => rs.map(r => ({ opponentKey: r.opponentKey, play: r.play, win: r.win, winRate: r.winRate, fetchedAt: r.fetchedAt, source: r.source || 'opgg-matchup' }));
    if (region !== 'kr') return { ...base, state: 'unsupported-region', rows: [], fetchedAt: null, error: null };
    if (!statRow) return { ...base, state: 'no-stat-row', rows: [], fetchedAt: null, error: null };
    if (cached.length && !o.force) {
      const ageH = (Date.now() - new Date(cached[0].fetchedAt).getTime()) / 36e5;
      return { ...base, state: ageH > 24 ? 'stale' : 'ok', rows: mapRows(cached), fetchedAt: cached[0].fetchedAt, error: null };
    }
    try {
      const r = await collector.collectMatchupPage(ctx, key, position, { region, tier: tierFilter, patch });
      if (!r.rows.length) {
        return { ...base, state: cached.length ? 'stale' : 'empty-source', rows: mapRows(cached), fetchedAt: cached.length ? cached[0].fetchedAt : null, error: null };
      }
      return { ...base, state: 'ok', rows: mapRows(r.rows), fetchedAt: r.fetchedAt, error: null };
    } catch (e) {
      return { ...base, state: cached.length ? 'stale' : 'failed', rows: mapRows(cached), fetchedAt: cached.length ? cached[0].fetchedAt : null, error: String(e.message || e) };
    }
  });
  handle('analysis:counter', (myKey, enemyKey, position) => {
    const map = cmap();
    const my = map[myKey], enemy = map[enemyKey];
    const f = Q.currentFilter(db, config);
    // 优先完整对位页样本（我方视角直接命中）
    const patch = Q.latestPatchFor(db, f.region, f.tierFilter);
    let counterStat = null, perspective = 'mine', fromMatchup = false;
    if (patch) {
      const m = db.get('SELECT * FROM matchups WHERE championKey=? AND position=? AND region=? AND tierFilter=? AND patch=? AND opponentKey=?', [myKey, position, f.region, f.tierFilter, patch, enemyKey]);
      if (m && m.winRate != null) { counterStat = { play: m.play, win: m.win, winRate: m.winRate }; fromMatchup = true; }
    }
    // 回退：强度榜内嵌摘要（每英雄 3 个最劣势对位）双向查找
    const find = (ownerKey, oppKey) => {
      const row = db.get('SELECT * FROM champion_stats WHERE championKey=? AND position=? AND region=? AND tierFilter=?', [ownerKey, position, f.region, f.tierFilter]);
      if (!row) return null;
      const cs = Q.parseJson(row.counters, []).find(c => c.championKey === oppKey);
      return cs && cs.winRate != null ? cs : null;
    };
    if (!counterStat) {
      counterStat = find(enemyKey, myKey); perspective = 'enemy';
      if (!counterStat) { counterStat = find(myKey, enemyKey); perspective = 'mine'; }
    }
    return { my, enemy, region: f.region, perspective: counterStat ? perspective : null, fromMatchup, ...tactics.explainCounter(my, enemy, counterStat, { perspective, region: f.region }) };
  });
  handle('analysis:build', (key, position) => {
    const map = cmap();
    const b = Q.getBuild(db, config, key, position);
    return { champion: map[key], build: b ? b.data : null, ...tactics.explainBuild(map[key] || { key }, b ? b.data : null) };
  });
  handle('analysis:build-plan', async (key, position, enemyKeys) => {
    let b = Q.getBuild(db, config, key, position);
    if (!b && Q.currentFilter(db, config).region === 'cn') {
      try { await require('../providers/cn101').championDetail(ctx, key, position, {}); } catch (e) { log.warn('cn plan lazy failed', { key, position, error: String(e.message || e) }); }
      b = Q.getBuild(db, config, key, position);
    }
    if (!b || !b.data) return null;
    const map = cmap();
    const enemy = (enemyKeys || []).map(k => map[k]).filter(Boolean);
    const im = Q.itemMap(db);
    const p = require('../analytics/buildplan').plan(b.data, map[key] || { key }, enemy, im);
    const ids = new Set([
      ...p.six, ...p.adjustedSix,
      ...p.purchase.flatMap(x => x.ids),
      ...p.popular.flatMap(r => r.items.map(i => i.id)),
      ...p.swaps.flatMap(s => [s.inId, s.outId]),
    ].filter(x => x != null));
    p.items = {};
    for (const id of ids) p.items[id] = im[id] || { id, name: '#' + id, nameCn: null, imageUrl: `item/${id}.png` };
    return p;
  });

  // ---- DATA VAULT ----
  handle('vault:status', () => ({
    counts: db.counts(), sizeBytes: db.sizeBytes(), integrity: db.integrity(),
    meta: { patch: db.getMeta('patch'), ddVersion: db.getMeta('ddVersion'), region: db.getMeta('region'), tier: db.getMeta('tier'), sampleSize: db.getMeta('sampleSize'), fetchedAt: db.getMeta('fetchedAt'), lastSuccessAt: db.getMeta('lastSuccessAt') },
    dbFile: db.file, backupDir: backup.dir,
  }));
  handle('vault:quality', () => runQualityChecks(db, config));
  handle('vault:backup', (kind) => backup.create(kind || 'manual', db));
  handle('vault:backups', () => backup.list(db));
  handle('vault:check', (file) => backup.check(file));
  handle('vault:restore', async (file) => {
    const res = backup.restore(file, db);
    db.reload();
    events.emit('data-state', updateEngine.snapshot());
    return res;
  });
  handle('vault:logs', (opts = {}) => {
    let rows = db.all('SELECT * FROM collection_logs ORDER BY id DESC LIMIT 500');
    if (opts.status) rows = rows.filter(r => r.status === opts.status);
    if (opts.source) rows = rows.filter(r => (r.source || '').includes(opts.source));
    return rows;
  });
  handle('vault:exportLogs', async () => {
    const rows = db.all('SELECT * FROM collection_logs ORDER BY id DESC');
    const res = await dialog.showSaveDialog(win, { title: '导出采集日志', defaultPath: 'nexus-collection-logs.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, JSON.stringify(rows, null, 2));
    return { ok: true, file: res.filePath, count: rows.length };
  });
  handle('vault:exportDb', async () => {
    db.persist();
    const res = await dialog.showSaveDialog(win, { title: '导出数据库', defaultPath: 'nexus-export.db', filters: [{ name: 'SQLite', extensions: ['db'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.copyFileSync(db.file, res.filePath);
    return { ok: true, file: res.filePath };
  });

  // ---- PLAYER ENGINE (国服战绩, read-only) ----
  const scouting = require('../analytics/scouting');
  handle('player:available', () => players.available());
  handle('player:channels', () => players.channels());
  handle('player:search', (name, opts) => players.search(name, opts || {}));
  handle('player:confirmCandidate', (c) => players.confirmCandidate(c));
  handle('player:searchHistory', (limit) => players.searchHistory(limit || 30));
  handle('player:deleteSearchHistory', (id) => players.deleteSearchHistory(id));
  handle('player:clearSearchHistory', () => players.clearSearchHistory());
  handle('player:profile', (puuid, opts) => players.profile(puuid, opts || {}));
  handle('player:history', (puuid, opts) => players.fetchHistory(puuid, opts || {}));
  handle('player:matchDetail', (gameId, opts) => players.getMatchDetail(gameId, opts || {}));
  handle('player:scoutParticipants', (list, modeKey) => players.scoutParticipants(list || [], modeKey));
  handle('player:wegameStatus', () => ctx.wegame.status());
  handle('player:wegameConnect', (cookie) => ctx.wegame.connect(cookie));
  handle('player:wegamePreview', (cookie) => ctx.wegame.preview(cookie));
  handle('player:wegameDisconnect', () => ctx.wegame.disconnect());
  handle('player:wegameVerify', (keyword) => ctx.wegame.verify(keyword || undefined));
  handle('player:recent', () => players.recentPlayers());
  handle('player:deleteRecent', (puuid) => players.deleteRecent(puuid));
  handle('player:clearRecent', () => players.clearRecent());
  handle('player:favorites', () => players.favoritePlayers());
  handle('player:toggleFavorite', (puuid, name) => players.toggleFavorite(puuid, name));
  handle('player:focus', () => players.focusList());
  handle('player:setFocus', (puuid, name, threat, note) => { players.setFocus(puuid, name, threat, note); return true; });
  handle('player:removeFocus', (puuid) => { players.removeFocus(puuid); return true; });
  handle('player:regions', () => ({ tencent: require('../providers/sgp').TENCENT_REGIONS, riot: require('../providers/sgp').RIOT_REGIONS }));
  handle('player:resolveCell', (cell) => players.resolveCell(cell));
  // Live warroom: resolve both champ-select teams into player intel.
  handle('warroom:live', async () => {
    const s = lcu.getState();
    const cs = s.champSelect;
    if (!cs) return { active: false, phase: s.phase, loggedIn: s.loggedIn, tencent: s.tencent };
    const resolveTeam = async (team) => { const out = []; for (const cell of team) out.push(await players.resolveCell(cell)); return out; };
    const myTeam = await resolveTeam(cs.myTeam || []);
    const theirTeam = await resolveTeam(cs.theirTeam || []);
    return { active: true, phase: cs.phase, myTeam, theirTeam, bans: cs.bans, loggedIn: s.loggedIn, tencent: s.tencent, platformId: s.platformId };
  });
  // scouting: teams = arrays of {puuid,name,championId,champKey,position}; resolve profiles then build report
  handle('scouting:report', async (blue, red) => {
    const cmap = Q.championMap(db);
    const champStats = Q.metaStats(db, config);
    const resolve = async (team) => {
      const out = [];
      for (const cell of (team || [])) {
        if (!cell) { out.push(null); continue; }
        let prof = null;
        if (cell.puuid) { try { prof = await players.profile(cell.puuid, { refresh: false, count: 20 }); } catch {} }
        out.push({ name: cell.name || (prof && prof.player && prof.player.name), puuid: cell.puuid, championId: cell.championId, champKey: cell.champKey, position: cell.position, rating: prof && prof.rating, stats: prof && prof.stats });
      }
      return out;
    };
    const B = await resolve(blue), R = await resolve(red);
    return scouting.buildScouting(B, R, champStats, cmap);
  });

  // ---- REPLAY / GROWTH / META TRENDS (cached real data only) ----
  const replayAnalytics = require('../analytics/replay');
  handle('replay:list', (puuid, limit) => players.cachedMatches(puuid, limit || 50).map(m => ({
    gameId: m.gameId, gameCreation: m.gameCreation, duration: m.duration, mode: m.mode, queueId: m.queueId,
    win: m.me ? m.me.win : null, championId: m.me ? m.me.championId : null, position: m.me ? m.me.position : null,
    kills: m.me ? m.me.kills : null, deaths: m.me ? m.me.deaths : null, assists: m.me ? m.me.assists : null, source: m.source,
  })));
  // 单局十人缓存回退：客户端离线时仍可用本地缓存的真实 participants 展示对局表
  handle('player:matchParticipants', (gameId, puuid) => {
    const gid = String(gameId);
    const rows = db.all('SELECT data FROM matches WHERE gameId=?', [gameId]).concat(db.all('SELECT data FROM matches WHERE CAST(gameId AS TEXT)=?', [gid]));
    for (const r of rows) {
      const m = Q.parseJson(r.data, null);
      if (m && Array.isArray(m.participants) && m.participants.length >= 2) {
        return { source: m.source || 'cache', gameCreation: m.gameCreation, duration: m.duration, mode: m.mode, queueId: m.queueId, participants: m.participants };
      }
    }
    return null;
  });
  handle('replay:analyze', (gameId, puuid) => {
    const matches = players.cachedMatches(puuid, 200);
    const gid = String(gameId);
    const m = matches.find(x => String(x.gameId) === gid);
    if (!m) return { __error: '未找到该对局的本地缓存。请先在玩家战绩中心查询战绩。' };
    // 基准只取与本场同模式的对局，避免人机/大乱斗/排位混算失去可研究性。
    const cat = replayAnalytics.modeCategory(m.queueId, m.mode);
    const sameMode = matches.filter(x => replayAnalytics.modeCategory(x.queueId, x.mode).key === cat.key);
    const stats = players.computeStats(sameMode, puuid);
    return replayAnalytics.analyzeMatch(m, stats, cat.label);
  });
  handle('growth:report', (puuid, modeKey) => {
    const all = players.cachedMatches(puuid, 200);
    const modes = replayAnalytics.modeBreakdown(all);
    const key = modeKey || 'all';
    const matches = replayAnalytics.filterByMode(all, key);
    const label = (modes.find(x => x.key === key) || {}).label || (matches[0] ? replayAnalytics.modeCategory(matches[0].queueId, matches[0].mode).label : key);
    const stats = players.computeStats(matches, puuid);
    return { ...replayAnalytics.growthReport(matches, stats, label), modeKey: key, modes, stats, player: db.get('SELECT * FROM players WHERE puuid=?', [puuid]) };
  });
  handle('meta:trends', () => {
    const patches = db.all('SELECT patch, COUNT(*) rows, SUM(sampleSize) samples, MAX(fetchedAt) fetchedAt FROM champion_stats GROUP BY patch ORDER BY patch DESC');
    const f = Q.currentFilter(db, config);
    const rows = db.all('SELECT championKey, position, tier, winRate, pickRate, banRate, sampleSize FROM champion_stats WHERE region=? AND tierFilter=? AND patch=?', [f.region, f.tierFilter, f.patch]);
    const byTier = {};
    for (const r of rows) byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    const top = (k, n) => rows.filter(r => r[k] != null && r.sampleSize >= 200).sort((a, b) => b[k] - a[k]).slice(0, n);
    return {
      patches, currentPatch: f.patch, region: f.region, tierFilter: f.tierFilter,
      byTier, topWin: top('winRate', 8), topPick: top('pickRate', 8), topBan: top('banRate', 8),
      multiPatch: patches.length > 1,
      note: patches.length > 1 ? null : '当前数据库仅含一个版本。版本趋势需要多个版本的数据积累；每次「更新数据」会记录当时版本，随时间自然形成趋势。',
    };
  });

  // ---- INTELLIGENCE ALERTS ----
  handle('alerts:list', (n) => alerts.list(n));
  handle('alerts:unread', () => alerts.unread());
  handle('alerts:read', (id) => alerts.markRead(id));
  handle('alerts:readAll', () => alerts.markAllRead());
  handle('alerts:clear', () => alerts.clear());
  handle('alerts:settings', () => alerts.settings());
  handle('alerts:set', (k, v) => { config.set(k, v); return alerts.settings(); });

  // ---- proactive analyst (P1-9) ----
  handle('analyst:evaluate', (reason) => analyst.evaluate(reason || 'manual'));
  handle('analyst:list', (n) => analyst.list(n));
  handle('analyst:dismiss', (id) => analyst.dismiss(id));
  handle('analyst:enabled', () => analyst.enabled());
  handle('analyst:setEnabled', (v) => analyst.setEnabled(v));
  handle('analyst:preview', () => analyst.compute());

  // ---- local knowledge base (P1-7) ----
  handle('kb:list', () => kb.list());
  handle('kb:search', (q, task, limit) => kb.search(q, task, limit));

  // ---- AI long-term context (P1-8) introspection ----
  handle('aicontext:build', (task, payload) => aicontext.build(task || 'tactic', payload || {}, { allowPersonal: ai.settings().sendPersonal }));

  // ---- champion pool coverage / proficiency / role correction (P1-7) ----
  handle('pool:list', (puuid) => db.all('SELECT * FROM player_pool WHERE puuid=?', [puuid || config.get('selfPuuid') || '']));
  handle('pool:set', (puuid, championId, proficiency, role) => {
    const pu = puuid || config.get('selfPuuid');
    if (!pu) return { __error: '未设本人账号' };
    db.run('INSERT INTO player_pool(puuid,championId,proficiency,role,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(puuid,championId) DO UPDATE SET proficiency=excluded.proficiency,role=excluded.role,updatedAt=excluded.updatedAt',
      [pu, championId, proficiency || null, role || null, new Date().toISOString()]);
    db.persist();
    return db.get('SELECT * FROM player_pool WHERE puuid=? AND championId=?', [pu, championId]);
  });
  handle('pool:remove', (puuid, championId) => {
    const pu = puuid || config.get('selfPuuid');
    db.run('DELETE FROM player_pool WHERE puuid=? AND championId=?', [pu, championId]); db.persist(); return true;
  });
  // coverage summary: cached byChampion joined with user tags + breadth recommendation
  handle('pool:coverage', (puuid) => {
    const pu = puuid || config.get('selfPuuid');
    if (!pu) return { __error: '未设本人账号' };
    const matches = players.cachedMatches(pu, 100);
    const st = players.computeStats(matches, pu);
    const tags = db.all('SELECT * FROM player_pool WHERE puuid=?', [pu]);
    const tagBy = {}; for (const t of tags) tagBy[t.championId] = t;
    const rows = (st.byChampion || []).map(c => ({ ...c, proficiency: (tagBy[c.championId] || {}).proficiency || null, role: (tagBy[c.championId] || {}).role || null }));
    const mains = rows.filter(r => r.proficiency === '主力');
    const mainRoles = [...new Set(mains.map(r => r.role).filter(Boolean))];
    return { total: st.total, poolDepth: st.poolDepth, rows, mains: mains.length, mainRoles, recommendedMain: 2, covered: mains.length >= 2 };
  });

  // ---- ANNOUNCEMENTS (local, 开发者：竖) ----
  handle('ann:list', () => announcements.list());
  handle('ann:get', (id) => announcements.get(id));
  handle('ann:boot', () => announcements.bootPopup());
  handle('ann:read', (id) => { announcements.markRead(id); return true; });
  handle('ann:ack', (id) => { announcements.ack(id); return true; });
  handle('ann:readAll', () => { announcements.markAllRead(); return true; });
  handle('ann:dismissNormal', (v) => { announcements.setDismissNormal(v); return true; });
  handle('ann:unread', () => announcements.unreadCount());
  handle('ann:import', (json) => announcements.importFile(json));

  // ---- AI MODEL HUB ----
  handle('ai:settings', () => ai.settings());
  handle('ai:providers', () => ai.list());
  handle('ai:addProvider', (p) => ai.addProvider(p));
  handle('ai:updateProvider', (id, patch) => ai.updateProvider(id, patch));
  handle('ai:removeProvider', (id) => { ai.removeProvider(id); return true; });
  handle('ai:test', (id) => ai.testProvider(id));
  handle('ai:setRouting', (task, id) => { ai.setRouting(task, id); return true; });
  handle('ai:setGlobal', (id) => { ai.setGlobal(id); return true; });
  handle('ai:setEnabled', (v) => { ai.setEnabled(v); return true; });
  handle('ai:setPrivacy', (p) => { ai.setPrivacy(p); return true; });
  handle('ai:calls', (n) => ai.calls(n));
  handle('ai:pick', (task, override) => ai.pickProvider(task, override));
  // Tactical AI: builds a data-grounded prompt, calls model, falls back to rules (flagged).
  handle('ai:tactic', async (task, payload) => {
    payload = payload || {};
    const rules = payload.rules; // precomputed rule-based analysis from renderer
    const allowPersonal = ai.settings().sendPersonal;
    if (payload.personal && !allowPersonal) return { fallback: true, reason: '隐私设置不允许发送个人战绩，使用本地规则分析。', rules: rules || null, model: null };
    const ctxBlock = aicontext ? aicontext.build(task, payload, { allowPersonal }).block : '';
    const sys = '你是 NEXUS 英雄联盟战术分析师（职业电竞分析师风格）。只依据提供的真实数据进行分析，区分事实/推断/建议。不得编造胜率、经济、视野或敌方位置等未提供的信息。数据不足时明确说明不确定性。用简洁中文输出。';
    const user = `任务类型：${task}\n\n真实数据与上下文（JSON）：\n${JSON.stringify(payload && payload.data || {}, null, 2)}\n${ctxBlock ? '\n长期记忆与档案上下文（供连续性参考，与本次数据冲突时以本次为准）：\n' + ctxBlock + '\n' : ''}\n请给出战术分析。`;
    const res = await ai.chat(task, [{ role: 'system', content: sys }, { role: 'user', content: user }], { overrideId: payload && payload.providerId });
    if (res.fallback) return { fallback: true, reason: res.reason, rules: rules || null, model: null };
    return { fallback: false, content: res.content, model: res.model, provider: res.provider, usage: res.usage, backup: !!res.backup };
  });

  // ---- structured AI report system (additive; ai:tactic kept for compatibility) ----
  const aireport = require('./aireport');
  handle('ai:report', async (task, payload) => {
    payload = payload || {};
    const rules = payload.rules;
    if (task === 'replay' && !ai.settings().sendReplay) return { fallback: true, reason: '隐私设置不允许发送复盘数据，使用本地规则分析。', rules: rules || null };
    const allowPersonal = ai.settings().sendPersonal;
    if (payload.personal && !allowPersonal) return { fallback: true, reason: '隐私设置不允许发送个人战绩，使用本地规则分析。', rules: rules || null };
    const ctxObj = aicontext ? aicontext.build(task, payload, { allowPersonal }) : null;
    const ctxBlock = ctxObj ? ctxObj.block : '';
    const ctxMeta = ctxObj ? { memoryCount: ctxObj.memoryCount, hasSelf: ctxObj.hasSelf, sources: ctxObj.sources } : null;
    const { sys, user } = aireport.buildPrompt(task, payload, ctxBlock);
    const res = await ai.chat(task, [{ role: 'system', content: sys }, { role: 'user', content: user }], { overrideId: payload.providerId, maxTokens: 3800, timeout: 90000 });
    if (res.fallback) return { fallback: true, reason: res.reason, rules: rules || null, model: null };
    const parsed = aireport.parseResponse(res.content);
    const createdAt = new Date().toISOString();
    const subject = String(payload.subject || 'global');
    const title = parsed.mode === 'structured' ? parsed.report.report_title : 'AI 分析（Markdown 兼容模式）';
    let id = null;
    try {
      db.run('INSERT INTO ai_reports(task,subject,title,mode,model,provider,report,content,meta,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [task, subject, title, parsed.mode, res.model, res.provider, parsed.mode === 'structured' ? JSON.stringify(parsed.report) : null, parsed.mode === 'markdown' ? parsed.content : null, JSON.stringify({ dataRange: payload.dataRange || null, variant: payload.variant || null, backup: !!res.backup, context: ctxMeta }), createdAt]);
      db.persist();
      const row = db.get('SELECT last_insert_rowid() AS id'); id = row && row.id;
    } catch (e) { log.error('ai:report save', e); }
    return { fallback: false, mode: parsed.mode, report: parsed.report || null, content: parsed.content || null, parseNote: parsed.note || null, model: res.model, provider: res.provider, backup: !!res.backup, id, createdAt, dataRange: payload.dataRange || null, context: ctxMeta };
  });
  handle('ai:reports', (task, subject, limit) => db.all('SELECT id,task,subject,title,mode,model,provider,createdAt FROM ai_reports WHERE task=? AND subject=? ORDER BY id DESC LIMIT ?', [task, String(subject || 'global'), limit || 20]));
  handle('ai:report-get', (id) => {
    const r = db.get('SELECT * FROM ai_reports WHERE id=?', [id]);
    if (!r) return null;
    return { ...r, report: r.report ? JSON.parse(r.report) : null, meta: r.meta ? JSON.parse(r.meta) : null };
  });
  handle('ai:report-delete', (id) => { db.run('DELETE FROM ai_reports WHERE id=?', [id]); db.persist(); return true; });
  handle('ai:report-text', (id) => {
    const r = db.get('SELECT * FROM ai_reports WHERE id=?', [id]);
    if (!r) return null;
    const report = r.report ? JSON.parse(r.report) : null;
    const meta = { model: r.model, createdAt: r.createdAt, dataRange: r.meta ? (JSON.parse(r.meta).dataRange || null) : null };
    return { md: report ? aireport.toMarkdown(report, meta) : (r.content || ''), title: r.title };
  });
  handle('ai:export', async (id, format) => {
    const r = db.get('SELECT * FROM ai_reports WHERE id=?', [id]);
    if (!r) return { ok: false, error: '报告不存在' };
    const report = r.report ? JSON.parse(r.report) : null;
    const meta = { model: r.model, createdAt: r.createdAt, dataRange: r.meta ? (JSON.parse(r.meta).dataRange || null) : null };
    const html = format === 'html';
    const text = html ? aireport.toHtml(report, meta) : (report ? aireport.toMarkdown(report, meta) : (r.content || ''));
    const res = await dialog.showSaveDialog(win, { title: '导出 AI 报告', defaultPath: `nexus-report-${r.id}.${html ? 'html' : 'md'}`, filters: html ? [{ name: 'HTML', extensions: ['html'] }] : [{ name: 'Markdown', extensions: ['md'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, text);
    return { ok: true, file: res.filePath };
  });

  // ---- LCU ENGINE ----
  handle('lcu:state', () => lcu.getState());
  handle('lcu:connect', () => lcu.connect());
  handle('lcu:start', () => { lcu.start(); return lcu.getState(); });
  handle('lcu:stop', () => { lcu.stop(); return lcu.getState(); });
  handle('lcu:perkPages', () => lcu.getPerkPages());
  handle('lcu:applyRunes', () => ({ __error: 'NEXUS V1.0 严格只读模式：不支持写入客户端符文。请在游戏内手动配置。' }));

  // ---- SMART UPDATE SYSTEM ----
  // Action channels throw so renderer promises reject (UI catch blocks work).
  const handleT = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => fn(...args));
  handle('update:state', () => updater.state());
  handleT('update:check', () => updater.check());
  handleT('update:download', () => updater.download());
  handle('update:cancelDownload', () => updater.cancelDownload());
  handleT('update:install', (opts) => updater.install(opts || {}));
  handle('update:snooze', (h) => updater.snooze(h));
  handle('update:history', () => updater.history());
  handle('update:setChannel', (c) => updater.setSources({ defaultChannel: c && c.type === 'https' ? 'github' : (c && c.type) || 'auto', ...(c && c.type === 'https' ? { github: { repo: (c.manifestUrl || '').replace(/^https:\/\/api\.github\.com\/repos\//, '').replace(/\/.*$/, '') } } : {}), ...(c && c.type === 'local' ? { local: { path: c.path || '' } } : {}) }));
  handle('update:sources', () => updater.sources());
  handle('update:setSources', (p) => updater.setSources(p));
  handleT('update:useLocalFile', (p) => updater.useLocalFile(p));
  handleT('update:pickLocalFile', () => updater.pickLocalFile());

  // ---- logs ----
  handle('log:recent', (n, level) => logger.recent(n || 200, level || null));
  handle('log:export', async () => {
    const res = await dialog.showSaveDialog(win, { title: '导出运行日志', defaultPath: 'nexus.log', filters: [{ name: 'Log', extensions: ['log', 'json'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, JSON.stringify(logger.export(), null, 2));
    return { ok: true, file: res.filePath };
  });

  // push events to renderer
  events.on('data-state', (s) => { if (win && !win.isDestroyed()) win.webContents.send('data-state', s); });
  events.on('sources-state', (s) => { if (win && !win.isDestroyed()) win.webContents.send('sources-state', s); });
  events.on('lcu-state', (s) => { if (win && !win.isDestroyed()) win.webContents.send('lcu-state', s); });
  events.on('update-state', (s) => { if (win && !win.isDestroyed()) win.webContents.send('update-state', s); });
  log.info('IPC registered');
}

module.exports = { registerIpc };