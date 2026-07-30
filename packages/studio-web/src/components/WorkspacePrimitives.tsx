import type { ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle, RotateCcw } from 'lucide-react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`workspace-page-header ${className}`.trim()}>
      <div className="workspace-page-heading">
        {eyebrow && <span className="canvas-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="workspace-page-actions">{actions}</div>}
    </header>
  );
}

export function Toolbar({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`workspace-toolbar ${className}`.trim()} aria-label={label}>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section className={`workspace-card ${className}`.trim()} aria-label={label}>
      {children}
    </section>
  );
}

export function TableFrame({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="table-wrap workspace-table-frame" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`workspace-empty-state${compact ? ' compact' : ''}`}>
      <Inbox size={22} aria-hidden="true" />
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}

export function AsyncFeedback({
  state,
  message,
  onRetry,
  compact = false,
}: {
  state: 'loading' | 'error' | 'success';
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const isError = state === 'error';
  return (
    <div
      className={`async-feedback ${state}${compact ? ' compact' : ''}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={state === 'loading' ? 'true' : undefined}
    >
      {state === 'loading'
        ? <LoaderCircle className="async-feedback-spinner" size={17} aria-hidden="true" />
        : state === 'error'
          ? <AlertCircle size={17} aria-hidden="true" />
          : null}
      <span>{message}</span>
      {isError && onRetry && (
        <button type="button" className="ghost" onClick={onRetry}>
          <RotateCcw size={14} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  );
}

export function DrawerHeader({
  title,
  icon,
  closeLabel,
  onClose,
}: {
  title: string;
  icon?: ReactNode;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="drawer-header">
      <h3>{icon}{title}</h3>
      <button type="button" className="ghost" onClick={onClose} aria-label={closeLabel}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
