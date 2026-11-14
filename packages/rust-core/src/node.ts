// The Rust core in Node: the server's host and the tests. The WASM is read from dist/, where `pnpm wasm` builds it
// (build-wasm.mjs). The same relative path serves this file in place (src/node.ts) and the desktop app's bundle
// (dist/main.mjs), which carries a copy of the WASM beside it (apps/desktop/build.mjs).
import { readFileSync } from 'node:fs';
import { RustCore } from './index.ts';

let compiled: WebAssembly.Module | undefined;

/** A new instance of the core, the WASM compiled once per process. */
export function nodeRustCore(): RustCore {
  compiled ??= new WebAssembly.Module(readFileSync(new URL('../dist/gp_core.wasm', import.meta.url)));
  return new RustCore(compiled);
}
