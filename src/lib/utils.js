export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export async function getJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

let apiToken = null;

async function loadToken(force = false) {
  if (apiToken && !force) return apiToken;
  try {
    const r = await fetch('/api/session', { cache: 'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    apiToken = data?.token || null;
  } catch {
    apiToken = null;
  }
  return apiToken;
}

export async function api(path, options = {}) {
  const opts = { ...options };
  const method = String(opts.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    const token = await loadToken();
    if (token) opts.headers = { ...(opts.headers || {}), 'X-SNA-Token': token };
  }
  try {
    let r = await fetch(path, opts);
    if (r.status === 401 && method !== 'GET') {
      const token = await loadToken(true);
      if (token) {
        opts.headers = { ...(opts.headers || {}), 'X-SNA-Token': token };
        r = await fetch(path, opts);
      }
    }
    let data = null;
    try { data = await r.json(); } catch { /* bukan JSON */ }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function download(filename, content, type = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob(['\ufeff' + content], { type }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function highlight(text, keywords = []) {
  let out = esc(text);
  const kws = [...new Set(keywords.filter((k) => String(k).length >= 3))]
    .sort((a, b) => String(b).length - String(a).length).slice(0, 30);
  kws.forEach((k) => {
    const safe = String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?![^<]>)(${safe})`, 'gi'), '<mark>$1</mark>');
  });
  return out;
}

export function formatDate(v) {
  if (!v) return 'tanpa waktu';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('id-ID');
}
