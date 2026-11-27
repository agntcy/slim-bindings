// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using uniffi.slim_bindings;
using Xunit;

namespace Agntcy.Slim.Tests;

/// <summary>Thread-safe count of how many times SLIM called each method of a custom object.</summary>
internal sealed class CallCounter
{
    private readonly ConcurrentDictionary<string, int> _calls = new();

    public void Hit(string method) => _calls.AddOrUpdate(method, 1, (_, n) => n + 1);

    public int this[string method] => _calls.GetValueOrDefault(method);
}

internal static class Certs
{
    private const string P256Oid = "1.2.840.10045.3.1.7";
    private const string CommonNameOid = "2.5.4.3";

    /// <summary>The subject's common name; the certificate must have exactly one.</summary>
    public static string CommonName(X509Certificate2 cert)
    {
        var names = cert.SubjectName.EnumerateRelativeDistinguishedNames()
            .Where(rdn => rdn.HasMultipleElements == false && rdn.GetSingleElementType().Value == CommonNameOid)
            .Select(rdn => rdn.GetSingleElementValue())
            .ToList();
        if (names.Count != 1 || string.IsNullOrEmpty(names[0]))
        {
            throw new CryptographicException("the certificate needs exactly one common name");
        }
        return names[0]!;
    }

    public static bool IsP256(ECParameters parameters) =>
        parameters.Curve.Oid.Value == P256Oid || parameters.Curve.Oid.FriendlyName == "nistP256";

    /// <summary>The certificate's public key as SLIM takes it: an uncompressed SEC1 point.</summary>
    public static byte[] PublicKey(X509Certificate2 cert)
    {
        using var ecdsa = cert.GetECDsaPublicKey() ?? throw new CryptographicException("not an ECDSA certificate");
        var parameters = ecdsa.ExportParameters(false);
        if (!IsP256(parameters))
        {
            throw new CryptographicException("the certificate key is not ECDSA P-256");
        }
        var point = new byte[65];
        point[0] = 0x04;
        parameters.Q.X!.CopyTo(point, 1);
        parameters.Q.Y!.CopyTo(point, 33);
        return point;
    }
}

/// <summary>
/// Uses an X.509 certificate as the token and its key pair as the signing keys: SLIM signs
/// the control messages with the certificate's key (raw 32-byte secret scalar, SEC1 public
/// key) and peers get that key from the certificate in the token.
/// </summary>
internal sealed class CertificateProvider : IdentityProvider
{
    private readonly string _certPem;
    private readonly X509Certificate2 _cert;
    private readonly SignatureKeys _keys;

    public bool Initialized { get; private set; }

    public CallCounter Calls { get; } = new();

    public CertificateProvider(string certPem, string keyPem)
    {
        _certPem = certPem;
        _cert = X509Certificate2.CreateFromPem(certPem);
        using var key = ECDsa.Create();
        key.ImportFromPem(keyPem);
        var parameters = key.ExportParameters(true);
        if (!Certs.IsP256(parameters) || parameters.D is not { Length: 32 })
        {
            throw new CryptographicException("the private key is not ECDSA P-256");
        }
        _keys = new SignatureKeys(parameters.D, Certs.PublicKey(_cert));
    }

    public Task Initialize()
    {
        Calls.Hit(nameof(Initialize));
        Initialized = true;
        return Task.CompletedTask;
    }

    public string GetToken()
    {
        Calls.Hit(nameof(GetToken));
        return _certPem;
    }

    public string GetId()
    {
        Calls.Hit(nameof(GetId));
        return Certs.CommonName(_cert);
    }

    public SignatureKeys GetSignatureKeys()
    {
        Calls.Hit(nameof(GetSignatureKeys));
        return _keys;
    }

    // The keys are the certificate's: SLIM must not generate its own.
    public bool MlsSignatureKeysInstalled()
    {
        Calls.Hit(nameof(MlsSignatureKeysInstalled));
        return true;
    }

    public void SetSignatureKeys(byte[] privateKey, byte[] publicKey)
    {
        Calls.Hit(nameof(SetSignatureKeys));
        throw new IdentityCallbackException.Failed("the signing key is the certificate's key and cannot be replaced");
    }

    // No persistence.
    public IdentityExport? ExportIdentity() => null;

    public bool HoldsLongTermSigningKey() => true;

    public void RestoreIdentity(IdentityExport identity) { }
}

/// <summary>
/// Accepts tokens whose PEM certificate was issued directly by the trusted CA (trust anchor
/// only: no revocation checking, no certificate downloads).
/// </summary>
internal sealed class CertificateVerifier : IdentityVerifier
{
    private readonly X509Certificate2 _ca;
    private readonly List<string> _verified = new();

    public bool Initialized { get; private set; }

    public CallCounter Calls { get; } = new();

    public CertificateVerifier(X509Certificate2 ca) => _ca = ca;

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

    private X509Certificate2 Parse(string token)
    {
        try
        {
            // Only a PEM certificate: no content around the PEM block.
            var pem = PemEncoding.Find(token);
            if (!string.IsNullOrWhiteSpace(token[..pem.Location.Start]) || !string.IsNullOrWhiteSpace(token[pem.Location.End..]))
            {
                throw new CryptographicException("unexpected content around the certificate");
            }
            var cert = X509Certificate2.CreateFromPem(token);
            try
            {
                Validate(cert);
                return cert;
            }
            catch
            {
                cert.Dispose();
                throw;
            }
        }
        catch (Exception e) when (e is ArgumentException or CryptographicException)
        {
            throw new IdentityCallbackException.Failed($"invalid token: {e.Message}");
        }
    }

    private void Validate(X509Certificate2 cert)
    {
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(_ca);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.DisableCertificateDownloads = true;
        if (!chain.Build(cert))
        {
            var status = string.Join(", ", chain.ChainStatus.Select(s => s.Status));
            throw new CryptographicException($"certificate not issued by the trusted CA ({status})");
        }
        if (chain.ChainElements.Count != 2)
        {
            throw new CryptographicException("certificate not issued directly by the trusted CA");
        }
        if (cert.Extensions.OfType<X509BasicConstraintsExtension>().Any(e => e.CertificateAuthority))
        {
            throw new CryptographicException("a CA certificate cannot be used as an identity");
        }
        Certs.PublicKey(cert);
        Certs.CommonName(cert);
    }

    public Task Initialize()
    {
        Calls.Hit(nameof(Initialize));
        Initialized = true;
        return Task.CompletedTask;
    }

    public Task VerifyAsync(string token)
    {
        Calls.Hit(nameof(VerifyAsync));
        Check(token);
        return Task.CompletedTask;
    }

    public void Verify(string token)
    {
        Calls.Hit(nameof(Verify));
        Check(token);
    }

    // Counts a rejection ("Rejected") when the token is not accepted.
    private void Check(string token)
    {
        string subject;
        try
        {
            using var cert = Parse(token);
            subject = Certs.CommonName(cert);
        }
        catch (IdentityCallbackException)
        {
            Calls.Hit("Rejected");
            throw;
        }
        lock (_verified)
        {
            _verified.Add(subject);
        }
    }

    public string GetClaims(string token)
    {
        Calls.Hit(nameof(GetClaims));
        using var cert = Parse(token);
        return JsonSerializer.Serialize(new Dictionary<string, string> { ["sub"] = Certs.CommonName(cert) });
    }

    public byte[] GetPublicKey(string token)
    {
        Calls.Hit(nameof(GetPublicKey));
        using var cert = Parse(token);
        return Certs.PublicKey(cert);
    }

    public string GetSubject(string token)
    {
        Calls.Hit(nameof(GetSubject));
        using var cert = Parse(token);
        return Certs.CommonName(cert);
    }

    public void VerifyKeyBinding(string token, byte[] publicKey)
    {
        Calls.Hit(nameof(VerifyKeyBinding));
        using var cert = Parse(token);
        if (!Certs.PublicKey(cert).AsSpan().SequenceEqual(publicKey))
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
    // The test PKI, generated once per run: a CA, and the certificates (PEM) and private keys
    // (PKCS#8 PEM) of alice and bob (CN = org/example/alice and org/example/bob) issued by it.
    private static readonly Lazy<(string CaPem, Dictionary<string, (string CertPem, string KeyPem)> Users)> Pki = new(() =>
    {
        using var ca = NewCa("SLIM test CA");
        var users = new[] { "alice", "bob" }.ToDictionary(
            user => user,
            user => Issue(ca, Subject(user), DateTimeOffset.UtcNow - Day, DateTimeOffset.UtcNow + Day));
        return (ca.ExportCertificatePem(), users);
    });

    private static X509Certificate2 Ca() => X509Certificate2.CreateFromPem(Pki.Value.CaPem);

    // The PEM certificate of the CA ("ca"), alice or bob.
    private static string FixturePem(string fixture) =>
        fixture == "ca" ? Pki.Value.CaPem : Pki.Value.Users[fixture].CertPem;

    private static CertificateProvider FixtureProvider(string fixture) =>
        new(FixturePem(fixture), Pki.Value.Users[fixture].KeyPem);

    private static string Subject(string fixture) => $"org/example/{fixture}";

    // The app name does not have to match the certificate; each test uses its own so that apps
    // of other tests living in the same process cannot receive its sessions.
    private static Name NameOf(string app) => new("org", "custom-id", app);

    private static SessionConfig SessionConfigForTest(bool mls = false) =>
        new(
            SessionType.PointToPoint,
            3,
            TimeSpan.FromMilliseconds(333),
            new Dictionary<string, string>(),
            mls ? new MlsSettings(100, null) : null);

    private static async Task<(App App, CertificateProvider Provider, CertificateVerifier Verifier)> CreateApp(
        string fixture, string app, X509Certificate2? trustedCa = null)
    {
        var provider = FixtureProvider(fixture);
        var verifier = new CertificateVerifier(trustedCa ?? Ca());
        var created = await App.NewWithCustomIdentityAsync(NameOf(app), provider, verifier, Direction.Bidirectional);
        return (created, provider, verifier);
    }

    private static readonly TimeSpan Day = TimeSpan.FromDays(1);

    private static X509Certificate2 NewCa(string cn)
    {
        var caKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={cn}", caKey, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        // The certificate keeps the private key it needs to issue certificates.
        return request.CreateSelfSigned(DateTimeOffset.UtcNow - 30 * Day, DateTimeOffset.UtcNow + 30 * Day);
    }

    // An end-entity certificate (PEM) and private key (PKCS#8 PEM) issued by the CA.
    private static (string CertPem, string KeyPem) Issue(X509Certificate2 ca, string cn, DateTimeOffset notBefore, DateTimeOffset notAfter)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={cn}", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        var serial = new byte[8];
        RandomNumberGenerator.Fill(serial);
        serial[0] &= 0x7f;
        using var issued = request.Create(ca, notBefore, notAfter, serial);
        return (issued.ExportCertificatePem(), key.ExportPkcs8PrivateKeyPem());
    }

    private static string IssueToken(X509Certificate2 ca, DateTimeOffset notBefore, DateTimeOffset notAfter) =>
        Issue(ca, "org/example/mallory", notBefore, notAfter).CertPem;

    // A self-signed CA the verifiers do not trust, and a CA-signed identity.
    private static CertificateProvider UntrustedIdentity(string cn)
    {
        using var ca = NewCa("Untrusted CA");
        var (cert, key) = Issue(ca, cn, DateTimeOffset.UtcNow - Day, DateTimeOffset.UtcNow + 10 * Day);
        return new CertificateProvider(cert, key);
    }

    private static X509Certificate2 PublicOnly(X509Certificate2 ca) => new(ca.RawData);

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task RequestReply(bool mls)
    {
        var sender = await CreateApp("alice", mls ? "sender-mls" : "sender");
        var receiver = await CreateApp("bob", mls ? "receiver-mls" : "receiver");

        // Initialize is awaited while the app is created, once per object; nothing else
        // is called before a session exists.
        foreach (var provider in new[] { sender.Provider, receiver.Provider })
        {
            Assert.True(provider.Initialized);
            Assert.Equal(1, provider.Calls[nameof(IdentityProvider.Initialize)]);
            Assert.Equal(0, provider.Calls[nameof(IdentityProvider.SetSignatureKeys)]);
            Assert.Equal(0, provider.Calls[nameof(IdentityProvider.MlsSignatureKeysInstalled)]);
        }
        foreach (var verifier in new[] { sender.Verifier, receiver.Verifier })
        {
            Assert.True(verifier.Initialized);
            Assert.Equal(1, verifier.Calls[nameof(IdentityVerifier.Initialize)]);
            Assert.Equal(0, verifier.Calls[nameof(IdentityVerifier.Verify)]);
            Assert.Equal(0, verifier.Calls[nameof(IdentityVerifier.VerifyAsync)]);
            Assert.Equal(0, verifier.Calls[nameof(IdentityVerifier.GetPublicKey)]);
            Assert.Equal(0, verifier.Calls[nameof(IdentityVerifier.VerifyKeyBinding)]);
        }

        var timeout = TimeSpan.FromSeconds(10);
        var served = Task.Run(async () =>
        {
            var session = await receiver.App.ListenForSessionAsync(timeout);
            var received = await session.GetMessageAsync(timeout);
            Assert.Equal("thisistherequest", Encoding.UTF8.GetString(received.Payload));
            await session.PublishToAndWaitAsync(
                received.Context, Encoding.UTF8.GetBytes("thisistheresponse"), null, null);
        });

        var session = await sender.App.CreateSessionAndWaitAsync(SessionConfigForTest(mls), NameOf(mls ? "receiver-mls" : "receiver"));
        await session.PublishAndWaitAsync(Encoding.UTF8.GetBytes("thisistherequest"), null, null);
        var reply = await session.GetMessageAsync(timeout);
        Assert.Equal("thisistheresponse", Encoding.UTF8.GetString(reply.Payload));
        await served;

        // SLIM verified the peer's token with our verifier.
        Assert.Contains(Subject("alice"), receiver.Verifier.Verified);
        Assert.Equal(0, receiver.Verifier.Calls["Rejected"]);

        // Every session asks for the token and the signing keys, MLS or not.
        Assert.True(sender.Provider.Calls[nameof(IdentityProvider.GetToken)] >= 1);
        Assert.True(receiver.Provider.Calls[nameof(IdentityProvider.GetToken)] >= 1);
        Assert.True(sender.Provider.Calls[nameof(IdentityProvider.GetSignatureKeys)] >= 1);
        Assert.True(receiver.Provider.Calls[nameof(IdentityProvider.GetSignatureKeys)] >= 1);

        // Verify checks the peer's token (SLIM never uses VerifyAsync here), GetPublicKey reads
        // the key the token is bound to.
        foreach (var verifier in new[] { sender.Verifier, receiver.Verifier })
        {
            Assert.True(verifier.Calls[nameof(IdentityVerifier.Verify)]
                + verifier.Calls[nameof(IdentityVerifier.VerifyAsync)] >= 1);
            Assert.True(verifier.Calls[nameof(IdentityVerifier.GetPublicKey)] >= 1);
        }

        // The key pair is the certificate's: SLIM never replaces it.
        foreach (var provider in new[] { sender.Provider, receiver.Provider })
        {
            Assert.Equal(0, provider.Calls[nameof(IdentityProvider.SetSignatureKeys)]);
        }

        if (!mls)
        {
            // Without MLS there is no key binding to check.
            foreach (var verifier in new[] { sender.Verifier, receiver.Verifier })
            {
                Assert.Equal(0, verifier.Calls[nameof(IdentityVerifier.VerifyKeyBinding)]);
            }
        }
        else
        {
            // SLIM asks whether the keys are installed (they are: the certificate's) and
            // peers check that the token is bound to the signing key.
            foreach (var verifier in new[] { sender.Verifier, receiver.Verifier })
            {
                Assert.True(verifier.Calls[nameof(IdentityVerifier.VerifyKeyBinding)] >= 1);
                Assert.True(verifier.Calls[nameof(IdentityVerifier.GetSubject)] >= 1);
            }
            foreach (var provider in new[] { sender.Provider, receiver.Provider })
            {
                Assert.True(provider.Calls[nameof(IdentityProvider.MlsSignatureKeysInstalled)] >= 1);
            }
        }
    }

    [Fact]
    public async Task VerifierThatRejectsTheTokenStopsTheSession()
    {
        // bob only trusts a CA that did not issue alice's certificate.
        var sender = await CreateApp("alice", "bad-sender");
        var receiver = await CreateApp("bob", "bad-receiver", TrustOnly("bob"));

        await Assert.ThrowsAnyAsync<Exception>(() =>
            sender.App.CreateSessionAndWaitAsync(SessionConfigForTest(), NameOf("bad-receiver")));

        // The receiver's verifier saw the token and refused it.
        Assert.True(receiver.Verifier.Calls["Rejected"] >= 1);

        // The receiver app has to stay alive until here.
        GC.KeepAlive(receiver.App);
    }

    // bob's own certificate used as the trust anchor: it did not issue alice's.
    private static X509Certificate2 TrustOnly(string fixture) => X509Certificate2.CreateFromPem(FixturePem(fixture));

    [Fact]
    public void TokenIsTheCertificateAndKeysAreTheCertificates()
    {
        var verifier = new CertificateVerifier(Ca());
        var provider = FixtureProvider("alice");
        var token = provider.GetToken();

        Assert.Equal(FixturePem("alice"), token);
        Assert.Equal(Subject("alice"), provider.GetId());
        Assert.True(provider.MlsSignatureKeysInstalled());
        Assert.True(provider.HoldsLongTermSigningKey());
        Assert.Null(provider.ExportIdentity());

        var keys = provider.GetSignatureKeys();
        Assert.Equal(32, keys.SecretKey.Length);
        Assert.Equal(65, keys.PublicKey.Length);
        Assert.Equal(0x04, keys.PublicKey[0]);

        verifier.Verify(token);
        Assert.Equal(Subject("alice"), verifier.GetSubject(token));
        Assert.Equal(keys.PublicKey, verifier.GetPublicKey(token));
        Assert.Contains(Subject("alice"), verifier.GetClaims(token));
        verifier.VerifyKeyBinding(token, keys.PublicKey);
        Assert.Throws<IdentityCallbackException.PublicKeyMismatch>(
            () => verifier.VerifyKeyBinding(token, SlimBindingsMethods.GenerateSignatureKeys().PublicKey));
        Assert.Throws<IdentityCallbackException.PublicKeyMismatch>(
            () => verifier.VerifyKeyBinding(token, FixtureProvider("bob").GetSignatureKeys().PublicKey));
    }

    [Fact]
    public void ProviderRefusesToReplaceTheSigningKey()
    {
        var provider = FixtureProvider("alice");
        var fresh = SlimBindingsMethods.GenerateSignatureKeys();
        var before = provider.GetSignatureKeys();

        Assert.Throws<IdentityCallbackException.Failed>(() => provider.SetSignatureKeys(fresh.SecretKey, fresh.PublicKey));

        Assert.Equal(before.PublicKey, provider.GetSignatureKeys().PublicKey);
        Assert.Equal(before.SecretKey, provider.GetSignatureKeys().SecretKey);
    }

    [Fact]
    public void VerifierRejectsACaCertificate()
    {
        var verifier = new CertificateVerifier(Ca());
        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(FixturePem("ca")));
    }

    [Fact]
    public void VerifierRejectsACertificateNotIssuedByItsTrustAnchor()
    {
        var verifier = new CertificateVerifier(TrustOnly("bob"));
        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(FixturePem("alice")));
    }

    [Fact]
    public void VerifierRejectsACertificateFromAnUntrustedCa()
    {
        var verifier = new CertificateVerifier(Ca());
        var token = UntrustedIdentity("org/example/mallory").GetToken();

        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(token));
    }

    [Fact]
    public void VerifierRejectsExpiredAndNotYetValidCertificates()
    {
        using var ca = NewCa("Test CA");
        var verifier = new CertificateVerifier(PublicOnly(ca));
        var now = DateTimeOffset.UtcNow;

        // Control: a valid certificate from the same CA is accepted.
        verifier.Verify(IssueToken(ca, now - Day, now + 10 * Day));

        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(IssueToken(ca, now - 10 * Day, now - Day)));
        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(IssueToken(ca, now + Day, now + 10 * Day)));
    }

    [Fact]
    public void VerifierRejectsMalformedTokens()
    {
        var verifier = new CertificateVerifier(Ca());
        var pem = FixturePem("alice");

        // Flip a character inside the base64 body.
        var body = pem.IndexOf('\n') + 1 + 40;
        var flipped = pem[body] == 'A' ? 'B' : 'A';
        var tampered = pem[..body] + flipped + pem[(body + 1)..];
        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(tampered));

        // Anything after the PEM block, even a second valid certificate.
        verifier.Verify(pem + "\n  \n");
        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(pem + "trailing"));
        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(pem + FixturePem("bob")));

        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify("not-a-token"));
        Assert.Throws<IdentityCallbackException.Failed>(() => verifier.Verify(""));
    }
}
