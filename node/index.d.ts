// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Type definitions for @agntcy/slim-bindings.
 * Full types are in types/ (generated from bindings before publish).
 *
 * Both import styles are supported:
 *   - named:   `import { Channel, RpcError } from '@agntcy/slim-bindings';`
 *              (runtime values come from ./named-exports.js; types from here)
 *   - default: `import slimBindings from '@agntcy/slim-bindings';`
 *              then access the API off it (`slimBindings.SessionType`).
 */
export * from './types/slim_bindings';
import * as slimBindings from './types/slim_bindings';
export default slimBindings;
