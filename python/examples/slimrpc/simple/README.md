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

(The task installs `protoc-gen-slimrpc-python` from [`slimrpc-compiler`](../../../../slimrpc-compiler)
with `cargo install`, so it ends up on your `PATH` where `buf.gen.yaml` expects it.)

## Run

Two terminals, still under `python`:

```bash
uv run slim-bindings-simple-rpc-server
```

```bash
uv run slim-bindings-simple-rpc-client
```

Both accept `--server <endpoint>` (default: `SLIM_ADDR` or `http://localhost:46357`). The same
can be run with `task examples:rpc:server` and `task python:examples:rpc:client`.

To try the multicast (group) client, start two servers and call both at once (each command
in its own terminal):

```bash
uv run slim-bindings-simple-rpc-server --instance server1
uv run slim-bindings-simple-rpc-server --instance server2
uv run slim-bindings-simple-rpc-client-group --servers server1,server2
```

## See also

- [SLIMRPC.md](../../../SLIMRPC.md) — slimrpc concepts and generated API
- [Go slimrpc simple](../../../../go/examples/slimrpc/simple/README.md) — same patterns in Go
