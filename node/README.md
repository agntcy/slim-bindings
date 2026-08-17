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

## Transport authentication (gRPC connection)

Separate from the app identity given to `createAppWithSecret`, the gRPC connection to a SLIM
node can carry its own credentials via `config.auth` (and `ServerConfig.auth` when hosting).
Supported modes are `Basic`, `StaticJwt`, `Jwt`, `Spire`, and `Oidc`.

OIDC, client side (client-credentials flow):

```ts
const config = slimBindings.newInsecureClientConfig('http://127.0.0.1:46357');
config.auth = new slimBindings.ClientAuthenticationConfig.Oidc({
  config: {
    issuerUrl: 'https://auth.example.com',
    clientId: 'my-client',
    clientSecret: 's3cr3t',
    scope: 'openid profile',
    timeout: 30_000, // durations are milliseconds
  },
});

const connId = await service.connectAsync(config);
```

For the refresh-token flow set `refreshToken` — or `refreshTokenFile`, which is rewritten in
place as tokens rotate — instead of `clientSecret`.

Server side, verifying incoming JWTs against the issuer's JWKS endpoint, optionally
restricting access by claim:

```ts
const config = slimBindings.newInsecureServerConfig('0.0.0.0:46357');
config.auth = new slimBindings.ServerAuthenticationConfig.Oidc({
  config: {
    issuerUrl: 'https://auth.example.com',
    audience: 'slim', // required for verification
    jwksTtl: 3_600_000,
    policy: new slimBindings.OidcPolicyConfig.Cel({ expression: '"admin" in claims.groups' }),
  },
});
```

`policy` accepts `OidcPolicyConfig.Cel`, `OidcPolicyConfig.Rego` (which must define
`package slim.auth` with `default allow = false`), or `OidcPolicyConfig.RegoFile`. Client-only
fields (`scope`, `timeout`) and server-only fields (`jwksTtl`, `claimCacheTtl`, `policy`) are
ignored by the other side.

From a config file — `newConfigFromJson(json)` accepts a full gRPC client config, covering TLS
material, backoff, and every authentication mode. The examples read the same document from
`SLIM_CLIENT_CONFIG`:

```json
{
  "endpoint": "http://127.0.0.1:46357",
  "tls": { "insecure": true },
  "auth": {
    "type": "oidc",
    "issuer_url": "https://auth.example.com",
    "client_id": "my-client",
    "client_secret": "s3cr3t",
    "audience": "slim",
    "policy": { "cel": "\"admin\" in claims.groups" }
  }
}
```

The schema matches `data-plane/core/config/src/grpc/schema/client-config.schema.json` in the
[slim](https://github.com/agntcy/slim) repo.

## Examples

Runnable scripts live under `examples/` (from repo root, use the `Taskfile` targets `example:server`, `example:alice`, `example:bob`, `example:group`, or run them via npm from `examples/` as documented in [README_dev.md](./README_dev.md)). `example:group` demonstrates multicast (group) sessions — a moderator creates a channel and invites participants; see [README_dev.md](./README_dev.md#3-run-the-group-multicast-example) for usage.

## Type notes

64-bit values (like the connection id from `connectAsync`) are real `bigint` end to end — pass them through as-is rather than converting to `Number`. Enum-typed fields (like `SessionConfig.sessionType`) are real TypeScript enums (`SessionType.PointToPoint`), not string literals. See [README_dev.md](./README_dev.md#type-conversions-and-api-notes) for details.

## Building from source / contributing

Generator setup, Task commands, and publishing are documented for maintainers in **[README_dev.md](./README_dev.md)**.

## Links

- [SLIM repository](https://github.com/agntcy/slim)
- [React Native bindings](../react-native/README.md) (mobile / JSI)
