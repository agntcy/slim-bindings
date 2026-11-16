// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package tests

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	slim "github.com/agntcy/slim-bindings-go"
)

const customIdentitySecret = "custom-identity-test-secret"

// toyProvider is an IdentityProvider implemented in Go. Its tokens are
// "<subject>.<base64 public key>.<secret>".
//
// SLIM signs the control messages of every session with the provider's key pair and
// peers check the signature against the token's public key, so the token has to carry
// the public key of the pair returned by GetSignatureKeys.
type toyProvider struct {
	mu          sync.Mutex
	subject     string
	secret      string
	keys        slim.SignatureKeys
	installed   bool
	initialized bool
}

func newToyProvider(t *testing.T, subject, secret string) *toyProvider {
	t.Helper()
	keys, err := slim.GenerateSignatureKeys()
	if err != nil {
		t.Fatalf("GenerateSignatureKeys: %v", err)
	}
	return &toyProvider{subject: subject, secret: secret, keys: keys}
}

func (p *toyProvider) Initialize() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.initialized = true
	return nil
}

func (p *toyProvider) GetToken() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	// Bind the current public key: it changes if SLIM installs a new pair.
	return fmt.Sprintf("%s.%s.%s", p.subject, base64.StdEncoding.EncodeToString(p.keys.PublicKey), p.secret), nil
}

func (p *toyProvider) GetId() (string, error) { return p.subject, nil }

func (p *toyProvider) GetSignatureKeys() (slim.SignatureKeys, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.keys, nil
}

func (p *toyProvider) MlsSignatureKeysInstalled() (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.installed, nil
}

func (p *toyProvider) SetSignatureKeys(privateKey []byte, publicKey []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.keys = slim.SignatureKeys{SecretKey: privateKey, PublicKey: publicKey}
	p.installed = true
	return nil
}

// No persistence.
func (p *toyProvider) ExportIdentity() (*slim.IdentityExport, error) { return nil, nil }
func (p *toyProvider) HoldsLongTermSigningKey() (bool, error)        { return false, nil }
func (p *toyProvider) RestoreIdentity(slim.IdentityExport) error     { return nil }

// toyVerifier is an IdentityVerifier implemented in Go. It accepts tokens carrying
// the shared secret and exposes their claims.
type toyVerifier struct {
	mu          sync.Mutex
	secret      string
	initialized bool
	verified    []string
}

func newToyVerifier(secret string) *toyVerifier { return &toyVerifier{secret: secret} }

func (v *toyVerifier) parse(token string) (subject, publicKey string, err error) {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) != 3 || parts[2] != v.secret {
		return "", "", slim.NewIdentityCallbackErrorFailed("invalid token")
	}
	return parts[0], parts[1], nil
}

func (v *toyVerifier) Initialize() error {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.initialized = true
	return nil
}

func (v *toyVerifier) VerifyAsync(token string) error { return v.Verify(token) }

func (v *toyVerifier) Verify(token string) error {
	subject, _, err := v.parse(token)
	if err != nil {
		return err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.verified = append(v.verified, subject)
	return nil
}

func (v *toyVerifier) GetClaims(token string) (string, error) {
	subject, publicKey, err := v.parse(token)
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]string{"sub": subject, "pubkey": publicKey})
	return string(claims), err
}

func (v *toyVerifier) GetSubject(token string) (string, error) {
	subject, _, err := v.parse(token)
	return subject, err
}

func (v *toyVerifier) VerifyKeyBinding(token string, publicKey []byte) error {
	_, bound, err := v.parse(token)
	if err != nil {
		return err
	}
	if bound != base64.StdEncoding.EncodeToString(publicKey) {
		return slim.NewIdentityCallbackErrorPublicKeyMismatch("token bound to another key")
	}
	return nil
}

func (v *toyVerifier) verifiedSubjects() []string {
	v.mu.Lock()
	defer v.mu.Unlock()
	return append([]string(nil), v.verified...)
}

// TestCustomIdentity runs a request/reply between two apps that use a Go identity.
func TestCustomIdentity(t *testing.T) {
	slim.InitializeWithDefaults()

	senderName := slim.NewName("org", "custom-id-sender", "v1")
	receiverName := slim.NewName("org", "custom-id-receiver", "v1")

	senderProvider := newToyProvider(t, senderName.String(), customIdentitySecret)
	senderVerifier := newToyVerifier(customIdentitySecret)
	receiverProvider := newToyProvider(t, receiverName.String(), customIdentitySecret)
	receiverVerifier := newToyVerifier(customIdentitySecret)

	sender, err := slim.AppNewWithCustomIdentity(senderName, senderProvider, senderVerifier, slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create sender: %v", err)
	}
	defer sender.Destroy()
	receiver, err := slim.AppNewWithCustomIdentity(receiverName, receiverProvider, receiverVerifier, slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}
	defer receiver.Destroy()

	// Initialize is called while the app is created.
	if !senderProvider.initialized || !senderVerifier.initialized ||
		!receiverProvider.initialized || !receiverVerifier.initialized {
		t.Fatal("Initialize was not called on every identity object")
	}

	request := []byte("thisistherequest")
	response := []byte("thisistheresponse")

	served := make(chan error, 1)
	go func() {
		timeout := 10 * time.Second
		session, err := receiver.ListenForSession(&timeout)
		if err != nil {
			served <- fmt.Errorf("listen: %w", err)
			return
		}
		defer session.Destroy()
		received, err := session.GetMessage(&timeout)
		if err != nil {
			served <- fmt.Errorf("get message: %w", err)
			return
		}
		if string(received.Payload) != string(request) {
			served <- fmt.Errorf("unexpected request %q", received.Payload)
			return
		}
		served <- session.PublishToAndWait(received.Context, response, nil, nil)
	}()

	session, err := sender.CreateSessionAndWait(slim.SessionConfig{
		SessionType: slim.SessionTypePointToPoint,
		MlsSettings: nil,
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
	if err := <-served; err != nil {
		t.Fatalf("receiver: %v", err)
	}

	// SLIM verified the peer's token with our Go verifier.
	found := false
	for _, subject := range receiverVerifier.verifiedSubjects() {
		if subject == senderName.String() {
			found = true
		}
	}
	if !found {
		t.Fatalf("receiver verifier never saw %s: %v", senderName, receiverVerifier.verifiedSubjects())
	}
}

// TestCustomIdentityRejectsWrongSecret checks that a verifier that rejects the
// sender's token stops the session from being established.
func TestCustomIdentityRejectsWrongSecret(t *testing.T) {
	slim.InitializeWithDefaults()

	senderName := slim.NewName("org", "custom-id-bad-sender", "v1")
	receiverName := slim.NewName("org", "custom-id-bad-receiver", "v1")

	sender, err := slim.AppNewWithCustomIdentity(senderName,
		newToyProvider(t, senderName.String(), customIdentitySecret),
		newToyVerifier(customIdentitySecret), slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create sender: %v", err)
	}
	defer sender.Destroy()
	receiver, err := slim.AppNewWithCustomIdentity(receiverName,
		newToyProvider(t, receiverName.String(), customIdentitySecret),
		newToyVerifier("some-other-secret"), slim.DirectionBidirectional)
	if err != nil {
		t.Fatalf("create receiver: %v", err)
	}
	defer receiver.Destroy()

	session, err := sender.CreateSessionAndWait(slim.SessionConfig{
		SessionType: slim.SessionTypePointToPoint,
		MlsSettings: nil,
	}, receiverName)
	if err == nil {
		session.Destroy()
		t.Fatal("session was established although the receiver rejects the token")
	}
}
