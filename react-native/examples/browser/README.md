# SLIM WASM browser example

This playground uses the generated `@agntcy/slim-bindings-react-native/web`
API to exercise all supported browser session combinations:

| Delivery | Security | Participants |
| --- | --- | --- |
| Unicast (point-to-point) | No MLS or MLS | Exactly two |
| Multicast (group) | No MLS or MLS | Browser moderator plus one or more invitees |

It demonstrates WASM initialization, a browser WebSocket connection, upstream
routing, outgoing and incoming sessions, multicast invitations, asynchronous
publish/receive operations, explicit session cleanup, and WebSocket cleanup.

For commands and click-by-click instructions for every supported scenario, see
[demo.md](./demo.md).

## Prerequisites

- Node.js 18 or newer
- Rust with the `wasm32-unknown-unknown` target
- `task`
- `wasm-bindgen-cli` 0.2.106
- sibling `slim` and `slim-bindings` repositories

## Build and start the web app

Build the browser bindings:

```bash
cd slim-bindings/react-native
npm install
npm run build:web
```

Start the example:

```bash
cd slim-bindings/react-native/examples/browser
npm install
npm run dev
```

The local `ws://127.0.0.1:46357` endpoint is suitable for development. A
deployed HTTPS application must use a `wss://` SLIM endpoint because browsers
block insecure WebSockets from secure pages.

## Two-browser unicast

Start a WebSocket SLIM node:

```bash
cd slim
cargo run --bin slim -- --config config/websocket/server-config.yaml
```

Open <http://127.0.0.1:5173> in two tabs:

1. Apply **Unicast · Alice creator** in the first tab.
2. Apply **Unicast · Bob receiver** in the second tab.
3. Connect both tabs with the same shared secret.
4. Select unicast and choose whether to enable MLS. The creator's setting is
   carried by the session handshake.
5. Click **Wait for incoming** in Bob's tab, then **Create session** in Alice's
   tab.

## Browser + native WebSocket + native gRPC multicast

One point-to-point session cannot contain three participants, so this showcase
uses one multicast session. A single SLIM node listens on WebSocket port 46357
and gRPC port 46358, routing every participant into the same channel.

Start the multi-transport node:

```bash
cd slim
cargo run --bin slim -- --config config/multi-transport/server-config.yaml
```

Start the native WebSocket participant in another terminal:

```bash
cd slim
cargo run -p slim-examples --bin chat -- \
  --config config/multi-transport/websocket-client-config.yaml \
  --name org/default/native-ws/1 \
  --channel org/default/mixed-demo
```

Start the native gRPC participant in a third terminal:

```bash
cd slim
cargo run -p slim-examples --bin chat -- \
  --config config/multi-transport/grpc-client-config.yaml \
  --name org/default/native-grpc/2 \
  --channel org/default/mixed-demo
```

In the browser apply **Mixed transports · Browser moderator**. The preset uses:

- endpoint: `ws://127.0.0.1:46357`
- local name: `org/default/browser`
- shared secret: `test-shared-secret-value-0123456789abcdef`
- delivery mode: **Multicast (group)**
- multicast channel: `org/default/mixed-demo`
- invitees: `org/default/native-ws` and `org/default/native-grpc`

Connect the browser after both native participants say they are waiting for an
invite. Toggle MLS as desired, then click **Create session**. Messages entered
in any of the three applications are broadcast to the other two. The browser
is the moderator, so `--no-mls` is not needed on native participants; they learn
the MLS setting from the incoming session.

## Production build

```bash
npm run build
npm run preview
```
