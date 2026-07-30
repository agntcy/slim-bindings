# SLIM React Native bindings (`@agntcy/slim-bindings-react-native`)

Use this package for **React Native** apps on **iOS and Android**, and for
**browser applications** through WebAssembly. It exposes the same SLIM
`Name`, `App`, `Session`, message, and completion-handle concepts through
host-specific UniFFI runtimes.

**Default JavaScript / TypeScript package** — For **Node.js** (servers, tooling, non-RN apps), install [`@agntcy/slim-bindings`](../node/README.md) instead. That is the primary npm entry point; this package is the mobile-focused variant.

## Features

- **iOS** — Native integration suited to React Native’s build and runtime model.
- **Web** — Browser WebSocket transport with generated TypeScript and WASM bindings.
- **Shared SLIM surface** — Same general concepts as the Node bindings (sessions, messaging, auth helpers); implementation targets RN’s native layer rather than Node’s `ffi-rs` addon.
- **TypeScript** — Types ship with the package for application code.
- **UniFFI + RN tooling** — Generated with [uniffi-bindgen-react-native](https://jhugman.github.io/uniffi-bindgen-react-native/) workflows documented in this repo.

## Installation

```bash
npm install @agntcy/slim-bindings-react-native
```

```bash
yarn add @agntcy/slim-bindings-react-native
```

## Quick start

1. Call `initializeCryptoProvider()` once at startup.
2. Create an app with `createAppWithSecret(name, secret)` or another supported auth path.
3. Create sessions with `createSessionAndWait(config, destination)`.
4. Publish with `session.publishAndWait(data, payloadType?, metadata?)`.
5. Call `app.destroy()` when finished.

## Browser / WebAssembly

Browser builds use the same UniFFI Rust source as the native bindings. The
browser implementation connects directly to a SLIM `ws://` or `wss://`
endpoint and supports the shared-secret identity path.

Generate the browser package:

```bash
npm install
npm run build:web
```

The stable `web.ts` entrypoint is selected automatically by bundlers through
the package's `browser` field and loads the generated WASM binary as a bundled
asset. TypeScript browser code should import the explicit `/web` entrypoint so
editors resolve the browser API rather than the React Native declarations. Call
`uniffiInitAsync()` once before using the bindings. All operations that wait
for network or session state must use their async variants in browsers.

```ts
import {
  App,
  Direction,
  Name,
  SessionType,
  uniffiInitAsync,
} from '@agntcy/slim-bindings-react-native/web';

await uniffiInitAsync();

const local = new Name('org', 'default', 'browser');
const remote = new Name('org', 'default', 'agent');

const app = await App.connectWithSecret(
  'wss://slim.example/ws',
  undefined,
  local,
  'abcdefghijklmnopqrstuvwxyz012345',
  Direction.Bidirectional,
);

await app.setRouteViaUpstreamAsync(remote);
const session = await app.createSessionAndWaitAsync(
  {
    sessionType: SessionType.PointToPoint,
    maxRetries: 10,
    interval: undefined,
    metadata: new Map(),
    mlsSettings: undefined,
  },
  remote,
);

await session.publishAndWaitAsync(
  new TextEncoder().encode('hello'),
  'text/plain',
  undefined,
);
```

For multicast/MLS sessions, select `SessionType.Group`, install upstream
routes for participants, and use `inviteAndWaitAsync` before publishing.

A runnable browser playground for unicast, multicast, optional MLS, and mixed
browser/native transports is available in
[`examples/browser`](./examples/browser/README.md), including point-to-point,
group, and MLS walkthroughs.

## API overview

- **Core**: `initializeCryptoProvider()`, `getVersion()`, `createAppWithSecret(name, secret)`
- **Name**: `new Name(components, id?)` — components, id, `asString`
- **BindingsAdapter**: `createSessionAndWait`, `deleteSessionAndWait`, `subscribe`, `unsubscribe`, `destroy`
- **BindingsSessionContext**: `publishAndWait`, `receive`, `inviteAndWait`, `removeAndWait`
- **Types**: `SessionConfig`, `SessionType` (PointToPoint, Group), `ReceivedMessage`

## Development

**Prerequisites**: Node.js 18+, Rust 1.70+, Task

```bash
git clone https://github.com/agntcy/slim-bindings.git
cd slim-bindings/react-native
npm install
task generate
task generate:web
task test
```

## Troubleshooting

**“Cannot find module”** — Run `task generate`.

**iOS undefined symbol errors** — XCFramework or pods out of date:

```bash
task prepare:ios
cd examples/react-native/test-app/ios && pod install
```

Open `TestApp.xcworkspace` (not `.xcodeproj`), clean the build folder, then rebuild.

**Android** — Confirm CMake / NDK setup matches the project’s `CMakeLists.txt` expectations.

## Resources

- [Node / default JS bindings](../node/README.md) — `@agntcy/slim-bindings`
- [UniFFI](https://mozilla.github.io/uniffi-rs/)
- [uniffi-bindgen-react-native](https://jhugman.github.io/uniffi-bindgen-react-native/)
- [SLIM](https://github.com/agntcy/slim)
- [Go bindings](../go/)
