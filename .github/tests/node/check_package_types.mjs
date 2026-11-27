#!/usr/bin/env node
// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * CI guard for the main package's TypeScript surface (index.d.ts).
 *
 * Type-checks a throwaway consumer that imports from '@agntcy/slim-bindings',
 * resolved to the built node/ directory, so the published entry point
 * (index.d.ts -> types/*.d.ts) is what gets exercised, not generated/index.js.
 * The consumer references every export of each UniFFI namespace re-exported
 * by generated/index.ts (slim_bindings, slim_rpc), as enumerated by
 * node/scripts/binding-surface.mjs with the TypeScript checker:
 *   - every runtime value export, both as a named import and off the default
 *     export (check_named_exports.mjs checks named-exports.js has the same set);
 *   - every name with a type meaning (ContextLike, ChannelLike, ...), including
 *     type-only ones that have no runtime representation and are only
 *     reachable through index.d.ts.
 * Dropping a namespace from index.d.ts (or keeping one generated/index.ts no
 * longer has) fails this check. Library checking is on (skipLibCheck: false)
 * because index.d.ts is itself a .d.ts: with it off, errors inside index.d.ts
 * (e.g. TS2308, a name re-exported by two namespaces) would be ignored.
 *
 * Usage: node .github/tests/node/check_package_types.mjs <node-dir>
 * Requires: `task generate` and `task emit-types` (types/ + named-exports.js),
 * and node/node_modules (typescript, @types/node, @ubjs/core) from `npm install`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const nodeDir = path.resolve(process.argv[2] || 'node');
const read = (p) => fs.readFileSync(path.join(nodeDir, p), 'utf8');

let surface;
let declared;
try {
  const helper = await import(pathToFileURL(path.join(nodeDir, 'scripts', 'binding-surface.mjs')).href);
  surface = helper.bindingSurface(nodeDir);
  // index.d.ts is hand-written; read its `export * from '...'` lines with TypeScript.
  declared = helper.starReexports(nodeDir, path.join(nodeDir, 'index.d.ts'));
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
const { namespaces } = surface;

for (const f of ['named-exports.js', ...namespaces.map((ns) => `types/${ns}.d.ts`)]) {
  if (!fs.existsSync(path.join(nodeDir, f))) {
    console.error(`❌ ${f} missing — run \`task generate\` and \`task emit-types\` first.`);
    process.exit(1);
  }
}

// index.d.ts must re-export exactly ./types/<ns> for each namespace in
// generated/index.ts. A namespace it lacks loses its types (the tsc check
// below also catches that); one it has extra declares values that do not exist
// at runtime, which tsc alone would not notice.
const expected = namespaces.map((ns) => `./types/${ns}`);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
if (!sameSet([...new Set(declared)], expected)) {
  console.error(
    `❌ index.d.ts re-exports [${declared.join(', ')}] but generated/index.ts needs ` +
      `[${expected.join(', ')}] — update its \`export * from './types/<ns>'\` lines.`,
  );
  process.exit(1);
}

// Every export of the bindings, from the TypeScript checker (no regexes):
// values (classes, consts, functions, ...) are referenced both as named
// imports and off the default export; every name with a type meaning
// (interfaces, type aliases, and the type side of classes/enums) as a type.
// check_named_exports.mjs separately checks named-exports.js == these values.
const values = [...surface.values.keys()];
const types = [...surface.types.keys()];
if (values.length === 0 || types.length === 0) {
  console.error(`❌ Found ${values.length} value and ${types.length} type exports — expected both.`);
  process.exit(1);
}

const consumer = [
  "import * as named from '@agntcy/slim-bindings';",
  "import slim from '@agntcy/slim-bindings';",
  'export const values = [',
  ...values.map((n) => `  named.${n}, slim.${n},`),
  '];',
  ...types.map((n, i) => `export type T${i} = named.${n};`),
  '',
].join('\n');

const tsc = path.join(nodeDir, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tsc)) {
  console.error(`❌ ${tsc} not found — run \`npm install\` in ${nodeDir}.`);
  process.exit(1);
}

// From here on, failures throw and set process.exitCode instead of calling
// process.exit(), which would skip the finally block and leak the temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slim-package-types-'));
try {
  fs.writeFileSync(path.join(tmp, 'consumer.ts'), consumer);
  fs.writeFileSync(
    path.join(tmp, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          // Check index.d.ts and types/ too; they are what is under test.
          skipLibCheck: false,
          types: ['node'],
          typeRoots: [path.join(nodeDir, 'node_modules', '@types')],
          // Resolve the package to the built node/ directory (its index.d.ts).
          paths: { '@agntcy/slim-bindings': [path.join(nodeDir, 'index.d.ts')] },
        },
        files: ['consumer.ts'],
      },
      null,
      2,
    ),
  );

  const res = spawnSync(process.execPath, [tsc, '-p', tmp], { stdio: 'inherit' });
  // Distinguish "tsc could not run / was killed" from "tsc found type errors",
  // so an OOM kill or CI timeout is not misreported as a missing export.
  if (res.error) {
    throw new Error(`failed to run tsc: ${res.error.message}`);
  }
  if (res.signal) {
    throw new Error(`tsc was terminated by ${res.signal} before finishing.`);
  }
  if (res.status !== 0) {
    throw new Error(
      '@agntcy/slim-bindings type surface is broken: see the tsc errors above (a generated ' +
        'export not reachable through index.d.ts, or an error inside index.d.ts / types/).',
    );
  }
  console.log(
    `✅ index.d.ts exposes all ${values.length} value exports (named + default) and ${types.length} type exports.`,
  );
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
