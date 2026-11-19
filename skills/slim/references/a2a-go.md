# A2A over SLIM — Go

**Written against:** `github.com/agntcy/slim-a2a-go` v0.5.2, `github.com/agntcy/slim-bindings-go/v3` v3.3.6 (pulled by slim-a2a-go), `github.com/a2aproject/a2a-go/v2` v2.1.0, Go 1.26, A2A protocol v1.0. Verified end to end against a `ghcr.io/agntcy/slim:3.4.6` node on macOS arm64.
If `go.mod` has a newer slim-a2a-go, check https://github.com/agntcy/slim-a2a-go/tree/main/examples/echo_agent at the matching tag before trusting the code below.

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
go get github.com/agntcy/slim-a2a-go@latest
go mod tidy                                                         # after writing the imports; resolves a2a-go/v2 and slim-bindings-go/v3
go run github.com/agntcy/slim-bindings-go/v3/cmd/slim-bindings-setup  # once per bindings version
```

slim-a2a-go needs **Go ≥ 1.26** and pulls compatible `slim-bindings-go/v3` and `a2a-go/v2`; don't pin those yourself. The bindings are a Rust static library linked through **cgo**, so:

- A C toolchain is required (Xcode CLT on macOS, gcc on Linux) and `CGO_ENABLED=1` (the default unless cross-compiling or in some Docker images).
- `slim-bindings-setup` downloads the prebuilt `libslim_bindings_<arch>_<os>.a` (~220 MB on macOS) from the slim-bindings GitHub release matching the version in **your** `go.mod`, into `$GOPATH/.cgo-cache/slim-bindings/<version>/`. Run it from inside the module, after `go mod tidy` (otherwise: `missing go.sum entry ... slim-bindings-setup`). Re-run it whenever the `slim-bindings-go/v3` version in `go.mod` changes.
- The cgo `LDFLAGS` find that directory by a path relative to the module cache, so `GOMODCACHE` must stay at the default `$GOPATH/pkg/mod`. Vendoring (`go mod vendor`) breaks the lookup too.
- Docker builds: run the setup step in the builder stage after `go mod download` (Linux musl/Alpine is detected automatically; `-os/-arch/-abi` flags pick another target). The binary is statically linked against the library, so the runtime image doesn't need it.

## 2. Connect to a node

No one-call helper as in Python; it's four bindings calls. They are synchronous (no event-loop setup).

```go
import slim_bindings "github.com/agntcy/slim-bindings-go/v3"

slim_bindings.InitializeWithDefaults()
svc := slim_bindings.GetGlobalService()

name := slim_bindings.NewName("agntcy", "demo", "echo_agent")             // SLIM name agntcy/demo/echo_agent
app, err := svc.CreateAppWithSecret(name, os.Getenv("SLIM_SHARED_SECRET")) // >= 32 chars; or svc.CreateApp(name, provider, verifier)
defer app.Destroy()
connID, err := svc.Connect(slim_bindings.NewInsecureClientConfig("http://localhost:46357")) // or NewSecureClientConfig for TLS
err = app.Subscribe(name, &connID)                                          // needed on BOTH server and client
```

`slim_bindings.NameFromString("agntcy/demo/echo_agent")` parses a three-part string. The default logger prints Rust `INFO` lines to stdout; for a CLI use `tc := slim_bindings.NewTracingConfig(); tc.LogLevel = "error"; slim_bindings.InitializeWithConfigs(slim_bindings.NewRuntimeConfig(), tc, []slim_bindings.ServiceConfig{slim_bindings.NewServiceConfig()})` instead of `InitializeWithDefaults()`.

## 3. Serve an agent

Full runnable file: `snippets/go/server/main.go` (with `snippets/go/go.mod`; copy and adapt). The SLIM-specific part is only this:

```go
import (
    "github.com/a2aproject/a2a-go/v2/a2asrv"
    a2aslimrpc "github.com/agntcy/slim-a2a-go/a2aslimrpc/v1"
    slim_rpc "github.com/agntcy/slim-bindings-go/v3/slim_rpc"
)

server := slim_rpc.ServerNewWithConnection(app, name, &connID)
a2aslimrpc.NewHandler(a2asrv.NewHandler(myExecutor)).RegisterWith(server)
err := server.ServeBlocking()
```

Everything else is ordinary `a2a-go/v2` code: an `a2asrv.AgentExecutor` whose `Execute(ctx, execCtx)` returns an `iter.Seq2[a2a.Event, error]`, wrapped by `a2asrv.NewHandler` (options such as `WithTaskStore`, `WithExtendedAgentCard`). An existing a2a-go agent is converted by swapping its `a2agrpc`/JSON-RPC server for the three lines above.

Unlike Python, the handler doesn't take an agent card — nothing is served at a well-known URL. If you publish a card elsewhere, give it `a2a.NewAgentInterface("<org/ns/service>", a2aslimrpc.SLIMProtocol)` (sets binding `"slimrpc"` and protocol version `1.0`).

Executor rule: yield `a2a.NewSubmittedTask(execCtx, execCtx.Message)` first when `execCtx.StoredTask == nil`, then `NewArtifactEvent` / `NewStatusUpdateEvent(..., a2a.TaskStateCompleted, ...)`, as the snippet does. Stop when `yield` returns false.

## 4. Call an agent

Full runnable file: `snippets/go/client/main.go`. Core:

```go
import (
    "github.com/a2aproject/a2a-go/v2/a2a"
    "github.com/a2aproject/a2a-go/v2/a2aclient"
    a2aslimrpc "github.com/agntcy/slim-a2a-go/a2aslimrpc/v1"
)

factory := a2aclient.NewFactory(
    a2aclient.WithDefaultsDisabled(),               // drop the HTTP transports
    a2aslimrpc.WithSLIMRPCTransport(app, &connID),
)
card := &a2a.AgentCard{SupportedInterfaces: []*a2a.AgentInterface{
    a2a.NewAgentInterface("agntcy/demo/echo_agent", a2aslimrpc.SLIMProtocol), // URL = SLIM name
}}
client, err := factory.CreateFromCard(ctx, card)
defer client.Destroy()
result, err := client.SendMessage(ctx, &a2a.SendMessageRequest{
    Message: a2a.NewMessage(a2a.MessageRoleUser, a2a.NewTextPart("hi")),
})
// result is *a2a.Message or *a2a.Task — handle both (text is in Task.Artifacts[].Parts)
```

Streaming: `for ev, err := range client.SendStreamingMessage(ctx, req) { ... }`. Without the factory: `a2aslimrpc.NewTransport(slim_rpc.ChannelNewWithConnection(app, remoteName, &connID))`.

The client must use its **own** SLIM name (e.g. `agntcy/demo/echo_client`), subscribe it, and use the same identity trust as the server.

## 5. Identity and TLS

- **Shared secret** (dev): `svc.CreateAppWithSecret(name, secret)` on both sides, same value, ≥ 32 chars.
- **JWT** (per-agent identity): `svc.CreateApp(name, provider, verifier)` with `slim_bindings.IdentityProviderConfigJwt{...}` / `IdentityVerifierConfigJwt{...}`. The slim-a2a-go README ("JWT identity (EdDSA / did:key)") has the complete Ed25519 + JWKS struct literal; copy it rather than reconstructing it. Always set `Issuer` on the provider. SPIRE: `IdentityProviderConfigSpire{Config: spire}` / `IdentityVerifierConfigSpire{...}`.
- **TLS to the node:** `cfg := slim_bindings.NewSecureClientConfig("https://slim.example.com:443")`; optional `cfg.Tls.CaSource = slim_bindings.CaSourceFile{Path: ...}`, mTLS via `cfg.Tls.Source`, node auth via `cfg.Auth = &auth` (`ClientAuthenticationConfigStaticJwt{...}`); then `svc.Connect(cfg)`.
- **Who called me (server side):** `caller, ok := a2aslimrpc.CallerFromContext(ctx)` in `Execute` gives `caller.Subject` / `caller.Issuer` from the token SLIM verified (with a shared secret, the subject is the caller's SLIM name). Authorize on this, never on request metadata.

The echo_agent example exposes all of this as flags (`--identity jwt|spire`, `--jwt-*`, `--tls*`, `--node-auth`); its `internal/slimconfig` package is a good template.

## 6. Multi-agent: multicast and groups

**slim-a2a-go has no multicast client** (no group channel factory, no equivalent of Python's `MulticastClient`). For an orchestrator, create one client per agent card from the same factory and fan out yourself with goroutines; each agent is an ordinary server (section 3) with its own name.

For non-RPC group messaging (chat-room style channels, moderator invites), use slim-bindings group sessions directly: https://docs.agntcy.org/slim/components/sdk/tutorials/tutorial-session/ and `agntcy/slim-bindings` `go/examples/group`.

## 7. A2A v0.3 compatibility

Separate package `github.com/agntcy/slim-a2a-go/a2aslimrpc/v0`, same API shape (`NewHandler`, `WithSLIMRPCTransport`, `NewTransport`, `SLIMProtocol`); both take the same `a2asrv.RequestHandler`.

- Server accepting both: register both on one server — `a2aslimrpcv0.NewHandler(h).RegisterWith(server)` and `a2aslimrpcv1.NewHandler(h).RegisterWith(server)`.
- Client talking to a v0.3 agent: `a2aslimrpcv0.WithSLIMRPCTransport(app, &connID)` and an interface `&a2a.AgentInterface{URL: name, ProtocolBinding: a2aslimrpcv0.SLIMProtocol, ProtocolVersion: "0.3"}`.
- Importing v0 and v1 in one binary **panics at startup**: `proto: file "a2a.proto" is already registered`. Run with `GOLANG_PROTOBUF_REGISTRATION_CONFLICT=warn`, or bake it in: `go build -ldflags "-X google.golang.org/protobuf/reflect/protoregistry.conflictPolicy=warn"`. Importing only v1 needs neither.

## 8. Gotchas

- Start the server before the client; a client calling a name nobody serves fails after ~10 s with `send message: RpcError: Rpc: Code=15, Message=Session handshake failed: failed to add participant to session: message send retries exhausted for id=...`. The same error appears when the secrets differ — check both.
- A secret under 32 chars (or an unset `$SLIM_SHARED_SECRET`) fails immediately at `CreateAppWithSecret` with `SlimError: AuthError: Message=hmac key is too short`.
- `svc.Connect` to a node that isn't listening **does not return** — it logs `transient connect error, retrying` every 2 s (still blocked after 90 s in testing). Check the node first, or call it under your own timeout.
- `ld: library 'slim_bindings_aarch64_darwin' not found` (Linux: `cannot find -lslim_bindings_x86_64_linux_gnu`) means `slim-bindings-setup` wasn't run for this version, or `GOMODCACHE` is non-default. `undefined: ResponseStreamReader` etc. in `slim_rpc` means `CGO_ENABLED=0`.
- `ld: warning: ignoring duplicate libraries: '-lslim_bindings_...'` is harmless. On macOS the setup tool re-downloads the library on every run even if present.
- On macOS a binary that imports only the bindings (no `net/http`, `crypto/x509`) can fail to link with missing CoreFoundation symbols; add `import _ "crypto/x509"`. Programs using `a2aclient`/`a2asrv` already pull it in.
- Call `client.Destroy()` and `app.Destroy()` when done; they release native resources.
- `server.ServeBlocking()` blocks; run other work in goroutines. `server.ShutdownBlocking()` stops it.

## 9. More examples

https://github.com/agntcy/slim-a2a-go/tree/main/examples/echo_agent — `cmd/server` (v0, v1 or both), `cmd/client` (direct `Transport`), `cmd/factory-client` (recommended `a2aclient.Factory` pattern), plus JWT / SPIRE / TLS flags in `internal/slimconfig`. API docs: https://pkg.go.dev/github.com/agntcy/slim-a2a-go.
