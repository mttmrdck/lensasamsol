# lensasamsol — client photo delivery from Google Drive

**One photographer manages multiple client-specific galleries, each shared through an independent link that
displays only that client's assigned photographs.**

Workflow: open admin → create a client gallery from a Drive folder → assign that client's photos →
customize the design → publish → copy the client link → send it. The client opens a standalone gallery
showing only their photos. Originals stay in Google Drive; the app never writes, moves or deletes anything there.

- **Public:** `/` is a minimal studio landing page that never lists galleries. `/g/<share-token>` is one
  client's gallery (static photographic opening, uncropped grid, full-screen viewer with `?photo=<id>` deep
  links, per-photo "Open Original in Google Drive" buttons). There is no public listing endpoint.
- **Admin:** `/admin`, `/admin/collections` (Client Galleries), `/admin/collections/new` (Create Client
  Gallery), `/admin/collections/:id` (client link, Assign Photos), `/admin/collections/:id/design`
  (Customize Design), `/admin/collections/:id/preview` (Preview Client Experience), `/admin/drive`,
  `/admin/appearance`, `/admin/settings`.

The editorial composition upgrade, template rules, validation artifacts and limitations are documented in
[docs/EDITORIAL_COMPOSITION.md](docs/EDITORIAL_COMPOSITION.md). The current client opening is documented in
[docs/STATIC_LANDING.md](docs/STATIC_LANDING.md).

## Client links — what they do and don't guarantee

- Each gallery gets a random 144-bit share token at creation (`/g/<24 chars>`). Slugs, names and IDs are
  never in the URL. Links work only while the gallery is **published**.
- The Worker enforces everything server-side: the gallery API and every image (`/img/t/<token>/<photo>/<size>`)
  check that the token belongs to a published gallery **and** that the photo is assigned to it. A link for
  gallery A cannot load gallery B's data or images, whatever IDs are guessed.
- **Regenerate** issues a new token (old link and its image URLs stop working immediately). **Revoke** removes
  the link entirely. **Unpublish** closes the link until you publish again (same link).
- Links are **bearer capabilities, not authentication**: anyone who has the link can view the gallery. Clients
  are told this in the gallery footer. Browsers may keep images they already loaded for up to 1 hour
  (`Cache-Control: private, max-age=3600`); shared caches never store them.
- Galleries are excluded from search engines (`noindex`, `robots.txt`, `Referrer-Policy: strict-origin` so the
  token is not leaked to Google Fonts/Drive).

## Two ways to source a client's photos

1. **One folder per client** ("Every photo in this folder"): every supported file is assigned; new files
   join on the next sync. Simplest and safest.
2. **Shared folder** ("Only photos I choose"): several galleries index the same folder; nothing is visible
   until you assign photos (click tiles, filter by filename, bulk assign). New files stay unassigned.

Each gallery keeps its own membership rows (`photos.assigned`) pointing at the same Drive file IDs; originals
are never copied.

Stack: React 19 + Vite 8 + TypeScript, Tailwind CSS 4, Radix primitives (shadcn-style, hand-written),
Lucide, TanStack Query, React Router 7 · Cloudflare Workers (Hono) + D1 · Google Drive API v3 + OAuth +
optional Google Picker · Zod shared contract · Vitest + Playwright.

## Run locally (demo mode, no Google credentials needed)

```bash
npm install
npm run fixtures            # downloads ~21 MB of Unsplash-licensed demo images via picsum.photos
cp .dev.vars.example .dev.vars
node scripts/set-admin-users.mjs solfb1 akiffb1   # hidden prompts; writes ADMIN_CREDENTIALS_JSON to .dev.vars
npm run gen-key                                     # paste into TOKEN_ENCRYPTION_KEY
npm run db:migrate:local
npm run db:seed:demo        # 8 demo collections incl. a 1,200-frame archive, a draft, an empty and a failed-sync state
npm run dev                 # http://localhost:5188
```

Demo mode (`DEMO_MODE=true` in `wrangler.jsonc` vars) is explicit everywhere: admin banner, "Demo"
labels, demo photos link to their Unsplash source page (never an invented Drive link), and the demo
"Harbour Wedding" sync failure is labelled _simulated_. With `DEMO_MODE=false`, demo collections and
their images return 404 publicly.

## Quality commands

```bash
npm run typecheck   # tsc -b
npm run lint        # eslint
npm run format      # prettier
npm test            # vitest — geometry, Drive URL/SSRF parsing, style/contrast, crypto
npm run test:e2e    # playwright — re-seeds demo data, starts dev server if needed
npm run build       # production client + worker bundle
node scripts/shoot.mjs <name> <path> [w] [h] [scrollY] [--login]   # screenshot helper → screenshots/
```

## Google Cloud / Drive setup

1. Create a Google Cloud project → **APIs & Services → Enable APIs**: _Google Drive API_ (and _Google
   Picker API_ if you want the folder chooser).
2. **OAuth consent screen**: user type _External_ (or _Internal_ if you're on Google Workspace).
   Add yourself as a test user. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/drive.readonly`.
3. **Credentials → Create OAuth client ID → Web application.**
   - Authorised JavaScript origins: `http://localhost:5188` and your production origin.
   - Authorised redirect URIs: `http://localhost:5188/api/admin/drive/callback` and
     `https://<your-domain>/api/admin/drive/callback`.
4. Optional Picker: **Credentials → API key**, restrict it to the Picker API and your HTTP referrers.
   `GOOGLE_PROJECT_NUMBER` is the project number from the dashboard.
5. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (and optional Picker values) in `.dev.vars` /
   Cloudflare secrets, then **Admin → Drive Sync → Connect Google Drive**.

**Drive sharing for clients (important).** The app's own Drive connection is _not_ used to give clients
access. Each photo button opens that one file on Drive; whether the client can open it is decided by
Google Drive sharing, independently of this app:

- **One folder per client:** share that folder as **Anyone with the link → Viewer**. Fine: the folder only
  holds their photos.
- **Shared folder:** do **not** share the whole folder publicly — anyone who obtains the folder link would see
  every client's files. Keep the folder restricted and share each client's files individually (Anyone with the
  link → Viewer), or move each client's photos into their own folder. The app never shows folder links for
  shared-folder galleries, and the "Whole-folder button" is off by default everywhere.
- Unpublishing, regenerating or revoking a gallery link does **not** change Drive sharing. Files shared as
  "Anyone with the link" stay reachable on Drive to anyone who has their Drive URLs. Isolation on Drive itself
  is **not verified** in this environment (no real Google account was used).

**Scope and verification caveats (read this).** `drive.readonly` is a _restricted_ scope:

- In _Testing_ publishing status with user type _External_, Google expires refresh tokens after **7 days**;
  you'll need to reconnect weekly. Options: use a Workspace account with _Internal_ user type, or move the
  app to _In production_ (unverified). Unverified production apps show a warning screen to you (the only
  user) — acceptable for single-owner personal use; public verification of restricted scopes requires a
  security assessment and is out of scope.
- Why not `drive.file`: it only covers files the user explicitly picks; Google's docs don't state that
  picking a folder grants access to its children or files added later, which sync requires. See
  ARCHITECTURE.md.

## Cloudflare setup & deploy (not performed — requires your account)

Deployment uses separate `staging` and `production` environments in `wrangler.jsonc`, each with its own
Worker and D1 database. The release gate (`scripts/release.mjs check|build|dryrun|deploy`) refuses
placeholder databases, shared databases, demo mode and non-HTTPS origins. The Worker also refuses to serve
(HTTP 503) when required secrets are missing, the demo password is configured, or a request arrives on a
non-canonical origin.

- Environment variables and secrets: [ENVIRONMENT.md](ENVIRONMENT.md)
- Release steps: [DEPLOYMENT.md](DEPLOYMENT.md)
- Account-dependent commands (D1 creation, secrets, migrations, backups, rollback): [OPERATIONS.md](OPERATIONS.md)
- Owner acceptance checklist with a real Drive account: [HANDOVER.md](HANDOVER.md)

## Cost & limitations (honest version)

- **Workers Free:** 100k requests/day, **10 ms CPU per request**. The app streams previews without
  decoding them, so most requests are cheap. Two hot spots: login (PBKDF2, 100k iterations ≈ tens of ms
  CPU; occasional and rate-limited, but may exceed the free CPU budget — Workers Paid, $5/mo, lifts it
  to 30 s) and syncing very large folders (JSON parsing + D1 batches).
- **D1 Free:** 5 GB, 5M row reads/day, 100k row writes/day. A 1,200-photo sync writes ~1,200 rows.
- **Images:** no Cloudflare Images/transforms are used. Previews come from Google Drive's own thumbnail
  service at fixed long-edge sizes (480/960/1600), cached per file version at the edge (custom domain
  only) and in browsers for 1 day. The `=s<size>` suffix on `thumbnailLink` is a widely used but
  **undocumented** Google convention — if it changes, previews break until the code adapts.
  Edge cache entries can be evicted at any time; cold views go back to Drive (latency ~200–800 ms each,
  subject to Drive quotas). Not measured against real Drive yet (no credentials in this environment).
- **Drive API quotas** apply per project; sync retries 429/5xx with exponential backoff.
- Originals are never proxied, so there is no egress cost for downloads — visitors download from Drive.

## What's blocked on your credentials / approval

- Real Drive OAuth, folder validation, sync, Picker and preview pipeline are implemented but **unverified
  end-to-end** here (no Google client). Next: complete "Google Cloud setup", connect, create one
  collection from a real folder, and check: rotated phone photos display upright, a resource-key folder
  link works, an anonymous browser can open the Drive file link.
- Cloudflare deployment, custom domain and production secrets require your account.

## Deviations / omissions (no silent compromises)

- shadcn/ui CLI wasn't run; equivalent components are hand-written on Radix primitives in `src/components/ui`.
- Motion (motion.dev) isn't used — CSS transitions covered every interaction within the motion budget.
- Thumbnail→viewer is a crossfade, not a shared-element zoom (chosen for robustness).
- Pinch-zoom in the viewer is the browser's native page zoom, not a custom zoom.
- Sync is non-recursive (subfolders ignored) and runs inside the request (no queue); folders over 20,000
  files are partially indexed and flagged.
- Logo upload isn't implemented (studio name is the wordmark).
- Demo fixture subjects (coast, city, portraits, highlands, concerts) stand in for the brief's wedding /
  graduation / event examples; the demo empty "Graduation Day" and simulated-failure "Harbour Wedding"
  exercise those states.
