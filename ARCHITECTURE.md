# Architecture

**Product model:** one photographer manages multiple client-specific galleries, each shared through an
independent link that displays only that client's assigned photographs.

```
Client browser ──/api/public/g/:token──────▶ Worker (Hono) ──▶ D1: gallery WHERE share_token=? AND published
               ──/img/t/:token/:photo/:v──▶   │  photo must be ASSIGNED to THAT gallery → Cache API → Drive thumbnail
               ──/api/public/studio───────▶   │  studio name/intro/contact only (no galleries)
               └─ "Open Original in Google Drive ↗" ────────────────▶ drive.google.com/file/d/<id> (Drive's own sharing)
Owner browser  ──/api/admin/*, /img/a/*───▶   │  session cookie + CSRF + rate limit
                                              └── OAuth (PKCE) / Drive v3 (drive.readonly, server-side only)
```

### Client gallery model (migration `0004_client_galleries.sql`, non-destructive)

| Column                        | Meaning                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections.share_token`     | 144-bit random (base64url, `crypto.getRandomValues`), unique partial index. `NULL` = revoked. Backfilled rows got 128-bit `randomblob(16)` tokens.                                                                                |
| `collections.assignment_mode` | `all` (folder belongs to this client; new files assigned on sync) or `selected` (shared folder; new files unassigned).                                                                                                            |
| `collections.client_name`     | Admin-only label; never in public payloads.                                                                                                                                                                                       |
| `photos.assigned`             | Explicit membership of a Drive file in a gallery. Replaces `hidden` (column kept, no longer read). One row per (gallery, Drive file): two galleries using the same file have two metadata rows, never two copies of the original. |

Public access rules (all server-side): gallery JSON requires `share_token = :token AND status = 'published'`;
images additionally require `photo.collection_id = gallery.id AND assigned = 1 AND unavailable = 0`. The cover
and featured photos must be assigned (enforced in PATCH and `ensureCover`). Folder links are only emitted
for `assignment_mode = 'all'` galleries whose owner enabled the (default-off) whole-folder button. Unknown,
revoked, unpublished and draft tokens all return the same 404.

Folders: `src/` (SPA), `worker/` (API), `shared/` (Zod contract, style config, layout geometry, Drive
parsing — imported by both sides), `migrations/`, `scripts/`, `tests/{unit,e2e}`.

## Key decisions

| Decision                                                                                                | Why                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One `GalleryRenderer` for public pages **and** the editor                                               | The preview _is_ the product, not an imitation. All responsive rules are **container queries**, so the editor's 390px frame behaves exactly like a 390px phone. The editor frame has `transform: translateZ(0)` so the `position: fixed` viewer resolves to the frame.         |
| Layout = pure functions → absolute boxes (integer rows, exact fractional clusters)                      | Unit-testable geometry; largest-remainder rounding guarantees rows are flush with zero overflow; boxes make vertical virtualisation trivial (≈40–80 tiles mounted for a 1,200-photo album).                                                                                    |
| Justified rows via DP (Knuth–Plass style)                                                               | Minimises squared deviation from target row height across the whole album; final row never stretched; panoramas/extreme portraits clamped.                                                                                                                                     |
| `drive.readonly` scope                                                                                  | `drive.file` + Picker covers only explicitly picked items; Google's docs don't state picking a folder grants children/future files (checked Nov 2026: developers.google.com/workspace/drive/api/guides/api-specific-auth, Picker overview). Sync needs both.                   |
| Tokens AES-256-GCM encrypted in D1 with `TOKEN_ENCRYPTION_KEY` (Worker secret)                          | Refresh token never leaves the server; disconnect revokes at Google and deletes.                                                                                                                                                                                               |
| Password session for the single owner (PBKDF2-SHA256 100k, hashed random session token in D1)           | Admin identity is separate from the Google connection (spec). No sign-up. Login throttled (6 failures / 15 min / IP, durable in D1).                                                                                                                                           |
| CSRF: `SameSite=Lax` cookie + required `x-archive-csrf` header + exact `Origin` match on every mutation | Lax is required so the OAuth redirect back from Google carries the session.                                                                                                                                                                                                    |
| Draft vs published style                                                                                | `style_draft_json` vs `style_published_json`. _Save draft_ writes only the draft; _Publish changes_ writes both. The client link reads only the published style; the owner's Preview Client Experience (`/admin/collections/:id/preview`, session) reads the draft.            |
| Images: `/img/t/:token/:photo/:v` (client) and `/img/a/:photo/:v` (owner session)                       | Authorisation happens before any cache lookup; the edge cache is keyed by Drive file + version + variant and never decides access. Client images are `Cache-Control: private, max-age=3600`. Fixed variants (480/960/1600 long edge); no user-supplied sizes or upstream URLs. |
| Demo mode = fixture "folders" through the same sync path                                                | Proves diff/sync/UI without pretending to be Drive; demo rows have `source='demo'` and are filtered when `DEMO_MODE` is off.                                                                                                                                                   |

## Corrections to the research blueprint

1. _"Worker image proxy with resized variants and R2 edge caching … sub-100ms global loads."_ A Worker
   doesn't resize bytes for free and Cache API doesn't work on `*.workers.dev`. We **don't resize**: we
   request Drive's own rendered thumbnail at fixed long-edge sizes (`thumbnailLink` with `=s<size>`;
   undocumented convention — the main technical risk) and cache per `fileId + version + variant`. No
   latency guarantee is made. R2 isn't used (not needed; would add a paid-tier risk at scale).
2. _"Store `drive_refresh_token` in studio_settings."_ Changed: separate `google_connections` row,
   encrypted, revocable.
3. _"`?photo=` via `history.replaceState`."_ Opening a photo **pushes** a history entry (so Back closes
   the viewer and keeps scroll); stepping within the viewer replaces it.
4. _"Download via Drive" wording._ Kept as an option, but the default is "Open original in Google Drive ↗"
   with helper copy — Drive does not auto-download.
5. _Image dimensions._ Drive reports sensor dimensions plus `rotation`; we transpose for 90°/270° so
   phone portraits lay out correctly. Drive thumbnails are rendered upright (to be verified with real data).

## Data model (D1)

`studio_settings` (singleton) · `sessions` · `login_attempts` · `oauth_states` (PKCE, 15 min) ·
`google_connections` (singleton, encrypted tokens) · `collections` (internal slug, client name, share token,
assignment mode, folder id/resource key, access state, cover, status, draft/published style JSON, sync state,
cached counts; `homepage_visible` is legacy and unused) · `photos` (gallery membership: Drive file id,
`assigned`, oriented dims, order, featured + order, source version, view link, resource key, demo asset/credit) · `sync_runs` (counts per sync: added/removed/updated/renamed/unsupported, error).

## Security checklist

- All inputs Zod-validated (`shared/api.ts`, `shared/style.ts`); public responses validated on the client.
- No user URL is ever fetched server-side: folder links are reduced to a regex-validated ID.
- Drive `webViewLink` values pass `safeDriveUrl` (https + Drive hosts only) before reaching visitors.
- Public payload strips Drive file IDs, folder internals, hidden/unavailable photos and (unless enabled) filenames.
- Security headers: `nosniff`, `x-frame-options: DENY`, `referrer-policy`; `<meta name="referrer" content="strict-origin">` keeps share tokens out of third-party Referer headers; gallery pages/API are `noindex`.
- Known gaps: no CSP header yet (Google Fonts + Picker origins would need allow-listing); admin mutation
  limiter is per-isolate (best effort).

## Client gallery entrance (iris)

Lives entirely in the public route: `src/pages/public/intro/` — `iris.ts` (pure geometry + timeline,
unit-tested), `IrisIntro.tsx` (SVG overlay; seven `d` attributes written per `requestAnimationFrame`, no
React renders, no SVG masks — the opening is an even-odd cut-out, which renders reliably in Safari),
`useGalleryEntrance.ts` (state machine `off → pending → closed → opening → done`, with `fading` for skip /
slow or failed cover), `ClientGalleryEntrance.tsx` (overlay + Skip intro). The shared `GalleryRenderer`
only gained an optional `holdTitles` flag (rendered as `data-entrance`); the editor and previews never pass
it. The cover is preloaded with the hero's exact `src`/`srcset`/`sizes` so it downloads once. Session
"seen" flags are keyed by an FNV hash of the token, never the token. No dependency was added (GSAP/Motion
offered no precision gain for seven paths and would add bundle weight). Measured in headless Chromium:
60 fps average, 0 frames over 33 ms, including with 4× and 6× CPU throttling.

## Editorial composition extension

`shared/composition.ts` extends the existing DP solver rather than introducing a second renderer or virtualization dependency. Optional `StyleConfig.composition` keys persist template settings, order preference, cover and public introduction within the existing draft/published JSON snapshots. Preview payloads retain underlying collection metadata so clearing an override previews correctly; public payloads resolve the published snapshot. Cover eligibility is checked at save/publish and again at projection. Studio defaults strip client content. No migration or Drive synchronization schema change was necessary. See [the implementation report](docs/EDITORIAL_COMPOSITION.md).
