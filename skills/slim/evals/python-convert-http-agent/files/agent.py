# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Shouting agent: replies with the user's text in upper case. Served over A2A JSON-RPC/HTTP."""

import uvicorn
from a2a.helpers import new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore
from a2a.server.tasks.task_updater import TaskUpdater
from a2a.types import Message, Part, Role
from a2a.types.a2a_pb2 import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from starlette.applications import Starlette


class ShoutExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        msg = context.message
        task = context.current_task or new_task_from_user_message(msg)
        if context.current_task is None:
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue=event_queue, task_id=task.id, context_id=task.context_id)
        text = "".join(p.text for p in msg.parts if p.WhichOneof("content") == "text")
        reply = Message(role=Role.ROLE_AGENT, message_id=msg.message_id, parts=[Part(text=text.upper())])
        await updater.add_artifact(parts=list(reply.parts), name="result")
        await updater.complete(message=reply)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise NotImplementedError


agent_card = AgentCard(
    name="Shout Agent",
    description="Repeats your message in upper case",
    version="1.2.0",
    supported_interfaces=[AgentInterface(url="http://localhost:9999/", protocol_binding="JSONRPC", protocol_version="1.0")],
    default_input_modes=["text"],
    default_output_modes=["text"],
    capabilities=AgentCapabilities(streaming=True),
    skills=[AgentSkill(id="shout", name="shout", description="upper-cases text", tags=["text"])],
)

handler = DefaultRequestHandler(agent_executor=ShoutExecutor(), task_store=InMemoryTaskStore(), agent_card=agent_card)
routes = create_agent_card_routes(agent_card=agent_card) + create_jsonrpc_routes(request_handler=handler, rpc_url="/")
app = Starlette(routes=routes)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9999)
