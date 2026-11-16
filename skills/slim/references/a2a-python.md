# A2A over SLIM — Python

**Written against:** `slima2a` 0.9.3, `slim-bindings` 3.3.9, `a2a-sdk` 1.2.3, A2A protocol v1.0. Verified end to end against a `ghcr.io/agntcy/slim:3.4.6` node.
If the installed `slima2a` is newer, check https://github.com/agntcy/slim-a2a-python/tree/main/examples at the matching tag before trusting the code below.

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
uv add slima2a httpx        # or: pip install slima2a httpx
```

`slima2a` pulls compatible `slim-bindings` and `a2a-sdk`; don't pin those yourself. Python 3.10+. `httpx` is needed by the A2A client config even though no HTTP is used.

## 2. Connect to a node

`setup_slim_client` does everything in one call: registers the asyncio loop with slim_bindings, initializes the service, creates the app with an identity, connects, and subscribes the name.

```python
from slima2a import setup_slim_client

service, local_app, local_name, conn_id = await setup_slim_client(
    namespace="agntcy", group="demo", name="echo_agent",   # → SLIM name agntcy/demo/echo_agent
    secret=os.environ["SLIM_SHARED_SECRET"],               # >= 32 chars; or identity=SlimIdentity(...)
    slim_url="http://localhost:46357",                     # default; or client_config=... for TLS
)
```

Exactly one of `secret` / `identity` is required (no default). At most one of `slim_url` / `client_config`. Conflicts raise `ValueError` before connecting. For manual control use `initialize_slim_service()` + `connect_and_subscribe(...)`, or raw `slim_bindings` (then call `slim_bindings.uniffi_set_event_loop(asyncio.get_running_loop())` first).

## 3. Serve an agent

Full runnable file: `snippets/python/echo_server.py` (copy and adapt it). The SLIM-specific part is only this:

```python
import slim_bindings
from slima2a.handler import SRPCHandler
from slima2a.types.v1.a2a_pb2_slimrpc import add_A2AServiceServicer_to_server

# agent_card: a2a.types.a2a_pb2.AgentCard; request_handler: a2a DefaultRequestHandler
server = slim_bindings.Server.new_with_connection(local_app, local_name, conn_id)
add_A2AServiceServicer_to_server(SRPCHandler(agent_card, request_handler), server)
await server.serve_async()
```

Everything else — `AgentExecutor`, `TaskUpdater`, `InMemoryTaskStore`, `DefaultRequestHandler` — is ordinary `a2a-sdk` code, so an existing A2A agent is converted by swapping its HTTP app for the four lines above.

Agent card: give it `supported_interfaces=[AgentInterface(url="<org/ns/service>", protocol_binding="slimrpc", protocol_version="1.0")]`. Without `protocol_version` the a2a-sdk logs a spec-compliance warning.

Executor rule: enqueue a `Task` (`new_task_from_user_message`) before emitting status or artifact events, as the snippet does.

## 4. Call an agent

Full runnable file: `snippets/python/echo_client.py`. Core:

```python
from a2a.client import minimal_agent_card
from slima2a.client_transport import ClientConfig, MultiAgentClientFactory, slimrpc_channel_factory

config = ClientConfig(
    supported_protocol_bindings=["slimrpc"],
    streaming=True,
    httpx_client=httpx.AsyncClient(),
    slimrpc_channel_factory=slimrpc_channel_factory(local_app, conn_id),
)
client = MultiAgentClientFactory(config).create(card=minimal_agent_card("agntcy/demo/echo_agent", ["slimrpc"]))
async for resp in client.send_message(request=SendMessageRequest(message=new_text_message("hi", role=Role.ROLE_USER))):
    ...  # resp.WhichOneof("payload") is "message", "task" or "artifact_update" — handle all three
```

The client must use its **own** SLIM name (e.g. `agntcy/demo/echo_client`) and the same identity trust as the server.

## 5. Identity and TLS

- **Shared secret** (dev): `secret=...` on both sides, same value, ≥ 32 chars.
- **JWT** (per-agent identity): pass `identity=SlimIdentity(provider=..., verifier=...)` using `slim_bindings.IdentityProviderConfig.JWT(...)` / `IdentityVerifierConfig.JWT(...)`. The slima2a README has a complete Ed25519 + JWKS example ("Identity and node connection"); copy it from there rather than reconstructing it. SPIRE is supported the same way.
- **TLS to the node:** `client_config = slim_bindings.new_secure_client_config("https://slim.example.com:443")`, optionally `client_config.auth = slim_bindings.ClientAuthenticationConfig.STATIC_JWT(...)`, then pass `client_config=client_config` (instead of `slim_url`; passing both raises `ValueError`).
- **mTLS to the node** (client certificate): same, plus
  ```python
  cfg = slim_bindings.new_secure_client_config("https://slim.internal:46357")   # https, not http
  cfg.tls.source = slim_bindings.TlsSource.FILE(cert="/certs/agent.crt", key="/certs/agent.key")
  cfg.tls.ca_source = slim_bindings.CaSource.FILE(path="/certs/ca.crt")         # private CA for the node cert
  cfg.tls.include_system_ca_certs_pool = False                                # optional: trust only that CA
  # cfg.server_name = "slim.internal"                                          # only if cert SAN != URL host
  ```
  `TlsSource.PEM(cert=..., key=...)` / `CaSource.PEM(data=...)` take strings instead of files. Every process that connects (servers *and* callers) needs its own client cert. Node side: `deployment.md`. Don't confuse `slim_bindings.ClientConfig` (node connection, TLS) with `slima2a.client_transport.ClientConfig` (A2A client settings).
- **Who called me (server side):** `context.call_context.user` in the executor is a `slima2a.SlimUser` (`.subject`, `.issuer`) when the caller's identity was verified, otherwise unauthenticated. Authorize on this, never on request metadata. Raw slimrpc context: `call_context.state["slim_context"]`.

## 6. Multi-agent: multicast and groups

One request to several agents at once — add a group channel factory and pass a list of cards:

```python
from slima2a.client_transport import slimrpc_group_channel_factory

config = ClientConfig(
    supported_protocol_bindings=["slimrpc"], streaming=True, httpx_client=http,
    slimrpc_channel_factory=slimrpc_channel_factory(local_app, conn_id),
    slimrpc_group_channel_factory=slimrpc_group_channel_factory(local_app, conn_id),
)
client = MultiAgentClientFactory(config).create(card=[
    minimal_agent_card("agntcy/demo/agent_a", ["slimrpc"]),
    minimal_agent_card("agntcy/demo/agent_b", ["slimrpc"]),
])
async for source, resp in client.send_message(request):   # MulticastClient yields (source, response)
    print(source, resp.WhichOneof("payload"))
```

`source` identifies which agent answered, so interleaved replies can be told apart. Each agent is an ordinary server (section 3) with its own name.

**Multicast is all-or-nothing.** The group channel invites every member before sending. If any one agent is down (or rejects the caller's identity), the whole call raises `RpcError` with `Failed to invite <name> ... retries exhausted` after ~10 s, and *no* agent gets the request — you do not get partial results. Wrap the call in `try/except slim_bindings.RpcError`, and don't tell the user a missing agent just yields fewer replies. When partial results matter, fan out instead: one client per card from the same factory, then `asyncio.gather(..., return_exceptions=True)` (optionally under `asyncio.wait_for`), so each agent succeeds or fails on its own. Same approach for an orchestrator that calls agents one at a time.

Realistic multi-agent example (LangChain agent behind A2A over SLIM): `examples/travel_planner_agent/` in slim-a2a-python.

For non-RPC group messaging (chat-room style channels, moderator invites), use slim-bindings group sessions directly: https://docs.agntcy.org/slim/components/sdk/tutorials/tutorial-session/ and `agntcy/slim-bindings/python/examples/group.py`.

## 7. A2A v0.3 compatibility

- Server accepting both: register both servicers on one server —
  `add_v0(SRPCCompatHandler(agent_card, request_handler), server)` from `slima2a.compat.v3_0.handler` / `slima2a.types.v0.a2a_pb2_slimrpc`, plus the v1 one. Both take the **v1** card and handler.
- Client talking to a v0.3 agent: `factory.register("slimrpc", SRPCCompatTransport.create, multiagent=True)` with `SRPCCompatTransport` from `slima2a.compat.v3_0.client_transport`.

## 8. Gotchas

- Start the server before the client; a client calling a name nobody serves fails after retries with `RpcError ... UNAVAILABLE ... Session handshake failed: ... message send retries exhausted`. The same error appears when the secrets differ — check both.
- A secret under 32 chars fails immediately with `AuthError: hmac key is too short`.
- `setup_slim_client` logs at `info` to stdout; pass `log_level="error"` to quiet it in CLIs.
- Don't name a local package `types` (shadows stdlib) — relevant if you generate your own stubs.
- `serve_async()` blocks; run other work as separate tasks.
- TLS problems don't always raise: a node cert whose SAN doesn't match the URL host makes `connect` retry silently; the cause (`certificate not valid for name ...`) only shows at `log_level="debug"`. A missing/untrusted client cert fails fast with `CertificateRequired`; `http://` against a TLS listener fails with `h2 protocol error`.
- Don't install the PyPI package `slimrpc` (0.2.x) — it's the obsolete standalone library. The slimrpc runtime ships inside `slim-bindings`.

## 9. More examples

https://github.com/agntcy/slim-a2a-python/tree/main/examples — `echo_agent` (unary, streaming, v0.3 compat, multicast, `--type starlette` to compare with HTTP) and `travel_planner_agent`.
