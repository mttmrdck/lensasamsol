import { describe, expect, it } from 'vitest';
import { driveFileUrl, driveFolderUrl, parseDriveFolderInput, safeDriveUrl } from '../../shared/drive';
import {
  DEFAULT_STYLE,
  PRESETS,
  THEMES,
  applyPreset,
  contrastRatio,
  parseStyle,
  presetOverrides,
  resolveTheme,
  styleConfigSchema,
} from '../../shared/style';
import { decryptSecret, encryptSecret, verifyPassword } from '../../worker/crypto';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('parseDriveFolderInput', () => {
  it.each([
    [`https://drive.google.com/drive/folders/${ID}`, null],
    [`https://drive.google.com/drive/folders/${ID}?usp=sharing`, null],
    [`https://drive.google.com/drive/u/1/folders/${ID}/`, null],
    [`drive.google.com/drive/folders/${ID}?resourcekey=0-abcDEF`, '0-abcDEF'],
    [`https://drive.google.com/open?id=${ID}`, null],
    [ID, null],
  ])('accepts %s', (input, rk) => {
    const r = parseDriveFolderInput(input);
    expect(r).toEqual({ ok: true, folderId: ID, resourceKey: rk });
  });

  it.each([
    ['', 'empty'],
    ['https://evil.example.com/drive/folders/' + ID, 'not-drive'],
    ['http://drive.google.com/drive/folders/' + ID, 'not-drive'],
    ['https://drive.google.com.evil.com/drive/folders/' + ID, 'not-drive'],
    [`https://drive.google.com/file/d/${ID}/view`, 'not-folder'],
    ['https://drive.google.com/drive/folders/abc', 'bad-id'],
    [`https://drive.google.com/drive/folders/${ID}'%20or%20'1`, 'bad-id'],
    ['javascript:alert(1)', 'not-drive'],
  ])('rejects %s', (input, reason) => {
    expect(parseDriveFolderInput(input)).toEqual({ ok: false, reason });
  });

  it('builds canonical links and only trusts Drive hosts', () => {
    expect(driveFolderUrl(ID, 'rk')).toBe(`https://drive.google.com/drive/folders/${ID}?resourcekey=rk`);
    expect(driveFileUrl(ID)).toBe(`https://drive.google.com/file/d/${ID}/view`);
    expect(safeDriveUrl('https://drive.google.com/file/d/x/view')).not.toBeNull();
    expect(safeDriveUrl('https://evil.com/x')).toBeNull();
    expect(safeDriveUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('style config', () => {
  it('default and every preset validate', () => {
    expect(styleConfigSchema.safeParse(DEFAULT_STYLE).success).toBe(true);
    for (const p of PRESETS)
      expect(styleConfigSchema.safeParse(applyPreset(DEFAULT_STYLE, p)).success).toBe(true);
  });
  it('preset application keeps content settings and reports overrides', () => {
    const custom = {
      ...DEFAULT_STYLE,
      actions: { ...DEFAULT_STYLE.actions, showFilenames: true },
      layout: { ...DEFAULT_STYLE.layout, gap: 30 },
    };
    expect(presetOverrides(custom, PRESETS[0])).toEqual(['spacing']);
    const applied = applyPreset(custom, PRESETS[2]);
    expect(applied.actions.showFilenames).toBe(true);
    expect(applied.color.theme).toBe('darkroom');
  });
  it('parseStyle falls back safely on bad JSON and merges partial data', () => {
    expect(parseStyle('not json')).toEqual(DEFAULT_STYLE);
    const partial = parseStyle(JSON.stringify({ layout: { mode: 'masonry' } }));
    expect(partial.layout.mode).toBe('masonry');
    expect(partial.cover).toEqual(DEFAULT_STYLE.cover);
  });
  it('built-in themes meet WCAG AA for body text', () => {
    for (const t of Object.values(THEMES)) {
      expect(contrastRatio(t.fg, t.bg)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(t.fg2, t.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('custom backgrounds always get readable text', () => {
    for (const bg of ['#FFFFFF', '#000000', '#7F7F7F', '#2A4B8D', '#F2E8C9', '#4A4A40']) {
      const t = resolveTheme({ theme: 'archival', customBg: bg, lightbox: 'darkroom' });
      expect(t.contrast).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.fg2, t.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('crypto', () => {
  it('AES-GCM round-trips and rejects tampering', async () => {
    const key = randomBytes(32).toString('base64');
    const blob = await encryptSecret('1//refresh-token', key);
    expect(blob).not.toContain('refresh');
    expect(await decryptSecret(blob, key)).toBe('1//refresh-token');
    const tampered = blob.slice(0, -4) + (blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
    await expect(decryptSecret(blob, randomBytes(32).toString('base64'))).rejects.toThrow();
  });
  it('verifies PBKDF2 hashes from the hash-password script format', async () => {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync('correct horse battery', salt, 100000, 32, 'sha256');
    const stored = `pbkdf2$sha256$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
  });
});
