import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { ApiError, api, post } from '../../lib/api';
import type { AdminCollectionSummary, DriveStatus, SyncRun } from '../../../shared/api';
import { relativeTime } from '../../lib/format';
import { Button, Callout, Card, Confirm, Pill } from '../../components/ui';
import { PageHeader, SyncLine } from '../../components/admin/bits';

export default function DrivePage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = useQuery({
    queryKey: ['drive-status'],
    queryFn: () => api<DriveStatus>('/api/admin/drive/status'),
  });
  const cols = useQuery({
    queryKey: ['collections'],
    queryFn: () => api<{ collections: AdminCollectionSummary[] }>('/api/admin/collections'),
  });
  const runs = useQuery({
    queryKey: ['sync-runs'],
    queryFn: () => api<{ runs: Array<SyncRun & { title: string }> }>('/api/admin/sync-runs'),
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    if (params.get('connected')) {
      toast.success('Google Drive connected.');
      setParams({}, { replace: true });
    } else if (params.get('error')) {
      toast.error(params.get('error')!);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const connect = useMutation({
    mutationFn: () => post<{ url: string }>('/api/admin/drive/connect'),
    onSuccess: ({ url }) => location.assign(url),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Couldn’t start the Google sign-in.'),
  });
  const test = useMutation({
    mutationFn: () => post<{ ms: number; email: string | null }>('/api/admin/drive/test'),
    onSuccess: (r) => {
      toast.success(`Connection works (${r.ms} ms).`);
      qc.invalidateQueries({ queryKey: ['drive-status'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Connection test failed.');
      qc.invalidateQueries({ queryKey: ['drive-status'] });
    },
  });
  const disconnect = useMutation({
    mutationFn: () => post('/api/admin/drive/disconnect'),
    onSuccess: () => {
      setConfirmDisconnect(false);
      qc.invalidateQueries({ queryKey: ['drive-status'] });
      toast.success('Disconnected. Access was revoked at Google and the stored credential deleted.');
    },
  });

  const syncOne = async (c: AdminCollectionSummary) => {
    setSyncing(c.id);
    try {
      const r = await post<{ added: number; removed: number }>(`/api/admin/collections/${c.id}/sync`);
      toast.success(`${c.title}: +${r.added} new, ${r.removed} removed.`);
    } catch (e) {
      toast.error(`${c.title}: ${e instanceof ApiError ? e.message : 'sync failed'}`);
    } finally {
      setSyncing(null);
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['sync-runs'] });
    }
  };

  const s = status.data;
  return (
    <div className="mx-auto flex max-w-[840px] flex-col gap-6">
      <PageHeader
        title="Drive Sync"
        sub="The app reads your folders; it never writes, moves or deletes anything in Google Drive."
      />

      {s && !s.configured && (
        <Callout tone="warn" title="Google credentials aren’t configured on the server">
          Missing: <span className="font-mono text-[12px]">{s.missing.join(', ')}</span>. Follow “Google Cloud
          setup” in the README, then redeploy.
          {s.demoMode && ' Demo collections keep working without Google.'}
        </Callout>
      )}

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-[15px] font-semibold">Google account</h2>
            {s?.connected ? (
              <>
                <p className="text-[14px]">{s.email ?? 'Connected account'}</p>
                <p className="text-[12px] text-slate">
                  Connected {relativeTime(s.connectedAt)}, last checked {relativeTime(s.lastCheckedAt)}
                </p>
              </>
            ) : (
              <p className="text-[14px] text-slate">Not connected.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {s?.connected && (
              <Button onClick={() => test.mutate()} loading={test.isPending}>
                Test connection
              </Button>
            )}
            <Button
              variant={s?.connected ? 'secondary' : 'primary'}
              onClick={() => connect.mutate()}
              loading={connect.isPending}
              disabled={!s?.configured}
            >
              {s?.connected ? 'Reconnect' : 'Connect Google Drive'}
            </Button>
            {s?.connected && (
              <Button variant="ghost" className="text-err" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
        {s?.lastError && (
          <Callout tone="err" title="Connection problem">
            {s.lastError}
          </Callout>
        )}
        <div className="flex flex-col gap-2 border-t border-line pt-4 text-[13px] leading-5 text-slate">
          <p>
            <span className="font-medium text-ink">Permission requested:</span> read-only access to Drive (
            <span className="font-mono text-[12px]">drive.readonly</span>). It’s needed to list folder
            contents and new files as you add them; narrower per-file access can’t see files added later.
          </p>
          <p>
            Tokens are encrypted on the server and never sent to visitors. Visitors open originals through
            Drive’s own sharing: share each folder as “Anyone with the link” (Viewer) if you want them to open
            originals without requesting access.
          </p>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">Folder health</h2>
        <div className="overflow-hidden rounded-ui border border-line bg-surface">
          <ul className="divide-y divide-line">
            {cols.data?.collections.length === 0 && (
              <li className="px-4 py-4 text-[13px] text-slate">No collections yet.</li>
            )}
            {cols.data?.collections.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link to={`/admin/collections/${c.id}`} className="truncate font-medium hover:underline">
                    {c.title}
                  </Link>
                  <span className="text-slate">
                    <SyncLine c={c} />
                    {c.syncError && <span className="block text-err">{c.syncError}</span>}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.source === 'demo' ? (
                    <Pill>Demo fixtures</Pill>
                  ) : c.folderAccess === 'anyone_with_link' ? (
                    <Pill tone="ok">Anyone with link</Pill>
                  ) : c.folderAccess === 'restricted' ? (
                    <Pill tone="warn">Restricted sharing</Pill>
                  ) : (
                    <Pill>Sharing unknown</Pill>
                  )}
                  <Button
                    size="sm"
                    onClick={() => syncOne(c)}
                    loading={syncing === c.id}
                    disabled={!!syncing}
                    icon={<RefreshCw size={14} aria-hidden="true" />}
                  >
                    {c.syncStatus === 'error' ? 'Retry' : 'Sync now'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">Sync log</h2>
        <ul className="divide-y divide-line rounded-ui border border-line bg-surface text-[13px]">
          {runs.data?.runs.length === 0 && <li className="px-4 py-3 text-slate">No syncs yet.</li>}
          {runs.data?.runs.slice(0, 20).map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
            >
              <span className="min-w-0 truncate">{r.title}</span>
              <span className="tnum flex items-center gap-3 text-slate">
                {r.status === 'error' ? (
                  <Pill tone="err">Failed</Pill>
                ) : (
                  <span>
                    {r.trigger === 'demo-seed'
                      ? 'Demo seed'
                      : `+${r.added} / −${r.removed} / ${r.updated} replaced`}
                  </span>
                )}
                {relativeTime(r.startedAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Card className="p-6 text-[13px] leading-5 text-slate">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">Supported files</h2>
        JPEG, PNG and WebP photos directly inside the folder (subfolders aren’t included). HEIC, RAW (CR2,
        NEF, ARW, DNG…), GIF, TIFF and video are skipped and counted in each sync. Export them as JPEG to
        include them.
      </Card>

      <Confirm
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Drive?"
        body="Access is revoked at Google and the stored credential deleted. Published galleries keep their indexed photos, but previews that aren’t cached yet and re-syncs will fail until you reconnect. Nothing in Drive changes."
        confirmLabel="Disconnect"
        destructive
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </div>
  );
}
