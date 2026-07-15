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
dedicated [README file of the slimrpc compiler](https://github.com/agntcy/slim/blob/main/crates/slimrpc-compiler/README.md).

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

## Java Setup

### Prerequisites

- Java 21+
- Maven 3.9+
- [buf](https://buf.build/docs/installation) CLI
- `protoc-gen-slimrpc-java` plugin on `PATH` (install via `cargo install agntcy-protoc-slimrpc-plugin`)
- `slim-bindings-java` installed locally (`mvn install` from `java/`)

### Code Generation

Configure `buf.gen.yaml` to generate the standard protobuf Java types plus the
slimrpc stubs:

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
  # Generates standard protobuf Java types
  - remote: buf.build/protocolbuffers/java:v29.3
    out: types
  # Generates *Slimrpc.java client/server/group stubs
  - local: protoc-gen-slimrpc-java
    out: slimrpc
```

Run `buf generate` to produce the generated code. This generates:

- `types/` — standard protobuf Java types
- `slimrpc/` — slimrpc client and server stubs (e.g. `TestSlimrpc.java`)

## Generated Code

The slimrpc compiler emits a single final class per service (e.g. `TestSlimrpc`)
containing the client interface, the server interface, the registration helper,
and — for group (multicast) usage — a group client interface.

### Client Interface

The client interface provides a method for each RPC defined in the proto file.
Unary methods return the response directly; streaming methods return typed stream
wrappers. Every method accepts an optional `Duration timeout` and a
`Map<String, String> metadata` (both may be `null`).

```java
public interface TestClient {
    ExampleResponse ExampleUnaryUnary(ExampleRequest request, Duration timeout, Map<String, String> metadata) throws RpcException;
    ResponseStreamReader ExampleUnaryStream(ExampleRequest request, Duration timeout, Map<String, String> metadata) throws RpcException;
    ClientRequestStream<ExampleRequest, ExampleResponse> ExampleStreamUnary(Duration timeout, Map<String, String> metadata) throws RpcException;
    ClientBidiStream<ExampleRequest> ExampleStreamStream(Duration timeout, Map<String, String> metadata) throws RpcException;
}
```

The client stub is created from a `Channel`:

```java
TestSlimrpc.TestClient client = new TestSlimrpc.TestClientImpl(channel);
```

Key features of the client:

- Blocking call semantics — unary methods return the response (or throw `RpcException`)
- Timeouts and per-call metadata via the `timeout` and `metadata` parameters
- Streaming methods return typed stream wrappers from `io.agntcy.slim.bindings.slimrpc`

### Stream Wrappers

The generated client returns these wrappers for streaming patterns:

- **`ClientResponseStream<T>`** — server streaming (unary-stream). Created with
  `ClientResponseStream.create(reader, parser)`; call `recv()` until it returns
  `null` to mark the end of the stream.
- **`ClientRequestStream<Req, Resp>`** — client streaming (stream-unary). Call
  `send(req)` for each request, then `finalizeStream()` to get the single response.
- **`ClientBidiStream<Req>`** — bidirectional streaming (stream-stream). Call
  `send(req)`, `closeSend()` when done sending, and `recv()` which returns a
  `StreamMessage` (`Data`, `Error`, or `End`).

### Server Interface

The server interface defines the service implementation. Each method returns a
`CompletableFuture`, and streaming methods receive a `RequestStream` and/or write
to a `ResponseSink`:

```java
public interface TestServer {
    CompletableFuture<ExampleResponse> ExampleUnaryUnary(ExampleRequest request, Context context);
    CompletableFuture<Void> ExampleUnaryStream(ExampleRequest request, Context context, ResponseSink sink);
    CompletableFuture<ExampleResponse> ExampleStreamUnary(RequestStream stream, Context context);
    CompletableFuture<Void> ExampleStreamStream(RequestStream stream, Context context, ResponseSink sink);
}
```

To stay forward-compatible as new methods are added to the proto, extend
`UnimplementedTestServer` (which returns a failed future for every method) and
override only the methods you implement.

### Server Registration

Register a service implementation with a `Server`:

```java
public static void registerTestServer(Server server, TestServer impl)
```

This wires up all the RPC handlers — serialization, deserialization, and error
conversion — with the SLIM server.

## Server Implementation

The server-side logic lives in
[SlimrpcServerMain.java](examples/slimrpc/simple/src/main/java/com/example_service/example/server/SlimrpcServerMain.java).
The service implementation provides the core functionality. Server-side stream
wrappers (`ServerRequestStream`, `ServerResponseStream`, `ServerBidiStream`)
provide blocking `send()`/`recv()` over the raw `RequestStream`/`ResponseSink`:

```java
Server rpcServer = Server.newWithConnection(app, localName, connId);
TestSlimrpc.registerTestServer(rpcServer, new TestSlimrpc.UnimplementedTestServer() {
    @Override
    public CompletableFuture<ExampleResponse> ExampleUnaryUnary(ExampleRequest request, Context context) {
        ExampleResponse response = ExampleResponse.newBuilder()
                .setExampleString("Hello, " + request.getExampleString() + "!")
                .setExampleInteger(request.getExampleInteger() * 2)
                .build();
        return CompletableFuture.completedFuture(response);
    }

    @Override
    public CompletableFuture<Void> ExampleUnaryStream(ExampleRequest request, Context context, ResponseSink sink) {
        ServerRequestStream<ExampleResponse> stream =
                ServerRequestStream.create(sink, ExampleResponse::toByteArray);
        for (long i = 1; i <= 3; i++) {
            ExampleResponse response = ExampleResponse.newBuilder()
                    .setExampleString(request.getExampleString() + " reply #" + i)
                    .setExampleInteger(request.getExampleInteger() * i)
                    .build();
            try {
                stream.send(response);
            } catch (Exception e) {
                return CompletableFuture.failedFuture(e);
            }
        }
        return CompletableFuture.completedFuture(null);
    }

    // ExampleStreamUnary / ExampleStreamStream omitted — see the example
});

System.out.println("SLIM_RPC_SERVER_READY");
rpcServer.serve();
```

The SLIM-specific server setup:

```java
RuntimeConfig runtime = SlimBindings.newRuntimeConfig();
TracingConfig tracing = SlimBindings.newTracingConfigWith("info", true, false, List.of());
ServiceConfig serviceConfig = SlimBindings.newServiceConfig();
SlimBindings.initializeWithConfigs(runtime, tracing, List.of(serviceConfig));

Service service = SlimBindings.getGlobalService();

// Create local name and app with a shared secret
Name localName = new Name("agntcy", "grpc", "server");
App app = service.createAppWithSecret(localName, "my_shared_secret_for_testing_purposes_only");

// Connect to SLIM and subscribe to the local name
ClientConfig clientConfig = SlimBindings.newInsecureClientConfig("http://localhost:46357");
long connId = service.connect(clientConfig);
app.subscribe(app.name(), connId);

// Create the RPC server, register the service, and serve
Server rpcServer = Server.newWithConnection(app, localName, connId);
TestSlimrpc.registerTestServer(rpcServer, new MyTestServer());
rpcServer.serve();
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
[SlimrpcClientMain.java](examples/slimrpc/simple/src/main/java/com/example_service/example/client/SlimrpcClientMain.java),
creates a `Channel` and uses the generated client methods:

```java
SlimBindings.initializeWithDefaults();
Service service = SlimBindings.getGlobalService();

Name localName = new Name("agntcy", "grpc", "client");
Name remoteName = new Name("agntcy", "grpc", "server");

App app = service.createAppWithSecret(localName, "my_shared_secret_for_testing_purposes_only");
ClientConfig clientConfig = SlimBindings.newInsecureClientConfig("http://localhost:46357");
long connId = service.connect(clientConfig);
app.subscribe(app.name(), connId);

Channel channel = Channel.newWithConnection(app, remoteName, connId);
TestSlimrpc.TestClient client = new TestSlimrpc.TestClientImpl(channel);

ExampleRequest request = ExampleRequest.newBuilder()
        .setExampleString("Alice")
        .setExampleInteger(42)
        .build();

// Unary-Unary
ExampleResponse response = client.ExampleUnaryUnary(request, Duration.ofSeconds(10), null);

// Unary-Stream
ResponseStreamReader reader = client.ExampleUnaryStream(request, Duration.ofSeconds(10), null);
ClientResponseStream<ExampleResponse> stream =
        ClientResponseStream.create(reader, ExampleResponse::parseFrom);
ExampleResponse streamResp;
while ((streamResp = stream.recv()) != null) {
    System.out.println("Stream Response: " + streamResp);
}
```

Key points:

- Similar setup as the server (initialize service, create app, subscribe)
- Create both local and remote `Name` objects
- Create a `Channel` with the app and remote name via `Channel.newWithConnection`
- Use `Duration` for timeouts and a `Map<String, String>` (or `null`) for metadata
- Streaming methods return typed stream wrappers; `recv()` returns `null` at stream end
- Bidirectional `recv()` returns a `StreamMessage`, pattern-match on `Data`/`Error`/`End`

## Multicast (Group) RPC

In addition to the four point-to-point patterns, the Java bindings support
multicast RPC, where a single client broadcasts to a group of server instances
and collects a response from each. The compiler generates a `TestGroupClient`
interface alongside the regular client:

```java
public interface TestGroupClient {
    MulticastResponseStream<ExampleResponse> ExampleUnaryUnary(ExampleRequest request, Duration timeout, Map<String, String> metadata) throws RpcException;
    MulticastResponseStream<ExampleResponse> ExampleUnaryStream(ExampleRequest request, Duration timeout, Map<String, String> metadata) throws RpcException;
    MulticastClientBidiStream<ExampleRequest, ExampleResponse> ExampleStreamUnary(Duration timeout, Map<String, String> metadata) throws RpcException;
    MulticastClientBidiStream<ExampleRequest, ExampleResponse> ExampleStreamStream(Duration timeout, Map<String, String> metadata) throws RpcException;
}
```

Create a group channel targeting multiple server names and pass it to the group
client. Each item received from a `MulticastResponseStream` carries the source
server context along with the response:

```java
Channel channel = Channel.newGroupWithConnection(app, serverNames, connId);
TestSlimrpc.TestGroupClient client = new TestSlimrpc.TestGroupClientImpl(channel);
MulticastResponseStream<ExampleResponse> stream = client.ExampleUnaryUnary(request, timeout, null);
```

See
[SlimrpcGroupClientMain.java](examples/slimrpc/simple/src/main/java/com/example_service/example/client/SlimrpcGroupClientMain.java)
for a complete multicast walkthrough across all four patterns.

## Example

A complete working example is available in
[examples/slimrpc/simple](examples/slimrpc/simple/). To run it:

1. Start a SLIM instance (from `java/`): `task examples:server`
2. Generate proto code: `buf generate` (from `examples/slimrpc/simple/`)
3. Run the server: `task examples:rpc:server`
4. Run the client (in another terminal): `task examples:rpc:client`
5. (Optional) Run the multicast group client against two servers: `task examples:rpc:group-client`

## slimrpc Under the Hood

slimrpc was introduced to simplify the integration of existing applications with
SLIM. From a developer's perspective, using slimrpc is similar to gRPC, but with
the benefits of SLIM's security and efficiency.

The underlying transport uses SLIM sessions with configurable reliability and
timeout settings. Since sessions in SLIM can be sticky, all messages in a
streaming communication will be forwarded to the same application instance.

The Java `slim_bindings` API provides:

- **`CompletableFuture`-based async**: Server handlers return futures; client calls block on the result
- **Type safety**: Generic stream wrappers (`ClientResponseStream<T>`, `ClientBidiStream<Req>`, …) ensure compile-time type checking
- **Error handling**: RPC errors surface as `RpcException`; helpers convert thrown exceptions to the right `RpcCode`
- **Stream wrappers**: Clean blocking abstractions over the raw `RequestStream`/`ResponseSink`
- **Multicast support**: Group channels and `Multicast*` streams for one-to-many RPC
