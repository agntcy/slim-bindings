// Stable browser entry point for @agntcy/slim-bindings-react-native/web.
// `new URL(..., import.meta.url)` makes the WASM binary a regular asset for
// Vite, webpack, and other browser bundlers instead of relying on experimental
// ESM/WASM integration.
export * from "./generated/web/slim_bindings";

import * as slimBindings from "./generated/web/slim_bindings";
import initWasm from "./generated/web/wasm-bindgen/index.js";

const wasmUrl = new URL(
  "./generated/web/wasm-bindgen/index_bg.wasm",
  import.meta.url,
);

let initialization: Promise<void> | undefined;

/** Initialize the WASM module and validate the generated UniFFI checksums. */
export function uniffiInitAsync(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

async function initialize(): Promise<void> {
  await initWasm({ module_or_path: wasmUrl });
  slimBindings.default.initialize();
}

export default {
  slim_bindings: slimBindings,
};
