import { describe, expect, it } from 'vitest';
import { attachmentHeader, nameFromDisposition, downloadContentType, safeFileName, uniqueNames, zipBaseName } from '../../shared/download';

describe('download naming', () => {
  it('keeps original names and extensions, and removes path tricks', () => {
    expect(safeFileName('IMG_0042.JPG')).toBe('IMG_0042.JPG');
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j.jpg')).toBe('a_b_c_d_e_f_g_h_i_j.jpg');
    expect(safeFileName('  ..hidden.jpg ')).toBe('hidden.jpg');
    expect(safeFileName('')).toBe('photo');
    expect(safeFileName(null)).toBe('photo');
    expect(safeFileName('x\u0000y\u001f.png')).toBe('x_y_.png');
  });
  it('shortens very long names but keeps the extension', () => {
    const n = safeFileName('a'.repeat(400) + '.jpeg');
    expect(n.length).toBeLessThanOrEqual(180);
    expect(n.endsWith('.jpeg')).toBe(true);
  });
  it('builds a Content-Disposition with an ASCII fallback and the exact UTF-8 name', () => {
    const h = attachmentHeader('Café "Ñandú" 1.jpg');
    expect(h).toBe(`attachment; filename="Cafe _Nandu_ 1.jpg"; filename*=UTF-8''Caf%C3%A9%20_%C3%91and%C3%BA_%201.jpg`);
    expect(attachmentHeader('IMG_1.jpg')).toContain('filename="IMG_1.jpg"');
    // header injection is impossible: no CR/LF or quotes survive
    expect(attachmentHeader('a\r\nSet-Cookie: x=1.jpg')).not.toMatch(/[\r\n]/);
  });
  it('makes a meaningful ASCII zip name', () => {
    expect(zipBaseName("Firazana's Convocation Day")).toBe('Firazanas-Convocation-Day');
    expect(zipBaseName('Mariée & Co — Été 2026')).toBe('Mariee-Co-Ete-2026');
    expect(zipBaseName('')).toBe('photos');
    expect(zipBaseName('???')).toBe('photos');
  });
  it('de-duplicates names case-insensitively, keeping order and extensions', () => {
    expect(uniqueNames(['a.jpg', 'A.JPG', 'a.jpg', 'b.png', 'noext', 'noext'])).toEqual([
      'a.jpg',
      'A (2).JPG',
      'a (3).jpg',
      'b.png',
      'noext',
      'noext (2)',
    ]);
    // a generated name never collides with a real one
    expect(uniqueNames(['a.jpg', 'a (2).jpg', 'a.jpg'])).toEqual(['a.jpg', 'a (2).jpg', 'a (3).jpg']);
  });
  it('reads back exactly what the server sent', () => {
    for (const n of ['IMG_0042.JPG', 'Café "Ñandú" 1.jpg', 'a b (2).png', "o'brien; x.jpg"])
      expect(nameFromDisposition(attachmentHeader(n))).toBe(safeFileName(n));
    expect(nameFromDisposition('attachment; filename="plain.jpg"')).toBe('plain.jpg');
    expect(nameFromDisposition(null)).toBeNull();
  });
  it('only emits indexed image content types', () => {
    expect(downloadContentType('image/jpeg')).toBe('image/jpeg');
    expect(downloadContentType('text/html')).toBe('application/octet-stream');
    expect(downloadContentType(undefined)).toBe('application/octet-stream');
  });
});
