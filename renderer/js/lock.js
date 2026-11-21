// NEXUS 私人访问锁屏。验证全在主进程；本模块只提交候选密码、渲染状态。
import { icon } from './icons.js';

const LOGO = `<svg viewBox="0 0 24 24" fill="none" width="40" height="40">
  <path d="M12 2 3 7v10l9 5 9-5V7z" stroke="#4CC3FF" stroke-width="1.3"/>
  <path d="M12 6 7 9v6l5 3 5-3V9z" fill="#4CC3FF" fill-opacity="0.14" stroke="#8AD8FF" stroke-width="1.1"/>
  <circle cx="12" cy="12" r="2" fill="#E8EDF3"/></svg>`;

export async function ensureUnlocked() {
  let st;
  try { st = await window.nexus.auth.status(); } catch { return true; }
  if (!st || !st.required || st.unlocked) return true;
  return new Promise((resolve) => renderLock(resolve));
}

function renderLock(resolve) {
  const ov = document.createElement('div');
  ov.id = 'lock-screen';
  ov.innerHTML = `
    <div class="lock-win">
      <button class="win-btn" id="lock-min" title="最小化">${icon('min', 12)}</button>
      <button class="win-btn" id="lock-max" title="最大化">${icon('max', 12)}</button>
      <button class="win-btn close" id="lock-close" title="关闭">${icon('close', 12)}</button>
    </div>
    <div class="lock-card" id="lock-card">
      <div class="lock-logo">${LOGO}</div>
      <div class="lock-brand">NEXUS</div>
      <div class="lock-sub">PRIVATE ACCESS</div>
      <div class="lock-label">请输入访问密码</div>
      <div class="lock-input-wrap">
        <input id="lock-pwd" type="password" autocomplete="off" spellcheck="false" placeholder="访问密码" />
        <button class="lock-eye" id="lock-eye" title="显示 / 隐藏密码" type="button">${icon('eye', 16)}</button>
      </div>
      <div class="lock-error" id="lock-error"></div>
      <button class="btn primary lock-enter" id="lock-enter">${icon('bolt', 15)} 进入 NEXUS</button>
      <div class="lock-foot">本地验证 · 无需联网 · 密码经哈希加密存储于本机</div>
    </div>`;
  document.body.appendChild(ov);

  const pwd = ov.querySelector('#lock-pwd');
  const err = ov.querySelector('#lock-error');
  const enter = ov.querySelector('#lock-enter');
  const card = ov.querySelector('#lock-card');
  const eye = ov.querySelector('#lock-eye');
  setTimeout(() => pwd.focus(), 60);

  ov.querySelector('#lock-min').addEventListener('click', () => window.nexus.window.min());
  ov.querySelector('#lock-max').addEventListener('click', () => window.nexus.window.max());
  ov.querySelector('#lock-close').addEventListener('click', () => window.nexus.window.close());

  eye.addEventListener('click', () => {
    const show = pwd.type === 'password';
    pwd.type = show ? 'text' : 'password';
    eye.innerHTML = icon(show ? 'eyeOff' : 'eye', 16);
    eye.title = show ? '隐藏密码' : '显示密码';
    pwd.focus();
  });

  let busy = false;
  async function submit() {
    if (busy) return;
    const v = pwd.value;
    if (!v) { fail('请输入访问密码'); return; }
    busy = true; enter.disabled = true; err.textContent = '';
    const old = enter.innerHTML; enter.innerHTML = '<span class="nx-spin"></span> 验证中…';
    let r;
    try { r = await window.nexus.auth.verify(v); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    busy = false; enter.disabled = false; enter.innerHTML = old;
    if (r && r.ok) {
      ov.classList.add('lock-out');
      setTimeout(() => { ov.remove(); resolve(true); }, 280);
    } else {
      fail((r && r.error) || '密码错误，请重新输入');
    }
  }
  function fail(msg) {
    err.textContent = msg;
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    pwd.focus(); pwd.select();
  }
  enter.addEventListener('click', submit);
  pwd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}