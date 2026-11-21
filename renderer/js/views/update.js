// 版本更新 — enterprise dual-channel update center (GitHub authoritative + Quark mirror + local).
import { icon } from '../icons.js';
import { esc, fmtTime, toast, confirmDialog, sourceTag } from '../util.js';
import { store } from '../store.js';

const LEVEL = { major: ['大版本 MAJOR', 'red'], minor: ['中版本 MINOR', 'gold'], patch: ['小版本 PATCH', 'teal'] };
const STAGE_TEXT = {
  idle: '尚未检查', checking: '正在检查更新…', available: '发现新版本', 'up-to-date': '当前已经是最新版本',
  downloading: '正在下载', verifying: '正在校验文件（SHA-256）', signing: '正在验证数字签名…', verified: '校验通过，可安全安装',
  preparing: '等待关闭程序 · 创建备份与回滚快照…', handoff: '已交由独立更新器安装…',
  'mirror-manual': '夸克镜像 · 需人工下载后选择文件', 'download-failed': '更新失败', 'check-failed': '更新源暂时不可用',
  unconfigured: '更新源尚未配置 · 等待接入', snoozed: '已稍后提醒', 'prepare-failed': '回滚快照创建失败',
};
const GH_STATE = { unknown: ['未探测', 'gray'], unconfigured: ['尚未配置 · 等待接入', 'gray'], ok: ['连接正常', 'green'], slow: ['速度偏慢', 'amber'], fail: ['不可达', 'red'] };

let st = null, hist = null, src = null, unsub = null;

export async function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('download', 26, 'accent')} 版本更新 <span class="accent">UPDATE</span></div>
      <div class="page-sub">GitHub 权威版本源 · 夸克国内镜像 · 本地兜底 · SHA-256 + 数字签名双重校验 · 独立更新器 · 失败自动回滚</div>
    </div>
    <div id="upd-body"></div>`;
  [st, hist, src] = await Promise.all([window.nexus.update.state(), window.nexus.update.history(), window.nexus.update.sources()]);
  draw(root);
  if (unsub) unsub();
  unsub = window.nexus.on('update-state', (s) => { st = s; draw(root); });
  return { onUpdateState: (s) => { st = s; draw(root); }, destroy: () => { if (unsub) { unsub(); unsub = null; } } };
}

function notesHtml(n) {
  if (!n) return '';
  const sec = (title, arr) => arr && arr.length ? `<div class="mb-3"><div class="section-title" style="font-size:13px">${title}</div><div class="fs-13 text-2" style="line-height:2">${arr.map(t => '· ' + esc(t)).join('<br/>')}</div></div>` : '';
  return sec('新增功能', n.added) + sec('功能优化', n.improved) + sec('问题修复', n.fixed) + sec('性能与稳定性', n.stability) +
    (n.compatibility && n.compatibility.length ? `<div class="mb-3"><div class="section-title" style="font-size:13px">重要兼容性提醒</div>${n.compatibility.map(t => `<div class="badge amber mb-1" style="white-space:normal;line-height:1.7;display:block">${esc(t)}</div>`).join('')}</div>` : '');
}

function chCard(name, iconName, stateBadge, lines, extra) {
  return `<div class="panel tight" style="flex:1;min-width:220px">
    <div class="panel-h"><div class="panel-title">${icon(iconName, 15)} ${name}</div>${stateBadge}</div>
    <div class="fs-12 text-2" style="line-height:1.9">${lines}</div>${extra || ''}
  </div>`;
}

function draw(root) {
  const body = root.querySelector('#upd-body');
  if (!body || !st) return;
  const m = st.latest;
  const lv = LEVEL[st.level || (m && m.level) || 'patch'] || LEVEL.patch;
  const busy = ['downloading', 'verifying', 'signing', 'preparing', 'handoff', 'checking'].includes(st.stage);
  const canInstall = st.downloaded && st.available && st.packaged && !busy;
  const cs = st.channels || {};
  const gh = cs.github || {};
  const ghs = GH_STATE[gh.state] || GH_STATE.unknown;
  const activeName = { github: 'GitHub', quark: '夸克镜像（人工）', local: '本地发布目录', 'local-file': '本地文件（人工选择）' }[st.channel] || '—';
  const speed = st.speedKBs ? (st.speedKBs >= 1024 ? (st.speedKBs / 1024).toFixed(1) + ' MB/s' : st.speedKBs + ' KB/s') : '';

  body.innerHTML = `
    <div class="flex gap-3 mb-4" style="flex-wrap:wrap">
      ${chCard('GitHub 主更新源', 'external', `<span class="badge ${ghs[1]}">${ghs[0]}</span>`,
        `仓库：${esc(src.github.repo || '尚未配置')}<br/>${gh.state === 'unconfigured' ? '创建仓库后在下方填写 owner/repo 即可接通，无需其他改动。<br/>' : ''}${gh.latencyMs != null ? '探测延迟 ' + gh.latencyMs + ' ms' : ''}${gh.speedKBs != null ? ' · 测速 ' + gh.speedKBs + ' KB/s' : ''}${gh.error ? '<br/><span class="text-red">' + esc(gh.error) + '</span>' : ''}<br/>版本信息权威来源 · Releases API`)}
      ${chCard('夸克网盘镜像', 'download', cs.quark && cs.quark.configured ? '<span class="badge teal">已配置</span>' : '<span class="badge gray">尚未配置 · 等待接入</span>',
        `国内下载镜像 · 人工下载后自动校验<br/>${cs.quark && cs.quark.configured ? '分享链接已配置' + (src.quark.shareCode ? ' · 提取码已配置' : '') : '上传安装包并获取分享链接后，在下方填写即可接通'}<br/><span class="text-3">夸克无稳定免人工直链，不模拟登录/不破解</span>`)}
      ${chCard('本地发布目录', 'vault', cs.local && cs.local.ok ? '<span class="badge green">有清单</span>' : '<span class="badge gray">无清单</span>',
        `离线兜底 · 开发/内网发布<br/><span class="text-3 truncate" style="display:block;max-width:260px" title="${esc(src.local.path || '')}">${esc(src.local.path || '')}</span>`)}
      ${chCard('当前下载渠道', 'sync', `<span class="badge gold">${esc(activeName)}</span>`,
        `清单来源：${{ github: 'GitHub Releases', cache: '上次缓存（GitHub 暂不可达）', local: '本地目录' }[cs.manifestSource] || '—'}${st.cached ? '<br/><span class="text-gold">正在使用缓存清单，非实时</span>' : ''}<br/>自动切换：${src.autoSwitch ? '开' : '关'} · 重试 ${src.retries} 次`)}
    </div>

    <div class="grid" style="grid-template-columns:1.2fr 1fr;gap:16px;align-items:start">
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">版本与状态</div>${sourceTag('local')}</div>
          <div class="grid grid-2 mb-3">
            <div><div class="fs-12 text-3 mb-1">当前版本</div><div class="num fw-6 fs-20">v${esc(st.current)}</div><div class="fs-12 text-3 mt-1">${st.packaged ? '正式安装版' : '开发模式（可检测/校验，不自动安装）'}</div></div>
            <div><div class="fs-12 text-3 mb-1">最新正式版本</div><div class="num fw-6 fs-20 ${st.available ? 'text-gold' : ''}">${m ? 'v' + esc(m.version) : '—'}</div>
              <div class="mt-1">${m ? `<span class="badge ${lv[1]}">${lv[0]}</span> <span class="fs-12 text-3">${esc(m.date || '')}</span>` : ''}</div></div>
          </div>
          ${m && m.title ? `<div class="fw-6 fs-15 mb-2 text-gold">${esc(m.title)}</div>` : ''}
          <div class="flex items-center gap-2 mb-2"><span class="lcu-dot ${st.available ? 'warn' : st.error ? '' : 'on'}"></span><span class="fs-13 fw-6">${esc(STAGE_TEXT[st.stage] || st.stage)}</span>${speed ? `<span class="badge teal">${speed}</span>` : ''}${st.resumed && st.stage === 'downloading' ? '<span class="badge gold">断点续传</span>' : ''}</div>
          ${busy || st.stage === 'verified' ? `<div class="bar-track mb-2"><div class="bar-fill gold" style="width:${st.percent || 0}%"></div></div><div class="fs-12 text-3 mb-2">${st.total ? (st.bytes / 1048576).toFixed(1) + ' / ' + (st.total / 1048576).toFixed(1) + ' MB · ' : ''}${st.percent || 0}%</div>` : ''}
          ${st.error ? `<div class="badge red mb-2" style="white-space:normal;line-height:1.7;display:block">${esc(st.error)}</div>` : ''}
          ${st.stage === 'mirror-manual' && st.mirror ? `<div class="panel tight mb-3" style="border-color:var(--gold)">
            <div class="fw-6 fs-13 text-gold mb-2">夸克镜像下载指引</div>
            <div class="fs-12 text-2" style="line-height:1.9">1. 打开夸克分享链接${st.mirror.shareCode ? '，输入提取码 <b class="num">' + esc(st.mirror.shareCode) + '</b>' : ''}；<br/>2. 下载 <b>${esc(st.mirror.file || (m ? m.file : ''))}</b>（v${esc(st.mirror.version || (m ? m.version : ''))}）到本机任意位置；<br/>3. 点击下方「选择本地安装包」，NEXUS 将自动做 SHA-256 与数字签名校验后安装。</div>
            ${st.mirror.sha256 ? `<div class="fs-11 text-3 mt-1 num" style="word-break:break-all">官方 SHA-256：${esc(st.mirror.sha256)}</div>` : ''}
            <div class="flex gap-2 mt-2"><button class="btn ghost sm" id="upd-open-quark">${icon('external', 13)} 打开夸克分享页</button>
            <button class="btn primary sm" id="upd-pick">${icon('upload', 13)} 选择本地安装包</button></div>
          </div>` : ''}
          <div class="flex gap-2" style="flex-wrap:wrap">
            <button class="btn ghost sm" id="upd-check" ${busy ? 'disabled' : ''}>${icon('sync', 14)} 手动检查更新</button>
            ${st.available && !st.downloaded && st.stage !== 'mirror-manual' ? `<button class="btn primary sm" id="upd-dl" ${busy ? 'disabled' : ''}>${icon('download', 14)} 下载更新</button>` : ''}
            ${st.stage === 'downloading' ? `<button class="btn ghost sm" id="upd-cancel">${icon('close', 14)} 取消下载</button>` : ''}
            ${st.available && !st.downloaded ? `<button class="btn ghost sm" id="upd-pick2">${icon('upload', 14)} 选择本地安装包</button>` : ''}
            ${canInstall ? `<button class="btn primary sm" id="upd-install">${icon('bolt', 14)} 立即更新</button>` : ''}
            ${st.available ? `<button class="btn ghost sm" id="upd-later" ${busy ? 'disabled' : ''}>稍后更新</button>` : ''}
          </div>
          <div class="fs-12 text-3 mt-3" style="line-height:1.7">检测时间：${st.lastCheckAt ? fmtTime(st.lastCheckAt) : '从未'} · 升级由独立更新进程执行（等待退出→静默安装→版本校验→启动新版），失败自动回滚旧版本。英雄收藏、配置、对局历史、本地数据库与自定义设置保存在独立用户目录，升级完整保留。</div>
        </div>

        <div class="panel">
          <div class="panel-h"><div class="panel-title">更新策略与渠道配置</div></div>
          <div class="grid grid-2">
            <div class="field mb-2"><label>GitHub 仓库（owner/repo）</label><input class="nx-input" id="src-repo" value="${esc(src.github.repo || '')}" placeholder="例如 sail/nexus"/></div>
            <div class="field mb-2"><label>GitHub API 地址</label><input class="nx-input" id="src-api" value="${esc(src.github.apiBase || 'https://api.github.com')}"/></div>
            <div class="field mb-2"><label>夸克分享链接</label><input class="nx-input" id="src-quark" value="${esc(src.quark.shareUrl || '')}" placeholder="https://pan.quark.cn/s/…"/></div>
            <div class="field mb-2"><label>夸克提取码</label><input class="nx-input" id="src-code" value="${esc(src.quark.shareCode || '')}" placeholder="无则留空"/></div>
            <div class="field mb-2"><label>默认下载渠道</label><select class="nx-select" id="src-default">
              <option value="auto" ${src.defaultChannel === 'auto' ? 'selected' : ''}>智能自动切换</option>
              <option value="github" ${src.defaultChannel === 'github' ? 'selected' : ''}>仅 GitHub</option>
              <option value="quark" ${src.defaultChannel === 'quark' ? 'selected' : ''}>夸克镜像（人工）</option>
              <option value="local" ${src.defaultChannel === 'local' ? 'selected' : ''}>本地发布目录</option>
            </select></div>
            <div class="field mb-2"><label>下载失败重试次数</label><input class="nx-input" type="number" min="0" max="5" id="src-retries" value="${src.retries}"/></div>
          </div>
          <div class="flex items-center justify-between mb-2"><div class="fs-13">启动时自动检查</div><div class="toggle ${store.config.autoCheckUpdate !== false ? 'on' : ''}" id="src-autocheck"><div class="track"></div></div></div>
          <div class="flex items-center justify-between mb-2"><div class="fs-13">GitHub 受阻时自动切换镜像</div><div class="toggle ${src.autoSwitch ? 'on' : ''}" id="src-switch"><div class="track"></div></div></div>
          <div class="flex items-center justify-between mb-3"><div class="fs-13">显示预发布版本（GitHub prerelease）</div><div class="toggle ${src.showPrerelease ? 'on' : ''}" id="src-pre"><div class="track"></div></div></div>
          <button class="btn primary sm" id="src-save">${icon('save', 14)} 保存全部配置</button>
          <div class="fs-12 text-3 mt-3" style="line-height:1.7">安全：仅 HTTPS；清单产品标识必须为 NEXUS；SHA-256 逐字节校验；Authenticode 数字签名 + 内置发布证书指纹双重验证（安装前二次复核）；校验失败一律删除拒装；相同版本不重复下载；来源不明安装包拒绝。</div>
        </div>
      </div>

      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">${m ? 'v' + esc(m.version) + ' 更新公告' : '更新公告'}</div>${m ? `<span class="badge ${lv[1]}">${lv[0]}</span>` : ''}</div>
          ${m ? (m.body ? `<div class="fs-13 text-2 mb-3" style="line-height:1.9">${esc(m.body)}</div>` : '') + notesHtml(m.notes) : '<div class="empty-state">' + icon('book', 40) + '<div class="es-title">暂无可用更新公告</div><div>点击「手动检查更新」从 GitHub 获取权威版本信息。</div></div>'}
        </div>
        ${st.prereleases && st.prereleases.length ? `<div class="panel tight"><div class="panel-h"><div class="panel-title">预发布版本</div><span class="badge purple">prerelease</span></div>
          ${st.prereleases.map(p => `<div class="flex items-center gap-2 fs-12 mb-1"><span class="num">v${esc(p.version)}</span><span class="text-3" style="flex:1">${esc(p.title || '')}</span><span class="text-3">${esc(p.date || '')}</span></div>`).join('')}
          <div class="fs-12 text-3 mt-1">预发布仅供测试，不参与自动升级。</div></div>` : ''}
        <div class="panel">
          <div class="panel-h"><div class="panel-title">历史版本</div></div>
          <div id="upd-hist" class="flex-col gap-1" style="max-height:280px;overflow-y:auto"></div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">本机升级记录</div></div>
          <div id="upd-attempts" class="flex-col gap-1"></div>
        </div>
      </div>
    </div>`;

  // actions
  body.querySelector('#upd-check').addEventListener('click', () => window.nexus.update.check());
  const dl = body.querySelector('#upd-dl');
  if (dl) dl.addEventListener('click', async () => { try { const r = await window.nexus.update.download(); if (r.manual) toast('已切换夸克镜像：请按指引下载后选择本地文件', 'info', 6000); else toast('下载并校验完成（SHA-256 + 数字签名）', 'success'); } catch (e) { toast(String(e.message || e), 'error', 6000); } });
  const cancel = body.querySelector('#upd-cancel');
  if (cancel) cancel.addEventListener('click', async () => { await window.nexus.update.cancelDownload(); toast('已取消下载，进度已保留，可断点续传', 'info'); });
  const pick = async () => { try { const r = await window.nexus.update.pickLocalFile(); if (r.canceled) return; toast('本地安装包校验通过', 'success'); } catch (e) { toast(String(e.message || e), 'error', 7000); } };
  const p1 = body.querySelector('#upd-pick'); if (p1) p1.addEventListener('click', pick);
  const p2 = body.querySelector('#upd-pick2'); if (p2) p2.addEventListener('click', pick);
  const oq = body.querySelector('#upd-open-quark'); if (oq) oq.addEventListener('click', () => window.nexus.shell.open(st.mirror.shareUrl));
  const inst = body.querySelector('#upd-install');
  if (inst) inst.addEventListener('click', async () => {
    const isMajor = (st.level || (m && m.level)) === 'major';
    const ok = await confirmDialog({
      title: '确认升级到 v' + m.version + '（' + lv[0] + '）',
      message: (isMajor ? '<b class="text-gold">大版本更新：</b>可能包含数据迁移或兼容性变化，请先阅读兼容性提醒。<br/><br/>' : '') +
        'NEXUS 将关闭并由独立更新器安装；升级前自动备份数据库并创建旧版本回滚快照，失败自动恢复。你的收藏、配置、对局历史与本地数据库完整保留。',
      confirmText: '备份并立即更新',
    });
    if (!ok) return;
    try { await window.nexus.update.install({ confirmed: true, backupFirst: true }); } catch (e) { toast(String(e.message || e), 'error', 6000); }
  });
  const later = body.querySelector('#upd-later');
  if (later) later.addEventListener('click', async () => { await window.nexus.update.snooze(24); toast('已推迟 24 小时提醒', 'info'); });

  // config
  const tog = (id, fn) => body.querySelector(id).addEventListener('click', (e) => { const t = e.currentTarget; const now = !t.classList.contains('on'); t.classList.toggle('on', now); fn(now); });
  tog('#src-autocheck', async (v) => { await window.nexus.config.set('autoCheckUpdate', v); store.config.autoCheckUpdate = v; });
  tog('#src-switch', (v) => { src.autoSwitch = v; });
  tog('#src-pre', (v) => { src.showPrerelease = v; });
  body.querySelector('#src-save').addEventListener('click', async () => {
    const patch = {
      github: { repo: body.querySelector('#src-repo').value.trim(), apiBase: body.querySelector('#src-api').value.trim() || 'https://api.github.com' },
      quark: { shareUrl: body.querySelector('#src-quark').value.trim(), shareCode: body.querySelector('#src-code').value.trim() },
      defaultChannel: body.querySelector('#src-default').value,
      autoSwitch: src.autoSwitch, showPrerelease: src.showPrerelease,
      retries: Math.max(0, Math.min(5, parseInt(body.querySelector('#src-retries').value, 10) || 0)),
    };
    if (patch.quark.shareUrl && !/^https:\/\//i.test(patch.quark.shareUrl)) { toast('夸克分享链接必须以 https:// 开头', 'error'); return; }
    src = await window.nexus.update.setSources(patch);
    toast('配置已持久化保存', 'success');
    await window.nexus.update.check();
  });

  // history
  const hw = body.querySelector('#upd-hist');
  const rels = (hist && hist.releases) || [];
  hw.innerHTML = rels.length ? rels.slice(0, 20).map((r, i) => `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:7px 10px">
    <div class="flex items-center gap-2 fs-12" data-hist="${i}" style="cursor:pointer">
      <span class="num fw-6">v${esc(r.version)}</span>${r.level ? `<span class="badge ${(LEVEL[r.level] || LEVEL.patch)[1]}" style="font-size:11px">${(LEVEL[r.level] || LEVEL.patch)[0].split(' ')[0]}</span>` : ''}${r.prerelease ? '<span class="badge purple" style="font-size:11px">预发布</span>' : ''}
      <span class="text-3" style="flex:1">${esc(r.date || '')}</span>${icon('chevronDown', 12)}
    </div>
    <div class="hidden fs-12 text-2 mt-2" data-hist-body="${i}" style="line-height:1.8">${esc(r.title || '')}${r.htmlUrl ? `<br/><a href="#" data-rel="${esc(r.htmlUrl)}" class="text-teal">GitHub Release 页面</a>` : ''}${notesHtml(r.notes)}</div>
  </div>`).join('') : '<div class="fs-12 text-3">暂无历史记录（配置 GitHub 仓库后自动拉取 Releases 历史）。</div>';
  hw.querySelectorAll('[data-hist]').forEach(n => n.addEventListener('click', () => { const b = hw.querySelector(`[data-hist-body="${n.dataset.hist}"]`); if (b) b.classList.toggle('hidden'); }));
  hw.querySelectorAll('[data-rel]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); window.nexus.shell.open(a.dataset.rel); }));
  const aw = body.querySelector('#upd-attempts');
  const att = (hist && hist.attempts) || [];
  aw.innerHTML = att.length ? att.slice(0, 10).map(a => `<div class="flex items-center gap-2 fs-12 mb-1">
    <span class="badge ${a.result === 'success' ? 'green' : a.result === 'rollback' ? 'amber' : 'red'}" style="font-size:11px">${a.result === 'success' ? '成功' : a.result === 'rollback' ? '已回滚' : '失败'}</span>
    <span class="num">${esc(a.from)} → ${esc(a.to)}</span><span class="text-3" style="flex:1">${a.at ? fmtTime(a.at) : ''}</span>
    ${a.detail ? `<span class="text-3 truncate" style="max-width:160px" title="${esc(a.detail)}">${esc(a.detail)}</span>` : ''}</div>`).join('')
    : '<div class="fs-12 text-3">本机尚无升级记录。</div>';
}