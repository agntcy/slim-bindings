# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

import asyncio
import base64
import datetime
import secrets
from dataclasses import dataclass

import pytest

import slim_bindings

test_audience = ["test.audience"]


# ---------------------------------------------------------------------------
# Throwaway EC key generation for the JWT tests.
#
# The keys are generated in pure Python so the test suite has no extra
# dependency (`cryptography` ships no wheels for Windows ARM64 or Intel macOS).
# This is NOT constant-time and must never be used outside of tests.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Curve:
    p: int  # field prime
    a: int  # curve coefficient a (b is not needed for point arithmetic)
    n: int  # group order
    gx: int  # generator x
    gy: int  # generator y
    size: int  # coordinate / scalar size in bytes
    oid: bytes  # DER-encoded named curve OID


P256 = _Curve(
    p=2**256 - 2**224 + 2**192 + 2**96 - 1,
    a=-3,
    n=0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551,
    gx=0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
    gy=0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5,
    size=32,
    oid=bytes.fromhex("06082a8648ce3d030107"),  # 1.2.840.10045.3.1.7 (prime256v1)
)

P384 = _Curve(
    p=2**384 - 2**128 - 2**96 + 2**32 - 1,
    a=-3,
    n=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973,
    gx=0xAA87CA22BE8B05378EB1C71EF320AD746E1D3B628BA79B9859F741E082542A385502F25DBF55296C3A545E3872760AB7,
    gy=0x3617DE4A96262C6F5D9E98BF9292DC29F8F41DBD289A147CE9DA3113B5F0B8C00A60B1CE1D7E819D7A431D7C90EA0E5F,
    size=48,
    oid=bytes.fromhex("06052b81040022"),  # 1.3.132.0.34 (secp384r1)
)

_EC_PUBLIC_KEY_OID = bytes.fromhex("06072a8648ce3d0201")  # 1.2.840.10045.2.1


def _point_add(curve: _Curve, p1, p2):
    """Add two affine points; None is the point at infinity."""
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2 and (y1 + y2) % curve.p == 0:
        return None
    if p1 == p2:
        lam = (3 * x1 * x1 + curve.a) * pow(2 * y1, -1, curve.p)
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, curve.p)
    x3 = (lam * lam - x1 - x2) % curve.p
    return x3, (lam * (x1 - x3) - y1) % curve.p


def _scalar_mult(curve: _Curve, k: int):
    result, addend = None, (curve.gx, curve.gy)
    while k:
        if k & 1:
            result = _point_add(curve, result, addend)
        addend = _point_add(curve, addend, addend)
        k >>= 1
    return result


def _der(tag: int, content: bytes) -> bytes:
    """Encode a single DER TLV."""
    length = len(content)
    if length < 0x80:
        encoded_length = bytes([length])
    else:
        raw = length.to_bytes((length.bit_length() + 7) // 8, "big")
        encoded_length = bytes([0x80 | len(raw)]) + raw
    return bytes([tag]) + encoded_length + content


def _pem(label: str, der: bytes) -> str:
    body = base64.b64encode(der).decode()
    lines = [body[i : i + 64] for i in range(0, len(body), 64)]
    return (
        f"-----BEGIN {label}-----\n" + "\n".join(lines) + f"\n-----END {label}-----\n"
    )


def generate_ec_key_pair(curve: _Curve) -> tuple[str, str]:
    """Generate a throwaway EC key pair for the test run.

    Returns:
        (private_key_pem, public_key_pem): PKCS#8 private key and
        SubjectPublicKeyInfo public key, both PEM-encoded.
    """
    d = secrets.randbelow(curve.n - 1) + 1
    x, y = _scalar_mult(curve, d)
    point = b"\x04" + x.to_bytes(curve.size, "big") + y.to_bytes(curve.size, "big")

    algorithm = _der(0x30, _EC_PUBLIC_KEY_OID + curve.oid)
    public_bits = _der(0x03, b"\x00" + point)

    # RFC 5915 ECPrivateKey, wrapped in a PKCS#8 PrivateKeyInfo
    ec_private_key = _der(
        0x30,
        _der(0x02, b"\x01")
        + _der(0x04, d.to_bytes(curve.size, "big"))
        + _der(0xA1, public_bits),
    )
    private_key_info = _der(
        0x30, _der(0x02, b"\x00") + algorithm + _der(0x04, ec_private_key)
    )
    subject_public_key_info = _der(0x30, algorithm + public_bits)

    return _pem("PRIVATE KEY", private_key_info), _pem(
        "PUBLIC KEY", subject_public_key_info
    )


def create_slim(
    name: slim_bindings.Name,
    private_key,
    private_key_algorithm,
    public_key,
    public_key_algorithm,
    wrong_audience=None,
):
    """Construct an App instance with a JWT identity provider/verifier.

    Args:
        name: Name identifying this local app (used as JWT subject).
        private_key: PEM private key used for signing outbound tokens.
        private_key_algorithm: Algorithm matching the private key type (e.g. ES256).
        public_key: PEM public key used to verify the peer's tokens.
        public_key_algorithm: Algorithm matching the peer public key type.
        wrong_audience: Optional override audience list to force verification failure.
                        If None, uses the shared test_audience (success path).

    Returns:
        App: A configured App instance.
    """

    # Build signing key config (private key for encoding)
    private_key_config = slim_bindings.JwtKeyConfig(
        algorithm=private_key_algorithm,
        format=slim_bindings.JwtKeyFormat.PEM,
        key=slim_bindings.JwtKeyData.DATA(value=private_key),  # type: ignore
    )

    # Build verification key config (public key for decoding)
    public_key_config = slim_bindings.JwtKeyConfig(
        algorithm=public_key_algorithm,
        format=slim_bindings.JwtKeyFormat.PEM,
        key=slim_bindings.JwtKeyData.DATA(value=public_key),  # type: ignore
    )

    # Create provider config (for signing outbound tokens)
    provider_config = slim_bindings.IdentityProviderConfig.JWT(
        config=slim_bindings.ClientJwtAuth(
            key=slim_bindings.JwtKeyType.ENCODING(key=private_key_config),  # type: ignore
            audience=test_audience,
            issuer="test-issuer",
            subject=f"{name}",
            duration=datetime.timedelta(seconds=60),
        )
    )

    # Create verifier config (for verifying inbound tokens)
    verifier_config = slim_bindings.IdentityVerifierConfig.JWT(
        config=slim_bindings.JwtAuth(
            key=slim_bindings.JwtKeyType.DECODING(key=public_key_config),  # type: ignore
            audience=wrong_audience or test_audience,
            issuer="test-issuer",
            subject=None,
            duration=datetime.timedelta(seconds=60),
        )
    )

    # Create and return the app
    return slim_bindings.App(name, provider_config, verifier_config)  # type: ignore[arg-type]


@pytest.mark.asyncio
@pytest.mark.parametrize("server", [None], indirect=True)
@pytest.mark.parametrize("audience", [test_audience, ["wrong.audience"]])
async def test_identity_verification(server, audience):
    """End-to-end JWT identity verification test.

    Parametrized:
        audience:
            - Matching audience list (expects successful request/reply)
            - Wrong audience list (expects receive timeout / verification failure)

    Flow:
        1. Create sender & receiver Slim instances with distinct EC key pairs.
        2. Cross-wire each instance: each verifier trusts the other's public key.
        3. Establish route sender -> receiver.
        4. Sender creates PointToPoint session and publishes a request.
        5. Receiver listens, validates payload, replies.
        6. Validate response only when audience matches; otherwise expect timeout.

    Assertions:
        - Payload integrity on both directions when audience matches.
        - Proper exception/timeout on audience mismatch.
    """
    sender_name = slim_bindings.Name("org", "default", "id_sender")
    receiver_name = slim_bindings.Name("org", "default", "id_receiver")

    # Keys used for signing JWTs of sender (P-256 / ES256); the receiver
    # verifies with the public half
    private_key_sender, public_key_sender = generate_ec_key_pair(P256)
    algorithm_sender = slim_bindings.JwtAlgorithm.ES256

    # Keys used for signing JWTs of receiver (P-384 / ES384); the sender
    # verifies with the public half
    private_key_receiver, public_key_receiver = generate_ec_key_pair(P384)
    algorithm_receiver = slim_bindings.JwtAlgorithm.ES384

    # create new app object. note that the verifier will use the public key of the receiver
    # to verify the JWT of the reply message
    app_sender = create_slim(
        sender_name,
        private_key_sender,
        algorithm_sender,
        public_key_receiver,
        algorithm_receiver,
    )

    # create second local app. note that the receiver will use the public key of the sender
    # to verify the JWT of the request message
    app_receiver = create_slim(
        receiver_name,
        private_key_receiver,
        algorithm_receiver,
        public_key_sender,
        algorithm_sender,
        audience,
    )

    # Create PointToPoint session
    session_config = slim_bindings.SessionConfig(
        session_type=slim_bindings.SessionType.POINT_TO_POINT,
        mls_settings=None,
        max_retries=3,
        interval=datetime.timedelta(milliseconds=333),
        metadata={},
    )
    # Create session (returns immediately with session_context)
    session_context = await app_sender.create_session_async(
        session_config, receiver_name
    )

    # Wait for session establishment based on audience
    if audience == test_audience:
        await session_context.completion.wait_async()
    else:
        # session establishment should timeout due to invalid audience
        with pytest.raises(slim_bindings.SlimError.SessionError):
            await asyncio.wait_for(
                session_context.completion.wait_async(),
                timeout=3.0,
            )

    # messages
    pub_msg = str.encode("thisistherequest")
    res_msg = str.encode("thisistheresponse")

    # Test with reply
    try:
        # create background task for slim_receiver
        async def background_task():
            """Receiver side:
            - Wait for inbound session
            - Receive request
            - Reply with response payload
            """

            recv_session_ctx = None
            try:
                recv_session_ctx = await app_receiver.listen_for_session_async(None)
                received_msg = await recv_session_ctx.get_message_async(None)
                _ctx = received_msg.context
                msg_rcv = received_msg.payload

                # make sure the message is correct
                assert msg_rcv == bytes(pub_msg)

                # reply to the session
                await recv_session_ctx.publish_to_async(_ctx, res_msg, None, None)
            except Exception as e:
                print("Error receiving message on app:", e)

        t = asyncio.create_task(background_task())

        # send a request and expect a response
        if audience == test_audience:
            # As audience matches, we expect a successful request/reply
            handle = await session_context.session.publish_async(pub_msg, None, None)
            await handle.wait_async()
            received_msg = await session_context.session.get_message_async(None)
            message = received_msg.payload

            # check if the message is correct
            assert message == bytes(res_msg)

            # Wait for task to finish (and surface any exceptions)
            _ = await t
    finally:
        # delete sessions
        if audience == test_audience:
            h = await app_sender.delete_session_async(session_context.session)
            await h.wait_async()


def test_invalid_shared_secret_too_short():
    """Test that creating an app with too short shared secret raises an exception."""
    name = slim_bindings.Name("org", "default", "test_app")

    # Create app with a secret that's too short (minimum is 32 characters)
    short_secret = "tooshort"

    # Get the global service
    service = slim_bindings.get_global_service()

    # Should raise an exception when creating the app
    with pytest.raises(Exception) as exc_info:
        service.create_app_with_secret(name, short_secret)

    # Verify the error message mentions the secret being too short
    assert (
        "short" in str(exc_info.value).lower()
        or "invalid" in str(exc_info.value).lower()
    )


def test_invalid_shared_secret_empty():
    """Test that creating an app with empty shared secret raises an exception."""
    name = slim_bindings.Name("org", "default", "test_app")

    # Empty secret
    empty_secret = ""

    # Get the global service
    service = slim_bindings.get_global_service()

    # Should raise an exception when creating the app
    with pytest.raises(Exception) as exc_info:
        service.create_app_with_secret(name, empty_secret)

    # Verify the error message is appropriate
    assert (
        "short" in str(exc_info.value).lower()
        or "invalid" in str(exc_info.value).lower()
    )
