// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Common utilities for SLIM browser (WASM) examples.
 *
 * Shared helpers used across the reference implementations, aligned with the
 * Node.js examples under slim-bindings/node/examples/.
 */

import {
  App,
  Direction,
  Name,
  uniffiInitAsync,
  type AppLike,
  type NameLike,
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
 * Initialize WASM, connect to SLIM over WebSocket, and subscribe locally.
 */
export async function createAndConnectApp(
  options: ConnectOptions,
): Promise<AppLike> {
  await initializeWasm();

  const local = splitId(options.localId);
  const app = await App.connectWithSecret(
    options.endpoint.trim(),
    options.token?.trim() || undefined,
    local,
    options.sharedSecret,
    Direction.Bidirectional,
  );

  return app;
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
  const resolved = { ...defaults };

  for (const key of Object.keys(defaults)) {
    const value = params.get(key);
    if (value !== null && value.length > 0) {
      resolved[key] = value;
    }
  }

  return resolved;
}

export function parseInviteList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
