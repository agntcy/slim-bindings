// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

using System.Text;
using System.Text.Json;
using uniffi.slim_bindings;
using Xunit;

namespace Agntcy.Slim.Tests;

/// <summary>
/// Issues "&lt;subject&gt;.&lt;base64 public key&gt;.&lt;secret&gt;" tokens.
///
/// SLIM signs the control messages of every session with the provider's key pair and peers
/// check the signature against the token's public key, so the token has to carry the public
/// key of the pair returned by <see cref="GetSignatureKeys"/>. The scheme is a toy; a real
/// provider issues a signed token (JWT, DPoP, ...).
/// </summary>
internal sealed class ToyProvider : IdentityProvider
{
    private readonly object _lock = new();
    private readonly string _subject;
    private readonly string _secret;
    private SignatureKeys _keys = SlimBindingsMethods.GenerateSignatureKeys();
    private bool _installed;

    public bool Initialized { get; private set; }

    public ToyProvider(string subject, string secret)
    {
        _subject = subject;
        _secret = secret;
    }

    public Task Initialize()
    {
        Initialized = true;
        return Task.CompletedTask;
    }

    public string GetToken()
    {
        lock (_lock)
        {
            // Bind the current public key: it changes if SLIM installs a new pair.
            return $"{_subject}.{Convert.ToBase64String(_keys.PublicKey)}.{_secret}";
        }
    }

    public string GetId() => _subject;

    public SignatureKeys GetSignatureKeys()
    {
        lock (_lock)
        {
            return _keys;
        }
    }

    public bool MlsSignatureKeysInstalled()
    {
        lock (_lock)
        {
            return _installed;
        }
    }

    public void SetSignatureKeys(byte[] privateKey, byte[] publicKey)
    {
        lock (_lock)
        {
            _keys = new SignatureKeys(privateKey, publicKey);
            _installed = true;
        }
    }

    // No persistence.
    public IdentityExport? ExportIdentity() => null;

    public bool HoldsLongTermSigningKey() => false;

    public void RestoreIdentity(IdentityExport identity) { }
}

/// <summary>Accepts tokens carrying the shared secret and exposes their claims.</summary>
internal sealed class ToyVerifier : IdentityVerifier
{
    private readonly string _secret;
    private readonly List<string> _verified = new();

    public bool Initialized { get; private set; }

    public ToyVerifier(string secret) => _secret = secret;

    public IReadOnlyList<string> Verified
    {
        get
        {
            lock (_verified)
            {
                return _verified.ToList();
            }
        }
    }

    private (string Subject, string PublicKey) Parse(string token)
    {
        var parts = token.Split('.', 3);
        if (parts.Length != 3 || parts[2] != _secret)
        {
            throw new IdentityCallbackException.Failed("invalid token");
        }
        return (parts[0], parts[1]);
    }

    public Task Initialize()
    {
        Initialized = true;
        return Task.CompletedTask;
    }

    public Task VerifyAsync(string token)
    {
        Verify(token);
        return Task.CompletedTask;
    }

    public void Verify(string token)
    {
        var (subject, _) = Parse(token);
        lock (_verified)
        {
            _verified.Add(subject);
        }
    }

    public string GetClaims(string token)
    {
        var (subject, publicKey) = Parse(token);
        return JsonSerializer.Serialize(new Dictionary<string, string> { ["sub"] = subject, ["pubkey"] = publicKey });
    }

    public string GetSubject(string token) => Parse(token).Subject;

    public void VerifyKeyBinding(string token, byte[] publicKey)
    {
        if (Parse(token).PublicKey != Convert.ToBase64String(publicKey))
        {
            throw new IdentityCallbackException.PublicKeyMismatch("token bound to another key");
        }
    }
}

/// <summary>
/// Custom identity provider/verifier implemented in C#, driving real sessions.
/// </summary>
[Collection("Slim")]
public class CustomIdentityTests
{
    private const string Secret = "custom-identity-test-secret";

    private static string Subject(string app) => $"org/{app}/v1";

    private static Name NameOf(string app) => new("org", app, "v1");

    private static SessionConfig SessionConfigForTest() =>
        new(SessionType.PointToPoint, 3, TimeSpan.FromMilliseconds(333), new Dictionary<string, string>(), null);

    private static async Task<(App App, ToyProvider Provider, ToyVerifier Verifier)> CreateApp(
        string app, string verifierSecret = Secret)
    {
        var provider = new ToyProvider(Subject(app), Secret);
        var verifier = new ToyVerifier(verifierSecret);
        var created = await App.NewWithCustomIdentityAsync(NameOf(app), provider, verifier, Direction.Bidirectional);
        return (created, provider, verifier);
    }

    [Fact]
    public async Task RequestReply()
    {
        var sender = await CreateApp("custom-id-sender");
        var receiver = await CreateApp("custom-id-receiver");

        // Initialize is awaited while the app is created.
        Assert.True(sender.Provider.Initialized && sender.Verifier.Initialized);
        Assert.True(receiver.Provider.Initialized && receiver.Verifier.Initialized);

        var timeout = TimeSpan.FromSeconds(10);
        var served = Task.Run(async () =>
        {
            var session = await receiver.App.ListenForSessionAsync(timeout);
            var received = await session.GetMessageAsync(timeout);
            Assert.Equal("thisistherequest", Encoding.UTF8.GetString(received.Payload));
            await session.PublishToAndWaitAsync(
                received.Context, Encoding.UTF8.GetBytes("thisistheresponse"), null, null);
        });

        var session = await sender.App.CreateSessionAndWaitAsync(SessionConfigForTest(), NameOf("custom-id-receiver"));
        await session.PublishAndWaitAsync(Encoding.UTF8.GetBytes("thisistherequest"), null, null);
        var reply = await session.GetMessageAsync(timeout);
        Assert.Equal("thisistheresponse", Encoding.UTF8.GetString(reply.Payload));
        await served;

        // SLIM verified the peer's token with our verifier.
        Assert.Contains(Subject("custom-id-sender"), receiver.Verifier.Verified);
    }

    [Fact]
    public async Task VerifierThatRejectsTheTokenStopsTheSession()
    {
        var sender = await CreateApp("custom-id-bad-sender");
        await CreateApp("custom-id-bad-receiver", "some-other-secret");

        await Assert.ThrowsAnyAsync<Exception>(() =>
            sender.App.CreateSessionAndWaitAsync(SessionConfigForTest(), NameOf("custom-id-bad-receiver")));
    }
}
