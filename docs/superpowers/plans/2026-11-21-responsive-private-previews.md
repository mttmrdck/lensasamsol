# Responsive private preview repair plan

**Goal:** Restore sharp hero/grid images and immersive contain-fit fullscreen viewing without changing the editorial design or original-file sharing model.

**Spec:** User attachment “FIX BLURRY PREVIEWS AND TINY FULLSCREEN PHOTOS”, 21 November 2026. Inspect, implement, and verify locally; no deployment, Google credential/permission changes, production data, or production infrastructure changes.

## Confirmed evidence and selected approach

Actual assigned staging photos: portrait original 3648×5472, landscape original 5472×3648. Every existing s/m/l endpoint returned the same 147×220 or 220×147 thumbnail. `fetchDrivePreview` ignores its long-edge parameter. Lightbox CSS uses auto width/height, limiting its image to that small intrinsic size. The metadata sync already preserves oriented dimensions.

Use the documented authenticated Drive `files.get?alt=media` endpoint and streaming Cloudflare Images binding for real 480/960/1600/2560-long-edge WebP derivatives. Do not rewrite Google's thumbnail URLs or proxy unbounded originals into browsers. The binding supports private input streams and an offline local implementation. Configure it locally for development/test/staging only; leave production configuration unchanged. Preview transformation availability and quotas require staging verification after approval; thumbnails remain a controlled degraded fallback for oversized/non-downloadable sources or transformation failures.

Alternative: changing CSS alone enlarges 220px images but cannot recover detail. Undocumented thumbnail sizing has no supported resolution guarantee. Browser-side original downloads waste bandwidth and would undermine the fixed private derivative boundary. No permanent original copies in Cloudflare storage.

## Requirements and review focus

- Authorization/assignment/published status must be checked before conditional responses or internal cache access.
- No browser/shared cache may bypass revocation. Use private/no-store delivery and an internal versioned derivative cache; do not enable a Worker cache in front of authorization.
- Bound media input to 20 MiB and derivative output; stream the original through transforms without buffering it in the Worker. Reject redirects, unexpected MIME, credentials in URLs, and arbitrary file-ID endpoints.
- Version derivative keys/ETags to invalidate old 220px caches. Never store original bytes in caches.
- Responsive width descriptors must match oriented derivative dimensions, cap at original size, and account for DPR. Demo fixtures never advertise nonexistent xl detail.
- Lightbox explicit contain-fit bounds account for toolbar/footer, controls, safe areas, mobile viewport, loading/error states, reduced motion, and bounded neighbor prefetch.
- All real diagnostic output contains only dimensions/byte counts/cache policy, never private links, names, credentials or tokens. Real originals were held in memory only.

## Tasks

- [x] Inspect pipeline and measure two real assigned staging sources and all existing variants safely.
- [x] Implement bounded authenticated media transformation and controlled thumbnail fallback.
- [x] Tighten private image caching, source/version keys, ETags and authorization regression tests.
- [x] Implement responsive frontend tiers, hero/grid selection and measured contain-fit lightbox.
- [x] Add synthetic real-codec/Workers and browser coverage for image sizes, orientations, DPR, navigation, loading/failure, isolation, revocation, unpublishing and cache privacy.
- [x] Run lint, typecheck, unit/browser tests, local staging build/dryrun, and independent review. Report before/after measurements, tradeoffs, limits and exact files changed. No deployment.

## Verification and measurements

Read-only live staging Chromium measurements at 1440×900, DPR2: hero displayed1053×702 from a220×147 response (browser density-adjusted natural size198×132); portrait viewer147×220.5, landscape219.98×146.66, stage1440×730. Source Google metadata/original media established portrait3648×5472 (9,878,436bytes), landscape5472×3648 (8,099,522bytes). No private original or screenshot was persisted.

Local real-codec output: portrait320×480 /640×960 /1067×1600 /1707×2560; landscape480×320 /960×640 /1600×1067 /2560×1707. Local synthetic Chromium/WebKit at the same Retina viewport: portrait viewer476×714 with1067×1600 selected; landscape1071×714 with2560×1707 selected; landscape hero1053×702 with2560×1707. Mobile390×844/DPR3 and desktopDPR1 were also measured. These are local-after results, not a claim that the live staging fix has been deployed.

Validation: full lint/typecheck;207 unit tests across14 files (actual workerd/Images codec, EXIF orientation/stripping, stream bounds, full-body cache semantics and actual in-memory SQLite authorization predicates);60-test full Chromium browser suite;22 final targeted Chromium/WebKit checks covering all image profiles plus the review fixes. Browser checks use synthetic patterned rasters and dummy credentials; physical iOS/Safari hardware was not available. Final release build/dryrun and artifact/private-value scans use staging configuration only.

Independent source reviews found and resolved cross-request stream sharing (removed entirely), conditional hero measurement, failed responsive tier upgrades, and embedded-frame height. A meaningful slow-cover regression also exposed the entrance effect canceling its own deadline when state changed to closed; timer lifetime now survives that transition and still cancels on navigation. A test-only external font timeout was isolated from this timing assertion. No credential/permission changes, production operations, deployment or commit occurred.

Safe numeric evidence and synthetic screenshots are in ignored `.wrangler/image-quality-evidence/`; they contain no real gallery links, filenames, credentials or originals. Internal cached masters are2560px derived WebPs, not original copies. Cache hits avoid further Drive media downloads; concurrent cold misses may still duplicate a source fetch. Inputs above20MB, denied download capability, unavailable binding/quotas or transform failure use a clearly tagged low-resolution thumbnail fallback. Already-viewed pixels cannot be recalled; Drive content edits require sync to update the source-version cache key. Real edge binding availability/quotas and private real-photo delivery must be retested after a separately approved staging deployment.

## Exact files changed for this image repair

- Delivery/config: `worker/google.ts` (preview function), `worker/images.ts`, `worker/image-delivery.ts`, `worker/env.ts`, `wrangler.jsonc` (local/test/staging Images bindings only), `shared/image-variants.ts`.
- Gallery UI: `src/components/gallery/CoverHero.tsx`, `PhotoGrid.tsx`, `Lightbox.tsx`, `images.ts`, `hooks.ts`; `src/lib/format.ts`; `src/styles/index.css`; `src/pages/public/intro/useGalleryEntrance.ts`; `src/pages/admin/DrivePage.tsx` (disconnect copy aligned with the active-connection image gate).
- Regression coverage: `tests/unit/image-variants.test.ts`, `image-routes.test.ts`, `image-delivery.test.ts`, `image-transform-workerd.test.ts`; `tests/e2e/image-quality.spec.ts`, `admin.spec.ts`, `intro.spec.ts`.
- Documentation: `ARCHITECTURE.md`, `ENVIRONMENT.md`, and this plan/report. `scripts/complete-staging-secrets.mjs` received two lint-only comments for its intentional control-character validation; credential behavior is unchanged. Other pre-existing OAuth/staging setup changes in the working tree are from earlier requests.
