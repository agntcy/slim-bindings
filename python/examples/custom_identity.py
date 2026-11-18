# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0
"""
Custom identity provider and verifier implemented in Python.

SLIM does not have to authenticate with one of its built-in mechanisms: subclass
`slim_bindings.IdentityProvider` (proves who this app is) and
`slim_bindings.IdentityVerifier` (checks who a peer is), and pass instances to
`App.new_with_custom_identity_async`.

Three things a custom identity has to get right:

  * SLIM signs the control messages of every session with the provider's key pair, and
    the peer checks the signature with the key its verifier returns from
    `get_public_key`. Here the key pair is the certificate's own: the token is the
    certificate, so the key the verifier returns is the one in the certificate.
  * SLIM can ask a provider to install a new key pair (`set_signature_keys`), unless
    the provider says its keys are installed (`mls_signature_keys_installed`). A
    certificate identity has a fixed key, so it reports them installed and refuses a
    replacement.
  * SLIM awaits the async methods (`initialize`, `verify_async`) from its own threads,
    so register the event loop with `uniffi_set_event_loop` and use the async
    constructor (the blocking one would wait on the loop it is blocking).

The identities are X.509 certificates. Each app holds a certificate issued by a CA
(fixtures in `testdata/x509`) and its private key, and its token is the certificate in
PEM form. The signing keys are the certificate's key (ECDSA P-256, the MLS ciphersuite
of SLIM): the secret key as the raw 32-byte scalar, the public key as an uncompressed
SEC1 point. The verifier trusts one CA: it checks the certificate was issued by it, is
within its validity period and is not a CA certificate, and its subject is the common
name. It is a trust-anchor check only: there is no revocation checking (CRL / OCSP).

Run with:  uv run --extra examples python examples/custom_identity.py
"""

import asyncio
import datetime
import json
from pathlib import Path

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

import slim_bindings

CERTS = Path(__file__).resolve().parents[2] / "testdata" / "x509"


def common_name(cert: x509.Certificate) -> str:
    return cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value  # type: ignore[return-value]


def signing_keys(
    cert: x509.Certificate, key: ec.EllipticCurvePrivateKey | None
) -> slim_bindings.SignatureKeys:
    """The certificate's key pair, as SLIM takes it: raw secret scalar, SEC1 public key."""
    public = cert.public_key()
    assert isinstance(public, ec.EllipticCurvePublicKey)
    secret = b""
    if key is not None:
        secret = key.private_numbers().private_value.to_bytes(32, "big")
    return slim_bindings.SignatureKeys(
        secret_key=secret,
        public_key=public.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        ),
    )


class ExampleProvider(slim_bindings.IdentityProvider):
    """Uses an X.509 certificate as the token and its key pair as the signing keys."""

    def __init__(self, cert_pem: bytes, key_pem: bytes):
        self.cert_pem = cert_pem.decode()
        self.cert = x509.load_pem_x509_certificate(cert_pem)
        key = serialization.load_pem_private_key(key_pem, password=None)
        assert isinstance(key, ec.EllipticCurvePrivateKey)
        self.keys = signing_keys(self.cert, key)

    async def initialize(self):
        # One-time async setup (load credentials, call an identity service, ...).
        pass

    def get_id(self):
        return common_name(self.cert)

    def get_token(self):
        return self.cert_pem

    def get_signature_keys(self):
        return self.keys

    def mls_signature_keys_installed(self):
        # The keys are the certificate's: SLIM must not generate its own.
        return True

    def set_signature_keys(self, private_key, public_key):
        raise slim_bindings.IdentityCallbackError.Failed(
            "the signing key is the certificate's key and cannot be replaced"
        )

    # No persistence: this identity cannot be exported and restored.
    def export_identity(self):
        return None

    def holds_long_term_signing_key(self):
        # The certificate's key is long-term.
        return True

    def restore_identity(self, identity):
        pass


class ExampleVerifier(slim_bindings.IdentityVerifier):
    """Accepts tokens whose certificate was issued by the trusted CA.

    Trust-anchor check only: no revocation (CRL / OCSP) is performed.
    """

    def __init__(self, ca_pem: bytes):
        self.ca = x509.load_pem_x509_certificate(ca_pem)

    async def initialize(self):
        # One-time async setup (fetch trust bundles, keys, ...).
        pass

    def _parse(self, token: str) -> x509.Certificate:
        """Validate the token, a PEM certificate; return the certificate."""
        try:
            cert = x509.load_pem_x509_certificate(token.encode())
        except ValueError as e:
            raise slim_bindings.IdentityCallbackError.Failed(
                f"malformed token: {e}"
            ) from e

        try:
            cert.verify_directly_issued_by(self.ca)
        except (ValueError, TypeError, InvalidSignature) as e:
            raise slim_bindings.IdentityCallbackError.Failed(
                f"certificate not issued by the trusted CA: {e}"
            ) from e
        now = datetime.datetime.now(datetime.timezone.utc)
        if not cert.not_valid_before_utc <= now <= cert.not_valid_after_utc:
            raise slim_bindings.IdentityCallbackError.Failed(
                "certificate is not valid at this time"
            )
        try:
            basic = cert.extensions.get_extension_for_class(x509.BasicConstraints)
            if basic.value.ca:
                raise slim_bindings.IdentityCallbackError.Failed(
                    "a CA certificate cannot be used as an identity"
                )
        except x509.ExtensionNotFound:
            pass
        if not isinstance(cert.public_key(), ec.EllipticCurvePublicKey):
            raise slim_bindings.IdentityCallbackError.Failed(
                "unsupported certificate key type"
            )
        return cert

    async def verify_async(self, token):
        # Where an async context is available: free to do I/O.
        self._parse(token)

    def verify(self, token):
        # Synchronous contexts: must not block for long.
        self._parse(token)

    def get_claims(self, token):
        return json.dumps({"sub": common_name(self._parse(token))})

    def get_public_key(self, token):
        return signing_keys(self._parse(token), None).public_key

    def get_subject(self, token):
        return common_name(self._parse(token))

    def verify_key_binding(self, token, public_key):
        if signing_keys(self._parse(token), None).public_key != public_key:
            raise slim_bindings.IdentityCallbackError.PublicKeyMismatch(
                "token bound to another key"
            )


async def create_app(name: slim_bindings.Name, user: str) -> slim_bindings.App:
    # The certificate subject (CN) is the app's name, e.g. "org/example/alice".
    provider = ExampleProvider(
        (CERTS / f"{user}.pem").read_bytes(), (CERTS / f"{user}.key").read_bytes()
    )
    return await slim_bindings.App.new_with_custom_identity_async(
        name,
        provider,
        ExampleVerifier((CERTS / "ca.pem").read_bytes()),
        slim_bindings.Direction.BIDIRECTIONAL,
    )


async def main():
    # SLIM calls our async methods from its own threads: tell it which loop to use.
    slim_bindings.uniffi_set_event_loop(asyncio.get_running_loop())  # type: ignore[arg-type]
    slim_bindings.initialize_with_defaults()

    alice_name = slim_bindings.Name("org", "example", "alice")
    bob_name = slim_bindings.Name("org", "example", "bob")
    alice = await create_app(alice_name, "alice")
    bob = await create_app(bob_name, "bob")

    async def bob_serves():
        session = await bob.listen_for_session_async(None)
        received = await session.get_message_async(None)
        print(f"bob received: {received.payload.decode()}")
        await session.publish_to_async(received.context, b"hello alice", None, None)

    server = asyncio.create_task(bob_serves())

    config = slim_bindings.SessionConfig(
        session_type=slim_bindings.SessionType.POINT_TO_POINT,
        mls_settings=None,
        max_retries=3,
        interval=datetime.timedelta(milliseconds=333),
        metadata={},
    )
    created = await alice.create_session_async(config, bob_name)
    await created.completion.wait_async()

    handle = await created.session.publish_async(b"hello bob", None, None)
    await handle.wait_async()
    reply = await created.session.get_message_async(None)
    print(f"alice received: {reply.payload.decode()}")

    await server
    handle = await alice.delete_session_async(created.session)
    await handle.wait_async()


if __name__ == "__main__":
    asyncio.run(main())
