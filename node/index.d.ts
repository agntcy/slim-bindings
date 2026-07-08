// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Type definitions for @agntcy/slim-bindings.
 * Full types are in types/ (generated from bindings before publish).
 *
 * The runtime entry (index.js) loads the platform package via dynamic import()
 * and re-exposes it as the default export only — the package name is computed
 * at runtime, so named symbols cannot be statically re-exported. These types
 * mirror that: import the default and access the API off it
 * (`import slimBindings from '@agntcy/slim-bindings'; slimBindings.SessionType`).
 */
import * as slimBindings from './types/slim_bindings';
export default slimBindings;
