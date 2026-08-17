// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package io.agntcy.slim.bindings

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.Duration
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Test: OIDC transport authentication on gRPC client/server configurations.
 *
 * Purpose:
 *   Validate that OIDC settings survive the FFI boundary in both directions, so a
 *   UniFFI or slim-core upgrade cannot silently drop fields.
 *
 * What is covered:
 *   * Construction of a fully populated OidcConfig, including the three
 *     java.time.Duration fields (timeout, jwksTtl, claimCacheTtl).
 *   * Attaching it as ClientAuthenticationConfig.Oidc and ServerAuthenticationConfig.Oidc.
 *   * All three OidcPolicyConfig variants (Rego, RegoFile, Cel).
 *   * Parsing core client-config JSON whose auth is OIDC - the direction that used
 *     to degrade to None on the client and panic on the server.
 *
 * Not supported:
 *   * Live token acquisition or JWKS verification; no identity provider is contacted.
 *
 * Pass criteria:
 *   Every field set on the way in reads back identically, and the parsed JSON yields
 *   an Oidc variant rather than None.
 */
class OidcConfigTest {

    private companion object {
        const val ISSUER_URL = "https://auth.example.com"
        const val CEL_POLICY = """"admin" in claims.groups"""
        const val REGO_FILE_PATH = "/etc/slim/policy.rego"
    }

    /** An OidcConfig with every field populated. */
    private fun fullOidcConfig() = OidcConfig(
        issuerUrl = ISSUER_URL,
        clientId = "my-client",
        clientSecret = "s3cr3t",
        audience = "slim",
        refreshToken = "refresh-token",
        refreshTokenFile = "/tmp/refresh-token",
        accessTokenFile = "/tmp/access-token",
        scope = "openid profile",
        timeout = Duration.ofSeconds(30),
        jwksTtl = Duration.ofHours(1),
        claimCacheTtl = Duration.ofMinutes(1),
        policy = OidcPolicyConfig.Cel(CEL_POLICY),
    )

    @Test
    fun `client config with OIDC round trips every field`() {
        val config = newInsecureClientConfig("http://127.0.0.1:46357").apply {
            auth = ClientAuthenticationConfig.Oidc(fullOidcConfig())
        }

        val oidc = (config.auth as ClientAuthenticationConfig.Oidc).config
        assertEquals(ISSUER_URL, oidc.issuerUrl)
        assertEquals("my-client", oidc.clientId)
        assertEquals("s3cr3t", oidc.clientSecret)
        assertEquals("slim", oidc.audience)
        assertEquals("refresh-token", oidc.refreshToken)
        assertEquals("/tmp/refresh-token", oidc.refreshTokenFile)
        assertEquals("/tmp/access-token", oidc.accessTokenFile)
        assertEquals("openid profile", oidc.scope)
        assertEquals(Duration.ofSeconds(30), oidc.timeout)
        assertEquals(Duration.ofHours(1), oidc.jwksTtl)
        assertEquals(Duration.ofMinutes(1), oidc.claimCacheTtl)
        assertEquals(OidcPolicyConfig.Cel(CEL_POLICY), oidc.policy)
    }

    @Test
    fun `server config with OIDC round trips JWKS settings and policy`() {
        val config = newInsecureServerConfig("127.0.0.1:46357").apply {
            auth = ServerAuthenticationConfig.Oidc(
                OidcConfig(
                    issuerUrl = ISSUER_URL,
                    clientId = null,
                    clientSecret = null,
                    audience = "slim",
                    refreshToken = null,
                    refreshTokenFile = null,
                    accessTokenFile = null,
                    scope = null,
                    timeout = null,
                    jwksTtl = Duration.ofHours(1),
                    claimCacheTtl = null,
                    policy = OidcPolicyConfig.RegoFile(REGO_FILE_PATH),
                )
            )
        }

        val oidc = (config.auth as ServerAuthenticationConfig.Oidc).config
        assertEquals("slim", oidc.audience)
        assertEquals(Duration.ofHours(1), oidc.jwksTtl)
        assertEquals(OidcPolicyConfig.RegoFile(REGO_FILE_PATH), oidc.policy)
        assertNull(oidc.claimCacheTtl)
    }

    @Test
    fun `every policy variant round trips`() {
        val policies = listOf(
            OidcPolicyConfig.Rego("package slim.auth\ndefault allow = false"),
            OidcPolicyConfig.RegoFile(REGO_FILE_PATH),
            OidcPolicyConfig.Cel(CEL_POLICY),
        )

        for (policy in policies) {
            val config = newInsecureServerConfig("127.0.0.1:46357").apply {
                auth = ServerAuthenticationConfig.Oidc(
                    fullOidcConfig().also { it.policy = policy }
                )
            }

            val oidc = (config.auth as ServerAuthenticationConfig.Oidc).config
            assertEquals(policy, oidc.policy, "policy variant ${policy::class.simpleName} did not round trip")
        }
    }

    @Test
    fun `newConfigFromJson lifts OIDC auth`() {
        val json = """
            {
              "endpoint": "http://127.0.0.1:46357",
              "tls": {"insecure": true},
              "auth": {
                "type": "oidc",
                "issuer_url": "$ISSUER_URL",
                "client_id": "my-client",
                "client_secret": "s3cr3t",
                "audience": "slim",
                "policy": {"cel": "\"admin\" in claims.groups"}
              }
            }
        """.trimIndent()

        val config = newConfigFromJson(json)

        val oidc = (config.auth as ClientAuthenticationConfig.Oidc).config
        assertEquals(ISSUER_URL, oidc.issuerUrl)
        assertEquals("my-client", oidc.clientId)
        assertEquals(OidcPolicyConfig.Cel(CEL_POLICY), oidc.policy)
    }

    @Test
    fun `newConfigFromJson rejects an invalid config`() {
        assertThrows<SlimException> { newConfigFromJson("""{"nope": true}""") }
    }
}
