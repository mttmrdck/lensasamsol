import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  Eye,
  ExternalLink,
  Link2,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { ApiError, api, del, patch, post } from '../../lib/api';
import type { AdminCollectionDetail, AdminPhoto } from '../../../shared/api';
import { formatDate, imgUrl, plural, relativeTime } from '../../lib/format';
import {
  Button,
  Callout,
  Confirm,
  Field,
  Input,
  LinkButton,
  Pill,
  Segmented,
  Textarea,
  cx,
} from '../../components/ui';
import { CopyClientLinkButton, StatusPill, clientUrl } from '../../components/admin/bits';

type PhotoFilter = 'all' | 'assigned' | 'unassigned' | 'featured';
type ConfirmKind = null | 'publish' | 'delete' | 'unpublish' | 'regenerate' | 'revoke';

export default function CollectionDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const key = ['collection', id];
  const curationKey = ['curation', id];
  const pendingCuration = useIsMutating({ mutationKey: curationKey });
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<AdminCollectionDetail>(`/api/admin/collections/${id}`),
  });
  const [filter, setFilter] = useState<PhotoFilter>('all');
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: key }),
    qc.invalidateQueries({ queryKey: ['collections'] }),
    qc.invalidateQueries({ queryKey: ['overview'] }),
    qc.invalidateQueries({ queryKey: ['preview', id] }),
  ]);
  const errorToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong.');

  const update = useMutation({
    mutationKey: curationKey,
    mutationFn: (body: Record<string, unknown>) => patch(`/api/admin/collections/${id}`, body),
    onSuccess: refresh,
    onError: errorToast,
  });
  const sync = useMutation({
    mutationKey: curationKey,
    mutationFn: () =>
      post<{
        status: string;
        added: number;
        removed: number;
        updated: number;
        renamed: number;
        skippedUnsupported: number;
        error: string | null;
      }>(`/api/admin/collections/${id}/sync`),
    onSuccess: async (r) => {
      await refresh();
      const parts = [`+${r.added} new`, `${r.removed} removed`];
      if (r.updated) parts.push(`${r.updated} replaced`);
      if (r.renamed) parts.push(`${r.renamed} renamed`);
      if (r.skippedUnsupported) parts.push(`${r.skippedUnsupported} unsupported skipped`);
      if (r.status === 'partial') toast.warning(`Partly synced: ${parts.join(', ')}. ${r.error ?? ''}`);
      else
        toast.success(
          r.added + r.removed + r.updated + r.renamed === 0
            ? 'Already up to date.'
            : `Synced: ${parts.join(', ')}.`,
        );
    },
    onError: async (e) => {
      await refresh();
      errorToast(e);
    },
  });
  const publish = useMutation({
    mutationFn: (on: boolean) => post(`/api/admin/collections/${id}/${on ? 'publish' : 'unpublish'}`),
    onSuccess: (_, on) => {
      refresh();
      setConfirm(null);
      toast.success(
        on
          ? 'Published. Copy the client link to send it.'
          : 'Unpublished. The client link now shows “Gallery unavailable”.',
      );
    },
    onError: errorToast,
  });
  const link = useMutation({
    mutationFn: (action: 'generate' | 'revoke') =>
      action === 'revoke'
        ? del<{ replaced?: boolean }>(`/api/admin/collections/${id}/link`)
        : post<{ replaced?: boolean }>(`/api/admin/collections/${id}/link`),
    onSuccess: (r, action) => {
      refresh();
      setConfirm(null);
      if (action === 'revoke')
        toast.success('Link revoked. Nobody can open this gallery until you generate a new link.');
      else
        toast.success(
          r.replaced ? 'New client link generated. The old link no longer works.' : 'Client link generated.',
        );
    },
    onError: errorToast,
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/admin/collections/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Client gallery deleted. Google Drive was not changed.');
      navigate('/admin/collections');
    },
    onError: errorToast,
  });
  const photoPatch = useMutation({
    mutationKey: curationKey,
    mutationFn: ({ photoId, body }: { photoId: string; body: { assigned?: boolean; featured?: boolean } }) =>
      patch(`/api/admin/collections/${id}/photos/${photoId}`, body),
    onMutate: async ({ photoId, body }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AdminCollectionDetail>(key);
      if (prev) {
        qc.setQueryData<AdminCollectionDetail>(key, {
          ...prev,
          photos: prev.photos.map((p) =>
            p.id === photoId
              ? { ...p, ...body, featured: body.assigned === false ? false : (body.featured ?? p.featured) }
              : p,
          ),
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      errorToast(e);
    },
    onSettled: refresh,
  });
  const bulk = useMutation({
    mutationKey: curationKey,
    mutationFn: (body: { ids: string[]; assigned: boolean }) =>
      post(`/api/admin/collections/${id}/photos/bulk`, body),
    onSuccess: async (_, b) => {
      await refresh();
      toast.success(
        `${plural(b.ids.length, 'photo')} ${b.assigned ? 'assigned to' : 'removed from'} this client gallery.`,
      );
    },
    onError: errorToast,
  });

  const publicationBlocked = pendingCuration > 0 || q.isFetching || q.isError;
  const c = q.data;
  const photos = useMemo(() => {
    const t = search.trim().toLowerCase();
    let all = (c?.photos ?? []).filter((p) => !t || p.filename.toLowerCase().includes(t));
    if (filter === 'assigned') all = all.filter((p) => p.assigned);
    if (filter === 'unassigned') all = all.filter((p) => !p.assigned);
    if (filter === 'featured')
      all = all.filter((p) => p.featured).sort((a, b) => (a.featuredOrder ?? 0) - (b.featuredOrder ?? 0));
    return all;
  }, [c, filter, search]);

  useEffect(() => {
    if (c) document.title = `${c.clientName ?? c.title} | lensasamsol studio`;
  }, [c]);
  const hasData = !!c;
  useEffect(() => {
    if (hasData && location.hash === '#assign')
      document.getElementById('assign')?.scrollIntoView({ block: 'start' });
  }, [hasData, location.hash]);

  if (q.isPending) return <div className="h-64 animate-pulse rounded-ui bg-placeholder" />;
  if (q.isError || !c) {
    return (
      <Callout
        tone="err"
        title="Client gallery not found"
        action={
          <Link to="/admin/collections" className="text-[13px] underline">
            Back to client galleries
          </Link>
        }
      >
        It may have been deleted.
      </Callout>
    );
  }
  const live = c.status === 'published';
  const cover = c.photos.find((p) => p.id === c.cover?.id);
  const assignedCount = c.photos.filter((p) => p.assigned).length;
  const featuredCount = c.photos.filter((p) => p.featured).length;
  const shownAssignable = photos.filter((p) => !p.assigned).map((p) => p.id);
  const shownRemovable = photos.filter((p) => p.assigned).map((p) => p.id);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-line pb-5">
        <Link
          to="/admin/collections"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] text-slate hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden="true" /> Client Galleries
        </Link>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <InlineText
              label="Client name"
              value={c.clientName ?? ''}
              placeholder="Add client name"
              onSave={(clientName) => update.mutate({ clientName: clientName || null })}
              className="text-[13px] font-medium text-slate"
            />
            <div className="flex min-w-0 items-center gap-3">
              <InlineText
                label="Gallery title"
                value={c.title}
                onSave={(title) => title && update.mutate({ title })}
                className="font-display text-[30px] leading-tight tracking-[-0.02em]"
              />
              <StatusPill c={c} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => sync.mutate()}
              loading={sync.isPending}
              icon={<RefreshCw size={15} aria-hidden="true" />}
            >
              {c.source === 'demo' ? 'Re-sync demo folder' : 'Re-sync Drive'}
            </Button>
            <Link
              to={`/admin/collections/${id}/design`}
              className="inline-flex h-9 items-center gap-2 rounded-ui border border-line bg-surface px-3.5 text-[14px] font-medium hover:bg-subtle"
            >
              <Palette size={15} aria-hidden="true" /> Customize Design
            </Link>
            <Link
              to={`/admin/collections/${id}/preview`}
              className="inline-flex h-9 items-center gap-2 rounded-ui border border-line bg-surface px-3.5 text-[14px] font-medium hover:bg-subtle"
            >
              <Eye size={15} aria-hidden="true" /> Preview Client Experience
            </Link>
            {live ? (
              <Button onClick={() => setConfirm('unpublish')}>Unpublish</Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => { if (!publicationBlocked) setConfirm('publish'); }}
                loading={publish.isPending}
                disabled={c.photoCount === 0 || publicationBlocked}
                title={c.photoCount === 0 ? 'Assign photos to this client first' : undefined}
              >
                Publish
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Client link */}
      <section
        className="flex flex-col gap-3 rounded-ui border border-line bg-surface p-5"
        aria-labelledby="link-h"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="link-h" className="text-[15px] font-semibold">
            Client link
          </h2>
          <span className="text-[12px] text-slate">
            {c.shareToken && c.shareTokenCreatedAt
              ? `Generated ${relativeTime(c.shareTokenCreatedAt)}`
              : 'No active link'}
          </span>
        </div>
        {c.shareToken ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                aria-label="Client link"
                value={clientUrl(c.shareToken)}
                onFocus={(e) => e.currentTarget.select()}
                className={cx('font-mono text-[13px]', !live && 'text-muted')}
                data-testid="client-link"
              />
              <div className="flex shrink-0 gap-2">
                <CopyClientLinkButton c={c} />
                {live && (
                  <LinkButton
                    href={clientUrl(c.shareToken)}
                    external
                    icon={<ExternalLink size={15} aria-hidden="true" />}
                  >
                    Open as client
                  </LinkButton>
                )}
              </div>
            </div>
            <p className="text-[12px] leading-5 text-slate">
              {live
                ? 'Send this link to your client. It opens only this gallery and only the photos assigned below. Anyone who has the link can view it, so it works like a private address, not a password.'
                : 'This link starts working as soon as you publish the gallery.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={14} aria-hidden="true" />}
                onClick={() => setConfirm('regenerate')}
              >
                Regenerate link
              </Button>
              <Button size="sm" variant="ghost" className="text-err" onClick={() => setConfirm('revoke')}>
                Revoke link
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] leading-5 text-slate">
              The previous link was revoked, so no link opens this gallery right now.
            </p>
            <Button
              variant="primary"
              icon={<Link2 size={15} aria-hidden="true" />}
              onClick={() => link.mutate('generate')}
              loading={link.isPending}
            >
              Generate Client Link
            </Button>
          </div>
        )}
      </section>

      {c.syncStatus === 'error' && (
        <Callout
          tone="err"
          title="Google Drive access interrupted"
          action={
            <>
              {c.folderUrl && (
                <LinkButton href={c.folderUrl} external size="sm">
                  Check folder in Drive
                </LinkButton>
              )}
              <Button size="sm" onClick={() => sync.mutate()} loading={sync.isPending}>
                Retry sync
              </Button>
            </>
          }
        >
          {c.syncError} The gallery keeps showing the last successfully indexed photos.
        </Callout>
      )}
      {c.syncStatus === 'partial' && (
        <Callout tone="warn" title="Partly synced">
          {c.syncError}
        </Callout>
      )}
      {c.source === 'drive' && c.assignmentMode === 'selected' && (
        <Callout tone="neutral" title="Shared source folder: check Drive sharing">
          This gallery shows only the photos you assign, and its Drive buttons open individual files, never
          the folder. Google Drive sharing is separate: if the whole folder is shared as “Anyone with the
          link”, anyone who gets that folder link sees every file in it. For strict separation, share each
          client’s files individually (or use one folder per client) and keep the folder itself restricted.
        </Callout>
      )}
      {c.source === 'drive' && c.folderAccess === 'restricted' && c.assignmentMode === 'all' && (
        <Callout tone="warn" title="Clients may see “Request access” in Drive">
          This folder isn’t shared as “Anyone with the link”, so the Drive buttons will ask your client to
          request access. Share the folder (or the individual files) as Viewer if they should open originals
          directly.
        </Callout>
      )}
      {c.source === 'demo' && (
        <Callout tone="neutral" title="Demo gallery">
          Indexed from bundled fixture images, not Google Drive. Photo buttons open each image’s source page
          instead of a Drive file.
        </Callout>
      )}
      {c.hasUnpublishedStyle && (
        <Callout
          tone="warn"
          title="Design changes are saved as a draft"
          action={
            <Link to={`/admin/collections/${id}/design`} className="text-[13px] font-medium underline">
              Review and publish
            </Link>
          }
        >
          Your client still sees the previously published design.
        </Callout>
      )}

      {/* Details */}
      <section className="grid gap-6 rounded-ui border border-line bg-surface p-5 lg:grid-cols-[200px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="aspect-[3/2] w-full bg-placeholder">
            {cover && <img src={imgUrl(cover.id, 's')} alt="Cover" className="h-full w-full object-cover" />}
          </div>
          <p className="text-[12px] text-slate">Cover: use the star on any assigned photo to change it.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Event date" htmlFor="ev">
            <Input
              id="ev"
              type="date"
              defaultValue={c.eventDate ?? ''}
              onBlur={(e) =>
                e.target.value !== (c.eventDate ?? '') && update.mutate({ eventDate: e.target.value || null })
              }
            />
          </Field>
          <Field label="Location or subtitle" htmlFor="loc">
            <Input
              id="loc"
              defaultValue={c.location ?? ''}
              maxLength={140}
              onBlur={(e) =>
                e.target.value !== (c.location ?? '') && update.mutate({ location: e.target.value || null })
              }
            />
          </Field>
          <div className="md:col-span-2">
            <Field
              label="Message to the client"
              htmlFor="desc"
              hint="Shown under the cover when the design has descriptions turned on."
            >
              <Textarea
                id="desc"
                rows={3}
                defaultValue={c.description ?? ''}
                maxLength={2000}
                onBlur={(e) =>
                  e.target.value !== (c.description ?? '') &&
                  update.mutate({ description: e.target.value || null })
                }
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <span className="text-[13px] font-medium">Which photos does this client get?</span>
            <div className="max-w-[440px]">
              <Segmented
                label="Which photos does this client get?"
                value={c.assignmentMode}
                onChange={(assignmentMode) => update.mutate({ assignmentMode })}
                options={[
                  { value: 'all', label: 'Every photo in the folder' },
                  { value: 'selected', label: 'Only photos I choose' },
                ]}
              />
            </div>
            <p className="text-[12px] leading-5 text-slate">
              {c.assignmentMode === 'all'
                ? 'New files added to the Drive folder join this gallery on the next sync.'
                : 'New files added to the shared folder stay out of this gallery until you assign them.'}{' '}
              Source:{' '}
              {c.folderUrl ? (
                <a
                  href={c.folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-ink"
                >
                  {c.driveFolderName ?? 'Google Drive folder'}
                </a>
              ) : (
                c.driveFolderName
              )}
              , synced {relativeTime(c.lastSyncedAt)}
              {c.lastSyncedAt && ` (${formatDate(c.lastSyncedAt.slice(0, 10), 'short')})`}.
            </p>
          </div>
        </div>
      </section>

      {/* Assign Photos */}
      <section id="assign" className="flex scroll-mt-6 flex-col gap-4" aria-labelledby="assign-h">
        <div className="flex flex-col gap-1">
          <h2 id="assign-h" className="text-[18px] font-semibold tracking-[-0.01em]">
            Assign Photos
          </h2>
          <p className="tnum text-[13px] text-slate" data-testid="assign-summary">
            <span className="font-medium text-ink">{assignedCount} assigned to this client</span>
            {c.photos.length - assignedCount > 0 && `, ${c.photos.length - assignedCount} not assigned`},{' '}
            {featuredCount} of 8 featured. Click a photo to add it to or remove it from this client’s gallery.
            Files stay in Drive either way.
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative lg:w-[260px]">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by filename"
              aria-label="Filter photos by filename"
              className="pl-9"
            />
          </div>
          <div className="w-full max-w-[400px]">
            <Segmented<PhotoFilter>
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'assigned', label: 'Assigned' },
                { value: 'unassigned', label: 'Not assigned' },
                { value: 'featured', label: 'Featured' },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <Button
              size="sm"
              disabled={!shownAssignable.length || bulk.isPending}
              onClick={() => bulk.mutate({ ids: shownAssignable, assigned: true })}
              icon={<Plus size={14} aria-hidden="true" />}
            >
              Assign shown ({shownAssignable.length})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!shownRemovable.length || bulk.isPending}
              onClick={() => bulk.mutate({ ids: shownRemovable, assigned: false })}
            >
              Remove shown ({shownRemovable.length})
            </Button>
            <div className="hidden w-[170px] sm:block">
              <Segmented
                label="Density"
                value={density}
                onChange={setDensity}
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'comfortable', label: 'Comfortable' },
                ]}
              />
            </div>
          </div>
        </div>
        <p className="text-[12px] leading-5 text-slate">
          Featured flags remain available for your curation. The selected cover leads the client gallery. Only assigned
          photos can be the cover or featured.
        </p>

        {c.photos.length === 0 ? (
          <div className="rounded-ui border border-dashed border-line-strong px-6 py-12 text-center">
            <p className="text-[15px] font-medium">No photos indexed yet</p>
            <p className="mt-1 text-[13px] text-slate">
              Add JPEG, PNG or WebP files to the folder, then re-sync.
            </p>
          </div>
        ) : photos.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-slate">No photos match.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Photos in the source folder">
            {photos.map((p) => (
              <PhotoTile
                key={p.id}
                p={p}
                h={density === 'compact' ? 112 : 168}
                isCover={p.id === c.cover?.id}
                onToggle={() => photoPatch.mutate({ photoId: p.id, body: { assigned: !p.assigned } })}
                onCover={() =>
                  update.mutate({ coverPhotoId: p.id }, { onSuccess: () => toast.success('Cover updated') })
                }
                onFeature={() => photoPatch.mutate({ photoId: p.id, body: { featured: !p.featured } })}
                canFeature={p.featured || featuredCount < 8}
              />
            ))}
            <li className="flex-[10_1_0%]" aria-hidden="true" />
          </ul>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Sync history</h2>
          <ul className="divide-y divide-line rounded-ui border border-line bg-surface text-[13px]">
            {c.recentSyncs.length === 0 && <li className="px-4 py-3 text-slate">No syncs yet.</li>}
            {c.recentSyncs.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="tnum">
                    {r.status === 'error' ? (
                      <Pill tone="err">Failed</Pill>
                    ) : r.status === 'partial' ? (
                      <Pill tone="warn">Partial</Pill>
                    ) : r.trigger === 'demo-seed' ? (
                      'Demo seed'
                    ) : (
                      `+${r.added} new, ${r.removed} removed, ${r.updated} replaced`
                    )}
                  </span>
                  <span className="text-slate">{relativeTime(r.startedAt)}</span>
                </div>
                {r.error && <span className="text-[12px] text-err">{r.error}</span>}
                {r.skippedUnsupported > 0 && (
                  <span className="text-[12px] text-slate">
                    {r.skippedUnsupported} unsupported files skipped
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Remove from this app</h2>
          <div className="flex flex-col items-start gap-3 rounded-ui border border-line bg-surface p-4 text-[13px] leading-5 text-slate">
            <p>
              Deleting removes this client gallery, its link, photo assignments and design. Your Google Drive
              folder and every original photo stay exactly as they are.
            </p>
            <Button
              variant="secondary"
              className="text-err"
              icon={<Trash2 size={15} aria-hidden="true" />}
              onClick={() => setConfirm('delete')}
            >
              Delete client gallery
            </Button>
          </div>
        </div>
      </section>

      <Confirm
        open={confirm === 'publish'}
        onOpenChange={open => !open && setConfirm(null)}
        title={`Share “${c.title}” with your client?`}
        body={`${assignedCount} assigned photographs will become visible to anyone with this gallery’s link. Confirm that this selection belongs to ${c.clientName || 'the intended client'}. Use Preview Client Experience to review the photographs before publishing.`}
        confirmLabel="Publish gallery"
        loading={publish.isPending || publicationBlocked}
        onConfirm={() => { if (!publicationBlocked) publish.mutate(true); }}
      />
      <Confirm
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete “${c.clientName ?? c.title}”?`}
        body="The client link stops working and this gallery’s assignments and design are removed from the app. Google Drive is not changed: no files are deleted, moved or unshared."
        confirmLabel="Delete client gallery"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      <Confirm
        open={confirm === 'unpublish'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Unpublish this gallery?"
        body="Your client’s link will show “Gallery unavailable” until you publish again (the same link then works again). Drive sharing doesn’t change."
        confirmLabel="Unpublish"
        loading={publish.isPending}
        onConfirm={() => publish.mutate(false)}
      />
      <Confirm
        open={confirm === 'regenerate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Generate a new client link?"
        body="The current link stops working immediately. You’ll need to send the new link to your client."
        confirmLabel="Generate new link"
        destructive
        loading={link.isPending}
        onConfirm={() => link.mutate('generate')}
      />
      <Confirm
        open={confirm === 'revoke'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Revoke the client link?"
        body="The link stops working immediately and no link opens this gallery until you generate a new one. Images your client already downloaded from Drive, or that their browser cached in the last hour, aren’t affected."
        confirmLabel="Revoke link"
        destructive
        loading={link.isPending}
        onConfirm={() => link.mutate('revoke')}
      />
    </div>
  );
}

function InlineText({
  value,
  onSave,
  label,
  placeholder,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  label: string;
  placeholder?: string;
  className: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      aria-label={label}
      value={v}
      placeholder={placeholder}
      maxLength={140}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() !== value ? onSave(v.trim()) : setV(value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cx(
        'min-w-0 flex-1 rounded-ui border border-transparent bg-transparent px-1 placeholder:text-muted hover:border-line focus:border-ink focus:outline-none',
        className,
      )}
    />
  );
}

function PhotoTile({
  p,
  h,
  isCover,
  onToggle,
  onCover,
  onFeature,
  canFeature,
}: {
  p: AdminPhoto;
  h: number;
  isCover: boolean;
  onToggle: () => void;
  onCover: () => void;
  onFeature: () => void;
  canFeature: boolean;
}) {
  const ar = p.w / p.h;
  const [broken, setBroken] = useState(false);
  return (
    <li
      className="group relative overflow-hidden bg-placeholder [content-visibility:auto]"
      style={{
        flex: `${ar} 1 ${Math.round(ar * h)}px`,
        height: h,
        containIntrinsicSize: `${Math.round(ar * h)}px ${h}px`,
      }}
      data-assigned={p.assigned}
      data-photo-id={p.id}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={p.assigned}
        aria-label={`${p.filename}: ${p.assigned ? 'assigned. Click to remove from this client gallery' : 'not assigned. Click to assign to this client gallery'}`}
        className="absolute inset-0 block h-full w-full focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ink"
      >
        {broken ? (
          <span className="absolute inset-0 grid place-items-center text-[11px] text-slate">
            Preview unavailable
          </span>
        ) : (
          <img
            src={imgUrl(p.id, 's')}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className={cx(
              'h-full w-full object-cover transition-[opacity,filter] duration-150',
              !p.assigned && 'opacity-40 grayscale-[60%]',
            )}
          />
        )}
      </button>
      <span
        className={cx(
          'pointer-events-none absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border transition-colors',
          p.assigned ? 'border-ink bg-ink text-white' : 'border-white/90 bg-black/25 text-transparent',
        )}
        aria-hidden="true"
      >
        <Check size={13} strokeWidth={2.5} />
      </span>
      <div className="pointer-events-none absolute left-1.5 top-1.5 flex gap-1">
        {isCover && (
          <span className="rounded-[4px] bg-ink px-1.5 py-0.5 text-[10px] font-medium text-white">Cover</span>
        )}
        {p.featured && (
          <span className="rounded-[4px] bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-ink">
            Featured
          </span>
        )}
        {!p.assigned && (
          <span className="rounded-[4px] bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-slate">
            Not in gallery
          </span>
        )}
        {!p.dimsKnown && (
          <span className="rounded-[4px] bg-warn-bg px-1.5 py-0.5 text-[10px] font-medium text-warn">
            No size data
          </span>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 pt-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <span className="truncate font-mono text-[10px] text-white/90">{p.filename}</span>
        <div className="pointer-events-auto flex shrink-0 gap-0.5">
          {p.assigned && (
            <>
              <TileBtn
                label={isCover ? 'Current cover' : 'Set as cover'}
                onClick={onCover}
                disabled={isCover}
                active={isCover}
              >
                <Star size={14} fill={isCover ? 'currentColor' : 'none'} />
              </TileBtn>
              <TileBtn
                label={
                  p.featured
                    ? 'Remove from featured'
                    : canFeature
                      ? 'Feature in opening sequence'
                      : 'Up to 8 featured'
                }
                onClick={onFeature}
                disabled={!canFeature}
                active={p.featured}
              >
                <Sparkles size={14} />
              </TileBtn>
            </>
          )}
          {p.viewUrl && (
            <a
              href={p.viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${p.filename} in Google Drive (new tab)`}
              title="Open Original in Google Drive"
              className="grid h-7 w-7 place-items-center rounded-[4px] bg-white/90 text-ink hover:bg-white"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function TileBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'grid h-7 w-7 place-items-center rounded-[4px] disabled:opacity-50',
        active ? 'bg-ink text-white' : 'bg-white/90 text-ink hover:bg-white',
      )}
    >
      {children}
    </button>
  );
}
