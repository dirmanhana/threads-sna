import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { SentimentDonutChart, SentimentTrendChart, TopicRankBars } from '../components/Charts.jsx';
import { api, getJson } from '../lib/utils.js';
import { currentProject as getProject, projectFile } from '../lib/project.js';
import '../../viewer_core.js';

const SNA = globalThis.SNA;
const nf = (v) => Number(v || 0).toLocaleString('id-ID');

function contentKey(author, postCode, text) {
  if (SNA?.contentKey) return SNA.contentKey(author, postCode, text);
  const raw = `${String(author || '').trim().toLowerCase()}|${String(postCode || '').trim()}|${String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export default function SummaryPage({ embedded = false, project: projectProp, onTab }) {
  const project = projectProp || getProject();
  const [posts, setPosts] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [projectMeta, setProjectMeta] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [briefing, setBriefing] = useState(null);
  const [briefingError, setBriefingError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, a, p] = await Promise.all([
        getJson(projectFile('data.json', project)),
        getJson(projectFile('llm_analysis.json', project)),
        api('/api/projects'),
      ]);
      if (!alive) return;
      const list = Array.isArray(d) ? d : (Array.isArray(d?.posts) ? d.posts : []);
      setPosts(list);
      setAnalysis(a && typeof a === 'object' && !Array.isArray(a) ? a : null);
      const projs = p.ok && Array.isArray(p.data?.projects) ? p.data.projects : [];
      setProjectMeta(projs.find((x) => x.slug === project) || { slug: project, name: project });
    })();
    return () => { alive = false; };
  }, [project]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await api('/api/status?project=' + encodeURIComponent(project || 'default'));
      if (!alive) return;
      setAnalyzing(!!(s.ok && s.data?.running));
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [project]);

  const goTab = (tab, focusActor) => {
    if (typeof onTab === 'function') onTab(tab, focusActor || null);
  };

  const runBatchAnalyze = async () => {
    if (analyzing) return;
    const r = await api('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project || 'default' }),
    });
    if (r.ok || r.status === 409) setAnalyzing(true);
  };

  const graph = useMemo(() => {
    if (!SNA || !posts.length) return { nodes: [], links: [] };
    return SNA.build(posts, { types: new Set(['komentar', 'mention']), minDeg: 1 });
  }, [posts]);
  const metrics = useMemo(() => (SNA && posts.length ? SNA.analyze(graph) : { degree: new Map(), betweenness: new Map(), closeness: new Map(), eigenvector: new Map(), communities: new Map() }), [graph, posts.length]);
  const baseTemporal = useMemo(() => (SNA && posts.length ? SNA.temporalBuckets(posts, { granularity: 'auto' }) : { buckets: [], bursts: [], stepMs: 3600000, total: 0, hasTime: false, granularity: 'hour' }), [posts]);
  const temporal = useMemo(() => {
    const labels = analysis?.comments || {};
    if (!baseTemporal.buckets?.length || !Object.keys(labels).length) return baseTemporal;
    const step = baseTemporal.stepMs || 3600000;
    const bucketMap = new Map(baseTemporal.buckets.map((b) => [b.t, { ...b, positif: 0, netral: 0, negatif: 0 }]));
    for (const p of posts) {
      for (const r of (p.replies || [])) {
        const t = SNA?.parseDate ? SNA.parseDate(r.timestamp) : (Date.parse(r.timestamp) || null);
        if (t == null) continue;
        const bt = Math.floor(t / step) * step;
        const b = bucketMap.get(bt);
        if (!b) continue;
        const key = contentKey(r.author, p.code, r.text);
        const s = labels[key]?.sentiment;
        if (s === 'positif') b.positif += 1;
        else if (s === 'negatif') b.negatif += 1;
        else b.netral += 1;
      }
    }
    return { ...baseTemporal, buckets: baseTemporal.buckets.map((b) => bucketMap.get(b.t) || b) };
  }, [baseTemporal, posts, analysis]);
  const cib = useMemo(() => (SNA && posts.length ? SNA.detectCIB(posts, { windowMs: 600000, minAccounts: 3 }) : { clusters: [] }), [posts]);
  const scores = useMemo(() => (SNA && posts.length ? SNA.buzzerScores(posts, { clusters: cib.clusters, bursts: temporal.bursts, stepMs: temporal.stepMs }) : []), [posts, cib.clusters, temporal.bursts, temporal.stepMs]);
  const scoreMap = useMemo(() => new Map(scores.map((s) => [s.id, s])), [scores]);

  const stats = useMemo(() => {
    const comments = posts.reduce((acc, p) => acc + ((p.replies || []).length), 0);
    const highRisk = scores.filter((s) => s.score >= 70).length;
    return {
      posts: posts.length,
      comments,
      accounts: (graph.nodes || []).length,
      links: (graph.links || []).length,
      highRisk,
    };
  }, [posts, graph, scores]);

  const sentimentCounts = useMemo(() => {
    const res = { positif: 0, netral: 0, negatif: 0, toxic: 0, spam: 0 };
    const c = analysis?.comments || {};
    for (const v of Object.values(c)) {
      if (!v || typeof v !== 'object') continue;
      if (v.sentiment === 'positif') res.positif += 1;
      else if (v.sentiment === 'negatif') res.negatif += 1;
      else res.netral += 1;
      if (Number(v.toxicity) >= 0.6) res.toxic += 1;
      if (v.spam) res.spam += 1;
    }
    return res;
  }, [analysis]);

  const topActors = useMemo(() => {
    const deg = metrics.degree || new Map();
    const btw = metrics.betweenness || new Map();
    const ev = metrics.eigenvector || new Map();
    return (graph.nodes || [])
      .map((n) => {
        const d = deg.get(n.id) ?? n.deg ?? 0;
        const pr = ev.get(n.id) ?? 0; // eigenvector sebagai proksi pengaruh
        const risk = scoreMap.get(n.id)?.score ?? 0;
        let role = 'komentator';
        if ((n.posts || 0) > 0 && (n.replies || 0) > 0) role = 'penulis & komentator';
        else if ((n.posts || 0) > 0) role = 'penulis';
        else if ((btw.get(n.id) || 0) > 0 && d >= 3) role = 'penghubung';
        return { ...n, deg: d, pr, risk, role };
      })
      .sort((a, b) => b.deg - a.deg || b.pr - a.pr)
      .slice(0, 7);
  }, [graph.nodes, metrics, scoreMap]);

  const topTopics = useMemo(() => {
    if (!Array.isArray(analysis?.topics)) return [];
    return [...analysis.topics].sort((a, b) => (b.count || 0) - (a.count || 0));
  }, [analysis]);

  const generateBriefing = () => {
    setBriefingError('');
    try {
      const labeled = sentimentCounts.positif + sentimentCounts.netral + sentimentCounts.negatif;
      const negPct = labeled ? Math.round((sentimentCounts.negatif / labeled) * 100) : 0;
      const posPct = labeled ? Math.round((sentimentCounts.positif / labeled) * 100) : 0;
      const top = topActors.slice(0, 3).map((a) => `@${a.id}`).join(', ') || 'belum teridentifikasi';
      const topTopic = topTopics[0]?.label || 'belum terklasifikasi';
      const lines = [
        `• Ringkasan: ${nf(stats.posts)} postingan dan ${nf(stats.comments)} komentar dari ${nf(stats.accounts)} akun dengan ${nf(stats.links)} relasi.`,
        labeled
          ? `• Sentimen: ${posPct}% positif, ${negPct}% negatif dari ${nf(labeled)} komentar berlabel; ${nf(sentimentCounts.toxic)} terindikasi toksik dan ${nf(sentimentCounts.spam)} spam.`
          : '• Sentimen: belum ada komentar berlabel; jalankan Analisis AI untuk klasifikasi.',
        `• Topik dominan: ${topTopic}. Aktor sentral: ${top}.`,
        `• Anomali: ${nf(stats.highRisk)} akun risiko tinggi, ${nf(cib.clusters.length)} klaster terkoordinasi, ${nf(temporal.bursts.length)} lonjakan aktivitas.`,
        '• Saran: tinjau akun/klaster berisiko di Peta Jaringan dan prioritaskan respons pada topik dengan sentimen negatif tinggi.',
      ];
      setBriefing({ text: lines.join('\n'), generatedAt: new Date().toISOString() });
    } catch (e) {
      setBriefingError('Gagal menghasilkan ringkasan.');
    }
  };

  const projectName = projectMeta?.name || project || 'default';

  if (posts.length === 0) {
    return (
      <div className="surface p-8 text-center">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Proyek &ldquo;{projectName}&rdquo; belum memiliki data
        </h2>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Tambahkan postingan/komentar atau impor file JSON dataset Anda untuk mulai memetakan jaringan interaksi dan sentimen.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={() => goTab('sumber')} className="btn-primary">
            Tambah atau Impor Data
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="surface p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Postingan</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
            {nf(stats.posts)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Threads
          </div>
        </div>

        <div className="surface p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Interaksi Komentar</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
            {nf(stats.comments)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {nf(Object.keys(analysis?.comments || {}).length)} telah berlabel sentimen
          </div>
        </div>

        <div className="surface p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Aktor &amp; Relasi SNA</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
            {nf(stats.accounts)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {nf(stats.links)} relasi · {nf(SNA?.communitySizes ? SNA.communitySizes(metrics.communities).size : 0)} komunitas
          </div>
        </div>

        <div className="surface p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Sinyal Anomali</div>
          <div
            className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
              stats.highRisk > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {nf(stats.highRisk)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {nf(cib.clusters.length)} klaster terkoordinasi · {nf(temporal.bursts.length)} lonjakan
          </div>
        </div>
      </div>

      {/* Main Analytics Row */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="surface p-5 xl:col-span-8">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Tren Volume &amp; Polaritas Waktu Nyata
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Agregasi per {temporal.granularity === 'day' ? 'hari' : temporal.granularity === 'hour' ? 'jam' : 'menit'} · klik batang untuk detail di peta jaringan
              </p>
            </div>
            <button
              type="button"
              onClick={() => goTab('jaringan')}
              className="btn-secondary"
            >
              Buka Peta Jaringan <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <SentimentTrendChart
            buckets={temporal.buckets}
            granularity={temporal.granularity}
            onSelectBucket={() => goTab('jaringan')}
          />
        </section>

        <section className="surface flex flex-col justify-between p-5 xl:col-span-4">
          <div>
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Distribusi Sentimen
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Klasifikasi konteks komentar
                </p>
              </div>
              <button type="button" onClick={() => goTab('sentimen')} className="btn-secondary">
                Detail
              </button>
            </div>

            {sentimentCounts.positif + sentimentCounts.netral + sentimentCounts.negatif > 0 ? (
              <SentimentDonutChart
                positif={sentimentCounts.positif}
                netral={sentimentCounts.netral}
                negatif={sentimentCounts.negatif}
              />
            ) : (
              <div className="py-8 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Belum ada komentar yang dianalisis.
                </p>
                <button
                  type="button"
                  onClick={runBatchAnalyze}
                  disabled={analyzing}
                  className="btn-primary mt-3"
                >
                  {analyzing ? 'Menganalisis...' : 'Jalankan Analisis AI'}
                </button>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>Toksik &ge; 0,6: <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{nf(sentimentCounts.toxic)}</strong></span>
            <span>Terindikasi Spam: <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{nf(sentimentCounts.spam)}</strong></span>
          </div>
        </section>
      </div>

      {/* Actors & Topics Row */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="surface p-5 xl:col-span-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Aktor Sentral dalam Jaringan (SNA)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Peringkat berdasarkan derajat interaksi dan skor pengaruh PageRank
              </p>
            </div>
            <button type="button" onClick={() => goTab('jaringan')} className="btn-secondary">
              Lihat Semua
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pr-3">Akun</th>
                  <th className="py-2 pr-3">Peran</th>
                  <th className="py-2 pr-3 text-right">Derajat</th>
                  <th className="py-2 pr-3 text-right">PageRank</th>
                  <th className="py-2 text-right">Risiko Koordinasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {topActors.map((a) => (
                  <tr
                    key={a.id}
                    className="h-10 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-2 pr-3 font-medium">
                      <button
                        type="button"
                        onClick={() => goTab('jaringan', a.id)}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        @{a.id}
                      </button>
                    </td>
                    <td className="py-2 pr-3 capitalize text-slate-600 dark:text-slate-300">
                      {a.role}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {nf(a.deg)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {(a.pr * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {a.risk >= 70 ? (
                        <span className="font-medium text-red-600 dark:text-red-400">
                          Tinggi ({a.risk})
                        </span>
                      ) : a.risk >= 40 ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          Sedang ({a.risk})
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface p-5 xl:col-span-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Topik Percakapan Dominan
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Klaster tema hasil ekstraksi model bahasa
              </p>
            </div>
            <button type="button" onClick={() => goTab('sentimen')} className="btn-secondary">
              Filter Topik
            </button>
          </div>
          <TopicRankBars topics={topTopics} />
        </section>
      </div>

      {/* Bottom Row: CIB Alert Summary + Executive Briefing */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="surface p-5 xl:col-span-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Deteksi Koordinasi &amp; Anomali (CIB)
              </h2>
            </div>
            <button type="button" onClick={() => goTab('jaringan')} className="btn-secondary">
              Inspeksi
            </button>
          </div>

          {cib.clusters.length > 0 ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {cib.clusters.slice(0, 3).map((c) => (
                <li key={c.id} className="py-3 first:pt-1 last:pb-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {c.accounts.length} akun mengirim teks identik
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
                      {Math.max(1, Math.round((c.spanMs || 0) / 60000))} menit
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">
                    &ldquo;{c.sampleText}&rdquo;
                  </p>
                  <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Akun: {c.accounts.slice(0, 4).map((acc) => `@${acc}`).join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-xs text-slate-500 dark:text-slate-400">
              Tidak ditemukan pola komentar duplikat terkoordinasi pada jendela waktu 10 menit.
            </p>
          )}
        </section>

        <section className="surface p-5 xl:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Ringkasan Intelijen Eksekutif
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Sintesis otomatis narasi publik, polarisasi aktor, dan langkah respons
              </p>
            </div>
            <button
              type="button"
              onClick={generateBriefing}
              className="btn-primary"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {briefing ? 'Perbarui Ringkasan' : 'Buat Ringkasan AI'}
            </button>
          </div>

          {briefingError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {briefingError}
            </div>
          )}

          {briefing ? (
            <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                {briefing.text}
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                Dibuat pada {new Date(briefing.generatedAt).toLocaleString('id-ID')}
              </div>
            </div>
          ) : (
            !briefingError && (
              <div className="border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
                Klik tombol &ldquo;Buat Ringkasan AI&rdquo; untuk menyusun ringkasan dari gabungan data jaringan interaksi, tren sentimen, dan anomali yang sedang aktif.
              </div>
            )
          )}
        </section>
      </div>
    </div>
  );
}
