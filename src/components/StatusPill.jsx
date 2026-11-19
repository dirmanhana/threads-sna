import React from 'react';

const TONES = {
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  brand: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
};

const DOTS = {
  green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500',
  sky: 'bg-sky-500', brand: 'bg-blue-500', slate: 'bg-slate-400',
};

export default function StatusPill({ tone = 'slate', dot = false, pulse = false, children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONES[tone] || TONES.slate} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOTS[tone] || DOTS.slate} ${pulse ? 'animate-pulse' : ''}`} />}
      {children}
    </span>
  );
}
