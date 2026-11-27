// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Package common provides shared helper utilities for SLIM Go binding examples.
//
// This package provides:
//   - Identity string parsing (org/namespace/app)
//   - App creation and connection helper
//   - Default configuration values
package common

import (
	"errors"
	"flag"
	"fmt"
	"os"

	slim "github.com/agntcy/slim-bindings-go"
)

// Default configuration values
const (
	DefaultServerEndpoint = "http://localhost:46357"
	DefaultSharedSecret   = "my_shared_secret_for_testing_purposes_only"
)

// ServerEndpoint returns the SLIM server endpoint.
// It checks the SLIM_ADDR environment variable first, falling back to DefaultServerEndpoint.
func ServerEndpoint() string {
	if addr := os.Getenv("SLIM_ADDR"); addr != "" {
		return addr
	}
	return DefaultServerEndpoint
}

// ClientConfig builds the gRPC client configuration used to reach the SLIM server.
//
// When SLIM_CLIENT_CONFIG points at a JSON file, that file supplies the whole
// configuration and serverAddr is ignored. This is how the examples reach settings
// with no dedicated flag - TLS material, backoff, rate limiting, and every
// authentication mode, including OIDC:
//
//	{
//	  "endpoint": "http://localhost:46357",
//	  "tls": {"insecure": true},
//	  "auth": {"type": "oidc", "issuer_url": "https://auth.example.com",
//	           "client_id": "my-client", "client_secret": "s3cr3t"}
//	}
//
// The schema matches data-plane/core/config/src/grpc/schema/client-config.schema.json
// in the slim repo. Without the variable an insecure (no TLS) config for serverAddr
// is returned.
func ClientConfig(serverAddr string) (slim.ClientConfig, error) {
	path := os.Getenv("SLIM_CLIENT_CONFIG")
	if path == "" {
		return slim.NewInsecureClientConfig(serverAddr), nil
	}

	jsonText, err := os.ReadFile(path)
	if err != nil {
		return slim.ClientConfig{}, fmt.Errorf("read slim client config %q: %w", path, err)
	}

	config, err := slim.NewConfigFromJson(string(jsonText))
	if err != nil {
		return slim.ClientConfig{}, fmt.Errorf("invalid slim client config JSON (%s): %w", path, err)
	}
	return config, nil
}

// EffectiveEndpoint reports the endpoint [ClientConfig] will actually dial, so log
// lines stay truthful when SLIM_CLIENT_CONFIG overrides serverAddr. Falls back to
// serverAddr if the config cannot be read - the connect attempt reports the real error.
func EffectiveEndpoint(serverAddr string) string {
	config, err := ClientConfig(serverAddr)
	if err != nil {
		return serverAddr
	}
	return config.Endpoint
}

// Identity is how an example app authenticates: a shared secret, or a did:key.
type Identity struct {
	// SharedSecret is used when PrivateKey is empty. Every app of the mesh uses the
	// same one (min 32 chars).
	SharedSecret string
	// PrivateKey is the path of the app's Ed25519 private key, a PKCS#8 PEM document
	// (as `openssl genpkey -algorithm ed25519` writes). The app's identity is the
	// did:key of this key. testdata/did_key/generate-keys.sh generates keys.
	PrivateKey string
	// TrustedKeys is the path of the JWKS of the keys the app accepts, one OKP Ed25519
	// JWK per app. It has to list the app's own key too.
	TrustedKeys string
}

// IdentityFlags registers the -shared-secret, -private-key and -trusted-keys flags.
// Read the returned Identity after flag.Parse.
func IdentityFlags() *Identity {
	id := &Identity{}
	flag.StringVar(&id.SharedSecret, "shared-secret", DefaultSharedSecret, "Shared secret (min 32 chars), unless -private-key is set")
	flag.StringVar(&id.PrivateKey, "private-key", "", "did:key identity: file with the app's Ed25519 private key (PKCS#8 PEM)")
	flag.StringVar(&id.TrustedKeys, "trusted-keys", "", "did:key identity: file with the JWKS of the keys the app accepts, its own included")
	return id
}

// createApp creates the app on the global service with the chosen identity.
func (id *Identity) createApp(appName *slim.Name) (*slim.App, error) {
	if id.PrivateKey == "" && id.TrustedKeys == "" {
		fmt.Println("Identity: shared secret")
		return slim.GetGlobalService().CreateAppWithSecret(appName, id.SharedSecret)
	}
	if id.PrivateKey == "" || id.TrustedKeys == "" {
		return nil, errors.New("a did:key identity needs both -private-key and -trusted-keys")
	}
	privateKey, err := os.ReadFile(id.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("read private key: %w", err)
	}
	trustedKeys, err := os.ReadFile(id.TrustedKeys)
	if err != nil {
		return nil, fmt.Errorf("read trusted keys: %w", err)
	}
	did, err := slim.DidKeyOfPrivateKey(string(privateKey))
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}
	fmt.Printf("Identity: %s\n", did)
	// The app signs with the private key and accepts the peers whose keys are in the
	// trust anchor.
	return slim.GetGlobalService().CreateAppWithDidKey(appName, string(privateKey), string(trustedKeys), slim.DirectionBidirectional)
}

// CreateAndConnectApp creates a SLIM app with shared secret authentication
// and connects it to a SLIM server. See CreateAndConnectAppWithIdentity.
func CreateAndConnectApp(localID, serverAddr, secret string) (*slim.App, uint64, error) {
	return CreateAndConnectAppWithIdentity(localID, serverAddr, &Identity{SharedSecret: secret})
}

// CreateAndConnectAppWithIdentity creates a SLIM app with the given identity
// and connects it to a SLIM server.
//
// This is a convenience function that combines:
//   - Crypto initialization
//   - App creation with a shared secret or a did:key
//   - Server connection with TLS settings
//
// Args:
//
//	localID: Local identity string (org/namespace/app format)
//	serverAddr: SLIM server endpoint URL (ignored when SLIM_CLIENT_CONFIG is set)
//	id: How the app authenticates
//
// Returns:
//
//	*slim.App: Created and connected app instance
//	uint64: Connection ID returned by the server
//	error: If creation or connection fails
func CreateAndConnectAppWithIdentity(localID, serverAddr string, id *Identity) (*slim.App, uint64, error) {
	// Initialize crypto, runtime, global service and logging with defaults
	slim.InitializeWithDefaults()

	// Parse the local identity string
	appName, err := slim.NameFromString(localID)
	if err != nil {
		return nil, 0, fmt.Errorf("invalid local ID: %w", err)
	}

	app, err := id.createApp(appName)
	if err != nil {
		return nil, 0, fmt.Errorf("create app failed: %w", err)
	}

	// Connect to SLIM server (returns connection ID)
	config, err := ClientConfig(serverAddr)
	if err != nil {
		app.Destroy()
		return nil, 0, err
	}
	connID, err := slim.GetGlobalService().ConnectAsync(config)
	if err != nil {
		app.Destroy()
		return nil, 0, fmt.Errorf("connect failed: %w", err)
	}

	// Forward subscription to next node
	err = app.SubscribeAsync(app.Name(), &connID)
	if err != nil {
		app.Destroy()
		return nil, 0, fmt.Errorf("subscribe failed: %w", err)
	}

	return app, connID, nil
}
