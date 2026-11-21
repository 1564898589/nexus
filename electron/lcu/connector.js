'use strict';
/**
 * NEXUS LCU ENGINE.
 * Talks ONLY to the local League Client's exposed local API (LCU). No game-memory
 * reads, no injection, no file modification, no anti-cheat bypass. Read-only by
 * default; any state-changing call (apply runes) requires explicit user confirmation.
 *
 * Riot states LCU is not a formally supported third-party API; endpoints may change
 * without notice. The engine degrades gracefully and reports per-endpoint availability.
 * Tencent (国服) compatibility is detected and adapted independently — a successful
 * non-Tencent connection is never assumed to imply 国服 success.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PHASES = ['None', 'Lobby', 'Matchmaking', 'ChampSelect', 'GameStart', 'InProgress', 'ReadyCheck', 'EndOfGame', 'PreEndOfGame', 'WaitingForStats', 'Reconnect'];

function ps(command) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
      (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

function readLockfile(f) {
  try {
    if (!fs.existsSync(f)) return null;
    const txt = fs.readFileSync(f, 'utf8').trim();
    // name:pid:port:token:protocol
    const parts = txt.split(':');
    if (parts.length >= 5 && parts[2] && parts[3]) {
      return { port: parseInt(parts[2], 10), token: parts[3], protocol: parts[4], installDir: path.dirname(f), source: 'lockfile', lockfile: f };
    }
  } catch { /* ignore */ }
  return null;
}

// Discover client via LeagueClientUx.exe command line (works for Riot & Tencent).
// 国服客户端常以管理员权限运行：非提权进程可能读不到 CommandLine/ExecutablePath
// （实测本机两者皆空）。返回 { info, sawProcess } 供上层给出诚实诊断。
async function discoverByProcess() {
  const out = await ps("Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress");
  if (!out || !out.trim()) return { info: null, sawProcess: false };
  let rows;
  try { rows = JSON.parse(out); } catch { return { info: null, sawProcess: false }; }
  if (!Array.isArray(rows)) rows = [rows];
  const sawProcess = rows.some(r => r && r.ProcessId);
  for (const r of rows) {
    if (!r) continue;
    const cmdline = String(r.CommandLine || '');
    const exePath = String(r.ExecutablePath || '');
    // 提权隔离下 WMI 字段为空时，Get-Process 的 Path 偶尔仍可读（有限信息查询）
    if (!exePath && r.ProcessId) {
      const p2 = await ps(`(Get-Process -Id ${parseInt(r.ProcessId, 10)} -ErrorAction SilentlyContinue).Path`);
      if (p2 && p2.trim()) exePath = p2.trim();
    }
    const port = (cmdline.match(/--app-port=(\d+)/) || [])[1];
    const token = (cmdline.match(/--remoting-auth-token=([\w-]+)/) || [])[1];
    if (port && token) {
      const installDir = (cmdline.match(/--install-directory=([^\s"]+)/) || [])[1] || (exePath ? path.dirname(exePath) : null);
      const grab = (re) => (cmdline.match(re) || [])[1] || null;
      return {
        info: {
          port: parseInt(port, 10), token, installDir, source: 'process',
          region: grab(/--region=([\w]+)/),                       // TENCENT / KR / NA ...
          platformId: grab(/--rso_platform_id=([\w]+)/),          // HN1 / CQ100 ...
          lcdsHost: grab(/--t\.lcdshost=([^\s"]+)/),
          edgeUrl: grab(/--t\.league_edge_url=([^\s"]+)/),
          riotClientPort: grab(/--riotclient-app-port=(\d+)/),
          riotClientToken: grab(/--riotclient-auth-token=([\w-]+)/),
          locale: grab(/--locale=([\w]+)/),
        },
        sawProcess,
      };
    }
    if (exePath) {
      const lf = readLockfile(path.join(path.dirname(exePath), 'lockfile'));
      if (lf) return { info: { ...lf, source: 'process-lockfile', exePath }, sawProcess };
    }
  }
  return { info: null, sawProcess };
}

// 注册表回退：国服安装路径写在 HKCU\Software\Tencent\LOL（InstallPath/setup），
// 不需要任何进程权限。实测本机客户端提权运行时此键仍可读。
async function discoverByRegistry() {
  // 中文路径必须强制 UTF-8 输出，否则默认 GBK 控制台编码会把 InstallPath 变成乱码
  const out = await ps("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-ItemProperty 'HKCU:\\Software\\Tencent\\LOL' -ErrorAction SilentlyContinue | Select-Object InstallPath,setup | ConvertTo-Json -Compress");
  if (!out || !out.trim()) return null;
  let reg;
  try { reg = JSON.parse(out); } catch { return null; }
  const dirs = [];
  if (reg.InstallPath) dirs.push(String(reg.InstallPath));
  if (reg.setup) dirs.push(path.dirname(String(reg.setup)));
  for (const d of dirs) {
    for (const rel of ['LeagueClient', '']) {
      const lf = readLockfile(path.join(d, rel, 'lockfile'));
      if (lf) return { ...lf, installDir: path.join(d, rel), source: 'registry-lockfile' };
    }
    // 腾讯版 lockfile 实测为 0 字节；客户端自己的启动日志记录了完整命令行（含 LCU 端口）。
    // 只读本地日志，凭据仅内存使用，不写盘不上传。
    const fromLog = discoverByClientLog(path.join(d, 'LeagueClient'));
    if (fromLog) return fromLog;
  }
  return null;
}

// 从客户端本地日志恢复 LCU 连接参数（提权隔离 + 空 lockfile 时的最终回退）。
// 日志文件名含启动时间与 PID；取最新一份，且仅当 PID 仍存活时采用，避免连到已退出的旧端口。
function discoverByClientLog(lcDir) {
  try {
    if (!fs.existsSync(lcDir)) return null;
    const logs = fs.readdirSync(lcDir).filter(f => /_LeagueClientUx\.log$/.test(f)).sort();
    for (let i = logs.length - 1; i >= 0 && i >= logs.length - 3; i--) {
      const m = logs[i].match(/_(\d+)_(\d+)_LeagueClientUx\.log$/);
      const pid = m ? parseInt(m[2], 10) : null;
      if (pid && !pidAlive(pid)) continue;
      const txt = fs.readFileSync(path.join(lcDir, logs[i]), 'utf8');
      const argLine = (txt.match(/Command line arguments: (.*)/) || [])[1] || '';
      const port = (argLine.match(/--app-port=(\d+)/) || [])[1];
      const token = (argLine.match(/--remoting-auth-token=([\w-]+)/) || [])[1];
      if (!port || !token) continue;
      const grab = (re) => (argLine.match(re) || [])[1] || null;
      return {
        port: parseInt(port, 10), token, installDir: lcDir, source: 'client-log',
        region: grab(/--region=([\w]+)/), platformId: grab(/--rso_platform_id=([\w]+)/),
        lcdsHost: grab(/--t\.lcdshost=([^\s"]+)/), edgeUrl: grab(/--t\.league_edge_url=([^\s"]+)/),
        riotClientPort: grab(/--riotclient-app-port=(\d+)/), riotClientToken: grab(/--riotclient-auth-token=([\w-]+)/),
        locale: grab(/--locale=([\w]+)/),
      };
    }
  } catch { /* ignore */ }
  return null;
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Fallback: lockfile (Riot standard path + common Tencent install layouts).
function discoverByLockfile() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(local, 'Riot Games', 'League of Legends', 'lockfile'),
  ];
  // Tencent installs often keep lockfile under the game dir; scan a few common roots.
  const roots = ['C:\\Program Files\\', 'C:\\Program Files (x86)\\', 'D:\\', 'E:\\', 'C:\\Games\\', 'C:\\', 'D:\\', 'E:\\'];
  for (const r of roots) {
    candidates.push(path.join(r, '英雄联盟', 'LeagueClient', 'lockfile'));
    candidates.push(path.join(r, 'League of Legends', 'LeagueClient', 'lockfile'));
    candidates.push(path.join(r, 'WeGame', '英雄联盟', 'LeagueClient', 'lockfile'));
    candidates.push(path.join(r, 'WeGame', 'Apps', '英雄联盟', 'LeagueClient', 'lockfile'));
    candidates.push(path.join(r, 'WeGameApps', '英雄联盟', 'LeagueClient', 'lockfile'));
    candidates.push(path.join(r, 'WeGameApps', '英雄联盟', 'lockfile'));
  }
  for (const f of candidates) {
    const lf = readLockfile(f);
    if (lf) return lf;
  }
  return null;
}

function detectTencent(info) {
  if (info.region && /tencent/i.test(info.region)) return true;
  const d = (info.installDir || '').toLowerCase();
  const hosts = ((info.lcdsHost || '') + ' ' + (info.edgeUrl || '')).toLowerCase();
  if (/lol\.qq\.com|tencent|wegame|腾讯/.test(hosts)) return true;
  return /英雄联盟|tencent|wegame/.test(d);
}

function createLcuEngine(logger, opts = {}) {
  const log = logger ? logger.child('lcu') : { info() {}, warn() {}, error() {} };
  let conn = null;             // {port, token, installDir, tencent}
  let state = {
    connected: false, running: false, loggedIn: false, tencent: false,
    phase: 'None', summoner: null, champSelect: null, perks: null,
    region: null, platformId: null, edgeUrl: null, lastError: null, endpointHealth: {}, updatedAt: null,
    lastDiscovery: null,
  };
  let timer = null;
  let listeners = [];
  let applying = false;
  let lastDiscoveryReason = null;

  function emit() { const s = { ...state }; for (const fn of listeners) { try { fn(s); } catch {} } }
  function onChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter(f => f !== fn); }; }

  function httpRequest(port, token, method, p, body) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = https.request({
        host: '127.0.0.1', port, path: p, method,
        rejectUnauthorized: false,
        headers: {
          Authorization: 'Basic ' + Buffer.from('riot:' + token).toString('base64'),
          Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
        timeout: 8000,
      }, (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(buf ? JSON.parse(buf) : null); } catch { resolve(buf); }
          } else {
            const e = new Error('LCU HTTP ' + res.statusCode + ' ' + p);
            e.status = res.statusCode; reject(e);
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('LCU timeout')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
  function request(method, p, body) {
    if (!conn) return Promise.reject(new Error('LCU not connected'));
    return httpRequest(conn.port, conn.token, method, p, body);
  }

  async function probeEndpoint(name, p) {
    try { await request('GET', p); state.endpointHealth[name] = 'ok'; return true; }
    catch (e) {
      // 英雄选择会话 404 = 当前不在 BP 阶段，属正常空闲态，不是端点故障
      if (name === 'champSelect' && e.status === 404) { state.endpointHealth[name] = 'idle'; return true; }
      state.endpointHealth[name] = e.status ? ('http-' + e.status) : 'error'; return false;
    }
  }

  async function refresh() {
    if (!conn) return;
    try {
      const sum = await request('GET', '/lol-summoner/v1/current-summoner');
      state.loggedIn = !!(sum && sum.summonerId);
      state.summoner = sum ? {
        summonerId: sum.summonerId, accountId: sum.accountId, puuid: sum.puuid,
        displayName: sum.displayName || sum.gameName || sum.internalName,
        gameName: sum.gameName, tagLine: sum.tagLine, level: sum.summonerLevel,
        profileIconId: sum.profileIconId, xpSinceLastLevel: sum.xpSinceLastLevel,
      } : null;
      state.lastError = null;
    } catch (e) {
      state.loggedIn = false;
      state.lastError = String(e.message || e);
    }
    try { const ph = await request('GET', '/lol-gameflow/v1/gameflow-phase'); state.phase = typeof ph === 'string' ? ph : (ph && ph.phase) || 'None'; }
    catch { state.phase = state.loggedIn ? 'Lobby' : 'None'; }

    if (state.phase === 'ChampSelect') {
      try {
        const cs = await request('GET', '/lol-champ-select/v1/session');
        state.champSelect = normalizeChampSelect(cs);
      } catch (e) { state.champSelect = null; state.endpointHealth.champSelect = 'http-' + (e.status || 'err'); }
    } else {
      state.champSelect = null;
    }
    state.updatedAt = new Date().toISOString();
    emit();
  }

  function normalizeChampSelect(cs) {
    if (!cs || !cs.actions) return null;
    const myCell = cs.localPlayerCellId;
    const team = (cs.myTeam || []).map(p => ({
      cellId: p.cellId, championId: p.championId, championPickIntent: p.championPickIntent,
      assignedPosition: p.assignedPosition, spell1: p.spell1, spell2: p.spell2,
      isSelf: p.cellId === myCell, summonerId: p.summonerId,
    }));
    const bench = (cs.benchChampions || []).map(b => ({ championId: b.championId, cellId: b.cellId }));
    const enemy = (cs.theirTeam || []).map(p => ({ cellId: p.cellId, championId: p.championId, assignedPosition: p.assignedPosition }));
    const bans = { myTeam: (cs.bans && cs.bans.myTeamBans) || [], theirTeam: (cs.bans && cs.bans.theirTeamBans) || [] };
    // flatten actions to find current pick/ban turn
    const flat = [];
    for (const group of cs.actions || []) for (const a of group) flat.push(a);
    const active = flat.find(a => a.isInProgress && !a.completed);
    return {
      gameId: cs.gameId, phase: cs.timer ? cs.timer.phase : null, myCell,
      myTeam: team, theirTeam: enemy, bench, bans,
      activeAction: active ? { id: active.id, type: active.type, championId: active.championId, actorCellId: active.actorCellId, isAllyAction: active.isAllyAction } : null,
      myPick: team.find(t => t.isSelf) || null,
    };
  }

  async function connect() {
    const proc = await discoverByProcess();
    let info = proc.info;
    if (!info) info = await discoverByRegistry();
    if (!info) info = discoverByLockfile();
    if (!info) {
      const reason = proc.sawProcess
        ? '检测到 LeagueClientUx.exe 进程，但客户端以更高权限运行，凭据与安装路径均不可读；注册表（HKCU\\Software\\Tencent\\LOL）与常见路径也未找到 lockfile。请确认客户端已登录，或以管理员身份运行 NEXUS。'
        : '未找到 LeagueClientUx.exe 进程，常见安装路径也没有 lockfile。请确认英雄联盟客户端已启动并登录（WeGame 启动亦可）；若客户端以管理员身份运行，请尝试同样以管理员身份运行 NEXUS。';
      state.lastDiscovery = { at: new Date().toISOString(), ok: false, reason };
      if (lastDiscoveryReason !== reason) { lastDiscoveryReason = reason; log.info('discovery failed', { reason }); }
      if (state.connected || state.running) { state.connected = false; state.running = false; state.loggedIn = false; state.phase = 'None'; state.summoner = null; state.champSelect = null; emit(); }
      return false;
    }
    lastDiscoveryReason = null;
    state.lastDiscovery = { at: new Date().toISOString(), ok: true, source: info.source, port: info.port };
    const changed = !conn || conn.port !== info.port || conn.token !== info.token;
    conn = { ...info, tencent: detectTencent(info) };
    state.running = true; state.tencent = conn.tencent; state.installDir = conn.installDir; state.source = info.source;
    state.region = conn.region || null; state.platformId = conn.platformId || null; state.edgeUrl = conn.edgeUrl || null;
    if (changed) { log.info('client discovered', { port: conn.port, tencent: conn.tencent, platformId: conn.platformId, source: info.source }); state.endpointHealth = {}; }
    state.connected = true;
    // probe a few endpoints to report 国服 availability honestly
    await probeEndpoint('summoner', '/lol-summoner/v1/current-summoner');
    await probeEndpoint('gameflow', '/lol-gameflow/v1/gameflow-phase');
    await probeEndpoint('perks', '/lol-perks/v1/pages');
    await probeEndpoint('champSelect', '/lol-champ-select/v1/session');
    await refresh();
    // 腾讯 LCU 的 self 战绩路径无效（400），必须用 puuid；未登录时如实标记
    if (state.summoner && state.summoner.puuid) {
      await probeEndpoint('matchHistory', `/lol-match-history/v1/products/lol/${encodeURIComponent(state.summoner.puuid)}/matches?begIndex=0&endIndex=0`);
    } else {
      state.endpointHealth.matchHistory = 'login-required';
    }
    // 腾讯客户端无 /lol-entitlements HTTP 路由；凭据实际来自 Riot Client，按真实可用性标记
    try { state.endpointHealth.entitlements = (await getEntitlementsToken()) ? 'ok' : 'unavailable'; }
    catch { state.endpointHealth.entitlements = 'unavailable'; }
    return true;
  }

  function start(interval = 2500) {
    if (timer) return;
    // 重入守卫：powershell 进程查询在慢机器上可能超过轮询间隔，
    // 无守卫时并发 discover 会堆积并互相覆盖连接状态。
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!conn) { await connect(); }
        else {
          // verify still alive
          try { await request('GET', '/lol-gameflow/v1/gameflow-phase'); await refresh(); }
          catch { conn = null; state.connected = false; state.running = false; state.loggedIn = false; state.phase = 'None'; state.summoner = null; state.champSelect = null; emit(); await connect(); }
        }
      } catch (e) { state.lastError = String(e.message || e); emit(); }
      finally { busy = false; }
    };
    tick();
    timer = setInterval(tick, interval);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  async function getPerkPages() { return request('GET', '/lol-perks/v1/pages'); }
  async function getCurrentSummoner() { return request('GET', '/lol-summoner/v1/current-summoner'); }
  async function getMatchHistory(puuid, beg = 0, end = 19) {
    return request('GET', `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=${beg}&endIndex=${end}`);
  }
  async function getMatchDetail(gameId) { return request('GET', `/lol-match-history/v1/games/${gameId}`); }
  async function getSummonerByName(name) {
    const n = String(name || '');
    try {
      return await request('GET', `/lol-summoner/v1/summoners?name=${encodeURIComponent(n)}`);
    } catch (e) {
      // 国服实测：纯昵称 → 422 INVALID_EMPTY_REQUEST；完整 Riot ID（昵称#标签）→ 200
      if (conn && conn.tencent && !n.includes('#') && (e.status === 422 || e.status === 400)) {
        throw Object.assign(new Error('国服客户端要求完整 Riot ID（昵称#标签，例如 超级会对线搞心态#42936）。仅凭昵称无法定位账号；标签可在客户端「个人资料」页或好友列表中查看。'), { kind: 'riot-id-required', status: e.status });
      }
      throw e;
    }
  }
  async function getSummonerById(id) { return request('GET', `/lol-summoner/v1/summoners/${id}`); }
  async function getSummonerByPuuid(puuid) { return request('GET', `/lol-summoner/v1/summoners/by-puuid/${encodeURIComponent(puuid)}`); }
  // Entitlements access token for SGP (kept in memory only; never persisted or uploaded).
  // 直营服：LCU /lol-entitlements/v1/entitlements。
  // 国服实测该路由 404；令牌来自 Riot Client 独立端口 /entitlements/v1/token（2026-11-20 本机 NJ100 实测 200，SGP 鉴权通过）。
  async function getEntitlementsToken() {
    try {
      const r = await request('GET', '/lol-entitlements/v1/entitlements');
      if (r && (r.accessToken || r.token)) return r.accessToken || r.token;
    } catch { /* 国服无此路由，回退 Riot Client */ }
    if (conn && conn.riotClientPort && conn.riotClientToken) {
      try {
        const r = await httpRequest(parseInt(conn.riotClientPort, 10), conn.riotClientToken, 'GET', '/entitlements/v1/token');
        if (r && r.accessToken) return r.accessToken;
      } catch (e) { log.warn('riotclient entitlements unavailable', String(e.message || e)); }
    }
    return null;
  }
  async function getRankedStats(puuid) {
    try { return await request('GET', `/lol-ranked/v1/ranked-stats/${encodeURIComponent(puuid)}`); }
    catch { return null; }
  }

  // V1.0 STRICT READ-ONLY: client writes are disabled by product policy.
  async function applyRunes() {
    throw new Error('NEXUS V1.0 采用严格只读模式，不支持写入客户端符文。请在游戏内手动配置。');
  }

  return {
    start, stop, onChange, connect,
    getState: () => ({ ...state }),
    request, getPerkPages, getCurrentSummoner, getMatchHistory, getMatchDetail,
    getSummonerByName, getSummonerById, getSummonerByPuuid, getEntitlementsToken, getRankedStats, applyRunes,
    discoverByProcess, discoverByRegistry, discoverByLockfile,
  };
}

module.exports = { createLcuEngine, PHASES, detectTencent };