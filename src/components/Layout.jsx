import React, { useEffect, useState } from 'react';

const Icon = ({ d, className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICON_GRAPH = 'M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-7 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm14 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-7-5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5.8-1.7-3.2 2.3a4.5 4.5 0 0 1-1.2 2.1l3.1 2.2a4.5 4.5 0 0 1 1.3-2.1l3.2-2.3-3.2-2.2ZM4.2 6.8l3.2 2.3a4.6 4.6 0 0 1 1.2-2.1L5.5 4.8A4.6 4.6 0 0 1 4.2 6.8Zm-1.6 10.5 3.2-2.3a4.5 4.5 0 0 1 2.3 2.2l3.1 2.2a4.5 4.5 0 0 1-2.2-2.2L2.6 17.3Z';
const ICON_CHART = 'M4 13h4v7H4v-7Zm6-9h4v16h-4V4Zm6 5h4v11h-4V9Z';
const ICON_MENU = 'M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z';
const ICON_CLOSE = 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z';
const ICON_SUN = 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z';
const ICON_MOON = 'M20.4 15.1A9 9 0 0 1 8.9 3.6 9 9 0 1 0 20.4 15.1Z';

function NavItem({ href, active, icon, label, expanded }) {
  return (
    <a
      href={href}
      title={label}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition
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

export default function Layout({ page, title, subtitle, children, actions, wide = false }) {
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

  const nav = (
    <>
      <NavItem href="/viewer.html" active={page === 'viewer'} icon={ICON_GRAPH} label="Peta Jaringan" expanded={expanded} />
      <NavItem href="/sentimen.html" active={page === 'sentimen'} icon={ICON_CHART} label="Analisis Sentimen" expanded={expanded} />
    </>
  );

  return (
    <div className="min-h-screen lg:flex">
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />
      )}
      <aside
        className={`fixed z-50 flex h-screen flex-col border-r border-slate-200 bg-white p-4 transition-all duration-200
          dark:border-gray-700/60 dark:bg-gray-800 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0
          ${open ? 'translate-x-0 w-64' : '-translate-x-full w-64'} lg:w-20 ${expanded ? 'lg:w-64' : ''}`}
      >
        <div className="mb-8 flex items-center justify-between px-1">
          <a href="/viewer.html" className="flex items-center gap-2 text-brand-600">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">SNA</span>
            <span className={`text-sm font-bold tracking-tight text-slate-800 dark:text-white ${expanded ? '' : 'lg:hidden'}`}>
              Threads SNA
            </span>
          </a>
          <button className="lg:hidden text-slate-500" onClick={() => setOpen(false)} aria-label="Tutup menu">
            <Icon d={ICON_CLOSE} className="w-5 h-5" />
          </button>
        </div>
        <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${expanded ? '' : 'lg:hidden'}`}>
          Menu
        </p>
        <nav className="space-y-1">{nav}</nav>
        <div className="mt-auto space-y-1">
          <button
            onClick={() => setDark(!dark)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-gray-700/60"
            title={dark ? 'Mode terang' : 'Mode gelap'}
          >
            <Icon d={dark ? ICON_SUN : ICON_MOON} />
            <span className={expanded ? '' : 'lg:hidden'}>{dark ? 'Mode terang' : 'Mode gelap'}</span>
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 lg:flex dark:hover:bg-gray-700/60"
            title="Perlebar menu"
          >
            <Icon d={ICON_MENU} />
            <span className={expanded ? '' : 'lg:hidden'}>Perlebar</span>
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-gray-700/60 dark:bg-gray-900/90 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Buka menu">
              <Icon d={ICON_MENU} className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-800 dark:text-white">{title}</h1>
              {subtitle && <p className="truncate text-xs text-slate-500 dark:text-gray-400">{subtitle}</p>}
            </div>
            {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </header>
        <main className={`mx-auto ${wide ? 'max-w-[1800px]' : 'max-w-[1500px]'} p-4 sm:p-6`}>{children}</main>
        <footer className="px-4 pb-6 text-[11px] text-slate-400 sm:px-6">
          Label LLM adalah bantuan triase, bukan bukti. Selalu verifikasi manual. ·
          Terinspirasi <a className="underline" href="https://github.com/cruip/tailwind-dashboard-template" target="_blank" rel="noreferrer">Mosaic Lite</a> (GPL-3.0).
        </footer>
      </div>
    </div>
  );
}
