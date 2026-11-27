// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Custom identity provider/verifier implemented in TypeScript, driving real sessions.
 *
 * `IdentityProvider` and `IdentityVerifier` are foreign interfaces: implement them and pass
 * the objects to `App.newWithCustomIdentityAsync`. The scheme here is based on X.509
 * certificates: the token is the PEM certificate, its key pair (ECDSA P-256) is the SLIM
 * signing key pair, and the verifier trusts the certificates issued by one CA. The CA and
 * the certificates are generated for each run. Only the trust anchor is checked: there is
 * no revocation.
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  X509Certificate,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import type { KeyObject } from "node:crypto";

// @ts-expect-error - tsx resolves .js imports to .ts files at runtime; generated module has default export at runtime
import * as slimBindings from "../generated/index.js";

// node:crypto reads X.509 certificates but cannot write them, so the test encodes them
// itself: just the DER it needs for an ECDSA P-256 certificate with a common name.
const der = (tag: number, ...content: Buffer[]): Buffer => {
  const body = Buffer.concat(content);
  const n = body.length;
  const length =
    n < 0x80
      ? Buffer.from([n])
      : n < 0x100
        ? Buffer.from([0x81, n])
        : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const seq = (...content: Buffer[]) => der(0x30, ...content);
const oid = (hex: string) => der(0x06, Buffer.from(hex, "hex"));
const ECDSA_WITH_SHA256 = seq(oid("2a8648ce3d040302"));
const commonNameDer = (cn: string) =>
  seq(der(0x31, seq(oid("550403"), der(0x0c, Buffer.from(cn)))));
const utcTime = (date: Date) =>
  der(
    0x17,
    Buffer.from(date.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"),
  );

/**
 * A certificate for `subject`'s key, signed by `issuerKey` on behalf of `issuer`, valid
 * from a day ago to a day from now. `ca` marks it a CA certificate.
 */
function issueCertificate(
  subject: string,
  key: KeyObject,
  issuer: string,
  issuerKey: KeyObject,
  ca: boolean,
): string {
  const day = 24 * 60 * 60 * 1000;
  const serial = randomBytes(16);
  serial[0] &= 0x7f; // a positive INTEGER
  const basicConstraints = seq(
    oid("551d13"),
    der(0x01, Buffer.from([0xff])), // critical
    der(0x04, ca ? seq(der(0x01, Buffer.from([0xff]))) : seq()),
  );
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), // version 3
    der(0x02, serial),
    ECDSA_WITH_SHA256,
    commonNameDer(issuer),
    seq(utcTime(new Date(Date.now() - day)), utcTime(new Date(Date.now() + day))),
    commonNameDer(subject),
    createPublicKey(key).export({ type: "spki", format: "der" }),
    der(0xa3, seq(basicConstraints)),
  );
  const signature = sign("sha256", tbs, { key: issuerKey, dsaEncoding: "der" });
  const cert = seq(
    tbs,
    ECDSA_WITH_SHA256,
    der(0x03, Buffer.from([0]), signature),
  );
  return new X509Certificate(cert).toString();
}

const newKey = () =>
  generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;

/**
 * The test PKI, generated for each run: a CA, and alice's and bob's certificates (CN =
 * org/example/alice, org/example/bob) issued by it, with their keys.
 */
const PKI = (() => {
  const caKey = newKey();
  const certs: Record<string, string> = {
    ca: issueCertificate("SLIM test CA", caKey, "SLIM test CA", caKey, true),
  };
  const keys: Record<string, KeyObject> = {};
  for (const user of ["alice", "bob"]) {
    keys[user] = newKey();
    certs[user] = issueCertificate(
      `org/example/${user}`,
      keys[user],
      "SLIM test CA",
      caKey,
      false,
    );
  }
  return { certs, keys };
})();

const toArrayBuffer = (buf: Buffer): ArrayBuffer =>
  buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;

function failed(message: string): Error {
  return new slimBindings.IdentityCallbackError.Failed({ message });
}

/** The common name of a certificate: this is the identity of its holder. */
function commonName(cert: X509Certificate): string {
  const cn = cert.toLegacyObject().subject.CN as string | string[] | undefined;
  if (typeof cn !== "string" || cn === "") {
    throw failed("certificate must have exactly one common name");
  }
  return cn;
}

/** A P-256 public key as an uncompressed SEC1 point: 0x04 || X || Y (65 bytes). */
function sec1PublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" });
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x as string, "base64url"),
    Buffer.from(jwk.y as string, "base64url"),
  ]);
}

/** A P-256 private key as the raw 32-byte big-endian scalar. */
function rawSecretKey(key: KeyObject): Buffer {
  const d = Buffer.from(key.export({ format: "jwk" }).d as string, "base64url");
  return Buffer.concat([Buffer.alloc(32 - d.length), d]);
}

/**
 * Uses an X.509 certificate as the token and its key pair as the signing keys.
 *
 * SLIM signs the control messages of every session with the key pair returned by
 * `getSignatureKeys`, and peers check the signature with the key their verifier extracts
 * from the token: here the certificate's own key, so the keys are never replaced.
 */
class CertProvider {
  // How many times SLIM (or the test) called each method.
  calls = new Map<string, number>();
  initialized = false;
  private certPem: string;
  private cert: X509Certificate;
  private keys: { secretKey: ArrayBuffer; publicKey: ArrayBuffer };

  private count(method: string): void {
    this.calls.set(method, (this.calls.get(method) ?? 0) + 1);
  }

  constructor(user: string) {
    this.certPem = PKI.certs[user];
    this.cert = new X509Certificate(this.certPem);
    this.keys = {
      secretKey: toArrayBuffer(rawSecretKey(PKI.keys[user])),
      publicKey: toArrayBuffer(sec1PublicKey(this.cert.publicKey)),
    };
  }

  async initialize(): Promise<void> {
    this.count("initialize");
    this.initialized = true;
  }

  getToken(): string {
    this.count("getToken");
    return this.certPem;
  }

  getId(): string {
    this.count("getId");
    return commonName(this.cert);
  }

  getSignatureKeys() {
    this.count("getSignatureKeys");
    return this.keys;
  }

  mlsSignatureKeysInstalled(): boolean {
    this.count("mlsSignatureKeysInstalled");
    return true;
  }

  setSignatureKeys(_privateKey: ArrayBuffer, _publicKey: ArrayBuffer): void {
    this.count("setSignatureKeys");
    throw failed(
      "the signing key is the certificate's key and cannot be replaced",
    );
  }

  // No persistence.
  exportIdentity() {
    return undefined;
  }

  holdsLongTermSigningKey(): boolean {
    return true;
  }

  restoreIdentity(_identity: unknown): void {}
}

/** Accepts tokens whose certificate was issued by the trusted CA and exposes their claims. */
class CertVerifier {
  calls = new Map<string, number>();
  initialized = false;
  verified: string[] = [];
  rejections = 0;
  private ca: X509Certificate;

  private count(method: string): void {
    this.calls.set(method, (this.calls.get(method) ?? 0) + 1);
  }

  // `trusted` names the certificate of the trust anchor: the CA, or (to test an untrusted
  // issuer) a user's own certificate.
  constructor(trusted: string = "ca") {
    this.ca = new X509Certificate(PKI.certs[trusted]);
  }

  // Validates the token, a PEM certificate, and returns the certificate.
  private parse(token: string): X509Certificate {
    try {
      // Exactly one PEM block, nothing but whitespace around it.
      if (
        !/^\s*-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*$/.test(
          token,
        )
      ) {
        throw new Error("malformed token");
      }
      const cert = new X509Certificate(token);

      if (!cert.verify(this.ca.publicKey) || !cert.checkIssued(this.ca)) {
        throw new Error("certificate not issued by the trusted CA");
      }
      const now = new Date();
      if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
        throw new Error("certificate is not valid now");
      }
      if (cert.ca) {
        throw new Error("a CA certificate cannot be used as an identity");
      }
      if (
        cert.publicKey.asymmetricKeyType !== "ec" ||
        cert.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
      ) {
        throw new Error("unsupported certificate key type");
      }
      commonName(cert);
      return cert;
    } catch (e) {
      this.rejections++;
      if (e instanceof slimBindings.IdentityCallbackError.Failed) {
        throw e;
      }
      throw failed(`invalid token: ${e instanceof Error ? e.message : e}`);
    }
  }

  async initialize(): Promise<void> {
    this.count("initialize");
    this.initialized = true;
  }

  async verifyAsync(token: string): Promise<void> {
    this.count("verifyAsync");
    this.verified.push(commonName(this.parse(token)));
  }

  verify(token: string): void {
    this.count("verify");
    this.verified.push(commonName(this.parse(token)));
  }

  getClaims(token: string): string {
    this.count("getClaims");
    return JSON.stringify({ sub: commonName(this.parse(token)) });
  }

  getPublicKey(token: string): ArrayBuffer {
    this.count("getPublicKey");
    return toArrayBuffer(sec1PublicKey(this.parse(token).publicKey));
  }

  getSubject(token: string): string {
    this.count("getSubject");
    return commonName(this.parse(token));
  }

  verifyKeyBinding(token: string, publicKey: ArrayBuffer): void {
    this.count("verifyKeyBinding");
    const bound = sec1PublicKey(this.parse(token).publicKey);
    if (!bound.equals(Buffer.from(publicKey))) {
      throw new slimBindings.IdentityCallbackError.PublicKeyMismatch({
        message: "token bound to another key",
      });
    }
  }
}

const name = (app: string) => new slimBindings.Name("org", app, "v1");

// `user` is the certificate (alice or bob) the app presents; `trustedCa` the verifier's anchor.
async function createApp(
  appName: string,
  user: string,
  trustedCa: string = "ca",
) {
  const provider = new CertProvider(user);
  const verifier = new CertVerifier(trustedCa);
  const app = await slimBindings.App.newWithCustomIdentityAsync(
    name(appName),
    provider,
    verifier,
    slimBindings.Direction.Bidirectional,
  );
  return { app, provider, verifier };
}

const sessionConfig = (mls: boolean) => ({
  sessionType: slimBindings.SessionType.PointToPoint,
  maxRetries: 3,
  interval: 333,
  metadata: new Map(),
  mlsSettings: mls ? { headerIntegrityValidationPercent: 0 } : undefined,
});

const called = (o: CertProvider | CertVerifier, method: string) =>
  o.calls.get(method) ?? 0;

describe("custom identity implemented in TypeScript", () => {
  for (const mls of [true, false]) {
    test(`request/reply between two apps (MLS ${mls ? "on" : "off"})`, async () => {
      slimBindings.initializeWithDefaults();

      const tag = mls ? "mls" : "plain";
      const sender = await createApp(`custom-id-sender-${tag}`, "alice");
      const receiver = await createApp(`custom-id-receiver-${tag}`, "bob");
      const all = [
        sender.provider,
        sender.verifier,
        receiver.provider,
        receiver.verifier,
      ];

      // `initialize` is awaited once, while the app is created; nothing else ran yet.
      for (const o of all) {
        assert.ok(o.initialized, "initialize should have been called");
        assert.strictEqual(called(o, "initialize"), 1);
        assert.strictEqual(called(o, "setSignatureKeys"), 0);
        assert.strictEqual(called(o, "mlsSignatureKeysInstalled"), 0);
        assert.strictEqual(called(o, "verify") + called(o, "verifyAsync"), 0);
        assert.strictEqual(called(o, "verifyKeyBinding"), 0);
      }

      const served = (async () => {
        const session = await receiver.app.listenForSessionAsync(10000);
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
      })();

      const session = await sender.app.createSessionAndWaitAsync(
        sessionConfig(mls),
        name(`custom-id-receiver-${tag}`),
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
      await served;

      // SLIM verified the peer's token with our verifier.
      assert.ok(receiver.verifier.verified.includes("org/example/alice"));
      assert.ok(sender.verifier.verified.includes("org/example/bob"));
      assert.strictEqual(receiver.verifier.rejections, 0);
      assert.strictEqual(sender.verifier.rejections, 0);

      // SLIM calls `verify` (not `verifyAsync`) on each peer's token, and `getPublicKey` to get
      // the key the peer signs its control messages with.
      for (const p of [sender.provider, receiver.provider]) {
        assert.ok(called(p, "getToken") >= 1);
        assert.ok(called(p, "getSignatureKeys") >= 1);
        // The keys are the certificate's: SLIM never replaces them.
        assert.strictEqual(called(p, "setSignatureKeys"), 0);
      }
      for (const verifier of [sender.verifier, receiver.verifier]) {
        assert.ok(called(verifier, "verify") >= 1);
        assert.ok(called(verifier, "getPublicKey") >= 1);
      }

      if (mls) {
        // SLIM checks `mlsSignatureKeysInstalled` and finds the keys installed; peers check that
        // a token is bound to the key of a message with `verifyKeyBinding`.
        for (const p of [sender.provider, receiver.provider]) {
          assert.ok(called(p, "mlsSignatureKeysInstalled") >= 1);
        }
        for (const v of [sender.verifier, receiver.verifier]) {
          assert.ok(called(v, "verifyKeyBinding") >= 1);
          assert.ok(called(v, "getSubject") >= 1);
        }
      } else {
        for (const o of [sender.verifier, receiver.verifier]) {
          assert.strictEqual(called(o, "verifyKeyBinding"), 0);
        }
      }
    });
  }

  test("a verifier that rejects the token stops the session", async () => {
    slimBindings.initializeWithDefaults();

    const sender = await createApp("custom-id-bad-sender", "alice");
    // bob's certificate is not a CA: it cannot have issued alice's. Keep the app referenced
    // for the whole test.
    const receiver = await createApp(
      "custom-id-bad-receiver",
      "bob",
      "bob",
    );

    await assert.rejects(
      sender.app.createSessionAndWaitAsync(
        sessionConfig(false),
        name("custom-id-bad-receiver"),
      ),
    );
    // The receiver's verifier is what refused the sender's token.
    assert.ok(receiver.verifier.rejections >= 1);
    assert.strictEqual(receiver.verifier.verified.length, 0);
    assert.ok(receiver.app);
  });

  test("the token is the certificate and its key is the signing key", () => {
    const provider = new CertProvider("alice");
    const verifier = new CertVerifier();
    const token = provider.getToken();
    assert.strictEqual(token, PKI.certs.alice);

    verifier.verify(token);
    assert.strictEqual(verifier.getSubject(token), "org/example/alice");
    assert.strictEqual(provider.getId(), "org/example/alice");
    assert.deepStrictEqual(JSON.parse(verifier.getClaims(token)), {
      sub: "org/example/alice",
    });

    const keys = provider.getSignatureKeys();
    assert.strictEqual(keys.secretKey.byteLength, 32);
    assert.strictEqual(keys.publicKey.byteLength, 65);
    assert.deepStrictEqual(
      Buffer.from(verifier.getPublicKey(token)),
      Buffer.from(keys.publicKey),
    );
    verifier.verifyKeyBinding(token, keys.publicKey);
    assert.ok(provider.mlsSignatureKeysInstalled());
    assert.ok(provider.holdsLongTermSigningKey());

    // Another key fails the key binding.
    const other = new CertProvider("bob").getSignatureKeys().publicKey;
    assert.throws(
      () => verifier.verifyKeyBinding(token, other),
      (e: unknown) =>
        e instanceof slimBindings.IdentityCallbackError.PublicKeyMismatch,
    );

    // The signing key cannot be replaced.
    assert.throws(
      () => provider.setSignatureKeys(keys.secretKey, keys.publicKey),
      (e: unknown) => e instanceof slimBindings.IdentityCallbackError.Failed,
    );
  });

  test("invalid tokens are rejected", () => {
    const token = new CertProvider("alice").getToken();
    const verifier = new CertVerifier();
    const rejected = (v: CertVerifier, tampered: string, message?: RegExp) =>
      assert.throws(
        () => v.verify(tampered),
        (e: unknown) =>
          e instanceof slimBindings.IdentityCallbackError.Failed &&
          (message === undefined ||
            message.test(String(e.inner?.message ?? e.message))),
      );

    // The CA certificate itself is not an identity.
    rejected(
      verifier,
      PKI.certs.ca,
      /CA certificate/,
    );

    // A certificate the verifier's CA did not issue: bob's cannot be the issuer of alice's.
    rejected(
      new CertVerifier("bob"),
      token,
      /not issued by the trusted CA/,
    );

    // A flipped character inside the base64 body.
    const at = token.indexOf("\n") + 40;
    const flipped = token[at] === "A" ? "B" : "A";
    rejected(verifier, token.slice(0, at) + flipped + token.slice(at + 1));

    // Trailing content after the PEM block.
    rejected(verifier, token + "garbage", /malformed/);
    verifier.verify(token + "\n\n");

    rejected(verifier, "not-a-token");
    rejected(verifier, "");
  });
});
