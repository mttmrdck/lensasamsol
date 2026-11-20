# Static client gallery landing implementation plan

User brief: (private attachment, not in repository).
The explicit user request removes Selected Moments, overriding the attachment's optional retention.

- [x] Capture current portrait, landscape, mixed, small and large galleries at 1440/1024/768/390/360, and record admin source hashes.
- [x] Replace photographic hero presentations with one static, uncropped exhibition opening: small wordmark, natural photograph, aligned title/subtitle and quiet metadata. Preserve stored cover choices, dimensions, typography, title alignment and height settings. Keep deliberate typography-only mode; retain all stored legacy settings without migrating data.
- [x] Remove the Selected Moments presentation, duplicated sticky bar, repeated all-photo heading and Explore pill from shared renderer. Keep featured metadata and arrangement emphasis. Remove secondary entrance title animation and hover zoom. Public and preview remain identical; no admin source changes.
- [x] Update navigation tests to use direct scrolling; add before/after screenshot matrix, static geometry/animation assertions, selected-cover and preview tests. Run typecheck/lint/format/unit/browser/build and independent review.
- [x] Leave a working local preview with demo client links and report limitations. No deployment or push.

Implementation uses existing React/TypeScript/gallery geometry and CSS container queries. No new library, schema or authorization change. Three accessible reference pages were consulted (Bottega53, Format, Minimal Gallery); Lana Zrnic and Cargo's supplied path were unavailable through the web tool. These references inform restraint and photographic emphasis, not copied layouts.

Independent review found one content-visibility regression: a subtitle suppressed an enabled description. A component rendering test reproduced it (RED); separate quiet description rendering corrected it (GREEN). Admin source hashes match the pre-change capture. No schema, authentication, API or admin implementation changes were made. Final verification passed: 83 unit tests, 52 browser tests, typecheck, lint, formatting, production build; 75 before/after screenshots, no overflow or page errors, unchanged admin hashes. Local demo data was restored after tests and preview links refreshed. The preview server remains running as explicitly requested. No production action was taken.
