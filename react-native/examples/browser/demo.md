# SLIM browser/WASM end-to-end demo

This guide demonstrates the SLIM browser bindings across delivery modes,
security modes, and transports. The browser UI supports repeatable presets for
each browser role, while the native `chat` example supplies WebSocket and gRPC
participants.

## What the demo covers

| Scenario | Delivery | Security | Participants |
| --- | --- | --- | --- |
| Browser-to-browser | Unicast | No MLS | Alice and Bob |
| Browser-to-browser | Unicast | MLS | Alice and Bob |
| Browser-only group | Multicast | No MLS | Browser moderator and two browser members |
| Browser-only group | Multicast | MLS | Browser moderator and two browser members |
| Mixed transports | Multicast | No MLS or MLS | Browser WebSocket, native WebSocket, native gRPC |
| Native-moderated group | Multicast | No MLS or MLS | Native moderator, browser participant, native participant |

“Single cast” in the UI and this guide is called **unicast** or
**point-to-point**. A unicast session contains exactly two participants. Three
or more participants must use multicast.

## Mixed-transport architecture

```text
Browser + WASM ───── WebSocket :46357 ────┐
Native chat ──────── WebSocket :46357 ────┼── SLIM node ── one session/channel
Native chat ──────────── gRPC :46358 ─────┘
```

The transports terminate at the same SLIM node. Session membership and MLS are
above the transport layer, so all three applications can participate in one
session.

## One-time setup

The commands assume `slim` and `slim-bindings` are sibling repositories.

Build the WASM bindings:

```bash
cd slim-bindings/react-native
npm install
npm run build:web
```

Install and start the browser example:

```bash
cd slim-bindings/react-native/examples/browser
npm install
npm run dev
```

Open <http://127.0.0.1:5173>.

The examples use this shared secret:

```text
test-shared-secret-value-0123456789abcdef
```

Every participant in a session must use the same secret. The browser UI already
contains this value, and the native `chat` example uses it by default.

The **Optional auth token** field is intentionally empty for the local configs
in this guide. It is the WebSocket query token for an auth-enabled SLIM server;
it is separate from the shared secret.

## Scenario 1: browser unicast without MLS

Start a WebSocket SLIM node:

```bash
cd slim
cargo run --bin slim -- --config config/websocket/server-config.yaml
```

Open the web app in two tabs.

### Bob's receiving tab

1. Select **Unicast · Bob receiver**.
2. Click **Apply preset**.
3. Leave **Enable MLS** off.
4. Click **Connect**.
5. Click **Wait for incoming**.

### Alice's creating tab

1. Select **Unicast · Alice creator**.
2. Click **Apply preset**.
3. Leave **Enable MLS** off.
4. Click **Connect**.
5. Click **Create session**.

The status in both tabs should become `Unicast · No MLS`. Send messages in both
directions, then click **Close session** in the creating tab.

## Scenario 2: browser unicast with MLS

Repeat Scenario 1, but enable **Enable MLS** in Alice's creating tab before
creating the session. Bob learns the MLS configuration from the incoming
session handshake, and both tabs should show `Unicast · MLS`.

The session creator controls the MLS setting. Toggling MLS in a receiving tab
does not override the incoming session configuration.

## Scenario 3: browser-only multicast without MLS

Use the WebSocket node from Scenario 1 and open the app in three tabs.

### Participant tabs

In the first participant tab:

1. Apply **Browser multicast · Participant one**.
2. Connect.
3. Click **Wait for incoming**.

In the second participant tab:

1. Apply **Browser multicast · Participant two**.
2. Connect.
3. Click **Wait for incoming**.

### Moderator tab

1. Apply **Browser multicast · Moderator**.
2. Leave **Enable MLS** off.
3. Connect.
4. Click **Create session**.

The moderator creates `org/default/browser-group` and invites
`org/default/browser-one` and `org/default/browser-two`. A message sent by any
tab is delivered to the other two tabs.

## Scenario 4: browser-only multicast with MLS

Repeat Scenario 3 with **Enable MLS** selected in the moderator tab. All tabs
should report `Multicast · MLS`. The participants receive the MLS setting and
group state through the invitation flow.

## Scenario 5: browser-moderated mixed transports

This scenario places browser WebSocket, native WebSocket, and native gRPC
participants in one multicast session.

### Start the dual-transport node

```bash
cd slim
cargo run --bin slim -- --config config/multi-transport/server-config.yaml
```

The node listens on:

- `ws://127.0.0.1:46357` for browser and native WebSocket clients;
- `http://127.0.0.1:46358` for native gRPC clients.

### Start the native WebSocket participant

```bash
cd slim
cargo run -p slim-examples --bin chat -- \
  --config config/multi-transport/websocket-client-config.yaml \
  --name org/default/native-ws/1 \
  --channel org/default/mixed-demo
```

Wait for `waiting for invite from a moderator ...`.

### Start the native gRPC participant

```bash
cd slim
cargo run -p slim-examples --bin chat -- \
  --config config/multi-transport/grpc-client-config.yaml \
  --name org/default/native-grpc/2 \
  --channel org/default/mixed-demo
```

Wait for `waiting for invite from a moderator ...`.

### Create the session in the browser

1. Apply **Mixed transports · Browser moderator**.
2. Choose whether to enable MLS.
3. Connect.
4. Click **Create session**.

The preset configures:

- local name: `org/default/browser`;
- channel: `org/default/mixed-demo`;
- invitees: `org/default/native-ws` and `org/default/native-grpc`.

Expected native output with MLS enabled:

```text
joined group 'org/default/mixed-demo' (MLS enabled)
type a message and press Enter (Ctrl-D to quit):
```

Send one message from each application. Each message should appear in the other
two applications, proving that the three transports share one session.

The browser is the moderator in this scenario, so the native participant
commands do not need `--no-mls`. They learn the security setting from the
incoming invitation.

## Scenario 6: native-moderated mixed transports

This variation proves that the browser can also be an invited participant.
Keep the dual-transport node running.

Start the native WebSocket participant from Scenario 5. In the browser:

1. Apply **Mixed transports · Browser participant**.
2. Connect.
3. Click **Wait for incoming**.

Then create the group from a native gRPC moderator:

```bash
cd slim
cargo run -p slim-examples --bin chat -- \
  --config config/multi-transport/grpc-client-config.yaml \
  --name org/default/native-moderator/3 \
  --channel org/default/mixed-demo \
  --moderator \
  --invite org/default/browser org/default/native-ws
```

MLS is enabled by default. Add `--no-mls` to the moderator command to create a
plaintext multicast session instead. The browser status reflects the setting
received from the native moderator.

## UI feature reference

| UI control | Purpose |
| --- | --- |
| Scenario preset | Populates consistent names, channel, invitees, and browser role |
| WebSocket endpoint | Browser connection to the SLIM WebSocket listener |
| Optional auth token | Query token used only when the server requires transport authentication |
| Local name | Three-component SLIM application name |
| Shared secret | Common end-to-end identity secret; minimum 32 characters |
| Delivery mode | Selects unicast/point-to-point or multicast/group |
| Enable MLS | Enables end-to-end MLS for the session created by this browser |
| Remote participant | Unicast destination |
| Multicast channel | Shared group destination |
| Participants to invite | One three-component participant name per line |
| Wait for incoming | Waits for a unicast handshake or multicast invitation |
| Create session | Installs upstream routes, creates the session, and invites group members |
| Close session | Deletes the active session and releases its receive loop |
| Disconnect | Closes an active session when possible, then closes the browser WebSocket |
| Event log | Shows connection, routing, session, invitation, and message events |

## Expected event sequence

For a browser-created multicast session, the browser log should show:

```text
WASM bindings initialized
Connected as org/default/browser
Route to org/default/native-ws installed through the upstream WebSocket
Route to org/default/native-grpc installed through the upstream WebSocket
Outgoing session established (Multicast, MLS)
Inviting org/default/native-ws…
org/default/native-ws joined the multicast session
Inviting org/default/native-grpc…
org/default/native-grpc joined the multicast session
Multicast session ready with 2 invited participants
```

## Cleanup

1. Click **Close session** in the moderator application.
2. Click **Disconnect** in each browser tab.
3. Press `Ctrl-C` in each native participant terminal.
4. Press `Ctrl-C` in the SLIM node terminal.

## Troubleshooting

### `403 Forbidden` for `index_bg.wasm`

Run the included Vite configuration from this example directory. It allows the
symlinked/generated binding directory through Vite's filesystem policy.

### `SlimError.SessionError` while creating a session

Verify that every destination participant:

- connected before session creation;
- is waiting for an incoming session or invitation;
- uses the expected three-component name;
- uses the same shared secret; and
- is connected to the same SLIM node.

### A multicast invitation fails

Confirm that the participant list contains application names such as
`org/default/native-ws`, not instance names such as
`org/default/native-ws/1`. The native process name includes an instance ID, but
routes and invitations target its three-component application name.

### Browser connects but native clients do not

Check that the multi-transport server is listening on both ports and that each
native client uses the matching config:

- `websocket-client-config.yaml` → port 46357;
- `grpc-client-config.yaml` → port 46358.

### HTTPS deployment cannot connect

An HTTPS page must use a `wss://` endpoint. Browsers block insecure `ws://`
connections from secure pages.
