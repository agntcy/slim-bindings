// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package tests

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"strings"
	"testing"
	"time"

	slim "github.com/agntcy/slim-bindings-go"
)

// didKeyPair is an Ed25519 key, as create_app_with_did_key takes it.
type didKeyPair struct {
	// privatePEM is the PKCS#8 PEM document of the private key.
	privatePEM string
	// jwk is the public key, as an OKP Ed25519 JWK of a trust anchor.
	jwk map[string]string
}

func didKeyPairOf(t *testing.T, key ed25519.PrivateKey) didKeyPair {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return didKeyPair{
		privatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		jwk: map[string]string{
			"kty": "OKP",
			"crv": "Ed25519",
			"alg": "EdDSA",
			"use": "sig",
			"x":   base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey)),
		},
	}
}

func newDidKeyPair(t *testing.T) didKeyPair {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return didKeyPairOf(t, key)
}

// trustedKeys is the JWKS that lists the public keys of the pairs.
func trustedKeys(t *testing.T, pairs ...didKeyPair) string {
	t.Helper()
	keys := make([]map[string]string, 0, len(pairs))
	for _, p := range pairs {
		keys = append(keys, p.jwk)
	}
	out, err := json.Marshal(map[string]any{"keys": keys})
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func didKeyOf(t *testing.T, p didKeyPair) string {
	t.Helper()
	did, err := slim.DidKeyOfPrivateKey(p.privatePEM)
	if err != nil {
		t.Fatalf("did:key of the private key: %v", err)
	}
	return did
}

// TestDidKeyOfPrivateKey checks the did:key of a known key, and that a bad key is an error.
func TestDidKeyOfPrivateKey(t *testing.T) {
	// RFC 8032 section 7.1, test 1.
	seed, _ := hex.DecodeString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
	pair := didKeyPairOf(t, ed25519.NewKeyFromSeed(seed))
	if got, want := didKeyOf(t, pair), "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"; got != want {
		t.Fatalf("did:key = %s, want %s", got, want)
	}
	if _, err := slim.DidKeyOfPrivateKey("not a pem"); err == nil {
		t.Fatal("a private key that is not a PEM document was accepted")
	}
}

// TestDidKeyIdentity runs a request/reply between two apps with a did:key identity that
// trust each other's key, with and without MLS. The receiver sees the sender's did:key as
// the identity of its messages.
func TestDidKeyIdentity(t *testing.T) {
	for _, mls := range []bool{false, true} {
		t.Run(fmt.Sprintf("mls=%v", mls), func(t *testing.T) { testDidKeyIdentity(t, mls) })
	}
}

func testDidKeyIdentity(t *testing.T, mls bool) {
	slim.InitializeWithDefaults()

	// The subtests share the global service, so each has its own names.
	suffix := fmt.Sprintf("-did-mls-%v", mls)
	senderName := slim.NewName("org", "example", "alice"+suffix)
	receiverName := slim.NewName("org", "example", "bob"+suffix)

	alice, bob := newDidKeyPair(t), newDidKeyPair(t)
	// Each app lists the keys it accepts, its own included.
	trusted := trustedKeys(t, alice, bob)

	// The App constructor and the Service method create the same kind of app.
	sender, err := slim.AppNewWithDidKey(senderName, alice.privatePEM, trusted, slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create sender: %v", err)
	}
	defer sender.Destroy()
	receiver, err := slim.GetGlobalService().CreateAppWithDidKey(receiverName, bob.privatePEM, trusted, slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}
	defer receiver.Destroy()

	request := []byte("thisistherequest")
	response := []byte("thisistheresponse")

	type served struct {
		identity string
		err      error
	}
	done := make(chan served, 1)
	go func() {
		timeout := 10 * time.Second
		session, err := receiver.ListenForSession(&timeout)
		if err != nil {
			done <- served{err: fmt.Errorf("listen: %w", err)}
			return
		}
		defer session.Destroy()
		received, err := session.GetMessage(&timeout)
		if err != nil {
			done <- served{err: fmt.Errorf("get message: %w", err)}
			return
		}
		if string(received.Payload) != string(request) {
			done <- served{err: fmt.Errorf("unexpected request %q", received.Payload)}
			return
		}
		done <- served{
			identity: received.Context.Identity,
			err:      session.PublishToAndWait(received.Context, response, nil, nil),
		}
	}()

	var mlsSettings *slim.MlsSettings
	if mls {
		mlsSettings = &slim.MlsSettings{HeaderIntegrityValidationPercent: 100}
	}
	session, err := sender.CreateSessionAndWait(slim.SessionConfig{
		SessionType: slim.SessionTypePointToPoint,
		MlsSettings: mlsSettings,
	}, receiverName)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	defer session.Destroy()

	if err := session.PublishAndWait(request, nil, nil); err != nil {
		t.Fatalf("publish: %v", err)
	}
	timeout := 10 * time.Second
	reply, err := session.GetMessage(&timeout)
	if err != nil {
		t.Fatalf("get reply: %v", err)
	}
	if string(reply.Payload) != string(response) {
		t.Fatalf("unexpected reply %q", reply.Payload)
	}
	result := <-done
	if result.err != nil {
		t.Fatalf("receiver: %v", result.err)
	}

	// The identity of a message is the sender's token, a JWT whose issuer and subject are
	// the sender's did:key. Each side sees the other's.
	if got, want := tokenSubject(t, result.identity), didKeyOf(t, alice); got != want {
		t.Fatalf("the receiver saw a token of %s, want the sender's did:key %s", got, want)
	}
	if got, want := tokenSubject(t, reply.Context.Identity), didKeyOf(t, bob); got != want {
		t.Fatalf("the sender saw a token of %s, want the receiver's did:key %s", got, want)
	}
}

// tokenSubject is the subject of a JWT, after checking that its issuer is the same.
func tokenSubject(t *testing.T, token string) string {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("the identity is not a JWT: %q", token)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("JWT payload: %v", err)
	}
	var claims struct {
		Iss string `json:"iss"`
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("JWT claims: %v", err)
	}
	if claims.Iss != claims.Sub {
		t.Fatalf("the token's issuer %s is not its subject %s", claims.Iss, claims.Sub)
	}
	return claims.Sub
}

// TestDidKeyRejectsUntrustedKey checks that a receiver whose trust anchor does not list
// the sender's key does not let the session be established.
func TestDidKeyRejectsUntrustedKey(t *testing.T) {
	slim.InitializeWithDefaults()

	senderName := slim.NewName("org", "example", "mallory-did")
	receiverName := slim.NewName("org", "example", "bob-did-untrusted")

	mallory, bob := newDidKeyPair(t), newDidKeyPair(t)

	sender, err := slim.AppNewWithDidKey(senderName, mallory.privatePEM, trustedKeys(t, mallory, bob), slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create sender: %v", err)
	}
	defer sender.Destroy()
	// The receiver trusts only its own key.
	receiver, err := slim.AppNewWithDidKey(receiverName, bob.privatePEM, trustedKeys(t, bob), slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}
	defer receiver.Destroy()

	session, err := sender.CreateSessionAndWait(slim.SessionConfig{
		SessionType: slim.SessionTypePointToPoint,
	}, receiverName)
	if err == nil {
		session.Destroy()
		t.Fatal("session was established although the receiver does not trust the sender's key")
	}
}

// TestDidKeyRejectsInvalidKeys checks that keys the call does not take are an error.
func TestDidKeyRejectsInvalidKeys(t *testing.T) {
	slim.InitializeWithDefaults()

	alice, bob := newDidKeyPair(t), newDidKeyPair(t)
	for name, tc := range map[string]struct{ privateKey, trustedKeys string }{
		"private key is not a PEM":         {"not a pem", trustedKeys(t, alice)},
		"trust anchor is not a JWKS":       {alice.privatePEM, "not a jwks"},
		"trust anchor without its own key": {alice.privatePEM, trustedKeys(t, bob)},
	} {
		t.Run(name, func(t *testing.T) {
			app, err := slim.AppNewWithDidKey(
				slim.NewName("org", "example", "invalid-"+strings.ReplaceAll(name, " ", "-")),
				tc.privateKey, tc.trustedKeys, slim.DirectionBidirectional)
			if err == nil {
				app.Destroy()
				t.Fatal("the app was created")
			}
		})
	}
}
