import { useEffect } from 'react';
import { fontHref, type PairingId } from '../../shared/style';

const loaded = new Set<string>();

/** Injects Google Fonts stylesheets on demand — public pages only load the pairing they use. */
export function useGoogleFonts(ids: PairingId[]) {
  const href = fontHref(ids);
  useEffect(() => {
    if (loaded.has(href)) return;
    loaded.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }, [href]);
}
