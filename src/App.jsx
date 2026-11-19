import React from 'react';
import SentimentPage from './pages/SentimentPage.jsx';
import ScrapePage from './pages/ScrapePage.jsx';
import ViewerPage from './pages/ViewerPage.jsx';

export default function App() {
  const path = globalThis.location.pathname || '';
  if (/sentimen/i.test(path)) return <SentimentPage />;
  if (/scrape|pengumpulan/i.test(path)) return <ScrapePage />;
  return <ViewerPage />;
}
