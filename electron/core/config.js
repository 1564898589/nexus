'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  region: 'kr',
  tier: 'emerald_plus',
  position: 'all',
  autoUpdate: true,
  updateIntervalHours: 6,
  autoBackup: true,
  backupKeep: 10,
  backupIntervalHours: 24,
  favorites: [],
  mainRole: 'MID',
  mainChampions: [],
  recentChampions: [],
  reduceMotion: false,
  aiEnabled: true,
  lcuAutoConnect: true,
  lcuConfirmApply: true,
  autoCheckUpdate: true,
};

function createConfig(dir) {
  const file = path.join(dir, 'config.json');
  let data = { ...DEFAULTS };
  try {
    if (fs.existsSync(file)) data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch { /* corrupt config -> defaults */ }
  function save() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }
  return {
    get: (k) => (k ? data[k] : { ...data }),
    set: (k, v) => { data[k] = v; save(); return data[k]; },
    patch: (obj) => { Object.assign(data, obj); save(); return { ...data }; },
    all: () => ({ ...data }),
    file,
  };
}

module.exports = { createConfig, DEFAULTS };