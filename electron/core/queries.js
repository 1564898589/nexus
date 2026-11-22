'use strict';
/** Read-side query helpers: join + parse DB rows into rich view models for the UI. */
const POSITIONS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function parseJson(v, def) { try { return v == null ? def : JSON.parse(v); } catch { return def; } }

// 读侧 map 缓存：以 db.changeCount() 为版本键，写操作自增即失效；避免每次 IPC 全表重建（P2-1）。
const _cache = new Map();
function cached(db, name, build) {
  const ver = typeof db.changeCount === 'function' ? db.changeCount() : 0;
  const hit = _cache.get(name);
  if (hit && hit.ver === ver) return hit.val;
  const val = build();
  _cache.set(name, { ver, val });
  return val;
}

function championMap(db) {
  return cached(db, 'champions', () => {
    const map = {};
    for (const c of db.all('SELECT * FROM champions')) {
      map[c.key] = {
        id: c.id, key: c.key, name: c.name, nameCn: c.nameCn, titleCn: c.titleCn,
        imageUrl: c.imageUrl, splashUrl: c.splashUrl,
        positions: parseJson(c.positions, []), tags: parseJson(c.tags, []),
        difficulty: c.difficulty, attackType: c.attackType, damageType: c.damageType,
        blurb: c.blurb, skills: parseJson(c.skills, null), updatedAt: c.updatedAt,
      };
    }
    return map;
  });
}

function itemMap(db) {
  return cached(db, 'items', () => {
    const m = {};
    for (const it of db.all('SELECT * FROM items')) m[it.id] = { id: it.id, name: it.name, nameCn: it.nameCn, imageUrl: it.imageUrl, gold: it.gold, description: it.description, tags: parseJson(it.tags, []) };
    return m;
  });
}
function runeMap(db) {
  return cached(db, 'runes', () => {
    const m = {};
    for (const r of db.all('SELECT * FROM runes')) m[r.id] = { id: r.id, key: r.key, name: r.name, nameCn: r.nameCn, icon: r.icon, slot: r.slot, styleId: r.styleId };
    return m;
  });
}
function styleMap(db) {
  return cached(db, 'styles', () => {
    const m = {};
    for (const s of db.all('SELECT * FROM rune_styles')) m[s.id] = { id: s.id, key: s.key, name: s.name, nameCn: s.nameCn, icon: s.icon };
    return m;
  });
}
function spellMap(db) {
  return cached(db, 'spells', () => {
    const m = {};
    for (const s of db.all('SELECT * FROM spells')) m[s.id] = { id: s.id, key: s.key, name: s.name, nameCn: s.nameCn, icon: s.icon };
    return m;
  });
}

function currentFilter(db, config) {
  return {
    region: (config && config.get('region')) || db.getMeta('region') || 'kr',
    tierFilter: (config && config.get('tier')) || db.getMeta('tier') || 'emerald_plus',
    patch: db.getMeta('patch') || null,
  };
}

// 每个服务器×段位口径各自解析最新版本，绝不拿韩服 patch 过滤国服行
function latestPatchFor(db, region, tierFilter) {
  const r = db.get('SELECT patch FROM champion_stats WHERE region=? AND tierFilter=? ORDER BY patch DESC LIMIT 1', [region, tierFilter]);
  return r ? r.patch : null;
}

function enrichStat(s, cmap) {
  const c = cmap[s.championKey] || {};
  return {
    championKey: s.championKey, championId: c.id, championName: c.nameCn || c.name || s.championKey,
    nameEn: c.name, titleCn: c.titleCn, imageUrl: c.imageUrl, splashUrl: c.splashUrl,
    tags: c.tags || [], positions: c.positions || [],
    position: s.position, region: s.region, tierFilter: s.tierFilter, patch: s.patch,
    winRate: s.winRate, pickRate: s.pickRate, banRate: s.banRate, roleRate: s.roleRate,
    tier: s.tier, rank: s.rank, rankPrev: s.rankPrev, rankPrevPatch: s.rankPrevPatch,
    counters: parseJson(s.counters, []), sampleSize: s.sampleSize, source: s.source, fetchedAt: s.fetchedAt,
  };
}

function tierList(db, config, opts = {}) {
  const f = currentFilter(db, config);
  const region = opts.region || f.region;
  const tierFilter = opts.tierFilter || f.tierFilter;
  const patch = opts.patch || latestPatchFor(db, region, tierFilter);
  const cmap = championMap(db);
  let rows = db.all('SELECT * FROM champion_stats WHERE region=? AND tierFilter=?' + (patch ? ' AND patch=?' : ''), patch ? [region, tierFilter, patch] : [region, tierFilter]);
  let stats = rows.map(s => enrichStat(s, cmap));
  if (opts.position && opts.position !== 'all') stats = stats.filter(s => s.position === opts.position);
  if (opts.search) {
    const q = String(opts.search).toLowerCase();
    stats = stats.filter(s => (s.championName || '').toLowerCase().includes(q) || (s.nameEn || '').toLowerCase().includes(q) || (s.championKey || '').toLowerCase().includes(q));
  }
  const sort = opts.sort || 'tier';
  const dir = opts.dir === 'asc' ? 1 : -1;
  const cmp = {
    tier: (a, b) => (a.tier - b.tier) || (a.rank - b.rank),
    winRate: (a, b) => a.winRate - b.winRate,
    pickRate: (a, b) => a.pickRate - b.pickRate,
    banRate: (a, b) => a.banRate - b.banRate,
    rank: (a, b) => a.rank - b.rank,
    name: (a, b) => String(a.championName).localeCompare(String(b.championName), 'zh'),
  }[sort] || ((a, b) => (a.tier - b.tier) || (a.rank - b.rank));
  stats.sort((a, b) => dir * cmp(a, b));
  return {
    filter: { region, tierFilter, patch }, positions: POSITIONS, rows: stats, total: stats.length,
    sampleSize: region === 'cn' ? null : db.getMeta('sampleSize'),
    fetchedAt: stats[0] ? stats[0].fetchedAt : db.getMeta('fetchedAt'),
    sampleUnknown: region === 'cn',
  };
}

function resolveBuild(db, data) {
  if (!data) return null;
  const items = itemMap(db), runes = runeMap(db), styles = styleMap(db), spells = spellMap(db);
  const resItems = (groups) => (groups || []).map(g => ({
    ...g,
    items: (g.items || []).map(i => {
      const it = items[i.id];
      return { id: i.id, name: it ? (it.nameCn || it.name) : i.name, nameEn: it ? it.name : i.name, imageUrl: it ? it.imageUrl : null, gold: it ? it.gold : null };
    }),
  }));
  const resPerk = (p) => p ? { ...p, nameCn: runes[p.id] ? (runes[p.id].nameCn || runes[p.id].name) : p.name, icon: runes[p.id] ? runes[p.id].icon : `perk/${p.id}.png` } : p;
  const resStyle = (s) => s ? { ...s, nameCn: styles[s.id] ? (styles[s.id].nameCn || styles[s.id].name) : s.name, icon: styles[s.id] ? styles[s.id].icon : null } : s;
  return {
    ...data,
    starterItems: resItems(data.starterItems),
    boots: resItems(data.boots),
    coreItems: resItems(data.coreItems),
    lastItems: resItems(data.lastItems),
    summonerSpells: (data.summonerSpells || []).map(sp => { const r = spells[sp.id]; return { id: sp.id, name: r ? (r.nameCn || r.name) : sp.name, icon: r ? r.icon : null }; }),
    summonerSpellPairs: (data.summonerSpellPairs || []).map(p => ({
      ...p,
      spells: (p.ids || []).map(id => { const r = spells[id]; return { id, name: r ? (r.nameCn || r.name) : ('#' + id), icon: r ? r.icon : null }; }),
    })),
    runes: (data.runes || []).map(r => ({
      ...r,
      primaryRune: resPerk(r.primaryRune),
      primaryStyle: resStyle(r.primaryStyle),
      subStyle: resStyle(r.subStyle),
      primary: (r.primary || []).map(resPerk),
      secondary: (r.secondary || []).map(resPerk),
      shards: (r.shards || []).map(resPerk),
    })),
  };
}

function getBuild(db, config, key, position, opts = {}) {
  const f = currentFilter(db, config);
  const region = opts.region || f.region, tierFilter = opts.tierFilter || f.tierFilter;
  const row = db.get('SELECT * FROM builds WHERE championKey=? AND position=? AND region=? AND tierFilter=? ORDER BY patch DESC LIMIT 1', [key, position, region, tierFilter]);
  if (!row) return null;
  let data = parseJson(row.data, null);
  // 国服缓存为 101 原始串 → 读时归一为通用形状（旧缓存无需重抓）
  if (region === 'cn' && data && data.build && !data.coreItems) data = require('../providers/cn101').normalize(data, db);
  const resolved = resolveBuild(db, data);
  // 加点顺序全覆盖：主来源缺加点时回退已缓存的国服 101 官方 skill_point（真实官方，离线可用），标明来源
  if (resolved && !(resolved.skillOrder && resolved.skillOrder.length) && region !== 'cn') {
    const cnRow = db.get('SELECT * FROM builds WHERE championKey=? AND position=? AND region=? ORDER BY patch DESC LIMIT 1', [key, position, 'cn']);
    if (cnRow) {
      let cnData = parseJson(cnRow.data, null);
      if (cnData && cnData.build && !cnData.coreItems) cnData = require('../providers/cn101').normalize(cnData, db);
      if (cnData && cnData.skillOrder && cnData.skillOrder.length) { resolved.skillOrder = cnData.skillOrder; resolved.skillOrderSource = 'cn101-official'; }
    }
  }
  return { championKey: key, position, region, tierFilter, patch: row.patch, source: row.source, fetchedAt: row.fetchedAt, data: resolved };
}

function getChampion(db, config, key) {
  const cmap = championMap(db);
  const c = cmap[key];
  if (!c) return null;
  const f = currentFilter(db, config);
  const stats = db.all('SELECT * FROM champion_stats WHERE championKey=? AND region=? AND tierFilter=?', [key, f.region, f.tierFilter]).map(s => enrichStat(s, cmap));
  const builds = {};
  for (const p of POSITIONS) { const b = getBuild(db, config, key, p); if (b) builds[p] = b; }
  const favorite = !!db.get('SELECT 1 x FROM favorites WHERE championKey=?', [key]);
  return { ...c, stats, builds, favorite, filter: f };
}

function listChampions(db, opts = {}) {
  const cmap = championMap(db);
  let arr = Object.values(cmap);
  if (opts.search) { const q = String(opts.search).toLowerCase(); arr = arr.filter(c => (c.nameCn || '').toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q) || (c.key || '').toLowerCase().includes(q)); }
  if (opts.position && opts.position !== 'all') arr = arr.filter(c => (c.positions || []).includes(opts.position));
  arr.sort((a, b) => String(a.nameCn || a.name).localeCompare(String(b.nameCn || b.name), 'zh'));
  return arr;
}

function countersFor(db, config, key, position) {
  const cmap = championMap(db);
  const f = currentFilter(db, config);
  const rows = db.all('SELECT * FROM champion_stats WHERE position=? AND region=? AND tierFilter=?', [position, f.region, f.tierFilter]);
  const mine = rows.find(r => r.championKey === key);
  const enrich = (c, perspective) => { const ch = cmap[c.championKey] || {}; return { ...c, perspective, championName: ch.nameCn || ch.name || c.championKey, imageUrl: ch.imageUrl, nameEn: ch.name }; };
  // 正向：我的行里是我对各对手的胜率（OP.GG 公开榜只收录最劣势 3 个对位）
  const forward = mine ? parseJson(mine.counters, []).filter(c => c.winRate != null).map(c => enrich(c, 'mine')) : [];
  // 反向：别人的行里把我当对手 → 我的胜率 = 1 - 对方胜率（同一批对局样本，非伪造）
  const reverse = [];
  for (const r of rows) {
    if (r.championKey === key) continue;
    const c = parseJson(r.counters, []).find(x => x.championKey === key);
    if (c && c.winRate != null) {
      reverse.push(enrich({
        championKey: r.championKey, championId: (cmap[r.championKey] || {}).id,
        play: c.play ?? null, win: c.play != null && c.win != null ? c.play - c.win : null, winRate: 1 - c.winRate,
      }, 'reverse'));
    }
  }
  const byKey = {};
  for (const c of [...forward, ...reverse]) if (!byKey[c.championKey]) byKey[c.championKey] = c;
  const all = Object.values(byKey);
  const strong = all.filter(c => c.winRate >= 0.5).sort((a, b) => b.winRate - a.winRate);
  const weak = all.filter(c => c.winRate < 0.5).sort((a, b) => a.winRate - b.winRate);
  const ref = mine || rows[0] || null;
  return { strong, weak, all, position, sampleSize: ref ? ref.sampleSize : null, source: ref ? ref.source : null, fetchedAt: ref ? ref.fetchedAt : null };
}

function metaStats(db, config) {
  const f = currentFilter(db, config);
  const cmap = championMap(db);
  return db.all('SELECT * FROM champion_stats WHERE region=? AND tierFilter=?', [f.region, f.tierFilter]).map(s => enrichStat(s, cmap));
}

/**
 * Position-aware champion pool for pickers (BP / prep).
 * Real data only: a champion qualifies for a position when OP.GG has a stat row
 * for that position, OR OP.GG meta lists the position (multi-role champions).
 * Meta-only candidates carry pending=true ("位置待确认") and NO invented stats.
 * Sort/search/tier/favorite filters all operate on the same real rows.
 */
function pickerPool(db, config, opts = {}) {
  const f = currentFilter(db, config);
  const region = opts.region || f.region, tierFilter = opts.tierFilter || f.tierFilter;
  const cmap = championMap(db);
  const rows = db.all('SELECT * FROM champion_stats WHERE region=? AND tierFilter=?' + (f.patch ? ' AND patch=?' : ''), f.patch ? [region, tierFilter, f.patch] : [region, tierFilter]).map(s => enrichStat(s, cmap));
  const byKey = {};
  for (const s of rows) (byKey[s.championKey] = byKey[s.championKey] || []).push(s);
  const favs = new Set(db.all('SELECT championKey FROM favorites').map(r => r.championKey));
  const position = opts.position && opts.position !== 'all' ? opts.position : 'all';
  let list = [];
  for (const c of Object.values(cmap)) {
    const all = byKey[c.key] || [];
    let stat = null, pending = false;
    if (position === 'all') {
      stat = all.slice().sort((a, b) => ((a.tier || 9) - (b.tier || 9)) || ((a.rank || 999) - (b.rank || 999)))[0] || null;
    } else {
      stat = all.find(s => s.position === position) || null;
      const inMeta = (c.positions || []).includes(position);
      if (!stat && !inMeta) continue; // no real evidence this champion plays here
      if (!stat) pending = true;      // meta lists the position but no stat sample
    }
    list.push({ ...c, stat, pending, favorite: favs.has(c.key), statPositions: all.map(s => s.position) });
  }
  if (opts.search) {
    const q = String(opts.search).toLowerCase();
    list = list.filter(x => (x.nameCn || '').toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q) || (x.key || '').toLowerCase().includes(q));
  }
  if (opts.tier) list = list.filter(x => x.stat && x.stat.tier === opts.tier);
  if (opts.favOnly) list = list.filter(x => x.favorite);
  const sort = opts.sort || 'tier';
  const dir = opts.dir === 'desc' ? -1 : 1;
  const val = (x) => !x.stat ? null : sort === 'winRate' ? x.stat.winRate : sort === 'pickRate' ? x.stat.pickRate : sort === 'banRate' ? x.stat.banRate : sort === 'tier' ? x.stat.tier : null;
  list.sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? 1 : -1; // 位置待确认 always last
    if (sort === 'name') return dir * String(a.nameCn || a.name).localeCompare(String(b.nameCn || b.name), 'zh');
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return String(a.nameCn || a.name).localeCompare(String(b.nameCn || b.name), 'zh');
    if (va == null) return 1;
    if (vb == null) return -1;
    return dir * (va - vb) || (((a.stat && a.stat.rank) || 999) - ((b.stat && b.stat.rank) || 999));
  });
  return { filter: { region, tierFilter, patch: f.patch }, position, rows: list, total: list.length, fetchedAt: db.getMeta('fetchedAt'), sampleSize: db.getMeta('sampleSize') };
}

module.exports = { POSITIONS, championMap, itemMap, runeMap, styleMap, spellMap, currentFilter, latestPatchFor, enrichStat, tierList, resolveBuild, getBuild, getChampion, listChampions, countersFor, metaStats, pickerPool, parseJson };