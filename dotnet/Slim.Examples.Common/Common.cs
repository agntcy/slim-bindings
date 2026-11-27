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
    /// </summary>
    /// <param name="localId">Local identity string (org/namespace/app format)</param>
    /// <param name="serverAddr">SLIM server endpoint URL (ignored when SLIM_CLIENT_CONFIG is set)</param>
    /// <param name="secret">Shared secret for authentication (min 32 chars)</param>
    /// <returns>Created and connected app instance and connection ID</returns>
    public static (SlimApp app, ulong connId) CreateAndConnectApp(
        string localId,
        string serverAddr,
        string secret) =>
        CreateAndConnectApp(localId, serverAddr, secret, privateKeyPath: null, trustedKeysPath: null);

    /// <summary>
    /// Creates a SLIM app and connects it to a SLIM server.
    ///
    /// This is a convenience function that combines:
    /// - Crypto initialization
    /// - App creation with a shared secret, or a did:key identity
    /// - Server connection with TLS settings
    /// </summary>
    /// <param name="localId">Local identity string (org/namespace/app format)</param>
    /// <param name="serverAddr">SLIM server endpoint URL (ignored when SLIM_CLIENT_CONFIG is set)</param>
    /// <param name="secret">Shared secret for authentication (min 32 chars), used without a did:key</param>
    /// <param name="privateKeyPath">
    /// did:key identity: path of the app's Ed25519 private key, a PKCS#8 PEM document
    /// (testdata/did_key/generate-keys.sh writes one). The app's identity is its did:key.
    /// </param>
    /// <param name="trustedKeysPath">
    /// did:key identity: path of the JWKS of the keys the app accepts, its own included.
    /// </param>
    /// <returns>Created and connected app instance and connection ID</returns>
    public static (SlimApp app, ulong connId) CreateAndConnectApp(
        string localId,
        string serverAddr,
        string secret,
        string? privateKeyPath,
        string? trustedKeysPath)
    {
        // Initialize crypto, runtime, global service and logging with defaults
        Slim.Initialize();

        // Parse the local identity string
        using var appName = SlimName.Parse(localId);

        // Get global service
        using var service = Slim.GetGlobalService();

        SlimApp app;
        if (privateKeyPath is null && trustedKeysPath is null)
        {
            // Create app with shared secret authentication
            Console.WriteLine("Identity: shared secret");
            app = service.CreateApp(appName, secret);
        }
        else if (privateKeyPath is null || trustedKeysPath is null)
        {
            throw new ArgumentException("a did:key identity needs both --private-key and --trusted-keys");
        }
        else
        {
            // The app signs with its private key and accepts the peers whose keys are in the
            // trust anchor.
            var privateKey = File.ReadAllText(privateKeyPath);
            Console.WriteLine($"Identity: {Slim.DidKeyOfPrivateKey(privateKey)}");
            app = service.CreateAppWithDidKey(appName, privateKey, File.ReadAllText(trustedKeysPath));
        }

        // Connect to SLIM server (returns connection ID)
        var connId = service.Connect(GetClientConfig(serverAddr));

        // Forward subscription to next node
        app.Subscribe(app.Name, connId);

        return (app, connId);
    }
}
