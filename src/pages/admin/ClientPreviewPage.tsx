import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import type { AdminCollectionDetail, GalleryResponse } from '../../../shared/api';
import { GalleryRenderer } from '../../components/gallery/GalleryRenderer';
import { CopyClientLinkButton } from '../../components/admin/bits';

/**
 * "Preview Client Experience": the exact payload the client receives (assigned photos only), rendered
 * full-screen with the latest saved design. Owner-only; works for drafts and revoked links too.
 */
export default function ClientPreviewPage() {
  const { id = '' } = useParams();
  const preview = useQuery({
    queryKey: ['preview', id],
    queryFn: () => api<GalleryResponse>(`/api/admin/collections/${id}/preview`),
  });
  const detail = useQuery({
    queryKey: ['collection', id],
    queryFn: () => api<AdminCollectionDetail>(`/api/admin/collections/${id}`),
  });

  useEffect(() => {
    document.title = 'Client preview | lensasamsol';
  }, []);

  if (preview.isError || detail.isError) {
    return <p className="p-10 text-[14px] text-slate">This gallery couldn’t be loaded.</p>;
  }
  if (!preview.data || !detail.data) return <div className="min-h-svh animate-pulse bg-placeholder" />;
  const d = preview.data;
  const c = detail.data;
  return (
    <>
      <GalleryRenderer
        studio={d.studio}
        collection={d.collection}
        photos={d.photos}
        styleConfig={d.collection.style}
        mode="preview"
        demoMode={d.demoMode}
      />
      <div
        className="fixed inset-x-3 bottom-3 z-[55] mx-auto flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-white/10 bg-ink/95 px-3 py-2.5 text-[13px] text-white shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur"
        role="region"
        aria-label="Owner preview controls"
      >
        <Link
          to={`/admin/collections/${id}`}
          className="flex h-8 items-center gap-1.5 rounded-ui px-2 hover:bg-white/10"
        >
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </Link>
        <p className="min-w-0 flex-1 leading-5 text-white/80">
          Preview for <span className="text-white">{c.clientName ?? c.title}</span>: only their{' '}
          {d.photos.length} assigned photos, with your latest saved design.
          {c.status !== 'published' && ' Not shared yet: the client link opens after you publish.'}
        </p>
        <CopyClientLinkButton
          c={c}
          className="!bg-white !text-ink hover:!bg-white/90 disabled:!bg-white/20 disabled:!text-white/60"
        />
      </div>
    </>
  );
}
