'use strict';
/**
 * Local curated knowledge base. Seed entries are general macro/tactics knowledge,
 * explicitly tagged as curated (NOT realtime scraped stats). Merged into db on boot
 * (idempotent by id+updatedAt); searchable; consumed by aicontext for AI grounding.
 */
const fs = require('fs');
const path = require('path');

function createKb({ db, logger, seedDir }) {
  const log = logger ? logger.child('kb') : { info() {}, warn() {} };
  function loadSeed() {
    try {
      const f = path.join(seedDir, 'kb.json');
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch (e) { log.warn('seed read', e.message); return []; }
  }
  function sync() {
    const seed = loadSeed();
    let n = 0;
    for (const e of seed) {
      if (!e || !e.id) continue;
      const ex = db.get('SELECT updatedAt FROM kb WHERE id=?', [e.id]);
      const stamp = e.updatedAt || 'seed-1';
      if (ex && ex.updatedAt === stamp) continue;
      db.run('INSERT INTO kb(id,title,tags,patch,source,body,updatedAt) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,tags=excluded.tags,patch=excluded.patch,source=excluded.source,body=excluded.body,updatedAt=excluded.updatedAt',
        [e.id, e.title || '', JSON.stringify(e.tags || []), e.patch || '通用', e.source || 'curated', e.body || '', stamp]);
      n++;
    }
    if (n) { db.persist(); log.info('synced', n); }
    return n;
  }
  const parse = (r) => ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [] });
  function list() { return db.all('SELECT * FROM kb ORDER BY id').map(parse); }
  // keyword/tag scoring; task biases toward relevant tags.
  function search(q, task, limit = 4) {
    const all = list();
    const terms = String(q || '').toLowerCase().split(/[\s,，、/]+/).filter(Boolean);
    const taskTags = { replay: ['复盘', '死亡', '对线', '兵线'], tactic: ['训练', '英雄池', '心态', '宏观'], growth: ['训练', '英雄池', '心态'], bp: ['BP', '英雄池'], query: ['对线', '英雄池'], live: ['对线', 'BP'], compare: ['宏观'], warroom: ['宏观', '视野'] }[task] || [];
    const scored = all.map(e => {
      const hay = (e.title + ' ' + e.tags.join(' ') + ' ' + e.body).toLowerCase();
      let s = 0;
      for (const t of terms) if (hay.includes(t)) s += 3;
      for (const t of taskTags) if (e.tags.includes(t)) s += 1;
      if (!terms.length) s += 0.5; // no query: mild task relevance only
      return { e, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map(x => x.e);
  }
  sync();
  return { sync, list, search };
}

module.exports = { createKb };