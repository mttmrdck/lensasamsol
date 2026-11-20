# Production implementation inventory — 20 November 2026

- Existing React/Vite/Workers/D1 architecture matches the intended stack. Public token + assigned-photo checks precede image cache reads. Draft/published style snapshots, static landing, virtualization, viewer, encryption and local tests exist.
- No Git commits exist; application files are untracked. Preserve them; release identification must use a source digest until the owner initializes version control.
- Root Wrangler config is local-demo-only: DEMO_MODE=true, localhost origin, zero D1 ID. No staging/production overlays, release preflight, built-runtime smoke gate, CI or recovery scripts exist.
- Local secret inventory contains only ADMIN_PASSWORD_HASH and TOKEN_ENCRYPTION_KEY. Google OAuth credentials are absent. No account was connected for this task.
- Google OAuth/Drive code exists but real account sync, permission behavior, token refresh and anonymous original-file access are unverified. Optional Picker deliberately exposes a short-lived access token to the authenticated owner, never a refresh token or client secret.
- Source review targets: safe production configuration/default-password rejection; HTML security headers and API fallbacks; OAuth state/session binding and Google identity; supported thumbnail links and bounded delivery; truncated/incomplete sync preservation; authentication/token regression tests.
- All migrations 0001–0004 reviewed. Need clean and representative upgrade checks, including cascade deletion and constraints. Remote migrations require separate approval and backup.
- The official Cloudflare security-audit skill was inspected and installed. Docker CLI exists but its daemon is unavailable. Formal audit target execution requires stronger isolation than the current shared local preview; perform independent source review and mark dynamic/provider-dependent leads as needs-validation, without claiming confirmed vulnerabilities from untrusted execution.
- No production action, account connection, secret update, paid service or resource creation is authorized by this preparation brief.
