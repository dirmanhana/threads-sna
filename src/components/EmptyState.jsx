import React from 'react';

export default function EmptyState({ title, description, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-12'}`}>
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-400 dark:bg-gray-700/60 dark:text-gray-400">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 5h16v2H4V5Zm0 6h10v2H4v-2Zm0 6h7v2H4v-2Zm14-4.6 2.4 2.4-1.4 1.4L17 14.2l-2 2-1.4-1.4 2-2-2-2L15 9.4l2 2 2.4-2.4 1.4 1.4-2.4 2.4Z" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-gray-200">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-gray-400">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
