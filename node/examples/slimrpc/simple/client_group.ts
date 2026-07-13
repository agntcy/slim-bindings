// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * SlimRPC simple example — multicast (group) client.
 *
 * Exercises all four RPC shapes of the generated `TestGroupClient` against a
 * GROUP channel spanning multiple server instances. Each yielded value pairs
 * the responding member's context with its decoded response.
 *
 * Mirrors python/examples/slimrpc/simple/client_group.py and
 * go/examples/slimrpc/simple/cmd/client_group.
 *
 * Run two servers first, e.g.:
 *   npm run server -- --instance server1
 *   npm run server -- --instance server2
 */

import * as slimBindings from '../../../generated/index.js';
import { createAndConnectApp, splitId, logMessage, DEFAULT_SERVER_ENDPOINT, DEFAULT_SHARED_SECRET } from './common.js';
import { create } from '@bufbuild/protobuf';
import { ExampleRequestSchema, type ExampleRequest } from './types/example_pb.js';
import { TestGroupClient } from './types/example_slimrpc.js';

const NAME_ORG = 'agntcy';
const NAME_NS = 'grpc';
const TIMEOUT_MS = 5000;

interface CliArgs {
  local: string;
  servers: string[];
  server: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let local = `${NAME_ORG}/${NAME_NS}/client`;
  let servers = ['server1', 'server2'];
  let server = DEFAULT_SERVER_ENDPOINT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--local' && i + 1 < args.length) {
      local = args[++i];
    } else if (args[i] === '--servers' && i + 1 < args.length) {
      servers = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === '--server' && i + 1 < args.length) {
      server = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: npm run client-group -- [OPTIONS]');
      console.log('');
      console.log('Options:');
      console.log('  --local <id>        Local identity (default: agntcy/grpc/client)');
      console.log('  --servers <names>   Comma-separated server instance names (default: server1,server2)');
      console.log('  --server <address>  SLIM server endpoint (default: http://localhost:46357)');
      console.log('  --help, -h          Show this help message');
      process.exit(0);
    }
  }

  return { local, servers, server };
}

async function* streamRequests(): AsyncGenerator<ExampleRequest> {
  for (let i = 0; i < 3; i++) {
    yield create(ExampleRequestSchema, { exampleString: `item ${i}`, exampleInteger: BigInt(i) });
  }
}

function source(context: { source: { toString(): string } }): string {
  try {
    return String(context.source);
  } catch {
    return '<member>';
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('📢 SlimRPC Group Client');
  console.log('=======================');
  console.log(`Local:   ${args.local}`);
  console.log(`Servers: ${args.servers.join(', ')}`);
  console.log(`Server:  ${args.server}`);
  console.log();

  const { app, connId } = await createAndConnectApp(args.local, args.server, DEFAULT_SHARED_SECRET);
  const instance = app.id();

  const serverNames = args.servers.map((s) => splitId(`${NAME_ORG}/${NAME_NS}/${s}`));
  const channel = slimBindings.Channel.newGroupWithConnection(app, serverNames, connId);
  const client = new TestGroupClient(channel);

  console.log('SLIM_RPC_GROUP_CLIENT_STARTED');

  const request = create(ExampleRequestSchema, { exampleString: 'hello', exampleInteger: 1n });

  logMessage(instance, '=== Multicast Unary-Unary ===');
  for await (const { context, response } of client.ExampleUnaryUnary(request, TIMEOUT_MS)) {
    logMessage(instance, `📨 [${source(context)}] "${response.exampleString}" (${response.exampleInteger})`);
  }

  logMessage(instance, '=== Multicast Unary-Stream ===');
  for await (const { context, response } of client.ExampleUnaryStream(request, TIMEOUT_MS)) {
    logMessage(instance, `📨 [${source(context)}] "${response.exampleString}" (${response.exampleInteger})`);
  }

  logMessage(instance, '=== Multicast Stream-Unary ===');
  for await (const { context, response } of client.ExampleStreamUnary(streamRequests(), TIMEOUT_MS)) {
    logMessage(instance, `📨 [${source(context)}] "${response.exampleString}" (${response.exampleInteger})`);
  }

  logMessage(instance, '=== Multicast Stream-Stream ===');
  for await (const { context, response } of client.ExampleStreamStream(streamRequests(), TIMEOUT_MS)) {
    logMessage(instance, `📨 [${source(context)}] "${response.exampleString}" (${response.exampleInteger})`);
  }

  console.log('SLIM_RPC_GROUP_CLIENT_DONE');

  await channel.closeAsync(undefined);
}

process.on('SIGINT', () => {
  console.log('\n\n📋 Received SIGINT — shutting down...');
  process.exit(0);
});

main().catch((error: any) => {
  console.error('Fatal error:', error?.message || String(error));
  process.exit(1);
});
