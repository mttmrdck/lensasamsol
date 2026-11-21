# Staging secret helper implementation plan

> Implement directly using the executing-plans skill. The owner explicitly requested this local helper; no deployment is authorized in this phase.

**Goal:** Complete the private five-secret staging bundle with one terminal command.

**Architecture:** A Node script reuses the existing hidden terminal input helper, preserves existing key/email and credentials, hashes missing administrator passwords, and atomically saves a private JSON file. It performs no network operations.

**Tech Stack:** Node built-in filesystem/crypto, existing hiddenInput helper.

**Spec:** The owner's six requirements in the current conversation: missing administrator password prompts, private Google credential prompts, existing key/email preservation, exact staging JSON destination, secret-free verification, one command. No Cloudflare upload/deployment or production changes.

## Global constraints

- Destination: `.wrangler/staging-credentials/secrets.json`, relative to the repository regardless of caller cwd.
- Exactly `solfb1` and `akiffb1`; salted PBKDF2 SHA256 / 100000 / 32-byte digest, confirmed distinct passwords of at least 12 characters.
- Preserve the existing encryption key and allowed email; stop safely if missing/invalid.
- Never log secrets, include secret values in error messages, or accept them as command arguments.
- Keep storage private; refuse symlinks; save atomically only after successful collection/validation.

## Review focus

- Cancellation or confirmation mismatch must not overwrite the existing bundle.
- Existing complete credentials must not be regenerated on rerun.
- Wrong cwd must not target another bundle.
- Malformed private input must not appear in errors.
- Local-only execution, including failure paths.

## Task

- [x] Add `scripts/complete-staging-secrets.mjs`, using hidden prompts and safe generic failure output.
- [x] Replace long setup instructions in `OPERATIONS.md` with the single command.
- [x] Check syntax and exercise interactive completion/rerun/cancel/error paths with synthetic secrets in a temporary project copy; compare real bundle digest before/after.
- [x] Review the helper and provide only the terminal command requested by the owner.

Verification: `node --check` passed. Synthetic PTY checks covered hidden entry, confirmation/duplicate-password/OAuth retries, hash correctness, exact bundle/permissions, preservation, alternate cwd, rerun, cancellation, noninteractive failure, malformed JSON redaction, partial accounts, unsafe permissions, and symlink rejection. The real staging bundle digest was unchanged. Independent read-only review found no critical or important issues; crash durability and concurrent-writer locking are outside this local helper's scope. No deployment, secret upload, production changes, or commits were performed.
