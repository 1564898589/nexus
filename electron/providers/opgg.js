'use strict';
/**
 * NEXUS OP.GG data adapter (parser).
 * Parses OP.GG's PUBLIC server-rendered pages (Next.js RSC flight payload).
 * No authentication, captcha or access-control bypass is involved: this reads the
 * same public HTML a normal browser renders. Provenance is stamped on every record.
 *
 * IMPORTANT / COMPLIANCE: This is an unofficial integration. OP.GG's Terms may
 * restrict automated access. The adapter is rate-limited, keeps the last good
 * data on failure, and the app always offers a "open on OP.GG" fallback.
 * Statistics are NEVER fabricated; fields the source does not provide are null.
 */

const PROVIDER = 'opgg';

// --- RSC flight reconstruction -------------------------------------------------
function flight(html) {
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
  let m, s = '';
  while ((m = re.exec(html))) {
    try { s += JSON.parse(m[1]); } catch { /* skip malformed chunk */ }
  }
  return s;
}

// Balanced {...} or [...] starting exactly at index i (string-aware).
function balanced(s, i, open, close) {
  if (s[i] !== open) return null;
  let d = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) d++;
    else if (c === close) { d--; if (d === 0) return s.slice(i, j + 1); }
  }
  return null;
}

function objAfter(s, i) {
  while (i < s.length && s[i] !== '{') i++;
  return balanced(s, i, '{', '}');
}

// Find the first `"anchor":[ ... ]` whose first element is an object.
function findObjectArray(s, anchor) {
  const needle = '"' + anchor + '":[';
  let idx = 0;
  while ((idx = s.indexOf(needle, idx)) !== -1) {
    const start = idx + needle.length - 1;
    const raw = balanced(s, start, '[', ']');
    idx += needle.length;
    if (!raw) continue;
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length && typeof p[0] === 'object' && p[0] !== null) return p;
    } catch { /* keep searching */ }
  }
  return null;
}

function patchFromHtml(html) {
  const m = html.match(/images\/lol\/(\d+\.\d+\.\d+)\//);
  if (m) return m[1];
  const t = html.match(/Patch\s+(\d+\.\d+)/);
  return t ? t[1] : null;
}

// --- Tier list -----------------------------------------------------------------
function parseTierList(html, ctx) {
  const s = flight(html);
  const meta = [];
  const stats = [];
  const seenMeta = new Set();
  const seenStat = new Set();
  let idx = 0;
  const needle = '{"key":"';
  while ((idx = s.indexOf(needle, idx)) !== -1) {
    const raw = balanced(s, idx, '{', '}');
    idx += needle.length;
    if (!raw || raw.length > 20000) continue;
    let o; try { o = JSON.parse(raw); } catch { continue; }
    if (o && typeof o.is_rip === 'boolean' && Array.isArray(o.positions) && o.id != null) {
      if (!seenMeta.has(o.id)) { seenMeta.add(o.id); meta.push(o); }
    } else if (o && typeof o.positionWinRate === 'number' && o.positionName) {
      const k = o.key + '|' + o.positionName;
      if (!seenStat.has(k)) { seenStat.add(k); stats.push(o); }
    }
  }
  const patch = patchFromHtml(html);
  const sampleM = html.match(/Total analyzed samples[^0-9]*([\d,]+)/);
  const norm = (st) => ({
    championKey: st.key,
    championName: st.name,
    position: st.positionName,
    winRate: st.positionWinRate / 100,
    pickRate: st.positionPickRate / 100,
    banRate: (st.positionBanRate ?? 0) / 100,
    roleRate: st.positionRoleRate ?? null,
    tier: st.positionTier ?? (st.positionTierData && st.positionTierData.tier) ?? null,
    rank: st.positionRank ?? (st.positionTierData && st.positionTierData.rank) ?? null,
    rankPrev: st.positionTierData ? st.positionTierData.rank_prev ?? null : null,
    rankPrevPatch: st.positionTierData ? st.positionTierData.rank_prev_patch ?? null : null,
    counters: Array.isArray(st.positionCounters) ? st.positionCounters.map(c => ({
      championKey: c.key, championId: c.champion_id, name: c.name,
      play: c.play ?? null, win: c.win ?? null,
      winRate: (c.play ? c.win / c.play : null),
    })) : [],
    imageUrl: st.image_url || null,
  });
  return {
    provider: PROVIDER,
    region: ctx.region, tier: ctx.tier, mode: ctx.mode || 'ranked',
    patch,
    sampleSize: sampleM ? parseInt(sampleM[1].replace(/,/g, ''), 10) : null,
    champions: meta.map(m => ({
      id: m.id, key: m.key, name: m.name, imageUrl: m.image_url,
      positions: m.positions, isRotation: !!m.is_rotation, isRip: !!m.is_rip,
    })),
    stats: stats.map(norm),
    fetchedAt: new Date().toISOString(),
  };
}

// --- Detail page ---------------------------------------------------------------
// Walk a parsed React-tree node into an ordered token list.
function tokenize(node, out) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push({ t: 'str', v: node }); return out; }
  if (typeof node === 'number') { out.push({ t: 'num', v: node }); return out; }
  if (Array.isArray(node)) { for (const n of node) tokenize(n, out); return out; }
  if (typeof node === 'object') {
    if (node.metaType && node.metaId != null) out.push({ t: 'meta', type: node.metaType, id: node.metaId });
    if (node.alt) out.push({ t: 'alt', v: node.alt });
    for (const k of Object.keys(node)) { if (k !== 'children' && k !== 'metaType' && k !== 'metaId' && k !== 'alt') tokenize(node[k], out); }
    if (node.children !== undefined) tokenize(node.children, out);
  }
  return out;
}

function parseRows(s) {
  const rows = {};
  const re = /"tr","([a-z_]+_\d+)"/g;
  let m;
  while ((m = re.exec(s))) {
    const key = m[1];
    const raw = objAfter(s, m.index + m[0].length);
    if (!raw) continue;
    let tree; try { tree = JSON.parse(raw); } catch { continue; }
    const toks = tokenize(tree, []);
    const metas = toks.filter(t => t.t === 'meta');
    // attach names: an 'alt' token following a meta belongs to it
    const items = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].t === 'meta') {
        let name = null;
        for (let j = i + 1; j < Math.min(i + 6, toks.length); j++) {
          if (toks[j].t === 'alt') { name = toks[j].v; break; }
          if (toks[j].t === 'meta') break;
        }
        items.push({ type: toks[i].type, id: toks[i].id, name });
      }
    }
    const percents = toks.filter(t => t.t === 'str' && /^\d+(\.\d+)?%$/.test(t.v)).map(t => parseFloat(t.v) / 100);
    let games = null;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].t === 'str' && /Games/i.test(toks[i].v)) {
        for (let j = i - 1; j >= 0; j--) {
          const tj = toks[j];
          if (tj.t === 'num') { games = tj.v; break; }
          if (tj.t === 'str' && /^[\d,]+$/.test(tj.v.trim())) { games = parseInt(tj.v.replace(/,/g, ''), 10); break; }
          if (tj.t === 'meta') break;
        }
      }
    }
    rows[key] = { items, percents, games };
  }
  return rows;
}

function sectionRows(rows, prefix) {
  return Object.keys(rows)
    .filter(k => k.startsWith(prefix + '_'))
    .sort((a, b) => parseInt(a.split('_').pop()) - parseInt(b.split('_').pop()))
    .map(k => {
      const r = rows[k];
      const its = r.items.filter(i => i.type === 'item');
      if (!its.length) return null;
      return {
        items: its.map(i => ({ id: i.id, name: i.name })),
        pickRate: r.percents[0] ?? null,
        winRate: r.percents[1] ?? null,
        games: r.games,
      };
    }).filter(Boolean);
}

function activePerks(rowsArr) {
  // rowsArr: array of rows, each row array of perks with isActive
  if (!Array.isArray(rowsArr)) return [];
  return rowsArr.map(row => {
    if (!Array.isArray(row)) return null;
    const a = row.find(p => p && p.isActive);
    return a ? { id: a.id, name: a.name, imageUrl: a.image_url } : null;
  }).filter(Boolean);
}

function parseRunes(s) {
  const pages = findObjectArray(s, 'rune_pages');
  if (!pages) return [];
  return pages.map(p => {
    const b = (p.builds && p.builds[0]) || {};
    return {
      keystoneId: p.id,
      play: p.play ?? null,
      pickRate: p.pick_rate ?? null,
      winRate: p.win_rate ?? null,
      primaryRune: p.primary_rune ? { id: p.primary_rune.id, name: p.primary_rune.name, imageUrl: p.primary_rune.image_url } : null,
      primaryStyle: b.primary_perk_style ? { id: b.primary_perk_style.id, name: b.primary_perk_style.name, imageUrl: b.primary_perk_style.image_url } : null,
      subStyle: b.perk_sub_style ? { id: b.perk_sub_style.id, name: b.perk_sub_style.name, imageUrl: b.perk_sub_style.image_url } : null,
      primary: activePerks(b.main_runes),
      secondary: activePerks(b.sub_runes),
      shards: activePerks(b.shards || b.stat_mods || []),
    };
  });
}

function parseDetail(html, ctx) {
  const s = flight(html);
  const rows = parseRows(s);
  const skills = findObjectArray(s, 'skills') || [];
  // Summoner spells = combination rows: each row spell_0+spell_1 with its own pick/win/games.
  // 多套组合绝不拍平成单排图标（旧版把 闪现+点燃 / 闪现+传送 拍成 3 个图标）。
  const pairs = [];
  const pairRe = /"spell_0",\{"metaId":(\d+),"metaType":"spell"[\s\S]{0,600}?"spell_1",\{"metaId":(\d+),"metaType":"spell"/g;
  let pm;
  while ((pm = pairRe.exec(s))) {
    const tail = s.slice(pm.index + pm[0].length, pm.index + pm[0].length + 900);
    const pcts = [...tail.matchAll(/"children":"(\d+(?:\.\d+)?)%"/g)].map(x => parseFloat(x[1]) / 100);
    const gmm = tail.match(/"children":"([\d,]+) Games"/);
    pairs.push({
      ids: [parseInt(pm[1], 10), parseInt(pm[2], 10)],
      pickRate: pcts[0] ?? null, winRate: pcts[1] ?? null,
      games: gmm ? parseInt(gmm[1].replace(/,/g, ''), 10) : null,
    });
  }
  const spells = (pairs[0] ? pairs[0].ids : []).map(id => ({ id, name: null }));
  // Skill order: RSC per-level lazy blocks ["$","span","<level>",…strong "Q/W/E/R"].
  // 按等级重置分组，取第一组完整序列（extraData 只承载主升三图标，不是 18 级顺序）。
  const gridRe = /"\$","span","(\d{1,2})",\{"className":"inline-flex flex-col items-center gap-0\.5[^"]*","children":\["\$undefined",\["\$","strong",null,\{[^}]*"children":"([QWER])"\}\]\]\}/g;
  const groups = [];
  let cur = null, prevLevel = 0, gm2;
  while ((gm2 = gridRe.exec(s))) {
    const lv = parseInt(gm2[1], 10) + 1; // span key 0-based → 等级 1..15
    if (!cur || lv <= prevLevel) { cur = []; groups.push(cur); }
    cur[lv - 1] = gm2[2];
    prevLevel = lv;
  }
  const fullGroup = groups.find(g => g[0] && g.filter(Boolean).length >= 15);
  const skillOrder = fullGroup ? fullGroup.filter(Boolean).slice(0, 18) : null;
  return {
    provider: PROVIDER,
    championKey: ctx.championKey, position: ctx.position,
    region: ctx.region, tier: ctx.tier, patch: patchFromHtml(html),
    runes: parseRunes(s),
    abilities: skills.map(sk => ({ key: sk.key, name: sk.name, imageUrl: sk.image_url, videoUrl: sk.video_url })),
    starterItems: sectionRows(rows, 'starter_items'),
    boots: sectionRows(rows, 'boots'),
    coreItems: sectionRows(rows, 'core_items'),
    lastItems: sectionRows(rows, 'last_items'),
    summonerSpells: spells,
    summonerSpellPairs: pairs,
    skillOrder,
    shape: 2,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Counters page: full matchup table -----------------------------------------
// 公开 SSR 页 /lol/champions/{key}/counters/{pos}?region=&tier=&type=ranked
// 实测：type=ranked/soloranked/flexranked 返回完全一致 → 该页固定 Solo/Duo 排位口径，无 Flex 混入。
// 表结构：[{play, win, win_rate(百分数), champion:{key,name,image_url}}]，按场次降序，官方自带最小样本门槛。
function parseCounters(html, ctx) {
  const s = flight(html);
  let i = 0, arr = null;
  while ((i = s.indexOf('"data":[{', i)) !== -1) {
    const raw = balanced(s, i + 7, '[', ']');
    i += 8;
    if (!raw || !raw.includes('"play"')) continue;
    let p; try { p = JSON.parse(raw); } catch { continue; }
    if (Array.isArray(p) && p.length && p[0].champion && p[0].play != null) { arr = p; break; }
  }
  return {
    provider: PROVIDER,
    region: ctx.region, tier: ctx.tier, mode: 'ranked',
    patch: patchFromHtml(html) || ctx.patch || null,
    rows: (arr || []).map(r => ({
      opponentKey: r.champion.key, opponentName: r.champion.name,
      play: r.play ?? null, win: r.win ?? null,
      winRate: r.win_rate != null ? r.win_rate / 100 : (r.play ? r.win / r.play : null),
    })).filter(r => r.opponentKey && r.winRate != null),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { PROVIDER, flight, balanced, findObjectArray, parseTierList, parseDetail, parseCounters, patchFromHtml };