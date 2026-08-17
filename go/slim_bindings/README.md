# SLIM Go Bindings

Get started with SLIM Go bindings in just a few minutes.

## Prerequisites

- [Go](https://go.dev/doc/install) 1.22 or later
- Internet connection to download dependencies

## Quick Start

### 1. Create a New Project

```bash
mkdir -p go-app
cd go-app
go mod init go-app
```

### 2. Install SLIM Go Bindings

```bash
go get github.com/agntcy/slim-bindings-go
```

### 3. Run the Setup Tool

The SLIM bindings require some additional setup to install the bindings libs. Run the setup command:

```bash
go run github.com/agntcy/slim-bindings-go/cmd/slim-bindings-setup
```

### 4. Create Your First SLIM Application

Create a `main.go` file with the following content:

```go
package main

import (
	"fmt"

	slim "github.com/agntcy/slim-bindings-go"
)

func main() {
	fmt.Println("🚀 SLIM Go Bindings Example")
	fmt.Println("============================")

	// Initialize crypto provider (required before any operations)
	slim.InitializeCryptoProvider()
	fmt.Println("✅ Crypto initialized")

	// Your SLIM code here...
}
```

### 5. Run Your Application

```bash
go run main.go
```

You should see:

```
🚀 SLIM Go Bindings Example
============================
✅ Crypto initialized
```

## Transport Authentication (gRPC connection)

Separate from the app identity passed to `CreateAppWithSecret` and friends, the gRPC
connection to a SLIM node can carry its own credentials via `ClientConfig.Auth` (and
`ServerConfig.Auth` when hosting). Supported modes are `Basic`, `StaticJwt`, `Jwt`,
`Spire`, and `Oidc`.

**OIDC**, client side (client-credentials flow):

```go
timeout := 30 * time.Second
var auth slim.ClientAuthenticationConfig = slim.ClientAuthenticationConfigOidc{
	Config: slim.OidcConfig{
		IssuerUrl:    "https://auth.example.com",
		ClientId:     ptr("my-client"),
		ClientSecret: ptr("s3cr3t"),
		Scope:        ptr("openid profile"),
		Timeout:      &timeout,
	},
}

config := slim.NewInsecureClientConfig("http://127.0.0.1:46357")
config.Auth = &auth
connID, err := slim.GetGlobalService().ConnectAsync(config)
```

(`ptr` is any `func[T any](v T) *T` helper; the optional fields are pointers.) For the
refresh-token flow set `RefreshToken` — or `RefreshTokenFile`, which is rewritten in place
as tokens rotate — instead of `ClientSecret`.

**Server side**, verifying incoming JWTs against the issuer's JWKS endpoint, optionally
restricting access by claim:

```go
jwksTTL := time.Hour
var policy slim.OidcPolicyConfig = slim.OidcPolicyConfigCel{Expression: `"admin" in claims.groups`}
var auth slim.ServerAuthenticationConfig = slim.ServerAuthenticationConfigOidc{
	Config: slim.OidcConfig{
		IssuerUrl: "https://auth.example.com",
		Audience:  ptr("slim"), // required for verification
		JwksTtl:   &jwksTTL,
		Policy:    &policy,
	},
}

config := slim.NewInsecureServerConfig("127.0.0.1:46357")
config.Auth = &auth
```

`Policy` accepts `OidcPolicyConfigCel`, `OidcPolicyConfigRego` (which must define
`package slim.auth` with `default allow = false`), or `OidcPolicyConfigRegoFile`.
Client-only fields (`Scope`, `Timeout`) and server-only fields (`JwksTtl`,
`ClaimCacheTtl`, `Policy`) are ignored by the other side.

**From a config file** — `slim.NewConfigFromJson` accepts a full gRPC client config,
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

The schema matches `data-plane/core/config/src/grpc/schema/client-config.schema.json` in the
[slim](https://github.com/agntcy/slim) repo.

## Important Notes

- **Setup is one-time**: You only need to run `slim-bindings-setup` once
- **Native dependencies**: The bindings use native libraries under the hood via [CGO](https://go.dev/wiki/cgo), so a C compiler is required

## slimrpc (SLIM Remote Procedure Call)

For information about using slimrpc to build protobuf-based RPC services over SLIM, see the [SLIMRPC documentation](SLIMRPC.md).
