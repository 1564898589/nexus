'use strict';
/** Data quality checks. Returns issues with severity; never mutates data. */
function runQualityChecks(db, config) {
  const issues = [];
  const add = (level, code, message, count = 1) => issues.push({ level, code, message, count });

  const champKeys = new Set(db.all('SELECT key FROM champions').map(r => r.key));
  const champIds = new Set(db.all('SELECT id FROM champions').map(r => r.id));
  const itemIds = new Set(db.all('SELECT id FROM items').map(r => r.id));
  const stats = db.all('SELECT * FROM champion_stats');
  const builds = db.all('SELECT * FROM builds');

  // missing champions referenced by stats
  const orphanStats = stats.filter(s => !champKeys.has(s.championKey));
  if (orphanStats.length) add('warn', 'orphan-stats', `${orphanStats.length} 条统计指向未收录的英雄`, orphanStats.length);

  // invalid champion ids
  const badIds = db.all('SELECT id,key FROM champions').filter(r => !Number.isInteger(r.id) || r.id <= 0);
  if (badIds.length) add('error', 'invalid-champion-id', `${badIds.length} 个英雄 ID 非法`, badIds.length);

  // anomalous stat values
  const anomaly = stats.filter(s =>
    (s.winRate != null && (s.winRate < 0 || s.winRate > 1)) ||
    (s.pickRate != null && (s.pickRate < 0 || s.pickRate > 1)) ||
    (s.banRate != null && (s.banRate < 0 || s.banRate > 1)));
  if (anomaly.length) add('error', 'stat-anomaly', `${anomaly.length} 条统计值超出合理范围 [0,1]`, anomaly.length);

  // builds referencing unknown items
  let badItemRefs = 0;
  for (const b of builds) {
    let d; try { d = JSON.parse(b.data); } catch { add('error', 'build-parse', `英雄 ${b.championKey} 的出装数据无法解析`); continue; }
    const groups = [...(d.coreItems || []), ...(d.starterItems || []), ...(d.boots || []), ...(d.lastItems || [])];
    for (const g of groups) for (const it of (g.items || [])) if (itemIds.size && !itemIds.has(it.id)) badItemRefs++;
  }
  if (badItemRefs) add('warn', 'unknown-item', `${badItemRefs} 处出装引用了装备库中不存在的 ID`, badItemRefs);

  // version consistency
  const metaPatch = db.getMeta('patch');
  const patches = new Set(stats.map(s => s.patch).filter(Boolean));
  if (metaPatch && patches.size && [...patches].some(p => p !== metaPatch)) add('warn', 'patch-mismatch', '统计版本与当前元数据版本不一致');

  // source consistency
  const sources = new Set(stats.map(s => s.source));
  if (sources.size > 1) add('warn', 'source-mixed', `统计来源不唯一: ${[...sources].join(', ')}`);

  // staleness
  const fetchedAt = db.getMeta('fetchedAt');
  if (fetchedAt) {
    const hours = (Date.now() - new Date(fetchedAt).getTime()) / 3600000;
    const limit = (config && config.get('updateIntervalHours')) || 6;
    if (hours > limit * 3) add('warn', 'stale', `数据已 ${hours.toFixed(1)} 小时未更新（阈值 ${limit}h）`);
  } else if (stats.length) {
    add('warn', 'no-timestamp', '统计缺少采集时间戳');
  }

  // empty core tables
  if (!champKeys.size) add('error', 'empty-champions', '英雄库为空');
  if (!stats.length) add('error', 'empty-stats', '强度统计为空');
  if (!itemIds.size) add('warn', 'empty-items', '装备库为空');

  // duplicate stats (PK should prevent)
  const dup = db.all('SELECT championKey,position,region,tierFilter,patch,COUNT(*) c FROM champion_stats GROUP BY championKey,position,region,tierFilter,patch HAVING c>1');
  if (dup.length) add('error', 'duplicate-stats', `${dup.length} 组重复统计`, dup.length);

  const errors = issues.filter(i => i.level === 'error').length;
  const warns = issues.filter(i => i.level === 'warn').length;
  return { healthy: errors === 0, errors, warns, issues, checkedAt: new Date().toISOString() };
}

module.exports = { runQualityChecks };