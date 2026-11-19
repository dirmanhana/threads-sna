import React, { useEffect, useMemo, useState } from 'react';
import { authorUrl, esc, fmt, hl, itemUrl, linkUser, postUrl, replayDate, tlLabel } from '../lib/viewerLib.js';

const H4 = ({ children }) => <h4 className="mb-1.5 mt-4 text-[13px] font-semibold text-slate-800 dark:text-slate-100">{children}</h4>;

const Tag = ({ children }) => (
  <div className="text-[11px] text-slate-600 dark:text-slate-400">{children}</div>
);

const Btn = ({ children, onClick, active }) => (
  <button onClick={onClick}
    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${active
      ? 'border-brand-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
    {children}
  </button>
);

const Empty = ({ children }) => (
  <p className="py-6 text-center text-[11px] text-slate-600 dark:text-slate-400">{children}</p>
);

function UserLink({ id, posts, url }) {
  const href = url || authorUrl(posts, id);
  return <span dangerouslySetInnerHTML={{ __html: linkUser(id, `@${id}`, href) }} />;
}

function Rich({ text, keyword, className = '' }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: hl(esc(text), keyword) }} />;
}

/* Urutkan komentar mengikuti pohon balasan; data lama tanpa kode tetap apa adanya. */
function orderReplies(replies) {
  const list = (replies || []).filter(Boolean);
  if (!list.some((r) => r.code)) return list;
  const byCode = new Map(list.filter((r) => r.code).map((r) => [r.code, r]));
  const children = new Map();
  const roots = [];
  list.forEach((r) => {
    const parent = r.parent_code;
    if (parent && parent !== r.code && byCode.has(parent)) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(r);
    } else {
      roots.push(r);
    }
  });
  const out = [];
  const seen = new Set();
  const walk = (r) => {
    if (!r || seen.has(r)) return;
    seen.add(r);
    out.push(r);
    (children.get(r.code) || []).forEach(walk);
  };
  roots.forEach(walk);
  list.forEach(walk);          // jaring pengaman untuk siklus/orphan
  return out;
}

function replyDepth(r) {
  const n = Number(r && r.depth);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/* ---------- kartu postingan (ringkas, bisa dibuka) ---------- */
function PostCard({ p, only, posts, keyword }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(10);
  const thread = (p.thread || []).filter((t) => !only || t.author === only);
  const replies = (p.replies || []).filter((r) => !only || r.author === only);
  const ordered = orderReplies(replies);
  const total = thread.length + replies.length;

  return (
    <article className="mb-2 rounded-xl border border-slate-200 bg-slate-50 text-xs dark:border-slate-800 dark:bg-slate-900/60">
      <div className="p-2.5">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            <UserLink id={p.author} posts={posts} url={postUrl(p)} />
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {only ? `(dikomentari @${only})` : 'memposting'}
          </span>
          {p.timestamp && <span className="text-[11px] text-slate-500 dark:text-slate-400">🗓 {p.timestamp}</span>}
          {Number.isFinite(p.likes) && <span className="text-[11px] text-slate-500 dark:text-slate-400">♥ {p.likes}</span>}
        </div>
        <div className={`my-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200 ${open ? '' : 'line-clamp-6'}`}>
          <Rich text={p.text} keyword={keyword} />
        </div>
        {total > 0 && (
          <button
            className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-300"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? 'Sembunyikan diskusi' : `Lihat ${thread.length} thread · ${replies.length} komentar`}
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-slate-200 px-2.5 py-2 dark:border-slate-800">
          {thread.map((t, i) => (
            <div key={`t-${i}`} className="my-1.5 border-l-[3px] border-emerald-500 pl-2 text-[12px] text-slate-600 dark:text-slate-400">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">thread</span>{' '}
              <b className="text-slate-800 dark:text-slate-100">
                <UserLink id={t.author} posts={posts} url={itemUrl(t, p)} />
              </b>:{' '}
              <Rich text={t.text} keyword={keyword} />
              {t.timestamp && <span className="text-[11px] text-slate-500 dark:text-slate-400"> {t.timestamp}</span>}
            </div>
          ))}
          {ordered.slice(0, limit).map((r, i) => {
            const depth = replyDepth(r);
            const indent = Math.min(depth - 1, 4) * 12;
            return (
              <div key={`r-${r.code || i}`}
                style={indent ? { marginLeft: `${indent}px` } : undefined}
                className={`my-1.5 border-l-[3px] pl-2 text-[12px] text-slate-600 dark:text-slate-400 ${depth > 1 ? 'border-slate-400 dark:border-gray-500' : 'border-brand-500'}`}>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{depth > 1 ? 'balasan' : 'komentar'}</span>{' '}
                {depth > 1 && r.reply_to_author && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">↳ @{r.reply_to_author} · </span>
                )}
                <b className="text-slate-800 dark:text-slate-100">
                  <UserLink id={r.author} posts={posts} url={itemUrl(r, p)} />
                </b>:{' '}
                <Rich text={r.text} keyword={keyword} />
                {r.timestamp && <span className="text-[11px] text-slate-500 dark:text-slate-400"> {r.timestamp}</span>}
                {r.timestamp_source === 'estimated' && (
                  <span className="text-[11px] italic text-slate-500 dark:text-slate-400"> (perkiraan)</span>
                )}
              </div>
            );
          })}
          {ordered.length > limit && (
            <button
              className="mt-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-300"
              onClick={() => setLimit((l) => l + 20)}
            >
              Muat {Math.min(20, ordered.length - limit)} komentar lagi
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* ---------- blok metrik ---------- */
function MetricTable({ metrics, posts }) {
  const m = metrics || { degree: new Map(), betweenness: new Map(), closeness: new Map(), eigenvector: new Map() };
  const defs = [['degree', m.degree, false], ['betweenness', m.betweenness, true],
    ['closeness', m.closeness, true], ['eigenvector', m.eigenvector, true]];
  return (
    <>
      <H4>Metrik jaringan</H4>
      <table className="w-full table-fixed border-collapse text-[11px]">
        <thead><tr><th className="border border-slate-200 p-1 text-left dark:border-slate-800">Metrik</th>
          {[1, 2, 3, 4, 5].map((i) => <th key={i} className="border border-slate-200 p-1 text-center dark:border-slate-800">{i}</th>)}</tr></thead>
        <tbody>
          {defs.map(([name, map, f3]) => {
            const top = [...(map?.entries() || [])].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 5);
            return (
              <tr key={name}>
                <th className="border border-slate-200 p-1 text-left dark:border-slate-800">{name}</th>
                {Array.from({ length: 5 }, (_, i) => (
                  <td key={i} className="border border-slate-200 p-1 align-top break-words dark:border-slate-800">
                    {top[i] ? (
                      <>
                        <UserLink id={top[i][0]} posts={posts} />{' '}
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">{f3 ? fmt(top[i][1]) : top[i][1]}</span>
                      </>
                    ) : '-'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function ActorTop({ graph, posts }) {
  const top = [...(graph?.nodes || [])].sort((a, b) => b.deg - a.deg || String(a.id).localeCompare(String(b.id))).slice(0, 5);
  return (
    <>
      <H4>Aktor teratas</H4>
      {top.length ? top.map((n) => (
        <Tag key={n.id}>
          <UserLink id={n.id} posts={posts} /> · {n.deg} relasi · {n.posts} post · {n.replies} komentar · {n.threadCount} thread
        </Tag>
      )) : <Tag>-</Tag>}
    </>
  );
}

function CommunityBlock({ SNA, metrics }) {
  const sizes = SNA.communitySizes(metrics?.communities);
  const top = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return (
    <>
      <H4>Komunitas</H4>
      <Tag>{sizes.size} komunitas</Tag>
      {top.slice(0, 5).map(([k, v]) => <Tag key={k}>Komunitas {k}: {v} akun</Tag>)}
    </>
  );
}

/* ---------- isi tab ---------- */
function MetricsTab({ SNA, posts, graph, metrics, anomaly, onAnomalyPanel }) {
  const c = anomaly?.cib || { clusters: [] };
  const t = anomaly?.temporal || { bursts: [] };
  const hi = (anomaly?.scores || []).filter((x) => x.score >= 70).length;
  return (
    <div>
      <MetricTable metrics={metrics} posts={posts} />
      <ActorTop graph={graph} posts={posts} />
      <CommunityBlock SNA={SNA} metrics={metrics} />
      <H4>Anomali &amp; buzzer</H4>
      <Tag>{c.clusters.length} klaster CIB · {t.bursts.length} lonjakan · {hi} akun risiko tinggi</Tag>
      <div className="my-2"><Btn onClick={onAnomalyPanel}>Buka tab anomali</Btn></div>
    </div>
  );
}

function PostsTab({ posts, keyword, q, setQ, limit, setLimit }) {
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return posts;
    const has = (t) => String(t == null ? '' : t).toLowerCase().includes(term);
    return posts.filter((p) =>
      has(p.author) || has(p.text) ||
      (p.replies || []).some((r) => has(r.author) || has(r.text)) ||
      (p.thread || []).some((r) => has(r.author) || has(r.text)));
  }, [posts, q]);
  const shown = filtered.slice(0, limit);
  return (
    <div>
      <input
        className="field mb-2 w-full" type="search" value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari akun atau teks di postingan…"
        aria-label="Cari di postingan"
      />
      {!filtered.length && <Empty>Tidak ada postingan yang cocok.</Empty>}
      {shown.map((p) => <PostCard key={p.code} p={p} posts={posts} keyword={keyword} />)}
      {filtered.length > limit && (
        <button className="btn w-full" onClick={() => setLimit((l) => l + 10)}>
          Muat 10 lagi ({filtered.length - limit} tersisa)
        </button>
      )}
    </div>
  );
}

function CommentsTab({ SNA, posts, keyword, q, setQ, limit, setLimit }) {
  const all = useMemo(() => {
    const out = [];
    posts.forEach((p) => {
      (p.replies || []).forEach((r) => out.push({
        ...r, postCode: p.code, postAuthor: p.author, postUrl: postUrl(p),
      }));
    });
    return out.sort((a, b) => (SNA.parseDate(b.timestamp) || 0) - (SNA.parseDate(a.timestamp) || 0));
  }, [posts, SNA]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return all;
    const has = (t) => String(t == null ? '' : t).toLowerCase().includes(term);
    return all.filter((c) => has(c.author) || has(c.text) || has(c.postAuthor));
  }, [all, q]);
  const shown = filtered.slice(0, limit);
  return (
    <div>
      <input
        className="field mb-2 w-full" type="search" value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari akun atau teks komentar…"
        aria-label="Cari di komentar"
      />
      {!filtered.length && <Empty>Tidak ada komentar yang cocok.</Empty>}
      {shown.map((c, i) => (
        <article key={`${c.postCode}-${i}`} className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <b className="text-slate-800 dark:text-slate-100"><UserLink id={c.author} posts={posts} url={itemUrl(c, { code: c.postCode, author: c.postAuthor })} /></b>
            {replyDepth(c) > 1 && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                balasan{c.reply_to_author ? ` ↳ @${c.reply_to_author}` : ''}
              </span>
            )}
            <span className="text-[11px] text-slate-500 dark:text-slate-400">di <UserLink id={c.postAuthor} posts={posts} url={c.postUrl} /></span>
            {c.timestamp && <span className="text-[11px] text-slate-500 dark:text-slate-400">· {c.timestamp}</span>}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
            <Rich text={c.text} keyword={keyword} />
          </div>
        </article>
      ))}
      {filtered.length > limit && (
        <button className="btn w-full" onClick={() => setLimit((l) => l + 20)}>
          Muat 20 lagi ({filtered.length - limit} tersisa)
        </button>
      )}
    </div>
  );
}

function AnomalyBody({ posts, keyword, anomaly, anonOpts, onRefreshAnomaly, onAnonWin, onAnonMin, onBucket, onFocus }) {
  const c = anomaly?.cib || { clusters: [] };
  const t = anomaly?.temporal || { bursts: [], granularity: '-' };
  const s = anomaly?.scores || [];
  const hi = s.filter((x) => x.score >= 70).length;
  const mid = s.filter((x) => x.score >= 40 && x.score < 70).length;
  const win = Math.round(anonOpts.windowMs / 60000);
  return (
    <div>
      <Tag>{c.clusters.length} klaster CIB · {t.bursts.length} lonjakan · {hi} akun risiko tinggi · {mid} sedang</Tag>
      <p className="my-1.5 text-[11px] italic text-slate-500 dark:text-slate-400">Heuristik untuk triase, bukan bukti. Selalu verifikasi manual.</p>
      <div className="my-2 flex flex-wrap gap-1.5">
        <Btn onClick={onRefreshAnomaly}>Hitung ulang</Btn>
      </div>
      <div className="text-[11px] text-slate-600 dark:text-slate-400">
        CIB: jendela{' '}
        <select className="field !py-0.5" value={win} onChange={(e) => onAnonWin?.(Number(e.target.value))}>
          {[5, 10, 30].map((v) => <option key={v} value={v}>{v} mnt</option>)}
        </select>
        {' '}· min akun{' '}
        <select className="field !py-0.5" value={anonOpts.minAccounts} onChange={(e) => onAnonMin?.(Number(e.target.value))}>
          {[2, 3, 5].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <H4>Lonjakan volume</H4>
      {t.bursts.length ? t.bursts.slice(0, 8).map((b) => (
        <Tag key={b.t}>
          <button className="text-blue-600 hover:underline dark:text-blue-300" onClick={() => onBucket?.(b.t)}>{esc(tlLabel(b.t, t.stepMs))}</button>
          {' · '}{b.count} komentar ({b.threshold} ambang{b.ratio ? ` · ${b.ratio}× median` : ''})
        </Tag>
      )) : <Tag>Tidak ada lonjakan signifikan.</Tag>}
      <H4>Pola komentar identik / mirip (CIB)</H4>
      {c.clusters.length ? c.clusters.slice(0, 6).map((k, i) => (
        <div key={i} className="my-1.5 rounded-xl border-l-[3px] border-orange-500 bg-slate-50 p-2.5 dark:bg-slate-900/60">
          <Tag>Klaster {i + 1} · {k.windowCount} komentar dalam jendela · {k.authors.length} akun · keyakinan {Math.round(k.confidence * 100)}%{k.resolution === 'date' ? ' · hanya tanggal' : ''}</Tag>
          <div className="my-1 whitespace-pre-wrap break-words text-xs text-slate-700 dark:text-slate-200">
            <Rich text={k.text} keyword={keyword} />
          </div>
          <Tag>{k.windowAuthors.map((id) => <span key={id}><UserLink id={id} posts={posts} /> </span>)}</Tag>
        </div>
      )) : <Tag>Tidak ada pola copy-paste terdeteksi.</Tag>}
      <H4>Skor buzzer (heuristik)</H4>
      {s.some((x) => x.score > 0) ? s.filter((x) => x.score > 0).slice(0, 15).map((x) => (
        <div key={x.id} className="mb-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
          <span className={`mr-1.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white ${x.level === 'tinggi' ? 'bg-red-800' : x.level === 'sedang' ? 'bg-amber-700' : 'bg-slate-500'}`}>{x.score}</span>
          <UserLink id={x.id} posts={posts} />
          <Tag>{x.reasons.join(' · ') || 'tidak ada indikator'}</Tag>
          <div className="mt-1"><Btn onClick={() => onFocus?.(x.id)}>Sorot di graf</Btn></div>
        </div>
      )) : <Tag>Tidak ada indikator mencurigakan.</Tag>}
    </div>
  );
}

function BucketBody({ SNA, posts, keyword, selectedBucket, anomaly, onAnomalyPanel }) {
  const step = anomaly?.temporal?.stepMs || 86400000;
  const evs = SNA.bucketEvents(posts, selectedBucket, { stepMs: step });
  const burst = (anomaly?.temporal?.bursts || []).find((b) => b.t === selectedBucket);
  const by = new Map();
  evs.forEach((e) => by.set(e.author, (by.get(e.author) || 0) + 1));
  const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  return (
    <div>
      <Tag>{evs.length} komentar{burst ? ` · LONJAKAN (${burst.count} vs ambang ${burst.threshold})` : ''}</Tag>
      <div className="my-2"><Btn onClick={onAnomalyPanel}>Kembali ke anomali</Btn></div>
      {!!top.length && <><H4>Akun paling aktif</H4>{top.map(([id, n]) => (
        <Tag key={id}><UserLink id={id} posts={posts} /> · {n} komentar</Tag>
      ))}</>}
      <H4>Contoh komentar</H4>
      {evs.slice(0, 8).map((e, i) => (
        <div key={i} className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="whitespace-pre-wrap break-words text-xs text-slate-700 dark:text-slate-200">
            <Rich text={e.text} keyword={keyword} />
          </div>
          <Tag><UserLink id={e.author} posts={posts} /> · {esc(e.post || '-')}</Tag>
        </div>
      ))}
    </div>
  );
}

function ReplayBody({ replay, graph, posts, onReplayBack }) {
  const ev = replay.events[replay.i - 1];
  const recent = replay.events.slice(Math.max(0, replay.i - 5), replay.i).reverse();
  return (
    <div>
      <Tag>{replay.i} dari {replay.events.length} peristiwa · {ev
        ? `terakhir: ${replayDate(ev.t)} · @${esc(ev.author)} (${esc(ev.kind)})`
        : 'belum dimulai'}</Tag>
      <div className="my-2"><Btn onClick={onReplayBack}>Kembali ke akhir</Btn></div>
      <ActorTop graph={graph} posts={posts} />
      <H4>Peristiwa terbaru</H4>
      {recent.map((e, i) => <Tag key={i}>{replayDate(e.t)} · @{esc(e.author)} · {esc(e.kind)}</Tag>)}
    </div>
  );
}

function UserBody({ u, posts, metrics, keyword, isolate, onFocus, onUnfocus, onToggleIsolate, onOpenThreads }) {
  const [limit, setLimit] = useState(10);
  const mine = posts.filter((p) => p.author === u);
  const other = posts.filter((p) => p.author !== u &&
    ((p.replies || []).some((r) => r.author === u) || (p.thread || []).some((t) => t.author === u)));
  const m = metrics || { degree: new Map(), betweenness: new Map(), closeness: new Map(), eigenvector: new Map(), communities: new Map() };
  const c = m.communities.get(u);
  return (
    <div>
      <Tag>Derajat {m.degree.get(u) || 0} · komunitas {c == null ? '-' : c} · betweenness {fmt(m.betweenness.get(u))} · closeness {fmt(m.closeness.get(u))} · eigenvector {fmt(m.eigenvector.get(u))}</Tag>
      <div className="my-2 flex flex-wrap gap-1.5">
        <Btn onClick={() => onFocus?.(u)}>Fokus</Btn>
        <Btn onClick={onUnfocus}>Lepaskan fokus</Btn>
        <Btn onClick={onToggleIsolate} active={isolate}>{isolate ? 'Tampilkan semua' : 'Isolasi'}</Btn>
        <Btn onClick={onOpenThreads}>Buka di Threads ↗</Btn>
      </div>
      {!!mine.length && (
        <>
          <H4>Postingan ({mine.length})</H4>
          {mine.slice(0, limit).map((p) => <PostCard key={p.code} p={p} posts={posts} keyword={keyword} />)}
        </>
      )}
      {!!other.length && (
        <>
          <H4>Dikomentari ({other.length})</H4>
          {other.slice(0, limit).map((p) => <PostCard key={p.code} p={p} only={u} posts={posts} keyword={keyword} />)}
        </>
      )}
      {(mine.length + other.length) > limit && (
        <button className="btn w-full" onClick={() => setLimit((l) => l + 10)}>
          Muat 10 postingan lagi
        </button>
      )}
    </div>
  );
}

function LinkBody({ l, posts, keyword }) {
  const [limit, setLimit] = useState(20);
  const items = l.items?.length ? l.items : [{}];
  return (
    <div>
      <Tag>{esc(l.type)} · {l.w || 0}× · {items.length} contoh</Tag>
      {items.slice(0, limit).map((it, i) => (
        <div key={i} className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/60">
          <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
            <Rich text={it.text} keyword={keyword} />
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            <UserLink id={it.author} posts={posts} url={itemUrl(it, { code: it.postCode, author: it.author })} />
            {' · '}{esc(it.postCode)}{it.timestamp ? ` · ${esc(it.timestamp)}` : ''}
          </div>
        </div>
      ))}
      {items.length > limit && (
        <button className="btn w-full" onClick={() => setLimit((l2) => l2 + 20)}>
          Muat 20 contoh lagi ({items.length - limit} tersisa)
        </button>
      )}
    </div>
  );
}

/* ---------- panel utama ---------- */
export default function InfoPanel(props) {
  const {
    SNA, mode, posts, graph, metrics, anomaly, anonOpts, replay, keyword, selectedBucket,
    focus, isolate, panelUser, linkDetail, tab, onTab,
    onFocus, onUnfocus, onToggleIsolate, onOpenThreads, onAnomalyPanel, onClosePanel,
    onBucket, onReplayBack, onRefreshAnomaly, onAnonWin, onAnonMin,
  } = props;

  const [q, setQ] = useState('');
  const [postLimit, setPostLimit] = useState(10);
  const [commentLimit, setCommentLimit] = useState(20);

  const commentTotal = useMemo(
    () => posts.reduce((a, p) => a + (p.replies?.length || 0), 0),
    [posts],
  );
  const hiRisk = (anomaly?.scores || []).filter((x) => x.score >= 70).length;

  useEffect(() => { setPostLimit(10); }, [q, posts]);
  useEffect(() => { setCommentLimit(20); }, [q, posts]);

  const detail = mode === 'user' || mode === 'link' || mode === 'bucket' || mode === 'replay';
  const activeTab = tab;

  const title = mode === 'user' && panelUser ? `@${panelUser}`
    : mode === 'link' ? 'Detail relasi'
      : mode === 'bucket' ? 'Rentang waktu'
        : mode === 'replay' ? 'Time-lapse jaringan'
          : 'Panel informasi';

  const tabs = [
    { id: 'metrik', label: 'Metrik' },
    { id: 'postingan', label: `Postingan (${posts.length})` },
    { id: 'komentar', label: `Komentar (${commentTotal})` },
    { id: 'anomali', label: 'Anomali', badge: hiRisk },
  ];

  let body = null;
  if (mode === 'user' && panelUser) {
    body = (
      <UserBody
        u={panelUser} posts={posts} metrics={metrics} keyword={keyword} isolate={isolate}
        onFocus={onFocus} onUnfocus={onUnfocus} onToggleIsolate={onToggleIsolate} onOpenThreads={onOpenThreads}
      />
    );
  } else if (mode === 'link' && linkDetail) {
    body = <LinkBody l={linkDetail} posts={posts} keyword={keyword} />;
  } else if (mode === 'bucket' && selectedBucket != null) {
    body = (
      <BucketBody
        SNA={SNA} posts={posts} keyword={keyword} selectedBucket={selectedBucket}
        anomaly={anomaly} onAnomalyPanel={onAnomalyPanel}
      />
    );
  } else if (mode === 'replay') {
    body = <ReplayBody replay={replay} graph={graph} posts={posts} onReplayBack={onReplayBack} />;
  } else if (activeTab === 'anomali') {
    body = (
      <AnomalyBody
        posts={posts} keyword={keyword} anomaly={anomaly} anonOpts={anonOpts}
        onRefreshAnomaly={onRefreshAnomaly} onAnonWin={onAnonWin} onAnonMin={onAnonMin}
        onBucket={onBucket} onFocus={onFocus}
      />
    );
  } else if (activeTab === 'postingan') {
    body = <PostsTab posts={posts} keyword={keyword} q={q} setQ={setQ} limit={postLimit} setLimit={setPostLimit} />;
  } else if (activeTab === 'komentar') {
    body = <CommentsTab SNA={SNA} posts={posts} keyword={keyword} q={q} setQ={setQ} limit={commentLimit} setLimit={setCommentLimit} />;
  } else {
    body = <MetricsTab SNA={SNA} posts={posts} graph={graph} metrics={metrics} anomaly={anomaly} onAnomalyPanel={onAnomalyPanel} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-slate-200 px-3 pb-2 pt-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold text-slate-800 dark:text-white">{title}</h2>
          {detail && (
            <button className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-gray-200"
              onClick={onClosePanel} aria-label="Tutup detail">✕</button>
          )}
        </div>
        {!detail && (
          <div role="tablist" aria-label="Panel informasi" className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => onTab?.(t.id)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${activeTab === t.id
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
              >
                {t.label}
                {t.badge > 0 && (
                  <span className="ml-1 rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-700 dark:bg-red-500/20 dark:text-red-300">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{body}</div>
    </div>
  );
}
