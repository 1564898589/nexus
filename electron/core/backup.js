'use strict';
const fs = require('fs');
const path = require('path');

/** Backup manager: full backups to user-data dir, integrity check, pre-restore snapshot, retention. */
function createBackupManager(dbFile, backupDir, SQL, logger, config) {
  const log = logger ? logger.child('backup') : { info() {}, error() {} };
  fs.mkdirSync(backupDir, { recursive: true });

  function verifyBuffer(buf) {
    try {
      const d = new SQL.Database(buf);
      const r = d.exec('PRAGMA integrity_check');
      const ok = r[0] && r[0].values[0][0] === 'ok';
      d.close();
      return ok;
    } catch { return false; }
  }

  function create(kind = 'manual', db = null) {
    if (db) db.persist();
    if (!fs.existsSync(dbFile)) throw new Error('数据库文件不存在');
    const buf = fs.readFileSync(dbFile);
    if (!verifyBuffer(buf)) throw new Error('当前数据库完整性校验失败，已中止备份');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `nexus-${kind}-${ts}.db`;
    const dest = path.join(backupDir, name);
    fs.writeFileSync(dest, buf);
    const rec = { file: name, createdAt: new Date().toISOString(), sizeBytes: buf.length, kind, integrity: 'ok' };
    if (db) db.run('INSERT INTO backups(file,createdAt,sizeBytes,kind,integrity) VALUES(?,?,?,?,?)',
      [rec.file, rec.createdAt, rec.sizeBytes, rec.kind, rec.integrity]);
    if (db) db.persist();
    enforceRetention(db);
    log.info('backup created', { name, size: buf.length, kind });
    return rec;
  }

  function enforceRetention(db) {
    const keep = (config && config.get('backupKeep')) || 10;
    // 按真实修改时间排序。按文件名字母序会误判：nexus-manual-* 排在 nexus-pre-restore-*
    // 之前，刚创建的手动备份会被当成"最旧"立即删除（2026-11-20 实测复现）。
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'))
      .map(f => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    while (files.length > keep) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(backupDir, old.f)); if (db) db.run('DELETE FROM backups WHERE file=?', [old.f]); } catch {}
    }
    if (db) db.persist();
  }

  function list(db) {
    const rows = db ? db.all('SELECT * FROM backups ORDER BY createdAt DESC') : [];
    const onDisk = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).map(f => {
      const st = fs.statSync(path.join(backupDir, f));
      return { file: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    });
    // 只列真实存在的文件：DB 记录但磁盘已删的"幻影行"不可恢复，不应展示
    const diskSet = new Set(onDisk.map(d => d.file));
    const map = new Map(rows.filter(r => diskSet.has(r.file)).map(r => [r.file, r]));
    for (const d of onDisk) if (!map.has(d.file)) map.set(d.file, { ...d, kind: 'external', integrity: 'unknown' });
    return [...map.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  // Restore: verify backup, snapshot current, then overwrite db file. Caller reloads db.
  function restore(file, db) {
    const src = path.join(backupDir, file);
    if (!fs.existsSync(src)) throw new Error('备份不存在: ' + file);
    const buf = fs.readFileSync(src);
    if (!verifyBuffer(buf)) throw new Error('备份完整性校验失败，已拒绝恢复');
    const snapshot = create('pre-restore', db);
    fs.writeFileSync(dbFile + '.tmp', buf);
    fs.renameSync(dbFile + '.tmp', dbFile);
    log.info('restored from backup', { file, snapshot: snapshot.file });
    return { ok: true, snapshot: snapshot.file };
  }

  function check(file) {
    const src = path.join(backupDir, file);
    if (!fs.existsSync(src)) return { ok: false, reason: 'not-found' };
    return { ok: verifyBuffer(fs.readFileSync(src)) };
  }

  return { create, list, restore, check, verifyBuffer, dir: backupDir };
}

module.exports = { createBackupManager };