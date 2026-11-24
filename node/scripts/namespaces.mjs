#!/usr/bin/env node
// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Single source of truth for the UniFFI namespaces of the generated bindings
 * (today slim_bindings and slim_rpc). They are read from the `export * from
 * './<ns>'` lines that uniffi-bindgen-react-native writes into
 * generated/index.ts, so adding or renaming a namespace needs no edits to the
 * scripts, CI guards or Taskfile checks that consume this list.
 *
 * As a module:  import { bindingNamespaces } from './namespaces.mjs';
 * As a CLI:     node scripts/namespaces.mjs [node-dir]   (one name per line)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} nodeDir the node/ package directory
 * @returns {string[]} namespace names, in generated/index.ts order
 * @throws if generated/index.ts is missing or re-exports no namespace
 */
export function bindingNamespaces(nodeDir) {
  const indexPath = path.join(nodeDir, 'generated', 'index.ts');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`${indexPath} not found. Run \`task generate\` first.`);
  }
  const src = fs.readFileSync(indexPath, 'utf8');
  const names = [...src.matchAll(/^export \* from '\.\/([A-Za-z0-9_]+)';?$/gm)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error(`${indexPath} re-exports no namespace (expected \`export * from './<ns>'\` lines).`);
  }
  return names;
}

const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const nodeDir = path.resolve(process.argv[2] || path.join(path.dirname(selfPath), '..'));
  try {
    console.log(bindingNamespaces(nodeDir).join('\n'));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
