# Environment and identity contract

The application has two configured password administrators, `solfb1` and `akiffb1`. Both sign in at `/admin/login` with their own username and password. There is no public registration and Google is not the administrator sign-in method. Passwords must be delivered privately; they are never recorded in these documents.

An administrator connects one Google Drive account through a separate, one-time OAuth consent flow. The account must match `GOOGLE_ALLOWED_EMAIL`. Connecting Drive does not add an administrator. Both administrators operate the same studio and Drive connection.

| Setting | Development / isolated test | Staging / production |
| --- | --- | --- |
| `APP_ENV` | `development` | Exact environment name |
| `DEMO_MODE` | `true` allowed locally | Literal string `false` |
| `PUBLIC_ORIGIN` | Loopback 5188 / test 5190 | Exact HTTPS origin, no trailing slash |
| `DB` | Local development / separate test D1 binding | Distinct explicitly selected remote D1 UUID per environment |
| `IMAGES` | Local Images codec, independently bound for development/test | Streaming derivative binding prepared for staging only; no production configuration change |
| `ADMIN_CREDENTIALS_JSON` | Local private `.dev.vars` / isolated test secrets | Worker secret, two operator accounts |
| `TOKEN_ENCRYPTION_KEY` | Local private secret | Unique per environment; base64 32 random bytes |
| `GOOGLE_CLIENT_ID` | Optional for local demo | Worker secret for approved OAuth web client |
| `GOOGLE_CLIENT_SECRET` | Optional for local demo | Worker secret |
| `GOOGLE_ALLOWED_EMAIL` | Required when exercising real connection | Exact approved owner email, Worker secret |

`ADMIN_CREDENTIALS_JSON` contains an array of `{ "username": "…", "passwordHash": "…" }` objects (maximum eight). Use exactly the two agreed accounts for this installation. Each hash has the form `pbkdf2$sha256$100000$<base64 16-byte salt>$<base64 32-byte digest>`. The public demo password is rejected outside development. The optional legacy `ADMIN_USERNAME` plus `ADMIN_PASSWORD_HASH` configuration supports a single account; it is a migration fallback, not the intended two-account setup.

Use the hidden terminal prompt to set or rotate the local accounts:

```sh
node scripts/set-admin-users.mjs solfb1 akiffb1
```

Never put plaintext passwords in shell arguments, committed files, issue comments or screenshots. `npm run gen-key` prints a new encryption key; capture it privately. Preserve the existing key when retaining an existing encrypted Google connection. Replacing it without a connection migration makes saved tokens unreadable.

`.dev.vars` belongs to local development. Isolated tests use their own generated configuration and database; never point test setup at the operator's development database. `.dev.vars.<environment>` or `.env.<environment>` files are local files, not evidence that remote secrets have been installed. Keep actual secret files outside version control and release assets. The release script removes only generated `dist` sidecars and fixture assets, scans selected release outputs against locally available secret values, and never deletes the source `.dev.vars` or `public/__fixtures`.

Staging selects D1 `lensasamsol-staging` (`dbf64834-4fdd-4ea6-9859-5f70aeff890a`) and `PUBLIC_ORIGIN=https://lensasamsol-staging.lnoa.workers.dev`. The owner reports migrations 0001–0005 applied; confirm remote migration status before deployment. Production remains unconfigured and is outside this staging setup. `node scripts/release.mjs check <env>` and every Vite build in CI (`WORKERS_CI=1` or `CI=true`) reject placeholders in the selected environment, `DEMO_MODE` other than `false`, invalid HTTPS origins, or missing required secret declarations. Worker names: `lensasamsol` (production) and `lensasamsol-staging`; never reuse development, test, or production infrastructure for staging.

Select staging builds with `CLOUDFLARE_ENV=staging`; `node scripts/release.mjs build staging` sets this automatically. Deploy the resulting staging manifest rather than the root development configuration. The exact five staging secrets are `ADMIN_CREDENTIALS_JSON`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ALLOWED_EMAIL`. There is no separate session signing key: each login creates a random 32-byte session token and D1 stores its hash. Real Google integration remains **BLOCKED_REAL_ACCOUNT_TEST** until OAuth and Drive operations are tested with an authorized account.

For secure first-deployment preparation and private terminal prompts, see [the staging setup procedure](OPERATIONS.md#staging-first-deployment).
