# SLIM Python Bindings (UniFFI)

Python bindings for SLIM (Secure Low-Latency Interactive Messaging) using UniFFI.

This provides a Python interface to the SLIM data plane, enabling secure,
low-latency messaging with support for point-to-point and group
(multicast) communication patterns.

## Overview

These Python bindings are generated from the `agntcy-slim-bindings-ffi` crate
using [UniFFI](https://mozilla.github.io/uniffi-rs/), providing a native
Python interface that wraps the high-performance Rust implementation.

### Key Features

- **Point-to-Point Messaging**: Direct communication between two endpoints
- **Group Messaging**: Multicast communication with multiple participants
- **Secure by Default**: Support for TLS, mTLS, and various authentication methods
- **MLS Encryption**: End-to-end encryption for sessions
- **Delivery Confirmation**: Optional completion handles for reliable messaging
- **Flexible Authentication**: Shared secrets, JWT, SPIRE for app identity; Basic, JWT, SPIRE,
  and [OIDC](#transport-authentication-grpc-connection) for the gRPC transport
- **slimrpc Support**: Protocol Buffers RPC over SLIM - see [SLIMRPC.md](SLIMRPC.md) for details

## Architecture

The Python bindings are built using Maturin, which compiles the Rust FFI crate
and generates the Python bindings from its UniFFI metadata:

```
slim-bindings/
├── rust/          # agntcy-slim-bindings-ffi: cdylib that re-exports the UniFFI
│   ├── src/lib.rs #   scaffolding of agntcy-slim-bindings and agntcy-slim-rpc
│   └── Cargo.toml #   (the FFI surface itself lives in agntcy/slim, crates/slim-bindings and crates/rpc)
└── python/        # Python-specific bindings and examples (this directory)
    ├── slim_bindings/         # Python package (generated module + helpers)
    ├── examples/              # Example applications
    ├── tests/                 # Pytest test suite
    ├── pyproject.toml         # Package configuration (Maturin build system)
    └── Taskfile.yaml          # Build and development tasks
```

## Prerequisites

- **Rust toolchain** (recent stable, 1.88+; the SLIM crates use edition 2024 and let-chains)
- **Python** (3.10+)
- **uv** (Python package manager): https://docs.astral.sh/uv/
- **Task** (optional, for convenient build commands)

## Installation

### From PyPI

```bash
pip install slim-bindings
```

### Development Build

```bash
cd python
task python:bindings:build
```

This will:
1. Install all dependencies
2. Compile the Rust UniFFI adapter
3. Generate Python bindings using Maturin
4. Install the package in development mode

## Creating Distribution Packages

### Build Wheels

To create distributable wheel packages (Python 3.10, 3.11, 3.12, 3.13 and 3.14):

```bash
task python:bindings:packaging
```

Or directly with Maturin:

```bash
uv run maturin build --release
```

Maturin automatically:
1. Compiles the Rust UniFFI adapter library
2. Generates Python bindings from UniFFI scaffolding
3. Bundles the native library into a platform-specific wheel

UniFFI wheels do not link against the Python C API, so a single `py3-none-<platform>`
wheel works on every supported Python version.

#### Custom Build Options

You can customize the build with the following variables:

```bash
# Build for a specific target architecture
task python:bindings:packaging TARGET=aarch64-apple-darwin

# Build in debug mode (default is release)
task python:bindings:packaging PROFILE=debug

# Cross-compile for Linux on macOS
task python:bindings:packaging TARGET=x86_64-unknown-linux-gnu
```

#### Output Structure

After running the packaging task, you'll find one wheel per platform:

```
dist/
└── slim_bindings-<version>-py3-none-<platform>.whl   # e.g. ...-py3-none-macosx_11_0_arm64.whl
```

Note: The native library is automatically bundled inside the wheel.

#### Installing from Wheel

Users can install the wheel package directly:

```bash
pip install dist/slim_bindings-<version>-py3-none-<platform>.whl
```

The native library is automatically included in the wheel and will be loaded at runtime.

## Quick Start

The bindings expose both blocking methods and asyncio `*_async` variants. The examples use
the async API:

```python
import asyncio
import datetime

import slim_bindings


async def main():
    # Initialize the runtime, tracing and the global service
    slim_bindings.initialize_with_defaults()
    print(f"SLIM Version: {slim_bindings.get_version()}")

    service = slim_bindings.get_global_service()

    # Connect to a SLIM node
    client_config = slim_bindings.new_insecure_client_config("http://127.0.0.1:46357")
    conn_id = await service.connect_async(client_config)

    # Create an app with shared secret authentication (secret must be >= 32 bytes)
    local_name = slim_bindings.Name("org", "example", "alice")
    app = service.create_app_with_secret(
        local_name, "my_shared_secret_for_testing_purposes_only"
    )
    await app.subscribe_async(local_name, conn_id)

    print(f"App ID: {app.id()}")
    print(f"App Name: {app.name()}")


asyncio.run(main())
```

## Examples

The examples live in the [`examples/`](https://github.com/agntcy/slim-bindings/tree/main/python/examples) package and are installed as console scripts
(`slim-bindings-server`, `slim-bindings-p2p`, `slim-bindings-group`, and the slimrpc ones; see
`[project.scripts]` in [pyproject.toml](https://github.com/agntcy/slim-bindings/blob/main/python/pyproject.toml)). Install them with:

```bash
cd python
task python:build    # builds the bindings and installs the [examples] extras
```

```
examples/
├── common.py           # Shared helpers (service setup, app creation, CLI options)
├── config.py           # Configuration models (CLI / env / config file)
├── slim.py             # SLIM node (server) example
├── point_to_point.py   # P2P messaging
├── group.py            # Group/multicast messaging
└── slimrpc/simple/     # slimrpc example, see its README.md
```

### Running Examples

All examples require a running SLIM node. Start one with:

```bash
cd python
task examples:server
```

### Point-to-Point Communication

**Terminal 1 - Receiver (Alice):**
```bash
task examples:p2p:alice
```

**Terminal 2 - Sender (Bob):**
```bash
task examples:p2p:no-mls:bob   # or examples:p2p:mls:bob for MLS-encrypted messages
```

### Group Communication

**Terminal 1 - Participant 1:**
```bash
task examples:group:client-1
```

**Terminal 2 - Participant 2:**
```bash
task examples:group:client-2
```

**Terminal 3 - Moderator:**
```bash
task examples:group:moderator
```

### slimrpc

```bash
task examples:rpc:server          # Terminal 1
task python:examples:rpc:client   # Terminal 2
```

See [examples/slimrpc/simple/README.md](https://github.com/agntcy/slim-bindings/blob/main/python/examples/slimrpc/simple/README.md) for details.

## Transport Authentication (gRPC connection)

Separate from the app identity set at `create_app_*` time, the gRPC connection to a SLIM node
can carry its own credentials via `ClientConfig.auth` (and `ServerConfig.auth` when hosting).
Supported modes are `BASIC`, `STATIC_JWT`, `JWT`, `SPIRE`, and `OIDC`.

**OIDC**, client side (client-credentials flow):

```python
import datetime
import slim_bindings

oidc = slim_bindings.OidcConfig(
    issuer_url="https://auth.example.com",
    client_id="my-client",
    client_secret="s3cr3t",
    audience=None,
    refresh_token=None,
    refresh_token_file=None,
    access_token_file=None,
    scope="openid profile",
    timeout=datetime.timedelta(seconds=30),
    jwks_ttl=None,
    claim_cache_ttl=None,
    policy=None,
)

base = slim_bindings.new_insecure_client_config("http://127.0.0.1:46357")
client_config = slim_bindings.ClientConfig(
    **{**vars(base), "auth": slim_bindings.ClientAuthenticationConfig.OIDC(config=oidc)}
)
conn_id = await service.connect_async(client_config)
```

For the refresh-token flow set `refresh_token` (or `refresh_token_file`, which is rewritten in
place as tokens rotate) instead of `client_secret`.

**Server side**, verifying incoming JWTs against the issuer's JWKS endpoint, optionally
restricting access by claim:

```python
oidc = slim_bindings.OidcConfig(
    issuer_url="https://auth.example.com",
    client_id=None,
    client_secret=None,
    audience="slim",                                   # required for verification
    refresh_token=None,
    refresh_token_file=None,
    access_token_file=None,
    scope=None,
    timeout=None,
    jwks_ttl=datetime.timedelta(hours=1),
    claim_cache_ttl=datetime.timedelta(minutes=1),
    policy=slim_bindings.OidcPolicyConfig.CEL(expression='"admin" in claims.groups'),
)

base = slim_bindings.new_insecure_server_config("127.0.0.1:46357")
server_config = slim_bindings.ServerConfig(
    **{**vars(base), "auth": slim_bindings.ServerAuthenticationConfig.OIDC(config=oidc)}
)
```

`policy` accepts `OidcPolicyConfig.CEL(expression=...)`, `OidcPolicyConfig.REGO(text=...)` (which
must define `package slim.auth` with `default allow = false`), or
`OidcPolicyConfig.REGO_FILE(path=...)`. Client-only fields (`scope`, `timeout`) and server-only
fields (`jwks_ttl`, `claim_cache_ttl`, `policy`) are ignored by the other side.

**From a config file** — the examples read `SLIM_CLIENT_CONFIG` (or `--slim-config <path>`),
which covers every auth mode plus TLS material and backoff without any code change:

```json
{
  "endpoint": "http://127.0.0.1:46357",
  "tls": { "insecure": true },
  "auth": {
    "type": "oidc",
    "issuer_url": "https://auth.example.com",
    "client_id": "my-client",
    "client_secret": "s3cr3t",
    "audience": "slim",
    "policy": { "cel": "\"admin\" in claims.groups" }
  }
}
```

The client configuration format is described by
[`crates/config/src/schema/client-config.schema.json`](https://github.com/agntcy/slim/blob/main/crates/config/src/schema/client-config.schema.json)
in the [slim](https://github.com/agntcy/slim) repo. To load one yourself, call
`slim_bindings.new_config_from_json(json_text)`.

## API Overview

Most blocking methods below have an `*_async` counterpart (e.g. `connect` / `connect_async`);
`disconnect` and simple accessors such as `app.id()` / `app.name()` are blocking only.
Timeouts are `datetime.timedelta` values; `None` waits forever.

### Initialization and Service

```python
slim_bindings.initialize_with_defaults()     # or initialize_with_configs(...) / initialize_from_config(path)
service = slim_bindings.get_global_service()

# Connect to a SLIM node
conn_id = service.connect(slim_bindings.new_insecure_client_config("http://localhost:46357"))

# Host a SLIM endpoint in-process
service.run_server(slim_bindings.new_insecure_server_config("127.0.0.1:46357"))

# Disconnect
service.disconnect(conn_id)
```

### Application Creation

```python
name = slim_bindings.Name("org", "example", "app")    # or Name.from_string("org/example/app")

# Shared secret identity (secret must be at least 32 bytes)
app = service.create_app_with_secret(name, shared_secret)

# JWT / SPIRE identity
app = service.create_app(name, provider_config, verifier_config)

app_id = app.id()
app_name = app.name()
app.subscribe(name, conn_id)
app.set_route(remote_name, conn_id)
```

### Session Management

```python
session_config = slim_bindings.SessionConfig(
    session_type=slim_bindings.SessionType.POINT_TO_POINT,  # or SessionType.GROUP
    max_retries=5,
    interval=datetime.timedelta(seconds=5),
    metadata={},
    mls_settings=None,  # or slim_bindings.MlsSettings(...) to enable MLS
)

# Create session: returns a SessionWithCompletion
session_context = app.create_session(session_config, remote_name)
session_context.completion.wait()       # wait until the session is established
session = session_context.session
# or: session = app.create_session_and_wait(session_config, remote_name)

# Listen for an incoming session
session = app.listen_for_session(timeout=datetime.timedelta(seconds=30))

# Delete session
app.delete_session(session).wait()
```

### Messaging

```python
# Send message: returns a CompletionHandle
completion = session.publish(data, "text/plain", metadata)
completion.wait()  # Block until delivered (optional)
# or: session.publish_and_wait(data, "text/plain", metadata)

# Receive message
msg = session.get_message(timeout=datetime.timedelta(seconds=5))
print(f"Payload: {msg.payload}")
print(f"From: {msg.context.source_name}")
print(f"Type: {msg.context.payload_type}")

# Reply to message
session.publish_to(msg.context, reply_data, "text/plain", None)
```

### Group Operations

```python
# Invite participant to group
session.invite(participant_name).wait()

# Remove participant
session.remove(participant_name).wait()
```

## Testing

The test suite starts its own in-process SLIM endpoints, so no external server is needed:

```bash
task test
# or a single file
task test TESTS=tests/test_point_to_point.py
# or directly
uv run pytest -s tests/
```

## Development

### Available Tasks

```bash
task                           # List tasks
task python:bindings:build     # Build and install in development mode (alias: generate)
task python:build              # Build and install the examples extras
task test                      # Run tests
task lint                      # Lint (ruff, mypy)
task python:bindings:packaging # Build wheels with Maturin (alias: build)
task python:generate-proto     # Regenerate the slimrpc example code
task clean                     # Clean build artifacts
```

### Project Structure

- `slim_bindings/` - Python package (bindings generated by Maturin plus `uniffi_set_event_loop` helper)
- `examples/` - Example applications
- `tests/` - Pytest test suite
- `Taskfile.yaml` - Build automation
- `pyproject.toml` - Package configuration (Maturin build system)

## Comparison with Go Bindings

Both Python and Go bindings use the same UniFFI adapter, ensuring API consistency:

| Feature | Python | Go |
|---------|--------|-----|
| Binding Generation | maturin + uniffi-bindgen | uniffi-bindgen-go |
| API Style | Pythonic (snake_case) | Idiomatic Go (PascalCase) |
| Error Handling | Exceptions | Error returns |
| Async Support | Blocking methods plus asyncio `*_async` methods | Blocking methods plus `*Async` variants |
| Examples | ✅ | ✅ |
| Tests | ✅ | ✅ |

## API Reference

### Core Types

- **`Name`**: Application/service identifier (three components, optional ID)
- **`SessionConfig`**: Configuration for creating sessions
- **`MlsSettings`**: MLS options for a session
- **`TlsClientConfig`** / **`TlsServerConfig`**: TLS settings for secure connections
- **`ServerConfig`**: Server endpoint and TLS configuration
- **`ClientConfig`**: Client endpoint and TLS configuration
- **`MessageContext`**: Message metadata (source, destination, type, metadata)
- **`ReceivedMessage`**: Received message with context and payload

### Main Classes

- **`Service`**: Connections, servers and app creation
- **`App`**: Main app interface for session management
- **`Session`**: Session interface for messaging
- **`CompletionHandle`**: Completion handle for delivery confirmation
- **`SessionWithCompletion`**: A new session plus its establishment `CompletionHandle`

### Session Types

- **`SessionType.POINT_TO_POINT`**: Direct one-to-one communication
- **`SessionType.GROUP`**: One-to-many multicast communication

## Troubleshooting

### ImportError: Cannot find slim_bindings

Make sure you've built and installed the package:
```bash
task python:bindings:build
# or
uv run maturin develop --uv
```

### Connection Refused

Ensure the SLIM node is running:
```bash
task examples:server
```

### Build Errors

If you encounter build errors, try cleaning and rebuilding:
```bash
task clean
task python:bindings:build
```

## Contributing

When contributing to the Python bindings:

1. Maintain API consistency with Go bindings
2. Follow Python naming conventions (snake_case)
3. Add tests for new functionality
4. Update examples if adding features
5. Keep documentation up to date

## License

Apache-2.0 - See [LICENSE](https://github.com/agntcy/slim-bindings/blob/main/LICENSE) for details

## See Also

- [slimrpc Documentation](SLIMRPC.md) - Protocol Buffers RPC over SLIM
- [Go Bindings](https://github.com/agntcy/slim-bindings/blob/main/go/slim_bindings/README.md)
- [SLIM Documentation](https://docs.agntcy.org/slim/overview)
