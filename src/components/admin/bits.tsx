import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DropdownMenu } from 'radix-ui';
import { Check, Copy, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminCollectionSummary } from '../../../shared/api';
import { formatDate, imgUrl, plural, relativeTime, srcSet } from '../../lib/format';
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

function statusLabel(c: Pick<AdminCollectionSummary, 'status' | 'syncStatus' | 'shareToken'>) {
  if (c.syncStatus === 'error') return { text: 'Sync issue', dot: 'bg-err' };
  if (c.syncStatus === 'syncing') return { text: 'Syncing', dot: 'bg-warn' };
  if (c.status !== 'published') return { text: 'Draft', dot: 'bg-muted' };
  return c.shareToken ? { text: 'Published', dot: 'bg-ok' } : { text: 'Link revoked', dot: 'bg-warn' };
}

const menuItem =
  'flex h-9 cursor-pointer select-none items-center rounded-[4px] px-2.5 text-[13px] text-ink outline-none data-[highlighted]:bg-subtle data-[disabled]:cursor-not-allowed data-[disabled]:text-muted';

export function CollectionCard({ c }: { c: AdminCollectionSummary }) {
  const navigate = useNavigate();
  const name = c.clientName ?? c.title;
  const status = statusLabel(c);
  const blocker = linkBlocker(c);
  return (
    <article className="studio-collection group relative flex min-w-0 flex-col gap-2">
      <Link
        to={`/admin/collections/${c.id}`}
        className="flex min-w-0 flex-col gap-2 focus-visible:outline-offset-4"
        aria-label={`Open ${name}`}
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-placeholder">
          {c.cover && (
            <img
              src={imgUrl(c.cover.id, 's')}
              srcSet={srcSet(c.cover.id, c.cover.w, c.cover.h)}
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          <h3 className="studio-collection-title truncate text-[15px] font-medium leading-5 text-ink">{c.title}</h3>
          {c.clientName && <p className="truncate text-[12.5px] leading-4 text-slate">{c.clientName}</p>}
        </div>
      </Link>
      <p className="tnum flex min-w-0 items-center gap-1.5 text-[12.5px] leading-4 text-slate">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', status.dot)} aria-hidden="true" />
        <span className="shrink-0">{status.text}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{plural(c.photoCount, 'photo')}</span>
        {c.eventDate && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{formatDate(c.eventDate, 'short')}</span>
          </>
        )}
      </p>
      {c.hasUnpublishedStyle && <p className="text-[11.5px] text-warn">Design changes not published yet</p>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${name}`}
            className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-surface/95 text-ink opacity-0 shadow-[0_1px_3px_rgba(0,0,0,0.18)] transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[210px] rounded-ui border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          >
            <DropdownMenu.Item className={menuItem} onSelect={() => navigate(`/admin/collections/${c.id}`)}>
              Manage photos
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItem}
              onSelect={() => navigate(`/admin/collections/${c.id}/design`)}
            >
              Customize design
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItem}
              onSelect={() => navigate(`/admin/collections/${c.id}/preview`)}
            >
              Preview client view
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item
              className={menuItem}
              disabled={!!blocker}
              title={blocker ?? undefined}
              onSelect={() => {
                if (c.shareToken)
                  void copyText(
                    clientUrl(c.shareToken),
                    'Client link copied. Paste it into your message to the client.',
                  );
              }}
            >
              Copy client link
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} onSelect={() => navigate(`/admin/collections/${c.id}`)}>
              {c.status === 'published' ? 'Unpublish or regenerate link' : 'Review and publish'}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </article>
  );
}

export function PageHeader({
  title,
  children,
  sub,
  middle,
}: {
  title: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  /** Sits beside the title (e.g. search). */
  middle?: React.ReactNode;
}) {
  return (
    <div className="studio-page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex min-w-0 flex-col">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">{title}</h1>
        {sub && <p className="text-[13px] text-slate">{sub}</p>}
      </div>
      {middle && <div className="min-w-0 sm:flex-1 sm:max-w-[360px]">{middle}</div>}
      {children && <div className="flex flex-wrap gap-2 sm:ml-auto">{children}</div>}
    </div>
  );
}
