import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { zipBaseName } from '../../../shared/download';
import { plural } from '../../lib/format';
import {
  downloadAll,
  pickZipTarget,
  supportsDiskStreaming,
  type BulkResult,
  type DownloadPhoto,
  type PartInfo,
} from '../../lib/bulk-download';
import { useImages } from './images';

type State =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number; toDisk: boolean }
  | { kind: 'part'; part: PartInfo }
  | { kind: 'done'; result: BulkResult }
  | { kind: 'error'; message: string };

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;

/** Saves a finished in-memory ZIP part through a real click, which every browser (including iPhone) allows. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** "Download all": one ZIP of this gallery's photographs, in the photographer's order. Public galleries only. */
export function DownloadAll({
  photos,
  title,
  variant = 'inline',
}: {
  photos: DownloadPhoto[];
  title: string;
  /** `bar`/`masthead`: sits in the gallery header (button top-right, status beneath it). */
  variant?: 'inline' | 'bar' | 'masthead';
}) {
  const { downloadUrl } = useImages();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  if (!photos.length || !downloadUrl(photos[0].id)) return null;

  const start = async () => {
    // The destination must be chosen straight from the click, before any await (browser activation rules).
    const zipName = zipBaseName(title);
    let target: FileSystemFileHandle | undefined;
    if (supportsDiskStreaming()) {
      try {
        const picked = await pickZipTarget(zipName);
        if (!picked) return; // the visitor cancelled the save dialog
        target = picked;
      } catch {
        target = undefined;
      }
    }
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: 'working', done: 0, total: photos.length, toDisk: !!target });
    try {
      const result = await downloadAll({
        photos,
        zipName,
        urlFor: (id) => downloadUrl(id)!,
        signal: controller.signal,
        target,
        onProgress: (p) =>
          setState((s) => (s.kind === 'working' ? { ...s, done: p.done, total: p.total } : s)),
        deliverPart: (part) =>
          new Promise<void>((resolve) => {
            release.current = () => {
              saveBlob(part.blob, part.name);
              release.current = null;
              setState({ kind: 'working', done: 0, total: photos.length, toDisk: false });
              resolve();
            };
            setState({ kind: 'part', part });
          }),
      });
      setState({ kind: 'done', result });
    } catch (e) {
      if (controller.signal.aborted) setState({ kind: 'idle' });
      else
        setState({
          kind: 'error',
          message: (e as Error).message || 'The download stopped. Nothing was lost; you can try again.',
        });
    }
  };
  const cancel = () => {
    abort.current?.abort();
    release.current = null;
    setState({ kind: 'idle' });
  };

  return (
    <div
      className={variant === 'bar' ? 'g-dl g-dl-bar' : variant === 'masthead' ? 'g-dl g-dl-masthead' : 'g-dl'}
      data-testid="download-all"
    >
      {(state.kind === 'idle' || state.kind === 'done' || state.kind === 'error') && (
        <button
          type="button"
          className="g-dl-btn"
          onClick={start}
          aria-label={
            state.kind === 'done' ? 'Download again' : `Download all (${plural(photos.length, 'photo')})`
          }
          title={`Download all ${plural(photos.length, 'photo')} as a ZIP`}
        >
          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
          {state.kind === 'done'
            ? 'Download again'
            : variant !== 'inline'
              ? 'Download all'
              : `Download all (${plural(photos.length, 'photo')})`}
        </button>
      )}
      <div role="status" aria-live="polite" className="g-dl-note">
        {state.kind === 'working' && (
          <>
            {state.toDisk ? 'Saving to your device' : 'Preparing'}: photo{' '}
            {Math.min(state.done + 1, state.total)} of {state.total}.{' '}
            <button type="button" className="g-dl-link" onClick={cancel}>
              Cancel
            </button>
          </>
        )}
        {state.kind === 'part' && (
          <>
            Part {state.part.index} is ready ({plural(state.part.count, 'photo')}, {mb(state.part.bytes)}).{' '}
            <button type="button" className="g-dl-btn g-dl-save" onClick={() => release.current?.()}>
              Save part {state.part.index}
            </button>{' '}
            <button type="button" className="g-dl-link" onClick={cancel}>
              Stop
            </button>
          </>
        )}
        {state.kind === 'done' &&
          (state.result.failed.length
            ? `Saved ${plural(state.result.saved, 'photo')}. ${plural(state.result.failed.length, 'photo')} could not be added and are listed in DOWNLOAD-ERRORS.txt inside the archive.`
            : `Saved ${plural(state.result.saved, 'photo')}.`)}
        {state.kind === 'error' && state.message}
      </div>
    </div>
  );
}
