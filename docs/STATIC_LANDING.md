# Static client gallery landing redesign

## Problem and direction

The previous portrait opening used a large split text panel, a cropped portrait, oversized headline, an Explore pill, a repeated sticky information bar, and a separate Selected Moments introduction. The new direction is a contemporary minimal photographic exhibition: studio wordmark, one complete selected photograph, its title/subtitle and optional description, quiet metadata, then the automatically arranged gallery through ordinary scrolling.

The user's explicit request to remove Selected Moments takes precedence over the attachment's optional retention. The section is absent from both the client gallery and live preview. Featured selections remain intact and continue to inform cover ranking and composition emphasis.

## What changed

- `src/components/gallery/CoverHero.tsx`: one static opening for photographic cover styles. Title and public introduction sit below the image; no overlays or Explore button. Deliberate typography-only covers still work.
- `src/components/gallery/GalleryRenderer.tsx`: removed the Prologue presentation, repeated sticky bar and All photographs heading. The main grid follows the caption without an intermediate section. Viewer, filmstrip, deep links, focus restoration and existing geometry remain in use.
- `src/styles/index.css`: natural cover sizing, restrained caption, responsive spacing, and no title reveal or image hover zoom. Removed obsolete split/cinematic/toolbar presentation styles. Utility interactions in the viewer and download controls remain supported.
- Browser tests use direct scrolling and cover all required widths. `tests/unit/landing.test.ts` protects subtitle/description visibility. The Node test TypeScript configuration supports rendering the shared React component during tests.
- `scripts/capture-landing.mjs` saves before/after screenshots and checks admin source hashes.

No admin page or inspector source, authentication code, API handler, database migration, dependency or production configuration was changed for this redesign.

## Cover handling and spacing

The existing eligible selected cover flows through the existing `selectCover` and scoped image URLs. No hardcoded or new stock cover is introduced. The image retains its original aspect ratio and reserves its dimensions while loading. Landscape photographs expand toward the gallery width within a viewport height bound. Portraits use a centered natural frame with the caption aligned to the same left edge, eliminating the old adjacent text panel.

Desktop framing uses 32px outer gutters, intermediate widths use 24px, phones use 16px and compact phones use 12px. The caption starts 18–20px after the image, and the main gallery starts 24–28px after the caption. Existing theme, typography, title alignment/scale, date/count/description visibility and bounded cover-height settings remain applied. Subtitle and enabled description both remain visible; the description does not disappear when a subtitle is entered.

Saved legacy split/cinematic settings are retained in data; their photographic opening now uses the requested static stacked presentation. Focal-point values remain saved, but the uncropped natural cover does not use them to crop. Existing sequence settings and the unused Prologue component remain compatible with old data, but no Selected Moments section is rendered.

## Static behavior

The existing one-time camera iris still runs only on eligible public gallery links. Text is already in its final position behind it: no second title fade/slide follows the opening. Image hover scaling is removed for all gallery layout modes. There is no carousel, slideshow, parallax, scroll hijacking or new animation system.

The editor canvas uses exactly the same cover and gallery components, including container-based responsive rules. The surrounding editor and all other admin sources are unchanged, checked against SHA-256 hashes captured before implementation.

## Visual evidence

The screenshot matrix contains landscape (`coast`), portrait (`portraits`), mixed (`highlands`), small (`night`) and 1,200-photo (`archive`) galleries at 1440, 1024, 768, 390 and 360px.

- `screenshots/static-landing/before/`: 25 opening screenshots.
- `screenshots/static-landing/after/`: 25 opening and 25 grid screenshots.
- Compare `before/portraits-1440-hero.png` with `after/portraits-1440-hero.png` for the split-panel replacement.
- Mobile examples: `after/portraits-390-hero.png`, `after/coast-360-hero.png`.
- The current local client URLs are in `screenshots/static-landing/preview-links.json`. Local demo tokens change when browser tests reseed the database, so capture links are refreshed after the final suite.

## Reference review

The supplied [Bottega53](https://www.bottega53.com/), [Format templates](https://www.format.com/website-templates) and [Minimal Gallery](https://minimal.gallery/) pages were accessible for reference review. Format's editorial/mobile template descriptions support the emphasis on adaptable photographic presentation; the final composition follows the user's concrete specification rather than copying a template. The supplied Lana Zrnic page could not be fetched, and the supplied Cargo In-Use path returned 404 in the web tool. No claim of reviewing inaccessible pages is made.

## Validation and limits

Final verification: **83 unit tests passed in 6 files; all 52 browser tests passed.** Typecheck, ESLint, repository-wide Prettier check and production client/Worker build all passed. The complete before/after matrix contains 75 screenshots and the final capture reported zero page errors or horizontal overflow. Admin source hashes match the baseline. Independent review completed; its description-visibility finding was reproduced and corrected. The browser checks cover selected-cover preservation, title placement, natural aspect ratio, removal of Selected Moments/toolbar/Explore, zero post-iris title transition, direct gallery spacing, all five viewports, accurate editor preview, virtualization, client isolation and original-file link targets.

This remains local-only work: no deployment, push or production mutation was performed. Real Google Drive OAuth, sharing, sync and downloads still need authorized real-account validation. Browser automation uses Chromium; physical iOS Safari and WhatsApp's in-app browser remain unverified. Portrait side framing is intentional to preserve the photograph without a destructive crop.

The local preview server remains running at `http://localhost:5188`. Final demo portrait link: `http://localhost:5188/g/6QJSxoOP8RxyWJXQB2gJzGzz`; landscape link: `http://localhost:5188/g/OiAEl6MVh057l6rjRa5omPNS`. These are local demo galleries.
