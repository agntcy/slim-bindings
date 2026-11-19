// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Call the echo agent over SLIM (slim-a2a-java 0.4.x, A2A v1.0).
//
// Run:  SLIM_SHARED_SECRET=<same as server> mvn -q compile exec:java -Dexec.mainClass=example.EchoClient -Dexec.args="hello"
package example;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import io.agntcy.slim.a2a.SlimA2AClient;
import io.agntcy.slim.a2a.SlimHelper;
import io.agntcy.slim.bindings.Name;
import io.agntcy.slim.bindings.SlimBindings;
import io.agntcy.slim.bindings.slimrpc.Channel;
import org.a2aproject.sdk.spec.EventKind;
import org.a2aproject.sdk.spec.Message;
import org.a2aproject.sdk.spec.MessageSendParams;
import org.a2aproject.sdk.spec.Part;
import org.a2aproject.sdk.spec.Task;
import org.a2aproject.sdk.spec.TextPart;

public final class EchoClient {

    public static void main(String[] args) throws Exception {
        String text = args.length > 0 ? String.join(" ", args) : "hello";
        String secret = System.getenv("SLIM_SHARED_SECRET");
        String slimUrl = System.getenv().getOrDefault("SLIM_URL", "http://localhost:46357");

        // Call SlimHelper before any other SLIM class (even Name): loading it extracts the native library.
        SlimHelper.initializeDefaults();

        // The client needs its own SLIM name, distinct from the server's.
        Name local = new Name("agntcy", "demo", "echo_client");
        Name agent = new Name("agntcy", "demo", "echo_agent");

        // A Channel is bound to one remote name; no agent card fetch over SLIM.
        Channel channel = SlimHelper.createChannel(local, agent,
                SlimHelper.sharedSecretProvider(local, secret),
                SlimHelper.sharedSecretVerifier(local, secret),
                SlimBindings.newInsecureClientConfig(slimUrl));
        try {
            SlimA2AClient client = new SlimA2AClient(channel);
            Message message = Message.builder()
                    .role(Message.Role.ROLE_USER)
                    .messageId(UUID.randomUUID().toString())
                    .parts(List.of(new TextPart(text, null)))
                    .build();

            // Depending on the agent you get a Message or a Task.
            EventKind result = client.sendMessage(MessageSendParams.builder().message(message).build());
            List<Part<?>> parts = switch (result) {
                case Message m -> m.parts();
                case Task t -> t.artifacts().stream().flatMap(a -> a.parts().stream()).toList();
                default -> List.of();
            };
            for (Part<?> part : parts) {
                if (part instanceof TextPart tp) {
                    System.out.println(tp.text());
                }
            }
        } finally {
            channel.closeBlocking(Duration.ofSeconds(5));
        }
    }
}
