// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

using Agntcy.Slim;

namespace Agntcy.Slim.Examples.Common;

/// <summary>
/// Shared helper utilities for SLIM .NET binding examples.
/// 
/// This class provides:
/// - Identity string parsing (org/namespace/app)
/// - App creation and connection helper
/// - Default configuration values
/// </summary>
public static class CommonHelpers
{
    /// <summary>
    /// Default configuration values
    /// </summary>
    public const string DefaultServerEndpoint = "http://localhost:46357";
    public const string DefaultSharedSecret = "my_shared_secret_for_testing_purposes_only";

    /// <summary>
    /// Returns the SLIM server endpoint.
    /// Checks the SLIM_ADDR environment variable first, falling back to DefaultServerEndpoint.
    /// </summary>
    public static string GetServerEndpoint() =>
        Environment.GetEnvironmentVariable("SLIM_ADDR") is string addr && addr.Length > 0
            ? addr
            : DefaultServerEndpoint;

    /// <summary>
    /// Builds the gRPC client configuration used to reach the SLIM server.
    ///
    /// When SLIM_CLIENT_CONFIG points at a JSON file, that file supplies the whole
    /// configuration and <paramref name="serverAddr"/> is ignored. This is how the examples
    /// reach settings with no dedicated flag — TLS material, backoff, rate limiting, and
    /// every authentication mode, including OIDC:
    ///
    /// <code>
    /// {
    ///   "endpoint": "http://localhost:46357",
    ///   "tls": {"insecure": true},
    ///   "auth": {"type": "oidc", "issuer_url": "https://auth.example.com",
    ///            "client_id": "my-client", "client_secret": "s3cr3t"}
    /// }
    /// </code>
    ///
    /// The schema matches data-plane/core/config/src/grpc/schema/client-config.schema.json
    /// in the slim repo. Without the variable an insecure (no TLS) config for
    /// <paramref name="serverAddr"/> is returned.
    /// </summary>
    /// <param name="serverAddr">SLIM server endpoint URL, used when SLIM_CLIENT_CONFIG is unset.</param>
    /// <returns>Client configuration ready to hand to <see cref="SlimService.Connect"/>.</returns>
    /// <exception cref="SlimException">Thrown when the file does not hold a valid configuration.</exception>
    public static SlimClientConfig GetClientConfig(string serverAddr)
    {
        var path = Environment.GetEnvironmentVariable("SLIM_CLIENT_CONFIG");
        if (string.IsNullOrEmpty(path))
        {
            return Slim.NewInsecureClientConfig(serverAddr);
        }

        return Slim.NewClientConfigFromJson(File.ReadAllText(path));
    }

    /// <summary>
    /// Reports the endpoint <see cref="GetClientConfig"/> will actually dial, so log lines stay
    /// truthful when SLIM_CLIENT_CONFIG overrides <paramref name="serverAddr"/>. Falls back to
    /// <paramref name="serverAddr"/> if the config cannot be read — the connect attempt reports
    /// the real error.
    /// </summary>
    /// <param name="serverAddr">SLIM server endpoint URL, used when SLIM_CLIENT_CONFIG is unset.</param>
    /// <returns>The endpoint that will be dialed.</returns>
    public static string GetEffectiveEndpoint(string serverAddr)
    {
        try
        {
            return GetClientConfig(serverAddr).Endpoint;
        }
        catch (Exception)
        {
            return serverAddr;
        }
    }

    /// <summary>
    /// Creates a SLIM app with shared secret authentication and connects it to a SLIM server.
    ///
    /// This is a convenience function that combines:
    /// - Crypto initialization
    /// - App creation with shared secret
    /// - Server connection with TLS settings
    /// </summary>
    /// <param name="localId">Local identity string (org/namespace/app format)</param>
    /// <param name="serverAddr">SLIM server endpoint URL (ignored when SLIM_CLIENT_CONFIG is set)</param>
    /// <param name="secret">Shared secret for authentication (min 32 chars)</param>
    /// <returns>Created and connected app instance and connection ID</returns>
    public static (SlimApp app, ulong connId) CreateAndConnectApp(
        string localId,
        string serverAddr,
        string secret)
    {
        // Initialize crypto, runtime, global service and logging with defaults
        Slim.Initialize();

        // Parse the local identity string
        using var appName = SlimName.Parse(localId);

        // Get global service
        using var service = Slim.GetGlobalService();

        // Create app with shared secret authentication
        var app = service.CreateApp(appName, secret);

        // Connect to SLIM server (returns connection ID)
        var connId = service.Connect(GetClientConfig(serverAddr));

        // Forward subscription to next node
        app.Subscribe(app.Name, connId);

        return (app, connId);
    }
}
