# SLIM JavaScript / TypeScript bindings (`@agntcy/slim-bindings`) — developer guide

This is the npm package for using SLIM from JavaScript and TypeScript. It targets **Node.js** (≥18): servers, services, CLIs, tests, and any workflow where the native addon loads through Node.

Bindings are generated with [uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native)'s **napi** target and talk to the Rust core via [@ubjs/core](https://www.npmjs.com/package/@ubjs/core) / [@ubjs/node](https://www.npmjs.com/package/@ubjs/node) (the N-API runtime backend).

This package previously used [uniffi-bindgen-node](https://github.com/livekit/uniffi-bindgen-node) + [ffi-rs](https://www.npmjs.com/package/ffi-rs). That tool is no longer actively developed (per its own README, development moved to uniffi-bindgen-react-native's napi target — the one used here). The switch also unlocks something the old toolchain never supported: foreign async callback interfaces, i.e. a plain JS object can now implement a server-side RPC handler (`Server.registerUnaryUnary(...)` and friends) and be genuinely called back into by Rust. This is required for hosting a slimrpc/A2A service in Node — the old toolchain could only run the client (`Channel`) side.

For **using the package** (install, quick start, main API patterns), see the root [README.md](./README.md).

## Features

- **Primary JS/TS entry point** — Install `@agntcy/slim-bindings` for Node; optional `@agntcy/slim-bindings-*` packages supply the correct native binary per OS/arch.
- **Rust-backed core** — Same SLIM logic as other language bindings; native code ships per platform.
- **TypeScript** — Typed surface and editor support (with known type-shape notes documented below).
- **Authentication** — Shared secret, JWT, and SPIRE-oriented flows exposed through the generated API.
- **Async-first** — Promise-based calls aligned with Node conventions.
- **RPC server support** — Server-side handlers can be implemented as plain JS objects (`{ async handle(...) { ... } }`), unlike the previous toolchain.
- **UniFFI** — Generated from Mozilla's [UniFFI](https://mozilla.github.io/uniffi-rs/) bindings.

## ESM only

This package is **native ESM** (`"type": "module"`) — the generated bindings use `import.meta.url` internally for locating the native library. `require('@agntcy/slim-bindings')` is not supported; use `import` or dynamic `import()`.

## Installation

Published builds install from npm only (no local Rust required):

```bash
npm install @agntcy/slim-bindings
```

That pulls this package plus the matching optional native addon for your platform when a release exists for your version.

To build from source (development or an unpublished platform), see [Build from source](#build-from-source).

## Prerequisites (build from source)

- Rust toolchain
- Node.js >= 18
- [Task](https://taskfile.dev/)

## Usage (development workflow)

### 1. Generate bindings (from source)

```bash
task generate
```

### 2. Run P2P examples

```bash
# Terminal 1: Start the server
task example:server

# Terminal 2: Start Alice (receiver)
task example:alice

# Terminal 3: Start Bob (sender)
task example:bob
```

### 3. Run the group (multicast) example

```bash
# Terminal 1: Start the server (if not already running)
task example:server

# Terminal 2: Participant - waits to be invited
task example:group -- --local org/default/bob

# Terminal 3: Moderator - creates the group session and invites the participant
task example:group -- --local org/default/alice --remote org/default/chat-topic --invites org/default/bob
```

Both sides then exchange messages interactively (type a line + Enter to send, `exit`/`quit` to leave). See `task example:group -- --help` for all options (`--invites` accepts a comma-separated list; `--enable-mls` turns on MLS encryption for the group).

### Available commands

```bash
task generate         # Generate bindings
task clean            # Clean build artifacts
task example:server   # Run server
task example:alice    # Run Alice receiver
task example:bob      # Run Bob sender
task example:group    # Run group (multicast) example (moderator or participant)
```

## Build process

`task generate` runs `ubrn generate napi bindings --library --lib-colocated` against the compiled `rust/` crate. No post-generation patching is needed — the napi target's output runs as-is against `@ubjs/core`/`@ubjs/node`. `--lib-colocated` bakes in "look for the native library next to the compiled JS file at runtime", matching how each `@agntcy/slim-bindings-<platform>` package is a single self-contained directory (see `scripts/pack-platform.ts`).

The compiled output is `generated/index.ts` (public entry — also runs a required one-time init that registers RPC callback vtables, so always import this file, not `slim_bindings.ts` directly), `generated/slim_bindings.ts` (the actual API surface, re-exported by `index.ts`), and `generated/slim_bindings-ffi.ts` (native module loading).

`scripts/pack-platform.ts` compiles `generated/*.ts` to plain `.js` + `.d.ts` for each platform tarball, then appends `.js` to relative import specifiers in the emitted output — `tsc`'s ESNext module emit does not add extensions to the extensionless relative imports the generator produces, but native Node ESM resolution requires them (unlike `require()` or `tsx`'s resolver).

## Type conversions and API notes

A few things changed when moving off the old ffi-rs-based toolchain — generated types are now enforced accurately, so code written against the old loose typing needs small adjustments:

- **u64 params are real `bigint`, not `number`.** The old toolchain silently accepted a `Number()`-cast value for u64 parameters like `App.setRoute`'s `connectionId`; the new one throws `BigintExpected` if you don't pass an actual `bigint`. Don't cast down — pass the `bigint` you already have (e.g. from `connectAsync`) straight through.
- **Enums are real TS `enum`s, not string literals.** E.g. `SessionConfig.sessionType` is `SessionType.PointToPoint` / `SessionType.Group`, not the string `"pointToPoint"`. Passing a bare string silently corrupts the value on the wire (surfaces as a confusing `Invalid SessionType enum value: <garbage>` from Rust) rather than failing at the call site.
- **Tagged unions use `.tag`/`.inner`, not `is_data()`/`is_end()` methods.** `StreamMessage` and `MulticastStreamMessage` are discriminated unions (`msg.tag === 'Data' | 'Error' | 'End'`); read the payload via `msg.inner` (a tuple for `StreamMessage`, e.g. `msg.inner[0]`; a named field for `MulticastStreamMessage`, e.g. `msg.inner.item.message`).

## Build from source

1. Install Rust and Task.
2. Run `task generate` (builds the Rust library and emits Node bindings).
3. Consume files under `generated/` or run examples (`task example:server`, etc.).

Optional platform packages (`@agntcy/slim-bindings-*`) are version-pinned beside this package in `package.json`. For a **local** platform tarball from `task pack:platform`, install it explicitly (for example `npm install ./dist/node-darwin-arm64.tgz`) in addition to this package.

## Publishing (maintainers)

- **Dry run**: From `node`, run `npm pack` for the main tarball; platform bundles via `task pack:platform TARGET=<target>` → `dist/node-<platform>.tgz`.
- **Version**: In `package.json`; release tags use `slim-bindings-v*` (see `.github/scripts/get-binding-version.sh`).
- **CI**: Releases publish via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC from `release-bindings.yaml`); no publish token in GitHub. Publish jobs use **Node 24** (npm ≥ 11.5.1 is required; Node 22.14 ships npm 10.x and fails with a misleading `404 Not Found`). For **local** `npm publish`, use `npm login` or an automation token as usual.
- **Trusted publisher setup (maintainers)**: Configure OIDC on **each** npm package that CI publishes — `@agntcy/slim-bindings`, every `@agntcy/slim-bindings-*` platform package, and `@agntcy/slim-bindings-react-native`. On npmjs.com → package → Settings → Trusted publishing, set **Repository** to `agntcy/slim-bindings` and **Workflow filename** to `release-bindings.yaml` (filename only, not the `.github/workflows/` path). After the repo split from `agntcy/slim`, update any publishers still pointing at the old monorepo.

## Resources

- [uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native)
- [UniFFI](https://mozilla.github.io/uniffi-rs/)
- [@ubjs/node](https://www.npmjs.com/package/@ubjs/node)
- [SLIM](https://github.com/agntcy/slim)
- [React Native bindings](../react-native/README.md)
