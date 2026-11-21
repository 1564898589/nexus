'use strict';
/**
 * Proactive analyst (P1-9). Evaluates REAL cached match data against explicit thresholds
 * and surfaces insights through the existing alert channel (kind 'analyst:*').
 * Five trigger classes: winrate anomaly / champion decline / position weakness /
 * training stagnation / pool structure. Dedup + throttle via analyst_state; user toggle.
 * Never fabricates: every insight cites sample sizes and the cached-data basis.
 */
const THROTTLE_MS = 6 * 60 * 60 * 1000; // re-emit same fingerprint at most every 6h
const STAGNANT_DAYS = 3;

function createAnalyst({ db, config, players, alerts, events, logger }) {
  const log = logger ? logger.child('analyst') : { info() {}, warn() {} };
  const enabled = () => config.get('analystEnabled') !== false;
  const champName = (id) => { const c = db.get('SELECT nameCn,name FROM champions WHERE id=?', [id]); return c ? (c.nameCn || c.name) : ('#' + id); };
  const pct = (v) => (v * 100).toFixed(0) + '%';

  function stateGet(key) { return db.get('SELECT fingerprint,emittedAt,dismissed FROM analyst_state WHERE key=?', [key]); }
  function stateSet(key, fp) {
    db.run('INSERT INTO analyst_state(key,fingerprint,emittedAt,dismissed) VALUES(?,?,?,0) ON CONFLICT(key) DO UPDATE SET fingerprint=excluded.fingerprint,emittedAt=excluded.emittedAt,dismissed=0', [key, fp, new Date().toISOString()]);
  }

  // Compute candidate insights from real cached data. Returns [{kind,title,body,fingerprint,severity,action}].
  // action = {view, params, label} so every insight leads somewhere (linkage, not dead-end text).
  function compute() {
    const pu = config.get('selfPuuid') || config.get('intelPuuid');
    if (!pu) return [];
    const matches = players.cachedMatches(pu, 100);
    if (matches.length < 6) return [];
    const st = players.computeStats(matches, pu);
    const out = [];
    const ACT = {
      winrate: { view: 'replay', params: {}, label: '去复盘失败局' },
      champion: { view: 'growth', params: {}, label: '查看英雄池' },
      position: { view: 'growth', params: {}, label: '查看位置数据' },
      training: { view: 'growth', params: {}, label: '去完成训练' },
      pool: { view: 'growth', params: {}, label: '管理英雄池' },
    };

    // 1) winrate anomaly: recent10 vs long-term, sufficient sample
    if (st.recent10.games >= 8 && st.total >= 15) {
      const delta = st.recent10.winRate - st.winRate;
      if (st.recent10.winRate < 0.40 || delta <= -0.15) {
        out.push({ kind: 'winrate', severity: 'high', title: `近期胜率异常：近10场 ${pct(st.recent10.winRate)}`, body: `近10场胜率 ${pct(st.recent10.winRate)}，长期 ${pct(st.winRate)}（${st.total} 场），差 ${(delta * 100).toFixed(0)}pp。当前 ${st.streak || 0} 连${st.streakType === 'L' ? '败' : '胜'}。建议暂停连打，复盘 2 场失败局共同死亡模式（真实缓存）。`, fingerprint: `wr:${st.recent10.games}:${Math.round(st.recent10.winRate * 100)}:${Math.round(st.winRate * 100)}` });
      }
    }
    // 2) champion decline: signature/high-games champ recent winRate << overall
    const byCh = st.byChampion || [];
    for (const c of byCh) {
      if (c.games < 6) continue;
      const recent = matches.filter(m => m.me && m.me.championId === c.championId).slice(0, 6);
      if (recent.length < 4) continue;
      const rw = recent.filter(m => m.me.win === true).length / recent.length;
      if (c.winRate - rw >= 0.25 && c.winRate >= 0.5) {
        out.push({ kind: 'champion', severity: 'medium', title: `英雄状态下滑：${champName(c.championId)}`, body: `${champName(c.championId)} 长期 ${c.games} 场胜率 ${pct(c.winRate)}，但近 ${recent.length} 场仅 ${pct(rw)}。可能是版本/对位/熟练度波动；建议查近期对位与出装是否偏离主流（真实缓存）。`, fingerprint: `ch:${c.championId}:${c.games}:${Math.round(rw * 100)}` });
      }
    }
    // 3) position weakness: >=5 games winRate<45%
    for (const p of (st.byPosition || [])) {
      if (p.games >= 5 && p.wins / p.games < 0.45) {
        out.push({ kind: 'position', severity: 'medium', title: `位置短板：${p.position}`, body: `位置 ${p.position} 缓存 ${p.games} 场胜率 ${pct(p.wins / p.games)}（<45%）。样本已足，属结构性短板而非单场波动；建议针对性复盘该位置前 3 次死亡或暂避该位置排位（真实缓存）。`, fingerprint: `pos:${p.position}:${p.games}:${Math.round(p.wins / p.games * 100)}` });
      }
    }
    // 4) training stagnation: report with training_plan, none completed, older than N days
    const reps = db.all('SELECT id,title,report,createdAt FROM ai_reports WHERE report IS NOT NULL ORDER BY id DESC LIMIT 12');
    for (const r of reps) {
      let plan = [];
      try { plan = JSON.parse(r.report).training_plan || []; } catch { continue; }
      if (!plan.length) continue;
      const done = (config.get('rpTrain:' + r.id) || []).length;
      const ageDays = (Date.now() - new Date(r.createdAt).getTime()) / 86400000;
      if (done === 0 && ageDays >= STAGNANT_DAYS) {
        out.push({ kind: 'training', severity: 'low', title: `训练停滞：${r.title}`, body: `报告「${r.title}」给出 ${plan.length} 项训练，${ageDays.toFixed(0)} 天仍未勾选任何完成。建议先做最小的一项（now 档），或告诉我调整计划难度（真实训练勾选记录）。`, fingerprint: `tr:${r.id}:${plan.length}:${Math.floor(ageDays)}` });
        break; // only surface the most recent stagnant plan
      }
    }
    // 5) pool structure: shallow pool or over-reliance
    if (st.total >= 10) {
      const top = byCh[0];
      const share = top ? top.games / st.total : 0;
      if (st.poolDepth <= 2) {
        out.push({ kind: 'pool', severity: 'medium', title: `英雄池过浅：仅 ${st.poolDepth} 个英雄`, body: `缓存 ${st.total} 场只用了 ${st.poolDepth} 个英雄，被 ban/抢/counter 时无备选。建议补 1-2 个与绝活互补的版本强势英雄（真实缓存池深度）。`, fingerprint: `pool:depth:${st.poolDepth}:${st.total}` });
      } else if (top && share > 0.5) {
        out.push({ kind: 'pool', severity: 'low', title: `英雄池过度集中：${champName(top.championId)} 占 ${pct(share)}`, body: `${champName(top.championId)} 占 ${top.games}/${st.total} 场（${pct(share)}）。一旦受限影响大；建议把第二英雄场次提上来分散风险（真实缓存）。`, fingerprint: `pool:share:${top.championId}:${Math.round(share * 100)}` });
      }
    }
    return out;
  }

  function evaluate(reason) {
    if (!enabled()) return { emitted: 0, skipped: 'disabled' };
    let emitted = 0;
    const cands = compute();
    for (const c of cands) {
      const key = 'analyst:' + c.kind;
      const prev = stateGet(key);
      const now = Date.now();
      const sameFp = prev && prev.fingerprint === c.fingerprint;
      const throttled = prev && (now - new Date(prev.emittedAt).getTime()) < THROTTLE_MS;
      if (prev && prev.dismissed && sameFp) continue; // user dismissed this exact insight
      if (sameFp && throttled) continue;
      stateSet(key, c.fingerprint);
      alerts.push('analyst:' + c.kind, c.title, c.body, { severity: c.severity, reason: reason || 'eval', fingerprint: c.fingerprint, action: ACT[c.kind] || null });
      emitted++;
    }
    db.persist();
    if (emitted) log.info('evaluate', { reason, emitted });
    return { emitted, candidates: cands.length };
  }

  const ACTION_BY_KIND = {
    'analyst:winrate': { view: 'replay', params: {}, label: '去复盘失败局' },
    'analyst:champion': { view: 'growth', params: {}, label: '查看英雄池' },
    'analyst:position': { view: 'growth', params: {}, label: '查看位置数据' },
    'analyst:training': { view: 'growth', params: {}, label: '去完成训练' },
    'analyst:pool': { view: 'growth', params: {}, label: '管理英雄池' },
  };
  // backfill action for insights persisted before the action field existed
  function list(n = 30) {
    return alerts.list(200).filter(i => String(i.kind).startsWith('analyst:')).slice(0, n)
      .map(i => ({ ...i, meta: { ...(i.meta || {}), action: (i.meta && i.meta.action) || ACTION_BY_KIND[i.kind] || null } }));
  }
  function dismiss(id) { return alerts.markRead(id); }
  function setEnabled(v) { config.set('analystEnabled', !!v); return enabled(); }

  return { evaluate, compute, list, dismiss, setEnabled, enabled };
}

module.exports = { createAnalyst, THROTTLE_MS };