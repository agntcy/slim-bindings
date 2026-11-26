// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Apps whose identity is a did:key.
 *
 * `Service.createAppWithDidKey` (and `App.newWithDidKey`) takes the app's Ed25519 private
 * key, a PKCS#8 PEM document, and the JWKS of the public keys the app accepts, its own
 * included. The app's identity is the did:key of its key: the tokens it sends are JWTs
 * whose issuer and subject are that did:key. The keys are generated for each run.
 *
 * The tests use the blocking calls: in slim 3.5.1 the async ones
 * (`createAppWithDidKeyAsync`, `App.newWithDidKeyAsync`) do not run on SLIM's runtime and
 * panic with "there is no reactor running".
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import type { KeyObject } from "node:crypto";

// @ts-expect-error - tsx resolves .js imports to .ts files at runtime; generated module has default export at runtime
import * as slimBindings from "../generated/index.js";

// RFC 8032 section 7.1, test 1, and its did:key.
const RFC8032_SEED =
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC8032_DID = "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw";
// The PKCS#8 DER encoding of an Ed25519 private key is this prefix, then the seed.
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

/** An Ed25519 key, as `createAppWithDidKey` takes it. */
class DidKey {
  /** The PKCS#8 PEM document of the private key. */
  readonly privatePem: string;
  /** The public key, as an OKP Ed25519 JWK of a trust anchor. */
  readonly jwk: Record<string, string>;

  constructor(key: KeyObject = generateKeyPairSync("ed25519").privateKey) {
    this.privatePem = key.export({ type: "pkcs8", format: "pem" }).toString();
    const { kty, crv, x } = key.export({ format: "jwk" });
    this.jwk = { kty: kty!, crv: crv!, alg: "EdDSA", use: "sig", x: x! };
  }

  get did(): string {
    return slimBindings.didKeyOfPrivateKey(this.privatePem);
  }
}

/** The JWKS that lists the public keys of `keys`. */
const trustedKeys = (...keys: DidKey[]) =>
  JSON.stringify({ keys: keys.map((k) => k.jwk) });

/** The subject of a JWT, after checking that its issuer is the same. */
function tokenSubject(token: string): string {
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  );
  assert.strictEqual(claims.iss, claims.sub);
  return claims.sub;
}

const name = (app: string) => new slimBindings.Name("org", app, "v1");

const sessionConfig = (mls: boolean) => ({
  sessionType: slimBindings.SessionType.PointToPoint,
  maxRetries: 3,
  interval: 333,
  metadata: new Map(),
  mlsSettings: mls ? { headerIntegrityValidationPercent: 100 } : undefined,
});

describe("did:key identity", () => {
  test("the did:key of a known key; a bad key is an error", () => {
    const seed = Buffer.from(PKCS8_ED25519_PREFIX + RFC8032_SEED, "hex");
    const key = createPrivateKey({ key: seed, format: "der", type: "pkcs8" });
    assert.strictEqual(new DidKey(key).did, RFC8032_DID);

    assert.throws(() => slimBindings.didKeyOfPrivateKey("not a pem"));
  });

  test("keys the call does not take are an error", () => {
    slimBindings.initializeWithDefaults();
    const service = slimBindings.getGlobalService();
    const key = new DidKey();
    const other = new DidKey();

    for (const [what, privateKey, trusted] of [
      ["private key is not a PEM", "not a pem", trustedKeys(key)],
      ["trust anchor is not a JWKS", key.privatePem, "not a jwks"],
      ["trust anchor without its own key", key.privatePem, trustedKeys(other)],
    ]) {
      assert.throws(
        () =>
          service.createAppWithDidKey(
            name("did-key-invalid"),
            privateKey,
            trusted,
            slimBindings.Direction.Bidirectional,
          ),
        undefined,
        what,
      );
    }
  });

  for (const mls of [true, false]) {
    test(`request/reply between two apps (MLS ${mls ? "on" : "off"})`, async () => {
      slimBindings.initializeWithDefaults();

      const tag = mls ? "mls" : "plain";
      const alice = new DidKey();
      const bob = new DidKey();
      // Each app lists the keys it accepts, its own included.
      const trusted = trustedKeys(alice, bob);

      // The App constructor and the Service method create the same kind of app.
      const sender = slimBindings.App.newWithDidKey(
        name(`did-key-sender-${tag}`),
        alice.privatePem,
        trusted,
        slimBindings.Direction.Bidirectional,
      );
      const receiver = slimBindings.getGlobalService().createAppWithDidKey(
        name(`did-key-receiver-${tag}`),
        bob.privatePem,
        trusted,
        slimBindings.Direction.Bidirectional,
      );

      const served = (async () => {
        const session = await receiver.listenForSessionAsync(10000);
        const received = await session.getMessageAsync(10000);
        assert.strictEqual(
          Buffer.from(received.payload).toString(),
          "thisistherequest",
        );
        await session.publishToAndWaitAsync(
          received.context,
          Buffer.from("thisistheresponse"),
          undefined,
          undefined,
        );
        return received.context.identity as string;
      })();

      const session = await sender.createSessionAndWaitAsync(
        sessionConfig(mls),
        name(`did-key-receiver-${tag}`),
      );
      await session.publishAndWaitAsync(
        Buffer.from("thisistherequest"),
        undefined,
        undefined,
      );
      const reply = await session.getMessageAsync(10000);
      assert.strictEqual(
        Buffer.from(reply.payload).toString(),
        "thisistheresponse",
      );
      const senderIdentity = await served;

      // The identity of a message is the sender's token: each side sees the other's did:key.
      assert.strictEqual(tokenSubject(senderIdentity), alice.did);
      assert.strictEqual(tokenSubject(reply.context.identity), bob.did);
    });
  }

  test("a receiver that does not trust the sender's key stops the session", async () => {
    slimBindings.initializeWithDefaults();

    const mallory = new DidKey();
    const bob = new DidKey();
    const sender = slimBindings.App.newWithDidKey(
      name("did-key-untrusted-sender"),
      mallory.privatePem,
      trustedKeys(mallory, bob),
      slimBindings.Direction.Bidirectional,
    );
    // The receiver trusts only its own key. Keep it referenced for the whole test.
    const receiver = slimBindings.App.newWithDidKey(
      name("did-key-untrusted-receiver"),
      bob.privatePem,
      trustedKeys(bob),
      slimBindings.Direction.Bidirectional,
    );

    await assert.rejects(
      sender.createSessionAndWaitAsync(
        sessionConfig(false),
        name("did-key-untrusted-receiver"),
      ),
    );
    assert.ok(receiver);
  });
});
