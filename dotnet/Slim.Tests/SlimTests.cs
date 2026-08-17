// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

using Agntcy.Slim;
using Xunit;

namespace Agntcy.Slim.Tests;

/// <summary>
/// Shared fixture that initializes SLIM once for all tests.
/// </summary>
public class SlimFixture : IDisposable
{
    public SlimFixture()
    {
        Slim.Initialize();
    }

    public void Dispose()
    {
        Slim.Shutdown();
    }
}

/// <summary>
/// Collection definition to share the fixture across test classes.
/// </summary>
[CollectionDefinition("Slim")]
public class SlimCollection : ICollectionFixture<SlimFixture> { }

/// <summary>
/// Unit tests that verify bindings load correctly (no server required).
/// </summary>
[Collection("Slim")]
public class UnitTests
{
    private const string SharedSecret = "test-shared-secret-must-be-at-least-32-bytes-long!";

    [Fact]
    public void Initialize_Works()
    {
        // Should not throw - already initialized by fixture
        Assert.True(Slim.IsInitialized);

        // Multiple calls should be safe
        Slim.Initialize();
        Assert.True(Slim.IsInitialized);
    }

    [Fact]
    public void GetVersion_ReturnsValue()
    {
        var version = Slim.Version;
        Assert.NotEmpty(version);
    }

    [Fact]
    public void AppCreation_Succeeds()
    {
        using var service = Slim.GetGlobalService();
        using var appName = new SlimName("org", "testapp", "v1");
        using var app = service.CreateApp(appName, SharedSecret);

        Assert.NotNull(app);
        Assert.False(string.IsNullOrEmpty(app.Id));

        // Test app properties
        var returnedName = app.Name;
        Assert.Contains("org", returnedName.ToString());
        Assert.Contains("testapp", returnedName.ToString());

        app.Destroy();
    }

    [Fact]
    public void NameStructure_CreatesValidName()
    {
        using var name = new SlimName("org", "app", "v1");
        Assert.NotNull(name);
        Assert.Contains("org", name.ToString());
        Assert.Contains("app", name.ToString());
        Assert.Contains("v1", name.ToString());
    }

    [Fact]
    public void SlimName_ParsesCorrectly()
    {
        using var name = SlimName.Parse("org/app/v1");
        Assert.StartsWith("org/app/v1", name.ToString());
    }

    [Fact]
    public void SlimName_Parse_TrimsWhitespace()
    {
        using var name = SlimName.Parse(" org / app / v1 ");
        Assert.StartsWith("org/app/v1", name.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("invalid")]
    [InlineData("a/b")]
    [InlineData("a/b/c/d")]
    [InlineData("/a/b")]
    [InlineData("a//b")]
    [InlineData("a/b/")]
    public void SlimName_Parse_InvalidFormat_ThrowsArgumentException(string invalidName)
    {
        Assert.Throws<ArgumentException>(() => SlimName.Parse(invalidName));
    }

    [Fact]
    public void SlimName_Parse_Null_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => SlimName.Parse(null!));
    }

    [Fact]
    public void SessionConfig_DefaultValues()
    {
        var config = new SlimSessionConfig
        {
            SessionType = SlimSessionType.PointToPoint
        };

        Assert.Equal(SlimSessionType.PointToPoint, config.SessionType);
        Assert.Null(config.MlsSettings);
    }

    [Fact]
    public void SessionConfig_GroupType()
    {
        var config = new SlimSessionConfig
        {
            SessionType = SlimSessionType.Group
        };

        Assert.Equal(SlimSessionType.Group, config.SessionType);
        Assert.Null(config.MlsSettings);
    }

    [Fact]
    public void SessionConfig_WithMls()
    {
        var config = new SlimSessionConfig
        {
            SessionType = SlimSessionType.PointToPoint,
            MlsSettings = new SlimMlsSettings()
        };

        Assert.NotNull(config.MlsSettings);
    }

    [Fact]
    public void SlimException_Properties_Work()
    {
        var ex = new SlimException("Connection timeout occurred");
        Assert.True(ex.IsTimeout);
        Assert.False(ex.IsClosed);
        Assert.True(ex.IsTransient);

        var closedEx = new SlimException("Session closed");
        Assert.True(closedEx.IsClosed);
        Assert.False(closedEx.IsTimeout);
    }

    [Fact]
    public void SlimExceptionExtensions_Work()
    {
        var ex = new Exception("Connection timeout");
        Assert.True(ex.IsTimeoutError());
        Assert.False(ex.IsClosedError());
        Assert.True(ex.IsTransientError());
    }

    [Fact]
    public void MultipleApps_HaveDifferentIds()
    {
        using var service = Slim.GetGlobalService();

        using var app1 = service.CreateApp("org", "app1", "v1", SharedSecret);
        using var app2 = service.CreateApp("org", "app2", "v1", SharedSecret);

        Assert.NotEqual(app1.Id, app2.Id);

        app1.Destroy();
        app2.Destroy();
    }

    [Fact]
    public void Cleanup_Succeeds()
    {
        using var service = Slim.GetGlobalService();
        using var app = service.CreateApp("org", "cleanup", "v1", SharedSecret);

        Assert.NotNull(app);

        // Cleanup
        app.Destroy();
    }
}

/// <summary>
/// Unit tests for OIDC transport authentication (no server or identity provider required).
/// </summary>
[Collection("Slim")]
public class OidcConfigUnitTests
{
    private const string IssuerUrl = "https://auth.example.com";
    private const string CelPolicy = "\"admin\" in claims.groups";

    private static SlimOidcConfig FullConfig() => new()
    {
        IssuerUrl = IssuerUrl,
        ClientId = "my-client",
        ClientSecret = "s3cr3t",
        Audience = "slim",
        RefreshToken = "refresh-token",
        RefreshTokenFile = "/tmp/refresh-token",
        AccessTokenFile = "/tmp/access-token",
        Scope = "openid profile",
        Timeout = TimeSpan.FromSeconds(30),
        JwksTtl = TimeSpan.FromHours(1),
        ClaimCacheTtl = TimeSpan.FromMinutes(1),
        Policy = new SlimOidcPolicy.Cel(CelPolicy)
    };

    [Fact]
    public void ClientConfig_WithOidc_RoundTripsThroughFfi()
    {
        // Arrange
        var config = Slim.NewInsecureClientConfig("http://localhost:46357");

        // Act
        var withOidc = config.WithOidc(FullConfig());

        // Assert - crossing the FFI boundary preserves every field
        var oidc = Assert.IsType<SlimOidcConfig>(withOidc.Oidc);
        Assert.Equal(IssuerUrl, oidc.IssuerUrl);
        Assert.Equal("my-client", oidc.ClientId);
        Assert.Equal("s3cr3t", oidc.ClientSecret);
        Assert.Equal("slim", oidc.Audience);
        Assert.Equal("refresh-token", oidc.RefreshToken);
        Assert.Equal("/tmp/refresh-token", oidc.RefreshTokenFile);
        Assert.Equal("/tmp/access-token", oidc.AccessTokenFile);
        Assert.Equal("openid profile", oidc.Scope);
        Assert.Equal(TimeSpan.FromSeconds(30), oidc.Timeout);
        Assert.Equal(TimeSpan.FromHours(1), oidc.JwksTtl);
        Assert.Equal(TimeSpan.FromMinutes(1), oidc.ClaimCacheTtl);
        Assert.Equal(new SlimOidcPolicy.Cel(CelPolicy), oidc.Policy);

        // The original config is untouched
        Assert.Null(config.Oidc);
    }

    [Fact]
    public void ServerConfig_WithOidc_RoundTripsThroughFfi()
    {
        // Arrange
        var config = Slim.NewInsecureServerConfig("127.0.0.1:46357");

        // Act
        var withOidc = config.WithOidc(new SlimOidcConfig
        {
            IssuerUrl = IssuerUrl,
            Audience = "slim",
            JwksTtl = TimeSpan.FromHours(1),
            Policy = new SlimOidcPolicy.RegoFile("/etc/slim/policy.rego")
        });

        // Assert
        var oidc = Assert.IsType<SlimOidcConfig>(withOidc.Oidc);
        Assert.Equal(IssuerUrl, oidc.IssuerUrl);
        Assert.Equal("slim", oidc.Audience);
        Assert.Equal(TimeSpan.FromHours(1), oidc.JwksTtl);
        Assert.Equal(new SlimOidcPolicy.RegoFile("/etc/slim/policy.rego"), oidc.Policy);
        Assert.Null(config.Oidc);
    }

    [Theory]
    [InlineData("rego")]
    [InlineData("rego_file")]
    [InlineData("cel")]
    public void OidcPolicy_EveryVariant_RoundTripsThroughFfi(string variant)
    {
        // Arrange
        SlimOidcPolicy policy = variant switch
        {
            "rego" => new SlimOidcPolicy.Rego("package slim.auth\ndefault allow = false"),
            "rego_file" => new SlimOidcPolicy.RegoFile("/etc/slim/policy.rego"),
            _ => new SlimOidcPolicy.Cel(CelPolicy)
        };

        // Act
        var config = Slim.NewInsecureServerConfig("127.0.0.1:46357")
            .WithOidc(new SlimOidcConfig { IssuerUrl = IssuerUrl, Audience = "slim", Policy = policy });

        // Assert - the exact variant survives, not just "some policy"
        Assert.Equal(policy, config.Oidc?.Policy);
    }

    [Fact]
    public void NewClientConfigFromJson_LiftsOidcAuth()
    {
        // Arrange - the core config schema tags the auth variant with "type"
        const string json = """
        {
          "endpoint": "http://localhost:46357",
          "tls": { "insecure": true },
          "auth": {
            "type": "oidc",
            "issuer_url": "https://auth.example.com",
            "client_id": "my-client",
            "client_secret": "s3cr3t",
            "audience": "slim",
            "policy": { "cel": "\"admin\" in claims.groups" }
          }
        }
        """;

        // Act
        var config = Slim.NewClientConfigFromJson(json);

        // Assert - this is the direction that previously degraded to None
        var oidc = Assert.IsType<SlimOidcConfig>(config.Oidc);
        Assert.Equal(IssuerUrl, oidc.IssuerUrl);
        Assert.Equal("my-client", oidc.ClientId);
        Assert.Equal(new SlimOidcPolicy.Cel(CelPolicy), oidc.Policy);
    }

    [Fact]
    public void NewClientConfigFromJson_RejectsInvalidJson()
    {
        Assert.Throws<SlimException>(() => Slim.NewClientConfigFromJson("{\"nope\": true}"));
        Assert.Throws<ArgumentException>(() => Slim.NewClientConfigFromJson("  "));
    }

    [Fact]
    public void WithOidc_RejectsNull()
    {
        var client = Slim.NewInsecureClientConfig("http://localhost:46357");
        var server = Slim.NewInsecureServerConfig("127.0.0.1:46357");

        Assert.Throws<ArgumentNullException>(() => client.WithOidc(null!));
        Assert.Throws<ArgumentNullException>(() => server.WithOidc(null!));
    }
}

/// <summary>
/// Integration tests that require a running SLIM server.
/// Run server first from the slim repo (https://github.com/agntcy/slim): cd data-plane && task data-plane:run:server
/// </summary>
[Collection("Slim")]
[Trait("Category", "Integration")]
public class IntegrationTests
{
    private const string ServerEndpoint = "http://localhost:46357";
    private const string SharedSecret = "test-shared-secret-minimum-32-characters!!";

    [Fact]
    public void CreateApp_Succeeds()
    {
        using var service = Slim.GetGlobalService();
        using var app = service.CreateApp("test-org", "create-app-test", "v1", SharedSecret);

        Assert.NotNull(app);
        Assert.False(string.IsNullOrEmpty(app.Id));

        // Verify Name property caching works (should return same instance)
        using var name1 = app.Name;
        var name2 = app.Name;
        Assert.Same(name1, name2);

        app.Destroy();
    }

    [Fact]
    public void CreateApp_WithSlimName_Succeeds()
    {
        using var service = Slim.GetGlobalService();
        using var name = new SlimName("test-org", "name-test", "v1");
        using var app = service.CreateApp(name, SharedSecret);

        Assert.NotNull(app);
        Assert.False(string.IsNullOrEmpty(app.Id));

        app.Destroy();
    }

    [Fact]
    public void Connect_CreateApp_Subscribe_Succeeds()
    {
        using var service = Slim.GetGlobalService();

        // Connect
        var connId = Slim.Connect(ServerEndpoint);
        Assert.True(connId >= 0);

        // Create app
        using var app = service.CreateApp("test-org", "full-test", "v1", SharedSecret);
        Assert.NotNull(app);

        // Subscribe (using cached Name property)
        var appName = app.Name;
        app.Subscribe(appName, connId);

        // Set route
        using var destination = SlimName.Parse("test-org/other-app/v1");
        app.SetRoute(destination, connId);

        // Cleanup
        app.RemoveRoute(destination, connId);
        app.Unsubscribe(appName, connId);
        app.Destroy();
        service.Disconnect(connId);
    }

    [Fact]
    public async Task ConnectAsync_Succeeds()
    {
        using var service = Slim.GetGlobalService();

        var connId = await Slim.ConnectAsync(ServerEndpoint);
        Assert.True(connId >= 0);

        service.Disconnect(connId);
    }

    [Fact]
    public async Task ConnectAsync_WithCancellation_ThrowsWhenCancelled()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(
            () => Slim.ConnectAsync(ServerEndpoint, cts.Token));
    }
}
