import asyncio as _asyncio

from slim_bindings._slim_bindings import *  # noqa: F403
from slim_bindings._slim_bindings import slim_bindings as _slim_bindings_ns
from slim_bindings._slim_bindings import slim_rpc as _slim_rpc_ns


def uniffi_set_event_loop(eventloop: _asyncio.BaseEventLoop) -> None:
    """Register the asyncio event loop used to drive async FFI callbacks.

    slimrpc now lives in its own UniFFI namespace (``slim_rpc``) with a
    separate event-loop global, so the loop must be set on both the core
    ``slim_bindings`` namespace and the ``slim_rpc`` namespace. Setting only
    one leaves the other's async callbacks (e.g. slimrpc server handlers)
    without a loop, surfacing as ``RuntimeError: no running event loop``.
    """
    _slim_bindings_ns.uniffi_set_event_loop(eventloop)
    _slim_rpc_ns.uniffi_set_event_loop(eventloop)
