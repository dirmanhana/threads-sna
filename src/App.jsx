import React from 'react';
import SentimentPage from './pages/SentimentPage.jsx';
import ScrapePage from './pages/ScrapePage.jsx';
import SummaryPage from './pages/SummaryPage.jsx';
import ViewerPage from './pages/ViewerPage.jsx';

export default function App() {
  const path = globalThis.location.pathname || '';
  if (/sentimen/i.test(path)) return <SentimentPage />;
  if (/scrape|pengumpulan/i.test(path)) return <ScrapePage />;
  if (/viewer|peta/i.test(path)) return <ViewerPage />;
  return <SummaryPage />;
}
