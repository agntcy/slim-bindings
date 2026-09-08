import argparse
import asyncio
import logging
from collections.abc import AsyncIterable

import slim_bindings
from examples.constants import (
    NAME_NS,
    NAME_ORG,
    SHARED_SECRET,
    SLIM_ADDR,
)
from examples.slimrpc.simple.types.example_pb2 import ExampleRequest, ExampleResponse
from examples.slimrpc.simple.types.example_pb2_slimrpc import (
    TestSharedServicer,
    add_TestServicer_to_server_shared,
)

logger = logging.getLogger(__name__)


class TestSharedService(TestSharedServicer):
    """Implements all four RPC shapes in shared-responses mode.

    Each method receives ``peer_responses`` — an async iterable of
    ``(source, ExampleResponse)`` tuples decoded from other servers in the
    multicast GROUP.  The handler can consume peer responses while computing
    its own reply, enabling coordination patterns such as consensus or dedup.
    """

    async def ExampleUnaryUnary(
        self,
        request: ExampleRequest,
        context: slim_bindings.Context,
        peer_responses: AsyncIterable,
    ) -> ExampleResponse:
        logger.info(f"Received unary-unary request: {request}")

        async def log_peers() -> None:
            async for source, resp in peer_responses:
                logger.info(f"  peer [{source}] replied: {resp}")

        asyncio.create_task(log_peers())

        return ExampleResponse(
            example_integer=request.example_integer,
            example_string=f"shared: {request.example_string}",
        )

    async def ExampleUnaryStream(
        self,
        request: ExampleRequest,
        context: slim_bindings.Context,
        peer_responses: AsyncIterable,
    ) -> AsyncIterable[ExampleResponse]:
        logger.info(f"Received unary-stream request: {request}")

        async def log_peers() -> None:
            async for source, resp in peer_responses:
                logger.info(f"  peer [{source}] replied: {resp}")

        asyncio.create_task(log_peers())

        for i in range(5):
            yield ExampleResponse(example_integer=i, example_string=f"shared stream {i}")

    async def ExampleStreamUnary(
        self,
        request_iterator: AsyncIterable[ExampleRequest],
        context: slim_bindings.Context,
        peer_responses: AsyncIterable,
    ) -> ExampleResponse:
        logger.info("Received stream-unary request")

        async def log_peers() -> None:
            async for source, resp in peer_responses:
                logger.info(f"  peer [{source}] replied: {resp}")

        asyncio.create_task(log_peers())

        received = []
        async for req in request_iterator:
            received.append(req.example_string)

        return ExampleResponse(
            example_integer=len(received),
            example_string="shared saw: " + ", ".join(received),
        )

    async def ExampleStreamStream(
        self,
        request_iterator: AsyncIterable[ExampleRequest],
        context: slim_bindings.Context,
        peer_responses: AsyncIterable,
    ) -> AsyncIterable[ExampleResponse]:
        logger.info("Received stream-stream request")

        async def log_peers() -> None:
            async for source, resp in peer_responses:
                logger.info(f"  peer [{source}] replied: {resp}")

        asyncio.create_task(log_peers())

        async for req in request_iterator:
            yield ExampleResponse(
                example_integer=req.example_integer * 100,
                example_string=f"shared echo: {req.example_string}",
            )


async def amain(instance: str, server: str) -> None:
    slim_bindings.uniffi_set_event_loop(asyncio.get_running_loop())  # type: ignore[arg-type]

    tracing_config = slim_bindings.new_tracing_config()
    runtime_config = slim_bindings.new_runtime_config()
    service_config = slim_bindings.new_service_config()

    tracing_config.log_level = "info"

    slim_bindings.initialize_with_configs(
        tracing_config=tracing_config,
        runtime_config=runtime_config,
        service_config=[service_config],
    )

    service = slim_bindings.get_global_service()

    local_name = slim_bindings.Name(NAME_ORG, NAME_NS, instance)

    client_config = slim_bindings.new_insecure_client_config(server)
    conn_id = await service.connect_async(client_config)

    local_app = service.create_app_with_secret(local_name, SHARED_SECRET)
    await local_app.subscribe_async(local_name, conn_id)

    # new_with_shared_responses_and_connection accepts shared-responses sessions;
    # a standard Server.new_with_connection would reject them with failed_precondition.
    rpc_server = slim_bindings.Server.new_with_shared_responses_and_connection(
        local_app, local_name, conn_id
    )

    add_TestServicer_to_server_shared(TestSharedService(), rpc_server)

    print("SLIM_RPC_SHARED_SERVER_READY", flush=True)
    logger.info(f"Shared-responses server '{instance}' starting...")
    await rpc_server.serve_async()


def main() -> None:
    parser = argparse.ArgumentParser(description="SlimRPC shared-responses example server")
    parser.add_argument(
        "--instance",
        default="server1",
        help="Instance name (default: server1). Run two instances (server1, server2) alongside client_group_shared.py.",
    )
    parser.add_argument(
        "--server",
        default=SLIM_ADDR,
        help="SLIM server endpoint (default: from SLIM_ADDR env var or http://localhost:46357)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG)
    try:
        asyncio.run(amain(args.instance, args.server))
    except KeyboardInterrupt:
        print("Server interrupted by user.")
