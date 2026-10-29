# SLIM Go Bindings - Examples

This directory contains Go examples demonstrating SLIM's messaging capabilities.

## Prerequisites

Before running any examples, build the Rust library and generate Go bindings:

```bash
cd go
task generate      # Build the Rust core library (debug by default) and generate Go bindings
```

Set `PROFILE=release` (e.g. `task generate PROFILE=release`) to build the Rust
library in release mode. The `examples:*` tasks below run `task generate` for
you if needed.

## Examples

### 1. Point-to-Point Example

Demonstrates 1:1 messaging between two peers with request/reply pattern.

**Terminal 1 - Server:**
```bash
task examples:server
```

**Terminal 2 - Alice (Receiver):**
```bash
task examples:p2p:alice
```

**Terminal 3 - Bob (Sender):**
```bash
task examples:p2p:no-mls:bob   # or examples:p2p:mls:bob to enable MLS
```

### 2. Group Example

Demonstrates group messaging with moderator-participant pattern and concurrent message handling.

**Terminal 1 - Server:**
```bash
task examples:server
```

**Terminal 2 - Moderator:**
```bash
task examples:group:moderator
```

**Terminal 3 - Alice (Participant):**
```bash
task examples:group:participant:alice
```

**Terminal 4 - Bob (Participant):**
```bash
task examples:group:participant:bob
```

### 3. slimrpc Example

See [slimrpc/simple/README.md](slimrpc/simple/README.md). With the server running
(`task examples:server`), use `task examples:rpc:server`, `task examples:rpc:client`,
and `task examples:rpc:group-client`.

## Available Tasks

View all available tasks:
```bash
task --list
```

## Example Structure

```
examples/
├── common/          # Shared helpers (ID parsing, endpoint, client config, app setup)
├── server/          # SLIM node the other examples connect to
├── point_to_point/  # 1:1 messaging
├── group/           # Group messaging
└── slimrpc/         # slimrpc (protobuf RPC over SLIM)
```

## Customizing Examples

All examples support custom parameters via `CLI_ARGS`:

```bash
# Custom point-to-point IDs
task examples:p2p:no-mls:bob CLI_ARGS="--local=org/sender/app --remote=org/receiver/app"

# Custom group channel
task examples:group:moderator CLI_ARGS="--remote=org/company/meeting"

# Custom server endpoint (host:port)
task examples:server CLI_ARGS="--endpoint=0.0.0.0:46357"
```

The point-to-point and group clients connect to `http://localhost:46357`; pass `--server`
(via `CLI_ARGS`) to change it. `SLIM_ADDR` applies only to the slimrpc examples. Set
`SLIM_CLIENT_CONFIG` to a JSON client config to customize the connection (TLS,
authentication) for the point-to-point and group examples.

## Troubleshooting

**"library not found" errors**: Run `task generate` first  
**"undefined symbols" errors**: Run `task generate` to regenerate bindings  
**Connection failures**: Ensure the server is running with `task examples:server`
