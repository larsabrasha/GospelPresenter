import { describe, expect, it } from 'vitest';
import { audioTypeFromName, fitWithin, IMAGE_VARIANTS, imageTypeFromName, MEDIA_LIMITS, mediaKey, sniffAudio, sniffMedia, sniffStoredImage, storedTypeFor, utf8Encode } from '@gp/core';

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

describe('audio (MEDIA-R1, R5, R13)', () => {
  const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

  it('recognises each accepted kind by its first bytes', () => {
    expect(sniffAudio(bytes('ID3', [3, 0, 0]))).toBe('audio/mpeg');
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90, 0x00]))).toBe('audio/mpeg'); // an MP3 frame with no tag
    expect(sniffAudio(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBe('audio/wav');
    expect(sniffAudio(bytes('OggS', [0]))).toBe('audio/ogg');
    expect(sniffAudio(bytes([0, 0, 0, 0x20], 'ftypM4A '))).toBe('audio/x-m4a');
    expect(sniffAudio(bytes([0, 0, 0, 0x20], 'ftypisom'))).toBe('audio/mp4');
    expect(sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('audio/webm');
    expect(sniffAudio(utf8Encode('not a sound'))).toBeNull();
    expect(sniffAudio(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBeNull(); // a picture, not a sound
  });

  it('takes a picture up to 10 MiB and a sound up to 20 MiB', () => {
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff]))).toEqual({ type: 'image/jpeg', maxBytes: MEDIA_LIMITS.blobBytes });
    expect(sniffMedia(bytes('OggS'))).toEqual({ type: 'audio/ogg', maxBytes: MEDIA_LIMITS.audioBytes });
    expect(sniffMedia(utf8Encode('text'))).toBeNull();
  });

  it('takes the type from the extension on a device', () => {
    expect(audioTypeFromName('Psalm.MP3')).toBe('audio/mpeg');
    expect(audioTypeFromName('a.m4a')).toBe('audio/x-m4a');
    expect(audioTypeFromName('a.m4b')).toBe('audio/mp4');
    expect(audioTypeFromName('a.flac')).toBeNull();
  });
});
