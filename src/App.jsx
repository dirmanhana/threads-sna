import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Share2,
  MessageSquareText,
  Database,
  Sun,
  Moon,
  Radio,
  Sparkles,
  Menu,
  X,
  Search,
} from 'lucide-react';
import SummaryView from './pages/SummaryPage.jsx';
import ViewerView from './pages/ViewerPage.jsx';
import SentimentView from './pages/SentimentPage.jsx';
import ScrapeView from './pages/ScrapePage.jsx';
import { api } from './lib/utils.js';
import { currentProject, normalizeProject } from './lib/project.js';

const TABS = {
  ringkasan: { id: 'ringkasan', label: 'Ringkasan', path: '/' },
  jaringan: { id: 'jaringan', label: 'Peta Jaringan', path: '/viewer.html' },
  sentimen: { id: 'sentimen', label: 'Sentimen Real-Time', path: '/sentimen.html' },
  sumber: { id: 'sumber', label: 'Sumber & Proyek', path: '/scrape.html' },
};

const NAV_ITEMS = [
  { id: 'ringkasan', label: 'Ringkasan', icon: LayoutDashboard },
  { id: 'jaringan', label: 'Peta Jaringan', icon: Share2 },
  { id: 'sentimen', label: 'Sentimen Real-Time', icon: MessageSquareText },
  { id: 'sumber', label: 'Sumber & Proyek', icon: Database },
];

function tabFromLocation() {
  try {
    const u = new URL(globalThis.location.href);
    const q = u.searchParams.get('tab');
    if (q && TABS[q]) return q;
    const path = u.pathname || '/';
    if (/viewer|peta|jaringan/i.test(path)) return 'jaringan';
    if (/sentimen/i.test(path)) return 'sentimen';
    if (/scrape|pengumpulan|sumber/i.test(path)) return 'sumber';
  } catch { /* ignore */ }
  return 'ringkasan';
}

export default function App() {
  const [activeTab, setActiveTab] = useState(tabFromLocation);
  const [project, setProject] = useState(() => currentProject());
  const [projects, setProjects] = useState([]);
  const [banner, setBanner] = useState(null);
  const [globalQuery, setGlobalQuery] = useState('');
  const [networkFocus, setNetworkFocus] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [liveStream, setLiveStream] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    const saved = globalThis.localStorage?.getItem('sna-theme');
    if (saved) return saved === 'dark';
    const legacy = globalThis.localStorage?.getItem('nusapulse-theme');
    return legacy === 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      globalThis.localStorage?.setItem('sna-theme', isDark ? 'dark' : 'light');
      globalThis.localStorage?.setItem('nusapulse-theme', isDark ? 'dark' : 'light');
    } catch { /* ignore */ }
  }, [isDark]);

  const fetchProjects = useCallback(async () => {
    const r = await api('/api/projects');
    if (r.ok) setProjects(Array.isArray(r.data?.projects) ? r.data.projects : []);
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects, project]);

  useEffect(() => {
    const sync = () => {
      setActiveTab(tabFromLocation());
      setProject(currentProject());
    };
    globalThis.addEventListener('popstate', sync);
    return () => globalThis.removeEventListener('popstate', sync);
  }, []);

  // Deep-link focus (?focus=) -> buka tab Peta Jaringan
  useEffect(() => {
    try {
      const f = new URL(globalThis.location.href).searchParams.get('focus');
      if (f) {
        setNetworkFocus(f);
        setActiveTab('jaringan');
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!analyzing) return;
    let alive = true;
    const tick = async () => {
      const s = await api('/api/status?project=' + encodeURIComponent(project || 'default'));
      if (!alive) return;
      if (s.ok && s.data?.running) {
        setBanner({ kind: 'info', text: s.data.message || 'Analisis AI sedang berjalan...' });
      } else {
        setAnalyzing(false);
        if (s.ok && s.data?.error) setBanner({ kind: 'error', text: 'Analisis gagal: ' + s.data.error });
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [analyzing, project]);

  const projectName = useMemo(() => {
    const p = projects.find((x) => x.slug === project);
    return p?.name || project || 'default';
  }, [projects, project]);

  const setTab = useCallback((next, focusActor = null) => {
    const t = TABS[next] ? next : 'ringkasan';
    if (focusActor) setNetworkFocus(focusActor);
    setActiveTab(t);
    try {
      const u = new URL(globalThis.location.href);
      u.pathname = TABS[t].path;
      u.searchParams.set('project', project || currentProject() || 'default');
      u.searchParams.delete('tab');
      if (t === 'jaringan' && (focusActor || networkFocus || u.searchParams.get('focus'))) {
        const fv = focusActor || u.searchParams.get('focus') || networkFocus;
        if (fv) u.searchParams.set('focus', String(fv).replace(/^@/, ''));
      } else {
        u.searchParams.delete('focus');
      }
      u.hash = '';
      globalThis.history.pushState({ tab: t }, '', u.pathname + u.search);
    } catch { /* ignore */ }
  }, [project, networkFocus]);

  const handleProjectChange = useCallback((slug) => {
    const s = normalizeProject(slug) || 'default';
    setProject(s);
    try {
      localStorage.setItem('sna-project', s);
      const u = new URL(globalThis.location.href);
      u.searchParams.set('project', s);
      globalThis.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch { /* ignore */ }
  }, []);

  const handleBatchAnalyze = async () => {
    if (analyzing) return;
    setBanner(null);
    const r = await api('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project || 'default' }),
    });
    if (r.ok || r.status === 409) {
      setAnalyzing(true);
      setBanner({ kind: 'info', text: 'Analisis Gemini dimulai untuk proyek ini...' });
    } else if (r.status === 404 || r.status === 501) {
      setBanner({ kind: 'error', text: 'Server analisis tidak aktif. Jalankan lewat ./run.sh serve.' });
    } else {
      setBanner({ kind: 'error', text: r.data?.message || 'Gagal memulai analisis.' });
    }
  };

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  const projectOptions = projects.length
    ? projects
    : [{ slug: project || 'default', name: project || 'default' }];
  if (!projectOptions.some((p) => p.slug === project)) {
    projectOptions.unshift({ slug: project || 'default', name: project || 'default' });
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Workspace Sidebar (248px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-slate-200 bg-white transition-transform duration-150 dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5 dark:border-slate-800">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            NusaPulse
          </span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-md p-1 text-slate-500 lg:hidden"
            aria-label="Tutup menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Project Switcher */}
        <div className="border-b border-slate-200 p-4 dark:border-slate-800">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Proyek Pemantauan
          </label>
          <select
            value={project}
            onChange={(e) => {
              handleProjectChange(e.target.value);
              setNetworkFocus(null);
            }}
            className="input-field mt-1.5 w-full font-medium"
          >
            {projectOptions.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Primary Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Workspace Controls: Real-Time Stream + Theme */}
        <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setLiveStream((v) => !v)}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              liveStream
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5" />
              <span>Live Stream</span>
            </span>
            <span className="font-mono text-[11px]">{liveStream ? 'Aktif' : 'Mati'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDark((d) => !d)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span className="flex items-center gap-2">
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              <span>{isDark ? 'Mode Terang' : 'Mode Gelap'}</span>
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Strict 3-Zone Top Header Bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-6 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
          {/* Zone 1: Contextual Breadcrumb */}
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Buka menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="hidden sm:inline whitespace-nowrap">Proyek</span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
              <span className="max-w-[180px] truncate font-medium text-slate-800 dark:text-slate-200">
                {projectName}
              </span>
              <span className="text-slate-300 dark:text-slate-700">/</span>
              <span className="font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                {activeNav.label}
              </span>
            </div>
          </div>

          {/* Zone 2: Global Search */}
          <div className="relative hidden max-w-xs flex-1 md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="Cari @akun atau kata kunci..."
              className="input-field w-full pl-8"
            />
          </div>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleBatchAnalyze}
              disabled={analyzing}
              className="btn-primary"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {analyzing ? 'Menganalisis...' : 'Analisis Gemini'}
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6">
          {banner && (
            <div
              className={`mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs ${
                banner.kind === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300'
              }`}
            >
              <span>{banner.text}</span>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="font-medium underline"
              >
                Tutup
              </button>
            </div>
          )}

          {activeTab === 'ringkasan' && (
            <SummaryView embedded project={project} onTab={setTab} />
          )}
          {activeTab === 'jaringan' && (
            <ViewerView embedded project={project} onTab={setTab} focusAccount={networkFocus} />
          )}
          {activeTab === 'sentimen' && (
            <SentimentView embedded project={project} onTab={setTab} />
          )}
          {activeTab === 'sumber' && (
            <ScrapeView
              embedded
              project={project}
              onTab={setTab}
              onProjectChange={handleProjectChange}
            />
          )}
        </main>
      </div>
    </div>
  );
}
