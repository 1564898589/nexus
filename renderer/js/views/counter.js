// Counter 克制中心 — matchup lookup + browse.
import { icon } from '../icons.js';
import { el, esc, pct, fx, asset, POS_CN, POSITIONS, sourceTag, toast, champImg, modal, fmtTime, TIER_FILTERS, TIER_FILTERS_CN } from '../util.js';
import { store, navigate, getChamp, loadChampions } from '../store.js';
import { openChampPicker } from '../picker.js';
import { laneGuideHTML, jungleRouteHTML } from './intel-common.js';

let myKey = null, enemyKey = null, pos = 'MID';
let currentMatchup = null;

function pickerBtn(key, label, onPick) {
  const c = key ? getChamp(key) : null;
  return `<button class="btn ghost" data-picker="${label}" style="height:auto;padding:10px 14px;min-width:200px;justify-content:flex-start">
    ${c ? `<img src="${asset(c.imageUrl)}" style="width:36px;height:36px;border-radius:var(--r-sm)"/>` : icon('champion', 20)}
    <span style="text-align:left"><span class="fw-6">${esc(c ? (c.nameCn || c.name) : '选择英雄')}</span><br/><span class="fs-12 text-3">${esc(label)}</span></span>
  </button>`;
}

function tierLabel() {
  const list = store.filter.region === 'cn' ? TIER_FILTERS_CN : TIER_FILTERS;
  const t = list.find(x => x.v === store.filter.tierFilter);
  return t ? t.l : store.filter.tierFilter;
}

export async function render(root, params) {
  await loadChampions();
  myKey = params.key || myKey || 'ahri';
  if (params.enemy) enemyKey = params.enemy;
  pos = params.position || pos;
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('counter', 26, 'accent')} Counter 克制中心 <span class="accent">MATCHUP</span></div>
      <div class="page-sub">OP.GG 韩服 Solo/Duo 排位真实对位样本 + 机制级启发式解读 · 选择我方与敌方英雄查询克制关系</div>
    </div>
    <div class="panel mb-4">
      <div class="flex items-center gap-4" style="flex-wrap:wrap">
        <div id="pick-my">${pickerBtn(myKey, '我方英雄')}</div>
        <button class="btn ghost sm" id="btn-swap" title="互换我方与敌方英雄，从另一侧看克制关系" style="align-self:center">${icon('sync', 16)} 互换</button>
        <div id="pick-enemy">${pickerBtn(enemyKey, '敌方英雄')}</div>
        <div class="top-select"><label>位置</label><select class="nx-select" id="counter-pos">${POSITIONS.map(p => `<option value="${p}" ${p === pos ? 'selected' : ''}>${POS_CN[p]}</option>`).join('')}</select></div>
        <button class="btn primary" id="btn-query">${icon('search', 15)} 查询克制</button>
      </div>
    </div>
    <div id="counter-result"></div>
    <div class="panel mt-4">
      <div class="panel-h">
        <div class="panel-title" id="browse-title">优势 / 劣势对线一览</div>
        <div class="flex gap-2 items-center">
          <button class="btn ghost sm" id="btn-refresh-matchup" title="重新采集当前英雄/位置的对位样本">${icon('sync', 14)} 刷新</button>
          <button class="btn ghost sm" id="btn-crawl" title="采集当前服务器/段位下全部英雄×位置的对位样本（约数分钟，限速 1 页/秒）">${icon('download', 14)} 采集完整对位库</button>
        </div>
      </div>
      <div id="matchup-meta" class="mb-3"></div>
      <div id="browse" class="grid grid-2"></div>
    </div>
  `;
  root.querySelector('#pick-my').addEventListener('click', () => openPicker('my', root));
  root.querySelector('#pick-enemy').addEventListener('click', () => openPicker('enemy', root));
  root.querySelector('#counter-pos').addEventListener('change', (e) => { pos = e.target.value; browse(root); });
  root.querySelector('#btn-query').addEventListener('click', () => query(root));
  root.querySelector('#btn-swap').addEventListener('click', () => swap(root));
  root.querySelector('#btn-refresh-matchup').addEventListener('click', () => browse(root, { force: true }));
  root.querySelector('#btn-crawl').addEventListener('click', () => crawl(root));
  browse(root);
  if (enemyKey) query(root);
  return { onSourcesState: (list) => updateCrawlBtn(root, list) };
}

function openPicker(which, root) {
  openChampPicker({
    title: which === 'my' ? '选择我方英雄' : '选择敌方英雄',
    position: pos,
    hint: `默认按当前查询位置「${POS_CN[pos]}」筛选候选；可切换「全部」浏览所有英雄。`,
    onPick: (key) => {
      if (which === 'my') myKey = key; else enemyKey = key;
      refreshPickers();
      if (which === 'my') browse(root);
      if (myKey && enemyKey) query(root);
    },
  });
}

function refreshPickers() {
  // container listeners are bound once in render(); only replace innerHTML here
  // (re-adding listeners would stack duplicate pickers on every selection).
  const my = document.querySelector('#pick-my'); const en = document.querySelector('#pick-enemy');
  if (my) my.innerHTML = pickerBtn(myKey, '我方英雄');
  if (en) en.innerHTML = pickerBtn(enemyKey, '敌方英雄');
}

function swap(root) {
  if (!myKey || !enemyKey) { toast('先选好我方与敌方英雄，再互换视角', 'info'); return; }
  [myKey, enemyKey] = [enemyKey, myKey];
  refreshPickers();
  browse(root);
  query(root);
}

async function crawl(root) {
  if (store.filter.region !== 'kr') { toast('完整对位库目前仅支持韩服 OP.GG（国服官方榜不提供对位样本）', 'info', 5000); return; }
  const btn = root.querySelector('#btn-crawl');
  btn.disabled = true;
  toast('开始采集完整对位库：当前段位全部英雄×位置，限速 1 页/秒，已有数据自动跳过', 'info', 6000);
  try {
    const r = await window.nexus.sources.refresh('kr-opgg-matchups', {});
    if (r && r.ok) toast(`对位库采集完成：成功 ${r.success} 组 · 失败 ${r.failed} · 样本 ${r.fetched} 条 · 版本 ${r.version}`, 'success', 7000);
    else toast('对位库采集失败：' + ((r && r.error) || '未知错误') + '（已保留原有数据）', 'error', 6000);
  } catch (e) {
    toast('对位库采集失败：' + String(e.message || e), 'error', 6000);
  } finally {
    btn.disabled = false;
    browse(root);
  }
}

function updateCrawlBtn(root, list) {
  const btn = root.querySelector('#btn-crawl');
  if (!btn) return;
  const src = (list || []).find(s => s.id === 'kr-opgg-matchups');
  if (src && src.running && src.progress) {
    btn.disabled = true;
    btn.innerHTML = `${icon('sync', 14)} ${esc(src.progress.message || '采集中…')}`;
  } else if (!btn.disabled || (src && !src.running)) {
    btn.disabled = false;
    btn.innerHTML = `${icon('download', 14)} 采集完整对位库`;
  }
}

function renderMeta(root, d, loading) {
  const node = root.querySelector('#matchup-meta');
  if (!node) return;
  const c = getChamp(myKey);
  const name = c ? (c.nameCn || c.name) : myKey;
  const totalPlay = (d.rows || []).reduce((s, r) => s + (r.play || 0), 0);
  const lowCount = (d.rows || []).filter(r => r.play != null && r.play < 100).length;
  const chips = `<div class="flex gap-3 fs-12 text-3" style="flex-wrap:wrap;margin-top:6px">
    <span>英雄：<span class="text-2">${esc(name)}</span></span>
    <span>位置：<span class="text-2">${esc(POS_CN[pos] || pos)}</span></span>
    <span>版本：<span class="text-2 num">${esc(d.patch || '—')}</span></span>
    <span>段位：<span class="text-2">${esc(tierLabel())}</span></span>
    <span>口径：<span class="text-2">Solo/Duo 排位</span></span>
    <span>更新：<span class="text-2">${d.fetchedAt ? fmtTime(d.fetchedAt) : '—'}</span></span>
    <span>${sourceTag('opgg')}</span>
    ${d.rows && d.rows.length ? `<span>对位 <span class="text-2 num">${d.rows.length}</span> 个 · 合计 <span class="text-2 num">${totalPlay}</span> 场</span>` : ''}
  </div>`;
  let banner;
  if (loading) banner = `<div class="fs-13 text-3">${icon('sync', 14)} 正在采集 ${esc(name)} ${esc(POS_CN[pos] || pos)} 的对位样本…</div>`;
  else if (d.state === 'ok') banner = `<div class="fs-13 text-green">● 数据正常 · ${d.rows.length} 个真实对位样本${lowCount ? ` · 其中 ${lowCount} 个样本偏小（<100 场，已标注，未隐藏）` : ''}</div>`;
  else if (d.state === 'stale') banner = `<div class="fs-13 text-gold">● ${d.error ? '接口异常：' + esc(d.error) + ' · 已保留上次有效数据' : '数据过期（超过 24 小时）'} · 最后成功更新 ${d.fetchedAt ? fmtTime(d.fetchedAt) : '—'} · 点「刷新」重试</div>`;
  else if (d.state === 'failed') banner = `<div class="fs-13 text-red">● 获取失败：${esc(d.error || '未知错误')} · 点「刷新」重试，或「采集完整对位库」批量采集</div>`;
  else if (d.state === 'empty-source') banner = `<div class="fs-13 text-3">● OP.GG 未提供 ${esc(name)} ${esc(POS_CN[pos] || pos)} 的对位样本（低于官方最小样本门槛），不编造数据。</div>`;
  else if (d.state === 'no-stat-row') banner = `<div class="fs-13 text-gold">● 当前筛选无匹配：${esc(tierLabel())} 段位下没有 ${esc(name)} ${esc(POS_CN[pos] || pos)} 的统计行。请切换位置/段位，或先更新 OP.GG 数据。</div>`;
  else if (d.state === 'unsupported-region') banner = `<div class="fs-13 text-3">● 国服官方榜只列出克制英雄 ID，不提供对位胜率与样本；完整对位样本库目前仅韩服 OP.GG 可用。</div>`;
  else banner = `<div class="fs-13 text-3">● 完整对位数据尚未采集 · 点「刷新」采集当前英雄，或「采集完整对位库」批量采集。</div>`;
  node.innerHTML = banner + chips;
}

async function browse(root, opts = {}) {
  const wrap = root.querySelector('#browse');
  const title = root.querySelector('#browse-title');
  const c = getChamp(myKey);
  title.textContent = `${c ? c.nameCn : ''} · ${POS_CN[pos]} 优势 / 劣势对线`;
  wrap.innerHTML = '<div class="skeleton" style="height:120px;grid-column:1/-1"></div>';
  renderMeta(root, {}, true);
  let d;
  try { d = await window.nexus.counter.matchup(myKey, pos, opts); }
  catch (e) { d = { state: 'failed', rows: [], error: String(e.message || e) }; }
  if (!d || d.__error) d = { state: 'failed', rows: [], error: (d && d.__error) || '接口返回异常' };
  currentMatchup = d;
  renderMeta(root, d, false);

  const delta = (r) => {
    if (d.overallWinRate == null || r.winRate == null) return '';
    const pp = (r.winRate - d.overallWinRate) * 100;
    return `<span class="fs-12 num ${pp >= 0 ? 'text-green' : 'text-red'}" title="相对 ${esc(c ? c.nameCn : myKey)} 整体胜率 ${fx(d.overallWinRate * 100)}% 的差值">${pp >= 0 ? '+' : ''}${fx(pp)}pp</span>`;
  };
  const col = (label, list, cls) => `<div><div class="section-title" style="font-size:13px">${label}</div><div class="flex-col gap-1">${
    list.length ? list.slice(0, 15).map(x => { const ch = getChamp(x.opponentKey || x.championKey) || {}; const key = x.opponentKey || x.championKey; const low = x.play != null && x.play < 100;
      return `<div class="flex items-center gap-2" data-key="${esc(key)}" title="${x.play || 0} 场真实对局${low ? ' · 样本偏小，仅供参考' : ''}" style="padding:6px;border-radius:var(--r-md);cursor:pointer">
      <img src="${asset(ch.imageUrl)}" style="width:32px;height:32px;border-radius:var(--r-sm)"/><span style="flex:1" class="fs-13 truncate">${esc(ch.nameCn || ch.name || x.championName || '未知英雄')}</span>
      ${low ? '<span class="badge gray" style="font-size:11px">样本不足</span>' : ''}
      ${delta(x)}<span class="num ${cls}">${pct(x.winRate)}</span><span class="fs-12 text-3 num">${x.play || 0}场</span></div>`; }).join('') : '<div class="text-3 fs-13">暂无样本</div>'
  }</div></div>`;

  if (d.rows && d.rows.length) {
    const strong = d.rows.filter(r => r.winRate >= 0.5).sort((a, b) => b.winRate - a.winRate);
    const weak = d.rows.filter(r => r.winRate < 0.5).sort((a, b) => a.winRate - b.winRate);
    wrap.innerHTML = col(`优势对线（${strong.length}）`, strong, 'text-green') + col(`劣势对线（${weak.length}）`, weak, 'text-red');
  } else {
    // 回退：强度榜内嵌摘要（双向），明确标注口径
    let cd = null;
    try { cd = await window.nexus.data.counters(myKey, pos); } catch {}
    if (cd && (cd.strong.length || cd.weak.length)) {
      const mapX = (x) => ({ opponentKey: x.championKey, championName: x.championName, winRate: x.winRate, play: x.play });
      wrap.innerHTML = col('优势对线（强度榜摘要）', cd.strong.map(mapX), 'text-green') + col('劣势对线（强度榜摘要）', cd.weak.map(mapX), 'text-red');
    } else {
      wrap.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${icon('counter', 40)}<div class="es-title">当前条件下暂无可显示的对位样本</div><div class="fs-12 text-3">原因见上方状态条。不编造胜率与克制关系。</div></div>`;
    }
  }
  wrap.querySelectorAll('[data-key]').forEach(n => n.addEventListener('click', () => { enemyKey = n.dataset.key; refreshPickers(); query(root); }));
}

async function query(root) {
  const out = root.querySelector('#counter-result');
  if (!myKey || !enemyKey) { toast('请先选择我方与敌方英雄', 'info'); return; }
  out.innerHTML = '<div class="panel"><div class="skeleton" style="height:120px"></div></div>';
  const my = getChamp(myKey), en = getChamp(enemyKey);
  let res;
  try { res = await window.nexus.analysis.counter(myKey, enemyKey, pos); }
  catch (e) { out.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 40)}<div class="es-title">查询失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary sm mt-3" id="cq-retry">重试</button></div></div>`; out.querySelector('#cq-retry').addEventListener('click', () => query(root)); return; }
  // 完整对位页直接命中（我方视角）优先展示
  const full = currentMatchup && currentMatchup.rows && currentMatchup.rows.find(r => r.opponentKey === enemyKey);
  let realHtml;
  if (full) {
    const pp = currentMatchup.overallWinRate != null ? ((full.winRate - currentMatchup.overallWinRate) * 100) : null;
    const low = full.play != null && full.play < 100;
    realHtml = `
      <div class="fs-13 text-2 mb-2" style="line-height:1.7">OP.GG 韩服对位页（${esc(my.nameCn)} 视角）：对线 ${esc(en.nameCn)} 胜率 <span class="num fw-6">${pct(full.winRate)}</span>（<span class="num">${full.play}</span> 场真实样本${pp != null ? `，相对整体胜率 ${pp >= 0 ? '+' : ''}${fx(pp)}pp` : ''}）。</div>
      <div class="fs-13 text-2 mb-2">${full.winRate >= 0.5 ? '该对位我方占优。' : '该对位我方偏劣。'}${low ? ' 样本偏小（<100 场），仅供参考。' : ''}</div>
      <div class="mt-2">${sourceTag('opgg')}<span class="badge teal" style="margin-left:6px">完整对位页</span>${low ? '<span class="badge gray" style="margin-left:6px">样本不足</span>' : ''}</div>`;
  } else {
    realHtml = `${(res.real || []).map(r => `<div class="fs-13 text-2 mb-2" style="line-height:1.7">${esc(r)}</div>`).join('')}
      <div class="mt-2">${sourceTag(res.region === 'cn' ? 'cn101' : 'opgg')}${res.fromMatchup ? '<span class="badge teal" style="margin-left:6px">完整对位页</span>' : res.perspective ? `<span class="badge gray" style="margin-left:6px">${res.perspective === 'mine' ? '我方视角摘要' : '敌方视角摘要'}</span>` : ''}</div>`;
  }
  out.innerHTML = `<div class="panel">
    <div class="flex items-center gap-4 mb-4">
      <div class="flex items-center gap-2">${champImg(my, 'item-icon')}<span class="fw-6 fs-16">${esc(my.nameCn)}</span></div>
      <span class="text-3">VS</span>
      <div class="flex items-center gap-2">${champImg(en, 'item-icon')}<span class="fw-6 fs-16">${esc(en.nameCn)}</span></div>
      <span class="badge teal">${esc(POS_CN[pos])}</span>
      <button class="btn ghost sm" id="cq-swap" style="margin-left:auto" title="互换视角，看对方英雄怎么打你">${icon('sync', 14)} 互换视角</button>
    </div>
    <div class="grid grid-2">
      <div><div class="section-title" style="font-size:13px">真实数据</div>${realHtml}</div>
      <div><div class="section-title" style="font-size:13px">机制解读</div>${(res.reason || []).map(r => `<div class="flex gap-2 mb-2">${icon('spark', 14, 'text-teal')}<span class="fs-13 text-2" style="line-height:1.7">${esc(r)}</span></div>`).join('')}<div class="mt-2">${sourceTag('heuristic')}</div></div>
    </div>
    <div class="divider"></div><div class="fs-12 text-3">${esc(res.note || '')}</div>
    <div id="counter-guide" class="mt-3"></div>
  </div>`;
  const sw = out.querySelector('#cq-swap'); if (sw) sw.addEventListener('click', () => swap(root));
  // 机制级对线指南（+打野位刷野路线）：冠军专属，启发式，独立异步加载不阻塞主面板
  (async () => {
    const node = out.querySelector('#counter-guide');
    if (!node) return;
    node.innerHTML = '<div class="fs-12 text-3">生成对线指南…</div>';
    let html = '';
    try {
      const g = await window.nexus.analysis.laneGuide(myKey, enemyKey, pos);
      if (g && !g.__error) html += laneGuideHTML(g);
    } catch {}
    if (pos === 'JUNGLE') {
      try {
        const r = await window.nexus.analysis.jungleRoute(myKey, enemyKey);
        if (r && !r.__error) html += jungleRouteHTML(r);
      } catch {}
    }
    node.innerHTML = html || '<div class="fs-12 text-3">对线指南不可用（英雄数据缺失）。</div>';
  })();
}