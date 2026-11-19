# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Custom identity provider/verifier implemented in Python.

`slim_bindings.IdentityProvider` and `slim_bindings.IdentityVerifier` are foreign
traits: subclass them, and pass the instances to `App.new_with_custom_identity`.
The scheme is X.509: a token is the PEM certificate, and the certificate's own key
pair (ECDSA P-256) is the key pair SLIM signs with. The verifier trusts one CA
(trust-anchor check only, no revocation).
"""

import asyncio
import datetime
import json
import threading
from collections import Counter
from pathlib import Path

import pytest
import pytest_asyncio
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

import slim_bindings

CERTS = Path(__file__).resolve().parents[2] / "testdata" / "x509"


def common_name(cert: x509.Certificate) -> str:
    return cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value  # type: ignore[return-value]


def load_provider(user: str) -> "CertProvider":
    return CertProvider(
        (CERTS / f"{user}.pem").read_bytes(), (CERTS / f"{user}.key").read_bytes()
    )


def trusted_verifier() -> "CertVerifier":
    return CertVerifier((CERTS / "ca.pem").read_bytes())


def issue(
    subject: str,
    *,
    ca: bool = False,
    valid: tuple[datetime.timedelta, datetime.timedelta] = (
        -datetime.timedelta(days=1),
        datetime.timedelta(days=1),
    ),
) -> tuple["CertProvider", bytes]:
    """A provider whose certificate is issued by a new CA, and that CA's certificate.

    `valid` is the validity period relative to now; `ca` makes the issued certificate
    itself a CA certificate.
    """
    now = datetime.datetime.now(datetime.timezone.utc)

    def name(cn: str) -> x509.Name:
        return x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, cn)])

    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(name("test CA"))
        .issuer_name(name("test CA"))
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    key = ec.generate_private_key(ec.SECP256R1())
    cert = (
        x509.CertificateBuilder()
        .subject_name(name(subject))
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now + valid[0])
        .not_valid_after(now + valid[1])
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    provider = CertProvider(
        cert.public_bytes(serialization.Encoding.PEM),
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
    )
    return provider, ca_cert.public_bytes(serialization.Encoding.PEM)


def untrusted_ca_provider(subject: str) -> "CertProvider":
    """A provider whose certificate is issued by a CA the verifiers do not trust."""
    return issue(subject)[0]


def sec1(cert: x509.Certificate) -> bytes:
    """The certificate's public key, as SLIM takes it: an uncompressed SEC1 point."""
    public = cert.public_key()
    assert isinstance(public, ec.EllipticCurvePublicKey)
    return public.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


class CallCounter:
    """Counts the calls per method. SLIM calls from its own threads, hence the lock."""

    def __init__(self):
        self._lock = threading.Lock()
        self._calls: Counter[str] = Counter()

    def count(self, method: str) -> None:
        with self._lock:
            self._calls[method] += 1

    def calls(self) -> dict[str, int]:
        with self._lock:
            return dict(self._calls)

    def __getitem__(self, method: str) -> int:
        with self._lock:
            return self._calls[method]


class CertProvider(slim_bindings.IdentityProvider):
    """Uses an X.509 certificate as the token and its key pair as the signing keys."""

    def __init__(self, cert_pem: bytes, key_pem: bytes):
        self.cert_pem = cert_pem.decode()
        self.cert = x509.load_pem_x509_certificate(cert_pem)
        key = serialization.load_pem_private_key(key_pem, password=None)
        assert isinstance(key, ec.EllipticCurvePrivateKey)
        # SLIM takes the secret key as the raw 32-byte scalar.
        self.keys = slim_bindings.SignatureKeys(
            secret_key=key.private_numbers().private_value.to_bytes(32, "big"),
            public_key=sec1(self.cert),
        )
        self.initialized = False
        self.calls = CallCounter()

    async def initialize(self):
        self.calls.count("initialize")
        self.initialized = True

    def get_id(self):
        self.calls.count("get_id")
        return common_name(self.cert)

    def get_token(self):
        self.calls.count("get_token")
        return self.cert_pem

    def get_signature_keys(self):
        self.calls.count("get_signature_keys")
        return self.keys

    def mls_signature_keys_installed(self):
        self.calls.count("mls_signature_keys_installed")
        # The keys are the certificate's: SLIM must not generate its own.
        return True

    def set_signature_keys(self, private_key, public_key):
        self.calls.count("set_signature_keys")
        raise slim_bindings.IdentityCallbackError.Failed(
            "the signing key is the certificate's key and cannot be replaced"
        )

    # No persistence: this identity cannot be exported and restored.
    def export_identity(self):
        return None

    def holds_long_term_signing_key(self):
        return True

    def restore_identity(self, identity):
        pass


class CertVerifier(slim_bindings.IdentityVerifier):
    """Accepts tokens whose certificate was issued by the trusted CA.

    Trust-anchor check only: no revocation (CRL / OCSP) is performed.
    """

    def __init__(self, ca_pem: bytes):
        self.ca = x509.load_pem_x509_certificate(ca_pem)
        self.initialized = False
        self.verified: list[str] = []
        self.calls = CallCounter()

    async def initialize(self):
        self.calls.count("initialize")
        self.initialized = True

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
        public = cert.public_key()
        if not isinstance(public, ec.EllipticCurvePublicKey) or not isinstance(
            public.curve, ec.SECP256R1
        ):
            raise slim_bindings.IdentityCallbackError.Failed(
                "unsupported certificate key: ECDSA P-256 is required"
            )
        return cert

    async def verify_async(self, token):
        self.calls.count("verify_async")
        self.verified.append(common_name(self._parse(token)))

    def verify(self, token):
        self.calls.count("verify")
        self.verified.append(common_name(self._parse(token)))

    def get_claims(self, token):
        self.calls.count("get_claims")
        return json.dumps({"sub": common_name(self._parse(token))})

    def get_public_key(self, token):
        self.calls.count("get_public_key")
        return sec1(self._parse(token))

    def get_subject(self, token):
        self.calls.count("get_subject")
        return common_name(self._parse(token))

    def verify_key_binding(self, token, public_key):
        self.calls.count("verify_key_binding")
        if sec1(self._parse(token)) != public_key:
            raise slim_bindings.IdentityCallbackError.PublicKeyMismatch(
                "token bound to another key"
            )


@pytest_asyncio.fixture(autouse=True)
async def register_event_loop():
    """SLIM awaits the Python async methods from its own threads, so the loop to run
    them on has to be registered. The registration is global: redo it for each test's
    loop, and clear it afterwards, or the tests that run after these would use the
    closed loop of the last one."""
    slim_bindings.uniffi_set_event_loop(asyncio.get_running_loop())  # type: ignore[arg-type]
    yield
    slim_bindings.uniffi_set_event_loop(None)  # type: ignore[arg-type]


async def create_app(
    name: slim_bindings.Name, provider: CertProvider, verifier: CertVerifier
):
    # Use the async constructor: the blocking one would wait for `initialize`, which
    # needs the loop it is blocking.
    return await slim_bindings.App.new_with_custom_identity_async(
        name, provider, verifier, slim_bindings.Direction.BIDIRECTIONAL
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("server", [None], indirect=True)
# The apps of a failed (untrusted) case keep retrying on the shared global service
# under the same names, so those cases run last.
@pytest.mark.parametrize(
    "sender_trusted, mls", [(True, True), (True, False), (False, True), (False, False)]
)
async def test_custom_identity(server, sender_trusted, mls):
    """Request/reply between two apps that use a Python X.509 identity.

    With a certificate issued by the trusted CA the exchange succeeds, and both Python
    objects were called by SLIM. With a sender certificate from an untrusted CA, the
    receiver rejects the sender's token and the session is never established.
    """
    sender_name = slim_bindings.Name("org", "example", "alice")
    receiver_name = slim_bindings.Name("org", "example", "bob")

    sender_provider = (
        load_provider("alice")
        if sender_trusted
        else untrusted_ca_provider(str(sender_name))
    )
    sender_verifier = trusted_verifier()
    receiver_provider = load_provider("bob")
    receiver_verifier = trusted_verifier()

    app_sender = await create_app(sender_name, sender_provider, sender_verifier)
    app_receiver = await create_app(receiver_name, receiver_provider, receiver_verifier)

    # `initialize` is awaited while the app is created.
    assert sender_provider.initialized and sender_verifier.initialized
    assert receiver_provider.initialized and receiver_verifier.initialized

    # `initialize` ran once per object. Creating the app only reads the provider's
    # identity (`get_id`, `get_token`); nothing else was called yet.
    for obj in (sender_provider, receiver_provider, sender_verifier, receiver_verifier):
        assert obj.calls["initialize"] == 1
    for provider in (sender_provider, receiver_provider):
        assert set(provider.calls.calls()) <= {"initialize", "get_id", "get_token"}
    for verifier in (sender_verifier, receiver_verifier):
        assert verifier.calls.calls() == {"initialize": 1}
    tokens_before = {
        p: p.calls["get_token"] for p in (sender_provider, receiver_provider)
    }

    session_config = slim_bindings.SessionConfig(
        session_type=slim_bindings.SessionType.POINT_TO_POINT,
        mls_settings=slim_bindings.MlsSettings(
            header_integrity_validation_percent=100,
            max_seen_control_message_ids_size=None,
        )
        if mls
        else None,
        max_retries=3,
        interval=datetime.timedelta(milliseconds=333),
        metadata={},
    )
    session_context = await app_sender.create_session_async(
        session_config, receiver_name
    )

    if not sender_trusted:
        with pytest.raises(slim_bindings.SlimError.SessionError):
            await asyncio.wait_for(session_context.completion.wait_async(), timeout=3.0)
        return

    await session_context.completion.wait_async()

    request = b"thisistherequest"
    response = b"thisistheresponse"

    async def receiver_task():
        session = await app_receiver.listen_for_session_async(None)
        received = await session.get_message_async(None)
        assert received.payload == request
        await session.publish_to_async(received.context, response, None, None)

    task = asyncio.create_task(receiver_task())
    try:
        handle = await session_context.session.publish_async(request, None, None)
        await handle.wait_async()
        reply = await session_context.session.get_message_async(None)
        assert reply.payload == response
        await task
    finally:
        h = await app_sender.delete_session_async(session_context.session)
        await h.wait_async()

    # SLIM verified the peer's token with our Python verifier.
    assert str(sender_name) in receiver_verifier.verified

    # SLIM really called the custom code. Which method SLIM calls for what:
    #   get_token / get_id            the identity put in outgoing messages
    #   get_signature_keys            the key pair used to sign them
    #   verify                        validate a peer's token (SLIM uses the sync one)
    #   get_claims / get_public_key   read a validated token
    #   get_subject / verify_key_binding   MLS only: who a token belongs to, and that
    #                                 the key in a MLS message is the one it is bound to
    #   mls_signature_keys_installed  MLS only: whether SLIM has to install a key pair;
    #                                 the certificate's is the one, so it never does
    # Never called: verify_async (the sync `verify` is used) and set_signature_keys.
    for provider in (sender_provider, receiver_provider):
        assert provider.calls["get_token"] > tokens_before[provider]
        assert provider.calls["get_signature_keys"] >= 1
        assert provider.calls["initialize"] == 1
        # The signing keys are the certificate's: SLIM never replaces them, and the
        # key a verifier takes from the token is the one SLIM signs with.
        assert provider.calls["set_signature_keys"] == 0
        token = provider.get_token()
        assert receiver_verifier.get_public_key(token) == provider.keys.public_key
        if mls:
            assert provider.calls["mls_signature_keys_installed"] >= 1
        else:
            assert provider.calls["mls_signature_keys_installed"] == 0
    for verifier in (sender_verifier, receiver_verifier):
        assert verifier.calls["initialize"] == 1
        assert verifier.calls["verify"] >= 1
        assert verifier.calls["verify_async"] == 0
        assert verifier.calls["get_public_key"] >= 1
        if mls:
            assert verifier.calls["verify_key_binding"] >= 1
            assert verifier.calls["get_subject"] >= 1
        else:
            assert verifier.calls["verify_key_binding"] == 0
            assert verifier.calls["get_subject"] == 0


def test_the_token_is_the_certificate():
    provider = load_provider("alice")
    assert provider.get_token() == (CERTS / "alice.pem").read_text()
    # The signing keys are the certificate's: SEC1 public key, raw scalar secret.
    keys = provider.get_signature_keys()
    assert keys.public_key == sec1(provider.cert)
    assert len(keys.public_key) == 65 and keys.public_key[0] == 4
    assert len(keys.secret_key) == 32


def test_verifier_accepts_valid_token():
    provider = load_provider("alice")
    verifier = trusted_verifier()
    token = provider.get_token()

    verifier.verify(token)
    assert verifier.get_subject(token) == "org/example/alice"
    assert json.loads(verifier.get_claims(token)) == {"sub": "org/example/alice"}
    assert verifier.get_public_key(token) == provider.keys.public_key
    verifier.verify_key_binding(token, provider.keys.public_key)
    with pytest.raises(slim_bindings.IdentityCallbackError.PublicKeyMismatch):
        verifier.verify_key_binding(token, b"another key")


def test_signing_keys_cannot_be_replaced():
    provider = load_provider("alice")
    keys = slim_bindings.generate_signature_keys()
    with pytest.raises(slim_bindings.IdentityCallbackError.Failed):
        provider.set_signature_keys(keys.secret_key, keys.public_key)
    assert provider.mls_signature_keys_installed()


def test_verifier_rejects_untrusted_ca():
    token = untrusted_ca_provider("org/example/alice").get_token()
    with pytest.raises(slim_bindings.IdentityCallbackError.Failed):
        trusted_verifier().verify(token)
    # A certificate the trusted CA did not issue: bob's cert is no trust anchor for alice's.
    with pytest.raises(slim_bindings.IdentityCallbackError.Failed):
        CertVerifier((CERTS / "bob.pem").read_bytes()).verify(
            load_provider("alice").get_token()
        )


def test_verifier_rejects_a_ca_certificate():
    # The CA certificate is signed by the trusted CA (itself), but is no identity.
    with pytest.raises(slim_bindings.IdentityCallbackError.Failed):
        trusted_verifier().verify((CERTS / "ca.pem").read_text())
    # A certificate marked as a CA, even from a trusted issuer, does not identify an app.
    provider, ca_pem = issue("org/example/mallory", ca=True)
    with pytest.raises(slim_bindings.IdentityCallbackError.Failed, match="CA"):
        CertVerifier(ca_pem).verify(provider.get_token())


def test_verifier_rejects_expired_and_not_yet_valid_certificates():
    day = datetime.timedelta(days=1)
    for valid in [(-3 * day, -day), (day, 3 * day)]:
        provider, ca_pem = issue("org/example/alice", valid=valid)
        with pytest.raises(slim_bindings.IdentityCallbackError.Failed, match="valid"):
            CertVerifier(ca_pem).verify(provider.get_token())
    # The same CA accepts a certificate that is valid now.
    provider, ca_pem = issue("org/example/alice")
    CertVerifier(ca_pem).verify(provider.get_token())


def test_verifier_rejects_malformed_tokens():
    verifier = trusted_verifier()
    pem = load_provider("alice").get_token()
    lines = pem.splitlines()
    body = lines[1]
    flipped = body[:10] + ("A" if body[10] != "A" else "B") + body[11:]
    tampered = "\n".join([lines[0], flipped, *lines[2:]]) + "\n"
    for token in [tampered, "not a token", "", pem.replace("CERTIFICATE", "KEY")]:
        with pytest.raises(slim_bindings.IdentityCallbackError.Failed):
            verifier.verify(token)
