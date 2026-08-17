// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package common

import (
	"os"
	"path/filepath"
	"testing"

	slim "github.com/agntcy/slim-bindings-go"
)

// oidcClientConfigJSON is a full gRPC client config whose transport auth is OIDC.
// It doubles as the documented example in the README.
const oidcClientConfigJSON = `{
	"endpoint": "http://127.0.0.1:46357",
	"tls": {"insecure": true},
	"auth": {
		"type": "oidc",
		"issuer_url": "https://auth.example.com",
		"client_id": "my-client",
		"client_secret": "s3cr3t",
		"audience": "slim",
		"policy": {"cel": "\"admin\" in claims.groups"}
	}
}`

func writeConfig(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "client-config.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}

// TestClientConfigFromEnvFile verifies SLIM_CLIENT_CONFIG supplies the whole
// configuration - including OIDC transport auth - and overrides the endpoint arg.
func TestClientConfigFromEnvFile(t *testing.T) {
	t.Setenv("SLIM_CLIENT_CONFIG", writeConfig(t, oidcClientConfigJSON))

	config, err := ClientConfig("http://ignored:1")
	if err != nil {
		t.Fatalf("ClientConfig failed: %v", err)
	}

	if config.Endpoint != "http://127.0.0.1:46357" {
		t.Errorf("Endpoint = %q, want the value from the config file", config.Endpoint)
	}
	if config.Auth == nil {
		t.Fatal("Auth should be populated from the config file")
	}
	oidc, ok := (*config.Auth).(slim.ClientAuthenticationConfigOidc)
	if !ok {
		t.Fatalf("expected ClientAuthenticationConfigOidc, got %T", *config.Auth)
	}
	if oidc.Config.IssuerUrl != "https://auth.example.com" {
		t.Errorf("IssuerUrl = %q, want %q", oidc.Config.IssuerUrl, "https://auth.example.com")
	}
}

// TestClientConfigWithoutEnv verifies the default branch builds an insecure config
// for the supplied endpoint.
func TestClientConfigWithoutEnv(t *testing.T) {
	t.Setenv("SLIM_CLIENT_CONFIG", "")

	config, err := ClientConfig("http://127.0.0.1:9999")
	if err != nil {
		t.Fatalf("ClientConfig failed: %v", err)
	}
	if config.Endpoint != "http://127.0.0.1:9999" {
		t.Errorf("Endpoint = %q, want the supplied address", config.Endpoint)
	}
}

// TestClientConfigSurfacesErrors verifies a bad SLIM_CLIENT_CONFIG fails loudly
// rather than silently falling back to an unauthenticated connection.
func TestClientConfigSurfacesErrors(t *testing.T) {
	t.Run("missing file", func(t *testing.T) {
		t.Setenv("SLIM_CLIENT_CONFIG", filepath.Join(t.TempDir(), "absent.json"))
		if _, err := ClientConfig("http://127.0.0.1:9999"); err == nil {
			t.Error("expected an error for a missing config file")
		}
	})

	t.Run("invalid contents", func(t *testing.T) {
		t.Setenv("SLIM_CLIENT_CONFIG", writeConfig(t, `{"nope": true}`))
		if _, err := ClientConfig("http://127.0.0.1:9999"); err == nil {
			t.Error("expected an error for an invalid config file")
		}
	})
}
