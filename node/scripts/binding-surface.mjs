#!/usr/bin/env node
// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Single source of truth for the export surface of the generated bindings.
 *
 * The UniFFI namespaces (today slim_bindings and slim_rpc) are the `export *
 * from './<ns>'` re-exports of generated/index.ts, and each namespace's exports
 * are enumerated with the TypeScript checker rather than with regexes, so every
 * declaration and re-export form (`export async function`, `export { X }`,
 * `export type { T } from ...`, either quote style, ...) is covered. Used by
 * scripts/gen-named-exports.mjs, the Taskfile and the CI guards in
 * .github/tests/node/, so adding or renaming a namespace needs no edits there.
 *
 * As a module:  import { bindingSurface, starReexports, loadTypeScript } from './binding-surface.mjs';
 * As a CLI:     node scripts/binding-surface.mjs [node-dir]  (namespace names, one per line)
 *
 * Requires node/node_modules (typescript) — installed by `task generate`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** The typescript module installed in node/node_modules. */
export function loadTypeScript(nodeDir) {
  try {
    return createRequire(path.resolve(nodeDir, 'package.json'))('typescript');
  } catch {
    throw new Error(`typescript not found in ${nodeDir}/node_modules — run \`npm install\` there.`);
  }
}

function loadSourceFile(program, filePath) {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`TypeScript could not load ${filePath} — check the path and re-run \`task generate\`.`);
  }
  return sourceFile;
}

/** `export * from '<spec>'` declarations (no export clause) of a source file. */
function starExportDeclarations(ts, sourceFile) {
  return sourceFile.statements.filter(
    (s) => ts.isExportDeclaration(s) && !s.exportClause && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier),
  );
}

/**
 * Module specifiers of the `export * from '...'` lines of any .ts/.d.ts file
 * (e.g. the hand-written index.d.ts), parsed with TypeScript.
 * @returns {string[]} e.g. ['./types/slim_bindings', './types/slim_rpc']
 */
export function starReexports(nodeDir, filePath) {
  const ts = loadTypeScript(nodeDir);
  const sourceFile = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest);
  return starExportDeclarations(ts, sourceFile).map((s) => s.moduleSpecifier.text);
}

/**
 * @param {string} nodeDir the node/ package directory
 * @returns {{
 *   namespaces: string[],             // in generated/index.ts order
 *   values: Map<string, string[]>,    // export with a runtime value -> namespaces exporting it
 *   types: Map<string, string[]>,     // export with a type meaning -> namespaces exporting it
 * }} A name can be in both maps (classes, enums, const + type pairs). A name
 * mapped to more than one namespace is ambiguous under `export *`.
 * @throws if generated/index.ts or a namespace module is missing, or no namespace is found
 */
export function bindingSurface(nodeDir) {
  const indexPath = path.join(nodeDir, 'generated', 'index.ts');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`${indexPath} not found. Run \`task generate\` first.`);
  }
  const ts = loadTypeScript(nodeDir);
  const program = ts.createProgram([indexPath], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();

  const namespaces = [];
  const values = new Map();
  const types = new Map();
  const add = (map, name, ns) => map.set(name, [...(map.get(name) ?? []), ns]);

  for (const decl of starExportDeclarations(ts, loadSourceFile(program, indexPath))) {
    const spec = decl.moduleSpecifier.text;
    const ns = spec.replace(/^\.\//, '');
    const mod = checker.getSymbolAtLocation(decl.moduleSpecifier);
    if (!mod) {
      throw new Error(`generated/index.ts re-exports '${spec}', which does not resolve — run \`task generate\`.`);
    }
    namespaces.push(ns);
    for (const sym of checker.getExportsOfModule(mod)) {
      if (sym.name === 'default') continue;
      // `export type { X }` / `export { type X }` re-export only the type side.
      const typeOnly = (sym.declarations ?? []).some((d) => ts.isTypeOnlyImportOrExportDeclaration(d));
      const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      if (!typeOnly && target.flags & ts.SymbolFlags.Value) add(values, sym.name, ns);
      if (target.flags & ts.SymbolFlags.Type) add(types, sym.name, ns);
    }
  }
  if (namespaces.length === 0) {
    throw new Error(`${indexPath} re-exports no namespace (expected \`export * from './<ns>'\` lines).`);
  }
  return { namespaces, values, types };
}

const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const nodeDir = path.resolve(process.argv[2] || path.join(path.dirname(selfPath), '..'));
  try {
    console.log(bindingSurface(nodeDir).namespaces.join('\n'));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
