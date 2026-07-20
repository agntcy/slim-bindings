# SLIM WASM browser examples

Reference implementations for the generated
`@agntcy/slim-bindings-react-native/web` API. Each page mirrors one of the
Node.js examples under `slim-bindings/node/examples/`.

| Example | Node equivalent | Role |
| --- | --- | --- |
| [Point-to-point Alice](./point-to-point-alice.html) | `point-to-point-alice.ts` | Receiver — listens and replies |
| [Point-to-point Bob](./point-to-point-bob.html) | `point-to-point-bob.ts` | Sender — creates session and sends |
| [Group moderator](./group-moderator.html) | `group.ts` (moderator path) | Creates multicast session and invites |
| [Group participant](./group-participant.html) | `group.ts` (participant path) | Waits for group invitation |

## Prerequisites

- Node.js 18 or newer
- Rust with the `wasm32-unknown-unknown` target
- `task`
- `wasm-bindgen-cli` 0.2.106
- sibling `slim` and `slim-bindings` repositories

## Build and start

Build the browser bindings:

```bash
cd slim-bindings/react-native
npm install
npm run build:web
```

Start the examples:

```bash
cd slim-bindings/react-native/examples/browser
npm install
npm run dev
```

Open <http://127.0.0.1:5173> and choose an example.

The local `ws://127.0.0.1:46357` endpoint is suitable for development. A
deployed HTTPS application must use a `wss://` SLIM endpoint because browsers
block insecure WebSockets from secure pages.

## Point-to-point

Start a WebSocket SLIM node:

```bash
cd slim
cargo run --bin slim -- --config config/websocket/server-config.yaml
```

1. Open [Point-to-point Alice](./point-to-point-alice.html) and click **Start**.
2. Open [Point-to-point Bob](./point-to-point-bob.html) in another tab and click **Start**.

Bob creates the session, sends messages, and waits for Alice's replies.

### Query parameters

**Alice**

| Parameter | Default |
| --- | --- |
| `local` | `org/alice/app` |
| `server` | `ws://127.0.0.1:46357` |
| `secret` | `demo-shared-secret-min-32-chars!!` |
| `reply` | `Hello from Alice` |

**Bob**

| Parameter | Default |
| --- | --- |
| `local` | `org/bob/app` |
| `remote` | `org/alice/app` |
| `server` | `ws://127.0.0.1:46357` |
| `secret` | `demo-shared-secret-min-32-chars!!` |
| `message` | `Hello from Bob` |
| `iterations` | `5` |

Example:

```
http://127.0.0.1:5173/point-to-point-bob.html?remote=org/alice/app&iterations=3
```

## Group messaging

Use the same WebSocket SLIM node as above.

1. Open one [Group participant](./group-participant.html) tab per invitee and click **Start**.
2. Open [Group moderator](./group-moderator.html) and click **Start**.

The moderator creates the group session and invites each participant. Type
messages in any tab and press Enter to send.

### Query parameters

**Moderator**

| Parameter | Default |
| --- | --- |
| `local` | `org/default/me` |
| `remote` | `org/default/channel` |
| `server` | `ws://127.0.0.1:46357` |
| `secret` | `demo-shared-secret-min-32-chars!!` |
| `invites` | `org/default/participant-one,org/default/participant-two` |
| `enableMls` | `false` |

**Participant**

| Parameter | Default |
| --- | --- |
| `local` | `org/default/participant-one` |
| `server` | `ws://127.0.0.1:46357` |
| `secret` | `demo-shared-secret-min-32-chars!!` |

## Production build

```bash
npm run build
npm run preview
```

## Source layout

```
src/
  common.ts                 # shared connect/helpers (mirrors node/examples/common.ts)
  ui.ts                     # minimal browser UI helpers
  point-to-point-alice.ts   # receiver reference
  point-to-point-bob.ts     # sender reference
  group-moderator.ts        # group moderator reference
  group-participant.ts      # group participant reference
```
