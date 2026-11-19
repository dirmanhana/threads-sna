/* Ekspor graf: CSV, GraphML, SVG, PNG, dan snapshot laporan. Diadaptasi dari viewer.html. */
import { download, downloadBlob } from './utils.js';
import { cmp, csv, eid, xe } from './viewerLib.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function exportNodesCsv(g, metrics, warn) {
  try {
    const rows = [['id', 'posts', 'replies', 'deg', 'threadCount', 'community'].map(csv).join(',')];
    g.nodes.forEach((n) => rows.push([n.id, n.posts, n.replies, n.deg, n.threadCount,
      metrics?.communities?.get(n.id)].map(csv).join(',')));
    download('sna-nodes.csv', rows.join('\r\n'), 'text/csv;charset=utf-8');
  } catch (err) { warn?.('Gagal mengekspor CSV node: ' + (err?.message || err)); }
}

export function exportEdgesCsv(g, warn) {
  try {
    const rows = [['source', 'target', 'type', 'w', 'item_text', 'item_timestamp', 'item_postCode', 'item_author'].map(csv).join(',')];
    g.links.forEach((l) => {
      const its = l.items?.length ? l.items : [{}];
      its.forEach((it) => rows.push([eid(l.source), eid(l.target), l.type, l.w,
        it.text, it.timestamp, it.postCode, it.author].map(csv).join(',')));
    });
    download('sna-edges.csv', rows.join('\r\n'), 'text/csv;charset=utf-8');
  } catch (err) { warn?.('Gagal mengekspor CSV edge: ' + (err?.message || err)); }
}

export function exportGraphMl(g, metrics, warn) {
  try {
    const keys = [['posts', 'node', 'int'], ['replies', 'node', 'int'], ['deg', 'node', 'int'],
      ['threadCount', 'node', 'int'], ['community', 'node', 'int'], ['type', 'edge', 'string'], ['w', 'edge', 'double']];
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">'];
    keys.forEach((k) => out.push(`<key id="${k[0]}" for="${k[1]}" attr.name="${k[0]}" attr.type="${k[2]}"/>`));
    out.push('<graph edgedefault="undirected">');
    g.nodes.forEach((n) => {
      const c = metrics?.communities?.get(n.id);
      out.push(`<node id="${xe(n.id)}"><data key="posts">${+n.posts || 0}</data>` +
        `<data key="replies">${+n.replies || 0}</data><data key="deg">${+n.deg || 0}</data>` +
        `<data key="threadCount">${+n.threadCount || 0}</data><data key="community">${c == null ? -1 : +c}</data></node>`);
    });
    g.links.forEach((l, i) => {
      out.push(`<edge id="e${i}" source="${xe(eid(l.source))}" target="${xe(eid(l.target))}">` +
        `<data key="type">${xe(l.type)}</data><data key="w">${Number(l.w) || 0}</data></edge>`);
    });
    out.push('</graph></graphml>');
    downloadBlob('sna.graphml', new Blob([out.join('\n')], { type: 'application/graphml+xml;charset=utf-8' }));
  } catch (err) { warn?.('Gagal mengekspor GraphML: ' + (err?.message || err)); }
}

const FALLBACK_COLORS = { '--c1': '#378add', '--c2': '#d85a30', '--c3': '#1d9e75',
  '--c4': '#8f6fd0', '--fg': '#1a1a1a', '--mut': '#6b6b6b', '--bg': '#ffffff' };

function cssGet() {
  const cs = getComputedStyle(document.documentElement);
  return (v) => cs.getPropertyValue(v).trim() || FALLBACK_COLORS[v] || '#888';
}

function inlineColors(el, get) {
  el.querySelectorAll('*').forEach((n) => {
    ['fill', 'stroke'].forEach((a) => {
      const v = n.getAttribute(a);
      if (!v) return;
      if (v === 'context-stroke') n.setAttribute(a, get('--c1'));
      else if (v.indexOf('var(--') === 0) n.setAttribute(a, get(v.slice(4, -1).trim()));
    });
  });
}

/* Kloning SVG graf dengan bbox seluruh node, tanpa transform zoom. */
export function svgForExport(svgEl, g) {
  const clone = svgEl.cloneNode(true);
  const vw = svgEl.clientWidth || 960, vh = svgEl.clientHeight || 600;
  let x0 = 0, y0 = 0, x1 = vw, y1 = vh, have = false;
  (g?.nodes || []).forEach((n) => {
    const x = Number(n.x), y = Number(n.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const r = 6 + Math.sqrt(n.deg || 0) * 3.5;
    const tx = Math.max(30, String(n.id || '').length * 6.5);
    if (!have) { x0 = x - r - tx; x1 = x + r + tx; y0 = y - r - tx - 8; y1 = y + r + tx; have = true; }
    else {
      x0 = Math.min(x0, x - r - tx); x1 = Math.max(x1, x + r + tx);
      y0 = Math.min(y0, y - r - tx - 8); y1 = Math.max(y1, y + r + tx);
    }
  });
  const pad = 24;
  const X = x0 - pad, Y = y0 - pad, W = (x1 - x0) + pad * 2, H = (y1 - y0) + pad * 2;
  const root = [...clone.children].find((el) => el.tagName === 'g');
  if (root) root.removeAttribute('transform');
  clone.setAttribute('xmlns', SVGNS);
  clone.setAttribute('viewBox', [X, Y, W, H].join(' '));
  clone.setAttribute('width', W);
  clone.setAttribute('height', H);
  const get = cssGet();
  inlineColors(clone, get);
  const st = document.createElementNS(SVGNS, 'style');
  st.textContent = `text{fill:${get('--fg')};font-size:11px;font-family:system-ui,sans-serif}`;
  clone.insertBefore(st, clone.firstChild);
  return { clone, W, H, get };
}

function svgToPng(svg, W, H, name, warn, maxDim = 4000) {
  try {
    const str = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        const scale = Math.max(.25, Math.min(2.5, maxDim / Math.max(W, H)));
        cv.width = Math.max(1, Math.round(W * scale));
        cv.height = Math.max(1, Math.round(H * scale));
        const ctx = cv.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, W, H);
        cv.toBlob((b) => { if (b) downloadBlob(name, b); else warn?.('Gagal membuat PNG.'); }, 'image/png');
      } catch (err) { warn?.('Gagal mengekspor PNG: ' + (err?.message || err)); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); warn?.('Gagal memuat SVG untuk PNG.'); };
    img.src = url;
  } catch (err) { warn?.('Gagal mengekspor PNG: ' + (err?.message || err)); }
}

export function exportSvg(svgEl, g, warn) {
  try {
    const { clone } = svgForExport(svgEl, g);
    downloadBlob('sna.svg', new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  } catch (err) { warn?.('Gagal mengekspor SVG: ' + (err?.message || err)); }
}

export function exportPng(svgEl, g, warn) {
  try { const { clone, W, H } = svgForExport(svgEl, g); svgToPng(clone, W, H, 'sna.png', warn); }
  catch (err) { warn?.('Gagal mengekspor PNG: ' + (err?.message || err)); }
}

/* Snapshot laporan: graf + legenda + ringkasan statistik dalam satu SVG/PNG. */
function reportSvg(svgEl, g, ctx) {
  const { posts, metrics, anomaly, colorBy, warn: _warn, ...rest } = ctx;
  const base = svgForExport(svgEl, g);
  const get = base.get, fg = get('--fg'), mut = get('--mut'), bg = get('--bg');
  const gw = base.W, gh = base.H, side = 340, pad = 28, gap = 24;
  const W = Math.ceil(gw + side + pad * 3 + gap), H = Math.ceil(Math.max(gh, 470) + pad * 2);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('xmlns', SVGNS);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const rect = document.createElementNS(SVGNS, 'rect');
  rect.setAttribute('width', W); rect.setAttribute('height', H); rect.setAttribute('fill', bg);
  svg.appendChild(rect);
  base.clone.setAttribute('x', pad); base.clone.setAttribute('y', pad);
  svg.appendChild(base.clone);
  const addText = (x, y, text, size = 12, weight = 'normal', fill = fg) => {
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-family', 'system-ui, sans-serif');
    t.setAttribute('font-size', size); t.setAttribute('font-weight', weight);
    t.setAttribute('fill', fill); t.textContent = text; svg.appendChild(t);
  };
  const px = pad + gw + gap + 16;
  let y = pad + 22;
  addText(px, y, 'Threads SNA — Snapshot', 16, '700'); y += 22;
  addText(px, y, 'Dibuat: ' + new Date().toLocaleString('id-ID'), 11, 'normal', mut); y += 28;
  const np = posts.length,
    nc = posts.reduce((a, p) => a + ((p.replies || []).length), 0),
    nt = posts.reduce((a, p) => a + ((p.thread || []).length), 0);
  const sizes = rest.communitySizes ? rest.communitySizes(metrics?.communities) : new Map();
  [np + ' postingan', nc + ' komentar', nt + ' thread', g.nodes.length + ' akun',
    g.links.length + ' relasi', sizes.size + ' komunitas'].forEach((s) => { addText(px, y, '• ' + s, 12); y += 19; });
  y += 6;
  addText(px, y, 'Anomali: ' + ((anomaly?.cib?.clusters) || []).length + ' klaster CIB · '
    + ((anomaly?.temporal?.bursts) || []).length + ' lonjakan', 11, 'normal', mut); y += 16;
  addText(px, y, 'Skor buzzer ≥70: ' + ((anomaly?.scores || []).filter((x) => x.score >= 70).length) + ' akun', 11, 'normal', mut); y += 14;
  addText(px, y, 'Aktor teratas (degree)', 12, '700'); y += 19;
  const ids = new Set(g.nodes.map((n) => n.id));
  const top = (metrics?.degree ? [...metrics.degree.entries()] : [])
    .filter(([id]) => ids.has(id)).sort((a, b) => b[1] - a[1] || cmp(String(a[0]), String(b[0]))).slice(0, 5);
  top.forEach(([id, d]) => { addText(px, y, '@' + id + ' — ' + d, 11); y += 17; });
  y += 12;
  addText(px, y, 'Legenda', 12, '700'); y += 19;
  [['komentar', get('--c1')], ['mention', get('--c2')], ['co-comment', get('--c4')]].forEach(([label, c]) => {
    const l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', px); l.setAttribute('x2', px + 26);
    l.setAttribute('y1', y - 4); l.setAttribute('y2', y - 4);
    l.setAttribute('stroke', c); l.setAttribute('stroke-width', 3); svg.appendChild(l);
    addText(px + 34, y, label, 11); y += 18;
  });
  y += 10;
  addText(px, y, colorBy === 'komunitas' ? 'Warna node: komunitas'
    : 'Hijau: penulis post · abu: komentator', 10, 'normal', mut); y += 16;
  addText(px, y, 'Sumber: data.json · Threads SNA', 10, 'normal', mut);
  return { svg, W, H };
}

export function exportReport(svgEl, g, ctx, fmtType, warn) {
  try {
    const { svg, W, H } = reportSvg(svgEl, g, ctx);
    if (fmtType === 'svg') {
      downloadBlob('sna-laporan.svg', new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    } else svgToPng(svg, W, H, 'sna-laporan.png', warn, 6000);
  } catch (err) { warn?.('Gagal mengekspor laporan: ' + (err?.message || err)); }
}
