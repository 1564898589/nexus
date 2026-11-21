'use strict';
/**
 * NEXUS 私人访问密码门。
 * 验证全部在主进程完成：renderer 只提交候选密码，永远拿不到哈希/盐/明文。
 * 存储：scrypt 验证器（盐 + 哈希），经 Windows DPAPI（safeStorage）加密落盘；
 * 源码与前端均不含明文密码——SEED 只是预先算好的验证器。
 * 启用语义：验一次信任本机。新设备首次启动需密码，验证成功后本机信任（DPAPI 加密，
 * 跨机器/跨 Windows 账户解不开）→ 本机日常启动免密码；打包发给别人时对方仍需首验。
 * 改密码使所有设备信任失效；revokeTrust 可让本机下次启动重新验证。无账号/授权码/联网。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

// 预计算的 scrypt 验证器（非明文）。修改密码后由用户数据目录的记录覆盖。
const SEED = {
  salt: '7f3a9c1e5b8d4206a1e9f0c3d7b2548e',
  hash: 'b0b302b992a98618121709cdc475ea0685347c1dd79dab65c3c1e1af4a89c37fe20bcc220adc84e348efdc3b5a6543728ad4d5b79cb6abd9517e83aac58981f0',
};
const SCRYPT = { N: 16384, r: 8, p: 1 };

function createAuthGate(dir, logger) {
  const log = logger ? logger.child('auth') : { info() {}, warn() {} };
  const file = path.join(dir, 'access-lock.json');
  const trustFile = path.join(dir, 'device-trust.json');
  let fails = 0;
  let lockUntil = 0;

  function derive(pwd, salt) {
    return crypto.scryptSync(String(pwd), salt, 64, SCRYPT);
  }
  function load() {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const json = raw.enc ? safeStorage.decryptString(Buffer.from(raw.enc, 'base64')) : raw.plain;
        const o = JSON.parse(json);
        if (o && o.salt && o.hash) return o;
      }
    } catch (e) { log.warn('load failed, reseed', e.message); }
    return { ...SEED };
  }
  let rec = load();
  function trustValid() {
    try {
      const raw = JSON.parse(fs.readFileSync(trustFile, 'utf8'));
      if (!raw.enc) return false;
      const o = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
      return !!(o && o.salt === rec.salt && o.hash === rec.hash);
    } catch { return false; }
  }
  function writeTrust() {
    try {
      const json = JSON.stringify({ salt: rec.salt, hash: rec.hash, at: Date.now() });
      fs.writeFileSync(trustFile, JSON.stringify({ enc: safeStorage.encryptString(json).toString('base64') }));
    } catch (e) { log.warn('trust write failed', e.message); }
  }
  function clearTrust() { try { fs.rmSync(trustFile, { force: true }); } catch {} }
  let unlocked = trustValid();
  function save() {
    const json = JSON.stringify(rec);
    const payload = safeStorage.isEncryptionAvailable()
      ? { enc: safeStorage.encryptString(json).toString('base64') }
      : { plain: json }; // 仅当系统加密不可用时回退（已标记）
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, file);
  }
  if (!fs.existsSync(file)) save();

  function status() {
    const trusted = trustValid();
    return { required: !trusted, unlocked: unlocked || trusted, trusted, initialized: true, secure: safeStorage.isEncryptionAvailable() };
  }

  async function verify(pwd) {
    if (Date.now() < lockUntil) return { ok: false, error: '尝试过于频繁，请 15 秒后再试', locked: true };
    let ok = false;
    try {
      const a = derive(pwd, rec.salt);
      const b = Buffer.from(rec.hash, 'hex');
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { ok = false; }
    if (ok) { unlocked = true; fails = 0; writeTrust(); log.info('unlocked'); return { ok: true }; }
    fails++;
    if (fails >= 5) { lockUntil = Date.now() + 15000; fails = 0; log.warn('throttled after repeated failures'); }
    await new Promise(r => setTimeout(r, 350)); //  slowing brute force
    return { ok: false, error: '密码错误，请重新输入' };
  }

  async function change(oldPwd, newPwd) {
    if (!unlocked) return { ok: false, error: '请先解锁后再修改密码' };
    const v = await verify(oldPwd);
    if (!v.ok) return { ok: false, error: v.locked ? v.error : '原密码不正确' };
    const np = String(newPwd == null ? '' : newPwd);
    if (np.length < 4 || np.length > 64) return { ok: false, error: '新密码需 4–64 个字符' };
    const salt = crypto.randomBytes(16).toString('hex');
    rec = { salt, hash: derive(np, salt).toString('hex') };
    save();
    clearTrust();
    log.info('password changed');
    return { ok: true };
  }

  function revokeTrust() { clearTrust(); unlocked = false; log.info('device trust revoked'); return { ok: true }; }

  return { status, verify, change, revokeTrust };
}

module.exports = { createAuthGate };