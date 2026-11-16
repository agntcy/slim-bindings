// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Custom identity provider and verifier implemented in Go.
//
// SLIM does not have to authenticate with one of its built-in mechanisms: implement
// slim.IdentityProvider (proves who this app is) and slim.IdentityVerifier (checks who a
// peer is), and pass them to slim.AppNewWithCustomIdentity.
//
// Two things a custom identity has to get right:
//
//   - SLIM signs the control messages of every session with the provider's key pair,
//     and the peer checks the signature with the key its verifier returns from
//     GetPublicKey. So the provider holds a key pair (slim.GenerateSignatureKeys makes
//     one), puts the public key in its tokens, and swaps the pair when SLIM calls
//     SetSignatureKeys.
//   - Both interfaces must be safe for concurrent use: SLIM calls them from its own
//     threads.
//
// The token scheme below, "<subject>.<base64 public key>.<secret>", is a toy that keeps
// the example short. A real provider issues a signed token (JWT, DPoP, ...) and a real
// verifier checks that signature.
//
// Run with: go run ./examples/custom_identity
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	slim "github.com/agntcy/slim-bindings-go"
)

const sharedSecret = "an-example-shared-secret"

// exampleProvider issues "<subject>.<base64 public key>.<secret>" tokens.
type exampleProvider struct {
	mu        sync.Mutex
	subject   string
	secret    string
	keys      slim.SignatureKeys
	installed bool
}

func newExampleProvider(subject, secret string) (*exampleProvider, error) {
	keys, err := slim.GenerateSignatureKeys()
	if err != nil {
		return nil, err
	}
	return &exampleProvider{subject: subject, secret: secret, keys: keys}, nil
}

// One-time setup (load credentials, call an identity service, ...).
func (p *exampleProvider) Initialize() error { return nil }

func (p *exampleProvider) GetId() (string, error) { return p.subject, nil }

func (p *exampleProvider) GetToken() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	// Always bind the *current* public key: it changes if SLIM installs a new pair.
	return fmt.Sprintf("%s.%s.%s", p.subject, base64.StdEncoding.EncodeToString(p.keys.PublicKey), p.secret), nil
}

func (p *exampleProvider) GetSignatureKeys() (slim.SignatureKeys, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.keys, nil
}

func (p *exampleProvider) MlsSignatureKeysInstalled() (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.installed, nil
}

// Called when MLS is used. Keep the bytes exactly as given.
func (p *exampleProvider) SetSignatureKeys(privateKey []byte, publicKey []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.keys = slim.SignatureKeys{SecretKey: privateKey, PublicKey: publicKey}
	p.installed = true
	return nil
}

// No persistence: this identity cannot be exported and restored.
func (p *exampleProvider) ExportIdentity() (*slim.IdentityExport, error)      { return nil, nil }
func (p *exampleProvider) HoldsLongTermSigningKey() (bool, error)             { return false, nil }
func (p *exampleProvider) RestoreIdentity(identity slim.IdentityExport) error { return nil }

// exampleVerifier accepts tokens carrying the shared secret and exposes their claims.
type exampleVerifier struct {
	secret string
}

func (v *exampleVerifier) parse(token string) (subject, publicKey string, err error) {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) != 3 || parts[2] != v.secret {
		return "", "", slim.NewIdentityCallbackErrorFailed("invalid token")
	}
	return parts[0], parts[1], nil
}

// One-time setup (fetch trust bundles, keys, ...).
func (v *exampleVerifier) Initialize() error { return nil }

// Where an async context is available: free to do I/O.
func (v *exampleVerifier) VerifyAsync(token string) error { return v.Verify(token) }

// Synchronous contexts: must not block for long.
func (v *exampleVerifier) Verify(token string) error {
	_, _, err := v.parse(token)
	return err
}

func (v *exampleVerifier) GetClaims(token string) (string, error) {
	subject, _, err := v.parse(token)
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]string{"sub": subject})
	return string(claims), err
}

func (v *exampleVerifier) GetPublicKey(token string) ([]byte, error) {
	_, publicKey, err := v.parse(token)
	if err != nil {
		return nil, err
	}
	return base64.StdEncoding.DecodeString(publicKey)
}

func (v *exampleVerifier) GetSubject(token string) (string, error) {
	subject, _, err := v.parse(token)
	return subject, err
}

func (v *exampleVerifier) VerifyKeyBinding(token string, publicKey []byte) error {
	_, bound, err := v.parse(token)
	if err != nil {
		return err
	}
	if bound != base64.StdEncoding.EncodeToString(publicKey) {
		return slim.NewIdentityCallbackErrorPublicKeyMismatch("token bound to another key")
	}
	return nil
}

func createApp(name *slim.Name) (*slim.App, error) {
	provider, err := newExampleProvider(name.String(), sharedSecret)
	if err != nil {
		return nil, err
	}
	return slim.AppNewWithCustomIdentity(name, provider, &exampleVerifier{secret: sharedSecret}, slim.DirectionBidirectional)
}

func main() {
	slim.InitializeWithDefaults()

	aliceName := slim.NewName("org", "example", "alice")
	bobName := slim.NewName("org", "example", "bob")

	alice, err := createApp(aliceName)
	if err != nil {
		log.Fatalf("create alice: %v", err)
	}
	defer alice.Destroy()
	bob, err := createApp(bobName)
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
