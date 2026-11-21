// 设置 — Settings + about + data-source transparency.
import { icon } from '../icons.js';
import { el, esc, toast, fmtBytes } from '../util.js';
import { store, navigate } from '../store.js';

function toggleRow(key, label, desc, value) {
  return `<div class="flex items-center justify-between" style="padding:12px 0;border-bottom:1px solid var(--line-soft)">
    <div style="flex:1;padding-right:16px"><div class="fs-13 fw-6">${esc(label)}</div><div class="fs-12 text-3 mt-2" style="line-height:1.6">${esc(desc)}</div></div>
    <div class="toggle ${value ? 'on' : ''}" data-toggle="${key}"><div class="track"></div></div>
  </div>`;
}

export async function render(root) {
  const cfg = await window.nexus.config.get();
  const info = await window.nexus.app.info();
  const ast = await window.nexus.auth.status().catch(() => null);
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">${icon('settings', 26, 'accent')} 设置 <span class="accent">SETTINGS</span></div>
      <div class="page-sub">数据更新 · 备份策略 · 界面 · LCU · 关于与数据来源</div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;align-items:start">
      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">数据更新</div></div>
          ${toggleRow('autoUpdate', '自动更新', '按设定间隔自动从 OP.GG 韩服刷新强度与出装数据；失败时保留原有数据。', cfg.autoUpdate)}
          <div class="field mt-3"><label>更新间隔（小时）</label><input class="nx-input" type="number" min="1" max="168" id="set-interval" value="${cfg.updateIntervalHours}"/></div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">备份策略</div></div>
          ${toggleRow('autoBackup', '自动备份', '定期备份本地数据库到用户数据目录，恢复前自动快照。', cfg.autoBackup)}
          <div class="grid grid-2 mt-3">
            <div class="field"><label>保留份数</label><input class="nx-input" type="number" min="1" max="50" id="set-keep" value="${cfg.backupKeep}"/></div>
            <div class="field"><label>备份间隔（小时）</label><input class="nx-input" type="number" min="1" max="168" id="set-binterval" value="${cfg.backupIntervalHours}"/></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">界面与 AI</div></div>
          ${toggleRow('reduceMotion', '减少动效', '关闭过渡动画，适合低性能设备或偏好静态界面。', cfg.reduceMotion)}
          ${toggleRow('aiEnabled', 'AI 战术解读', '基于规则的启发式解读引擎（无需联网模型）。真实统计与推理始终分开标注。', cfg.aiEnabled)}
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">LCU 客户端</div></div>
          ${toggleRow('lcuAutoConnect', '自动连接客户端（实验性）', '启动时自动检测并连接本机客户端本地接口，只读不写。腾讯未确认第三方调用的使用政策，正式包首装默认关闭；了解风险后手动开启视为知情同意。', cfg.lcuAutoConnect)}
          <div class="fs-12 text-3 mt-3" style="line-height:1.7">V1.0 严格只读：不自动选/禁英雄、不写入符文、不接受对局、不改客户端设置。需要写入才能实现的功能已直接取消。</div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">情报提醒</div></div>
          ${toggleRow('alertsEnabled', '启用情报提醒', '选人阶段自动检测威胁并弹出提醒（本地计算，不联网）。', cfg.alertsEnabled !== false)}
          ${toggleRow('alertFocusEnemy', '标记玩家出现在敌方', '你关注/标记的玩家进入敌方阵容时提醒。', cfg.alertFocusEnemy !== false)}
          ${toggleRow('alertSignatureEnemy', '敌方绝活英雄', '敌方选出其高场次高胜率英雄时提醒（基于本地缓存真实战绩）。', cfg.alertSignatureEnemy !== false)}
          ${toggleRow('alertSelfBan', '我的绝活被禁', '你的绝活英雄被对方禁用时提醒启用备选。', cfg.alertSelfBan !== false)}
          ${toggleRow('analystEnabled', '主动分析师', '启动与战绩更新时按真实缓存阈值自动评估（胜率异常/英雄下滑/位置短板/训练停滞/池结构），去重节流，本地计算不联网。', cfg.analystEnabled !== false)}
        </div>
      </div>

      <div class="flex-col gap-4">
        <div class="panel">
          <div class="panel-h"><div class="panel-title">关于 NEXUS</div></div>
          <div class="fs-13 text-2" style="line-height:1.9">
            <div class="fw-6 fs-16 text-gold mb-2">NEXUS · 英雄联盟智能战术终端</div>
            版本 ${esc(info.version)} · Electron ${esc(info.electron)} · Chromium ${esc(info.chrome)}<br/>
            纯本地桌面应用 · 无需云端服务器 · 无需强制登录<br/>
            用户数据目录：<span class="fs-12 text-3">${esc(info.paths.userData)}</span>
          </div>
          <div class="divider"></div>
          <div class="fs-13 text-2" style="line-height:2">
            <div>开发者：<b class="text-gold">竖</b></div>
            <div class="flex items-center gap-2" style="flex-wrap:wrap">
              <span>邮箱：<span class="num text-teal" id="dev-email">1564898589@qq.com</span></span>
              <button class="btn ghost sm" id="dev-copy">${icon('copy', 13)} 复制</button>
              <button class="btn ghost sm" id="dev-mail">${icon('mail', 13)} 发邮件</button>
            </div>
          </div>
          <div class="flex gap-2 mt-3">
            <button class="btn ghost sm" id="set-logs">${icon('download', 14)} 导出运行日志</button>
            <button class="btn ghost sm" id="set-vault">${icon('vault', 14)} 数据中枢</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">数据来源与合规</div></div>
          <div class="fs-12 text-2" style="line-height:1.9">
            <div class="mb-2"><b class="text-teal">OP.GG 韩服统计</b>：通过解析 OP.GG 公开页面获取胜率/登场率/禁用率/Counter/出装/符文。每条记录均标注来源、服务器、段位、版本与采集时间。</div>
            <div class="mb-2"><b class="text-teal">Riot Data Dragon</b>：官方公开静态资料（中文英雄/技能/装备/符文/原画）。</div>
            <div class="mb-2"><b class="text-purple">LCU 本地接口</b>：仅访问本机客户端暴露的接口，国服兼容性独立验证。</div>
            <div class="mb-2"><b class="text-gold">启发式分析</b>：阵容/对线解读为基于英雄机制的规则推理，<b>非</b> OP.GG 官方统计，已明确区分标注。</div>
            <div class="divider"></div>
            <div class="text-3">合规提示：OP.GG 数据经公开页面解析，属非官方用途，可能与其服务条款存在冲突；本软件仅供个人学习研究，不绕过验证码/登录/反爬机制。若来源失效，软件保留旧数据并提供官方页面跳转，绝不伪造数据。</div>
          </div>
          <div class="flex gap-2 mt-3">
            <button class="btn ghost sm" id="open-opgg">${icon('external', 14)} OP.GG 官方页面</button>
            <button class="btn ghost sm" id="open-dd">${icon('external', 14)} Riot Data Dragon</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">安全承诺</div></div>
          <div class="fs-12 text-2" style="line-height:1.9">
            ✗ 不制作外挂 · ✗ 不读取游戏内存 · ✗ 不注入游戏进程 · ✗ 不自动操作游戏<br/>
            ✗ 不伪造胜率/登场率/Counter/出装 · ✗ 不混合来源冒充 OP.GG<br/>
            ✓ 所有数据本地存储 · ✓ 日志不记录密码/令牌 · ✓ 密钥不硬编码<br/>
            ✓ 卸载默认保留用户数据库与备份
          </div>
        </div>
        <div class="panel">
          <div class="panel-h"><div class="panel-title">访问密码</div></div>
          <div class="fs-12 text-3 mb-3" style="line-height:1.7">新电脑第一次启动输一次密码，之后这台电脑启动就免密码；把安装包发给别人，对方第一次启动仍要输。密码哈希加密存本机，不联网、不上传。改密码后所有设备下次启动重新验证。</div>
          <div class="flex items-center justify-between gap-2 mb-3" style="padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-md)">
            <div class="fs-12 text-2" id="pw-trust-text">${ast && ast.trusted ? '本机已信任 · 启动免密码' : '本机未信任 · 下次启动需输密码'}</div>
            <button class="btn ghost sm" id="pw-revoke" ${ast && ast.trusted ? '' : 'disabled'}>下次启动重新输</button>
          </div>
          <div class="field mb-2"><label>原密码</label><input class="nx-input" type="password" id="pw-old" autocomplete="off"/></div>
          <div class="field mb-2"><label>新密码（4–64 位）</label><input class="nx-input" type="password" id="pw-new" autocomplete="off"/></div>
          <div class="field mb-3"><label>确认新密码</label><input class="nx-input" type="password" id="pw-new2" autocomplete="off"/></div>
          <button class="btn primary sm" id="pw-change">${icon('check', 14)} 修改密码</button>
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll('[data-toggle]').forEach(t => t.addEventListener('click', async () => {
    const key = t.dataset.toggle;
    const now = !t.classList.contains('on');
    t.classList.toggle('on', now);
    await window.nexus.config.set(key, now);
    store.config[key] = now;
    if (key === 'reduceMotion') document.body.classList.toggle('reduce-motion', now);
    toast('设置已保存', 'success');
  }));
  const bindNum = (id, key, min, max) => root.querySelector(id).addEventListener('change', async (e) => {
    let v = parseInt(e.target.value, 10); if (isNaN(v)) v = min; v = Math.max(min, Math.min(max, v)); e.target.value = v;
    await window.nexus.config.set(key, v); store.config[key] = v; toast('设置已保存', 'success');
  });
  bindNum('#set-interval', 'updateIntervalHours', 1, 168);
  bindNum('#set-keep', 'backupKeep', 1, 50);
  bindNum('#set-binterval', 'backupIntervalHours', 1, 168);
  root.querySelector('#dev-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('1564898589@qq.com'); toast('邮箱已复制', 'success'); }
    catch (e) { toast('复制失败：' + e.message, 'error'); }
  });
  root.querySelector('#dev-mail').addEventListener('click', () => { window.nexus.shell.open('mailto:1564898589@qq.com'); });
  root.querySelector('#set-logs').addEventListener('click', async () => { try { const r = await window.nexus.log.export(); if (r.ok) toast('日志已导出', 'success'); else toast('导出失败：' + (r.__error || ''), 'error'); } catch (e) { toast('导出失败：' + e.message, 'error'); } });
  root.querySelector('#set-vault').addEventListener('click', () => navigate('vault'));
  root.querySelector('#open-opgg').addEventListener('click', () => window.nexus.shell.open('https://op.gg/lol/champions?region=kr'));
  root.querySelector('#open-dd').addEventListener('click', () => window.nexus.shell.open('https://ddragon.leagueoflegends.com/'));
  root.querySelector('#pw-change').addEventListener('click', async () => {
    const old = root.querySelector('#pw-old').value;
    const n1 = root.querySelector('#pw-new').value;
    const n2 = root.querySelector('#pw-new2').value;
    if (!old) { toast('请输入原密码', 'info'); return; }
    if (n1 !== n2) { toast('两次输入的新密码不一致', 'error'); return; }
    const r = await window.nexus.auth.change(old, n1);
    if (r && r.ok) {
      toast('访问密码已修改', 'success');
      root.querySelector('#pw-old').value = ''; root.querySelector('#pw-new').value = ''; root.querySelector('#pw-new2').value = '';
      root.querySelector('#pw-trust-text').textContent = '本机未信任 · 下次启动需输密码';
      root.querySelector('#pw-revoke').disabled = true;
    }
    else toast((r && r.error) || '修改失败', 'error');
  });
  root.querySelector('#pw-revoke').addEventListener('click', async () => {
    await window.nexus.auth.revokeTrust();
    root.querySelector('#pw-trust-text').textContent = '本机未信任 · 下次启动需输密码';
    root.querySelector('#pw-revoke').disabled = true;
    toast('已清除本机信任，下次启动需输入密码', 'success');
  });
  return {};
}