// A .wasm import in the Worker: wrangler (and the tests' Miniflare) hand it over compiled.
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
