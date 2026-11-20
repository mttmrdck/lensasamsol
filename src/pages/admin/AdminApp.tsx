import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderSync, Images, LayoutGrid, LogOut, Menu, Paintbrush, Settings, X } from 'lucide-react';
import { api, post } from '../../lib/api';
import type { DriveStatus } from '../../../shared/api';
import { cx } from '../../components/ui';
import LoginPage from './LoginPage';
import DashboardPage from './DashboardPage';
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
              <Route index element={<DashboardPage />} />
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
  { to: '/admin', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/admin/collections', label: 'Client Galleries', icon: Images },
  { to: '/admin/drive', label: 'Drive Sync', icon: FolderSync },
  { to: '/admin/appearance', label: 'Appearance Defaults', icon: Paintbrush },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

function Shell({ children, demo }: { children: ReactNode; demo: boolean }) {
  const [open, setOpen] = useState(false);
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
          <span className="truncate font-display text-[20px] leading-none tracking-[-0.02em]">
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
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex h-9 items-center gap-2.5 rounded-ui px-2.5 text-[14px] transition-colors',
                  isActive
                    ? 'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]'
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
    <div className="min-h-svh bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r border-line bg-canvas lg:block">
        {rail}
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
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
      <div className="lg:pl-[240px]">
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-ml-1 rounded-ui p-2 hover:bg-subtle"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <img src="/brand/icon-48.png" alt="" width={22} height={22} className="h-[22px] w-[22px]" />
          <span className="font-display text-[19px]">{settings.data?.studioName ?? 'lensasamsol'}</span>
        </div>
        <main className="mx-auto max-w-[1360px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
