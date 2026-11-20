import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { galleryResponseSchema } from '../../../shared/api';
import { ApiError, apiParsed } from '../../lib/api';
import { GalleryRenderer } from '../../components/gallery/GalleryRenderer';
import { PublicMessage } from './PublicMessage';
import { ClientGalleryEntrance } from './intro/ClientGalleryEntrance';
import { useGalleryEntrance } from './intro/useGalleryEntrance';

/** Keeps client galleries out of search engines (they are private-by-link, not secret). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

/** /g/:token — one client's gallery, addressed only by its share token. */
export default function CollectionPage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const photoId = params.get('photo');
  useNoIndex();

  const q = useQuery({
    queryKey: ['gallery', token],
    queryFn: () => apiParsed(`/api/public/g/${encodeURIComponent(token)}`, galleryResponseSchema),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    staleTime: 60_000,
  });

  // Cinematic iris entrance: first visit of this gallery in this tab session, never for ?photo= deep links.
  const entrance = useGalleryEntrance(token, !!photoId, q.data, q.isError);

  useEffect(() => {
    if (q.data) document.title = `${q.data.collection.title} | ${q.data.studio.name}`;
  }, [q.data]);

  const onActive = useCallback(
    (id: string | null, how: 'open' | 'step' | 'close') => {
      const next = new URLSearchParams(location.search);
      if (id) next.set('photo', id);
      else next.delete('photo');
      const search = next.toString() ? `?${next}` : '';
      if (how === 'open') navigate({ search }, { state: { fromGrid: true } });
      else if (how === 'step') navigate({ search }, { replace: true, state: location.state });
      // Browser back closes a viewer opened from the grid without losing the gallery scroll position.
      else if ((location.state as { fromGrid?: boolean } | null)?.fromGrid) navigate(-1);
      else navigate({ search }, { replace: true });
    },
    [location.search, location.state, navigate],
  );

  if (q.isPending) {
    // An entrance is likely: hold a dark surface instead of the light skeleton, so there is no white flash.
    if (entrance.state === 'pending')
      return <div className="min-h-svh bg-[#0E0E0D]" aria-busy="true" aria-label="Loading gallery" />;
    return (
      <div className="min-h-svh bg-canvas" aria-busy="true" aria-label="Loading gallery">
        <div className="h-[78svh] animate-pulse bg-placeholder" />
        <div className="mx-auto grid max-w-[1600px] grid-cols-3 gap-3 px-4 pt-12 sm:px-12">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="aspect-[3/2] animate-pulse bg-placeholder" />
          ))}
        </div>
      </div>
    );
  }
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <PublicMessage
        title={notFound ? 'Gallery unavailable' : 'This gallery didn’t load'}
        body={
          notFound
            ? 'This link may have been replaced, or the gallery is not shared right now. Please ask your photographer for a current link.'
            : 'Check your connection and try again.'
        }
        retry={notFound ? undefined : () => q.refetch()}
      />
    );
  }
  const d = q.data;
  // Deep links are gallery-scoped: a photo ID from any other gallery simply doesn't open.
  const validPhoto = photoId && d.photos.some((p) => p.id === photoId) ? photoId : null;
  return (
    <>
      {/* The real gallery is always rendered underneath; the iris reveals it, then gets out of the way. */}
      <div inert={entrance.overlayVisible || undefined}>
        <GalleryRenderer
          studio={d.studio}
          collection={d.collection}
          photos={d.photos}
          styleConfig={d.collection.style}
          mode="public"
          demoMode={d.demoMode}
          shareToken={token}
          activePhotoId={validPhoto}
          onActivePhotoChange={onActive}
          holdTitles={entrance.state === 'off' ? undefined : entrance.holdTitles}
        />
      </div>
      <ClientGalleryEntrance
        state={entrance.state}
        onReveal={entrance.onReveal}
        onOpened={entrance.onOpened}
        onFaded={entrance.onFaded}
        onSkip={entrance.skip}
      />
    </>
  );
}
