// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package tests

import (
	"testing"
	"time"

	slim "github.com/agntcy/slim-bindings-go"
)

const (
	oidcIssuerURL = "https://auth.example.com"
	oidcCelPolicy = `"admin" in claims.groups`
)

func strPtr(s string) *string               { return &s }
func durPtr(d time.Duration) *time.Duration { return &d }

// fullOidcConfig returns an OidcConfig with every field populated, including the
// three duration fields most likely to break in a generator upgrade.
func fullOidcConfig() slim.OidcConfig {
	var policy slim.OidcPolicyConfig = slim.OidcPolicyConfigCel{Expression: oidcCelPolicy}
	return slim.OidcConfig{
		IssuerUrl:        oidcIssuerURL,
		ClientId:         strPtr("my-client"),
		ClientSecret:     strPtr("s3cr3t"),
		Audience:         strPtr("slim"),
		RefreshToken:     strPtr("refresh-token"),
		RefreshTokenFile: strPtr("/tmp/refresh-token"),
		AccessTokenFile:  strPtr("/tmp/access-token"),
		Scope:            strPtr("openid profile"),
		Timeout:          durPtr(30 * time.Second),
		JwksTtl:          durPtr(time.Hour),
		ClaimCacheTtl:    durPtr(time.Minute),
		Policy:           &policy,
	}
}

// TestClientConfigWithOidc verifies every OIDC field survives being attached to a
// ClientConfig and crossing the FFI boundary.
func TestClientConfigWithOidc(t *testing.T) {
	var auth slim.ClientAuthenticationConfig = slim.ClientAuthenticationConfigOidc{Config: fullOidcConfig()}

	config := slim.NewInsecureClientConfig("http://127.0.0.1:46357")
	config.Auth = &auth

	oidcAuth, ok := (*config.Auth).(slim.ClientAuthenticationConfigOidc)
	if !ok {
		t.Fatalf("expected ClientAuthenticationConfigOidc, got %T", *config.Auth)
	}

	oidc := oidcAuth.Config
	if oidc.IssuerUrl != oidcIssuerURL {
		t.Errorf("IssuerUrl = %q, want %q", oidc.IssuerUrl, oidcIssuerURL)
	}
	if *oidc.ClientId != "my-client" {
		t.Errorf("ClientId = %q, want %q", *oidc.ClientId, "my-client")
	}
	if *oidc.Scope != "openid profile" {
		t.Errorf("Scope = %q, want %q", *oidc.Scope, "openid profile")
	}
	if *oidc.Timeout != 30*time.Second {
		t.Errorf("Timeout = %v, want %v", *oidc.Timeout, 30*time.Second)
	}
	if *oidc.JwksTtl != time.Hour {
		t.Errorf("JwksTtl = %v, want %v", *oidc.JwksTtl, time.Hour)
	}
	if *oidc.ClaimCacheTtl != time.Minute {
		t.Errorf("ClaimCacheTtl = %v, want %v", *oidc.ClaimCacheTtl, time.Minute)
	}
	cel, ok := (*oidc.Policy).(slim.OidcPolicyConfigCel)
	if !ok {
		t.Fatalf("expected OidcPolicyConfigCel, got %T", *oidc.Policy)
	}
	if cel.Expression != oidcCelPolicy {
		t.Errorf("policy expression = %q, want %q", cel.Expression, oidcCelPolicy)
	}
}

// TestServerConfigWithOidc verifies server-side OIDC (JWKS verification plus a
// policy) is constructible from Go.
func TestServerConfigWithOidc(t *testing.T) {
	var policy slim.OidcPolicyConfig = slim.OidcPolicyConfigRegoFile{Path: "/etc/slim/policy.rego"}
	var auth slim.ServerAuthenticationConfig = slim.ServerAuthenticationConfigOidc{
		Config: slim.OidcConfig{
			IssuerUrl: oidcIssuerURL,
			Audience:  strPtr("slim"),
			JwksTtl:   durPtr(time.Hour),
			Policy:    &policy,
		},
	}

	config := slim.NewInsecureServerConfig("127.0.0.1:46357")
	config.Auth = &auth

	oidcAuth, ok := (*config.Auth).(slim.ServerAuthenticationConfigOidc)
	if !ok {
		t.Fatalf("expected ServerAuthenticationConfigOidc, got %T", *config.Auth)
	}
	if *oidcAuth.Config.Audience != "slim" {
		t.Errorf("Audience = %q, want %q", *oidcAuth.Config.Audience, "slim")
	}
	regoFile, ok := (*oidcAuth.Config.Policy).(slim.OidcPolicyConfigRegoFile)
	if !ok {
		t.Fatalf("expected OidcPolicyConfigRegoFile, got %T", *oidcAuth.Config.Policy)
	}
	if regoFile.Path != "/etc/slim/policy.rego" {
		t.Errorf("policy path = %q, want %q", regoFile.Path, "/etc/slim/policy.rego")
	}
}

// TestOidcPolicyVariants verifies each policy variant keeps its payload.
func TestOidcPolicyVariants(t *testing.T) {
	tests := []struct {
		name   string
		policy slim.OidcPolicyConfig
	}{
		{"rego", slim.OidcPolicyConfigRego{Text: "package slim.auth\ndefault allow = false"}},
		{"rego_file", slim.OidcPolicyConfigRegoFile{Path: "/etc/slim/policy.rego"}},
		{"cel", slim.OidcPolicyConfigCel{Expression: oidcCelPolicy}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			policy := tc.policy
			var auth slim.ServerAuthenticationConfig = slim.ServerAuthenticationConfigOidc{
				Config: slim.OidcConfig{
					IssuerUrl: oidcIssuerURL,
					Audience:  strPtr("slim"),
					Policy:    &policy,
				},
			}

			config := slim.NewInsecureServerConfig("127.0.0.1:46357")
			config.Auth = &auth

			oidcAuth := (*config.Auth).(slim.ServerAuthenticationConfigOidc)
			if *oidcAuth.Config.Policy != tc.policy {
				t.Errorf("policy = %#v, want %#v", *oidcAuth.Config.Policy, tc.policy)
			}
		})
	}
}

// TestNewConfigFromJsonLiftsOidc covers the core->bindings direction: parsing a
// gRPC client config whose auth is OIDC. This previously degraded to None.
func TestNewConfigFromJsonLiftsOidc(t *testing.T) {
	const configJSON = `{
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

	config, err := slim.NewConfigFromJson(configJSON)
	if err != nil {
		t.Fatalf("NewConfigFromJson failed: %v", err)
	}
	if config.Auth == nil {
		t.Fatal("Auth should not be nil for an OIDC config")
	}

	oidcAuth, ok := (*config.Auth).(slim.ClientAuthenticationConfigOidc)
	if !ok {
		t.Fatalf("expected ClientAuthenticationConfigOidc, got %T", *config.Auth)
	}
	if oidcAuth.Config.IssuerUrl != oidcIssuerURL {
		t.Errorf("IssuerUrl = %q, want %q", oidcAuth.Config.IssuerUrl, oidcIssuerURL)
	}
	cel, ok := (*oidcAuth.Config.Policy).(slim.OidcPolicyConfigCel)
	if !ok {
		t.Fatalf("expected OidcPolicyConfigCel, got %T", *oidcAuth.Config.Policy)
	}
	if cel.Expression != oidcCelPolicy {
		t.Errorf("policy expression = %q, want %q", cel.Expression, oidcCelPolicy)
	}
}

// TestNewConfigFromJsonRejectsInvalid verifies the error path surfaces as an error.
func TestNewConfigFromJsonRejectsInvalid(t *testing.T) {
	if _, err := slim.NewConfigFromJson(`{"nope": true}`); err == nil {
		t.Error("expected an error for an invalid client config")
	}
}
