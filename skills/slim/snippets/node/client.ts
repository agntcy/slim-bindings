// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Call the echo agent over SLIM (@agntcy/slim-a2a 0.4.x, A2A v1.0).
 *
 * Run:  SLIM_SHARED_SECRET=<same as server> npx tsx client.ts "hello"
 */
import { randomUUID } from 'node:crypto';
import { AgentCard, SendMessageRequest, type Part } from '@a2a-js/sdk';
import { createSlimClient, setupSlimClient } from '@agntcy/slim-a2a';

const text = process.argv[2] ?? 'hello';

// The client needs its own SLIM name, distinct from the server's.
const { app, connId } = await setupSlimClient('agntcy', 'demo', 'echo_client', {
  secret: process.env.SLIM_SHARED_SECRET,
  slimUrl: process.env.SLIM_URL ?? 'http://localhost:46357',
});

// Over SLIM the agent is addressed by its SLIM name; no HTTP card fetch.
const card = AgentCard.fromJSON({
  name: 'echo_agent',
  version: '1.0.0',
  capabilities: { streaming: true },
  supportedInterfaces: [
    { url: 'agntcy/demo/echo_agent', protocolBinding: 'slimrpc', protocolVersion: '1.0' },
  ],
});
const client = await createSlimClient(app, connId, card);

const result = await client.sendMessage(
  SendMessageRequest.fromJSON({
    message: { messageId: randomUUID(), role: 'ROLE_USER', parts: [{ text }] },
  }),
);

// Depending on the agent you get a Message or a Task — handle both.
const parts: Part[] =
  'parts' in result ? result.parts : result.artifacts.flatMap((a) => a.parts);
for (const p of parts) {
  if (p.content?.$case === 'text') console.log(p.content.value);
}
