# Copyright AGNTCY Contributors (https://github.com/agntcy)
# SPDX-License-Identifier: Apache-2.0

"""Call the echo agent over SLIM (slima2a 0.9.x, A2A v1.0).

Run:  SLIM_SHARED_SECRET=<same as server> python echo_client.py "hello"
"""

import asyncio
import os
import sys

import httpx
from a2a.client import minimal_agent_card
from a2a.helpers import new_text_message
from a2a.types.a2a_pb2 import Role, SendMessageRequest

from slima2a import setup_slim_client
from slima2a.client_transport import ClientConfig, MultiAgentClientFactory, slimrpc_channel_factory


async def main(text: str) -> None:
    # The client needs its own SLIM name, distinct from the server's.
    _service, local_app, _local_name, conn_id = await setup_slim_client(
        namespace="agntcy",
        group="demo",
        name="echo_client",
        secret=os.environ["SLIM_SHARED_SECRET"],
        slim_url=os.environ.get("SLIM_URL", "http://localhost:46357"),
    )

    async with httpx.AsyncClient() as http:
        config = ClientConfig(
            supported_protocol_bindings=["slimrpc"],
            streaming=True,
            httpx_client=http,
            slimrpc_channel_factory=slimrpc_channel_factory(local_app, conn_id),
        )
        factory = MultiAgentClientFactory(config)
        # Over SLIM the agent is addressed by its SLIM name; no HTTP card fetch.
        client = factory.create(card=minimal_agent_card("agntcy/demo/echo_agent", ["slimrpc"]))

        request = SendMessageRequest(message=new_text_message(text, role=Role.ROLE_USER))
        async for resp in client.send_message(request=request):
            # Depending on the agent you get a message, a task, or artifact updates.
            match resp.WhichOneof("payload"):
                case "message":
                    parts = resp.message.parts
                case "task":
                    parts = [p for a in resp.task.artifacts for p in a.parts]
                case "artifact_update":
                    parts = resp.artifact_update.artifact.parts
                case _:
                    parts = []
            for part in parts:
                if part.WhichOneof("content") == "text":
                    print(part.text)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "hello"))
