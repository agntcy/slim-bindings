#!/usr/bin/env node
// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * CI guard for the main package's TypeScript surface (index.d.ts).
 *
 * Type-checks a throwaway consumer that imports from '@agntcy/slim-bindings',
 * resolved to the built node/ directory, so the published entry point
 * (index.d.ts -> types/*.d.ts) is what gets exercised, not generated/index.js.
 * The consumer references:
 *   - every runtime value export in named-exports.js, both as a named import
 *     and off the default export, so types cannot drift from the runtime barrel;
 *   - every type/interface export of each UniFFI namespace re-exported by
 *     generated/index.ts (slim_bindings, slim_rpc: ContextLike, ChannelLike,
 *     ...), which have no runtime representation and are only reachable
 *     through index.d.ts.
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

let namespaces;
try {
  const helper = pathToFileURL(path.join(nodeDir, 'scripts', 'namespaces.mjs')).href;
  namespaces = (await import(helper)).bindingNamespaces(nodeDir);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

for (const f of [
  'index.d.ts',
  'named-exports.js',
  ...namespaces.flatMap((ns) => [`types/${ns}.d.ts`, `generated/${ns}.ts`]),
]) {
  if (!fs.existsSync(path.join(nodeDir, f))) {
    console.error(`❌ ${f} missing — run \`task generate\` and \`task emit-types\` first.`);
    process.exit(1);
  }
}

// index.d.ts is hand-written: its `export * from './types/<ns>'` lines must
// match generated/index.ts exactly. A namespace it lacks loses its types (the
// tsc check below also catches that); one it has extra declares values that
// do not exist at runtime, which tsc alone would not notice.
const declared = [...read('index.d.ts').matchAll(/^export \* from '\.\/types\/([A-Za-z0-9_]+)';?$/gm)].map(
  (m) => m[1],
);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
if (!sameSet([...new Set(declared)], namespaces)) {
  console.error(
    `❌ index.d.ts re-exports [${declared.join(', ')}] but generated/index.ts has ` +
      `[${namespaces.join(', ')}] — update the \`export * from './types/<ns>'\` lines.`,
  );
  process.exit(1);
}

const values = [...read('named-exports.js').matchAll(/^export const ([A-Za-z0-9_$]+) = /gm)].map(
  (m) => m[1],
);
const types = [
  ...new Set(
    namespaces.flatMap((ns) =>
      [...read(`generated/${ns}.ts`).matchAll(/^export (?:interface|type) ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]),
    ),
  ),
];
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
