# Operations (account-dependent commands)

Every command in this file touches a real Cloudflare account. None of them has been run for this project. Each one needs the owner's approval before it runs. Before running a command, confirm the logged-in account (`npx --no-install wrangler whoami`), the Worker name and the D1 UUID. Replace `<env>` with `staging` or `production`. Finish staging completely before starting production.

Use only the repository's installed Wrangler (`npx --no-install wrangler`).

## 1. Create the databases (once per environment)

```sh
npx --no-install wrangler d1 create archive-gallery-<env>
```

Copy the printed `database_id` into `env.<env>.d1_databases[0].database_id` in `wrangler.jsonc`. Staging and production must use different databases. Never point either one at the development or test database. Then run `node scripts/release.mjs check <env>`.

## 2. Origin and Google OAuth client

1. Find the account's workers.dev subdomain in the Cloudflare dashboard (Workers & Pages → Settings). The origin is `https://archive-gallery-<env>.<subdomain>.workers.dev`, or a custom domain added later.
2. Put that exact origin in `env.<env>.vars.PUBLIC_ORIGIN`, with no trailing slash.
3. In Google Cloud, add the redirect URI `<PUBLIC_ORIGIN>/api/admin/drive/callback` to the OAuth web client. A separate client for staging is recommended.

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

## 4. First deployment and secrets

`wrangler secret put` needs an existing Worker. On a first deployment, deploy the built artifact before installing the secrets. Until all required secrets are valid, the configuration guard returns HTTP 503 for every `/api/*` and `/img/*` request. In that window, no gallery data, images or admin actions are served. Static assets (the app shell) are still served directly.

```sh
node scripts/release.mjs build <env>
node scripts/release.mjs dryrun <env>
node scripts/release.mjs deploy <env> --approve <env>
```

Then install the secrets. Each command prompts for the value, so the value never appears in shell history:

```sh
npx --no-install wrangler secret put ADMIN_CREDENTIALS_JSON --env <env>   # [{"username":"solfb1",...},{"username":"akiffb1",...}]
npx --no-install wrangler secret put TOKEN_ENCRYPTION_KEY --env <env>     # npm run gen-key; unique per environment
npx --no-install wrangler secret put GOOGLE_CLIENT_ID --env <env>
npx --no-install wrangler secret put GOOGLE_CLIENT_SECRET --env <env>
npx --no-install wrangler secret put GOOGLE_ALLOWED_EMAIL --env <env>
# Optional: GOOGLE_PICKER_API_KEY, GOOGLE_PROJECT_NUMBER
npx --no-install wrangler secret list --env <env>
```

To generate the `ADMIN_CREDENTIALS_JSON` value without exposing passwords, run `node scripts/set-admin-users.mjs solfb1 akiffb1` against a throwaway checkout, or temporarily move your local `.dev.vars` aside first. Copy the JSON line, then restore the file. Production passwords must differ from local ones, and must not be the demo passphrase (the Worker rejects it).

Check that `curl -s <PUBLIC_ORIGIN>/api/health` returns `{"ok":true,"demoMode":false}`. A 503 response means a secret or variable is still missing or invalid.

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
