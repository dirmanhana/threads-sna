import React, { useRef } from 'react';
import { esc, tlLabel } from '../lib/viewerLib.js';

export default function Timeline({ temporal, selectedBucket, onSelect }) {
  const tip = useRef(null);
  const host = useRef(null);
  const t = temporal || { buckets: [], bursts: [], total: 0 };
  const W = 900, H = 92, m = { t: 6, r: 12, b: 20, l: 12 };
  const burstSet = new Set((t.bursts || []).map((b) => b.t));
  const buckets = t.buckets || [];
  const step = t.stepMs || 86400000;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const band = buckets.length ? (W - m.l - m.r) / buckets.length : 0;
  const bw = Math.max(1, band * .85);
  const y = (v) => (H - m.b) - (v / max) * (H - m.b - m.t);

  const show = (html, e) => {
    const el = tip.current;
    if (!el) return;
    el.innerHTML = html;
    el.style.display = 'block';
    const pad = 14, w = el.offsetWidth || 220, h = el.offsetHeight || 80;
    let x = e.clientX + pad, yy = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (yy + h > window.innerHeight - 8) yy = e.clientY - h - pad;
    el.style.left = Math.max(4, x) + 'px';
    el.style.top = Math.max(4, yy) + 'px';
  };
  const hide = () => { if (tip.current) tip.current.style.display = 'none'; };

  if (!buckets.length) {
    return <div className="grid h-[92px] place-items-center text-xs text-slate-400">Tidak ada data waktu</div>;
  }

  const ticks = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];

  return (
    <>
      <div ref={host} className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[92px] w-full">
          <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} className="stroke-slate-300 dark:stroke-gray-600" />
          {buckets.map((b, i) => {
            const burst = burstSet.has(b.t);
            const bx = m.l + i * band + (band - bw) / 2;
            const by = y(b.count);
            return (
              <rect
                key={b.t}
                x={bx} y={by} width={bw} height={Math.max(0, H - m.b - by)} rx={1}
                fill={burst ? 'var(--c2)' : 'var(--c1)'}
                opacity={selectedBucket === b.t ? 1 : .85}
                className="cursor-pointer"
                onMouseMove={(e) => show('<b>' + esc(tlLabel(b.t, step)) + '</b><br>' + b.count + ' komentar'
                  + (burst ? ' · <b style="color:var(--c2)">LONJAKAN</b>' : '')
                  + '<br><span style="color:#888">klik untuk detail</span>', e)}
                onMouseOut={hide}
                onClick={() => onSelect?.(b.t)}
              />
            );
          })}
          {ticks.map((i) => {
            const b = buckets[i];
            return (
              <text key={i} x={m.l + i * band + band / 2} y={H - 4} textAnchor="middle"
                className="fill-slate-500 dark:fill-gray-400" style={{ fontSize: 10 }}>
                {tlLabel(b.t, step, true)}
              </text>
            );
          })}
        </svg>
      </div>
      <div
        ref={tip}
        style={{ display: 'none', position: 'fixed', zIndex: 999, maxWidth: 340, pointerEvents: 'none' }}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </>
  );
}
