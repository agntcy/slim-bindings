// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

package io.agntcy.slim.bindings.slimrpc;


import java.util.function.Function;

public final class ClientBidiStream<ReqT> {
    private final BidiStreamHandler inner;
    private final Function<ReqT, byte[]> serializer;

    public ClientBidiStream(BidiStreamHandler inner, Function<ReqT, byte[]> serializer) {
        this.inner = inner;
        this.serializer = serializer;
    }

    public void send(ReqT request) throws RpcException {
        inner.sendAsync(serializer.apply(request)).join();
    }

    public void closeSend() throws RpcException {
        inner.closeSendAsync().join();
    }

    public StreamMessage recv() {
        return inner.recvAsync().join();
    }
}
