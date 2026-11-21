// Safe Markdown rendering for AI output: marked (GFM) + DOMPurify sanitize.
// Never executes untrusted HTML; links are defanged to data-ext (opened via shell).
import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: true });

const PURIFY_CFG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'button', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math'],
  FORBID_ATTR: ['style', 'id', 'name', 'formaction', 'srcset'],
  ALLOW_DATA_ATTR: false,
};

export function renderMarkdown(text) {
  const raw = marked.parse(String(text == null ? '' : text));
  const clean = DOMPurify.sanitize(raw, PURIFY_CFG);
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  tpl.content.querySelectorAll('table').forEach(t => {
    const wrap = document.createElement('div');
    wrap.className = 'md-table-wrap';
    t.parentNode.insertBefore(wrap, t);
    wrap.appendChild(t);
  });
  tpl.content.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    a.removeAttribute('href');
    if (/^https?:\/\//i.test(href)) { a.setAttribute('data-ext', href); a.classList.add('md-link'); }
  });
  tpl.content.querySelectorAll('img').forEach(img => { img.setAttribute('loading', 'lazy'); img.setAttribute('referrerpolicy', 'no-referrer'); });
  return tpl.innerHTML;
}

// Plain-text extraction for copy fallback.
export function markdownToPlain(text) {
  const tpl = document.createElement('template');
  tpl.innerHTML = renderMarkdown(text);
  return (tpl.content.textContent || '').trim();
}