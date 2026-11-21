# Design

**Direction:** a private exhibition, not an app template. The admin is a quiet studio; the public side
is the gallery. Photographs carry the colour — the interface stays in warm paper and ink.

## Tokens

| Token    | Value                 | Use                           |
| -------- | --------------------- | ----------------------------- |
| canvas   | `#FAF9F6`             | archival paper background     |
| surface  | `#FFFFFF`             | cards, inspector              |
| subtle   | `#F3F2EE`             | hover fills, segmented tracks |
| ink      | `#141413`             | text, primary buttons         |
| slate    | `#6E6D68`             | secondary text                |
| line     | `#E6E4DD`             | 1px hairlines                 |
| darkroom | `#0E0E0D` / `#F5F4F0` | viewer theatre, dark theme    |

Studio UI: **Young Serif** (display, wordmark) + **Schibsted Grotesk** (UI and body), Geist Mono only for filenames/slugs. New public monographs use **Instrument Serif + Inter**; existing pairings remain available.
Brand: **lensasamsol**, lens icon in `public/brand/` (favicon 16–512px, apple-touch 180px).
Public galleries choose one of six pairings (Archival, Fine Art, Literary, Swiss, Monograph, Editorial Monograph); fonts
load per gallery. Display sizes use `clamp()` against container width (`cqi`) so they fit 360px.

Radius: **0px** on every public photograph; 6px on admin controls; pills only for status and gallery
buttons. Shadows: almost none — hairlines and proportion do the work.

Spacing: 8 / 16 / 24 / 32 / 48 / 64 / 96. Gallery max width 1600px (configurable), gutters 48/32/16px.

## Principles applied

- **One photographic opening:** one complete selected cover, its restrained title and public introduction, then the gallery. Selected Moments, repeated sticky metadata and the Explore pill are removed from client presentation.
- **Uncropped by default:** justified rows from real dimensions; cropping only in the deliberate _Grid_ mode.
- **Metadata as quiet text:** dates in tabular numerals, sentence case; no tracked all-caps eyebrows,
  no dot-joined meta strings.
- **External handoff is explicit:** "Open original in Google Drive ↗", helper line "Opens Google Drive
  in a new tab. You can download the original there." Touch devices always show the per-photo button.
- **Motion:** 150–200ms utility UI feedback and restrained viewer transitions, easing `cubic-bezier(.22,1,.36,1)`,
  no decorative photo hover zoom. No scroll hijacking, parallax or per-image entrance animation.
  `prefers-reduced-motion` disables transitions and smooth scroll.

## Client gallery experience

A client link opens a standalone exhibition prepared for that client: no studio navigation, no directory,
no other galleries, no admin chrome. The footer states plainly that anyone with the link can view the
gallery. The studio landing page (`/`) is a calm typographic card — name, introduction, “Lost your link? Get
in touch” — and never shows collections. In admin, every gallery card leads with the client's name and offers
**Copy Client Link** (primary), **Manage Photos** and **Customize Design**; the gallery page puts the client
link panel first and the **Assign Photos** grid (click to toggle, check mark = assigned, dimmed = not in gallery)
right below.

## Presets

Cover names below describe stored legacy preset values. All photographic covers now use the static exhibition opening; typography-only remains available.

| Preset           | Layout                    | Cover                 | Type                | Colour     |
| ---------------- | ------------------------- | --------------------- | ------------------- | ---------- |
| Minimal Archival | adaptive rows 320, gap 12 | featured, title below | Editorial Monograph | archival   |
| Editorial Warm   | editorial, gap 24         | split                 | Literary            | linen      |
| Darkroom Noir    | justified 300, gap 6      | full-bleed centred    | Swiss               | darkroom   |
| Exhibition White | masonry, gap 32           | typographic centred   | Monograph           | exhibition |
| Classic Portrait | justified 400, gap 16     | split                 | Fine Art            | stone      |

All theme text pairs exceed 7:1 (primary) and 4.5:1 (secondary); custom backgrounds derive text colours
that are unit-tested to stay ≥ 4.5:1.

## Client gallery entrance — full-viewport diaphragm

The entire website viewport is the six-blade aperture. A body-level portal isolates it from clipping and transformed ancestors. There is no outer ring, lens housing, logo, caption or Skip Intro control. The aperture begins at zero and opens around the visual viewport centre; its final inscribed circle extends beyond the farthest corner. Fixed inset coverage and ResizeObserver/VisualViewport listeners keep layout coverage and visible centering separate.

Motion: one 1100ms ease-in-out cubic opening with 18° mechanical blade travel, no fade-in, bounce, zoomed icon or per-frame React renders. Six graphite surfaces form a quiet closed composition. The surface behind the blades prevents antialiasing gaps. The normal completion removes the overlay; an independent 2000ms safety timer handles lost frames. Slow/failed hero loading falls back within 1600ms plus a short fade. Pending metadata has a 4500ms bound. Reduced motion bypasses the entrance, including changes while active. Escape remains an accessible emergency exit without visible skip UI.

Rules: public client gallery only, once per gallery per tab, no replay for photo navigation, no intro for deep links, invalid links, admin/editor/preview or typography-only covers. Images use the existing responsive hero candidate, not another original download. Real iPhone toolbar behavior requires device verification; desktop WebKit emulation is not that evidence.

## Private Photographic Edition — coordinated redesign

Chosen composition: photographic cover/page with an uncropped image, ruled studio masthead and an editorial caption. The two alternatives considered were cropped full-bleed covers (loses photographic content) and large typography-first panels (delays photographs). Existing saved themes, pairings, cover choices and layout controls remain authoritative.

- Display: existing selected gallery face, fluid 35–68px desktop titles, 32–48px mobile; tight 1.04 line height. Studio uses existing Young Serif paired with Schibsted Grotesk. No new font family or dependency.
- Masthead: 68px desktop /58px mobile; understated private-edition descriptor, never an action or access guarantee. Photo/caption share a left edge. Caption closes with a hairline; sequence begins 40px below (24px mobile).
- Photographs: square corners, native aspect ratios, no hover zoom. Responsive 480/960/1600/2560px tiers and explicit contain-fit viewer remain intact. Small and large collections use the same existing justified/editorial engine and bounded virtualization.
- Studio: paper #f7f7f2, rail #efefe8, selected navigation #252b25, lines #ddded5. Real operational status stays in a compact horizontal ledger. Larger cover-led collection entries, no fabricated analytics. Mobile menu traps focus, supports Escape and restores trigger focus.
- Publishing: explicit gallery title/client/assigned-count confirmation. Bulk selection, preview, revoke, regenerate and original Drive actions remain available. No sharing or OAuth changes.
- Acceptance: complete blade coverage at 0%; centre stable through rotation; progressive opening at 25/50/75%; no overlay at100%; no horizontal overflow at360/390px; photo and caption aligned; full portrait and landscape visible in viewer; studio actions reachable on touch and keyboard.

## Reference research (21 November 2026)

Inspected available page structures: [Jack Davison work index](https://www.jackdavison.co.uk/work-v-06), [Nadav Kander](https://www.nadavkander.com/), [Viviane Sassen](https://www.vivianesassen.com/), [Rinko Kawauchi](https://rinkokawauchi.com/en/), [Kawauchi works](https://rinkokawauchi.com/en/works/). Applicable patterns: photographer identity as a quiet anchor, pictures before explanatory copy, coherent series/order, sparse functional navigation, metadata as secondary type. Avoid portfolio-wide indexes in private client galleries, unnecessary subscriptions, copying composition, or acquiring reference photographs. Some requested/reference domains were unavailable or parked; these were not treated as usable design evidence. The browsing tool exposes document structure, not a full visual or interaction audit.

Available skills actually used: brainstorming, writing-plans, executing-plans, verification-before-completion; review at the end. No additional UI library, motion package, MCP installation or external asset dependency. The separately referenced resource inventory and iPhone screenshot were not included in this task's accessible attachments; do not claim they were inspected.

## Automatic editorial composition

New composition designs use a natural, viewport-bounded highlighted photograph with title/subtitle below and one of five orientation-aware templates. The static landing redesign removes the separate Selected Moments presentation. Existing valid saved designs keep their selected styles. Auto Arrange applies a recommendation to the editor draft only. See [the implementation report](docs/EDITORIAL_COMPOSITION.md) for exact geometry, manual overrides and validation.

## Static client landing

The current public and preview presentation removes split text panels, title overlays, Selected Moments, the Explore pill and the repeated sticky bar. One uncropped selected photograph leads directly into an aligned caption and the main gallery. All admin sources remain unchanged. See [the static landing report](docs/STATIC_LANDING.md) for compatibility notes, screenshots and validation.

## Reference-driven overhaul (2026-11-21)

Two approved references set the direction. They are never merged.

**Studio (Reference A: dense collection manager).** Bright white workspace, 224px quiet rail, one sans family
(Schibsted Grotesk), 24px page title, search beside the title, create action on the right. Collections are a
4/3/2/2-column grid (xl/md/base) of 4:3 thumbnails with a 15px name, a status dot, photo count and date. Actions
live in a menu (keyboard and touch reachable; the trigger is always visible on coarse pointers). Publishing and
link regeneration stay on the gallery page so the named-gallery confirmation is never bypassed.

**Public gallery (Reference B: editorial contact sheet).** Layout mode `folio`: a 224px sticky information column
(wordmark, title, date, place, photograph count, description, private-link note) beside aspect-true columns
(2/3/4/5 by width, 8px gutter). Photos keep the photographer's order; the selected cover leads and, when landscape
on three or more columns, spans two columns as the single larger frame. Below 900px the column collapses into a
compact header above the sheet and the notes move below it. No cards, borders, banner hero or slogans; only real
collection data is shown. Saved galleries that still carry the untouched earlier default adopt folio; any gallery
the photographer styled keeps its own layout, theme and type.

**Type system.** Two families, both already shipped: Schibsted Grotesk (everything) and Geist Mono (the wordmark
only). Both are open-licensed (SIL OFL) via Google Fonts. Young Serif was removed from the studio. The optional
per-gallery pairings (serif and grotesk) remain available in the design editor.

**Iris.** Starts fully covered, centred on the viewport, opens to clear every corner, no Skip control. The entrance
now also plays for the folio default (previously gated off for `typographic` covers).
