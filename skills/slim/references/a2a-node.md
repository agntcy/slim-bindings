# A2A over SLIM — Node.js / TypeScript

**Written against:** `@agntcy/slim-a2a` 0.4.2, `@agntcy/slim-bindings` 3.3.6, `@a2a-js/sdk` 1.0.0-beta.0, A2A protocol v1.0, Node 24 (package requires >= 18). Verified end to end against a `ghcr.io/agntcy/slim:3.4.6` node.
If the installed `@agntcy/slim-a2a` is newer, check https://github.com/agntcy/slim-a2a-node/tree/main/examples at the matching tag before trusting the code below.

## Contents
1. Install
2. Connect to a node
3. Serve an agent
4. Call an agent
5. Identity and TLS
6. Multi-agent: multicast and groups
7. A2A v0.3 compatibility
8. Gotchas
9. More examples

## 1. Install

```bash
npm install @agntcy/slim-a2a @a2a-js/sdk@"$(npm view @agntcy/slim-a2a dependencies.@a2a-js/sdk)"
npm install -D tsx typescript @types/node
```

`@agntcy/slim-a2a` pulls `@agntcy/slim-bindings` and the native addon for your OS/arch. You import A2A types from `@a2a-js/sdk` directly, so declare it, but at **exactly** the version slim-a2a pins (0.4.2 pins `1.0.0-beta.0`). A plain `npm install @a2a-js/sdk` gets the latest (1.3.0) and a second nested copy, which breaks type-checking (see Gotchas). ESM only: set `"type": "module"`. With current TypeScript (7.x), add `"types": ["node"]` to `tsconfig.json`.

## 2. Connect to a node

`setupSlimClient` does everything in one call: initializes the global service, creates the app with an identity, connects, and subscribes the name.

```ts
import { setupSlimClient } from '@agntcy/slim-a2a';

const { service, app, name, connId } = await setupSlimClient('agntcy', 'demo', 'echo_agent', { // → agntcy/demo/echo_agent
  secret: process.env.SLIM_SHARED_SECRET,   // >= 32 chars; or identity: { provider, verifier }
  slimUrl: 'http://localhost:46357',        // default; or clientConfig: ... for TLS
});
```

Positional `(namespace, group, name, options)`; options use camelCase. Exactly one of `secret` / `identity` (an empty or unset secret counts as missing and throws). At most one of `slimUrl` / `clientConfig`. `connId` is a `bigint`; pass it through as-is. For manual control use `initializeSlim()` + `connectAndSubscribe(service, name, options)`; the raw bindings are re-exported as the `slim` namespace (import `Server`, `Channel`, `RpcError` from there, not from `@agntcy/slim-bindings`, whose types don't expose them).

## 3. Serve an agent

Full runnable project: `snippets/node/` (`server.ts`, `client.ts`, `package.json`, `tsconfig.json`; run with `npm run server` / `npm run client -- "hi"`). The SLIM-specific part is only this:

```ts
import { registerSlimA2AHandler, slim, SRPCHandler } from '@agntcy/slim-a2a';

// agentCard: AgentCard from '@a2a-js/sdk'; requestHandler: DefaultRequestHandler from '@a2a-js/sdk/server'
const server = slim.Server.newWithConnection(app, name, connId);
registerSlimA2AHandler(server, new SRPCHandler(agentCard, requestHandler));
await server.serveAsync();
```

Everything else — `AgentExecutor`, `ExecutionEventBus`, `AgentEvent`, `InMemoryTaskStore`, `DefaultRequestHandler` — is ordinary `@a2a-js/sdk` code, so an existing A2A agent is converted by swapping its Express/gRPC app for the three lines above.

Agent card: build it with `AgentCard.fromJSON({ ..., supportedInterfaces: [{ url: 'agntcy/demo/echo_agent', protocolBinding: 'slimrpc', protocolVersion: '1.0' }] })`. A2A types in this SDK version are ts-proto objects: construct them with `X.fromJSON(...)`, and parts are `{ content: { $case: 'text', value } }`.

Executor rule: the first event published on the bus must be a `message` (`AgentEvent.message(...)`, ends the call) or a `task` (`AgentEvent.task(...)`, then `statusUpdate` / `artifactUpdate`); call `bus.finished()` at the end.

## 4. Call an agent

Full runnable file: `snippets/node/client.ts`. Core:

```ts
import { AgentCard, SendMessageRequest } from '@a2a-js/sdk';
import { createSlimClient } from '@agntcy/slim-a2a';

const card = AgentCard.fromJSON({
  name: 'echo_agent', version: '1.0.0', capabilities: { streaming: true },
  supportedInterfaces: [{ url: 'agntcy/demo/echo_agent', protocolBinding: 'slimrpc', protocolVersion: '1.0' }],
});
const client = await createSlimClient(app, connId, card);   // an @a2a-js/sdk Client
const result = await client.sendMessage(SendMessageRequest.fromJSON({
  message: { messageId: randomUUID(), role: 'ROLE_USER', parts: [{ text: 'hi' }] },
}));  // Message | Task — check `'parts' in result`
for await (const ev of client.sendMessageStream(req)) { ev.payload?.$case; }  // 'message' | 'task' | 'statusUpdate' | 'artifactUpdate'
```

There is no `minimalAgentCard` helper; write the small card yourself. For manual wiring: `new ClientFactory({ transports: [new SRPCTransportFactory(app, connId)] })` from `@a2a-js/sdk/client`, or `SRPCTransport.fromName(app, connId, 'agntcy/demo/echo_agent')`. Per-call timeout/metadata: `createSlimClient(app, connId, card, { transport: { timeout: 30_000 } })`.

The client must use its **own** SLIM name (e.g. `agntcy/demo/echo_client`) and the same identity trust as the server.

## 5. Identity and TLS

- **Shared secret** (dev): `secret: ...` on both sides, same value, ≥ 32 chars.
- **JWT** (per-agent identity): `identity: { provider: new slim.IdentityProviderConfig.Jwt({...}), verifier: new slim.IdentityVerifierConfig.Jwt({...}) }`. The slim-a2a-node README has a complete Ed25519 + JWKS example ("Identity and node connection"); copy it from there. SPIRE works the same way. Durations are milliseconds.
- **TLS to the node:** `clientConfig: { ...slim.newSecureClientConfig('https://slim.example.com:443'), auth: new slim.ClientAuthenticationConfig.StaticJwt({ config: { tokenFile, duration } }) }` (auth optional).
- **Who called me (server side):** `requestContext.context.user` in the executor is a `SlimAuthenticatedUser` (`.subject`, `.issuer`) when the caller's identity was verified, otherwise `UnauthenticatedUser`. Authorize on this, never on request metadata. Custom policy: pass `{ contextBuilder }` to `SRPCHandler`; `callerUser(context)` gives the default result.

## 6. Multi-agent: multicast and groups

One request to several agents at once — `SRPCMulticastClient` (a standalone class, not an `@a2a-js/sdk` `Client`; only `sendMessage` and `sendMessageStream`):

```ts
import { SRPCMulticastClient } from '@agntcy/slim-a2a';

const mc = SRPCMulticastClient.create(app, connId, ['agntcy/demo/agent_a', 'agntcy/demo/agent_b']);
for await (const { source, response } of mc.sendMessage(request)) {   // or mc.sendMessageStream(request)
  console.log(source, response);   // source = 'agntcy/demo/agent_a'; response: Message | Task
}
```

`source` identifies which agent answered, so interleaved replies can be told apart. Each agent is an ordinary server (section 3) with its own name. For an orchestrator that calls agents one at a time, create one client per agent card with `createSlimClient`.

For non-RPC group messaging (chat-room style channels, moderator invites), use slim-bindings group sessions directly: https://docs.agntcy.org/slim/components/sdk/tutorials/tutorial-session/ and `agntcy/slim-bindings/node/examples/`.

## 7. A2A v0.3 compatibility

Not available in `@agntcy/slim-a2a` 0.4.x: it speaks A2A v1.0 only, on both server and client. It cannot call a v0.3 agent (e.g. one built on an older slima2a without its v1 servicer), and v0.3 clients cannot call it. If you need it, check a newer release's README ("Proto version scope").

## 8. Gotchas

- Start the server before the client; a client calling a name nobody serves fails after ~15 s of retries with `RpcError` (`tag: 'Rpc'`, `inner.code: 14`), message `Session handshake failed: failed to add participant to session: message send retries exhausted for id=...`. The same error appears when the secrets differ — check both. The text is in `err.inner.message`, not `err.message`.
- A secret under 32 chars fails immediately in `setupSlimClient` with `SlimError.AuthError` (`inner: { message: 'hmac key is too short' }`). A missing or empty secret throws `Error: ConnectOptions: a SLIM credential is required. ... There is no default secret.`
- `@a2a-js/sdk` version must match slim-a2a's pin. With two copies installed, `tsc` fails on `new SRPCHandler(agentCard, requestHandler)` with `Argument of type 'DefaultRequestHandler' is not assignable to parameter of type 'A2ARequestHandler'`. Check with `npm ls @a2a-js/sdk`.
- ESM only. `require('@agntcy/slim-a2a')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`; use `import` (or dynamic `import()` from CJS).
- Native addon prebuilt for darwin x64/arm64, linux x64/arm64 (glibc and musl), win32 x64/arm64 only. Installing with `--omit=optional` / `--no-optional`, or copying `node_modules` across platforms (e.g. macOS host into a Linux Docker image), drops the addon; run `npm ci` inside the target image.
- SLIM's Rust logs go to **stdout** at `info`; set `RUST_LOG=error` to quiet them in CLIs.
- `serveAsync()` blocks (awaits until shutdown); start other work before awaiting it.

## 9. More examples

https://github.com/agntcy/slim-a2a-node/tree/main/examples — `echo-agent` (unary echo; run via `npm run example:server` / `example:client`). Its server **starts an in-process SLIM node on 46357 by default**; pass `--no-broker` (or `--url` to a spare port) when a node is already running. `tests/` has identity (JWT) and streaming end-to-end tests worth copying from.
