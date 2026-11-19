#!/bin/sh
# Regenerates the example CA and the end-entity certificates used by the custom identity
# examples. The keys are public test keys: never use them for anything else.
#
#   ca.pem / ca.key      self-signed CA (trust anchor of the verifiers)
#   <name>.pem / .key    certificate signed by the CA, CN = the app's subject, and its
#                        private key (PKCS#8). EC P-256, valid for 100 years.
set -eu
cd "$(dirname "$0")"

openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 36500 -subj "/CN=SLIM example CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.pem

issue() {
    name=$1 subject=$2
    escaped=$(printf '%s' "$subject" | sed 's|/|\\/|g')
    openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "$name.key"
    openssl req -new -key "$name.key" -subj "/CN=$escaped" -out "$name.csr"
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' > "$name.ext"
    openssl x509 -req -in "$name.csr" -CA ca.pem -CAkey ca.key -CAcreateserial -sha256 \
        -days 36500 -extfile "$name.ext" -out "$name.pem"
    rm -f "$name.csr" "$name.ext"
}

issue alice org/example/alice
issue bob org/example/bob
rm -f ca.srl
