# Slim RPC Compiler

The Slim RPC Compiler is a collection of protoc plugins that generate client
stubs and server handlers for slimrpc from Protocol Buffer service definitions.
These plugins enable you to build high-performance RPC services using the
slimrpc framework.

## Supported Languages

- **Python**: `protoc-gen-slimrpc-python`
- **Go**: `protoc-gen-slimrpc-go`
- **Java**: `protoc-gen-slimrpc-java`
- **C#**: `protoc-gen-slimrpc-csharp`
- **Kotlin**: `protoc-gen-slimrpc-kotlin`
- **TypeScript / Node.js**: `protoc-gen-slimrpc-node`

## Features

- Generates type-safe client stubs and server handlers for slimrpc services
- Supports all gRPC streaming patterns: unary-unary, unary-stream, stream-unary,
  and stream-stream
- Compatible with both `protoc` and `buf` build systems (buf recommended)
- Automatic import resolution for Protocol Buffer dependencies

## Installation

### Install from crates.io

The plugins are published as the `agntcy-protoc-slimrpc-plugin` crate. This
installs all of them into Cargo's bin directory (usually `~/.cargo/bin`, which
should be on your `PATH`):

```bash
cargo install agntcy-protoc-slimrpc-plugin
```

To install a single plugin, add `--bin`, e.g.
`cargo install agntcy-protoc-slimrpc-plugin --bin protoc-gen-slimrpc-go`.

### Download a Prebuilt Binary

Prebuilt binaries of the Python, Go, and C# plugins for Linux, macOS, and
Windows (x86_64 and arm64) are attached to the `protoc-slimrpc-plugin-v*`
[releases](https://github.com/agntcy/slim-bindings/releases) of this
repository. For the Java, Kotlin, and Node plugins, use `cargo install` or
build from source.

### Compile from Source

1. Clone the repository:

```bash
git clone https://github.com/agntcy/slim-bindings.git
cd slim-bindings/slimrpc-compiler
```

2. Build the plugins:

```bash
cargo build --release
```

3. The compiled binaries will be available at:
   - `target/release/protoc-gen-slimrpc-python`
   - `target/release/protoc-gen-slimrpc-go`
   - `target/release/protoc-gen-slimrpc-java`
   - `target/release/protoc-gen-slimrpc-csharp`
   - `target/release/protoc-gen-slimrpc-kotlin`
   - `target/release/protoc-gen-slimrpc-node`

## Usage

The recommended way to use the slimrpc compiler is through `buf`. The Python,
Go, Java, C#, and TypeScript/Node examples all use this approach.

### Using with buf (Recommended)

#### Prerequisites

- `buf` CLI installed
- Compiled slimrpc plugins (see Installation above)

#### Python Example

Create a `buf.gen.yaml` file in your project:

```yaml
version: v2
managed:
  enabled: true
inputs:
  - proto_file: example.proto
plugins:
  # Generate slimrpc stubs
  - local: /path/to/target/release/protoc-gen-slimrpc-python
    out: types
  # Generate standard protobuf code
  - remote: buf.build/protocolbuffers/python:v29.3
    out: types
  # Generate type stubs
  - remote: buf.build/protocolbuffers/pyi:v31.1
    out: types
```

#### Go Example

Create a `buf.gen.yaml` file in your project:

```yaml
version: v2
managed:
  enabled: true
plugins:
  # Generate standard .pb.go files
  - remote: buf.build/protocolbuffers/go
    out: types
    opt:
      - paths=source_relative
  # Generate slimrpc stubs
  - local: /path/to/target/release/protoc-gen-slimrpc-go
    out: types
    opt:
      - paths=source_relative
```

#### Java Example

Create a `buf.gen.yaml` file in your project:

```yaml
version: v2
clean: true
managed:
  enabled: true
  override:
    - file_option: java_package_prefix
      value: com
inputs:
  - proto_file: example.proto
plugins:
  # Generate standard protobuf Java classes
  - remote: buf.build/protocolbuffers/java:v29.3
    out: types
  # Generate slimrpc stubs
  - local: /path/to/target/release/protoc-gen-slimrpc-java
    out: slimrpc
```

#### C# Example

Create a `buf.gen.yaml` file in your project:

```yaml
version: v2
managed:
  enabled: true
plugins:
  # Generate standard .pb.cs files
  - remote: buf.build/protocolbuffers/csharp
    out: Generated
    opt: base_namespace=MyApp.Types
  # Generate slimrpc stubs
  - local: /path/to/target/release/protoc-gen-slimrpc-csharp
    out: Generated
    opt: base_namespace=MyApp.Types,types_namespace=MyApp.Types
```

**Output file naming**: For `example.proto`, the C# plugin generates `example_slimrpc.cs` (alongside the standard protobuf `Example.cs` from the csharp plugin).

#### TypeScript / Node.js Example

Create a `buf.gen.yaml` file in your project:

```yaml
version: v2
clean: false
managed:
  enabled: true
inputs:
  - proto_file: example.proto
plugins:
  # Generate slimrpc stubs (example_slimrpc.ts)
  - local: protoc-gen-slimrpc-node
    out: types
  # Generate protobuf-es message types (example_pb.ts)
  - remote: buf.build/bufbuild/es:v2.12.1
    out: types
    opt:
      - target=ts
      - import_extension=js
```

**Output file naming**: For `example.proto`, the node plugin generates `example_slimrpc.ts` (alongside the protobuf-es `example_pb.ts` from the `es` plugin). The generated stubs target the `@agntcy/slim-bindings` runtime and `@bufbuild/protobuf` (protobuf-es v2). See [`node/SLIMRPC.md`](https://github.com/agntcy/slim-bindings/blob/main/node/SLIMRPC.md) for the full reference.

#### Generate Code

```bash
buf generate
```

This will generate:
- **Python**: `*_pb2.py` (protobuf types) and `*_pb2_slimrpc.py` (slimrpc stubs)
- **Go**: `*.pb.go` (protobuf types) and `*_slimrpc.pb.go` (slimrpc stubs)
- **Java**: Standard protobuf Java classes and `*Slimrpc.java` (slimrpc stubs)
- **C#**: `*.cs` (protobuf types from csharp plugin) and `*_slimrpc.cs` (slimrpc stubs)
- **TypeScript/Node**: `*_pb.ts` (protobuf-es types) and `*_slimrpc.ts` (slimrpc stubs)

### Using with protoc (Alternative)

If you prefer to use `protoc` directly:

#### Python

```bash
protoc \
  --python_out=. \
  --pyi_out=. \
  --plugin=protoc-gen-slimrpc-python=/path/to/protoc-gen-slimrpc-python \
  --slimrpc-python_out=. \
  example.proto
```

#### Go

```bash
protoc \
  --go_out=. \
  --plugin=protoc-gen-slimrpc-go=/path/to/protoc-gen-slimrpc-go \
  --slimrpc-go_out=. \
  example.proto
```

#### Java

```bash
protoc \
  --java_out=. \
  --plugin=protoc-gen-slimrpc-java=/path/to/protoc-gen-slimrpc-java \
  --slimrpc-java_out=. \
  example.proto
```

#### C#

```bash
protoc \
  --csharp_out=Generated \
  --plugin=protoc-gen-slimrpc-csharp=/path/to/protoc-gen-slimrpc-csharp \
  --slimrpc-csharp_out=Generated \
  example.proto
```

#### TypeScript / Node.js

```bash
protoc \
  --plugin=protoc-gen-es=./node_modules/.bin/protoc-gen-es \
  --es_out=types --es_opt=target=ts,import_extension=js \
  --plugin=protoc-gen-slimrpc-node=/path/to/protoc-gen-slimrpc-node \
  --slimrpc-node_out=types \
  example.proto
```

## Generated Code Structure

### Python

For a service definition, the generated `*_pb2_slimrpc.py` contains:

#### Client Stub

```python
class TestStub:
    """Client stub for Test."""

    def __init__(self, channel):
        self._channel = channel  # a slim_bindings.Channel

    async def ExampleUnaryUnary(
        self,
        request: pb2.ExampleRequest,
        timeout: Optional[timedelta] = None,
        metadata: Optional[dict[str, str]] = None,
    ) -> pb2.ExampleResponse:
        """Call ExampleUnaryUnary method."""
        # Implementation handles serialization and channel communication
```

A `TestGroupStub` with the same methods is generated for multicast calls over a
channel created with `Channel.new_group*`; its methods are async generators
that yield one `(context, response)` pair per responding server.

#### Servicer

Subclass the servicer and override its methods with `async def`
implementations. Methods you don't override raise
`slim_bindings.RpcError.Rpc(code=slim_bindings.RpcCode.UNIMPLEMENTED, ...)`.

```python
class TestServicer:
    """Server servicer for Test. Implement this class to provide your service logic."""

    def ExampleUnaryUnary(self, request, context):
        # `context` is a slim_bindings.Context
        ...
```

#### Registration Function

```python
def add_TestServicer_to_server(servicer, server: slim_bindings.Server):
    """Register Test service handlers with the server."""
    # Registers all service methods
```

### Go

For a service definition, the generated `*_slimrpc.pb.go` contains:

#### Client Interface

```go
type TestClient interface {
    ExampleUnaryUnary(ctx context.Context, req *ExampleRequest) (*ExampleResponse, error)
    ExampleUnaryStream(ctx context.Context, req *ExampleRequest) (slim_rpc.ResponseStream[*ExampleResponse], error)
    ExampleStreamUnary(ctx context.Context) (slim_rpc.ClientRequestStream[*ExampleRequest, *ExampleResponse], error)
    ExampleStreamStream(ctx context.Context) (slim_rpc.ClientBidiStream[*ExampleRequest, *ExampleResponse], error)
}

func NewTestClient(channel slim_rpc.ChannelInterface) TestClient
```

A `TestGroupClient` (created with `NewTestGroupClient`) is also generated for
multicast calls; its methods return `slim_rpc.MulticastResponseStream` or
`slim_rpc.MulticastClientBidiStream`.

#### Server Interface

```go
type TestServer interface {
    ExampleUnaryUnary(ctx context.Context, req *ExampleRequest) (*ExampleResponse, error)
    ExampleUnaryStream(ctx context.Context, req *ExampleRequest, stream slim_rpc.ServerStream[*ExampleResponse]) error
    ExampleStreamUnary(ctx context.Context, stream slim_rpc.ResponseStream[*ExampleRequest]) (*ExampleResponse, error)
    ExampleStreamStream(ctx context.Context, stream slim_rpc.ServerBidiStream[*ExampleRequest, *ExampleResponse]) error
}
```

Embed `UnimplementedTestServer` in your implementation for forward compatibility.

#### Registration Function

```go
func RegisterTestServer(server slim_rpc.ServerInterface, impl TestServer) {
    // Registers all service methods with type-safe handlers
}
```

### Java

For a service definition, the generated `*Slimrpc.java` contains:

#### Client Interface

```java
public interface TestClient {
    ExampleResponse ExampleUnaryUnary(ExampleRequest request, Duration timeout, Map<String, String> metadata) throws RpcException;
    ResponseStreamReader ExampleUnaryStream(ExampleRequest request, Duration timeout, Map<String, String> metadata) throws RpcException;
    ClientRequestStream<ExampleRequest, ExampleResponse> ExampleStreamUnary(Duration timeout, Map<String, String> metadata) throws RpcException;
    ClientBidiStream<ExampleRequest> ExampleStreamStream(Duration timeout, Map<String, String> metadata) throws RpcException;
}
```

#### Server Interface

```java
public interface TestServer {
    CompletableFuture<ExampleResponse> ExampleUnaryUnary(ExampleRequest request, Context context);
    CompletableFuture<Void> ExampleUnaryStream(ExampleRequest request, Context context, ResponseSink sink);
    CompletableFuture<ExampleResponse> ExampleStreamUnary(RequestStream stream, Context context);
    CompletableFuture<Void> ExampleStreamStream(RequestStream stream, Context context, ResponseSink sink);
}
```

#### Registration Function

```java
public static void registerTestServer(Server server, TestServer impl) {
    // Registers all service methods with type-safe handlers
}
```

### C#

For a service definition, the generated `*_slimrpc.cs` contains:

#### Client Stub

```csharp
public sealed class TestClient
{
    private readonly Channel _channel;

    public TestClient(Channel channel) => _channel = channel;

    public async Task<ExampleResponse> ExampleUnaryUnaryAsync(ExampleRequest request, ...) { ... }
    public async IAsyncEnumerable<ExampleResponse> ExampleUnaryStreamAsync(ExampleRequest request, ...) { ... }
    public async Task<ExampleResponse> ExampleStreamUnaryAsync(IAsyncEnumerable<ExampleRequest> requestStream, ...) { ... }
    public async IAsyncEnumerable<ExampleResponse> ExampleStreamStreamAsync(IAsyncEnumerable<ExampleRequest> requestStream, ...) { ... }
}
```

#### Server Interface

```csharp
public interface ITestServer
{
    Task<ExampleResponse> ExampleUnaryUnary(ExampleRequest request, SlimRpcContext context);
    IAsyncEnumerable<ExampleResponse> ExampleUnaryStream(ExampleRequest request, SlimRpcContext context);
    Task<ExampleResponse> ExampleStreamUnary(IAsyncEnumerable<ExampleRequest> requestStream, SlimRpcContext context);
    IAsyncEnumerable<ExampleResponse> ExampleStreamStream(IAsyncEnumerable<ExampleRequest> requestStream, SlimRpcContext context);
}
```

#### Registration

```csharp
TestServerRegistration.RegisterTestServer(server, impl);
```

### TypeScript / Node.js

For a service definition, the generated `*_slimrpc.ts` contains:

#### Client Stub

```ts
export class TestClient {
  constructor(_channel: ChannelLike);
  ExampleUnaryUnary(request: ExampleRequest, timeout?: number, metadata?: Map<string, string>): Promise<ExampleResponse>;
  ExampleUnaryStream(request: ExampleRequest, timeout?: number, metadata?: Map<string, string>): AsyncGenerator<ExampleResponse>;
  ExampleStreamUnary(requests: AsyncIterable<ExampleRequest>, timeout?: number, metadata?: Map<string, string>): Promise<ExampleResponse>;
  ExampleStreamStream(requests: AsyncIterable<ExampleRequest>, timeout?: number, metadata?: Map<string, string>): AsyncGenerator<ExampleResponse>;
}

// Multicast/group variant: each method yields one { context, response } per member.
export class TestGroupClient { /* ... */ }
```

#### Server Servicer

```ts
export interface TestServicer {
  ExampleUnaryUnary(request: ExampleRequest, context: ContextLike): Promise<ExampleResponse>;
  ExampleUnaryStream(request: ExampleRequest, context: ContextLike): AsyncIterable<ExampleResponse>;
  ExampleStreamUnary(requests: AsyncIterable<ExampleRequest>, context: ContextLike): Promise<ExampleResponse>;
  ExampleStreamStream(requests: AsyncIterable<ExampleRequest>, context: ContextLike): AsyncIterable<ExampleResponse>;
}
```

#### Registration Function

```ts
export function registerTestServicer(server: ServerLike, servicer: TestServicer): void;
```

## Examples

Complete working examples are available in the
[slim-bindings](https://github.com/agntcy/slim-bindings) repository:

- **Python**: [`python/examples/slimrpc/simple`](https://github.com/agntcy/slim-bindings/tree/main/python/examples/slimrpc/simple)
- **Go**: [`go/examples/slimrpc/simple`](https://github.com/agntcy/slim-bindings/tree/main/go/examples/slimrpc/simple)
- **Java**: [`java/examples/slimrpc/simple`](https://github.com/agntcy/slim-bindings/tree/main/java/examples/slimrpc/simple)
- **C#**: [`dotnet/Slim.Examples.SlimRpc`](https://github.com/agntcy/slim-bindings/tree/main/dotnet/Slim.Examples.SlimRpc)
- **TypeScript/Node**: [`node/examples/slimrpc/simple`](https://github.com/agntcy/slim-bindings/tree/main/node/examples/slimrpc/simple)

All examples demonstrate all four RPC patterns with comprehensive client and
server implementations.

### Running Examples

All slimrpc examples require a **running SLIM server** (default: `localhost:46357`).
Start it before running any example:

```bash
# from a checkout of https://github.com/agntcy/slim
cargo run --bin slim -- --config ./config/base/server-config.yaml
```

## Plugin Parameters

### Python Plugin

- `types_import`: Customize how protobuf types are imported
  - Example: `types_import="from my_package import types_pb2 as pb2"`
  - Default: Uses local import based on the proto file name

### Go Plugin

- `paths`: Control output path strategy (handled by buf/protoc, ignored by plugin)
  - `source_relative`: Generate files relative to the proto file location

- `types_import`: Go import path for the protobuf-generated types package.
  Required when the generated slimrpc file lives in a different package than
  the proto types.
  - Example: `types_import=github.com/myorg/myrepo/types`
  - Default: not set (types are used as bare unqualified names, requires same package)

- `types_alias`: Optional Go package alias to use when referencing proto types.
  Only valid when `types_import` is also set.
  - Example: `types_alias=pb`
  - Default: last path component of `types_import` (e.g., `"types"` for `.../types`)

### C# Plugin

- `base_namespace`: C# namespace for generated code.
  - Example: `base_namespace=MyApp.Types`
  - Default: derived from proto `package`

- `types_namespace`: C# namespace for resolving protobuf types (when different from base).
  - Example: `types_namespace=MyApp.Types`
  - Default: same as base_namespace

### TypeScript / Node Plugin

- `types_import`: Override the module specifier for the current file's protobuf
  message types (and their `*Schema` companions).
  - Example: `types_import=@myorg/generated/example_pb.js`
  - Default: a sibling `./<base>_pb.js` (the `protoc-gen-es` default output).
    Cross-file types resolve to their own relative `*_pb.js`; `google.protobuf.*`
    well-known types come from `@bufbuild/protobuf/wkt`.

- `bindings_import`: Module specifier for the slimrpc runtime.
  - Example: `bindings_import=../../../../generated/index.js`
  - Default: `@agntcy/slim-bindings`

## Troubleshooting

### Plugin Not Found

If you get an error that the plugin is not found:

- Ensure the plugin binary is in your PATH or use full path in `buf.gen.yaml`
- Check that the binary is executable: `chmod +x /path/to/protoc-gen-slimrpc-*`

### Import Errors

If you encounter import errors:

- Make sure the generated files are in your module path
- For Python: Verify the `types_import` parameter matches your project structure
- For Go: Ensure `go.mod` is properly configured with correct module paths
- For Java: Ensure the `java_package` option (or `buf` managed `java_package_prefix`)
  produces a package that matches your project layout

### Build Errors

If the plugin fails to build:

- Ensure you have Rust and Cargo installed (latest stable version)
- Check that all dependencies are available
- Try cleaning and rebuilding: `cargo clean && cargo build --release`

## Contributing

Please see the main repository's contributing guidelines at
[CONTRIBUTING.md](../CONTRIBUTING.md).

## License

This project is licensed under the Apache 2.0 License - see the
[LICENSE](../LICENSE) file for details.
