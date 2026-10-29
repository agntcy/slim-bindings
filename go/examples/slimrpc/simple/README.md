# slimrpc Simple Example (Go)

This example demonstrates all slimrpc RPC patterns in Go with comprehensive client and server implementations.

## Prerequisites

- Go 1.25+ (see `go.mod`)
- Go bindings generated locally: this module uses a `replace` directive pointing at
  `../../../slim_bindings`, so run `task generate` from the `go/` directory first
- Running SLIM server on `localhost:46357` (`task examples:server` from `go/`)

## Generate Code

The generated files in `types/` are committed, so this step is only needed after
changing `example.proto`. From the `go/` directory:

```bash
task generate-proto
```

This installs `protoc-gen-slimrpc-go` from the in-repo slimrpc compiler with
`cargo install`, then runs `buf generate`. To run `buf generate` yourself,
`protoc-gen-slimrpc-go` must be on your `PATH`.

This generates:
- `types/example.pb.go` - Standard protobuf types
- `types/example_slimrpc.pb.go` - slimrpc client and server stubs

## Run the Example

In one terminal, start the server:

```bash
go run cmd/server/server.go
```

In another terminal, run the client:

```bash
go run cmd/client/client.go
```

The same steps are available as `task examples:rpc:server` and
`task examples:rpc:client` from the `go/` directory. Use `--server` (or
`SLIM_ADDR`) to point at a different SLIM node.

### Group (multicast) client

Start two server instances, then run the group client, which calls both at once
(each command in its own terminal):

```bash
go run cmd/server/server.go -instance=server1
go run cmd/server/server.go -instance=server2
go run cmd/client_group/client_group.go --servers=server1,server2
```

## Code Structure

### Server (`cmd/server/server.go`)

Implements the four RPC patterns (the proto has five methods; `ExampleUnaryStreamTwo` is a second unary-stream method):

1. **UnaryUnary**: Simple request-response
2. **UnaryStream**: Single request, multiple responses
3. **StreamUnary**: Multiple requests, single response
4. **StreamStream**: Bidirectional streaming

The server implements the `TestServer` interface and embeds `UnimplementedTestServer` for forward compatibility.

### Client (`cmd/client/client.go`)

Demonstrates all four RPC patterns:

#### 1. Unary-Unary
```go
response, err := client.ExampleUnaryUnary(ctx, request)
```

#### 2. Unary-Stream (Server Streaming)
```go
stream, err := client.ExampleUnaryStream(ctx, request)
for {
    resp, err := stream.Recv()
    if resp == nil { break }
    // Process response
}
```

#### 3. Stream-Unary (Client Streaming)
```go
stream, err := client.ExampleStreamUnary(ctx)
for i := 0; i < 10; i++ {
    stream.Send(request)
}
response, err := stream.CloseAndRecv()
```

#### 4. Stream-Stream (Bidirectional Streaming)
```go
stream, err := client.ExampleStreamStream(ctx)

// Send in goroutine
go func() {
    for i := 0; i < 10; i++ {
        stream.Send(request)
    }
    stream.CloseSend()
}()

// Receive
for {
    resp, err := stream.Recv()
    if resp == nil { break }
    // Process response
}
```

## Generated Code

The `buf generate` command produces type-safe interfaces for all RPC patterns:

### Client Interface
```go
type TestClient interface {
    ExampleUnaryUnary(ctx context.Context, req *ExampleRequest) (*ExampleResponse, error)
    ExampleUnaryStream(ctx context.Context, req *ExampleRequest) (slim_rpc.ResponseStream[*ExampleResponse], error)
    ExampleUnaryStreamTwo(ctx context.Context, req *ExampleRequest) (slim_rpc.ResponseStream[*ExampleResponse], error)
    ExampleStreamUnary(ctx context.Context) (slim_rpc.ClientRequestStream[*ExampleRequest, *ExampleResponse], error)
    ExampleStreamStream(ctx context.Context) (slim_rpc.ClientBidiStream[*ExampleRequest, *ExampleResponse], error)
}
```

### Server Interface
```go
type TestServer interface {
    ExampleUnaryUnary(ctx context.Context, req *ExampleRequest) (*ExampleResponse, error)
    ExampleUnaryStream(ctx context.Context, req *ExampleRequest, stream slim_rpc.ServerStream[*ExampleResponse]) error
    ExampleUnaryStreamTwo(ctx context.Context, req *ExampleRequest, stream slim_rpc.ServerStream[*ExampleResponse]) error
    ExampleStreamUnary(ctx context.Context, stream slim_rpc.ResponseStream[*ExampleRequest]) (*ExampleResponse, error)
    ExampleStreamStream(ctx context.Context, stream slim_rpc.ServerBidiStream[*ExampleRequest, *ExampleResponse]) error
}
```

### Group Client Interface
```go
type TestGroupClient interface {
    ExampleUnaryUnary(ctx context.Context, req *ExampleRequest) (slim_rpc.MulticastResponseStream[*ExampleResponse], error)
    ExampleUnaryStream(ctx context.Context, req *ExampleRequest) (slim_rpc.MulticastResponseStream[*ExampleResponse], error)
    ExampleUnaryStreamTwo(ctx context.Context, req *ExampleRequest) (slim_rpc.MulticastResponseStream[*ExampleResponse], error)
    ExampleStreamUnary(ctx context.Context) (slim_rpc.MulticastClientBidiStream[*ExampleRequest, *ExampleResponse], error)
    ExampleStreamStream(ctx context.Context) (slim_rpc.MulticastClientBidiStream[*ExampleRequest, *ExampleResponse], error)
}
```

### Stream Interfaces
The stream types are generic interfaces from the `slim_rpc` package
(`slim_bindings/slim_rpc/stream_interfaces.go`), shared by all services:

```go
// Server streaming (server side)
type ServerStream[T proto.Message] interface {
    Send(T) error
}

// Client streaming (server side) and server streaming (client side)
type ResponseStream[T proto.Message] interface {
    Recv() (T, error)
}

// Bidirectional streaming (server side)
type ServerBidiStream[TReq proto.Message, TResp proto.Message] interface {
    Send(TResp) error
    Recv() (TReq, error)
}
```

## Features

- ✅ All 4 RPC patterns (unary-unary, unary-stream, stream-unary, stream-stream)
- ✅ Type-safe client and server interfaces
- ✅ Automatic serialization/deserialization
- ✅ Proper error handling with RPC error conversion
- ✅ Stream end detection (nil return)
- ✅ Forward-compatible server with unimplemented method stubs
- ✅ Concurrent send/receive for bidirectional streaming

## Notes

- `Recv()` returns `nil` when the stream ends (not an error)
- Error handling automatically converts `RpcError` to standard Go errors
- Bidirectional streaming uses goroutines for concurrent send/receive
- The server automatically closes response streams when handlers return
