// Unit tests for replay/growth analytics + alert engine logic (synthetic inputs
// to verify computation; the app itself only ever uses real cached data).
const assert = require('assert');
const { analyzeMatch, growthReport } = require('../electron/analytics/replay');
const { createAlerts } = require('../electron/core/alerts');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '::', e.message); } };

const mk = (o) => ({ gameCreation: Date.now(), duration: 1800, mode: 'CLASSIC', queueId: 420, source: 'lcu', me: { win: true, championId: 103, position: 'MID', kills: 8, deaths: 2, assists: 10, cs: 210, gold: 14000, damage: 22000, vision: 25, items: [3157, 3089] }, ...o });

check('analyzeMatch: facts/inferences/advice tagged & real comparisons', () => {
  const matches = [mk(), mk({ me: { win: false, championId: 103, position: 'MID', kills: 2, deaths: 9, assists: 3, cs: 120, gold: 9000, damage: 9000, vision: 8 } }), mk(), mk()];
  const stats = { total: 4, avgKDA: 3, avgDeaths: 4, avgCs: 180, avgDamage: 16000, avgVision: 20 };
  const r = analyzeMatch(matches[1], stats);
  assert(r.facts.length >= 2 && r.inferences.length >= 1 && r.advice.length >= 1);
  assert(r.inferences.some(t => t.includes('死亡')));
  assert(Math.abs(r.csPerMin - 4) < 0.01);
  assert(r.dataCoverage.hasBaseline === true);
});

check('analyzeMatch: unknown duration => null per-min (never guessed)', () => {
  const r = analyzeMatch(mk({ duration: 0 }), null);
  assert(r.csPerMin === null && r.goldPerMin === null);
  assert(r.dataCoverage.hasBaseline === false);
});

check('growthReport: insufficient sample honest', () => {
  const r = growthReport([mk(), mk()], null);
  assert(r.enough === false && r.facts[0].includes('<6'));
});

check('growthReport: trend detection recent vs older', () => {
  const recent = Array.from({ length: 10 }, () => mk());
  const older = Array.from({ length: 10 }, () => mk({ me: { win: false, championId: 103, position: 'MID', kills: 1, deaths: 8, assists: 2, cs: 100, gold: 8000, damage: 8000, vision: 8 } }));
  const stats = { total: 20, poolDepth: 1, signature: [{ championId: 103, games: 20, winRate: 0.5 }], byChampion: [] };
  const r = growthReport([...recent, ...older], stats);
  assert(r.enough === true);
  assert(r.recent.winRate === 1 && r.older.winRate === 0);
  assert(r.inferences.some(t => t.includes('上升')));
  assert(r.advice.some(t => t.includes('英雄池')));
  assert(r.series.length === 20 && r.series[0].win === 0); // oldest first
});

// ---- alerts engine ----
function stubDb(focusRows, playerRows, matchRows, champRows) {
  return {
    all: (sql, params) => {
      if (sql.includes('player_focus')) return focusRows;
      if (sql.includes('GROUP BY championId')) return matchRows;
      return [];
    },
    get: (sql, params) => {
      if (sql.includes('FROM players WHERE puuid')) return playerRows.find(p => p.puuid === params[0]) || null;
      if (sql.includes('FROM players WHERE summonerId')) return playerRows.find(p => p.summonerId === params[0]) || null;
      if (sql.includes('FROM champions')) return champRows.find(c => c.id === params[0]) || null;
      return null;
    },
  };
}
const stubConfig = (() => { const m = {}; return { get: k => m[k], set: (k, v) => { m[k] = v; } }; })();
const stubEvents = { emitted: [], emit(n, p) { this.emitted.push({ n, p }); } };
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-alerts-'));

check('alerts: focus enemy + signature enemy + self-ban fire once per draft', () => {
  const db = stubDb(
    [{ puuid: 'P-ENEMY', threat: 1, note: '' }],
    [{ puuid: 'P-ENEMY', summonerId: 11, name: '敌方绝活哥' }, { puuid: 'P-ME', summonerId: 99, name: '我' }],
    [{ championId: 103, g: 10, w: 7 }],
    [{ id: 103, nameCn: '阿狸' }],
  );
  const alerts = createAlerts(tmp, db, stubConfig, stubEvents, null);
  const cs = {
    gameId: 1, myTeam: [{ isSelf: true, summonerId: 99, championId: 0 }],
    theirTeam: [{ summonerId: 11, championId: 103 }],
    bans: { theirTeam: [103], myTeam: [] },
  };
  alerts.onLcuState({ champSelect: cs });
  const kinds = stubEvents.emitted.map(e => e.p.kind);
  assert(kinds.includes('focus-enemy'), 'focus-enemy');
  assert(kinds.includes('signature-enemy'), 'signature-enemy');
  assert(kinds.includes('self-ban'), 'self-ban');
  const n1 = stubEvents.emitted.length;
  alerts.onLcuState({ champSelect: cs }); // same draft => no duplicate
  assert(stubEvents.emitted.length === n1, 'no duplicate alerts');
  assert(alerts.list().length === n1 && alerts.unread() === n1);
  alerts.markAllRead();
  assert(alerts.unread() === 0);
});

check('alerts: disabled => silent', () => {
  stubConfig.set('alertsEnabled', false);
  const db = stubDb([{ puuid: 'P-ENEMY', threat: 1 }], [{ puuid: 'P-ENEMY', summonerId: 11, name: 'x' }], [], []);
  const ev2 = { emitted: [], emit(n, p) { this.emitted.push(p); } };
  const a2 = createAlerts(tmp, db, stubConfig, ev2, null);
  a2.onLcuState({ champSelect: { gameId: 2, myTeam: [], theirTeam: [{ summonerId: 11, championId: 1 }], bans: {} } });
  assert(ev2.emitted.length === 0);
  stubConfig.set('alertsEnabled', true);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);