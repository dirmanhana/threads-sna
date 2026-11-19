import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Card, { CardBody, CardHeader } from '../components/Card.jsx';
import KpiCard from '../components/KpiCard.jsx';
import StatusPill from '../components/StatusPill.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { BarChart, Donut, RankBars } from '../components/MiniCharts.jsx';
import { api, formatDate, getJson } from '../lib/utils.js';
import { currentProject as getProject, projectFile, withProject } from '../lib/project.js';
import '../../viewer_core.js';

const SNA = globalThis.SNA;
const DAY = 86400000;
const SENT_COLORS = { positif: '#16a34a', netral: '#94a3b8', negatif: '#dc2626' };
const nf = (v) => Number(v || 0).toLocaleString('id-ID');

function shortDate(t, granularity) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  if (granularity === 'hour') return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}
function roleOf(n) { if (n.posts && n.replies) return 'penulis & komentator'; if (n.posts) return 'penulis'; return 'komentator'; }
function riskTone(score) { if (score >= 70) return 'red'; if (score >= 40) return 'amber'; return 'slate'; }

function SentimentLegend({ rows }) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <ul className="w-full space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="flex-1 capitalize text-slate-600 dark:text-slate-300">{r.label}</span>
          <span className="tabular-nums font-medium text-slate-800 dark:text-white">{nf(r.value)}</span>
          <span className="w-10 text-right tabular-nums text-slate-500 dark:text-slate-400">{Math.round((r.value / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

function stackedVolume(temporal) {
  // tanpa label sentimen per-bucket di data SNA, tampilkan batang total gaya NusaPulse
  const buckets = temporal.buckets.slice(-28);
  return buckets.map((b) => ({
    label: shortDate(b.t, temporal.granularity),
    value: b.count,
    title: `${new Date(b.t).toLocaleString('id-ID')}: ${b.count} komentar`,
  }));
}

export default function SummaryPage({ embedded = false, project: projectProp, onTab }) {
  const project = projectProp || getProject();
  const [posts, setPosts] = useState([]);
  const [llm, setLlm] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [d, l, s] = await Promise.all([
        getJson(projectFile('data.json', project) + '?t=' + Date.now()),
        getJson(projectFile('llm_analysis.json', project) + '?t=' + Date.now()),
        api('/api/scrape/status?project=' + encodeURIComponent(project)),
      ]);
      if (!alive) return;
      setPosts(Array.isArray(d) ? d : (Array.isArray(d?.posts) ? d.posts : []));
      setLlm(l?.comments ? l : null);
      setStatus(s.ok ? s.data : { offline: true });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tick, project]);

  const graph = useMemo(() => SNA.build(posts, { types: new Set(['komentar', 'mention']), minDeg: 1 }), [posts]);
  const metrics = useMemo(() => SNA.analyze(graph), [graph]);
  const temporal = useMemo(() => SNA.temporalBuckets(posts, { granularity: 'auto' }), [posts]);
  const cib = useMemo(() => SNA.detectCIB(posts, {}), [posts]);
  const scores = useMemo(() => SNA.buzzerScores(posts, { clusters: cib.clusters }), [posts, cib]);
  const scoreById = useMemo(() => new Map(scores.map((s) => [s.id, s])), [scores]);

  const stats = useMemo(() => {
    const comments = posts.reduce((a, p) => a + (p.replies?.length || 0), 0);
    const threads = posts.reduce((a, p) => a + (p.thread?.length || 0), 0);
    return { posts: posts.length, comments, threads, accounts: graph.nodes.length, links: graph.links.length };
  }, [posts, graph]);

  const volume = useMemo(() => stackedVolume(temporal), [temporal]);
  const recent7 = useMemo(() => {
    if (!temporal.buckets.length) return null;
    const last = temporal.buckets[temporal.buckets.length - 1].t;
    return temporal.buckets.filter((b) => b.t >= last - 7 * DAY).reduce((a, b) => a + b.count, 0);
  }, [temporal]);

  const sentiment = useMemo(() => {
    if (!llm?.comments) return null;
    const c = { positif: 0, netral: 0, negatif: 0 };
    Object.values(llm.comments).forEach((x) => { const k = String(x?.sentiment || '').toLowerCase(); if (c[k] != null) c[k] += 1; });
    const rows = [
      { label: 'positif', value: c.positif, color: SENT_COLORS.positif },
      { label: 'netral', value: c.netral, color: SENT_COLORS.netral },
      { label: 'negatif', value: c.negatif, color: SENT_COLORS.negatif },
    ];
    return { rows, total: rows.reduce((a, r) => a + r.value, 0) };
  }, [llm]);

  const topActors = useMemo(() => graph.nodes
    .map((n) => ({ ...n, degree: metrics.degree.get(n.id) || 0, pr: metrics.pageRank?.get(n.id) || 0, risk: scoreById.get(n.id)?.score ?? 0 }))
    .sort((a, b) => b.pr - a.pr || b.degree - a.degree || a.id.localeCompare(b.id))
    .slice(0, 8), [graph, metrics, scoreById]);

  const topTopics = useMemo(() => {
    const topics = Array.isArray(llm?.topics) ? llm.topics : [];
    return [...topics].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 6)
      .map((t) => ({ label: t.label || `Topik ${t.id}`, value: t.count || 0 }));
  }, [llm]);

  const anomaly = useMemo(() => {
    const high = scores.filter((s) => s.score >= 70);
    const involved = new Set();
    (cib.clusters || []).forEach((c) => (c.items || c.authors || []).forEach((x) => involved.add(x.author || x)));
    const labels = llm?.comments ? Object.values(llm.comments) : [];
    const toxic = labels.filter((x) => Number(x?.toxicity) >= 0.6).length;
    const spam = labels.filter((x) => x?.spam).length;
    return { high, toxic, spam, clusters: (cib.clusters || []).length, bursts: (temporal.bursts || []).length, involved: involved.size };
  }, [scores, cib, temporal, llm]);

  const go = (tabId) => { if (embedded && onTab) onTab(tabId); };

  const aiSummary = useMemo(() => {
    if (!posts.length) return null;
    const sentPart = sentiment ? `Dari ${nf(sentiment.total)} komentar berlabel, ${nf(sentiment.rows.find(r=>r.label==='negatif')?.value||0)} negatif, ${nf(sentiment.rows.find(r=>r.label==='positif')?.value||0)} positif.` : 'Belum ada analisis sentimen LLM.';
    const riskPart = anomaly.high.length ? `${nf(anomaly.high.length)} akun berisiko tinggi terdeteksi oleh heuristik.` : (anomaly.clusters ? `${nf(anomaly.clusters)} klaster komentar identik terdeteksi.` : 'Belum ada sinyal risiko tinggi dari heuristik.');
    const burstPart = anomaly.bursts ? ` ${nf(anomaly.bursts)} lonjakan aktivitas waktu teramati.` : '';
    return `Pantauan proyek memuat ${nf(stats.posts)} postingan, ${nf(stats.comments)} komentar, dan ${nf(stats.accounts)} akun dengan ${nf(stats.links)} relasi. ${sentPart} ${riskPart}${burstPart}`;
  }, [posts, stats, sentiment, anomaly]);

  const hasData = posts.length > 0;

  const content = (
    <>
      {loading && <div className="surface mb-4 p-5 text-sm text-slate-500 dark:text-slate-400">Memuat data proyek {project}…</div>}
      {!loading && !hasData && (
        <div className="surface mb-4">
          <CardBody className="pt-5">
            <EmptyState title="Belum ada data" description="Kumpulkan data dari tab Sumber & Proyek, lalu kembali ke ringkasan ini."
              action={embedded ? <button className="btn-primary" onClick={() => go('sumber')}>Buka Sumber &amp; Proyek</button> : <a className="btn-primary" href={withProject('/scrape.html', project)}>Buka Sumber &amp; Proyek</a>} />
          </CardBody>
        </div>
      )}

      {hasData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Postingan" value={nf(stats.posts)} tone="brand" hint={`${nf(stats.threads)} lanjutan thread`} />
            <KpiCard label="Interaksi Komentar" value={nf(stats.comments)} tone="sky" hint={recent7 != null ? `${nf(recent7)} dalam 7 hari terakhir` : 'tanpa timestamp'} />
            <KpiCard label="Aktor & Relasi" value={`${nf(stats.accounts)} / ${nf(stats.links)}`} tone="slate" hint="akun · relasi terbentuk" />
            <KpiCard label="Sinyal Anomali" value={nf(anomaly.high.length || anomaly.clusters)} tone={anomaly.high.length ? 'amber' : 'green'} hint={anomaly.high.length ? `${nf(anomaly.high.length)} akun berisiko tinggi` : `${nf(anomaly.clusters)} klaster CIB`} />
          </div>

          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-12 xl:col-span-8">
              <CardHeader title="Tren Volume & Sentimen" description={temporal.buckets.length ? `${nf(temporal.total)} komentar · per ${temporal.granularity === 'hour' ? 'jam' : 'hari'}` : 'Grafik waktu komentar'}
                actions={embedded ? <button className="btn-secondary" onClick={() => go('jaringan')}>Buka peta ↗</button> : <a className="btn-secondary" href="/viewer.html">Buka peta ↗</a>} />
              <CardBody>
                <BarChart data={volume} height={200} />
                {temporal.bursts.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {temporal.bursts.slice(0, 4).map((b, i) => (
                      <StatusPill key={i} tone="amber" dot>{formatDate(b.t)} · {nf(b.count)} komentar</StatusPill>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card className="col-span-12 xl:col-span-4">
              <CardHeader title="Proporsi Sentimen" description={llm ? `Model ${llm.model || '-'} · ${nf(llm.counts?.labeled)} berlabel` : 'Butuh analisis AI'} />
              <CardBody>
                {sentiment ? (
                  <div className="flex flex-wrap items-center justify-center gap-5">
                    <Donut segments={sentiment.rows} centerValue={nf(sentiment.total)} centerLabel="berlabel" />
                    <SentimentLegend rows={sentiment.rows} />
                  </div>
                ) : (
                  <EmptyState compact title="Belum ada hasil AI" description="Jalankan Analisis AI untuk mengisi sentimen."
                    action={embedded ? <button className="btn-secondary" onClick={() => go('sentimen')}>Buka sentimen</button> : <a className="btn-secondary" href="/sentimen.html">Buka sentimen</a>} />
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-12 xl:col-span-8">
              <CardHeader title="Aktor Utama" description="Diurutkan berdasarkan PageRank / pengaruh jaringan"
                actions={embedded ? <button className="btn-secondary" onClick={() => go('jaringan')}>Lihat semua ↗</button> : <a className="btn-secondary" href="/viewer.html">Lihat semua ↗</a>} />
              <CardBody className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-2 pr-3 font-semibold">Akun</th>
                      <th className="py-2 pr-3 font-semibold">Peran</th>
                      <th className="py-2 pr-3 text-right font-semibold">PageRank</th>
                      <th className="py-2 pr-3 text-right font-semibold">Derajat</th>
                      <th className="py-2 pr-3 text-right font-semibold">Komentar</th>
                      <th className="py-2 text-right font-semibold">Risiko</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topActors.map((n) => (
                      <tr key={n.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="py-2.5 pr-3">
                          <a className="font-medium text-blue-600 hover:underline dark:text-blue-400" href={`/viewer.html?focus=${encodeURIComponent(n.id)}&project=${encodeURIComponent(project)}`}>@{n.id}</a>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">{roleOf(n)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{(n.pr || 0).toFixed(4)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{nf(n.degree)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{nf(n.replies)}</td>
                        <td className="py-2.5 text-right">{n.risk ? <StatusPill tone={riskTone(n.risk)}>{n.risk}</StatusPill> : <span className="text-slate-400">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!topActors.length && <EmptyState compact title="Belum ada relasi" />}
              </CardBody>
            </Card>

            <div className="col-span-12 space-y-4 xl:col-span-4">
              <Card>
                <CardHeader title="Topik Dominan" description={llm ? `${nf(llm.counts?.topics)} topik dari analisis AI` : 'Butuh analisis AI'} />
                <CardBody>
                  {topTopics.length ? <RankBars rows={topTopics} /> : <EmptyState compact title="Belum ada topik" description="Topik dihasilkan oleh analisis AI." />}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Deteksi CIB" description="Koordinasi / komentar identik (triase)" />
                <CardBody>
                  <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800"><div className="text-base font-semibold tabular-nums text-slate-800 dark:text-white">{nf(anomaly.clusters)}</div><div className="text-[10px] text-slate-500">klaster</div></div>
                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800"><div className="text-base font-semibold tabular-nums text-slate-800 dark:text-white">{nf(anomaly.bursts)}</div><div className="text-[10px] text-slate-500">lonjakan</div></div>
                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800"><div className="text-base font-semibold tabular-nums text-slate-800 dark:text-white">{nf(anomaly.high.length)}</div><div className="text-[10px] text-slate-500">risiko tinggi</div></div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {anomaly.clusters ? `${nf(anomaly.clusters)} klaster komentar identik/mirip, melibatkan ${nf(anomaly.involved)} akun.` : 'Tidak ada klaster CIB menonjol.'} Toksik ≥0,6: {nf(anomaly.toxic)} · Spam: {nf(anomaly.spam)}.
                  </p>
                </CardBody>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader title="Ringkasan AI" description="Narasi ringkas dari statistik proyek — bantu triase, bukan bukti" />
            <CardBody>
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{aiSummary}</p>
              <p className="mt-2 text-[11px] text-slate-400">Gunakan tombol “Analisis AI” di header untuk memperbarui label sentimen/topik per komentar.</p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );

  if (embedded) return content;
  return (
    <Layout page="ringkasan" title="Ringkasan"
      subtitle={`Proyek ${project} · gambaran singkat data Threads`}
      actions={<><button className="btn" onClick={() => setTick(t => t + 1)}>↻ Muat ulang</button></>}>
      {content}
    </Layout>
  );
}
