// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Custom identity provider/verifier implemented in TypeScript, driving real sessions.
 *
 * `IdentityProvider` and `IdentityVerifier` are foreign interfaces: implement them and pass
 * the objects to `App.newWithCustomIdentityAsync`. The scheme here is a toy
 * (`<subject>.<base64 public key>.<secret>`); a real one would be a signed token
 * (JWT, DPoP, ...).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

// @ts-expect-error - tsx resolves .js imports to .ts files at runtime; generated module has default export at runtime
import * as slimBindings from '../generated/index.js';

const SECRET = 'custom-identity-test-secret';

const b64 = (data: ArrayBuffer): string => Buffer.from(data).toString('base64');

function failed(message: string): Error {
  return new slimBindings.IdentityCallbackError.Failed({ message });
}

/**
 * Issues `<subject>.<base64 public key>.<secret>` tokens.
 *
 * SLIM signs the control messages of every session with the provider's key pair and peers
 * check the signature against the token's public key, so the token has to carry the public
 * key of the pair returned by `getSignatureKeys`.
 */
class ToyProvider {
  keys = slimBindings.generateSignatureKeys();
  installed = false;
  initialized = false;

  constructor(private subject: string, private secret: string = SECRET) {}

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  getToken(): string {
    // Bind the current public key: it changes if SLIM installs a new pair.
    return `${this.subject}.${b64(this.keys.publicKey)}.${this.secret}`;
  }

  getId(): string {
    return this.subject;
  }

  getSignatureKeys() {
    return this.keys;
  }

  mlsSignatureKeysInstalled(): boolean {
    return this.installed;
  }

  setSignatureKeys(privateKey: ArrayBuffer, publicKey: ArrayBuffer): void {
    this.keys = { secretKey: privateKey, publicKey };
    this.installed = true;
  }

  // No persistence.
  exportIdentity() {
    return undefined;
  }

  holdsLongTermSigningKey(): boolean {
    return false;
  }

  restoreIdentity(_identity: unknown): void {}
}

/** Accepts tokens carrying the shared secret and exposes their claims. */
class ToyVerifier {
  initialized = false;
  verified: string[] = [];

  constructor(private secret: string = SECRET) {}

  private parse(token: string): [string, string] {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[2] !== this.secret) {
      throw failed('invalid token');
    }
    return [parts[0], parts[1]];
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async verifyAsync(token: string): Promise<void> {
    this.verify(token);
  }

  verify(token: string): void {
    this.verified.push(this.parse(token)[0]);
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

const name = (app: string) => new slimBindings.Name('org', app, 'v1');

async function createApp(appName: string, verifierSecret: string = SECRET) {
  const provider = new ToyProvider(appName);
  const verifier = new ToyVerifier(verifierSecret);
  const app = await slimBindings.App.newWithCustomIdentityAsync(
    name(appName),
    provider,
    verifier,
    slimBindings.Direction.Bidirectional,
  );
  return { app, provider, verifier };
}

const sessionConfig = () => ({
  sessionType: slimBindings.SessionType.PointToPoint,
  maxRetries: 3,
  interval: 333,
  metadata: new Map(),
  mlsSettings: undefined,
});

describe('custom identity implemented in TypeScript', () => {
  test('request/reply between two apps', async () => {
    slimBindings.initializeWithDefaults();

    const sender = await createApp('custom-id-sender');
    const receiver = await createApp('custom-id-receiver');

    // `initialize` is awaited while the app is created.
    for (const o of [sender.provider, sender.verifier, receiver.provider, receiver.verifier]) {
      assert.ok(o.initialized, 'initialize should have been called');
    }

    const served = (async () => {
      const session = await receiver.app.listenForSessionAsync(10000);
      const received = await session.getMessageAsync(10000);
      assert.strictEqual(Buffer.from(received.payload).toString(), 'thisistherequest');
      await session.publishToAndWaitAsync(
        received.context,
        Buffer.from('thisistheresponse'),
        undefined,
        undefined,
      );
    })();

    const session = await sender.app.createSessionAndWaitAsync(
      sessionConfig(),
      name('custom-id-receiver'),
    );
    await session.publishAndWaitAsync(Buffer.from('thisistherequest'), undefined, undefined);
    const reply = await session.getMessageAsync(10000);
    assert.strictEqual(Buffer.from(reply.payload).toString(), 'thisistheresponse');
    await served;

    // SLIM verified the peer's token with our verifier.
    assert.ok(receiver.verifier.verified.includes('custom-id-sender'));
  });

  test('a verifier that rejects the token stops the session', async () => {
    slimBindings.initializeWithDefaults();

    const sender = await createApp('custom-id-bad-sender');
    await createApp('custom-id-bad-receiver', 'some-other-secret');

    await assert.rejects(
      sender.app.createSessionAndWaitAsync(sessionConfig(), name('custom-id-bad-receiver')),
    );
  });
});
