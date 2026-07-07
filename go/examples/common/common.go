// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Package common provides shared helper utilities for SLIM Go binding examples.
//
// This package provides:
//   - Identity string parsing (org/namespace/app)
//   - App creation and connection helper
//   - Hierarchical config discovery via slim.yaml / env vars
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
//	serverAddr: SLIM server endpoint URL
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
	config := slim.NewInsecureClientConfig(serverAddr)
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

// CreateAndConnectAppFromConfig builds a ready App using hierarchical config discovery.
//
// Config is loaded from slim.yaml (walking up from the current working directory) and/or
// ~/.slim/config.yaml, with environment variables taking highest priority.
// The app name and a stable instance UUID are read from (or written to) the .slim-cache/
// directory next to the discovered config file.
//
// Requires app.name to be set in the config or via SLIM_APP_NAME.
//
// Returns:
//
//	*slim.App: Created, connected, and subscribed app instance
//	error: If config loading, connection, or subscription fails
func CreateAndConnectAppFromConfig() (*slim.App, error) {
	slim.InitializeWithDefaults()

	config, err := slim.LoadSlimConfig()
	if err != nil {
		return nil, fmt.Errorf("load slim config: %w", err)
	}

	app, err := slim.GetGlobalService().CreateAppFromSlimConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create app from config: %w", err)
	}

	return app, nil
}
