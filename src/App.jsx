import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from './components/Layout.jsx';
import SummaryView from './pages/SummaryPage.jsx';
import ViewerView from './pages/ViewerPage.jsx';
import SentimentView from './pages/SentimentPage.jsx';
import ScrapeView from './pages/ScrapePage.jsx';
import { currentProject } from './lib/project.js';

export const TABS = {
  ringkasan: { id: 'ringkasan', label: 'Ringkasan', path: '/' },
  jaringan: { id: 'jaringan', label: 'Peta Jaringan', path: '/viewer.html' },
  sentimen: { id: 'sentimen', label: 'Sentimen', path: '/sentimen.html' },
  sumber: { id: 'sumber', label: 'Sumber & Proyek', path: '/scrape.html' },
};

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
  const [tab, setTabState] = useState(tabFromLocation);
  const [project, setProject] = useState(() => currentProject());

  useEffect(() => {
    const sync = () => { setTabState(tabFromLocation()); setProject(currentProject()); };
    globalThis.addEventListener('popstate', sync);
    return () => globalThis.removeEventListener('popstate', sync);
  }, []);

  const setTab = useCallback((next) => {
    const t = TABS[next] ? next : 'ringkasan';
    setTabState(t);
    try {
      const u = new URL(globalThis.location.href);
      u.pathname = TABS[t].path;
      // jaga ?project, buang ?tab; biarkan focus dll untuk jaringan agar ViewerView bisa baca
      if (t !== 'jaringan') u.searchParams.delete('focus');
      u.searchParams.delete('tab');
      u.hash = '';
      globalThis.history.pushState({ tab: t }, '', u.pathname + u.search);
    } catch { /* ignore */ }
  }, []);

  const tabInfo = TABS[tab] || TABS.ringkasan;

  return (
    <Layout
      tab={tab}
      tabLabel={tabInfo.label}
      project={project}
      onTab={setTab}
      onProjectChange={(slug) => setProject(slug)}
    >
      {tab === 'ringkasan' && <SummaryView embedded project={project} onTab={setTab} />}
      {tab === 'jaringan' && <ViewerView embedded project={project} onTab={setTab} />}
      {tab === 'sentimen' && <SentimentView embedded project={project} onTab={setTab} />}
      {tab === 'sumber' && <ScrapeView embedded project={project} onTab={setTab} onProjectChange={setProject} />}
    </Layout>
  );
}
