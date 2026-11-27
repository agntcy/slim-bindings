// Custom identity provider and verifier implemented in Go, backed by X.509 certificates.
//
// SLIM does not have to authenticate with one of its built-in mechanisms: implement
// slim.IdentityProvider (proves who this app is) and slim.IdentityVerifier (checks who a
// peer is), and pass them to slim.AppNewWithCustomIdentity.
//
// Three things a custom identity has to get right:
//
//   - SLIM signs the control messages of every session with the provider's key pair, and
//     the peer checks the signature with the key its verifier returns from GetPublicKey.
//     Here the key pair is the certificate's own: the token is the certificate, so the
//     key the verifier returns is the one in the certificate.
//   - SLIM can ask a provider to install a new key pair (SetSignatureKeys), unless the
//     provider says its keys are installed (MlsSignatureKeysInstalled). A certificate
//     identity has a fixed key, so it reports them installed and refuses a replacement.
//   - Both interfaces must be safe for concurrent use: SLIM calls them from its own
//     threads.
//
// The identities are X.509 certificates. Each app holds a certificate issued by a CA
// (generate them with testdata/x509/gen.sh) and its private key, and its token is the certificate in
// PEM form. The signing keys are the certificate's key (ECDSA P-256, the MLS ciphersuite
// of SLIM): the secret key as the raw 32-byte scalar, the public key as an uncompressed
// SEC1 point. The verifier trusts one CA: it checks the certificate was issued by it, is
// within its validity period and is not a CA certificate, and its subject is the common
// name. It is a trust-anchor check only: there is no revocation checking (CRL / OCSP).
//
// The certificates come from testdata/x509 at the root of the repository (override the
// directory with SLIM_X509_DIR). Generate them once with testdata/x509/gen.sh, then run
// with: go run ./examples/custom_identity
package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"

	slim "github.com/agntcy/slim-bindings-go"
)

// fixturesDir returns the directory with the CA, alice and bob certificates and keys.
func fixturesDir() string {
	if dir := os.Getenv("SLIM_X509_DIR"); dir != "" {
		return dir
	}
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "testdata", "x509")
}

// parseCertificate parses a PEM text holding exactly one certificate.
func parseCertificate(text string) (*x509.Certificate, error) {
	block, rest := pem.Decode([]byte(text))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("no PEM certificate")
	}
	if len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("trailing data after the certificate")
	}
	return x509.ParseCertificate(block.Bytes)
}

// publicKeySEC1 is the public key of an ECDSA P-256 certificate as an uncompressed SEC1
// point (0x04 || X || Y), the encoding SLIM expects.
func publicKeySEC1(cert *x509.Certificate) ([]byte, error) {
	key, ok := cert.PublicKey.(*ecdsa.PublicKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("certificate key is not ECDSA P-256")
	}
	ecdhKey, err := key.ECDH()
	if err != nil {
		return nil, err
	}
	return ecdhKey.Bytes(), nil
}

// exampleProvider uses an X.509 certificate as the token and its key pair as the signing keys.
type exampleProvider struct {
	certPEM string
	cn      string
	keys    slim.SignatureKeys
}

func newExampleProvider(dir, user string) (*exampleProvider, error) {
	certPEM, err := os.ReadFile(filepath.Join(dir, user+".pem"))
	if err != nil {
		return nil, err
	}
	cert, err := parseCertificate(string(certPEM))
	if err != nil {
		return nil, err
	}
	public, err := publicKeySEC1(cert)
	if err != nil {
		return nil, err
	}
	keyPEM, err := os.ReadFile(filepath.Join(dir, user+".key"))
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return nil, errors.New("no PEM private key")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("private key is not ECDSA")
	}
	// The raw 32-byte big-endian scalar.
	secret := key.D.FillBytes(make([]byte, 32))
	return &exampleProvider{
		certPEM: string(certPEM),
		cn:      cert.Subject.CommonName,
		keys:    slim.SignatureKeys{SecretKey: secret, PublicKey: public},
	}, nil
}

// One-time setup (load credentials, call an identity service, ...).
func (p *exampleProvider) Initialize() error { return nil }

func (p *exampleProvider) GetId() (string, error) { return p.cn, nil }

func (p *exampleProvider) GetToken() (string, error) { return p.certPEM, nil }

func (p *exampleProvider) GetSignatureKeys() (slim.SignatureKeys, error) { return p.keys, nil }

// The keys are the certificate's: SLIM must not generate its own.
func (p *exampleProvider) MlsSignatureKeysInstalled() (bool, error) { return true, nil }

func (p *exampleProvider) SetSignatureKeys(privateKey []byte, publicKey []byte) error {
	return slim.NewIdentityCallbackErrorFailed("the signing key is the certificate's key and cannot be replaced")
}

// No persistence: this identity cannot be exported and restored.
func (p *exampleProvider) ExportIdentity() (*slim.IdentityExport, error) { return nil, nil }

// The certificate's key is long-term.
func (p *exampleProvider) HoldsLongTermSigningKey() (bool, error)             { return true, nil }
func (p *exampleProvider) RestoreIdentity(identity slim.IdentityExport) error { return nil }

// exampleVerifier accepts tokens whose certificate was issued by the trusted CA.
// Trust-anchor check only: no revocation (CRL / OCSP) is performed.
type exampleVerifier struct {
	roots *x509.CertPool
}

func newExampleVerifier(ca *x509.Certificate) *exampleVerifier {
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	return &exampleVerifier{roots: roots}
}

// parse validates the token, a PEM certificate, and returns the certificate.
func (v *exampleVerifier) parse(token string) (*x509.Certificate, error) {
	fail := func(format string, args ...any) (*x509.Certificate, error) {
		return nil, slim.NewIdentityCallbackErrorFailed(fmt.Sprintf(format, args...))
	}
	cert, err := parseCertificate(token)
	if err != nil {
		return fail("malformed token: %v", err)
	}
	// Issued by the trust anchor and within its validity dates.
	if _, err := cert.Verify(x509.VerifyOptions{
		Roots:       v.roots,
		CurrentTime: time.Now(),
		KeyUsages:   []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}); err != nil {
		return fail("certificate not trusted: %v", err)
	}
	if cert.IsCA {
		return fail("a CA certificate cannot be used as an identity")
	}
	if _, err := publicKeySEC1(cert); err != nil {
		return fail("unsupported certificate key: %v", err)
	}
	if commonNames(cert) != 1 {
		return fail("the certificate subject must have exactly one common name")
	}
	return cert, nil
}

// commonNames counts the common names (OID 2.5.4.3) in the certificate subject.
func commonNames(cert *x509.Certificate) int {
	n := 0
	for _, name := range cert.Subject.Names {
		if name.Type.String() == "2.5.4.3" {
			n++
		}
	}
	return n
}

// One-time setup (fetch trust bundles, keys, ...).
func (v *exampleVerifier) Initialize() error { return nil }

// Where an async context is available: free to do I/O.
func (v *exampleVerifier) VerifyAsync(token string) error { return v.Verify(token) }

// Synchronous contexts: must not block for long.
func (v *exampleVerifier) Verify(token string) error {
	_, err := v.parse(token)
	return err
}

func (v *exampleVerifier) GetClaims(token string) (string, error) {
	cert, err := v.parse(token)
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]string{"sub": cert.Subject.CommonName})
	return string(claims), err
}

func (v *exampleVerifier) GetPublicKey(token string) ([]byte, error) {
	cert, err := v.parse(token)
	if err != nil {
		return nil, err
	}
	return publicKeySEC1(cert)
}

func (v *exampleVerifier) GetSubject(token string) (string, error) {
	cert, err := v.parse(token)
	if err != nil {
		return "", err
	}
	return cert.Subject.CommonName, nil
}

func (v *exampleVerifier) VerifyKeyBinding(token string, publicKey []byte) error {
	cert, err := v.parse(token)
	if err != nil {
		return err
	}
	bound, err := publicKeySEC1(cert)
	if err != nil {
		return err
	}
	if !bytes.Equal(bound, publicKey) {
		return slim.NewIdentityCallbackErrorPublicKeyMismatch("token bound to another key")
	}
	return nil
}

func loadCA(dir string) (*x509.Certificate, error) {
	data, err := os.ReadFile(filepath.Join(dir, "ca.pem"))
	if err != nil {
		return nil, err
	}
	return parseCertificate(string(data))
}

func createApp(name *slim.Name, dir, user string) (*slim.App, error) {
	ca, err := loadCA(dir)
	if err != nil {
		return nil, err
	}
	provider, err := newExampleProvider(dir, user)
	if err != nil {
		return nil, err
	}
	return slim.AppNewWithCustomIdentity(name, provider, newExampleVerifier(ca), slim.DirectionBidirectional)
}

func main() {
	slim.InitializeWithDefaults()
	dir := fixturesDir()
	if _, err := os.Stat(filepath.Join(dir, "ca.pem")); err != nil {
		log.Fatalf("no certificates in %s: generate them with testdata/x509/gen.sh", dir)
	}

	aliceName := slim.NewName("org", "example", "alice")
	bobName := slim.NewName("org", "example", "bob")

	alice, err := createApp(aliceName, dir, "alice")
	if err != nil {
		log.Fatalf("create alice: %v", err)
	}
	defer alice.Destroy()
	bob, err := createApp(bobName, dir, "bob")
	if err != nil {
		log.Fatalf("create bob: %v", err)
	}
	defer bob.Destroy()

	done := make(chan error, 1)
	go func() {
		timeout := 10 * time.Second
		session, err := bob.ListenForSession(&timeout)
		if err != nil {
			done <- err
			return
		}
		defer session.Destroy()
		received, err := session.GetMessage(&timeout)
		if err != nil {
			done <- err
			return
		}
		fmt.Printf("bob received: %s\n", received.Payload)
		done <- session.PublishToAndWait(received.Context, []byte("hello alice"), nil, nil)
	}()

	session, err := alice.CreateSessionAndWait(slim.SessionConfig{
		SessionType: slim.SessionTypePointToPoint,
		MlsSettings: nil,
	}, bobName)
	if err != nil {
		log.Fatalf("create session: %v", err)
	}
	defer session.Destroy()

	if err := session.PublishAndWait([]byte("hello bob"), nil, nil); err != nil {
		log.Fatalf("publish: %v", err)
	}
	timeout := 10 * time.Second
	reply, err := session.GetMessage(&timeout)
	if err != nil {
		log.Fatalf("get reply: %v", err)
	}
	fmt.Printf("alice received: %s\n", reply.Payload)

	if err := <-done; err != nil {
		log.Fatalf("bob: %v", err)
	}
}
