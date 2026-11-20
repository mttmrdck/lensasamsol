import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Monitor, Redo2, Smartphone, Undo2 } from 'lucide-react';
import { selectCover } from '../../../shared/composition';
import { ApiError, api, post, put } from '../../lib/api';
import type { AdminCollectionDetail, AdminCollectionSummary, GalleryResponse } from '../../../shared/api';
import { sameStyle, styleConfigSchema, type StyleConfig } from '../../../shared/style';
import { GalleryRenderer } from '../../components/gallery/GalleryRenderer';
import { Inspector } from '../../components/admin/Inspector';
import { Button, Confirm, Segmented, cx } from '../../components/ui';

const same = sameStyle;

/** Undo/redo history; rapid changes from the same control (slider drags) coalesce into one step. */
function useHistory(initial: StyleConfig | null) {
  const [state, setState] = useState<{
    past: StyleConfig[];
    present: StyleConfig | null;
    future: StyleConfig[];
  }>({ past: [], present: initial, future: [] });
  const last = useRef<{ key: string; at: number } | null>(null);
  const set = useCallback((next: StyleConfig, key = 'other') => {
    const now = Date.now();
    const coalesce = last.current && last.current.key === key && now - last.current.at < 700;
    last.current = { key, at: now };
    setState((s) => {
      if (!s.present || same(s.present, next)) return s;
      return { past: coalesce ? s.past : [...s.past.slice(-60), s.present], present: next, future: [] };
    });
  }, []);
  const reset = useCallback((value: StyleConfig) => setState({ past: [], present: value, future: [] }), []);
  const undo = useCallback(
    () =>
      setState((s) =>
        s.past.length && s.present
          ? {
              past: s.past.slice(0, -1),
              present: s.past[s.past.length - 1],
              future: [s.present, ...s.future],
            }
          : s,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setState((s) =>
        s.future.length && s.present
          ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
          : s,
      ),
    [],
  );
  return { ...state, set, reset, undo, redo };
}

export default function EditorPage({ target }: { target: 'collection' | 'defaults' }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ---- data
  const detail = useQuery({
    queryKey: ['collection', id],
    queryFn: () => api<AdminCollectionDetail>(`/api/admin/collections/${id}`),
    enabled: target === 'collection',
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ defaultStyle: StyleConfig; studioName: string }>('/api/admin/settings'),
  });
  const list = useQuery({
    queryKey: ['collections'],
    queryFn: () => api<{ collections: AdminCollectionSummary[] }>('/api/admin/collections'),
    enabled: target === 'defaults',
  });
  const previewId =
    target === 'collection'
      ? id
      : list.data?.collections.find((c) => c.photoCount > 0 && c.photoCount < 400)?.id;
  const preview = useQuery({
    queryKey: ['preview', previewId],
    queryFn: () => api<GalleryResponse>(`/api/admin/collections/${previewId}/preview`),
    enabled: !!previewId,
    staleTime: 60_000,
  });

  const savedDraft = target === 'collection' ? detail.data?.styleDraft : settings.data?.defaultStyle;
  const published = target === 'collection' ? detail.data?.stylePublished : settings.data?.defaultStyle;
  const history = useHistory(null);
  const draft = history.present;
  const [savedRef, setSavedRef] = useState<StyleConfig | null>(null);
  const [publishedRef, setPublishedRef] = useState<StyleConfig | null>(null);

  useEffect(() => {
    if (savedDraft && !draft) {
      history.reset(savedDraft);
      setSavedRef(savedDraft);
      setPublishedRef(published ?? null);
    }
  }, [savedDraft, published, draft, history]);

  const dirty = !!draft && !same(draft, savedRef);
  const unpublished = target === 'collection' && !!draft && !same(draft, publishedRef);

  // ---- viewport / canvas
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [panel, setPanel] = useState<'preview' | 'customize'>('customize');
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [frameH, setFrameH] = useState(800);
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFrameH(Math.round(e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview.data]);

  // ---- leave protection
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const backHref = target === 'collection' ? `/admin/collections/${id}` : '/admin';
  const leave = (to: string) => (dirty ? setLeaveTo(to) : navigate(to));

  // ---- save / publish
  const [busy, setBusy] = useState<null | 'save' | 'publish'>(null);
  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const parsed = styleConfigSchema.safeParse(draft);
    if (!parsed.success) return toast.error('Some settings are out of range.');
    setBusy('save');
    try {
      if (target === 'collection') {
        await put(`/api/admin/collections/${id}/style`, { style: parsed.data });
        toast.success('Draft saved. The live gallery is unchanged.');
      } else {
        await put('/api/admin/settings/default-style', { style: parsed.data });
        setPublishedRef(parsed.data);
        toast.success('Studio defaults saved. New collections will start from this design.');
      }
      setSavedRef(parsed.data);
      qc.invalidateQueries({ queryKey: target === 'collection' ? ['collection', id] : ['settings'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Couldn’t save.');
    } finally {
      setBusy(null);
    }
  }, [draft, id, qc, target]);

  const publish = async () => {
    if (!draft) return;
    const parsed = styleConfigSchema.safeParse(draft);
    if (!parsed.success) return toast.error('Some settings are out of range.');
    setBusy('publish');
    try {
      const r = await post<{ live: boolean }>(`/api/admin/collections/${id}/style/publish`, {
        style: parsed.data,
      });
      setSavedRef(parsed.data);
      setPublishedRef(parsed.data);
      qc.invalidateQueries({ queryKey: ['collection', id] });
      qc.invalidateQueries({ queryKey: ['collections'] });
      if (r.live) toast.success('Changes published. Visitors now see the new design.');
      else
        toast.success(
          'Design published. The collection itself is still a draft: publish it from the collection page to go live.',
        );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Couldn’t publish.');
    } finally {
      setBusy(null);
    }
  };

  // ---- keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        history.redo();
      } else if (k === 's') {
        e.preventDefault();
        saveDraft();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [history, saveDraft]);

  const title = target === 'collection' ? (detail.data?.title ?? '…') : 'Appearance defaults';
  const status = !draft
    ? ''
    : dirty
      ? 'Unsaved changes'
      : target === 'defaults'
        ? 'Saved'
        : unpublished
          ? 'Draft saved, not published'
          : 'Live design';

  const data = preview.data;
  const loadError = detail.isError || preview.isError || settings.isError;
  const photos = useMemo(() => data?.photos ?? [], [data]);

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-mat text-ink">
      {/* 52px studio bar */}
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
        <button
          type="button"
          onClick={() => leave(backHref)}
          className="flex h-9 items-center gap-1.5 rounded-ui px-2 text-[13px] text-slate hover:bg-subtle hover:text-ink"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span className="hidden md:inline">{target === 'collection' ? 'Collection' : 'Dashboard'}</span>
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-line pl-3">
          <span className="truncate text-[14px] font-medium">{title}</span>
          {status && (
            <span
              className={cx(
                'hidden shrink-0 items-center gap-1.5 text-[12px] sm:flex',
                dirty ? 'text-warn' : 'text-slate',
              )}
              aria-live="polite"
            >
              <span
                className={cx(
                  'h-1.5 w-1.5 rounded-full',
                  dirty ? 'bg-warn' : unpublished ? 'bg-muted' : 'bg-ok',
                )}
                aria-hidden="true"
              />
              {status}
            </span>
          )}
        </div>
        <div className="hidden w-[176px] md:block">
          <Segmented
            label="Preview size"
            value={viewport}
            onChange={setViewport}
            options={[
              {
                value: 'desktop',
                label: (
                  <>
                    <Monitor size={14} aria-hidden="true" /> Desktop
                  </>
                ),
              },
              {
                value: 'mobile',
                label: (
                  <>
                    <Smartphone size={14} aria-hidden="true" /> Mobile
                  </>
                ),
              },
            ]}
          />
        </div>
        <div className="flex items-center">
          <button
            type="button"
            onClick={history.undo}
            disabled={!history.past.length}
            className="grid h-9 w-9 place-items-center rounded-ui text-slate hover:bg-subtle hover:text-ink disabled:opacity-30"
            aria-label="Undo (Cmd+Z)"
            title="Undo (⌘Z)"
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            onClick={history.redo}
            disabled={!history.future.length}
            className="grid h-9 w-9 place-items-center rounded-ui text-slate hover:bg-subtle hover:text-ink disabled:opacity-30"
            aria-label="Redo (Shift+Cmd+Z)"
            title="Redo (⇧⌘Z)"
          >
            <Redo2 size={16} />
          </button>
        </div>
        <span className="hidden sm:contents">
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)} disabled={!dirty}>
            Reset
          </Button>
        </span>
        {target === 'collection' ? (
          <>
            <Button size="sm" onClick={saveDraft} loading={busy === 'save'} disabled={!dirty || !!busy}>
              <span className="sm:hidden">Save</span>
              <span className="hidden sm:inline">Save draft</span>
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={publish}
              loading={busy === 'publish'}
              disabled={!unpublished || !!busy}
              className="relative"
            >
              <span className="sm:hidden">Publish</span>
              <span className="hidden sm:inline">Publish changes</span>
              {unpublished && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-warn"
                  aria-hidden="true"
                />
              )}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={saveDraft}
            loading={busy === 'save'}
            disabled={!dirty || !!busy}
          >
            Save defaults
          </Button>
        )}
      </header>

      {/* Below lg: preview/customize toggle */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 lg:hidden">
        <div className="w-[200px]">
          <Segmented
            label="Panel"
            value={panel}
            onChange={setPanel}
            options={[
              { value: 'preview', label: 'Preview' },
              { value: 'customize', label: 'Customize' },
            ]}
          />
        </div>
        <div className="ml-auto w-[148px] md:hidden">
          <Segmented
            label="Preview size"
            value={viewport}
            onChange={setViewport}
            options={[
              { value: 'desktop', label: 'Wide' },
              { value: 'mobile', label: 'Phone' },
            ]}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <main
          className="flex min-w-0 flex-1 items-stretch justify-center overflow-hidden p-3 sm:p-5"
          aria-label="Live preview"
        >
          {loadError ? (
            <p className="self-center text-[14px] text-slate">
              The preview couldn’t load. Refresh the page to try again.
            </p>
          ) : !data || !draft ? (
            <div className="h-full w-full animate-pulse rounded-[4px] bg-placeholder" />
          ) : (
            <div
              ref={frameRef}
              data-testid="preview-frame"
              className={cx(
                'relative h-full overflow-hidden bg-white shadow-[0_0_0_1px_rgba(20,20,19,0.08),0_12px_40px_rgba(20,20,19,0.10)] transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)]',
                viewport === 'mobile' ? 'w-[390px] max-w-full rounded-[18px]' : 'w-full rounded-[4px]',
              )}
              // A transform makes position:fixed descendants (the viewer) resolve to this frame, not the editor.
              style={{ transform: 'translateZ(0)' }}
            >
              <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden overscroll-contain">
                <GalleryRenderer
                  studio={data.studio}
                  collection={{ ...data.collection, style: draft }}
                  photos={photos}
                  styleConfig={draft}
                  mode="preview"
                  demoMode={data.demoMode}
                  scrollRoot={scrollRef}
                  vh={`${frameH / 100}px`}
                />
              </div>
            </div>
          )}
        </main>
        <aside
          className={cx(
            'flex w-[300px] shrink-0 flex-col border-l border-line bg-surface',
            'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:h-[52svh] max-lg:w-full max-lg:border-l-0 max-lg:border-t max-lg:shadow-[0_-12px_40px_rgba(20,20,19,0.12)]',
            panel === 'preview' && 'max-lg:hidden',
          )}
          aria-label="Design inspector"
        >
          {draft && (
            <Inspector
              style={draft}
              photos={photos}
              coverId={data?.collection.coverPhotoId ?? null}
              onChange={history.set}
              cover={
                data ? selectCover(photos, draft.composition?.coverId, data.collection.coverPhotoId) : null
              }
              featuredCount={photos.filter((p) => p.featured).length}
              folderButtonAllowed={target === 'defaults' || detail.data?.assignmentMode !== 'selected'}
              target={target}
              onSaveAsDefault={
                target === 'collection'
                  ? async () => {
                      try {
                        await put('/api/admin/settings/default-style', { style: draft });
                        qc.invalidateQueries({ queryKey: ['settings'] });
                        toast.success('Saved as the studio default for new collections.');
                      } catch (e) {
                        toast.error(e instanceof ApiError ? e.message : 'Couldn’t save defaults.');
                      }
                    }
                  : undefined
              }
              onRestorePublished={
                target === 'collection' && publishedRef && unpublished
                  ? () => history.set(publishedRef, 'restore')
                  : undefined
              }
            />
          )}
          {target === 'collection' && !detail.data?.stylePublished && detail.data && (
            <p className="border-t border-line px-4 py-3 text-[12px] text-slate">
              This collection hasn’t been published yet. Publishing changes saves the design that will go
              live.
            </p>
          )}
          {target === 'defaults' && (
            <p className="border-t border-line px-4 py-3 text-[12px] leading-4 text-slate">
              Previewing with {data?.collection.title ?? 'a collection'}. Defaults apply to collections you
              create next; existing ones keep their own design.
            </p>
          )}
        </aside>
      </div>

      <Confirm
        open={!!leaveTo}
        onOpenChange={(o) => !o && setLeaveTo(null)}
        title="Leave without saving?"
        body="Your unsaved design changes will be lost."
        confirmLabel="Leave"
        destructive
        onConfirm={() => {
          const to = leaveTo!;
          setLeaveTo(null);
          history.reset(savedRef!);
          navigate(to);
        }}
      />
      <Confirm
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset unsaved changes?"
        body="The design goes back to the last saved draft. You can still undo this."
        confirmLabel="Reset"
        onConfirm={() => {
          setConfirmReset(false);
          if (savedRef) history.set(savedRef, 'reset');
        }}
      />
    </div>
  );
}
