import { createContext, useContext, useMemo } from 'react';
import { imgUrl, srcSet } from '../../lib/format';

/** Share token of the gallery being rendered (null = owner preview, served via the admin image route). */
export const ImageScope = createContext<string | null>(null);

export function useImages() {
  const token = useContext(ImageScope);
  return useMemo(
    () => ({
      imgUrl: (id: string, v: 's' | 'm' | 'l') => imgUrl(id, v, token),
      srcSet: (id: string, w: number, h: number) => srcSet(id, w, h, token),
    }),
    [token],
  );
}
