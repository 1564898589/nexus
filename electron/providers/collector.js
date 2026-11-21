'use strict';
/**
 * NEXUS DATA ENGINE collector. Fetches OP.GG (KR) statistics + Riot Data Dragon
 * static data, downloads assets, then commits in a single transaction only after
 * integrity validation. On any failure the previous good data is preserved.
 */
const opgg = require('./opgg');
const dd = require('./datadragon');
const Q = require('../core/queries');
const { fetchText, sleep } = require('../core/net');

const POSITIONS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const opggPos = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPPORT: 'support' };

function logTask(db, task, source, startedAt, result) {
  const endedAt = new Date().toISOString();
  db.run('INSERT INTO collection_logs(task,source,startedAt,endedAt,fetched,success,failed,status,error,durationMs) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [task, source, startedAt, endedAt, result.fetched || 0, result.success || 0, result.failed || 0, result.status, result.error || null, new Date(endedAt) - new Date(startedAt)]);
}

async function collect(ctx, opts = {}) {
  const { db, logger, config, assets } = ctx;
  const log = logger.child('collector');
  const progress = opts.progress || (() => {});
  const force = !!opts.force;
  const region = opts.region || config.get('region') || 'kr';
  const tier = opts.tier || config.get('tier') || 'emerald_plus';
  const detailConcurrency = opts.concurrency || 3;
  const startedAt = new Date().toISOString();
  const summary = { fetched: 0, success: 0, failed: 0, status: 'ok', error: null };

  try {
    // ---- Phase A: OP.GG tier list ----
    progress({ phase: 'tier', message: '正在获取 OP.GG 韩服强度榜…', done: 0, total: 1 });
    const tierUrl = `https://op.gg/lol/champions?region=${region}&tier=${tier}&type=ranked`;
    const tierHtml = await fetchText(tierUrl, { retries: 2 });
    const tierData = opgg.parseTierList(tierHtml, { region, tier, mode: 'ranked' });
    if (!tierData.stats.length) throw new Error('OP.GG 强度榜解析为空（页面结构可能已变更）');
    summary.fetched += tierData.stats.length;
    log.info('tier list parsed', { champions: tierData.champions.length, stats: tierData.stats.length, patch: tierData.patch });

    // ---- Phase B: Data Dragon static ----
    progress({ phase: 'static', message: '正在同步 Riot 官方静态资料…', done: 0, total: 1 });
    const ddVersion = await dd.getLatestVersion();
    const prevVersion = db.getMeta('ddVersion');
    const needStatic = force || prevVersion !== ddVersion || !db.get('SELECT COUNT(*) c FROM champions').c;
    let ddSummary = null, ddItems = null, ddRunes = null, ddSpells = null;
    const ddFull = {};
    if (needStatic) {
      ddSummary = await dd.getChampionSummary(ddVersion);
      ddItems = await dd.getItems(ddVersion);
      ddRunes = await dd.getRunes(ddVersion);
      ddSpells = await dd.getSpells(ddVersion);
      // full champion data (CN skills) — keyed by numeric id
      const byId = {};
      for (const k of Object.keys(ddSummary)) byId[parseInt(ddSummary[k].key, 10)] = ddSummary[k];
      const keys = tierData.champions.map(c => byId[c.id]).filter(Boolean);
      let done = 0;
      for (let i = 0; i < keys.length; i += detailConcurrency) {
        const batch = keys.slice(i, i + detailConcurrency);
        await Promise.all(batch.map(async (rec) => {
          const numId = parseInt(rec.key, 10);
          try { ddFull[numId] = await dd.getChampionFull(ddVersion, rec.id); summary.success++; }
          catch (e) { summary.failed++; log.warn('dd full failed', { key: rec.id }); }
        }));
        done += batch.length;
        progress({ phase: 'static', message: `同步英雄技能资料 ${done}/${keys.length}`, done, total: keys.length });
        await sleep(120);
      }
    }

    // ---- Phase C: OP.GG per-champion builds ----
    const existingBuilds = new Set(db.all('SELECT championKey,position,patch FROM builds').map(b => `${b.championKey}|${b.position}|${b.patch}`));
    const targets = [];
    for (const st of tierData.stats) {
      const champ = tierData.champions.find(c => c.key === st.championKey);
      if (!champ) continue;
      const k = `${st.championKey}|${st.position}|${tierData.patch}`;
      if (!force && existingBuilds.has(k)) continue;
      targets.push({ key: st.championKey, position: st.position, id: champ.id });
    }
    const details = [];
    let cdone = 0;
    for (let i = 0; i < targets.length; i += detailConcurrency) {
      const batch = targets.slice(i, i + detailConcurrency);
      await Promise.all(batch.map(async (t) => {
        const url = `https://op.gg/lol/champions/${t.key}/build/${opggPos[t.position]}?region=${region}&tier=${tier}`;
        try {
          const html = await fetchText(url, { retries: 1, timeout: 25000 });
          const det = opgg.parseDetail(html, { championKey: t.key, position: t.position, region, tier });
          details.push(det); summary.success++; summary.fetched++;
        } catch (e) { summary.failed++; log.warn('detail failed', { key: t.key, pos: t.position, error: String(e.message || e) }); }
      }));
      cdone += batch.length;
      progress({ phase: 'builds', message: `获取出装符文 ${cdone}/${targets.length}`, done: cdone, total: targets.length });
      await sleep(200);
    }

    // ---- Phase D: assets ----
    progress({ phase: 'assets', message: '下载英雄原画与图标…', done: 0, total: 1 });
    const byId = {};
    if (ddSummary) for (const k of Object.keys(ddSummary)) byId[parseInt(ddSummary[k].key, 10)] = ddSummary[k];
    let adone = 0;
    const champList = tierData.champions;
    for (let i = 0; i < champList.length; i += 6) {
      const batch = champList.slice(i, i + 6);
      await Promise.all(batch.map(async (c) => {
        const rec = byId[c.id];
        const ddKey = rec ? rec.id : c.name;
        await assets.download(dd.urls.championSquare(ddVersion, ddKey), `champion/${c.key}.png`);
        await assets.download(dd.urls.championSplash(ddKey), `splash/${c.key}.jpg`);
        const full = ddFull[c.id];
        if (full) {
          if (full.passive && full.passive.image) await assets.download(`${dd.cdn(ddVersion)}/img/passive/${full.passive.image.full}`, `passive/${c.key}.png`);
          await Promise.all((full.spells || []).map((sp, idx) => {
            const k = ['Q', 'W', 'E', 'R'][idx];
            return sp.image ? assets.download(`${dd.cdn(ddVersion)}/img/spell/${sp.image.full}`, `ability/${c.key}_${k}.png`) : null;
          }));
        }
      }));
      adone += batch.length;
      progress({ phase: 'assets', message: `下载素材 ${adone}/${champList.length}`, done: adone, total: champList.length });
    }
    if (ddItems) {
      const ids = Object.keys(ddItems);
      for (let i = 0; i < ids.length; i += 12) {
        await Promise.all(ids.slice(i, i + 12).map(id => assets.download(dd.urls.item(ddVersion, id), `item/${id}.png`)));
      }
    }
    if (ddSpells) for (const k of Object.keys(ddSpells)) await assets.download(dd.urls.spell(ddVersion, ddSpells[k].image.full.replace(/\.png$/, '')), `spell/${ddSpells[k].id}.png`);
    if (ddRunes) for (const style of ddRunes) {
      await assets.download(`https://ddragon.leagueoflegends.com/cdn/img/${style.icon}`, `style/${style.id}.png`);
      for (const slot of style.slots || []) for (const r of slot.runes || []) await assets.download(`https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`, `perk/${r.id}.png`);
    }
    // Stat shards & any OP.GG perk icons not present in Data Dragon (cached locally).
    const shardSeen = new Set();
    for (const d of details) for (const r of d.runes || []) {
      const perks = [r.primaryRune, ...(r.primary || []), ...(r.secondary || []), ...(r.shards || [])].filter(Boolean);
      for (const p of perks) {
        if (!p.id || shardSeen.has(p.id)) continue;
        shardSeen.add(p.id);
        if (p.imageUrl && !assets.has(`perk/${p.id}.png`)) await assets.download(p.imageUrl, `perk/${p.id}.png`);
      }
    }

    // ---- Phase E: commit in transaction + integrity ----
    progress({ phase: 'commit', message: '校验并写入本地数据库…', done: 0, total: 1 });
    db.transaction(() => {
      // champions
      for (const c of tierData.champions) {
        const rec = byId[c.id];
        const full = ddFull[c.id];
        let norm = null;
        if (full) norm = dd.normalizeChampion(full, rec);
        const existing = db.get('SELECT * FROM champions WHERE id=?', [c.id]);
        const nameCn = norm ? norm.nameCn : (rec ? rec.title : (existing ? existing.nameCn : c.name));
        const titleCn = norm ? norm.titleCn : (rec ? rec.name : (existing ? existing.titleCn : null));
        const blurb = norm ? norm.blurb : (rec ? rec.blurb : (existing ? existing.blurb : null));
        const tags = norm ? norm.tags : (rec ? rec.tags : (existing ? JSON.parse(existing.tags || '[]') : []));
        const skills = norm ? { passive: norm.passive, spells: norm.spells } : (existing ? JSON.parse(existing.skills || 'null') : null);
        db.run(`INSERT INTO champions(id,key,name,nameCn,titleCn,imageUrl,splashUrl,positions,roles,tags,difficulty,attackType,damageType,blurb,skills,updatedAt)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET key=excluded.key,name=excluded.name,nameCn=excluded.nameCn,titleCn=excluded.titleCn,
          imageUrl=excluded.imageUrl,splashUrl=excluded.splashUrl,positions=excluded.positions,tags=excluded.tags,
          difficulty=excluded.difficulty,attackType=excluded.attackType,damageType=excluded.damageType,blurb=excluded.blurb,skills=excluded.skills,updatedAt=excluded.updatedAt`,
          [c.id, c.key, c.name, nameCn, titleCn, `champion/${c.key}.png`, `splash/${c.key}.jpg`,
            JSON.stringify(c.positions), JSON.stringify(c.positions), JSON.stringify(tags),
            norm ? norm.difficulty : (rec && rec.info ? rec.info.difficulty : null),
            norm ? norm.attackType : null, norm ? norm.damageType : null, blurb, JSON.stringify(skills), new Date().toISOString()]);
      }
      // stats
      for (const s of tierData.stats) {
        db.run(`INSERT INTO champion_stats(championKey,position,region,tierFilter,patch,winRate,pickRate,banRate,roleRate,tier,rank,rankPrev,rankPrevPatch,counters,sampleSize,source,fetchedAt)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(championKey,position,region,tierFilter,patch) DO UPDATE SET winRate=excluded.winRate,pickRate=excluded.pickRate,banRate=excluded.banRate,
          roleRate=excluded.roleRate,tier=excluded.tier,rank=excluded.rank,rankPrev=excluded.rankPrev,rankPrevPatch=excluded.rankPrevPatch,
          counters=excluded.counters,sampleSize=excluded.sampleSize,source=excluded.source,fetchedAt=excluded.fetchedAt`,
          [s.championKey, s.position, region, tier, tierData.patch, s.winRate, s.pickRate, s.banRate, s.roleRate, s.tier, s.rank, s.rankPrev, s.rankPrevPatch, JSON.stringify(s.counters), tierData.sampleSize, 'opgg', tierData.fetchedAt]);
      }
      // builds
      for (const d of details) {
        db.run(`INSERT INTO builds(championKey,position,region,tierFilter,patch,data,source,fetchedAt) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(championKey,position,region,tierFilter,patch) DO UPDATE SET data=excluded.data,source=excluded.source,fetchedAt=excluded.fetchedAt`,
          [d.championKey, d.position, region, tier, d.patch || tierData.patch, JSON.stringify(d), 'opgg', d.fetchedAt]);
      }
      // items / runes / spells
      if (ddItems) for (const id of Object.keys(ddItems)) {
        const it = ddItems[id];
        db.run('INSERT INTO items(id,name,nameCn,description,imageUrl,gold,tags) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,nameCn=excluded.nameCn,description=excluded.description,imageUrl=excluded.imageUrl,gold=excluded.gold,tags=excluded.tags',
          [parseInt(id, 10), it.name, it.name, it.description || it.plaintext || null, `item/${id}.png`, it.gold ? it.gold.total : null, JSON.stringify(it.tags || [])]);
      }
      if (ddRunes) for (const style of ddRunes) {
        db.run('INSERT INTO rune_styles(id,key,name,nameCn,icon) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,nameCn=excluded.nameCn,icon=excluded.icon',
          [style.id, style.key, style.name, style.name, `style/${style.id}.png`]);
        let slotIdx = 0;
        for (const slot of style.slots || []) for (const r of slot.runes || []) {
          db.run('INSERT INTO runes(id,key,name,nameCn,icon,slot,styleId) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,nameCn=excluded.nameCn,icon=excluded.icon,slot=excluded.slot,styleId=excluded.styleId',
            [r.id, r.key, r.name, r.name, `perk/${r.id}.png`, slotIdx, style.id]);
          slotIdx++;
        }
      }
      if (ddSpells) for (const k of Object.keys(ddSpells)) {
        const sp = ddSpells[k];
        db.run('INSERT INTO spells(id,key,name,nameCn,icon) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,nameCn=excluded.nameCn,icon=excluded.icon',
          [parseInt(sp.id, 10) || sp.key, sp.key, sp.name, sp.name, `spell/${sp.id}.png`]);
      }
      db.setMeta('patch', tierData.patch);
      db.setMeta('ddVersion', ddVersion);
      db.setMeta('region', region);
      db.setMeta('tier', tier);
      db.setMeta('sampleSize', tierData.sampleSize);
      db.setMeta('fetchedAt', new Date().toISOString());
      db.setMeta('lastSuccessAt', new Date().toISOString());
    });

    if (!db.integrity()) {
      throw new Error('写入后完整性校验失败');
    }
    db.persist();
    summary.status = 'ok';
    logTask(db, force ? 'full-sync' : 'incremental-sync', 'opgg+datadragon', startedAt, summary);
    db.persist();
    progress({ phase: 'done', message: '数据更新完成', done: 1, total: 1 });
    return { ok: true, summary, patch: tierData.patch, ddVersion, stats: tierData.stats.length, builds: details.length };
  } catch (e) {
    summary.status = 'failed';
    summary.error = String(e.message || e);
    log.error('collection failed', e);
    try { logTask(db, force ? 'full-sync' : 'incremental-sync', 'opgg+datadragon', startedAt, summary); db.persist(); } catch {}
    progress({ phase: 'error', message: '更新失败：' + summary.error + '（已保留原有数据）', done: 0, total: 1 });
    return { ok: false, summary, error: summary.error };
  }
}

// ---- 完整对位样本（OP.GG counters 页，Solo/Duo）----------------------------------
// 单英雄单位置：抓取 → 解析 → 事务写入 → 完整性校验。失败抛错，旧数据不动。
async function collectMatchupPage(ctx, championKey, position, opts = {}) {
  const { db, logger, config } = ctx;
  const log = logger.child('matchup');
  const region = opts.region || config.get('region') || 'kr';
  const tier = opts.tier || config.get('tier') || 'emerald_plus';
  const url = `https://op.gg/lol/champions/${championKey}/counters/${opggPos[position]}?region=${region}&tier=${tier}&type=ranked`;
  const html = await fetchText(url, { retries: 2, timeout: 30000 });
  const data = opgg.parseCounters(html, { region, tier, patch: opts.patch });
  if (!data.patch) throw new Error('对位页版本解析失败（页面结构可能已变更）');
  if (data.rows.length) {
    db.transaction(() => {
      db.run('DELETE FROM matchups WHERE championKey=? AND position=? AND region=? AND tierFilter=? AND patch=?',
        [championKey, position, region, tier, data.patch]);
      for (const r of data.rows) {
        db.run(`INSERT INTO matchups(championKey,position,region,tierFilter,patch,opponentKey,play,win,winRate,source,fetchedAt)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [championKey, position, region, tier, data.patch, r.opponentKey, r.play, r.win, r.winRate, 'opgg-matchup', data.fetchedAt]);
      }
    });
    if (!db.integrity()) throw new Error('对位样本写入后完整性校验失败');
    db.persist();
  }
  log.info('matchup page collected', { championKey, position, region, tier, patch: data.patch, rows: data.rows.length });
  return { patch: data.patch, rows: data.rows, fetchedAt: data.fetchedAt };
}

// 批量采集当前口径全部英雄×位置（数据源 kr-opgg-matchups 的 collect）。
// 礼貌限速 1s/页；单页失败不中断；已存在的组合默认跳过（force 全量重采）。
async function collectMatchups(ctx, opts = {}) {
  const { db, logger, config } = ctx;
  const log = logger.child('matchups');
  const progress = opts.progress || (() => {});
  const region = opts.region || config.get('region') || 'kr';
  const tier = opts.tier || config.get('tier') || 'emerald_plus';
  const startedAt = new Date().toISOString();
  const patch = Q.latestPatchFor(db, region, tier);
  if (!patch) return { ok: false, error: '当前服务器/段位尚无强度榜数据，请先更新 OP.GG 数据', fetched: 0, success: 0, failed: 0 };
  const targets = db.all('SELECT championKey, position FROM champion_stats WHERE region=? AND tierFilter=? AND patch=?', [region, tier, patch]);
  const existing = new Set(db.all('SELECT championKey, position FROM matchups WHERE region=? AND tierFilter=? AND patch=?', [region, tier, patch]).map(r => r.championKey + '|' + r.position));
  const todo = opts.force ? targets : targets.filter(t => !existing.has(t.championKey + '|' + t.position));
  let success = 0, failed = 0, fetched = 0, done = 0;
  progress({ phase: 'matchups', message: `准备采集对位样本 ${todo.length} 组（跳过已有 ${targets.length - todo.length}）`, done: 0, total: todo.length || 1 });
  for (const t of todo) {
    try {
      const r = await collectMatchupPage(ctx, t.championKey, t.position, { region, tier, patch });
      success++; fetched += r.rows.length;
    } catch (e) {
      failed++;
      log.warn('matchup collect failed', { key: t.championKey, pos: t.position, error: String(e.message || e) });
    }
    done++;
    progress({ phase: 'matchups', message: `采集对位样本 ${done}/${todo.length} · ${t.championKey} ${t.position}`, done, total: todo.length });
    await sleep(1000);
  }
  const result = {
    ok: success > 0 || todo.length === 0,
    version: patch, fetched, success, failed,
    meta: { region, tier, total: targets.length, skipped: targets.length - todo.length },
  };
  if (!result.ok) result.error = '全部对位页采集失败（网络或页面结构变更），已保留原有数据';
  logTask(db, 'matchup-crawl', 'opgg-matchups', startedAt, { ...result, status: result.ok ? 'ok' : 'failed' });
  db.persist();
  return result;
}

// 单英雄出装页懒刷新：缓存形状过旧（缺组合/加点解析）时按需重抓一页并落库，礼貌限速由调用方控制
async function refreshDetail(ctx, championKey, position, opts = {}) {
  const { db, logger, config } = ctx;
  const log = logger.child('collector');
  const region = opts.region || (config && config.get('region')) || 'kr';
  const tier = opts.tierFilter || (config && config.get('tier')) || 'emerald_plus';
  const url = `https://op.gg/lol/champions/${championKey}/build/${opggPos[position]}?region=${region}&tier=${tier}`;
  const html = await fetchText(url, { retries: 1, timeout: 25000 });
  const det = opgg.parseDetail(html, { championKey, position, region, tier });
  if (!det.coreItems.length && !det.runes.length) throw new Error('OP.GG 详情页解析为空（页面结构可能已变更）');
  db.run(`INSERT INTO builds(championKey,position,region,tierFilter,patch,data,source,fetchedAt) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(championKey,position,region,tierFilter,patch) DO UPDATE SET data=excluded.data,source=excluded.source,fetchedAt=excluded.fetchedAt`,
    [championKey, position, region, tier, det.patch || db.getMeta('patch'), JSON.stringify(det), 'opgg', det.fetchedAt]);
  db.persist();
  log.info('detail refreshed', { championKey, position, region, tier });
  return det;
}

module.exports = { collect, collectMatchupPage, collectMatchups, refreshDetail, POSITIONS, opggPos };