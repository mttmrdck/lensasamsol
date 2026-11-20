# Handover and owner acceptance

Status: **BLOCKED_REAL_ACCOUNT_TEST**. The code, local tests and release gates are complete. Nothing has been checked against a real Google account or a real Cloudflare account. Do not call the release operational until every item below has been checked on **staging** and its result recorded.

## What is verified locally

- `npm run typecheck`, `npm run lint`, `npm test` (unit tests, including the admin account and runtime configuration guards), `node scripts/check-migrations.mjs` (5 migrations, upgrade and cascade checks), and `npm run test:e2e` (isolated Chromium tests on port 5190).
- Client gallery isolation, link regeneration and revocation, draft and unpublished closure, the viewer, the editor, the iris entrance and mobile layouts. Evidence is listed in [PLAN.md](PLAN.md).
- Production fail-closed behaviour: wrong origin, demo mode, demo password, a missing secret or a weak hash all make the Worker return 503 for API and image requests (covered by unit tests, not yet by a deployed Worker).

## Owner checklist (staging, real accounts)

Record the date, the person who ran it, and pass or fail for each item.

**Administrators**

1. `solfb1` signs in with their own password; `akiffb1` signs in with theirs. A wrong password or an unknown user ID is rejected.
2. Sign-out ends the session. Rotating `ADMIN_CREDENTIALS_JSON` signs out both administrators.
3. After six failed attempts from one IP within 15 minutes, the next attempt is throttled (HTTP 429).

**Drive connection**

4. Connect Drive with the `GOOGLE_ALLOWED_EMAIL` account; it succeeds. Connecting with any other Google account is refused.
5. The OAuth callback fails if it is opened in a different browser session from the one that started the connection.
6. After at least one hour (one access-token lifetime), sync still works, which proves the token refresh works. If the OAuth app is in *Testing* status with *External* users, expect a forced reconnect after 7 days.

**Galleries with real Drive folders**

7. Create Gallery A from a dedicated folder and Gallery B from a shared folder. Sync both. Rotated phone photos display upright. A folder link that carries a resource key also works.
8. A's link shows only A's photos. Requesting B's photo IDs through A's link returns 404.
9. In a private or anonymous browser window, each Download button opens that exact Drive file, not the folder. Check whether the client can actually open it: that depends on the file's Drive sharing (see README, "Drive sharing for clients").
10. In the shared folder, files belonging to other clients are **not** reachable through the shared folder's own Drive link.
11. Unpublish, regenerate and revoke each close the old link. Drive sharing stays unchanged, as expected.

**Platform**

12. `/api/health` reports `demoMode: false`. Demo collections return 404.
13. Image previews load. Check whether edge caching works on workers.dev (Cache API caching might do nothing there). If caching matters, attach a custom domain and test again.
14. Production repeats items 1, 4, 8 and 12 after its own deployment.

## Open limitations

- Only Chromium was tested. Safari, Firefox and physical phones were not.
- Google Drive's `thumbnailLink` size suffix is undocumented and could change.
- Sync runs inside the request, does not go into subfolders, and indexes at most 20,000 files per folder.
- Login uses PBKDF2 with 100,000 iterations. On Workers Free this can exceed the 10 ms CPU limit; Workers Paid removes that limit.

## Files you own

`wrangler.jsonc` (D1 UUIDs and origins), the Worker secrets, the Google Cloud OAuth client, D1 exports, and the `TOKEN_ENCRYPTION_KEY` backup. Commands are in [OPERATIONS.md](OPERATIONS.md); the variable reference is in [ENVIRONMENT.md](ENVIRONMENT.md).
