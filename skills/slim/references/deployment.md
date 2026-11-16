# Running SLIM nodes

Written against SLIM node / slimctl **3.4.6**. Check https://github.com/agntcy/slim/releases (tags `slim-v*`, `slimctl-v*`) for newer. Note: some pages in the official docs still show `2.0.0` image tags and slimctl URLs — don't copy version numbers from there.

This file is a map. For anything beyond local dev, point the user at the official config for their case and adapt it; don't invent node YAML.

## Local dev node

Preferred order (see SKILL.md): reuse a running node → `slimctl slim start` → Docker.

`slimctl slim start` flags: `--config <yaml>` to use a config file, `--endpoint <host:port>` to change the listen address (e.g. `--endpoint 127.0.0.1:46357` to avoid listening on all interfaces).

Minimal config for Docker or `slimctl slim start --config`:

```yaml
# slim-config.yaml
tracing:
  log_level: info
runtime:
  n_cores: 0
  drain_timeout: 10s
services:
  slim/0:
    node_id: slim-local
    dataplane:
      servers:
        - endpoint: "0.0.0.0:46357"
          tls:
            insecure: true
      clients: []
```

```bash
docker run --rm -d --name slim-dev \
  -v "$PWD/slim-config.yaml:/config.yaml" -p 46357:46357 \
  ghcr.io/agntcy/slim:3.4.6 /slim --config /config.yaml
```

Images: `ghcr.io/agntcy/slim:<ver>` (distroless) and `:<ver>-debug` (has a shell). amd64 + arm64.

Apps in other containers on the same Docker network connect to `http://<container-name>:46357`, not `localhost`.

## Production map

All sample configs live in the `agntcy/slim` repo under `config/` (each has `server-config.yaml` for the node and `client-config.yaml` for the app side). Fetch the one matching the user's node version tag.

| Need | Node config | App side |
|---|---|---|
| TLS to the node | `config/tls/` | SDK "secure client config" with the server URL as `https://…`, CA if not in the system pool |
| mTLS | `config/mtls/` | client cert + key in the SDK client TLS config |
| Bearer JWT to the node | `config/jwt-auth-ecdsa/`, `jwt-auth-rsa/`, `jwt-auth-hmac/` | static JWT auth in the SDK client config |
| Basic auth to the node | `config/basic-auth/` | basic auth in the SDK client config |
| SPIRE / SPIFFE | `config/spire/`, Helm chart `slim-spire` | SPIRE identity provider/verifier in the app |
| Multi-node routing | `config/full-mesh/`, `config/east-west/` | nothing special; connect to the nearest node |
| WebSocket transport | `config/websocket/` | websocket URL |
| Telemetry | `config/telemetry/` | — |
| Post-quantum crypto | `config/pqc/` | — |

mTLS specifics worth knowing (from the `config/mtls` sample at 3.4.6):

- The listener's `tls` block gets `source` (node cert + key, `type: file` or `pem`) and `client_ca` (the CA that signed the apps' certs). Setting `client_ca` is what makes client certs mandatory.
- The node cert's SAN must match the host the apps dial. Each app needs its own cert with the `clientAuth` EKU.
- Cert/key files are reloaded on change. `client_ca` is **not** (the reload option is unimplemented) — restart the node after changing the CA bundle.
- Migrating a running system: `servers:` is a list, so add the mTLS listener on a new port beside the plaintext one, move apps over, then remove the plaintext entry. Otherwise every app must switch at the same moment.
- Node-to-node links (`clients:` entries) and the controller have their own `tls` blocks (`config/mtls/client-config.yaml`).
- Generating test certs on macOS: use `openssl genpkey ... -pkeyopt ec_param_enc:named_curve` (or RSA); LibreSSL's default EC encoding crashes the node.

Remember: these secure the **app ↔ node hop**. End-to-end app identity (shared secret / JWT / SPIRE) and MLS are configured in the app code — see `concepts.md` and the language reference.

## Kubernetes

Helm charts are published as OCI artifacts:

- `oci://ghcr.io/agntcy/slim/helm/slim` — data plane
- `oci://ghcr.io/agntcy/slim/helm/slim-spire` — data plane with SPIRE
- `oci://ghcr.io/agntcy/slim/helm/slim-control-plane` — controller

Guides: https://docs.agntcy.org/slim/deploy/ (kubernetes, daemonset, multicluster).

## Operating

- `slimctl` can inspect nodes and controllers (connections, routes); run `slimctl --help`.
- Node config reference: https://docs.agntcy.org/slim/components/data-plane/config/
