# Editorial composition implementation

Implemented locally on 20 November 2026. No production deployment was performed.

## Before the upgrade

The application already had client-specific random gallery tokens, assigned-photo authorization, Google Drive sync, separate draft/published style JSON, an iris entrance, four layout modes, DP justified rows, viewport virtualization, Selected Moments, a filmstrip viewer, keyboard/touch navigation and photo deep links. The editorial mode used repeated offset single frames and large vertical gaps. The default cinematic hero cropped photographs and overlaid its title.

The complete composition research in `~/Downloads/editorial_gallery_composition_engine_blueprint.txt` was read before implementation. Existing migrations 0001–0004 and the repository architecture were the technical source of truth.

## Implemented research recommendations

The new monograph presentation uses one natural-aspect featured photograph, a title directly beneath it, optional subtitle, date/location/count and description, an optional compact Selected Moments selection, and the main gallery. The hero reserves its dimensions and is capped at 74% of the viewport on desktop, 68% on intermediate widths and 66% on phones. Public photo corners remain square. Instrument Serif and Inter are available as the Editorial Monograph pairing; existing font pairings remain available.

Featured Photo + Title Below is the new Minimal Archival/default cover. Existing valid saved styles retain their selected cover and legacy layout modes. Split, cinematic and typographic alternatives remain supported. Selecting a template or Auto Arrange does not overwrite an existing selected cover style.

## Automatic recommendation

Analysis uses only the assigned, available photographs delivered by the gallery API. Known dimensions classify portrait below 0.92 aspect ratio, landscape above 1.08, and square in between. Missing, nonfinite, zero or invalid metadata is excluded from orientation proportions, with a safe natural-layout fallback. Drive sensor orientation continues to be normalized by the existing synchronization code.

Recommendations use this priority:

1. More than 220 photographs: Compact Exhibition.
2. At least 60% portraits among known dimensions: Portrait Story.
3. At least 30 known photographs with aspect-ratio standard deviation below 0.08: Modern Contact Sheet.
4. At least 65% landscapes among known dimensions: Cinematic Archive.
5. Otherwise: Editorial Signature, with factual counts and unknown metadata explained.

No face recognition, subject detection, luminance, sharpness or aesthetic-quality analysis is claimed. Cover ranking uses photographer-featured status, known resolution, standard photographic proportions and original position. An eligible manual cover takes precedence. The explicit Automatic selection requests a metadata recommendation.

## Five different arrangements

| Template             | Geometry                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Editorial Signature  | Optimized rows with compatible consecutive P/LL or LL/P spreads and restrained wide featured anchors           |
| Compact Exhibition   | Dense optimized rows, smaller target height and gutters                                                        |
| Portrait Story       | Taller portrait-calibrated rows with a bounded number of photos per band                                       |
| Cinematic Archive    | Larger horizontal rows and occasional wide featured anchors; an immersive single-photo stream on phones        |
| Modern Contact Sheet | Greedy steady-height natural strips with bounded fitting, dense phone pairings and an unstretched final single |

The row solver considers bounded candidate breaks across the complete input segment. It penalizes height deviation, narrow tiles, extreme row heights and sparse/orphan endings. Internal segments preceding editorial spreads close flush; only the actual end of the collection gets bounded final-row alignment. Normal rows use exact pixel distribution. Clusters use fractional coordinates to preserve their exact original proportions.

For portrait ratio `p` beside landscape ratios `a` and `b`, let `s = 1/a + 1/b`, gap `g`, container width `W`. The stacked landscape column has width `R = (W - g - p*g) / (1 + p*s)`; total height is `H = R*s + g`; portrait width is `p*H`. This solves both column and row boundaries exactly, including unequal landscape ratios. Incompatible, too narrow or overly tall clusters fall back to rows. Spreads group consecutive images and never reorder them.

## Negative space and manual controls

Compact/Balanced/Spacious select 8/12/22 px desktop gutters, with existing manual gap, row-height and max-width sliders retained. Responsive scaling keeps smaller screens compact. Selected Moments uses a short, virtualized highlight arrangement for new composition designs and excludes the hero from that introductory selection. The full gallery still includes every assigned photograph.

The existing inspector now includes Auto Arrange, five geometry-generated structural thumbnails, cover suggestions and a full assigned-photo selector, public title/subtitle/description overrides, density, cluster handling and featured emphasis where applicable. Typography, title alignment, dates, count and Selected Moments controls remain. Existing sequence is the default; an explicit Filename preference uses stable natural numeric sorting. Capture-date and custom drag ordering are not implemented because those data/workflows were not present.

Undo/redo, Reset, Save Draft and Publish Changes use the existing history and persistence. Cover and introduction overrides live in style JSON, so saving a draft does not change the public presentation. Changing to a legacy layout retains the draft's cover and introduction. Clearing an override previews the original collection metadata. Public and preview use the same renderer.

## Data and isolation

No database migration or dependency was added. Existing dimensions, featured flags, source order, cover, focal coordinates and style snapshots already covered the required storage. Subtitle, template, cover and introduction overrides are additive optional keys in the validated style contract; legacy JSON remains valid. No Drive originals were changed.

Save/publish reject covers outside this client's assigned, available photo set. Public payloads remove stale cover references after unassignment. Studio defaults discard client-specific cover IDs and introduction text. Layout input never includes another client's photos. Existing token/image authorization remains server-side. New composition designs expose individual original-file links rather than whole-folder controls.

## Changed components

- `shared/composition.ts`: analysis, ranking, templates, exact clusters, composition, ordering and diagnostics.
- `shared/layout.ts`: bounded DP penalties and correct internal/final-row distinction.
- `shared/style.ts`, `shared/api.ts`: backward-compatible style settings and known-dimension metadata.
- `CoverHero`, `PhotoGrid`, `GalleryRenderer`, `Prologue`, gallery CSS: natural hero, title structure, templates, compact highlights and exact viewer focus restoration.
- `CompositionControls`, `Inspector`, `EditorPage`: editor controls, manual overrides and structural saved-state equality.
- `worker/gallery.ts`, style/default handlers in `worker/routes/admin.ts`: draft/public projection, cover eligibility and default sanitization.
- Composition unit/browser suites and benchmark script; existing browser tests now await assignment persistence and target stable viewport tiles.

## Verification and artifacts

See `tests/unit/composition.test.ts`, `tests/e2e/composition.spec.ts` and `scripts/benchmark-composition.mjs` for reproducible coverage. Screenshots are stored in `screenshots/composition/`: five templates × five widths (1440, 1024, 768, 390, 360) × hero/grid = 50 captures, plus a controlled exact-cluster capture (51 total). The existing `screenshots/c-gallery-*.png` captures remain as earlier visual references.

Benchmarks record 20, 500 and 1,200-photo datasets in `test-results/composition-benchmark.json`. Browser measurements of 1,200 photos across five templates and five container widths are in `test-results/composition-browser-benchmark.json`. Timings measure geometry computation on this machine; they do not promise real mobile frame rates, network speed or Google Drive thumbnail latency. Virtualization still mounts a viewport-sized subset rather than all 1,200 images.

## Final validation results

- Typecheck, ESLint, repository-wide Prettier check and production client/Worker build: passed.
- Vitest: 81 tests passed in 5 files.
- Full Playwright regression suite: 44 passed after the final internal-row refinement.
- Two subsequently added focused browser regressions passed: exact uncropped cluster boundaries and keyboard focus restoration to photo 1,101 of a virtualized gallery. There are 46 unique passing browser tests in total across the full and focused runs.
- Final standalone browser benchmark: 25 template/width combinations for 1,200 photos; maximum p95 0.9 ms on this machine. After scrolling, 24 main-grid tiles were mounted.
- Node benchmark: 75 count/template/width cases, 100 measured iterations per case; maximum p95 for 1,200-photo cases 1.186 ms. All measured p95 values were below the 10 ms target.
- Responsive matrix: no horizontal overflow at 1440, 1024, 768, 390 or 360 px. Captured and visually reviewed representative desktop, tablet and mobile results, including the exact asymmetric spread.
- Independent review completed; the six reported substantive cases were corrected and covered by the relevant editor, geometry and viewer regressions. No deferred review findings remain.

## Limitations and audit handoff

Demo imagery includes portraits, landscapes, mixed sets and a synthetic 1,200-frame archive; it does not constitute real graduation/wedding delivery testing. Unknown/single-photo browser cases use controlled API fixtures. Chromium is exercised; actual iOS Safari, WhatsApp's browser and physical-device performance remain to be checked. Pixel-based quality scoring and EXIF capture-date ordering are intentionally absent. Intentional whitespace remains around portrait heroes and bounded final rows.

The code is prepared for the next independent security audit, not certified production-ready. Real Google Drive OAuth, sharing, original downloads and synchronization require authorized credentials and were not verified end-to-end. Existing infrastructure limitations and security-audit notes in README/ARCHITECTURE still apply. Production deployment requires the owner's approval.
