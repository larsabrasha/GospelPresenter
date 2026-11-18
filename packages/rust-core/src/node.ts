// The Rust core in Node: the server's host and the tests. The WASM is read from dist/, where `pnpm wasm` builds it
// (build-wasm.mjs). The same relative path serves this file in place (src/node.ts) and the desktop app's bundle
// (dist/main.mjs), which carries a copy of the WASM beside it (apps/desktop/build.mjs).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { RustCore } from './index.ts';

let compiled: WebAssembly.Module | undefined;

/**
 * The WASM beside this file, by its URL; in a unit test with a DOM (happy-dom) Vitest gives this file a URL that is not
 * a file's, and the WASM is found as the package exports it, from the package the test runs in.
 */
function wasm(): URL | string {
  const here = new URL('../dist/gp_core.wasm', import.meta.url);
  return here.protocol === 'file:' ? here : createRequire(`${process.cwd()}/`).resolve('@gp/rust-core/gp_core.wasm');
}

/** A new instance of the core, the WASM compiled once per process. */
export function nodeRustCore(): RustCore {
  compiled ??= new WebAssembly.Module(readFileSync(wasm()));
  return new RustCore(compiled);
}
