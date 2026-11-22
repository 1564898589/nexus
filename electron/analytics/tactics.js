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

const SPIKE_CN = { early: '前期（1–6 级）', mid: '中期（6–13 级）', late: '后期（13 级+/三件套）', even: '全期均衡' };
function spikeOf(tr) {
  if (tr.early >= 2 && tr.late <= 1) return 'early';
  if (tr.late >= 2 && tr.early <= 1) return 'late';
  if (tr.early >= 2 && tr.late >= 2) return 'even';
  return 'mid';
}

/** Mechanism-level laning guide derived from the real trait matchup (not a generic
 *  tip list). Every line is conditioned on THIS champion pair's traits; the optional
 *  counterStat anchors the verdict in real OP.GG samples. Heuristic, clearly labelled. */
function laneGuide(my, enemy, position, counterStat, opts = {}) {
  const a = traitsFor(my), b = traitsFor(enemy);
  const pos = position || 'MID';
  const dims = ['frontline', 'burst', 'dps', 'sustain', 'cc', 'mobility', 'early', 'late', 'poke', 'waveclear'];
  let edge = 0; for (const d of dims) edge += (a[d] - b[d]);
  let myWin = null;
  if (counterStat && counterStat.winRate != null) myWin = opts.perspective === 'enemy' ? 1 - counterStat.winRate : counterStat.winRate;
  const score = edge + (myWin != null ? (myWin - 0.5) * 20 : 0);
  const verdict = score > 3 ? 'advantage' : score < -3 ? 'disadvantage' : 'even';
  const verdictText = verdict === 'advantage' ? '该对位你占优，可主动压迫' : verdict === 'disadvantage' ? '该对位你偏劣，以稳为主' : '该对位均势，拼熟练度与打野';
  const sa = spikeOf(a), sb = spikeOf(b);
  const spikeText = `你的强势期：${SPIKE_CN[sa]}；${cn(enemy)}：${SPIKE_CN[sb]}。` +
    (sa === 'early' && sb !== 'early' ? '你比对方更早成型，前期要打出压制。' : sa === 'late' && sb !== 'late' ? '你比对方更晚成型，前期别送，拖到后期曲线更优。' : '双方节奏接近，谁先失误谁崩。');

  const trade = [];
  if (a.burst >= 2 && b.mobility <= 1 && b.sustain <= 1) trade.push(`你爆发高、${cn(enemy)} 缺位移/回复：抓对方补刀硬直打一套，打完即撤，别恋战给反打机会。`);
  if (b.poke >= 2 && a.sustain <= 1) trade.push(`${cn(enemy)} 消耗强、你回复弱：站兵线后挡技能，血线低于 60% 就回城或呼叫打野，别硬换。`);
  if (a.sustain >= 2 && b.burst <= 1) trade.push(`你续航占优：主动短换血（换一波就退），靠回复把对方耗回家赚经验差。`);
  if (a.frontline >= 2 && b.frontline <= 1) trade.push(`你身板更硬：可压前换血，逼 ${cn(enemy)} 退到塔下漏刀。`);
  if (b.burst >= 2 && a.mobility <= 1) trade.push(`${cn(enemy)} 爆发高而你腿短：留位移/闪现躲关键技能，对方技能空了再反打。`);
  if (a.cc >= 2 && b.mobility >= 2) trade.push(`你控制足：捏硬控等 ${cn(enemy)} 交位移后再控，配合打野基本必杀。`);
  if (b.burst >= 2 && a.mobility >= 2) trade.push(`${cn(enemy)} 爆发高但你机动足：用位移躲关键技能（大招/控制），对方技能空窗期再反打。`);
  if (a.poke >= 2 && b.mobility <= 1) trade.push(`你消耗强、${cn(enemy)} 腿短：保持距离持续 poke 压血线，别被近身打一套。`);
  if (a.mobility >= 2 && b.mobility <= 1 && !trade.length) trade.push(`你机动占优：可主动近身换血再撤，${cn(enemy)} 追不上也留不住你。`);
  if (!trade.length) trade.push('机制差异不极端：换血取决于技能命中率与兵线位置，优先在己方兵线多时换血。');

  const wave = [];
  if (a.waveclear >= 2 && b.waveclear <= 1) wave.push(`你清线快：速推线进塔逼对方漏刀/被迫守塔，但推完立刻做视野防抓。`);
  if (b.poke >= 2 && a.waveclear <= 1) wave.push(`${cn(enemy)} 清线/消耗强：别硬推，把线控在己方塔前安全补刀，等打野介入。`);
  if (a.early >= 2 && b.late >= 2) wave.push(`你前期强：抢 2/抢 3 级先手，把等级优势转成塔皮与河蟹。`);
  if (a.late >= 2 && b.early >= 2) wave.push(`你偏后期：前期稳补刀控线，宁可漏几个刀也别送人头。`);
  if (a.splitpush >= 2) wave.push('中后期可边线分推牵制，但先确认队友能 4v4 拖住再深推。');
  if (!wave.length) wave.push('默认 last-hit 控线，兵线过河前先在河道做眼；推线时机选在对方回城/被击杀后。');

  const gank = [];
  if (a.mobility <= 1 && (b.cc >= 2 || b.engage >= 2)) gank.push(`你腿短、${cn(enemy)} 有硬控/先手：6 级后最容易被抓，河道/三角草常驻眼，兵线别过河。`);
  if (a.mobility >= 2) gank.push('你机动高：可适度压线，但位移留作逃生，别交位移打输出。');
  if (a.cc >= 2) gank.push('你有硬控：被 Gank 时反控对方打野争取逃生/反杀，提前呼叫己方打野反蹲。');
  gank.push('通用：3 分钟前在河道/敌方野区入口做眼；小地图对方打野消失立即后撤，别赌。');

  const win = [];
  if (verdict === 'advantage') win.push('占优路：把压制转成塔皮→河蟹→支援中路，带动全场节奏，别只盯着对位单杀。');
  else if (verdict === 'disadvantage') win.push('劣势路：目标是「不崩」而非单杀，控线吃经验，等打野/团战找回场子。');
  else win.push('均势路：抓对方技能冷却/补刀硬直的小窗口积累血量优势，呼叫打野打破平衡。');
  if (sa === 'late') win.push('你的曲线在后期：团战站位靠后，存活输出比先手更重要。');
  if (a.frontline >= 2) win.push('团战你承担前排/开团，盯对方后排走位，但别脱节被秒。');

  return {
    position: pos, verdict, verdictText, edgeScore: Math.round(score), myWinRate: myWin,
    spike: { mine: sa, enemy: sb, text: spikeText },
    sections: [
      { key: 'trade', title: '换血窗口', icon: 'sword', lines: trade },
      { key: 'wave', title: '兵线处理', icon: 'list', lines: wave },
      { key: 'gank', title: '防 Gank / 呼叫打野', icon: 'eye', lines: gank },
      { key: 'win', title: '取胜路径', icon: 'target', lines: win },
    ],
    note: '对线指南由英雄机制标签推导（启发式），非 OP.GG 官方结论；对位胜率（如有）来自真实样本。',
  };
}

const JG_ARCH = {
  aggressive: { name: '激进速 3 型', route: ['红 Buff', '锋喙鸟', '暗影狼', '蓝 Buff', '河蟹 / 抓人'], reason: '前期强势 + 高机动/先手，红开速 3 抢节奏。' },
  fullclear: { name: '全清发育型', route: ['蓝 Buff', '魔沼蛙', '暗影狼', '锋喙鸟', '红 Buff', '石甲虫', '河蟹'], reason: '偏后期持续输出，全清到 6 级大招就位再出山。' },
  tankgank: { name: '坦克 Gank 型', route: ['红 Buff', '暗影狼', '蓝 Buff', '抓人 / 河蟹'], reason: '身板硬 + 双控，3 级带双 Buff 即可配合队友抓人。' },
  apkite: { name: 'AP 风筝型', route: ['蓝 Buff', '魔沼蛙', '暗影狼', '锋喙鸟', '红 Buff', '河蟹'], reason: 'AP + 高机动，拉野风筝少伤刷野，蓝开续航。' },
};
function jgArchetype(tr) {
  if (tr.early >= 3 && (tr.mobility >= 2 || tr.engage >= 2)) return 'aggressive';
  if (tr.frontline >= 2 && tr.cc >= 2 && tr.engage >= 2) return 'tankgank';
  if (tr.ap >= 2 && tr.mobility >= 2) return 'apkite';
  if (tr.dps >= 2 && tr.late >= 2 && tr.early <= 1) return 'fullclear';
  return tr.early >= 2 ? 'aggressive' : 'fullclear';
}

/** Champion-adaptive jungle clear plan: archetype + real camp order + first-gank
 *  timing + invade risk vs the enemy jungler + objective priority. Camp names are
 *  real Summoner's Rift camps; the CHOICE of route is derived from traits. Heuristic. */
function jungleRoute(my, enemyJungler) {
  const a = traitsFor(my), b = enemyJungler ? traitsFor(enemyJungler) : null;
  const arch = jgArchetype(a);
  const A = JG_ARCH[arch];
  const farmToSix = arch === 'fullclear' || (a.late >= 2 && a.early <= 1);
  const firstGank = farmToSix
    ? { timing: '6 级（约 6–7 分钟）', text: '大招就位后抓压线最深的一路，或先控小龙；前期以刷野到 6 为主，别硬抓。' }
    : arch === 'tankgank'
      ? { timing: '3 级（约 2:40）', text: '带双 Buff + 硬控抓有控制队友的一路，留人能力强，优先帮劣势路止损。' }
      : a.early >= 2
        ? { timing: '3 级（约 2:30–3:00）', text: '速 3 后抓最近压线 lane，或入侵对方野区；错过窗口就转河蟹控图。' }
        : { timing: '4–5 级（约 4 分钟）', text: '清完半区到 4–5 级再抓人，优先帮有硬控/压线深的一路，抓完顺势控河蟹。' };

  let invadeRisk = 'mid', invadeText = '双方前期接近：遭遇看技能命中与惩戒，开局在敌方野区入口做眼掌握动向。';
  if (b) {
    if (a.early >= 2 && b.early <= 1) { invadeRisk = 'low'; invadeText = `你前期强于 ${cn(enemyJungler)}：可 2–3 级入侵抢 Buff/野怪，压制其发育与等级。`; }
    else if (b.early >= 2 && a.early <= 1) { invadeRisk = 'high'; invadeText = `${cn(enemyJungler)} 前期强：避免 1v1 遭遇，开局做防守眼，必要时镜像换野区避其锋芒。`; }
    else if (a.mobility >= 2 && b.mobility <= 1) { invadeRisk = 'low'; invadeText = `你机动高于 ${cn(enemyJungler)}：遭遇可打可退，对方留不住你，主动权在你。`; }
    else if (b.mobility >= 2 && a.mobility <= 1) { invadeRisk = 'high'; invadeText = `${cn(enemyJungler)} 机动高：别落单深入，留位移/惩戒保命，遭遇优先撤。`; }
  } else {
    invadeText = '敌方打野未知：开局默认在河道/敌方野区入口做眼，按对方阵容前期强度决定入侵或防守。';
  }

  const objective = a.early >= 2
    ? { priority: '先锋 > 小龙', text: '前期节奏型：8 分钟先锋优先，推塔滚雪球；小龙可让但要换塔皮。' }
    : a.late >= 2
      ? { priority: '小龙叠魂', text: '发育型：控小龙叠龙魂，避免无谓团战，拖到成型再决战。' }
      : { priority: '视线上优势', text: '哪路有线权就控哪侧河蟹/小龙；团战前确保惩戒在手，别空惩戒进团。' };

  const tips = [];
  if (a.sustain >= 2) tips.push('你续航好：可少回城持续刷野，用等级/经济差压制对方打野。');
  if (a.cc >= 2) tips.push('你控制足：Gank 先手留人，团战盯对方后排，是队伍节奏发动机。');
  if (a.dps >= 2 && a.late >= 2) tips.push('你后期输出高：刷野路线尽量不断档，装备成型后接管比赛。');
  if (arch === 'aggressive') tips.push('激进型务必算对方打野位置：抓人前确认其不在反蹲，别送双 Buff。');
  if (arch === 'fullclear') tips.push('发育型前 6 级别硬抓：漏抓没关系，到 6 的等级差才是你的武器。');
  tips.push('通用：每次回城补满状态再出门；惩戒优先留给河蟹/龙/先锋等关键资源。');

  return {
    champion: my ? cn(my) : null, position: 'JUNGLE', archetype: arch, archetypeName: A.name,
    route: A.route, routeReason: A.reason, firstGank,
    invade: { risk: invadeRisk, text: invadeText }, objective, tips,
    note: '刷野路线由英雄机制标签推导（启发式）；营地为真实召唤师峡谷营地，营序选择按英雄特性自适应，非官方统计。',
  };
}

module.exports = { explainCounter, explainBuild, metaSummary, laneMatchup, compareTeams, pickAdvice, pickAdviceByPosition, laneGuide, jungleRoute };