// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package io.agntcy.slim.examples.common;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;

import io.agntcy.slim.bindings.App;
import io.agntcy.slim.bindings.ClientConfig;
import io.agntcy.slim.bindings.Name;
import io.agntcy.slim.bindings.Service;
import io.agntcy.slim.bindings.SlimBindings;

/**
 * Common utilities for SLIM Java binding examples.
 *
 * This class provides:
 * - Identity string parsing (org/namespace/app)
 * - App creation and connection helpers
 * - Default configuration values
 */
public class Common {

    /**
     * Default configuration values
     */
    public static final String DEFAULT_SERVER_ENDPOINT = "http://localhost:46357";
    public static final String DEFAULT_SHARED_SECRET = "my_shared_secret_for_testing_purposes_only";

    /**
     * Returns the SLIM server endpoint.
     * Checks the SLIM_ADDR environment variable first, falling back to DEFAULT_SERVER_ENDPOINT.
     */
    public static String getServerEndpoint() {
        String env = System.getenv("SLIM_ADDR");
        return (env != null && !env.isEmpty()) ? env : DEFAULT_SERVER_ENDPOINT;
    }

    /**
     * Builds the gRPC client configuration used to reach the SLIM server.
     *
     * When SLIM_CLIENT_CONFIG points at a JSON file, that file supplies the whole
     * configuration and {@code serverAddr} is ignored. This is how the examples reach
     * settings with no dedicated flag - TLS material, backoff, rate limiting, and every
     * authentication mode, including OIDC:
     *
     * <pre>
     * {
     *   "endpoint": "http://localhost:46357",
     *   "tls": {"insecure": true},
     *   "auth": {"type": "oidc", "issuer_url": "https://auth.example.com",
     *            "client_id": "my-client", "client_secret": "s3cr3t"}
     * }
     * </pre>
     *
     * The schema matches data-plane/core/config/src/grpc/schema/client-config.schema.json
     * in the slim repo. Without the variable an insecure (no TLS) config for
     * {@code serverAddr} is returned.
     *
     * @param serverAddr SLIM server endpoint URL, used when SLIM_CLIENT_CONFIG is unset
     * @return Client configuration ready to hand to {@code Service.connect}
     * @throws Exception if the file cannot be read or does not hold a valid configuration
     */
    public static ClientConfig clientConfig(String serverAddr) throws Exception {
        String path = System.getenv("SLIM_CLIENT_CONFIG");
        if (path == null || path.isEmpty()) {
            return SlimBindings.newInsecureClientConfig(serverAddr);
        }

        String jsonText = Files.readString(Path.of(path));
        try {
            return SlimBindings.newConfigFromJson(jsonText);
        } catch (Exception e) {
            throw new IllegalArgumentException(
                    "Invalid slim client config JSON (" + path + "): " + e.getMessage(), e);
        }
    }

    /**
     * Reports the endpoint {@link #clientConfig(String)} will actually dial, so log lines
     * stay truthful when SLIM_CLIENT_CONFIG overrides {@code serverAddr}. Falls back to
     * {@code serverAddr} if the config cannot be read - the connect attempt reports the
     * real error.
     *
     * @param serverAddr SLIM server endpoint URL, used when SLIM_CLIENT_CONFIG is unset
     * @return the endpoint that will be dialed
     */
    public static String effectiveEndpoint(String serverAddr) {
        try {
            return clientConfig(serverAddr).endpoint();
        } catch (Exception e) {
            return serverAddr;
        }
    }

    /** Name org component used across all examples. */
    public static final String NAME_ORG = "agntcy";

    /** Name namespace component used across all examples. */
    public static final String NAME_NS = "grpc";

    /**
     * Result of creating and connecting an app.
     */
    public static class AppConnection {
        public final App app;
        public final Long connectionId;

        public AppConnection(App app, Long connectionId) {
            this.app = app;
            this.connectionId = connectionId;
        }
    }

    /**
     * Creates a SLIM app with shared secret authentication and connects it to a
     * SLIM server.
     *
     * This is a convenience function that combines:
     * - Crypto initialization
     * - App creation with shared secret
     * - Server connection with TLS settings
     *
     * @param localId    Local identity string (org/namespace/app format)
     * @param serverAddr SLIM server endpoint URL (ignored when SLIM_CLIENT_CONFIG is set)
     * @param secret     Shared secret for authentication (min 32 chars)
     * @return AppConnection containing the app and connection ID
     * @throws Exception if creation or connection fails
     */
    public static AppConnection createAndConnectApp(String localId, String serverAddr, String secret)
            throws Exception {
        // Initialize crypto, runtime, global service and logging with defaults
        SlimBindings.initializeWithDefaults();

        // Parse the local identity string
        Name appName = Name.fromString(localId);

        // Create app with shared secret authentication
        Service globalService = SlimBindings.getGlobalService();
        App app = globalService.createAppWithSecret(appName, secret);

        // Connect to SLIM server (returns connection ID)
        ClientConfig config = clientConfig(serverAddr);
        Long connId = globalService.connect(config);

        // Forward subscription to next node
        app.subscribe(app.name(), connId);

        return new AppConnection(app, connId);
    }

    /**
     * Creates a SLIM app with shared secret authentication and connects it to a
     * SLIM server (async version).
     *
     * @param localId    Local identity string (org/namespace/app format)
     * @param serverAddr SLIM server endpoint URL
     * @param secret     Shared secret for authentication (min 32 chars)
     * @return CompletableFuture of AppConnection
     */
    public static CompletableFuture<AppConnection> createAndConnectAppAsync(
            String localId, String serverAddr, String secret) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return createAndConnectApp(localId, serverAddr, secret);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
    }
}
