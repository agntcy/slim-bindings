// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared setup helpers for the SlimRPC simple example.
 *
 * Kept local (rather than reusing ../../common.ts) so this example directory is
 * self-contained and type-checks cleanly on its own.
 */
import * as slimBindings from '../../../generated/index.js';

export const DEFAULT_SERVER_ENDPOINT = 'http://localhost:46357';
export const DEFAULT_SHARED_SECRET = 'demo-shared-secret-min-32-chars!!';

/**
 * Parse an `organization/namespace/app` identity into a SLIM `Name`.
 */
export function splitId(id: string): any {
  const parts = id.split('/');
  if (parts.length !== 3) {
    throw new Error(`IDs must be in the format organization/namespace/app, got: ${id}`);
  }
  return new slimBindings.Name(parts[0], parts[1], parts[2]);
}

/**
 * Initialize SLIM, create a shared-secret app, connect it to the broker, and
 * subscribe it to its own name.
 *
 * @returns the app plus the connection id (as a bigint, ready to pass to
 *          `Channel.newWithConnection` / `Server.newWithConnection`).
 */
export async function createAndConnectApp(
  localId: string,
  serverAddr: string,
  secret: string,
): Promise<{ app: any; connId: bigint; service: any }> {
  slimBindings.initializeWithDefaults();

  const appName = splitId(localId);
  const service = slimBindings.getGlobalService();

  const app = service.createAppWithSecret(appName, secret);
  console.log(`[${app.id()}] ✅ Created app`);

  const config = slimBindings.newInsecureClientConfig(serverAddr);
  const connId = await service.connectAsync(config);
  console.log(`[${app.id()}] 🔌 Connected to ${serverAddr} (conn ID: ${connId})`);

  await app.subscribeAsync(appName, BigInt(connId));
  console.log(`[${app.id()}] ✅ Subscribed`);

  return { app, connId: BigInt(connId), service };
}

/**
 * Format a message with an instance-id prefix.
 */
export function logMessage(instance: bigint | number | string, message: string): void {
  console.log(`[${instance}] ${message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
