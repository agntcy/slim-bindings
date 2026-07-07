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
    /// Creates a SLIM app with shared secret authentication and connects it to a SLIM server.
    /// 
    /// This is a convenience function that combines:
    /// - Crypto initialization
    /// - App creation with shared secret
    /// - Server connection with TLS settings
    /// </summary>
    /// <param name="localId">Local identity string (org/namespace/app format)</param>
    /// <param name="serverAddr">SLIM server endpoint URL</param>
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
        var connId = Slim.Connect(serverAddr);

        // Forward subscription to next node
        app.Subscribe(app.Name, connId);

        return (app, connId);
    }

    /// <summary>
    /// Creates a ready App using hierarchical config discovery (slim.yaml + env vars).
    ///
    /// Config is loaded from slim.yaml (walking up from the current working directory)
    /// and/or ~/.slim/config.yaml, with environment variables taking highest priority.
    /// The app name and a stable instance UUID are read from (or written to) the
    /// .slim-cache/ directory next to the discovered config file.
    ///
    /// Requires app.name to be set in the config or via SLIM_APP_NAME.
    /// </summary>
    /// <returns>Created, connected, and subscribed app instance.</returns>
    public static SlimApp CreateAndConnectAppFromConfig()
    {
        Slim.Initialize();

        var config = Slim.LoadSlimConfig();

        using var service = Slim.GetGlobalService();
        return service.CreateAppFromSlimConfig(config);
    }
}
