import React, { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import StatusPill from './StatusPill.jsx';
import { api } from '../lib/utils.js';

const Icon = ({ d, className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICON_SUMMARY = 'M4 4h7v7H4V4Zm9 0h7v4h-7V4ZM4 13h7v7H4v-7Zm9-3h7v10h-7V10Z';
const ICON_GRAPH = 'M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-7 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm14 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-7-5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5.8-1.7-3.2 2.3a4.5 4.5 0 0 1-1.2 2.1l3.1 2.2a4.5 4.5 0 0 1 1.3-2.1l3.2-2.3-3.2-2.2ZM4.2 6.8l3.2 2.3a4.6 4.6 0 0 1 1.2-2.1L5.5 4.8A4.6 4.6 0 0 1 4.2 6.8Zm-1.6 10.5 3.2-2.3a4.5 4.5 0 0 1 2.3 2.2l3.1 2.2a4.5 4.5 0 0 1-2.2-2.2L2.6 17.3Z';
const ICON_CHART = 'M4 13h4v7H4v-7Zm6-9h4v16h-4V4Zm6 5h4v11h-4V9Z';
const ICON_DB = 'M12 3c-4.4 0-8 1.3-8 3s3.6 3 8 3 8-1.3 8-3-3.6-3-8-3Zm0 2c3.3 0 6 .8 6 1s-2.7 1-6 1-6-.8-6-1 2.7-1 6-1ZM4 8.2c1.1 1 3.6 1.8 8 1.8s6.9-.8 8-1.8V12c0 1.7-3.6 3-8 3s-8-1.3-8-3V8.2Zm0 5.2c1.1 1 3.6 1.8 8 1.8s6.9-.8 8-1.8V17c0 1.7-3.6 3-8 3s-8-1.3-8-3v-3.6Z';
const ICON_MENU = 'M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z';
const ICON_CLOSE = 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z';
const ICON_SUN = 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z';
const ICON_MOON = 'M20.4 15.1A9 9 0 0 1 8.9 3.6 9 9 0 1 0 20.4 15.1Z';
const ICON_CHEVRON = 'M8.6 4.6 16 12l-7.4 7.4L7.2 18l6-6-6-6 1.4-1.4Z';

const NAV_GROUPS = [
  {
    label: 'Utama',
    items: [{ href: '/', page: 'ringkasan', icon: ICON_SUMMARY, label: 'Ringkasan' }],
  },
  {
    label: 'Analisis',
    items: [
      { href: '/viewer.html', page: 'viewer', icon: ICON_GRAPH, label: 'Peta Jaringan' },
      { href: '/sentimen.html', page: 'sentimen', icon: ICON_CHART, label: 'Analisis Sentimen' },
    ],
  },
  {
    label: 'Data',
    items: [{ href: '/scrape.html', page: 'scrape', icon: ICON_DB, label: 'Pengumpulan Data' }],
  },
];

function NavItem({ href, active, icon, label, expanded }) {
  return (
    <a
      href={href}
      title={label}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition
        ${expanded ? '' : 'lg:justify-center lg:px-0'}
        ${active
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
          : 'text-slate-600 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-gray-700/60'}`}
    >
      <span className={active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 group-hover:text-brand-500'}>
        <Icon d={icon} />
      </span>
      <span className={expanded ? '' : 'lg:hidden'}>{label}</span>
    </a>
  );
}

function Sidebar({ page, expanded, setExpanded, open, setOpen }) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />
      )}
      <aside
        className={`fixed z-50 flex h-screen flex-col border-r border-slate-200 bg-white px-3 py-4 transition-all duration-200
          dark:border-gray-700/60 dark:bg-gray-800 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0
          ${open ? 'translate-x-0 w-64' : '-translate-x-full w-64'} lg:w-20 ${expanded ? 'lg:w-64' : ''}`}
      >
        <div className={`mb-6 flex items-center ${expanded ? 'justify-between px-1' : 'justify-center lg:justify-center'}`}>
          <a href="/" className="flex items-center gap-2 text-brand-600" title="Ringkasan">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">SNA</span>
            <span className={`text-sm font-bold tracking-tight text-slate-800 dark:text-white ${expanded ? '' : 'lg:hidden'}`}>
              Threads SNA
            </span>
          </a>
          <button className="text-slate-500 lg:hidden" onClick={() => setOpen(false)} aria-label="Tutup menu">
            <Icon d={ICON_CLOSE} className="w-5 h-5" />
          </button>
        </div>

        <nav className="space-y-5 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className={`mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${expanded ? '' : 'lg:hidden'}`}>
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavItem key={item.href} {...item} active={page === item.page} expanded={expanded} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto space-y-1 border-t border-slate-100 pt-3 dark:border-gray-700/60">
          <button
            onClick={() => setExpanded(!expanded)}
            className={`hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 lg:flex dark:text-gray-400 dark:hover:bg-gray-700/60 ${expanded ? '' : 'lg:justify-center lg:px-0'}`}
            title={expanded ? 'Ringkas menu' : 'Perlebar menu'}
            aria-label={expanded ? 'Ringkas menu' : 'Perlebar menu'}
          >
            <Icon d={ICON_CHEVRON} className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            <span className={expanded ? '' : 'lg:hidden'}>Ringkas menu</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function DataStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await api('/api/scrape/status');
      if (!alive) return;
      if (r.ok && r.data) setStatus(r.data);
      else setStatus({ offline: true });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!status) {
    return <StatusPill tone="slate" className="hidden sm:inline-flex">Memuat…</StatusPill>;
  }
  if (status.offline) {
    return <StatusPill tone="amber" dot className="hidden sm:inline-flex">Mode statis</StatusPill>;
  }
  if (status.running) {
    return <StatusPill tone="brand" dot pulse className="hidden sm:inline-flex">Scraping…</StatusPill>;
  }
  const posts = status.data?.posts ?? 0;
  const active = status.login?.active;
  return (
    <StatusPill tone={active ? 'green' : 'slate'} dot className="hidden sm:inline-flex">
      {posts} post · {active ? 'sesi aktif' : 'sesi belum ada'}
    </StatusPill>
  );
}

export default function Layout({ page, title, subtitle, meta, children, actions, wide = false }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sna-sidebar') === '1');
  const [dark, setDark] = useState(() => localStorage.getItem('sna-theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('sna-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    localStorage.setItem('sna-sidebar', expanded ? '1' : '0');
  }, [expanded]);

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar page={page} expanded={expanded} setExpanded={setExpanded} open={open} setOpen={setOpen} />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-gray-700/60 dark:bg-gray-900/90">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button className="shrink-0 text-slate-600 dark:text-gray-300 lg:hidden" onClick={() => setOpen(true)} aria-label="Buka menu">
              <Icon d={ICON_MENU} className="w-5 h-5" />
            </button>
            <GlobalSearch />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <DataStatus />
              <button
                onClick={() => setDark(!dark)}
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-gray-700/60"
                title={dark ? 'Mode terang' : 'Mode gelap'}
                aria-label={dark ? 'Mode terang' : 'Mode gelap'}
              >
                <Icon d={dark ? ICON_SUN : ICON_MOON} />
              </button>
            </div>
          </div>
        </header>

        <main className={`mx-auto w-full ${wide ? 'max-w-[1800px]' : 'max-w-[1536px]'} px-4 py-6 sm:px-6 lg:px-8`}>
          <PageHeader title={title} subtitle={subtitle} meta={meta} actions={actions} />
          {children}
        </main>

        <footer className="mx-auto w-full max-w-[1536px] px-4 pb-6 text-[11px] text-slate-500 sm:px-6 lg:px-8 dark:text-gray-400">
          Label LLM adalah bantuan triase, bukan bukti. Selalu verifikasi manual. ·
          Terinspirasi <a className="underline" href="https://github.com/cruip/tailwind-dashboard-template" target="_blank" rel="noreferrer">Mosaic Lite</a> (GPL-3.0).
        </footer>
      </div>
    </div>
  );
}
