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

// CreateAndConnectApp creates a SLIM app with shared secret authentication
// and connects it to a SLIM server.
//
// This is a convenience function that combines:
//   - Crypto initialization
//   - App creation with shared secret
//   - Server connection with TLS settings
//
// Args:
//
//	localID: Local identity string (org/namespace/app format)
//	serverAddr: SLIM server endpoint URL (ignored when SLIM_CLIENT_CONFIG is set)
//	secret: Shared secret for authentication (min 32 chars)
//
// Returns:
//
//	*slim.BindingsAdapter: Created and connected app instance
//	uint64: Connection ID returned by the server
//	error: If creation or connection fails
func CreateAndConnectApp(localID, serverAddr, secret string) (*slim.App, uint64, error) {
	// Initialize crypto, runtime, global service and logging with defaults
	slim.InitializeWithDefaults()

	// Parse the local identity string
	appName, err := slim.NameFromString(localID)
	if err != nil {
		return nil, 0, fmt.Errorf("invalid local ID: %w", err)
	}

	// Create app with shared secret authentication
	app, err := slim.GetGlobalService().CreateAppWithSecret(appName, secret)
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
