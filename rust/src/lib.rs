// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

slim_bindings_impl::uniffi_reexport_scaffolding!();
#[cfg(not(target_arch = "wasm32"))]
slim_rpc_impl::uniffi_reexport_scaffolding!();
