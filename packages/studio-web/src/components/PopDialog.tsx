import { useEffect, useRef } from 'react';

/**
 * The modal shell shared by the workspaces — Compose's step editor and Test Data's dataset
 * editor use the same one, so "entering a task" looks the same wherever you do it.
 *
 * Escape closes it, but only when nothing nested has already consumed the key: the pickers
 * stopPropagation on their own Escape, so closing a dropdown does not also discard the edit
 * behind it. Backdrop click closes; a drag that STARTED inside the panel does not.
 */
export function PopDialog({
  title,
  onClose,
  closeLabel,
  className = '',
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  /** Per-dialog sizing, e.g. "data-dialog". The shell itself is always .pop-dialog. */
  className?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `pop-dialog-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

  useEffect(() => {
    // The panel itself, not the first control: the heading is what a screen reader should
    // announce on open, and the author still tabs straight into the form from here.
    ref.current?.focus();
  }, []);

  return (
    <div
      className="pop-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`pop-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          onClose();
        }}
      >
        <header className="pop-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </header>
        <div className="pop-dialog-body">{children}</div>
        {footer && <footer className="pop-dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}
