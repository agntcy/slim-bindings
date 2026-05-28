# slimrpc simple example (Python)

Minimal client/server over SLIM using the generated `TestStub` / `TestServicer` stubs.

## Prerequisites

- Rust toolchain, **uv**, and a **SLIM node** listening on **`http://localhost:46357`**
- From the **Python bindings root** (`python`)

## One-time setup

```bash
cd python

# Build and install the native extension (editable)
task python:bindings:build

# Optional dependencies for examples (protobuf, pydantic, etc.)
uv pip install -e '.[examples]'
```

If you change `.proto` or the slimrpc plugin, regenerate types:

```bash
task python:generate-proto
```

(The task installs `protoc-gen-slimrpc-python` from crates.io via `cargo install`.)

## Run

Two terminals, still under `python`:

```bash
uv run slim-bindings-simple-rpc-server
```

```bash
uv run slim-bindings-simple-rpc-client
```

## See also

- [SLIMRPC.md](../../../SLIMRPC.md) — slimrpc concepts and generated API
- [Go slimrpc simple](../../../../go/examples/slimrpc/simple/README.md) — same patterns in Go
