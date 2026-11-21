'use strict';
/** Riot Data Dragon adapter — official public static data (zh_CN localization). */
const { fetchJson } = require('../core/net');
const BASE = 'https://ddragon.leagueoflegends.com';
const PROVIDER = 'riot-datadragon';

async function getLatestVersion() {
  const v = await fetchJson(BASE + '/api/versions.json');
  return v[0];
}
const cdn = (v) => `${BASE}/cdn/${v}`;
async function getChampionSummary(v) {
  const j = await fetchJson(`${cdn(v)}/data/zh_CN/champion.json`);
  return j.data; // keyed by champion Key (e.g. Ahri)
}
async function getChampionFull(v, key) {
  const j = await fetchJson(`${cdn(v)}/data/zh_CN/champion/${key}.json`);
  return j.data[key];
}
async function getItems(v) { const j = await fetchJson(`${cdn(v)}/data/zh_CN/item.json`); return j.data; }
async function getRunes(v) { const j = await fetchJson(`${cdn(v)}/data/zh_CN/runesReforged.json`); return j; }
async function getSpells(v) { const j = await fetchJson(`${cdn(v)}/data/zh_CN/summoner.json`); return j.data; }

const urls = {
  championSquare: (v, key) => `${cdn(v)}/img/champion/${key}.png`,
  championSplash: (key) => `${BASE}/cdn/img/champion/splash/${key}_0.jpg`,
  championLoading: (key) => `${BASE}/cdn/img/champion/loading/${key}_0.jpg`,
  item: (v, id) => `${cdn(v)}/img/item/${id}.png`,
  spell: (v, key) => `${cdn(v)}/img/spell/${key}.png`,
  passive: (v, key) => `${cdn(v)}/img/passive/${key}.png`,
  perk: (id) => `${BASE}/cdn/img/perk-images/Styles/${id}.png`, // fallback; OP.GG perk icons preferred
};

// Normalize a full champion record into our domain model.
function normalizeChampion(full, summary) {
  const s = summary || {};
  const spells = (full.spells || []).map((sp, i) => ({
    key: ['Q', 'W', 'E', 'R'][i] || sp.id,
    id: sp.id, name: sp.name, description: sp.description,
    tooltip: sp.tooltip || null, image: sp.image ? sp.image.full : null,
    cooldown: sp.cooldownBurn || null, cost: sp.costBurn || null, range: sp.rangeBurn || null,
  }));
  const passive = full.passive ? { name: full.passive.name, description: full.passive.description, image: full.passive.image ? full.passive.image.full : null } : null;
  return {
    // Data Dragon: `id` is the string key (e.g. "Ahri"), `key` is the numeric id (e.g. "103").
    // zh_CN quirk: `title` holds the champion name (阿狸), `name` holds the epithet (九尾妖狐).
    id: parseInt(full.key, 10), key: full.id,
    name: full.title, nameCn: full.title, titleCn: full.name,
    blurb: full.lore || s.blurb || null,
    tags: full.tags || s.tags || [],
    difficulty: full.info ? full.info.difficulty : null,
    attackType: full.info ? full.info.attack : null,
    damageType: full.info ? full.info.magic : null,
    partype: full.partype || null,
    stats: full.stats || null,
    passive, spells,
  };
}

module.exports = { PROVIDER, getLatestVersion, getChampionSummary, getChampionFull, getItems, getRunes, getSpells, urls, normalizeChampion, cdn };