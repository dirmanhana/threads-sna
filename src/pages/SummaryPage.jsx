import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Card, { CardBody, CardHeader } from '../components/Card.jsx';
import KpiCard from '../components/KpiCard.jsx';
import StatusPill from '../components/StatusPill.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { BarChart, Donut, RankBars } from '../components/MiniCharts.jsx';
import { api, formatDate, getJson } from '../lib/utils.js';
import '../../viewer_core.js';

const SNA = globalThis.SNA;
const DAY = 86400000;
const SENT_COLORS = { positif: '#3ec972', netral: '#9ca3af', negatif: '#fa4949' };

const nf = (v) => Number(v || 0).toLocaleString('id-ID');

function shortDate(t, granularity) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  if (granularity === 'hour') {
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function roleOf(n) {
  if (n.posts && n.replies) return 'penulis & komentator';
  if (n.posts) return 'penulis';
  return 'komentator';
}

function riskTone(score) {
  if (score >= 70) return 'red';
  if (score >= 40) return 'amber';
  return 'slate';
}

function SentimentLegend({ rows }) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <ul className="w-full space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="flex-1 capitalize text-slate-600 dark:text-gray-300">{r.label}</span>
          <span className="tabular-nums font-medium text-slate-800 dark:text-white">{nf(r.value)}</span>
          <span className="w-10 text-right tabular-nums text-slate-500 dark:text-gray-400">
            {Math.round((r.value / total) * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SummaryPage() {
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
        getJson('data.json?t=' + Date.now()),
        getJson('llm_analysis.json?t=' + Date.now()),
        api('/api/scrape/status'),
      ]);
      if (!alive) return;
      setPosts(Array.isArray(d) ? d : (Array.isArray(d?.posts) ? d.posts : []));
      setLlm(l?.comments ? l : null);
      setStatus(s.ok ? s.data : { offline: true });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tick]);

  const graph = useMemo(
    () => SNA.build(posts, { types: new Set(['komentar', 'mention']), minDeg: 1 }),
    [posts],
  );
  const metrics = useMemo(() => SNA.analyze(graph), [graph]);
  const temporal = useMemo(() => SNA.temporalBuckets(posts, { granularity: 'auto' }), [posts]);
  const cib = useMemo(() => SNA.detectCIB(posts, {}), [posts]);
  const scores = useMemo(() => SNA.buzzerScores(posts, { clusters: cib.clusters }), [posts, cib]);
  const scoreById = useMemo(() => new Map(scores.map((s) => [s.id, s])), [scores]);

  const stats = useMemo(() => {
    const comments = posts.reduce((a, p) => a + (p.replies?.length || 0), 0);
    const threads = posts.reduce((a, p) => a + (p.thread?.length || 0), 0);
    return {
      posts: posts.length,
      comments,
      threads,
      accounts: graph.nodes.length,
      links: graph.links.length,
    };
  }, [posts, graph]);

  const volume = useMemo(() => {
    const buckets = temporal.buckets.slice(-30);
    return buckets.map((b) => ({
      label: shortDate(b.t, temporal.granularity),
      value: b.count,
      title: `${new Date(b.t).toLocaleString('id-ID')}: ${b.count} komentar`,
    }));
  }, [temporal]);

  const recent7 = useMemo(() => {
    if (!temporal.buckets.length) return null;
    const last = temporal.buckets[temporal.buckets.length - 1].t;
    return temporal.buckets
      .filter((b) => b.t >= last - 7 * DAY)
      .reduce((a, b) => a + b.count, 0);
  }, [temporal]);

  const sentiment = useMemo(() => {
    if (!llm?.comments) return null;
    const c = { positif: 0, netral: 0, negatif: 0 };
    Object.values(llm.comments).forEach((x) => {
      const k = String(x?.sentiment || '').toLowerCase();
      if (c[k] != null) c[k] += 1;
    });
    const rows = [
      { label: 'positif', value: c.positif, color: SENT_COLORS.positif },
      { label: 'netral', value: c.netral, color: SENT_COLORS.netral },
      { label: 'negatif', value: c.negatif, color: SENT_COLORS.negatif },
    ];
    return { rows, total: rows.reduce((a, r) => a + r.value, 0) };
  }, [llm]);

  const topActors = useMemo(() => {
    return graph.nodes
      .map((n) => ({
        ...n,
        degree: metrics.degree.get(n.id) || 0,
        risk: scoreById.get(n.id)?.score ?? 0,
      }))
      .sort((a, b) => b.degree - a.degree || b.replies - a.replies || a.id.localeCompare(b.id))
      .slice(0, 8);
  }, [graph, metrics, scoreById]);

  const topTopics = useMemo(() => {
    const topics = Array.isArray(llm?.topics) ? llm.topics : [];
    return [...topics].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 6)
      .map((t) => ({ label: t.label || `Topik ${t.id}`, value: t.count || 0 }));
  }, [llm]);

  const anomaly = useMemo(() => {
    const high = scores.filter((s) => s.score >= 70);
    const medium = scores.filter((s) => s.score >= 40 && s.score < 70);
    const involved = new Set();
    (cib.clusters || []).forEach((c) => (c.items || c.authors || []).forEach((x) => involved.add(x.author || x)));
    const labels = llm?.comments ? Object.values(llm.comments) : [];
    const toxic = labels.filter((x) => Number(x?.toxicity) >= 0.6).length;
    const spam = labels.filter((x) => x?.spam).length;
    const byAuthor = new Map();
    if (llm?.comments) {
      posts.forEach((p) => (p.replies || []).forEach((r) => {
        const a = llm.comments[SNA.contentKey(r.author, p.code || '', r.text || '')];
        if (!a) return;
        const cur = byAuthor.get(r.author) || { id: r.author, toxic: 0, spam: 0, max: 0 };
        if (Number(a.toxicity) >= 0.6) { cur.toxic += 1; cur.max = Math.max(cur.max, Number(a.toxicity)); }
        if (a.spam) cur.spam += 1;
        if (cur.toxic || cur.spam) byAuthor.set(r.author, cur);
      }));
    }
    const flagged = [...byAuthor.values()]
      .sort((a, b) => b.toxic - a.toxic || b.spam - a.spam || a.id.localeCompare(b.id))
      .slice(0, 4);
    return {
      high, medium, flagged, toxic, spam,
      clusters: (cib.clusters || []).length,
      bursts: (temporal.bursts || []).length,
      involved: involved.size,
    };
  }, [scores, cib, temporal, llm, posts]);

  const activity = useMemo(() => {
    const rows = [];
    if (status?.data?.mtime) {
      rows.push({
        label: 'Data dikumpulkan',
        detail: `${nf(status.data.posts)} post · ${status.data.size ? `${Math.round(status.data.size / 1024)} KB` : 'data.json'}`,
        when: formatDate(status.data.mtime * 1000),
        tone: 'brand',
      });
    } else if (posts.length) {
      const newest = posts.reduce((a, p) => {
        const t = SNA.parseDate(p.scraped_at);
        return t != null && (a == null || t > a) ? t : a;
      }, null);
      rows.push({
        label: 'Data tersedia',
        detail: `${nf(posts.length)} post`,
        when: newest ? formatDate(newest) : 'tanpa waktu',
        tone: 'brand',
      });
    }
    if (llm?.generated_at) {
      rows.push({
        label: 'Analisis LLM',
        detail: `${nf(llm.counts?.labeled)} komentar berlabel · model ${llm.model || '-'}`,
        when: formatDate(llm.generated_at),
        tone: 'green',
      });
    }
    if (status?.login) {
      rows.push({
        label: 'Sesi Threads',
        detail: status.login.active ? 'Aktif — siap scraping' : 'Belum ada sesi login',
        when: status.login.active ? 'cookie tersimpan lokal' : 'buka halaman pengumpulan data',
        tone: status.login.active ? 'green' : 'amber',
      });
    }
    if (temporal.last) {
      rows.push({
        label: 'Komentar terbaru',
        detail: `${nf(temporal.total)} komentar bertimestamp`,
        when: formatDate(temporal.last),
        tone: 'slate',
      });
    }
    return rows;
  }, [status, posts, llm, temporal]);

  const actions = (
    <>
      <button className="btn" onClick={() => setTick((t) => t + 1)}>↻ Muat ulang</button>
      <a className="btn" href="/scrape.html">Mulai scraping</a>
      <a className="btn btn-primary" href="/sentimen.html">Jalankan analisis</a>
    </>
  );

  const hasData = posts.length > 0;
  const dotTone = {
    brand: 'bg-brand-500', green: 'bg-emerald-500', amber: 'bg-amber-500', slate: 'bg-slate-400',
  };

  return (
    <Layout page="ringkasan" title="Ringkasan"
      subtitle="Gambaran singkat data Threads: volume, aktor, sentimen, dan sinyal anomali"
      actions={actions}>
      {loading && (
        <Card className="mb-6 p-5 text-sm text-slate-500 dark:text-gray-400">Memuat data.json…</Card>
      )}

      {!loading && !hasData && (
        <Card className="mb-6">
          <CardBody className="pt-5">
            <EmptyState
              title="Belum ada data"
              description="Jalankan pengumpulan data dari halaman Pengumpulan Data, lalu kembali ke ringkasan ini."
              action={<a className="btn btn-primary" href="/scrape.html">Buka Pengumpulan Data</a>}
            />
          </CardBody>
        </Card>
      )}

      {hasData && (
        <div className="grid grid-cols-12 gap-4 lg:gap-6">
          {/* KPI */}
          <div className="col-span-12 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-6">
            <KpiCard label="Postingan" value={nf(stats.posts)} tone="brand"
              hint={`${nf(stats.threads)} lanjutan thread`} />
            <KpiCard label="Komentar" value={nf(stats.comments)} tone="sky"
              hint={recent7 != null ? `${nf(recent7)} dalam 7 hari terakhir` : 'tanpa timestamp'} />
            <KpiCard label="Akun" value={nf(stats.accounts)} tone="slate"
              hint={`${nf(stats.links)} relasi terbentuk`} />
            <KpiCard label="Relasi" value={nf(stats.links)} tone={anomaly.high.length ? 'amber' : 'green'}
              hint={anomaly.high.length
                ? `${nf(anomaly.high.length)} akun berisiko tinggi`
                : 'tidak ada sinyal risiko tinggi'} />
          </div>

          {/* Volume komentar */}
          <Card className="col-span-12 xl:col-span-8">
            <CardHeader title="Volume komentar"
              description={temporal.buckets.length
                ? `${nf(temporal.total)} komentar · per ${temporal.granularity === 'hour' ? 'jam' : 'hari'}${temporal.bursts.length ? ` · ${temporal.bursts.length} lonjakan terdeteksi` : ''}`
                : 'Grafik waktu komentar'}
              actions={<a className="btn" href="/viewer.html">Buka peta ↗</a>} />
            <CardBody>
              <BarChart data={volume} height={190} />
              {temporal.bursts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {temporal.bursts.slice(0, 4).map((b, i) => (
                    <StatusPill key={i} tone="amber" dot>
                      {formatDate(b.t)} · {nf(b.count)} komentar
                    </StatusPill>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Sentimen */}
          <Card className="col-span-12 xl:col-span-4">
            <CardHeader title="Sentimen komentar"
              description={llm ? `Model ${llm.model || '-'} · ${nf(llm.counts?.labeled)} berlabel` : 'Butuh analisis LLM'} />
            <CardBody>
              {sentiment ? (
                <div className="flex flex-wrap items-center justify-center gap-5">
                  <Donut segments={sentiment.rows} centerValue={nf(sentiment.total)} centerLabel="berlabel" />
                  <SentimentLegend rows={sentiment.rows} />
                </div>
              ) : (
                <EmptyState compact title="Belum ada hasil LLM"
                  description="Jalankan analisis di halaman sentimen agar donut dan topik terisi."
                  action={<a className="btn" href="/sentimen.html">Buka sentimen</a>} />
              )}
            </CardBody>
          </Card>

          {/* Aktor teratas */}
          <Card className="col-span-12 xl:col-span-8">
            <CardHeader title="Aktor teratas"
              description="Diurutkan berdasarkan derajat (jumlah relasi komentar/mention)"
              actions={<a className="btn" href="/viewer.html">Lihat semua ↗</a>} />
            <CardBody className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500 dark:border-gray-700 dark:text-gray-400">
                    <th className="py-2 pr-3 font-semibold">Akun</th>
                    <th className="py-2 pr-3 font-semibold">Peran</th>
                    <th className="py-2 pr-3 text-right font-semibold">Derajat</th>
                    <th className="py-2 pr-3 text-right font-semibold">Komentar</th>
                    <th className="py-2 text-right font-semibold">Risiko</th>
                  </tr>
                </thead>
                <tbody>
                  {topActors.map((n) => (
                    <tr key={n.id} className="border-b border-slate-100 last:border-0 dark:border-gray-700/50">
                      <td className="py-2 pr-3">
                        <a className="font-medium text-brand-600 hover:underline dark:text-brand-300"
                          href={`/viewer.html?focus=${encodeURIComponent(n.id)}`}>@{n.id}</a>
                      </td>
                      <td className="py-2 pr-3 text-slate-500 dark:text-gray-400">{roleOf(n)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-700 dark:text-gray-200">{nf(n.degree)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-700 dark:text-gray-200">{nf(n.replies)}</td>
                      <td className="py-2 text-right">
                        {n.risk ? <StatusPill tone={riskTone(n.risk)}>{n.risk}</StatusPill>
                          : <span className="text-slate-500 dark:text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!topActors.length && <EmptyState compact title="Belum ada relasi" />}
            </CardBody>
          </Card>

          {/* Aktivitas */}
          <Card className="col-span-12 xl:col-span-4">
            <CardHeader title="Aktivitas terakhir" description="Status data dan proses" />
            <CardBody>
              <ol className="space-y-4">
                {activity.map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotTone[a.tone] || dotTone.slate}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-700 dark:text-gray-200">{a.label}</p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-gray-400">{a.detail}</p>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400">{a.when}</p>
                    </div>
                  </li>
                ))}
                {!activity.length && <EmptyState compact title="Belum ada aktivitas" />}
              </ol>
            </CardBody>
          </Card>

          {/* Anomali */}
          <Card className="col-span-12 xl:col-span-6">
            <CardHeader title="Sinyal risiko"
              description="Gabungan label LLM dan heuristik — triase, bukan bukti."
              actions={<a className="btn" href="/viewer.html">Periksa ↗</a>} />
            <CardBody>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-gray-700/40">
                  <div className="text-lg font-semibold tabular-nums text-red-700 dark:text-red-300">{nf(anomaly.toxic)}</div>
                  <div className="text-[11px] text-slate-600 dark:text-gray-300">toksik ≥ 0,6</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-gray-700/40">
                  <div className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300">{nf(anomaly.spam)}</div>
                  <div className="text-[11px] text-slate-600 dark:text-gray-300">ditandai spam</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-gray-700/40">
                  <div className="text-lg font-semibold tabular-nums text-sky-700 dark:text-sky-300">{nf(anomaly.bursts)}</div>
                  <div className="text-[11px] text-slate-600 dark:text-gray-300">lonjakan waktu</div>
                </div>
              </div>
              {anomaly.high.length > 0 ? (
                <ul className="space-y-2">
                  {anomaly.high.slice(0, 4).map((s) => (
                    <li key={s.id} className="flex items-start gap-2">
                      <StatusPill tone="red">{s.score}</StatusPill>
                      <div className="min-w-0">
                        <a className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                          href={`/viewer.html?focus=${encodeURIComponent(s.id)}`}>@{s.id}</a>
                        <p className="truncate text-[11px] text-slate-500 dark:text-gray-400">
                          {s.reasons.slice(0, 2).join(' · ') || 'perilaku menonjol'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : anomaly.flagged.length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px] text-slate-500 dark:text-gray-400">
                    Tidak ada akun berisiko tinggi dari heuristik. Akun dengan komentar paling sering ditandai:
                  </p>
                  <ul className="space-y-2">
                    {anomaly.flagged.map((f) => (
                      <li key={f.id} className="flex items-center gap-2">
                        <a className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                          href={`/viewer.html?focus=${encodeURIComponent(f.id)}`}>@{f.id}</a>
                        {f.toxic > 0 && <StatusPill tone="red">{f.toxic} toksik</StatusPill>}
                        {f.spam > 0 && <StatusPill tone="amber">{f.spam} spam</StatusPill>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-gray-400">
                  Tidak ada sinyal menonjol pada data ini
                  {anomaly.clusters ? ` · ${nf(anomaly.clusters)} klaster komentar identik` : ''}.
                </p>
              )}
            </CardBody>
          </Card>

          {/* Topik LLM */}
          <Card className="col-span-12 xl:col-span-6">
            <CardHeader title="Topik dominan"
              description={llm ? `${nf(llm.counts?.topics)} topik dari analisis LLM` : 'Butuh analisis LLM'}
              actions={llm ? <a className="btn" href="/sentimen.html">Detail ↗</a> : null} />
            <CardBody>
              {topTopics.length ? (
                <RankBars rows={topTopics} />
              ) : (
                <EmptyState compact title="Belum ada topik"
                  description="Topik dihasilkan oleh analisis LLM di halaman sentimen." />
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </Layout>
  );
}
