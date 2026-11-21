# Lensasamsol editorial redesign implementation plan

**Goal:** Implement both user briefs as a coordinated local redesign; the dedicated iris brief controls the entrance.
**Architecture:** Retain React, existing gallery renderer, accessible controls, authenticated image tiers and Worker/D1 contracts. Use a root portal and viewport-sized vector aperture, no new dependencies.
**Spec:** User's Master UI/UX Redesign and dedicated Iris briefs; explicit instruction to implement without aesthetic approval.

## Constraints and decisions
No GitHub push, deployment, remote mutation, secret/OAuth change or production operation. Existing uncommitted image/OAuth work stays intact. Local branch: codex/editorial-redesign. No automatic commits of the mixed working tree.

Chosen direction: Private Photographic Edition. Retain photographer-selected themes and type pairings. A ruled masthead, generous uncropped photograph, expressive caption typography, quiet sequence and aligned footer. A full-bleed cropped cover would lose portrait content; a typography-led splash would delay the photographs. Admin becomes a restrained studio ledger with clear navigation, larger editorial headings and actionable real status. Preserve all saved design controls.

## Baseline / feature parity
- Existing iris clips blades to a 96–180px circle, draws a ring, moves toward hero focal point and initially leaves a nonzero hole. Replace all four behaviors.
- Overlay is route-nested; SVG uses 100dvh while geometry uses innerHeight. This is a measurable viewport mismatch risk; real iPhone reproduction remains unavailable.
- Public: private share token, no directory, chosen cover, responsive grid, virtualized large collections, fullscreen/keyboard/swipe/focus restoration/original Drive links, empty/error/revoked states.
- Admin: independent accounts, Drive connection/scan/sync, gallery create/search/filter/list/grid, assignment/bulk assignment/cover/design/preview, publish/unpublish/copy/regenerate/revoke/delete/settings.
- Publishing currently has no photo-review checkpoint. Add named-gallery/count/preview confirmation before existing publish mutation.
- Prior image repair remains: 480/960/1600/2560 derivatives, authorization before internal cache and browser no-store.

## Tasks
- [ ] 1. Record reference research and design rules; capture local baseline.
- [ ] 2. Replace iris geometry/rendering with exact visual-center, zero initial aperture, full-viewport blades, 1100ms reveal; portal, dynamic viewport bounds, no Skip button, bounded timeout and reduced motion.
- [ ] 3. Refine public cover, image sequence, viewer chrome, footer and responsive typography without changing image/authorization contracts.
- [ ] 4. Redesign studio navigation, overview, collection presentation, sign-in, curation hierarchy and publish checkpoint. Preserve existing routes/actions.
- [ ] 5. Add geometry, viewport, fallback, publish and mobile-navigation regressions; run lint/typecheck/unit/full Chromium and targeted WebKit. Inspect screenshots and 0/25/50/75/100% frames.
- [ ] 6. Review changes, document exact results/limitations, prepare staging build/dryrun only, scan artifacts privately; ask approval for GitHub and staging.

## Review focus
VisualViewport changes/rotation; missing animation callbacks; focus and scrolling restoration; unusually long client/gallery names; selected photos changed before publishing; large collections; no private data in captures/logs.

## Ledger
User authorized implementation without design checkpoints. Local branch created; existing image repair retained. The separately referenced resource inventory is absent; use the explicit reference shortlist and installed skills, without claiming the inventory was read. Physical devices unavailable; distinguish emulator evidence.
