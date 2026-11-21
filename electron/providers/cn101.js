'use strict';
/**
 * NEXUS CN provider — 腾讯官方 101 攻略中心公开数据（https://101.qq.com/）。
 * 通道：mlol.qt.qq.com/go/battle_info/odp_proxy/{数据集}（公开 GET，无登录/签名/验证码，已实测）。
 * 静态字典：game.gtimg.cn（英雄/装备/符文）。
 * 合规：普通浏览器 UA + Referer，礼貌限速（并发1、间隔≥1s）；个人非商业用途、本地缓存、注明来源；
 *       不使用任何 bot 类 UA（gtimg robots 明确封禁 AI 爬虫）；不绕过任何访问控制。
 * 诚实性：内部接口无 SLA，解析失败保留旧数据并如实报错；官方接口无样本量字段 → sampleSize=null（未知）。
 * 关键坑（实测）：lane 必须大写（MIDDLE/BOTTOM）；version_id 用版本名。
 */
const { fetchJson, sleep } = require('../core/net');

const GATEWAY = 'https://mlol.qt.qq.com/go/battle_info/odp_proxy/';
const DBASE = 'https://mlol.qt.qq.com/go/database/';
const HDRS = { Referer: 'https://101.qq.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' };
const LANE_MAP = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'ADC', SUPPORT: 'SUPPORT', ALL: 'ALL' };
const LANE_REV = { TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MIDDLE', ADC: 'BOTTOM', SUPPORT: 'SUPPORT' };
// itier ↔ NEXUS tierFilter（只导入有明确语义的口径，其余段位按需懒加载）
const ITIER = { all: 255, emerald_plus: 26, summit: 88 };
const ITIER_REV = { 255: 'all', 26: 'emerald_plus', 88: 'summit' };
const TIER_CN = { 1: '黑铁', 2: '黄铜', 3: '白银', 4: '黄金', 5: '铂金', 6: '翡翠', 7: '钻石', 8: '大师', 9: '宗师', 10: '王者', 24: '黄金+', 25: '铂金+', 26: '翡翠+', 27: '钻石+', 28: '大师+', 29: '宗师', 88: '峡谷之巅', 255: '全段位' };

async function odp(dataset, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const j = await fetchJson(GATEWAY + dataset + '?' + qs, { headers: HDRS, retries: 2, timeout: 30000 });
  if (j.code !== 0 && j.result !== 0) throw new Error(`101 ${dataset} 返回错误 code=${j.code} ${j.errMsg || ''}`);
  const fv = j.data && j.data._fieldValues;
  if (!fv) return null;
  const key = Object.keys(fv)[0];
  if (!key || !fv[key]) return null;
  try { return JSON.parse(fv[key]); } catch { return { __raw: fv[key] }; }
}
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const pct = (x) => { const n = num(x); return n == null ? null : n / 100; };

async function latestVersions() {
  const j = await fetchJson(DBASE + 'versionlist?zone=lol&from=h5', { headers: HDRS, retries: 2 });
  const list = Array.isArray(j.data) ? j.data : [];
  return list.map(v => ({ id: v.id, name: v.name, vkey: v.vkey, publicDate: v.public_date, key: v.key }));
}

// ---------- 召唤师峡谷强度榜 ----------
function parseRankRows(inner, keyMap, tierFilter, patch, fetchedAt) {
  const rows = [];
  if (!inner || !inner.datadetails) return rows;
  for (const line of String(inner.datadetails).split('#')) {
    const f = line.split('_');
    if (f.length < 8) continue;
    const key = keyMap[f[1]];
    if (!key) continue;
    const lane = LANE_MAP[f[3]];
    if (!lane || lane === 'ALL') continue;
    const counters = (f[7] || '').split(',').filter(Boolean).map(id => ({ championKey: keyMap[id] || null, championId: num(id), winRate: null })).filter(c => c.championKey);
    rows.push({
      championKey: key, position: lane, region: 'cn', tierFilter, patch,
      winRate: pct(f[4]), pickRate: pct(f[5]), banRate: pct(f[6]), roleRate: null,
      tier: /^T\d+$/.test(f[2]) ? parseInt(f[2].slice(1), 10) : null,
      rank: num(f[0]), rankPrev: null, rankPrevPatch: null,
      counters: JSON.stringify(counters), sampleSize: null, // 官方榜不提供样本量 → 未知
      source: '101-official', fetchedAt,
    });
  }
  return rows;
}

async function collectRanked(ctx, opts = {}) {
  const { db, logger } = ctx;
  const log = logger.child('cn101');
  const progress = opts.progress || (() => {});
  const keyMap = {};
  for (const c of db.all('SELECT id, key FROM champions')) keyMap[String(c.id)] = c.key;
  if (!Object.keys(keyMap).length) throw new Error('本地英雄资料库为空，请先更新韩服/官方静态数据');

  progress({ phase: 'version', message: '获取国服版本列表…', done: 0, total: 1 });
  const versions = await latestVersions();
  if (!versions.length) throw new Error('国服版本列表为空');
  let patch = null, inner = null;
  // 新版本首日榜单可能为空 → 自动回退上一版本（与官方前端行为一致）
  for (const v of versions.slice(0, 3)) {
    await sleep(1000);
    const r = await odp('lol_101strategy', { itier: ITIER.emerald_plus, version_id: v.name, lane: 'ALL', sort_metric: 1, sort_order: 2 });
    if (r && r.datadetails) { patch = v.name; inner = r; break; }
  }
  if (!patch) throw new Error('国服近三个版本均无强度榜数据（接口可能变更）');
  const fetchedAt = new Date().toISOString();
  const allRows = [];
  const tiers = opts.tiers || ['emerald_plus', 'all', 'summit'];
  let done = 0;
  for (const tf of tiers) {
    progress({ phase: 'rank', message: `获取国服强度榜（${tf}）…`, done, total: tiers.length });
    const r = tf === 'emerald_plus' ? inner : await odp('lol_101strategy', { itier: ITIER[tf], version_id: patch, lane: 'ALL', sort_metric: 1, sort_order: 2 });
    allRows.push(...parseRankRows(r, keyMap, tf, patch, fetchedAt));
    done++;
    await sleep(1000);
  }
  if (!allRows.length) throw new Error('国服强度榜解析为空（页面结构可能已变更）');
  db.transaction(() => {
    for (const s of allRows) {
      db.run(`INSERT INTO champion_stats(championKey,position,region,tierFilter,patch,winRate,pickRate,banRate,roleRate,tier,rank,rankPrev,rankPrevPatch,counters,sampleSize,source,fetchedAt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(championKey,position,region,tierFilter,patch) DO UPDATE SET winRate=excluded.winRate,pickRate=excluded.pickRate,banRate=excluded.banRate,
        tier=excluded.tier,rank=excluded.rank,counters=excluded.counters,source=excluded.source,fetchedAt=excluded.fetchedAt`,
        [s.championKey, s.position, s.region, s.tierFilter, s.patch, s.winRate, s.pickRate, s.banRate, s.roleRate, s.tier, s.rank, s.rankPrev, s.rankPrevPatch, s.counters, s.sampleSize, s.source, s.fetchedAt]);
    }
  });
  if (!db.integrity()) throw new Error('国服数据写入后完整性校验失败');
  db.persist();
  log.info('cn ranked imported', { patch, rows: allRows.length });
  return { ok: true, version: patch, fetched: allRows.length, success: allRows.length, failed: 0, meta: { patch, tiers, dtstatdate: inner.dtstatdate || null, note: '国服官方榜不提供样本量（sampleSize=null）；克制列表仅 ID，对线胜率需详情页 confront 接口' } };
}

// ---------- 单英雄详情（懒加载 + 缓存到 builds 表，region=cn）----------
async function championDetail(ctx, championKey, position, opts = {}) {
  const { db, logger } = ctx;
  const champ = db.get('SELECT * FROM champions WHERE key=?', [championKey]);
  if (!champ) return { __error: '英雄不存在' };
  const patchRow = db.get("SELECT patch FROM champion_stats WHERE region='cn' AND championKey=? ORDER BY patch DESC LIMIT 1", [championKey]);
  const patch = opts.patch || (patchRow ? patchRow.patch : null);
  if (!patch) return { __error: '国服暂无该英雄数据，请先更新国服强度榜' };
  const tierFilter = opts.tierFilter || 'emerald_plus';
  const lane = LANE_REV[position] || 'MIDDLE';
  const itier = ITIER[tierFilter] != null ? ITIER[tierFilter] : 26;
  const cached = db.get('SELECT * FROM builds WHERE championKey=? AND position=? AND region=? AND tierFilter=? AND patch=?', [championKey, position, 'cn', tierFilter, patch]);
  if (cached && !opts.force) { try { return { ...JSON.parse(cached.data), cached: true }; } catch {} }
  const base = { itier, version_id: patch, lane, championid: champ.id };
  const out = { championKey, position, region: 'cn', tierFilter, patch, source: '101-official', fetchedAt: new Date().toISOString() };
  const jobs = [
    ['build', 'lol_101strategy_build'], ['confront', 'lol_101strategy_confront'],
    ['segment', 'lol_101strategy_segment'], ['newlane', 'lol_101strategy_newlane'],
    ['skillPoint', 'lol_101strategy_skill_point'], ['runeinfo', 'lol_101strategy_runeinfo'],
    ['skill', 'lol_101strategy_skill'],
  ];
  for (const [name, ds] of jobs) {
    // segment 接口实测必须 itier=255（它自身返回全段位分行），其他 itier 返回空
    const params = name === 'segment' ? { ...base, itier: 255 } : base;
    try { out[name] = await odp(ds, params); } catch (e) { out[name] = null; out[name + 'Error'] = String(e.message || e); }
    await sleep(1000);
  }
  if (out.segment && out.segment.datadetails) {
    out.segmentRows = String(out.segment.datadetails).split('#').filter(Boolean).map(x => {
      const f = x.split('_');
      const code = num(f[0]);
      return { itier: code, tierCn: TIER_CN[code] || ('段位' + f[0]), winRate: pct(f[1]), pickRate: pct(f[2]), banRate: pct(f[3]) };
    }).filter(r => r.itier != null);
  }
  try { out.trend = await odp('lol_101strategy_trend', { itier, lane, championid: champ.id }); } catch { out.trend = null; }
  db.run(`INSERT INTO builds(championKey,position,region,tierFilter,patch,data,source,fetchedAt) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(championKey,position,region,tierFilter,patch) DO UPDATE SET data=excluded.data,source=excluded.source,fetchedAt=excluded.fetchedAt`,
    [championKey, position, 'cn', tierFilter, patch, JSON.stringify(out), '101-official', out.fetchedAt]);
  db.persist();
  return out;
}

async function check(ctx) {
  try {
    const vs = await latestVersions();
    return { ok: vs.length > 0, detail: vs.length ? `101 网关在线 · 最新版本 ${vs[0].name}` : '版本列表为空' };
  } catch (e) { return { ok: false, detail: '101 网关不可达：' + String(e.message || e) }; }
}

// ---------- 101 原始串 → 通用 build 形状（与 OP.GG detail 同构，供出装/符文/加点/规划引擎消费） ----------
// 101 不提供样本量 → games=null（未知，不伪造）；pick/win 为官方百分数 /100。
function normalize(raw, db) {
  if (!raw || raw.coreItems) return raw;
  const items = {}, runes = {}, styles = {}, spells = {};
  for (const it of db.all('SELECT id,name,nameCn,imageUrl FROM items')) items[it.id] = it;
  for (const r of db.all('SELECT id,name,nameCn,icon,styleId FROM runes')) runes[r.id] = r;
  for (const s of db.all('SELECT id,name,nameCn,icon FROM rune_styles')) styles[s.id] = s;
  for (const s of db.all('SELECT id,name,nameCn,icon FROM spells')) spells[s.id] = s;
  const rows = (str, n) => String(str || '').split('#').filter(Boolean).map(seg => {
    const f = seg.split('_');
    const ids = f[0].split(',').map(x => parseInt(x, 10)).filter(x => Number.isFinite(x));
    if (!ids.length || (n && ids.length !== n)) return null;
    return {
      items: ids.map(id => ({ id, name: items[id] ? (items[id].nameCn || items[id].name) : ('#' + id) })),
      pickRate: num(f[2]) != null ? num(f[2]) / 100 : null,
      winRate: num(f[3]) != null ? num(f[3]) / 100 : null,
      games: null,
    };
  }).filter(Boolean);
  const b = raw.build || {};
  const out = {
    ...raw, provider: '101-official',
    starterItems: rows(b.starting_details),
    boots: rows(b.shoes_details, 1),
    coreItems: rows(b.core_details, 3),
    lastItems: [...rows(b.forth_details, 1), ...rows(b.fifth_details, 1), ...rows(b.sixth_details, 1)],
    summonerSpells: [], skillOrder: null, runes: [],
  };
  // 加点：首组（主升路线）第一个 15 级序列 → Q/W/E/R ×18
  const sp = raw.skillPoint && raw.skillPoint.detaildetails;
  if (sp) {
    const first = String(sp).split('$')[0].split('@')[1];
    if (first) {
      const seq = first.split('_')[0].split(',').map(x => ({ 1: 'Q', 2: 'W', 3: 'E', 4: 'R' }[parseInt(x, 10)] || null)).filter(Boolean);
      if (seq.length >= 6) out.skillOrder = seq.slice(0, 18);
    }
  }
  // 召唤师技能：data_details 行 = 「技能A_技能B_胜率_登场率」组合，取最高登场组合的两个技能
  const sk = raw.skill && raw.skill.data_details;
  if (sk) {
    const spRows = String(sk).split('#').filter(Boolean).map(seg => seg.split('_'))
      .map(f => ({ ids: [parseInt(f[0], 10), parseInt(f[1], 10)], pickRate: num(f[3]) != null ? num(f[3]) / 100 : null, winRate: num(f[2]) != null ? num(f[2]) / 100 : null, games: null }))
      .filter(p => p.ids.every(id => spells[id]))
      .sort((a, b2) => (b2.pickRate || 0) - (a.pickRate || 0));
    out.summonerSpellPairs = spRows;
    if (spRows[0]) out.summonerSpells = spRows[0].ids.map(id => ({ id, name: spells[id].nameCn || spells[id].name, icon: spells[id].icon }));
  }
  // 符文：rune_top_details 行 = 排名_基石_副系代码_9符文ID_登场_胜率_场次；系别由本地符文库 styleId 解析
  const rt = raw.runeinfo && raw.runeinfo.rune_top_details;
  if (rt) {
    const perk = id => runes[id] ? { id, name: runes[id].nameCn || runes[id].name, nameCn: runes[id].nameCn, imageUrl: runes[id].icon } : { id, name: '#' + id, imageUrl: `perk/${id}.png` };
    const styleOf = id => { const r = runes[id]; const s = r && styles[r.styleId]; return s ? { id: s.id, name: s.nameCn || s.name, nameCn: s.nameCn, imageUrl: s.icon } : null; };
    out.runes = String(rt).split('#').filter(Boolean).map(seg => {
      const f = seg.split('_');
      if (f.length < 7) return null;
      const ids = f[3].split(',').map(x => parseInt(x, 10)).filter(x => Number.isFinite(x));
      if (ids.length < 9) return null;
      const main = ids.slice(0, 4), sub = ids.slice(4, 6), shards = ids.slice(6, 9);
      return {
        keystoneId: ids[0], play: num(f[6]),
        pickRate: num(f[4]) != null ? num(f[4]) / 100 : null,
        winRate: num(f[5]) != null ? num(f[5]) / 100 : null,
        primaryRune: perk(ids[0]), primaryStyle: styleOf(ids[0]), subStyle: styleOf(sub[0]),
        primary: main.slice(1).map(perk), secondary: sub.map(perk), shards: shards.map(perk),
      };
    }).filter(Boolean).sort((a, b2) => (b2.pickRate || 0) - (a.pickRate || 0)).slice(0, 2);
  }
  return out;
}

module.exports = { collectRanked, championDetail, check, latestVersions, normalize, ITIER, ITIER_REV, TIER_CN, LANE_REV };
