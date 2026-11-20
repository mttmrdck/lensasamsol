# Environment and identity contract

The application has two configured password administrators, `solfb1` and `akiffb1`. Both sign in at `/admin/login` with their own username and password. There is no public registration and Google is not the administrator sign-in method. Passwords must be delivered privately; they are never recorded in these documents.

An administrator connects one Google Drive account through a separate, one-time OAuth consent flow. The account must match `GOOGLE_ALLOWED_EMAIL`. Connecting Drive does not add an administrator. Both administrators operate the same studio and Drive connection.

| Setting | Development / isolated test | Staging / production |
| --- | --- | --- |
| `APP_ENV` | `development` | Exact environment name |
| `DEMO_MODE` | `true` allowed locally | Literal string `false` |
| `PUBLIC_ORIGIN` | Loopback 5188 / test 5190 | Exact HTTPS origin, no trailing slash |
| `DB` | Local development / separate test D1 binding | Distinct explicitly selected remote D1 UUID per environment |
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

The checked-in remote database UUIDs and origins are deliberately unconfigured placeholders (all-zero UUIDs, empty `PUBLIC_ORIGIN`). `node scripts/release.mjs check <env>` and every Vite build in CI (`WORKERS_CI=1` or `CI=true`) refuse to proceed while any remain, while `DEMO_MODE` is not `false`, while the origin is not a real HTTPS origin, or while `secrets.required` omits a required secret. Worker names: `lensasamsol` (production, the existing dashboard Worker) and `lensasamsol-staging`; databases `lensasamsol-production` and `lensasamsol-staging`. Real account ownership, D1 provisioning, remote secrets and Google OAuth credentials remain **BLOCKED_REAL_ACCOUNT_TEST** until the owner performs and approves those operations. Never reuse the development or test database in either remote environment.
