// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for OIDC transport authentication on gRPC client/server configs.
 *
 * These cross the FFI boundary only — no identity provider, server, or network is
 * involved. The valuable direction is the JSON parse: lifting a core
 * AuthenticationConfig::Oidc back into the bindings used to silently degrade to
 * None on the client and panic on the server.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

// @ts-expect-error - tsx resolves .js imports to .ts files at runtime; generated module has default export at runtime
import * as slimBindings from '../generated/index.js';

const ISSUER_URL = 'https://auth.example.com';
const CEL_POLICY = '"admin" in claims.groups';
const REGO_FILE_PATH = '/etc/slim/policy.rego';

/** An OidcConfig with every field populated, including the three duration fields. */
function fullOidcConfig(): any {
  return {
    issuerUrl: ISSUER_URL,
    clientId: 'my-client',
    clientSecret: 's3cr3t',
    audience: 'slim',
    refreshToken: 'refresh-token',
    refreshTokenFile: '/tmp/refresh-token',
    accessTokenFile: '/tmp/access-token',
    scope: 'openid profile',
    timeout: 30_000,
    jwksTtl: 3_600_000,
    claimCacheTtl: 60_000,
    policy: new slimBindings.OidcPolicyConfig.Cel({ expression: CEL_POLICY }),
  };
}

describe('OIDC transport authentication', () => {
  test('client config with OIDC round trips every field', () => {
    const config = slimBindings.newInsecureClientConfig('http://127.0.0.1:46357');
    config.auth = new slimBindings.ClientAuthenticationConfig.Oidc({ config: fullOidcConfig() });

    assert.strictEqual(config.auth.tag, slimBindings.ClientAuthenticationConfig_Tags.Oidc);
    const oidc = config.auth.inner.config;

    assert.strictEqual(oidc.issuerUrl, ISSUER_URL);
    assert.strictEqual(oidc.clientId, 'my-client');
    assert.strictEqual(oidc.clientSecret, 's3cr3t');
    assert.strictEqual(oidc.audience, 'slim');
    assert.strictEqual(oidc.refreshToken, 'refresh-token');
    assert.strictEqual(oidc.refreshTokenFile, '/tmp/refresh-token');
    assert.strictEqual(oidc.accessTokenFile, '/tmp/access-token');
    assert.strictEqual(oidc.scope, 'openid profile');
    assert.strictEqual(oidc.timeout, 30_000);
    assert.strictEqual(oidc.jwksTtl, 3_600_000);
    assert.strictEqual(oidc.claimCacheTtl, 60_000);
    assert.strictEqual(oidc.policy.tag, slimBindings.OidcPolicyConfig_Tags.Cel);
    assert.strictEqual(oidc.policy.inner.expression, CEL_POLICY);
  });

  test('server config with OIDC round trips JWKS settings and policy', () => {
    const config = slimBindings.newInsecureServerConfig('127.0.0.1:46357');
    config.auth = new slimBindings.ServerAuthenticationConfig.Oidc({
      config: {
        issuerUrl: ISSUER_URL,
        audience: 'slim',
        jwksTtl: 3_600_000,
        policy: new slimBindings.OidcPolicyConfig.RegoFile({ path: REGO_FILE_PATH }),
      },
    });

    assert.strictEqual(config.auth.tag, slimBindings.ServerAuthenticationConfig_Tags.Oidc);
    const oidc = config.auth.inner.config;
    assert.strictEqual(oidc.audience, 'slim');
    assert.strictEqual(oidc.jwksTtl, 3_600_000);
    assert.strictEqual(oidc.policy.tag, slimBindings.OidcPolicyConfig_Tags.RegoFile);
    assert.strictEqual(oidc.policy.inner.path, REGO_FILE_PATH);
  });

  test('every policy variant round trips', () => {
    const policies = [
      new slimBindings.OidcPolicyConfig.Rego({ text: 'package slim.auth\ndefault allow = false' }),
      new slimBindings.OidcPolicyConfig.RegoFile({ path: REGO_FILE_PATH }),
      new slimBindings.OidcPolicyConfig.Cel({ expression: CEL_POLICY }),
    ];

    for (const policy of policies) {
      const config = slimBindings.newInsecureServerConfig('127.0.0.1:46357');
      config.auth = new slimBindings.ServerAuthenticationConfig.Oidc({
        config: { ...fullOidcConfig(), policy },
      });

      const readBack = config.auth.inner.config.policy;
      assert.strictEqual(readBack.tag, policy.tag, `policy tag ${policy.tag} did not round trip`);
      assert.deepStrictEqual(readBack.inner, policy.inner);
    }
  });

  test('newConfigFromJson lifts OIDC auth', () => {
    const json = JSON.stringify({
      endpoint: 'http://127.0.0.1:46357',
      tls: { insecure: true },
      auth: {
        type: 'oidc',
        issuer_url: ISSUER_URL,
        client_id: 'my-client',
        client_secret: 's3cr3t',
        audience: 'slim',
        policy: { cel: CEL_POLICY },
      },
    });

    const config = slimBindings.newConfigFromJson(json);

    assert.strictEqual(config.auth.tag, slimBindings.ClientAuthenticationConfig_Tags.Oidc);
    const oidc = config.auth.inner.config;
    assert.strictEqual(oidc.issuerUrl, ISSUER_URL);
    assert.strictEqual(oidc.clientId, 'my-client');
    assert.strictEqual(oidc.policy.tag, slimBindings.OidcPolicyConfig_Tags.Cel);
    assert.strictEqual(oidc.policy.inner.expression, CEL_POLICY);
  });

  test('newConfigFromJson rejects an invalid config', () => {
    assert.throws(() => slimBindings.newConfigFromJson(JSON.stringify({ nope: true })));
  });
});
