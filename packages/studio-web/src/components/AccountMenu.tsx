import { ChevronUp, CircleHelp, LogOut, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StudioUser } from '../types';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

export function AccountMenu({
  user,
  collapsed,
  canSignOut,
  onSettings,
  onHelp,
  onSignOut,
}: {
  user: StudioUser;
  collapsed: boolean;
  canSignOut: boolean;
  onSettings: () => void;
  onHelp: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    firstItem?.focus();
  }, [open]);

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      menuRef.current?.querySelector<HTMLButtonElement>('.account-trigger')?.focus();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length > 0) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      items[(currentIndex + direction + items.length) % items.length].focus();
    } else if (event.key === 'Home' && items.length > 0) {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End' && items.length > 0) {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  }

  return (
    <div
      ref={menuRef}
      className={`account-menu-wrap${collapsed ? ' collapsed' : ''}`}
      onKeyDown={handleMenuKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {open && (
        <div className="account-popover" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>
            <Settings size={16} aria-hidden="true" /> Settings
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onHelp(); }}>
            <CircleHelp size={16} aria-hidden="true" /> Help
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canSignOut}
            title={canSignOut ? 'Sign out of this workspace' : 'Connect a Google account before signing out'}
            onClick={() => { setOpen(false); onSignOut(); }}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        className="account-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={collapsed ? `Open account menu for ${user.name}` : undefined}
      >
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="account-initials">{initials(user.name)}</span>}
        {!collapsed && (
          <>
            <span className="account-identity">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <ChevronUp size={15} aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  );
}
