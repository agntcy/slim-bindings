#!/usr/bin/env bash
# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0
#
# End-to-end smoke test for the Node.js / TypeScript slimrpc example.
#
# Proves the *generated* stubs actually work at runtime — not just that they
# type-check. It stands up an in-process SLIM broker (the node example server),
# a slimrpc RPC server, and runs the point-to-point + multicast clients,
# asserting every RPC shape round-trips through the generated code.
#
# Usage: slimrpc_e2e.sh <example-dir>
#   <example-dir> is the slimrpc example directory (contains server.ts, the
#   generated types/, and an installed node_modules with tsx).
set -euo pipefail

EXAMPLE_DIR="${1:?usage: slimrpc_e2e.sh <example-dir>}"
cd "$EXAMPLE_DIR"

TSX="./node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "❌ tsx not found at $TSX (run npm install in the example first)"; exit 1; }
[ -f "types/example_slimrpc.ts" ] || { echo "❌ generated types/example_slimrpc.ts missing (run buf generate first)"; exit 1; }

BROKER_LOG=$(mktemp)
SERVER_LOG=$(mktemp)
S1_LOG=$(mktemp)
S2_LOG=$(mktemp)
CLIENT_LOG=$(mktemp)
GROUP_LOG=$(mktemp)
PIDS=()

cleanup() {
  if [ "${#PIDS[@]}" -gt 0 ]; then
    for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  fi
}
trap cleanup EXIT

# wait_for <file> <pattern> <timeout-sec> <label>
wait_for() {
  local f="$1" pat="$2" timeout="$3" label="$4" i=0
  local max=$(( timeout * 2 ))
  while [ "$i" -lt "$max" ]; do
    if grep -q "$pat" "$f" 2>/dev/null; then return 0; fi
    # Fail fast on either the client/server ("Fatal error:") or the broker
    # ("❌ Error:") top-level catch handlers.
    if grep -qE "Fatal error:|❌ Error:" "$f" 2>/dev/null; then
      echo "❌ $label reported an error:"; cat "$f"; return 1
    fi
    sleep 0.5
    i=$(( i + 1 ))
  done
  echo "❌ timed out after ${timeout}s waiting for '$pat' from $label:"; cat "$f"; return 1
}

# assert_contains <file> <literal-substring>
assert_contains() {
  if ! grep -qF "$2" "$1"; then
    echo "❌ expected output not found: $2"
    echo "--- actual (ANSI-stripped) ---"
    sed 's/\x1b\[[0-9;]*m//g' "$1"
    exit 1
  fi
}

echo "▶ starting SLIM broker (node example server)..."
"$TSX" ../../server.ts > "$BROKER_LOG" 2>&1 & PIDS+=($!)
wait_for "$BROKER_LOG" "running and listening" 60 "broker"

echo "▶ starting slimrpc RPC server..."
"$TSX" server.ts --instance server > "$SERVER_LOG" 2>&1 & PIDS+=($!)
wait_for "$SERVER_LOG" "SLIM_RPC_SERVER_READY" 60 "rpc server"

echo "▶ running point-to-point client..."
"$TSX" client.ts > "$CLIENT_LOG" 2>&1 || { echo "❌ client exited non-zero:"; cat "$CLIENT_LOG"; exit 1; }
sed 's/\x1b\[[0-9;]*m//g' "$CLIENT_LOG"
assert_contains "$CLIENT_LOG" "SLIM_RPC_CLIENT_DONE"
assert_contains "$CLIENT_LOG" 'reply: "Hello, World!" (1)'                         # unary-unary
assert_contains "$CLIENT_LOG" 'stream: "Response 4" (4)'                            # unary-stream
assert_contains "$CLIENT_LOG" 'reply: "Saw: Request 0, Request 1, Request 2" (3)'  # stream-unary
assert_contains "$CLIENT_LOG" 'stream: "Echo: Request 2" (200)'                     # stream-stream (bigint x100)
echo "✅ point-to-point: all four RPC shapes round-tripped"

echo "▶ starting group servers server1 + server2..."
"$TSX" server.ts --instance server1 > "$S1_LOG" 2>&1 & PIDS+=($!)
"$TSX" server.ts --instance server2 > "$S2_LOG" 2>&1 & PIDS+=($!)
wait_for "$S1_LOG" "SLIM_RPC_SERVER_READY" 60 "server1"
wait_for "$S2_LOG" "SLIM_RPC_SERVER_READY" 60 "server2"

echo "▶ running multicast/group client..."
"$TSX" client_group.ts --servers server1,server2 > "$GROUP_LOG" 2>&1 || { echo "❌ group client exited non-zero:"; cat "$GROUP_LOG"; exit 1; }
sed 's/\x1b\[[0-9;]*m//g' "$GROUP_LOG"
assert_contains "$GROUP_LOG" "SLIM_RPC_GROUP_CLIENT_DONE"
# Responses must come back from BOTH group members (proves the multicast
# named-field MulticastStreamMessage decoding + context routing).
assert_contains "$GROUP_LOG" "[agntcy/grpc/server1]"
assert_contains "$GROUP_LOG" "[agntcy/grpc/server2]"
echo "✅ multicast: responses received from both group members"

echo "🎉 slimrpc node end-to-end passed"
