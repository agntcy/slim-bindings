#!/usr/bin/env tsx
// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Platform identifier mapping for @agntcy/slim-bindings (optional platform packages).
 * Used for: (1) CI: Rust TARGET → npm platform package name
 *           (2) Runtime: process.platform/arch → platform id to require().
 */

import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { detectLinuxLibc } = require(path.join(__dirname, '..', 'libc-linux.js')) as {
  detectLinuxLibc: () => 'musl' | 'gnu';
};

/** Rust target triple → npm platform id (package suffix) */
export const RUST_TARGET_TO_PLATFORM_ID: Record<string, string> = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
  'x86_64-unknown-linux-gnu': 'linux-x64-gnu',
  'aarch64-unknown-linux-gnu': 'linux-arm64-gnu',
  'x86_64-unknown-linux-musl': 'linux-x64-musl',
  'aarch64-unknown-linux-musl': 'linux-arm64-musl',
  'x86_64-pc-windows-msvc': 'win32-x64-msvc',
  'aarch64-pc-windows-msvc': 'win32-arm64-msvc',
  'x86_64-pc-windows-gnu': 'win32-x64-gnu',
};

/**
 * All platform ids we publish (for optionalDependencies list).
 *
 * win32-x64-gnu is deliberately absent: it carries the same os/cpu as
 * win32-x64-msvc and npm has no field that separates them, so publishing both
 * would install both on Windows x64. getCurrentPlatformId() only ever resolves
 * win32-x64-msvc, so nothing would load it anyway.
 */
export const ALL_PLATFORM_IDS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'linux-x64-musl',
  'linux-arm64-musl',
  'win32-x64-msvc',
  'win32-arm64-msvc',
] as const;

export type PlatformId = (typeof ALL_PLATFORM_IDS)[number];

/** npm platform-gating fields written into each platform package's package.json. */
export interface NpmPlatformFields {
  os: string[];
  cpu: string[];
  libc?: string[];
}

/**
 * `os`/`cpu`/`libc` per platform id. These are what npm (and pnpm/yarn) check to
 * skip an optionalDependency that cannot run on the host; `optionalDependencies`
 * alone does not filter by platform, so without these fields every consumer
 * downloads all published platform binaries instead of the one they need.
 * `libc` (npm >= 10.4) is the only discriminator between linux-*-gnu and
 * linux-*-musl, which share os/cpu; values are npm's 'glibc' / 'musl'.
 */
export const PLATFORM_ID_TO_NPM_FIELDS: Record<PlatformId, NpmPlatformFields> = {
  'darwin-arm64': { os: ['darwin'], cpu: ['arm64'] },
  'darwin-x64': { os: ['darwin'], cpu: ['x64'] },
  'linux-x64-gnu': { os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
  'linux-arm64-gnu': { os: ['linux'], cpu: ['arm64'], libc: ['glibc'] },
  'linux-x64-musl': { os: ['linux'], cpu: ['x64'], libc: ['musl'] },
  'linux-arm64-musl': { os: ['linux'], cpu: ['arm64'], libc: ['musl'] },
  'win32-x64-msvc': { os: ['win32'], cpu: ['x64'] },
  'win32-arm64-msvc': { os: ['win32'], cpu: ['arm64'] },
};

/**
 * npm platform-gating fields for a platform id. Used when packing a platform
 * package so npm installs only the one matching the host.
 */
export function platformIdToNpmFields(platformId: string): NpmPlatformFields {
  const fields = PLATFORM_ID_TO_NPM_FIELDS[platformId as PlatformId];
  if (!fields) {
    throw new Error(
      `${platformId} is not a published platform package (see ALL_PLATFORM_IDS); refusing to pack it.`
    );
  }
  return fields;
}

/**
 * Map Rust TARGET to npm platform id. Used in CI when building platform packages.
 */
export function rustTargetToPlatformId(rustTarget: string): string {
  const id = RUST_TARGET_TO_PLATFORM_ID[rustTarget];
  if (!id) {
    throw new Error(`Unknown Rust target for platform id: ${rustTarget}`);
  }
  return id;
}

/**
 * Get the platform id for the current Node process (for runtime require).
 * Linux distinguishes musl vs gnu when possible (see libc-linux.js).
 */
export function getCurrentPlatformId(): PlatformId {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (platform === 'linux') {
    const libc = detectLinuxLibc();
    if (arch === 'arm64') {
      return `linux-arm64-${libc}` as PlatformId;
    }
    if (arch === 'x64') {
      return `linux-x64-${libc}` as PlatformId;
    }
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'win32-arm64-msvc' : 'win32-x64-msvc';
  }
  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

/** Package name for a platform-specific optional dependency */
export function getPlatformPackageName(platformId: PlatformId): string {
  return `@agntcy/slim-bindings-${platformId}`;
}

// CLI: print platform id for given Rust TARGET (for use in Taskfile/shell)
// Only runs when invoked as script with an argument (not when imported).
const arg = process.argv[2];
if (arg === '--current') {
  console.log(getCurrentPlatformId());
} else if (arg && !arg.startsWith('-')) {
  console.log(rustTargetToPlatformId(arg));
} else if (arg !== undefined) {
  console.error('Usage: platform-id.ts <RUST_TARGET> | --current');
  process.exit(1);
}
