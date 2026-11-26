# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Apps whose identity is a did:key.

`Service.create_app_with_did_key` (and `App.new_with_did_key`) takes the app's Ed25519
private key, a PKCS#8 PEM document, and the JWKS of the public keys the app accepts,
its own included. The app's identity is the did:key of its key: the tokens it sends are
JWTs whose issuer and subject are that did:key.

The keys are generated for each run.

The apps are created with the async calls (`create_app_with_did_key_async`,
`App.new_with_did_key_async`), which slim 3.5.1 could not run from an event loop
("there is no reactor running"); the invalid-key cases also try the blocking call.
"""

import asyncio
import base64
import datetime
import json

import pytest
from ecdsa import Ed25519, SigningKey

import slim_bindings

# RFC 8032 section 7.1, test 1, and its did:key.
RFC8032_SEED = bytes.fromhex(
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
)
RFC8032_DID = "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw"


class DidKey:
    """An Ed25519 key, as `create_app_with_did_key` takes it."""

    def __init__(self, key: SigningKey | None = None):
        self.key = key or SigningKey.generate(curve=Ed25519)
        # The PKCS#8 PEM document of the private key.
        self.private_pem = self.key.to_pem(format="pkcs8").decode()
        # The public key, as an OKP Ed25519 JWK of a trust anchor.
        x = base64.urlsafe_b64encode(self.key.get_verifying_key().to_string())
        self.jwk = {
            "kty": "OKP",
            "crv": "Ed25519",
            "alg": "EdDSA",
            "use": "sig",
            "x": x.rstrip(b"=").decode(),
        }

    @property
    def did(self) -> str:
        return slim_bindings.did_key_of_private_key(self.private_pem)


def trusted_keys(*keys: DidKey) -> str:
    """The JWKS that lists the public keys of `keys`."""
    return json.dumps({"keys": [k.jwk for k in keys]})


def token_subject(token: str) -> str:
    """The subject of a JWT, after checking that its issuer is the same."""
    payload = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert claims["iss"] == claims["sub"]
    return claims["sub"]


def test_did_key_of_private_key():
    """The did:key of a known key; a private key that is not a PEM is an error."""
    key = DidKey(SigningKey.from_string(RFC8032_SEED, curve=Ed25519))
    assert key.did == RFC8032_DID

    with pytest.raises(slim_bindings.SlimError):
        slim_bindings.did_key_of_private_key("not a pem")


@pytest.mark.asyncio
@pytest.mark.parametrize("server", [None], indirect=True)
@pytest.mark.parametrize(
    "private_key, trust",
    [
        pytest.param("not a pem", "own", id="private key is not a PEM"),
        pytest.param(None, "not a jwks", id="trust anchor is not a JWKS"),
        pytest.param(None, "other", id="trust anchor without its own key"),
    ],
)
async def test_did_key_rejects_invalid_keys(server, private_key, trust):
    """Keys the call does not take are an error."""
    key, other = DidKey(), DidKey()
    trust_anchor = {
        "own": trusted_keys(key),
        "other": trusted_keys(other),
        "not a jwks": "not a jwks",
    }[trust]

    args = (
        slim_bindings.Name("org", "example", "invalid"),
        private_key or key.private_pem,
        trust_anchor,
        slim_bindings.Direction.BIDIRECTIONAL,
    )
    with pytest.raises(slim_bindings.SlimError):
        server.service.create_app_with_did_key(*args)
    with pytest.raises(slim_bindings.SlimError):
        await server.service.create_app_with_did_key_async(*args)


@pytest.mark.asyncio
@pytest.mark.parametrize("server", [None], indirect=True)
# The apps of the failed (untrusted) case keep retrying on the shared global service,
# so it runs last.
@pytest.mark.parametrize(
    "sender_trusted, mls", [(True, True), (True, False), (False, False)]
)
async def test_did_key(server, sender_trusted, mls):
    """Request/reply between two apps with a did:key identity.

    When each trusts the other's key, the exchange succeeds and each side sees the
    other's did:key. When the receiver's trust anchor does not list the sender's key,
    the session is never established.
    """
    # The cases share the global service: each has its own names.
    suffix = f"-did-{sender_trusted}-{mls}"
    sender_name = slim_bindings.Name("org", "example", "alice" + suffix)
    receiver_name = slim_bindings.Name("org", "example", "bob" + suffix)

    alice, bob = DidKey(), DidKey()

    # The App constructor and the Service method create the same kind of app.
    app_sender = await slim_bindings.App.new_with_did_key_async(
        sender_name,
        alice.private_pem,
        trusted_keys(alice, bob),
        slim_bindings.Direction.BIDIRECTIONAL,
    )
    app_receiver = await server.service.create_app_with_did_key_async(
        receiver_name,
        bob.private_pem,
        # Each app lists the keys it accepts, its own included.
        trusted_keys(alice, bob) if sender_trusted else trusted_keys(bob),
        slim_bindings.Direction.BIDIRECTIONAL,
    )

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

    async def receiver_task() -> str:
        session = await app_receiver.listen_for_session_async(None)
        received = await session.get_message_async(None)
        assert received.payload == request
        await session.publish_to_async(received.context, response, None, None)
        return received.context.identity

    task = asyncio.create_task(receiver_task())
    try:
        handle = await session_context.session.publish_async(request, None, None)
        await handle.wait_async()
        reply = await session_context.session.get_message_async(None)
        assert reply.payload == response
        sender_identity = await task
    finally:
        h = await app_sender.delete_session_async(session_context.session)
        await h.wait_async()

    # The identity of a message is the sender's token: each side sees the other's did:key.
    assert token_subject(sender_identity) == alice.did
    assert token_subject(reply.context.identity) == bob.did
