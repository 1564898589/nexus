'use strict';
/**
 * Rule-based tactical explanation engine ("AI 战术分析" without a hosted model).
 * Every output separates REAL OP.GG statistics from HEURISTIC reasoning.
 * No statistics are invented. Optional external-model hookup is documented but
 * never required for the app to function.
 */
const { traitsFor, analyzeTeam, scoreTeam, recommendForTeam } = require('./composition');

const pct = (x) => x == null ? '—' : String(parseFloat((x * 100).toFixed(1))) + '%';
const cn = (c) => c ? (c.nameCn || c.name || c.key) : '未知';

function explainCounter(my, enemy, counterStat, opts = {}) {
  const real = [];
  const reason = [];
  const perspective = opts.perspective || 'enemy';
  const srcName = opts.region === 'cn' ? '国服 101 官方榜' : 'OP.GG 韩服统计';
  if (counterStat && counterStat.winRate != null) {
    const owner = perspective === 'mine' ? my : enemy;
    const opp = perspective === 'mine' ? enemy : my;
    const small = counterStat.play != null && counterStat.play < 100 ? '样本偏小（<100 场），仅供参考。' : '';
    real.push(`${srcName}（${cn(owner)} 视角）：${cn(owner)} 对线 ${cn(opp)} 的胜率为 ${pct(counterStat.winRate)}（${counterStat.play ?? '—'} 场样本）。${small}`);
    const myWin = perspective === 'mine' ? counterStat.winRate : 1 - counterStat.winRate;
    real.push(`换算为我方视角：${cn(my)} 对线 ${cn(enemy)} 胜率约 ${pct(myWin)}（同一批对局样本），${myWin >= 0.5 ? '该对位我方占优' : '该对位我方偏劣'}。`);
  } else if (opts.region === 'cn') {
    real.push('国服 101 官方榜只列出克制英雄 ID，不提供对位胜率与样本量，无法给出真实对位统计。');
  } else {
    real.push('OP.GG 公开榜仅收录每个英雄最劣势的 3 个对位；该组合双向均未被收录，无直接样本。下方机制解读为启发式推理，非真实统计。');
  }
  const a = traitsFor(my), b = traitsFor(enemy);
  if (b.burst >= 2 && a.mobility <= 1) reason.push(`${cn(enemy)} 爆发高而 ${cn(my)} 机动性偏低，需警惕被先手秒杀，注意保持距离与留位移。`);
  if (b.poke >= 2 && a.sustain <= 1) reason.push(`${cn(enemy)} 消耗能力强，${cn(my)} 回复不足，对线期容易被压血线，建议控线呼叫打野。`);
  if (a.frontline >= 2 && b.frontline <= 1) reason.push(`${cn(my)} 具备前排/换血优势，可主动压迫 ${cn(enemy)} 的补刀空间。`);
  if (b.early >= 2 && a.late >= 2) reason.push(`${cn(enemy)} 前期强势而 ${cn(my)} 偏后期，前期以稳为主，拖到后期 ${cn(my)} 曲线更优。`);
  if (a.cc >= 2 && b.mobility >= 2) reason.push(`${cn(my)} 控制充足，可配合打野限制 ${cn(enemy)} 的高机动游走。`);
  if (!reason.length) reason.push('两者机制差异不极端，对线更多取决于熟练度、打野介入与兵线管理。');
  return { real, reason, note: '启发式推理基于英雄机制标签，非 OP.GG 官方结论。' };
}

function explainBuild(champ, build) {
  const reason = [];
  const tags = champ.tags || [];
  const tr = traitsFor(champ);
  if (build && build.coreItems && build.coreItems[0]) {
    const names = build.coreItems[0].items.map(i => i.name).join(' → ');
    reason.push(`核心出装 ${names}：来自 OP.GG 韩服最高登场率组合（登场 ${pct(build.coreItems[0].pickRate)}，胜率 ${pct(build.coreItems[0].winRate)}）。`);
  }
  if (tr.ap >= 2) reason.push(`${cn(champ)} 以魔法伤害为主，出装围绕法强/法穿/法力构建。`);
  if (tr.ad >= 2 && tr.ap < 2) reason.push(`${cn(champ)} 以物理伤害为主，出装围绕攻击力/暴击/穿甲构建。`);
  if (tr.dps >= 2) reason.push('持续输出定位，优先攻速/特效与续航装备。');
  if (tr.burst >= 2) reason.push('爆发定位，优先穿透与瞬间法强/攻击力，追求一套秒杀。');
  if (tr.frontline >= 2) reason.push('需要承担前排，补充生命/抗性装备提升团战存活。');
  if (build && build.runes && build.runes[0]) {
    const r = build.runes[0];
    reason.push(`主系符文 ${r.primaryRune ? r.primaryRune.name : ''}（${r.primaryStyle ? r.primaryStyle.name : ''}）：OP.GG 登场 ${pct(r.pickRate)}、胜率 ${pct(r.winRate)} 的主流选择。`);
  }
  return { reason, note: '出装/符文数值来自 OP.GG；适配解释为启发式推理。' };
}

function metaSummary(stats, patch) {
  const byPos = {};
  for (const s of stats) { (byPos[s.position] = byPos[s.position] || []).push(s); }
  const positions = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
  const summary = [];
  for (const p of positions) {
    const arr = (byPos[p] || []).sort((a, b) => (a.tier - b.tier) || (b.winRate - a.winRate));
    if (!arr.length) continue;
    const top = arr.slice(0, 3);
    const risers = arr.filter(s => s.rankPrevPatch != null && s.rank != null && (s.rankPrevPatch - s.rank) >= 5).sort((a, b) => (b.rankPrevPatch - b.rank) - (a.rankPrevPatch - a.rank)).slice(0, 2);
    summary.push({
      position: p,
      top: top.map(s => ({ name: s.championName, key: s.championKey, tier: s.tier, winRate: s.winRate })),
      risers: risers.map(s => ({ name: s.championName, key: s.championKey, up: s.rankPrevPatch - s.rank })),
    });
  }
  const highestWin = [...stats].sort((a, b) => b.winRate - a.winRate)[0];
  const highestBan = [...stats].sort((a, b) => b.banRate - a.banRate)[0];
  return { patch, positions: summary, highestWin, highestBan, note: '全部为 OP.GG 韩服真实统计。' };
}

function laneMatchup(blue, red, stats) {
  const cs = stats ? stats.find(s => s.championKey === (red && red.key) && s.position === (blue && blue.position)) : null;
  let counter = null;
  if (cs && cs.counters) counter = cs.counters.find(c => c.championKey === (blue && blue.key));
  const a = traitsFor(blue), b = traitsFor(red);
  let edge = 0;
  const dims = ['frontline', 'burst', 'dps', 'sustain', 'cc', 'mobility', 'early', 'late'];
  for (const d of dims) edge += (a[d] - b[d]);
  const counterEdge = counter && counter.winRate != null ? (0.5 - counter.winRate) * 20 : 0;
  const total = edge + counterEdge;
  const verdict = total > 3 ? 'blue' : total < -3 ? 'red' : 'even';
  return { verdict, score: total, counter, real: counter ? `OP.GG：${cn(red)} 对 ${cn(blue)} 胜率 ${pct(counter.winRate)}` : null };
}

function compareTeams(blue, red, stats) {
  const A = analyzeTeam(blue), B = analyzeTeam(red);
  const lanes = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
  const laneResults = lanes.map((p, i) => {
    const b = blue[i], r = red[i];
    if (!b || !r) return { position: p, verdict: 'incomplete' };
    return { position: p, ...laneMatchup({ ...b, position: p }, { ...r, position: p }, stats) };
  });
  const blueWins = laneResults.filter(l => l.verdict === 'blue').length;
  const redWins = laneResults.filter(l => l.verdict === 'red').length;
  const overall = blueWins > redWins ? 'blue' : redWins > blueWins ? 'red' : 'even';
  return { blue: A, red: B, lanes: laneResults, blueWins, redWins, overall, note: '对位与阵容评估为启发式分析；对位胜率引用 OP.GG Counter 数据。' };
}

const ADVICE_POS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const NEED_CN = { frontline: '前排', engage: '开团', cc: '控制', peel: '保护', dps: '输出', ad: '物理伤害', ap: '魔法伤害' };

/** Decorate raw recommendations with real-stat reasons, enemy counter risk and
 *  personal-pool evidence. `stats` MUST already be scoped to the target position
 *  so every quoted number belongs to that position. */
function decorateAdvice(rec, stats, enemyKeys, personal, signature) {
  const sig = new Set(signature || []);
  const suggestions = rec.suggestions.map(s => {
    const reasons = [];
    if (s.needs.length) reasons.push('弥补己方阵容短板：' + s.needs.map(nd => NEED_CN[nd] || nd).join('、'));
    if (s.tier != null) reasons.push(`OP.GG 当前 T${s.tier}，胜率 ${pct(s.winRate)}`);
    const counteredBy = stats ? stats.find(x => x.championKey === s.champion.key) : null;
    let risky = false;
    if (counteredBy && counteredBy.counters) risky = counteredBy.counters.some(c => enemyKeys.has(c.championKey) && c.winRate != null && c.winRate < 0.45);
    if (risky) reasons.push('注意：敌方已选英雄中存在对其克制关系');
    const p = personal && personal[s.champion.key];
    if (p && p.games > 0) reasons.push(`个人英雄池：近期 ${p.games} 场，胜率 ${pct(p.winRate)}`);
    const isSig = sig.has(s.champion.key);
    if (isSig) reasons.push('你的常用英雄（个人偏好设置）');
    return { ...s, reasons, risky, personal: p && p.games > 0 ? p : null, signature: isSig };
  });
  // personal proficiency nudge: modest bonus so real pool evidence surfaces,
  // never overriding a large strength gap; re-sort keeps ordering honest.
  for (const s of suggestions) {
    if (s.personal) s.score += Math.min(s.personal.games, 15) * 0.2 + (s.personal.winRate - 0.5) * 8;
    if (s.signature) s.score += 3;
  }
  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}

function pickAdvice(myTeam, enemyTeam, pool, stats, opts = {}) {
  const banned = new Set(opts.banned || []);
  let usePool = pool.filter(c => !banned.has(c.key));
  let useStats = stats;
  if (opts.position && opts.position !== 'all') {
    useStats = stats.filter(s => s.position === opts.position);
    const keys = new Set(useStats.map(s => s.championKey));
    usePool = usePool.filter(c => keys.has(c.key));
  }
  const rec = recommendForTeam(myTeam, usePool, useStats);
  const enemyKeys = new Set(enemyTeam.filter(Boolean).map(c => c.key));
  const suggestions = decorateAdvice(rec, useStats, enemyKeys, opts.personal, opts.signature);
  return { needs: rec.needs, suggestions, position: opts.position || 'all', note: '推荐结合 OP.GG 真实强度与启发式阵容契合度，非官方胜率预测。' };
}

/** Per-empty-slot advice: every recommendation is computed from THAT position's
 *  real OP.GG rows (win/pick/ban/tier/counters), with banned champions excluded
 *  and the user's cached personal pool folded in. No cross-position mixing. */
function pickAdviceByPosition(myTeam, enemyTeam, pool, stats, opts = {}) {
  const banned = new Set(opts.banned || []);
  const enemyKeys = new Set(enemyTeam.filter(Boolean).map(c => c.key));
  const byPosition = [];
  for (let i = 0; i < 5; i++) {
    if (myTeam[i]) continue;
    const p = ADVICE_POS[i];
    const posStats = stats.filter(s => s.position === p);
    const posKeys = new Set(posStats.map(s => s.championKey));
    const posPool = pool.filter(c => posKeys.has(c.key) && !banned.has(c.key));
    const rec = recommendForTeam(myTeam, posPool, posStats);
    byPosition.push({ position: p, slotIndex: i, needs: rec.needs, suggestions: decorateAdvice(rec, posStats, enemyKeys, opts.personal, opts.signature) });
  }
  return { byPosition, note: '每个空位按该位置的真实 OP.GG 统计独立推荐；阵容契合度为启发式分析。' };
}

module.exports = { explainCounter, explainBuild, metaSummary, laneMatchup, compareTeams, pickAdvice, pickAdviceByPosition };