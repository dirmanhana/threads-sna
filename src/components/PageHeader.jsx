import React from 'react';

/** Judul halaman + aksi, mengikuti pola "Dashboard actions" Mosaic Lite. */
export default function PageHeader({ title, subtitle, meta, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight text-slate-800 dark:text-white sm:text-[30px] sm:leading-9">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-600 dark:text-gray-400">{subtitle}</p>
        )}
        {meta && <div className="mt-2 text-xs text-slate-500 dark:text-gray-400">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
