# Editorial Composition Implementation Plan

> Use executing-plans for inline implementation and requesting-code-review for final review.

**Goal:** Implement the supplied Archival Monograph brief in the existing client gallery.
**Architecture:** Extend shared/layout.ts and the shared style contract; retain the exact same renderer and virtualizer for preview and public delivery. Store composition, cover and public introduction overrides in draft/published JSON, avoiding redundant D1 columns.
**Tech Stack:** Existing React, TypeScript, Zod, Workers/D1, Vitest and Playwright.
**Spec:** User attachment master implementation prompt and a private blueprint document (not in repository) (read in full).

## Constraints

Client eligibility stays server-side; never use unassigned metadata in analysis. Preserve original order, existing styles, iris, viewer, Drive file links, and last published design. No production deployment. No new layout dependency. No pixel/subject quality claims.

## Tasks

- [x] 1. Add tested analysis, factual recommendations, manual-first hero ranking and five composition templates. Extend bounded DP and exact three-image geometry. Verify order, dimensions, extremes and responsive geometry.
- [x] 2. Add opt-in composition settings and featured-below default for new galleries. Integrate natural hero, introduction and five layouts into existing renderer, preserving virtualization.
- [x] 3. Extend existing inspector with Auto Arrange, actual geometry thumbnails, cover recommendations, draft title/subtitle/description, density, orientation and emphasis controls. Persist through existing undo/save/publish.
- [x] 4. Validate style cover membership server-side. Project published introduction and cover without leaking another gallery's ID. Preserve sync and existing oriented metadata; no migration needed.
- [x] 5. Add browser regression and screenshot matrix, benchmark 1,200 photos, run all checks and production build; inspect screenshots and refine. Final independent code review.

## Review focus

Legacy JSON without composition; cover removed after draft save; portrait hero in narrow editor; extreme ratios and unknown dimensions; viewer order/focus after template changes; studio defaults must not inherit a client's text or photo ID.

## Progress

Audit complete. Repository initially consists of untracked project files; preserve existing work and do not commit it wholesale. User explicitly requested execution in this checkout; no worktree needed. Research's approximate cluster formula will be replaced with an exact solution using all three ratios. Metadata fields already provide oriented dimensions, featured flags, source order; capture-date ordering is deferred rather than invented.

Implementation tasks 1–4 verified with 81 unit tests, typecheck and lint. Independent read-only review identified six substantive cases: legacy-layout content retention, raw preview fallback metadata, explicit versus display-fallback cover identity, automatic-cover null semantics, editor highlight scroll root and exact virtualized focus restoration. All six were corrected; browser regressions cover draft/cover/template behavior and cleared overrides, with a far-photo focus regression added. Additional visual review corrected sparse phone contact strips and bounded-last-row treatment accidentally applied to internal segments.

Decisions: existing style JSON replaces unnecessary duplicate migration fields; legacy presets/styles remain supported; capture-time sorting and pixel scoring are absent rather than inferred; current virtualization is retained. Tests wait for actual assignment persistence and scroll to a stable main-grid viewport rather than a moving overscan boundary. No commits or deployment were made because the project files were already untracked and production publication was explicitly excluded.

Final verification: 81/81 unit tests; 44/44 full browser regressions plus 2/2 additional focused tests; typecheck, lint, format check and production build all passed. 51 screenshots. Browser maximum p95 0.9 ms for 1,200 photos (24 mounted main-grid tiles); Node maximum p95 1.186 ms for the same collection size. All requested phases complete; actual Google Drive and physical Safari/device validation remain documented limitations.
