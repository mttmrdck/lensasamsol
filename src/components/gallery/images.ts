import { createContext, useContext, useMemo } from 'react';
import type { ImageVariant } from '../../../shared/image-variants';
import { imgUrl, srcSet } from '../../lib/format';

/** Share token of the gallery being rendered (null = owner preview, served via the admin image route). */
export const ImageScope = createContext<string | null>(null);

export function useImages() {
  const token = useContext(ImageScope);
  return useMemo(
    () => ({
      imgUrl: (id: string, v: ImageVariant) => imgUrl(id, v, token),
      srcSet: (id: string, w: number, h: number, maxVariant?: ImageVariant) =>
        srcSet(id, w, h, token, maxVariant),
      /** Original-photo download for visitors; null in the owner preview (no share token, nothing to authorize). */
      downloadUrl: (id: string): string | null => (token ? `/dl/t/${token}/${id}` : null),
    }),
    [token],
  );
}
