// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * SLIM Group Messaging Example
 *
 * Demonstrates multicast (group) sessions:
 *   - Moderator mode: create a group session for a channel and invite participants.
 *   - Participant mode: wait for an incoming group session invitation.
 *   - Both modes then exchange messages interactively over the group session.
 *
 * Based on implementations from the Go, Python, and .NET bindings.
 */

// @ts-expect-error - tsx resolves .js imports to .ts files at runtime
import * as slimBindings from '../generated/index.js';
import * as readline from 'node:readline/promises';
import { createAndConnectApp, splitId, logMessage, sleep, DEFAULT_SERVER_ENDPOINT, DEFAULT_SHARED_SECRET } from './common.js';

const DEFAULT_LOCAL_ID = 'org/default/me';

/**
 * Command line arguments
 */
interface CliArgs {
  local: string;
  remote?: string;
  server: string;
  sharedSecret: string;
  enableMls: boolean;
  invites: string[];
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let local = DEFAULT_LOCAL_ID;
  let remote: string | undefined;
  let server = DEFAULT_SERVER_ENDPOINT;
  let sharedSecret = DEFAULT_SHARED_SECRET;
  let enableMls = false;
  let invites: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--local' && i + 1 < args.length) {
      local = args[i + 1];
      i++;
    } else if (args[i] === '--remote' && i + 1 < args.length) {
      remote = args[i + 1];
      i++;
    } else if (args[i] === '--server' && i + 1 < args.length) {
      server = args[i + 1];
      i++;
    } else if (args[i] === '--secret' && i + 1 < args.length) {
      sharedSecret = args[i + 1];
      i++;
    } else if (args[i] === '--enable-mls') {
      enableMls = true;
    } else if (args[i] === '--invites' && i + 1 < args.length) {
      invites = args[i + 1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: npm run group -- [OPTIONS]');
      console.log('');
      console.log('Options:');
      console.log('  --local <id>          Local identity (default: org/default/me)');
      console.log('  --remote <id>         Remote channel/topic identity (moderator mode)');
      console.log('  --server <address>    Server endpoint (default: http://localhost:46357)');
      console.log('  --secret <secret>     Shared secret (default: demo-shared-secret-min-32-chars!!)');
      console.log('  --enable-mls          Enable MLS encryption');
      console.log('  --invites <ids>       Comma-separated participant IDs to invite (moderator mode)');
      console.log('  --help, -h            Show this help message');
      console.log('');
      console.log('If --remote and --invites are both supplied, this instance creates and moderates');
      console.log('the group session. Otherwise it waits to be invited into one.');
      process.exit(0);
    }
  }

  return { local, remote, server, sharedSecret, enableMls, invites };
}

/** Extract a readable message from a thrown SlimError/UniffiError-shaped value. */
function describeError(error: any): string {
  if (error?.tag && error?.inner?.message) {
    return error.inner.message;
  }
  return error?.message || String(error);
}

/**
 * Run as moderator: create a group session for the channel and invite participants.
 */
async function runModerator(
  app: any,
  connId: bigint,
  remote: string,
  invites: string[],
  enableMls: boolean,
  instance: string
): Promise<void> {
  const channelName = splitId(remote);

  logMessage(instance, `📡 Creating group session as moderator for channel: ${remote}`);

  const config = {
    sessionType: slimBindings.SessionType.Group,
    enableMls,
    maxRetries: 5,
    interval: 5000,
    metadata: new Map(),
  };

  const session = await app.createSessionAndWaitAsync(config, channelName);

  // Give session a moment to establish
  await sleep(100);
  logMessage(instance, '✅ Group session created');

  for (const inviteId of invites) {
    try {
      const inviteName = splitId(inviteId);
      app.setRoute(inviteName, connId);
      await session.inviteAndWaitAsync(inviteName);
      logMessage(instance, `👥 Invited ${inviteId} to the group`);
    } catch (error: any) {
      logMessage(instance, `⚠️  Failed to invite ${inviteId}: ${describeError(error)}`);
    }
  }

  try {
    await runMessageLoops(session, channelName, instance);
  } finally {
    try {
      const handle = await app.deleteSessionAsync(session);
      await handle.waitAsync();
    } catch {
      // Session may already be closed - nothing more to clean up.
    }
  }
}

/**
 * Run as participant: wait for an incoming group session invitation.
 */
async function runParticipant(app: any, instance: string): Promise<void> {
  logMessage(instance, '👂 Waiting for incoming group session invitation...');

  const timeout = 60000;
  const session = await app.listenForSessionAsync(timeout);
  const channelName = session.destination();

  logMessage(instance, `🎉 Joined group session for channel: ${channelName}`);

  try {
    await runMessageLoops(session, channelName, instance);
  } finally {
    try {
      const handle = await app.deleteSessionAsync(session);
      await handle.waitAsync();
    } catch {
      // Session may already be closed - nothing more to clean up.
    }
  }
}

/**
 * Run the receive loop and the interactive keyboard loop concurrently until
 * either one finishes (session ends, or the user exits).
 */
async function runMessageLoops(session: any, channelName: any, instance: string): Promise<void> {
  const controller = new AbortController();
  const receivePromise = receiveLoop(session, instance, controller);
  const keyboardPromise = keyboardLoop(session, channelName, instance, controller);

  try {
    await Promise.race([receivePromise, keyboardPromise]);
  } finally {
    controller.abort();
    await Promise.allSettled([receivePromise, keyboardPromise]);
  }
}

/**
 * Receive messages for the group session and auto-reply (unless the message
 * is itself already a reply, indicated by a PUBLISH_TO metadata entry, to
 * avoid an infinite reply loop).
 */
async function receiveLoop(session: any, instance: string, controller: AbortController): Promise<void> {
  const sourceName = session.source();

  while (!controller.signal.aborted) {
    let received: any;
    try {
      received = await session.getMessageAsync(1000, { signal: controller.signal });
    } catch (error: any) {
      if (controller.signal.aborted) {
        return;
      }
      const msg = describeError(error);
      if (msg.toLowerCase().includes('timeout')) {
        continue;
      }
      logMessage(instance, `🔚 Session ended: ${msg}`);
      controller.abort();
      return;
    }

    const ctx = received.context;
    const text = Buffer.from(received.payload).toString('utf-8');
    console.log(`\n${ctx.sourceName} > ${text}`);

    // If this message already carries PUBLISH_TO, it is itself a reply - don't reply again.
    if (!ctx.metadata.has('PUBLISH_TO')) {
      const reply = `message received by ${sourceName}`;
      try {
        await session.publishToAndWaitAsync(ctx, Buffer.from(reply), undefined, ctx.metadata);
      } catch (error: any) {
        logMessage(instance, `⚠️  Error sending auto-reply: ${describeError(error)}`);
      }
    }

    process.stdout.write(`${sourceName} > `);
  }
}

/**
 * Interactive loop: type a message and press Enter to send it to the group;
 * 'exit' or 'quit' leaves the group.
 */
async function keyboardLoop(session: any, channelName: any, instance: string, controller: AbortController): Promise<void> {
  const sourceName = session.source();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(`\nWelcome to the group ${channelName}!`);

    const participants: any[] = await session.participantsListAsync();
    logMessage(instance, `👥 Participants in the group (${participants.length}):`);
    for (const participant of participants) {
      logMessage(instance, `   👤 ${participant}`);
    }

    console.log(`Type a message and press Enter to send, or 'exit'/'quit' to leave.\n`);

    while (!controller.signal.aborted) {
      let input: string;
      try {
        input = await rl.question(`${sourceName} > `, { signal: controller.signal });
      } catch {
        return;
      }

      const trimmed = input.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        logMessage(instance, '👋 Leaving group...');
        return;
      }

      try {
        await session.publishAndWaitAsync(Buffer.from(trimmed), undefined, undefined);
        logMessage(instance, '📤 Sent to group');
      } catch (error: any) {
        logMessage(instance, `❌ Error sending message: ${describeError(error)}`);
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs();

  console.log('👥 SLIM Group Messaging Example');
  console.log('================================');
  console.log(`Local ID: ${args.local}`);
  if (args.remote) console.log(`Remote (channel): ${args.remote}`);
  console.log(`Server: ${args.server}`);
  if (args.invites.length > 0) console.log(`Invites: ${args.invites.join(', ')}`);
  console.log();

  try {
    const { app, connId } = await createAndConnectApp(args.local, args.server, args.sharedSecret);
    const instance = app.id();

    const isModerator = Boolean(args.remote) && args.invites.length > 0;
    if (isModerator) {
      await runModerator(app, connId, args.remote!, args.invites, args.enableMls, instance);
    } else {
      await runParticipant(app, instance);
    }
  } catch (error: any) {
    console.error('Fatal error:', describeError(error));
    process.exit(1);
  }
}

// Handle signals gracefully
process.on('SIGINT', () => {
  console.log('\n\n📋 Received SIGINT');
  console.log('🛑 Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n📋 Received SIGTERM');
  console.log('🛑 Shutting down...');
  process.exit(0);
});

// Run the main function
main();
