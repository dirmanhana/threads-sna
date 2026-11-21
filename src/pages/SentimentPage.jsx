import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Download } from 'lucide-react';
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

function highlightKeywords(text, terms) {
  const cleanTerms = (terms || []).filter((t) => t && t.length >= 3).slice(0, 12);
  if (cleanTerms.length === 0) return text;
  const escaped = cleanTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = String(text || '').split(re);
  return parts.map((part, idx) =>
    idx % 2 === 1 ? <mark key={idx}>{part}</mark> : <React.Fragment key={idx}>{part}</React.Fragment>,
  );
}

function downloadText(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SentimentPage({ embedded = false, project: projectProp, onTab }) {
  const project = projectProp || getProject();
  const [posts, setPosts] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [q, setQ] = useState('');
  const [sentFilter, setSentFilter] = useState('');
  const [emoFilter, setEmoFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [flagFilter, setFlagFilter] = useState('');
  const [sortBy, setSortBy] = useState('baru');
  const [shown, setShown] = useState(60);

  const [sandboxText, setSandboxText] = useState('');
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxError, setSandboxError] = useState('');
  const [sandboxResult, setSandboxResult] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, a] = await Promise.all([
        getJson(projectFile('data.json', project)),
        getJson(projectFile('llm_analysis.json', project)),
      ]);
      if (!alive) return;
      const list = Array.isArray(d) ? d : (Array.isArray(d?.posts) ? d.posts : []);
      setPosts(list);
      setAnalysis(a && typeof a === 'object' && !Array.isArray(a) ? a : null);
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

  const runBatchAnalyze = async () => {
    if (analyzing) return;
    const r = await api('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project || 'default' }),
    });
    if (r.ok || r.status === 409) setAnalyzing(true);
  };

  const entries = useMemo(() => {
    const out = [];
    const seen = new Set();
    const map = analysis?.comments || {};
    for (const p of posts) {
      for (const r of (p.replies || [])) {
        const key = contentKey(r.author, p.code, r.text);
        if (seen.has(key)) continue;
        seen.add(key);
        const label = map[key];
        out.push({
          key,
          author: r.author || '',
          postAuthor: p.author || '',
          postCode: p.code || '',
          postUrl: p.url || '',
          timestamp: r.timestamp || '',
          platform: r.platform || p.platform || 'Threads',
          text: r.text || '',
          ...(label || {}),
        });
      }
    }
    return out;
  }, [posts, analysis]);

  const topics = useMemo(() => Array.isArray(analysis?.topics) ? analysis.topics : [], [analysis]);
  const topicLabel = (id) => {
    if (id == null || id === '') return 'Belum dikelompokkan';
    const hit = topics.find((t) => String(t.id) === String(id));
    return hit ? hit.label : `Topik #${id}`;
  };

  const emotions = useMemo(
    () => [...new Set(entries.map((e) => e.emotion).filter(Boolean))].sort(),
    [entries],
  );

  const keywords = useMemo(() => {
    const freq = new Map();
    for (const t of topics) {
      for (const kw of (t.keywords || [])) {
        const clean = String(kw).trim().toLowerCase();
        if (clean) freq.set(clean, (freq.get(clean) || 0) + (t.count || 1));
      }
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [topics]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (sentFilter === 'unlabeled' && e.sentiment) return false;
      if (sentFilter && sentFilter !== 'unlabeled' && e.sentiment !== sentFilter) return false;
      if (emoFilter && e.emotion !== emoFilter) return false;
      if (topicFilter !== '' && String(e.topic) !== String(topicFilter)) return false;
      if (flagFilter === 'tox' && Number(e.toxicity || 0) < 0.6) return false;
      if (flagFilter === 'spam' && !e.spam) return false;
      if (term) {
        const hay = `${e.author} ${e.text} ${e.postAuthor}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    if (sortBy === 'tox') return [...list].sort((a, b) => Number(b.toxicity || 0) - Number(a.toxicity || 0));
    if (sortBy === 'akun') return [...list].sort((a, b) => String(a.author).localeCompare(String(b.author)));
    if (sortBy === 'lama') return [...list].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return [...list].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }, [entries, sentFilter, emoFilter, topicFilter, flagFilter, q, sortBy]);

  const stats = useMemo(() => {
    const t = { positif: 0, netral: 0, negatif: 0, toxic: 0, spam: 0, unlabeled: 0 };
    for (const e of filtered) {
      if (!e.sentiment) { t.unlabeled += 1; continue; }
      if (t[e.sentiment] != null) t[e.sentiment] += 1;
      else t.netral += 1;
      if (Number(e.toxicity || 0) >= 0.6) t.toxic += 1;
      if (e.spam) t.spam += 1;
    }
    return t;
  }, [filtered]);

  const labeledCount = stats.positif + stats.netral + stats.negatif;

  const runSandbox = async (e) => {
    e.preventDefault();
    if (!sandboxText.trim()) return;
    setSandboxBusy(true);
    setSandboxError('');
    setSandboxResult(null);
    // Coba endpoint server jika tersedia; fallback: info tidak tersedia.
    try {
      const resp = await fetch('/api/analyze-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sandboxText.trim(), project: project || 'default' }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setSandboxResult(data);
      } else {
        setSandboxError('Fitur uji klasifikasi instan tidak tersedia di server ini. Gunakan Analisis Gemini batch untuk melabeli komentar.');
      }
    } catch {
      setSandboxError('Fitur uji klasifikasi instan tidak tersedia di server ini. Gunakan Analisis Gemini batch untuk melabeli komentar.');
    } finally {
      setSandboxBusy(false);
    }
  };

  const exportCsv = () => {
    const header = ['timestamp', 'author', 'post_author', 'post_code', 'platform', 'text', 'sentiment', 'emotion', 'topic', 'toxicity', 'spam', 'alasan'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filtered.map((f) => [
      f.timestamp, f.author, f.postAuthor, f.postCode, f.platform, f.text,
      f.sentiment || '', f.emotion || '', topicLabel(f.topic), Number(f.toxicity || 0).toFixed(2), f.spam ? 'true' : 'false', f.alasan || '',
    ].map(esc).join(','));
    downloadText(`${project || 'proyek'}-sentimen.csv`, [header.join(','), ...rows].join('\n'));
  };

  const jumpToActor = (actorId) => {
    if (typeof onTab === 'function') onTab('jaringan', actorId);
  };

  return (
    <div className="space-y-5">
      {/* Live Classifier Sandbox */}
      <section className="surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Uji Klasifikasi Sentimen Real-Time (Gemini AI)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Tempel komentar atau keluhan pelanggan untuk menguji deteksi sentimen, emosi, toksisitas, dan spam secara instan
            </p>
          </div>
          <button
            type="button"
            onClick={runBatchAnalyze}
            disabled={analyzing}
            className="btn-primary"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {analyzing ? 'Memproses Batch...' : 'Analisis Komentar Belum Berlabel'}
          </button>
        </div>

        <form onSubmit={runSandbox} className="flex flex-col gap-2.5 sm:flex-row">
          <input
            type="text"
            value={sandboxText}
            onChange={(e) => setSandboxText(e.target.value)}
            placeholder="Contoh: Kereta terlambat 25 menit tapi pengumuman di peron sama sekali tidak jelas!"
            className="input-field flex-1 py-2"
          />
          <button type="submit" disabled={sandboxBusy || !sandboxText.trim()} className="btn-secondary py-2">
            {sandboxBusy ? 'Menganalisis...' : 'Klasifikasi Sekarang'}
          </button>
        </form>

        {sandboxError && (
          <p className="mt-2.5 text-xs text-red-600 dark:text-red-400">{sandboxError}</p>
        )}

        {sandboxResult && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
            <span
              className={`font-semibold capitalize ${
                sandboxResult.sentiment === 'positif'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : sandboxResult.sentiment === 'negatif'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Sentimen: {sandboxResult.sentiment || '-'}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-700 dark:text-slate-300">Emosi: {sandboxResult.emotion || '-'}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-700 dark:text-slate-300">Topik: {sandboxResult.topicLabel || '-'}</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
              Toksisitas {Number(sandboxResult.toxicity || 0).toFixed(2)}
            </span>
            {sandboxResult.spam && (
              <>
                <span className="text-slate-400">·</span>
                <span className="font-medium text-amber-600 dark:text-amber-400">Terindikasi Spam</span>
              </>
            )}
            {sandboxResult.alasan && (
              <p className="w-full text-[11px] text-slate-500 dark:text-slate-400">
                Alasan model: {sandboxResult.alasan}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="surface p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Tampil</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{nf(filtered.length)}</div>
        </div>
        <div className="surface p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Positif</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {nf(stats.positif)}
          </div>
        </div>
        <div className="surface p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Netral</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-700 dark:text-slate-300">
            {nf(stats.netral)}
          </div>
        </div>
        <div className="surface p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Negatif</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
            {nf(stats.negatif)}
          </div>
        </div>
        <div className="surface p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Toksik &ge; 0,6</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {nf(stats.toxic)}
          </div>
        </div>
        <div className="surface p-3.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Spam</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {nf(stats.spam)}
          </div>
        </div>
      </div>

      {/* Main Split */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {/* Filter Bar */}
          <div className="surface flex flex-wrap items-center gap-2 p-3">
            <input
              type="search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setShown(60); }}
              placeholder="Cari teks komentar atau @akun..."
              className="input-field min-w-[180px] flex-1"
            />
            <select
              value={sentFilter}
              onChange={(e) => { setSentFilter(e.target.value); setShown(60); }}
              className="input-field"
            >
              <option value="">Semua Sentimen</option>
              <option value="positif">Positif</option>
              <option value="netral">Netral</option>
              <option value="negatif">Negatif</option>
              <option value="unlabeled">Belum Berlabel</option>
            </select>
            <select
              value={emoFilter}
              onChange={(e) => { setEmoFilter(e.target.value); setShown(60); }}
              className="input-field"
            >
              <option value="">Semua Emosi</option>
              {emotions.map((em) => (
                <option key={em} value={em}>{em}</option>
              ))}
            </select>
            <select
              value={topicFilter}
              onChange={(e) => { setTopicFilter(e.target.value); setShown(60); }}
              className="input-field max-w-[180px]"
            >
              <option value="">Semua Topik</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <select
              value={flagFilter}
              onChange={(e) => { setFlagFilter(e.target.value); setShown(60); }}
              className="input-field"
            >
              <option value="">Semua Flag</option>
              <option value="tox">Toksisitas &ge; 0,6</option>
              <option value="spam">Spam saja</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input-field"
            >
              <option value="baru">Terbaru</option>
              <option value="lama">Terlama</option>
              <option value="tox">Toksisitas Tertinggi</option>
              <option value="akun">Akun A–Z</option>
            </select>
            <button
              type="button"
              onClick={exportCsv}
              className="btn-secondary"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>

          {/* Comment Stream List */}
          <div className="surface divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.slice(0, shown).map((e) => {
              const sentColor =
                e.sentiment === 'positif'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : e.sentiment === 'negatif'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-500 dark:text-slate-400';

              return (
                <article key={e.key} className="p-4 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => jumpToActor(e.author.toLowerCase())}
                        className="font-semibold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                      >
                        @{e.author}
                      </button>
                      <span className="text-slate-400">membalas</span>
                      <button
                        type="button"
                        onClick={() => jumpToActor(e.postAuthor.toLowerCase())}
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        @{e.postAuthor}
                      </button>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-500 dark:text-slate-400">{e.platform}</span>
                    </div>
                    <time className="font-mono text-[11px] tabular-nums text-slate-400">
                      {e.timestamp ? new Date(e.timestamp).toLocaleString('id-ID') : '-'}
                    </time>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    <span className={`font-semibold capitalize ${sentColor}`}>
                      {e.sentiment || 'Belum dianalisis'}
                    </span>
                    {e.emotion && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className="capitalize text-slate-600 dark:text-slate-300">{e.emotion}</span>
                      </>
                    )}
                    {e.topic != null && e.topic !== '' && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className="text-slate-600 dark:text-slate-300">Topik: {topicLabel(e.topic)}</span>
                      </>
                    )}
                    {e.toxicity != null && Number(e.toxicity) >= 0.4 && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                          Toksisitas {Number(e.toxicity).toFixed(2)}
                        </span>
                      </>
                    )}
                    {e.spam && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className="font-medium text-amber-600 dark:text-amber-400">Spam</span>
                      </>
                    )}
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                    {highlightKeywords(e.text, keywords.map(([k]) => k))}
                  </p>

                  {e.alasan && (
                    <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      Alasan model: {e.alasan}
                    </p>
                  )}
                </article>
              );
            })}

            {filtered.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Tidak ada komentar yang cocok dengan filter saat ini.
              </div>
            )}
          </div>

          {filtered.length > shown && (
            <button
              type="button"
              onClick={() => setShown((s) => s + 60)}
              className="btn-secondary w-full py-2"
            >
              Tampilkan 60 komentar berikutnya ({nf(filtered.length - shown)} tersisa)
            </button>
          )}
        </div>

        {/* Right Breakdown Sidebar */}
        <aside className="space-y-4 xl:col-span-4">
          <div className="surface p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Proporsi Polaritas</h3>
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              {labeledCount > 0 && (
                <>
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${(stats.positif / labeledCount) * 100}%` }}
                  />
                  <div
                    className="bg-slate-400"
                    style={{ width: `${(stats.netral / labeledCount) * 100}%` }}
                  />
                  <div
                    className="bg-red-500"
                    style={{ width: `${(stats.negatif / labeledCount) * 100}%` }}
                  />
                </>
              )}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              <span>Pos {labeledCount ? Math.round((stats.positif / labeledCount) * 100) : 0}%</span>
              <span>Net {labeledCount ? Math.round((stats.netral / labeledCount) * 100) : 0}%</span>
              <span>Neg {labeledCount ? Math.round((stats.negatif / labeledCount) * 100) : 0}%</span>
            </div>
          </div>

          <div className="surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Klaster Topik ({topics.length})
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {topics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTopicFilter((cur) => (String(cur) === String(t.id) ? '' : String(t.id)))}
                  className={`block w-full py-2.5 text-left transition-colors ${
                    String(topicFilter) === String(t.id) ? 'text-blue-600 dark:text-blue-400' : ''
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="truncate">{t.label}</span>
                    <span className="font-mono tabular-nums text-slate-500">{nf(t.count)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {(t.keywords || []).join(' · ')}
                  </p>
                </button>
              ))}
              {topics.length === 0 && (
                <p className="py-2 text-xs text-slate-500 dark:text-slate-400">
                  Belum ada topik yang terekstrak.
                </p>
              )}
            </div>
          </div>

          <div className="surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Kata Kunci Menonjol
            </h3>
            <div className="flex flex-wrap gap-2">
              {keywords.map(([word, count]) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => setQ((cur) => (cur === word ? '' : word))}
                  className={`text-xs transition-colors hover:underline ${
                    q === word
                      ? 'font-semibold text-blue-600 dark:text-blue-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {word}{' '}
                  <span className="font-mono text-[10px] tabular-nums text-slate-400">({count})</span>
                </button>
              ))}
              {keywords.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">Belum ada kata kunci.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
