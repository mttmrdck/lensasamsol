import { execSync } from 'node:child_process';

/** Removes test-only galleries so the local demo database stays clean. */
export default function globalTeardown() {
  execSync(
    `npx wrangler d1 execute DB --local --env test --command "DELETE FROM collections WHERE id = 'col_e2e_drive' OR title LIKE 'E2E %'; DELETE FROM login_attempts;"`,
    { stdio: 'ignore' },
  );
}
