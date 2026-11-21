'use strict';
/**
 * NEXUS MATCHUP WAR ROOM — ten-player scouting report.
 * Combines real player match data + ratings with OP.GG champion stats and heuristic
 * composition reasoning. Every line is tagged: fact (real data) / inference / advice.
 * Never fabricates win rates or unknown info.
 */
const { analyzeTeam, traitsFor } = require('./composition');
const { laneMatchup } = require('./tactics');

const POS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const POS_CN = { TOP: '上路', JUNGLE: '打野', MID: '中路', ADC: '下路', SUPPORT: '辅助' };

function gradeVal(g) { return { S: 5, A: 4, B: 3, C: 2, D: 1 }[g] || 0; }

// players: [{name,puuid,championId,position,rating,stats, champKey}]
function buildScouting(blue, red, champStats, cmap) {
  const tag = (kind, text) => ({ kind, text });
  const facts = [], inferences = [], advice = [];
  const resolveChamp = (p) => p.champKey ? (cmap[p.champKey] || { key: p.champKey }) : (p.championId ? Object.values(cmap).find(c => c.id === p.championId) : null);

  const score = (p) => p.rating && p.rating.grade ? gradeVal(p.rating.grade) * 10 + (p.rating.longTerm || 50) / 10 : null;
  const ranked = (team) => team.filter(p => p && score(p) != null).sort((a, b) => score(b) - score(a));
  const blueRanked = ranked(blue), redRanked = ranked(red);

  // facts: who has data
  const withData = [...blue, ...red].filter(p => p && p.rating && p.rating.grade);
  facts.push(tag('fact', `已获取 ${withData.length}/10 名玩家的可评级数据；其余显示「暂无法评级」。`));
  if (redRanked[0]) facts.push(tag('fact', `敌方评级最高：${redRanked[0].name || '未知'}（${redRanked[0].rating.grade} 级，长期 ${redRanked[0].rating.longTerm}，近期 ${redRanked[0].rating.recent}）。`));
  if (blueRanked[0]) facts.push(tag('fact', `我方评级最高：${blueRanked[0].name || '未知'}（${blueRanked[0].rating.grade} 级）。`));

  // signature threats
  const sigEnemies = red.filter(p => p && p.stats && p.stats.signature && p.stats.signature.length);
  for (const p of sigEnemies) {
    const c = resolveChamp(p);
    const onSig = c && p.stats.signature.some(s => s.championId === c.id);
    inferences.push(tag('inference', `${p.name || '敌方玩家'} 是绝活哥（${p.stats.signature.length} 个高胜率英雄）${onSig && c ? '，且当前正选出其绝活 ' + (c.nameCn || c.name || c.key) + '，威胁显著上调' : ''}。`));
  }
  // recent form
  const hotEnemy = red.filter(p => p && p.rating && p.rating.recent >= 70).sort((a, b) => b.rating.recent - a.rating.recent)[0];
  if (hotEnemy) inferences.push(tag('inference', `${hotEnemy.name || '敌方玩家'} 近期状态火热（近期评分 ${hotEnemy.rating.recent}），需重点警惕。`));

  // lane pressure using composition + counter
  const laneResults = [];
  for (let i = 0; i < 5; i++) {
    const b = blue[i], r = red[i];
    const bc = b && resolveChamp(b), rc = r && resolveChamp(r);
    let verdict = 'incomplete', detail = '双方未选满';
    if (bc && rc) {
      const lm = laneMatchup({ ...bc, position: POS[i] }, { ...rc, position: POS[i] }, champStats);
      verdict = lm.verdict;
      const ratingEdge = (b.rating && r.rating && b.rating.grade && r.rating.grade) ? gradeVal(b.rating.grade) - gradeVal(r.rating.grade) : 0;
      detail = lm.real || '机制评估';
      if (ratingEdge <= -2) { verdict = 'red'; detail += '；且敌方玩家实力评级明显更高'; }
      else if (ratingEdge >= 2) { verdict = 'blue'; detail += '；且我方玩家实力评级明显更高'; }
      laneResults.push({ position: POS[i], verdict, detail, ratingEdge });
    } else laneResults.push({ position: POS[i], verdict, detail });
  }
  const pressureLane = laneResults.filter(l => l.verdict === 'red').sort((a, b) => (a.ratingEdge || 0) - (b.ratingEdge || 0))[0];
  const breakLane = laneResults.filter(l => l.verdict === 'blue').sort((a, b) => (b.ratingEdge || 0) - (a.ratingEdge || 0))[0];
  if (pressureLane) inferences.push(tag('inference', `${POS_CN[pressureLane.position]} 对线压力最大（${pressureLane.detail}），应避免硬拼、呼叫支援。`));
  if (breakLane) inferences.push(tag('inference', `${POS_CN[breakLane.position]} 可能成为突破口（${breakLane.detail}），可围绕建立优势。`));

  // team composition
  const blueChamps = blue.map(p => p && resolveChamp(p)).filter(Boolean);
  const redChamps = red.map(p => p && resolveChamp(p)).filter(Boolean);
  const blueComp = analyzeTeam(blueChamps), redComp = analyzeTeam(redChamps);

  // advice
  if (blueRanked[0]) advice.push(tag('advice', `核心 Carry：${blueRanked[0].name || '我方最高评级'}，资源向其倾斜，重点保护。`));
  const weakBlue = blue.filter(p => p && p.rating && (p.rating.grade === 'C' || p.rating.grade === 'D'));
  if (weakBlue.length) advice.push(tag('advice', `${weakBlue.map(p => p.name || '队友').join('、')} 当前数据表现偏弱，避免让其承担过多压力，多支援。`));
  if (redRanked[0]) advice.push(tag('advice', `最值得限制的敌方：${redRanked[0].name || '敌方核心'}，BP 与团战优先针对。`));
  if (sigEnemies.length) advice.push(tag('advice', `禁用/限制绝活哥的英雄池：${sigEnemies.map(p => p.name).join('、')}。`));
  if (blueComp.weaknesses.length) advice.push(tag('advice', `阵容短板需注意：${blueComp.weaknesses[0]}。`));
  // phase plan
  const earlyStrong = blueComp.scores.early >= 55, lateStrong = blueComp.scores.late >= 55;
  if (earlyStrong && !lateStrong) advice.push(tag('advice', '前期阵容：主动入侵滚雪球，争取 20 分钟前结束比赛。'));
  else if (lateStrong && !earlyStrong) advice.push(tag('advice', '后期阵容：前期以稳为主，控图发育，拖到后期团战决胜。'));
  else advice.push(tag('advice', '前中期：围绕优势路建立节奏，争夺先锋/小龙；后期：保护 Carry，避免无准备接团。'));

  return {
    facts, inferences, advice, laneResults,
    blueComp, redComp,
    strongestEnemy: redRanked[0] || null, ourCarry: blueRanked[0] || null,
    pressureLane: pressureLane || null, breakLane: breakLane || null,
    dataCoverage: withData.length,
    note: '事实=真实战绩/统计；推断=基于数据的启发式判断；建议=战术参考。数据不足处已标明不确定性，非官方胜率预测。',
  };
}

module.exports = { buildScouting, POS, POS_CN };