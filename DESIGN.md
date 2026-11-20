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

## Client gallery entrance — the camera iris

When a client opens their link for the first time in a tab, a graphite six-blade iris (rebuilt as vector
geometry from the brand's aperture mark) sits centred on a near-black surface. Its blades swing open with an
ease-in-out mechanical motion, the hexagonal opening twisting 34° as it widens, while the lens glides to the
cover photograph. The real gallery is already rendered underneath, so what shows through the opening is
the client's own cover photograph. The lens then grows past the viewport corners. Title and caption are already static underneath it; no secondary text reveal follows. Total ≈1.4 s.

| Phase | Time          | What moves                                                                                     |
| ----- | ------------- | ---------------------------------------------------------------------------------------------- |
| A     | 0–180 ms      | Lens fades in at its closed pose (1.5% settle, no zoom, no spin)                               |
| B     | 180–950 ms    | Blades open (apothem 7% → 88% of the lens), opening twists 34°, lens glides to the focal point |
| C     | 760–1420 ms   | Lens and opening grow until the hexagon's inscribed circle passes every corner                 |
| D     | ≈1130–1420 ms | Overlay removed; static title and metadata are immediately visible                             |

Rules: once per gallery per tab session; never for `?photo=` deep links, invalid links, reduced motion or
type-only covers; never on `/`, admin pages, the editor or previews. Skip intro and Esc end it immediately
(freezing the current frame, then a 300 ms fade). A cover slower than 1.6 s or failing to load fades the lens
away instead of holding the visitor. No sound, no spring overshoot, no lens flare.

## Automatic editorial composition

New composition designs use a natural, viewport-bounded highlighted photograph with title/subtitle below and one of five orientation-aware templates. The static landing redesign removes the separate Selected Moments presentation. Existing valid saved designs keep their selected styles. Auto Arrange applies a recommendation to the editor draft only. See [the implementation report](docs/EDITORIAL_COMPOSITION.md) for exact geometry, manual overrides and validation.

## Static client landing

The current public and preview presentation removes split text panels, title overlays, Selected Moments, the Explore pill and the repeated sticky bar. One uncropped selected photograph leads directly into an aligned caption and the main gallery. All admin sources remain unchanged. See [the static landing report](docs/STATIC_LANDING.md) for compatibility notes, screenshots and validation.
