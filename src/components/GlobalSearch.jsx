import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getJson } from '../lib/utils.js';
import { currentProject, projectFile, withProject } from '../lib/project.js';

const MAX_PER_GROUP = 5;

function useData() {
  const [posts, setPosts] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (posts || loading) return;
    setLoading(true);
    const d = await getJson(projectFile('data.json', currentProject()));
    const list = Array.isArray(d) ? d : (Array.isArray(d?.posts) ? d.posts : []);
    setPosts(list);
    setLoading(false);
  };
  return { posts, loading, load };
}

export default function GlobalSearch() {
  const { posts, loading, load } = useData();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term || !posts) return { accounts: [], posts: [] };
    const accounts = new Map();
    posts.forEach((p) => {
      const add = (id) => {
        const name = String(id || '').trim();
        if (!name) return;
        const prev = accounts.get(name) || { id: name, posts: 0, replies: 0 };
        accounts.set(name, prev);
      };
      add(p.author);
      (p.replies || []).forEach((r) => add(r.author));
      (p.thread || []).forEach((r) => add(r.author || p.author));
    });
    const acc = [...accounts.values()]
      .filter((a) => a.id.toLowerCase().includes(term))
      .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id))
      .slice(0, MAX_PER_GROUP);
    const ps = posts
      .filter((p) => `${p.author || ''} ${p.text || ''}`.toLowerCase().includes(term))
      .slice(0, MAX_PER_GROUP)
      .map((p) => ({
        code: p.code,
        author: p.author,
        text: String(p.text || '').replace(/\s+/g, ' ').slice(0, 90),
        replies: (p.replies || []).length,
      }));
    return { accounts: acc, posts: ps };
  }, [q, posts]);

  const flat = useMemo(
    () => [
      ...results.accounts.map((a) => ({ kind: 'akun', key: a.id, label: `@${a.id}` })),
      ...results.posts.map((p) => ({ kind: 'post', key: p.code, label: `@${p.author}` })),
    ],
    [results],
  );

  const go = (item) => {
    if (!item) return;
    const focus = item.kind === 'akun' ? item.key : item.label.replace(/^@/, '');
    globalThis.location.href = withProject(`/viewer.html?focus=${encodeURIComponent(focus)}`);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open || !flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % flat.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + flat.length) % flat.length); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
  };

  const hasResults = results.accounts.length > 0 || results.posts.length > 0;

  return (
    <div ref={boxRef} className="relative w-full min-w-0 max-w-md">
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M10 4a6 6 0 1 0 3.5 10.9l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={q}
          onFocus={() => { load(); setOpen(true); }}
          onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Cari akun atau postingan…"
          aria-label="Pencarian global"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:bg-gray-800 dark:focus:ring-brand-900"
        />
      </div>

      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {loading && <div className="px-3 py-3 text-xs text-slate-500 dark:text-gray-400">Memuat data proyek…</div>}
          {!loading && !hasResults && (
            <div className="px-3 py-3 text-xs text-slate-500 dark:text-gray-400">Tidak ada hasil untuk “{q.trim()}”.</div>
          )}
          {results.accounts.length > 0 && (
            <div className="border-b border-slate-100 py-1.5 dark:border-gray-700/60">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Akun</p>
              {results.accounts.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go({ kind: 'akun', key: a.id })}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${active === i ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-700 dark:text-gray-200'}`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                    {a.id.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">@{a.id}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-slate-400">buka di peta</span>
                </button>
              ))}
            </div>
          )}
          {results.posts.length > 0 && (
            <div className="py-1.5">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Postingan</p>
              {results.posts.map((p, i) => {
                const idx = results.accounts.length + i;
                return (
                  <button
                    key={p.code}
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go({ kind: 'post', label: `@${p.author}` })}
                    className={`block w-full px-3 py-1.5 text-left ${active === idx ? 'bg-brand-50 dark:bg-brand-500/15' : ''}`}
                  >
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-gray-200">@{p.author}</span>
                    <span className="ml-2 text-[10px] text-slate-400">{p.replies} komentar</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-gray-400">{p.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
