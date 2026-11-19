import React, { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Card, { CardBody, CardHeader } from '../components/Card.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { api, formatDate } from '../lib/utils.js';
import { currentProject as getProject, projectFile, switchProject } from '../lib/project.js';

const nf = (v) => Number(v || 0).toLocaleString('id-ID');
const MODES = [
  { id: 'profile', label: 'Profil akun', target: 'nama_akun', hint: 'Ambil beberapa postingan terbaru dari sebuah akun beserta komentarnya.' },
  { id: 'keyword', label: 'Kata kunci', target: 'misal: pemilu 2026', hint: 'Cari postingan lewat kolom pencarian Threads.' },
  { id: 'post', label: 'URL postingan', target: 'https://www.threads.com/@akun/post/KODE', hint: 'Ambil satu postingan beserta komentarnya.' },
];
const PHASE = { login: 'Menunggu login…', discover: 'Mencari postingan…', scrape: 'Mengambil postingan…', done: 'Selesai', error: 'Gagal' };

function Bar({ value }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  );
}

export default function ScrapePage({ embedded = false, project: projectProp, onProjectChange }) {
  const project = projectProp || getProject();
  const [mode, setMode] = useState('profile');
  const [target, setTarget] = useState('');
  const [maxPosts, setMaxPosts] = useState(10);
  const [maxReplies, setMaxReplies] = useState(400);
  const [merge, setMerge] = useState(true);
  const [status, setStatus] = useState(null);
  const [warn, setWarn] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverOk, setServerOk] = useState(true);
  const [projects, setProjects] = useState([]);
  const [newName, setNewName] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const logRef = useRef(null);

  const refresh = useCallback(async () => {
    const r = await api('/api/scrape/status?project=' + encodeURIComponent(project));
    if (!r.ok) { setServerOk(false); return; }
    setServerOk(true); setStatus(r.data);
  }, [project]);

  const refreshProjects = useCallback(async () => {
    const r = await api('/api/projects');
    if (r.ok) setProjects(Array.isArray(r.data?.projects) ? r.data.projects : []);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 1500); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  const log = status?.log || [];
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log.length]);

  const send = async (path, body) => {
    setBusy(true);
    const r = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
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
    return send('/api/scrape/start', { project, mode, target: target.trim(), maxPosts: Number(maxPosts) || 10, maxReplies: Number(maxReplies) || 400, merge });
  };

  const selectProject = (slug) => {
    if (embedded && onProjectChange) {
      onProjectChange(slug);
      try { localStorage.setItem('sna-project', slug); const u = new URL(globalThis.location.href); u.searchParams.set('project', slug); globalThis.history.replaceState({}, '', u.pathname + u.search + u.hash); } catch { /* ignore */ }
    } else {
      switchProject(slug);
    }
  };

  const createProject = async () => {
    const name = newName.trim();
    if (!name) { setWarn('Isi nama proyek baru.'); return; }
    setProjectBusy(true);
    const r = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    setProjectBusy(false);
    if (!r.ok) { setWarn(r.data?.message || 'Gagal membuat proyek.'); return; }
    await refreshProjects(); selectProject(r.data.project.slug); setNewName('');
  };

  const renameProject = async (slug) => {
    const current = projects.find((p) => p.slug === slug);
    const name = globalThis.prompt('Nama proyek baru', current?.name || slug);
    if (!name || !name.trim() || name.trim() === current?.name) return;
    setProjectBusy(true);
    const r = await api('/api/projects/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, name: name.trim() }) });
    setProjectBusy(false);
    if (!r.ok) { setWarn(r.data?.message || 'Gagal mengganti nama proyek.'); return; }
    await refreshProjects();
  };

  const deleteProject = async (slug) => {
    if (!globalThis.confirm(`Hapus proyek "${slug}"? Data dipindahkan ke projects/.trash dan bisa dipulihkan manual.`)) return;
    setProjectBusy(true);
    const r = await api('/api/projects/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
    setProjectBusy(false);
    if (!r.ok) { setWarn(r.data?.message || 'Gagal menghapus proyek.'); return; }
    await refreshProjects();
    const remaining = projects.filter((p) => p.slug !== slug);
    selectProject(remaining[0]?.slug || 'default');
  };

  const projectName = projects.find((p) => p.slug === project)?.name || project;
  const login = status?.login || {};
  const job = status || {};
  const running = !!job.running;
  const loggingIn = !!login.running;
  const progress = job.total ? Math.round((job.done || 0) / job.total * 100) : (job.phase === 'done' ? 100 : 0);
  const info = job.data || {};
  const activeMode = MODES.find((m) => m.id === mode) || MODES[0];
  const analysisInfo = job.analysis || {};
  const dataHref = projectFile('data.json', project);
  const llmHref = projectFile('llm_analysis.json', project);

  const content = (
    <div className="space-y-4">
      {!serverOk && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200">
          Halaman ini butuh server lokal. Jalankan <code className="rounded bg-white/70 px-1 dark:bg-black/30">./run.sh serve</code>, lalu buka <code className="rounded bg-white/70 px-1 dark:bg-black/30">http://localhost:8000/scrape.html</code>.
        </div>
      )}
      {warn && <div className="rounded-lg bg-red-700 px-4 py-3 text-sm text-white">{warn}<button className="ml-3 underline" onClick={() => setWarn('')}>tutup</button></div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Ingesti & Pengumpulan Data" description={`Proyek aktif: ${projectName} · data disimpan di projects/${project}/data.json`} />
            <CardBody className="space-y-5">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span>1 · Sesi login Threads</span>
                  <StatusPill tone={login.active ? 'green' : 'slate'}>{login.active ? 'Aktif' : 'Belum ada'}</StatusPill>
                </div>
                <p className="mb-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Login hanya perlu sekali. Browser Chromium dibuka lokal; sesi disimpan di <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">threads_profile/</code>.</p>
                {loggingIn ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-700/50 dark:bg-blue-500/10 dark:text-blue-200">Browser login terbuka. {login.message || 'Silakan login, lalu kembali ke sini.'}</div>
                    <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={busy} onClick={confirmLogin}>✓ Saya sudah login</button><button className="btn-secondary" disabled={busy} onClick={cancelLogin}>Batalkan</button></div>
                  </div>
                ) : (
                  <button className="btn-primary" disabled={busy || running} onClick={startLogin}>Buka browser login ↗</button>
                )}
                {login.error && !loggingIn && <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">{login.error}</p>}
              </div>

              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="mb-3 text-xs font-semibold text-slate-700 dark:text-slate-200">2 · Ambil data</div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {MODES.map((m) => (
                    <button key={m.id} onClick={() => { setMode(m.id); setTarget(''); }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${mode === m.id ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'border-slate-200 text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:text-slate-300'}`}>{m.label}</button>
                  ))}
                </div>
                <label className="mb-3 block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Target</span>
                  <input className="input-field w-full" value={target} placeholder={activeMode.target} onChange={(e) => setTarget(e.target.value)} disabled={running} />
                  <span className="mt-1 block text-[11px] text-slate-400">{activeMode.hint}</span>
                </label>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Jumlah postingan</span><input className="input-field w-full" type="number" min="1" max="100" value={maxPosts} onChange={(e) => setMaxPosts(e.target.value)} disabled={running} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Maks. komentar per post</span><input className="input-field w-full" type="number" min="1" max="1000" value={maxReplies} onChange={(e) => setMaxReplies(e.target.value)} disabled={running} /></label>
                </div>
                <div className="mb-3">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Simpan hasil</span>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setMerge(true)} disabled={running} className={`rounded-lg border px-3 py-1.5 text-xs ${merge ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>Gabungkan dengan data lama</button>
                    <button onClick={() => setMerge(false)} disabled={running} className={`rounded-lg border px-3 py-1.5 text-xs ${!merge ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>Timpa data lama</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={busy || running || loggingIn} onClick={startScrape}>▶ Mulai scraping</button>
                  {running && <button className="btn-secondary" disabled={busy} onClick={cancelScrape}>■ Hentikan</button>}
                </div>
              </div>
            </CardBody>
          </Card>

          {(running || job.phase === 'done' || job.phase === 'error') && (
            <Card>
              <CardHeader title={PHASE[job.phase] || 'Proses'} description={job.total ? `${job.done || 0}/${job.total}` : ''} />
              <CardBody>
                <Bar value={progress} />
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{job.message || ''}</p>
                {job.error && job.phase === 'error' && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{job.error}</p>}
                {log.length > 0 && <pre ref={logRef} className="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-emerald-300 font-mono">{log.join('\n')}</pre>}
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Manajemen Proyek Pemantauan" description="Kelola ruang kerja riset" />
            <CardBody>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                <input className="input-field min-w-0 flex-1" placeholder="Nama proyek baru…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createProject(); }} />
                <button className="btn-primary" disabled={projectBusy} onClick={createProject}>＋ Buat</button>
              </div>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {projects.map((p) => (
                  <li key={p.slug} className={`flex items-center gap-2 px-3 py-2.5 text-xs ${p.slug === project ? 'bg-blue-50/70 dark:bg-blue-500/10' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-800 dark:text-slate-100">{p.name}</div>
                      <div className="text-[10px] text-slate-400">{nf(p.posts || 0)} post · {p.slug}</div>
                    </div>
                    {p.slug === project ? <StatusPill tone="brand">aktif</StatusPill> : <button className="btn-secondary !px-2 !py-1" onClick={() => selectProject(p.slug)}>Buka</button>}
                    <button className="btn-secondary !px-2 !py-1" onClick={() => renameProject(p.slug)}>Ubah</button>
                    <button className="btn-secondary !px-2 !py-1" disabled={projects.length <= 1} onClick={() => deleteProject(p.slug)}>Hapus</button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Impor & Cadangkan Dataset JSON" description="Unduh data proyek untuk arsip / analisis eksternal" />
            <CardBody className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Postingan</span><span className="font-semibold tabular-nums text-slate-800 dark:text-white">{nf(info.posts ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Ukuran data.json</span><span className="tabular-nums">{info.size ? `${(info.size / 1024).toFixed(0)} KB` : '-'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Diperbarui</span><span>{info.mtime ? formatDate(info.mtime * 1000) : '-'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Analisis LLM</span><span>{analysisInfo?.mtime ? formatDate(analysisInfo.mtime * 1000) : 'belum ada'}</span></div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <a className="btn-primary" href={dataHref} download={`data-${project}.json`}>Unduh data.json</a>
                <a className="btn-secondary" href={llmHref} download={`llm_analysis-${project}.json`}>Unduh analisis AI</a>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Impor dataset JSON ke proyek berjalan di server lokal belum tersedia sebagai endpoint tulis; untuk memuat data lain gunakan “Muat data.json” di tab Peta Jaringan (sesi lokal browser) atau salin berkas ke <code>projects/{project}/</code> saat server dimatikan.</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );

  if (embedded) return content;
  return <Layout page="scrape" title="Sumber & Proyek" subtitle={`Proyek ${projectName}`}>{content}</Layout>;
}
