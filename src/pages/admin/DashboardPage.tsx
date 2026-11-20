import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import type { AdminCollectionSummary, SyncRun } from '../../../shared/api';
import { relativeTime } from '../../lib/format';
import { Callout, Pill } from '../../components/ui';
import { CollectionCard, PageHeader } from '../../components/admin/bits';

interface Overview {
  counts: { published: number; drafts: number; errors: number; photos: number; lastSync: string | null };
  drive: { connected: boolean; email: string | null; lastError: string | null };
  demoMode: boolean;
  recent: AdminCollectionSummary[];
  runs: Array<SyncRun & { title: string }>;
}

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/api/admin/overview') });
  const d = q.data;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Overview">
        <Link
          to="/admin/collections/new"
          className="inline-flex h-9 items-center gap-2 rounded-ui bg-ink px-3.5 text-[14px] font-medium text-white hover:bg-ink-2"
        >
          <Plus size={16} aria-hidden="true" /> Create Client Gallery
        </Link>
      </PageHeader>

      {d?.drive.lastError && (
        <Callout
          tone="err"
          title="Google Drive needs attention"
          action={
            <Link className="text-[13px] font-medium underline" to="/admin/drive">
              Open Drive Sync
            </Link>
          }
        >
          {d.drive.lastError}
        </Callout>
      )}

      <dl className="tnum grid grid-cols-2 overflow-hidden rounded-ui border border-line bg-surface text-[13px] sm:grid-cols-4 [&>div]:border-line [&>div]:px-4 [&>div]:py-3">
        <div className="border-b border-r sm:border-b-0">
          <dt className="text-slate">Google Drive</dt>
          <dd className="mt-1 truncate font-medium">
            {d ? (
              d.drive.connected ? (
                (d.drive.email ?? 'Connected')
              ) : (
                <Link to="/admin/drive" className="underline">
                  Not connected
                </Link>
              )
            ) : (
              '…'
            )}
          </dd>
        </div>
        <div className="border-b sm:border-b-0 sm:border-r">
          <dt className="text-slate">Shared with clients</dt>
          <dd className="mt-1 font-medium">{d?.counts.published ?? '…'}</dd>
        </div>
        <div className="border-r">
          <dt className="text-slate">Drafts</dt>
          <dd className="mt-1 font-medium">
            {d?.counts.drafts ?? '…'}
            {!!d?.counts.errors && <span className="ml-2 text-err">{d.counts.errors} with sync issues</span>}
          </dd>
        </div>
        <div>
          <dt className="text-slate">Last sync</dt>
          <dd className="mt-1 font-medium">{d ? relativeTime(d.counts.lastSync) : '…'}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Recent client galleries</h2>
          <Link to="/admin/collections" className="text-[13px] text-slate hover:text-ink">
            View all client galleries
          </Link>
        </div>
        {q.isPending ? (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="aspect-[3/2.6] animate-pulse rounded-ui bg-placeholder" />
            ))}
          </div>
        ) : d && d.recent.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-ui border border-dashed border-line-strong p-8">
            <p className="font-display text-[26px]">Your first client gallery starts with a Drive folder.</p>
            <p className="max-w-[56ch] text-[14px] text-slate">
              Paste a Google Drive folder link, choose a cover and publish. Originals stay in Drive.
            </p>
            <Link
              to="/admin/collections/new"
              className="mt-2 inline-flex h-9 items-center rounded-ui bg-ink px-3.5 text-[14px] font-medium text-white"
            >
              Create Client Gallery
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {d?.recent.map((c) => (
              <CollectionCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>

      {d && d.runs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Recent syncs</h2>
          <ul className="divide-y divide-line rounded-ui border border-line bg-surface text-[13px]">
            {d.runs.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
              >
                <Link to={`/admin/collections/${r.collectionId}`} className="font-medium hover:underline">
                  {r.title}
                </Link>
                <span className="tnum flex items-center gap-3 text-slate">
                  {r.status === 'error' ? (
                    <Pill tone="err">Failed</Pill>
                  ) : (
                    <span>{r.trigger === 'demo-seed' ? 'Demo seed' : `+${r.added} / −${r.removed}`}</span>
                  )}
                  {relativeTime(r.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
