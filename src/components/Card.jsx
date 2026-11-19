import React from 'react';

export default function Card({ as: Tag = 'section', className = '', children, ...rest }) {
  return (
    <Tag className={`surface ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, actions, className = '' }) {
  return (
    <header className={`flex flex-wrap items-start justify-between gap-2 px-5 pt-4 ${description ? 'pb-3' : 'pb-2'} ${className}`}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900 font-display dark:text-white">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className = '', children }) {
  return <div className={`px-5 pb-5 ${className}`}>{children}</div>;
}
