// 数据中枢 — DATA VAULT (status / backup / restore / quality / logs).
import { icon } from '../icons.js';
import { el, esc, num, fx, fmtBytes, fmtTime, timeAgo, sourceTag, toast, confirmDialog } from '../util.js';
import { store, navigate } from '../store.js';

let _logs = [];

export async function render(root) {
  const [status, quality, backups, logs] = await Promise.all([
    window.nexus.vault.status(), window.nexus.vault.quality(), window.nexus.vault.backups(), window.nexus.vault.logs({}),
  ]);
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('vault', 26, 'accent')} 数据中枢 <span class="accent">VAULT</span></div>
      <div class="page-sub">本地数据库状态 · 备份 / 恢复 · 完整性与质量检查 · 采集日志 · 所有数据仅存本机</div>
    </div>

    <div class="grid grid-4 mb-4">
      <div class="stat-card">${icon('vault', 28, 'sc-icon')}<div class="sc-label">数据库容量</div><div class="sc-value num">${fmtBytes(status.sizeBytes)}</div><div class="sc-sub">${esc(status.dbFile)}</div></div>
      <div class="stat-card">${icon('shield', 28, 'sc-icon')}<div class="sc-label">完整性</div><div class="sc-value num" style="color:${status.integrity ? 'var(--green)' : 'var(--red)'}">${status.integrity ? 'OK' : '异常'}</div><div class="sc-sub">PRAGMA integrity_check</div></div>
      <div class="stat-card">${icon('chart', 28, 'sc-icon')}<div class="sc-label">质量检查</div><div class="sc-value num" style="color:${quality.healthy ? 'var(--green)' : 'var(--amber)'}">${quality.healthy ? '健康' : quality.errors + ' 错误'}</div><div class="sc-sub">${quality.warns} 项警告</div></div>
      <div class="stat-card">${icon('clock', 28, 'sc-icon')}<div class="sc-label">上次采集</div><div class="sc-value num" style="font-size:22px">${timeAgo(status.meta.fetchedAt)}</div><div class="sc-sub">版本 ${esc(status.meta.patch || '—')}</div></div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;align-items:start">
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">数据表概览</div>${sourceTag('local')}</div>
          <div id="vault-counts" class="flex-col gap-1"></div>
          <div class="divider"></div>
          <div class="flex gap-2">
            <button class="btn ghost sm" id="vault-refresh">${icon('sync', 14)} 更新数据</button>
            <button class="btn ghost sm" id="vault-export-db">${icon('download', 14)} 导出数据库</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">质量检查明细</div><button class="btn ghost sm" id="vault-recheck">重新检查</button></div>
          <div id="vault-quality" class="flex-col gap-2"></div>
        </div>
      </div>

      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">备份管理</div><button class="btn primary sm" id="vault-backup">${icon('save', 14)} 立即备份</button></div>
          <div class="fs-12 text-3 mb-3">备份目录：${esc(status.backupDir)} · 自动备份 ${store.config.autoBackup ? '开启' : '关闭'} · 保留 ${store.config.backupKeep} 份</div>
          <div id="vault-backups" class="flex-col gap-2" style="max-height:320px;overflow-y:auto"></div>
        </div>
      </div>
    </div>

    <div class="panel mt-4">
      <div class="panel-h"><div class="panel-title">采集日志</div>
        <div class="flex gap-2 items-center">
          <input class="nx-input" id="log-q" type="text" placeholder="搜索任务/来源/错误…" autocomplete="off" style="width:180px" />
          <select class="nx-select" id="log-filter"><option value="">全部状态</option><option value="ok">成功</option><option value="failed">失败</option></select>
          <button class="btn ghost sm" id="log-export">${icon('download', 14)} 导出日志</button>
        </div>
      </div>
      <div style="overflow-x:auto"><table class="nx-table"><thead><tr><th>任务</th><th>来源</th><th>开始</th><th>耗时</th><th>获取</th><th>成功/失败</th><th>状态</th><th>错误</th></tr></thead><tbody id="log-body"></tbody></table></div>
    </div>
  `;

  // counts
  const CN = { champions: '英雄', champion_stats: '强度统计', builds: '出装符文', items: '装备', runes: '符文', spells: '召唤师技能', favorites: '收藏', bp_saves: 'BP 方案', prep_saves: '对局准备', collection_logs: '采集日志', backups: '备份记录' };
  root.querySelector('#vault-counts').innerHTML = Object.entries(status.counts).map(([k, v]) => `<div class="flex justify-between fs-13"><span class="text-2">${CN[k] || k}</span><span class="num text-gold">${num(v)}</span></div>`).join('');

  drawQuality(root, quality);
  drawBackups(root, backups);
  drawLogs(root, logs);

  root.querySelector('#vault-refresh').addEventListener('click', () => window.__nexus.doRefresh());
  root.querySelector('#vault-export-db').addEventListener('click', async () => { try { const r = await window.nexus.vault.exportDb(); if (r.ok) toast('已导出：' + r.file, 'success'); else toast('导出失败：' + (r.__error || ''), 'error'); } catch (e) { toast('导出失败：' + e.message, 'error'); } });
  root.querySelector('#vault-recheck').addEventListener('click', async () => { try { const q = await window.nexus.vault.quality(); drawQuality(root, q); toast('质量检查完成', 'success'); } catch (e) { toast('质量检查失败：' + e.message, 'error'); } });
  root.querySelector('#vault-backup').addEventListener('click', async () => {
    try { const rec = await window.nexus.vault.backup('manual'); if (rec.__error) throw new Error(rec.__error); toast('备份完成：' + rec.file, 'success'); drawBackups(root, await window.nexus.vault.backups()); }
    catch (e) { toast('备份失败：' + e.message, 'error'); }
  });
  root.querySelector('#log-filter').addEventListener('change', async (e) => drawLogs(root, await window.nexus.vault.logs({ status: e.target.value })));
  root.querySelector('#log-q').addEventListener('input', () => drawLogs(root, _logs));
  root.querySelector('#log-export').addEventListener('click', async () => { try { const r = await window.nexus.vault.exportLogs(); if (r.ok) toast(`已导出 ${r.count} 条日志`, 'success'); else toast('导出失败：' + (r.__error || ''), 'error'); } catch (e) { toast('导出失败：' + e.message, 'error'); } });
  return {};
}

function drawQuality(root, q) {
  const node = root.querySelector('#vault-quality');
  if (!q.issues.length) { node.innerHTML = `<div class="flex items-center gap-2 text-green fs-13">${icon('check', 16)} 所有检查通过，数据健康。</div>`; return; }
  node.innerHTML = q.issues.map(i => `<div class="flex items-center gap-2 fs-13" style="padding:7px 10px;border-radius:var(--r-md);background:${i.level === 'error' ? 'var(--red-dim)' : 'var(--amber-dim)'}">
    ${icon(i.level === 'error' ? 'warn' : 'info', 15, i.level === 'error' ? 'text-red' : 'text-gold')}
    <span style="flex:1" class="text-2">${esc(i.message)}</span><span class="badge ${i.level === 'error' ? 'red' : 'amber'}">${i.count}</span></div>`).join('');
}

function drawBackups(root, backups) {
  const node = root.querySelector('#vault-backups');
  if (!backups.length) { node.innerHTML = '<div class="text-3 fs-13">暂无备份。点击「立即备份」创建第一份。</div>'; return; }
  node.innerHTML = '';
  for (const b of backups) {
    const row = el('div', { class: 'flex items-center gap-3', style: { padding: '9px 10px', border: '1px solid var(--line)', borderRadius: '9px' }, html: `
      ${icon('vault', 16, 'text-teal')}
      <div style="flex:1;min-width:0"><div class="fs-13 truncate">${esc(b.file)}</div><div class="fs-12 text-3">${fmtTime(b.createdAt)} · ${fmtBytes(b.sizeBytes)} · ${esc(b.kind)}</div></div>
      <span class="badge ${b.integrity === 'ok' ? 'green' : 'gray'}">${b.integrity === 'ok' ? '完整' : esc(b.integrity || '?')}</span>
      <button class="btn ghost sm bk-check">校验</button>
      <button class="btn ghost sm bk-restore">恢复</button>` });
    row.querySelector('.bk-check').addEventListener('click', async () => { const r = await window.nexus.vault.check(b.file); toast(r.ok ? '备份完整性校验通过' : '备份校验失败：' + (r.reason || ''), r.ok ? 'success' : 'error'); });
    row.querySelector('.bk-restore').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '恢复备份', message: `将从 <b>${esc(b.file)}</b> 恢复数据库。<br/><br/>恢复前会自动创建当前数据的快照（pre-restore），以便回滚。确定继续？`, confirmText: '恢复', danger: true });
      if (!ok) return;
      const r = await window.nexus.vault.restore(b.file);
      if (r.__error) toast('恢复失败：' + r.__error, 'error');
      else { toast('恢复成功，已创建快照 ' + r.snapshot, 'success'); setTimeout(() => window.__nexus.rerender(), 600); }
    });
    node.appendChild(row);
  }
}

function drawLogs(root, logs) {
  _logs = logs || [];
  const body = root.querySelector('#log-body');
  const q = (root.querySelector('#log-q') ? root.querySelector('#log-q').value : '').trim().toLowerCase();
  const rows = q ? _logs.filter(l => [l.task, l.source, l.error, l.status].join(' ').toLowerCase().includes(q)) : _logs;
  if (!rows.length) { body.innerHTML = `<tr><td colspan="8"><div class="text-3 fs-13" style="padding:16px">${q ? '无匹配「' + esc(q) + '」的日志' : '暂无采集日志'}</div></td></tr>`; return; }
  body.innerHTML = rows.slice(0, 100).map(l => `<tr style="cursor:default">
    <td>${esc(l.task)}</td><td class="fs-12 text-3">${esc(l.source)}</td><td class="fs-12 text-3">${fmtTime(l.startedAt)}</td>
    <td class="num">${l.durationMs != null ? fx(l.durationMs / 1000) + 's' : '—'}</td>
    <td class="num">${num(l.fetched)}</td><td class="num"><span class="text-green">${l.success}</span> / <span class="text-red">${l.failed}</span></td>
    <td><span class="badge ${l.status === 'ok' ? 'green' : 'red'}">${l.status === 'ok' ? '成功' : '失败'}</span></td>
    <td class="fs-12 text-3 truncate" style="max-width:200px" title="${esc(l.error || '')}">${esc(l.error || '—')}</td></tr>`).join('');
}