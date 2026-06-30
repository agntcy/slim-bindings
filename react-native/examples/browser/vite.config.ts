import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

const bindingsRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  build: {
    target: "es2022",
  },
  server: {
    fs: {
      // The example installs the bindings through `file:../..`. Vite resolves
      // that symlink to the package source, so its generated WASM asset is
      // intentionally outside examples/browser unless this root is allowed.
      allow: [bindingsRoot],
    },
    port: 5173,
    strictPort: true,
  },
});
