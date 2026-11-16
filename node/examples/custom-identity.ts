// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Custom identity provider and verifier implemented in TypeScript.
 *
 * SLIM does not have to authenticate with one of its built-in mechanisms: implement
 * `IdentityProvider` (proves who this app is) and `IdentityVerifier` (checks who a peer
 * is), and pass them to `App.newWithCustomIdentityAsync`.
 *
 * A custom identity has to get one thing right: SLIM signs the control messages of every
 * session with the provider's key pair, and the peer checks the signature with the key
 * its verifier returns from `getPublicKey`. So the provider holds a key pair
 * (`generateSignatureKeys()` makes one), puts the public key in its tokens, and swaps the
 * pair when SLIM calls `setSignatureKeys`.
 *
 * The token scheme below, `<subject>.<base64 public key>.<secret>`, is a toy that keeps
 * the example short. A real provider issues a signed token (JWT, DPoP, ...) and a real
 * verifier checks that signature.
 *
 * Run with: npm run custom-identity
 */

import * as slimBindings from '../generated/index.js';

const SHARED_SECRET = 'an-example-shared-secret';

const b64 = (data: ArrayBuffer): string => Buffer.from(data).toString('base64');
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** Issues `<subject>.<base64 public key>.<secret>` tokens. */
class ExampleProvider {
  private keys = slimBindings.generateSignatureKeys();
  private installed = false;

  constructor(private subject: string, private secret: string) {}

  // One-time async setup (load credentials, call an identity service, ...).
  async initialize(): Promise<void> {}

  getId(): string {
    return this.subject;
  }

  getToken(): string {
    // Always bind the *current* public key: it changes if SLIM installs a new pair.
    return `${this.subject}.${b64(this.keys.publicKey)}.${this.secret}`;
  }

  getSignatureKeys() {
    return this.keys;
  }

  mlsSignatureKeysInstalled(): boolean {
    return this.installed;
  }

  // Called when MLS is used. Keep the bytes exactly as given.
  setSignatureKeys(secretKey: ArrayBuffer, publicKey: ArrayBuffer): void {
    this.keys = { secretKey, publicKey };
    this.installed = true;
  }

  // No persistence: this identity cannot be exported and restored.
  exportIdentity() {
    return undefined;
  }

  holdsLongTermSigningKey(): boolean {
    return false;
  }

  restoreIdentity(_identity: unknown): void {}
}

/** Accepts tokens carrying the shared secret and exposes their claims. */
class ExampleVerifier {
  constructor(private secret: string) {}

  private parse(token: string): [string, string] {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[2] !== this.secret) {
      throw new slimBindings.IdentityCallbackError.Failed({ message: 'invalid token' });
    }
    return [parts[0], parts[1]];
  }

  // One-time async setup (fetch trust bundles, keys, ...).
  async initialize(): Promise<void> {}

  // Where an async context is available: free to do I/O.
  async verifyAsync(token: string): Promise<void> {
    this.parse(token);
  }

  // Synchronous contexts: must not block for long.
  verify(token: string): void {
    this.parse(token);
  }

  getClaims(token: string): string {
    return JSON.stringify({ sub: this.parse(token)[0] });
  }

  getPublicKey(token: string): ArrayBuffer {
    const key = Buffer.from(this.parse(token)[1], 'base64');
    return key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  }

  getSubject(token: string): string {
    return this.parse(token)[0];
  }

  verifyKeyBinding(token: string, publicKey: ArrayBuffer): void {
    if (this.parse(token)[1] !== b64(publicKey)) {
      throw new slimBindings.IdentityCallbackError.PublicKeyMismatch({
        message: 'token bound to another key',
      });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createApp(name: any) {
  return slimBindings.App.newWithCustomIdentityAsync(
    name,
    new ExampleProvider(name.toString(), SHARED_SECRET),
    new ExampleVerifier(SHARED_SECRET),
    slimBindings.Direction.Bidirectional,
  );
}

async function main() {
  slimBindings.initializeWithDefaults();

  const aliceName = new slimBindings.Name('org', 'example', 'alice');
  const bobName = new slimBindings.Name('org', 'example', 'bob');
  const alice = await createApp(aliceName);
  const bob = await createApp(bobName);

  const serving = (async () => {
    const session = await bob.listenForSessionAsync(10000);
    const received = await session.getMessageAsync(10000);
    console.log(`bob received: ${Buffer.from(received.payload).toString()}`);
    await session.publishToAndWaitAsync(
      received.context,
      bytes('hello alice'),
      undefined,
      undefined,
    );
  })();

  const session = await alice.createSessionAndWaitAsync(
    {
      sessionType: slimBindings.SessionType.PointToPoint,
      maxRetries: 3,
      interval: 333,
      metadata: new Map(),
      mlsSettings: undefined,
    },
    bobName,
  );
  await session.publishAndWaitAsync(bytes('hello bob'), undefined, undefined);
  const reply = await session.getMessageAsync(10000);
  console.log(`alice received: ${Buffer.from(reply.payload).toString()}`);

  await serving;
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
