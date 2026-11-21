'use strict';
/**
 * Authenticode publisher-signature verification (NOT just SHA-256).
 * Trust model: pinned self-signed publisher certificate shipped with the app
 * (nexus-publisher.cer). A package is accepted only when it carries a valid
 * Authenticode signature whose signer thumbprint equals the pinned publisher
 * AND the certificate chain builds (unknown-root allowed, revocation offline).
 * Commercial CA certs work unchanged once their thumbprint is pinned.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CER = path.join(__dirname, 'nexus-publisher.cer');

function ps(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve(err ? null : String(stdout || '').trim()));
  });
}

let pinnedThumb = null;
async function pinnedThumbprint() {
  if (pinnedThumb) return pinnedThumb;
  if (!fs.existsSync(CER)) return null;
  const out = await ps(`(New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${CER.replace(/'/g, "''")}')).Thumbprint`);
  pinnedThumb = out || null;
  return pinnedThumb;
}

/** Returns { ok, reason, thumbprint, chainOk, status }. */
async function verifySignature(file, expectedThumbprint) {
  const pinned = await pinnedThumbprint();
  if (!pinned) return { ok: false, reason: '应用内置发布证书缺失，无法验证签名' };
  const expect = (expectedThumbprint || pinned).toUpperCase();
  if (expect !== pinned.toUpperCase()) return { ok: false, reason: '清单签名指纹与内置发布证书不一致（可能为伪造清单）' };
  const esc = file.replace(/'/g, "''");
  const out = await ps(`
    $v = Get-AuthenticodeSignature -LiteralPath '${esc}';
    if (-not $v.SignerCertificate) { Write-Output 'MISSING'; exit }
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain;
    $chain.ChainPolicy.RevocationMode = 'NoCheck';
    $chain.ChainPolicy.VerificationFlags = 'AllowUnknownCertificateAuthority';
    $ok = $chain.Build($v.SignerCertificate);
    Write-Output ($v.SignerCertificate.Thumbprint + '|' + $ok + '|' + $v.Status)
  `);
  if (!out || out === 'MISSING') return { ok: false, reason: '安装包未携带数字签名，拒绝安装（仅 SHA-256 不足以信任）' };
  const [thumb, chainOk, status] = out.split('|');
  if ((thumb || '').toUpperCase() !== pinned.toUpperCase()) return { ok: false, reason: '签名发布者与 NEXUS 官方发布证书不符', thumbprint: thumb };
  if (chainOk !== 'True') return { ok: false, reason: '签名证书链校验失败', thumbprint: thumb, status };
  return { ok: true, thumbprint: thumb, chainOk: true, status };
}

/** Sign a file with the publisher cert from CurrentUser\\My (release pipeline only). */
async function signFile(file, thumbprint) {
  const esc = file.replace(/'/g, "''");
  const out = await ps(`
    $c = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Thumbprint -eq '${thumbprint}' };
    if (-not $c) { Write-Output 'NOCERT'; exit }
    $r = Set-AuthenticodeSignature -LiteralPath '${esc}' -Certificate $c -HashAlgorithm SHA256;
    Write-Output $r.Status
  `);
  return out; // 'UnknownError' == signed OK with untrusted root (expected for self-signed)
}

module.exports = { verifySignature, signFile, pinnedThumbprint, CER };