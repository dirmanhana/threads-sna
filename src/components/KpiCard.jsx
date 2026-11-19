import React from 'react';
import Card from './Card.jsx';
import StatusPill from './StatusPill.jsx';

const TONES = {
  slate: 'text-slate-900 dark:text-white',
  green: 'text-emerald-600 dark:text-emerald-300',
  red: 'text-red-600 dark:text-red-300',
  amber: 'text-amber-600 dark:text-amber-300',
  sky: 'text-sky-600 dark:text-sky-300',
  brand: 'text-blue-600 dark:text-blue-300',
};

export default function KpiCard({ label, value, hint, delta, tone = 'slate', icon, href }) {
  const Wrapper = href ? 'a' : 'div';
  return (
    <Card className="p-4">
      <Wrapper href={href} className={href ? 'group block' : 'block'}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
            <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${TONES[tone] || TONES.slate}`}>{value}</div>
          </div>
          {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">{icon}</span>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {delta && <StatusPill tone={delta.tone || 'slate'}>{delta.text}</StatusPill>}
          {hint && <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
        </div>
      </Wrapper>
    </Card>
  );
}
