import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Upload, Download, Trash2 } from 'lucide-react';
import { api, formatDate, getJson } from '../lib/utils.js';
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

function downloadText(filename, content, mime = 'application/json;charset=utf-8') {
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

export default function ScrapePage({ embedded = false, project: projectProp, onTab, onProjectChange }) {
  const project = projectProp || getProject();
  const [projects, setProjects] = useState([]);
  const [newName, setNewName] = useState('');
  const [projBusy, setProjBusy] = useState(false);
  const [projMsg, setProjMsg] = useState('');

  const [mode, setMode] = useState('profile');
  const [target, setTarget] = useState('');
  const [maxPosts, setMaxPosts] = useState(20);
  const [maxReplies, setMaxReplies] = useState(100);
  const [merge, setMerge] = useState(true);

  const [status, setStatus] = useState({ running: false, phase: null, log: [] });
  const [login, setLogin] = useState({ logged_in: false, running: false });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const fileRef = useRef(null);

  const loadProjects = useCallback(async () => {
    const r = await api('/api/projects');
    if (r.ok) setProjects(Array.isArray(r.data?.projects) ? r.data.projects : []);
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects, project]);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      api('/api/scrape/status?project=' + encodeURIComponent(project)),
      api('/api/login/status'),
    ]);
    if (s.ok) setStatus(s.data || {});
    if (l.ok) setLogin(l.data || {});
  }, [project]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!status.running && !login.running) return;
    const id = setInterval(load, 1500);
    return () => clearInterval(id);
  }, [status.running, login.running, load]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status.log?.length]);

  const startScrape = async (e) => {
    e?.preventDefault?.();
    if (!target.trim()) { setNotice({ kind: 'err', text: 'Isi target terlebih dahulu.' }); return; }
    setBusy(true); setNotice(null);
    const r = await api('/api/scrape/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, mode, target: target.trim(), maxPosts: Number(maxPosts) || 20, maxReplies: Number(maxReplies) || 100, merge }),
    });
    setBusy(false);
    if (r.ok || r.status === 202 || r.status === 409) {
      setNotice({ kind: 'ok', text: r.data?.message || 'Pengambilan data dimulai.' });
      load();
    } else {
      setNotice({ kind: 'err', text: r.data?.message || 'Gagal memulai pengambilan data.' });
    }
  };

  const cancelScrape = async () => {
    await api('/api/scrape/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
    load();
  };

  const loginAction = async (path) => {
    setBusy(true);
    const r = await api(path, { method: 'POST' });
    setBusy(false);
    if (r.ok || r.status === 202) {
      setNotice({ kind: 'ok', text: r.data?.message || 'Perintah login dikirim.' });
    } else {
      setNotice({ kind: 'err', text: r.data?.message || 'Gagal memproses permintaan login.' });
    }
    load();
  };

  const createProject = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setProjBusy(true); setProjMsg('');
    const r = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setProjBusy(false);
    if (r.ok && r.data?.project?.slug) {
      const slug = r.data.project.slug;
      setNewName('');
      await loadProjects();
      try { localStorage.setItem('sna-project', slug); } catch {}
      if (typeof onProjectChange === 'function') onProjectChange(slug);
      else switchProject(slug);
    } else {
      setProjMsg(r.data?.message || 'Gagal membuat proyek.');
    }
  };

  const deleteProject = async (slug) => {
    if (projects.length <= 1) return;
    setProjBusy(true); setProjMsg('');
    const r = await api('/api/projects/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    setProjBusy(false);
    if (r.ok) {
      await loadProjects();
      const list = projects.filter((p) => p.slug !== slug);
      const next = list[0]?.slug || 'default';
      if (slug === project) {
        try { localStorage.setItem('sna-project', next); } catch {}
        if (typeof onProjectChange === 'function') onProjectChange(next);
      }
    } else {
      setProjMsg(r.data?.message || 'Gagal menghapus proyek.');
    }
  };

  const downloadDataset = async (file) => {
    const data = await getJson(projectFile(file, project));
    if (!data) {
      setNotice({ kind: 'err', text: `Berkas ${file} belum tersedia untuk proyek ini.` });
      return;
    }
    downloadText(`${project}-${file}`, JSON.stringify(data, null, 2));
  };

  const onImportFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Impor tulis ke server tidak tersedia; arahkan ke Peta Jaringan (muat lokal) / salin manual.
    setNotice({ kind: 'err', text: 'Impor ke server tidak tersedia. Muat file secara lokal di tab Peta Jaringan, atau salin ke projects/<slug>/ saat server mati.' });
    e.target.value = '';
  };

  const currentMode = MODES.find((m) => m.id === mode) || MODES[0];
  const progressDone = Number(status.done ?? status.current ?? 0);
  const progressTotal = Number(status.total || 0);
  const pct = progressTotal
    ? Math.round((progressDone / progressTotal) * 100)
    : (status.phase === 'done' ? 100 : 0);
  const data = status.data || {};
  const activeProject = projects.find((p) => p.slug === project);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      {/* Left: Ingest/Scrape & Import */}
      <div className="space-y-5 xl:col-span-7">
        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Ingesti Data Langsung &amp; Klasifikasi Real-Time
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Ambil postingan/komentar dari Threads ke proyek &ldquo;{activeProject?.name || project}&rdquo; untuk memperbarui graf SNA dan sentimen
          </p>

          <form onSubmit={startScrape} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs">
                <span className="text-slate-500 dark:text-slate-400">Jenis Entri</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="input-field mt-1 w-full"
                >
                  {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>

              <label className="block text-xs">
                <span className="text-slate-500 dark:text-slate-400">Platform</span>
                <select value="Threads" disabled className="input-field mt-1 w-full">
                  <option value="Threads">Threads</option>
                </select>
              </label>

              <label className="block text-xs">
                <span className="text-slate-500 dark:text-slate-400">Status Sesi</span>
                <div className="input-field mt-1 flex w-full items-center justify-between">
                  <span className={login.logged_in ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}>
                    {login.logged_in ? 'Login aktif' : 'Belum login'}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">{login.running ? 'proses' : ''}</span>
                </div>
              </label>
            </div>

            <label className="block text-xs">
              <span className="text-slate-500 dark:text-slate-400">Target ({currentMode.target})</span>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={currentMode.target}
                className="input-field mt-1 w-full"
              />
              <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{currentMode.hint}</span>
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs">
                <span className="text-slate-500 dark:text-slate-400">Maks. postingan</span>
                <input type="number" min={1} max={200} value={maxPosts} onChange={(e) => setMaxPosts(e.target.value)} className="input-field mt-1 w-full" />
              </label>
              <label className="block text-xs">
                <span className="text-slate-500 dark:text-slate-400">Maks. balasan/post</span>
                <input type="number" min={0} max={500} value={maxReplies} onChange={(e) => setMaxReplies(e.target.value)} className="input-field mt-1 w-full" />
              </label>
              <label className="flex items-end pb-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} className="accent-blue-600" />
                  <span>Gabung dengan data yang ada</span>
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => loginAction('/api/login/start')} disabled={busy} className="btn-secondary">
                  Buka Login Threads
                </button>
                {login.running && (
                  <>
                    <button type="button" onClick={() => loginAction('/api/login/confirm')} disabled={busy} className="btn-secondary">Konfirmasi Login</button>
                    <button type="button" onClick={() => loginAction('/api/login/cancel')} disabled={busy} className="btn-secondary">Batal</button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {status.running ? (
                  <button type="button" onClick={cancelScrape} className="btn-secondary">Hentikan</button>
                ) : null}
                <button
                  type="submit"
                  disabled={busy || status.running || !target.trim()}
                  className="btn-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {status.running ? 'Mengambil...' : 'Kirim ke Aliran Data'}
                </button>
              </div>
            </div>
          </form>

          {(status.running || status.phase) && (
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">{PHASE[status.phase] || status.phase || 'Status'}</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">{progressDone}/{progressTotal} ({pct}%)</span>
              </div>
              <Bar value={pct} />
              {status.message && <p className="text-xs text-slate-600 dark:text-slate-300">{status.message}</p>}
              {status.error && <p className="text-xs text-red-600 dark:text-red-400">{status.error}</p>}
            </div>
          )}

          {notice && (
            <p className={`mt-3 text-xs ${notice.kind === 'err' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
              {notice.text}
            </p>
          )}

          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="mb-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">Log Proses</div>
            <pre ref={logRef} className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">
              {(status.log && status.log.length ? status.log : ['Belum ada log.']).join('\n')}
            </pre>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
            <div><div className="text-[11px] text-slate-500 dark:text-slate-400">Postingan</div><div className="font-mono text-lg font-semibold tabular-nums">{nf(data.posts || 0)}</div></div>
            <div><div className="text-[11px] text-slate-500 dark:text-slate-400">Balasan</div><div className="font-mono text-lg font-semibold tabular-nums">{nf(data.replies || 0)}</div></div>
            <div><div className="text-[11px] text-slate-500 dark:text-slate-400">Diperbarui</div><div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{data.updated_at ? formatDate(data.updated_at) : '—'}</div></div>
          </div>
        </section>

        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Impor &amp; Cadangkan Dataset JSON
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Unduh <code className="font-mono">data.json</code> dan{' '}
            <code className="font-mono">llm_analysis.json</code> per proyek. Impor tulis ke server tidak tersedia.
          </p>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-secondary"
            >
              <Upload className="h-3.5 w-3.5" /> Impor File JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              hidden
              onChange={onImportFile}
            />
            <button
              type="button"
              onClick={() => downloadDataset('data.json')}
              className="btn-secondary"
            >
              <Download className="h-3.5 w-3.5" /> Unduh Dataset (data.json)
            </button>
            <button
              type="button"
              onClick={() => downloadDataset('llm_analysis.json')}
              className="btn-secondary"
            >
              <Download className="h-3.5 w-3.5" /> Unduh Analisis (llm_analysis.json)
            </button>
          </div>
        </section>
      </div>

      {/* Right: Workspace / Project Manager */}
      <div className="space-y-5 xl:col-span-5">
        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Manajemen Proyek Pemantauan
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Pisahkan ruang kerja berdasarkan kampanye atau isu agar graf SNA tidak tercampur
          </p>

          <form onSubmit={createProject} className="mt-4 space-y-2.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nama proyek baru, mis. Evaluasi Layanan Publik"
              className="input-field w-full"
            />
            <input
              type="text"
              value=""
              readOnly
              placeholder="Kata kunci pantauan (opsional, diatur saat scraping)"
              className="input-field w-full"
            />
            <button
              type="submit"
              disabled={projBusy || !newName.trim()}
              className="btn-primary w-full"
            >
              <Plus className="h-3.5 w-3.5" /> Buat Proyek Baru
            </button>
          </form>

          {projMsg && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{projMsg}</p>
          )}

          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
            {projects.map((p) => {
              const active = p.slug === project;
              return (
                <div key={p.slug} className="flex items-center justify-between gap-2 py-3 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900 dark:text-white">
                      {p.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {nf(p.posts || 0)} post · {p.has_data ? 'data tersedia' : 'kosong'}{p.has_analysis ? ' · berlabel' : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {active ? (
                      <span className="font-medium text-blue-600 dark:text-blue-400">Aktif</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          try { localStorage.setItem('sna-project', p.slug); } catch {}
                          if (typeof onProjectChange === 'function') onProjectChange(p.slug);
                          else switchProject(p.slug);
                        }}
                        className="btn-secondary"
                      >
                        Buka
                      </button>
                    )}
                    {projects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => deleteProject(p.slug)}
                        disabled={projBusy}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        title="Hapus proyek"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {projects.length === 0 && (
              <p className="py-3 text-xs text-slate-500 dark:text-slate-400">Belum ada proyek.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
