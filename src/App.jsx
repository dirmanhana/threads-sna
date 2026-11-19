import React from 'react';
import SentimentPage from './pages/SentimentPage.jsx';
import ViewerPage from './pages/ViewerPage.jsx';

export default function App() {
  const path = globalThis.location.pathname || '';
  return /sentimen/i.test(path) ? <SentimentPage /> : <ViewerPage />;
}
