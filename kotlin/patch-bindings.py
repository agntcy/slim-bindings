#!/usr/bin/env python3
"""
patch-bindings.py
Patches UniFFI-generated Kotlin bindings to fix compatibility issues.

slimrpc was split into its own UniFFI namespace (agntcy-slim-rpc), so the
generator now emits a second file, slim_rpc.kt, alongside slim_bindings.kt.
Both are generated into package io.agntcy.slim.bindings, which collides on the
shared runtime (UniffiLib, RustBuffer, FfiConverter*, ...). To avoid that, this
script relocates slim_rpc.kt into the io.agntcy.slim.bindings.slimrpc subpackage
(sharing the package of the hand-written slimrpc wrappers), so there is a single
slimrpc package and no runtime-type collision with the core namespace.
"""

import os
import re
import sys

GEN_DIR = "./generated/io/agntcy/slim/bindings"
CORE_FILE = f"{GEN_DIR}/slim_bindings.kt"
RPC_SRC = f"{GEN_DIR}/slim_rpc.kt"
RPC_DIR = f"{GEN_DIR}/slimrpc"
RPC_DST = f"{RPC_DIR}/slim_rpc.kt"


def apply_common_fixes(content: str) -> str:
    # Fix 1: Exception classes with `message` parameter conflict
    content = re.sub(r'val `message`: kotlin\.String(,?)', r'val msg: kotlin.String\1', content)
    # Fix 2: Update references to `message` in exception message strings
    content = re.sub(r'message=\$\{ `message` \}', r'message=${ msg }', content)
    # Fix 3: wait() method conflict with Object.wait()
    content = re.sub(r'fun `wait`\(\)', 'fun waitForCompletion()', content)
    content = re.sub(r'\.`wait`\(\)', '.waitForCompletion()', content)
    # Fix 3b: Session.close() now returns CompletionHandle (agntcy-slim-bindings
    # 2.0.0-alpha.10+), unlike other close()-returning-Unit collisions below, so
    # AutoCloseable.close(): Unit can no longer double as its implementation.
    # Rename Session's abstract member and implementation to closeSession()
    # before the generic Fix 4 below (which renames close()->closeStream() for
    # the Unit-returning collisions, e.g. ResponseSink, and would otherwise also
    # match Session's implementation, leaving its interface member un-renamed
    # and mismatched).
    content = content.replace(
        'fun `close`(): CompletionHandle',
        'fun `closeSession`(): CompletionHandle',
        1,
    )
    content = content.replace(
        'override fun `close`(): CompletionHandle {',
        'override fun `closeSession`(): CompletionHandle {',
        1,
    )
    # Fix 4: close() method conflict with AutoCloseable.close()
    content = re.sub(r'override fun `close`\(\)', 'fun closeStream()', content)
    content = re.sub(
        r'(@Throws\([^)]*\))override suspend fun `closeAsync`\(\)',
        r'\1suspend fun closeStreamAsync()',
        content,
    )
    return content


def patch_file(path: str, *, relocate: bool) -> None:
    try:
        with open(path, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"❌ Error: Bindings file not found: {path}")
        sys.exit(1)

    content = apply_common_fixes(content)

    if relocate:
        # Move slim_rpc into the slimrpc subpackage so it shares a package with
        # the hand-written wrappers and does not collide with the core namespace.
        content = re.sub(
            r'^package io\.agntcy\.slim\.bindings$',
            'package io.agntcy.slim.bindings.slimrpc',
            content,
            count=1,
            flags=re.MULTILINE,
        )
        # The generator fully-qualifies references to slim_rpc's OWN types with the
        # package it was generated into (io.agntcy.slim.bindings). After relocating,
        # rewrite those self-references to the new subpackage. Leave references to
        # core types (App, Name, ...), which genuinely live in the parent package.
        own_types = set(re.findall(
            r'^(?:@\w+\s*)*'
            r'(?:public |internal |private |open |sealed |abstract |data |enum |value )*'
            r'(?:class|object|interface) (\w+)',
            content, flags=re.MULTILINE,
        ))
        own_types |= set(re.findall(r'^typealias (\w+)', content, flags=re.MULTILINE))

        # Rewrite only body references, never `import` lines: the generator already
        # emits correct parent-package imports for external types (App, Name, and
        # core's RustBuffer aliased as RustBufferApp/RustBufferName). Some names
        # (e.g. RustBuffer) exist in BOTH namespaces, so rewriting inside imports
        # would wrongly repoint the external alias at slim_rpc's own type.
        def rewrite_line(line: str) -> str:
            if line.lstrip().startswith("import "):
                return line
            for name in sorted(own_types, key=len, reverse=True):
                line = re.sub(
                    r'\bio\.agntcy\.slim\.bindings\.' + re.escape(name) + r'\b',
                    'io.agntcy.slim.bindings.slimrpc.' + name,
                    line,
                )
            return line

        content = "\n".join(rewrite_line(ln) for ln in content.split("\n"))
        os.makedirs(RPC_DIR, exist_ok=True)
        with open(RPC_DST, 'w') as f:
            f.write(content)
        os.remove(path)
        print(f"  → Relocated {os.path.basename(path)} to io.agntcy.slim.bindings.slimrpc")
    else:
        with open(path, 'w') as f:
            f.write(content)


def main():
    print("🔧 Patching generated Kotlin bindings...")
    patch_file(CORE_FILE, relocate=False)
    if os.path.exists(RPC_SRC):
        patch_file(RPC_SRC, relocate=True)
    print("✅ Successfully patched bindings (message/wait/close fixes; slim_rpc relocated to slimrpc subpackage)")


if __name__ == "__main__":
    main()
