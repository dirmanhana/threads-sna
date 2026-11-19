import React from 'react';
import Card from './Card.jsx';
import StatusPill from './StatusPill.jsx';

const TONES = {
  slate: 'text-slate-800 dark:text-white',
  green: 'text-emerald-600 dark:text-emerald-300',
  red: 'text-red-600 dark:text-red-300',
  amber: 'text-amber-600 dark:text-amber-300',
  sky: 'text-sky-600 dark:text-sky-300',
  brand: 'text-brand-600 dark:text-brand-300',
};

export default function KpiCard({ label, value, hint, delta, tone = 'slate', icon, href }) {
  const Wrapper = href ? 'a' : 'div';
  return (
    <Card className="p-5">
      <Wrapper href={href} className={href ? 'group block' : 'block'}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 dark:text-gray-400">{label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${TONES[tone] || TONES.slate}`}>
              {value}
            </div>
          </div>
          {icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-gray-700/60 dark:text-gray-300">
              {icon}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {delta && <StatusPill tone={delta.tone || 'slate'}>{delta.text}</StatusPill>}
          {hint && <span className="truncate text-[11px] text-slate-500 dark:text-gray-400">{hint}</span>}
        </div>
      </Wrapper>
    </Card>
  );
}
