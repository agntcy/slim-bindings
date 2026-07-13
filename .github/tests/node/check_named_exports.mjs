#!/usr/bin/env node
// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * CI guard for the main package's named-export barrel.
 *
 * Ensures `@agntcy/slim-bindings` exposes named exports that stay in sync with
 * the generated bindings surface, so downstream `import { Channel } from
 * '@agntcy/slim-bindings'` (and slimrpc-generated stubs) can't silently break.
 *
 * Checks:
 *   1. named-exports.js exists (was generated).
 *   2. Every VALUE export of generated/slim_bindings.ts is re-exported by it.
 *   3. package.json "files" ships binding.js and named-exports.js.
 *
 * Usage: node .github/tests/node/check_named_exports.mjs <node-dir>
 */
import fs from 'node:fs';
import path from 'node:path';

const nodeDir = process.argv[2] || 'node';
const read = (p) => fs.readFileSync(path.join(nodeDir, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`❌ ${msg}`); failed++; };

// 1. barrel exists
const barrelPath = path.join(nodeDir, 'named-exports.js');
if (!fs.existsSync(barrelPath)) {
  fail('named-exports.js missing — run `task emit-named-exports` (or `task generate`).');
  process.exit(1);
}
const barrel = read('named-exports.js');

// 2. completeness vs generated bindings surface
const src = read('generated/slim_bindings.ts');
const re = /^export (?:abstract class|class|const|enum|function) ([A-Za-z0-9_$]+)/gm;
const expected = [...new Set([...src.matchAll(re)].map((m) => m[1]))];
const missing = expected.filter((n) => !new RegExp(`^export const ${n} = ns\\.${n};`, 'm').test(barrel));
if (missing.length) {
  fail(`named-exports.js is stale — missing ${missing.length} export(s): ${missing.join(', ')}`);
} else {
  console.log(`✅ named-exports.js re-exports all ${expected.length} value exports.`);
}

// 3. package.json ships the new entry files
const pkg = JSON.parse(read('package.json'));
for (const f of ['binding.js', 'named-exports.js']) {
  if (!(pkg.files || []).includes(f)) {
    fail(`package.json "files" is missing "${f}" — it won't be published.`);
  }
}
if (!failed) console.log('✅ package.json ships binding.js and named-exports.js.');

console.log(failed === 0 ? '\n🎉 named-export barrel is complete and shipped' : `\n❌ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
