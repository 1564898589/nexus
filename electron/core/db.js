'use strict';
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS champions (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT, nameCn TEXT, titleCn TEXT,
  imageUrl TEXT, splashUrl TEXT, positions TEXT, roles TEXT, tags TEXT,
  difficulty INTEGER, attackType TEXT, damageType TEXT, blurb TEXT, skills TEXT, updatedAt TEXT
);
CREATE TABLE IF NOT EXISTS champion_stats (
  championKey TEXT, position TEXT, region TEXT, tierFilter TEXT, patch TEXT,
  winRate REAL, pickRate REAL, banRate REAL, roleRate REAL, tier INTEGER, rank INTEGER,
  rankPrev INTEGER, rankPrevPatch INTEGER, counters TEXT, sampleSize INTEGER,
  source TEXT, fetchedAt TEXT,
  PRIMARY KEY (championKey, position, region, tierFilter, patch)
);
CREATE TABLE IF NOT EXISTS builds (
  championKey TEXT, position TEXT, region TEXT, tierFilter TEXT, patch TEXT,
  data TEXT, source TEXT, fetchedAt TEXT,
  PRIMARY KEY (championKey, position, region, tierFilter, patch)
);
CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT, nameCn TEXT, description TEXT, imageUrl TEXT, gold INTEGER, tags TEXT);
CREATE TABLE IF NOT EXISTS runes (id INTEGER PRIMARY KEY, key TEXT, name TEXT, nameCn TEXT, icon TEXT, slot INTEGER, styleId INTEGER);
CREATE TABLE IF NOT EXISTS rune_styles (id INTEGER PRIMARY KEY, key TEXT, name TEXT, nameCn TEXT, icon TEXT);
CREATE TABLE IF NOT EXISTS spells (id INTEGER PRIMARY KEY, key TEXT, name TEXT, nameCn TEXT, icon TEXT);
CREATE TABLE IF NOT EXISTS favorites (championKey TEXT PRIMARY KEY, addedAt TEXT);
CREATE TABLE IF NOT EXISTS bp_saves (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, data TEXT, createdAt TEXT);
CREATE TABLE IF NOT EXISTS prep_saves (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, data TEXT, createdAt TEXT);
CREATE TABLE IF NOT EXISTS collection_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, source TEXT, startedAt TEXT, endedAt TEXT,
  fetched INTEGER, success INTEGER, failed INTEGER, status TEXT, error TEXT, durationMs INTEGER
);
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT, createdAt TEXT, sizeBytes INTEGER, kind TEXT, integrity TEXT
);
CREATE INDEX IF NOT EXISTS idx_stats_pos ON champion_stats(position, tierFilter);
CREATE INDEX IF NOT EXISTS idx_builds_key ON builds(championKey, position);
CREATE TABLE IF NOT EXISTS players (
  puuid TEXT PRIMARY KEY, summonerId INTEGER, name TEXT, tagLine TEXT,
  serverId TEXT, region TEXT, profileIconId INTEGER, level INTEGER,
  rankTier TEXT, rankDivision TEXT, rankLp INTEGER, rankWins INTEGER, rankLosses INTEGER,
  privacy TEXT, source TEXT, fetchedAt TEXT, confidence REAL, data TEXT
);
CREATE TABLE IF NOT EXISTS matches (
  gameId INTEGER, puuid TEXT, queueId INTEGER, mode TEXT, gameCreation INTEGER, duration INTEGER,
  win INTEGER, championId INTEGER, position TEXT, kills INTEGER, deaths INTEGER, assists INTEGER,
  cs INTEGER, gold INTEGER, damage INTEGER, vision INTEGER, data TEXT, source TEXT, fetchedAt TEXT,
  PRIMARY KEY (gameId, puuid)
);
CREATE TABLE IF NOT EXISTS player_recent (puuid TEXT PRIMARY KEY, name TEXT, serverId TEXT, queriedAt TEXT);
CREATE TABLE IF NOT EXISTS player_favorites (puuid TEXT PRIMARY KEY, name TEXT, addedAt TEXT);
CREATE TABLE IF NOT EXISTS player_focus (puuid TEXT PRIMARY KEY, name TEXT, threat INTEGER, note TEXT, addedAt TEXT);
-- ==== UPGRADE: 战绩双通道查询历史（关键词+大区+通道+结果，供历史 chips 与审计）====
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT, serverId TEXT, channel TEXT,
  resultCount INTEGER, state TEXT, at TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_puuid ON matches(puuid, gameCreation);
-- ==== UPGRADE: multi-server data source registry ====
CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, region TEXT, mode TEXT,
  enabled INTEGER DEFAULT 1, autoUpdate INTEGER DEFAULT 1, intervalHours REAL DEFAULT 24,
  license TEXT, attribution TEXT, homepage TEXT,
  status TEXT DEFAULT 'pending', lastCheckAt TEXT, lastSuccessAt TEXT, lastError TEXT,
  version TEXT, fetchedAt TEXT, sampleSize INTEGER, meta TEXT
);
-- ==== UPGRADE: OP.GG 完整对位样本（counters 页，Solo/Duo 排位口径）====
CREATE TABLE IF NOT EXISTS matchups (
  championKey TEXT, position TEXT, region TEXT, tierFilter TEXT, patch TEXT,
  opponentKey TEXT, play INTEGER, win INTEGER, winRate REAL,
  source TEXT, fetchedAt TEXT,
  PRIMARY KEY (championKey, position, region, tierFilter, patch, opponentKey)
);
CREATE INDEX IF NOT EXISTS idx_matchups_champ ON matchups(championKey, position, region, tierFilter);
CREATE TABLE IF NOT EXISTS ai_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, subject TEXT, title TEXT,
  mode TEXT, model TEXT, provider TEXT, report TEXT, content TEXT, meta TEXT, createdAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_reports ON ai_reports(task, subject, id);
CREATE TABLE IF NOT EXISTS player_pool (
  puuid TEXT, championId INTEGER, proficiency TEXT, role TEXT, updatedAt TEXT,
  PRIMARY KEY (puuid, championId)
);
CREATE TABLE IF NOT EXISTS analyst_state (
  key TEXT PRIMARY KEY, fingerprint TEXT, emittedAt TEXT, dismissed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kb (
  id TEXT PRIMARY KEY, title TEXT, tags TEXT, patch TEXT, source TEXT, body TEXT, updatedAt TEXT
);
`;

// 海克斯大乱斗功能已按用户要求整体移除：旧库中残留的表在启动时清理
const DROPPED_TABLES = ['augments', 'mayhem_champion_stats', 'augment_stats', 'champion_augment_stats', 'champion_item_stats', 'mayhem_builds', 'mayhem_matches', 'mayhem_players', 'player_augments'];

async function createDb(initSqlJs, file, logger) {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let db = null;
  let recovery = null;
  // sql.js 构造不校验页：坏库会"打开成功"但每条查询都抛 malformed。启动即 quick_check。
  const quickOk = (d) => { try { const r = d.exec('PRAGMA quick_check'); return !!(r[0] && r[0].values[0] && r[0].values[0][0] === 'ok'); } catch { return false; } };
  if (fs.existsSync(file)) {
    try { db = new SQL.Database(fs.readFileSync(file)); }
    catch (e) { if (logger) logger.error('db', 'open failed', e); db = null; }
    if (db && !quickOk(db)) { if (logger) logger.error('db', 'integrity quick_check failed'); try { db.close(); } catch {} db = null; }
    if (!db) {
      // 坏库不直接覆盖：先改名留存，再尝试最新有效备份，最后才全新建库。
      const aside = file + '.corrupt-' + Date.now();
      try { fs.renameSync(file, aside); } catch (e) { if (logger) logger.error('db', 'aside rename failed', e); }
      const bakDir = path.join(path.dirname(file), 'backups');
      let restored = null;
      try {
        const cands = fs.readdirSync(bakDir).filter(f => f.endsWith('.db')).sort().reverse();
        for (const f of cands) {
          let d2 = null;
          try { d2 = new SQL.Database(fs.readFileSync(path.join(bakDir, f))); if (quickOk(d2)) { restored = { db: d2, from: f }; break; } } catch {}
          if (d2) { try { d2.close(); } catch {} }
        }
      } catch {}
      if (restored) { db = restored.db; recovery = { kind: 'backup', from: restored.from, aside, at: new Date().toISOString() }; if (logger) logger.warn('db', 'corrupt db recovered from backup', { from: restored.from, aside }); }
      else { db = new SQL.Database(); recovery = { kind: 'fresh', aside, at: new Date().toISOString() }; if (logger) logger.error('db', 'corrupt db preserved aside, starting fresh', { aside }); }
    }
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  for (const t of DROPPED_TABLES) db.run('DROP TABLE IF EXISTS ' + t);

  // 变更计数：供读侧缓存失效（queries map cache）；每次 run/transaction 自增
  let changeCount = 0;
  let persistTimer = null;
  function persist() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    const data = db.export();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, file);
  }
  // 防抖落盘：高频写合并为一次 export+rename；before-quit 调 persist() 强制 flush
  function persistSoon(ms = 400) {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; try { persist(); } catch (e) { if (logger) logger.error('db', 'persistSoon', e); } }, ms);
  }
  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }
  function get(sql, params = []) { return all(sql, params)[0] || null; }
  function run(sql, params = []) { db.run(sql, params); changeCount++; }
  function transaction(fn) {
    db.run('BEGIN');
    try { const r = fn(); db.run('COMMIT'); changeCount++; persistSoon(); return r; }
    catch (e) { try { db.run('ROLLBACK'); } catch {} throw e; }
  }
  function integrity() {
    try { const r = all('PRAGMA integrity_check'); return r[0] && r[0].integrity_check === 'ok'; }
    catch { return false; }
  }
  function counts() {
    const tables = ['champions', 'champion_stats', 'builds', 'items', 'runes', 'spells', 'favorites', 'bp_saves', 'prep_saves', 'collection_logs', 'backups', 'players', 'matches', 'player_recent', 'player_favorites', 'player_focus', 'data_sources', 'matchups', 'search_history', 'ai_reports'];
    const out = {};
    for (const t of tables) { try { out[t] = get('SELECT COUNT(*) c FROM ' + t).c; } catch { out[t] = 0; } }
    return out;
  }
  function sizeBytes() { try { return fs.statSync(file).size; } catch { return 0; } }
  // 审计/报告类表设上限，避免长期运行无限增长。
  // matches 为用户战绩缓存（可从 SGP 重新拉取）：每账号仅保留最近 200 场，防止多年累积无限膨胀，不动近期分析数据。
  function prune() {
    try { run('DELETE FROM collection_logs WHERE id NOT IN (SELECT id FROM collection_logs ORDER BY id DESC LIMIT 500)'); } catch {}
    try { run('DELETE FROM ai_reports WHERE id NOT IN (SELECT id FROM ai_reports ORDER BY id DESC LIMIT 200)'); } catch {}
    try {
      run('DELETE FROM matches WHERE rowid IN (SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY puuid ORDER BY gameCreation DESC) rn FROM matches) WHERE rn > 200)');
    } catch {}
    persist();
  }
  function setMeta(k, v) { run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, typeof v === 'string' ? v : JSON.stringify(v)]); }
  function getMeta(k) { const r = get('SELECT value FROM meta WHERE key=?', [k]); return r ? r.value : null; }
  function reload() {
    if (!fs.existsSync(file)) throw new Error('数据库文件不存在');
    const next = new SQL.Database(fs.readFileSync(file));
    next.run(SCHEMA);
    db = next;
    return integrity();
  }

  persist();
  return { raw: db, all, get, run, transaction, persist, persistSoon, changeCount: () => changeCount, integrity, counts, sizeBytes, setMeta, getMeta, reload, prune, file, SQL, recovery };
}

module.exports = { createDb, SCHEMA };