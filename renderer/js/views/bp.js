// BP 模拟器 — Ban/Pick Simulator + composition analysis.
// 选人槽位与位置真实联动：点击某路槽位 → 选择器默认该路候选（真实 OP.GG 按位置统计）。
import { icon } from '../icons.js';
import { el, esc, pct, fx, asset, POS_CN, POSITIONS, sourceTag, toast, modal, confirmDialog, champImg } from '../util.js';
import { store, navigate, getChamp, loadChampions } from '../store.js';
import { radar, donut, hbar } from '../charts.js';
import { openChampPicker, loadPersonal } from '../picker.js';
import { aiBlock, bindAi } from './intel-common.js';

const DIMS = ['engage', 'poke', 'splitpush', 'waveclear', 'frontline', 'peel', 'cc', 'burst', 'dps', 'mobility', 'sustain', 'early', 'late'];
let bp = null;
let history = [];
let adviceSide = 'blue';
let personalMap = {};
let analyzeSeq = 0;

function freshBp() {
  return { blue: [null, null, null, null, null], red: [null, null, null, null, null], blueBans: [null, null, null, null, null], redBans: [null, null, null, null, null] };
}
function snapshot() { history.push(JSON.stringify(bp)); if (history.length > 50) history.shift(); }
function allPicked() { return [...bp.blue, ...bp.red].filter(Boolean).map(p => p.key); }
function allBanned() { return [...bp.blueBans, ...bp.redBans].filter(Boolean); }
function takenMap() {
  const m = new Map();
  for (const k of allPicked()) m.set(k, '已选');
  for (const k of allBanned()) m.set(k, '已禁');
  return m;
}

export async function render(root) {
  await loadChampions();
  if (!bp) bp = freshBp();
  loadPersonal().then(m => { personalMap = m || {}; });
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('bp', 26, 'accent')} BP 模拟器 <span class="accent">DRAFT</span></div>
      <div class="page-sub">自由 Ban / Pick · 点击槽位按位置筛选候选（真实 OP.GG 统计）· 实时阵容分析 + 分路选人建议 · 可保存 / 载入方案</div>
    </div>
    <div class="panel tight mb-4">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <button class="btn ghost sm" id="bp-undo">${icon('undo', 15)} 撤销</button>
        <button class="btn ghost sm" id="bp-reset">${icon('reset', 15)} 重置</button>
        <div class="divider" style="width:1px;height:24px;margin:0 6px"></div>
        <button class="btn primary sm" id="bp-save">${icon('save', 15)} 保存方案</button>
        <button class="btn ghost sm" id="bp-load">${icon('upload', 15)} 载入方案</button>
        <div style="flex:1"></div>
        <button class="btn ghost sm" id="bp-prep">${icon('prep', 15)} 存入对局准备</button>
        <span class="fs-12 text-3" id="bp-count"></span>
      </div>
    </div>
    <div id="bp-live" class="mb-4"></div>
    <div class="bp-board mb-4">
      <div class="bp-side blue">
        <div class="bp-side-title">蓝色方 BLUE</div>
        <div class="fs-12 text-3 mb-2">禁用</div>
        <div class="bp-bans" id="blue-bans"></div>
        <div class="fs-12 text-3 mb-2">选用</div>
        <div id="blue-picks"></div>
      </div>
      <div class="bp-side red">
        <div class="bp-side-title">红色方 RED</div>
        <div class="fs-12 text-3 mb-2">禁用</div>
        <div class="bp-bans" id="red-bans"></div>
        <div class="fs-12 text-3 mb-2">选用</div>
        <div id="red-picks"></div>
      </div>
    </div>
    <div id="bp-analysis"></div>
  `;
  root.querySelector('#bp-undo').addEventListener('click', () => { if (history.length) { bp = JSON.parse(history.pop()); drawBoard(root); analyze(root); toast('已撤销上一步', 'info', 1500); } else toast('没有可撤销的操作', 'info'); });
  root.querySelector('#bp-reset').addEventListener('click', async () => { if (await confirmDialog({ title: '重置 BP', message: '确定清空当前所有 Ban / Pick？', confirmText: '重置', danger: true })) { snapshot(); bp = freshBp(); drawBoard(root); analyze(root); toast('BP 已重置', 'success', 1800); } });
  root.querySelector('#bp-save').addEventListener('click', () => saveBp(root));
  root.querySelector('#bp-load').addEventListener('click', () => loadBp(root));
  root.querySelector('#bp-prep').addEventListener('click', () => toPrep(root));
  renderLiveBanner(root);
  drawBoard(root);
  analyze(root);
  return {};
}

// 实时选人联动：检测到客户端选人阵容时提供「载入到棋盘」，把真实 draft（含 ban）灌入 BP 模拟器
function renderLiveBanner(root) {
  const node = root.querySelector('#bp-live');
  if (!node) return;
  const b = store.bpBoard;
  if (!b || !b.fromLive || (!(b.myPicks || []).length && !(b.enemyPicks || []).length)) { node.innerHTML = ''; return; }
  const en = (b.enemyPicks || []).length, my = (b.myPicks || []).length;
  const banN = ((b.liveBans && b.liveBans.my) || []).length + ((b.liveBans && b.liveBans.enemy) || []).length;
  node.innerHTML = `<div class="panel tight" style="border-color:var(--teal)">
    <div class="flex items-center gap-2" style="flex-wrap:wrap">
      ${icon('lcu', 16, 'text-teal')}
      <span class="fs-13 fw-6">检测到实时选人阵容</span>
      <span class="fs-12 text-3">我方 ${my} 人 · 敌方 ${en} 人 · ban ${banN} 个（客户端只读）</span>
      <button class="btn primary sm" id="bp-load-live" style="margin-left:auto">${icon('download', 14)} 载入到棋盘</button>
    </div>
  </div>`;
  node.querySelector('#bp-load-live').addEventListener('click', () => {
    snapshot();
    bp = freshBp();
    (b.myPicks || []).slice(0, 5).forEach((p, i) => { if (p && p.key) bp.blue[i] = { key: p.key }; });
    (b.enemyPicks || []).slice(0, 5).forEach((p, i) => { if (p && p.key) bp.red[i] = { key: p.key }; });
    ((b.liveBans && b.liveBans.my) || []).slice(0, 5).forEach((k, i) => { bp.blueBans[i] = k; });
    ((b.liveBans && b.liveBans.enemy) || []).slice(0, 5).forEach((k, i) => { bp.redBans[i] = k; });
    drawBoard(root); analyze(root);
    toast('已载入实时选人阵容（我方蓝/敌方红），可继续手动调整', 'success', 2600);
  });
}

function flashSlot(root, side, type, i) {
  const sel = type === 'ban' ? `#${side}-bans .ban-slot[data-ban="${i}"]` : `#${side}-picks .bp-slot[data-pick="${i}"]`;
  const n = root.querySelector(sel);
  if (n) { n.classList.add('flash'); setTimeout(() => n.classList.remove('flash'), 700); }
}

function drawBoard(root) {
  const undoBtn = root.querySelector('#bp-undo');
  if (undoBtn) { undoBtn.disabled = !history.length; undoBtn.title = history.length ? '撤销上一步' : '暂无可撤销的操作'; }
  for (const side of ['blue', 'red']) {
    const bans = root.querySelector(`#${side}-bans`);
    bans.innerHTML = bp[side + 'Bans'].map((k, i) => {
      const c = k ? getChamp(k) : null;
      return `<div class="ban-slot ${k ? 'filled' : ''}" data-side="${side}" data-ban="${i}" title="${c ? esc(c.nameCn) + ' · 点击移除' : '点击禁用（全部位置候选）'}">${c ? `<img src="${asset(c.imageUrl)}"/><span class="ban-x">×</span>` : icon('plus', 14)}</div>`;
    }).join('');
    bans.querySelectorAll('.ban-slot').forEach(n => n.addEventListener('click', () => {
      const i = +n.dataset.ban;
      if (bp[side + 'Bans'][i]) { snapshot(); bp[side + 'Bans'][i] = null; drawBoard(root); analyze(root); }
      else {
        n.classList.add('selecting');
        openChampPicker({
          title: `禁用英雄 · ${side === 'blue' ? '蓝色方' : '红色方'}（全部位置模式）`,
          position: 'all', taken: takenMap(),
          hint: '禁用不限制位置：当前为全部位置模式，可切换位置缩小范围。已选 / 已禁英雄自动置灰。',
          onClose: () => n.classList.remove('selecting'),
          onPick: (key) => { snapshot(); bp[side + 'Bans'][i] = key; drawBoard(root); flashSlot(root, side, 'ban', i); analyze(root); },
        });
      }
    }));

    const picks = root.querySelector(`#${side}-picks`);
    picks.innerHTML = bp[side].map((p, i) => {
      const c = p ? getChamp(p.key) : null;
      return `<div class="bp-slot ${p ? 'filled' : ''}" data-side="${side}" data-pick="${i}">
        <span class="slot-pos">${POS_CN[POSITIONS[i]]}</span>
        ${c ? `<img src="${asset(c.imageUrl)}"/><div style="flex:1"><div class="slot-name">${esc(c.nameCn)}</div><div class="fs-12 text-3">${esc(c.titleCn || '')} · 点击可替换</div></div><button class="btn icon sm ghost slot-clear" title="移除">${icon('close', 13)}</button>`
          : `<span class="slot-empty">点击选择 ${POS_CN[POSITIONS[i]]} 英雄</span>`}
      </div>`;
    }).join('');
    picks.querySelectorAll('.bp-slot').forEach(n => {
      const i = +n.dataset.pick;
      n.addEventListener('click', (e) => {
        if (e.target.closest('.slot-clear')) { snapshot(); bp[side][i] = null; drawBoard(root); analyze(root); return; }
        const pos = POSITIONS[i];
        n.classList.add('selecting');
        openChampPicker({
          title: `选择 ${POS_CN[pos]} · ${side === 'blue' ? '蓝色方' : '红色方'}${bp[side][i] ? '（替换）' : ''}`,
          position: pos, taken: takenMap(),
          hint: `候选来自 OP.GG ${POS_CN[pos]}真实统计；多位置英雄按数据出现。可切换「全部」浏览所有英雄。`,
          onClose: () => n.classList.remove('selecting'),
          onPick: (key) => { snapshot(); bp[side][i] = { key, position: pos }; drawBoard(root); flashSlot(root, side, 'pick', i); analyze(root); },
        });
      });
    });
  }
  const total = allPicked().length;
  root.querySelector('#bp-count').textContent = `已选 ${total}/10 · 禁用 ${allBanned().length}/10`;
}

async function analyze(root) {
  const wrap = root.querySelector('#bp-analysis');
  if (!wrap) return;
  // 装备规划联动：广播当前棋盘（我方/敌方/禁用），出装页订阅后自动重算针对出装
  const otherSide = adviceSide === 'blue' ? 'red' : 'blue';
  store.bpBoard = { my: adviceSide, myPicks: bp[adviceSide].filter(Boolean), enemyPicks: bp[otherSide].filter(Boolean), bans: allBanned() };
  window.dispatchEvent(new CustomEvent('nexus-bp-board', { detail: store.bpBoard }));
  const mySeq = ++analyzeSeq;
  const blue = bp.blue, red = bp.red;
  const blueCount = blue.filter(Boolean).length, redCount = red.filter(Boolean).length;
  if (!blueCount && !redCount) {
    wrap.innerHTML = `<div class="panel"><div class="empty-state">${icon('bp', 48)}<div class="es-title">开始你的 BP</div><div>点击任意槽位选择英雄（自动按该路筛选候选）。选人后这里会实时展示阵容维度分析、对位评估与分路选人建议。</div></div></div>`;
    return;
  }
  wrap.innerHTML = '<div class="panel"><div class="skeleton" style="height:200px"></div></div>';
  const my = adviceSide === 'blue' ? blue : red;
  const enemy = adviceSide === 'blue' ? red : blue;
  let cmp, advice;
  try {
    [cmp, advice] = await Promise.all([
      window.nexus.analysis.compare(blue, red),
      window.nexus.analysis.pickAdviceByPosition(my, enemy, allBanned(), personalMap, store.config.mainChampions || []),
    ]);
  } catch (e) {
    if (mySeq !== analyzeSeq) return;
    wrap.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 40)}<div class="es-title">分析加载失败</div><div>${esc(String(e.message || e))}</div><button class="btn primary sm mt-3" id="bp-retry">重试</button></div></div>`;
    const r = wrap.querySelector('#bp-retry'); if (r) r.addEventListener('click', () => analyze(root));
    return;
  }
  if (mySeq !== analyzeSeq) return; // a newer board change already re-rendered
  const A = cmp.blue, B = cmp.red;
  const teamPanel = (side, T, color) => `
    <div class="panel">
      <div class="panel-h"><div class="panel-title" style="color:${color}">${side === 'blue' ? '蓝色方' : '红色方'}阵容</div>${sourceTag('heuristic')}</div>
      <div class="flex gap-4 items-center">
        <div style="flex:1">${radar(T.scores, DIMS, { size: 260, color })}</div>
        <div class="flex-col items-center gap-2">${donut(T.profile.ad, T.profile.ap, { size: 110 })}<div class="fs-12 text-3">魔法 ${T.profile.ap}%</div></div>
      </div>
      <div class="divider"></div>
      <div class="grid grid-2">
        <div><div class="fs-12 text-green fw-6 mb-2">优势</div>${T.strengths.map(s => `<div class="fs-12 text-2 mb-1">· ${esc(s)}</div>`).join('') || '<div class="fs-12 text-3">—</div>'}</div>
        <div><div class="fs-12 text-red fw-6 mb-2">短板</div>${T.weaknesses.map(s => `<div class="fs-12 text-2 mb-1">· ${esc(s)}</div>`).join('') || '<div class="fs-12 text-3">—</div>'}</div>
      </div>
    </div>`;

  const lanes = (cmp.lanes || []).map(l => {
    const v = l.verdict;
    const badge = v === 'blue' ? '<span class="badge teal">蓝优</span>' : v === 'red' ? '<span class="badge red">红优</span>' : v === 'even' ? '<span class="badge gray">均势</span>' : '<span class="badge gray">未选满</span>';
    return `<div class="flex items-center gap-3" style="padding:7px 0;border-bottom:1px solid var(--line-soft)">
      <span class="fs-12 text-3" style="width:48px">${POS_CN[l.position]}</span>${badge}
      <span class="fs-12 text-2" style="flex:1">${l.real ? esc(l.real) : (v === 'incomplete' ? '双方未选满' : '机制评估')}</span>
      ${l.score != null ? `<span class="num fs-12 ${l.score > 0 ? 'text-teal' : l.score < 0 ? 'text-red' : 'text-3'}">${l.score > 0 ? '+' : ''}${fx(l.score)}</span>` : ''}
    </div>`;
  }).join('');

  const sideName = adviceSide === 'blue' ? '蓝色方' : '红色方';
  const groups = (advice && advice.byPosition) || [];
  const perCount = Object.keys(personalMap || {}).length;
  const adviceHtml = `
    <div class="panel mt-4">
      <div class="panel-h">
        <div class="panel-title">${sideName}分路选人建议</div>
        <div class="flex gap-2 items-center">
          ${sourceTag('heuristic')}${sourceTag('opgg')}
          <div class="chip-row">
            <button class="chip ${adviceSide === 'blue' ? 'active' : ''}" id="adv-blue">蓝方</button>
            <button class="chip ${adviceSide === 'red' ? 'active' : ''}" id="adv-red">红方</button>
          </div>
        </div>
      </div>
      ${perCount ? `<div class="fs-12 text-3 mb-2">已结合你的个人英雄池（${perCount} 个英雄的缓存真实对局）；「擅长」标记来自你的实际战绩。</div>` : ''}
      ${groups.length ? groups.map(g => `
        <div class="bp-advice-pos">
          <span class="badge teal">${POS_CN[g.position]}</span>
          ${store.config.mainRole === g.position ? '<span class="badge gold">你的主打位置</span>' : ''}
          <span class="fs-12 text-3">${g.needs && g.needs.length ? '该路补强方向：' + g.needs.map(n => ({ frontline: '前排', engage: '开团', cc: '控制', peel: '保护', dps: '输出', ad: '物理伤害', ap: '魔法伤害' }[n] || n)).join('、') : '按该位置真实强度排序'}</span>
        </div>
        ${g.suggestions.length ? `<div class="grid grid-4">${g.suggestions.slice(0, 4).map(s => {
          const c = s.champion;
          return `<div class="stat-card" style="cursor:pointer" data-key="${esc(c.key)}" data-slot="${g.slotIndex}" title="点击填入${sideName}${POS_CN[g.position]}">
            <div class="flex items-center gap-2 mb-2"><img src="${asset(c.imageUrl)}" style="width:36px;height:36px;border-radius:var(--r-sm)"/><div><div class="fw-6 fs-13">${esc(c.nameCn || c.name)}</div>${s.tier != null ? `<span class="badge gold" style="font-size:11px">T${s.tier}</span>` : ''} ${s.personal ? `<span class="badge teal" style="font-size:11px">擅长 ${s.personal.games}场</span>` : ''} ${s.signature ? '<span class="badge purple" style="font-size:11px">常用</span>' : ''}</div></div>
            <div class="fs-12 text-2" style="line-height:1.6">${(s.reasons || []).map(r => esc(r)).join('<br/>')}</div>
            ${s.risky ? '<div class="badge red mt-2" style="font-size:11px">存在克制风险</div>' : ''}
          </div>`;
        }).join('')}</div>` : '<div class="fs-12 text-3 mb-2">该位置暂无可用统计候选。</div>'}
      `).join('') : `<div class="empty-state">${icon('check', 40)}<div class="es-title">${sideName}已选满五路</div><div>切换另一方查看建议，或继续完善禁用。</div></div>`}
      <div class="mt-3 fs-12 text-3">${esc(advice.note || '')} 点击建议卡片可直接填入对应位置的空槽。</div>
    </div>`;

  wrap.innerHTML = `
    <div class="grid grid-2">${teamPanel('blue', A, '#0AC8B9')}${teamPanel('red', B, '#E84057')}</div>
    <div class="panel mt-4">
      <div class="panel-h"><div class="panel-title">对位评估</div><div class="flex gap-2 items-center">${sourceTag('heuristic')}<span class="badge ${cmp.overall === 'blue' ? 'teal' : cmp.overall === 'red' ? 'red' : 'gray'}">总体 ${cmp.overall === 'blue' ? '蓝优' : cmp.overall === 'red' ? '红优' : '均势'} (${cmp.blueWins}:${cmp.redWins})</span></div></div>
      ${lanes}
      <div class="mt-3 fs-12 text-3">${esc(cmp.note || '')}</div>
    </div>
    ${adviceHtml}
    ${aiBlock('bp-ai', { title: 'AI BP 推演' })}
  `;
  const nameOf = (p) => p ? ((getChamp(p.key) || {}).nameCn || p.key) : null;
  bindAi(wrap, 'bp-ai', 'bp', () => ({
    data: {
      blue: bp.blue.map(p => p ? { champion: nameOf(p), position: p.position } : null),
      red: bp.red.map(p => p ? { champion: nameOf(p), position: p.position } : null),
      bans: allBanned(), dimensions: { blue: A.scores, red: B.scores },
      laneVerdicts: cmp.lanes, overall: cmp.overall, note: cmp.note,
    },
    rules: { facts: [`总体评估 ${cmp.overall === 'blue' ? '蓝优' : cmp.overall === 'red' ? '红优' : '均势'}（${cmp.blueWins}:${cmp.redWins}）`], inferences: (cmp.lanes || []).filter(l => l.detail).map(l => l.detail), advice: [] },
  }), {
    variant: 'bp', subject: 'bp', dataRange: `当前 BP 棋盘 · 蓝 ${blueCount}/5 红 ${redCount}/5 · 规则维度评估`,
    charts: { radar: { scores: A.scores, dims: Object.keys(A.scores || {}), compare: B.scores, note: '蓝方 vs 红方阵容维度（0–100，规则推导）' } },
  });
  wrap.querySelector('#adv-blue').addEventListener('click', () => { if (adviceSide !== 'blue') { adviceSide = 'blue'; analyze(root); } });
  wrap.querySelector('#adv-red').addEventListener('click', () => { if (adviceSide !== 'red') { adviceSide = 'red'; analyze(root); } });
  wrap.querySelectorAll('.stat-card[data-key]').forEach(n => n.addEventListener('click', () => {
    const idx = +n.dataset.slot;
    const team = adviceSide === 'blue' ? bp.blue : bp.red;
    if (team[idx]) { toast(`该位置已选英雄：请先移除或点击槽位替换`, 'info'); return; }
    snapshot();
    team[idx] = { key: n.dataset.key, position: POSITIONS[idx] };
    drawBoard(root); flashSlot(root, adviceSide, 'pick', idx); analyze(root);
    const gc = getChamp(n.dataset.key) || {};
    toast(`已填入${sideName}${POS_CN[POSITIONS[idx]]}：${gc.nameCn || gc.name || n.dataset.key}`, 'success', 2200);
  }));
}

async function saveBp(root) {
  const input = el('input', { class: 'nx-input', placeholder: '方案名称，如「季后赛蓝色方」', value: 'BP 方案 ' + new Date().toLocaleDateString('zh-CN') });
  const m = modal({ title: '保存 BP 方案', body: el('div', {}, [el('div', { class: 'field' }, [el('label', { text: '方案名称' }), input])]),
    foot: el('button', { class: 'btn primary', text: '保存', onClick: async () => { const rec = await window.nexus.bp.save(input.value.trim() || '未命名', bp); m.close(); toast('已保存：' + rec.name, 'success'); } }) });
}
async function loadBp(root) {
  const list = await window.nexus.bp.list();
  if (!list.length) { toast('暂无已保存方案', 'info'); return; }
  const body = el('div', { class: 'flex-col gap-2' });
  for (const item of list) {
    const row = el('div', { class: 'flex items-center gap-3', style: { padding: '10px', border: '1px solid var(--line)', borderRadius: '10px' } }, [
      el('div', { style: { flex: '1' }, html: `<div class="fw-6">${esc(item.name)}</div><div class="fs-12 text-3">${esc(item.createdAt)}</div>` }),
      el('button', { class: 'btn primary sm', text: '载入', onClick: async () => { const rec = await window.nexus.bp.load(item.id); if (rec && rec.data) { snapshot(); bp = rec.data; m.close(); drawBoard(root); analyze(root); toast('已载入：' + rec.name, 'success'); } } }),
      el('button', { class: 'btn danger sm icon', html: icon('trash', 14), onClick: async () => { await window.nexus.bp.delete(item.id); m.close(); loadBp(root); } }),
    ]);
    body.appendChild(row);
  }
  const m = modal({ title: '载入 BP 方案', body });
}
async function toPrep(root) {
  const name = 'BP 准备 ' + new Date().toLocaleDateString('zh-CN');
  await window.nexus.prep.save(name, { bp, note: '' });
  toast('已存入对局准备工作台', 'success');
}