// Player Growth — trend analysis over cached real matches (recent vs older windows).
import { icon } from '../icons.js';
import { esc, asset, pct, fx, sourceTag } from '../util.js';
import { sparkline, hbar } from '../charts.js';
import { accountBar, champBy, taggedReport, aiBlock, bindAi, modeChipsFromCounts } from './intel-common.js';

let puuid = null;
let growthMode = 'all';

export async function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('arrowUp', 26, 'accent')} 个人成长 <span class="accent">GROWTH</span></div>
      <div class="page-sub">按模式区分的真实战绩趋势 · 近期 vs 此前 · 英雄池演变 · 全部结论标注事实 / 推断 / 建议</div>
    </div>
    <div class="panel tight mb-4" id="intel-account"></div>
    <div id="growth-mode" class="mb-3"></div>
    <div id="growth-body"></div>`;
  const cfg = await window.nexus.config.get().catch(() => ({}));
  const self = (cfg && (cfg.selfPuuid || cfg.intelPuuid)) || null;
  puuid = await accountBar(root, self || puuid, (p) => { puuid = p; load(root); });
  await load(root);
}

function drawModeChips(root, modes) {
  const box = root.querySelector('#growth-mode');
  if (!box) return;
  box.innerHTML = '';
  box.appendChild(modeChipsFromCounts(modes, growthMode, (k) => { growthMode = k; load(root); }));
}

async function load(root) {
  const body = root.querySelector('#growth-body');
  if (!puuid) { body.innerHTML = '<div class="panel"><div class="empty-state">' + icon('arrowUp', 40) + '<div class="es-title">暂无可分析账号</div><div>请先在玩家战绩中心查询战绩。</div></div></div>'; return; }
  body.innerHTML = '<div class="panel"><div class="empty-state">' + icon('sync', 36) + '<div class="es-title">分析中…</div></div></div>';
  const r = await window.nexus.growth.report(puuid, growthMode);
  if (!r || r.__error) { body.innerHTML = `<div class="panel"><div class="empty-state">${icon('warn', 36)}<div class="es-title">无法分析</div><div>${esc(r && r.__error || '')}</div></div></div>`; return; }
  if (r.modes) {
    if (growthMode !== 'all' && !r.modes.some(x => x.key === growthMode)) { growthMode = 'all'; drawModeChips(root, r.modes); return load(root); }
    drawModeChips(root, r.modes);
  }
  if (!r.enough) {
    body.innerHTML = `<div class="panel"><div class="empty-state">${icon('arrowUp', 40)}<div class="es-title">样本不足</div><div>${esc(r.facts[0])}</div></div>${taggedReport(r)}</div>`;
    return;
  }
  const s = r.series;
  const wins = s.map(x => x.win);
  const kdas = s.map(x => x.kda);
  const name = (r.player && r.player.name) || '该玩家';
  const pool = (r.stats && r.stats.byChampion || []).slice(0, 8);
  body.innerHTML = `
    <div class="grid grid-2 mb-4">
      <div class="panel">
        <div class="panel-h"><div class="panel-title">胜负走势 · ${esc(r.mode || '全部模式')}（旧 → 新，${s.length} 场）</div>${sourceTag('lcu')}</div>
        <div class="flex gap-1" style="flex-wrap:wrap">${wins.map(w => `<span style="width:14px;height:22px;border-radius:var(--r-sm);background:${w ? 'var(--teal)' : 'var(--red)'};opacity:${w ? 0.9 : 0.75}" title="${w ? '胜' : '负'}"></span>`).join('')}</div>
        <div class="fs-12 text-3 mt-2">绿=胜 · 红=负 · 来自缓存真实对局</div>
      </div>
      <div class="panel">
        <div class="panel-h"><div class="panel-title">KDA 走势</div>${sourceTag('lcu')}</div>
        ${sparkline(kdas, { width: 320, height: 64, color: '#F0C75E' })}
        <div class="fs-12 text-3 mt-2">最低 ${fx(Math.min(...kdas))} · 最高 ${fx(Math.max(...kdas))}</div>
      </div>
    </div>
    <div class="grid grid-2 mb-4">
      <div class="panel">
        <div class="panel-h"><div class="panel-title">近期 vs 此前</div>${sourceTag('heuristic')}</div>
        ${hbar('近期胜率 ' + pct(r.recent.winRate), r.recent.winRate * 100, 100, { color: 'var(--teal)', suffix: '%' })}
        ${r.older ? hbar('此前胜率 ' + pct(r.older.winRate), r.older.winRate * 100, 100, { color: 'var(--blue)', suffix: '%' }) : ''}
        ${hbar('近期 KDA ' + fx(r.recent.kda, 2), Math.min(100, r.recent.kda * 15), 100, { color: 'var(--gold-bright)' })}
        ${r.older ? hbar('此前 KDA ' + fx(r.older.kda, 2), Math.min(100, r.older.kda * 15), 100, { color: 'var(--purple)' }) : ''}
        <div class="fs-12 text-3 mt-2">近期 ${r.recent.games} 场${r.older ? ' · 此前 ' + r.older.games + ' 场' : ''} · KDA 条为示意刻度（×15），非胜率。</div>
      </div>
      <div class="panel">
        <div class="panel-h"><div class="panel-title">英雄池（缓存统计）</div>${sourceTag('lcu')}</div>
        ${pool.length ? pool.map(c => { const ch = champBy(c.championId); return `<div class="flex items-center gap-2 fs-12 mb-1">
          ${ch ? `<img src="${asset(ch.imageUrl)}" style="width:24px;height:24px;border-radius:var(--r-sm)"/>` : ''}
          <span style="flex:1">${ch ? esc(ch.nameCn) : '#' + c.championId}</span>
          <span class="text-3">${c.games}场</span><span class="${c.winRate >= 0.55 ? 'text-teal' : 'text-2'}">${pct(c.winRate)}</span>
          ${r.stats.signature.some(x => x.championId === c.championId) ? '<span class="badge gold" style="font-size:11px">绝活</span>' : ''}</div>`; }).join('') : '<div class="text-3 fs-12">暂无</div>'}
        <div class="fs-12 text-3 mt-2">池深度 ${r.stats.poolDepth} 个英雄${r.newChampions.length ? ' · 近期新用 ' + r.newChampions.length + ' 个' : ''}</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h"><div class="panel-title">${esc(name)} · 成长结论</div>${sourceTag('heuristic')}</div>
      ${taggedReport(r)}
      ${aiBlock('growth-ai')}
    </div>`;
  bindAi(body, 'growth-ai', 'tactic', () => ({
    personal: true,
    data: { player: name, recent: r.recent, older: r.older, poolDepth: r.stats.poolDepth, signature: r.stats.signature.map(x => (champBy(x.championId) || {}).nameCn || x.championId), facts: r.facts, inferences: r.inferences },
    rules: r,
  }), {
    variant: 'growth', subject: puuid, subjectName: name,
    dataRange: `「${r.mode || '全部模式'}」缓存真实对局 ${s.length} 场（近期 ${r.recent.games}${r.older ? ' / 此前 ' + r.older.games : ''}，不与其他模式混算）`,
    charts: { winSeries: wins, kdaSeries: kdas, recent: r.recent, older: r.older, pool: pool.map(c => ({ name: (champBy(c.championId) || {}).nameCn || '#' + c.championId, games: c.games, winRate: c.winRate })) },
  });
  await drawPool(root);
}

const PROF_OPTS = ['', '主力', '备选', '练习'];
const ROLE_OPTS = ['', 'TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
async function drawPool(root) {
  let host = root.querySelector('#growth-pool');
  if (!host) { host = document.createElement('div'); host.id = 'growth-pool'; host.className = 'mt-4'; root.querySelector('#growth-body').appendChild(host); }
  const cov = await window.nexus.pool.coverage(puuid).catch(() => null);
  if (!cov || cov.__error) { host.innerHTML = ''; return; }
  const rows = cov.rows.slice(0, 12);
  host.innerHTML = `<div class="panel">
    <div class="panel-h"><div class="panel-title">英雄池管理（熟练度 / 定位修正）</div><span class="badge ${cov.covered ? 'green' : 'amber'}">${cov.covered ? '主力覆盖达标' : '建议≥2 主力'}</span></div>
    <div class="fs-12 text-3 mb-2">缓存 ${cov.total} 场 · 池深度 ${cov.poolDepth} · 自设主力 ${cov.mains} 个${cov.mainRoles.length ? '（' + cov.mainRoles.join('/') + '）' : ''}。熟练度/定位为本人自设，会回灌 AI 上下文；场次/胜率仍为真实缓存。</div>
    ${rows.length ? `<table class="nx-table"><thead><tr><th>英雄</th><th>场次</th><th>胜率</th><th>熟练度</th><th>定位修正</th></tr></thead><tbody>
      ${rows.map(c => { const ch = champBy(c.championId); return `<tr data-ch="${c.championId}">
        <td>${ch ? esc(ch.nameCn) : '#' + c.championId}</td><td class="num">${c.games}</td><td class="num">${pct(c.winRate)}</td>
        <td><select class="nx-select pool-prof" style="width:88px">${PROF_OPTS.map(o => `<option value="${o}" ${((c.proficiency || '') === o) ? 'selected' : ''}>${o || '未设'}</option>`).join('')}</select></td>
        <td><select class="nx-select pool-role" style="width:96px">${ROLE_OPTS.map(o => `<option value="${o}" ${((c.role || '') === o) ? 'selected' : ''}>${o || '自动'}</option>`).join('')}</select></td>
      </tr>`; }).join('')}
    </tbody></table>` : '<div class="fs-12 text-3">暂无缓存英雄数据。</div>'}
  </div>`;
  host.querySelectorAll('tr[data-ch]').forEach(tr => {
    const id = +tr.dataset.ch;
    const save = async () => {
      const prof = tr.querySelector('.pool-prof').value;
      const role = tr.querySelector('.pool-role').value;
      await window.nexus.pool.set(puuid, id, prof || null, role || null);
    };
    tr.querySelector('.pool-prof').addEventListener('change', save);
    tr.querySelector('.pool-role').addEventListener('change', save);
  });
}