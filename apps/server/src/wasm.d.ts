// A WebAssembly file imported by the server's picture codecs (picture-codecs.ts): a compiled module where wrangler
// and Miniflare load the Worker, its bytes where esbuild bundles for Node (loader `binary`) and in the tests.
declare module '*.wasm' {
  const wasm: WebAssembly.Module | Uint8Array;
  export default wasm;
}
