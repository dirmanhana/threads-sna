/* Helpers murni untuk halaman viewer (non-React). Diadaptasi dari viewer.html. */
import { esc } from './utils.js';

export { esc };

export const BASE_URL = 'https://www.threads.com';

export const SAMPLE = { posts: [
  { code: 'A1', author: 'dirman', text: 'Kenapa UMKM susah naik kelas? Menurutku soal pencatatan.', timestamp: '2026-10-01', likes: 12,
    thread: [
      { code: 'A1-1', author: 'dirman', text: 'Lanjut: catat arus kas tiap hari' },
      { code: 'A1-2', author: 'dirman', text: 'Lanjut: pakai aplikasi sederhana' },
    ],
    replies: [
      { author: 'sari_toko', text: 'Setuju kak, saya masih catat di buku', timestamp: '2026-10-02' },
      { author: 'budi.dev', text: 'Bisa pakai bot WA @dirman', timestamp: '2026-10-02' },
      { author: 'rina_k', text: '@sari_toko coba deh', timestamp: '2026-10-03' },
    ] },
  { code: 'A2', author: 'sari_toko', text: 'Baru buka toko online, doakan ya', timestamp: '2026-10-04', likes: 5,
    replies: [
      { author: 'dirman', text: 'Sukses kak!' },
      { author: 'rina_k', text: 'Semangat' },
      { author: 'budi.dev', text: 'Mantap' },
    ] },
  { code: 'A3', author: 'budi.dev', text: 'Rust vs Go untuk backend kecil?',
    replies: [
      { author: 'dirman', text: 'Go lebih cepat dipelajari' },
      { author: 'andi99', text: 'Rust kalau mau performa' },
    ] },
] };

export const eid = (v) => (v && typeof v === 'object' ? String(v.id == null ? '' : v.id) : String(v == null ? '' : v));
export const fmt = (v) => Number(v || 0).toFixed(3);
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const csv = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
export const xe = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const safeUrl = (u) => {
  try {
    const x = new URL(String(u || ''), globalThis.location?.href || BASE_URL);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch { return null; }
};
export const postUrl = (p) => (p
  ? (safeUrl(p.url) || (p.author && p.code
    ? `${BASE_URL}/@${encodeURIComponent(p.author)}/post/${encodeURIComponent(p.code)}` : null))
  : null);
export const itemUrl = (it, p) => (it && it.author && it.code
  ? `${BASE_URL}/@${encodeURIComponent(it.author)}/post/${encodeURIComponent(it.code)}`
  : postUrl(p));

export function authorUrl(posts, id) {
  const own = posts.find((p) => p.author === id && postUrl(p));
  if (own) return postUrl(own);
  for (const p of posts) {
    for (const r of [...(p.replies || []), ...(p.thread || [])]) {
      if (r.author === id) { const u = itemUrl(r, p); if (u) return u; }
    }
  }
  return `${BASE_URL}/@${encodeURIComponent(id || '')}`;
}

export function linkUser(id, label, url) {
  const href = safeUrl(url) || `${BASE_URL}/@${encodeURIComponent(id || '')}`;
  return `<a class="ul" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Buka di Threads">${esc(label == null ? `@${id}` : label)}</a>`;
}
export const userLink = (posts, id) => linkUser(id, `@${id}`, authorUrl(posts, id));

/* Sorot kata kunci pada teks yang sudah di-escape. */
export function hl(escaped, keyword) {
  const k = String(keyword || '').trim();
  if (!k) return escaped;
  const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return escaped.replace(re, (m) => `<mark>${m}</mark>`);
}

/* Label waktu untuk bucket timeline. */
export function tlLabel(t, step, short) {
  const d = new Date(t);
  if (step === 86400000) {
    return d.toLocaleDateString('id-ID', Object.assign({ day: '2-digit', month: 'short', timeZone: 'UTC' }, short ? {} : { year: 'numeric' }));
  }
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return short ? jam : `${d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' })} ${jam} UTC`;
}
export const replayDate = (t) => (t
  ? new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

/* Bangun daftar peristiwa time-lapse dari seluruh postingan. */
export function buildEvents(SNA, all) {
  const ev = [];
  const dates = [];
  all.forEach((p) => {
    const t = SNA.parseDate(p.timestamp); if (t != null) dates.push(t);
    [...(p.thread || []), ...(p.replies || [])].forEach((it) => {
      const d = SNA.parseDate(it.timestamp); if (d != null) dates.push(d);
    });
  });
  const globalBase = dates.length ? Math.min(...dates) : Date.UTC(2026, 0, 1);
  all.forEach((p, pi) => {
    const pid = p.code || `post-${pi}`;
    const pt = SNA.parseDate(p.timestamp);
    const items = [
      ...(p.thread || []).map((x) => ({ ...x, _kind: 'thread' })),
      ...(p.replies || []).map((x) => ({ ...x, _kind: 'komentar' })),
    ];
    const known = items.map((x) => SNA.parseDate(x.timestamp)).filter((x) => x != null);
    const base = pt || (known.length ? Math.min(...known) : globalBase + pi * 86400000);
    ev.push({ t: pt || base, order: pi * 100000, pid, post: p, author: p.author, kind: 'post', date: pt });
    items.forEach((it, ii) => {
      const date = SNA.parseDate(it.timestamp);
      ev.push({ t: date || base + (ii + 1) * 60000, order: pi * 100000 + ii + 1, pid, post: p,
        author: it.author, kind: it._kind, date, item: it });
    });
  });
  ev.sort((a, b) => a.t - b.t || a.order - b.order);
  return ev;
}

/* Rekonstruksi postingan dari N peristiwa pertama. */
export function postsUntil(events, n) {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const e = events[i];
    let q = m.get(e.pid);
    if (!q) { q = { ...e.post, thread: [], replies: [] }; m.set(e.pid, q); }
    if (e.kind === 'thread') q.thread.push(e.item);
    else if (e.kind === 'komentar') q.replies.push(e.item);
  }
  return [...m.values()];
}
