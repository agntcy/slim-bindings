#!/usr/bin/env bash
# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0
#
# Generate the keys of the did:key examples.
#
#   generate-keys.sh <output-dir> <name>...
#
# For each <name> it writes <output-dir>/<name>.pem, the app's Ed25519 private key (a
# PKCS#8 PEM document), for the sender and receiver examples' --private-key. It also writes
# <output-dir>/trusted-keys.jwks, the JWKS with the public key of every <name>, for
# --trusted-keys. Apps that share that JWKS accept each other. An app's JWKS has to list its
# own key too.
#
# Needs OpenSSL 1.1.1 or later and base64. The LibreSSL that macOS ships as `openssl`
# cannot generate Ed25519 keys: point OPENSSL at another one, for example
# OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl.
#
# The keys are for trying the examples: generate them where you run the examples, and
# never commit them.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <output-dir> <name>..." >&2
  exit 1
fi

openssl="${OPENSSL:-openssl}"
if ! "$openssl" genpkey -algorithm ed25519 >/dev/null 2>&1; then
  echo "$openssl cannot generate Ed25519 keys ($("$openssl" version 2>&1))." >&2
  echo "Set OPENSSL to OpenSSL 1.1.1 or later, for example OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl." >&2
  exit 1
fi

out="$1"
shift
umask 077
mkdir -p "$out"

public_jwks=""
for name in "$@"; do
  "$openssl" genpkey -algorithm ed25519 -out "$out/$name.pem"
  # The public key is the last 32 bytes of its DER encoding, as base64url without padding.
  x=$("$openssl" pkey -in "$out/$name.pem" -pubout -outform DER \
    | tail -c 32 | base64 | tr '+/' '-_' | tr -d '=\n')
  public_jwks="${public_jwks:+$public_jwks,}{\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"alg\":\"EdDSA\",\"use\":\"sig\",\"x\":\"$x\"}"
  echo "$name: $out/$name.pem"
done

printf '{"keys":[%s]}\n' "$public_jwks" > "$out/trusted-keys.jwks"
echo "trust anchor: $out/trusted-keys.jwks"
