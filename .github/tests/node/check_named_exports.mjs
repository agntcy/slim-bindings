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
 *      value name is exported by two namespaces (ESM drops such ambiguous
 *      `export *` names, so they would be undefined at runtime).
 *      The expected set comes from the TypeScript checker, not from the regex
 *      scripts/gen-named-exports.mjs uses, so an export form that regex misses
 *      (`export async function`, `export { X }`, ...) fails here.
 *   3. package.json "files" ships binding.js and named-exports.js.
 *
 * Usage: node .github/tests/node/check_named_exports.mjs <node-dir>
 * Requires: node/node_modules (typescript) from `npm install`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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
const barrel = read('named-exports.js');

// 2. barrel == value exports of every namespace in generated/index.ts
const indexPath = path.join(nodeDir, 'generated', 'index.ts');
if (!fs.existsSync(indexPath)) {
  console.error('❌ generated/index.ts missing — run `task generate`.');
  process.exit(1);
}
let ts;
try {
  ts = createRequire(path.join(nodeDir, 'package.json'))('typescript');
} catch {
  console.error(`❌ typescript not found in ${nodeDir}/node_modules — run \`npm install\` there.`);
  process.exit(1);
}
const program = ts.createProgram([indexPath], {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  types: [],
});
const checker = program.getTypeChecker();
const isValue = (sym) => {
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  return (target.flags & ts.SymbolFlags.Value) !== 0;
};
const owners = new Map(); // value name -> namespaces exporting it
let namespaces = 0;
for (const stmt of program.getSourceFile(indexPath).statements) {
  // `export * from './<ns>'` — one per UniFFI namespace.
  if (!ts.isExportDeclaration(stmt) || stmt.exportClause || !stmt.moduleSpecifier) continue;
  const ns = stmt.moduleSpecifier.text;
  const mod = checker.getSymbolAtLocation(stmt.moduleSpecifier);
  if (!mod) {
    console.error(`❌ generated/index.ts re-exports '${ns}', which does not resolve — run \`task generate\`.`);
    process.exit(1);
  }
  namespaces++;
  for (const sym of checker.getExportsOfModule(mod)) {
    if (sym.name === 'default' || !isValue(sym)) continue;
    owners.set(sym.name, [...(owners.get(sym.name) ?? []), ns]);
  }
}
if (namespaces === 0 || owners.size === 0) {
  console.error(`❌ Found ${namespaces} namespace(s) and ${owners.size} value export(s) in generated/index.ts.`);
  process.exit(1);
}
const clashes = [...owners].filter(([, list]) => list.length > 1);
if (clashes.length) {
  fail(
    'value exports defined in more than one namespace (undefined at runtime under `export *`): ' +
      clashes.map(([n, list]) => `${n} (${list.join(', ')})`).join(', '),
  );
}
const barrelNames = new Set(
  [...barrel.matchAll(/^export const ([A-Za-z0-9_$]+) = ns\.([A-Za-z0-9_$]+);$/gm)]
    .filter((m) => m[1] === m[2])
    .map((m) => m[1]),
);
const missing = [...owners.keys()].filter((n) => !barrelNames.has(n));
const extra = [...barrelNames].filter((n) => !owners.has(n));
if (missing.length) {
  fail(`named-exports.js is stale — missing ${missing.length} export(s): ${missing.join(', ')}`);
}
if (extra.length) {
  fail(`named-exports.js exports ${extra.length} name(s) the bindings do not: ${extra.join(', ')}`);
}
if (!missing.length && !extra.length) {
  console.log(`✅ named-exports.js re-exports all ${owners.size} value exports of ${namespaces} namespace(s).`);
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
