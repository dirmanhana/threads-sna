import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api, cmp, download, getJson, highlight, num } from '../lib/utils.js';
import { currentProject, projectFile } from '../lib/project.js';
import '../../viewer_core.js';

const SNA = globalThis.SNA;

function StatCard({ label, value, tone = 'slate', hint }) {
  const tones = {
    slate: 'text-slate-800 dark:text-white',
    green: 'text-emerald-600 dark:text-emerald-300',
    red: 'text-red-600 dark:text-red-300',
    amber: 'text-amber-600 dark:text-amber-300',
    sky: 'text-sky-600 dark:text-sky-300',
  };
  return (
    <div className="kpi">
      <div className="text-xs font-medium text-slate-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function Badge({ children, kind }) {
  return <span className={`badge-${kind || 'netral'}`}>{children}</span>;
}

function CommentItem({ e, topicLabel, keywords }) {
  const sent = e.sentiment || 'netral';
  const tox = num(e.toxicity);
  const postUrl = /^https?:\/\//i.test(e.postUrl || '')
    ? e.postUrl
    : `https://www.threads.com/@${encodeURIComponent(e.postAuthor || e.author || '')}/post/${encodeURIComponent(e.postCode || '')}`;
  const authorUrl = `https://www.threads.com/@${encodeURIComponent(e.author || '')}`;
  const border = sent === 'positif' ? 'border-l-emerald-500'
    : sent === 'negatif' ? 'border-l-red-500' : 'border-l-slate-300 dark:border-l-slate-500';
  return (
    <article className={`rounded-r-xl border border-slate-200 border-l-4 bg-white p-4 shadow-card dark:border-gray-700/60 dark:bg-gray-800 ${border}`}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <a href={authorUrl} target="_blank" rel="noreferrer" className="font-semibold text-slate-800 hover:text-brand-600 dark:text-white">
          @{e.author || '-'}
        </a>
        <span className="text-slate-400">komentar di</span>
        <a href={postUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
          @{e.postAuthor || '-'}
        </a>
        <span className="text-slate-400">· {e.timestamp || 'tanpa waktu'} · {e.postCode}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Badge kind={sent}>{sent === 'positif' ? '＋ Positif' : sent === 'negatif' ? '－ Negatif' : '＝ Netral'}</Badge>
        {e.emotion && <Badge kind="emosi">{e.emotion}</Badge>}
        <Badge kind="topik">{topicLabel(e.topic)}</Badge>
        {tox >= 0.6 && <Badge kind="tox">toksisitas {tox.toFixed(2)}</Badge>}
        {e.spam && <Badge kind="spam">spam</Badge>}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-gray-200"
        dangerouslySetInnerHTML={{ __html: highlight(e.text, keywords) }} />
      {e.alasan && <p className="mt-2 text-[11px] italic text-slate-400">Alasan model: {e.alasan}</p>}
    </article>
  );
}

export default function SentimentPage() {
  const project = currentProject();
  const [posts, setPosts] = useState([]);
  const [raw, setRaw] = useState(null);
  const [entries, setEntries] = useState([]);
  const [topics, setTopics] = useState([]);
  const [meta, setMeta] = useState({ model: '-', generated_at: '-', counts: {} });
  const [q, setQ] = useState('');
  const [sent, setSent] = useState('');
  const [emo, setEmo] = useState('');
  const [topic, setTopic] = useState('');
  const [flag, setFlag] = useState('');
  const [sort, setSort] = useState('baru');
  const [shown, setShown] = useState(80);
  const [warn, setWarn] = useState('');
  const [status, setStatus] = useState(null);
  const [limit, setLimit] = useState(0);
  const dataInput = useRef(null);
  const llmInput = useRef(null);

  const buildEntries = useCallback((data, llm) => {
    if (!llm?.comments) return [];
    const seen = new Set();
    const out = [];
    (data || []).forEach((p) => {
      const code = p.code || '';
      (p.replies || []).forEach((r) => {
        const key = SNA.contentKey(r.author, code, r.text);
        const a = llm.comments[key];
        if (!a || seen.has(key)) return;
        seen.add(key);
        out.push({ ...a, key, author: r.author || '', text: r.text || '', timestamp: r.timestamp || '',
          postCode: code, postAuthor: p.author || '', postUrl: p.url || '' });
      });
    });
    return out;
  }, []);

  const applyLlm = useCallback((llm, data) => {
    setRaw(llm);
    setTopics(Array.isArray(llm?.topics) ? llm.topics : []);
    setMeta({ model: llm?.model || '-', generated_at: llm?.generated_at || '-', counts: llm?.counts || {} });
    setEntries(buildEntries(data, llm));
    setWarn('');
  }, [buildEntries]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, l] = await Promise.all([
        getJson(projectFile('data.json', project)),
        getJson(projectFile('llm_analysis.json', project)),
      ]);
      if (!alive) return;
      if (Array.isArray(d)) setPosts(d);
      else if (Array.isArray(d?.posts)) setPosts(d.posts);
      if (l?.comments) applyLlm(l, Array.isArray(d) ? d : d?.posts || []);
      else setWarn(`Hasil analisis LLM untuk proyek ${project} belum tersedia. Klik ▶ Jalankan analisis atau muat llm_analysis.json manual.`);
      const s = await api('/api/status?project=' + encodeURIComponent(project));
      if (alive && s.ok && s.data?.running) setStatus(s.data);
    })();
    return () => { alive = false; };
  }, [applyLlm, project]);

  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(async () => {
      const s = await api('/api/status?project=' + encodeURIComponent(project));
      if (!s.ok) { setStatus(null); setWarn('Server analisis tidak merespons.'); return; }
      if (s.data?.running) { setStatus(s.data); return; }
      clearInterval(id);
      setStatus(null);
      const fresh = await getJson(projectFile('llm_analysis.json', project) + '?t=' + Date.now());
      if (fresh?.comments) applyLlm(fresh, posts);
      else if (s.data?.error) setWarn('Analisis gagal: ' + s.data.error);
      else setWarn('Analisis selesai, tetapi hasil tidak bisa dibaca.');
    }, 2000);
    return () => clearInterval(id);
  }, [status?.running, applyLlm, posts, project]);

  const topicLabel = useCallback((id) => {
    const t = topics.find((x) => x.id === Number(id));
    return t ? (t.label || `Topik ${t.id}`) : `Topik ${id ?? '-'}`;
  }, [topics]);

  const keywords = useMemo(() => {
    const w = new Map();
    entries.forEach((e) => {
      const t = topics.find((x) => x.id === e.topic);
      (t?.keywords || []).forEach((k) => {
        const s = String(k).trim().toLowerCase();
        if (s) w.set(s, (w.get(s) || 0) + 1);
      });
    });
    return [...w.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 26);
  }, [entries, topics]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let es = entries.filter((e) => {
      if (sent && e.sentiment !== sent) return false;
      if (emo && e.emotion !== emo) return false;
      if (topic !== '' && Number(e.topic) !== Number(topic)) return false;
      const tox = num(e.toxicity);
      if (flag === 'tox' && tox < 0.6) return false;
      if (flag === 'spam' && !e.spam) return false;
      if (flag === 'review' && tox < 0.6 && !e.spam) return false;
      if (needle && !SNA.normText(e.text).includes(needle) && !String(e.author || '').toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === 'tox') es = [...es].sort((a, b) => num(b.toxicity) - num(a.toxicity));
    else if (sort === 'lama') es = [...es].sort((a, b) => cmp(String(a.timestamp), String(b.timestamp)));
    else if (sort === 'akun') es = [...es].sort((a, b) => cmp(String(a.author), String(b.author)));
    else es = [...es].sort((a, b) => cmp(String(b.timestamp), String(a.timestamp)));
    return es;
  }, [entries, q, sent, emo, topic, flag, sort]);

  const stats = useMemo(() => {
    const t = { positif: 0, negatif: 0, netral: 0, toxic: 0, spam: 0 };
    filtered.forEach((e) => {
      t[e.sentiment] = (t[e.sentiment] || 0) + 1;
      if (num(e.toxicity) >= 0.6) t.toxic++;
      if (e.spam) t.spam++;
    });
    return t;
  }, [filtered]);

  const topicCounts = useMemo(() => {
    const m = new Map();
    filtered.forEach((e) => m.set(e.topic, (m.get(e.topic) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const emotions = useMemo(() => [...new Set(entries.map((e) => e.emotion).filter(Boolean))].sort(cmp), [entries]);
  const resetFilters = () => { setQ(''); setSent(''); setEmo(''); setTopic(''); setFlag(''); setSort('baru'); setShown(80); };

  const runAnalysis = async () => {
    const r = await api('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, limit: Math.max(0, Number(limit) || 0) }),
    });
    if (!r.ok) {
      if (r.status === 404 || r.status === 501) setWarn('Server analisis tidak tersedia. Jalankan ./run.sh serve lalu buka halaman ini di http://localhost:8000/sentimen.html.');
      else setWarn(r.data?.message || 'Gagal memulai analisis.');
      return;
    }
    setWarn('');
    const s = await api('/api/status?project=' + encodeURIComponent(project));
    if (s.ok) setStatus(s.data);
  };

  const exportCsv = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['sentimen', 'emosi', 'toksisitas', 'spam', 'topik', 'alasan', 'akun', 'kode_postingan', 'postingan', 'waktu', 'teks'];
    const rows = filtered.map((e) => [e.sentiment, e.emotion, e.toxicity, e.spam ? 'ya' : '', topicLabel(e.topic),
      e.alasan, e.author, e.postCode, e.postAuthor, e.timestamp, e.text].map(cell).join(','));
    download('sentimen.csv', [head.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
  };

  const readFile = (input, cb) => {
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { cb(JSON.parse(String(reader.result).replace(/^\uFEFF/, ''))); }
      catch (err) { setWarn('File bukan JSON valid: ' + (err?.message || err)); }
    };
    reader.readAsText(f);
    input.value = '';
  };

  const actions = (
    <>
      {status?.running && (
        <span className="hidden max-w-[280px] truncate text-xs text-brand-600 sm:block">
          {status.message || 'Menganalisis'} {status.total ? `· ${status.done}/${status.total}` : ''}
        </span>
      )}
      <label className="hidden items-center gap-1 text-xs text-slate-500 sm:flex" title="0 = semua komentar">
        maks <input className="field w-16" type="number" min="0" step="20" value={limit}
          onChange={(e) => setLimit(e.target.value)} disabled={!!status?.running} />
      </label>
      <button className="btn btn-primary" onClick={runAnalysis} disabled={!!status?.running} title="Jalankan analisis via server lokal">
        ▶ Jalankan analisis
      </button>
      <button className="btn" onClick={exportCsv}>Ekspor CSV</button>
      <button className="btn" onClick={() => dataInput.current?.click()}>data.json</button>
      <button className="btn" onClick={() => llmInput.current?.click()}>llm JSON</button>
      <input ref={dataInput} type="file" accept=".json" hidden onChange={(e) => readFile(e.target, (d) => {
        const ps = Array.isArray(d) ? d : d?.posts || [];
        setPosts(ps);
        if (raw) applyLlm(raw, ps);
      })} />
      <input ref={llmInput} type="file" accept=".json" hidden onChange={(e) => readFile(e.target, (d) => {
        if (!d?.comments) { setWarn('File itu bukan hasil analisis LLM.'); return; }
        applyLlm(d, posts);
      })} />
    </>
  );

  const maxCloud = keywords[0]?.[1] || 1;

  return (
    <Layout page="sentimen" title="Analisis Sentimen"
      subtitle={`Proyek ${project} · label sentimen, emosi, topik, dan toksisitas per komentar`}
      actions={actions}>
      {status?.running && (
        <div className="card mb-4 p-3">
          <div className="mb-2 text-xs text-slate-600 dark:text-gray-300">
            {status.message || 'Menganalisis'} {status.total ? `· batch ${status.done}/${status.total}` : ''}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-gray-700">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${status.total ? Math.round(status.done / status.total * 100) : 0}%` }} />
          </div>
        </div>
      )}
      {warn && <div className="mb-4 rounded-xl bg-red-700 px-4 py-3 text-sm text-white">{warn}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Komentar berlabel" value={filtered.length} hint={`dari ${entries.length} total`} />
        <StatCard label="Positif" value={stats.positif} tone="green" />
        <StatCard label="Netral" value={stats.netral} />
        <StatCard label="Negatif" value={stats.negatif} tone="red" />
        <StatCard label="Toksik ≥ 0,6" value={stats.toxic} tone="amber" />
        <StatCard label="Spam" value={stats.spam} tone="amber" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
            <input className="field min-w-[180px] flex-1" type="search" placeholder="Cari teks / akun…" value={q}
              onChange={(e) => { setQ(e.target.value); setShown(80); }} />
            <select className="field" value={sent} onChange={(e) => { setSent(e.target.value); setShown(80); }}>
              <option value="">Semua sentimen</option><option value="positif">Positif</option>
              <option value="negatif">Negatif</option><option value="netral">Netral</option>
            </select>
            <select className="field" value={emo} onChange={(e) => { setEmo(e.target.value); setShown(80); }}>
              <option value="">Semua emosi</option>
              {emotions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select className="field" value={topic} onChange={(e) => { setTopic(e.target.value); setShown(80); }}>
              <option value="">Semua topik</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.label || `Topik ${t.id}`}</option>)}
            </select>
            <select className="field" value={flag} onChange={(e) => { setFlag(e.target.value); setShown(80); }}>
              <option value="">Semua komentar</option><option value="tox">Toksisitas ≥ 0,6</option>
              <option value="spam">Spam saja</option><option value="review">Perlu ditinjau</option>
            </select>
            <select className="field" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="baru">Terbaru dulu</option><option value="lama">Terlama dulu</option>
              <option value="tox">Toksisitas tertinggi</option><option value="akun">Akun (A–Z)</option>
            </select>
            <button className="btn" onClick={resetFilters}>Reset</button>
          </div>

          <div className="mb-3 text-xs text-slate-500">
            Menampilkan {Math.min(shown, filtered.length)} dari {filtered.length} komentar · model {meta.model} · {meta.generated_at}
          </div>
          <div className="space-y-3">
            {filtered.slice(0, shown).map((e) => (
              <CommentItem key={e.key} e={e} topicLabel={topicLabel} keywords={keywords.map(([k]) => k)} />
            ))}
            {!filtered.length && <div className="card p-8 text-center text-sm text-slate-500">Tidak ada komentar yang cocok.</div>}
          </div>
          {filtered.length > shown && <button className="btn mt-4 w-full" onClick={() => setShown(shown + 80)}>Tampilkan lebih banyak</button>}
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-white">Ringkasan</h3>
            <div className="space-y-2 text-xs text-slate-500">
              <div>Model: <b className="text-slate-700 dark:text-gray-200">{meta.model}</b></div>
              <div>Dibuat: {meta.generated_at}</div>
              <div>Postingan: {posts.length} · komentar: {meta.counts.comments || entries.length}</div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-gray-700">
              <div className="h-full bg-emerald-500" style={{ width: `${filtered.length ? stats.positif / filtered.length * 100 : 0}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Positif {filtered.length ? Math.round(stats.positif / filtered.length * 100) : 0}% ·
              Netral {filtered.length ? Math.round(stats.netral / filtered.length * 100) : 0}% ·
              Negatif {filtered.length ? Math.round(stats.negatif / filtered.length * 100) : 0}%
            </p>
          </div>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-white">Topik dari LLM</h3>
            <div className="space-y-2">
              {topicCounts.map(([id, n]) => {
                const t = topics.find((x) => x.id === Number(id));
                return (
                  <div key={id}>
                    <div className="flex justify-between text-xs">
                      <b className="font-medium text-slate-700 dark:text-gray-200">{topicLabel(id)}</b><span>{n}</span>
                    </div>
                    {!!t?.keywords?.length && <div className="text-[11px] text-slate-400">{t.keywords.slice(0, 7).join(' · ')}</div>}
                  </div>
                );
              })}
              {!topicCounts.length && <p className="text-xs text-slate-400">Belum ada data.</p>}
            </div>
          </div>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-white">Kata kunci</h3>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {keywords.map(([k, n]) => (
                <span key={k} title={`${k} · ${n} komentar`} style={{ fontSize: 11 + Math.round(13 * n / maxCloud) }}
                  className="text-brand-700 dark:text-brand-300">{k}</span>
              ))}
              {!keywords.length && <span className="text-xs text-slate-400">Belum ada data.</span>}
            </div>
          </div>
        </aside>
      </div>
    </Layout>
  );
}
