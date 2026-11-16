// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Custom identity provider and verifier implemented in C#.
//
// SLIM does not have to authenticate with one of its built-in mechanisms: implement
// IdentityProvider (proves who this app is) and IdentityVerifier (checks who a peer is),
// and pass them to App.NewWithCustomIdentityAsync.
//
// A custom identity has to get one thing right: SLIM signs the control messages of every
// session with the provider's key pair, and the peer checks the signature with the key its
// verifier returns from GetPublicKey. So the provider holds a key pair
// (SlimBindingsMethods.GenerateSignatureKeys makes one), puts the public key in its
// tokens, and swaps the pair when SLIM calls SetSignatureKeys.
//
// The token scheme below, "<subject>.<base64 public key>.<secret>", is a toy that keeps the
// example short. A real provider issues a signed token (JWT, DPoP, ...) and a real verifier
// checks that signature.
//
// Run with: dotnet run --project Slim.Examples.CustomIdentity

using System.Text;
using System.Text.Json;
using Agntcy.Slim;
using uniffi.slim_bindings;

const string SharedSecret = "an-example-shared-secret";

Slim.Initialize();

var aliceName = new Name("org", "example", "alice");
var bobName = new Name("org", "example", "bob");

var alice = await CreateApp("org/example/alice", aliceName);
var bob = await CreateApp("org/example/bob", bobName);

var timeout = TimeSpan.FromSeconds(10);
var serving = Task.Run(async () =>
{
    var session = await bob.ListenForSessionAsync(timeout);
    var received = await session.GetMessageAsync(timeout);
    Console.WriteLine($"bob received: {Encoding.UTF8.GetString(received.Payload)}");
    await session.PublishToAndWaitAsync(received.Context, Encoding.UTF8.GetBytes("hello alice"), null, null);
});

var created = await alice.CreateSessionAndWaitAsync(
    new SessionConfig(SessionType.PointToPoint, 3, TimeSpan.FromMilliseconds(333), new Dictionary<string, string>(), null),
    bobName);
await created.PublishAndWaitAsync(Encoding.UTF8.GetBytes("hello bob"), null, null);
var reply = await created.GetMessageAsync(timeout);
Console.WriteLine($"alice received: {Encoding.UTF8.GetString(reply.Payload)}");
await serving;

static Task<App> CreateApp(string subject, Name name) =>
    App.NewWithCustomIdentityAsync(
        name,
        new ExampleProvider(subject, SharedSecret),
        new ExampleVerifier(SharedSecret),
        Direction.Bidirectional);

/// <summary>Issues "&lt;subject&gt;.&lt;base64 public key&gt;.&lt;secret&gt;" tokens.</summary>
internal sealed class ExampleProvider : IdentityProvider
{
    private readonly object _lock = new();
    private readonly string _subject;
    private readonly string _secret;
    private SignatureKeys _keys = SlimBindingsMethods.GenerateSignatureKeys();
    private bool _installed;

    public ExampleProvider(string subject, string secret)
    {
        _subject = subject;
        _secret = secret;
    }

    // One-time async setup (load credentials, call an identity service, ...).
    public Task Initialize() => Task.CompletedTask;

    public string GetId() => _subject;

    public string GetToken()
    {
        lock (_lock)
        {
            // Always bind the *current* public key: it changes if SLIM installs a new pair.
            return $"{_subject}.{Convert.ToBase64String(_keys.PublicKey)}.{_secret}";
        }
    }

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

    // Called when MLS is used. Keep the bytes exactly as given.
    public void SetSignatureKeys(byte[] privateKey, byte[] publicKey)
    {
        lock (_lock)
        {
            _keys = new SignatureKeys(privateKey, publicKey);
            _installed = true;
        }
    }

    // No persistence: this identity cannot be exported and restored.
    public IdentityExport? ExportIdentity() => null;

    public bool HoldsLongTermSigningKey() => false;

    public void RestoreIdentity(IdentityExport identity) { }
}

/// <summary>Accepts tokens carrying the shared secret and exposes their claims.</summary>
internal sealed class ExampleVerifier : IdentityVerifier
{
    private readonly string _secret;

    public ExampleVerifier(string secret) => _secret = secret;

    private (string Subject, string PublicKey) Parse(string token)
    {
        var parts = token.Split('.', 3);
        if (parts.Length != 3 || parts[2] != _secret)
        {
            throw new IdentityCallbackException.Failed("invalid token");
        }
        return (parts[0], parts[1]);
    }

    // One-time async setup (fetch trust bundles, keys, ...).
    public Task Initialize() => Task.CompletedTask;

    // Where an async context is available: free to do I/O.
    public Task VerifyAsync(string token)
    {
        Parse(token);
        return Task.CompletedTask;
    }

    // Synchronous contexts: must not block for long.
    public void Verify(string token) => Parse(token);

    public string GetClaims(string token)
    {
        return JsonSerializer.Serialize(new Dictionary<string, string> { ["sub"] = Parse(token).Subject });
    }

    public byte[] GetPublicKey(string token) => Convert.FromBase64String(Parse(token).PublicKey);

    public string GetSubject(string token) => Parse(token).Subject;

    public void VerifyKeyBinding(string token, byte[] publicKey)
    {
        if (Parse(token).PublicKey != Convert.ToBase64String(publicKey))
        {
            throw new IdentityCallbackException.PublicKeyMismatch("token bound to another key");
        }
    }
}
