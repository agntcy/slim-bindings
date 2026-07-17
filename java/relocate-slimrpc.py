#!/usr/bin/env python3
"""
relocate-slimrpc.py

uniffi-bindgen-java emits the FFI downcall table (UniffiLib) only for the primary
namespace, so a re-exported second namespace (slimrpc / agntcy-slim-rpc) cannot be
generated correctly in the same pass. Instead we generate it standalone
(uniffi-bindgen-java --crate slim_rpc) — which DOES produce a complete, self-
contained binding — and relocate it into its own Java package,
io.agntcy.slim.bindings.slimrpc (shared with the hand-written slimrpc wrappers).

Each namespace keeps its own runtime (UniffiLib, RustBuffer, converters), so there
is no cross-namespace collision. slimrpc references the core types (App, Name, ...)
which stay in io.agntcy.slim.bindings.

Usage: relocate-slimrpc.py <src_dir> <dest_dir>
  src_dir : standalone slim_rpc generation (…/io/agntcy/slim/bindings)
  dest_dir: …/generated/uniffi/io/agntcy/slim/bindings/slimrpc
"""
import os
import re
import sys

src_dir, dest_dir = sys.argv[1], sys.argv[2]
os.makedirs(dest_dir, exist_ok=True)

OLD_PKG = "io.agntcy.slim.bindings"
NEW_PKG = "io.agntcy.slim.bindings.slimrpc"

files = [f for f in os.listdir(src_dir) if f.endswith(".java")]
# Every generated file is named after its top-level type; that set is exactly the
# slimrpc-owned types. Any io.agntcy.slim.bindings.<X> reference to one of these is
# a self-reference to be repointed; everything else (App, Name, ...) is external.
own_types = {f[:-len(".java")] for f in files}

for fname in files:
    with open(os.path.join(src_dir, fname)) as fh:
        content = fh.read()
    content = re.sub(
        r'^package io\.agntcy\.slim\.bindings;$',
        f'package {NEW_PKG};',
        content, count=1, flags=re.MULTILINE,
    )
    for name in sorted(own_types, key=len, reverse=True):
        content = re.sub(
            r'\bio\.agntcy\.slim\.bindings\.' + re.escape(name) + r'\b',
            f'{NEW_PKG}.{name}',
            content,
        )
    with open(os.path.join(dest_dir, fname), "w") as fh:
        fh.write(content)

print(f"  → Relocated {len(files)} slim_rpc files into {NEW_PKG}")
