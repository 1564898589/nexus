'use strict';
/**
 * 统一装备推荐引擎 2.0。
 * 输入全部为 OP.GG 真实行（starter/boots/core/last，含 pick/win/games）+ 冠军元数据；
 * 不伪造任何胜率：小样本胜率经收缩后才参与排序，展示始终为原始值 + 样本量。
 * 敌方针对与智能替换为规则推导（heuristic），单独标注，不与真实统计混同。
 */
const PRIOR_GAMES = 150;

const HEAL_KEYS = new Set(['soraka', 'yuumi', 'nami', 'sona', 'lulu', 'janna', 'milio', 'renata', 'seraphine', 'karma', 'senna', 'drmundo', 'sylas', 'aatrox', 'vladimir', 'swain', 'warwick', 'fiora', 'gwen', 'briar', 'zac', 'maokai', 'ivern', 'taric']);
const DASH_KEYS = new Set(['yasuo', 'yone', 'irelia', 'jax', 'fiora', 'camille', 'riven', 'katarina', 'akali', 'zed', 'talon', 'qiyana', 'ekko', 'fizz', 'leblanc', 'kassadin', 'ahri', 'leesin', 'elise', 'nidalee', 'reksai', 'khazix', 'rengar', 'pantheon', 'xinzhao', 'jarvaniv', 'vi', 'nocturne', 'hecarim', 'rammus', 'skarner']);
const EARLY_KEYS = new Set(['leesin', 'elise', 'nidalee', 'renekton', 'pantheon', 'talon', 'qiyana', 'draven', 'lucian', 'kalista', 'rumble', 'jayce', 'gangplank', 'riven', 'darius', 'olaf', 'trundle', 'xinzhao', 'jarvaniv', 'reksai', 'kindred', 'gragas', 'sylas', 'akshan', 'vex']);

function shrunkWin(wr, games) {
  if (wr == null || !games) return null;
  return (wr * games + 0.5 * PRIOR_GAMES) / (games + PRIOR_GAMES);
}
function score(row) {
  const w = shrunkWin(row.winRate, row.games);
  return (row.pickRate || 0) * (w == null ? 0.5 : w);
}
const byScore = (a, b) => score(b) - score(a);
const has = (c, t) => (c.tags || []).includes(t);
// DD 的 damageType/attackType 存的是数值评分（info.magic / info.attack），比大小定伤害类型；平局回退 tags
const dmgKind = c => {
  const m = Number(c.damageType), a = Number(c.attackType);
  return Number.isFinite(m) && Number.isFinite(a) && m !== a ? (m > a ? 'AP' : 'AD') : null;
};
const isAP = c => dmgKind(c) === 'AP' || has(c, 'Mage');
const isAD = c => dmgKind(c) === 'AD' || has(c, 'Marksman') || has(c, 'Fighter');
const isMarksman = c => has(c, 'Marksman');
const isTank = c => has(c, 'Tank') && !isMarksman(c);

// 装备与英雄职业是否相配（DD 真实 tags）：暴击装不给法师/坦克；纯坦装不给法师/射手；纯法装不给 AD
function itemFits(my, tags) {
  const t = tags || [];
  if (t.includes('Boots')) return true; // 鞋子全职业通用，不受坦/法过滤
  const sd = t.includes('SpellDamage'), dm = t.includes('Damage'), cs = t.includes('CriticalStrike');
  const bulk = t.includes('Health') || t.includes('Armor') || t.includes('SpellBlock');
  if (cs && !sd && (isAP(my) || isTank(my))) return false;
  if (isTank(my)) return true;
  if (isAP(my)) return !(bulk && !sd && !dm);
  if (isMarksman(my)) return !(sd && !dm) && !(bulk && !sd && !dm);
  return !(sd && !dm);
}

function enemyDims(enemy) {
  const n = enemy.length || 1;
  const cnt = f => enemy.filter(f).length;
  const d = [
    ['ap', 'AP 威胁', cnt(isAP) / n, `${cnt(isAP)} 名法系`],
    ['ad', 'AD 威胁', cnt(isAD) / n, `${cnt(isAD)} 名物理`],
    ['burst', '爆发', cnt(c => has(c, 'Assassin')) / n, `${cnt(c => has(c, 'Assassin'))} 名刺客`],
    ['dps', '持续输出', cnt(c => has(c, 'Marksman') || (has(c, 'Fighter') && / ranged/i.test(c.attackType || ''))) / n, '射手/远程战士'],
    ['frontline', '前排', cnt(c => has(c, 'Tank')) / n, `${cnt(c => has(c, 'Tank'))} 名坦克`],
    ['heal', '治疗/护盾', cnt(c => HEAL_KEYS.has(c.key)) / n, `${cnt(c => HEAL_KEYS.has(c.key))} 名回复系`],
    ['cc', '控制链', cnt(c => has(c, 'Tank') || has(c, 'Support')) / n, '坦克/辅助控制'],
    ['mobility', '机动', cnt(c => DASH_KEYS.has(c.key) || has(c, 'Assassin')) / n, '位移/突进英雄'],
    ['poke', '长手消耗', cnt(c => has(c, 'Mage') || has(c, 'Marksman')) / n, '法师/射手'],
    ['early', '前期压力', cnt(c => EARLY_KEYS.has(c.key)) / n, `${cnt(c => EARLY_KEYS.has(c.key))} 名前期英雄`],
  ];
  return d.map(([key, label, value, note]) => ({ key, label, value: Math.max(0, Math.min(1, value)), note }));
}

// 规则替换：dim 阈值 → 针对装，按英雄职业选相配的装备（射手不塞中娅/兰顿）。source 恒为 rule（无胜率样本，诚实标注）。
function swapRules(my, dims) {
  const v = k => (dims.find(d => d.key === k) || {}).value || 0;
  const ap = isAP(my), tank = isTank(my), marksman = isMarksman(my);
  const rules = [];
  if (v('burst') >= 0.4) {
    const inId = marksman ? 3026 : tank ? 3193 : ap ? 3157 : 3053;
    const cn = { 3157: '中娅沙漏保命窗口', 3026: '守护天使防秒杀', 3193: '石像鬼板甲抗爆发', 3053: '斯特拉克血手防秒杀' }[inId];
    rules.push({ slot: 'follow', inId, dim: 'burst', reason: '敌方刺客爆发高：' + cn });
  }
  if (v('ap') >= 0.4) {
    const inId = ap ? 3102 : tank ? 3065 : 3155;
    const cn = { 3102: '女妖面纱挡一次关键技能', 3065: '振奋盔甲提升魔抗与回复', 3155: '饮魔刀护盾挡法爆' }[inId];
    rules.push({ slot: 'follow', inId, dim: 'ap', reason: '法系威胁高：' + cn });
  }
  if (v('heal') >= 0.4) rules.push({ slot: 'follow', inId: ap ? 3165 : 3033, dim: 'heal', reason: '敌方回复系多：重伤压制治疗' });
  if (v('frontline') >= 0.4) rules.push({ slot: 'follow', inId: ap ? 3135 : 3153, dim: 'frontline', reason: '敌方前排厚：穿透/百分比伤害处理坦克' });
  if (v('dps') >= 0.4 && v('ad') >= 0.4 && (tank || has(my, 'Support'))) rules.push({ slot: 'follow', inId: 3110, dim: 'dps', reason: '物理持续输出高：冰心减攻速' });
  if (v('cc') >= 0.6) rules.push({ slot: 'follow', inId: ap ? 3102 : 3140, dim: 'cc', reason: '控制链长：解控/免控保输出环境' });
  if (v('mobility') >= 0.6 && (ap || tank)) rules.push({ slot: 'follow', inId: ap ? 3116 : 3143, dim: 'mobility', reason: '突进多：减速/减暴击限制贴脸' });
  if (v('early') >= 0.6 || (v('ad') >= 0.6 && v('burst') >= 0.2)) rules.push({ slot: 'boots', inId: 3047, dim: 'early', reason: '前期物理压力：铁板靴减普攻伤害' });
  else if (v('ap') >= 0.6 || v('cc') >= 0.6) rules.push({ slot: 'boots', inId: 3111, dim: 'ap', reason: '法控压力：水银靴减控时长' });
  return rules;
}

function plan(build, my, enemy, items) {
  const fits = id => itemFits(my || {}, ((items || {})[id] || {}).tags);
  const comboRows = (build.coreItems || []).filter(r => r.items.length >= 3);
  const coreRows = comboRows.filter(r => r.items.length === 3);
  // 单件热度行：OP.GG 带 games；101 官方无样本量字段（games=null）但 pick/win 真实 → 同样可用
  const singles = [...(build.coreItems || []), ...(build.lastItems || [])]
    .filter(r => r.items.length === 1 && r.pickRate != null && r.winRate != null);
  const coreRow = coreRows.slice().sort(byScore)[0] || null;
  const bootsRow = (build.boots || []).slice().sort(byScore)[0] || null;
  const starterRow = (build.starterItems || []).slice().sort(byScore)[0] || null;
  const used = new Set();
  const take = id => { used.add(id); return id; };
  let coreIds = coreRow ? coreRow.items.map(i => i.id) : singles.slice().sort(byScore).slice(0, 3).map(r => r.items[0].id);
  coreIds.forEach(take);
  const bootsId = bootsRow ? take(bootsRow.items[0].id) : null;
  // 后续槽候选：热门单件行优先；不足时从其他真实组合行提取成品装（带该行真实统计，口径单独标注）
  const starterIds = new Set(starterRow ? starterRow.items.map(i => i.id) : []);
  const followCands = [];
  for (const r of singles.slice().sort(byScore)) {
    const id = r.items[0].id;
    if (!used.has(id) && fits(id) && !followCands.some(c => c.id === id)) followCands.push({ id, row: r, kind: 'single' });
  }
  for (const r of comboRows.slice().sort(byScore)) {
    // 组合行门槛：真实样本≥20 场、行内无重复件（排除统计脏行），且装备与英雄职业相配
    if (r === coreRow || r.games == null || r.games < 20 || r.pickRate == null || r.winRate == null) continue;
    if (new Set(r.items.map(i => i.id)).size !== r.items.length) continue;
    for (const it of r.items) {
      const id = it.id;
      if (id < 2000 || used.has(id) || starterIds.has(id) || !fits(id) || followCands.some(c => c.id === id)) continue;
      followCands.push({ id, row: r, kind: 'combo' });
    }
  }
  const f1 = followCands[0] ? take(followCands[0].id) : null;
  const f2 = followCands[1] ? take(followCands[1].id) : null;
  const six = [coreIds[0] ?? null, coreIds[1] ?? null, coreIds[2] ?? null, bootsId, f1, f2];
  const followRows = {};
  for (const c of followCands) followRows[c.id] = c.row;
  const followKind = {};
  for (const c of followCands) followKind[c.id] = c.kind;

  const dims = enemyDims(enemy || []);
  const swaps = [];
  const adjusted = six.slice();
  if (enemy && enemy.length) {
    for (const rule of swapRules(my || {}, dims)) {
      if (adjusted.includes(rule.inId) || !fits(rule.inId)) continue;
      let idx;
      if (rule.slot === 'boots') {
        idx = 3;
      } else {
        // 优先填空后续槽（4→5）；都满时替换未被本轮规则动过的非核心件，避免后一条规则覆盖前一条
        idx = adjusted[4] == null ? 4 : adjusted[5] == null ? 5 : -1;
        if (idx === -1) {
          idx = [4, 5].find(i => !coreIds.includes(adjusted[i]) && !swaps.some(s => s.slot === i));
          if (idx == null) continue;
        }
      }
      swaps.push({ slot: idx, outId: adjusted[idx], inId: rule.inId, dim: rule.dim, reason: rule.reason, source: 'rule' });
      adjusted[idx] = rule.inId;
      if (swaps.length >= 3) break;
    }
  }

  const purchase = [
    { stage: 1, label: '出门', ids: starterRow ? starterRow.items.map(i => i.id) : [], row: starterRow },
    { stage: 2, label: '鞋子', ids: adjusted[3] != null ? [adjusted[3]] : [], row: bootsRow },
    { stage: 3, label: '核心 1', ids: adjusted[0] != null ? [adjusted[0]] : [], row: coreRow },
    { stage: 4, label: '核心 2', ids: adjusted[1] != null ? [adjusted[1]] : [], row: coreRow },
    { stage: 5, label: '核心 3', ids: adjusted[2] != null ? [adjusted[2]] : [], row: coreRow },
    { stage: 6, label: '针对/后续', ids: adjusted[5] != null ? [adjusted[5]] : (adjusted[4] != null ? [adjusted[4]] : []), row: followRows[adjusted[5]] || followRows[adjusted[4]] || (swaps.some(s => s.inId === adjusted[5] || s.inId === adjusted[4]) ? { heuristic: true } : null) },
  ];
  let popular, popularNote;
  if (singles.length) {
    popular = singles.slice().sort(byScore).slice(0, 6)
      .map(r => ({ ...r, kind: '单件热度', lowSample: r.games != null && r.games < 100 }));
    popularNote = '单件热度行，独立统计，非六神装拼接。';
  } else {
    // 韩服翡翠+口径无带样本的单件行：回退到真实核心组合/鞋子/出门行，口径如实标注，不伪造。
    const fallback = [
      ...(build.coreItems || []).filter(r => r.items.length > 1).map(r => ({ ...r, kind: '核心组合' })),
      ...(build.boots || []).map(r => ({ ...r, kind: '鞋子' })),
      ...(build.starterItems || []).map(r => ({ ...r, kind: '出门' })),
    ].filter(r => r.games != null && r.pickRate != null && r.winRate != null);
    popular = fallback.sort(byScore).slice(0, 6)
      .map(r => ({ ...r, lowSample: r.games < 100 }));
    popularNote = '当前口径无单件热度样本：展示真实核心组合 / 鞋子 / 出门行的独立热度，非六神装拼接。';
  }
  const timeline = purchase.map(p => ({ ...p, lowSample: p.row && p.row.games != null && p.row.games < 100 }));
  return {
    key: build.championKey, position: build.position, patch: build.patch, fetchedAt: build.fetchedAt, provider: build.provider,
    region: build.region, tier: build.tier,
    six, adjustedSix: adjusted, swaps, purchase, popular, popularNote, timeline, dims,
    coreRow, bootsRow, starterRow, followRows,
    sixSources: six.map((id, i) => id == null ? 'empty' : (i < 3 ? (coreRow ? 'core' : 'single-assembled') : i === 3 ? 'boots' : (followKind[id] || 'single'))),
    lowSamples: [coreRow, bootsRow, starterRow, ...singles, ...followCands.map(c => c.row)].filter(r => r && r.games != null && r.games < 100).length,
    note: '六神装 = 真实核心三件 + 鞋子 + 后续（热门单件或其他真实组合行）；无样本槽位留空不伪造。针对替换为规则推导，单独标注。',
  };
}

module.exports = { plan, enemyDims, swapRules, itemFits, shrunkWin, score, PRIOR_GAMES };