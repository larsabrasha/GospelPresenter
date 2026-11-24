/** A frame of a video and what it is: its display size, and its length in seconds. */
export interface DecodedFrame {
  frame: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  duration: number;
}

/**
 * The frame at `at(duration)` seconds into `file`, read and decoded without a <video> (Mediabunny: the container read
 * from the file as needed, the frame decoded by WebCodecs). An iPhone's Safari never began loading a video in a
 * <video> it did not play (2026-11-08); this needs no element. Null where this device cannot decode the track, or has
 * no WebCodecs; the caller then tries a <video>.
 */
export async function decodedFrame(file: Blob, at: (duration: number) => number): Promise<DecodedFrame | null> {
  if (typeof VideoDecoder === 'undefined') return null;
  // Loaded only when a video is imported: the app itself stays as small as it was.
  const { BlobSource, CanvasSink, Input, MP4, QTFF } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF] });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const duration = await input.computeDuration();
    const first = await track.getFirstTimestamp();
    const sink = new CanvasSink(track);
    const shown = (await sink.getCanvas(first + at(duration - first))) ?? (await sink.getCanvas(first));
    return shown && { frame: shown.canvas, width: track.displayWidth, height: track.displayHeight, duration };
  } finally {
    input.dispose();
  }
}
