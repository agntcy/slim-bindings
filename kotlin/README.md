# SLIM Kotlin Bindings

Kotlin/JVM bindings for the SLIM data plane, generated using [UniFFI](https://mozilla.github.io/uniffi-rs/).

## Overview

This package provides Kotlin bindings for SLIM, enabling secure messaging with:

- **Point-to-point messaging**: Direct communication between two parties
- **Group messaging**: Multi-party communication with MLS encryption support
- **Identity management**: Support for shared secrets, JWT, and SPIRE authentication
- **Coroutine support**: Idiomatic async/await using Kotlin coroutines
- **slimrpc support**: Protocol Buffers RPC over SLIM - see [SLIMRPC.md](SLIMRPC.md) for details

## Prerequisites

- **JDK 17 or higher**
- **Gradle 8.5+** (wrapper included)
- **Rust toolchain** (for building native library)
- **uniffi-bindgen-cli** CLI tool (installed automatically via Taskfile)
- **Task** (for running build tasks) - Install from [taskfile.dev](https://taskfile.dev/)

## Project Structure

```
kotlin/
├── Taskfile.yaml           # Build automation tasks
├── uniffi.toml             # UniFFI configuration (package name)
├── patch-bindings.py       # Post-generation patches
├── build.gradle.kts        # Gradle build configuration
├── settings.gradle.kts     # Gradle settings
├── gradle.properties       # Build properties
├── detekt.yml              # Detekt linter rules (used by `task lint`)
├── examples/
│   ├── kotlin/
│   │   ├── common/         # Shared utilities
│   │   │   ├── Config.kt   # Configuration data classes
│   │   │   ├── Common.kt   # Helper functions
│   │   │   └── Colors.kt   # Terminal formatting
│   │   ├── PointToPoint.kt # P2P messaging example
│   │   ├── Group.kt        # Group messaging example
│   │   └── Server.kt       # SLIM server example
│   └── slimrpc/simple/     # slimrpc example (see SLIMRPC.md)
└── generated/              # UniFFI-generated code (gitignored)
    └── io/agntcy/slim/bindings/
        └── slim_bindings.kt

```

## Quick Start

### 1. Generate Bindings

The first step is to build the Rust library and generate Kotlin bindings:

```bash
task generate
```

This will:

1. Build the Rust `slim_bindings` library
2. Run `uniffi-bindgen-cli` with `uniffi.toml` config to generate Kotlin code in the `io.agntcy.slim.bindings` package
3. Apply compatibility patches (exception message parameters, wait() method conflicts)
4. Copy the native library to `generated/jniLibs/`

### 2. Build Examples

Build the Kotlin examples:

```bash
task build
```

### 3. Run Examples

#### Server Example

Start a SLIM server:

```bash
task examples:server
```

Or with custom address:

```bash
task examples:server CLI_ARGS='--args="--slim 127.0.0.1:8080"'
```

#### Point-to-Point Messaging

Run Alice (receiver) in one terminal:

```bash
task examples:p2p:alice
```

Run Bob (sender) in another terminal:

```bash
task examples:p2p:no-mls:bob
```

With MLS encryption:

```bash
task examples:p2p:mls:bob
```

#### Group Messaging

Run the moderator in one terminal:

```bash
task examples:group:moderator
```

Run clients in separate terminals:

```bash
task examples:group:client-1
task examples:group:client-2
```

## Examples

### Point-to-Point Messaging

**Sender Mode** (sends messages to a specific peer):

```kotlin
import io.agntcy.slim.examples.common.*
import io.agntcy.slim.bindings.*
import kotlinx.coroutines.*

suspend fun main() = coroutineScope {
    val config = PointToPointConfig(
        local = "org/alice/app",
        remote = "org/bob/app",
        message = "Hello, Bob!",
        iterations = 5,
        enableMls = true
    )
    
    val (app, connId) = createLocalApp(config)
    val remoteName = Name.fromString(config.remote!!)
    
    app.setRouteAsync(remoteName, connId)
    
    val sessionConfig = SessionConfig(
        sessionType = SessionType.POINT_TO_POINT,
        maxRetries = 5u,
        interval = Duration.ofSeconds(5),
        metadata = emptyMap(),
        mlsSettings = if (config.enableMls) MlsSettings(100u, null) else null
    )
    
    val sessionContext = app.createSessionAsync(sessionConfig, remoteName)
    sessionContext.completion.waitAsync()
    val session = sessionContext.session
    
    repeat(config.iterations) {
        session.publishAsync(config.message!!.toByteArray(), null, null)
        val reply = session.getMessageAsync(Duration.ofSeconds(30))
        println("Received: ${String(reply.payload)}")
    }
}
```

**Receiver Mode** (listens for incoming sessions):

```kotlin
suspend fun main() = coroutineScope {
    val config = PointToPointConfig(local = "org/bob/app")
    val (app, _) = createLocalApp(config)
    
    while (true) {
        val session = app.listenForSessionAsync(null)
        launch {
            while (true) {
                val msg = session.getMessageAsync(Duration.ofSeconds(30))
                println("Received: ${String(msg.payload)}")
                session.publishAsync("Echo: ${String(msg.payload)}".toByteArray(), null, null)
            }
        }
    }
}
```

### Group Messaging

**Moderator** (creates group and invites participants):

```kotlin
suspend fun main() = coroutineScope {
    val config = GroupConfig(
        local = "org/moderator/app",
        remote = "org/default/chat-room",
        invites = listOf("org/alice/app", "org/bob/app"),
        enableMls = true
    )
    
    val (app, connId) = createLocalApp(config)
    val channelName = Name.fromString(config.remote!!)
    
    val sessionConfig = SessionConfig(
        sessionType = SessionType.GROUP,
        maxRetries = 5u,
        interval = Duration.ofSeconds(5),
        metadata = emptyMap(),
        mlsSettings = if (config.enableMls) MlsSettings(100u, null) else null
    )
    
    val sessionContext = app.createSession(sessionConfig, channelName)
    sessionContext.completion.waitAsync()
    val session = sessionContext.session
    
    config.invites!!.forEach { invite ->
        val inviteName = Name.fromString(invite)
        app.setRouteAsync(inviteName, connId)
        session.inviteAsync(inviteName).waitAsync()
    }
    
    // Now send/receive messages
    session.publishAsync("Hello, everyone!".toByteArray(), null, null)
}
```

**Participant** (waits for invitation):

```kotlin
suspend fun main() = coroutineScope {
    val config = GroupConfig(local = "org/alice/app")
    val (app, _) = createLocalApp(config)
    
    val session = app.listenForSessionAsync(null)
    
    launch {
        while (true) {
            val msg = session.getMessageAsync(Duration.ofSeconds(30))
            println("${msg.context.sourceName} > ${String(msg.payload)}")
        }
    }
    
    // Interactive message sending
    while (true) {
        val input = readlnOrNull() ?: break
        session.publishAsync(input.toByteArray(), null, null)
    }
}
```

### Server

```kotlin
suspend fun main() {
    val service = setupService(enableOpentelemetry = false)
    val serverConfig = newInsecureServerConfig("127.0.0.1:46357")
    
    service.runServerAsync(serverConfig)
    println("Server started on 127.0.0.1:46357")
    
    awaitCancellation()
}
```

## Configuration

### Command-Line Arguments

All examples support the following common arguments:

- `--local <id>` - Local ID (org/namespace/app) - **REQUIRED**
- `--remote <id>` - Remote ID (org/namespace/app-or-channel)
- `--slim <url>` - SLIM server endpoint (default: `http://127.0.0.1:46357`)
- `--shared-secret <secret>` - Shared secret for authentication
- `--enable-mls` - Enable MLS encryption for sessions
- `--enable-opentelemetry` - Enable OpenTelemetry tracing

**Point-to-Point specific:**

- `--message <text>` - Message to send (activates sender mode)
- `--iterations <n>` - Number of request/reply cycles (default: 10)

**Group specific:**

- `--invites <id>` - Invite participant (can be specified multiple times)

**Server specific:**

- `--slim, -s <address>` - Server address (host:port)

### Environment Variables

Some defaults can also be provided via environment variables with the `SLIM_` prefix
(`--local` and `--enable-mls` have no environment equivalent):

- `SLIM_ENDPOINT` - Server endpoint
- `SLIM_SHARED_SECRET` - Shared secret
- `SLIM_ENABLE_OPENTELEMETRY` - Enable OpenTelemetry (true/false)
- `SLIM_JWT`, `SLIM_SPIRE_TRUST_BUNDLE`, `SLIM_AUDIENCE` - JWT identity settings
- `SLIM_SPIRE_SOCKET_PATH`, `SLIM_SPIRE_TARGET_SPIFFE_ID`, `SLIM_SPIRE_JWT_AUDIENCE` - SPIRE identity settings
- `SLIM_CLIENT_CONFIG` - Path to a JSON file holding the full gRPC client config (see
  [Transport Authentication](#transport-authentication-grpc-connection)); overrides `SLIM_ENDPOINT`

### Authentication Modes

These modes set the **application identity** — who this app claims to be inside SLIM.
They are independent of [transport authentication](#transport-authentication-grpc-connection),
which secures the gRPC connection to the SLIM node.

The bindings support three authentication modes:

1. **Shared Secret** (default, for development):

   ```kotlin
   val config = BaseConfig(
       local = "org/alice/app",
       sharedSecret = "my-shared-secret-at-least-32-bytes-long"
   )
   ```

2. **JWT with JWKS**:

   ```kotlin
   val config = BaseConfig(
       local = "org/alice/app",
       jwt = "/path/to/jwt.pem",
       spireTrustBundle = "/path/to/bundle.json",
       audience = listOf("slim-service")
   )
   ```

3. **SPIRE** (dynamic identity):

   ```kotlin
   val config = BaseConfig(
       local = "org/alice/app",
       spireSocketPath = "/tmp/spire-agent/public/api.sock",
       spireTargetSpiffeId = "spiffe://example.org/alice",
       spireJwtAudience = listOf("slim-service")
   )
   ```

### Transport Authentication (gRPC connection)

Separate from application identity, the gRPC connection to a SLIM node can carry its own
credentials via `ClientConfig.auth` (and `ServerConfig.auth` when hosting). Supported modes
are `Basic`, `StaticJwt`, `Jwt`, `Spire`, and `Oidc`.

**OIDC from Kotlin**, client side (client-credentials flow):

```kotlin
val clientConfig = newInsecureClientConfig("http://127.0.0.1:46357").apply {
    auth = ClientAuthenticationConfig.Oidc(
        OidcConfig(
            issuerUrl = "https://auth.example.com",
            clientId = "my-client",
            clientSecret = "s3cr3t",
            audience = null,
            refreshToken = null,
            refreshTokenFile = null,
            accessTokenFile = null,
            scope = "openid profile",
            timeout = Duration.ofSeconds(30),
            jwksTtl = null,
            claimCacheTtl = null,
            policy = null,
        )
    )
}
val connId = service.connectAsync(clientConfig)
```

For the refresh-token flow set `refreshToken` (or `refreshTokenFile`, which is rewritten
in place as tokens rotate) instead of `clientSecret`.

**Server side**, verifying incoming JWTs against the issuer's JWKS endpoint, optionally
restricting access by claim:

```kotlin
val serverConfig = newInsecureServerConfig("127.0.0.1:46357").apply {
    auth = ServerAuthenticationConfig.Oidc(
        OidcConfig(
            issuerUrl = "https://auth.example.com",
            clientId = null, clientSecret = null,
            audience = "slim",                       // required for verification
            refreshToken = null, refreshTokenFile = null, accessTokenFile = null,
            scope = null,
            timeout = null,
            jwksTtl = Duration.ofHours(1),
            claimCacheTtl = Duration.ofMinutes(1),
            policy = OidcPolicyConfig.Cel(""""admin" in claims.groups"""),
        )
    )
}
```

`policy` accepts `OidcPolicyConfig.Cel(expression)`, `OidcPolicyConfig.Rego(text)` (which must
define `package slim.auth` with `default allow = false`), or `OidcPolicyConfig.RegoFile(path)`.
Client-only fields (`scope`, `timeout`) and server-only fields (`jwksTtl`, `claimCacheTtl`,
`policy`) are ignored by the other side.

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

The schema matches `crates/config/src/schema/client-config.schema.json` in the
[slim](https://github.com/agntcy/slim) repo. To load one yourself, call `newConfigFromJson(json)`.

## Building

### Task Commands

The project uses [Task](https://taskfile.dev/) for build automation:

- `task generate` - Generate Kotlin bindings from Rust library
- `task build` - Build Kotlin code and create JARs
- `task clean` - Remove build artifacts and generated code
- `task examples:server` - Run the server example
- `task examples:p2p:alice` - Run Alice (P2P receiver)
- `task examples:p2p:no-mls:bob` - Run Bob (P2P sender, without encryption)
- `task examples:p2p:mls:bob` - Run Bob with MLS encryption
- `task examples:group:moderator` - Run group moderator
- `task examples:group:client-1` - Run group participant 1
- `task examples:group:client-2` - Run group participant 2

## Dependencies

- **JNA 5.14.0+** - Native library loading via Java Native Access
- **kotlinx-coroutines-core 1.8.1+** - Coroutine support for async operations
- **Clikt 4.2.2** - Command-line interface parsing

## Architecture

### UniFFI Code Generation

The Kotlin bindings are generated from the Rust `slim_bindings` crate using UniFFI:

1. Rust code uses `#[uniffi::export]` macros to mark public APIs
2. `uniffi-bindgen-cli` reads the compiled library and generates Kotlin code
3. Generated code uses JNA to call native functions
4. Native library is packaged in `generated/jniLibs/` for runtime loading

### Async Support

Rust async functions are exposed as Kotlin `suspend` functions:

```rust
// Rust
#[uniffi::export]
pub async fn connect_async(&self, config: ClientConfig) -> Result<u64, SlimError>
```

```kotlin
// Generated Kotlin
suspend fun connectAsync(config: ClientConfig): ULong
```

### Error Handling

Rust `Result<T, E>` types are converted to Kotlin exceptions:

```rust
// Rust
pub enum SlimError {
    ServiceError { message: String },
    SessionError { message: String },
    SendError { message: String },
    Timeout,
    // ... ReceiveError, AuthError, ConfigError, RpcError, InvalidArgument, InternalError
}
```

```kotlin
// Kotlin
try {
    session.publishAsync(data, null, null)
} catch (e: SlimException.SessionException) {
    println("Session error: ${e.message}")
} catch (e: SlimException.Timeout) {
    println("Timed out")
}
```

## Development

### Project Layout

- `examples/kotlin/common/` - Shared utilities and configuration
- `examples/kotlin/*.kt` - Example applications
- `examples/slimrpc/simple/` - slimrpc example
- `generated/` - UniFFI-generated Kotlin code (not in git)
- `build.gradle.kts` - Gradle build configuration
- `detekt.yml` — Static analysis rules (`task lint` in this directory)
- `Taskfile.yaml` - Task automation

## License

Apache 2.0 - See [LICENSE](../LICENSE) for details

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines

## Links

- [SLIM Project](https://github.com/agntcy/slim)
- [UniFFI Documentation](https://mozilla.github.io/uniffi-rs/)
- [Kotlin Coroutines](https://kotlinlang.org/docs/coroutines-overview.html)
- [Task Documentation](https://taskfile.dev/)
