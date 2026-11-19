import React, { useCallback, useEffect, useMemo, useState } from 'react';
import GlobalSearch from './GlobalSearch.jsx';
import StatusPill from './StatusPill.jsx';
import { api } from '../lib/utils.js';
import { currentProject, normalizeProject, switchProject } from '../lib/project.js';

const nf = (v) => Number(v || 0).toLocaleString('id-ID');

function Icon({ children, className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const I = {
  ringkasan: (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="4" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="10" width="7" height="11" rx="1.5"/></Icon>,
  jaringan: (p) => <Icon {...p}><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.2l2.8 8.2M16 7.2l-2.8 8.2M8.5 6h7"/></Icon>,
  sentimen: (p) => <Icon {...p}><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20V8"/></Icon>,
  sumber: (p) => <Icon {...p}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></Icon>,
  menu: (p) => <Icon {...p}><path d="M4 6h16M4 12h16M4 18h16"/></Icon>,
  close: (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>,
  sun: (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></Icon>,
  moon: (p) => <Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></Icon>,
  spark: (p) => <Icon {...p}><path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3Z"/><path d="M19 14l.8 2.1 2.2.9-2.2.9L19 20l-.8-2.1-2.2-.9 2.2-.9L19 14Z"/></Icon>,
  search: (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></Icon>,
  folder: (p) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></Icon>,
};

const NAV = [
  { id: 'ringkasan', label: 'Ringkasan', icon: I.ringkasan },
  { id: 'jaringan', label: 'Peta Jaringan', icon: I.jaringan },
  { id: 'sentimen', label: 'Sentimen', icon: I.sentimen },
  { id: 'sumber', label: 'Sumber & Proyek', icon: I.sumber },
];

function Sidebar({ tab, project, projects, onTab, onProjectChange, open, setOpen, dark, setDark }) {
  const activeSlug = normalizeProject(project) || currentProject();
  const list = projects.length ? projects : [{ slug: activeSlug, name: activeSlug }];
  if (!list.some((p) => p.slug === activeSlug)) list.unshift({ slug: activeSlug, name: activeSlug });

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed z-50 flex h-screen w-[248px] flex-col border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <button type="button" onClick={() => { onTab('ringkasan'); setOpen(false); }} className="flex items-center gap-2.5 text-left">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-[10px] font-bold tracking-wide text-white font-display">SNA</span>
            <div className="leading-tight">
              <div className="text-sm font-bold text-slate-900 font-display dark:text-white">Threads SNA</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Analisis jaringan &amp; sentimen</div>
            </div>
          </button>
          <button className="text-slate-500 lg:hidden" onClick={() => setOpen(false)} aria-label="Tutup menu"><I.close /></button>
        </div>

        <div className="px-3 pb-3">
          <label className="mb-1 block px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Proyek Pemantauan</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"><I.folder className="h-3.5 w-3.5" /></span>
            <select
              className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-8 text-xs font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={activeSlug}
              onChange={(e) => { const s = e.target.value; onProjectChange(s); setOpen(false); }}
              aria-label="Pilih proyek"
            >
              {list.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}{Number.isFinite(p.posts) ? ` · ${nf(p.posts)}` : ''}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">▾</span>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
          {NAV.map((item) => {
            const active = tab === item.id;
            const IconCmp = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { onTab(item.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${active
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'}`}
              >
                <span className={active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}>
                  <IconCmp />
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setDark(!dark)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title={dark ? 'Mode terang' : 'Mode gelap'}
          >
            <span className="text-slate-400">{dark ? <I.sun /> : <I.moon />}</span>
            <span>{dark ? 'Mode Terang' : 'Mode Gelap'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}

export default function Layout({ tab, tabLabel, project, onTab, onProjectChange, children }) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('sna-theme') === 'dark'; } catch { return false; }
  });
  const [projects, setProjects] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [anMsg, setAnMsg] = useState('');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('sna-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);

  const loadProjects = useCallback(async () => {
    const r = await api('/api/projects');
    if (r.ok) setProjects(Array.isArray(r.data?.projects) ? r.data.projects : []);
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects, project]);

  const projectName = useMemo(() => {
    const p = projects.find((x) => x.slug === project);
    return p?.name || project || 'default';
  }, [projects, project]);

  useEffect(() => {
    if (!analyzing) return;
    let alive = true;
    const tick = async () => {
      const s = await api('/api/status?project=' + encodeURIComponent(project || 'default'));
      if (!alive) return;
      if (s.ok && s.data?.running) {
        const d = s.data;
        setAnMsg(d.message || (d.total ? `${d.done}/${d.total}` : 'Menganalisis…'));
      } else {
        setAnalyzing(false);
        setAnMsg('');
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [analyzing, project]);

  const runAnalyze = async () => {
    if (analyzing) return;
    const r = await api('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project || 'default' }),
    });
    if (r.ok || r.status === 409) { setAnalyzing(true); setAnMsg('Memulai analisis…'); }
    else if (r.status === 404 || r.status === 501) setAnMsg('Server analisis tidak aktif');
    else setAnMsg(r.data?.message || 'Gagal memulai');
  };

  const handleProjectChange = (slug) => {
    const s = normalizeProject(slug) || 'default';
    onProjectChange?.(s);
    try {
      localStorage.setItem('sna-project', s);
      const u = new URL(globalThis.location.href);
      u.searchParams.set('project', s);
      globalThis.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar
        tab={tab} project={project} projects={projects}
        onTab={onTab} onProjectChange={handleProjectChange}
        open={open} setOpen={setOpen} dark={dark} setDark={setDark}
      />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button className="shrink-0 text-slate-600 lg:hidden dark:text-slate-300" onClick={() => setOpen(true)} aria-label="Buka menu"><I.menu /></button>

            <div className="hidden min-w-0 shrink items-center gap-1.5 text-xs sm:flex">
              <span className="truncate text-slate-500 dark:text-slate-400">Proyek</span>
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span className="truncate font-medium text-slate-700 dark:text-slate-200">{projectName}</span>
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span className="truncate font-semibold text-slate-900 dark:text-white">{tabLabel}</span>
            </div>

            <div className="min-w-0 flex-1 sm:max-w-md">
              <GlobalSearch />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {anMsg && <span className="hidden max-w-[180px] truncate text-[11px] text-blue-600 sm:inline dark:text-blue-300">{anMsg}</span>}
              <button
                type="button"
                onClick={runAnalyze}
                disabled={analyzing}
                className="btn-primary h-8 px-3"
                title="Jalankan analisis AI untuk proyek ini"
              >
                <I.spark className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{analyzing ? 'Menganalisis…' : 'Analisis AI'}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-[1440px] px-4 pb-6 text-[11px] leading-relaxed text-slate-500 sm:px-6 lg:px-8 dark:text-slate-400">
          Label AI adalah bantuan triase, bukan bukti. Selalu verifikasi manual. · Gaya visual terinspirasi template dashboard; komponen UI dasar diadaptasi dari <a className="underline hover:text-slate-700 dark:hover:text-slate-200" href="https://github.com/cruip/tailwind-dashboard-template" target="_blank" rel="noreferrer">Mosaic Lite</a> (GPL-3.0).
        </footer>
      </div>
    </div>
  );
}
