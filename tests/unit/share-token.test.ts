import { describe, expect, it } from 'vitest';
import { shareTokenSchema } from '../../shared/api';
import { randomToken } from '../../worker/crypto';

describe('share tokens', () => {
  it('Worker tokens are 24 base64url chars (144 bits) and unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = randomToken(18);
      expect(t).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(shareTokenSchema.safeParse(t).success).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });
  it('accepts migration backfill tokens and rejects malformed input', () => {
    expect(shareTokenSchema.safeParse('0123456789abcdef0123456789abcdef').success).toBe(true);
    for (const bad of [
      '',
      'short',
      'coastline-late',
      '../../etc/passwd',
      'a'.repeat(65),
      'abc def ghi jkl mno pqr',
      "x' OR '1'='1",
    ])
      expect(shareTokenSchema.safeParse(bad).success, bad).toBe(false);
  });
});
