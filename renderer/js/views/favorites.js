// 我的收藏 — Favorites & Profile.
import { icon } from '../icons.js';
import { el, esc, pct, asset, tierClass, POS_CN, POSITIONS, sourceTag, toast, confirmDialog } from '../util.js';
import { store, navigate, getChamp, loadChampions, refreshFavorites } from '../store.js';
import { openChampPicker } from '../picker.js';

export async function render(root) {
  root.innerHTML = `<div class="skeleton" style="height:64px"></div><div class="grid grid-3 gap-2 mt-3">${'<div class="skeleton" style="height:120px"></div>'.repeat(3)}</div>`;
  await loadChampions();
  await refreshFavorites();
  const keys = [...store.favorites];
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('star', 26, 'accent')} 我的收藏 <span class="accent">FAVORITES</span></div>
      <div class="page-sub">收藏的英雄与个人偏好 · 全部保存在本地，不上传云端</div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 320px;gap:16px;align-items:start">
      <div>
        <div class="flex items-center justify-between mb-3"><div class="fs-12 text-3">${keys.length} 位收藏英雄</div>${sourceTag('local')}</div>
        <div id="fav-grid" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px"></div>
      </div>
      <div class="panel" style="position:sticky;top:0">
        <div class="panel-h"><div class="panel-title">个人偏好</div></div>
        <div class="field"><label>主打位置</label><select class="nx-select w-full" id="main-role">${POSITIONS.map(p => `<option value="${p}" ${store.config.mainRole === p ? 'selected' : ''}>${POS_CN[p]}</option>`).join('')}</select></div>
        <div class="field"><label>常用英雄（BP 推荐会优先参考）</label><div id="main-champs" class="flex gap-2" style="flex-wrap:wrap"></div>
          <button class="btn ghost sm mt-2" id="add-main">${icon('plus', 13)} 添加常用英雄</button></div>
        <div class="divider"></div>
        <div class="fs-12 text-3" style="line-height:1.7">收藏与偏好仅存储在本机用户数据目录。卸载软件时默认保留，不会随卸载删除。</div>
      </div>
    </div>
  `;
  root.querySelector('#main-role').addEventListener('change', async (e) => { await window.nexus.config.set('mainRole', e.target.value); store.config.mainRole = e.target.value; toast('已更新主打位置', 'success'); });

  const grid = root.querySelector('#fav-grid');
  if (!keys.length) {
    grid.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="empty-state">${icon('star', 48)}<div class="es-title">还没有收藏</div><div>在强度榜或英雄详情页点击 ☆ 即可收藏。</div><button class="btn primary mt-3" id="go-tier">浏览强度榜</button></div></div>`;
    grid.querySelector('#go-tier').addEventListener('click', () => navigate('tier'));
  } else {
    for (const k of keys) {
      const data = await window.nexus.data.champion(k);
      const c = getChamp(k);
      const st = data.stats[0];
      const card = el('div', { class: 'stat-card', html: `
        <div class="flex items-center gap-3 mb-3">
          <img src="${asset(c.imageUrl)}" style="width:52px;height:52px;border-radius:var(--r-md);border:1px solid var(--line-strong);cursor:pointer" class="fav-open"/>
          <div style="flex:1;min-width:0"><div class="fw-6 fav-open" style="cursor:pointer">${esc(c.nameCn)}</div><div class="fs-12 text-3 truncate">${esc(c.titleCn || '')}</div></div>
          <button class="btn icon sm ghost fav-rm" title="取消收藏">${icon('close', 14)}</button>
        </div>
        ${st ? `<div class="flex items-center gap-2"><span class="tier-badge ${tierClass(st.tier)}" style="width:26px;height:26px;font-size:11px">T${st.tier}</span><span class="num text-green">${pct(st.winRate)}</span><span class="fs-12 text-3">${POS_CN[st.position]} · 登场 ${pct(st.pickRate)}</span></div>` : '<div class="fs-12 text-3">暂无统计</div>'}
      ` });
      card.querySelectorAll('.fav-open').forEach(n => n.addEventListener('click', () => navigate('detail', { key: k })));
      card.querySelector('.fav-rm').addEventListener('click', async () => { await window.nexus.favorites.toggle(k); await refreshFavorites(); render(root); toast('已取消收藏', 'success'); });
      grid.appendChild(card);
    }
  }
  drawMainChamps(root);
  root.querySelector('#add-main').addEventListener('click', () => {
    const cur = new Set(store.config.mainChampions || []);
    openChampPicker({
      title: '添加常用英雄', position: store.config.mainRole || 'all',
      taken: new Map([...cur].map(k => [k, '已添加'])),
      hint: '常用英雄会出现在 BP 选人建议的「常用」标记中；最多 8 个。',
      onPick: async (key) => {
        const list = store.config.mainChampions || [];
        if (list.includes(key)) { toast('该英雄已在常用列表', 'info'); return; }
        if (list.length >= 8) { toast('常用英雄最多 8 个，请先移除一个', 'info'); return; }
        const next = [...list, key];
        await window.nexus.config.set('mainChampions', next);
        store.config.mainChampions = next;
        drawMainChamps(root);
        toast('已添加常用英雄：' + ((getChamp(key) || {}).nameCn || (getChamp(key) || {}).name || key), 'success');
      },
    });
  });
  return {};
}

function drawMainChamps(root) {
  const mc = root.querySelector('#main-champs');
  if (!mc) return;
  const mainKeys = store.config.mainChampions || [];
  mc.innerHTML = mainKeys.length ? mainKeys.map(k => { const c = getChamp(k); return c ? `<span class="main-champ" style="position:relative;display:inline-flex" data-key="${esc(k)}">
    <img src="${asset(c.imageUrl)}" title="${esc(c.nameCn)} · 点击查看详情" style="width:36px;height:36px;border-radius:var(--r-sm);cursor:pointer" class="mc-open"/>
    <button class="mc-rm" title="移除常用" style="position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;border:1px solid var(--line-strong);background:var(--panel-2);color:var(--text-2);font-size:11px;line-height:1;cursor:pointer;display:grid;place-items:center">×</button>
  </span>` : ''; }).join('') : '<span class="fs-12 text-3">尚未设置</span>';
  mc.querySelectorAll('.main-champ').forEach(n => {
    n.querySelector('.mc-open').addEventListener('click', () => navigate('detail', { key: n.dataset.key }));
    n.querySelector('.mc-rm').addEventListener('click', async () => {
      const next = (store.config.mainChampions || []).filter(k => k !== n.dataset.key);
      await window.nexus.config.set('mainChampions', next);
      store.config.mainChampions = next;
      drawMainChamps(root);
      toast('已移除常用英雄', 'success', 1800);
    });
  });
}