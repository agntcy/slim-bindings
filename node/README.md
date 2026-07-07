# `@agntcy/slim-bindings`

Node.js (≥18) bindings for **SLIM**: connect apps to a SLIM server, open sessions, and exchange messages using the same Rust core as other language bindings.

## Install

```bash
npm install @agntcy/slim-bindings
```

npm installs this package and, when published for your OS/arch, the matching optional native addon (`@agntcy/slim-bindings-*`). If install fails with a native-load error, your platform/version combo may not have a published binary yet.

## Module shape

This package is **native ESM** (`require()` is not supported — use `import`). The published entry loads the generated UniFFI/Node bindings (see `package.json` `main` / `types`). Examples in this repo import from `generated/index.js` when running inside the bindings workspace.

```typescript
import slimBindings from '@agntcy/slim-bindings';

slimBindings.initializeWithDefaults();
const service = slimBindings.getGlobalService();
```

Full TypeScript types ship under `types/` in the published package (`index.d.ts` re-exports them).

## Typical flow

1. **Initialize** crypto/runtime once per process:

   `slimBindings.initializeWithDefaults()`

2. **Obtain the global service** — entry point for apps, connections, and server mode:

   `slimBindings.getGlobalService()`

3. **Identity** — SLIM names are three segments: `organization/namespace/application` (constructor `new slimBindings.Name(org, ns, app)`).

4. **Client: create an app** — e.g. shared-secret auth:

   `service.createAppWithSecret(name, secret)`  
   Use a secret that meets the minimum length required by your deployment (examples use a 32+ character demo string).

5. **Client: connect to the SLIM server** — build a client config (see `newInsecureClientConfig(url)` for development-style HTTP to the server), then:

   `await service.connectAsync(config)`  
   Returns a connection id used for routing/subscriptions.

6. **Subscribe** the app to receive traffic for its name, passing the connection id as a real `bigint` (e.g. `await app.subscribeAsync(name, connId)` where `connId` is what `connectAsync` returned).

7. **Server** — for a network node that accepts clients, initialize the same way, then build a server config (e.g. `newInsecureServerConfig('0.0.0.0:46357')`) and run:

   `slimBindings.getGlobalService().runServer(config)`  
   The process must stay alive while the server runs (see examples).

## Examples

Runnable scripts live under `examples/` (from repo root, use the `Taskfile` targets `example:server`, `example:alice`, `example:bob`, or run them via npm from `examples/` as documented in [README_dev.md](./README_dev.md)).

## Type notes

64-bit values (like the connection id from `connectAsync`) are real `bigint` end to end — pass them through as-is rather than converting to `Number`. Enum-typed fields (like `SessionConfig.sessionType`) are real TypeScript enums (`SessionType.PointToPoint`), not string literals. See [README_dev.md](./README_dev.md#type-conversions-and-api-notes) for details.

## Building from source / contributing

Generator setup, Task commands, and publishing are documented for maintainers in **[README_dev.md](./README_dev.md)**.

## Links

- [SLIM repository](https://github.com/agntcy/slim)
- [React Native bindings](../react-native/README.md) (mobile / JSI)
