#!/usr/bin/env node
'use strict';
/**
 * NEXUS seed/refresh CLI. Populates a local SQLite DB + asset cache with real
 * OP.GG (KR) statistics and Riot Data Dragon static data. Used to build the
 * bundled seed and for manual refresh outside the app.
 *   node tools/fetch-data.mjs [--dir data/seed] [--force] [--region kr] [--tier emerald_plus]
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const initSqlJs = require('sql.js');
const { createDb } = require('../electron/core/db');
const { createLogger } = require('../electron/core/logger');
const { createConfig } = require('../electron/core/config');
const { createAssets } = require('../electron/providers/assets');
const { collect } = require('../electron/providers/collector');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = path.resolve(root, arg('dir', 'data/seed'));
  const force = !!arg('force', false);
  const region = arg('region', 'kr');
  const tier = arg('tier', 'emerald_plus');
  fs.mkdirSync(dir, { recursive: true });
  const logger = createLogger(path.join(dir, 'logs'));
  const config = createConfig(dir);
  config.patch({ region, tier });
  const db = await createDb(initSqlJs, path.join(dir, 'nexus.db'), logger);
  const assets = createAssets(path.join(dir, 'assets'), logger);
  const ctx = { db, logger, config, assets };
  console.log('[NEXUS] collecting →', dir, { region, tier, force });
  const t0 = Date.now();
  const res = await collect(ctx, {
    force, region, tier, concurrency: 3,
    progress: (p) => { if (p.message) console.log(`  [${p.phase}] ${p.message}${p.total > 1 ? ` (${p.done}/${p.total})` : ''}`); },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.ok) {
    console.log(`[NEXUS] OK in ${secs}s — patch ${res.patch}, dd ${res.ddVersion}, stats ${res.stats}, builds ${res.builds}`);
    console.log('[NEXUS] counts', db.counts(), 'dbBytes', db.sizeBytes());
  } else {
    console.error('[NEXUS] FAILED:', res.error);
    process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exit(1); });