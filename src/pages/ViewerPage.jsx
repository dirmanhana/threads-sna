import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import GraphCanvas from '../components/GraphCanvas.jsx';
import Timeline from '../components/Timeline.jsx';
import InfoPanel from '../components/InfoPanel.jsx';
import { getJson } from '../lib/utils.js';
import { SAMPLE, authorUrl, buildEvents, cmp, postsUntil } from '../lib/viewerLib.js';
import { exportEdgesCsv, exportGraphMl, exportNodesCsv, exportPng, exportReport, exportSvg } from '../lib/exportGraph.js';
import '../../viewer_core.js';

const SNA = globalThis.SNA;

export default function ViewerPage() {
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
  const [panelUser, setPanelUser] = useState(null);
  const [panelMode, setPanelMode] = useState({ kind: 'default' });
  const [panelTab, setPanelTab] = useState('metrik');
  const [linkDetail, setLinkDetail] = useState(null);
  const [anonOpts, setAnonOpts] = useState({ windowMs: 600000, minAccounts: 3 });
  const [tlGran, setTlGran] = useState('auto');
  const [riskHighlight, setRiskHighlight] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [tlHidden, setTlHidden] = useState(false);
  const [anomalyTick, setAnomalyTick] = useState(0);
  const [replay, setReplay] = useState({ events: [], i: 0, playing: false, active: false });
  const [speed, setSpeed] = useState(5);
  const [warn, setWarn] = useState('');
  const [fs, setFs] = useState(false);
  const [anomaly, setAnomaly] = useState({ cib: { clusters: [] }, temporal: { buckets: [], bursts: [], total: 0, stepMs: 86400000 }, scores: [], byId: new Map() });

  /* ---------- data & derived state ---------- */
  const load = useCallback((d) => {
    const arr = Array.isArray(d) ? d : (d && Array.isArray(d.posts) ? d.posts : []);
    setAll(arr);
    setReplay({ events: buildEvents(SNA, arr), i: 0, playing: false, active: false });
    setFocus(null); setIsolate(false); setPanelUser(null); setPanelMode({ kind: 'default' });
    setPanelTab('metrik');
    setSelectedBucket(null); setLinkDetail(null); setWarn('');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await getJson('data.json');
      if (!alive) return;
      if (d && (Array.isArray(d) || Array.isArray(d.posts))) {
        try { load(d); } catch (e) { setWarn('data.json terbaca, tetapi gagal dirender: ' + (e?.message || e)); load(SAMPLE); }
      } else {
        load(SAMPLE);
        setWarn('Gagal memuat data.json — menampilkan data contoh. Buka lewat ./run.sh serve agar fetch lokal diizinkan.');
      }
    })();
    return () => { alive = false; };
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => setAppliedKw(kw), 250);
    return () => clearTimeout(id);
  }, [kw]);

  const posts = useMemo(() => {
    if (!appliedKw.trim()) return all;
    const k = appliedKw.trim().toLowerCase();
    const has = (t) => String(t == null ? '' : t).toLowerCase().includes(k);
    return all.map((p) => {
      if (has(p.text) || has(p.author)) return p;
      const rs = (p.replies || []).filter((r) => has(r.text) || has(r.author));
      if (rs.length) return { ...p, replies: rs };
      const th = (p.thread || []).filter((t) => has(t.text) || has(t.author));
      if (th.length) return { ...p, thread: th };
      return null;
    }).filter(Boolean);
  }, [all, appliedKw]);

  const graphOpts = useMemo(() => ({ types, minDeg, dateFrom, dateTo }), [types, minDeg, dateFrom, dateTo]);
  const baseGraph = useMemo(() => SNA.build(posts, graphOpts), [posts, graphOpts]);
  const metrics = useMemo(() => SNA.analyze(baseGraph), [baseGraph]);

  const drawnPosts = replay.active ? postsUntil(replay.events, replay.i) : posts;
  const drawnGraph = useMemo(
    () => (replay.active ? SNA.build(drawnPosts, graphOpts) : baseGraph),
    [replay.active, replay.i, drawnPosts, graphOpts, baseGraph],
  );

  const visibleGraph = useMemo(() => {
    const g = drawnGraph;
    if (!isolate || !focus) return g;
    const ids = new Set([focus]);
    g.links.forEach((l) => {
      const s = l.source?.id ?? l.source, t = l.target?.id ?? l.target;
      if (s === focus) ids.add(t);
      if (t === focus) ids.add(s);
    });
    return {
      nodes: g.nodes.filter((n) => ids.has(n.id)),
      links: g.links.filter((l) => ids.has(l.source?.id ?? l.source) && ids.has(l.target?.id ?? l.target)),
    };
  }, [drawnGraph, isolate, focus]);

  /* ---------- anomali & timeline ---------- */
  useEffect(() => {
    try {
      const cib = SNA.detectCIB(posts, { windowMs: anonOpts.windowMs, minAccounts: anonOpts.minAccounts });
      const temporal = SNA.temporalBuckets(posts, { granularity: tlGran });
      const scores = SNA.buzzerScores(posts, { clusters: cib.clusters });
      setAnomaly({ cib, temporal, scores, byId: new Map(scores.map((s) => [s.id, s])) });
      if (selectedBucket != null && !temporal.buckets.some((b) => b.t === selectedBucket)) setSelectedBucket(null);
    } catch (e) {
      setWarn('Gagal menghitung anomali: ' + (e?.message || e));
    }
  }, [posts, tlGran, anonOpts, anomalyTick]);

  const tlInfo = useMemo(() => {
    const t = anomaly.temporal || {};
    return t.total
      ? `${t.total} komentar · per ${t.granularity === 'day' ? 'hari' : t.granularity === 'hour' ? 'jam' : 'menit'}` +
        ` · ${(t.bursts || []).length} lonjakan${t.hasTime ? '' : ' · timestamp hanya tanggal'}`
      : 'tidak ada komentar bertimestamp';
  }, [anomaly]);

  /* ---------- daftar aktor & statistik ---------- */
  const actorIds = useMemo(() => {
    const g = SNA.build(all, { types: new Set(['komentar', 'mention']), minDeg: 0 });
    const deg = new Map(g.nodes.map((n) => [n.id, n.deg]));
    return [...deg.keys()].sort((a, b) => deg.get(b) - deg.get(a) || cmp(a, b)).map((id) => [id, deg.get(id)]);
  }, [all]);

  const stats = useMemo(() => {
    const np = posts.length;
    const nc = posts.reduce((a, p) => a + ((p.replies || []).length), 0);
    const nt = posts.reduce((a, p) => a + ((p.thread || []).length), 0);
    return { np, nc, nt, na: baseGraph.nodes.length, nl: baseGraph.links.length };
  }, [posts, baseGraph]);

  /* ---------- replay ---------- */
  useEffect(() => {
    if (!replay.playing) return;
    const id = setInterval(() => {
      const step = Math.max(1, Number(speed) || 1);
      setReplay((r) => ({ ...r, i: Math.min(r.events.length, r.i + step) }));
    }, 120);
    return () => clearInterval(id);
  }, [replay.playing, speed]);

  useEffect(() => {
    if (replay.playing && replay.i >= replay.events.length) {
      setReplay((r) => ({ ...r, playing: false, active: false, i: r.events.length }));
      setPanelMode({ kind: 'default' });
    }
  }, [replay.i, replay.events.length, replay.playing]);

  const replayInfo = useMemo(() => {
    const n = replay.i, total = replay.events.length;
    return `${n} / ${total} peristiwa` + (total ? ` · ${n ? new Date(replay.events[n - 1].t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : 'mulai'}` : '');
  }, [replay]);

  /* ---------- fullscreen ---------- */
  const toggleFs = useCallback(() => {
    const next = !fs;
    setFs(next);
    try {
      if (next) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* abaikan */ }
    requestAnimationFrame(() => {
      graphRef.current?.redrawKeep();
      setTimeout(() => graphRef.current?.redrawKeep(), 80);
    });
  }, [fs]);

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement && fs) setFs(false); };
    const onKey = (e) => { if (e.key === 'Escape' && fs) toggleFs(); };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('keydown', onKey); };
  }, [fs, toggleFs]);

  /* ---------- aksi ---------- */
  const stopReplay = (keepPosition = false) => setReplay((r) => ({
    ...r, playing: false, active: keepPosition ? r.active : false, i: keepPosition ? r.i : r.events.length,
  }));

  const openAnomaly = () => {
    if (replay.active) stopReplay(false);
    setPanelMode({ kind: 'default' });
    setPanelTab('anomali');
  };

  const changeFilter = (fn) => {
    if (replay.active) { stopReplay(false); setPanelMode({ kind: 'default' }); }
    fn();
  };

  const toggleType = (t, on) => changeFilter(() => setTypes((prev) => {
    const next = new Set(prev);
    on ? next.add(t) : next.delete(t);
    return next;
  }));

  const onPlay = () => {
    if (!replay.events.length) return;
    if (replay.playing) { setReplay((r) => ({ ...r, playing: false })); return; }
    const start = replay.i >= replay.events.length ? 0 : replay.i;
    setReplay((r) => ({ ...r, i: start, playing: true, active: true }));
    setPanelMode({ kind: 'replay' });
  };

  const onScrub = (val) => {
    if (!replay.events.length) return;
    const target = Math.max(0, Math.min(replay.events.length, Number(val) || 0));
    setReplay((r) => ({ ...r, playing: false, active: true, i: target }));
    setPanelMode({ kind: 'replay' });
  };

  const focusUser = (id, zoom = true) => {
    setFocus(id); setIsolate(false); setPanelUser(id); setActor(id); setPanelMode({ kind: 'user' });
    if (zoom) requestAnimationFrame(() => graphRef.current?.zoomTo(id));
  };
  const unfocus = () => { setFocus(null); setIsolate(false); setPanelUser(null); setActor(''); setPanelMode({ kind: 'default' }); };

  /* Pencarian global mengarah ke /viewer.html?focus=<akun>. */
  const focusApplied = useRef(false);
  useEffect(() => {
    if (focusApplied.current || !baseGraph.nodes.length) return;
    focusApplied.current = true;
    const raw = (new URLSearchParams(globalThis.location.search).get('focus') || '').trim().replace(/^@/, '');
    if (!raw) return;
    const hit = baseGraph.nodes.find((n) => n.id.toLowerCase() === raw.toLowerCase());
    if (!hit) { setWarn(`Akun @${raw} tidak ditemukan di graf.`); return; }
    focusUser(hit.id, true);
  }, [baseGraph]);

  const onNodeClick = (id) => focusUser(id, true);
  const onLinkClick = (l) => { setLinkDetail(l); setPanelUser(null); setPanelMode({ kind: 'link' }); };
  const onActor = (id) => {
    stopReplay(true);
    if (!id) { unfocus(); return; }
    focusUser(id, true);
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { load(JSON.parse(String(r.result).replace(/^\uFEFF/, ''))); }
      catch (x) { setWarn('File JSON tidak valid — data tidak diubah.'); }
    };
    r.onerror = () => setWarn('Gagal membaca file — data tidak diubah.');
    r.readAsText(f);
    e.target.value = '';
  };

  const doExport = (kind) => {
    const svg = graphRef.current?.getSvg();
    if (!svg) return;
    const g = visibleGraph;
    const ctx = { posts, metrics, anomaly, colorBy, communitySizes: SNA.communitySizes };
    switch (kind) {
      case 'node': exportNodesCsv(g, metrics, setWarn); break;
      case 'edge': exportEdgesCsv(g, setWarn); break;
      case 'gml': exportGraphMl(g, metrics, setWarn); break;
      case 'svg': exportSvg(svg, g, setWarn); break;
      case 'png': exportPng(svg, g, setWarn); break;
      case 'reportSvg': exportReport(svg, g, ctx, 'svg', setWarn); break;
      case 'reportPng': exportReport(svg, g, ctx, 'png', setWarn); break;
      default: break;
    }
  };

  const panelModeEffective = replay.active ? 'replay' : panelMode.kind;
  const riskById = anomaly.byId;

  const actions = (
    <span className="hidden text-xs text-slate-500 sm:block dark:text-gray-400">
      {stats.np} post · {stats.nc} komentar · {stats.nt} thread · {stats.na} akun · {stats.nl} relasi
      {appliedKw.trim() ? ` · dari ${all.length} post` : ''}
    </span>
  );

  return (
    <Layout page="viewer" title="Peta Jaringan" subtitle="Siapa bicara dengan siapa — interaktif, lokal, tanpa backend"
      wide actions={actions}>
      <div className="flex flex-col gap-3 xl:h-[calc(100vh-248px)] xl:min-h-[620px]">
        {warn && (
          <div className="rounded-xl bg-red-700 px-4 py-2.5 text-sm text-white">{warn}
            <button className="ml-3 underline" onClick={() => setWarn('')}>tutup</button>
          </div>
        )}

        {!fs && (
          <div className="card space-y-2 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input className="field min-w-[180px] flex-1" type="search" placeholder="Cari kata kunci / @akun…" value={kw}
                onChange={(e) => changeFilter(() => setKw(e.target.value))} />
              <button className="btn" onClick={() => fileRef.current?.click()}>Muat data.json</button>
              <input ref={fileRef} type="file" accept=".json" hidden onChange={onFile} />
              <button className="btn" onClick={() => { unfocus(); graphRef.current?.redraw(); }}>Reset pilihan</button>
              <button className="btn" onClick={() => graphRef.current?.resetZoom()}>Reset zoom</button>
              <button className="btn" onClick={toggleFs}>Layar penuh</button>
              <select className="field" value={colorBy} onChange={(e) => setColorBy(e.target.value)} title="Warna node">
                <option value="peran">Warna: Peran</option><option value="komunitas">Warna: Komunitas</option>
              </select>
              <span className="hidden items-center gap-0.5 text-[11px] text-slate-400 xl:flex">
                <i className="mr-0.5 inline-block h-[3px] w-3.5" style={{ background: 'var(--c1)' }} />komentar
                <i className="ml-2 mr-0.5 inline-block h-[3px] w-3.5" style={{ background: 'var(--c2)' }} />mention
                <i className="ml-2 mr-0.5 inline-block h-[3px] w-3.5" style={{ background: 'var(--c4)' }} />co-comment
              </span>
              <details className="relative">
                <summary className="btn cursor-pointer list-none">Ekspor ▾</summary>
                <div className="absolute right-0 top-full z-30 mt-1 flex min-w-[160px] flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  <button className="btn" onClick={() => doExport('node')}>CSV node</button>
                  <button className="btn" onClick={() => doExport('edge')}>CSV edge</button>
                  <button className="btn" onClick={() => doExport('gml')}>GraphML</button>
                  <button className="btn" onClick={() => doExport('png')}>PNG</button>
                  <button className="btn" onClick={() => doExport('svg')}>SVG</button>
                  <button className="btn" onClick={() => doExport('reportPng')}>PNG laporan</button>
                  <button className="btn" onClick={() => doExport('reportSvg')}>SVG laporan</button>
                </div>
              </details>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-gray-700 dark:text-gray-400">
              <label className="flex items-center gap-1"><input type="checkbox" checked={types.has('komentar')}
                onChange={(e) => toggleType('komentar', e.target.checked)} /> komentar</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={types.has('mention')}
                onChange={(e) => toggleType('mention', e.target.checked)} /> mention</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={types.has('co-comment')}
                onChange={(e) => toggleType('co-comment', e.target.checked)} /> co-comment</label>
              <label className="flex items-center gap-1">min derajat
                <input type="range" min="0" max="20" step="1" value={minDeg} className="w-24 accent-brand-600"
                  onChange={(e) => changeFilter(() => { setMinDeg(Number(e.target.value) || 0); })} />
                <b className="text-slate-700 dark:text-gray-200">{minDeg}</b></label>
              <label className="flex items-center gap-1">dari
                <input type="date" className="field" value={dateFrom} onChange={(e) => changeFilter(() => setDateFrom(e.target.value))} /></label>
              <label className="flex items-center gap-1">sampai
                <input type="date" className="field" value={dateTo} onChange={(e) => changeFilter(() => setDateTo(e.target.value))} /></label>
              <label className="flex items-center gap-1">akun
                <select className="field max-w-[190px]" value={actor} onChange={(e) => onActor(e.target.value)}>
                  <option value="">— Pilih akun —</option>
                  {actorIds.map(([id, n]) => <option key={id} value={id}>@{id} ({n})</option>)}
                </select></label>
              <span className="flex items-center gap-1">time-lapse
                <button className="btn" onClick={onPlay}>{replay.playing ? '⏸ Jeda' : (replay.i && replay.i < replay.events.length ? '▶ Lanjut' : '▶ Putar')}</button>
                <input type="range" min="0" max={replay.events.length} value={replay.i} className="w-32 accent-brand-600"
                  onChange={(e) => onScrub(e.target.value)} />
                <select className="field" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Kecepatan putar">
                  <option value="1">1×</option><option value="5">5×</option><option value="20">20×</option>
                </select></span>
              <span className="min-w-[150px] font-variant-numeric tabular-nums">{replayInfo}</span>
              <button className="btn" onClick={openAnomaly} title="Deteksi komentar terkoordinasi & skor buzzer">🚨 Anomali</button>
            </div>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-12">
          <div className={`card relative h-[420px] min-w-0 overflow-hidden bg-white sm:h-[520px] xl:h-auto xl:min-h-0 dark:bg-gray-900 ${fs ? 'xl:col-span-12' : 'xl:col-span-8'}`}>
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
              onNodeClick={onNodeClick}
              onLinkClick={onLinkClick}
              onBackgroundClick={() => { setPanelUser(null); setPanelMode({ kind: 'default' }); }}
            />
          </div>
          {!fs && (
            <aside className="min-h-0 xl:col-span-4">
              <div className="card flex max-h-[70vh] flex-col overflow-hidden text-xs xl:h-full xl:max-h-none">
                <InfoPanel
                  SNA={SNA} mode={panelModeEffective} posts={posts} graph={baseGraph} metrics={metrics}
                  anomaly={anomaly} anonOpts={anonOpts} replay={replay} keyword={appliedKw}
                  selectedBucket={selectedBucket} focus={focus} isolate={isolate} panelUser={panelUser}
                  linkDetail={linkDetail} tab={panelTab} onTab={setPanelTab}
                  onFocus={(u) => focusUser(u, true)} onUnfocus={unfocus}
                  onToggleIsolate={() => { if (!panelUser) return; setFocus(panelUser); setIsolate((v) => !v); setActor(panelUser); setPanelMode({ kind: 'user' }); }}
                  onOpenThreads={() => { if (panelUser) window.open(authorUrl(all, panelUser), '_blank', 'noopener'); }}
                  onAnomalyPanel={openAnomaly}
                  onClosePanel={() => setPanelMode({ kind: 'default' })}
                  onBucket={(t) => { setSelectedBucket(t); setPanelMode({ kind: 'bucket' }); }}
                  onReplayBack={() => { stopReplay(false); setPanelMode({ kind: 'default' }); }}
                  onRefreshAnomaly={() => setAnomalyTick((t) => t + 1)}
                  onAnonWin={(v) => setAnonOpts((o) => ({ ...o, windowMs: v * 60000 }))}
                  onAnonMin={(v) => setAnonOpts((o) => ({ ...o, minAccounts: v }))}
                />
              </div>
            </aside>
          )}
        </div>

        {!fs && (
          <div className="card p-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <b className="text-slate-700 dark:text-gray-200">Timeline komentar</b>
              <select className="field" value={tlGran} onChange={(e) => { setTlGran(e.target.value); setAnomalyTick((t) => t + 1); }} title="Granularitas waktu">
                <option value="auto">Otomatis</option><option value="minute">Menit</option>
                <option value="hour">Jam</option><option value="day">Hari</option>
              </select>
              <span className="text-slate-500 dark:text-gray-400">{tlInfo}</span>
              <label className="ml-auto flex items-center gap-1 text-slate-500 dark:text-gray-400">
                <input type="checkbox" checked={riskHighlight} onChange={(e) => setRiskHighlight(e.target.checked)} /> sorot akun berisiko
              </label>
              <button className="btn" onClick={() => { setTlHidden((v) => !v); if (tlHidden) requestAnimationFrame(() => graphRef.current?.redrawKeep()); }}>
                {tlHidden ? 'Tampilkan' : 'Sembunyikan'}
              </button>
            </div>
            {!tlHidden && <Timeline temporal={anomaly.temporal} selectedBucket={selectedBucket} onSelect={(t) => { setSelectedBucket(t); setPanelMode({ kind: 'bucket' }); }} />}
          </div>
        )}
      </div>

      {fs && (
        <button onClick={toggleFs} title="Keluar layar penuh (Esc)"
          className="fixed right-3 top-3 z-[1000] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
          Keluar layar penuh ✕
        </button>
      )}
    </Layout>
  );
}
