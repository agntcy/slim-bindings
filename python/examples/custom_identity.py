# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0
"""
Custom identity provider and verifier implemented in Python.

SLIM does not have to authenticate with one of its built-in mechanisms: subclass
`slim_bindings.IdentityProvider` (proves who this app is) and
`slim_bindings.IdentityVerifier` (checks who a peer is), and pass instances to
`App.new_with_custom_identity_async`.

Two things a custom identity has to get right:

  * SLIM signs the control messages of every session with the provider's key pair, and
    the peer checks the signature with the key its verifier returns from
    `get_public_key`. So the provider holds a key pair (`generate_signature_keys()`
    makes one), puts the public key in its tokens, and swaps the pair when SLIM calls
    `set_signature_keys`.
  * SLIM awaits the async methods (`initialize`, `verify_async`) from its own threads,
    so register the event loop with `uniffi_set_event_loop` and use the async
    constructor (the blocking one would wait on the loop it is blocking).

The token scheme below, `<subject>.<base64 public key>.<secret>`, is a toy that keeps
the example short. A real provider issues a signed token (JWT, DPoP, ...) and a real
verifier checks that signature.

Run with:  uv run python examples/custom_identity.py
"""

import asyncio
import base64
import datetime
import json

import slim_bindings

SECRET = "an-example-shared-secret"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class ExampleProvider(slim_bindings.IdentityProvider):
    """Issues `<subject>.<base64 public key>.<secret>` tokens."""

    def __init__(self, subject: str, secret: str):
        self.subject = subject
        self.secret = secret
        self.keys = slim_bindings.generate_signature_keys()
        self.installed = False

    async def initialize(self):
        # One-time async setup (load credentials, call an identity service, ...).
        pass

    def get_id(self):
        return self.subject

    def get_token(self):
        # Always bind the *current* public key: it changes if SLIM installs a new pair.
        return f"{self.subject}.{b64(self.keys.public_key)}.{self.secret}"

    def get_signature_keys(self):
        return self.keys

    def mls_signature_keys_installed(self):
        return self.installed

    def set_signature_keys(self, private_key, public_key):
        # Called when MLS is used. Keep the bytes exactly as given.
        self.keys = slim_bindings.SignatureKeys(
            secret_key=private_key, public_key=public_key
        )
        self.installed = True

    # No persistence: this identity cannot be exported and restored.
    def export_identity(self):
        return None

    def holds_long_term_signing_key(self):
        return False

    def restore_identity(self, identity):
        pass


class ExampleVerifier(slim_bindings.IdentityVerifier):
    """Accepts tokens carrying the shared secret and exposes their claims."""

    def __init__(self, secret: str):
        self.secret = secret

    async def initialize(self):
        # One-time async setup (fetch trust bundles, keys, ...).
        pass

    def _parse(self, token: str) -> tuple[str, str]:
        parts = token.split(".", 2)
        if len(parts) != 3 or parts[2] != self.secret:
            raise slim_bindings.IdentityCallbackError.Failed("invalid token")
        return parts[0], parts[1]

    async def verify_async(self, token):
        # Where an async context is available: free to do I/O.
        self._parse(token)

    def verify(self, token):
        # Synchronous contexts: must not block for long.
        self._parse(token)

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


async def create_app(name: slim_bindings.Name) -> slim_bindings.App:
    return await slim_bindings.App.new_with_custom_identity_async(
        name,
        ExampleProvider(str(name), SECRET),
        ExampleVerifier(SECRET),
        slim_bindings.Direction.BIDIRECTIONAL,
    )


async def main():
    # SLIM calls our async methods from its own threads: tell it which loop to use.
    slim_bindings.uniffi_set_event_loop(asyncio.get_running_loop())  # type: ignore[arg-type]
    slim_bindings.initialize_with_defaults()

    alice_name = slim_bindings.Name("org", "example", "alice")
    bob_name = slim_bindings.Name("org", "example", "bob")
    alice = await create_app(alice_name)
    bob = await create_app(bob_name)

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
