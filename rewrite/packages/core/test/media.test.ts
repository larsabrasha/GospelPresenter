import { describe, expect, it } from 'vitest';
import { fitWithin, IMAGE_VARIANTS, imageTypeFromName, mediaKey, sniffStoredImage, storedTypeFor, utf8Encode } from '@gp/core';

// MEDIA-R4, R11 and R13: the rules a picture is stored by.
describe('media rules', () => {
  it('fits within the box, keeps the aspect and never upscales (MEDIA-A2, A4)', () => {
    const { full, thumb } = IMAGE_VARIANTS;
    expect(fitWithin(4000, 3000, full.width, full.height)).toEqual({ width: 1440, height: 1080 });
    expect(fitWithin(4000, 3000, thumb.width, thumb.height)).toEqual({ width: 300, height: 225 });
    expect(fitWithin(200, 100, full.width, full.height)).toEqual({ width: 200, height: 100 });
    expect(fitWithin(200, 100, thumb.width, thumb.height)).toEqual({ width: 200, height: 100 });
    expect(fitWithin(5000, 10, full.width, full.height)).toEqual({ width: 1920, height: 4 });
  });

  it('takes the type from the extension, any case (MEDIA-R13)', () => {
    expect(imageTypeFromName('Logo.JPG')).toBe('image/jpeg');
    expect(imageTypeFromName('a.b.png')).toBe('image/png');
    expect(imageTypeFromName('x.bmp')).toBeNull();
    expect(imageTypeFromName('noextension')).toBeNull();
  });

  it('stores JPEG as JPEG and everything else as WebP (MEDIA-R4)', () => {
    expect(storedTypeFor('image/jpeg')).toBe('image/jpeg');
    for (const t of ['image/png', 'image/webp', 'image/gif'] as const) expect(storedTypeFor(t)).toBe('image/webp');
  });

  it('recognises a stored picture by its signature, not by what is claimed (MEDIA-A6)', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffStoredImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffStoredImage(webp)).toBe('image/webp');
    expect(sniffStoredImage(utf8Encode('this is text, not a picture'))).toBeNull();
    expect(sniffStoredImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG is converted before it is stored
    expect(sniffStoredImage(new Uint8Array())).toBeNull();
  });

  it('keys a blob under its organisation, and refuses anything but a hash (MEDIA-R11)', () => {
    const hash = 'a'.repeat(64);
    expect(mediaKey('org-1', hash)).toBe(`org/org-1/media/${hash}`);
    expect(mediaKey('../x', hash)).toBe(`org/%2E%2E%2Fx/media/${hash}`);
    expect(mediaKey('..', hash)).toBe(`org/%2E%2E/media/${hash}`);
    expect(() => mediaKey('org-1', '../../etc/passwd')).toThrow();
    expect(() => mediaKey('org-1', 'A'.repeat(64))).toThrow();
  });
});
