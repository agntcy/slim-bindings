// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal A2A echo agent served over SLIM (@agntcy/slim-a2a 0.4.x, A2A v1.0).
 *
 * Run:  SLIM_SHARED_SECRET=<32+ chars> npx tsx server.ts
 * Needs a SLIM node on $SLIM_URL (default http://localhost:46357).
 */
import { randomUUID } from 'node:crypto';
import { AgentCard, Message, Role } from '@a2a-js/sdk';
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { registerSlimA2AHandler, setupSlimClient, slim, SRPCHandler } from '@agntcy/slim-a2a';

class EchoExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const text = ctx.userMessage.parts
      .map((p) => (p.content?.$case === 'text' ? p.content.value : ''))
      .join('');
    // The first event must be a `message` or a `task`. A single Message ends the call.
    bus.publish(
      AgentEvent.message(
        Message.fromJSON({
          messageId: randomUUID(),
          contextId: ctx.contextId,
          role: Role.ROLE_AGENT,
          parts: [{ text: `echo: ${text}` }],
        }),
      ),
    );
    bus.finished();
  }

  async cancelTask(): Promise<void> {
    throw new Error('cancel not supported');
  }
}

const agentCard = AgentCard.fromJSON({
  name: 'Echo Agent',
  description: 'Returns the received text',
  version: '1.0.0',
  // Over SLIM the interface "url" is the agent's SLIM name.
  supportedInterfaces: [
    { url: 'agntcy/demo/echo_agent', protocolBinding: 'slimrpc', protocolVersion: '1.0' },
  ],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  capabilities: { streaming: true },
  skills: [{ id: 'echo', name: 'echo', description: 'echo', tags: ['echo'] }],
});

const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), new EchoExecutor());

// Registers on SLIM as agntcy/demo/echo_agent.
const { app, name, connId } = await setupSlimClient('agntcy', 'demo', 'echo_agent', {
  secret: process.env.SLIM_SHARED_SECRET,
  slimUrl: process.env.SLIM_URL ?? 'http://localhost:46357',
});

const server = slim.Server.newWithConnection(app, name, connId);
registerSlimA2AHandler(server, new SRPCHandler(agentCard, requestHandler));
console.log('echo agent serving as agntcy/demo/echo_agent');
await server.serveAsync();
