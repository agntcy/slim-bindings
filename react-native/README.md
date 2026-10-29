# SLIM React Native bindings (`@agntcy/slim-bindings-react-native`)

Use this package for **React Native** apps on **iOS** (Android support is not
available yet), and for **browser applications** through WebAssembly. It exposes the same SLIM
`Name`, `App`, `Session`, message, and completion-handle concepts through
host-specific UniFFI runtimes.

**Default JavaScript / TypeScript package** — For **Node.js** (servers, tooling, non-RN apps), install [`@agntcy/slim-bindings`](../node/README.md) instead. That is the primary npm entry point; this package is the mobile-focused variant.

## Features

- **iOS** — Native integration suited to React Native’s build and runtime model.
- **Web** — Browser WebSocket transport with generated TypeScript and WASM bindings.
- **Shared SLIM surface** — Same general concepts as the Node bindings (sessions, messaging, auth helpers); implementation targets RN’s JSI layer rather than Node’s N-API addon.
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

1. Wait for the JSI bindings with `waitForJSIBindings()` (a named export), then call `initializeWithDefaults()` once at startup.
2. Get the service with `getGlobalService()` and create an app with `service.createAppWithSecret(name, secret)` (the secret must be at least 32 characters) or another supported auth path.
3. Connect with `service.connect(newInsecureClientConfig(endpoint))` and subscribe the app on the returned connection ID with `app.subscribe(name, connId)`.
4. Create sessions with `app.createSessionAndWait(config, destination)`.
5. Publish with `session.publishAndWait(data, payloadType?, metadata?)`.
6. Call `uniffiDestroy()` on generated objects when finished.

## Transport authentication (gRPC connection)

On the **native (iOS)** target the gRPC client and server configurations expose
transport authentication via `config.auth`, including OIDC (`ClientAuthenticationConfig.Oidc`
with an `OidcConfig`, and `ServerAuthenticationConfig.Oidc` server-side). The API matches the
Node bindings — see [their transport-authentication section](../node/README.md#transport-authentication-grpc-connection)
for snippets and the JSON config form.

On the **web / WebAssembly** target this surface is absent by design: the browser build enables
the `web` feature of `agntcy-slim-bindings`, which compiles out the whole gRPC configuration
module (`ClientConfig`, `TlsClientConfig`, `ClientAuthenticationConfig`, and therefore OIDC).
Browser apps connect over `ws://`/`wss://` and authenticate through the identity path instead.

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
`uniffiInitAsync()` once before using the bindings. In the browser, connect a
`Service` over WebSocket to obtain a connection ID, create the app with
`service.createAppAsync(name, secret)` (or `createAppWithDirectionAsync`), and
subscribe the app's own name on that connection so the node can route messages
back to it. All operations that wait for network or session state must use their
async variants in browsers.

```ts
import {
  Name,
  Service,
  SessionType,
  uniffiInitAsync,
} from '@agntcy/slim-bindings-react-native/web';

await uniffiInitAsync();

const local = new Name('org', 'default', 'browser');
const remote = new Name('org', 'default', 'agent');

// The service id must be a plain token (no "/").
const service = new Service('browser');
// Optional second argument: a token appended as the `token` query parameter.
const connId = await service.connectAsync('wss://slim.example/ws', undefined);

const app = await service.createAppAsync(
  local,
  'abcdefghijklmnopqrstuvwxyz012345',
);
await app.subscribeAsync(local, connId);

await app.setRouteAsync(remote, connId);
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

For multicast/MLS sessions, select `SessionType.Group`, install routes for
participants with `app.setRouteAsync(participant, connId)`, and use `inviteAndWaitAsync` before publishing.

A runnable browser playground for unicast, multicast, optional MLS, and mixed
browser/native transports is available in
[`examples/browser`](./examples/browser/README.md), including point-to-point,
group, and MLS walkthroughs.

## API overview

- **Core** (native): `initializeWithDefaults()`, `getVersion()`, `getGlobalService()`
- **Service**: `createAppWithSecret(name, secret)`, `connect(config)` (native); `new Service(id)`, `connectAsync(endpoint, token?)`, `createAppAsync(name, secret)`, `createAppWithDirectionAsync(name, secret, direction)`, `disconnect(connId)` (web)
- **Name**: `new Name(component0, component1, component2)`, `Name.newWithId(c0, c1, c2, uuid)`, `Name.fromString('org/ns/app')` — `components()`, `id()`, `toString()`
- **App**: `createSessionAndWait`, `deleteSessionAndWait`, `subscribe`, `unsubscribe`, `setRoute`, `removeRoute`, `listenForSession` (plus `*Async` variants)
- **Session**: `publishAndWait`, `getMessage`, `inviteAndWait`, `removeAndWait` (plus `*Async` variants)
- **Types**: `SessionConfig`, `SessionType` (PointToPoint, Group), `ReceivedMessage`
- **Cleanup**: `uniffiDestroy()` on any generated object

## Development

**Prerequisites**: Node.js 18+, recent stable Rust (1.88+), Task. React Native apps need `react-native` >= 0.72.

```bash
git clone https://github.com/agntcy/slim-bindings.git
cd slim-bindings/react-native
npm install
task generate
task generate:web
```

There are no unit tests in this package yet. End-to-end smoke tests run the
[test app](./examples/react-native/test-app/README.md) on an iOS simulator with
Maestro:

```bash
task test:e2e:ios
```

## Troubleshooting

**“Cannot find module”** — Run `task generate`.

**iOS undefined symbol errors** — XCFramework or pods out of date:

```bash
task prepare:ios
cd examples/react-native/test-app/ios && pod install
```

Open `TestApp.xcworkspace` (not `.xcodeproj`), clean the build folder, then rebuild.

**Android** — Not supported yet: the package ships iOS native artifacts only.

## Resources

- [Node / default JS bindings](../node/README.md) — `@agntcy/slim-bindings`
- [UniFFI](https://mozilla.github.io/uniffi-rs/)
- [uniffi-bindgen-react-native](https://jhugman.github.io/uniffi-bindgen-react-native/)
- [SLIM](https://github.com/agntcy/slim)
- [Go bindings](../go/)
