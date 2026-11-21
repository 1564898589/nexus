// 国服玩家战绩查询中心 — 双通道架构（独立 WeGame + 本地 LCU/SGP）。
// 页面不依赖客户端连接：无客户端时独立通道/缓存/收藏/历史全部可用。
import { icon } from '../icons.js';
import { el, esc, pct, fx, num, asset, fmtTime, timeAgo, sourceTag, toast, modal, confirmDialog, POS_CN } from '../util.js';
import { store, navigate } from '../store.js';
import { aiBlock, bindAi, modeFilterRow, inMode, modeCat } from './intel-common.js';

const RANK_CN = { IRON: '黑铁', BRONZE: '青铜', SILVER: '白银', GOLD: '黄金', PLATINUM: '铂金', EMERALD: '翡翠', DIAMOND: '钻石', MASTER: '大师', GRANDMASTER: '宗师', CHALLENGER: '王者' };
const GRADE_COLOR = { S: 'var(--t1)', A: 'var(--teal)', B: 'var(--blue)', C: 'var(--purple)', D: 'var(--red)' };
const KIND_CN = {
  'not-found': ['账号不存在', 'red'], 'unavailable': ['数据源不可用', 'amber'], 'permission': ['权限不足', 'red'],
  'rate-limit': ['接口限流', 'amber'], 'network': ['网络错误', 'amber'], 'login-required': ['需要登录态', 'purple'],
  'needs-verification': ['待实测验证', 'purple'], 'region-mismatch': ['大区不匹配', 'amber'], 'shape-mismatch': ['响应形状不符', 'amber'],
  'riot-id-required': ['需昵称#标签', 'amber'],
};
let curPuuid = null, matchCount = 20, regionMap = {};

function champBy(id) { return store.champions.find(c => c.id === id) || null; }
function gradeBadge(rating, lg = false) {
  if (!rating || !rating.grade) return '<span class="badge gray">暂无法评级</span>';
  const g = rating.grade;
  return `<span class="tier-badge" style="background:${GRADE_COLOR[g]};${lg ? 'width:48px;height:48px;font-size:22px' : 'width:30px;height:30px;font-size:14px'}" title="${esc(rating.label)}">${g}</span>`;
}
function regionName(id) { return id ? (regionMap[String(id).toUpperCase()] || id) : '未知大区'; }
function kindBadge(kind) { const [t, c] = KIND_CN[kind] || ['查询失败', 'red']; return `<span class="badge ${c}">${t}</span>`; }
function loadingPanel(text) {
  return `<div class="panel"><div class="flex items-center gap-3" style="padding:8px 0"><span class="nx-spin"></span><span class="fs-13 text-2">${esc(text)}</span></div><div class="skeleton mt-3" style="height:140px"></div></div>`;
}

export async function render(root, params) {
  const [ch, regions, recent, favs, hist] = await Promise.all([
    window.nexus.player.channels(), window.nexus.player.regions(),
    window.nexus.player.recent(), window.nexus.player.favorites(), window.nexus.player.searchHistory(12),
  ]);
  regionMap = {};
  for (const r of [...regions.tencent, ...regions.riot]) regionMap[r.id] = r.name;
  const cnOpts = regions.tencent.filter(r => !r.test).map(r => `<option value="${r.id}">${esc(r.name)}（${r.id}）</option>`).join('');
  const testOpts = regions.tencent.filter(r => r.test).map(r => `<option value="${r.id}">${esc(r.name)}（${r.id}）</option>`).join('');
  const riotOpts = regions.riot.map(r => `<option value="${r.id}">${esc(r.name)}（${r.id}）</option>`).join('');
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('champion', 26, 'accent')} 玩家战绩中心 <span class="accent">PLAYER</span></div>
      <div class="page-sub">国服真实战绩查询 · 双通道：独立 WeGame（无需游戏客户端）+ 本地 LCU/SGP · 只读 · 不伪造任何战绩</div>
    </div>
    <div class="grid mb-4" style="grid-template-columns:1fr 1fr;gap:16px" id="player-channels"></div>
    <div class="panel mb-4">
      <div class="flex items-center gap-3" style="flex-wrap:wrap">
        <div class="search-box" style="width:280px;flex:1">${icon('search', 16)}<input id="player-search" placeholder="昵称#标签（国服）或召唤师名称…"/></div>
        <select class="nx-select" id="player-region" style="width:200px" title="选择目标大区；自动=独立通道不限大区，客户端通道限当前登录大区">
          <option value="auto">大区：自动</option>
          <optgroup label="国服">${cnOpts}</optgroup>
          <optgroup label="国服体验服">${testOpts}</optgroup>
          <optgroup label="直营服（SGP 实验性）">${riotOpts}</optgroup>
        </select>
        <button class="btn primary" id="player-go">${icon('search', 15)} 智能查询</button>
      </div>
      <div class="fs-12 text-3 mt-2">国服客户端通道需完整 Riot ID：<b>昵称#标签</b>（如 超级会对线搞心态#42936，标签在客户端「个人资料」页可见）；独立通道按 WeGame 实测范围支持昵称搜索。身份确认规则：名称 + 大区 + 唯一标识综合判定；同名候选必须由你选择，NEXUS 不会自动关联账号。客户端通道的名称搜索仅限其当前登录大区。</div>
      <div id="player-hist" class="flex gap-2 mt-3" style="flex-wrap:wrap"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 300px;gap:16px;align-items:start">
      <div id="player-main"></div>
      <div class="flex-col gap-4">
        <div class="panel tight"><div class="panel-h"><div class="panel-title">最近查询</div></div><div id="player-recent" class="flex-col gap-1"></div></div>
        <div class="panel tight"><div class="panel-h"><div class="panel-title">收藏玩家</div></div><div id="player-favs" class="flex-col gap-1"></div></div>
      </div>
    </div>
  `;
  drawChannels(root, ch);
  drawRecent(root, recent);
  drawFavs(root, favs);
  drawHistChips(root, hist);

  const doSearch = async () => {
    const name = root.querySelector('#player-search').value.trim();
    if (!name) { toast('请输入召唤师名称', 'info'); return; }
    const sel = root.querySelector('#player-region').value;
    const serverId = sel === 'auto' ? null : sel;
    const main = root.querySelector('#player-main');
    main.innerHTML = loadingPanel(`正在查询「${name}」${serverId ? ' · ' + regionName(serverId) : ''}…（依次尝试可用通道）`);
    let r;
    try { r = await window.nexus.player.search(name, { serverId }); }
    catch (e) { r = { state: 'error', kind: 'unavailable', message: String(e.message || e) }; }
    if (r.state === 'ok') {
      curPuuid = r.player.puuid;
      await drawProfile(root, curPuuid, true);
      drawRecent(root, await window.nexus.player.recent());
      toast(`查询成功（${r.channel === 'wegame' ? '独立通道' : '客户端通道'}）`, 'success');
    } else if (r.state === 'candidates') {
      main.innerHTML = `<div class="panel"><div class="empty-state">${icon('champion', 44)}<div class="es-title">找到 ${r.players.length} 个候选玩家</div><div>请在弹出列表中选择身份。</div></div></div>`;
      openCandidates(root, r.players);
    } else {
      const lines = String(r.message || '').split('\n').map(l => `<div class="fs-12 text-2" style="line-height:1.8">${esc(l)}</div>`).join('');
      const extra = r.kind === 'riot-id-required' ? '国服请改用「昵称#标签」格式重试：打开英雄联盟客户端 → 点自己头像进入个人资料，昵称后面 # 开头的数字就是标签。' : '账号不存在请核对名称与大区；需要登录态可连接独立通道或启动并登录客户端；限流请稍后再试。';
      main.innerHTML = `<div class="panel"><div class="flex items-center gap-2 mb-3">${kindBadge(r.kind)}<span class="fw-6">查询失败</span></div>${lines}
        <div class="fs-12 text-3 mt-3">提示：${extra}本地缓存与收藏不受影响。</div></div>`;
    }
    drawHistChips(root, await window.nexus.player.searchHistory(12));
  };
  root.querySelector('#player-go').addEventListener('click', doSearch);
  root.querySelector('#player-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  if (params.puuid) { curPuuid = params.puuid; await drawProfile(root, curPuuid, true); }
  else if (curPuuid) { await drawProfile(root, curPuuid, false); }
  else {
    // 已设为自己/情报默认账号时，进入战绩中心直接展示本人缓存战绩（连接客户端后点刷新拉真实历史）
    const cfg = await window.nexus.config.get().catch(() => ({}));
    const self = cfg && (cfg.selfPuuid || cfg.intelPuuid);
    if (self) { curPuuid = self; await drawProfile(root, curPuuid, false); }
    else root.querySelector('#player-main').innerHTML = `<div class="panel"><div class="empty-state">${icon('champion', 48)}<div class="es-title">查询一名召唤师</div><div>输入名称并选择大区开始查询。无需启动游戏客户端：连接独立通道后即可查询；已缓存的玩家可随时离线浏览。</div></div></div>`;
  }
  return {};
}

// ---- 双通道状态卡片 ----
function drawChannels(root, ch) {
  const node = root.querySelector('#player-channels');
  const lcu = ch.lcu, wg = ch.wegame;
  const lcuState = lcu.loggedIn ? ['on', `已连接并登录${lcu.tencent ? '国服' : '客户端'} · ${lcu.platformId || '未知大区'}`] : lcu.connected ? ['warn', '客户端已连接，但未登录'] : ['off', '未检测到客户端（不影响独立通道）'];
  node.innerHTML = `
    <div class="panel tight" id="ch-lcu">
      <div class="flex items-center gap-2 mb-2"><span class="lcu-dot ${lcuState[0]}"></span><span class="fw-6 fs-13">通道 B · 本地客户端（LCU + SGP）</span>${lcu.loggedIn ? sourceTag('lcu') : ''}</div>
      <div class="fs-12 text-2 mb-2">${esc(lcuState[1])}</div>
      <div class="fs-12 text-3 mb-3" style="line-height:1.7">${esc(ch.sgp.note)} 名称搜索限当前登录大区；SGP 支持深分页与实验性跨区。</div>
      <button class="btn ghost sm" id="ch-lcu-btn">${icon('sync', 14)} ${lcu.loggedIn ? '重新检测' : '立即检测客户端'}</button>
    </div>
    <div class="panel tight" id="ch-wg">
      <div class="flex items-center gap-2 mb-2"><span class="lcu-dot ${wg.verified ? 'on' : wg.connected ? 'warn' : 'off'}"></span><span class="fw-6 fs-13">通道 A · 独立查询（WeGame）</span>${wg.verified ? '<span class="badge green">已实测验证</span>' : wg.connected ? '<span class="badge amber">待验证</span>' : '<span class="badge gray">未连接</span>'}</div>
      <div class="fs-12 text-3 mb-3" style="line-height:1.7">${esc(wg.limitation)}</div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        ${wg.connected ? '' : `<button class="btn primary sm" id="ch-wg-connect">${icon('check', 14)} 连接我的 WeGame</button>`}
        ${wg.connected && !wg.verified ? `<button class="btn primary sm" id="ch-wg-verify">${icon('check', 14)} 实测验证</button>` : ''}
        ${wg.verified ? `<button class="btn ghost sm" id="ch-wg-verify">${icon('sync', 14)} 重新验证</button>` : ''}
        ${wg.connected ? `<button class="btn ghost sm" id="ch-wg-replace">${icon('sync', 14)} 更换凭证</button>` : ''}
        ${wg.connected ? `<button class="btn ghost sm" id="ch-wg-disc">${icon('close', 14)} 断开</button>` : ''}
      </div>
      ${wg.connected && !wg.verified ? `<div class="fs-12 text-gold mt-2" style="line-height:1.7">还没验证通过？先点「实测验证」。若反复失败，多半是凭证只复制了一小段——点「更换凭证」，用教程里的<b>方法 A（复制整段 cURL）</b>重来。</div>` : ''}
      ${wg.verifiedAt ? `<div class="fs-12 text-3 mt-2">验证时间：${fmtTime(wg.verifiedAt)}${wg.fieldCount ? ' · ' + wg.fieldCount + ' 个凭证字段' : ''}${wg.secure ? ' · Cookie 已 DPAPI 加密' : ' · 警告：系统加密不可用，Cookie 以明文存储'}</div>` : ''}
    </div>`;
  node.querySelector('#ch-lcu-btn').addEventListener('click', async () => {
    const ok = await window.nexus.lcu.connect();
    toast(ok ? '已尝试连接' : '未检测到客户端', ok ? 'success' : 'info');
    setTimeout(async () => drawChannels(root, await window.nexus.player.channels()), 800);
  });
  const c = node.querySelector('#ch-wg-connect'); if (c) c.addEventListener('click', () => openWegameConnect(root));
  const rp = node.querySelector('#ch-wg-replace'); if (rp) rp.addEventListener('click', () => openWegameConnect(root));
  const v = node.querySelector('#ch-wg-verify'); if (v) v.addEventListener('click', () => doWegameVerify(root));
  const d = node.querySelector('#ch-wg-disc'); if (d) d.addEventListener('click', async () => { await window.nexus.player.wegameDisconnect(); toast('已断开独立通道并清除会话', 'success'); drawChannels(root, await window.nexus.player.channels()); });
}

const WG_FORMAT_LABEL = { raw: '原始 Cookie 值', header: 'Cookie 请求头', curl: 'cURL 命令（已自动提取）', json: 'DevTools JSON（已自动拼接）' };

function openWegameConnect(root) {
  const m = modal({
    title: '连接独立通道 · WeGame',
    body: `<div class="fs-13 text-2" style="line-height:1.8">
      <div class="mb-3">这条通道用<b>你自己的 WeGame 登录态</b>查战绩，不用开游戏客户端。NEXUS 不替你登录、不碰你的密码，只需要一段登录凭证（Cookie）。<b>照着下面三步做，粘贴后会自动检查格式对不对。</b></div>
      <div class="wg-step"><span class="wg-num">1</span><div style="flex:1"><div class="fw-6 fs-13">登录 WeGame 网页</div><div class="fs-12 text-3 mt-1">点右边按钮打开官网，用你的 QQ/微信登录。<b>一定要先登录成功</b>，再做第 2 步。</div></div><button class="btn primary sm" id="wg-open">${icon('external', 14)} 打开登录页</button></div>
      <div class="wg-step"><span class="wg-num">2</span><div style="flex:1"><div class="fw-6 fs-13">复制登录凭证（推荐方法 A，最不容易出错）</div>
        <div class="fs-12 text-3 mt-1" style="line-height:1.9">在刚登录的 WeGame 页面：</div>
        <div class="wg-method"><div class="fw-6 fs-12 text-teal">方法 A · 复制整段 cURL（推荐）</div>
          <div class="fs-12 text-3 mt-1" style="line-height:1.9">① 按 <b>F12</b>（笔记本可能是 Fn+F12）打开开发者工具<br/>② 点顶部 <b>Network</b>（网络）标签，按 <b>F5</b> 刷新页面<br/>③ 左侧列表里<b>右键第一个请求</b>（名字通常是 www.wegame.com.cn）<br/>④ 选 <b>Copy</b> → <b>Copy as cURL (bash)</b><br/>⑤ 回到这里点「从剪贴板粘贴」——NEXUS 会自动从里面提取 Cookie，不用你手动找</div></div>
        <details class="mt-2"><summary class="fs-12 text-2" style="cursor:pointer">方法 B · 只复制 Cookie 值（备选）</summary>
          <div class="fs-12 text-3 mt-2" style="line-height:1.9">① F12 → <b>Network</b> → F5 刷新<br/>② 点第一个请求 → 右侧 <b>Headers</b>（标头）→ 往下找到 <b>Request Headers</b> 里的 <b>Cookie:</b> 一行<br/>③ <b>右键那一行 → Copy value</b>（复制值）。<span class="text-gold">注意：不要用双击选词，那样只会复制到一小段。</span></div>
        </details>
        <details class="mt-2"><summary class="fs-12 text-2" style="cursor:pointer">Cookie 长什么样？看示例</summary>
          <div class="fs-12 text-3 mt-2" style="line-height:1.8">它是一长串「<b>名字=值</b>」，很多组用 <b>; </b>（分号+空格）隔开，通常有几百到上千个字符。下面只是<b>示意格式，不是真实凭证</b>：</div>
          <div class="wg-example num">abc=1234567890; def=AbCdEfGh123; ghi=9876543210; jkl=xYz…（后面还有很多组）</div>
          <div class="fs-12 text-3 mt-2" style="line-height:1.8">如果你只复制到 <span class="num">Cookie:</span> 这个词、一个网址、或短短一小段，说明选错了位置——用<b>方法 A</b> 重来最稳妥。</div>
        </details>
      </div></div>
      <div class="wg-step"><span class="wg-num">3</span><div style="flex:1"><div class="fw-6 fs-13">粘贴到 NEXUS，自动检查</div><div class="fs-12 text-3 mt-1">点「从剪贴板粘贴」，或手动 Ctrl+V 到下方框。粘贴后会立刻告诉你格式对不对。</div></div><button class="btn ghost sm" id="wg-paste">${icon('check', 14)} 从剪贴板粘贴</button></div>
      <textarea id="wg-cookie" rows="4" style="width:100%;background:var(--panel-3);border:1px solid var(--line-strong);border-radius:var(--r-md);color:var(--t1);padding:10px;font-size:12px;font-family:var(--font-num)" placeholder="把复制到的 cURL 或 Cookie 值粘贴到这里…" autocomplete="off" spellcheck="false"></textarea>
      <div id="wg-feedback" class="fs-12 mt-2" style="line-height:1.7;min-height:20px"></div>
      <div class="fs-12 text-3 mt-2">安全说明：Cookie 经 Windows DPAPI 加密后仅存于本机，绝不上传、不写日志；随时可「断开」清除。保存后 NEXUS 会用真实请求实测验证，通过才启用查询。</div>
    </div>`,
    wide: true,
  });
  const foot = document.createElement('div');
  foot.className = 'flex gap-2';
  foot.innerHTML = `<button class="btn ghost" id="wg-cancel">取消</button><button class="btn primary" id="wg-save">${icon('check', 14)} 保存并连接</button>`;
  m.box.appendChild(Object.assign(document.createElement('div'), { className: 'modal-foot' })).appendChild(foot);
  const ta = m.body.querySelector('#wg-cookie');
  const fb = m.body.querySelector('#wg-feedback');
  let previewTimer = null;
  async function check() {
    const v = ta.value;
    if (!v.trim()) { fb.innerHTML = '<span class="text-3">粘贴后这里会显示格式检查结果。</span>'; return null; }
    const p = await window.nexus.player.wegamePreview(v);
    if (p.ok) fb.innerHTML = `<span class="text-green">✓ 格式正确</span> <span class="text-3">· 识别到 ${p.fields} 个凭证字段 · 来源：${esc(WG_FORMAT_LABEL[p.format] || p.format)}。可以点「保存并连接」。</span>`;
    else fb.innerHTML = `<span class="text-gold">⚠ ${esc(p.message)}</span>`;
    return p;
  }
  ta.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(check, 350); });
  foot.querySelector('#wg-cancel').addEventListener('click', m.close);
  m.body.querySelector('#wg-open').addEventListener('click', () => { window.nexus.shell.open('https://www.wegame.com.cn/'); toast('已在浏览器打开 WeGame，登录后回到这里继续', 'info'); });
  m.body.querySelector('#wg-paste').addEventListener('click', async () => {
    let txt = '';
    try { txt = await window.nexus.clip.read(); } catch { try { txt = await navigator.clipboard.readText(); } catch {} }
    if (txt && txt.trim()) { ta.value = txt.trim(); toast('已从剪贴板粘贴，正在检查格式…', 'success'); check(); }
    else toast('剪贴板是空的，请先在浏览器按方法 A 复制', 'info');
  });
  foot.querySelector('#wg-save').addEventListener('click', async () => {
    const v = ta.value.trim();
    if (!v) { fb.innerHTML = '<span class="text-gold">⚠ 请先粘贴 Cookie（推荐用方法 A 复制整段 cURL）。</span>'; ta.focus(); return; }
    const p = await window.nexus.player.wegamePreview(v);
    if (!p.ok) { fb.innerHTML = `<span class="text-gold">⚠ ${esc(p.message)}</span>`; ta.focus(); return; }
    const r = await window.nexus.player.wegameConnect(v);
    m.close();
    if (r.ok) { toast(`已保存登录态（${r.fields} 个字段），正在实测验证…`, 'success'); drawChannels(root, await window.nexus.player.channels()); doWegameVerify(root); }
    else toast(r.error || '连接失败', 'error');
  });
  check();
}

const WG_NEXT_STEP = {
  'login-required': '凭证不完整或已过期。最常见原因是只复制到了 Cookie 的一小段。请点下方「重新连接」，用<b>方法 A（复制整段 cURL）</b>重来；若仍失败，先在浏览器退出 WeGame 重新登录，再复制。',
  'permission': '登录态有效但权限不足，可能是该账号战绩设为隐私。请在 WeGame 检查战绩隐私设置，或换一个公开战绩的账号凭证。',
  'network': '网络没连上 WeGame 服务器。检查本机网络/代理后点「重新验证」；NEXUS 不会高频重试。',
  'rate-limit': '接口暂时限流。等一两分钟再点「重新验证」即可，不用重新复制凭证。',
  'shape-mismatch': '接口能连上，但返回的数据结构和预期不同（契约未获官方确认）。NEXUS 已把真实响应存档、不会瞎解析。这通常是 WeGame 接口变动，可稍后重试或反馈给开发者。',
  'unavailable': '数据源暂时不可用。可稍后点「重新验证」重试。',
};

async function doWegameVerify(root) {
  toast('正在用真实请求验证接口…', 'info');
  const r = await window.nexus.player.wegameVerify();
  const tried = (r.tried || []).map(t => `<div class="fs-12 text-3" style="line-height:1.8">· ${esc(t.endpoint || '')} ${t.status ? 'HTTP ' + t.status : ''} ${t.error_code != null ? 'error_code=' + t.error_code : ''} ${esc(t.message || t.kind || '')}${t.snippet ? '<br/><span style="opacity:0.7">响应样本：' + esc(t.snippet.slice(0, 160)) + '…</span>' : ''}</div>`).join('');
  const next = r.ok ? '' : (WG_NEXT_STEP[r.kind] || WG_NEXT_STEP['unavailable']);
  const m = modal({
    title: r.ok ? '独立通道验证通过' : '独立通道验证未通过',
    body: `<div class="flex items-center gap-2 mb-3">${r.ok ? '<span class="badge green">可用</span>' : kindBadge(r.kind || 'unavailable')}<span class="fs-13">${esc(r.message || (r.ok ? '接口返回真实数据，查询已启用。' : ''))}</span></div>
      ${r.ok ? '' : `<div class="wg-next"><div class="fw-6 fs-13 mb-1">${icon('spark', 15, 'text-teal')} 下一步怎么办</div><div class="fs-13 text-2" style="line-height:1.8">${next}</div></div>`}
      ${tried ? `<details class="mt-3"><summary class="fs-12 text-3" style="cursor:pointer">查看真实请求明细（供核对）</summary><div class="mt-2">${tried}</div></details>` : ''}
      <div class="fs-12 text-3 mt-3">${r.ok ? '查询范围以实测响应为准；响应形状变化时会原样返回样本并停用解析，绝不编造数据。' : '未通过验证前不会启用任何解析，绝不编造战绩。'}</div>`,
    wide: true,
  });
  if (!r.ok) {
    const foot = document.createElement('div');
    foot.className = 'flex gap-2';
    foot.innerHTML = `<button class="btn ghost" id="wgv-close">关闭</button><button class="btn ghost" id="wgv-retry">${icon('sync', 14)} 重新验证</button><button class="btn primary" id="wgv-reconnect">${icon('check', 14)} 重新连接</button>`;
    m.box.appendChild(Object.assign(document.createElement('div'), { className: 'modal-foot' })).appendChild(foot);
    foot.querySelector('#wgv-close').addEventListener('click', m.close);
    foot.querySelector('#wgv-retry').addEventListener('click', () => { m.close(); doWegameVerify(root); });
    foot.querySelector('#wgv-reconnect').addEventListener('click', () => { m.close(); openWegameConnect(root); });
  }
  drawChannels(root, await window.nexus.player.channels());
}

// ---- 同名候选：必须由用户选择身份 ----
function openCandidates(root, players) {
  const rows = players.map((p, i) => `
    <div class="flex items-center gap-3" style="padding:10px;border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:8px">
      ${p.profileIconId != null ? `<img src="nexus-asset://profileicon/${p.profileIconId}.png" style="width:40px;height:40px;border-radius:var(--r-md);background:var(--panel-3)"/>` : `<div class="item-icon"></div>`}
      <div style="flex:1">
        <div class="fw-6 fs-13">${esc(p.name)}${p.tagLine ? ' <span class="text-3">#' + esc(p.tagLine) + '</span>' : ''}</div>
        <div class="fs-12 text-3">${esc(regionName(p.serverId))} · 等级 ${p.level ?? '未知'} · 标识 ${esc(String(p.puuid || p.externalId || '').slice(0, 18))}…</div>
      </div>
      <button class="btn primary sm" data-i="${i}">选择此玩家</button>
    </div>`).join('');
  const m = modal({ title: '同名候选 · 请确认身份', body: `<div class="fs-12 text-3 mb-3">找到多个候选。请核对大区、等级与标识后选择；NEXUS 不会自动关联任何账号。</div>${rows}`, wide: true });
  m.body.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', async () => {
    const p = players[+btn.dataset.i];
    const r = await window.nexus.player.confirmCandidate(p);
    m.close();
    if (r.state === 'ok') { curPuuid = r.player.puuid; await drawProfile(root, curPuuid, true); drawRecent(root, await window.nexus.player.recent()); }
    else toast(r.message || '身份确认失败', 'error');
  }));
}

function drawHistChips(root, hist) {
  const node = root.querySelector('#player-hist');
  if (!node) return;
  if (!hist.length) { node.innerHTML = ''; return; }
  node.innerHTML = '<span class="fs-12 text-3" style="align-self:center">查询历史：</span>' + hist.slice(0, 8).map(h => `
    <span class="hist-chip">
      <button class="hc-q" data-k="${esc(h.keyword)}" data-s="${esc(h.serverId || 'auto')}" title="点击重新查询">${esc(h.keyword)}${h.serverId ? ' · ' + esc(regionName(h.serverId)) : ''}</button>
      <button class="hc-x" data-id="${h.id}" title="删除这条历史">${icon('close', 11)}</button>
    </span>`).join('') + `<button class="btn ghost sm" id="hist-clear" style="font-size:11px;padding:3px 8px">${icon('close', 11)} 清空</button>`;
  node.querySelectorAll('.hc-q').forEach(b => b.addEventListener('click', () => {
    root.querySelector('#player-search').value = b.dataset.k;
    const sel = root.querySelector('#player-region');
    sel.value = [...sel.options].some(o => o.value === b.dataset.s) ? b.dataset.s : 'auto';
    root.querySelector('#player-go').click();
  }));
  node.querySelectorAll('.hc-x').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.nexus.player.deleteHistory(+b.dataset.id);
    drawHistChips(root, await window.nexus.player.searchHistory(30));
  }));
  const clr = node.querySelector('#hist-clear');
  if (clr) clr.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '清空查询历史', message: '将删除全部查询历史记录（不影响已缓存的玩家与战绩）。确定清空吗？', confirmText: '清空', danger: true });
    if (!ok) return;
    await window.nexus.player.clearHistory();
    drawHistChips(root, []);
    toast('查询历史已清空', 'success');
  });
}

function drawRecent(root, recent) {
  const node = root.querySelector('#player-recent');
  node.innerHTML = recent.length ? recent.map(r => `<div class="flex items-center gap-2 fs-13" data-puuid="${esc(r.puuid)}" style="padding:6px;border-radius:var(--r-sm);cursor:pointer"><span class="lcu-dot"></span><span style="flex:1" class="truncate">${esc(r.name)}</span><span class="fs-12 text-3">${esc(regionName(r.serverId))}</span><button class="btn icon sm ghost rc-x" data-puuid="${esc(r.puuid)}" title="删除这条最近查询">${icon('close', 11)}</button></div>`).join('') + `<div class="flex justify-end mt-1"><button class="btn ghost sm" id="rc-clear">清空最近查询</button></div>` : '<div class="text-3 fs-12">暂无</div>';
  node.querySelectorAll('[data-puuid]:not(.rc-x)').forEach(n => n.addEventListener('click', () => { curPuuid = n.dataset.puuid; drawProfile(root, curPuuid, true); }));
  node.querySelectorAll('.rc-x').forEach(b => b.addEventListener('click', async (e) => { e.stopPropagation(); await window.nexus.player.deleteRecent(b.dataset.puuid); drawRecent(root, await window.nexus.player.recent()); }));
  const clr = node.querySelector('#rc-clear');
  if (clr) clr.addEventListener('click', async () => { if (await confirmDialog({ title: '清空最近查询', message: '确定清空所有最近查询记录？不影响已缓存战绩。', danger: true, confirmText: '清空' })) { await window.nexus.player.clearRecent(); drawRecent(root, await window.nexus.player.recent()); } });
}
function drawFavs(root, favs) {
  const node = root.querySelector('#player-favs');
  node.innerHTML = favs.length ? favs.map(r => `<div class="flex items-center gap-2 fs-13" data-puuid="${esc(r.puuid)}" style="padding:6px;border-radius:var(--r-sm);cursor:pointer">${icon('star', 13, 'text-gold')}<span style="flex:1" class="truncate">${esc(r.name)}</span></div>`).join('') : '<div class="text-3 fs-12">暂无</div>';
  node.querySelectorAll('[data-puuid]').forEach(n => n.addEventListener('click', () => { curPuuid = n.dataset.puuid; drawProfile(root, curPuuid, true); }));
}

// ---- 来源与时间标识（缓存 ≠ 实时） ----
function historyBadges(hist) {
  const src = hist.source || 'cache';
  let tags = '';
  if (src === 'cache') tags = `<span class="badge amber">本地缓存 · 非实时</span>${sourceTag('local', '缓存')}`;
  else if (src === 'lcu') tags = sourceTag('lcu');
  else if (src === 'lcu+sgp') tags = sourceTag('lcu') + sourceTag('sgp', 'SGP 深分页');
  else if (src === 'sgp-cross') tags = sourceTag('sgp', 'SGP 跨区（实验性）');
  else tags = sourceTag(src, src);
  const t = hist.fetchedAt ? `<span class="fs-12 text-3">数据更新：${timeAgo(hist.fetchedAt)}</span>` : '';
  return tags + t;
}

let rateModeOverride = null; // null=自动(竞技优先)；否则为用户选定模式
async function drawProfile(root, puuid, refresh) {
  const main = root.querySelector('#player-main');
  main.innerHTML = loadingPanel(refresh ? '正在刷新真实战绩…' : '正在读取本地缓存…');
  let prof;
  try { prof = await window.nexus.player.profile(puuid, { refresh, count: matchCount, modeKey: rateModeOverride || undefined }); }
  catch (e) { main.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 44)}<div class="es-title">加载失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary sm mt-3" id="p-retry">重试</button></div></div>`; main.querySelector('#p-retry').addEventListener('click', () => drawProfile(root, puuid, refresh)); return; }
  if (!prof || prof.__error) { main.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 44)}<div class="es-title">无法加载</div><div>${esc(prof && prof.__error || '未知错误')}</div></div></div>`; return; }
  const p = prof.player, st = prof.stats, rating = prof.rating || { grade: null, reasons: [], confidence: 0, longTerm: 0, recent: 0, label: '', note: '' }, rank = prof.rank;
  const winRate = rank && rank.wins != null && (rank.wins + rank.losses) > 0 ? rank.wins / (rank.wins + rank.losses) : st.winRate;
  const srcBadge = p.source === 'wegame' ? sourceTag('wegame', 'WeGame 独立通道') : sourceTag('lcu');
  main.innerHTML = `
    <div class="panel mb-4">
      <div class="flex items-center gap-4">
        <div style="position:relative"><img src="nexus-asset://profileicon/${p.profileIconId || 0}.png" style="width:72px;height:72px;border-radius:var(--r-lg);border:1px solid var(--line-strong);background:var(--panel-3)" alt=""/><div style="position:absolute;bottom:-6px;right:-6px">${gradeBadge(rating)}</div></div>
        <div style="flex:1">
          <div class="fw-6 fs-16" style="color:var(--text)">${esc(p.name || '未知')} ${p.tagLine ? '<span class="text-3 fs-13">#' + esc(p.tagLine) + '</span>' : ''}</div>
          <div class="fs-12 text-3 mt-2">${esc(regionName(p.serverId))} ${p.region ? '· ' + esc(p.region) : ''} · 等级 ${p.level || '—'} · ${p.privacy === 'PRIVATE' ? '战绩私密' : '战绩公开'} · 身份可信度 ${Math.round((p.confidence || 0.8) * 100)}%</div>
          <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
            ${rank && rank.tier ? `<span class="badge gold">${RANK_CN[rank.tier.toUpperCase()] || rank.tier} ${esc(rank.division || '')} ${rank.lp != null ? rank.lp + ' LP' : ''}</span>` : '<span class="badge gray">段位未知</span>'}
            ${rank && rank.wins != null ? `<span class="badge teal">${rank.wins}胜 ${rank.losses}负 · ${pct(winRate)}</span>` : ''}
            <span class="badge ${(rating.confidence || 0) >= 0.6 ? 'green' : 'amber'}">评级可信度 ${Math.round((rating.confidence || 0) * 100)}%</span>
            <span class="badge teal" title="评级只基于该模式真实对局，不跨模式混算">评级口径 ${esc(rating.modeLabel || '全部模式')}</span>
            ${srcBadge}
          </div>
          <div class="flex gap-2 mt-2 items-center" style="flex-wrap:wrap">
            <span class="fs-12 text-3">评级/统计模式：</span>
            <select class="nx-select" id="p-rate-mode" style="width:130px">
              ${[['auto', '自动(竞技优先)'], ['solo', '单双排'], ['flex', '灵活组排'], ['normal', '匹配'], ['swift', '快速模式'], ['aram', '大乱斗'], ['all', '全部模式']].map(o => `<option value="${o[0]}" ${(rateModeOverride ? rateModeOverride === o[0] : o[0] === 'auto') ? 'selected' : ''}>${o[1]}</option>`).join('')}
            </select>
            <span class="fs-12 text-3">大乱斗/人机不会混入排位参考</span>
          </div>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap;justify-content:flex-end">
          <button class="btn ghost sm" id="p-refresh">${icon('sync', 14)} 刷新</button>
          <button class="btn ghost sm" id="p-fav">${icon('star', 14)} 收藏</button>
          <button class="btn ghost sm" id="p-self">${icon('champion', 14)} 设为自己</button>
          <button class="btn ghost sm" id="p-replay">${icon('chart', 14)} 复盘</button>
          <button class="btn ghost sm" id="p-growth">${icon('arrowUp', 14)} 成长</button>
        </div>
      </div>
      ${rating.grade ? `<div class="divider"></div><div class="grid" style="grid-template-columns:auto 1fr 1fr;gap:20px;align-items:center">
        <div class="flex-col items-center gap-1">${gradeBadge(rating, true)}<span class="fs-12 text-3">${esc(rating.label)}</span></div>
        <div><div class="fs-12 text-3 mb-1">长期实力</div><div class="bar-track"><div class="bar-fill" style="width:${rating.longTerm}%"></div></div><div class="num fs-13 text-gold mt-2">${rating.longTerm}/100</div></div>
        <div><div class="fs-12 text-3 mb-1">近期状态</div><div class="bar-track"><div class="bar-fill gold" style="width:${rating.recent}%"></div></div><div class="num fs-13 text-gold mt-2">${rating.recent}/100</div></div>
      </div><div class="mt-3 fs-12 text-2" style="line-height:1.8">${rating.reasons.map(r => '· ' + esc(r)).join('<br/>')}</div><div class="mt-2 fs-12 text-3">${esc(rating.note)}</div>` : `<div class="divider"></div><div class="fs-13 text-3">${esc(rating.reasons[0] || '数据不足')}</div>`}
    </div>

    <div class="viz-strip stagger mb-4">
      <div class="viz-panel">
        <div class="viz-h">胜率环 ${srcBadge}</div>
        <div class="viz-body">${ringSVG(winRate)}</div>
        <div class="viz-sub">${st.wins}胜 ${st.losses}负 · 总 ${st.total} 场</div>
      </div>
      <div class="viz-panel">
        <div class="viz-h">近期走势 <span class="fs-11 text-3">滚动胜率 · 逐场胜负点</span></div>
        <div class="viz-body">${trendSVG(prof.history.matches || [])}</div>
        <div class="viz-sub">近10场 ${pct(st.recent10 && st.recent10.winRate)} · ${st.streakType ? st.streak + (st.streakType === 'W' ? ' 连胜' : ' 连败') : '当前无连胜/连败'}</div>
      </div>
      <div class="viz-panel">
        <div class="viz-h">能力雷达</div>
        <div class="viz-body">${radarSVG(st, prof.history.matches || [])}</div>
        <div class="viz-sub">平均 KDA ${fx(st.avgKDA, 2)}（${fx(st.avgKills)} / ${fx(st.avgDeaths)} / ${fx(st.avgAssists)}）· 由真实场均推导</div>
      </div>
      <div class="viz-panel">
        <div class="viz-h">英雄池矩阵 <span class="fs-11 text-3">${st.poolDepth} 名英雄</span></div>
        <div class="viz-body">${poolHTML(st)}</div>
        <div class="viz-sub">角标胜率绿≥50% / 红&lt;50% · 金边=绝活</div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
      <div class="panel"><div class="panel-h"><div class="panel-title">常用 / 绝活英雄</div>${srcBadge}</div><div id="p-champs" class="flex-col gap-1"></div></div>
      <div class="panel"><div class="panel-h"><div class="panel-title">位置表现</div></div><div id="p-pos" class="flex-col gap-2"></div></div>
    </div>

    <div class="panel mt-4">
      <div class="panel-h"><div class="panel-title">历史战绩</div>
        <div class="flex gap-2 items-center" style="flex-wrap:wrap">
          <select class="nx-select" id="p-count"><option value="10" ${matchCount === 10 ? 'selected' : ''}>最近 10 场</option><option value="20" ${matchCount === 20 ? 'selected' : ''}>最近 20 场</option><option value="50" ${matchCount === 50 ? 'selected' : ''}>最近 50 场</option></select>
          ${historyBadges(prof.history)}
        </div>
      </div>
      ${prof.history.note ? `<div class="fs-12 ${prof.history.errorKind ? 'text-red' : 'text-gold'} mb-3" style="line-height:1.7">${prof.history.errorKind ? kindBadge(prof.history.errorKind) + ' ' : ''}${esc(prof.history.note)}</div>` : ''}
      ${prof.fromCache ? '<div class="fs-12 text-3 mb-3">当前展示为本地缓存（非实时）。点「刷新」从真实数据源更新；无可用通道时会保留缓存并说明原因。</div>' : ''}
      <div id="p-mfilters" class="mb-2"></div>
      <div id="p-matches" class="flex-col gap-2"></div>
    </div>
    ${aiBlock('player-ai', { title: 'AI 个人能力分析', hint: '基于该玩家缓存真实战绩生成能力画像与改进建议；样本不足时会明确声明。' })}
  `;
  const cw = main.querySelector('#p-champs');
  cw.innerHTML = st.byChampion.length ? st.byChampion.slice(0, 8).map(c => {
    const ch = champBy(c.championId); const isSig = st.signature.some(s => s.championId === c.championId);
    return `<div class="flex items-center gap-2" style="padding:6px;border-radius:var(--r-md);${isSig ? 'background:var(--gold-dim)' : ''}">
      ${ch ? `<img src="${asset(ch.imageUrl)}" style="width:32px;height:32px;border-radius:var(--r-sm)"/>` : '<div class="item-icon sm"></div>'}
      <span style="flex:1" class="fs-13 truncate">${ch ? esc(ch.nameCn) : '#' + c.championId} ${isSig ? '<span class="badge gold" style="font-size:11px">绝活</span>' : ''}</span>
      <span class="fs-12 text-3 num">${c.games}场</span><span class="num ${c.winRate >= 0.5 ? 'text-green' : 'text-red'}">${pct(c.winRate)}</span></div>`;
  }).join('') : '<div class="text-3 fs-13">暂无英雄数据</div>';
  const pw = main.querySelector('#p-pos');
  pw.innerHTML = st.byPosition.length ? st.byPosition.map(pp => `<div><div class="flex justify-between fs-12 mb-1"><span class="text-2">${esc(POS_CN[String(pp.position || '').toUpperCase()] || pp.position || '未知')}</span><span class="num text-3">${pp.games}场 · ${pct(pp.games ? pp.wins / pp.games : 0)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pp.games ? pp.wins / pp.games * 100 : 0}%"></div></div></div>`).join('') : '<div class="text-3 fs-13">暂无位置数据</div>';
  bindMatchFilters(main, prof.history.matches || [], puuid, p.serverId);

  const histMatches = (prof.history.matches || []).filter(m => typeof m.win === 'boolean');
  bindAi(main, 'player-ai', 'query', () => ({
    personal: true,
    data: {
      player: p.name, serverId: p.serverId,
      rating: rating ? { grade: rating.grade, longTerm: rating.longTerm, recent: rating.recent, confidence: rating.confidence, reasons: rating.reasons } : null,
      stats: { total: st.total, winRate: st.winRate, avgKDA: st.avgKDA, avgKills: st.avgKills, avgDeaths: st.avgDeaths, avgAssists: st.avgAssists, poolDepth: st.poolDepth, recent10: st.recent10, streak: st.streak, streakType: st.streakType },
      signature: st.signature.map(s => (champBy(s.championId) || {}).nameCn || '#' + s.championId),
      byPosition: st.byPosition, byChampion: st.byChampion.slice(0, 10),
    },
    rules: { facts: [`缓存 ${st.total} 场 · 胜率 ${pct(st.winRate)} · KDA ${fx(st.avgKDA, 2)}`], inferences: rating && rating.reasons || [], advice: [] },
  }), {
    variant: 'player', subject: puuid, subjectName: p.name,
    dataRange: `缓存真实战绩 ${st.total} 场` + (st.recent10 ? ` · 近10场胜率 ${pct(st.recent10.winRate)}` : ''),
    charts: {
      pool: st.byChampion.slice(0, 6).map(c => ({ name: (champBy(c.championId) || {}).nameCn || '#' + c.championId, games: c.games, winRate: c.winRate })),
      winSeries: histMatches.length >= 2 ? histMatches.slice(0, 20).reverse().map(m => m.win) : null,
    },
  });

  main.querySelector('#p-refresh').addEventListener('click', () => drawProfile(root, puuid, true));
  const rmSel = main.querySelector('#p-rate-mode');
  if (rmSel) rmSel.addEventListener('change', () => { rateModeOverride = rmSel.value === 'auto' ? null : rmSel.value; drawProfile(root, puuid, false); });
  main.querySelector('#p-fav').addEventListener('click', async () => { const now = await window.nexus.player.toggleFavorite(puuid, p.name); drawFavs(root, await window.nexus.player.favorites()); toast(now ? '已收藏玩家' : '已取消收藏', 'success'); });
  main.querySelector('#p-self').addEventListener('click', async () => { await window.nexus.config.set('selfPuuid', puuid); await window.nexus.config.set('intelPuuid', puuid); toast('已设为自己的账号，复盘/成长/教练将默认分析该账号', 'success'); });
  main.querySelector('#p-replay').addEventListener('click', async () => { await window.nexus.config.set('intelPuuid', puuid); navigate('replay'); });
  main.querySelector('#p-growth').addEventListener('click', async () => { await window.nexus.config.set('intelPuuid', puuid); navigate('growth'); });
  main.querySelector('#p-count').addEventListener('change', (e) => { matchCount = +e.target.value; drawProfile(root, puuid, false); });
  animateViz(main);
}

// ---- 可视化首屏：全部由真实战绩/场均推导，无样本时诚实空态 ----
const RING_C = 2 * Math.PI * 56;
function ringSVG(wr) {
  const w = Math.max(0, Math.min(1, wr || 0));
  return `<div class="ring-wrap">
    <svg width="132" height="132" viewBox="0 0 132 132">
      <circle class="ring-track" cx="66" cy="66" r="56" fill="none" stroke-width="10"/>
      <circle class="ring-val" cx="66" cy="66" r="56" fill="none" stroke-width="10" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}" data-offset="${(RING_C * (1 - w)).toFixed(1)}"/>
    </svg>
    <div class="ring-center"><span class="num" data-count="${Math.round(w * 100)}" data-suffix="%">0%</span><span class="rl">胜率</span></div>
  </div>`;
}
function trendSVG(matches) {
  const seq = [...matches].reverse().slice(-20);
  if (!seq.length) return '<div class="text-3 fs-12">暂无逐场数据，连接通道刷新后生成走势。</div>';
  const W = 320, H = 120, L = 30, R = 8, T = 10, B = 22;
  const pts = seq.map((m, i) => {
    const win = m.me && m.me.win === true;
    const windowSeq = seq.slice(Math.max(0, i - 4), i + 1);
    const wr = windowSeq.filter(x => x.me && x.me.win === true).length / windowSeq.length;
    return { x: L + (i / Math.max(1, seq.length - 1)) * (W - L - R), y: T + (1 - wr) * (H - T - B), win };
  });
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${L},${H - B} ${line} ${pts[pts.length - 1].x.toFixed(1)},${H - B}`;
  const grid = [0, 0.5, 1].map(g => { const y = T + (1 - g) * (H - T - B); return `<line class="trend-grid" x1="${L}" y1="${y}" x2="${W - R}" y2="${y}"/><text class="trend-label" x="2" y="${y + 3}">${g * 100}%</text>`; }).join('');
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}
    <polygon class="trend-area" points="${area}"/><polyline class="trend-line" points="${line}"/>
    ${pts.map(p => `<circle class="${p.win ? 'trend-dot-w' : 'trend-dot-l'}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"/>`).join('')}
  </svg>`;
}
function radarSVG(st, matches) {
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const withGold = matches.filter(m => m.me && m.me.gold != null);
  const axes = [
    ['输出', clamp01((st.avgKills || 0) / 8)],
    ['生存', clamp01(1 - (st.avgDeaths || 0) / 8)],
    ['团战', clamp01((st.avgAssists || 0) / 12)],
    ['取胜', clamp01(st.winRate || 0)],
  ];
  if (withGold.length) axes.push(['经济', clamp01(withGold.reduce((s, m) => s + m.me.gold, 0) / withGold.length / 15000)]);
  const cx = 110, cy = 85, R = 62, n = axes.length;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI / n); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const grid = [0.33, 0.66, 1].map(f => `<polygon class="radar-grid" points="${axes.map((_, i) => pt(i, R * f).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`).join('');
  const shape = axes.map((a, i) => pt(i, R * Math.max(0.04, a[1])).map(v => v.toFixed(1)).join(',')).join(' ');
  const labels = axes.map((a, i) => { const [x, y] = pt(i, R + 14); return `<text class="radar-axis-label" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle">${a[0]}</text>`; }).join('');
  return `<svg class="radar-svg" viewBox="0 0 220 170">${grid}<polygon class="radar-shape" points="${shape}"/>${labels}</svg>`;
}
function poolHTML(st) {
  const list = (st.byChampion || []).slice(0, 8);
  if (!list.length) return '<div class="text-3 fs-12">暂无英雄池数据。</div>';
  return `<div class="pool-matrix">${list.map(c => {
    const ch = champBy(c.championId);
    const sig = (st.signature || []).some(s => s.championId === c.championId);
    const wr = c.winRate || 0;
    return `<div class="pool-cell ${sig ? 'sig' : ''}" title="${ch ? esc(ch.nameCn) : '#' + c.championId} · ${c.games}场 · ${pct(wr)}">
      ${ch ? `<img src="${asset(ch.imageUrl)}" alt=""/>` : ''}
      <div class="pc-overlay"><span class="pc-wr" style="color:${wr >= 0.5 ? 'var(--green)' : 'var(--red)'}">${pct(wr)}</span><span class="pc-games">${c.games}场</span></div>
    </div>`;
  }).join('')}</div>`;
}
function animateViz(scope) {
  const reduced = document.body.classList.contains('reduce-motion');
  scope.querySelectorAll('.ring-val').forEach(el => {
    const off = el.dataset.offset;
    if (reduced) el.style.strokeDashoffset = off;
    else requestAnimationFrame(() => requestAnimationFrame(() => { el.style.strokeDashoffset = off; }));
  });
  scope.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, suf = el.dataset.suffix || '';
    if (reduced) { el.textContent = to + suf; return; }
    const t0 = performance.now(), dur = 450;
    const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

// 战绩筛选（模式/英雄/胜负）：与复盘同口径 modeCat，本地过滤不重复请求；筛选态随本次 profile 重置。
function bindMatchFilters(main, matches, puuid, serverId) {
  const bar = main.querySelector('#p-mfilters');
  const listWrap = main.querySelector('#p-matches');
  if (!bar || !listWrap) { drawMatches(listWrap, matches, puuid, serverId); return; }
  const st = { mode: 'all', champ: '', result: 'all' };
  const champs = [...new Set(matches.map(m => m.me && m.me.championId).filter(x => x != null))];
  function apply() {
    let rows = matches.filter(m => inMode(m, st.mode));
    if (st.champ) rows = rows.filter(m => m.me && String(m.me.championId) === st.champ);
    if (st.result !== 'all') rows = rows.filter(m => m.me && (st.result === 'win' ? m.me.win === true : m.me.win === false));
    drawMatches(listWrap, rows, puuid, serverId);
    if (!rows.length && matches.length) listWrap.innerHTML = `<div class="empty-state">${icon('clock', 36)}<div class="es-title">当前筛选下无对局</div><div>试试放宽模式/英雄/胜负条件。</div></div>`;
  }
  function renderBar() {
    bar.innerHTML = '';
    bar.appendChild(modeFilterRow(matches, st.mode, (k) => { st.mode = k; renderBar(); apply(); }));
    const row2 = el('div', { class: 'flex gap-2 items-center', style: { flexWrap: 'wrap' } });
    const sel = el('select', { class: 'nx-select', style: { width: '150px' } });
    sel.appendChild(el('option', { value: '', text: '全部英雄' }));
    for (const c of champs) { const ch = champBy(c); sel.appendChild(el('option', { value: String(c), text: ch ? (ch.nameCn || ch.name) : ('#' + c), selected: st.champ === String(c) })); }
    sel.addEventListener('change', () => { st.champ = sel.value; apply(); });
    row2.appendChild(sel);
    for (const r of [['all', '全部'], ['win', '只看胜'], ['loss', '只看负']]) {
      row2.appendChild(el('button', { class: 'chip' + (st.result === r[0] ? ' active' : ''), text: r[1], onClick: () => { st.result = r[0]; renderBar(); apply(); } }));
    }
    const n = matches.filter(m => inMode(m, st.mode) && (!st.champ || (m.me && String(m.me.championId) === st.champ)) && (st.result === 'all' || (m.me && (st.result === 'win' ? m.me.win === true : m.me.win === false)))).length;
    row2.appendChild(el('span', { class: 'fs-12 text-3', text: `筛选后 ${n} / ${matches.length} 场` }));
    bar.appendChild(row2);
  }
  renderBar();
  apply();
}

function drawMatches(wrap, matches, puuid, serverId) {
  if (!matches.length) { wrap.innerHTML = `<div class="empty-state">${icon('clock', 40)}<div class="es-title">暂无战绩</div><div>点「刷新」从真实数据源获取；私密战绩或无记录时显示为空。未连接任何通道时不会显示伪造战绩。</div></div>`; return; }
  wrap.innerHTML = matches.map(m => {
    const me = m.me || {}; const ch = champBy(me.championId);
    const win = me.win === true;
    const kda = fx(me.deaths ? (me.kills + me.assists) / me.deaths : (me.kills + me.assists), 2);
    return `<div class="match-row flex items-center gap-3" data-game="${m.gameId}" style="padding:10px;border-radius:var(--r-md);border:1px solid var(--line);border-left:3px solid ${win ? 'var(--green)' : 'var(--red)'};cursor:pointer;background:rgba(0,0,0,0.15)">
      ${ch ? `<img src="${asset(ch.imageUrl)}" style="width:42px;height:42px;border-radius:var(--r-md)"/>` : '<div class="item-icon"></div>'}
      <div style="width:70px"><div class="fw-6 ${win ? 'text-green' : 'text-red'}">${win ? '胜利' : me.win === false ? '失败' : '未知'}</div><div class="fs-12 text-3">${esc(modeCat(m.queueId, m.mode).label)}</div></div>
      <div style="width:90px"><div class="num fw-6">${me.kills ?? '—'} / ${me.deaths ?? '—'} / ${me.assists ?? '—'}</div><div class="fs-12 text-3">KDA ${kda}</div></div>
      <div style="flex:1" class="fs-12 text-3">${me.cs != null ? me.cs + ' 补刀' : ''} ${me.gold != null ? '· ' + num(me.gold) + ' 金' : ''} ${m.duration ? '· ' + Math.round(m.duration / 60) + ' 分钟' : ''} ${m.source === 'sgp' ? '· SGP' : ''}</div>
      <div class="fs-12 text-3">${m.gameCreation ? timeAgo(new Date(m.gameCreation).toISOString()) : ''}</div>
      ${icon('chevron', 14, 'text-3')}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.match-row').forEach(n => n.addEventListener('click', () => openMatch(+n.dataset.game, puuid, serverId)));
}

async function openMatch(gameId, puuid, serverId) {
  const m = modal({ title: '对局详情 #' + gameId, body: loadingPanel('正在读取单局详情…'), wide: true });
  let detail = null;
  try { detail = await window.nexus.player.matchDetail(gameId, { puuid, serverId }); } catch (e) { detail = { __error: e.message, kind: e.kind }; }
  const body = m.body;
  // 离线回退：live 详情不可用时用本地缓存的真实十人 participants
  let cachedFallback = null;
  if (!detail || detail.__error) {
    cachedFallback = await window.nexus.player.matchParticipants(gameId, puuid).catch(() => null);
    if (!cachedFallback) {
      body.innerHTML = `<div class="flex items-center gap-2 mb-2">${detail && detail.kind ? kindBadge(detail.kind) : ''}<span class="fs-13 text-2">无法加载单局详情</span></div><div class="fs-12 text-3" style="line-height:1.8">${esc(detail && detail.__error || '需连接客户端或独立通道')}。该对局亦无本地十人缓存。</div>`;
      return;
    }
  }
  // 统一十人形状（SGP / LCU / 缓存 三源），供分组 + 评级 + 逐人侦察
  let parts, metaHtml;
  if (cachedFallback) {
    parts = cachedFallback.participants.map(pp => ({ puuid: pp.puuid, name: pp.name, tagLine: pp.tagLine, championId: pp.championId, teamId: pp.teamId, win: pp.win, kills: pp.kills, deaths: pp.deaths, assists: pp.assists, cs: pp.cs, gold: pp.gold, damage: pp.damage, position: pp.position }));
    metaHtml = `<div class="fs-12 text-3 mb-3 flex gap-2 items-center" style="flex-wrap:wrap">${esc(modeCat(cachedFallback.queueId, cachedFallback.mode).label)} · ${cachedFallback.duration ? Math.round(cachedFallback.duration / 60) + ' 分钟' : ''} · ${cachedFallback.gameCreation ? fmtTime(new Date(cachedFallback.gameCreation).toISOString()) : ''} <span class="badge gray">本地缓存十人</span>${sourceTag('lcu')}</div>`;
  } else if (detail.source === 'sgp') {
    const g = detail.game;
    parts = (g.participants || []).map(pp => ({ puuid: pp.puuid, name: pp.name, tagLine: pp.tagLine, championId: pp.championId, teamId: pp.teamId, win: pp.win, kills: pp.kills, deaths: pp.deaths, assists: pp.assists, cs: pp.cs, gold: pp.gold }));
    metaHtml = `<div class="fs-12 text-3 mb-3 flex gap-2 items-center" style="flex-wrap:wrap">${esc(g.mode || '')} · ${g.duration ? Math.round(g.duration / 60) + ' 分钟' : ''} · ${g.gameCreation ? fmtTime(new Date(g.gameCreation).toISOString()) : ''} ${sourceTag('sgp', 'SGP 单局摘要')}${detail.crossRegion ? '<span class="badge purple">跨区</span>' : ''}${detail.verifiedHost === false ? '<span class="badge amber">主机未验证</span>' : ''}</div>`;
  } else {
    const idMap = {}; (detail.participantIdentities || []).forEach(it => idMap[it.participantId] = it.player || {});
    parts = (detail.participants || []).map(p => {
      const pl = idMap[p.participantId] || {}; const s = p.stats || {};
      return { puuid: pl.puuid, name: pl.gameName || pl.summonerName, tagLine: pl.tagLine, championId: p.championId, teamId: p.teamId, win: s.win === true || s.win === 'Win', kills: s.kills, deaths: s.deaths, assists: s.assists, cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0), gold: s.goldEarned };
    });
    metaHtml = `<div class="fs-12 text-3 mb-3">${esc(detail.gameMode || '')} · ${detail.gameDuration ? Math.round(detail.gameDuration / 60) + ' 分钟' : ''} · ${detail.gameCreation ? fmtTime(new Date(detail.gameCreation).toISOString()) : ''} ${sourceTag('lcu')}</div>`;
  }
  const me = parts.find(p => p.puuid === puuid) || null;
  const myTeam = me ? me.teamId : null;
  // 评级口径=本场模式（大乱斗场用大乱斗评级，排位场用排位评级），不跨模式混算
  const matchModeKey = modeCat(cachedFallback ? cachedFallback.queueId : (detail.game ? detail.game.queueId : detail.queueId), cachedFallback ? cachedFallback.mode : (detail.game ? detail.game.gameMode : detail.gameMode)).key;
  // 评级先读本地缓存（无网络、即时）；深度侦察按需拉真实历史
  let scout = [];
  try { scout = await window.nexus.player.scoutParticipants(parts.map(p => ({ puuid: p.puuid })), matchModeKey); } catch {}
  const ratingBy = {}; (scout || []).forEach(s => { if (s && s.puuid) ratingBy[s.puuid] = s; });
  const ctx = { parts, ratingBy, serverId, gameId, modeKey: matchModeKey };
  const gradeCell = (p) => { const sc = ratingBy[p.puuid]; return sc && sc.rating && sc.rating.grade ? gradeBadge(sc.rating) : '<span class="badge gray">待侦察</span>'; };
  // 近期状态点（近5真实胜负）+ 主玩英雄 + 火热/低迷 tag
  const formCell = (p) => {
    const sc = ratingBy[p.puuid];
    if (!sc || !sc.recent || !sc.recent.length) return '<span class="text-3 fs-11">—</span>';
    const dots = sc.recent.map(w => `<span style="width:8px;height:8px;border-radius:2px;display:inline-block;background:${w === true ? 'var(--green)' : w === false ? 'var(--red)' : 'var(--line-strong)'}" title="${w === true ? '胜' : w === false ? '负' : '未知'}"></span>`).join('');
    let tag = '';
    if (sc.recentWinRate != null) tag = sc.recentWinRate >= 0.7 ? '<span class="badge green" style="font-size:10px">火热</span>' : sc.recentWinRate <= 0.3 ? '<span class="badge red" style="font-size:10px">低迷</span>' : '';
    return `<span class="flex gap-1 items-center">${dots}${tag}</span>`;
  };
  const mainCell = (p) => {
    const sc = ratingBy[p.puuid];
    if (!sc || sc.mainChampionId == null) return '<span class="text-3 fs-11">—</span>';
    const mc = champBy(sc.mainChampionId);
    return `<span class="flex items-center gap-1 fs-11">${mc ? `<img src="${asset(mc.imageUrl)}" style="width:16px;height:16px;border-radius:3px"/>` : ''}<span class="text-3">${sc.mainGames}场${sc.mainWinRate != null ? ' ' + pct(sc.mainWinRate) : ''}</span></span>`;
  };
  const rowHtml = (p) => {
    const ch = champBy(p.championId); const isMe = p.puuid === puuid;
    return `<tr class="scout-row" data-puuid="${esc(p.puuid || '')}" style="cursor:pointer;${isMe ? 'background:var(--teal-dim)' : ''}" title="点击查看该玩家真实历史战绩与评级">
      <td><div class="flex items-center gap-2">${ch ? `<img src="${asset(ch.imageUrl)}" style="width:28px;height:28px;border-radius:var(--r-sm)"/>` : ''}<span class="fs-12">${esc(p.name || '未知')}${p.tagLine ? ' <span class="text-3">#' + esc(p.tagLine) + '</span>' : ''}${isMe ? ' <span class="badge teal">我</span>' : ''}</span></div></td>
      <td class="fs-12">${ch ? esc(ch.nameCn) : p.championId}</td>
      <td class="num">${p.kills ?? '—'}/${p.deaths ?? '—'}/${p.assists ?? '—'}</td>
      <td class="num fs-12">${p.cs ?? '—'}</td>
      <td class="num fs-12">${p.gold != null ? num(p.gold) : '—'}</td>
      <td><span class="badge ${p.win ? 'green' : 'red'}">${p.win ? '胜' : '负'}</span></td>
      <td class="scout-form">${formCell(p)}</td>
      <td class="scout-main">${mainCell(p)}</td>
      <td class="scout-grade">${gradeCell(p)}</td>
      <td>${icon('chevron', 13, 'text-3')}</td></tr>`;
  };
  const table = (list, title, cls) => list.length ? `<div class="section-title ${cls}" style="font-size:13px;margin:10px 0 6px">${title} <span class="badge gray">${list.length}</span></div>
    <table class="nx-table"><thead><tr><th>玩家</th><th>英雄</th><th>KDA</th><th>补刀</th><th>经济</th><th>胜负</th><th>近5状态</th><th>主玩</th><th>评级</th><th></th></tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table>` : '';
  const mine = parts.filter(p => myTeam != null && p.teamId === myTeam);
  const enemy = parts.filter(p => !(myTeam != null && p.teamId === myTeam));
  // 队伍聚合 + 对位对比（我 vs 同位置对手），基于真实缓存/单局数据
  const agg = (list) => {
    const scs = list.map(p => ratingBy[p.puuid]).filter(s => s && s.recentWinRate != null);
    const wr = scs.length ? scs.reduce((a, s) => a + s.recentWinRate, 0) / scs.length : null;
    const ranks = list.map(p => ratingBy[p.puuid]).filter(s => s && s.rank && s.rank.tier);
    return { wr, known: scs.length, n: list.length, rankSample: ranks.length };
  };
  const myAgg = agg(mine), enAgg = agg(enemy);
  const laneOpp = me && me.position ? enemy.find(p => p.position === me.position) : null;
  const laneHtml = me && laneOpp ? `<div class="panel tight mb-3"><div class="fs-12 fw-6 mb-1">对位对比 · ${esc(POS_CN[String(me.position).toUpperCase()] || me.position)}</div>
    <div class="flex gap-3 fs-12" style="flex-wrap:wrap">
      <span>我 KDA <b class="num">${me.kills ?? '—'}/${me.deaths ?? '—'}/${me.assists ?? '—'}</b></span>
      <span>对手 KDA <b class="num">${laneOpp.kills ?? '—'}/${laneOpp.deaths ?? '—'}/${laneOpp.assists ?? '—'}</b></span>
      ${me.cs != null && laneOpp.cs != null ? `<span>补刀差 <b class="num ${me.cs - laneOpp.cs >= 0 ? 'text-green' : 'text-red'}">${me.cs - laneOpp.cs >= 0 ? '+' : ''}${me.cs - laneOpp.cs}</b></span>` : ''}
      ${me.gold != null && laneOpp.gold != null ? `<span>经济差 <b class="num ${me.gold - laneOpp.gold >= 0 ? 'text-green' : 'text-red'}">${me.gold - laneOpp.gold >= 0 ? '+' : ''}${num(me.gold - laneOpp.gold)}</b></span>` : ''}
    </div></div>` : '';
  const aggHtml = myTeam != null ? `<div class="flex gap-2 mb-3" style="flex-wrap:wrap">
    <span class="badge teal">我方近期均胜率 ${myAgg.wr != null ? pct(myAgg.wr) : '—'}（${myAgg.known}/${myAgg.n} 有数据）</span>
    <span class="badge red">敌方近期均胜率 ${enAgg.wr != null ? pct(enAgg.wr) : '—'}（${enAgg.known}/${enAgg.n} 有数据）</span>
    ${myAgg.wr != null && enAgg.wr != null ? `<span class="badge ${myAgg.wr >= enAgg.wr ? 'green' : 'amber'}">${myAgg.wr >= enAgg.wr ? '我方状态占优' : '敌方状态占优'}</span>` : ''}
  </div>` : '';
  body.innerHTML = metaHtml + aggHtml + laneHtml +
    `<div class="flex gap-2 items-center mb-3" style="flex-wrap:wrap"><button class="btn primary sm" id="scout-all">${icon('search', 14)} 深度侦察十人</button><span class="fs-12 text-3" id="scout-note">打开即自动拉取十人真实历史（只读）；近5状态/主玩/评级随之更新。点任意行下钻。</span></div>` +
    (myTeam != null ? table(mine, '我方阵容', 'text-teal') + table(enemy, '敌方阵容', 'text-red') : table(parts, '全部玩家', ''));
  body.querySelectorAll('.scout-row').forEach(n => n.addEventListener('click', () => { const p = parts.find(x => (x.puuid || '') === n.dataset.puuid); if (p) openScout(p, ctx); }));
  const allBtn = body.querySelector('#scout-all');
  if (allBtn) allBtn.addEventListener('click', () => scoutAll(ctx, body, allBtn));
  // 自动深度侦察：打开即顺序拉真实历史，逐行回写状态/主玩/评级
  scoutAll(ctx, body, allBtn, true);
}

// 逐人深度侦察：拉取该玩家真实历史 + 评级（只读），可继续下钻其单局
async function openScout(p, ctx) {
  const sm = modal({ title: '侦察 · ' + (p.name || '未知'), body: loadingPanel('正在从真实数据源拉取该玩家历史战绩…'), wide: true });
  let prof = null;
  try { prof = await window.nexus.player.profile(p.puuid, { refresh: true, count: 20, serverId: ctx.serverId }); } catch (e) { prof = { __error: String(e.message || e), kind: e.kind }; }
  const b = sm.body;
  if (!prof || prof.__error) {
    b.innerHTML = `<div class="flex items-center gap-2 mb-2">${prof && prof.kind ? kindBadge(prof.kind) : ''}<span class="fs-13 text-2">无法拉取该玩家历史</span></div><div class="fs-12 text-3" style="line-height:1.8">${esc(prof && prof.__error || '需连接客户端或独立通道')}。私密战绩或无记录时为空，不编造。</div>`;
    return;
  }
  const rating = prof.rating || {}, st = prof.stats || {}, player = prof.player || {};
  const rank = prof.rank;
  const head = `<div class="flex items-center gap-3 mb-3">
    <div>${gradeBadge(rating, true)}</div>
    <div style="flex:1"><div class="fw-6 fs-15">${esc(player.name || p.name || '未知')}${p.tagLine ? ' <span class="text-3 fs-12">#' + esc(p.tagLine) + '</span>' : ''}</div>
      <div class="fs-12 text-3 mt-1">${rank && rank.tier ? (RANK_CN[rank.tier.toUpperCase()] || rank.tier) + ' ' + esc(rank.division || '') : '段位未知'} · 缓存 ${st.total || 0} 场 · 胜率 ${pct(st.winRate)} · KDA ${fx(st.avgKDA || 0, 2)}</div>
      <div class="fs-12 text-3 mt-1">${esc(rating.label || '')}${rating.confidence != null ? ' · 评级可信度 ' + Math.round(rating.confidence * 100) + '%' : ''}</div></div>
    <button class="btn ghost sm" id="scout-full">${icon('champion', 14)} 完整档案</button></div>`;
  const reasons = (rating.reasons || []).map(r => `<div class="fs-12 text-2" style="line-height:1.8">· ${esc(r)}</div>`).join('');
  b.innerHTML = head + (reasons ? `<div class="mb-3">${reasons}</div>` : '') +
    `<div class="fs-12 text-3 mb-2">近期真实战绩（${(prof.history && prof.history.matches || []).length} 场 · 点击可下钻单局）${prof.fromCache ? ' · 本地缓存' : ''}</div>`;
  const mw = el('div', { class: 'flex-col gap-2' }); b.appendChild(mw);
  drawMatches(mw, (prof.history && prof.history.matches) || [], p.puuid, ctx.serverId);
  const fullBtn = b.querySelector('#scout-full');
  if (fullBtn) fullBtn.addEventListener('click', () => { sm.close(); navigate('player', { puuid: p.puuid }); });
  // 回写评级到对局表
  if (ctx.ratingBy) { ctx.ratingBy[p.puuid] = { puuid: p.puuid, rating, games: st.total }; }
}

// 批量侦察十人：顺序拉取（限速友好），逐行回写 评级+近5状态+主玩。auto=打开即自动 prefetch。
async function scoutAll(ctx, body, btn, auto) {
  if (btn) btn.disabled = true;
  const note = body.querySelector('#scout-note');
  const targets = ctx.parts.filter(p => p.puuid);
  let done = 0;
  for (const p of targets) {
    if (note) note.textContent = `正在侦察 ${done + 1}/${targets.length}：${p.name || '未知'}…（只读拉取真实历史）`;
    try {
      const prof = await window.nexus.player.profile(p.puuid, { refresh: true, count: 15, serverId: ctx.serverId, modeKey: ctx.modeKey || undefined });
      if (prof && prof.rating) {
        const st = prof.stats || {};
        const matches = (prof.history && prof.history.matches) || [];
        const recent = matches.slice(0, 5).map(m => (m.me ? m.me.win : null));
        const rk = recent.filter(w => w != null).length;
        const top = (st.byChampion || [])[0] || null;
        ctx.ratingBy[p.puuid] = {
          puuid: p.puuid, rating: prof.rating, games: st.total,
          rank: prof.rank || null, recent, recentWinRate: rk ? recent.filter(w => w === true).length / rk : null,
          mainChampionId: top ? top.championId : null, mainGames: top ? top.games : 0, mainWinRate: top ? top.winRate : null,
        };
      }
    } catch {}
    done++;
    const sc = ctx.ratingBy[p.puuid];
    const gradeEl = body.querySelector(`.scout-row[data-puuid="${CSS.escape(p.puuid)}"] .scout-grade`);
    if (gradeEl) gradeEl.innerHTML = sc && sc.rating && sc.rating.grade ? gradeBadge(sc.rating) : '<span class="badge gray">无数据</span>';
    const formEl = body.querySelector(`.scout-row[data-puuid="${CSS.escape(p.puuid)}"] .scout-form`);
    if (formEl && sc && sc.recent && sc.recent.length) {
      const dots = sc.recent.map(w => `<span style="width:8px;height:8px;border-radius:2px;display:inline-block;background:${w === true ? 'var(--green)' : w === false ? 'var(--red)' : 'var(--line-strong)'}"></span>`).join('');
      const tag = sc.recentWinRate != null ? (sc.recentWinRate >= 0.7 ? '<span class="badge green" style="font-size:10px">火热</span>' : sc.recentWinRate <= 0.3 ? '<span class="badge red" style="font-size:10px">低迷</span>' : '') : '';
      formEl.innerHTML = `<span class="flex gap-1 items-center">${dots}${tag}</span>`;
    }
    const mainEl = body.querySelector(`.scout-row[data-puuid="${CSS.escape(p.puuid)}"] .scout-main`);
    if (mainEl && sc && sc.mainChampionId != null) {
      const mc = champBy(sc.mainChampionId);
      mainEl.innerHTML = `<span class="flex items-center gap-1 fs-11">${mc ? `<img src="${asset(mc.imageUrl)}" style="width:16px;height:16px;border-radius:3px"/>` : ''}<span class="text-3">${sc.mainGames}场${sc.mainWinRate != null ? ' ' + pct(sc.mainWinRate) : ''}</span></span>`;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  if (note) note.textContent = `侦察完成 ${done}/${targets.length}：近5状态/主玩/评级均基于各人真实历史；私密/无记录者标「无数据」。点任意行可下钻。`;
  if (btn) btn.disabled = false;
}