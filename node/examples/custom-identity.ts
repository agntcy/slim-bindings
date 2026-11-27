// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Custom identity provider and verifier implemented in TypeScript, based on X.509
 * certificates.
 *
 * SLIM does not have to authenticate with one of its built-in mechanisms: implement
 * `IdentityProvider` (proves who this app is) and `IdentityVerifier` (checks who a peer
 * is), and pass them to `App.newWithCustomIdentityAsync`.
 *
 * Three things a custom identity has to get right:
 *
 *   - SLIM signs the control messages of every session with the provider's key pair, and
 *     the peer checks the signature with the key its verifier returns from `getPublicKey`.
 *     Here the key pair is the certificate's own: the token is the certificate, so the key
 *     the verifier returns is the one in the certificate.
 *   - SLIM can ask a provider to install a new key pair (`setSignatureKeys`), unless the
 *     provider says its keys are installed (`mlsSignatureKeysInstalled`). A certificate
 *     identity has a fixed key, so it reports them installed and refuses a replacement.
 *   - The methods are called from SLIM's own threads: keep them quick and side-effect free.
 *
 * The identities are X.509 certificates. Each app holds a certificate issued by a CA
 * (generate them with `testdata/x509/gen.sh`) and its private key, and its
 * token is the certificate in PEM form. The signing keys are the certificate's key (ECDSA
 * P-256, the MLS ciphersuite of SLIM): the secret key as the raw 32-byte scalar, the public
 * key as an uncompressed SEC1 point. The verifier trusts one CA: it checks the certificate
 * was issued by it, is within its validity period and is not a CA certificate, and its
 * subject is the common name. It is a trust-anchor check only: there is no revocation
 * checking (CRL / OCSP).
 *
 * Generate the certificates once with `testdata/x509/gen.sh`, then run with:
 * npm run custom-identity
 */

import { X509Certificate, createPrivateKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as slimBindings from "../generated/index.js";

const CERTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "testdata",
  "x509",
);

const bytes = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;
const toArrayBuffer = (buf: Buffer): ArrayBuffer =>
  buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;

const failed = (message: string) =>
  new slimBindings.IdentityCallbackError.Failed({ message });

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

/** Uses an X.509 certificate as the token and its key pair as the signing keys. */
class ExampleProvider {
  private certPem: string;
  private cert: X509Certificate;
  private keys: { secretKey: ArrayBuffer; publicKey: ArrayBuffer };

  constructor(certFile: string, keyFile: string) {
    this.certPem = readFileSync(certFile, "utf8");
    this.cert = new X509Certificate(this.certPem);
    this.keys = {
      secretKey: toArrayBuffer(
        rawSecretKey(createPrivateKey(readFileSync(keyFile))),
      ),
      publicKey: toArrayBuffer(sec1PublicKey(this.cert.publicKey)),
    };
  }

  // One-time async setup (load credentials, call an identity service, ...).
  async initialize(): Promise<void> {}

  getId(): string {
    return commonName(this.cert);
  }

  getToken(): string {
    return this.certPem;
  }

  getSignatureKeys() {
    return this.keys;
  }

  // The keys are the certificate's: SLIM must not generate its own.
  mlsSignatureKeysInstalled(): boolean {
    return true;
  }

  setSignatureKeys(_secretKey: ArrayBuffer, _publicKey: ArrayBuffer): void {
    throw failed(
      "the signing key is the certificate's key and cannot be replaced",
    );
  }

  // No persistence: this identity cannot be exported and restored.
  exportIdentity() {
    return undefined;
  }

  // The certificate's key is long-term.
  holdsLongTermSigningKey(): boolean {
    return true;
  }

  restoreIdentity(_identity: unknown): void {}
}

/**
 * Accepts tokens whose certificate was issued by the trusted CA.
 *
 * Trust-anchor check only: no revocation (CRL / OCSP) is performed.
 */
class ExampleVerifier {
  private ca: X509Certificate;

  constructor(caFile: string) {
    this.ca = new X509Certificate(readFileSync(caFile));
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
      if (e instanceof slimBindings.IdentityCallbackError.Failed) {
        throw e;
      }
      throw failed(`invalid token: ${e instanceof Error ? e.message : e}`);
    }
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
    return JSON.stringify({ sub: commonName(this.parse(token)) });
  }

  getPublicKey(token: string): ArrayBuffer {
    return toArrayBuffer(sec1PublicKey(this.parse(token).publicKey));
  }

  getSubject(token: string): string {
    return commonName(this.parse(token));
  }

  verifyKeyBinding(token: string, publicKey: ArrayBuffer): void {
    const bound = sec1PublicKey(this.parse(token).publicKey);
    if (!bound.equals(Buffer.from(publicKey))) {
      throw new slimBindings.IdentityCallbackError.PublicKeyMismatch({
        message: "token bound to another key",
      });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createApp(name: any, user: string) {
  return slimBindings.App.newWithCustomIdentityAsync(
    name,
    new ExampleProvider(
      join(CERTS_DIR, `${user}.pem`),
      join(CERTS_DIR, `${user}.key`),
    ),
    new ExampleVerifier(join(CERTS_DIR, "ca.pem")),
    slimBindings.Direction.Bidirectional,
  );
}

async function main() {
  if (!existsSync(join(CERTS_DIR, "ca.pem"))) {
    throw new Error(
      `no certificates in ${CERTS_DIR}: generate them with testdata/x509/gen.sh`,
    );
  }
  slimBindings.initializeWithDefaults();

  const aliceName = new slimBindings.Name("org", "example", "alice");
  const bobName = new slimBindings.Name("org", "example", "bob");
  const alice = await createApp(aliceName, "alice");
  const bob = await createApp(bobName, "bob");

  const serving = (async () => {
    const session = await bob.listenForSessionAsync(10000);
    const received = await session.getMessageAsync(10000);
    console.log(`bob received: ${Buffer.from(received.payload).toString()}`);
    await session.publishToAndWaitAsync(
      received.context,
      bytes("hello alice"),
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
  await session.publishAndWaitAsync(bytes("hello bob"), undefined, undefined);
  const reply = await session.getMessageAsync(10000);
  console.log(`alice received: ${Buffer.from(reply.payload).toString()}`);

  await serving;
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
