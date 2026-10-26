// Web platform APIs that browsers, Node 22+ and Workers all have, but that
// this package's types (ES2023 only, no DOM) do not describe. Typed here once,
// narrowly, rather than pulling the DOM library into the core.

interface WebGlobals {
  TextEncoder: new () => { encode(s: string): Uint8Array };
  TextDecoder: new (label?: string, opts?: { fatal?: boolean }) => { decode(b: Uint8Array): string };
  DecompressionStream: new (format: 'deflate-raw') => unknown;
  Blob: new (parts: Uint8Array[]) => { stream(): { pipeThrough(t: unknown): unknown } };
  Response: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
  crypto: { subtle: { digest(alg: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> } };
}

const web = globalThis as unknown as WebGlobals;

export function utf8Encode(s: string): Uint8Array {
  return new web.TextEncoder().encode(s);
}

/** UTF-8 to text; a byte order mark is dropped, invalid bytes become U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  return new web.TextDecoder('utf-8').decode(bytes);
}

/** Inflates raw DEFLATE data (a zip entry), with the platform's own decompressor. */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new web.Blob([bytes]).stream().pipeThrough(new web.DecompressionStream('deflate-raw'));
  return new Uint8Array(await new web.Response(stream).arrayBuffer());
}

/** The SHA-256 of a text's UTF-8 bytes, as 64 lower-case hex digits. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await web.crypto.subtle.digest('SHA-256', utf8Encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
