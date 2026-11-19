# Troubleshooting SLIM

Work from the bottom of the stack up: node → connection → identity → names → protocol.

## Can't connect / connection refused / connect hangs

- Is a node running? `nc -z localhost 46357`. If not, start one (SKILL.md "Getting a local SLIM node").
- Scheme must match the node: `http://` for an `insecure: true` listener, `https://` for TLS. A TLS client against a plaintext node (or the reverse) fails or hangs.
- In Docker, `localhost` inside a container is the container itself — use the node container's name on a shared network, or `host.docker.internal`.
- Wrong port: 46357 is the data-plane default; 50051/50052 belong to the controller.

## Connected, but the client never gets an answer / times out

- The server must be **running and subscribed** before the client's first call; anycast discovery has nothing to find otherwise. Start the server first and give it a moment.
- Name mismatch: the client must address exactly the server's `org/namespace/service` (case-sensitive). Print both.
- Client and server share the **same name** → messages loop to the wrong app. Give the client its own name.
- Identity mismatch: both sides must trust each other — the same shared secret, or verifiers that accept each other's JWTs. A wrong secret does **not** produce an auth error: the client retries and fails exactly like "no server" (Python: `RpcError ... UNAVAILABLE ... Session handshake failed: failed to add participant to session: message send retries exhausted`). When you see that, check both the server is up *and* the secrets/trust match. Turn up log level (`debug`) on both sides to see dropped messages.
- Shared secret shorter than 32 characters is rejected at app creation (`AuthError: hmac key is too short`).
- **Telling the two apart from logs** (at debug level):
  - The *server* app logs `dropping pre-session message: identity verification failed` → secret/identity mismatch.
  - The *node* logs `no match for publish destination` with the target name → nobody is subscribed under that name (server down, typo, or connected to a different node).
  - Different nodes with no route between them: the node warns `cannot infer default gateway ... set_route or set_default_gateway required`.
- The handshake retries 10 times at 1 s intervals, so these failures surface after ~10–15 s, never instantly.

## Multicast fails as a whole

A group/multicast call invites every member first. One member down or untrusted → the entire call fails with `Failed to invite <name> ... retries exhausted`, and no member receives the request. For partial results, call agents individually and gather (see the language reference).

## TLS / mTLS to the node

- `CertificateRequired` → the node has `client_ca` set and the app sent no (or an untrusted) client cert.
- `h2 protocol error` → plaintext `http://` client against a TLS listener.
- Connect retries forever without an error → often a node cert SAN mismatch; the real message (`certificate not valid for name ...`) only appears at debug level. Set `server_name` in the client config or fix the cert.
- Node crashes at start with `InconsistentKeys(KeyMismatch)` → EC key written with explicit curve parameters (macOS LibreSSL `openssl req -newkey ec`). Regenerate with `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -pkeyopt ec_param_enc:named_curve`, or use RSA.
- Changed the client CA bundle and nothing happened → the node does not reload `client_ca`; restart it. (The server cert/key files are reloaded.)

## A2A-specific

- A2A v1.0 vs v0.3 mismatch between client and server: use the SDK's v0.3 compat handler/transport on one side, or align versions.
- The client returns a mix of `message`, `task` and artifact-update payloads depending on the agent — handle all of them, or the client looks like it "got nothing".
- Agent card URLs: over SLIM the card's address is the SLIM name; clients typically build a minimal card from the name rather than fetching it over HTTP.

## Import / build errors after install

- Version skew between the slim-a2a SDK, `slim-bindings` and the A2A SDK. Install only the slim-a2a SDK and let it resolve the other two; remove manual pins.
- Installed SDK newer than this skill's "Written against" header: the API probably moved. Read the example at the matching tag in the SDK repo.
- Go: slim-bindings-go uses cgo and a prebuilt native library; needs a C compiler and `CGO_ENABLED=1`. Follow the slim-bindings-go README for the library setup step.
- Python asyncio: when not using the SDK helper (`setup_slim_client`), call `slim_bindings.uniffi_set_event_loop(asyncio.get_running_loop())` before other calls.

## Still stuck

Ask the user for logs from both apps at debug level and the node log. Issues: https://github.com/agntcy/slim/issues (node, docs) and the specific SDK repo for A2A issues.
