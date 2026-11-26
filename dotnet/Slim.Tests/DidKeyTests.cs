// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Agntcy.Slim.Tests;

/// <summary>
/// Apps whose identity is a did:key, created with <see cref="SlimService.CreateAppWithDidKeyAsync"/>.
/// </summary>
/// <remarks>
/// The call takes the app's Ed25519 private key, a PKCS#8 PEM document, and the JWKS of the
/// public keys the app accepts, its own included. The app's identity is the did:key of its
/// key: the tokens it sends are JWTs whose issuer and subject are that did:key. The keys are
/// generated for each run. The invalid-key cases also try the blocking
/// <see cref="SlimService.CreateAppWithDidKey(SlimName, string, string)"/>.
/// </remarks>
[Collection("Slim")]
public class DidKeyTests
{
    // RFC 8032 section 7.1, test 1, and its did:key.
    private const string Rfc8032Seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    private const string Rfc8032Did = "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw";

    /// <summary>An Ed25519 key, as <c>CreateAppWithDidKey</c> takes it.</summary>
    private sealed class DidKey
    {
        // The PKCS#8 DER encoding of an Ed25519 private key is this prefix, then the seed.
        private static readonly byte[] Pkcs8Prefix = Convert.FromHexString("302e020100300506032b657004220420");

        // .NET has no Ed25519, so the key is a random seed, and its public key is read back
        // from its did:key.
        public DidKey(byte[]? seed = null)
        {
            seed ??= RandomNumberGenerator.GetBytes(32);
            PrivatePem = PemEncoding.WriteString("PRIVATE KEY", [.. Pkcs8Prefix, .. seed]);
            Did = Slim.DidKeyOfPrivateKey(PrivatePem);
            Jwk = new Dictionary<string, string>
            {
                ["kty"] = "OKP",
                ["crv"] = "Ed25519",
                ["alg"] = "EdDSA",
                ["use"] = "sig",
                ["x"] = Base64Url(PublicKeyOf(Did)),
            };
        }

        /// <summary>The PKCS#8 PEM document of the private key.</summary>
        public string PrivatePem { get; }

        /// <summary>The did:key of the key.</summary>
        public string Did { get; }

        /// <summary>The public key, as an OKP Ed25519 JWK of a trust anchor.</summary>
        public Dictionary<string, string> Jwk { get; }
    }

    /// <summary>The JWKS that lists the public keys of <paramref name="keys"/>.</summary>
    private static string TrustedKeys(params DidKey[] keys) =>
        JsonSerializer.Serialize(new { keys = keys.Select(k => k.Jwk) });

    /// <summary>The Ed25519 public key of a did:key: base58btc of 0xed 0x01, then the key.</summary>
    private static byte[] PublicKeyOf(string did)
    {
        const string prefix = "did:key:z";
        Assert.StartsWith(prefix, did);
        const string alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        var value = BigInteger.Zero;
        foreach (var c in did[prefix.Length..])
        {
            value = value * 58 + alphabet.IndexOf(c);
        }
        var bytes = value.ToByteArray(isUnsigned: true, isBigEndian: true);
        Assert.Equal(34, bytes.Length);
        Assert.Equal([0xed, 0x01], bytes[..2]);
        return bytes[2..];
    }

    private static string Base64Url(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>The subject of a JWT, after checking that its issuer is the same.</summary>
    private static string TokenSubject(string token)
    {
        var payload = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
        using var claims = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
        var issuer = claims.RootElement.GetProperty("iss").GetString();
        var subject = claims.RootElement.GetProperty("sub").GetString();
        Assert.Equal(issuer, subject);
        return subject!;
    }

    // Each test uses its own names so that apps of other tests in the same process cannot
    // receive its sessions.
    private static SlimName NameOf(string app) => new("org", "did-key", app);

    private static SlimSessionConfig SessionConfig(bool mls) => new()
    {
        SessionType = SlimSessionType.PointToPoint,
        MaxRetries = 3,
        RetryInterval = TimeSpan.FromMilliseconds(333),
        MlsSettings = mls ? new SlimMlsSettings { HeaderIntegrityValidationPercent = 100 } : null,
    };

    [Fact]
    public void DidKeyOfPrivateKey_KnownKey()
    {
        Assert.Equal(Rfc8032Did, new DidKey(Convert.FromHexString(Rfc8032Seed)).Did);
        Assert.Throws<SlimException>(() => Slim.DidKeyOfPrivateKey("not a pem"));
    }

    [Theory]
    [InlineData("private key is not a PEM")]
    [InlineData("trust anchor is not a JWKS")]
    [InlineData("trust anchor without its own key")]
    public async Task CreateAppWithDidKey_RejectsInvalidKeys(string what)
    {
        var key = new DidKey();
        var (privateKey, trustedKeys) = what switch
        {
            "private key is not a PEM" => ("not a pem", TrustedKeys(key)),
            "trust anchor is not a JWKS" => (key.PrivatePem, "not a jwks"),
            _ => (key.PrivatePem, TrustedKeys(new DidKey())),
        };

        using var name = NameOf("invalid");
        var service = Slim.GetGlobalService();
        Assert.Throws<SlimException>(() => service.CreateAppWithDidKey(name, privateKey, trustedKeys));
        await Assert.ThrowsAsync<SlimException>(() => service.CreateAppWithDidKeyAsync(name, privateKey, trustedKeys));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RequestReply_SeesThePeersDidKey(bool mls)
    {
        var service = Slim.GetGlobalService();
        var tag = mls ? "mls" : "plain";
        var alice = new DidKey();
        var bob = new DidKey();
        // Each app lists the keys it accepts, its own included.
        var trusted = TrustedKeys(alice, bob);

        using var senderName = NameOf($"sender-{tag}");
        using var receiverName = NameOf($"receiver-{tag}");
        using var sender = await service.CreateAppWithDidKeyAsync(senderName, alice.PrivatePem, trusted);
        using var receiver = await service.CreateAppWithDidKeyAsync(receiverName, bob.PrivatePem, trusted);

        var served = Task.Run(async () =>
        {
            using var session = await receiver.ListenForSessionAsync(TimeSpan.FromSeconds(10));
            var request = await session.GetMessageAsync(TimeSpan.FromSeconds(10));
            Assert.Equal("thisistherequest", request.Text);
            await session.ReplyAsync(request, "thisistheresponse");
            return request.Identity;
        });

        using var session = await sender.CreateSessionAsync(receiverName, SessionConfig(mls));
        await session.PublishAsync("thisistherequest");
        var reply = await session.GetMessageAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("thisistheresponse", reply.Text);
        var senderIdentity = await served;

        // The identity of a message is the sender's token: each side sees the other's did:key.
        Assert.Equal(alice.Did, TokenSubject(senderIdentity));
        Assert.Equal(bob.Did, TokenSubject(reply.Identity));
    }

    [Fact]
    public async Task UntrustedKey_StopsTheSession()
    {
        var service = Slim.GetGlobalService();
        var mallory = new DidKey();
        var bob = new DidKey();

        using var senderName = NameOf("untrusted-sender");
        using var receiverName = NameOf("untrusted-receiver");
        using var sender = await service.CreateAppWithDidKeyAsync(senderName, mallory.PrivatePem, TrustedKeys(mallory, bob));
        // The receiver trusts only its own key.
        using var receiver = await service.CreateAppWithDidKeyAsync(receiverName, bob.PrivatePem, TrustedKeys(bob));

        await Assert.ThrowsAnyAsync<Exception>(() => sender.CreateSessionAsync(receiverName, SessionConfig(false)));
    }
}
