'use strict';
/**
 * NEXUS SGP ENGINE adapter (read-only).
 * SGP = the match-history platform API. Tencent (国服) LCU only returns the first
 * page reliably; SGP supports deep pagination via an entitlements Bearer token.
 *
 * 主机与路径事实来源：LeagueAkari dev 内置配置（2026-07-18 更新）+ lol-copilot
 * 2026-11-01 HN1 实测记录（见 tools/research/akari-sgp-findings.json）。腾讯大区
 * 已合并为联盟一~五区等，旧 HN2-HN12 代码不再使用。地址为开源社区验证事实，本机
 * 连通性以用户实机为准；未知大区回退通用主机模式并明确标记未验证。
 * Tokens stay in memory; never persisted/uploaded.
 */
const https = require('https');

// 当前国服大区（rso_platform_id → SGP 主机，端口 21019）。verified=社区源码+实测交叉验证。
const TENCENT_REGIONS = [
  { id: 'HN1', name: '艾欧尼亚', host: 'https://hn1-k8s-sgp.lol.qq.com:21019', verified: true },
  { id: 'HN10', name: '黑色玫瑰', host: 'https://hn10-k8s-sgp.lol.qq.com:21019', verified: true },
  { id: 'NJ100', name: '联盟一区', host: 'https://nj100-sgp.lol.qq.com:21019', verified: true },
  { id: 'GZ100', name: '联盟二区', host: 'https://gz100-sgp.lol.qq.com:21019', verified: true },
  { id: 'CQ100', name: '联盟三区', host: 'https://cq100-sgp.lol.qq.com:21019', verified: true },
  { id: 'TJ100', name: '联盟四区', host: 'https://tj100-sgp.lol.qq.com:21019', verified: true },
  { id: 'TJ101', name: '联盟五区', host: 'https://tj101-sgp.lol.qq.com:21019', verified: true },
  { id: 'BGP2', name: '峡谷之巅', host: 'https://bgp2-k8s-sgp.lol.qq.com:21019', verified: true },
  { id: 'PBE', name: '体验服', host: 'https://pbe-sgp.lol.qq.com:21019', verified: true, test: true },
  { id: 'PREPBE', name: '预体验服', host: 'https://prepbe-sgp.lol.qq.com:21019', verified: true, test: true },
];
// 直营服：matchHistory 走集群主机，单局路径前缀用 regionPathParam。
const RIOT_REGIONS = [
  { id: 'KR', name: '韩服', host: 'https://apne1-red.pp.sgp.pvp.net', common: 'https://kr-red.lol.sgp.pvp.net', verified: true },
  { id: 'JP1', name: '日服', host: 'https://apne1-red.pp.sgp.pvp.net', common: 'https://jp-red.lol.sgp.pvp.net', regionPathParam: 'JP1', verified: true },
  { id: 'NA1', name: '北美', host: 'https://usw2-red.pp.sgp.pvp.net', common: 'https://na-red.lol.sgp.pvp.net', verified: true },
  { id: 'EUW1', name: '西欧', host: 'https://euc1-red.pp.sgp.pvp.net', common: 'https://euw-red.lol.sgp.pvp.net', regionPathParam: 'EUW1', verified: true },
  { id: 'EUN1', name: '东欧', host: 'https://euc1-red.pp.sgp.pvp.net', common: 'https://eun-red.lol.sgp.pvp.net', verified: false },
  { id: 'OC1', name: '大洋洲', host: 'https://apse1-red.pp.sgp.pvp.net', common: 'https://oce-red.lol.sgp.pvp.net', verified: true },
  { id: 'BR1', name: '巴西', host: 'https://usw2-red.pp.sgp.pvp.net', common: 'https://br-red.lol.sgp.pvp.net', verified: true },
  { id: 'TR1', name: '土耳其', host: 'https://euc1-red.pp.sgp.pvp.net', common: 'https://tr-red.lol.sgp.pvp.net', verified: true },
  { id: 'RU', name: '俄罗斯', host: 'https://euc1-red.pp.sgp.pvp.net', common: 'https://ru-red.lol.sgp.pvp.net', verified: true },
  { id: 'LA1', name: '拉丁北美', host: 'https://usw2-red.pp.sgp.pvp.net', common: 'https://lan-red.lol.sgp.pvp.net', verified: true },
  { id: 'LA2', name: '拉丁南美', host: 'https://usw2-red.pp.sgp.pvp.net', common: 'https://las-red.lol.sgp.pvp.net', verified: true },
  { id: 'SG2', name: '新加坡', host: 'https://apse1-red.pp.sgp.pvp.net', common: 'https://sg2-red.lol.sgp.pvp.net', verified: true },
  { id: 'TW2', name: '台服', host: 'https://apse1-red.pp.sgp.pvp.net', common: 'https://tw2-red.lol.sgp.pvp.net', verified: true },
];

function regionById(platformId) {
  const p = String(platformId || '').toUpperCase();
  return TENCENT_REGIONS.find(r => r.id === p) || RIOT_REGIONS.find(r => r.id === p) || null;
}

// 单局路径前缀：腾讯 = 大区 ID；直营服 = regionPathParam 或大区 ID。
function subIdFor(platformId, tencent) {
  const p = String(platformId || '').toUpperCase();
  if (tencent) return p;
  const r = regionById(p);
  return (r && r.regionPathParam) || p;
}

function candidateHosts(platformId, tencent, customHost) {
  if (customHost) return [customHost.replace(/\/$/, '')];
  const p = String(platformId || '').toLowerCase();
  if (!p) return [];
  const known = regionById(platformId);
  const hosts = [];
  if (known && known.host) hosts.push(known.host);
  if (tencent) {
    // 通用模式兜底（未知/旧大区代码）：未验证，结果中会标记
    hosts.push(`https://${p}-k8s-sgp.lol.qq.com:21019`, `https://${p}-sgp.lol.qq.com:21019`, `https://${p}-red.lol.sgp.pvp.net`);
  } else {
    hosts.push(`https://${p}-red.lol.sgp.pvp.net`);
  }
  return [...new Set(hosts)];
}

function sgpRequest(host, path, token, { timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(host + path);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      rejectUnauthorized: true, // public SGP endpoints: verify cert
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      timeout,
    }, (res) => {
      // do not follow redirects (security: limit targets to built-in hosts)
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return reject(Object.assign(new Error('SGP redirect blocked'), { status: res.statusCode })); }
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(buf ? JSON.parse(buf) : null); } catch { resolve(buf); } }
        else reject(Object.assign(new Error('SGP HTTP ' + res.statusCode), { status: res.statusCode }));
      });
    });
    req.on('timeout', () => req.destroy(new Error('SGP timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function tryHosts(hosts, path, token) {
  let lastErr;
  for (const host of hosts) {
    try {
      const raw = await sgpRequest(host, path, token);
      const known = regionById(host.replace(/^https?:\/\//, '').split(/[-.]/)[0]);
      return { raw, host, verifiedHost: !!(known && known.host === host) };
    } catch (e) { lastErr = e; if (e.status === 401 || e.status === 403) throw e; /* auth error: don't try other hosts */ }
  }
  throw lastErr || new Error('SGP 不可用');
}

// Fetch a page of match history; tries candidate hosts until one responds.
async function getMatchHistory({ token, platformId, tencent, puuid, startIndex = 0, count = 20, customHost }) {
  const hosts = candidateHosts(platformId, tencent, customHost);
  if (!hosts.length) throw new Error('无法确定 SGP 服务器地址（缺少大区信息）');
  if (!token) throw new Error('缺少 SGP 凭据（需登录客户端获取 entitlements token）');
  const path = `/match-history-query/v1/products/lol/player/${encodeURIComponent(puuid)}/SUMMARY?startIndex=${startIndex}&count=${count}`;
  return tryHosts(hosts, path, token);
}

// 单局完整摘要（跨区详情可用）：{subId}_{gameId}/SUMMARY，返回与历史页相同的 json 结构。
async function getGameSummary({ token, platformId, tencent, gameId, customHost }) {
  const hosts = candidateHosts(platformId, tencent, customHost);
  if (!hosts.length) throw new Error('无法确定 SGP 服务器地址（缺少大区信息）');
  if (!token) throw new Error('缺少 SGP 凭据（需登录客户端获取 entitlements token）');
  const subId = subIdFor(platformId, tencent);
  const path = `/match-history-query/v1/products/lol/${encodeURIComponent(subId)}_${encodeURIComponent(gameId)}/SUMMARY`;
  return tryHosts(hosts, path, token);
}

// 单局 DETAILS（实验性只读探测）：尝试 DETAILS 端点，返回原始 json 供检查 perks/加点/timeline 字段。
// 国服可用性未确认；失败/404 由调用方诚实降级，不伪造。
async function getGameDetails({ token, platformId, tencent, gameId, customHost }) {
  const hosts = candidateHosts(platformId, tencent, customHost);
  if (!hosts.length) throw new Error('无法确定 SGP 服务器地址（缺少大区信息）');
  if (!token) throw new Error('缺少 SGP 凭据（需登录客户端获取 entitlements token）');
  const subId = subIdFor(platformId, tencent);
  const path = `/match-history-query/v1/products/lol/${encodeURIComponent(subId)}_${encodeURIComponent(gameId)}/DETAILS`;
  return tryHosts(hosts, path, token);
}

// Normalize an SGP game into our unified match shape.
// 真实响应外层为 { metadata, json }（Akari 类型定义证实），必须先解包 json。
// 按 PUUID 定位本人，绝不假设 participant[0]。
function normalizeGame(raw, puuid) {
  if (!raw) return null;
  const g = raw.json || raw.game || raw;
  const participants = (g.participants || raw.participants || []).map(p => normalizeParticipant(p));
  const me = participants.find(p => p.puuid === puuid) || null;
  return {
    gameId: g.gameId || raw.gameId,
    queueId: g.queueId || raw.queueId,
    mode: g.gameMode || raw.gameMode,
    gameCreation: g.gameCreation || raw.gameCreation,
    duration: g.gameDuration || raw.gameDuration,
    platformId: g.platformId || null,
    participants, me,
    source: 'sgp',
  };
}
function normalizeParticipant(p) {
  const s = p.stats || p; // SGP 为扁平结构（无 stats 嵌套），LCU 转换后同形
  return {
    puuid: p.puuid || (p.player && p.player.puuid),
    name: p.riotIdGameName || (p.player && (p.player.gameName || p.player.summonerName)) || p.summonerName || null,
    tagLine: p.riotIdTagLine || (p.player && p.player.tagLine) || null,
    championId: p.championId,
    position: p.teamPosition || p.individualPosition || null,
    teamId: p.teamId,
    win: s.win != null ? !!s.win : null,
    kills: s.kills ?? null, deaths: s.deaths ?? null, assists: s.assists ?? null,
    cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0) || null,
    gold: s.goldEarned ?? null,
    damage: s.totalDamageDealtToChampions ?? null,
    vision: s.visionScore ?? null,
    items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5].filter(x => x != null && x > 0),
    spells: [p.spell1Id, p.spell2Id].filter(x => x != null),
    perks: extractPerks(p.perks),
    level: s.champLevel ?? null,
  };
}
// 符文提取：主系/副系/基石/属性碎片，供历史行与复盘可视化
function extractPerks(perks) {
  if (!perks || !perks.styles) return null;
  const st0 = perks.styles[0] || {}, st1 = perks.styles[1] || {};
  return {
    primary: st0.style != null ? st0.style : null,
    sub: st1.style != null ? st1.style : null,
    keystone: st0.selections && st0.selections[0] ? st0.selections[0].perk : null,
    primaryRunes: (st0.selections || []).map(x => x.perk).filter(Boolean),
    subRunes: (st1.selections || []).map(x => x.perk).filter(Boolean),
    statPerks: perks.statPerks || null,
  };
}

module.exports = { TENCENT_REGIONS, RIOT_REGIONS, regionById, subIdFor, candidateHosts, getMatchHistory, getGameSummary, getGameDetails, normalizeGame, normalizeParticipant, extractPerks };