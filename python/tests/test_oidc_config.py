# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Tests for OIDC transport authentication on gRPC client/server configs.

These exercise the FFI boundary only - no identity provider or network is
involved. The valuable direction is the JSON parse: lifting a core
AuthenticationConfig::Oidc back into the bindings used to silently degrade to
None on the client and panic on the server.
"""

import datetime
import json

import pytest

import slim_bindings

ISSUER_URL = "https://auth.example.com"
CEL_POLICY = '"admin" in claims.groups'


def full_oidc_config() -> slim_bindings.OidcConfig:
    """An OidcConfig with every field populated, including the three durations."""
    return slim_bindings.OidcConfig(
        issuer_url=ISSUER_URL,
        client_id="my-client",
        client_secret="s3cr3t",
        audience="slim",
        refresh_token="refresh-token",
        refresh_token_file="/tmp/refresh-token",
        access_token_file="/tmp/access-token",
        scope="openid profile",
        timeout=datetime.timedelta(seconds=30),
        jwks_ttl=datetime.timedelta(hours=1),
        claim_cache_ttl=datetime.timedelta(minutes=1),
        policy=slim_bindings.OidcPolicyConfig.CEL(expression=CEL_POLICY),  # type: ignore[attr-defined,arg-type]
    )


def test_client_config_with_oidc_round_trips():
    """Every field survives being attached to a ClientConfig."""
    auth = slim_bindings.ClientAuthenticationConfig.OIDC(config=full_oidc_config())  # type: ignore[attr-defined]
    base = slim_bindings.new_insecure_client_config("http://127.0.0.1:46357")
    config = slim_bindings.ClientConfig(**{**vars(base), "auth": auth})

    assert config.auth.is_OIDC()
    oidc = config.auth.config
    assert oidc.issuer_url == ISSUER_URL
    assert oidc.client_id == "my-client"
    assert oidc.client_secret == "s3cr3t"
    assert oidc.audience == "slim"
    assert oidc.refresh_token == "refresh-token"
    assert oidc.refresh_token_file == "/tmp/refresh-token"
    assert oidc.access_token_file == "/tmp/access-token"
    assert oidc.scope == "openid profile"
    assert oidc.timeout == datetime.timedelta(seconds=30)
    assert oidc.jwks_ttl == datetime.timedelta(hours=1)
    assert oidc.claim_cache_ttl == datetime.timedelta(minutes=1)
    assert oidc.policy.expression == CEL_POLICY


def test_server_config_with_oidc_round_trips():
    """Server-side OIDC (JWKS verification plus policy) is constructible."""
    oidc = slim_bindings.OidcConfig(
        issuer_url=ISSUER_URL,
        client_id=None,
        client_secret=None,
        audience="slim",
        refresh_token=None,
        refresh_token_file=None,
        access_token_file=None,
        scope=None,
        timeout=None,
        jwks_ttl=datetime.timedelta(hours=1),
        claim_cache_ttl=None,
        policy=slim_bindings.OidcPolicyConfig.REGO_FILE(path="/etc/slim/policy.rego"),  # type: ignore[attr-defined]
    )
    auth = slim_bindings.ServerAuthenticationConfig.OIDC(config=oidc)  # type: ignore[attr-defined]
    base = slim_bindings.new_insecure_server_config("127.0.0.1:46357")
    config = slim_bindings.ServerConfig(**{**vars(base), "auth": auth})

    assert config.auth.is_OIDC()
    assert config.auth.config.audience == "slim"
    assert config.auth.config.jwks_ttl == datetime.timedelta(hours=1)
    assert config.auth.config.policy.path == "/etc/slim/policy.rego"


@pytest.mark.parametrize(
    "policy,attribute,value",
    [
        (
            slim_bindings.OidcPolicyConfig.REGO,  # type: ignore[attr-defined]
            "text",
            "package slim.auth\ndefault allow = false",
        ),
        (
            slim_bindings.OidcPolicyConfig.REGO_FILE,  # type: ignore[attr-defined]
            "path",
            "/etc/slim/policy.rego",
        ),
        (
            slim_bindings.OidcPolicyConfig.CEL,  # type: ignore[attr-defined]
            "expression",
            CEL_POLICY,
        ),
    ],
)
def test_every_policy_variant_round_trips(policy, attribute, value):
    """Each policy variant keeps its payload across the FFI boundary."""
    oidc = slim_bindings.OidcConfig(
        issuer_url=ISSUER_URL,
        client_id=None,
        client_secret=None,
        audience="slim",
        refresh_token=None,
        refresh_token_file=None,
        access_token_file=None,
        scope=None,
        timeout=None,
        jwks_ttl=None,
        claim_cache_ttl=None,
        policy=policy(**{attribute: value}),
    )
    auth = slim_bindings.ServerAuthenticationConfig.OIDC(config=oidc)  # type: ignore[attr-defined]
    base = slim_bindings.new_insecure_server_config("127.0.0.1:46357")
    config = slim_bindings.ServerConfig(**{**vars(base), "auth": auth})

    assert getattr(config.auth.config.policy, attribute) == value


def test_new_config_from_json_lifts_oidc_auth():
    """Parsing core config JSON yields an OIDC variant, not None."""
    config = slim_bindings.new_config_from_json(
        json.dumps(
            {
                "endpoint": "http://127.0.0.1:46357",
                "tls": {"insecure": True},
                "auth": {
                    "type": "oidc",
                    "issuer_url": ISSUER_URL,
                    "client_id": "my-client",
                    "client_secret": "s3cr3t",
                    "audience": "slim",
                    "policy": {"cel": CEL_POLICY},
                },
            }
        )
    )

    assert config.auth.is_OIDC()
    assert config.auth.config.issuer_url == ISSUER_URL
    assert config.auth.config.client_id == "my-client"
    assert config.auth.config.policy.expression == CEL_POLICY


def test_new_config_from_json_rejects_invalid_config():
    with pytest.raises(slim_bindings.SlimError.ConfigError):  # type: ignore[attr-defined]
        slim_bindings.new_config_from_json(json.dumps({"nope": True}))
