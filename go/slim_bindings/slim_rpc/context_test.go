package slim_rpc

import (
	"context"
	"testing"
)

func TestWithMetadata(t *testing.T) {
	ctx := context.Background()
	metadata := map[string]string{
		"key1": "value1",
		"key2": "value2",
	}

	ctx = WithMetadata(ctx, metadata)

	retrievedMetadata, ok := MetadataFromContext(ctx)
	if !ok {
		t.Fatal("Expected metadata to be present in context")
	}

	if len(retrievedMetadata) != 2 {
		t.Fatalf("Expected 2 metadata entries, got %d", len(retrievedMetadata))
	}

	if retrievedMetadata["key1"] != "value1" {
		t.Errorf("Expected key1=value1, got key1=%s", retrievedMetadata["key1"])
	}

	if retrievedMetadata["key2"] != "value2" {
		t.Errorf("Expected key2=value2, got key2=%s", retrievedMetadata["key2"])
	}
}

func TestWithSessionId(t *testing.T) {
	ctx := context.Background()
	sessionId := "test-session-123"

	ctx = WithSessionId(ctx, sessionId)

	retrievedSessionId, ok := SessionIdFromContext(ctx)
	if !ok {
		t.Fatal("Expected session ID to be present in context")
	}

	if retrievedSessionId != sessionId {
		t.Errorf("Expected session ID %s, got %s", sessionId, retrievedSessionId)
	}
}

func TestMetadataFromContext_NotPresent(t *testing.T) {
	ctx := context.Background()

	_, ok := MetadataFromContext(ctx)
	if ok {
		t.Fatal("Expected metadata to not be present in context")
	}
}

func TestSessionIdFromContext_NotPresent(t *testing.T) {
	ctx := context.Background()

	_, ok := SessionIdFromContext(ctx)
	if ok {
		t.Fatal("Expected session ID to not be present in context")
	}
}

func TestWithPeerIdentity(t *testing.T) {
	ctx := context.Background()
	subject := "spiffe://example.org/ns/default/sa/client"
	issuer := "https://issuer.example.org"

	ctx = WithPeerSubject(ctx, subject)
	ctx = WithPeerIssuer(ctx, issuer)

	retrievedSubject, ok := PeerSubjectFromContext(ctx)
	if !ok {
		t.Fatal("Expected peer subject to be present in context")
	}
	if retrievedSubject != subject {
		t.Errorf("Expected peer subject %s, got %s", subject, retrievedSubject)
	}

	retrievedIssuer, ok := PeerIssuerFromContext(ctx)
	if !ok {
		t.Fatal("Expected peer issuer to be present in context")
	}
	if retrievedIssuer != issuer {
		t.Errorf("Expected peer issuer %s, got %s", issuer, retrievedIssuer)
	}
}

func TestPeerIdentityFromContext_NotPresent(t *testing.T) {
	ctx := context.Background()

	if _, ok := PeerSubjectFromContext(ctx); ok {
		t.Fatal("Expected peer subject to not be present in context")
	}
	if _, ok := PeerIssuerFromContext(ctx); ok {
		t.Fatal("Expected peer issuer to not be present in context")
	}
}
