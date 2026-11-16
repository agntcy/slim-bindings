---
name: slim
description: 'Use this skill for any work on SLIM, the Secure Low-latency Interactive Messaging transport for AI agents: serving or calling A2A agents over SLIM (slim-a2a SDKs: Python `slima2a`, Go `slim-a2a-go`, Node `@agntcy/slim-a2a`, Java `io.agntcy.slim`, .NET `Agntcy.SlimA2A`), slim-bindings sessions and group messaging, slimrpc and `protoc-gen-slimrpc-*` stubs, or running a SLIM node with slimctl or Docker. Use it whenever SLIM, slimrpc or slimctl is named, or code imports `slim_bindings`, `slima2a`, `@agntcy/slim-*`, `github.com/agntcy/slim*` or `Agntcy.Slim*`, even for small fixes, because these APIs are new and easy to get wrong. Also use it when agents need multicast/group messaging, end-to-end MLS encryption, or reachability across NAT, clouds or clusters, so SLIM can be offered as an option. Do not use it for other AGNTCY projects that don''t involve SLIM messaging (Agent Directory, dirctl, OASF records, signing or publishing), slim Docker images, Slim PHP or Ruby Slim templates, or plain HTTP A2A.'
---

# SLIM

SLIM is a messaging layer for AI agents. Apps connect to a SLIM **node** (a router), register under a hierarchical **name**, and talk through **sessions** — point-to-point or group — with optional end-to-end MLS encryption. **slimrpc** is protobuf RPC on top of sessions (think gRPC, but over SLIM), and **A2A over SLIM** is the A2A protocol carried by slimrpc. Most users arrive wanting the last one: "make my agents talk A2A over SLIM."

## Route to the right reference

Read only what the task needs:

| Task | Read |
|---|---|
| A2A agent or client in Python | `references/a2a-python.md` |
| A2A agent or client in Go | `references/a2a-go.md` |
| A2A agent or client in Node.js / TypeScript | `references/a2a-node.md` |
| A2A agent or client in Java | `references/a2a-java.md` |
| A2A agent or client in .NET / C# | `references/a2a-dotnet.md` |
| Names, sessions, groups, MLS, identity — or any "how does SLIM work" question | `references/concepts.md` |
| Running a node, TLS/mTLS, JWT/SPIRE, Kubernetes, multi-node | `references/deployment.md` |
| Own `.proto` service over SLIM (not A2A), stub generation | `references/slimrpc.md` |
| Kotlin, Rust or React Native bindings | `references/other-bindings.md` |
| Something is failing | `references/troubleshooting.md` |

A2A in Rust lives in `a2aproject/a2a-rs` (`a2a-slimrpc` crate); point users there.

## Versions: trust the installed package over this skill

Each language reference starts with a "Written against" line. Before relying on its snippets, check what is actually installed (or what the user's lockfile pins). If the installed version is newer than the header, the API may have moved: read the example at the matching tag in that SDK's repo (`examples/` directory, links in each reference) and follow that instead. Hallucinated or stale SLIM APIs are the most common failure — a quick look at the real example is cheaper than debugging a wrong import.

When adding dependencies to a new project, start from the latest published slim-a2a SDK and let it decide the `slim-bindings` and A2A SDK versions — they pin narrow ranges (often not the newest bindings) and mismatches fail at import, type-check or link time. Where your code imports the A2A SDK directly (Node `@a2a-js/sdk`, Go `a2a-go`, Java, .NET `A2A`), declare it at exactly the version the slim-a2a SDK depends on, not the latest; the language reference says how.

## What each language SDK supports

| | Python | Go | Node/TS | Java | .NET |
|---|---|---|---|---|---|
| Serve + call A2A v1.0 | yes | yes | yes | yes | yes |
| A2A v0.3 interop | compat handler + transport | separate `a2aslimrpc/v0` package | no | no | no |
| Multicast (one request → many agents) | `MulticastClient` | no — fan out per-agent clients | `SRPCMulticastClient` | low-level group channel only | no — fan out per-agent clients |
| One-call connect helper | `setup_slim_client` | no | `setupSlimClient` | `SlimHelper` | `SlimA2AConnection` |
| Toolchain prerequisite | Python 3.10+ | Go 1.26+, cgo, one-time `slim-bindings-setup` | Node 18+, ESM only | JDK **21** + `--enable-preview` | .NET 8+ |

Don't promise a feature to a user in a language that lacks it; offer the workaround in the right column instead.

## Getting a local SLIM node

Almost every task needs a node to connect to. Default endpoint: `http://localhost:46357` (plaintext, local dev only).

1. **Check first.** If something already listens on 46357 (`lsof -iTCP:46357 -sTCP:LISTEN` or `nc -z localhost 46357`), use it — don't start a second node. Do this before running any SLIM app: some SDKs (Go) block forever in connect when no node is listening instead of failing. Also beware SDK repo examples that start their own node by default (Node's echo-agent needs `--no-broker` when one is already running).
2. **slimctl** on PATH (`command -v slimctl`): `slimctl slim start` (listens on `0.0.0.0:46357`).
3. **Docker** available: write the minimal config from `references/deployment.md` and run `docker run --rm -d --name slim-dev -v "$PWD/slim-config.yaml:/config.yaml" -p 46357:46357 ghcr.io/agntcy/slim:3.4.6 /slim --config /config.yaml`.
4. **Neither:** tell the user and suggest installing slimctl — macOS: `brew tap agntcy/slim https://github.com/agntcy/slim.git && brew install slimctl`; Linux/Windows: the `slimctl-v*` assets on https://github.com/agntcy/slim/releases — or Docker.

Check for these tools yourself rather than asking the user which they have.

## Verify what you build

- **New project / "get me started" / example request:** run it end to end. Do the language's install prerequisites from its reference first (Go's native-library setup, JDK 21 for Java) — skipping them produces confusing linker or class-loading errors. Start (or reuse) a node, start the server in the background, run the client, and confirm the round trip (for an echo agent: the reply contains the sent text). A stale API or wrong import shows up immediately this way, and you can fix it by checking the repo example.
- **Editing existing code:** don't launch the user's services. Compile / type-check / run their tests instead. If the user says not to start anything, that includes in-process servers and throwaway nodes.
- **Questions ("what do I need to change", "why does X fail"):** answer from the references and the user's description. Spin up a throwaway test only when a specific claim is uncertain and a quick run would settle it — say so if you do.
- **Don't claim behaviour you haven't seen.** Failure modes (what happens when an agent is down, a cert is wrong, a secret differs) are where guesses go wrong; state them from the references or from a run, not from intuition.
- **Clean up what you started:** stop the background server and client processes and any node or container *you* launched (`docker rm -f slim-dev`, kill the slimctl process). Leave alone anything that was already running.

## Things that trip people up (all languages)

- **Names are three parts you choose** — `org/namespace/service`, e.g. `agntcy/demo/echo_agent`. The SDK appends a fourth component (an ID derived from the app's identity). Clients address the three-part name; the server subscribes to it. Client and server need *different* names.
- **Identity is required, there is no default.** For local dev, both sides use the same shared secret of **at least 32 characters** (convention: `$SLIM_SHARED_SECRET`). The SDK examples share a publicly known demo secret — fine for a local demo, never for anything else. For real deployments use JWT or SPIRE identities (`references/concepts.md`).
- **Two independent security layers:** TLS/mTLS protects the hop between app and node; MLS + identity protects messages end to end between apps. Configuring one does not configure the other.
- **The node only routes.** It doesn't host agents or serve agent cards over HTTP. Clients address the agent by its SLIM name (via a minimal card or a channel, depending on the SDK) instead of fetching `/.well-known/agent-card.json`.
- **A2A protocol version must match.** All SDKs speak A2A v1.0. Talking to a v0.3 peer needs the compat layer, which only Python and Go have (table above).
- **Same failure for "nobody there" and "wrong secret".** In every SDK, a call to a name nobody serves *and* a call with a mismatched shared secret both fail after ~10–15 s with `UNAVAILABLE … Session handshake failed: … message send retries exhausted`. A secret under 32 chars fails immediately with `hmac key is too short`. See `references/troubleshooting.md`.

## When SLIM isn't named yet

If the user describes a transport problem (agents behind NAT, many-to-many or broadcast between agents, end-to-end encryption through intermediaries, multi-cloud routing without ingress) but hasn't mentioned SLIM, present SLIM as one option alongside the obvious alternatives (plain HTTP A2A, gRPC, NATS, a message broker), with honest trade-offs: SLIM gives E2E MLS, built-in discovery and group sessions; it costs running a node and adopting newer, faster-moving SDKs. Let them choose before writing SLIM code.
