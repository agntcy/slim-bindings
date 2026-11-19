# SLIM concepts

Source of truth: https://docs.agntcy.org/slim/ (repo `agntcy/slim`, `docs/content/slim/`). Spec: IETF draft `draft-mpsb-agntcy-slim`.

## Contents
- Pieces
- Names
- Sessions
- Identity and security
- slimrpc
- A2A over SLIM
- Plain messaging without A2A

## Pieces

- **Node (data plane):** a router. Apps connect to it over gRPC/HTTP2 (default port 46357). Nodes can peer with each other to route across hosts, clusters and clouds. It never sees plaintext when MLS is on.
- **Controller / control plane:** optional; manages routes and connections across many nodes. Not needed for local dev.
- **Channel Manager:** optional; operator-managed group channels.
- **slimctl:** CLI. `slimctl slim start` runs a local node; other subcommands talk to nodes and controllers.
- **SDKs (slim-bindings):** one Rust core exposed to Python, Go, Node.js, Java, Kotlin, .NET, React Native via UniFFI. Same concepts and nearly the same API shape in every language.
- **slim-a2a SDKs:** A2A protocol bindings on top of slimrpc, one per language.

## Names

Every endpoint has a name `organization/namespace/service/<id>`:

- The first three parts are chosen by the app (e.g. `agntcy/demo/echo_agent`). All replicas of a service share them.
- `<id>` is derived from the app's identity (a hash of its `sub`), filled in by the SDK. You rarely write it.
- **Anycast:** addressing the three-part name reaches any one instance. This is how a client finds a server.
- **Unicast:** the four-part name reaches that specific instance. A session binds to one after discovery.
- In the Python/most SDK APIs a name is constructed as `Name(org, namespace, service)`; slim-a2a SDKs take the same three strings (Python calls them `namespace, group, name`) or the joined `"org/ns/service"` string for remote agents.

## Sessions

The session layer handles setup, optional MLS encryption, optional acknowledgement/retry, and membership.

| | Point-to-point | Group |
|---|---|---|
| Participants | 2 | many |
| Discovery | anycast to the service name, then bound to one instance | channel name known up front; each invitee is discovered |
| Membership | n/a | the creator is the **moderator**; only it invites/removes |
| Use for | request/response, task delegation | broadcast, multi-agent collaboration |

Session creation is async and completes only after discovery, invite and MLS setup are done. With MLS, every membership change rotates keys. Group state can optionally be persisted so participants rejoin after restart.

## Identity and security

Two layers, configured separately:

1. **Transport (app ↔ node, node ↔ node):** TLS or mTLS, plus optional client auth to the node (basic, static JWT bearer, etc.). Configured in the node config and the SDK's client config.
2. **Application identity (app ↔ app, end to end):** every app is created with an identity *provider* (how it proves who it is) and *verifier* (whom it trusts). Options:
   - **Shared secret** (≥ 32 chars): everyone with the secret can claim any name. Local dev and closed networks only.
   - **JWT:** the `sub` claim is the identity. Self-signed (e.g. Ed25519 key + JWKS allowlist) or from an OIDC IdP.
   - **SPIRE:** SPIFFE ID from a JWT-SVID. Best fit for Kubernetes.

   All members of a session need compatible identity types.

- **MLS** encrypts inside the app, so intermediate nodes only see ciphertext, regardless of TLS.
- **Identity binding:** sessions check that a peer's name ID matches its verified identity. `SLIM_IDENTITY_BINDING=warn|enforce|off` (default `warn`).
- On the server side, slimrpc handlers can read the caller's verified identity (`peer_subject` / `peer_issuer`, named per language). The slim-a2a SDKs surface this as the A2A call context user — use that, not caller-supplied metadata, for authorization.

## slimrpc

Protobuf RPC over SLIM sessions, same four patterns as gRPC (unary, server-, client-, bidi-streaming).

- A server subscribes to one SLIM name and serves every service/method registered on it; service and method travel as metadata.
- A client channel opens one session lazily on the first call and multiplexes all calls over it; it recreates the session if it dies.
- slimrpc channels (and so A2A over SLIM) open their sessions **with MLS enabled** by default, with 10 retries at 1 s for setup. Plain slim-bindings sessions make MLS a per-session choice — check it's on if E2E encryption is a requirement.
- **Multicast RPC:** a group channel sends one call to many servers and yields `(context, response)` pairs per server.
- Stubs come from `protoc-gen-slimrpc-<lang>` plugins; see `slimrpc.md`.

## A2A over SLIM

A2A defines transport-independent operations with "protocol bindings" (JSON-RPC, gRPC, HTTP+JSON). SLIM adds an experimental **slimrpc** binding (`https://a2a-protocol.org/bindings/experimental-slimrpc/v1`; SDK configs usually call it `"slimrpc"`). It reuses A2A's `a2a.proto`, so the agent logic (executor, task store, request handler) is plain A2A SDK code — only the server registration and client transport change.

What SLIM adds over HTTP A2A: discovery by name instead of DNS/load balancers, E2E MLS, routing across clusters without ingress, and multicast (one request to many agents).

Spec: https://github.com/a2aproject/experimental-cpb-slimrpc

## Plain messaging without A2A

For apps that just exchange bytes or messages (no RPC), use slim-bindings directly: create an app with a name and identity, connect to a node, subscribe, then create a point-to-point or group session and publish/receive. The SDK tutorials walk through it per language: https://docs.agntcy.org/slim/components/sdk/tutorials/tutorial-connect/ (connect → app → session → receive). Each language SDK in `agntcy/slim-bindings` also has an `examples/` directory.
