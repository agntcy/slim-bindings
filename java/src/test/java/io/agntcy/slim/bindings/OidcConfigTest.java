// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package io.agntcy.slim.bindings;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.time.Duration;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for OIDC transport authentication on gRPC client/server configurations.
 *
 * These tests exercise:
 * - A fully populated OidcConfig, including the three java.time.Duration fields
 * - Attaching it as ClientAuthenticationConfig.Oidc and
 * ServerAuthenticationConfig.Oidc
 * - All three OidcPolicyConfig variants (Rego, RegoFile, Cel)
 * - Parsing core client-config JSON whose auth is OIDC, the direction that used
 * to degrade to None on the client and panic on the server
 *
 * No identity provider or network is involved: only the FFI boundary is crossed.
 */
class OidcConfigTest {

  private static final String ISSUER_URL = "https://auth.example.com";
  private static final String CEL_POLICY = "\"admin\" in claims.groups";
  private static final String REGO_FILE_PATH = "/etc/slim/policy.rego";

  /** An OidcConfig with every field populated. */
  private static OidcConfig fullOidcConfig() {
    return new OidcConfig(
        ISSUER_URL,
        "my-client",
        "s3cr3t",
        "slim",
        "refresh-token",
        "/tmp/refresh-token",
        "/tmp/access-token",
        "openid profile",
        Duration.ofSeconds(30),
        Duration.ofHours(1),
        Duration.ofMinutes(1),
        new OidcPolicyConfig.Cel(CEL_POLICY));
  }

  @Test
  void clientConfigWithOidcRoundTripsEveryField() {
    ClientConfig config = SlimBindings.newInsecureClientConfig("http://127.0.0.1:46357");
    config.setAuth(new ClientAuthenticationConfig.Oidc(fullOidcConfig()));

    assertInstanceOf(ClientAuthenticationConfig.Oidc.class, config.auth());
    OidcConfig oidc = ((ClientAuthenticationConfig.Oidc) config.auth()).config();

    assertEquals(ISSUER_URL, oidc.issuerUrl());
    assertEquals("my-client", oidc.clientId());
    assertEquals("s3cr3t", oidc.clientSecret());
    assertEquals("slim", oidc.audience());
    assertEquals("refresh-token", oidc.refreshToken());
    assertEquals("/tmp/refresh-token", oidc.refreshTokenFile());
    assertEquals("/tmp/access-token", oidc.accessTokenFile());
    assertEquals("openid profile", oidc.scope());
    assertEquals(Duration.ofSeconds(30), oidc.timeout());
    assertEquals(Duration.ofHours(1), oidc.jwksTtl());
    assertEquals(Duration.ofMinutes(1), oidc.claimCacheTtl());
    assertEquals(new OidcPolicyConfig.Cel(CEL_POLICY), oidc.policy());
  }

  @Test
  void serverConfigWithOidcRoundTripsJwksSettingsAndPolicy() {
    ServerConfig config = SlimBindings.newInsecureServerConfig("127.0.0.1:46357");
    config.setAuth(new ServerAuthenticationConfig.Oidc(new OidcConfig(
        ISSUER_URL,
        null,
        null,
        "slim",
        null,
        null,
        null,
        null,
        null,
        Duration.ofHours(1),
        null,
        new OidcPolicyConfig.RegoFile(REGO_FILE_PATH))));

    assertInstanceOf(ServerAuthenticationConfig.Oidc.class, config.auth());
    OidcConfig oidc = ((ServerAuthenticationConfig.Oidc) config.auth()).config();

    assertEquals("slim", oidc.audience());
    assertEquals(Duration.ofHours(1), oidc.jwksTtl());
    assertEquals(new OidcPolicyConfig.RegoFile(REGO_FILE_PATH), oidc.policy());
    assertNull(oidc.claimCacheTtl());
  }

  private static Stream<OidcPolicyConfig> policyVariants() {
    return Stream.of(
        new OidcPolicyConfig.Rego("package slim.auth\ndefault allow = false"),
        new OidcPolicyConfig.RegoFile(REGO_FILE_PATH),
        new OidcPolicyConfig.Cel(CEL_POLICY));
  }

  @ParameterizedTest
  @MethodSource("policyVariants")
  void everyPolicyVariantRoundTrips(OidcPolicyConfig policy) {
    OidcConfig oidc = fullOidcConfig();
    oidc.setPolicy(policy);

    ServerConfig config = SlimBindings.newInsecureServerConfig("127.0.0.1:46357");
    config.setAuth(new ServerAuthenticationConfig.Oidc(oidc));

    OidcConfig readBack = ((ServerAuthenticationConfig.Oidc) config.auth()).config();
    assertEquals(policy, readBack.policy());
  }

  @Test
  void newConfigFromJsonLiftsOidcAuth() throws SlimException {
    String json = """
        {
          "endpoint": "http://127.0.0.1:46357",
          "tls": {"insecure": true},
          "auth": {
            "type": "oidc",
            "issuer_url": "https://auth.example.com",
            "client_id": "my-client",
            "client_secret": "s3cr3t",
            "audience": "slim",
            "policy": {"cel": "\\"admin\\" in claims.groups"}
          }
        }
        """;

    ClientConfig config = SlimBindings.newConfigFromJson(json);

    assertInstanceOf(ClientAuthenticationConfig.Oidc.class, config.auth());
    OidcConfig oidc = ((ClientAuthenticationConfig.Oidc) config.auth()).config();
    assertEquals(ISSUER_URL, oidc.issuerUrl());
    assertEquals("my-client", oidc.clientId());
    assertEquals(new OidcPolicyConfig.Cel(CEL_POLICY), oidc.policy());
  }

  @Test
  void newConfigFromJsonRejectsInvalidConfig() {
    assertThrows(SlimException.class, () -> SlimBindings.newConfigFromJson("{\"nope\": true}"));
  }
}
