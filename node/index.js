// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Main entry point for @agntcy/slim-bindings.
//
// Exposes the platform binding both ways:
//   * named exports — `import { Channel, RpcError } from '@agntcy/slim-bindings'`
//     (from the generated ./named-exports.js barrel), and
//   * a default export — `import slim from '@agntcy/slim-bindings'` (the resolved
//     platform-binding namespace), for backwards compatibility.
//
// The platform-specific package is selected and loaded in ./binding.js.
export * from './named-exports.js';
export { default } from './binding.js';
