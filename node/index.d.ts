// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Type definitions for @agntcy/slim-bindings.
 * Full types are in types/ (generated from bindings before publish).
 *
 * The bindings span two UniFFI namespaces, and both are surfaced here:
 *   - ./types/slim_bindings — core API (App, Name, SessionType, ...)
 *   - ./types/slim_rpc      — SLIMRPC (Channel, Server, RpcError, ContextLike, ...)
 * This mirrors the runtime: ./named-exports.js (scripts/gen-named-exports.mjs)
 * re-exports value exports from both, and the default export is the whole
 * platform-binding namespace (see binding.js).
 *
 * Both import styles are supported:
 *   - named:   `import { Channel, RpcError } from '@agntcy/slim-bindings';`
 *              (runtime values come from ./named-exports.js; types from here)
 *   - default: `import slimBindings from '@agntcy/slim-bindings';`
 *              then access the API off it (`slimBindings.SessionType`).
 *
 * Each namespace's own `default` export (its UniFFI init/converters object) is
 * omitted from the default-export type: on the runtime namespace, `default` is
 * the generated index's `{ slim_bindings, slim_rpc }`, not either of those.
 */
export * from './types/slim_bindings';
export * from './types/slim_rpc';
import * as slimCore from './types/slim_bindings';
import * as slimRpc from './types/slim_rpc';
declare const slimBindings: Omit<typeof slimCore & typeof slimRpc, 'default'>;
export default slimBindings;
