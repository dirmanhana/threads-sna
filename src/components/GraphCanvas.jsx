import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as d3 from 'd3';
import { esc, fmt } from '../lib/viewerLib.js';

const radius = (d) => 6 + Math.sqrt(d.deg || 0) * 3.5;
const edgeColor = (t) => (t === 'mention' ? 'var(--c2)' : t === 'co-comment' ? 'var(--c4)' : 'var(--c1)');

/* Komponen graf D3 imperatif. State/UI lain tetap dipegang React (ViewerPage). */
const GraphCanvas = forwardRef(function GraphCanvas(props, ref) {
  const {
    graph, metrics, colorBy, focus, isolate, riskHighlight, riskById, keyword,
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

  useEffect(() => {
    const svg = d3.select(svgEl.current);
    const root = svg.append('g');
    rootEl.current = root.node();
    const defs = svg.append('defs').append('marker').attr('id', 'sna-arrow')
      .attr('viewBox', '0 -4 8 8').attr('refX', 18)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto');
    defs.append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', 'context-stroke');
    const zoom = d3.zoom().scaleExtent([.2, 4]).on('zoom', (e) => {
      d3.select(rootEl.current).attr('transform', e.transform);
    });
    zoomRef.current = zoom;
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', () => { propsRef.current.onBackgroundClick?.(); });
    return () => { simRef.current?.stop(); };
  }, []);

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

  function draw() {
    const p = propsRef.current;
    const g = p.graph || { nodes: [], links: [] };
    const root = d3.select(rootEl.current);
    root.selectAll('*').remove();
    simRef.current?.stop();
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

    simRef.current = d3.forceSimulation(g.nodes)
      .force('l', d3.forceLink(g.links).id((d) => d.id).distance(110))
      .force('c', d3.forceManyBody().strength(-320))
      .force('m', d3.forceCenter(W / 2, H / 2))
      .force('x', d3.forceCollide().radius((d) => radius(d) + 8))
      .on('tick', () => {
        lk.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
          .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
        nd.attr('transform', (d) => `translate(${d.x},${d.y})`);
        g.nodes.forEach((n) => posRef.current.set(n.id, { x: n.x, y: n.y }));
      });
  }

  useImperativeHandle(ref, () => ({
    redraw: draw,
    redrawKeep: () => { draw(); simRef.current?.alpha(.25).restart(); },
    zoomTo: (id) => {
      const n = (propsRef.current.graph?.nodes || []).find((x) => x.id === id);
      if (!n || !zoomRef.current) return;
      const el = svgEl.current, W = el.clientWidth || 800, H = el.clientHeight || 600;
      const k = Math.max(1.2, d3.zoomTransform(el).k || 1);
      const tr = d3.zoomIdentity.translate(W / 2 - k * (n.x || 0), H / 2 - k * (n.y || 0)).scale(k);
      d3.select(el).transition().duration(450).call(zoomRef.current.transform, tr);
    },
    resetZoom: () => {
      if (zoomRef.current) d3.select(svgEl.current).transition().duration(350).call(zoomRef.current.transform, d3.zoomIdentity);
    },
    getSvg: () => svgEl.current,
  }));

  useEffect(() => { draw(); }, [graph, colorBy, focus, isolate, riskHighlight, metrics]);

  return (
    <>
      <svg ref={svgEl} className="h-full w-full select-none" style={{ touchAction: 'none' }} />
      <div
        ref={tipEl}
        style={{ display: 'none', position: 'fixed', zIndex: 999, maxWidth: 340, pointerEvents: 'none' }}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-700 shadow-xl dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
    </>
  );
});

export default GraphCanvas;
