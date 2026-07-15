# SlimRPC for Node.js / TypeScript

`protoc-gen-slimrpc-node` generates TypeScript client stubs and server handlers
for [slimrpc](https://github.com/agntcy/slim/tree/main/crates/slimrpc-compiler) from Protocol Buffer service definitions. The
generated code runs on the `@agntcy/slim-bindings` runtime (built with
`uniffi-bindgen-react-native`, napi target) and uses
[protobuf-es](https://github.com/bufbuild/protobuf-es) (`@bufbuild/protobuf`,
v2) for message serialization.

It reaches parity with the Python, Go, Java, C#, and Kotlin targets: all four
RPC shapes (unary-unary, unary-stream, stream-unary, stream-stream) plus a
multicast/group client stub.

## Prerequisites

- Node.js ≥ 18 (the bindings are native ESM — use `import`, not `require`).
- [`buf`](https://buf.build/docs/installation) (recommended) or `protoc`.
- The `@agntcy/slim-bindings` package (or a locally generated build under
  `node/generated`).
- `@bufbuild/protobuf` (v2) as a runtime dependency of your project.
- The `protoc-gen-slimrpc-node` plugin on your `PATH`.

## Installation

Install the plugin from crates.io:

```bash
cargo install --locked agntcy-protoc-slimrpc-plugin --bin protoc-gen-slimrpc-node
```

`cargo install` places the binary in `~/.cargo/bin`; make sure that is on your
`PATH`. Alternatively, build from source:

```bash
git clone https://github.com/agntcy/slim
cd slim
cargo build --release -p agntcy-protoc-slimrpc-plugin --bin protoc-gen-slimrpc-node
# binary at target/release/protoc-gen-slimrpc-node
```

## Usage with buf (recommended)

Create a `buf.gen.yaml` next to your `.proto`:

```yaml
version: v2
clean: false
managed:
  enabled: true
inputs:
  - proto_file: example.proto
plugins:
  # Generates <base>_slimrpc.ts (slimrpc stubs).
  - local: protoc-gen-slimrpc-node
    out: types
  # Generates <base>_pb.ts (protobuf-es message types).
  - remote: buf.build/bufbuild/es:v2.12.1
    out: types
    opt:
      - target=ts
      - import_extension=js
```

Then:

```bash
buf generate
```

For `example.proto` this produces, under `types/`:

- `example_pb.ts` — protobuf-es message types and `*Schema` descriptors.
- `example_slimrpc.ts` — the slimrpc client stub, group stub, servicer
  interface, handler adapters, and registration function.

Both files land in the same directory; the slimrpc file imports its message
types from the sibling `./example_pb.js`.

## Usage with protoc (alternative)

```bash
protoc \
  --plugin=protoc-gen-es=./node_modules/.bin/protoc-gen-es \
  --es_out=types --es_opt=target=ts,import_extension=js \
  --plugin=protoc-gen-slimrpc-node=$(which protoc-gen-slimrpc-node) \
  --slimrpc-node_out=types \
  example.proto
```

## Generated code structure

For a `Test` service in package `example_service`, `example_slimrpc.ts`
contains:

### Client stub (point-to-point)

```ts
export class TestClient {
  constructor(_channel: ChannelLike);

  ExampleUnaryUnary(request: ExampleRequest, timeout?: number, metadata?: Map<string, string>): Promise<ExampleResponse>;
  ExampleUnaryStream(request: ExampleRequest, timeout?: number, metadata?: Map<string, string>): AsyncGenerator<ExampleResponse>;
  ExampleStreamUnary(requests: AsyncIterable<ExampleRequest>, timeout?: number, metadata?: Map<string, string>): Promise<ExampleResponse>;
  ExampleStreamStream(requests: AsyncIterable<ExampleRequest>, timeout?: number, metadata?: Map<string, string>): AsyncGenerator<ExampleResponse>;
}
```

Construct it from a `Channel`:

```ts
const channel = slimBindings.Channel.newWithConnection(app, remoteName, connId);
const client = new TestClient(channel);
const reply = await client.ExampleUnaryUnary(request, 5000);
```

### Group (multicast) stub

```ts
export class TestGroupClient {
  constructor(_channel: ChannelLike);
  // Each method yields one { context, response } per responding group member.
  ExampleUnaryUnary(request: ExampleRequest, timeout?: number, metadata?: Map<string, string>):
    AsyncGenerator<{ context: RpcMessageContext; response: ExampleResponse }>;
  // ...unary-stream / stream-unary / stream-stream variants
}
```

Construct it from a group channel:

```ts
const channel = slimBindings.Channel.newGroupWithConnection(app, members, connId);
const group = new TestGroupClient(channel);
for await (const { context, response } of group.ExampleUnaryUnary(request, 5000)) {
  console.log(context.source, response);
}
```

### Server servicer + registration

```ts
export interface TestServicer {
  ExampleUnaryUnary(request: ExampleRequest, context: ContextLike): Promise<ExampleResponse>;
  ExampleUnaryStream(request: ExampleRequest, context: ContextLike): AsyncIterable<ExampleResponse>;
  ExampleStreamUnary(requests: AsyncIterable<ExampleRequest>, context: ContextLike): Promise<ExampleResponse>;
  ExampleStreamStream(requests: AsyncIterable<ExampleRequest>, context: ContextLike): AsyncIterable<ExampleResponse>;
}

export function registerTestServicer(server: ServerLike, servicer: TestServicer): void;
```

Implement the interface and register it:

```ts
class TestService implements TestServicer { /* ... */ }

const server = slimBindings.Server.newWithConnection(app, localName, connId);
registerTestServicer(server, new TestService());
await server.serveAsync();
```

To return a specific gRPC-style status, `throw` an `RpcError`:

```ts
throw new slimBindings.RpcError.Rpc({
  code: slimBindings.RpcCode.Unimplemented,
  message: 'not implemented',
  details: undefined,
});
```

Any other thrown value is mapped to `RpcCode.Internal` by the generated handler.

## Plugin parameters

- `types_import`: override the module specifier the current file's protobuf
  message types (and their `*Schema` companions) are imported from.
  - Example: `types_import=@myorg/generated/example_pb.js`
  - Default: a sibling `./<base>_pb.js` (the `protoc-gen-es` default output).
    Types from *other* proto files are always resolved to their own relative
    `*_pb.js`; well-known `google.protobuf.*` types come from
    `@bufbuild/protobuf/wkt`.

- `bindings_import`: module specifier for the slimrpc runtime.
  - Example: `bindings_import=../../../../generated/index.js`
  - Default: `@agntcy/slim-bindings`.

Pass parameters via `opt:` in `buf.gen.yaml` (one per list item) or as
`--slimrpc-node_opt=key=value` with `protoc`.

## Output file naming

For `example.proto` the plugin emits `example_slimrpc.ts` (parallel to Go's
`_slimrpc.pb.go` and C#'s `_slimrpc.cs`). Directory components of the proto
path are preserved; the base name is kept verbatim (not snake-cased), matching
`protoc-gen-es`'s `_pb.ts` output so the two files sit side by side.

## A note on the bytes boundary

protobuf-es's `toBinary()` returns a `Uint8Array`, while the runtime FFI works
in `ArrayBuffer`. The generated code bridges this at every call site and copies
only when a view does not exactly span its backing buffer, so partial/pooled
buffers are never mis-serialized. You do not need to do anything — it is handled
for you.

## Example

A complete, runnable example lives in
[`examples/slimrpc/simple`](examples/slimrpc/simple): a `server.ts`,
point-to-point `client.ts`, and multicast `client_group.ts` exercising all four
RPC shapes against a running SLIM broker. See its
[README](examples/slimrpc/simple/README.md).

## Troubleshooting

### Plugin not found

`buf` reports it cannot find `protoc-gen-slimrpc-node`:

- Ensure `~/.cargo/bin` (or wherever `cargo install` placed it) is on `PATH`,
  or use an absolute path in `local:`.
- Confirm the binary is executable.

### `BigintExpected` at runtime

Connection ids and other `u64` values are real `bigint`s — never `Number()`.
Pass the `connId` returned by `connectAsync` (converted with `BigInt(...)` if it
arrives as a number) straight through to `Channel.newWithConnection` /
`Server.newWithConnection`.

### Cannot `require()` the package

`@agntcy/slim-bindings` is native ESM (`"type": "module"`). Use `import`, and
set `"type": "module"` (or use `tsx`) in projects that consume it.

### Module resolution for `./example_pb.js`

The generated `import "./example_pb.js"` resolves to the `example_pb.ts`
emitted by `protoc-gen-es`. Use `moduleResolution: "bundler"` (or `nodenext`
with matching emit) and generate with `import_extension=js` so both files agree.
