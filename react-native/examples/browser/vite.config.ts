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
        "group-moderator-mls": "group-moderator-mls.html",
        "group-participant": "group-participant.html",
        "group-participant-two": "group-participant-two.html",
        "group-participant-mls": "group-participant-mls.html",
        "group-participant-two-mls": "group-participant-two-mls.html",
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
