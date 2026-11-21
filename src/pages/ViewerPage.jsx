import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Play, Pause, Download, RotateCcw } from 'lucide-react';
import GraphCanvas from '../components/GraphCanvas.jsx';
import { getJson } from '../lib/utils.js';
import { currentProject as getProject, projectFile } from '../lib/project.js';
import { SAMPLE, buildEvents, cmp, postsUntil } from '../lib/viewerLib.js';
import { exportEdgesCsv, exportGraphMl, exportNodesCsv, exportPng, exportSvg } from '../lib/exportGraph.js';
import '../../viewer_core.js';

const SNA = globalThis.SNA;
const nf = (v) => Number(v || 0).toLocaleString('id-ID');

function parseDate(ts) {
  if (!ts) return null;
  if (SNA?.parseDate) return SNA.parseDate(ts);
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

export default function ViewerPage({ embedded = false, project: projectProp, onTab, focusAccount }) {
  const project = projectProp || getProject();
  const graphRef = useRef(null);
  const fileRef = useRef(null);

  const [all, setAll] = useState([]);
  const [kw, setKw] = useState('');
  const [appliedKw, setAppliedKw] = useState('');
  const [types, setTypes] = useState(() => new Set(['komentar', 'mention']));
  const [minDeg, setMinDeg] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actor, setActor] = useState('');
  const [colorBy, setColorBy] = useState('peran');
  const [focus, setFocus] = useState(null);
  const [isolate, setIsolate] = useState(false);
  const [riskHighlight, setRiskHighlight] = useState(true);
  const [hulls, setHulls] = useState(true);
  const [selectedLink, setSelectedLink] = useState(null);
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [inspectorTab, setInspectorTab] = useState('metrik');
  const [tlGranularity, setTlGranularity] = useState('auto');
  const [cibWindowMin, setCibWindowMin] = useState(10);
  const [cibMinAcc, setCibMinAcc] = useState(3);
  const [fullscreen, setFullscreen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [warn, setWarn] = useState('');
  const [replayIdx, setReplayIdx] = useState(null);
  const [playing, setPlaying] = useState(false);

  const load = useCallback((d) => {
    const arr = Array.isArray(d) ? d : (d && Array.isArray(d.posts) ? d.posts : []);
    setAll(arr);
    setReplayIdx(null); setPlaying(false);
    setFocus(null); setIsolate(false); setSelectedLink(null); setSelectedBucket(null);
    setInspectorTab('metrik'); setWarn('');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await getJson(projectFile('data.json', project));
      if (!alive) return;
      if (d && (Array.isArray(d) || Array.isArray(d.posts))) {
        try { load(d); } catch (e) { setWarn('Data proyek terbaca, tetapi gagal dirender: ' + (e?.message || e)); load(SAMPLE); }
      } else {
        load(SAMPLE);
        setWarn(`Gagal memuat data proyek ${project} — menampilkan data contoh. Buka lewat ./run.sh serve agar fetch lokal diizinkan.`);
      }
    })();
    return () => { alive = false; };
  }, [load, project]);

  useEffect(() => { const id = setTimeout(() => setAppliedKw(kw), 250); return () => clearTimeout(id); }, [kw]);

  const filteredPosts = useMemo(() => {
    const term = (appliedKw || '').trim().toLowerCase();
    if (!term) return all;
    const has = (t) => String(t == null ? '' : t).toLowerCase().includes(term);
    return all.map((p) => {
      if (has(p.text) || has(p.author)) return p;
      const rs = (p.replies || []).filter((r) => has(r.text) || has(r.author));
      if (rs.length) return { ...p, replies: rs };
      const th = (p.thread || []).filter((t) => has(t.text) || has(t.author));
      if (th.length) return { ...p, thread: th };
      return null;
    }).filter(Boolean);
  }, [all, appliedKw]);

  const sortedEvents = useMemo(() => buildEvents(SNA, filteredPosts), [filteredPosts]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setReplayIdx((prev) => {
        const cur = prev ?? 0;
        if (cur >= sortedEvents.length) { setPlaying(false); return null; }
        return Math.min(sortedEvents.length, cur + 1);
      });
    }, 350);
    return () => clearInterval(timer);
  }, [playing, sortedEvents.length]);

  const activePosts = useMemo(() => {
    if (replayIdx == null || replayIdx >= sortedEvents.length) return filteredPosts;
    return postsUntil(sortedEvents, replayIdx);
  }, [filteredPosts, replayIdx, sortedEvents]);

  const graphOpts = useMemo(() => ({ types, minDeg, dateFrom, dateTo }), [types, minDeg, dateFrom, dateTo]);
  const baseGraph = useMemo(() => SNA.build(activePosts, graphOpts), [activePosts, graphOpts]);
  const metrics = useMemo(() => SNA.analyze(baseGraph), [baseGraph]);

  const visibleGraph = useMemo(() => {
    if (!isolate || !focus) return baseGraph;
    const ego = new Set([focus]);
    for (const l of baseGraph.links) {
      const s = l.source?.id ?? l.source, t = l.target?.id ?? l.target;
      if (s === focus) ego.add(t);
      if (t === focus) ego.add(s);
    }
    return {
      nodes: baseGraph.nodes.filter((n) => ego.has(n.id)),
      links: baseGraph.links.filter((l) => ego.has(l.source?.id ?? l.source) && ego.has(l.target?.id ?? l.target)),
    };
  }, [baseGraph, isolate, focus]);

  const temporal = useMemo(
    () => SNA.temporalBuckets(filteredPosts, { granularity: tlGranularity }),
    [filteredPosts, tlGranularity],
  );
  const cib = useMemo(
    () => SNA.detectCIB(filteredPosts, { windowMs: cibWindowMin * 60000, minAccounts: cibMinAcc }),
    [filteredPosts, cibWindowMin, cibMinAcc],
  );
  const scores = useMemo(
    () => SNA.buzzerScores(filteredPosts, { clusters: cib.clusters, bursts: temporal.bursts, stepMs: temporal.stepMs }),
    [filteredPosts, cib.clusters, temporal.bursts, temporal.stepMs],
  );
  const riskById = useMemo(() => new Map(scores.map((s) => [s.id, s])), [scores]);

  // Deep-link focus (?focus= / prop)
  const focusApplied = useRef(false);
  const lastFocusProp = useRef(null);
  useEffect(() => { focusApplied.current = false; }, [project]);
  useEffect(() => {
    if (!baseGraph.nodes.length) return;
    let raw = '';
    if (focusAccount && focusAccount !== lastFocusProp.current) {
      raw = String(focusAccount || '').trim().replace(/^@/, '');
      lastFocusProp.current = focusAccount;
    } else if (!focusApplied.current) {
      focusApplied.current = true;
      try {
        raw = (new URL(globalThis.location.href).searchParams.get('focus') || '').trim().replace(/^@/, '');
      } catch { raw = ''; }
    }
    if (!raw) return;
    const hit = baseGraph.nodes.find((n) => n.id.toLowerCase() === raw.toLowerCase());
    if (!hit) { setWarn(`Akun @${raw} tidak ditemukan di graf.`); return; }
    setFocus(hit.id); setActor(hit.id); setInspectorTab('metrik'); setIsolate(false); setSelectedLink(null);
    requestAnimationFrame(() => graphRef.current?.zoomTo(hit.id));
  }, [baseGraph, focusAccount]);

  const toggleType = (t) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const focusedNode = useMemo(
    () => (focus ? baseGraph.nodes.find((n) => n.id === focus) || null : null),
    [focus, baseGraph.nodes],
  );

  const focusedInteractions = useMemo(() => {
    if (!focus) return [];
    const items = [];
    for (const p of activePosts) {
      for (const r of (p.replies || [])) {
        const ra = String(r.author || '').toLowerCase();
        if (ra === focus) {
          items.push({ direction: 'keluar', peer: p.author, text: r.text, timestamp: r.timestamp });
        } else if (String(p.author || '').toLowerCase() === focus) {
          items.push({ direction: 'masuk', peer: r.author, text: r.text, timestamp: r.timestamp });
        }
      }
    }
    return items.slice(0, 12);
  }, [focus, activePosts]);

  const bucketItems = useMemo(() => {
    if (selectedBucket == null) return [];
    const end = selectedBucket + (temporal.stepMs || 86400000);
    const rows = [];
    for (const p of filteredPosts) {
      for (const r of (p.replies || [])) {
        const t = parseDate(r.timestamp);
        if (t != null && t >= selectedBucket && t < end) {
          rows.push({ author: r.author, target: p.author, text: r.text, timestamp: r.timestamp });
        }
      }
    }
    return rows;
  }, [selectedBucket, temporal.stepMs, filteredPosts]);

  const maxBucketCount = Math.max(1, ...(temporal.buckets || []).map((b) => b.count));
  const communityCount = SNA?.communitySizes ? SNA.communitySizes(metrics.communities).size : 0;

  const onNodeClick = (id) => {
    setFocus(id); setSelectedLink(null); setInspectorTab('metrik'); setActor(id);
  };
  const onLinkClick = (l) => {
    const norm = { ...l, source: l.source?.id ?? l.source, target: l.target?.id ?? l.target, samples: l.items || [] };
    setSelectedLink(norm); setFocus(null); setInspectorTab('metrik');
  };
  const onBackgroundClick = () => {
    setFocus(null); setSelectedLink(null); setIsolate(false); setSelectedBucket(null);
  };

  const doExport = (kind) => {
    const svg = graphRef.current?.getSvg(); if (!svg) return;
    const g = visibleGraph;
    try {
      switch (kind) {
        case 'node': exportNodesCsv(g, metrics, setWarn); break;
        case 'edge': exportEdgesCsv(g, setWarn); break;
        case 'gml': exportGraphMl(g, metrics, setWarn); break;
        case 'svg': exportSvg(svg, g, setWarn); break;
        case 'png': exportPng(svg, g, setWarn); break;
        default: break;
      }
    } finally { setExportOpen(false); }
  };

  const onPlay = () => {
    if (!sortedEvents.length) return;
    if (playing) { setPlaying(false); return; }
    if (replayIdx == null || replayIdx >= sortedEvents.length) setReplayIdx(1);
    setPlaying(true);
  };

  const deg = metrics.degree || new Map();
  const btw = metrics.betweenness || new Map();
  const ev = metrics.eigenvector || new Map();
  const comm = metrics.communities || new Map();
  const burstSet = new Set((temporal.bursts || []).map((b) => b.t));

  const focusDeg = focus ? (deg.get(focus) ?? focusedNode?.deg ?? 0) : 0;
  const focusIn = focus ? (baseGraph.links.filter((l) => (l.target?.id ?? l.target) === focus).length) : 0;
  const focusOut = focus ? (baseGraph.links.filter((l) => (l.source?.id ?? l.source) === focus).length) : 0;
  const focusRole = (() => {
    if (!focusedNode) return '';
    if ((focusedNode.posts || 0) > 0 && (focusedNode.replies || 0) > 0) return 'penulis & komentator';
    if ((focusedNode.posts || 0) > 0) return 'penulis';
    if ((btw.get(focus) || 0) > 0 && focusDeg >= 3) return 'penghubung';
    return 'komentator';
  })();

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col gap-3 bg-slate-50 p-4 dark:bg-slate-950' : 'space-y-4'}>
      {warn && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {warn}{' '}
          <button type="button" className="font-medium underline" onClick={() => setWarn('')}>Tutup</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="surface flex flex-wrap items-center gap-2.5 p-3">
        <input
          type="search"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="Filter node / teks..."
          className="input-field w-44"
        />

        <div className="flex items-center gap-3 border-l border-slate-200 pl-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {['komentar', 'mention', 'co-comment'].map((t) => (
            <label key={t} className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={types.has(t)}
                onChange={() => toggleType(t)}
                className="accent-blue-600"
              />
              <span className="capitalize">{t}</span>
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 border-l border-slate-200 pl-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
          <span>Min derajat</span>
          <input
            type="range"
            min={0}
            max={10}
            value={minDeg}
            onChange={(e) => setMinDeg(Number(e.target.value))}
            className="w-20 accent-blue-600"
          />
          <span className="w-4 font-mono tabular-nums font-medium">{minDeg}</span>
        </label>

        <select
          value={colorBy}
          onChange={(e) => setColorBy(e.target.value)}
          className="input-field"
        >
          <option value="peran">Warna: Peran Aktor</option>
          <option value="komunitas">Warna: Komunitas</option>
        </select>

        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={riskHighlight}
            onChange={(e) => setRiskHighlight(e.target.checked)}
            className="accent-red-600"
          />
          <span>Sorot risiko</span>
        </label>

        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={hulls}
            onChange={(e) => setHulls(e.target.checked)}
            className="accent-emerald-600"
          />
          <span>Gelembung</span>
        </label>

        {/* Time-lapse controls */}
        <div className="flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onPlay}
            className="btn-secondary"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? 'Jeda' : 'Time-Lapse'}
          </button>
          {replayIdx != null && (
            <>
              <input
                type="range"
                min={1}
                max={Math.max(1, sortedEvents.length)}
                value={replayIdx}
                onChange={(e) => { setPlaying(false); setReplayIdx(Number(e.target.value)); }}
                className="w-24 accent-blue-600"
              />
              <span className="font-mono text-[11px] tabular-nums text-slate-500">
                {replayIdx}/{sortedEvents.length}
              </span>
              <button
                type="button"
                onClick={() => { setPlaying(false); setReplayIdx(null); }}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                title="Reset time-lapse"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              className="btn-secondary"
            >
              <Download className="h-3.5 w-3.5" /> Ekspor
            </button>
            {exportOpen && (
              <div
                onMouseLeave={() => setExportOpen(false)}
                className="absolute right-0 top-full z-30 mt-1 flex w-40 flex-col rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                <button type="button" onClick={() => doExport('node')} className="rounded-md px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">CSV Node</button>
                <button type="button" onClick={() => doExport('edge')} className="rounded-md px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">CSV Edge</button>
                <button type="button" onClick={() => doExport('gml')} className="rounded-md px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">GraphML</button>
                <button type="button" onClick={() => doExport('svg')} className="rounded-md px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Gambar SVG</button>
                <button type="button" onClick={() => doExport('png')} className="rounded-md px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Gambar PNG</button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setFullscreen((v) => !v);
              requestAnimationFrame(() => { graphRef.current?.redrawKeep?.(); setTimeout(() => graphRef.current?.redrawKeep?.(), 80); });
            }}
            className="btn-secondary"
            title={fullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Split: Graph + Inspector */}
      <div className={`grid grid-cols-1 gap-4 xl:grid-cols-12 ${fullscreen ? 'min-h-0 flex-1' : ''}`}>
        <div className="surface relative h-[480px] overflow-hidden xl:col-span-8 xl:h-[540px]">
          <GraphCanvas
            ref={graphRef}
            graph={visibleGraph}
            metrics={metrics}
            colorBy={colorBy}
            focus={focus}
            isolate={isolate}
            riskHighlight={riskHighlight}
            riskById={riskById}
            keyword={appliedKw}
            hulls={hulls}
            onNodeClick={onNodeClick}
            onLinkClick={onLinkClick}
            onBackgroundClick={onBackgroundClick}
          />
        </div>

        {/* Right Inspector */}
        <aside className="surface flex h-[540px] flex-col overflow-hidden xl:col-span-4">
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            {[
              ['metrik', 'Metrik & Aktor'],
              ['anomali', `Anomali (${nf(scores.length)})`],
              ['timeline', 'Lonjakan'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setInspectorTab(key)}
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  inspectorTab === key
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 text-xs">
            {inspectorTab === 'metrik' && (
              <>
                {focusedNode ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          @{focusedNode.id}
                        </div>
                        <div className="mt-0.5 text-[11px] capitalize text-slate-500 dark:text-slate-400">
                          Peran: {focusRole} · Klaster #{(comm.get(focusedNode.id) ?? 0) + 1}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setIsolate((v) => !v)}
                          className={isolate ? 'btn-primary' : 'btn-secondary'}
                        >
                          {isolate ? 'Tampilkan Semua' : 'Isolasi Ego'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setFocus(null); setIsolate(false); setActor(''); }}
                          className="btn-secondary"
                        >
                          Tutup
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 border-y border-slate-100 py-3 dark:border-slate-800">
                      <div>
                        <span className="text-[11px] text-slate-500">Derajat / In / Out</span>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                          {nf(focusDeg)} ({nf(focusIn)} / {nf(focusOut)})
                        </div>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500">Pengaruh / Betweenness</span>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                          {((ev.get(focusedNode.id) || 0) * 100).toFixed(1)}% · {(btw.get(focusedNode.id) || 0).toFixed(1)}
                        </div>
                      </div>
                    </div>

                    {riskById.has(focusedNode.id) && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                        <div className="font-medium text-amber-800 dark:text-amber-300">
                          Skor Risiko Perilaku: {riskById.get(focusedNode.id).score}/100
                        </div>
                        <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-700 dark:text-amber-400">
                          {(riskById.get(focusedNode.id).reasons || []).map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <h4 className="mb-2 font-medium text-slate-800 dark:text-slate-200">
                        Riwayat Interaksi ({focusedInteractions.length})
                      </h4>
                      <div className="space-y-2.5">
                        {focusedInteractions.map((it, idx) => (
                          <div key={idx} className="border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {it.direction === 'keluar' ? 'Membalas' : 'Dibalas oleh'}{' '}
                              <button
                                type="button"
                                onClick={() => { const id = String(it.peer || '').toLowerCase(); setFocus(id); setActor(id); graphRef.current?.zoomTo(id); }}
                                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                @{it.peer}
                              </button>
                            </div>
                            <p className="mt-0.5 text-slate-700 dark:text-slate-300">{it.text}</p>
                          </div>
                        ))}
                        {focusedInteractions.length === 0 && (
                          <p className="text-slate-500 dark:text-slate-400">Belum ada interaksi tercatat.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : selectedLink ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        @{selectedLink.source} → @{selectedLink.target}
                      </div>
                      <button type="button" onClick={() => setSelectedLink(null)} className="btn-secondary">
                        Tutup
                      </button>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      Tipe relasi: <strong className="capitalize text-slate-800 dark:text-slate-200">{selectedLink.type}</strong> · Bobot {selectedLink.w || 0}
                    </div>
                    <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      {(selectedLink.samples || []).slice(0, 20).map((s, idx) => (
                        <div key={idx} className="border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                          <div className="font-mono text-[11px] text-slate-400">{s.postCode}</div>
                          <p className="mt-0.5 text-slate-700 dark:text-slate-300">{s.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                      <div>
                        <div className="text-[11px] text-slate-500">Node</div>
                        <div className="font-mono text-sm font-semibold tabular-nums">{nf(baseGraph.nodes.length)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">Relasi</div>
                        <div className="font-mono text-sm font-semibold tabular-nums">{nf(baseGraph.links.length)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">Komunitas</div>
                        <div className="font-mono text-sm font-semibold tabular-nums">{nf(communityCount)}</div>
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-2 font-medium text-slate-800 dark:text-slate-200">
                        Top Aktor Berdasarkan Pengaruh (PageRank)
                      </h4>
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {[...baseGraph.nodes]
                          .sort((a, b) => (ev.get(b.id) || 0) - (ev.get(a.id) || 0))
                          .slice(0, 10)
                          .map((n) => (
                            <li key={n.id} className="flex items-center justify-between py-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setFocus(n.id); setActor(n.id);
                                  setInspectorTab('metrik');
                                  graphRef.current?.zoomTo(n.id);
                                }}
                                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                @{n.id}
                              </button>
                              <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                deg {nf(deg.get(n.id) ?? n.deg)} · {((ev.get(n.id) || 0) * 100).toFixed(1)}%
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}

            {inspectorTab === 'anomali' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <label className="block">
                    <span className="text-[11px] text-slate-500">Jendela waktu (menit)</span>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={cibWindowMin}
                      onChange={(e) => setCibWindowMin(Math.max(1, Number(e.target.value) || 10))}
                      className="input-field mt-1 w-full"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-500">Min. akun identik</span>
                    <input
                      type="number"
                      min={2}
                      max={20}
                      value={cibMinAcc}
                      onChange={(e) => setCibMinAcc(Math.max(2, Number(e.target.value) || 3))}
                      className="input-field mt-1 w-full"
                    />
                  </label>
                </div>

                <div>
                  <h4 className="mb-2 font-medium text-slate-800 dark:text-slate-200">
                    Klaster Komentar Terkoordinasi ({nf((cib.clusters || []).length)})
                  </h4>
                  {(cib.clusters || []).length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400">
                      Tidak ada klaster koordinasi yang terdeteksi dengan parameter ini.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {(cib.clusters || []).map((c, i) => (
                        <div key={c.key || i} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                          <div className="flex justify-between font-medium text-amber-700 dark:text-amber-400">
                            <span>{nf((c.accounts || c.windowAuthors || []).length)} akun serempak</span>
                            <span className="font-mono tabular-nums">{Math.max(1, Math.round((c.spanMs || 0) / 60000))} mnt</span>
                          </div>
                          <p className="mt-1 text-slate-600 dark:text-slate-300">&ldquo;{c.text || c.sampleText}&rdquo;</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {(c.accounts || c.windowAuthors || []).map((acc) => (
                              <button
                                key={acc}
                                type="button"
                                onClick={() => {
                                  const id = String(acc).toLowerCase();
                                  setFocus(id); setActor(id);
                                  setInspectorTab('metrik');
                                  graphRef.current?.zoomTo(id);
                                }}
                                className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                @{acc}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 font-medium text-slate-800 dark:text-slate-200">
                    Skor Risiko Buzzer / Anomali
                  </h4>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {scores.map((s) => (
                      <li key={s.id} className="py-2">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => {
                              setFocus(s.id); setActor(s.id);
                              setInspectorTab('metrik');
                              graphRef.current?.zoomTo(s.id);
                            }}
                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            @{s.id}
                          </button>
                          <span
                            className={`font-mono font-semibold tabular-nums ${
                              s.score >= 70
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {s.score}/100
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {(s.reasons || []).join(' · ')}
                        </p>
                      </li>
                    ))}
                    {scores.length === 0 && (
                      <li className="py-2 text-slate-500 dark:text-slate-400">Belum ada skor risiko terdeteksi.</li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            {inspectorTab === 'timeline' && (
              <div className="space-y-3">
                <div className="text-slate-500 dark:text-slate-400">
                  {selectedBucket != null
                    ? `Menampilkan ${bucketItems.length} komentar pada ${new Date(selectedBucket).toLocaleString('id-ID')}`
                    : 'Klik salah satu batang pada grafik timeline di bawah untuk melihat aktivitas pada slot waktu tersebut.'}
                </div>
                {bucketItems.map((b, i) => (
                  <div key={i} className="border-b border-slate-100 pb-2 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500">
                      <button
                        type="button"
                        onClick={() => { const id = String(b.author || '').toLowerCase(); setFocus(id); setActor(id); setInspectorTab('metrik'); }}
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        @{b.author}
                      </button>{' '}
                      → @{b.target}
                    </div>
                    <p className="mt-0.5 text-slate-700 dark:text-slate-300">{b.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom Temporal Burst Strip */}
      <div className="surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Timeline Aktivitas &amp; Lonjakan (Burst)
            </span>
            <select
              value={tlGranularity}
              onChange={(e) => setTlGranularity(e.target.value)}
              className="input-field py-1"
            >
              <option value="auto">Granularitas: Otomatis</option>
              <option value="minute">Per Menit</option>
              <option value="hour">Per Jam</option>
              <option value="day">Per Hari</option>
            </select>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            {nf(temporal.total)} komentar · {nf((temporal.bursts || []).length)} lonjakan terdeteksi
          </span>
        </div>

        <div className="flex h-14 items-end gap-1 overflow-x-auto pt-2">
          {(temporal.buckets || []).map((b) => {
            const hPct = Math.max(12, Math.round((b.count / maxBucketCount) * 100));
            const isSel = selectedBucket === b.t;
            const isBurst = burstSet.has(b.t);
            return (
              <button
                key={b.t}
                type="button"
                onClick={() => {
                  setSelectedBucket(b.t);
                  setInspectorTab('timeline');
                }}
                title={`${new Date(b.t).toLocaleString('id-ID')}: ${b.count} komentar`}
                className={`min-w-[10px] flex-1 rounded-t-xs transition-opacity ${
                  isBurst
                    ? 'bg-amber-500'
                    : isSel
                    ? 'bg-blue-600 dark:bg-blue-400'
                    : 'bg-slate-300 hover:bg-blue-500 dark:bg-slate-700 dark:hover:bg-blue-500'
                }`}
                style={{ height: `${hPct}%` }}
              />
            );
          })}
          {!(temporal.buckets || []).length && (
            <div className="grid h-14 w-full place-items-center text-xs text-slate-400">Tidak ada data waktu</div>
          )}
        </div>
      </div>
    </div>
  );
}
