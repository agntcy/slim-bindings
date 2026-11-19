# A2A over SLIM — .NET / C#

**Written against:** `Agntcy.SlimA2A` 0.6.2, `Agntcy.Slim` / `Agntcy.Slim.SlimRpc` 3.3.6, `A2A` (a2a-dotnet) 1.0.0-preview3, `net8.0`, A2A protocol v1.0. Verified end to end against a `ghcr.io/agntcy/slim:3.4.6` node.
If the installed `Agntcy.SlimA2A` is newer, check https://github.com/agntcy/slim-a2a-dotnet/tree/main/examples/EchoAgent at the matching tag (`vX.Y.Z`) before trusting the code below.

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
dotnet add package Agntcy.SlimA2A        # .NET 8+
```

`Agntcy.SlimA2A` pulls compatible `A2A`, `Agntcy.Slim.SlimRpc` and `Agntcy.Slim` (native libraries for linux/macOS/windows x64+arm64 included); don't add those yourself. If a project references the SLIM packages directly, use exactly the version SlimA2A depends on. Namespaces: `SlimA2A` (this SDK) and `A2A` (a2a-dotnet).

## 2. Connect to a node

One `SlimA2AConnection` per node per process; every server and client in the process is created from it, each with its own identity.

```csharp
using SlimA2A;

await using var slim = await SlimA2AConnection.ConnectAsync(new SlimA2AConnectionOptions
{
    Endpoint = "http://localhost:46357",     // http → plaintext, https → TLS with system roots
});
```

Unlike Python, the connection carries no identity: identity (`Identity` + `SharedSecret`, or `IdentityProvider` + `IdentityVerifier`) goes on each server/client options object. `ConnectAsync` gives up after `ConnectTimeout` (default 30 s). Disposing the connection disposes its servers and clients.

## 3. Serve an agent

Full runnable project: `snippets/dotnet/EchoServer/` (copy and adapt it). The SLIM-specific part is only this:

```csharp
using A2A;
using Microsoft.Extensions.Logging.Abstractions;

var a2a = new A2AServer(new EchoHandler(), new InMemoryTaskStore(), new ChannelEventNotifier(), NullLogger<A2AServer>.Instance);
await using var server = await slim.StartServerAsync(
    new SlimA2AServerOptions
    {
        Identity = "agntcy/demo/echo_agent",
        SharedSecret = secret,                                     // >= 32 chars
        ResolveExtendedAgentCard = (_, _) => Task.FromResult(card), // optional
    },
    a2a);                       // any IA2ARequestHandler
await server.Completion;        // StartServerAsync returns once subscribed; stop with server.StopAsync()
```

Everything else — `IAgentHandler`, `TaskUpdater`, `MessageResponder`, `InMemoryTaskStore`, `A2AServer` — is ordinary a2a-dotnet code, so an existing agent is converted by replacing its ASP.NET Core hosting (`A2A.AspNetCore`) with `StartServerAsync`.

Agent card: `SupportedInterfaces = [new AgentInterface { Url = "slim://agntcy/demo/echo_agent", ProtocolBinding = "SLIMRPC", ProtocolVersion = "1.0" }]` — the .NET SDK uses a `slim://` URL and upper-case `SLIMRPC` (the Python examples use the bare name and `slimrpc`). The card is only returned by `GetExtendedAgentCard`; clients don't need it to connect.

Handler: in `ExecuteAsync(RequestContext context, AgentEventQueue eventQueue, CancellationToken ct)`, `context.UserText` is the first text part. For a one-shot answer `new MessageResponder(eventQueue, context.ContextId).ReplyAsync(text, cancellationToken: ct)`; for a task, `new TaskUpdater(eventQueue, context.TaskId, context.ContextId)` then `SubmitAsync` → `AddArtifactAsync` → `CompleteAsync`, as the snippet does. Pass the token by name (`cancellationToken: ct`) — the positional slot before it is `metadata`.

## 4. Call an agent

Full runnable project: `snippets/dotnet/EchoClient/`. Core:

```csharp
await using var client = slim.CreateClient(new SlimA2AClientOptions
{
    Identity = "agntcy/demo/echo_client",      // the client's own name
    SharedSecret = secret,
    Remote = "agntcy/demo/echo_agent",         // or "slim://agntcy/demo/echo_agent" from the card
    DefaultTimeout = TimeSpan.FromSeconds(30),
});
var request = new SendMessageRequest
{
    Message = new Message { Role = Role.User, MessageId = Guid.NewGuid().ToString("N"), Parts = [Part.FromText("hi")] },
};
await foreach (var ev in client.SendStreamingMessageAsync(request))
    ...  // ev.PayloadCase is Message, Task, StatusUpdate or ArtifactUpdate — handle them all
```

`SlimA2AClient` implements a2a-dotnet's `IA2AClient`, so code written against that interface works unchanged. `SendMessageAsync` (non-streaming) returns a `SendMessageResponse` with `.Task` or `.Message` set. One client targets one agent; create one per remote from the same connection.

## 5. Identity and TLS

- **Shared secret** (dev): `SharedSecret = ...` on server and client, same value, ≥ 32 chars.
- **JWT / SPIRE** (per-agent identity): set `IdentityProvider` and `IdentityVerifier` (`uniffi.slim_bindings.IdentityProviderConfig.Jwt(...)` / `IdentityVerifierConfig.Jwt(...)`) instead of `SharedSecret`, on servers and clients alike; exactly one of the two schemes. The SlimA2A README "Identity" section has a complete Ed25519 + JWKS example; copy it from there.
- **TLS to the node:** `Endpoint = "https://..."` uses system roots. Explicit: `Tls = SlimA2ATls.TrustedCa("ca.pem")`, `SlimA2ATls.InsecureSkipVerify` (dev only), mTLS with `.WithClientCertificate("cert.pem", "key.pem")`. Node auth (static JWT, OIDC) via `ConfigureClient = _ => Slim.NewClientConfigFromJson("""{ ... "auth": { "type": "static_jwt", "file": "..." } }""")` — this replaces the generated config, including its bounded retries.
- **Who called me (server side):** `SlimA2ACallContext.Current` inside the handler: `PeerSubject` / `PeerIssuer` are the caller's verified identity (with a shared secret, `PeerSubject` is just the caller's SLIM name plus a random suffix). Also `Metadata` and `RequestedExtensions` (client sends `Metadata = { [SlimA2AMetadata.Extensions] = "..." }`). Authorize on the peer identity, never on metadata.

## 6. Multi-agent: multicast and groups

**Not supported in Agntcy.SlimA2A 0.6.2** — there is no multicast or group client in the public API (the bundled generated `A2AServiceGroupClient` has an internal constructor). To fan a request out, create one `SlimA2AClient` per agent from the shared connection and call them concurrently (`Task.WhenAll`); each agent is an ordinary server (section 3) with its own name.

For non-RPC group messaging (chat-room style channels, moderator invites), use `Agntcy.Slim` group sessions directly: https://docs.agntcy.org/slim/components/sdk/tutorials/tutorial-session/ and `Slim.Examples.Group` in https://github.com/agntcy/slim-bindings/tree/main/dotnet.

## 7. A2A v0.3 compatibility

Not available in the .NET SDK: it speaks only A2A v1.0 (`lf.a2a.v1`). To talk to a v0.3 agent, put the compat layer on the other side (e.g. a Python server registering both servicers).

## 8. Gotchas

- Start the server before the client; a client calling a name nobody serves fails after ~10 s with `A2A.A2AException: Session handshake failed: failed to add participant to session: message send retries exhausted for id=...`. The same error appears when the secrets differ — check both.
- A secret under 32 chars fails immediately (after connecting, at `CreateClient` / `StartServerAsync`) with `uniffi.slim_bindings.SlimException+AuthException: @message=hmac key is too short`.
- Node unreachable: `System.TimeoutException: Could not connect to the SLIM node at <url> within 00:00:30.` Tune with `ConnectTimeout`.
- Set `DefaultTimeout` on clients — otherwise SLIM's per-call deadline is 10 hours. Cancelling a call's token only stops waiting; the server keeps working until the deadline.
- Only one connection per node endpoint per process: a second `ConnectAsync` to the same endpoint throws `SlimException`. Share the connection between servers and clients.
- The native runtime logs `INFO` lines to stdout; `RUST_LOG=error` quiets it in CLIs.
- `System.TypeLoadException: Method '...' in type 'SlimA2A.SlimA2AClient' ... does not have an implementation` means the `A2A.dll` loaded isn't the build SlimA2A was compiled against — typically a locally packed `A2A` of the same version sitting in `~/.nuget/packages/a2a/` (check its `.nupkg.metadata` `source`). Restore with a clean `NUGET_PACKAGES` or clear that folder.

## 9. More examples

https://github.com/agntcy/slim-a2a-dotnet/tree/main/examples/EchoAgent — server and client in one project (`dotnet run -- server` / `-- client`), unary and streaming; env `SLIM_SERVER`, `SLIM_SHARED_SECRET`, `SLIM_A2A_SERVER_NAME`, `SLIM_A2A_CLIENT_NAME`. `tests/SlimA2A.IntegrationTests` exercises every A2A RPC including error paths.
