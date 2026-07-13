// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * SlimRPC simple example — point-to-point client.
 *
 * Exercises all four RPC shapes of the generated `TestClient` against a single
 * server instance over a running SLIM broker.
 *
 * Mirrors python/examples/slimrpc/simple/client.py and
 * go/examples/slimrpc/simple/cmd/client.
 */

import * as slimBindings from '../../../generated/index.js';
import { createAndConnectApp, splitId, logMessage, DEFAULT_SERVER_ENDPOINT, DEFAULT_SHARED_SECRET } from './common.js';
import { create } from '@bufbuild/protobuf';
import { ExampleRequestSchema, type ExampleRequest } from './types/example_pb.js';
import { TestClient } from './types/example_slimrpc.js';

const NAME_ORG = 'agntcy';
const NAME_NS = 'grpc';
const TIMEOUT_MS = 5000;

interface CliArgs {
  local: string;
  remote: string;
  server: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let local = `${NAME_ORG}/${NAME_NS}/client`;
  let remote = `${NAME_ORG}/${NAME_NS}/server`;
  let server = DEFAULT_SERVER_ENDPOINT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--local' && i + 1 < args.length) {
      local = args[++i];
    } else if (args[i] === '--remote' && i + 1 < args.length) {
      remote = args[++i];
    } else if (args[i] === '--server' && i + 1 < args.length) {
      server = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: npm run client -- [OPTIONS]');
      console.log('');
      console.log('Options:');
      console.log('  --local <id>        Local identity (default: agntcy/grpc/client)');
      console.log('  --remote <id>       Remote server identity (default: agntcy/grpc/server)');
      console.log('  --server <address>  SLIM server endpoint (default: http://localhost:46357)');
      console.log('  --help, -h          Show this help message');
      process.exit(0);
    }
  }

  return { local, remote, server };
}

async function* streamRequests(): AsyncGenerator<ExampleRequest> {
  for (let i = 0; i < 3; i++) {
    yield create(ExampleRequestSchema, { exampleString: `Request ${i}`, exampleInteger: BigInt(i) });
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('📞 SlimRPC Client');
  console.log('=================');
  console.log(`Local:  ${args.local}`);
  console.log(`Remote: ${args.remote}`);
  console.log(`Server: ${args.server}`);
  console.log();

  const { app, connId } = await createAndConnectApp(args.local, args.server, DEFAULT_SHARED_SECRET);
  const instance = app.id();

  const remoteName = splitId(args.remote);
  const channel = slimBindings.Channel.newWithConnection(app, remoteName, connId);
  const client = new TestClient(channel);

  console.log('SLIM_RPC_CLIENT_STARTED');

  const request = create(ExampleRequestSchema, { exampleString: 'hello', exampleInteger: 1n });

  logMessage(instance, '=== Unary-Unary ===');
  const uu = await client.ExampleUnaryUnary(request, TIMEOUT_MS);
  logMessage(instance, `📨 reply: "${uu.exampleString}" (${uu.exampleInteger})`);

  logMessage(instance, '=== Unary-Stream ===');
  for await (const resp of client.ExampleUnaryStream(request, TIMEOUT_MS)) {
    logMessage(instance, `📨 stream: "${resp.exampleString}" (${resp.exampleInteger})`);
  }

  logMessage(instance, '=== Stream-Unary ===');
  const su = await client.ExampleStreamUnary(streamRequests(), TIMEOUT_MS);
  logMessage(instance, `📨 reply: "${su.exampleString}" (${su.exampleInteger})`);

  logMessage(instance, '=== Stream-Stream ===');
  for await (const resp of client.ExampleStreamStream(streamRequests(), TIMEOUT_MS)) {
    logMessage(instance, `📨 stream: "${resp.exampleString}" (${resp.exampleInteger})`);
  }

  await channel.closeAsync(undefined);
  console.log('SLIM_RPC_CLIENT_DONE');
}

process.on('SIGINT', () => {
  console.log('\n\n📋 Received SIGINT — shutting down...');
  process.exit(0);
});

main().catch((error: any) => {
  console.error('Fatal error:', error?.message || String(error));
  process.exit(1);
});
