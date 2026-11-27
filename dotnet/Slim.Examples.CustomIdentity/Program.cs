// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Custom identity provider and verifier implemented in C#, based on X.509 certificates.
//
// SLIM does not have to authenticate with one of its built-in mechanisms: implement
// IdentityProvider (proves who this app is) and IdentityVerifier (checks who a peer is),
// and pass them to App.NewWithCustomIdentityAsync.
//
// Three things a custom identity has to get right:
//
//   * SLIM signs the control messages of every session with the provider's key pair, and
//     the peer checks the signature with the key its verifier returns from GetPublicKey.
//     Here the key pair is the certificate's own: the token is the certificate, so the key
//     the verifier returns is the one in the certificate.
//   * SLIM can ask a provider to install a new key pair (SetSignatureKeys), unless the
//     provider says its keys are installed (MlsSignatureKeysInstalled). A certificate
//     identity has a fixed key, so it reports them installed and refuses a replacement.
//   * The callbacks are invoked from SLIM's own threads: keep them thread-safe.
//
// The identities are X.509 certificates. Each app holds a certificate issued by a CA
// (generate them with testdata/x509/gen.sh) and its private key, and its token is the
// certificate in PEM
// form. The signing keys are the certificate's key (ECDSA P-256, the MLS ciphersuite of
// SLIM): the secret key as the raw 32-byte scalar, the public key as an uncompressed SEC1
// point. The verifier trusts one CA: it checks the certificate was issued by it, is within
// its validity period and is not a CA certificate, and its subject is the common name. It
// is a trust-anchor check only: there is no revocation checking (CRL / OCSP) and no
// certificate is downloaded.
//
// Persistence is not supported (ExportIdentity returns null).
//
// The certificates and keys are the ones testdata/x509/gen.sh writes (the build copies
// them next to the binary). Generate them once, then run with:
// dotnet run --project Slim.Examples.CustomIdentity

using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Agntcy.Slim;
using uniffi.slim_bindings;

Slim.Initialize();

var aliceName = new Name("org", "example", "alice");
var bobName = new Name("org", "example", "bob");

var certs = Path.Combine(AppContext.BaseDirectory, "x509");
if (!File.Exists(Path.Combine(certs, "ca.pem")))
{
    Console.Error.WriteLine("No certificates: generate them with testdata/x509/gen.sh, then run the example again.");
    return 1;
}
var ca = X509Certificate2.CreateFromPem(File.ReadAllText(Path.Combine(certs, "ca.pem")));

var alice = await CreateApp("alice", aliceName);
var bob = await CreateApp("bob", bobName);

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
return 0;

Task<App> CreateApp(string fixture, Name name) =>
    App.NewWithCustomIdentityAsync(
        name,
        new CertificateProvider(
            File.ReadAllText(Path.Combine(certs, fixture + ".pem")),
            File.ReadAllText(Path.Combine(certs, fixture + ".key"))),
        new CertificateVerifier(ca),
        Direction.Bidirectional);

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
        return Sec1(parameters);
    }

    public static byte[] Sec1(ECParameters parameters)
    {
        var q = parameters.Q;
        var point = new byte[65];
        point[0] = 0x04;
        q.X!.CopyTo(point, 1);
        q.Y!.CopyTo(point, 33);
        return point;
    }
}

/// <summary>Uses an X.509 certificate as the token and its key pair as the signing keys.</summary>
internal sealed class CertificateProvider : IdentityProvider, IDisposable
{
    private readonly string _certPem;
    private readonly X509Certificate2 _cert;
    private readonly SignatureKeys _keys;

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
        // The certificate's key pair: raw secret scalar, SEC1 public key.
        _keys = new SignatureKeys(parameters.D, Certs.PublicKey(_cert));
    }

    public void Dispose() => _cert.Dispose();

    // One-time async setup (load credentials, call an identity service, ...).
    public Task Initialize() => Task.CompletedTask;

    public string GetId() => Certs.CommonName(_cert);

    public string GetToken() => _certPem;

    public SignatureKeys GetSignatureKeys() => _keys;

    // The keys are the certificate's: SLIM must not generate its own.
    public bool MlsSignatureKeysInstalled() => true;

    public void SetSignatureKeys(byte[] privateKey, byte[] publicKey) =>
        throw new IdentityCallbackException.Failed("the signing key is the certificate's key and cannot be replaced");

    // No persistence: this identity cannot be exported and restored.
    public IdentityExport? ExportIdentity() => null;

    // The certificate's key is long-term.
    public bool HoldsLongTermSigningKey() => true;

    public void RestoreIdentity(IdentityExport identity) { }
}

/// <summary>
/// Accepts tokens whose certificate was issued by the trusted CA, and exposes their claims.
/// Trust-anchor check only: no revocation (CRL / OCSP) is performed and nothing is downloaded.
/// </summary>
internal sealed class CertificateVerifier : IdentityVerifier
{
    private readonly X509Certificate2 _ca;

    public CertificateVerifier(X509Certificate2 ca) => _ca = ca;

    /// <summary>Validates the token, a PEM certificate, and returns the certificate.</summary>
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
        // The leaf has to be issued directly by the CA.
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

    // One-time async setup (fetch trust bundles, keys, ...).
    public Task Initialize() => Task.CompletedTask;

    // Where an async context is available: free to do I/O.
    public Task VerifyAsync(string token)
    {
        Parse(token).Dispose();
        return Task.CompletedTask;
    }

    // Synchronous contexts: must not block for long.
    public void Verify(string token) => Parse(token).Dispose();

    public string GetClaims(string token)
    {
        using var cert = Parse(token);
        return JsonSerializer.Serialize(new Dictionary<string, string> { ["sub"] = Certs.CommonName(cert) });
    }

    public byte[] GetPublicKey(string token)
    {
        using var cert = Parse(token);
        return Certs.PublicKey(cert);
    }

    public string GetSubject(string token)
    {
        using var cert = Parse(token);
        return Certs.CommonName(cert);
    }

    public void VerifyKeyBinding(string token, byte[] publicKey)
    {
        using var cert = Parse(token);
        if (!Certs.PublicKey(cert).AsSpan().SequenceEqual(publicKey))
        {
            throw new IdentityCallbackException.PublicKeyMismatch("token bound to another key");
        }
    }
}
