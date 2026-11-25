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
 *   2. It re-exports exactly the VALUE exports of every UniFFI namespace that
 *      generated/index.ts re-exports (slim_bindings, slim_rpc, ...), and no
 *      name is exported by two namespaces (ESM drops such ambiguous `export *`
 *      names, so they would be undefined at runtime). The expected set comes
 *      from node/scripts/binding-surface.mjs (TypeScript checker, no regexes),
 *      so this catches a barrel that was not regenerated after the bindings
 *      changed, and both files are parsed with TypeScript.
 *   3. package.json "files" ships binding.js and named-exports.js.
 *
 * Usage: node .github/tests/node/check_named_exports.mjs <node-dir>
 * Requires: `task generate` (generated/ + named-exports.js + node_modules).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nodeDir = path.resolve(process.argv[2] || 'node');
const read = (p) => fs.readFileSync(path.join(nodeDir, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`❌ ${msg}`); failed++; };

// 1. barrel exists
const barrelPath = path.join(nodeDir, 'named-exports.js');
if (!fs.existsSync(barrelPath)) {
  console.error('❌ named-exports.js missing — run `task emit-named-exports` (or `task generate`).');
  process.exit(1);
}

// 2. barrel == value exports of every namespace in generated/index.ts
let surface;
let ts;
try {
  const helper = await import(pathToFileURL(path.join(nodeDir, 'scripts', 'binding-surface.mjs')).href);
  surface = helper.bindingSurface(nodeDir);
  ts = helper.loadTypeScript(nodeDir);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
const owners = new Map(); // export name -> namespaces exporting it (as a value or a type)
for (const [name, list] of [...surface.values, ...surface.types]) {
  owners.set(name, [...new Set([...(owners.get(name) ?? []), ...list])]);
}
const clashes = [...owners].filter(([, list]) => list.length > 1);
if (clashes.length) {
  fail(
    'exports defined in more than one namespace (undefined at runtime under `export *`): ' +
      clashes.map(([n, list]) => `${n} (${list.join(', ')})`).join(', '),
  );
}

// The barrel's `export const <name> = ns.<name>;` bindings, parsed with TypeScript.
const barrelSource = ts.createSourceFile(barrelPath, read('named-exports.js'), ts.ScriptTarget.Latest);
const barrelNames = new Set();
for (const stmt of barrelSource.statements) {
  if (!ts.isVariableStatement(stmt)) continue;
  if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
  for (const d of stmt.declarationList.declarations) {
    const init = d.initializer;
    const ok =
      ts.isIdentifier(d.name) &&
      init &&
      ts.isPropertyAccessExpression(init) &&
      ts.isIdentifier(init.expression) &&
      init.expression.text === 'ns' &&
      init.name.text === d.name.text;
    if (ok) barrelNames.add(d.name.text);
    else fail(`named-exports.js has an unexpected export: ${d.getText(barrelSource)}`);
  }
}
const missing = [...surface.values.keys()].filter((n) => !barrelNames.has(n));
const extra = [...barrelNames].filter((n) => !surface.values.has(n));
if (missing.length) {
  fail(`named-exports.js is stale — missing ${missing.length} export(s): ${missing.join(', ')}`);
}
if (extra.length) {
  fail(`named-exports.js exports ${extra.length} name(s) the bindings do not: ${extra.join(', ')}`);
}
if (!missing.length && !extra.length) {
  console.log(
    `✅ named-exports.js re-exports all ${surface.values.size} value exports of ` +
      `${surface.namespaces.length} namespace(s).`,
  );
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
