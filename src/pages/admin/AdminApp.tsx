import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderSync, Images, LogOut, Menu, Paintbrush, Settings, X } from 'lucide-react';
import { api, post } from '../../lib/api';
import type { DriveStatus } from '../../../shared/api';
import { cx } from '../../components/ui';
import LoginPage from './LoginPage';
import CollectionsPage from './CollectionsPage';
import NewCollectionPage from './NewCollectionPage';
import CollectionDetailPage from './CollectionDetailPage';
import EditorPage from './EditorPage';
import ClientPreviewPage from './ClientPreviewPage';
import DrivePage from './DrivePage';
import SettingsPage from './SettingsPage';

export interface Me {
  authenticated: boolean;
  configured: boolean;
  demoMode: boolean;
}

export default function AdminApp() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/auth/me'), staleTime: 60_000 });
  const location = useLocation();
  useEffect(() => {
    document.title = 'Studio | lensasamsol';
  }, [location.pathname]);
  if (me.isPending) return <div className="min-h-svh bg-canvas" />;
  if (location.pathname === '/admin/login') return <LoginPage me={me.data} />;
  if (!me.data?.authenticated) {
    return (
      <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
    );
  }
  return (
    <Routes>
      {/* Full-viewport editor lives outside the sidebar shell so the canvas gets the width. */}
      <Route path="collections/:id/design" element={<EditorPage target="collection" />} />
      <Route path="appearance" element={<EditorPage target="defaults" />} />
      <Route path="collections/:id/preview" element={<ClientPreviewPage />} />
      <Route
        path="*"
        element={
          <Shell demo={!!me.data.demoMode}>
            <Routes>
              <Route index element={<Navigate to="/admin/collections" replace />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="collections/new" element={<NewCollectionPage />} />
              <Route path="collections/:id" element={<CollectionDetailPage />} />
              <Route path="drive" element={<DrivePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Shell>
        }
      />
    </Routes>
  );
}

const NAV = [
  { to: '/admin/collections', label: 'Collections', icon: Images },
  { to: '/admin/drive', label: 'Drive Sync', icon: FolderSync },
  { to: '/admin/appearance', label: 'Appearance Defaults', icon: Paintbrush },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

function Shell({ children, demo }: { children: ReactNode; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const drive = useQuery({
    queryKey: ['drive-status'],
    queryFn: () => api<DriveStatus>('/api/admin/drive/status'),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ studioName: string }>('/api/admin/settings'),
  });
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter(el => el.getClientRects().length);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const list = focusable(), first = list[0], last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', key); if (trigger?.getClientRects().length) trigger.focus(); };
  }, [open]);

  useEffect(() => {
    const desktop = matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  const logout = async () => {
    await post('/api/auth/logout');
    qc.clear();
    navigate('/admin/login');
  };

  const rail = (
    <nav className="flex h-full flex-col" aria-label="Studio">
      <div className="flex h-[60px] items-center justify-between px-5">
        <span className="flex min-w-0 items-center gap-2">
          <img src="/brand/icon-48.png" alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
          <span className="truncate font-mono text-[13px] font-medium leading-none">
            {settings.data?.studioName ?? 'lensasamsol'}
          </span>
        </span>
        <button
          type="button"
          className="rounded-ui p-1.5 text-slate hover:bg-subtle lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>
      <ul className="flex flex-col gap-0.5 px-3 pt-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-3 rounded-ui px-2.5 text-[14px] transition-colors',
                  isActive
                    ? 'bg-subtle font-medium text-ink'
                    : 'text-slate hover:bg-subtle hover:text-ink',
                )
              }
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-2 border-t border-line p-4 text-[12px]">
        {demo && (
          <p className="rounded-ui bg-warn-bg px-2.5 py-2 leading-4 text-warn">
            Demo mode is on. Sample collections use fixture images, not Google Drive.
          </p>
        )}
        <NavLink to="/admin/drive" className="flex items-center gap-2 text-slate hover:text-ink">
          <span
            className={cx(
              'h-2 w-2 rounded-full',
              drive.data?.connected ? (drive.data.lastError ? 'bg-err' : 'bg-ok') : 'bg-muted',
            )}
            aria-hidden="true"
          />
          {drive.data?.connected
            ? drive.data.lastError
              ? 'Drive needs attention'
              : `Drive connected${drive.data.email ? `: ${drive.data.email}` : ''}`
            : 'Google Drive not connected'}
        </NavLink>
        <div className="flex items-center justify-between">
          <a href="/" target="_blank" rel="noopener noreferrer" className="text-slate hover:text-ink">
            View public site
          </a>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 rounded-ui px-1.5 py-1 text-slate hover:bg-subtle hover:text-ink"
          >
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="studio-shell min-h-svh bg-canvas text-ink">
      <aside className="studio-rail fixed inset-y-0 left-0 z-30 hidden w-[224px] border-r border-line bg-canvas lg:block">
        {rail}
      </aside>
      {open && (
        <div ref={menuRef} className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            className="absolute inset-0 bg-ink/25"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[260px] max-w-[85vw] border-r border-line bg-canvas">
            {rail}
          </aside>
        </div>
      )}
      <div className="lg:pl-[224px]" inert={open || undefined}>
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            ref={triggerRef}
            onClick={() => setOpen(true)}
            className="-ml-1 rounded-ui p-2 hover:bg-subtle"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <img src="/brand/icon-48.png" alt="" width={22} height={22} className="h-[22px] w-[22px]" />
          <span className="font-mono text-[13px] font-medium">{settings.data?.studioName ?? 'lensasamsol'}</span>
        </div>
        <main className="studio-main mx-auto max-w-[1680px] px-4 py-5 sm:px-8 sm:py-7">{children}</main>
      </div>
    </div>
  );
}
