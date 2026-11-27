// The server's picture codecs (docs/mcp.md, "Pictures"): Squoosh's, as jSquash builds them to WebAssembly, so a
// picture is decoded, fitted and encoded the same on Node, in the desktop host and in a Cloudflare Worker, which has
// no canvas and may not compile WebAssembly from bytes. Each `.wasm` is imported: wrangler and Miniflare hand the
// Worker a compiled module, esbuild's `binary` loader and the tests' plugin hand Node its bytes.
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode.js';
import encodeJpeg, { init as initJpegEncode } from '@jsquash/jpeg/encode.js';
import decodePng, { init as initPngDecode } from '@jsquash/png/decode.js';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';
import encodeWebp, { init as initWebpEncode } from '@jsquash/webp/encode.js';
import resizePixels, { initResize } from '@jsquash/resize';
import { initWasm as initResvg, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import jpegDecodeWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import jpegEncodeWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';
// @ts-expect-error -- its package types it as wasm-bindgen's exports; the bundlers hand over the module or its bytes.
import pngDecodeWasm from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import webpDecodeWasm from '@jsquash/webp/codec/dec/webp_dec.wasm';
// The SIMD build: jSquash loads its glue when the runtime has SIMD, as Node and workerd have.
import webpEncodeWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';
// @ts-expect-error -- as the PNG decoder's above.
import resizeWasm from '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';

/** The kinds of picture the server reads. */
export type SourceKind = 'jpeg' | 'png' | 'webp';

/** The codecs a picture is made with (picture-import.ts); a test may give its own. */
export interface PictureCodecs {
  decode(kind: SourceKind, bytes: Uint8Array): Promise<ImageData>;
  resize(pixels: ImageData, size: { width: number; height: number }): Promise<ImageData>;
  /** `quality` 0–1, as a canvas's. */
  encode(type: 'image/jpeg' | 'image/webp', pixels: ImageData, quality: number): Promise<Uint8Array>;
  /** An SVG drawn as a PNG as large as fits within `within`, larger or smaller than it was drawn for: it is a vector. */
  drawSvg(svg: Uint8Array, within: { width: number; height: number }): Promise<Uint8Array>;
}

const compiled = (wasm: WebAssembly.Module | Uint8Array) => (wasm instanceof WebAssembly.Module ? wasm : new WebAssembly.Module(wasm as BufferSource));
// jSquash's types name only the options; its init takes the module first, as its README says for Workers.
type Init = (module: WebAssembly.Module) => Promise<unknown>;
const start = (init: unknown, wasm: WebAssembly.Module | Uint8Array) => (init as Init)(compiled(wasm));

let ready: Promise<unknown> | null = null;
/** Each codec started once, on the first picture: a server that is never asked for one never loads them. */
function started() {
  // A Worker and Node have no ImageData; jSquash only makes and reads its three fields.
  (globalThis as { ImageData?: unknown }).ImageData ??= class {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  };
  ready ??= Promise.all([
    start(initJpegDecode, jpegDecodeWasm),
    start(initJpegEncode, jpegEncodeWasm),
    start(initPngDecode, pngDecodeWasm),
    start(initWebpDecode, webpDecodeWasm),
    start(initWebpEncode, webpEncodeWasm),
    start(initResize, resizeWasm),
    initResvg(compiled(resvgWasm)),
  ]).catch((e: unknown) => {
    // Not kept: the next picture tries again rather than every one failing until the server restarts.
    ready = null;
    throw e;
  });
  return ready;
}

/** A copy of the bytes in an ArrayBuffer of their own, as the decoders take one. */
const own = (bytes: Uint8Array) => bytes.slice().buffer;

export const pictureCodecs: PictureCodecs = {
  async decode(kind, bytes) {
    await started();
    return kind === 'jpeg' ? decodeJpeg(own(bytes)) : kind === 'png' ? decodePng(own(bytes)) : decodeWebp(own(bytes));
  },
  async resize(pixels, size) {
    await started();
    return resizePixels(pixels, size);
  },
  async encode(type, pixels, quality) {
    await started();
    const out = type === 'image/jpeg' ? await encodeJpeg(pixels, { quality: Math.round(quality * 100) }) : await encodeWebp(pixels, { quality: Math.round(quality * 100) });
    return new Uint8Array(out);
  },
  async drawSvg(svg, within) {
    await started();
    // No fonts: a Worker has none to load, and a logo's letters are mostly shapes. Nothing it links to is fetched.
    const options = { font: { loadSystemFonts: false } };
    const measured = new Resvg(svg, options);
    const scale = Math.min(within.width / measured.width, within.height / measured.height);
    const width = Math.max(1, Math.floor(measured.width * scale));
    measured.free();
    const svgDrawn = new Resvg(svg, { ...options, fitTo: { mode: 'width', value: width } });
    const image = svgDrawn.render();
    const png = image.asPng();
    image.free();
    svgDrawn.free();
    return png;
  },
};
