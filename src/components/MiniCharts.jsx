import React from 'react';

const fmtNum = (v) => Number(v || 0).toLocaleString('id-ID');

/**
 * Grafik batang ringan berbasis div (tanpa Chart.js).
 * data: [{ label, value, title }]
 */
export function BarChart({ data = [], height = 180, color = 'bg-brand-500', emptyText = 'Belum ada data waktu.' }) {
  const rows = Array.isArray(data) ? data : [];
  const max = Math.max(1, ...rows.map((d) => Number(d.value) || 0));
  if (!rows.length) {
    return <div className="grid place-items-center text-xs text-slate-500 dark:text-gray-400" style={{ height }}>{emptyText}</div>;
  }
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label="Grafik volume komentar">
        {rows.map((d, i) => {
          const value = Number(d.value) || 0;
          return (
            <div
              key={`${d.label}-${i}`}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={d.title || `${d.label}: ${fmtNum(value)}`}
            >
              <div
                className={`w-full rounded-t-sm ${color} opacity-90 transition group-hover:opacity-100`}
                style={{ height: `${(value / max) * 100}%`, minHeight: value > 0 ? 2 : 0 }}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block">
                {fmtNum(value)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-2 text-[11px] text-slate-500 dark:text-gray-400">
        {rows.map((d, i) => (
          <span key={`${d.label}-x-${i}`} className={i % labelEvery === 0 || i === rows.length - 1 ? '' : 'invisible'}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Donut SVG sederhana. segments: [{ label, value, color }] */
export function Donut({ segments = [], size = 168, thickness = 20, centerValue, centerLabel }) {
  const total = segments.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut sentimen">
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
          className="stroke-slate-100 dark:stroke-gray-700"
        />
        {total > 0 && segments.map((s) => {
          const value = Number(s.value) || 0;
          if (!value) return null;
          const len = (value / total) * c;
          const dash = `${Math.max(0, len - 1)} ${Math.max(0, c - len + 1)}`;
          const el = (
            <circle
              key={s.label}
              cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
              stroke={s.color} strokeDasharray={dash} strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${s.label}: ${fmtNum(value)}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-xl font-semibold tabular-nums text-slate-800 dark:text-white">
            {centerValue ?? fmtNum(total)}
          </div>
          {centerLabel && <div className="text-[11px] text-slate-500 dark:text-gray-400">{centerLabel}</div>}
        </div>
      </div>
    </div>
  );
}

/** Bar horizontal untuk topik/kata kunci. */
export function RankBars({ rows = [], color = 'bg-brand-500', max: maxProp }) {
  const max = Math.max(1, maxProp || 0, ...rows.map((r) => Number(r.value) || 0));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-slate-700 dark:text-gray-200">{r.label}</span>
            <span className="shrink-0 tabular-nums text-slate-500 dark:text-gray-400">{fmtNum(r.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-gray-700">
            <div
              className={`h-full rounded-full ${color}`}
              style={{ width: `${Math.max(2, ((Number(r.value) || 0) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
