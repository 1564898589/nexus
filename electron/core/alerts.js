'use strict';
/**
 * Intelligence Alert engine. Watches LCU champ-select state against the user's
 * focus/threat list and cached signature champions. Local-only; emits events,
 * persists a bounded alert log. Never writes to the client.
 */
const fs = require('fs');
const path = require('path');

function createAlerts(dir, db, config, events, logger) {
  const log = logger ? logger.child('alerts') : { info() {}, warn() {} };
  const file = path.join(dir, 'alerts.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { items = []; }
  let lastKey = null;

  const settings = () => ({
    enabled: config.get('alertsEnabled') !== false,
    focusEnemy: config.get('alertFocusEnemy') !== false,
    signatureEnemy: config.get('alertSignatureEnemy') !== false,
    selfBan: config.get('alertSelfBan') !== false,
  });

  function persist() {
    // 原子写：tmp+rename，避免写一半崩溃留下损坏的 alerts.json
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(items.slice(0, 200)));
      fs.renameSync(tmp, file);
    } catch (e) { log.warn('persist', e.message); }
  }
  function push(kind, title, body, meta) {
    const it = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), kind, title, body, meta: meta || null, at: new Date().toISOString(), read: false };
    items.unshift(it); items = items.slice(0, 200); persist();
    events.emit('nexus-alert', it);
    log.info('alert', { kind, title });
    return it;
  }

  // Called on every lcu-state change.
  function onLcuState(s) {
    const st = settings();
    if (!st.enabled || !s || !s.champSelect) { lastKey = null; return; }
    const cs = s.champSelect;
    const key = (cs.gameId || '') + '|' + (cs.myTeam || []).map(p => p.championId).join(',') + '|' + (cs.theirTeam || []).map(p => p.championId).join(',');
    if (key === lastKey) return; // only alert when the draft actually changes
    lastKey = key;
    const focus = db.all('SELECT * FROM player_focus');
    const focusBySummoner = {};
    for (const f of focus) {
      const p = db.get('SELECT puuid,summonerId,name FROM players WHERE puuid=?', [f.puuid]);
      if (p && p.summonerId) focusBySummoner[p.summonerId] = { ...f, name: p.name };
    }
    const champName = (id) => { const c = db.get('SELECT nameCn FROM champions WHERE id=?', [id]); return c ? c.nameCn : ('#' + id); };
    for (const p of cs.theirTeam || []) {
      const f = p.summonerId && focusBySummoner[p.summonerId];
      if (st.focusEnemy && f) push('focus-enemy', `标记玩家出现在敌方：${f.name || '未知'}`, f.threat ? '你已将其标记为威胁。建议查看其绝活英雄并优先针对。' : '你关注的玩家本场在敌方。', { puuid: f.puuid });
      if (st.signatureEnemy && p.championId) {
        const pl = p.summonerId && db.get('SELECT puuid FROM players WHERE summonerId=?', [p.summonerId]);
        if (pl) {
          const rows = db.all('SELECT championId, COUNT(*) g, SUM(win) w FROM matches WHERE puuid=? GROUP BY championId HAVING g>=5', [pl.puuid]);
          const sig = rows.find(r => r.championId === p.championId && r.w / r.g >= 0.55);
          if (sig) push('signature-enemy', `敌方选出绝活英雄：${champName(p.championId)}`, `该玩家使用此英雄 ${sig.g} 场、胜率 ${(sig.w / sig.g * 100).toFixed(0)}%（本地缓存真实战绩）。威胁上调，建议针对或封锁。`, { championId: p.championId });
        }
      }
    }
    if (st.selfBan) {
      const me = (cs.myTeam || []).find(p => p.isSelf);
      const myPu = me && me.summonerId && db.get('SELECT puuid FROM players WHERE summonerId=?', [me.summonerId]);
      if (myPu) {
        const rows = db.all('SELECT championId, COUNT(*) g, SUM(win) w FROM matches WHERE puuid=? GROUP BY championId HAVING g>=5', [myPu.puuid]);
        const banned = (cs.bans && cs.bans.theirTeam) || [];
        for (const r of rows) {
          if (r.w / r.g >= 0.55 && banned.includes(r.championId)) push('self-ban', `你的绝活被禁：${champName(r.championId)}`, `此英雄你 ${r.g} 场胜率 ${(r.w / r.g * 100).toFixed(0)}%。建议启用备选英雄池。`, { championId: r.championId });
        }
      }
    }
  }

  return {
    onLcuState, settings, push,
    list: (n = 50) => items.slice(0, n),
    unread: () => items.filter(i => !i.read).length,
    markRead: (id) => { const it = items.find(i => i.id === id); if (it) { it.read = true; persist(); } return true; },
    markAllRead: () => { items.forEach(i => i.read = true); persist(); return true; },
    clear: () => { items = []; persist(); return true; },
  };
}

module.exports = { createAlerts };