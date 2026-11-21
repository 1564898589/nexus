'use strict';
/**
 * Heuristic champion trait model + team composition analysis.
 * IMPORTANT: This is rule-based design knowledge derived from champion tags/roles,
 * NOT OP.GG statistics. The UI labels every output here as "启发式分析".
 * Real win/pick/ban/counter numbers always come from the OP.GG adapter separately.
 */

// Curated trait overrides (0..3). Dimensions:
// engage poke splitpush waveclear frontline peel cc burst dps mobility sustain early late ad ap
const TRAITS = {
  aatrox: { frontline: 2, sustain: 3, early: 2, late: 2, ad: 3, splitpush: 2, cc: 1 },
  ahri: { poke: 2, burst: 2, mobility: 3, ap: 3, cc: 1, early: 1, late: 2, waveclear: 2 },
  akali: { burst: 3, mobility: 3, ap: 3, splitpush: 2, early: 1, late: 2 },
  akshan: { burst: 2, mobility: 3, ad: 3, early: 2, splitpush: 2 },
  alistar: { engage: 3, frontline: 3, cc: 3, peel: 2, early: 2, late: 1 },
  amumu: { engage: 3, frontline: 2, cc: 3, ap: 2, early: 1, late: 2 },
  anivia: { waveclear: 3, cc: 2, ap: 3, late: 3, early: 0, poke: 1 },
  annie: { burst: 3, engage: 2, cc: 2, ap: 3, early: 2 },
  aphelios: { dps: 3, ad: 3, late: 3, early: 0, waveclear: 2 },
  ashe: { engage: 2, cc: 2, dps: 2, ad: 3, late: 2, poke: 1, early: 1 },
  aurelionsol: { waveclear: 3, ap: 3, late: 3, cc: 2, early: 0, mobility: 2 },
  azir: { dps: 2, ap: 3, late: 3, waveclear: 2, mobility: 2, engage: 2, early: 0 },
  bard: { poke: 2, cc: 2, mobility: 3, peel: 1, early: 2, engage: 1 },
  belveth: { dps: 3, ad: 3, late: 3, mobility: 2, splitpush: 2, early: 1 },
  blitzcrank: { engage: 3, cc: 2, frontline: 1, early: 3, late: 0, poke: 1 },
  brand: { poke: 2, waveclear: 2, ap: 3, dps: 2, late: 2, cc: 1 },
  braum: { peel: 3, frontline: 2, cc: 2, early: 2, engage: 1 },
  briar: { engage: 2, frontline: 2, sustain: 3, ad: 3, early: 2, mobility: 2 },
  caitlyn: { poke: 3, dps: 2, ad: 3, late: 3, early: 2, waveclear: 1 },
  camille: { splitpush: 3, engage: 2, ad: 3, mobility: 2, late: 2, cc: 1, early: 1 },
  cassiopeia: { dps: 3, ap: 3, late: 3, cc: 2, early: 1, waveclear: 2 },
  chogath: { frontline: 3, cc: 2, ap: 2, late: 2, sustain: 1 },
  corki: { poke: 2, dps: 2, ad: 2, ap: 1, late: 2, mobility: 2, waveclear: 2 },
  darius: { frontline: 2, sustain: 2, ad: 3, early: 3, late: 1, splitpush: 2, cc: 1 },
  diana: { engage: 2, burst: 3, ap: 3, mobility: 2, early: 1, late: 2, waveclear: 2 },
  draven: { dps: 3, ad: 3, early: 3, late: 1, burst: 2 },
  drmundo: { frontline: 3, sustain: 3, late: 2, ad: 1, ap: 1, splitpush: 1 },
  ekko: { burst: 3, mobility: 3, ap: 3, splitpush: 2, early: 1, late: 2, engage: 1 },
  elise: { burst: 2, engage: 2, ap: 2, early: 3, late: 0, mobility: 2, cc: 1 },
  evelynn: { burst: 3, ap: 3, mobility: 2, late: 2, early: 0 },
  ezreal: { poke: 3, mobility: 3, ad: 2, ap: 1, late: 2, early: 1, dps: 1 },
  fiddlesticks: { engage: 3, ap: 3, cc: 2, late: 2, early: 0, waveclear: 2 },
  fiora: { splitpush: 3, ad: 3, sustain: 2, late: 3, mobility: 2, early: 1 },
  fizz: { burst: 3, mobility: 3, ap: 3, early: 2, late: 1 },
  galio: { engage: 3, frontline: 2, cc: 3, ap: 2, early: 2, waveclear: 2, peel: 1 },
  gangplank: { poke: 2, ad: 3, late: 3, waveclear: 2, splitpush: 2, early: 0 },
  garen: { frontline: 2, ad: 3, sustain: 2, early: 2, late: 1, splitpush: 2 },
  gnar: { frontline: 2, engage: 2, ad: 2, cc: 2, early: 1, late: 2, splitpush: 1 },
  gragas: { engage: 2, burst: 2, ap: 2, frontline: 1, cc: 2, mobility: 2, early: 1 },
  graves: { dps: 2, ad: 3, burst: 2, early: 2, frontline: 1, mobility: 1 },
  gwen: { dps: 2, ap: 3, sustain: 2, late: 2, splitpush: 2, mobility: 2 },
  hecarim: { engage: 3, mobility: 3, ad: 2, frontline: 2, early: 2, late: 1, cc: 1 },
  heimerdinger: { poke: 2, waveclear: 3, ap: 3, late: 2, early: 1, splitpush: 1 },
  hwei: { poke: 3, waveclear: 3, ap: 3, cc: 2, late: 2, early: 1 },
  illaoi: { frontline: 2, ad: 3, sustain: 2, splitpush: 2, early: 2, late: 1, waveclear: 2 },
  irelia: { mobility: 3, ad: 3, dps: 2, splitpush: 2, early: 2, late: 2, engage: 1, sustain: 1 },
  ivern: { peel: 2, cc: 2, engage: 1, early: 2, sustain: 1 },
  janna: { peel: 3, cc: 2, mobility: 2, early: 2, late: 2, engage: 1 },
  jarvaniv: { engage: 3, frontline: 2, ad: 2, cc: 2, early: 2, late: 1 },
  jax: { splitpush: 3, ad: 2, ap: 1, late: 3, mobility: 2, early: 1, frontline: 1, dps: 2 },
  jayce: { poke: 3, burst: 2, ad: 3, early: 2, late: 1, mobility: 1, splitpush: 1 },
  jhin: { poke: 2, burst: 2, ad: 3, cc: 1, late: 2, early: 1, dps: 1 },
  jinx: { dps: 3, ad: 3, late: 3, waveclear: 2, early: 0, mobility: 0 },
  kaisa: { dps: 3, burst: 2, ad: 2, ap: 1, mobility: 2, late: 3, early: 1 },
  kalista: { dps: 2, ad: 3, mobility: 3, early: 2, late: 1, engage: 1 },
  karma: { poke: 2, peel: 2, ap: 2, early: 2, waveclear: 2, mobility: 1, cc: 1 },
  karthus: { waveclear: 3, ap: 3, dps: 3, late: 3, early: 0 },
  kassadin: { burst: 2, mobility: 3, ap: 3, late: 3, early: 0, splitpush: 1 },
  katarina: { burst: 3, mobility: 3, ap: 3, early: 1, late: 2, waveclear: 1 },
  kayle: { dps: 3, ap: 2, ad: 1, late: 3, early: 0, waveclear: 2, splitpush: 2 },
  kayn: { mobility: 3, ad: 3, engage: 2, early: 1, late: 2, splitpush: 1, sustain: 1 },
  kennen: { engage: 3, ap: 3, cc: 2, mobility: 2, early: 1, late: 2, waveclear: 1 },
  khazix: { burst: 3, mobility: 3, ad: 3, early: 2, late: 1 },
  kindred: { dps: 2, ad: 3, mobility: 2, late: 2, early: 1 },
  kled: { engage: 3, frontline: 2, ad: 3, early: 2, splitpush: 2, mobility: 2 },
  kogmaw: { dps: 3, ad: 2, ap: 1, late: 3, early: 0, poke: 1 },
  ksante: { frontline: 3, engage: 2, cc: 2, ad: 2, early: 1, late: 2, mobility: 2, peel: 1 },
  leblanc: { burst: 3, mobility: 3, ap: 3, early: 3, late: 1, poke: 1 },
  leesin: { engage: 2, mobility: 3, ad: 3, early: 3, late: 0, cc: 1, burst: 1 },
  leona: { engage: 3, frontline: 2, cc: 3, early: 3, late: 1, peel: 1 },
  lillia: { dps: 2, ap: 3, mobility: 3, engage: 2, late: 2, early: 1, cc: 1 },
  lissandra: { engage: 2, cc: 3, ap: 3, waveclear: 2, early: 1, late: 2, mobility: 1 },
  lucian: { burst: 2, dps: 2, ad: 3, mobility: 2, early: 3, late: 1 },
  lulu: { peel: 3, cc: 1, early: 2, late: 2, poke: 1, mobility: 1 },
  lux: { poke: 3, burst: 2, cc: 2, ap: 3, waveclear: 2, early: 1, late: 2 },
  malphite: { engage: 3, frontline: 3, cc: 2, ap: 2, early: 1, late: 2 },
  malzahar: { cc: 3, ap: 3, waveclear: 2, late: 2, early: 1, engage: 1 },
  maokai: { engage: 2, frontline: 3, cc: 3, ap: 2, early: 1, late: 2, sustain: 1 },
  masteryi: { dps: 3, ad: 3, late: 3, mobility: 2, early: 0, splitpush: 2 },
  milio: { peel: 3, cc: 1, early: 2, late: 2, sustain: 1 },
  missfortune: { poke: 2, burst: 2, ad: 3, waveclear: 2, early: 2, late: 2, engage: 1 },
  mordekaiser: { frontline: 2, ap: 3, sustain: 2, late: 2, splitpush: 2, cc: 1 },
  morgana: { cc: 3, peel: 2, ap: 2, waveclear: 2, early: 2, engage: 1 },
  naafiri: { burst: 2, ad: 3, mobility: 3, early: 2, splitpush: 1 },
  nami: { peel: 2, cc: 2, engage: 1, early: 2, late: 2, poke: 1, sustain: 1 },
  nasus: { splitpush: 3, frontline: 2, ad: 2, late: 3, early: 0, sustain: 2 },
  nautilus: { engage: 3, cc: 3, frontline: 2, early: 2, late: 1, peel: 1 },
  neeko: { engage: 2, burst: 2, ap: 3, cc: 2, mobility: 1, early: 1 },
  nidalee: { poke: 3, burst: 2, ap: 3, mobility: 3, early: 3, late: 0 },
  nilah: { dps: 2, ad: 3, sustain: 2, late: 2, engage: 1, early: 1 },
  nocturne: { engage: 3, ad: 3, mobility: 2, early: 2, late: 1, splitpush: 1 },
  nunu: { engage: 2, frontline: 2, cc: 2, ap: 2, early: 2, mobility: 2 },
  olaf: { frontline: 2, ad: 3, sustain: 2, early: 3, late: 1, splitpush: 1 },
  orianna: { waveclear: 3, engage: 2, ap: 3, cc: 2, late: 3, early: 0, poke: 1 },
  ornn: { frontline: 3, engage: 2, cc: 2, ap: 2, early: 1, late: 2, peel: 1 },
  pantheon: { engage: 2, burst: 2, ad: 3, early: 3, late: 0, cc: 1, mobility: 1, splitpush: 1 },
  poppy: { frontline: 3, cc: 2, engage: 1, peel: 2, ad: 2, early: 2, late: 1 },
  pyke: { burst: 3, mobility: 3, ad: 3, cc: 1, early: 3, late: 0, engage: 1 },
  qiyana: { burst: 3, mobility: 2, ad: 3, cc: 2, early: 2, late: 1, engage: 1 },
  quinn: { poke: 2, ad: 3, mobility: 3, early: 2, splitpush: 2, late: 0 },
  rakan: { engage: 3, mobility: 3, cc: 2, peel: 2, early: 2, late: 1 },
  rammus: { engage: 3, frontline: 3, cc: 2, ad: 1, ap: 1, early: 2, late: 1, mobility: 2 },
  reksai: { engage: 2, ad: 3, early: 3, late: 0, frontline: 1, mobility: 2, cc: 1 },
  rell: { engage: 3, frontline: 2, cc: 3, early: 2, late: 1, mobility: 1 },
  renata: { peel: 3, cc: 2, engage: 1, early: 2, late: 2 },
  renekton: { frontline: 2, ad: 3, early: 3, late: 0, sustain: 2, splitpush: 1, cc: 1, mobility: 1 },
  rengar: { burst: 3, ad: 3, mobility: 2, early: 2, late: 1, splitpush: 1 },
  riven: { burst: 2, mobility: 3, ad: 3, splitpush: 2, early: 2, late: 2, cc: 1 },
  rumble: { waveclear: 3, ap: 3, engage: 2, early: 2, late: 2, frontline: 1 },
  ryze: { dps: 2, ap: 3, waveclear: 3, late: 3, early: 0, splitpush: 2, mobility: 1 },
  samira: { dps: 2, burst: 2, ad: 3, mobility: 2, late: 2, early: 1, engage: 1, sustain: 1 },
  sejuani: { engage: 3, frontline: 3, cc: 3, ap: 2, early: 2, late: 1 },
  senna: { poke: 2, dps: 2, ad: 3, late: 3, early: 1, peel: 1, sustain: 1 },
  seraphine: { waveclear: 2, engage: 2, ap: 2, cc: 2, peel: 2, late: 2, early: 1 },
  sett: { frontline: 2, engage: 2, ad: 3, cc: 2, early: 2, late: 1, sustain: 1, splitpush: 1 },
  shaco: { burst: 2, mobility: 2, ad: 2, ap: 1, early: 2, splitpush: 1 },
  shen: { frontline: 3, peel: 2, cc: 1, engage: 1, early: 2, late: 1, splitpush: 2 },
  shyvana: { frontline: 2, ap: 2, ad: 1, waveclear: 2, late: 2, engage: 1, splitpush: 1 },
  singed: { frontline: 2, ap: 2, mobility: 2, splitpush: 2, late: 2, cc: 1, early: 1 },
  sion: { frontline: 3, cc: 2, engage: 2, ad: 2, early: 1, late: 2, splitpush: 1, waveclear: 1 },
  sivir: { waveclear: 3, dps: 2, ad: 3, late: 3, early: 1, mobility: 1, engage: 1 },
  skarner: { engage: 3, frontline: 3, cc: 3, ad: 2, early: 2, late: 1 },
  smolder: { dps: 2, ad: 3, late: 3, waveclear: 2, early: 0, poke: 1 },
  sona: { peel: 2, poke: 1, sustain: 2, late: 3, early: 1, cc: 1, waveclear: 1 },
  soraka: { peel: 2, sustain: 3, late: 2, early: 1, cc: 1 },
  swain: { frontline: 2, ap: 3, sustain: 2, cc: 1, late: 2, early: 1, waveclear: 2 },
  sylas: { burst: 2, ap: 3, mobility: 2, sustain: 2, early: 1, late: 2, splitpush: 1, engage: 1 },
  syndra: { burst: 3, poke: 2, ap: 3, cc: 1, late: 2, early: 1, waveclear: 2 },
  tahmkench: { frontline: 3, peel: 3, cc: 1, sustain: 2, early: 2, late: 1 },
  taliyah: { waveclear: 3, poke: 2, ap: 3, cc: 2, early: 1, late: 2, mobility: 1 },
  talon: { burst: 3, mobility: 3, ad: 3, early: 2, late: 1, splitpush: 1 },
  taric: { peel: 3, frontline: 2, cc: 1, sustain: 2, early: 1, late: 2, engage: 1 },
  teemo: { poke: 3, ap: 3, splitpush: 2, early: 2, late: 1, cc: 1 },
  thresh: { engage: 2, cc: 3, peel: 2, early: 2, late: 1, frontline: 1 },
  tristana: { dps: 2, burst: 2, ad: 3, mobility: 2, late: 3, early: 1, splitpush: 1 },
  trundle: { frontline: 2, ad: 3, splitpush: 2, early: 2, late: 1, sustain: 2, cc: 1 },
  tryndamere: { splitpush: 3, ad: 3, mobility: 2, late: 2, early: 1, sustain: 1 },
  twistedfate: { cc: 2, ap: 3, waveclear: 2, early: 2, late: 1, mobility: 1, splitpush: 1 },
  twitch: { dps: 3, ad: 3, late: 3, early: 0, burst: 1, mobility: 1 },
  udyr: { frontline: 2, engage: 2, ad: 2, ap: 1, mobility: 2, early: 2, cc: 1, splitpush: 1, sustain: 1 },
  urgot: { frontline: 2, ad: 3, dps: 2, early: 2, late: 2, cc: 1, splitpush: 1 },
  varus: { poke: 3, dps: 2, ad: 2, ap: 1, cc: 1, late: 2, early: 1, waveclear: 1 },
  vayne: { dps: 3, ad: 3, mobility: 2, late: 3, early: 0, splitpush: 2 },
  veigar: { burst: 3, ap: 3, cc: 2, late: 3, early: 0, waveclear: 1 },
  velkoz: { poke: 3, burst: 2, ap: 3, waveclear: 2, cc: 1, late: 2, early: 1 },
  vex: { burst: 2, engage: 2, ap: 3, cc: 2, mobility: 2, early: 1, late: 2, waveclear: 2 },
  vi: { engage: 3, ad: 3, cc: 2, frontline: 1, early: 2, late: 1, mobility: 2 },
  viego: { dps: 2, ad: 3, mobility: 2, sustain: 2, early: 1, late: 2, engage: 1 },
  viktor: { waveclear: 3, poke: 2, ap: 3, late: 3, early: 0, dps: 2 },
  vladimir: { ap: 3, sustain: 3, late: 3, early: 0, waveclear: 2, frontline: 1, burst: 2 },
  volibear: { frontline: 2, engage: 2, ad: 2, ap: 1, early: 2, cc: 1, sustain: 2, splitpush: 1 },
  warwick: { frontline: 2, sustain: 3, ad: 2, ap: 1, early: 2, cc: 1, engage: 1, mobility: 1 },
  wukong: { engage: 3, ad: 3, frontline: 1, cc: 2, early: 1, late: 2, mobility: 2 },
  xayah: { dps: 2, ad: 3, cc: 1, peel: 1, late: 2, early: 1, waveclear: 2 },
  xerath: { poke: 3, burst: 2, ap: 3, waveclear: 2, late: 2, early: 1 },
  xinzhao: { engage: 2, ad: 3, frontline: 1, early: 3, late: 0, sustain: 1, cc: 1, mobility: 1 },
  yasuo: { dps: 2, ad: 3, mobility: 3, splitpush: 2, late: 2, early: 1, cc: 1, waveclear: 2 },
  yone: { dps: 2, ad: 2, ap: 1, mobility: 3, splitpush: 2, late: 2, early: 1, engage: 1, cc: 1 },
  yorick: { splitpush: 3, ad: 3, frontline: 1, late: 2, early: 1, waveclear: 1 },
  yuumi: { peel: 2, sustain: 2, poke: 1, late: 2, early: 0, cc: 1 },
  zac: { engage: 3, frontline: 3, cc: 2, ap: 2, sustain: 2, early: 1, late: 2, mobility: 2 },
  zed: { burst: 3, mobility: 3, ad: 3, splitpush: 2, early: 2, late: 1 },
  zeri: { dps: 3, ad: 3, mobility: 3, late: 3, early: 0, waveclear: 1 },
  ziggs: { poke: 3, waveclear: 3, ap: 3, late: 2, early: 1, splitpush: 1 },
  zilean: { peel: 2, cc: 1, ap: 2, late: 2, early: 1, waveclear: 1, mobility: 1 },
  zoe: { poke: 3, burst: 3, ap: 3, cc: 1, early: 2, late: 1, mobility: 1 },
  zyra: { poke: 2, cc: 2, ap: 3, waveclear: 2, engage: 1, early: 2, late: 1 },
};

const DIMS = ['engage', 'poke', 'splitpush', 'waveclear', 'frontline', 'peel', 'cc', 'burst', 'dps', 'mobility', 'sustain', 'early', 'late', 'ad', 'ap'];

function traitsFor(champ) {
  const key = (champ.key || '').toLowerCase();
  const base = {};
  for (const d of DIMS) base[d] = 0;
  const tags = champ.tags || [];
  // tag-derived defaults
  if (tags.includes('Tank')) { base.frontline = 2; base.cc = 1; base.engage = 1; base.early = 1; }
  if (tags.includes('Fighter')) { base.frontline = 1; base.ad = 2; base.sustain = 1; base.splitpush = 1; base.early = 1; }
  if (tags.includes('Mage')) { base.ap = 2; base.waveclear = 1; base.poke = 1; base.late = 1; }
  if (tags.includes('Assassin')) { base.burst = 2; base.mobility = 2; base.early = 1; }
  if (tags.includes('Marksman')) { base.ad = 2; base.dps = 2; base.late = 2; }
  if (tags.includes('Support')) { base.peel = 1; base.cc = 1; base.early = 1; }
  const ov = TRAITS[key];
  if (ov) for (const d of DIMS) if (ov[d] != null) base[d] = ov[d];
  return base;
}

function sumTraits(team) {
  const t = {};
  for (const d of DIMS) t[d] = 0;
  for (const c of team) {
    if (!c) continue;
    const tr = traitsFor(c);
    for (const d of DIMS) t[d] += tr[d];
  }
  return t;
}

// Normalize a 5-champion team's raw trait sums into 0..100 dimension scores.
function scoreTeam(team) {
  const filled = team.filter(Boolean);
  const raw = sumTraits(filled);
  const n = Math.max(filled.length, 1);
  const scores = {};
  for (const d of DIMS) scores[d] = Math.round(Math.min(100, (raw[d] / (n * 3)) * 100));
  const ad = raw.ad, ap = raw.ap;
  const totalDmg = ad + ap || 1;
  const profile = { ad: Math.round(ad / totalDmg * 100), ap: Math.round(ap / totalDmg * 100) };
  return { scores, profile, raw, count: filled.length };
}

function analyzeTeam(team) {
  const { scores, profile, count } = scoreTeam(team);
  const strengths = [], weaknesses = [];
  const has = (d, th) => scores[d] >= th;
  if (has('frontline', 45)) strengths.push('具备可靠前排，能吸收伤害并保护后排');
  else weaknesses.push('前排不足，团战容易被先手开团击穿');
  if (has('engage', 45)) strengths.push('开团手段充足，能主动发起团战');
  else weaknesses.push('缺乏稳定开团，难以主动创造团战机会');
  if (has('cc', 45)) strengths.push('控制链完整，能限制敌方关键目标');
  else weaknesses.push('硬控偏少，难以留住或打断敌方');
  if (has('peel', 40)) strengths.push('保护能力强，后排输出环境较好');
  if (has('dps', 45) || has('burst', 45)) strengths.push('输出能力达标，具备击杀威胁');
  else weaknesses.push('整体输出不足，难以在团战中造成减员');
  if (has('late', 50)) strengths.push('后期成长优秀，拖到后期胜率上升');
  if (has('early', 50)) strengths.push('前期节奏强，适合主动入侵滚雪球');
  if (has('splitpush', 45)) strengths.push('具备分推牵制点，可打边线运营');
  if (has('waveclear', 45)) strengths.push('清线能力好，守塔与转线从容');
  if (has('mobility', 45)) strengths.push('机动性高，支援与追击灵活');
  if (profile.ap >= 75) weaknesses.push('伤害几乎全为魔法，敌方堆魔抗即可大幅减伤');
  else if (profile.ad >= 75) weaknesses.push('伤害几乎全为物理，敌方堆护甲即可大幅减伤');
  else strengths.push('物理/魔法伤害混合，敌方难以单一堆抗');
  if (count < 5) weaknesses.push(`阵容尚未选满（${count}/5），分析仅供参考`);
  return { scores, profile, strengths, weaknesses, count };
}

function recommendForTeam(team, pool, stats) {
  const { scores, profile } = scoreTeam(team);
  const needs = [];
  if (scores.frontline < 40) needs.push('frontline');
  if (scores.engage < 40) needs.push('engage');
  if (scores.cc < 40) needs.push('cc');
  if (scores.peel < 35) needs.push('peel');
  if (scores.dps < 40 && scores.burst < 40) needs.push('dps');
  if (profile.ap >= 70) needs.push('ad');
  if (profile.ad >= 70) needs.push('ap');
  const picked = new Set(team.filter(Boolean).map(c => c.key));
  const scored = pool.filter(c => !picked.has(c.key)).map(c => {
    const tr = traitsFor(c);
    let fit = 0;
    for (const nd of needs) fit += (tr[nd] || 0) * 2;
    const st = stats ? stats.find(s => s.championKey === c.key) : null;
    const wr = st ? st.winRate : 0.5;
    const tierBonus = st ? (5 - (st.tier || 3)) * 1.5 : 0;
    return { champion: c, fit, winRate: wr, tier: st ? st.tier : null, score: fit + (wr - 0.5) * 40 + tierBonus, needs };
  }).sort((a, b) => b.score - a.score);
  return { needs, suggestions: scored.slice(0, 8) };
}

module.exports = { DIMS, TRAITS, traitsFor, scoreTeam, analyzeTeam, recommendForTeam };