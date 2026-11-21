import React, { useState } from 'react';

const nf = (v) => Number(v || 0).toLocaleString('id-ID');

export function SentimentTrendChart({ buckets, granularity, onSelectBucket }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const items = (buckets || []).slice(-28);

  if (items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        Belum ada data bertimestamp untuk ditampilkan.
      </div>
    );
  }

  const maxCount = Math.max(1, ...items.map((b) => b.count));
  const width = 680;
  const height = 196;
  const padL = 32;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const barStep = innerW / items.length;
  const barW = Math.max(6, Math.min(24, barStep * 0.68));

  const formatTick = (t) => {
    const d = new Date(t);
    if (granularity === 'day') return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  const showLabel = (idx) => idx === 0 || idx === items.length - 1 || idx % Math.ceil(items.length / 5) === 0;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full"
        role="img"
        aria-label="Grafik tren sentimen berdasarkan waktu"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const y = padT + innerH - r * innerH;
          const val = Math.round(maxCount * r);
          return (
            <g key={r}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="currentColor"
                className="text-slate-400 dark:text-slate-500"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {val}
              </text>
            </g>
          );
        })}

        {items.map((b, idx) => {
          const cx = padL + idx * barStep + barStep / 2;
          const x = cx - barW / 2;
          const totalH = Math.max(2, (b.count / maxCount) * innerH);
          const y = padT + innerH - totalH;
          const posH = b.count > 0 ? (b.positif / b.count) * totalH : 0;
          const negH = b.count > 0 ? (b.negatif / b.count) * totalH : 0;
          const neuH = Math.max(0, totalH - posH - negH);
          const hovered = hoverIdx === idx;

          return (
            <g
              key={`${b.t}-${idx}`}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              onClick={() => onSelectBucket?.(b.t)}
              className="cursor-pointer"
            >
              <rect x={x} y={padT} width={barW} height={innerH} fill="transparent" />
              {neuH > 0 && (
                <rect x={x} y={y} width={barW} height={neuH} fill="#94a3b8" opacity={hovered ? 1 : 0.85} rx={1.5} />
              )}
              {posH > 0 && (
                <rect x={x} y={y + neuH} width={barW} height={posH} fill="#16a34a" opacity={hovered ? 1 : 0.9} />
              )}
              {negH > 0 && (
                <rect x={x} y={y + neuH + posH} width={barW} height={negH} fill="#dc2626" opacity={hovered ? 1 : 0.9} />
              )}
              {b.isBurst && (
                <circle cx={cx} cy={y - 4} r={2.5} fill="#f59e0b" />
              )}
              {showLabel(idx) && (
                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  className="text-slate-500 dark:text-slate-400"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {formatTick(b.t)}
                </text>
              )}
            </g>
          );
        })}

        {hoverIdx != null && items[hoverIdx] && (() => {
          const b = items[hoverIdx];
          const cx = padL + hoverIdx * barStep + barStep / 2;
          const tipW = 132;
          const tipH = 56;
          const tx = Math.min(width - tipW - 4, Math.max(4, cx - tipW / 2));
          const ty = 18;
          return (
            <g>
              <rect x={tx} y={ty} width={tipW} height={tipH} rx={6} fill="#0f172a" opacity="0.96" />
              <text x={tx + 8} y={ty + 14} fontSize="10" fill="#e2e8f0" style={{ fontFamily: 'var(--font-mono)' }}>
                {new Date(b.t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </text>
              <text x={tx + 8} y={ty + 28} fontSize="10" fill="#94a3b8">
                Total: <tspan fill="#f8fafc" style={{ fontFamily: 'var(--font-mono)' }}>{nf(b.count)}</tspan>
              </text>
              <text x={tx + 8} y={ty + 42} fontSize="9" fill="#94a3b8">
                <tspan fill="#16a34a">+{nf(b.positif)}</tspan>
                {'  '}<tspan fill="#94a3b8">○{nf(b.netral)}</tspan>
                {'  '}<tspan fill="#dc2626">−{nf(b.negatif)}</tspan>
                {b.isBurst ? <tspan fill="#f59e0b">  • lonjakan</tspan> : ''}
              </text>
            </g>
          );
        })()}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" /> Positif</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-slate-400" /> Netral</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-red-600" /> Negatif</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Lonjakan (burst)</span>
      </div>
    </div>
  );
}

export function SentimentDonutChart({ positif, netral, negatif }) {
  const total = positif + netral + negatif;
  const segments = [
    { label: 'Positif', value: positif, color: '#16a34a' },
    { label: 'Netral', value: netral, color: '#94a3b8' },
    { label: 'Negatif', value: negatif, color: '#dc2626' },
  ].filter((s) => s.value > 0);

  if (total === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        Belum ada data sentimen.
      </div>
    );
  }

  const radius = 42;
  const c = 2 * Math.PI * radius;
  let acc = 0;

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="14" className="dark:stroke-slate-800" />
          {segments.map((seg) => {
            const dash = (seg.value / total) * c;
            const dashOffset = -acc;
            acc += dash;
            if (seg.value === 0) return null;
            return (
              <circle
                key={seg.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={dashOffset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {nf(total)}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">berlabel</span>
        </div>
      </div>

      <ul className="w-full flex-1 space-y-2.5">
        {[
          { label: 'Positif', value: positif, color: '#16a34a' },
          { label: 'Netral', value: netral, color: '#94a3b8' },
          { label: 'Negatif', value: negatif, color: '#dc2626' },
        ].map((seg) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          return (
            <li key={seg.label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: seg.color }} />
                {seg.label}
              </span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {nf(seg.value)}{' '}
                <span className="text-slate-400 dark:text-slate-500">({pct}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TopicRankBars({ topics }) {
  const list = Array.isArray(topics) ? topics : [];
  if (list.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
        Belum ada topik terklasifikasi. Jalankan analisis AI untuk mengekstrak klaster topik.
      </div>
    );
  }

  const max = Math.max(1, ...list.map((t) => t.count || t.value || 0));

  return (
    <div className="space-y-3.5">
      {list.slice(0, 6).map((t, i) => {
        const count = t.count ?? t.value ?? 0;
        const label = t.label || `Topik ${t.id ?? i + 1}`;
        const keywords = Array.isArray(t.keywords) ? t.keywords : [];
        const widthPct = Math.max(6, Math.round((count / max) * 100));
        return (
          <div key={t.id ?? label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                {label}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                {nf(count)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            {keywords.length > 0 && (
              <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                {keywords.slice(0, 5).join(' · ')}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
