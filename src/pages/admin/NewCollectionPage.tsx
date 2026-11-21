import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, FolderOpen, Loader2, TriangleAlert } from 'lucide-react';
import { ApiError, api, post } from '../../lib/api';
import type { DriveStatus, FolderValidation } from '../../../shared/api';
import { driveFolderUrl, parseDriveFolderInput } from '../../../shared/drive';
import { PRESETS, THEMES, PAIRINGS, type PresetId } from '../../../shared/style';
import { Button, Callout, Confirm, Field, Input, cx } from '../../components/ui';
import { useGoogleFonts } from '../../lib/fonts';
import { plural } from '../../lib/format';
import { openDrivePicker } from '../../lib/picker';

function slugify(s: string) {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || ''
  );
}

const DEMO_CHOICES = [
  ['demo:coast', 'Coastline'],
  ['demo:city', 'Cities'],
  ['demo:portraits', 'Portraits'],
  ['demo:highlands', 'Highlands'],
  ['demo:lights', 'Evening lights'],
  ['demo:archive', '1,200-frame archive'],
  ['demo:empty', 'Empty folder'],
] as const;

export default function NewCollectionPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const drive = useQuery({
    queryKey: ['drive-status'],
    queryFn: () => api<DriveStatus>('/api/admin/drive/status'),
  });
  useGoogleFonts(PRESETS.map((p) => p.patch.type.pairing));

  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [mode, setMode] = useState<'all' | 'selected'>('all');
  const [date, setDate] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [folderInput, setFolderInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [folder, setFolder] = useState<FolderValidation | null>(null);
  const [folderError, setFolderError] = useState<{ message: string; code: string } | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetId>('minimal-archival');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null);
  const reqId = useRef(0);

  const effectiveSlug = slugTouched ? slug : slugify(title);
  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effectiveSlug) && effectiveSlug.length >= 2;

  const validate = async (input: string) => {
    const id = ++reqId.current;
    setValidating(true);
    setFolderError(null);
    try {
      const v = await post<FolderValidation>('/api/admin/drive/validate-folder', { input });
      if (id !== reqId.current) return;
      setFolder(v);
      setCover(v.candidates.find((c) => c.w > c.h)?.fileId ?? v.candidates[0]?.fileId ?? null);
      if (!title && v.name) setTitle(v.name.replace(/\s*\(demo fixtures\)$/, ''));
    } catch (e) {
      if (id !== reqId.current) return;
      setFolder(null);
      setFolderError({
        message: e instanceof ApiError ? e.message : 'Validation failed.',
        code: e instanceof ApiError ? e.code : 'error',
      });
    } finally {
      if (id === reqId.current) setValidating(false);
    }
  };

  // Paste-and-validate: debounce 400ms once the input parses as a folder link or demo key.
  useEffect(() => {
    const v = folderInput.trim();
    if (!v) {
      setFolder(null);
      setFolderError(null);
      return;
    }
    const looksValid = v.startsWith('demo:') || parseDriveFolderInput(v).ok;
    if (!looksValid) return;
    const t = setTimeout(() => validate(v), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderInput]);

  const parseHint = useMemo(() => {
    const v = folderInput.trim();
    if (!v || v.startsWith('demo:')) return null;
    const p = parseDriveFolderInput(v);
    return p.ok ? null : p.reason;
  }, [folderInput]);

  const submit = async (publish: boolean) => {
    if (!folder || !title.trim() || !slugOk || (publish && folder.imageCount === 0)) return;
    setSaving(publish ? 'publish' : 'draft');
    try {
      const res = await post<{
        id: string;
        shareToken: string;
        published: boolean;
        sync: { status: string; added: number; error: string | null };
      }>('/api/admin/collections', {
        title: title.trim(),
        clientName: clientName.trim() || null,
        assignmentMode: mode,
        eventDate: date || null,
        slug: effectiveSlug,
        folderInput:
          folder.source === 'demo' ? folder.folderId : driveFolderUrl(folder.folderId, folder.resourceKey),
        presetId: preset,
        coverFileId: cover,
        publish,
      });
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      if (res.sync.status === 'error')
        toast.error(`Client gallery saved, but indexing failed: ${res.sync.error}`);
      else if (mode === 'selected')
        toast.success(
          `Client gallery created. ${plural(res.sync.added, 'photo')} indexed: now assign this client’s photos.`,
        );
      else
        toast.success(
          `${res.published ? 'Published: copy the client link to send it.' : 'Draft saved.'} ${plural(res.sync.added, 'photo')} assigned.`,
        );
      navigate(`/admin/collections/${res.id}${mode === 'selected' ? '#assign' : ''}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Couldn’t create the client gallery.');
      setSaving(null);
    }
  };

  const pick = async () => {
    try {
      const picked = await openDrivePicker();
      if (picked) setFolderInput(driveFolderUrl(picked.id, picked.resourceKey));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Google Picker failed to open.');
    }
  };

  const canDraft = !!folder && !!title.trim() && slugOk;
  const ready = canDraft && !!folder && folder.imageCount > 0;

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-8 pb-28">
      <div className="flex flex-col gap-3">
        <Link
          to="/admin/collections"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] text-slate hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden="true" /> Client Galleries
        </Link>
        <h1 className="font-display text-[34px] leading-tight tracking-[-0.015em]">Create Client Gallery</h1>
        <p className="text-[14px] text-slate">
          Each client gets a private gallery with its own link, showing only the photos you assign. Originals
          stay in Google Drive.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-ui border border-line bg-surface p-6">
        <h2 className="text-[13px] font-semibold">Client</h2>
        <Field label="Client name" htmlFor="client" hint="For your records only. Clients don’t see it.">
          <Input
            id="client"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Aisyah Rahim"
            maxLength={120}
          />
        </Field>
        <Field label="Gallery title" htmlFor="title" hint="Shown to the client on the gallery cover.">
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Elena & Marcus"
            maxLength={140}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event date" htmlFor="date">
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            label="Internal name"
            htmlFor="slug"
            error={effectiveSlug && !slugOk ? 'Use lowercase letters, numbers and single hyphens.' : null}
            hint="Only you see this. The client link is a private random address made for this gallery."
          >
            <Input
              id="slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              aria-invalid={!!effectiveSlug && !slugOk}
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-ui border border-line bg-surface p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[13px] font-semibold">Google Drive folder</h2>
          {drive.data && !drive.data.connected && (
            <Link to="/admin/drive" className="text-[12px] text-slate underline hover:text-ink">
              Connect Google Drive
            </Link>
          )}
        </div>
        <Field
          label="Folder link"
          htmlFor="folder"
          error={
            parseHint === 'not-folder'
              ? 'That link points to a single file. Paste the folder link instead.'
              : parseHint === 'not-drive' && folderInput.length > 12
                ? 'Paste a link that starts with https://drive.google.com/drive/folders/'
                : null
          }
          hint="In Drive, right-click the folder, choose Share, then Copy link."
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="folder"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                spellCheck={false}
                autoComplete="off"
                className="pr-9 font-mono text-[13px]"
              />
              {validating && (
                <Loader2
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate"
                  aria-label="Checking folder"
                />
              )}
            </div>
            {drive.data?.pickerAvailable && (
              <Button type="button" onClick={pick} icon={<FolderOpen size={15} aria-hidden="true" />}>
                Choose
              </Button>
            )}
          </div>
        </Field>
        {drive.data?.demoMode && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-slate">
              Demo mode: try a sample folder (fixture images, not Google Drive).
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_CHOICES.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFolderInput(key)}
                  className={cx(
                    'h-7 rounded-full border px-2.5 text-[12px]',
                    folderInput === key
                      ? 'border-ink bg-ink text-white'
                      : 'border-line text-slate hover:border-ink hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {folderError && (
          <Callout
            tone="err"
            title={
              folderError.code === 'drive_not_connected' || folderError.code === 'drive_config'
                ? 'Google Drive isn’t connected'
                : folderError.code === 'drive_not_found'
                  ? 'Folder not found or not shared with your account'
                  : 'This folder can’t be used yet'
            }
            action={
              folderError.code.startsWith('drive_') && folderError.code !== 'drive_not_found' ? (
                <Link to="/admin/drive" className="text-[13px] font-medium underline">
                  Open Drive Sync
                </Link>
              ) : (
                <Button size="sm" onClick={() => validate(folderInput)}>
                  Try again
                </Button>
              )
            }
          >
            {folderError.message}
          </Callout>
        )}

        {folder && (
          <div className="flex flex-col gap-3 rounded-ui border border-line bg-canvas p-4" aria-live="polite">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">{folder.name}</p>
                <p className="tnum mt-0.5 text-[13px] text-slate">
                  {plural(folder.imageCount, 'supported image')} found
                  {folder.unsupportedCount > 0 &&
                    ` and ${folder.unsupportedCount} skipped (${folder.unsupportedKinds.join(', ')})`}
                </p>
              </div>
              {folder.imageCount > 0 ? (
                <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok">
                  <Check size={14} aria-hidden="true" />{' '}
                  {folder.source === 'demo' ? 'Demo folder' : 'Readable'}
                </span>
              ) : (
                <span className="shrink-0 text-[12px] font-medium text-warn">No supported images</span>
              )}
            </div>
            {folder.source === 'drive' && folder.access === 'restricted' && (
              <p className="flex gap-2 text-[13px] leading-5 text-warn">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                Visitors will see “Request access” in Drive. To let them open originals, share this folder as
                “Anyone with the link” (Viewer) in Drive.
              </p>
            )}
            {folder.source === 'drive' && folder.access === 'unknown' && (
              <p className="text-[13px] text-slate">
                Couldn’t read this folder’s sharing settings. Check in Drive that visitors can open it.
              </p>
            )}
            {folder.truncated && (
              <p className="text-[13px] text-warn">
                Very large folder: only the first 20,000 files will be indexed.
              </p>
            )}
            {folder.imageCount === 0 && (
              <p className="text-[13px] text-slate">
                Supported formats are JPEG, PNG and WebP. HEIC, RAW, GIF and video are skipped.
              </p>
            )}
          </div>
        )}
      </section>

      {folder && (
        <section className="flex flex-col gap-3 rounded-ui border border-line bg-surface p-6">
          <h2 className="text-[13px] font-semibold">Which photos does this client get?</h2>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label="Which photos does this client get?"
          >
            {(
              [
                [
                  'all',
                  'Every photo in this folder',
                  'The folder holds only this client’s photos. New files you add join the gallery on the next sync.',
                ],
                [
                  'selected',
                  'Only photos I choose',
                  'The folder is shared by several clients. Nothing is shown until you assign photos to this client.',
                ],
              ] as const
            ).map(([value, label, body]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cx(
                  'flex flex-col gap-1 rounded-ui border p-3.5 text-left transition-colors',
                  mode === value ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong',
                )}
              >
                <span className="text-[14px] font-medium">{label}</span>
                <span className="text-[12px] leading-4 text-slate">{body}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {folder && folder.imageCount > 0 && (
        <>
          <section className="flex flex-col gap-4 rounded-ui border border-line bg-surface p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold">Cover photograph</h2>
              <span className="text-[12px] text-slate">
                {mode === 'selected' ? 'The cover is assigned to this client' : 'You can change it later'}
              </span>
            </div>
            <div
              className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1"
              role="radiogroup"
              aria-label="Cover photograph"
            >
              {folder.candidates.map((c) => (
                <button
                  key={c.fileId}
                  type="button"
                  role="radio"
                  aria-checked={cover === c.fileId}
                  aria-label={c.name}
                  onClick={() => setCover(c.fileId)}
                  className={cx(
                    'relative h-24 shrink-0 bg-placeholder outline-offset-2',
                    cover === c.fileId ? 'outline-2 outline-ink' : 'opacity-80 hover:opacity-100',
                  )}
                  style={{ aspectRatio: `${c.w} / ${c.h}` }}
                >
                  <img src={c.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  {cover === c.fileId && (
                    <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-white">
                      <Check size={12} aria-hidden="true" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-4 rounded-ui border border-line bg-surface p-6">
            <h2 className="text-[13px] font-semibold">Starting design</h2>
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label="Starting design"
            >
              {PRESETS.map((p) => {
                const t = THEMES[p.patch.color.theme];
                const f = PAIRINGS[p.patch.type.pairing];
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={preset === p.id}
                    onClick={() => setPreset(p.id)}
                    className={cx(
                      'flex flex-col overflow-hidden rounded-ui border text-left transition-colors',
                      preset === p.id ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="flex h-16 items-end px-3 pb-2" style={{ background: t.bg, color: t.fg }}>
                      <span
                        style={{
                          fontFamily: f.display,
                          fontWeight: f.displayWeight,
                          letterSpacing: f.displayTracking,
                        }}
                        className="text-[24px] leading-none"
                      >
                        Aa
                      </span>
                    </span>
                    <span className="flex flex-col gap-0.5 border-t border-line px-3 py-2">
                      <span className="text-[13px] font-medium">{p.name}</span>
                      <span className="text-[11px] leading-4 text-slate">{p.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      <Confirm open={confirmPublish} onOpenChange={setConfirmPublish}
        title={`Publish “${title.trim()}”?`}
        body={`Every supported photograph in “${folder?.name ?? 'this folder'}” will be shared with ${clientName.trim() || 'the intended client'}. The scan found ${folder?.imageCount ?? 0} photographs. To review individual assignments first, cancel and choose Create & Assign Photos.`}
        confirmLabel="Publish gallery" loading={!!saving} onConfirm={() => submit(true)} />
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 backdrop-blur lg:left-[240px]">
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-3 px-4 py-3">
          <p className="hidden text-[12px] text-slate sm:block">
            {!folder
              ? 'Add a folder to continue.'
              : !title.trim()
                ? 'Add a title to continue.'
                : folder.imageCount === 0
                  ? 'No supported images yet: you can save a draft and sync later.'
                  : 'Ready.'}
          </p>
          <div className="ml-auto flex gap-2">
            {mode === 'all' && (
              <Button
                onClick={() => submit(false)}
                disabled={!canDraft || !!saving}
                loading={saving === 'draft'}
              >
                Save as draft
              </Button>
            )}
            {mode === 'selected' ? (
              <Button
                variant="primary"
                onClick={() => submit(false)}
                disabled={!canDraft || !!saving}
                loading={saving === 'draft'}
              >
                Create &amp; Assign Photos
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => setConfirmPublish(true)}
                disabled={!ready || !!saving}
                loading={saving === 'publish'}
              >
                Publish &amp; Generate Link
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
