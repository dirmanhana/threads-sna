import React, { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api, formatDate } from '../lib/utils.js';

const MODES = [
  { id: 'profile', label: 'Profil akun', target: 'nama_akun',
    hint: 'Ambil beberapa postingan terbaru dari sebuah akun beserta komentarnya.' },
  { id: 'keyword', label: 'Kata kunci', target: 'misal: pemilu 2026',
    hint: 'Cari postingan lewat kolom pencarian Threads.' },
  { id: 'post', label: 'URL postingan', target: 'https://www.threads.com/@akun/post/KODE',
    hint: 'Ambil satu postingan beserta komentarnya.' },
];

const PHASE = {
  login: 'Menunggu login…', discover: 'Mencari postingan…', scrape: 'Mengambil postingan…',
  done: 'Selesai', error: 'Gagal',
};

function Bar({ value }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-gray-700">
      <div className="h-full rounded-full bg-brand-600 transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  );
}

export default function ScrapePage() {
  const [mode, setMode] = useState('profile');
  const [target, setTarget] = useState('');
  const [maxPosts, setMaxPosts] = useState(10);
  const [maxReplies, setMaxReplies] = useState(400);
  const [merge, setMerge] = useState(true);
  const [status, setStatus] = useState(null);
  const [warn, setWarn] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverOk, setServerOk] = useState(true);
  const logRef = useRef(null);

  const refresh = useCallback(async () => {
    const r = await api('/api/scrape/status');
    if (!r.ok) { setServerOk(false); return; }
    setServerOk(true);
    setStatus(r.data);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);

  const log = status?.log || [];
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  const send = async (path, body) => {
    setBusy(true);
    const r = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    setBusy(false);
    if (!r.ok && r.status !== 404) setWarn(r.data?.message || 'Permintaan gagal.');
    else if (r.status === 404) setWarn('Server API tidak tersedia. Jalankan lewat ./run.sh serve.');
    else setWarn('');
    await refresh();
    return r;
  };

  const startLogin = () => send('/api/login/start');
  const confirmLogin = () => send('/api/login/confirm');
  const cancelLogin = () => send('/api/login/cancel');
  const cancelScrape = () => send('/api/scrape/cancel');

  const startScrape = () => {
    if (!target.trim()) { setWarn('Isi target terlebih dahulu.'); return; }
    return send('/api/scrape/start', {
      mode, target: target.trim(), maxPosts: Number(maxPosts) || 10,
      maxReplies: Number(maxReplies) || 400, merge,
    });
  };

  const login = status?.login || {};
  const job = status || {};
  const running = !!job.running;
  const loggingIn = !!login.running;
  const progress = job.total ? Math.round((job.done || 0) / job.total * 100)
    : (job.phase === 'done' ? 100 : 0);
  const info = job.data || {};
  const activeMode = MODES.find((m) => m.id === mode) || MODES[0];

  const actions = (
    <>
      <a className="btn" href="/viewer.html">Peta jaringan</a>
      <a className="btn" href="/sentimen.html">Sentimen</a>
    </>
  );

  return (
    <Layout page="scrape" title="Pengumpulan Data" subtitle="Ambil postingan & komentar Threads dari browser, lalu simpan ke data.json"
      actions={actions}>
      {!serverOk && (
        <div className="card mb-4 border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          Halaman ini butuh server lokal. Jalankan <code className="rounded bg-white/70 px-1 dark:bg-black/30">./run.sh serve</code>,
          lalu buka <code className="rounded bg-white/70 px-1 dark:bg-black/30">http://localhost:8000/scrape.html</code>.
        </div>
      )}
      {warn && (
        <div className="mb-4 rounded-xl bg-red-700 px-4 py-3 text-sm text-white">
          {warn}<button className="ml-3 underline" onClick={() => setWarn('')}>tutup</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {/* ---- Sesi login ---- */}
          <section className="card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-white">1 · Sesi login Threads</h2>
              <span className={`badge ${login.active ? 'badge-positif' : 'badge-netral'}`}>
                {login.active ? 'Aktif' : 'Belum ada'}
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-gray-400">
              Login hanya perlu sekali. Tombol ini membuka jendela Chromium; silakan login di sana.
              Sesi disimpan lokal di <code className="rounded bg-slate-100 px-1 dark:bg-gray-700">threads_profile/</code>
              dan tidak pernah dikirim ke browser.
            </p>
            {loggingIn ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs text-brand-800 dark:border-brand-700 dark:bg-brand-500/10 dark:text-brand-200">
                  Browser login sudah terbuka. {login.message || 'Silakan login, lalu kembali ke halaman ini.'}
                  Deteksi berjalan otomatis — tombol di bawah hanya fallback bila tidak terdeteksi.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" disabled={busy} onClick={confirmLogin}>✓ Saya sudah login</button>
                  <button className="btn" disabled={busy} onClick={cancelLogin}>Batalkan</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary" disabled={busy || running} onClick={startLogin}>
                Buka browser login ↗
              </button>
            )}
            {login.error && !loggingIn && (
              <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">{login.error}</p>
            )}
          </section>

          {/* ---- Form scraping ---- */}
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-white">2 · Ambil data</h2>
            <div className="mb-4 flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => { setMode(m.id); setTarget(''); }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${mode === m.id
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'border-slate-200 text-slate-600 hover:border-brand-300 dark:border-gray-700 dark:text-gray-300'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-gray-400">Target</span>
              <input className="field w-full" value={target} placeholder={activeMode.target}
                onChange={(e) => setTarget(e.target.value)} disabled={running} />
              <span className="mt-1 block text-[11px] text-slate-400">{activeMode.hint}</span>
            </label>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-gray-400">Jumlah postingan</span>
                <input className="field w-full" type="number" min="1" max="100" value={maxPosts}
                  onChange={(e) => setMaxPosts(e.target.value)} disabled={running} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-gray-400">Maks. komentar per post</span>
                <input className="field w-full" type="number" min="1" max="1000" value={maxReplies}
                  onChange={(e) => setMaxReplies(e.target.value)} disabled={running} />
              </label>
            </div>
            <div className="mb-4">
              <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-gray-400">Simpan hasil</span>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setMerge(true)} disabled={running}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${merge
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'border-slate-200 text-slate-600 dark:border-gray-700 dark:text-gray-300'}`}>
                  Gabungkan dengan data lama
                </button>
                <button onClick={() => setMerge(false)} disabled={running}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${!merge
                    ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                    : 'border-slate-200 text-slate-600 dark:border-gray-700 dark:text-gray-300'}`}>
                  Timpa data lama
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {merge
                  ? 'Postingan lama tetap disimpan; yang baru menimpa berdasarkan kode post.'
                  : 'data.json diganti seluruhnya. Versi lama tetap dibackup ke data.json.bak.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy || running || loggingIn} onClick={startScrape}>
                ▶ Mulai scraping
              </button>
              {running && <button className="btn" disabled={busy} onClick={cancelScrape}>■ Hentikan</button>}
            </div>
          </section>

          {/* ---- Progres ---- */}
          {(running || job.phase === 'done' || job.phase === 'error') && (
            <section className="card p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-white">
                  {PHASE[job.phase] || 'Proses'}
                </h2>
                <span className="text-xs tabular-nums text-slate-500 dark:text-gray-400">
                  {job.total ? `${job.done || 0}/${job.total}` : ''}
                </span>
              </div>
              <Bar value={progress} />
              <p className="mt-2 text-xs text-slate-600 dark:text-gray-300">{job.message || ''}</p>
              {job.error && job.phase === 'error' && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-300">{job.error}</p>
              )}
              {log.length > 0 && (
                <pre ref={logRef}
                  className="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-emerald-300">
                  {log.join('\n')}
                </pre>
              )}
            </section>
          )}
        </div>

        {/* ---- Ringkasan data ---- */}
        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-white">Data tersimpan</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-500 dark:text-gray-400">Postingan</span>
                <span className="font-semibold tabular-nums text-slate-800 dark:text-white">{info.posts ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-gray-400">Ukuran data.json</span>
                <span className="tabular-nums text-slate-700 dark:text-gray-200">
                  {info.size ? `${(info.size / 1024).toFixed(0)} KB` : '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-gray-400">Diperbarui</span>
                <span className="text-slate-700 dark:text-gray-200">
                  {info.mtime ? formatDate(info.mtime * 1000) : '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-gray-400">Backup .bak</span>
                <span className="text-slate-700 dark:text-gray-200">
                  {info.backup ? formatDate(info.backup * 1000) : '-'}</span></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="btn btn-primary" href="/viewer.html">Buka di peta jaringan ↗</a>
              <a className="btn" href="/data.json" download="data.json">Unduh data.json</a>
            </div>
          </section>
          <section className="card p-5 text-[11px] leading-relaxed text-slate-500 dark:text-gray-400">
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-white">Catatan</h2>
            <p className="mb-2">
              Scraper memakai browser sungguhan dan sesi login Anda, jadi hasilnya bergantung pada
              tampilan Threads saat ini. Jika semua postingan gagal, periksa sesi login atau selector
              di <code className="rounded bg-slate-100 px-1 dark:bg-gray-700">scrape_threads.py</code>.
            </p>
            <p>
              Jeda antar postingan sengaja ada agar permintaan tidak beruntun. Proses ini bisa
              berlangsung beberapa menit; Anda boleh menutup halaman ini — job tetap berjalan di server.
            </p>
          </section>
        </aside>
      </div>
    </Layout>
  );
}
