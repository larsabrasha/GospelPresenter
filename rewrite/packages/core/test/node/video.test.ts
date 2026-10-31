import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findMoov, partCount, probeVideo, sniffVideoContainer, VIDEO_LIMITS, videoMime, videoTypeFromName, type RangeReader } from '@gp/core';

// The fixtures are three seconds of ffmpeg's test pattern at 160×90, made with:
//   ffmpeg -f lavfi -i testsrc=size=160x90:rate=10:duration=3 -f lavfi -i sine=frequency=440:duration=3 \
//     -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 35 -c:a aac -b:a 24k -shortest h264.mp4   (moov last)
//   … -c:v libx264 -pix_fmt yuv420p -crf 35 -movflags +faststart h264.mov                          (moov first, brand qt)
//   … -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p -crf 35 hevc.mp4
//   … -c:v mpeg4 -q:v 20 mpeg4.mp4                                                                  (refused)
export const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

/** Reads a file in memory, counting the bytes asked for. */
function reader(bytes: Uint8Array): RangeReader & { read: number } {
  const r = Object.assign(async (offset: number, length: number) => ((r.read += Math.min(length, bytes.length - offset)), bytes.slice(offset, offset + length)), { read: 0 });
  return r;
}

describe('video files', () => {
  it('reads H.264 from an MP4 whose moov is at the end', async () => {
    const bytes = fixture('h264.mp4');

    expect(await probeVideo(reader(bytes), bytes.length)).toEqual({ ok: true, type: 'video/mp4', codec: 'h264' });
  });

  it('reads HEVC from an MP4', async () => {
    const bytes = fixture('hevc.mp4');

    expect(await probeVideo(reader(bytes), bytes.length)).toEqual({ ok: true, type: 'video/mp4', codec: 'hevc' });
  });

  it('reads a MOV by its brand', async () => {
    const bytes = fixture('h264.mov');

    expect(await probeVideo(reader(bytes), bytes.length)).toEqual({ ok: true, type: 'video/quicktime', codec: 'h264' });
  });

  it('refuses another codec and names it', async () => {
    const bytes = fixture('mpeg4.mp4');

    expect(await probeVideo(reader(bytes), bytes.length)).toEqual({ ok: false, problem: 'codec', entry: 'mp4v' });
  });

  it('refuses a file that is no MP4 or MOV', async () => {
    const bytes = new TextEncoder().encode('RIFF....AVI LIST, not a video we take');

    expect(await probeVideo(reader(bytes), bytes.length)).toEqual({ ok: false, problem: 'container' });
  });

  it('refuses an MP4 with no moov', async () => {
    const bytes = fixture('h264.mp4');
    const cut = bytes.slice(0, (await findMoov(reader(bytes), bytes.length))!.offset);

    expect(await probeVideo(reader(cut), cut.length)).toEqual({ ok: false, problem: 'codec' });
  });

  it('finds the moov reading only the box headers before it', async () => {
    const bytes = fixture('h264.mp4');
    const read = reader(bytes);

    const moov = await findMoov(read, bytes.length);

    expect(moov!.offset + moov!.size).toBe(bytes.length);
    expect(read.read).toBeLessThanOrEqual(4 * 16);
  });

  it('knows the container by its first bytes', () => {
    expect(sniffVideoContainer(fixture('h264.mp4'))).toBe('video/mp4');
    expect(sniffVideoContainer(fixture('h264.mov'))).toBe('video/quicktime');
    expect(sniffVideoContainer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('takes the type from the extension', () => {
    expect(videoTypeFromName('Dop.MOV')).toBe('video/quicktime');
    expect(videoTypeFromName('a.m4v')).toBe('video/mp4');
    expect(videoTypeFromName('a.webm')).toBeNull();
  });

  it('names the codec in a string canPlayType understands, a MOV as an MP4', () => {
    expect(videoMime('video/mp4', 'h264')).toBe('video/mp4; codecs="avc1.4D4028"');
    expect(videoMime('video/quicktime', 'hevc')).toBe('video/mp4; codecs="hvc1.1.6.L120.90"');
  });

  it('splits an upload into parts of the part size, the last one shorter', () => {
    expect(partCount(1)).toBe(1);
    expect(partCount(VIDEO_LIMITS.partBytes)).toBe(1);
    expect(partCount(VIDEO_LIMITS.partBytes + 1)).toBe(2);
    expect(partCount(VIDEO_LIMITS.bytes)).toBe(256);
  });
});
