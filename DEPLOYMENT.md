# Deployment runbook

The prepared source is not a live deployment. No Cloudflare account, database, Google connection, paid plan or domain is created by these instructions automatically. Real integration remains **BLOCKED_REAL_ACCOUNT_TEST** until the owner approves the account-dependent work and records the results.

## Owner decisions before release

Choose the Cloudflare account owner, Google Drive account owner, separate staging/production D1 databases, exact public origins and a backup custodian. Keep recovery methods and MFA under the owner's control. The production Worker is the existing `lensasamsol` Worker; staging is `lensasamsol-staging`. Configure both remote D1 UUIDs in `wrangler.jsonc`; the release isolation guard rejects placeholder or shared databases. Set the selected environment's exact HTTPS `PUBLIC_ORIGIN` and retain `APP_ENV` and `DEMO_MODE=false`.

A domain purchase is not required. The configured `workers_dev=true` environments can use their final `https://<worker>.<account-subdomain>.workers.dev` addresses; discover the account subdomain before setting the origin and Google redirect URI. Custom domains can be added later. Do not assume the application's Cache API image caching works on workers.dev; verify that separately, as Cloudflare documents functional Cache API operations for Workers on custom domains. Browser caching still needs its own verification. [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).

## Local verification

Install locked dependencies with `npm ci` when needed. Use only the repository's installed Wrangler and Vite. Run the project checks and isolated migration rehearsal:

```sh
npm run typecheck
npm run lint
npm test
node scripts/check-migrations.mjs
npm run test:e2e
```

The migration checker opens temporary SQLite files only and writes `test-results/migrations.json`. Browser tests use the isolated test environment at `http://localhost:5190`; operator development remains at 5188. Review the actual test output. A local demo pass cannot establish a real Google/Cloudflare integration pass.

To inspect the built Worker locally, build the test environment and discover its generated configuration:

```sh
node scripts/prepare-test-env.mjs
CLOUDFLARE_ENV=test npx --no-install vite build
node -e 'const fs=require("node:fs"); for(const e of fs.readdirSync("dist",{withFileTypes:true})){ const p=`dist/${e.name}/wrangler.json`; if(e.isDirectory()&&fs.existsSync(p)){const c=JSON.parse(fs.readFileSync(p));if(c.name==="lensasamsol-test")console.log(p)}}'
```

Use the printed path in place of `<generated-test-config>` below. Run this on loopback only; keep the same isolated persistence directory as test migration/seed preparation. Never substitute a release configuration or operator persistence directory.

```sh
npx --no-install wrangler dev --config <generated-test-config> --local --ip 127.0.0.1 --port 5190 --persist-to .wrangler/test-state
curl --fail http://127.0.0.1:5190/api/health
curl --fail http://127.0.0.1:5190/admin/login
```

Check a built `/g/<test-share-token>` gallery, login/logout, static assets and API routing using disposable test credentials. An unauthenticated admin API request must fail. Verify that unknown API and image paths receive API/image errors rather than the SPA document. Stop the server when finished. This is a local runtime check, never a public test or Google connectivity check.

## Prepare the selected release

Run the following only after the owner fills the real environment configuration. These commands do not create cloud resources, install secrets or apply migrations:

```sh
node scripts/release.mjs check staging
node scripts/release.mjs build staging
node scripts/release.mjs dryrun staging
```

Repeat for `production` after staging acceptance. `check` validates the strict JSON environment overlay and D1 isolation without network calls. `build` selects the Vite Cloudflare environment, discovers `dist/*/wrangler.json`, removes generated secret sidecars and demo fixtures, scans the selected client/Worker outputs for locally known secret values, and records source/artifact SHA-256 digests under `test-results/release/<environment>/manifest.json`. It never modifies source secret files or fixtures. `dryrun` runs Wrangler's `--dry-run` compilation/upload validation without uploading and records evidence. It cannot prove that remote secrets, migrations or account permissions are correct.

Changing source, configuration or generated release assets invalidates the manifest and requires rebuilding and repeating dryrun. Building the test environment can replace shared client assets, so finish all test builds before preparing release artifacts. Preserve the manifest and verification reports with the release record. The manifest is a local integrity check, not a signed attestation or a substitute for code review.

## Separately approved remote operations

Resource creation, account login, secret changes, backups, remote migrations and deployment each require owner approval. Do not run them as part of local preparation. The exact commands and backup requirements are in [OPERATIONS.md](OPERATIONS.md). Review the selected account, Worker and D1 UUID before every remote operation.

Before deployment, verify required remote secrets exist, both approved administrator passwords work, Google owner pinning is correct, the approved migrations are applied, and staging real-account tests have passed. For first-ever deployment, coordinate bootstrap and secret installation explicitly: secret version commands need an existing Worker version and must not be assumed to bootstrap an undeployed service. Keep the service unadvertised until runtime validation passes.

Only after explicit owner approval, deploy the selected built artifact:

```sh
node scripts/release.mjs deploy staging --approve staging
# Production is a separate approval:
node scripts/release.mjs deploy production --approve production
```

The deploy gate requires unchanged source/artifact digests and matching dryrun evidence. It does not run migrations or change secrets. Afterwards record the deployed Worker version, origin, D1 UUID, migration list and real acceptance results. Health must report demo mode off; confirm both administrator identities and reconnect Drive only if required. Do not label the release operational until the owner checks the real Drive workflows in [HANDOVER.md](HANDOVER.md).
