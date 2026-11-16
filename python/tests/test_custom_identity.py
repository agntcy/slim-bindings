# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Custom identity provider/verifier implemented in Python.

`slim_bindings.IdentityProvider` and `slim_bindings.IdentityVerifier` are foreign
traits: subclass them, and pass the instances to `App.new_with_custom_identity`.
The scheme here is a toy (`<subject>.<public key>.<secret>`); a real one would be a
signed token (JWT, DPoP, ...).
"""

import asyncio
import base64
import datetime
import json

import pytest
import pytest_asyncio

import slim_bindings

SECRET = "custom-identity-test-secret"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class ToyProvider(slim_bindings.IdentityProvider):
    """Issues `<subject>.<base64 public key>.<secret>` tokens.

    SLIM signs session control messages with the provider's key pair and peers check
    the signature against the token's `pubkey`, so the token must carry the public key
    of the pair returned by `get_signature_keys`.
    """

    def __init__(self, subject: str, secret: str = SECRET):
        self.subject = subject
        self.secret = secret
        self.keys = slim_bindings.generate_signature_keys()
        self.installed = False
        self.initialized = False

    async def initialize(self):
        self.initialized = True

    def get_token(self):
        return f"{self.subject}.{b64(self.keys.public_key)}.{self.secret}"

    def get_id(self):
        return self.subject

    def get_signature_keys(self):
        return self.keys

    def mls_signature_keys_installed(self):
        return self.installed

    def set_signature_keys(self, private_key, public_key):
        self.keys = slim_bindings.SignatureKeys(
            secret_key=private_key, public_key=public_key
        )
        self.installed = True

    def export_identity(self):
        return None

    def holds_long_term_signing_key(self):
        return False

    def restore_identity(self, identity):
        pass


class ToyVerifier(slim_bindings.IdentityVerifier):
    """Accepts `<subject>.<base64 public key>.<secret>` tokens with the right secret."""

    def __init__(self, secret: str = SECRET):
        self.secret = secret
        self.initialized = False
        self.verified: list[str] = []

    async def initialize(self):
        self.initialized = True

    def _parse(self, token: str) -> tuple[str, str]:
        parts = token.split(".", 2)
        if len(parts) != 3 or parts[2] != self.secret:
            raise slim_bindings.IdentityCallbackError.Failed("invalid token")
        return parts[0], parts[1]

    async def verify_async(self, token):
        self.verify(token)

    def verify(self, token):
        self.verified.append(self._parse(token)[0])

    def get_claims(self, token):
        return json.dumps({"sub": self._parse(token)[0]})

    def get_public_key(self, token):
        return base64.b64decode(self._parse(token)[1])

    def get_subject(self, token):
        return self._parse(token)[0]

    def verify_key_binding(self, token, public_key):
        if self._parse(token)[1] != b64(public_key):
            raise slim_bindings.IdentityCallbackError.PublicKeyMismatch(
                "token bound to another key"
            )


@pytest_asyncio.fixture(autouse=True)
async def register_event_loop():
    """SLIM awaits the Python async methods from its own threads, so the loop to run
    them on has to be registered. The registration is global: redo it for each test's
    loop."""
    slim_bindings.uniffi_set_event_loop(asyncio.get_running_loop())  # type: ignore[arg-type]
    yield


async def create_app(
    name: slim_bindings.Name, provider: ToyProvider, verifier: ToyVerifier
):
    # Use the async constructor: the blocking one would wait for `initialize`, which
    # needs the loop it is blocking.
    return await slim_bindings.App.new_with_custom_identity_async(
        name, provider, verifier, slim_bindings.Direction.BIDIRECTIONAL
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("server", [None], indirect=True)
@pytest.mark.parametrize("receiver_secret", [SECRET, "some-other-secret"])
async def test_custom_identity(server, receiver_secret):
    """Request/reply between two apps that use a Python identity.

    With a matching secret the exchange succeeds, and both Python objects were
    called by SLIM. With a different secret on the receiver, the receiver rejects the
    sender's token and the session is never established.
    """
    sender_name = slim_bindings.Name("org", "default", "custom_id_sender")
    receiver_name = slim_bindings.Name("org", "default", "custom_id_receiver")

    sender_provider = ToyProvider(str(sender_name))
    sender_verifier = ToyVerifier()
    receiver_provider = ToyProvider(str(receiver_name))
    receiver_verifier = ToyVerifier(receiver_secret)

    app_sender = await create_app(sender_name, sender_provider, sender_verifier)
    app_receiver = await create_app(receiver_name, receiver_provider, receiver_verifier)

    # `initialize` is awaited while the app is created.
    assert sender_provider.initialized and sender_verifier.initialized
    assert receiver_provider.initialized and receiver_verifier.initialized

    session_config = slim_bindings.SessionConfig(
        session_type=slim_bindings.SessionType.POINT_TO_POINT,
        mls_settings=None,
        max_retries=3,
        interval=datetime.timedelta(milliseconds=333),
        metadata={},
    )
    session_context = await app_sender.create_session_async(
        session_config, receiver_name
    )

    if receiver_secret != SECRET:
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
