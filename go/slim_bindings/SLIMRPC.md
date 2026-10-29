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
dedicated [README file of the slimrpc compiler](https://github.com/agntcy/slim-bindings/blob/main/slimrpc-compiler/README.md).

The slimrpc runtime lives in the `slim_rpc` sub-package
(`github.com/agntcy/slim-bindings-go/slim_rpc`), next to the core
`slim_bindings` package used to create apps and connections.

## SLIM naming in slimrpc

A slimrpc server subscribes once to its SLIM name; every request carries the
service and method it targets, and the server dispatches it to the matching
handler. Consider the [example
protobuf](https://github.com/agntcy/slim-bindings/tree/main/go/examples/slimrpc/simple/example.proto) definition, which defines one
service, `Test`, with five methods:

```protobuf
syntax = "proto3";

package example_service;

service Test {
  rpc ExampleUnaryUnary(ExampleRequest) returns (ExampleResponse);
  rpc ExampleUnaryStream(ExampleRequest) returns (stream ExampleResponse);
  rpc ExampleUnaryStreamTwo(ExampleRequest) returns (stream ExampleResponse);
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

Based on the example_service.Test definition, the method names would be:

```
example_service.Test/ExampleUnaryUnary
example_service.Test/ExampleUnaryStream
example_service.Test/ExampleUnaryStreamTwo
example_service.Test/ExampleStreamUnary
example_service.Test/ExampleStreamStream
```

The slimrpc package manages all the underlying SLIM communication. Application
developers only need to implement the specific functions that will be invoked
when a message arrives for a defined RPC method.

## Example

This section provides a detailed walkthrough of a basic slimrpc client-server
interaction, leveraging the simple example provided in the
[examples/slimrpc/simple](https://github.com/agntcy/slim-bindings/tree/main/go/examples/slimrpc/simple) folder.

### Generated Code

The foundation of this example is the `example.proto` file, which is a
standard Protocol Buffers definition file. This file is compiled using the slimrpc
compiler (refer to the [slimrpc Compiler README](https://github.com/agntcy/slim-bindings/blob/main/slimrpc-compiler/README.md)
for installation and usage instructions) to generate the necessary Go stub
code. The generated code is available in `example_slimrpc.pb.go`, which contains
the slimrpc-specific stubs for both client and server implementations.

#### Client Interface

The client interface provides methods for calling each RPC defined in the proto file:

```go
type TestClient interface {
    ExampleUnaryUnary(ctx context.Context, req *ExampleRequest) (*ExampleResponse, error)
    ExampleUnaryStream(ctx context.Context, req *ExampleRequest) (slim_rpc.ResponseStream[*ExampleResponse], error)
    ExampleUnaryStreamTwo(ctx context.Context, req *ExampleRequest) (slim_rpc.ResponseStream[*ExampleResponse], error)
    ExampleStreamUnary(ctx context.Context) (slim_rpc.ClientRequestStream[*ExampleRequest, *ExampleResponse], error)
    ExampleStreamStream(ctx context.Context) (slim_rpc.ClientBidiStream[*ExampleRequest, *ExampleResponse], error)
}
```

The client stub is created with:

```go
client := NewTestClient(channel)
```

Key features of the client:
- The `ctx` deadline becomes the RPC timeout
- Metadata is attached with `slim_rpc.WithMetadata(ctx, map[string]string{...})`
- Unary methods return responses directly or an error
- Streaming methods return typed stream interfaces
- All methods follow standard Go error handling patterns

#### Server Interface

The server interface defines the service implementation. Developers implement
this interface to provide the actual business logic for each RPC method:

```go
type TestServer interface {
    ExampleUnaryUnary(ctx context.Context, req *ExampleRequest) (*ExampleResponse, error)
    ExampleUnaryStream(ctx context.Context, req *ExampleRequest, stream slim_rpc.ServerStream[*ExampleResponse]) error
    ExampleUnaryStreamTwo(ctx context.Context, req *ExampleRequest, stream slim_rpc.ServerStream[*ExampleResponse]) error
    ExampleStreamUnary(ctx context.Context, stream slim_rpc.ResponseStream[*ExampleRequest]) (*ExampleResponse, error)
    ExampleStreamStream(ctx context.Context, stream slim_rpc.ServerBidiStream[*ExampleRequest, *ExampleResponse]) error
}
```

Embed `UnimplementedTestServer` in your implementation to get default
handlers for the methods you don't implement.

#### Stream Interfaces

The generated code uses generic stream interfaces from the `slim_rpc` package
for type safety. All type parameters are constrained to `proto.Message`.
`Recv()` returns `(nil, nil)` when the stream ends; it does not return `io.EOF`.

**ResponseStream[T]** - For receiving a stream (client-side unary-stream, server-side stream-unary):
```go
type ResponseStream[T proto.Message] interface {
    Recv() (T, error)  // Returns nil when stream ends
}
```

**ServerStream[T]** - For sending a stream of responses (server-side unary-stream):
```go
type ServerStream[T proto.Message] interface {
    Send(T) error
}
```

**ClientRequestStream[TReq, TResp]** - For sending requests and receiving a final response (client-side stream-unary):
```go
type ClientRequestStream[TReq proto.Message, TResp proto.Message] interface {
    Send(TReq) error
    CloseAndRecv() (TResp, error)
}
```

**ClientBidiStream[TReq, TResp]** - For bidirectional streaming (client-side stream-stream):
```go
type ClientBidiStream[TReq proto.Message, TResp proto.Message] interface {
    Send(TReq) error
    Recv() (TResp, error)  // Returns nil when stream ends
    CloseSend() error
}
```

**ServerBidiStream[TReq, TResp]** - For bidirectional streaming (server-side stream-stream):
```go
type ServerBidiStream[TReq proto.Message, TResp proto.Message] interface {
    Send(TResp) error
    Recv() (TReq, error)  // Returns nil when stream ends
}
```

#### Server Registration

Register a service implementation with a server:

```go
func RegisterTestServer(server slim_rpc.ServerInterface, impl TestServer)
```

This function registers all the RPC handlers with the SLIM server.

### Server Implementation

The server-side logic is defined in
[server.go](https://github.com/agntcy/slim-bindings/tree/main/go/examples/slimrpc/simple/cmd/server/server.go). The service
implementation provides the core functionality:

```go
type TestServiceImpl struct {
    pb.UnimplementedTestServer
}

func (s *TestServiceImpl) ExampleUnaryUnary(ctx context.Context, req *pb.ExampleRequest) (*pb.ExampleResponse, error) {
    log.Printf("Received unary-unary request: %+v", req)
    return &pb.ExampleResponse{
        ExampleInteger: 1,
        ExampleString:  "Hello, World!",
    }, nil
}

func (s *TestServiceImpl) ExampleUnaryStream(ctx context.Context, req *pb.ExampleRequest, stream slim_rpc.ServerStream[*pb.ExampleResponse]) error {
    log.Printf("Received unary-stream request: %+v", req)

    // Generate response stream
    for i := int64(0); i < 5; i++ {
        if err := stream.Send(&pb.ExampleResponse{
            ExampleInteger: i,
            ExampleString:  fmt.Sprintf("Response %d", i),
        }); err != nil {
            return err
        }
    }
    return nil
}
```

To return a specific status code, return
`slim_rpc.NewRpcErrorRpc(slim_rpc.RpcCodeInvalidArgument, "message", nil)`;
any other error is reported to the caller as `INTERNAL`.

The SLIM-specific server setup:

```go
import (
    "log"

    slim_bindings "github.com/agntcy/slim-bindings-go"
    slim_rpc "github.com/agntcy/slim-bindings-go/slim_rpc"
    // plus your generated package, imported as pb
)

func main() {
    // Initialize SLIM with defaults
    slim_bindings.InitializeWithDefaults()

    service := slim_bindings.GetGlobalService()

    // Create local name
    localName := slim_bindings.NewName("agntcy", "grpc", "server")

    // Create app with shared secret
    app, err := service.CreateAppWithSecret(localName, "my_shared_secret_for_testing_purposes_only")
    if err != nil {
        log.Fatalf("Failed to create app: %v", err)
    }

    // Connect to SLIM
    clientConfig := slim_bindings.NewInsecureClientConfig("http://localhost:46357")
    connId, err := service.Connect(clientConfig)
    if err != nil {
        log.Fatalf("Failed to connect: %v", err)
    }

    // Subscribe to local name
    if err := app.Subscribe(app.Name(), &connId); err != nil {
        log.Fatalf("Failed to subscribe: %v", err)
    }

    // Create server
    server := slim_rpc.ServerNewWithConnection(app, localName, &connId)

    // Register service
    pb.RegisterTestServer(server, &TestServiceImpl{})

    // Start server (blocks until the server stops)
    log.Println("Server starting...")
    if err := server.ServeBlocking(); err != nil {
        log.Printf("Server error: %v", err)
    }
}
```

Key steps:
1. Initialize the SLIM service with defaults
2. Create a `slim_bindings.Name` for the server identity
3. Create an app with authentication (shared secret in this example)
4. Connect to the SLIM node
5. Subscribe to receive messages at the local name
6. Create a `slim_rpc.Server` from the app
7. Register the service implementation
8. Start the server with `ServeBlocking()` (or `ServeAsync()`)

### Client Implementation

The client-side implementation, found in
[client.go](https://github.com/agntcy/slim-bindings/tree/main/go/examples/slimrpc/simple/cmd/client/client.go), creates a channel and uses
the generated client methods:

```go
func main() {
    // Initialize SLIM with defaults
    slim_bindings.InitializeWithDefaults()

    service := slim_bindings.GetGlobalService()

    // Create local and remote names
    localName := slim_bindings.NewName("agntcy", "grpc", "client")
    remoteName := slim_bindings.NewName("agntcy", "grpc", "server")

    // Create app with shared secret
    app, err := service.CreateAppWithSecret(localName, "my_shared_secret_for_testing_purposes_only")
    if err != nil {
        log.Fatalf("Failed to create app: %v", err)
    }

    // Connect to SLIM
    clientConfig := slim_bindings.NewInsecureClientConfig("http://localhost:46357")
    connId, err := service.Connect(clientConfig)
    if err != nil {
        log.Fatalf("Failed to connect: %v", err)
    }

    // Subscribe to local name
    if err := app.Subscribe(app.Name(), &connId); err != nil {
        log.Fatalf("Failed to subscribe: %v", err)
    }

    // Create channel
    channel := slim_rpc.ChannelNewWithConnection(app, remoteName, &connId)
    defer channel.CloseBlocking(nil)

    // Create client
    client := pb.NewTestClient(channel)

    ctx := context.Background()

    // Call unary method
    request := &pb.ExampleRequest{
        ExampleInteger: 1,
        ExampleString:  "hello",
    }

    response, err := client.ExampleUnaryUnary(ctx, request)
    if err != nil {
        log.Fatalf("ExampleUnaryUnary failed: %v", err)
    }
    log.Printf("Response: %+v", response)

    // Call streaming method
    streamClient, err := client.ExampleUnaryStream(ctx, request)
    if err != nil {
        log.Fatalf("ExampleUnaryStream failed: %v", err)
    }

    for {
        resp, err := streamClient.Recv()
        if err != nil {
            log.Fatalf("Recv failed: %v", err)
        }
        if resp == nil {
            log.Println("Stream ended")
            break
        }
        log.Printf("Stream Response: %+v", resp)
    }
}
```

Key points:
- Similar setup as the server (initialize service, create app, subscribe)
- Create both local and remote `slim_bindings.Name` objects
- Create a `slim_rpc.Channel` with the app and remote name
- Use `context.Context` for cancellation and timeouts
- Standard Go error handling with explicit error checks
- Streaming methods return typed stream interfaces
- `Recv()` returns `nil` to indicate stream end

### Group (multicast) client

The compiler also generates a `TestGroupClient`, which sends each call to every
member of a group channel and returns the responses as a
`slim_rpc.MulticastResponseStream[T]` (or `MulticastClientBidiStream` for
client-streaming methods). Each `Recv()` yields a `*slim_rpc.MulticastItem[T]`
with the response in `Value` and the responding server in `Context`; it returns
`(nil, nil)` at the end. See
[client_group.go](https://github.com/agntcy/slim-bindings/tree/main/go/examples/slimrpc/simple/cmd/client_group/client_group.go):

```go
members := []*slim_bindings.Name{
    slim_bindings.NewName("agntcy", "grpc", "server1"),
    slim_bindings.NewName("agntcy", "grpc", "server2"),
}
channel, err := slim_rpc.ChannelNewGroupWithConnection(app, members, &connId)
if err != nil {
    log.Fatalf("Failed to create group channel: %v", err)
}
client := pb.NewTestGroupClient(channel)
```

## slimrpc Under the Hood

slimrpc was introduced to simplify the integration of existing applications with
SLIM. From a developer's perspective, using slimrpc is similar to gRPC, but with
the benefits of SLIM's security and efficiency.

The underlying transport uses SLIM sessions with configurable reliability and
timeout settings. Since sessions in SLIM can be sticky, all messages in a
streaming communication will be forwarded to the same application instance.

The `slim_rpc` API provides:
- **Context support**: Standard Go `context.Context` for cancellation and timeouts
- **Type safety**: Generic stream interfaces ensure compile-time type checking
- **Error handling**: Follows Go conventions with explicit error returns
- **Stream interfaces**: Clean abstractions for different streaming patterns
