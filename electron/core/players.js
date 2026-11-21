'use strict';
/**
 * NEXUS PLAYER ENGINE — 国服玩家战绩双通道架构。
 * 通道 A（独立）：WeGame 会话（用户自有登录态，DPAPI 加密，实测验证门控），不依赖本机游戏客户端。
 * 通道 B（本地）：LCU 首页 + SGP 深分页/跨区（凭据来自已登录客户端，仅内存）。
 * 两通道互相独立：客户端连接状态不是本模块的启动条件；页面/缓存/收藏始终可用。
 * 所有数据真实或明确不可用；身份必须经 名称+大区+唯一标识 确认，同名候选由用户选择。
 */
const sgp = require('../providers/sgp');
const { classifyError } = require('../providers/wegame');
const replayAnalytics = require('../analytics/replay');

const RANK_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const RANK_CN = { IRON: '黑铁', BRONZE: '青铜', SILVER: '白银', GOLD: '黄金', PLATINUM: '铂金', EMERALD: '翡翠', DIAMOND: '钻石', MASTER: '大师', GRANDMASTER: '宗师', CHALLENGER: '王者' };
const DIV_ORDER = ['IV', 'III', 'II', 'I'];

function createPlayerEngine(ctx) {
  const { db, logger, lcu, config, wegame, events } = ctx;
  const log = logger.child('players');

  function available() {
    const s = lcu.getState();
    return { connected: s.connected, loggedIn: s.loggedIn, tencent: s.tencent, platformId: s.platformId, region: s.region };
  }

  // 双通道可用性（页面无客户端也能完整渲染）
  function channels() {
    const s = lcu.getState();
    return {
      lcu: { connected: s.connected, loggedIn: s.loggedIn, tencent: s.tencent, platformId: s.platformId, region: s.region },
      sgp: {
        ready: s.loggedIn,
        crossRegion: s.loggedIn,
        note: s.loggedIn
          ? 'SGP 深分页可用；跨区查询使用当前客户端凭据访问目标大区（实验性，逐次实测）。'
          : 'SGP 需已登录客户端提供 entitlements 凭据。未登录时仅可读取本地缓存。',
      },
      wegame: wegame ? wegame.status() : { channel: 'wegame', connected: false, verified: false, limitation: '独立通道未启用。' },
    };
  }

  function classify(e, channel) {
    const msg = String((e && e.message) || e || '');
    if (e && e.kind) return { kind: e.kind, message: msg };
    if (/未检测到|未连接|尚未登录|请登录|客户端/.test(msg) && !e.status) return { kind: 'login-required', message: msg };
    return classifyError(e);
  }

  function isTencentId(id) { return !!sgp.TENCENT_REGIONS.find(r => r.id === String(id || '').toUpperCase()); }

  // ---- search history ----
  function recordSearch(keyword, serverId, channel, resultCount, state) {
    try {
      db.run('INSERT INTO search_history(keyword,serverId,channel,resultCount,state,at) VALUES(?,?,?,?,?,?)',
        [keyword, serverId || null, channel, resultCount || 0, state || 'ok', new Date().toISOString()]);
      db.run('DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY id DESC LIMIT 100)');
      db.persist();
    } catch (e) { log.warn('recordSearch', e.message); }
  }
  function searchHistory(limit = 30) { return db.all('SELECT * FROM search_history ORDER BY id DESC LIMIT ?', [limit]); }
  function deleteSearchHistory(id) { db.run('DELETE FROM search_history WHERE id=?', [id]); db.persist(); return true; }
  function clearSearchHistory() { db.run('DELETE FROM search_history'); db.persist(); return true; }

  // ---- search（双通道，身份确认优先） ----
  async function search(name, opts = {}) {
    const keyword = String(name || '').trim();
    if (!keyword) return { state: 'error', kind: 'unavailable', message: '请输入召唤师名称。', tried: [] };
    const serverId = opts.serverId ? String(opts.serverId).toUpperCase() : null;
    const s = lcu.getState();
    const tried = [];

    // 通道 A：WeGame（独立，不依赖客户端）
    if (wegame) {
      const st = wegame.status();
      if (st.connected && st.verified) {
        const r = await wegame.search(keyword, serverId);
        if (r.state === 'ok' && r.players && r.players.length) {
          const list = r.players.map(p => ({ ...p, serverId: p.serverId || serverId || null }));
          recordSearch(keyword, serverId, 'wegame', list.length, 'ok');
          if (list.length === 1) return { state: 'ok', player: adoptPlayer(list[0]), channel: 'wegame', fetchedAt: r.fetchedAt };
          return { state: 'candidates', players: list, channel: 'wegame', message: '找到多个候选玩家。请核对名称、大区与等级后选择身份，NEXUS 不会自动关联。' };
        }
        tried.push({ channel: 'wegame', state: r.state, kind: r.state, message: r.message });
      } else {
        tried.push({ channel: 'wegame', state: st.connected ? 'needs-verification' : 'login-required', kind: st.connected ? 'unavailable' : 'login-required', message: st.limitation });
      }
    }

    // 通道 B：LCU 名称搜索（仅限客户端当前大区）
    if (s.loggedIn) {
      const clientRegion = String(s.platformId || '').toUpperCase();
      if (serverId && clientRegion && serverId !== clientRegion) {
        tried.push({ channel: 'lcu', state: 'region-mismatch', kind: 'unavailable', message: `客户端当前大区为 ${s.platformId}，LCU 名称搜索仅限该大区。查询 ${serverId} 的玩家请使用独立通道，或登录该大区客户端。` });
      } else {
        try {
          const res = await lcu.getSummonerByName(keyword);
          if (res && (res.puuid || res.summonerId)) {
            const player = {
              puuid: res.puuid, summonerId: res.summonerId, name: res.displayName || res.gameName || res.internalName || keyword,
              tagLine: res.tagLine || null, serverId: s.platformId, region: s.region,
              profileIconId: res.profileIconId, level: res.summonerLevel, privacy: res.privacy || 'PUBLIC',
              source: 'lcu', fetchedAt: new Date().toISOString(), confidence: 0.9,
            };
            upsertPlayer(player);
            addRecent(player);
            recordSearch(keyword, serverId || s.platformId, 'lcu', 1, 'ok');
            return { state: 'ok', player, channel: 'lcu', fetchedAt: player.fetchedAt };
          }
          tried.push({ channel: 'lcu', state: 'not-found', kind: 'not-found', message: `当前大区（${s.platformId || '未知'}）未找到该召唤师。请确认名称拼写与大区一致，或尝试其他大区/独立通道。` });
        } catch (e) {
          const cl = classify(e, 'lcu');
          tried.push({ channel: 'lcu', state: cl.kind, kind: cl.kind, message: cl.message });
        }
      }
    } else {
      tried.push({ channel: 'lcu', state: 'login-required', kind: 'login-required', message: s.connected ? '客户端已连接但未登录，LCU 通道不可用。' : '未检测到本机客户端，LCU 通道不可用（独立通道不受影响）。' });
    }

    const primary = tried.find(t => t.kind === 'not-found') || tried.find(t => t.kind === 'riot-id-required') || tried.find(t => t.kind === 'network') || tried.find(t => t.kind !== 'login-required') || tried[0] || { kind: 'unavailable', message: '无可用查询通道。' };
    recordSearch(keyword, serverId, 'none', 0, primary.kind);
    return { state: 'error', kind: primary.kind, message: tried.map(t => `【${t.channel === 'wegame' ? '独立通道' : '客户端通道'}】${t.message}`).join('\n'), tried };
  }

  // 用户在候选列表中明确选择后才建立玩家记录（禁止自动关联）
  function confirmCandidate(c) {
    if (!c || (!c.puuid && !c.externalId)) return { state: 'error', kind: 'unavailable', message: '候选缺少唯一标识，无法确认身份。' };
    const player = adoptPlayer(c);
    recordSearch(c.name, c.serverId, c.source || 'wegame', 1, 'confirmed');
    return { state: 'ok', player };
  }

  function adoptPlayer(c) {
    const puuid = c.puuid || ('wg:' + c.externalId); // WeGame 未提供 puuid 时用带前缀的外部标识，绝不冒充 Riot puuid
    const player = {
      puuid, summonerId: c.summonerId || null, name: c.name, tagLine: c.tagLine || null,
      serverId: c.serverId || null, region: c.region || null, profileIconId: c.profileIconId || null,
      level: c.level || null, privacy: c.privacy || 'PUBLIC', externalId: c.externalId || null,
      source: c.source || 'wegame', fetchedAt: new Date().toISOString(), confidence: c.confidence || 0.7,
    };
    upsertPlayer(player);
    addRecent(player);
    return player;
  }

  function addRecent(player) {
    db.run('INSERT INTO player_recent(puuid,name,serverId,queriedAt) VALUES(?,?,?,?) ON CONFLICT(puuid) DO UPDATE SET name=excluded.name,queriedAt=excluded.queriedAt',
      [player.puuid, player.name, player.serverId, player.fetchedAt]);
    db.persist();
  }

  function upsertPlayer(p) {
    db.run(`INSERT INTO players(puuid,summonerId,name,tagLine,serverId,region,profileIconId,level,privacy,source,fetchedAt,confidence,data)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(puuid) DO UPDATE SET name=excluded.name,level=excluded.level,profileIconId=excluded.profileIconId,privacy=excluded.privacy,source=excluded.source,fetchedAt=excluded.fetchedAt,confidence=excluded.confidence`,
      [p.puuid, p.summonerId || null, p.name, p.tagLine || null, p.serverId || null, p.region || null, p.profileIconId || null, p.level || null, p.privacy || null, p.source, p.fetchedAt, p.confidence || 0.8, JSON.stringify(p)]);
  }

  async function getRanked(puuid) {
    try {
      const r = await lcu.getRankedStats(puuid);
      if (!r) return null;
      const q = (r.queueMap && (r.queueMap.RANKED_SOLO_5x5 || r.queueMap.RANKED_FLEX_SR)) || r;
      const tier = q.tier || q.rank || null;
      return { tier: tier || null, division: q.division || null, lp: q.leaguePoints ?? null, wins: q.wins ?? null, losses: q.losses ?? null };
    } catch { return null; }
  }

  // ---- match history (LCU first page + SGP pagination / cross-region) ----
  function normalizeLcuGame(g, puuid) {
    if (!g) return null;
    const identities = g.participantIdentities || [];
    const idMap = {};
    for (const it of identities) idMap[it.participantId] = it.player || {};
    const participants = (g.participants || []).map(p => {
      const pl = idMap[p.participantId] || {};
      const st = p.stats || {};
      const win = st.win === true || st.win === 'Win' || st.win === 'win';
      return {
        puuid: pl.puuid || null, name: pl.gameName || pl.summonerName || null,
        championId: p.championId, position: p.timeline && p.timeline.lane || null, teamId: p.teamId,
        win: st.win != null ? win : null,
        kills: st.kills ?? null, deaths: st.deaths ?? null, assists: st.assists ?? null,
        cs: (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0) || null,
        gold: st.goldEarned ?? null, damage: st.totalDamageDealtToChampions ?? null, vision: st.visionScore ?? null,
        items: [st.item0, st.item1, st.item2, st.item3, st.item4, st.item5].filter(x => x != null && x > 0),
        spells: [p.spell1Id, p.spell2Id].filter(x => x != null),
        perks: st.perks ? { primary: st.perks.primaryStyle, sub: st.perks.subStyle } : null,
        level: st.champLevel ?? null,
      };
    });
    const me = participants.find(p => p.puuid === puuid) || null;
    return { gameId: g.gameId, queueId: g.queueId, mode: g.gameMode, gameCreation: g.gameCreation, duration: g.gameDuration, participants, me, source: 'lcu' };
  }

  async function fetchHistory(puuid, { count = 20, startIndex = 0, serverId } = {}) {
    const s = lcu.getState();
    if (!s.loggedIn) {
      const cl = { kind: 'login-required', message: s.connected ? '客户端已连接但未登录。刷新战绩需要登录态；本地缓存仍可浏览。' : '未检测到已登录的客户端。刷新战绩需要客户端凭据；本地缓存仍可浏览，独立通道（WeGame）不受此限制。' };
      throw Object.assign(new Error(cl.message), { kind: cl.kind });
    }
    const row = db.get('SELECT serverId FROM players WHERE puuid=?', [puuid]);
    const clientRegion = String(s.platformId || '').toUpperCase();
    const target = String(serverId || (row && row.serverId) || s.platformId || '').toUpperCase();
    const crossRegion = !!(target && clientRegion && target !== clientRegion);
    const out = [];
    const seen = new Set();
    let usedSgp = false, sgpHost = null, note = null, verifiedHost = false;
    const customHost = config.get('sgpHostOverride') || null;

    if (crossRegion) {
      // 跨区：LCU 绑定客户端大区，不可用；直接 SGP 目标大区（实验性，凭据复用）
      if (!sgp.regionById(target) && !customHost) {
        throw Object.assign(new Error(`大区 ${target} 暂无已验证的 SGP 主机映射（可能是 WeGame 内部编号或已合并旧大区），无法跨区查询。请改用该大区客户端登录，或等待独立通道支持。`), { kind: 'unavailable' });
      }
      note = `跨区查询 ${target}：使用当前客户端凭据访问目标大区 SGP（实验性能力，可用性以实测为准）。`;
      try {
        const token = await lcu.getEntitlementsToken();
        if (!token) throw Object.assign(new Error('无法获取 entitlements 凭据。'), { kind: 'login-required' });
        const r = await sgp.getMatchHistory({ token, platformId: target, tencent: isTencentId(target), puuid, startIndex, count, customHost });
        usedSgp = true; sgpHost = r.host; verifiedHost = r.verifiedHost;
        const arr = (r.raw && r.raw.games) || [];
        for (const g of arr) {
          const m = sgp.normalizeGame(g, puuid);
          if (m && m.gameId && !seen.has(m.gameId)) { seen.add(m.gameId); out.push(m); }
        }
        if (!verifiedHost) note += ' 目标主机为通用模式推断（未验证）。';
      } catch (e) {
        const cl = classify(e, 'sgp');
        throw Object.assign(new Error(`跨区查询 ${target} 失败：${cl.message}`), { kind: cl.kind });
      }
    } else {
      // 同大区：LCU 首页
      try {
        const res = await lcu.getMatchHistory(puuid, 0, Math.min(19, count - 1));
        const games = (res && res.games && (res.games.games || res.games)) || [];
        for (const g of games) {
          const m = normalizeLcuGame(g, puuid);
          if (m && m.gameId && !seen.has(m.gameId)) { seen.add(m.gameId); out.push(m); }
        }
      } catch (e) { note = 'LCU 战绩读取失败：' + (e.message || e); }

      // SGP 深分页（腾讯 LCU 超过 20 场会重复第一页）
      if (count > out.length || startIndex > 0) {
        try {
          const token = await lcu.getEntitlementsToken();
          if (token) {
            const r = await sgp.getMatchHistory({ token, platformId: target || s.platformId, tencent: s.tencent, puuid, startIndex: startIndex || out.length, count: count - out.length, customHost });
            usedSgp = true; sgpHost = r.host; verifiedHost = r.verifiedHost;
            const arr = (r.raw && r.raw.games) || [];
            for (const g of arr) {
              const m = sgp.normalizeGame(g, puuid);
              if (m && m.gameId && !seen.has(m.gameId)) { seen.add(m.gameId); out.push(m); }
            }
          } else note = (note ? note + '；' : '') + '无法获取 SGP 凭据，仅显示 LCU 首页。';
        } catch (e) {
          note = (note ? note + '；' : '') + 'SGP 深分页不可用（' + (e.message || e) + '），已回退 LCU。';
        }
      }
    }
    for (const m of out) cacheMatch(m, puuid);
    db.persist();
    if (events && out.length) { try { events.emit('matches-ingested', { puuid, count: out.length }); } catch {} }
    return { matches: out, usedSgp, sgpHost, verifiedHost, crossRegion, targetRegion: target || null, note, source: usedSgp ? (crossRegion ? 'sgp-cross' : 'lcu+sgp') : 'lcu', fetchedAt: new Date().toISOString() };
  }

  function cacheMatch(m, puuid) {
    const me = m.me || {};
    db.run(`INSERT INTO matches(gameId,puuid,queueId,mode,gameCreation,duration,win,championId,position,kills,deaths,assists,cs,gold,damage,vision,data,source,fetchedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(gameId,puuid) DO UPDATE SET data=excluded.data,source=excluded.source,fetchedAt=excluded.fetchedAt`,
      [m.gameId, puuid, m.queueId || null, m.mode || null, m.gameCreation || null, m.duration || null,
        me.win == null ? null : (me.win ? 1 : 0), me.championId || null, me.position || null,
        me.kills ?? null, me.deaths ?? null, me.assists ?? null, me.cs ?? null, me.gold ?? null, me.damage ?? null, me.vision ?? null,
        JSON.stringify(m), m.source, new Date().toISOString()]);
  }

  function cachedMatches(puuid, limit = 100) {
    return db.all('SELECT * FROM matches WHERE puuid=? ORDER BY gameCreation DESC LIMIT ?', [puuid, limit]).map(r => {
      const m = JSON.parse(r.data);
      m.me = m.me || { win: r.win === 1, championId: r.championId, kills: r.kills, deaths: r.deaths, assists: r.assists, cs: r.cs, gold: r.gold, damage: r.damage, vision: r.vision, position: r.position };
      return m;
    });
  }

  // 单局详情：同大区优先 LCU；跨区或 LCU 失败 → SGP 单局 SUMMARY（真实接口，已实测验证路径）
  async function getMatchDetail(gameId, opts = {}) {
    const s = lcu.getState();
    if (!s.loggedIn) throw Object.assign(new Error('单局详情需要已登录客户端（LCU 或 SGP 凭据）。缓存摘要仍可在战绩列表查看。'), { kind: 'login-required' });
    const target = String(opts.serverId || s.platformId || '').toUpperCase();
    const clientRegion = String(s.platformId || '').toUpperCase();
    const crossRegion = !!(opts.serverId && clientRegion && target !== clientRegion);
    if (crossRegion && !sgp.regionById(target) && !config.get('sgpHostOverride')) {
      throw Object.assign(new Error(`大区 ${target} 暂无已验证的 SGP 主机映射，无法读取跨区单局详情。`), { kind: 'unavailable' });
    }
    let lcuErr = null;
    if (!crossRegion) {
      try {
        const g = await lcu.getMatchDetail(gameId);
        if (g) return { source: 'lcu', ...g };
      } catch (e) { lcuErr = e; }
    }
    try {
      const token = await lcu.getEntitlementsToken();
      if (!token) throw Object.assign(new Error('无法获取 entitlements 凭据。'), { kind: 'login-required' });
      const r = await sgp.getGameSummary({ token, platformId: target, tencent: crossRegion ? isTencentId(target) : s.tencent, gameId, customHost: config.get('sgpHostOverride') || null });
      const game = sgp.normalizeGame(r.raw, opts.puuid || null);
      if (!game || !game.participants.length) throw new Error('SGP 单局摘要为空或形状不符');
      return { source: 'sgp', host: r.host, verifiedHost: r.verifiedHost, crossRegion, game };
    } catch (e) {
      const cl = classify(e, 'sgp');
      const prefix = lcuErr ? 'LCU 详情失败（' + (lcuErr.message || lcuErr) + '）；' : '';
      throw Object.assign(new Error(prefix + 'SGP 详情失败：' + cl.message), { kind: cl.kind });
    }
  }

  // ---- stats ----
  // modeKey: 'all' | 具体模式 key | 'other'。评级/统计必须分模式——大乱斗/人机的表现不能拿去排位参考。
  function computeStats(matches, puuid, modeKey) {
    let src = matches;
    if (modeKey && modeKey !== 'all') src = replayAnalytics.filterByMode(matches, modeKey);
    const mine = src.map(m => m.me).filter(Boolean);
    const total = mine.length;
    const wins = mine.filter(m => m.win === true).length;
    const sum = (k) => mine.reduce((a, m) => a + (m[k] || 0), 0);
    const avg = (k) => total ? sum(k) / total : 0;
    const byChampion = {};
    for (const m of mine) {
      const c = m.championId; if (c == null) continue;
      const e = byChampion[c] || (byChampion[c] = { championId: c, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 });
      e.games++; if (m.win) e.wins++; e.kills += m.kills || 0; e.deaths += m.deaths || 0; e.assists += m.assists || 0;
    }
    const champs = Object.values(byChampion).map(e => ({ ...e, winRate: e.games ? e.wins / e.games : 0, kda: e.deaths ? (e.kills + e.assists) / e.deaths : (e.kills + e.assists) })).sort((a, b) => b.games - a.games);
    const byPosition = {};
    for (const m of mine) { const p = m.position || 'UNKNOWN'; const e = byPosition[p] || (byPosition[p] = { position: p, games: 0, wins: 0 }); e.games++; if (m.win) e.wins++; }
    // streak (most recent first)
    let streak = 0, streakType = null;
    for (const m of mine) { if (m.win == null) break; const t = m.win ? 'W' : 'L'; if (streakType == null) { streakType = t; streak = 1; } else if (t === streakType) streak++; else break; }
    const recent = (n) => { const arr = mine.slice(0, n); const w = arr.filter(m => m.win).length; return { games: arr.length, wins: w, winRate: arr.length ? w / arr.length : 0, kda: arr.length ? arr.reduce((a, m) => a + ((m.deaths ? (m.kills + m.assists) / m.deaths : (m.kills + m.assists)) || 0), 0) / arr.length : 0 }; };
    // signature champions: high games + high winRate + sample
    const signature = champs.filter(c => c.games >= 5 && c.winRate >= 0.55).sort((a, b) => (b.winRate * b.games) - (a.winRate * a.games)).slice(0, 3);
    return {
      total, wins, losses: total - wins, winRate: total ? wins / total : 0,
      avgKills: avg('kills'), avgDeaths: avg('deaths'), avgAssists: avg('assists'),
      avgKDA: avg('deaths') ? (avg('kills') + avg('assists')) / avg('deaths') : (avg('kills') + avg('assists')),
      avgCs: avg('cs'), avgGold: avg('gold'), avgDamage: avg('damage'), avgVision: avg('vision'),
      byChampion: champs, byPosition: Object.values(byPosition), poolDepth: champs.length,
      signature, recent10: recent(10), recent20: recent(20), streak, streakType,
    };
  }

  // ---- power rating (relative, evidence-based, long-term vs recent separated, MODE-SCOPED) ----
  // 默认评级口径：优先单双排→灵活→匹配→快速（召唤师峡谷竞技），绝不把大乱斗/人机混入排位参考。
  function defaultRatingMode(matches) {
    for (const k of ['solo', 'flex', 'normal', 'swift']) {
      if (replayAnalytics.filterByMode(matches, k).length >= 3) return k;
    }
    return 'all';
  }
  function modeLabel(key) {
    const M = { all: '全部模式', solo: '单双排', flex: '灵活组排', normal: '匹配', swift: '快速模式', aram: '大乱斗', bot: '人机', practice: '训练模式', arena: '竞技场', other: '其他模式' };
    return M[key] || key;
  }
  // 展示去尾零（86.0% → 86%、2.40 → 2.4）
  const pc = (v) => String(parseFloat((v * 100).toFixed(1)));
  const fx = (v, d = 2) => String(parseFloat((+v).toFixed(d)));
  function rate(stats, rank, modeKey) {
    const mk = modeKey || 'all';
    const mlabel = modeLabel(mk);
    if (!stats || stats.total < 3) return { grade: null, label: '暂无法评级', confidence: 0, longTerm: null, recent: null, reasons: [`「${mlabel}」样本不足（<3 场），不做评级。`], sampleSize: stats ? stats.total : 0, mode: mk, modeLabel: mlabel };
    const reasons = [];
    // long-term score 0..100
    let lt = 50;
    lt += (stats.winRate - 0.5) * 120;                       // win rate dominant
    lt += Math.min(15, (stats.avgKDA - 2) * 5);              // KDA
    if (rank && rank.tier) { const idx = RANK_ORDER.indexOf(rank.tier.toUpperCase()); if (idx >= 0) { lt += (idx - 3) * 4; reasons.push(`当前段位 ${RANK_CN[rank.tier.toUpperCase()] || rank.tier}${rank.division ? ' ' + rank.division : ''}。`); } }
    lt += Math.min(8, stats.total / 10);                     // sample bonus
    lt = Math.max(0, Math.min(100, lt));
    // recent score
    const r10 = stats.recent10;
    let rc = 50 + (r10.winRate - 0.5) * 140 + Math.min(12, (r10.kda - 2) * 4);
    rc = Math.max(0, Math.min(100, rc));
    const gradeOf = (v) => v >= 80 ? 'S' : v >= 66 ? 'A' : v >= 48 ? 'B' : v >= 33 ? 'C' : 'D';
    const grade = gradeOf(lt * 0.6 + rc * 0.4);
    const confidence = Math.min(1, stats.total / 30) * (rank && rank.tier ? 1 : 0.8);
    reasons.push(`评级口径：「${mlabel}」（不与其他模式混算）。`);
    reasons.push(`长期：${stats.total} 场胜率 ${pc(stats.winRate)}%，平均 KDA ${fx(stats.avgKDA)}。`);
    reasons.push(`近期：近 ${r10.games} 场胜率 ${pc(r10.winRate)}%，KDA ${fx(r10.kda)}${stats.streakType ? '，当前 ' + stats.streak + (stats.streakType === 'W' ? ' 连胜' : ' 连败') : ''}。`);
    if (stats.signature.length) reasons.push(`绝活英雄 ${stats.signature.length} 个（高场次高胜率），选出时威胁上调。`);
    if (stats.poolDepth <= 3) reasons.push('英雄池较浅，针对其绝活可有效限制。');
    if (stats.total < 10) reasons.push('样本偏少，评级仅供参考。');
    return {
      grade, label: { S: '顶尖选手', A: '上等马', B: '中等马', C: '下等马', D: '数据表现风险' }[grade],
      longTerm: Math.round(lt), recent: Math.round(rc), confidence: +confidence.toFixed(2),
      reasons, sampleSize: stats.total, mode: mk, modeLabel: mlabel,
      note: `评级仅基于「${mlabel}」真实对局+段位，不跨模式混算；为相对表现非永久标签；D 级仅描述当前可用数据，非对真人的评价。`,
    };
  }

  // ---- full profile ----
  async function profile(puuid, { refresh = false, count = 20, serverId, modeKey } = {}) {
    let player = db.get('SELECT * FROM players WHERE puuid=?', [puuid]);
    const s = lcu.getState();
    let hist = { matches: cachedMatches(puuid, count), usedSgp: false, note: null, source: 'cache', fetchedAt: null };
    if (hist.matches.length) {
      const r = db.get('SELECT MAX(fetchedAt) t FROM matches WHERE puuid=?', [puuid]);
      hist.fetchedAt = r && r.t;
    }
    if (refresh) {
      try { hist = await fetchHistory(puuid, { count, serverId }); }
      catch (e) { hist.note = String(e.message || e); hist.errorKind = e.kind || classify(e).kind; }
    }
    let rank = null;
    if (s.loggedIn && (!serverId || String(serverId).toUpperCase() === String(s.platformId || '').toUpperCase())) {
      rank = await getRanked(puuid);
      if (rank && player) { db.run('UPDATE players SET rankTier=?,rankDivision=?,rankLp=?,rankWins=?,rankLosses=? WHERE puuid=?', [rank.tier, rank.division, rank.lp, rank.wins, rank.losses, puuid]); db.persist(); }
      // 本人头像与游戏内一致：从 LCU 当前/by-puuid summoner 刷新 profileIconId（缓存可能过期）
      if (player && (puuid === config.get('selfPuuid') || !serverId)) {
        try {
          const sum = await lcu.getSummonerByPuuid(puuid);
          if (sum && sum.profileIconId != null && sum.profileIconId !== player.profileIconId) {
            db.run('UPDATE players SET profileIconId=? WHERE puuid=?', [sum.profileIconId, puuid]); db.persist();
            player = { ...player, profileIconId: sum.profileIconId };
          }
        } catch {}
      }
    }
    // 评级分模式：默认取竞技口径（单双排→灵活→匹配→快速），可用 modeKey 覆盖；大乱斗/人机不混入排位参考
    const mk = modeKey || defaultRatingMode(hist.matches);
    const stats = computeStats(hist.matches, puuid, mk);
    const rating = rate(stats, rank, mk);
    const allStats = computeStats(hist.matches, puuid, 'all');
    return {
      player: player ? { ...player, data: undefined } : { puuid, name: '未知' },
      rank, stats, rating, allStats, history: hist, ratingMode: mk,
      fromCache: hist.source === 'cache',
      servedAt: new Date().toISOString(),
      available: available(),
    };
  }

  // Resolve a champ-select cell (summonerId) into name + puuid + cached profile.
  async function resolveCell(cell) {
    if (!cell) return null;
    const out = { championId: cell.championId, position: cell.assignedPosition, summonerId: cell.summonerId, isSelf: cell.isSelf };
    const s = lcu.getState();
    if (cell.summonerId && s.loggedIn) {
      try {
        const sum = await lcu.getSummonerById(cell.summonerId);
        if (sum && sum.puuid) {
          out.puuid = sum.puuid; out.name = sum.displayName || sum.gameName || sum.internalName;
          upsertPlayer({ puuid: sum.puuid, summonerId: sum.summonerId, name: out.name, serverId: s.platformId, region: s.region, profileIconId: sum.profileIconId, level: sum.summonerLevel, source: 'lcu', fetchedAt: new Date().toISOString(), confidence: 0.9 });
          db.persist();
          const cached = db.get('SELECT * FROM players WHERE puuid=?', [sum.puuid]);
          const matches = cachedMatches(sum.puuid, 20);
          if (matches.length) { out.stats = computeStats(matches, sum.puuid); out.rating = rate(out.stats, cached && cached.rankTier ? { tier: cached.rankTier, division: cached.rankDivision } : null); }
        }
      } catch (e) { out.resolveError = String(e.message || e); }
    }
    return out;
  }

  // 单局十人快速评级：仅读本地缓存（无网络），供对局详情表即时展示；深度侦察走 profile(refresh)。
  function scoutParticipants(list, modeKey) {
    return (list || []).map(pp => {
      if (!pp || !pp.puuid) return { puuid: null, rating: null, games: 0 };
      const matches = cachedMatches(pp.puuid, 40);
      const row = db.get('SELECT rankTier,rankDivision FROM players WHERE puuid=?', [pp.puuid]);
      const mk = modeKey || defaultRatingMode(matches);
      const stats = computeStats(matches, pp.puuid, mk);
      const rating = rate(stats, row && row.rankTier ? { tier: row.rankTier, division: row.rankDivision } : null, mk);
      // 近期状态（近5真实胜负）+ 主玩英雄（缓存场次最高），供对局表状态列
      const recent = matches.slice(0, 5).map(m => (m.me ? m.me.win : null));
      const recentWins = recent.filter(w => w === true).length;
      const recentKnown = recent.filter(w => w != null).length;
      const top = (stats.byChampion || [])[0] || null;
      return {
        puuid: pp.puuid, rating, games: stats.total, winRate: stats.winRate, avgKDA: stats.avgKDA,
        rank: row && row.rankTier ? { tier: row.rankTier, division: row.rankDivision } : null,
        recent, recentWinRate: recentKnown ? recentWins / recentKnown : null,
        mainChampionId: top ? top.championId : null, mainGames: top ? top.games : 0, mainWinRate: top ? top.winRate : null,
      };
    });
  }

  function recentPlayers() { return db.all('SELECT * FROM player_recent ORDER BY queriedAt DESC LIMIT 20'); }
  function deleteRecent(puuid) { db.run('DELETE FROM player_recent WHERE puuid=?', [puuid]); db.persist(); return true; }
  function clearRecent() { db.run('DELETE FROM player_recent'); db.persist(); return true; }
  function favoritePlayers() { return db.all('SELECT * FROM player_favorites ORDER BY addedAt DESC'); }
  function toggleFavorite(puuid, name) {
    const ex = db.get('SELECT 1 x FROM player_favorites WHERE puuid=?', [puuid]);
    if (ex) db.run('DELETE FROM player_favorites WHERE puuid=?', [puuid]);
    else db.run('INSERT INTO player_favorites(puuid,name,addedAt) VALUES(?,?,?)', [puuid, name || '', new Date().toISOString()]);
    db.persist(); return !ex;
  }
  function focusList() { return db.all('SELECT * FROM player_focus ORDER BY addedAt DESC'); }
  function setFocus(puuid, name, threat, note) {
    db.run('INSERT INTO player_focus(puuid,name,threat,note,addedAt) VALUES(?,?,?,?,?) ON CONFLICT(puuid) DO UPDATE SET threat=excluded.threat,note=excluded.note', [puuid, name || '', threat ? 1 : 0, note || '', new Date().toISOString()]);
    db.persist();
  }
  function removeFocus(puuid) { db.run('DELETE FROM player_focus WHERE puuid=?', [puuid]); db.persist(); }

  return { available, channels, search, confirmCandidate, searchHistory, deleteSearchHistory, clearSearchHistory, profile, fetchHistory, getMatchDetail, computeStats, rate, cachedMatches, scoutParticipants, resolveCell, recentPlayers, deleteRecent, clearRecent, favoritePlayers, toggleFavorite, focusList, setFocus, removeFocus, defaultRatingMode, modeLabel, RANK_CN, RANK_ORDER };
}

module.exports = { createPlayerEngine, RANK_CN, RANK_ORDER };