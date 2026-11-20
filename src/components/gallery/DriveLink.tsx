import { ArrowUpRight } from 'lucide-react';
import type { PublicPhoto } from '../../../shared/api';
import type { StyleConfig } from '../../../shared/style';

export function photoActionLabel(style: StyleConfig) {
  return style.actions.label === 'download' ? 'Download via Google Drive' : 'Open Original in Google Drive';
}

export function folderActionLabel(style: StyleConfig) {
  return style.actions.label === 'download'
    ? 'Download full collection via Google Drive'
    : 'Open full collection in Google Drive';
}

export const DRIVE_HELPER = 'Opens Google Drive in a new tab. You can download the original there.';

/** Where a photo's external action goes: its Drive file, a demo fixture's source page, or nowhere. */
export function photoTarget(photo: PublicPhoto): { href: string; kind: 'drive' | 'demo' } | null {
  if (photo.driveUrl) return { href: photo.driveUrl, kind: 'drive' };
  if (photo.credit) return { href: photo.credit.url, kind: 'demo' };
  return null;
}

export function ExternalArrow({ size = 15 }: { size?: number }) {
  return <ArrowUpRight size={size} strokeWidth={1.75} aria-hidden="true" />;
}
