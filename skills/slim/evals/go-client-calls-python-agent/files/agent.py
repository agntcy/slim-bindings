# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Summarizer agent served over A2A on SLIM.

Run:  SLIM_SHARED_SECRET=<32+ chars> uv run agent.py
Needs a SLIM node on http://localhost:46357.
"""

import asyncio
import os

import slim_bindings
from a2a.helpers import new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.server.tasks.task_updater import TaskUpdater
from a2a.types import Message, Part, Role
from a2a.types.a2a_pb2 import AgentCapabilities, AgentCard, AgentInterface, AgentSkill

from slima2a import setup_slim_client
from slima2a.handler import SRPCHandler
from slima2a.types.v1.a2a_pb2_slimrpc import add_A2AServiceServicer_to_server


class SummarizeExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        msg = context.message
        if msg is None:
            raise ValueError("no message")

        # The request handler expects a Task to exist before status/artifact events.
        task = context.current_task
        if task is None:
            task = new_task_from_user_message(msg)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue=event_queue, task_id=task.id, context_id=task.context_id)

        text = "".join(p.text for p in msg.parts if p.WhichOneof("content") == "text")
        words = text.split()
        summary = f"summary: {len(words)} words, starts with {words[0]!r}" if words else "summary: empty"
        reply = Message(role=Role.ROLE_AGENT, message_id=msg.message_id, parts=[Part(text=summary)])
        await updater.add_artifact(parts=list(reply.parts), name="result")
        await updater.complete(message=reply)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise NotImplementedError


async def main() -> None:
    agent_card = AgentCard(
        name="Summarizer",
        description="Summarizes text",
        version="1.0.0",
        # Over SLIM the interface "url" is the agent's SLIM name.
        supported_interfaces=[AgentInterface(url="acme/research/summarizer", protocol_binding="slimrpc", protocol_version="1.0")],
        default_input_modes=["text"],
        default_output_modes=["text"],
        capabilities=AgentCapabilities(streaming=True),
        skills=[AgentSkill(id="summarize", name="summarize", description="Summarizes text", tags=["text"])],
    )
    request_handler = DefaultRequestHandler(
        agent_executor=SummarizeExecutor(),
        task_store=InMemoryTaskStore(),
        agent_card=agent_card,
    )

    # Registers on SLIM as acme/research/summarizer. Also sets up the asyncio loop for slim_bindings.
    _service, local_app, local_name, conn_id = await setup_slim_client(
        namespace="acme",
        group="research",
        name="summarizer",
        secret=os.environ["SLIM_SHARED_SECRET"],
        slim_url=os.environ.get("SLIM_URL", "http://localhost:46357"),
    )

    server = slim_bindings.Server.new_with_connection(local_app, local_name, conn_id)
    add_A2AServiceServicer_to_server(SRPCHandler(agent_card, request_handler), server)
    print("summarizer serving as acme/research/summarizer", flush=True)
    await server.serve_async()


if __name__ == "__main__":
    asyncio.run(main())
