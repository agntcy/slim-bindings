// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

slim_bindings_impl::uniffi_reexport_scaffolding!();
#[cfg(feature = "rpc")]
slim_rpc_impl::uniffi_reexport_scaffolding!();
