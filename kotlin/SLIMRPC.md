# slimrpc (SLIM Remote Procedure Call)

slimrpc, or SLIM Remote Procedure Call, is a mechanism designed to enable Protocol
Buffers (protobuf) RPC over SLIM (Secure Low-Latency Interactive Messaging).
This is analogous to gRPC, which leverages HTTP/2 as its underlying transport
layer for protobuf RPC.

A key advantage of slimrpc lies in its ability to seamlessly integrate SLIM as the
transport protocol for inter-application message exchange. This significantly
simplifies development: a protobuf file can be compiled to generate code that
utilizes SLIM for communication. Application developers can then interact with
the generated code much like they would with standard gRPC, while benefiting
from the inherent security features and efficiency provided by the SLIM
protocol.

This README provides a guide to understanding how slimrpc functions and how you can
implement it in your applications. For detailed instructions on compiling a
protobuf file to obtain the necessary slimrpc stub code, please refer to the
dedicated [README file of the slimrpc compiler](../slimrpc-compiler/README.md).

## SLIM naming in slimrpc

In slimrpc, each service and its individual RPC handlers are assigned a SLIM name,
facilitating efficient message routing and processing. Consider the [example
protobuf](examples/slimrpc/simple/example.proto) definition, which defines four
distinct RPC patterns:

```protobuf
syntax = "proto3";

package example_service;

service Test {
  rpc ExampleUnaryUnary(ExampleRequest) returns (ExampleResponse);
  rpc ExampleUnaryStream(ExampleRequest) returns (stream ExampleResponse);
  rpc ExampleStreamUnary(stream ExampleRequest) returns (ExampleResponse);
  rpc ExampleStreamStream(stream ExampleRequest) returns (stream ExampleResponse);
}
```

This example showcases the four primary communication patterns supported by
gRPC: Unary-Unary, Unary-Stream, Stream-Unary, and Stream-Stream.

For slimrpc, service methods are invoked using the format:

```
{package-name}.{service-name}/{method-name}
```

Based on the `example_service.Test` definition, the method names would be:

```
example_service.Test/ExampleUnaryUnary
example_service.Test/ExampleUnaryStream
example_service.Test/ExampleStreamUnary
example_service.Test/ExampleStreamStream
```

The slimrpc package manages all the underlying SLIM communication. Application
developers only need to implement the specific functions that will be invoked
when a message arrives for a defined RPC method.

## Kotlin Setup

### Prerequisites

- Java 17+ (JDK)
- Gradle (the wrapper is included with the example)
- [buf](https://buf.build/docs/installation) CLI
- `protoc-gen-slimrpc-kotlin` plugin on `PATH` (install via `cargo install agntcy-protoc-slimrpc-plugin`)
- `slim-bindings-kotlin` installed locally (`./gradlew publishToMavenLocal` from `kotlin/`)

### Code Generation

Configure `buf.gen.yaml` to generate the standard protobuf Java types, the Kotlin
DSL builders, and the slimrpc stubs:

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
  # Standard protobuf Java types (usable from Kotlin)
  - remote: buf.build/protocolbuffers/java
    out: types
  # Kotlin DSL builders (exampleRequest { ... })
  - remote: buf.build/protocolbuffers/kotlin
    out: types
  # Generates *Slimrpc.kt client/server/group stubs
  - local: protoc-gen-slimrpc-kotlin
    out: slimrpc
```

Run `buf generate` to produce the generated code. This generates:

- `types/` — standard protobuf Java types and Kotlin DSL builders
- `slimrpc/` — slimrpc Kotlin client and server stubs (e.g. `TestSlimrpc.kt`)

## Generated Code

The slimrpc compiler emits a single `object` per service (e.g. `TestSlimrpc`)
containing the client interface, the server interface, the registration helper,
and — for group (multicast) usage — a group client interface. All calls are
modeled with Kotlin `suspend` functions, so they integrate naturally with
coroutines.

### Client Interface

The client interface provides a method for each RPC defined in the proto file.
Unary methods return the response directly; streaming methods return typed stream
wrappers. Every method accepts a `Duration timeout` and a nullable
`Map<String, String>?` of metadata.

```kotlin
interface TestClient {
    suspend fun ExampleUnaryUnary(request: ExampleRequest, timeout: Duration, metadata: Map<String, String>?): ExampleResponse
    suspend fun ExampleUnaryStream(request: ExampleRequest, timeout: Duration, metadata: Map<String, String>?): ResponseStreamReader
    fun ExampleStreamUnary(timeout: Duration, metadata: Map<String, String>?): ClientRequestStream<ExampleRequest, ExampleResponse>
    fun ExampleStreamStream(timeout: Duration, metadata: Map<String, String>?): ClientBidiStream<ExampleRequest>
}
```

The client stub is created from a `Channel`:

```kotlin
val client = TestSlimrpc.TestClientImpl(channel)
```

Key features of the client:

- `suspend` call semantics — unary methods return the response (or throw `RpcException`)
- Timeouts and per-call metadata via the `timeout` and `metadata` parameters
- Streaming methods return typed stream wrappers from `io.agntcy.slim.bindings.slimrpc`

### Stream Wrappers

The generated client returns these wrappers for streaming patterns:

- **`ClientResponseStream<T>`** — server streaming (unary-stream). Created with
  `ClientResponseStream.create(reader) { ... }`; call `recv()` until it returns
  `null` to mark the end of the stream.
- **`ClientRequestStream<Req, Resp>`** — client streaming (stream-unary). Call
  `send(req)` for each request, then `finalizeStream()` to get the single response.
- **`ClientBidiStream<Req>`** — bidirectional streaming (stream-stream). Call
  `send(req)`, `closeSend()` when done sending, and `recv()` which returns a
  `StreamMessage` (`Data`, `Error`, or `End`).

### Server Interface

The server interface defines the service implementation. Each method is a
`suspend` function; streaming methods receive a `RequestStream` and/or write to a
`ResponseSink`:

```kotlin
interface TestServer {
    suspend fun ExampleUnaryUnary(request: ExampleRequest, context: Context): ExampleResponse
    suspend fun ExampleUnaryStream(request: ExampleRequest, context: Context, sink: ResponseSink)
    suspend fun ExampleStreamUnary(stream: RequestStream, context: Context): ExampleResponse
    suspend fun ExampleStreamStream(stream: RequestStream, context: Context, sink: ResponseSink)
}
```

To stay forward-compatible as new methods are added to the proto, extend
`UnimplementedTestServer` (which throws `UnsupportedOperationException` for every
method) and override only the methods you implement.

### Server Registration

Register a service implementation with a `Server`:

```kotlin
fun registerTestServer(server: Server, impl: TestServer)
```

This wires up all the RPC handlers — serialization, deserialization, and error
conversion — with the SLIM server.

## Server Implementation

The server-side logic lives in
[SlimrpcServerMain.kt](examples/slimrpc/simple/src/main/kotlin/com/example_service/example/server/SlimrpcServerMain.kt).
The service implementation provides the core functionality. Server-side stream
wrappers (`ServerRequestStream`, `ServerResponseStream`, `ServerBidiStream`)
provide coroutine-based `send()`/`recv()` over the raw `RequestStream`/`ResponseSink`:

```kotlin
val rpcServer = Server.newWithConnection(app, localName, connId)
TestSlimrpc.registerTestServer(rpcServer, object : TestSlimrpc.UnimplementedTestServer() {

    override suspend fun ExampleUnaryUnary(request: ExampleRequest, context: Context): ExampleResponse {
        return exampleResponse {
            exampleString = "Hello, ${request.exampleString}!"
            exampleInteger = request.exampleInteger * 2
        }
    }

    override suspend fun ExampleUnaryStream(request: ExampleRequest, context: Context, sink: ResponseSink) {
        val stream = ServerRequestStream.create<ExampleResponse>(sink) { it.toByteArray() }
        for (i in 1..3) {
            stream.send(exampleResponse {
                exampleString = "${request.exampleString} reply #$i"
                exampleInteger = request.exampleInteger * i
            })
        }
    }

    // ExampleStreamUnary / ExampleStreamStream omitted — see the example
})

println("SLIM_RPC_SERVER_READY")
rpcServer.serve()
```

The SLIM-specific server setup (inside `runBlocking`):

```kotlin
val runtime = newRuntimeConfig()
val tracing = newTracingConfigWith("info", true, false, emptyList())
val serviceConfig = newServiceConfig()
initializeWithConfigs(runtime, tracing, listOf(serviceConfig))

val service = getGlobalService()

// Create local name and app with a shared secret
val localName = Name("agntcy", "grpc", "server")
val app = service.createAppWithSecret(localName, "my_shared_secret_for_testing_purposes_only")

// Connect to SLIM and subscribe to the local name
val clientConfig = newInsecureClientConfig("http://localhost:46357")
val connId = service.connectAsync(clientConfig)
app.subscribeAsync(app.name(), connId)

// Create the RPC server, register the service, and serve
val rpcServer = Server.newWithConnection(app, localName, connId)
TestSlimrpc.registerTestServer(rpcServer, MyTestServer())
rpcServer.serve()
```

Key steps:

1. Initialize the SLIM service with configs
2. Create a `Name` for the server identity
3. Create an `App` with authentication (shared secret in this example)
4. Connect to the SLIM node and subscribe to the local name
5. Create a `Server` from the app with `Server.newWithConnection`
6. Register the service implementation with `registerTestServer`
7. Start the server with `serve()`

## Client Implementation

The client-side implementation, found in
[SlimrpcClientMain.kt](examples/slimrpc/simple/src/main/kotlin/com/example_service/example/client/SlimrpcClientMain.kt),
creates a `Channel` and uses the generated client methods (inside `runBlocking`):

```kotlin
initializeWithDefaults()
val service = getGlobalService()

val localName = Name("agntcy", "grpc", "client")
val remoteName = Name("agntcy", "grpc", "server")

val app = service.createAppWithSecret(localName, "my_shared_secret_for_testing_purposes_only")
val clientConfig = newInsecureClientConfig("http://localhost:46357")
val connId = service.connectAsync(clientConfig)
app.subscribeAsync(app.name(), connId)

val channel = Channel.newWithConnection(app, remoteName, connId)
val client = TestSlimrpc.TestClientImpl(channel)

val request = exampleRequest {
    exampleString = "Alice"
    exampleInteger = 42
}

// Unary-Unary
val response = client.ExampleUnaryUnary(request, Duration.ofSeconds(10), null)

// Unary-Stream
val reader = client.ExampleUnaryStream(request, Duration.ofSeconds(10), null)
val stream = ClientResponseStream.create(reader) { ExampleResponse.parseFrom(it) }
while (true) {
    val resp = stream.recv() ?: break
    println("Stream Response: $resp")
}
```

Key points:

- Similar setup as the server (initialize service, create app, subscribe)
- Create both local and remote `Name` objects
- Create a `Channel` with the app and remote name via `Channel.newWithConnection`
- Use `Duration` for timeouts and a `Map<String, String>?` (or `null`) for metadata
- Streaming methods return typed stream wrappers; `recv()` returns `null` at stream end
- Bidirectional `recv()` returns a `StreamMessage`; use a `when` over `Data`/`Error`/`End`

## Multicast (Group) RPC

In addition to the four point-to-point patterns, the Kotlin bindings support
multicast RPC, where a single client broadcasts to a group of server instances
and collects a response from each. The compiler generates a `TestGroupClient`
interface alongside the regular client:

```kotlin
interface TestGroupClient {
    suspend fun ExampleUnaryUnary(request: ExampleRequest, timeout: Duration, metadata: Map<String, String>?): MulticastResponseStream<ExampleResponse>
    suspend fun ExampleUnaryStream(request: ExampleRequest, timeout: Duration, metadata: Map<String, String>?): MulticastResponseStream<ExampleResponse>
    fun ExampleStreamUnary(timeout: Duration, metadata: Map<String, String>?): MulticastClientBidiStream<ExampleRequest, ExampleResponse>
    fun ExampleStreamStream(timeout: Duration, metadata: Map<String, String>?): MulticastClientBidiStream<ExampleRequest, ExampleResponse>
}
```

Create a group channel targeting multiple server names and pass it to the group
client. Each item received from a `MulticastResponseStream` carries the source
server context along with the response:

```kotlin
val channel = Channel.newGroupWithConnection(app, serverNames, connId)
val client = TestSlimrpc.TestGroupClientImpl(channel)
val stream = client.ExampleUnaryUnary(request, timeout, null)
```

See
[SlimrpcGroupClientMain.kt](examples/slimrpc/simple/src/main/kotlin/com/example_service/example/client/SlimrpcGroupClientMain.kt)
for a complete multicast walkthrough across all four patterns.

## Example

A complete working example is available in
[examples/slimrpc/simple](examples/slimrpc/simple/). To run it:

1. Start a SLIM instance (from `kotlin/`): `task examples:server`
2. Generate proto code: `buf generate` (from `examples/slimrpc/simple/`)
3. Run the server: `./gradlew server`
4. Run the client (in another terminal): `./gradlew client`
5. (Optional) Run the multicast group client against two servers: `./gradlew groupClient`

## slimrpc Under the Hood

slimrpc was introduced to simplify the integration of existing applications with
SLIM. From a developer's perspective, using slimrpc is similar to gRPC, but with
the benefits of SLIM's security and efficiency.

The underlying transport uses SLIM sessions with configurable reliability and
timeout settings. Since sessions in SLIM can be sticky, all messages in a
streaming communication will be forwarded to the same application instance.

The Kotlin `slim_bindings` API provides:

- **Coroutine-based async**: Client calls and server handlers are `suspend` functions
- **Type safety**: Generic stream wrappers (`ClientResponseStream<T>`, `ClientBidiStream<Req>`, …) ensure compile-time type checking
- **Error handling**: RPC errors surface as `RpcException`; helpers convert thrown exceptions to the right `RpcCode`
- **Stream wrappers**: Clean `suspend` abstractions over the raw `RequestStream`/`ResponseSink`
- **Multicast support**: Group channels and `Multicast*` streams for one-to-many RPC
