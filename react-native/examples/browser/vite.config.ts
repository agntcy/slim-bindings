import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

const bindingsRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: "index.html",
        "point-to-point-alice": "point-to-point-alice.html",
        "point-to-point-bob": "point-to-point-bob.html",
        "group-moderator": "group-moderator.html",
        "group-participant": "group-participant.html",
      },
    },
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
