# SLIM Java Bindings

Java bindings for SLIM generated via [uniffi-bindgen-java](https://github.com/IronCoreLabs/uniffi-bindgen-java).

## Features

- **Native Java Interface**: Idiomatic Java API with sync methods; async variants via `CompletableFuture` available
- **Java 21**: Built for modern Java with records and latest language features
- **Panama FFM**: Native calls go through the Foreign Function & Memory API (`java.lang.foreign`), compiled as a Java 21 preview feature
- **Complete Examples**: Server, Point-to-Point, and Group messaging examples
- **slimrpc Support**: Protocol Buffers RPC over SLIM - see [SLIMRPC.md](SLIMRPC.md) for details
- **Task Automation**: Integrated with Taskfile for easy builds and testing

## Requirements

- **JDK 21** — the classes are compiled with `--enable-preview` for release 21, so they run only on a
  Java 21 JVM started with `--enable-preview` (preview class files are rejected by other JDK versions).
  Code that uses them must also be compiled with `--enable-preview` (e.g. maven-compiler-plugin
  `<compilerArgs><arg>--enable-preview</arg></compilerArgs>`, as in [`examples/pom.xml`](examples/pom.xml))
- **Maven 3.8+**
- **Rust toolchain** (for building native library)
- **uniffi-bindgen-java** (auto-installed via Taskfile)

### Running an application that uses the JAR

The generated code calls `System.loadLibrary("slim_bindings")` and does not extract the
native libraries bundled in the JAR (they sit at `<platform>/libslim_bindings.*`, e.g.
`darwin-aarch64/libslim_bindings.dylib`). Start the JVM with preview features enabled and
point it at the native library:

```bash
java --enable-preview \
  -Djava.library.path=/path/to/dir/containing/libslim_bindings \
  -cp app.jar:slim-bindings-java.jar com.example.Main

# or give the absolute path of the library file instead (slimrpc loads it under its
# own component name, so set both):
#   -Duniffi.component.slim_bindings.libraryOverride=/abs/path/libslim_bindings.so
#   -Duniffi.component.slim_rpc.libraryOverride=/abs/path/libslim_bindings.so
```

`java.library.path` is read once at JVM startup, so it must be passed on the command line
(or in `JAVA_TOOL_OPTIONS` / `.mvn/jvm.config`); setting it at runtime with
`System.setProperty` has no effect. The examples take `--enable-preview` and the
`--add-opens` flags for `java.base/java.lang` and `java.lang.reflect` from
[`examples/.mvn/jvm.config`](examples/.mvn/jvm.config).

## Quick Start

### 1. Generate Bindings

```bash
cd java
task generate
```

This will:
- Build the Rust bindings library
- Install uniffi-bindgen-java (if not present)
- Generate Java source files
- Copy native libraries to the correct platform directory

### 2. Build Java Bindings

```bash
task build
```

Creates a JAR at `target/slim-bindings-java-1.2.0.jar`.

### 3. Install to Local Maven Repository

```bash
task install
```

Makes the bindings available to the examples and other local projects.

### 4. Run Examples

```bash
# Start server
task examples:server

# Point-to-point (in separate terminals)
task examples:p2p:alice
task examples:p2p:no-mls:bob   # or examples:p2p:mls:bob for MLS encryption

# Group messaging (in separate terminals)
task examples:group:moderator
task examples:group:client-1
task examples:group:client-2
```

## Architecture

```
┌─────────────────────────┐
│  Java Application       │
│  (Your Code)            │
└───────────┬─────────────┘
            │
            │ Sync / CompletableFuture API
            ▼
┌─────────────────────────┐
│  Generated Java Classes │
│  (uniffi-bindgen-java)  │
└───────────┬─────────────┘
            │
            │ Panama FFM (java.lang.foreign)
            ▼
┌─────────────────────────┐
│  Native Library         │
│  libslim_bindings.so    │
│  (Rust + UniFFI)        │
└─────────────────────────┘
```

## Directory Structure

```
java/
├── Taskfile.yaml           # Build automation
├── pom.xml                 # Maven configuration
├── uniffi.toml             # UniFFI Java bindings config
├── README.md               # This file
├── generated/              # Generated code (gitignored)
│   ├── uniffi/io/agntcy/slim/bindings/  # Java source files
│   └── native/             # Native libraries by platform
│       ├── darwin-x86-64/
│       ├── darwin-aarch64/
│       ├── linux-x86-64/
│       ├── linux-aarch64/
│       ├── win32-x86-64/
│       └── win32-aarch64/
└── examples/               # Java examples (run via `task examples:*` from java/)
    ├── pom.xml
    └── src/main/java/io/agntcy/slim/examples/
        ├── common/         # Shared utilities
        ├── Server.java     # Server example
        ├── PointToPoint.java  # P2P messaging
        └── Group.java      # Group messaging
```

## API Overview

### Initialization

```java
import io.agntcy.slim.bindings.*;

// Initialize with defaults
SlimBindings.initializeWithDefaults();

// Or with explicit runtime, tracing and service configs
TracingConfig tracing = SlimBindings.newTracingConfig();
tracing.setLogLevel("debug");
SlimBindings.initializeWithConfigs(
    SlimBindings.newRuntimeConfig(),
    tracing,
    List.of(SlimBindings.newServiceConfig()));
```

### Creating an App

```java
Service service = SlimBindings.getGlobalService();
Name appName = new Name("org", "namespace", "app");

// Create app with shared secret
App app = service.createAppWithSecret(appName, "my-secret-min-32-chars!!!!!!!!!!");
```

### Connecting to Server

```java
// Create client config
ClientConfig config = SlimBindings.newInsecureClientConfig("http://localhost:46357");

// Connect (sync)
Long connectionId = service.connect(config);
```

### Transport Authentication (gRPC connection)

Separate from the app identity passed to `createAppWithSecret` and friends, the gRPC
connection to a SLIM node can carry its own credentials via `ClientConfig.setAuth` (and
`ServerConfig.setAuth` when hosting). Supported modes are `Basic`, `StaticJwt`, `Jwt`,
`Spire`, and `Oidc`.

OIDC, client side (client-credentials flow):

```java
ClientConfig config = SlimBindings.newInsecureClientConfig("http://localhost:46357");
config.setAuth(new ClientAuthenticationConfig.Oidc(new OidcConfig(
    "https://auth.example.com",  // issuerUrl
    "my-client",                 // clientId
    "s3cr3t",                    // clientSecret
    null,                        // audience
    null, null, null,            // refreshToken, refreshTokenFile, accessTokenFile
    "openid profile",            // scope
    Duration.ofSeconds(30),      // timeout        (client-side)
    null,                        // jwksTtl        (server-side)
    null,                        // claimCacheTtl  (server-side)
    null)));                     // policy         (server-side)

Long connectionId = service.connect(config);
```

For the refresh-token flow set `refreshToken` — or `refreshTokenFile`, which is rewritten
in place as tokens rotate — instead of `clientSecret`.

Server side, verifying incoming JWTs against the issuer's JWKS endpoint, optionally
restricting access by claim:

```java
ServerConfig config = SlimBindings.newInsecureServerConfig("127.0.0.1:46357");
config.setAuth(new ServerAuthenticationConfig.Oidc(new OidcConfig(
    "https://auth.example.com",
    null, null,
    "slim",                      // audience - required for verification
    null, null, null, null, null,
    Duration.ofHours(1),         // jwksTtl
    Duration.ofMinutes(1),       // claimCacheTtl
    new OidcPolicyConfig.Cel("\"admin\" in claims.groups"))));
```

`policy` accepts `OidcPolicyConfig.Cel`, `OidcPolicyConfig.Rego` (which must define
`package slim.auth` with `default allow = false`), or `OidcPolicyConfig.RegoFile`.
Client-only fields (`scope`, `timeout`) and server-only fields (`jwksTtl`,
`claimCacheTtl`, `policy`) are ignored by the other side.

From a config file — `SlimBindings.newConfigFromJson` accepts a full gRPC client config,
covering TLS material, backoff, and every authentication mode. The examples read the same
document from `SLIM_CLIENT_CONFIG`:

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
[slim](https://github.com/agntcy/slim) repo.

### Creating Sessions

```java
Name remoteName = new Name("org", "namespace", "remote");

// Create point-to-point session
SessionConfig sessionConfig = new SessionConfig(
    SessionType.POINT_TO_POINT,
    null,  // maxRetries
    null,  // interval
    Map.of(),  // metadata
    new MlsSettings(100, null) // mlsSettings: headerIntegrityValidationPercent, maxSeenControlMessageIdsSize (null to disable MLS)
);

Session session = app.createSessionAndWait(sessionConfig, remoteName);
```

### Sending Messages

```java
byte[] message = "Hello, SLIM!".getBytes();

// Publish and wait
session.publishAndWait(message, null, null);
```

### Receiving Messages

```java
Duration timeout = Duration.ofSeconds(30);
ReceivedMessage msg = session.getMessage(timeout);

System.out.println("Received: " + new String(msg.payload()));
```

### Async Methods (CompletableFuture)

Async variants (`*Async`) returning `CompletableFuture` are available for all operations. They can be a good choice when using **Virtual Threads** (Java 21+), where blocking is cheap and you can use `.get()` or `.join()` without tying up OS threads.

When using the **standard Java thread model** (OS threads) with async methods, consider increasing the common pool parallelism:

```bash
java -Djava.util.concurrent.ForkJoinPool.common.parallelism=16 -jar myapp.jar
```

## Available Tasks

Run `task` in the `java/` directory to see all available tasks:

```bash
task                      # List all tasks
task generate             # Generate Java bindings
task build                # Build Java code and create JAR
task install              # Install JAR to local Maven repository
task clean                # Clean build artifacts and generated code
task examples:server      # Run server example
task examples:p2p:alice   # Run P2P receiver
task examples:p2p:no-mls:bob  # Run P2P sender (examples:p2p:mls:bob with MLS)
task examples:group:*     # Run group examples
task examples:rpc:*       # Run slimrpc examples (server, client, group-client)
```

## Examples

See [examples/README.md](examples/README.md) for detailed example documentation.

## Platform Support

| Platform | Architecture | Status |
|----------|-------------|--------|
| macOS | x86_64 | ✅ Supported |
| macOS | aarch64 (M1/M2) | ✅ Supported |
| Linux | x86_64 | ✅ Supported |
| Linux | aarch64 | ✅ Supported |
| Windows | x86_64 | ✅ Supported |

## Resources

- [UniFFI Book](https://mozilla.github.io/uniffi-rs/)
- [uniffi-bindgen-java GitHub](https://github.com/IronCoreLabs/uniffi-bindgen-java)
- [Foreign Function & Memory API (JEP 442)](https://openjdk.org/jeps/442)
- [SLIM Project](https://github.com/agntcy/slim)

## License

Copyright AGNTCY Contributors (https://github.com/agntcy)

SPDX-License-Identifier: Apache-2.0
