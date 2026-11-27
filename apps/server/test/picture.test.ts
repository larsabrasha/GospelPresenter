// A picture fetched for MCP (docs/mcp.md, "Pictures"): which addresses the server refuses, and how a picture's kind and
// size are read from its first bytes, before anything is decoded.
import { describe, expect, it } from 'vitest';
import { privateAddress } from '../src/picture-fetch.ts';
import { headerSize, makePicture, MAX_PIXELS, sourceKind } from '../src/picture-import.ts';
import type { PictureCodecs } from '../src/picture-codecs.ts';

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
/** A PNG's signature and header, no pixels. */
const pngHeader = (width: number, height: number) => bytes('\x89PNG\r\n\x1a\n', u32be(13), 'IHDR', u32be(width), u32be(height), [8, 6, 0, 0, 0]);

describe('the addresses the server refuses to fetch from', () => {
  it.each(['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1'])(
    'refuses %s, which is this machine or a private network',
    (ip) => {
      expect(privateAddress(ip)).toBe(true);
    },
  );

  it.each(['93.184.216.34', '2606:4700::1111', '172.32.0.1'])('lets %s through, an address on the internet', (ip) => {
    expect(privateAddress(ip)).toBe(false);
  });
});

describe("a picture's kind and size from its header", () => {
  it('reads a PNG by its signature, whatever it is called', () => {
    expect(sourceKind(pngHeader(1, 1))).toBe('png');
  });

  it('reads a web page as no picture', () => {
    expect(sourceKind(bytes('<!doctype html>'))).toBeNull();
  });

  it('reads an SVG after its XML declaration and a comment', () => {
    expect(sourceKind(bytes('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg');
  });

  it('reads a web page with an svg inside it as no picture', () => {
    expect(sourceKind(bytes('<!doctype html><html><body><svg></svg></body></html>'))).toBeNull();
  });

  it("reads a PNG's width and height from its header", () => {
    expect(headerSize('png', pngHeader(3000, 1000))).toEqual({ width: 3000, height: 1000 });
  });

  it("reads a JPEG's size from its frame header, past the segments before it", () => {
    const app0 = [0xff, 0xe0, 0, 4, 0, 0];
    // Its height, then its width, each two bytes.
    const sof0 = [0xff, 0xc0, 0, 11, 8, 1000 >> 8, 1000 & 255, 3000 >> 8, 3000 & 255, 3];

    expect(headerSize('jpeg', bytes([0xff, 0xd8], app0, sof0))).toEqual({ width: 3000, height: 1000 });
  });

  it("reads an extended WebP's size from its VP8X chunk", () => {
    const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

    expect(headerSize('webp', bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0x10, 0, 0, 0], le24(2999), le24(999)))).toEqual({ width: 3000, height: 1000 });
  });
});

describe('a picture too large to hold', () => {
  it('is refused from its header, before it is decoded', async () => {
    const side = Math.ceil(Math.sqrt(MAX_PIXELS)) + 1;
    const codecs = { decode: () => Promise.reject(new Error('decoded')) } as unknown as PictureCodecs;

    await expect(makePicture(pngHeader(side, side), codecs)).rejects.toMatchObject({ code: 'too-large' });
  });
});
