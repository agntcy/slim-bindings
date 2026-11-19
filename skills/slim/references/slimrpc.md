# slimrpc for your own .proto services

Written against `agntcy-protoc-slimrpc-plugin` **3.0.1** (matches slim-bindings 3.x). Use this when the user has their own protobuf service. For A2A, the slim-a2a SDKs ship pre-generated stubs, so the user does not need the compiler.

Full docs: https://docs.agntcy.org/slim/components/sdk/slimrpc/compiler/ and the plugin README in `agntcy/slim-bindings/slimrpc-compiler/README.md` (all options: `types_import`, `paths`, `base_namespace`, …).

## Install the plugins

```bash
cargo install agntcy-protoc-slimrpc-plugin                                   # all six
cargo install agntcy-protoc-slimrpc-plugin --bin protoc-gen-slimrpc-python   # just one
```

Prebuilt Python, Go and C# plugins are attached to `protoc-slimrpc-plugin-v*` releases of `agntcy/slim-bindings`. Keep the plugin major version equal to the slim-bindings major version.

Binaries: `protoc-gen-slimrpc-{python,go,java,kotlin,csharp,node}`. They must be on `PATH`.

**Check the installed version before generating.** The plugins have no `--version` flag; use `cargo install --list | grep -A3 agntcy-protoc-slimrpc-plugin`. Old 1.x/2.x plugins are common on developer machines and generate stubs that don't match slim-bindings 3.x. If the global one is stale and you'd rather not replace it, install into a project-local dir: `cargo install agntcy-protoc-slimrpc-plugin@3.0.1 --bin protoc-gen-slimrpc-python --root ./.tools` and put `./.tools/bin` on `PATH` for `buf generate`.

Python runtime deps for generated code: `slim-bindings` (includes the slimrpc runtime), `protobuf`, and `googleapis-common-protos` (stubs import `google.rpc`). Don't install the PyPI package `slimrpc` — it's the obsolete standalone library.

## buf.gen.yaml (recommended)

Run the slimrpc plugin **alongside** the normal protobuf plugin for the language. It generates only the RPC stubs, not the message types.

```yaml
# Python
version: v2
managed: { enabled: true }
plugins:
  - local: protoc-gen-slimrpc-python
    out: example_service
  - remote: buf.build/protocolbuffers/python:v29.3
    out: example_service
  - remote: buf.build/protocolbuffers/pyi:v31.1
    out: example_service
```

```yaml
# Go
version: v2
managed: { enabled: true }
plugins:
  - remote: buf.build/protocolbuffers/go
    out: types
    opt: [paths=source_relative]
  - local: protoc-gen-slimrpc-go
    out: types
    opt: [paths=source_relative]
```

```yaml
# Node.js / TypeScript
version: v2
managed: { enabled: true }
plugins:
  - local: protoc-gen-slimrpc-node
    out: types
  - remote: buf.build/bufbuild/es:v2.12.1
    out: types
    opt: [target=ts, import_extension=js]
```

```yaml
# Java
version: v2
managed: { enabled: true }
plugins:
  - remote: buf.build/protocolbuffers/java
    out: src/main/java
  - local: protoc-gen-slimrpc-java
    out: src/main/java
```

```yaml
# .NET
version: v2
managed: { enabled: true }
plugins:
  - remote: buf.build/protocolbuffers/csharp
    out: Generated
    opt: base_namespace=ExampleService
  - local: protoc-gen-slimrpc-csharp
    out: Generated
    opt: base_namespace=ExampleService,types_namespace=ExampleService
```

Kotlin needs the java + kotlin protobuf plugins plus `protoc-gen-slimrpc-kotlin`; see the official compiler page.

Then `buf generate`. With plain protoc: `protoc --slimrpc-python_out=out --python_out=out example.proto` (swap the language).

**Python gotcha:** don't name the output package `types` — it shadows the standard-library `types` module.

**Reusing types generated elsewhere** (e.g. `a2a-sdk` already ships `a2a_pb2`): pass `types_import` so stubs import those instead of regenerating. Example from slim-a2a-python: `opt: ['types_import=from a2a.types import a2a_pb2 as a2a__pb2']`.

## What gets generated

- a client stub that calls a remote server through a slimrpc `Channel`
- a server interface/servicer to implement
- a registration function (Python: `add_<Service>Servicer_to_server(servicer, server)`)

## Wiring it up (shape is the same in every language)

Server: initialize the SLIM service → create an app with name + identity → connect to the node → `Server` bound to that app/name/connection → register servicer → serve.

Client: same app setup with a *different* name → create a `Channel` to the server's three-part name → wrap in the generated stub → call methods.

Multicast: a group channel created with a list of server names fans out one call and returns a stream of `(context, response)`.

Per-language tutorials with full code: https://docs.agntcy.org/slim/components/sdk/tutorials/slimrpc/tutorial-serve/ , `tutorial-client/`, `tutorial-multicast/`. Python examples: `agntcy/slim-bindings/python/examples/slimrpc/`.
