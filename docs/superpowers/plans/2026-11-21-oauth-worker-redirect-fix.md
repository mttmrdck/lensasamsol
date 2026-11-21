# OAuth Worker redirect correction implementation plan

**Goal:** Fix the confirmed staging callback runtime failure locally and prove safe redirect/error handling before requesting deployment approval.

**Spec:** Current user request: investigate the four Worker `redirect: error` calls independently of Node probes; identify the actual callback stage; reject upstream redirects safely; inspect session, allowlist, identity, encryption and persistence; add regressions. No remote writes, credential changes, or deployment.

**Architecture:** Preserve the Google client's existing no-redirect security policy using a Workers-compatible `manual` fetch wrapper. Reject 3xx responses explicitly, inspect only Location presence, and discard bodies. Report callback failures through fixed codes/messages, never exception text. Preserve session/state checks and encrypted D1 storage. Display the sanitized callback failure persistently on Drive Sync so Safari users can report it.

## Constraints and review focus

- No production resource queries/changes, no remote D1 writes, no Google credential use in tests.
- Keep thumbnail manual fetch and local fixture follow behavior unchanged.
- Exercise redirects with and without Location and malicious bodies/URLs; no follow/retry or secret leakage.
- Exercise missing session/state and allowlist/identity/scope denial separately from token exchange.
- Exercise encryption and D1 save failures separately; do not hide them behind a false connected state.

## Tasks

- [x] Reproduce the existing runtime failure in local workerd with outbound requests mocked; verify the deployed artifact contains the same option.
- [x] Add failing tests for exchange/refresh/revocation/Drive redirect handling and safe callback failure paths.
- [x] Apply the targeted redirect wrapper and sanitized callback messages/logging, preserving existing access checks.
- [x] Test successful callback encryption/persistence with fixtures, plus each separate failure stage.
- [x] Run all unit tests, type checking, staging build/dryrun and secret artifact checks; obtain independent read-only review.
- [x] Report evidence, minimal fix, remaining real-account validation and request staging deployment approval.

## Evidence and limits

Read-only inspection of the currently deployed staging Worker found four unsupported redirect settings. Local workerd reproduced the exact TypeError with zero outbound requests. The callback's first token-exchange fetch fails before Google identity/allowlist/scope validation, encryption, or saving the connection. Session and single-use state validation precede the failing call. The callback catches this error and redirects with HTTP 302, explaining the observed symptoms.

The original regression run failed 24 of 26 new cases, including the successful exchange/callback case, against the old redirect policy. After the targeted fix, all 161 tests passed, including 32 new cases and two running the actual Google client in workerd with mocked outbound traffic. Type checking, targeted ESLint, staging build/dryrun, and private artifact checks passed. An isolated Chromium check confirmed the safe callback error persists after URL cleanup and toast expiry and does not display arbitrary error input. Independent read-only review found no critical or important issues.

Test-only D1 declarations were extended for callback imports, and the existing preview byte allocation received a narrower ArrayBuffer return type to satisfy both Node and Worker type checks; this changes no image runtime behavior. No secrets, credentials, remote D1 data, or production resources were changed. No deployment or commit occurred. Actual authorized Google connection, Drive identity, synchronization, and gallery access must be retested after an approved staging deployment; synthetic tests do not establish that integration works.
