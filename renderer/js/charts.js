// NEXUS hand-rolled SVG charts (no external deps).
import { esc, fx, DIM_CN } from './util.js';

// Radar chart for team composition dimensions.
export function radar(scores, dims, { size = 300, color = '#0AC8B9', compare = null, compareColor = '#E84057' } = {}) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 42;
  const n = dims.length;
  const pt = (i, val) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (Math.max(0, Math.min(100, val)) / 100) * R;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const ring = (frac) => dims.map((_, i) => pt(i, frac * 100).join(',')).join(' ');
  let grid = '';
  for (const f of [0.25, 0.5, 0.75, 1]) grid += `<polygon points="${ring(f)}" fill="none" stroke="rgba(200,170,110,0.12)" stroke-width="1"/>`;
  let axes = '', labels = '';
  dims.forEach((d, i) => {
    const [x, y] = pt(i, 100);
    axes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(200,170,110,0.10)" stroke-width="1"/>`;
    const [lx, ly] = pt(i, 118);
    const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
    labels += `<text x="${lx}" y="${ly}" class="radar-label" text-anchor="${anchor}" dominant-baseline="middle">${esc(DIM_CN[d] || d)}</text>`;
  });
  const poly = (vals, col, fillOp) => {
    const points = dims.map((d, i) => pt(i, vals[d] || 0).join(',')).join(' ');
    return `<polygon points="${points}" fill="${col}" fill-opacity="${fillOp}" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
  };
  let dots = '';
  dims.forEach((d, i) => { const [x, y] = pt(i, scores[d] || 0); dots += `<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`; });
  const cmp = compare ? poly(compare, compareColor, 0.10) : '';
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:${size}px">${grid}${axes}${cmp}${poly(scores, color, 0.18)}${dots}${labels}</svg>`;
}

// Horizontal labeled bar.
export function hbar(label, value, max = 100, { color = '', suffix = '', width = '100%' } = {}) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="hbar" style="width:${width}">
    <div class="flex justify-between items-center mb-2"><span class="fs-12 text-2">${esc(label)}</span><span class="num fs-13 text-gold">${typeof value === 'number' ? fx(value, 2) : esc(value)}${esc(suffix)}</span></div>
    <div class="bar-track"><div class="bar-fill ${color}" style="width:${w}%"></div></div>
  </div>`;
}

// Donut for AD/AP damage profile.
export function donut(ad, ap, { size = 120 } = {}) {
  const r = size / 2 - 10, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  const adLen = (ad / 100) * C;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(157,108,255,0.5)" stroke-width="12"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#E8A33D" stroke-width="12" stroke-dasharray="${adLen} ${C}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="num" fill="#F0E6D2" font-size="20" font-weight="700">${ad}%</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#A7B6C4" font-size="10">物理</text>
  </svg>`;
}

// Sparkline from numeric series.
export function sparkline(values, { width = 120, height = 32, color = '#0AC8B9' } = {}) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

// Win-rate gauge (semicircle).
export function gauge(value, { size = 140, label = '胜率' } = {}) {
  const v = Math.max(0, Math.min(1, value || 0));
  const r = size / 2 - 12, cx = size / 2, cy = size / 2;
  const ang = Math.PI * v;
  const x = cx - r * Math.cos(ang), y = cy - r * Math.sin(ang);
  const col = v >= 0.52 ? '#29C76F' : v >= 0.48 ? '#0AC8B9' : '#E84057';
  return `<svg viewBox="0 0 ${size} ${size / 1.6}" width="100%" style="max-width:${size}px">
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10" stroke-linecap="round"/>
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="num" fill="${col}" font-size="26" font-weight="700">${fx(v * 100, 1)}%</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="#6B7C8C" font-size="11">${esc(label)}</text>
  </svg>`;
}