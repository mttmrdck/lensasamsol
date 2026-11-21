# Operations (account-dependent commands)

Every command in this file touches a real Cloudflare account. None of them has been run for this project. Each one needs the owner's approval before it runs. Before running a command, confirm the logged-in account (`npx --no-install wrangler whoami`), the Worker name and the D1 UUID. Replace `<env>` with `staging` or `production`. Finish staging completely before starting production.

Use only the repository's installed Wrangler (`npx --no-install wrangler`).

## Names (fixed in `wrangler.jsonc`)

| | Worker | D1 database | Origin |
| --- | --- | --- | --- |
| Local development | `lensasamsol` (never deployed) | local only | `http://localhost:5188` |
| Isolated tests | `lensasamsol-test` | local only | `http://localhost:5190` |
| **Staging** | `lensasamsol-staging` (new) | `lensasamsol-staging` | `https://lensasamsol-staging.<subdomain>.workers.dev` |
| **Production** | `lensasamsol` (the existing dashboard Worker, GitHub-connected) | `lensasamsol-production` | `https://lensasamsol.<subdomain>.workers.dev` or a custom domain |

The existing D1 database `lestari` belongs to something else. Never bind it here.

## 1. Create the databases (once per environment)

```sh
npx --no-install wrangler d1 create lensasamsol-staging
npx --no-install wrangler d1 create lensasamsol-production   # only when production is being prepared
```

Copy each printed `database_id` into `env.<env>.d1_databases[0].database_id` in `wrangler.jsonc`. Keep `database_name` and `migrations_dir` as they are. Then run `node scripts/release.mjs check <env>`, which refuses placeholders, shared databases and mismatched names.

## 2. Origin and Google OAuth client

1. Read the account's workers.dev subdomain: Cloudflare dashboard → Workers & Pages → open the `lensasamsol` Worker → Settings → Domains & Routes. The `workers.dev` entry reads `lensasamsol.<subdomain>.workers.dev`. If none is shown, enable the workers.dev route first. (Wrangler has no read-only command for this.)
2. Put the exact origin in `env.<env>.vars.PUBLIC_ORIGIN`, with no trailing slash.
3. In Google Cloud, add the redirect URI `<PUBLIC_ORIGIN>/api/admin/drive/callback` to the OAuth web client. Use a separate client for staging.

## 3. Migrations (back up first)

On a new, empty database:

```sh
npx --no-install wrangler d1 migrations list DB --env <env> --remote
npx --no-install wrangler d1 migrations apply DB --env <env> --remote
```

On a database that already holds data, take an export first and keep it with the release record:

```sh
npx --no-install wrangler d1 export DB --env <env> --remote --output backups/<env>-<YYYYMMDD-HHMM>.sql
npx --no-install wrangler d1 migrations apply DB --env <env> --remote
```

Exports contain encrypted Google tokens and session hashes. Store them like secrets and never commit them. Rehearse new migrations locally first with `node scripts/check-migrations.mjs`.

## 4. Secrets, then deployment

Every environment declares `secrets.required`, so `wrangler deploy` and Vite builds are expected to refuse an environment whose required secrets are missing. Install secrets first. Each command prompts for the value, so it never enters shell history.

```sh
npx --no-install wrangler secret put ADMIN_CREDENTIALS_JSON --env <env>   # [{"username":"solfb1",...},{"username":"akiffb1",...}]
npx --no-install wrangler secret put TOKEN_ENCRYPTION_KEY --env <env>     # npm run gen-key; unique per environment
npx --no-install wrangler secret put GOOGLE_CLIENT_ID --env <env>
npx --no-install wrangler secret put GOOGLE_CLIENT_SECRET --env <env>
npx --no-install wrangler secret put GOOGLE_ALLOWED_EMAIL --env <env>
# Optional: GOOGLE_PICKER_API_KEY, GOOGLE_PROJECT_NUMBER
npx --no-install wrangler secret list --env <env>
```

For a new staging Worker, use the staging first-deployment procedure below. The installed Wrangler supports `deploy --secrets-file`, which uploads code and all required secrets together. Do not deploy the application with missing secrets or use individual secret uploads to bootstrap it.

To produce the `ADMIN_CREDENTIALS_JSON` value without exposing passwords, run `node scripts/set-admin-users.mjs solfb1 akiffb1` in a throwaway checkout (or move `.dev.vars` aside first), copy the JSON line, then restore. Remote passwords must differ from local ones and must not be the demo passphrase (the Worker rejects it).

Then build, rehearse and deploy with the release script:

```sh
node scripts/release.mjs check <env>
node scripts/release.mjs build <env>
node scripts/release.mjs dryrun <env>
node scripts/release.mjs deploy <env> --approve <env>
```

Check that `curl -s <PUBLIC_ORIGIN>/api/health` returns `{"ok":true,"demoMode":false}`. A 503 means a secret or variable is missing or invalid.

### Git-connected production Worker (Workers Builds)

The existing `lensasamsol` Worker builds from GitHub. In the dashboard (Workers & Pages → `lensasamsol` → Settings → Build):

| Setting | Value |
| --- | --- |
| Git repository | `mttmrdck/lensasamsol` (reconnect it if the build still points at the old repository name) |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build` (Workers Builds already runs `npm clean-install`) |
| Deploy command | `npx wrangler deploy` |
| Build variable | `CLOUDFLARE_ENV` = `production` |

`CLOUDFLARE_ENV` selects the Vite environment, so the generated `dist/lensasamsol/wrangler.json` carries the production values. `--env` and `CLOUDFLARE_ENV` do not combine: leave the deploy command without `--env`. The build guard in `vite.config.ts` fails a CI build that has no `CLOUDFLARE_ENV` or whose production values are incomplete, so pushes to `main` cannot publish a demo or localhost build. Until production is configured, pushes to `main` fail at the build step on purpose. To stop the failed builds meanwhile, disable automatic builds on the production branch in the same settings page. Do not give the staging Worker a Git connection; deploy it only with `release.mjs`.

### Staging first deployment

This procedure is limited to `lensasamsol-staging` at `https://lensasamsol-staging.lnoa.workers.dev`. Production is excluded. The intended Google account is `zafranakif74@gmail.com`. Its allowlist value and a fresh encryption key generated by `scripts/gen-key.mjs` have been prepared locally in `.wrangler/staging-credentials/secrets.json` (ignored, mode 0600, directory 0700). This file is a partial bundle until the steps below finish. Never print it or add it to release assets. Preserve this key across retries; do not regenerate it after connecting Drive.

1. In Google Auth Platform, create a separate **Web application** client for staging. Set the authorized redirect URI to exactly:

   ```text
   https://lensasamsol-staging.lnoa.workers.dev/api/admin/drive/callback
   ```

   If entering an authorized JavaScript origin, use `https://lensasamsol-staging.lnoa.workers.dev` without a path. The server OAuth flow does not require Picker. Enable Google Drive API; configure `openid`, `email`, and `https://www.googleapis.com/auth/drive.readonly`. For an External application in Testing, add `zafranakif74@gmail.com` as a test user as well as the application's allowlist. Keep the downloaded OAuth credentials private and outside the repository.

2. From the repository root, run the local setup helper:

   ```sh
   node scripts/complete-staging-secrets.mjs
   ```

   It prompts privately for missing administrator passwords (with confirmation) and missing Google OAuth credentials. Choose different passwords of at least 12 characters for `solfb1` and `akiffb1` and keep them in your password manager. Saved administrator hashes and OAuth credentials are preserved on reruns. The existing encryption key and allowed email are always preserved; malformed or missing key/email values stop setup.

3. Wait for the message confirming all five secrets were saved and verified privately in `.wrangler/staging-credentials/secrets.json`. The helper writes atomically with mode 0600, does not change the development `.dev.vars`, and performs no network operations. Ctrl+C cancels before saving. Do not paste credential values into chat or shell arguments.

4. Before any creation, secret upload, or deployment, obtain the owner's explicit approval. After approval, confirm the authenticated Cloudflare account/subdomain and the existing staging D1 UUID. Read migration status with `npx --no-install wrangler d1 migrations list DB --env staging --remote`; do not recreate D1 or reapply migrations already installed. Stop on any account, database, or Worker mismatch.

5. Run `npm run typecheck`, `node scripts/release.mjs check staging`, `node scripts/release.mjs build staging`, and `node scripts/release.mjs dryrun staging`. The build command selects `CLOUDFLARE_ENV=staging`. Verify the generated manifest names `lensasamsol-staging`, binds only staging D1, uses the exact staging origin and `DEMO_MODE=false`, and excludes generated `.dev.vars` and fixtures. Scan build and rehearsal outputs against every private bundle value and administrator hash without printing matches. With no source/artifact changes after those checks, rehearse the initial upload with the complete bundle:

   ```sh
   npx --no-install wrangler deploy --config dist/lensasamsol/wrangler.json --secrets-file .wrangler/staging-credentials/secrets.json --dry-run
   ```

   The directory `dist/lensasamsol` is the Vite output directory; the generated manifest Worker name must be `lensasamsol-staging`. Do not infer the target from the directory name. The existing `release.mjs deploy` does not accept a secrets-file argument, so this first deployment uses the verified generated manifest directly. Only after explicit approval and successful checks, deploy code and all five secrets together:

   ```sh
   npx --no-install wrangler deploy --config dist/lensasamsol/wrangler.json --secrets-file .wrangler/staging-credentials/secrets.json
   ```

   Do not bootstrap with incomplete application code, individual `secret put` operations, or a temporarily weakened `secrets.required` list. If any check fails, stop before uploading. Keep Wrangler at its normal log level; never enable debug/trace logging while handling secrets.

6. Verify `/api/health` returns `{"ok":true,"demoMode":false}`. In private browser sessions, test both administrators login, protected access, logout, and rejection after logout; verify anonymous admin API calls are denied and session cookies are Secure/HttpOnly/SameSite=Lax. Connect Drive while signed in as an administrator and authorize the allowed Google account. Confirm the displayed connected email, synchronize a real test folder, and compare photo counts and thumbnails with Drive. Test a published client gallery anonymously, including PIN restrictions if configured, original-file access under the intended Drive sharing, and denial after revocation. Never record session cookies, OAuth callback parameters, private gallery links, or tokens in logs/reports. Real-account OAuth, synchronization, and gallery access remain unverified until these steps are actually observed; Google consent requires the owner's interaction.

## 5. Later deployments

Run `check`, then `build`, then `dryrun`, then `deploy --approve <env>`, as described in [DEPLOYMENT.md](DEPLOYMENT.md). Apply any new migrations (with a backup) before deploying code that depends on them.

## 6. Rotation

- **Administrator password:** regenerate `ADMIN_CREDENTIALS_JSON` and `secret put` it. Every existing session for both administrators is invalidated, because sessions are bound to a fingerprint of the whole credential set.
- **TOKEN_ENCRYPTION_KEY:** after changing it, the stored Google tokens cannot be read. Disconnect Drive first, rotate the key, then reconnect.
- **Google client secret:** rotate it in Google Cloud, `secret put` the new value, then reconnect Drive if refresh starts failing.

## 7. Rollback and recovery

```sh
npx --no-install wrangler deployments list --env <env>
npx --no-install wrangler rollback <version-id> --env <env>
```

A rollback restores code only. It does not undo migrations. To restore the database, use D1 Time Travel (`npx --no-install wrangler d1 time-travel info|restore DB --env <env> --timestamp <ISO>`) or import the export taken before the migration. Restoring overwrites newer data, so take a fresh export first.

## 8. Emergency shut-off

- **Close all client links:** revoke each gallery in the admin UI, or unpublish it.
- **Take the whole site offline:** run `npx --no-install wrangler secret delete TOKEN_ENCRYPTION_KEY --env <env>`. The configuration guard then returns 503 for every API and image request, so galleries, images and admin all stop working. Only the static shell still loads. Restoring the same key value brings the site back with no data loss. Keep a private copy of the key before you delete it.
- Drive sharing is separate. A file shared as "Anyone with the link" stays reachable on Drive until its sharing is changed in Google Drive.
