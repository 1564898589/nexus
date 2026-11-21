'use strict';
/**
 * Replay Intelligence + Player Growth analytics.
 * Operates ONLY on cached real match data (LCU/SGP). Every output is tagged
 * 事实 / 推断 / 建议. No fabricated benchmarks: comparisons are against the
 * player's own cached averages; role heuristics are explicitly labeled 推断.
 */

const kdaOf = (m) => m.deaths ? (m.kills + m.assists) / m.deaths : (m.kills + m.assists);
// 展示去尾零（2.40 → 2.4、86.0% → 86%），保留有效小数
const f1 = (v) => (v == null ? '—' : String(parseFloat((+v).toFixed(1))));
const f2 = (v) => (v == null ? '—' : String(parseFloat((+v).toFixed(2))));
const pct = (v) => (v == null ? '—' : String(parseFloat((v * 100).toFixed(1))) + '%');

// ---- 模式分类（真实 queueId 优先，gameMode 兜底）----
// 不同模式的节奏/目标/补刀/视野口径完全不同，混在一起统计会失去可研究性。
// 单双排(420) 与 灵活(440) 同为排位但分开；人机/大乱斗/匹配各自独立。
const QUEUE_CAT = {
  420: ['solo', '单双排', 'ranked'], 440: ['flex', '灵活组排', 'ranked'],
  450: ['aram', '大乱斗', 'casual'], 400: ['normal', '匹配', 'casual'], 430: ['normal', '匹配', 'casual'],
  480: ['swift', '快速模式', 'casual'], 870: ['swift', '快速模式', 'casual'], 880: ['swift', '快速模式', 'casual'],
  800: ['bot', '人机', 'bot'], 810: ['bot', '人机', 'bot'], 820: ['bot', '人机', 'bot'],
  830: ['bot', '人机', 'bot'], 840: ['bot', '人机', 'bot'], 850: ['bot', '人机', 'bot'],
  1700: ['arena', '竞技场', 'casual'], 1710: ['arena', '竞技场', 'casual'], 2400: ['arena', '竞技场', 'casual'], 2410: ['arena', '竞技场', 'casual'],
  900: ['urf', '无限火力', 'casual'], 1900: ['urf', '无限火力', 'casual'],
  1200: ['blitz', '极限闪击', 'casual'], 1300: ['blitz', '极限闪击', 'casual'],
  1400: ['ultbook', '终极魔典', 'casual'], 1410: ['ultbook', '终极魔典', 'casual'], 1420: ['ultbook', '终极魔典', 'casual'], 1430: ['ultbook', '终极魔典', 'casual'],
  3140: ['practice', '训练模式', 'bot'],
  700: ['tutorial', '教程', 'bot'], 2000: ['tutorial', '教程', 'bot'], 2010: ['tutorial', '教程', 'bot'], 2020: ['tutorial', '教程', 'bot'],
};
const CORE_KEYS = ['solo', 'flex', 'aram', 'bot', 'normal', 'swift', 'arena'];
function modeCategory(queueId, mode) {
  const q = QUEUE_CAT[queueId];
  if (q) return { key: q[0], label: q[1], group: q[2] };
  const ms = String(mode || '').toUpperCase();
  if (ms === 'ARAM') return { key: 'aram', label: '大乱斗', group: 'casual' };
  if (ms === 'SWIFTPLAY') return { key: 'swift', label: '快速模式', group: 'casual' };
  if (ms === 'PRACTICETOOL') return { key: 'practice', label: '训练模式', group: 'bot' };
  if (ms === 'TUTORIAL') return { key: 'tutorial', label: '教程', group: 'bot' };
  if (ms === 'URF') return { key: 'urf', label: '无限火力', group: 'casual' };
  if (ms === 'NEXUSBLITZ') return { key: 'blitz', label: '极限闪击', group: 'casual' };
  if (ms === 'ULTBOOK') return { key: 'ultbook', label: '终极魔典', group: 'casual' };
  if (ms === 'CHERRY' || ms === 'KIWI') return { key: 'arena', label: '竞技场', group: 'casual' };
  if (ms === 'CLASSIC') return { key: 'classic', label: '召唤师峡谷', group: 'casual' };
  return { key: 'other', label: mode || '其他', group: 'other' };
}
// modeKey: 'all' | 具体 key | 'other'(非核心模式的合集)
function inMode(m, modeKey) {
  if (!modeKey || modeKey === 'all') return true;
  const c = modeCategory(m.queueId, m.mode);
  if (modeKey === 'other') return !CORE_KEYS.includes(c.key);
  return c.key === modeKey;
}
function filterByMode(matches, modeKey) { return (matches || []).filter(m => inMode(m, modeKey)); }
// 按真实出现的模式动态分组（含「全部」），排位优先排序，供 UI 筛选 chips。
const MODE_ORDER = ['solo', 'flex', 'normal', 'swift', 'aram', 'bot', 'practice', 'arena', 'urf', 'blitz', 'ultbook', 'classic', 'tutorial', 'other'];
function modeBreakdown(matches) {
  const map = {};
  for (const m of (matches || [])) {
    const c = modeCategory(m.queueId, m.mode);
    const e = map[c.key] || (map[c.key] = { key: c.key, label: c.label, n: 0 });
    e.n++;
  }
  const rank = (k) => { const i = MODE_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  const cats = Object.values(map).sort((a, b) => rank(a.key) - rank(b.key));
  return [{ key: 'all', label: '全部模式', n: (matches || []).length }, ...cats];
}

// Per-minute values need real duration; unknown duration => null (never guessed).
function perMin(m, key) {
  if (!m.duration || m.duration <= 0 || m[key] == null) return null;
  return m[key] / (m.duration / 60);
}

/** Analyze one cached match against the player's own SAME-MODE averages. */
function analyzeMatch(m, stats, modeLabel) {
  const me = m.me || {};
  const cat = modeCategory(m.queueId, m.mode);
  const ml = modeLabel || cat.label;
  const facts = [], inferences = [], advice = [];
  const durMin = m.duration ? m.duration / 60 : null;
  facts.push(`结果：${me.win === true ? '胜利' : me.win === false ? '失败' : '未知'} · 时长 ${durMin ? f1(durMin) + ' 分钟' : '未知'} · 模式 ${cat.label}${m.queueId ? '（队列 ' + m.queueId + '）' : ''}。`);
  facts.push(`KDA ${me.kills ?? '—'}/${me.deaths ?? '—'}/${me.assists ?? '—'}（${f2(kdaOf(me))}）· 补刀 ${me.cs ?? '—'} · 经济 ${me.gold ?? '—'} · 对英雄伤害 ${me.damage ?? '—'} · 视野 ${me.vision ?? '—'}。`);
  if (stats && stats.total >= 3) {
    facts.push(`个人基准（同模式「${ml}」${stats.total} 场缓存真实战绩，不与其他模式混算）：平均 KDA ${f2(stats.avgKDA)} · 平均补刀 ${f1(stats.avgCs)} · 平均伤害 ${f1(stats.avgDamage)} · 平均视野 ${f1(stats.avgVision)}。`);
    const k = kdaOf(me);
    if (me.deaths != null && stats.avgDeaths > 0) {
      if (me.deaths > stats.avgDeaths * 1.4) inferences.push(`死亡 ${me.deaths} 次，明显高于个人均值 ${f1(stats.avgDeaths)}——本场死亡问题是主要负面因素（推断）。`);
      else if (me.deaths < stats.avgDeaths * 0.6) inferences.push(`死亡 ${me.deaths} 次，低于个人均值 ${f1(stats.avgDeaths)}，生存控制优于平时（推断）。`);
    }
    if (me.damage != null && stats.avgDamage > 0) {
      const r = me.damage / stats.avgDamage;
      if (r >= 1.25) inferences.push(`对英雄伤害为个人均值的 ${f1(r)} 倍，输出贡献突出（推断）。`);
      else if (r <= 0.7) inferences.push(`对英雄伤害仅为个人均值的 ${f1(r)} 倍，输出参与偏低（推断）。`);
    }
    if (me.cs != null && stats.avgCs > 0 && durMin) {
      const csm = perMin({ ...me, duration: m.duration }, 'cs');
      if (csm != null && csm < 5 && me.position !== 'UTILITY' && me.position !== 'SUPPORT') inferences.push(`补刀 ${f1(csm)}/分钟，发育效率偏低（推断，辅助位除外）。`);
    }
    if (me.vision != null && stats.avgVision > 0 && me.vision < stats.avgVision * 0.6) inferences.push(`视野得分 ${me.vision}，低于个人均值 ${f1(stats.avgVision)}，视野投入不足（推断）。`);
    if (me.win === false && me.deaths != null && me.deaths <= 2 && k >= 3) advice.push('虽败但个人表现优于基准：复盘重点放在团队决策与目标控制，而非个人操作（建议）。');
    if (me.win === true && me.deaths != null && stats.avgDeaths > 0 && me.deaths > stats.avgDeaths * 1.4) advice.push('胜利但死亡偏多：优势局的止损与撤退时机值得复盘（建议）。');
  } else {
    inferences.push(`同模式「${ml}」缓存样本不足（<3 场），无法与个人基准对比；以下仅为本场事实。`);
  }
  // ---- 十人团队深度（已存 participants；代理口径如实标注）----
  const team = { kp: null, damageShare: null, laneCsDiff: null, laneGoldDiff: null, teamKills: null, note: null };
  const parts = Array.isArray(m.participants) ? m.participants : [];
  if (parts.length >= 2 && me.teamId != null) {
    const mates = parts.filter(p => p.teamId === me.teamId);
    const foes = parts.filter(p => p.teamId !== me.teamId);
    const tk = mates.reduce((a, p) => a + (p.kills || 0), 0);
    const td = mates.reduce((a, p) => a + (p.damage || 0), 0);
    team.teamKills = tk;
    if (tk > 0 && (me.kills != null || me.assists != null)) team.kp = ((me.kills || 0) + (me.assists || 0)) / tk;
    if (td > 0 && me.damage != null) team.damageShare = me.damage / td;
    // 对位差：同 position 的对手（位置未知则不臆造，标代理口径）
    const opp = me.position ? foes.find(p => p.position === me.position) : null;
    if (opp) {
      if (me.cs != null && opp.cs != null) team.laneCsDiff = me.cs - opp.cs;
      if (me.gold != null && opp.gold != null) team.laneGoldDiff = me.gold - opp.gold;
    } else if (me.position) {
      team.note = '对方同位置选手未识别，对位差不可用（不臆造）。';
    } else {
      team.note = '本场位置字段缺失，对位差按代理口径不可用；KP/伤害占比仍为真实团队合计。';
    }
    if (team.kp != null) facts.push(`参团率 ${(team.kp * 100).toFixed(0)}%（我方团队击杀 ${tk}，真实十人数据）。`);
    if (team.damageShare != null) facts.push(`伤害占团队 ${(team.damageShare * 100).toFixed(0)}%（团队总伤害 ${td}，真实十人数据）。`);
    if (team.laneCsDiff != null) facts.push(`对位补刀差 ${team.laneCsDiff >= 0 ? '+' : ''}${team.laneCsDiff} · 经济差 ${team.laneGoldDiff >= 0 ? '+' : ''}${team.laneGoldDiff}（对位=${me.position}，真实十人数据）。`);
    if (team.kp != null && team.kp < 0.4 && me.position !== 'UTILITY' && me.position !== 'SUPPORT') inferences.push(`参团率 ${(team.kp * 100).toFixed(0)}% 偏低（非辅助位），可能游离于团队节奏之外（推断，需结合死亡时间点验证）。`);
    if (team.damageShare != null && team.damageShare < 0.15 && me.position !== 'UTILITY' && me.position !== 'SUPPORT') inferences.push(`伤害占比 ${(team.damageShare * 100).toFixed(0)}% 偏低（非辅助位），输出贡献不足（推断）。`);
  }
  // item facts
  if (me.items && me.items.length) facts.push(`最终装备 ID：${me.items.join(', ')}（真实客户端数据）。`);
  if (!advice.length) advice.push(me.win ? '保持当前节奏；可将本场关键决策时间点记录下来供后续复盘（建议）。' : '建议查看死亡时间点与当时经济差，定位 1–2 个可改进决策（建议）。');
  return {
    gameId: m.gameId, gameCreation: m.gameCreation, duration: m.duration, win: me.win,
    championId: me.championId, position: me.position,
    mode: cat.label, modeKey: cat.key, queueId: m.queueId || null, baselineGames: stats ? stats.total : 0,
    team,
    kda: kdaOf(me), csPerMin: perMin({ ...me, duration: m.duration }, 'cs'), goldPerMin: perMin({ ...me, duration: m.duration }, 'gold'), damagePerMin: perMin({ ...me, duration: m.duration }, 'damage'),
    facts, inferences, advice,
    dataCoverage: { hasDuration: !!m.duration, hasBaseline: !!(stats && stats.total >= 3), source: m.source || 'cache' },
  };
}

/** Growth report: recent window vs older window, both from cached real matches of ONE mode. */
function growthReport(matches, stats, modeLabel) {
  const mine = matches.map(m => m.me).filter(Boolean);
  const ml = modeLabel || '全部模式';
  if (mine.length < 6) return { enough: false, total: mine.length, mode: ml, facts: [`「${ml}」缓存对局仅 ${mine.length} 场（<6），成长趋势分析需要更多该模式的真实对局。可切换其他模式，或先在玩家战绩中心查询并缓存战绩。`], inferences: [], advice: [], series: [] };
  const recent = mine.slice(0, 10), older = mine.slice(10, 30);
  const agg = (arr) => {
    const n = arr.length; if (!n) return null;
    const wins = arr.filter(m => m.win === true).length;
    const avg = (k) => arr.reduce((a, m) => a + (m[k] || 0), 0) / n;
    return { games: n, winRate: wins / n, kda: arr.reduce((a, m) => a + kdaOf(m), 0) / n, cs: avg('cs'), damage: avg('damage'), vision: avg('vision'), deaths: avg('deaths') };
  };
  const R = agg(recent), O = agg(older.length ? older : mine.slice(10));
  const facts = [], inferences = [], advice = [];
  facts.push(`统计口径：「${ml}」共 ${mine.length} 场缓存真实对局（不与其他模式混算）。`);
  facts.push(`近期 ${R.games} 场：胜率 ${pct(R.winRate)} · KDA ${f2(R.kda)} · 平均死亡 ${f1(R.deaths)}。`);
  if (O) facts.push(`此前 ${O.games} 场：胜率 ${pct(O.winRate)} · KDA ${f2(O.kda)} · 平均死亡 ${f1(O.deaths)}。`);
  if (O) {
    const dw = R.winRate - O.winRate;
    if (Math.abs(dw) >= 0.08) inferences.push(`胜率${dw > 0 ? '上升' : '下降'} ${pct(Math.abs(dw))}（近期 vs 此前），${dw > 0 ? '状态向好' : '状态下滑'}（推断，样本 ${R.games}/${O.games} 场）。`);
    else inferences.push('胜率近期与此前基本持平（推断）。');
    if (R.deaths < O.deaths * 0.85) inferences.push(`平均死亡从 ${f1(O.deaths)} 降到 ${f1(R.deaths)}，生存意识改善（推断）。`);
    else if (R.deaths > O.deaths * 1.2) inferences.push(`平均死亡从 ${f1(O.deaths)} 升到 ${f1(R.deaths)}，死亡控制是当前最大改进点（推断）。`);
    if (R.vision > O.vision * 1.15) inferences.push('视野投入近期提升（推断）。');
  }
  // pool evolution
  const champsR = new Set(recent.map(m => m.championId).filter(x => x != null));
  const champsO = new Set((older.length ? older : mine.slice(10)).map(m => m.championId).filter(x => x != null));
  const newChamps = [...champsR].filter(c => !champsO.has(c));
  if (newChamps.length) facts.push(`近期新使用英雄 ${newChamps.length} 个（ID：${newChamps.slice(0, 6).join(', ')}）。`);
  if (stats && stats.signature.length) facts.push(`当前绝活英雄 ${stats.signature.length} 个（高场次高胜率，真实缓存统计）。`);
  if (stats && stats.poolDepth <= 3) advice.push('英雄池较浅：建议扩展 1–2 个版本强势英雄作为备选，降低被针对风险（建议）。');
  if (R.winRate < 0.45) advice.push('近期胜率低于 45%：建议暂停排位连打，先复盘 2–3 场失败对局的共同死亡模式（建议）。');
  if (R.deaths > 5) advice.push('近期场均死亡偏高：优先练习劣势局止损与地图信息读取（建议）。');
  if (!advice.length) advice.push('保持当前训练节奏；建议固定复盘每场前 3 次死亡（建议）。');
  // series for charts (oldest→newest)
  const series = mine.slice(0, 30).reverse().map(m => ({ t: m.gameCreation, win: m.win === true ? 1 : 0, kda: +kdaOf(m).toFixed(2), cs: m.cs, deaths: m.deaths, championId: m.championId }));
  return { enough: true, total: mine.length, mode: ml, recent: R, older: O, facts, inferences, advice, series, newChampions: newChamps };
}

module.exports = { analyzeMatch, growthReport, kdaOf, modeCategory, inMode, filterByMode, modeBreakdown, MODE_ORDER, CORE_KEYS };