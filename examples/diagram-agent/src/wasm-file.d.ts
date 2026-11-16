// What a bundler for Cloudflare Workers gives a module that imports a .wasm
// file: the module, already compiled.
declare module '*.wasm' {
  const compiled: WebAssembly.Module;
  export default compiled;
}
