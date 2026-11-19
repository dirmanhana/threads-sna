import React from 'react';
import { esc, fmt, hl, itemUrl, linkUser, postUrl, replayDate, tlLabel, userLink } from '../lib/viewerLib.js';

const H4 = ({ children }) => <h4 className="mb-1.5 mt-4 text-[13px] font-semibold text-slate-800 dark:text-gray-100">{children}</h4>;
const Tag = ({ children, html }) => (
  <div className="text-[11px] text-slate-500 dark:text-gray-400"
    {...(html ? { dangerouslySetInnerHTML: { __html: children } } : { children })} />
);
const Btn = ({ children, onClick, active }) => (
  <button onClick={onClick}
    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${active
      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
      : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
    {children}
  </button>
);

export default function InfoPanel(props) {
  const {
    SNA, mode, posts, graph, metrics, anomaly, anonOpts, replay, keyword, selectedBucket,
    focus, isolate, panelUser, linkDetail,
    onFocus, onUnfocus, onToggleIsolate, onOpenThreads, onAnomalyPanel, onClosePanel,
    onBucket, onReplayBack, onRefreshAnomaly, onAnonWin, onAnonMin,
  } = props;
  const uLink = (id) => userLink(posts, id);
  const html = (text) => ({ __html: hl(esc(text), keyword) });

  function PostCard({ p, only }) {
    const txt = String(p.text == null ? '' : p.text);
    const badges = [
      p.timestamp ? `<span class="tag text-[11px] text-slate-400">🗓 ${esc(p.timestamp)}</span>` : '',
      Number.isFinite(p.likes) ? `<span class="tag text-[11px] text-slate-400">♥ ${p.likes}</span>` : '',
    ].join(' ');
    const th = (p.thread || []).filter((t) => !only || t.author === only).map((t) =>
      `<div class="border-l-[3px] border-emerald-500 pl-2 my-1.5 text-[12px] text-slate-500 dark:text-gray-400">` +
      `<span class="text-[11px] text-slate-400">thread</span> <b class="text-slate-800 dark:text-gray-100">` +
      linkUser(t.author, '@' + t.author, itemUrl(t, p)) + '</b>: ' + hl(esc(t.text), keyword) +
      (t.timestamp ? ` <span class="text-[11px] text-slate-400">${esc(t.timestamp)}</span>` : '') + '</div>').join('');
    const rp = (p.replies || []).filter((r) => !only || r.author === only).map((r) =>
      `<div class="border-l-[3px] border-brand-500 pl-2 my-1.5 text-[12px] text-slate-500 dark:text-gray-400">` +
      `<span class="text-[11px] text-slate-400">komentar</span> <b class="text-slate-800 dark:text-gray-100">` +
      linkUser(r.author, '@' + r.author, itemUrl(r, p)) + '</b>: ' + hl(esc(r.text), keyword) +
      (r.timestamp ? ` <span class="text-[11px] text-slate-400">${esc(r.timestamp)}</span>` : '') + '</div>').join('');
    return (
      <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800/60"
        dangerouslySetInnerHTML={{ __html:
          '<b class="text-slate-800 dark:text-gray-100">' + linkUser(p.author, '@' + p.author, postUrl(p)) + '</b> ' +
          '<span class="text-[11px] text-slate-400">' + (only ? '(dikomentari ' + uLink(only) + ')' : 'memposting') + '</span> ' + badges +
          '<div class="my-1 line-clamp-6 whitespace-pre-wrap break-words text-slate-700 dark:text-gray-200" title="' + esc(txt) + '">' + hl(esc(txt), keyword) + '</div>' +
          th + rp,
        }} />
    );
  }

  function MetricTable() {
    const m = metrics || { degree: new Map(), betweenness: new Map(), closeness: new Map(), eigenvector: new Map() };
    const defs = [['degree', m.degree, false], ['betweenness', m.betweenness, true],
      ['closeness', m.closeness, true], ['eigenvector', m.eigenvector, true]];
    return (
      <>
        <H4>Metrik jaringan</H4>
        <table className="w-full table-fixed border-collapse text-[11px]">
          <thead><tr><th className="border border-slate-200 p-1 text-left dark:border-gray-700">Metrik</th>
            {[1, 2, 3, 4, 5].map((i) => <th key={i} className="border border-slate-200 p-1 text-center dark:border-gray-700">{i}</th>)}</tr></thead>
          <tbody>
            {defs.map(([name, map, f3]) => {
              const top = [...(map?.entries() || [])].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 5);
              return (
                <tr key={name}>
                  <th className="border border-slate-200 p-1 text-left dark:border-gray-700">{name}</th>
                  {Array.from({ length: 5 }, (_, i) => (
                    <td key={i} className="border border-slate-200 p-1 align-top break-words dark:border-gray-700">
                      {top[i] ? <span dangerouslySetInnerHTML={{ __html: uLink(top[i][0]) + ' <span class="text-[10px] text-slate-400">' + (f3 ? fmt(top[i][1]) : top[i][1]) + '</span>' }} /> : '-'}
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

  function ActorTop() {
    const ns = graph?.nodes || [];
    const top = [...ns].sort((a, b) => b.deg - a.deg || String(a.id).localeCompare(String(b.id))).slice(0, 5);
    return (
      <>
        <H4>Aktor teratas</H4>
        {top.length ? top.map((n) => (
          <Tag key={n.id} html>{uLink(n.id)} · {n.deg} relasi · {n.posts} post · {n.replies} komentar · {n.threadCount} thread</Tag>
        )) : <Tag>-</Tag>}
      </>
    );
  }

  function CommunityBlock() {
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

  /* ----- mode: default ----- */
  if (mode === 'default') {
    const c = anomaly?.cib || { clusters: [] }, t = anomaly?.temporal || { bursts: [] }, s = anomaly?.scores || [];
    const hi = s.filter((x) => x.score >= 70).length;
    return (
      <div>
        <MetricTable />
        <ActorTop />
        <CommunityBlock />
        <H4>Anomali & buzzer</H4>
        <Tag>{c.clusters.length} klaster CIB · {t.bursts.length} lonjakan · {hi} akun risiko tinggi</Tag>
        <div className="my-2 flex flex-wrap gap-1.5"><Btn onClick={onAnomalyPanel}>Lihat detail deteksi</Btn></div>
        <H4>Semua postingan</H4>
        {posts.map((p) => <PostCard key={p.code} p={p} />)}
      </div>
    );
  }

  /* ----- mode: user ----- */
  if (mode === 'user' && panelUser) {
    const u = panelUser;
    const mine = posts.filter((p) => p.author === u);
    const other = posts.filter((p) => p.author !== u &&
      ((p.replies || []).some((r) => r.author === u) || (p.thread || []).some((t) => t.author === u)));
    const m = metrics || { degree: new Map(), betweenness: new Map(), closeness: new Map(), eigenvector: new Map(), communities: new Map() };
    const c = m.communities.get(u);
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white" dangerouslySetInnerHTML={{ __html: uLink(u) }} />
        <Tag html>Derajat {m.degree.get(u) || 0} · komunitas {c == null ? '-' : c} · betweenness {fmt(m.betweenness.get(u))} · closeness {fmt(m.closeness.get(u))} · eigenvector {fmt(m.eigenvector.get(u))}</Tag>
        <div className="my-2 flex flex-wrap gap-1.5">
          <Btn onClick={() => onFocus?.(u)}>Fokus</Btn>
          <Btn onClick={onUnfocus}>Lepaskan fokus</Btn>
          <Btn onClick={onToggleIsolate} active={isolate}>{isolate ? 'Tampilkan semua' : 'Isolasi'}</Btn>
          <Btn onClick={onOpenThreads}>Buka di Threads ↗</Btn>
        </div>
        {!!mine.length && <><H4>Postingan</H4>{mine.map((p) => <PostCard key={p.code} p={p} />)}</>}
        {!!other.length && <><H4>Dikomentari</H4>{other.map((p) => <PostCard key={p.code} p={p} only={u} />)}</>}
      </div>
    );
  }

  /* ----- mode: link ----- */
  if (mode === 'link' && linkDetail) {
    const l = linkDetail, items = l.items?.length ? l.items : [{}];
    return (
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-800 dark:text-white"
          dangerouslySetInnerHTML={{ __html: uLink(l.source?.id ?? l.source) + ' → ' + uLink(l.target?.id ?? l.target) +
            ' <span class="text-[11px] font-normal text-slate-400">' + esc(l.type) + ', ' + (l.w || 0) + '×</span>' }} />
        {items.map((it, i) => (
          <div key={i} className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800/60">
            <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-gray-200" {...html(it.text)} />
            <div className="mt-1 text-[11px] text-slate-400"
              dangerouslySetInnerHTML={{ __html: linkUser(it.author, '@' + it.author, itemUrl(it, { code: it.postCode, author: it.author })) +
                ' · ' + esc(it.postCode) + (it.timestamp ? ' · ' + esc(it.timestamp) : '') }} />
          </div>
        ))}
      </div>
    );
  }

  /* ----- mode: anomaly ----- */
  if (mode === 'anomaly') {
    const c = anomaly?.cib || { clusters: [] }, t = anomaly?.temporal || { bursts: [], granularity: '-' }, s = anomaly?.scores || [];
    const hi = s.filter((x) => x.score >= 70).length, mid = s.filter((x) => x.score >= 40 && x.score < 70).length;
    const win = Math.round(anonOpts.windowMs / 60000);
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white">🚨 Deteksi anomali &amp; perilaku akun</h3>
        <Tag>{c.clusters.length} klaster CIB · {t.bursts.length} lonjakan · {hi} akun risiko tinggi · {mid} sedang</Tag>
        <p className="my-1.5 text-[11px] italic text-slate-400">Heuristik untuk triase, bukan bukti. Selalu verifikasi manual.</p>
        <div className="my-2 flex flex-wrap gap-1.5">
          <Btn onClick={onRefreshAnomaly}>Hitung ulang</Btn>
          <Btn onClick={onClosePanel}>Tutup</Btn>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-gray-400">
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
          <Tag key={b.t} html><button className="text-brand-600 hover:underline" onClick={() => onBucket?.(b.t)}>{esc(tlLabel(b.t, t.stepMs))}</button> · {b.count} komentar ({b.threshold} ambang{b.ratio ? ' · ' + b.ratio + '× median' : ''})</Tag>
        )) : <Tag>Tidak ada lonjakan signifikan.</Tag>}
        <H4>Pola komentar identik / mirip (CIB)</H4>
        {c.clusters.length ? c.clusters.slice(0, 6).map((k, i) => (
          <div key={i} className="my-1.5 rounded-xl border-l-[3px] border-orange-500 bg-slate-50 p-2.5 dark:bg-gray-800/60">
            <Tag html>Klaster {i + 1} · {k.windowCount} komentar dalam jendela · {k.authors.length} akun · keyakinan {Math.round(k.confidence * 100)}%{k.resolution === 'date' ? ' · hanya tanggal' : ''}</Tag>
            <div className="my-1 whitespace-pre-wrap break-words text-xs text-slate-700 dark:text-gray-200" {...html(k.text)} />
            <Tag html>{k.windowAuthors.map((id) => uLink(id)).join(', ')}</Tag>
          </div>
        )) : <Tag>Tidak ada pola copy-paste terdeteksi.</Tag>}
        <H4>Skor buzzer (heuristik)</H4>
        {s.some((x) => x.score > 0) ? s.filter((x) => x.score > 0).slice(0, 15).map((x) => (
          <div key={x.id} className="mb-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
            <span className={`mr-1.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white ${x.level === 'tinggi' ? 'bg-red-800' : x.level === 'sedang' ? 'bg-amber-700' : 'bg-slate-500'}`}>{x.score}</span>
            <span dangerouslySetInnerHTML={{ __html: uLink(x.id) }} />
            <Tag>{x.reasons.join(' · ') || 'tidak ada indikator'}</Tag>
            <div className="mt-1"><Btn onClick={() => onFocus?.(x.id)}>Sorot di graf</Btn></div>
          </div>
        )) : <Tag>Tidak ada indikator mencurigakan.</Tag>}
      </div>
    );
  }

  /* ----- mode: bucket ----- */
  if (mode === 'bucket' && selectedBucket != null) {
    const step = anomaly?.temporal?.stepMs || 86400000;
    const evs = SNA.bucketEvents(posts, selectedBucket, { stepMs: step });
    const burst = (anomaly?.temporal?.bursts || []).find((b) => b.t === selectedBucket);
    const by = new Map();
    evs.forEach((e) => by.set(e.author, (by.get(e.author) || 0) + 1));
    const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white">{esc(tlLabel(selectedBucket, step))}</h3>
        <Tag html>{evs.length} komentar{burst ? ' · <b style="color:var(--c2)">LONJAKAN</b> (' + burst.count + ' vs ambang ' + burst.threshold + ')' : ''}</Tag>
        <div className="my-2"><Btn onClick={onAnomalyPanel}>Kembali ke anomali</Btn></div>
        {!!top.length && <><H4>Akun paling aktif</H4>{top.map(([id, n]) => <Tag key={id} html>{uLink(id)} · {n} komentar</Tag>)}</>}
        <H4>Contoh komentar</H4>
        {evs.slice(0, 8).map((e, i) => (
          <div key={i} className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="whitespace-pre-wrap break-words text-xs text-slate-700 dark:text-gray-200" {...html(e.text)} />
            <Tag html>{uLink(e.author)} · {esc(e.post || '-')}</Tag>
          </div>
        ))}
      </div>
    );
  }

  /* ----- mode: replay ----- */
  if (mode === 'replay') {
    const ev = replay.events[replay.i - 1];
    const recent = replay.events.slice(Math.max(0, replay.i - 5), replay.i).reverse();
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Time-lapse jaringan</h3>
        <Tag>{replay.i} dari {replay.events.length} peristiwa · {ev
          ? 'terakhir: ' + replayDate(ev.t) + ' · @' + esc(ev.author) + ' (' + esc(ev.kind) + ')'
          : 'belum dimulai'}</Tag>
        <div className="my-2"><Btn onClick={onReplayBack}>Kembali ke akhir</Btn></div>
        <ActorTop />
        <H4>Peristiwa terbaru</H4>
        {recent.map((e, i) => <Tag key={i}>{replayDate(e.t)} · @{esc(e.author)} · {esc(e.kind)}</Tag>)}
      </div>
    );
  }

  return null;
}
