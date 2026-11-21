import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as d3 from 'd3';
import { esc, fmt } from '../lib/viewerLib.js';

const radius = (d) => 6 + Math.sqrt(d.deg || 0) * 3.5;
const edgeColor = (t) => (t === 'mention' ? 'var(--c2)' : t === 'co-comment' ? 'var(--c4)' : 'var(--c1)');

/* Komponen graf D3 imperatif. State/UI lain tetap dipegang React (ViewerPage). */
const GraphCanvas = forwardRef(function GraphCanvas(props, ref) {
  const {
    graph, metrics, colorBy, focus, isolate, riskHighlight, riskById, keyword, hulls = true,
    onNodeClick, onLinkClick, onBackgroundClick,
  } = props;

  const svgEl = useRef(null);
  const rootEl = useRef(null);
  const zoomRef = useRef(null);
  const simRef = useRef(null);
  const posRef = useRef(new Map());
  const linkSel = useRef(null);
  const nodeSel = useRef(null);
  const tipEl = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const hullUpdateRef = useRef(null);
  const fitRef = useRef(null);
  const fitTimer = useRef(null);
  const userZoom = useRef(false);

  useEffect(() => {
    const svg = d3.select(svgEl.current);
    const root = svg.append('g');
    rootEl.current = root.node();
    const defs = svg.append('defs').append('marker').attr('id', 'sna-arrow')
      .attr('viewBox', '0 -4 8 8').attr('refX', 18)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto');
    defs.append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', 'context-stroke');
    const zoom = d3.zoom().scaleExtent([.08, 4]).on('zoom', (e) => {
      if (e.sourceEvent) userZoom.current = true;
      const root = d3.select(rootEl.current);
      root.attr('transform', e.transform);
      // Makro: label dan komentator kecil disembunyikan, gelembung komunitas tampil.
      const macro = e.transform.k < .45;
      root.classed('sna-zoom-out', macro);
      const p = propsRef.current;
      nodeSel.current?.style('display', (d) => (
        macro && p.hulls && (Number(d.deg || 0) <= 1) && !d.posts ? 'none' : null
      ));
      hullUpdateRef.current?.(macro);
    });
    zoomRef.current = zoom;
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', () => { propsRef.current.onBackgroundClick?.(); });

    // Jaga graf tetap terlihat saat ukuran kontainer berubah (mis. layar penuh).
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fitRef.current?.(false));
    });
    ro.observe(svgEl.current);

    return () => {
      simRef.current?.stop();
      clearTimeout(fitTimer.current);
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  /* Skala & geser seluruh graf agar muat di kontainer. */
  function fitView(animate = true, force = false) {
    const el = svgEl.current;
    const nodes = (propsRef.current.graph?.nodes || []).filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    if (!el || !nodes.length || !zoomRef.current || (userZoom.current && !force)) return;
    const W = el.clientWidth || 800, H = el.clientHeight || 600;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach((n) => {
      const r = radius(n);
      x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r);
      y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r);
    });
    const pad = 24;
    const k = Math.max(.08, Math.min(4, Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0))));
    const tr = d3.zoomIdentity
      .translate(W / 2 - k * (x0 + x1) / 2, H / 2 - k * (y0 + y1) / 2)
      .scale(k);
    const sel = d3.select(el);
    if (animate) sel.transition().duration(450).call(zoomRef.current.transform, tr);
    else sel.call(zoomRef.current.transform, tr);
  }
  fitRef.current = fitView;

  function showTip(html, e) {
    const t = tipEl.current;
    if (!t) return;
    t.innerHTML = html;
    t.style.display = 'block';
    const pad = 14, w = t.offsetWidth || 220, h = t.offsetHeight || 90;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    t.style.left = Math.max(4, x) + 'px';
    t.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { if (tipEl.current) tipEl.current.style.display = 'none'; }

  function nodeTip(e, d) {
    const p = propsRef.current;
    const m = p.metrics || { communities: new Map(), betweenness: new Map(), closeness: new Map(), eigenvector: new Map() };
    const c = m.communities.get(d.id), sc = p.riskById?.get(d.id);
    showTip('<b>@' + esc(d.id) + '</b><br>' +
      'Derajat: ' + (d.deg || 0) + ' · Post: ' + (d.posts || 0) + ' · Komentar: ' + (d.replies || 0) + ' · Thread: ' + (d.threadCount || 0) + '<br>' +
      'Komunitas: ' + (c == null ? '-' : c) + '<br>' +
      'Betweenness: ' + fmt(m.betweenness.get(d.id)) + ' · Closeness: ' + fmt(m.closeness.get(d.id)) + ' · Eigenvector: ' + fmt(m.eigenvector.get(d.id)) +
      (sc ? '<br>Skor buzzer: <b>' + sc.score + '</b> (' + esc(sc.level) + ')' : ''), e);
  }
  function colorOf(n) {
    const p = propsRef.current;
    if (p.colorBy === 'komunitas' && p.metrics) {
      const c = p.metrics.communities.get(n.id);
      const sc = d3.schemeTableau10 || d3.schemeCategory10;
      return c == null ? 'var(--mut)' : sc[c % sc.length];
    }
    return n.posts ? 'var(--c3)' : 'var(--mut)';
  }

  /* Convex hull per komunitas — tampilan makro saat zoom out. */
  function updateHulls(show) {
    const root = d3.select(rootEl.current);
    if (!root.node()) return;
    let layer = root.select('g.sna-hulls');
    if (layer.empty()) layer = root.insert('g', ':first-child').attr('class', 'sna-hulls');
    const p = propsRef.current;
    if (!show || !p.hulls || !p.metrics?.communities?.size) {
      layer.selectAll('*').remove();
      return;
    }
    const groups = new Map();
    (p.graph?.nodes || []).forEach((n) => {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
      const c = p.metrics.communities.get(n.id) ?? 0;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(n);
    });
    const items = [];
    groups.forEach((arr, c) => {
      if (arr.length < 3) return;
      let poly = d3.polygonHull(arr.map((n) => [n.x, n.y]));
      if (!poly || poly.length < 3) return;
      if (poly.length > 1 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly = poly.slice(0, -1);
      items.push({ c, poly });
    });
    const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6));
    const sc = d3.schemeTableau10 || d3.schemeCategory10;
    layer.selectAll('path').data(items, (d) => d.c).join('path')
      .attr('d', (d) => line(d.poly))
      .attr('fill', (d) => sc[d.c % sc.length])
      .attr('fill-opacity', 0.12)
      .attr('stroke', (d) => sc[d.c % sc.length])
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1.5)
      .style('pointer-events', 'none');
  }
  hullUpdateRef.current = updateHulls;

  function draw() {
    const p = propsRef.current;
    const g = p.graph || { nodes: [], links: [] };
    const root = d3.select(rootEl.current);
    root.selectAll('*').remove();
    simRef.current?.stop();
    clearTimeout(fitTimer.current);
    // Saat ada fokus akun, biarkan zoom ke akun; jangan fit ulang seluruh graf.
    userZoom.current = !!p.focus;
    hideTip();

    // Pulihkan posisi node yang masih dikenal (mis. setelah filter berubah).
    g.nodes.forEach((n) => {
      const old = posRef.current.get(n.id);
      if (old && Number.isFinite(old.x)) Object.assign(n, old);
    });

    const svgNode = svgEl.current;
    const W = svgNode.clientWidth || 800, H = svgNode.clientHeight || 600;
    const nb = new Set();
    if (p.focus) g.links.forEach((l) => {
      const s = l.source?.id ?? l.source, t = l.target?.id ?? l.target;
      if (s === p.focus) nb.add(t);
      if (t === p.focus) nb.add(s);
    });
    const dim = (id) => !!(p.focus && !p.isolate && id !== p.focus && !nb.has(id));
    const lop = (l) => (p.focus && !p.isolate
      ? (((l.source?.id ?? l.source) === p.focus || (l.target?.id ?? l.target) === p.focus) ? 0.6 : 0.12)
      : 0.6);

    const lk = root.append('g').attr('class', 'lnk').selectAll('line').data(g.links).join('line')
      .attr('stroke', (d) => edgeColor(d.type))
      .attr('stroke-opacity', lop)
      .attr('stroke-width', (d) => 1 + Math.min(Number(d.w) || 1, 8))
      .attr('marker-end', 'url(#sna-arrow)')
      .style('cursor', 'pointer')
      .on('click', (e, d) => { e.stopPropagation(); p.onLinkClick?.(d); })
      .on('mousemove', (e, d) => {
        showTip('@' + esc(d.source?.id ?? d.source) + ' → @' + esc(d.target?.id ?? d.target) +
          ' (' + esc(d.type) + ', ' + (d.w || 0) + '×)', e);
      })
      .on('mouseout', hideTip);
    linkSel.current = lk;

    const nd = root.append('g').selectAll('g').data(g.nodes).join('g')
      .style('cursor', 'pointer')
      .attr('opacity', (d) => (dim(d.id) ? 0.12 : 1))
      .on('click', (e, d) => { e.stopPropagation(); p.onNodeClick?.(d.id); })
      .on('mousemove', nodeTip)
      .on('mouseout', hideTip)
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simRef.current?.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simRef.current?.alphaTarget(0); d.fx = d.fy = null; }));
    nodeSel.current = nd;

    nd.append('circle').attr('r', radius).attr('fill', colorOf)
      .attr('stroke', 'var(--bg)').attr('stroke-width', 1.5);
    if (p.riskHighlight) nd.filter((d) => (p.riskById?.get(d.id)?.score || 0) >= 40)
      .append('circle').attr('r', (d) => radius(d) + 5).attr('fill', 'none')
      .attr('stroke', (d) => ((p.riskById?.get(d.id)?.score || 0) >= 70 ? 'var(--c2)' : '#e0a000'))
      .attr('stroke-width', 2);
    nd.append('text').attr('dy', (d) => -radius(d) - 3).attr('text-anchor', 'middle')
      .text((d) => '@' + d.id);

    const n = g.nodes.length;
    const charge = -320 * Math.max(.18, Math.min(1, 160 / Math.max(1, n)));
    const dist = n > 400 ? 70 : 110;
    let tickCount = 0;
    const macroNow = () => d3.zoomTransform(svgNode).k < .45;
    simRef.current = d3.forceSimulation(g.nodes)
      .force('l', d3.forceLink(g.links).id((d) => d.id).distance(dist))
      .force('c', d3.forceManyBody().strength(charge))
      .force('m', d3.forceCenter(W / 2, H / 2))
      .force('x', d3.forceCollide().radius((d) => radius(d) + 8))
      .on('tick', () => {
        lk.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
          .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
        nd.attr('transform', (d) => `translate(${d.x},${d.y})`);
        g.nodes.forEach((n) => posRef.current.set(n.id, { x: n.x, y: n.y }));
        if (++tickCount % 12 === 0) hullUpdateRef.current?.(macroNow());
      })
      .on('end', () => { fitView(); hullUpdateRef.current?.(macroNow()); });
    // Simulasi besar butuh beberapa detik; fit lebih awal agar graf langsung terlihat.
    fitTimer.current = setTimeout(() => {
      fitView();
      hullUpdateRef.current?.(macroNow());
      fitTimer.current = setTimeout(() => { fitView(); hullUpdateRef.current?.(macroNow()); }, 1500);
    }, 900);
  }

  useImperativeHandle(ref, () => ({
    redraw: draw,
    redrawKeep: () => { draw(); simRef.current?.alpha(.25).restart(); },
    zoomTo: (id) => {
      const n = (propsRef.current.graph?.nodes || []).find((x) => x.id === id);
      if (!n || !zoomRef.current) return;
      userZoom.current = true;
      const el = svgEl.current, W = el.clientWidth || 800, H = el.clientHeight || 600;
      const k = Math.max(1.2, d3.zoomTransform(el).k || 1);
      const tr = d3.zoomIdentity.translate(W / 2 - k * (n.x || 0), H / 2 - k * (n.y || 0)).scale(k);
      d3.select(el).transition().duration(450).call(zoomRef.current.transform, tr);
    },
    resetZoom: () => {
      userZoom.current = false;
      fitView(true, true);
    },
    getSvg: () => svgEl.current,
  }));

  useEffect(() => { draw(); }, [graph, colorBy, focus, isolate, riskHighlight, metrics, hulls]);

  return (
    <>
      <svg ref={svgEl} className="h-full w-full select-none" style={{ touchAction: 'none' }} />
      <div
        ref={tipEl}
        style={{ display: 'none', position: 'fixed', zIndex: 999, maxWidth: 340, pointerEvents: 'none' }}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </>
  );
});

export default GraphCanvas;
