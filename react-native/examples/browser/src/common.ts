// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Common utilities for SLIM browser (WASM) examples.
 *
 * Shared helpers used across the reference implementations, aligned with the
 * Node.js examples under slim-bindings/node/examples/.
 */

import {
  Direction,
  Name,
  Service,
  uniffiInitAsync,
  type AppLike,
  type NameLike,
  type ServiceLike,
} from "@agntcy/slim-bindings-react-native/web";

export const DEFAULT_ENDPOINT = "ws://127.0.0.1:46357";
export const DEFAULT_SHARED_SECRET = "demo-shared-secret-min-32-chars!!";

let wasmReady = false;

export function splitId(id: string): NameLike {
  const parts = id.split("/");
  if (parts.length !== 3) {
    throw new Error(
      `IDs must be in the format organization/namespace/app-or-stream, got: ${id}`,
    );
  }
  return Name.fromString(id);
}

export async function initializeWasm(): Promise<void> {
  if (wasmReady) return;
  await uniffiInitAsync();
  wasmReady = true;
}

export function isWasmReady(): boolean {
  return wasmReady;
}

export type ConnectOptions = {
  endpoint: string;
  localId: string;
  sharedSecret: string;
  token?: string;
};

/**
 * A connected SLIM app together with the owning service and the upstream
 * connection id. The connection id is required to set routes and to disconnect.
 */
export type ConnectedApp = {
  app: AppLike;
  service: ServiceLike;
  connId: bigint;
};

/**
 * Initialize WASM, connect to SLIM over WebSocket, and subscribe locally.
 *
 * Uses the Service-based flow introduced in agntcy-slim-bindings 2.0.0-alpha.10:
 * connect the service to obtain a connection id, create the app with
 * SharedSecret auth, then subscribe the app's own name on that connection so
 * the node can route messages back to it.
 */
export async function createAndConnectApp(
  options: ConnectOptions,
): Promise<ConnectedApp> {
  await initializeWasm();

  const local = splitId(options.localId);
  // The service id must be a plain identifier token (no "/"): the Service
  // constructor parses it via ID::new_with_name and rejects path-like values.
  const serviceId = options.localId.replace(/[^A-Za-z0-9_-]/g, "-");
  const service = new Service(serviceId);
  const connId = await service.connectAsync(
    options.endpoint.trim(),
    options.token?.trim() || undefined,
  );
  const app = await service.createAppWithDirectionAsync(
    local,
    options.sharedSecret,
    Direction.Bidirectional,
  );
  await app.subscribeAsync(local, connId);

  return { app, service, connId };
}

export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const uniffiError = error as {
      tag?: unknown;
      inner?: { message?: unknown };
    };
    if (typeof uniffiError.inner?.message === "string") {
      const tag =
        typeof uniffiError.tag === "string" ? `${uniffiError.tag}: ` : "";
      return `${tag}${uniffiError.inner.message}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export type QueryDefaults = Record<string, string>;

/**
 * Read optional query-string overrides for example configuration.
 */
export function parseQueryParams(defaults: QueryDefaults): QueryDefaults {
  const params = new URLSearchParams(window.location.search);
  const resolved = { ...defaults, ...readPageDefaults() };

  for (const key of Object.keys(resolved)) {
    const value = params.get(key);
    if (value !== null && value.length > 0) {
      resolved[key] = value;
    }
  }

  return resolved;
}

function readPageDefaults(): QueryDefaults {
  const resolved: QueryDefaults = {};

  for (const attr of document.body.attributes) {
    if (!attr.name.startsWith("data-default-")) continue;
    resolved[attr.name.slice("data-default-".length)] = attr.value;
  }

  return resolved;
}

export function parseInviteList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
