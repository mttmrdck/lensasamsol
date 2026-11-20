import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminCollectionSummary } from '../../../shared/api';
import { formatDate, imgUrl, relativeTime, srcSet } from '../../lib/format';
import { Pill, cx } from '../ui';

/** The one URL a client receives. It contains only the random share token: no name, slug or ID. */
export function clientUrl(token: string) {
  return `${location.origin}/g/${token}`;
}

export async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
    return true;
  } catch {
    toast.error('Couldn’t access the clipboard. Select the link and copy it manually.');
    return false;
  }
}

export function StatusPill({
  c,
}: {
  c: Pick<AdminCollectionSummary, 'status' | 'syncStatus' | 'shareToken'>;
}) {
  if (c.syncStatus === 'error') return <Pill tone="err">Sync issue</Pill>;
  if (c.syncStatus === 'syncing') return <Pill tone="warn">Syncing</Pill>;
  if (c.status !== 'published') return <Pill>Draft</Pill>;
  return c.shareToken ? <Pill tone="ok">Shared</Pill> : <Pill tone="warn">Link revoked</Pill>;
}

export function SyncLine({ c }: { c: AdminCollectionSummary }) {
  if (c.syncStatus === 'error')
    return <span className="text-err">Sync failed {relativeTime(c.lastSyncedAt)}</span>;
  if (c.syncStatus === 'never') return <span>Not synced yet</span>;
  return <span>Synced {relativeTime(c.lastSyncedAt)}</span>;
}

/** Why a client link can't be copied right now (null = it can). */
export function linkBlocker(c: Pick<AdminCollectionSummary, 'status' | 'shareToken'>): string | null {
  if (c.status !== 'published') return 'Publish the gallery first: draft links don’t open for clients.';
  if (!c.shareToken) return 'The link was revoked. Generate a new client link on the gallery page.';
  return null;
}

export function CopyClientLinkButton({
  c,
  variant = 'solid',
  className,
}: {
  c: Pick<AdminCollectionSummary, 'status' | 'shareToken' | 'title'>;
  variant?: 'solid' | 'icon';
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const blocker = linkBlocker(c);
  return (
    <button
      type="button"
      disabled={!!blocker}
      title={blocker ?? 'Copy the link to send to your client'}
      aria-label={variant === 'icon' ? `Copy client link for ${c.title}` : undefined}
      onClick={async () => {
        if (!c.shareToken) return;
        if (
          await copyText(
            clientUrl(c.shareToken),
            'Client link copied. Paste it into your message to the client.',
          )
        ) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-ui text-[13px] font-medium transition-colors disabled:cursor-not-allowed',
        variant === 'solid'
          ? 'h-9 bg-ink px-3 text-white hover:bg-ink-2 disabled:bg-subtle disabled:text-muted'
          : 'h-8 w-8 text-slate hover:bg-subtle hover:text-ink disabled:opacity-40',
        className,
      )}
    >
      {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      {variant === 'solid' && (done ? 'Copied' : 'Copy Client Link')}
    </button>
  );
}

export function CollectionCard({ c }: { c: AdminCollectionSummary }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-ui border border-line bg-surface transition-colors duration-200 hover:border-line-strong">
      <Link
        to={`/admin/collections/${c.id}`}
        className="block focus-visible:outline-offset-[-2px]"
        aria-label={`Open ${c.clientName ?? c.title}`}
      >
        <div className="relative aspect-[3/2] bg-placeholder">
          {c.cover && (
            <img
              src={imgUrl(c.cover.id, 's')}
              srcSet={srcSet(c.cover.id, c.cover.w, c.cover.h)}
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 40vw, 100vw"
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          )}
          <span className="absolute left-2.5 top-2.5">
            <StatusPill c={c} />
          </span>
        </div>
        <div className="flex flex-col gap-0.5 px-4 pb-3 pt-3.5">
          <p className="truncate text-[12px] font-medium text-slate">{c.clientName ?? 'No client name'}</p>
          <h3 className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{c.title}</h3>
          <p className="tnum flex flex-wrap gap-x-3 text-[13px] text-slate [&>span]:whitespace-nowrap">
            <span>{c.eventDate ? formatDate(c.eventDate, 'short') : 'No date'}</span>
            <span>{c.photoCount.toLocaleString('en-GB')} photos</span>
            {c.assignmentMode === 'selected' && <span>Selected</span>}
            {c.source === 'demo' && <span className="text-muted">Demo</span>}
          </p>
        </div>
      </Link>
      <div className="mt-auto flex flex-col gap-1.5 border-t border-line p-2.5">
        <CopyClientLinkButton c={c} className="w-full" />
        <div className="grid grid-cols-2 gap-1.5">
          <Link
            to={`/admin/collections/${c.id}`}
            className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-ui border border-line px-1 text-[12px] font-medium text-ink hover:bg-subtle"
          >
            Manage Photos
          </Link>
          <Link
            to={`/admin/collections/${c.id}/design`}
            className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-ui border border-line px-1 text-[12px] font-medium text-ink hover:bg-subtle"
          >
            Customize Design
          </Link>
        </div>
        {c.hasUnpublishedStyle && (
          <p className="px-0.5 text-[11px] text-warn">Design changes not published yet</p>
        )}
      </div>
    </article>
  );
}

export function PageHeader({
  title,
  children,
  sub,
}: {
  title: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
        {sub && <p className="text-[13px] text-slate">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
