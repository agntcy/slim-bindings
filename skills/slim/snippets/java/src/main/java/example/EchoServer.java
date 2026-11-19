// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Minimal A2A echo agent served over SLIM (slim-a2a-java 0.4.x, A2A v1.0).
//
// Run:  SLIM_SHARED_SECRET=<32+ chars> mvn -q compile exec:java -Dexec.mainClass=example.EchoServer
// Needs JDK 21 and a SLIM node on http://localhost:46357 (override with SLIM_URL).
package example;

import java.util.List;
import java.util.concurrent.Executors;

import io.agntcy.slim.a2a.SlimA2AHandler;
import io.agntcy.slim.a2a.SlimHelper;
import io.agntcy.slim.bindings.Name;
import io.agntcy.slim.bindings.SlimBindings;
import io.agntcy.slim.bindings.slimrpc.Server;
import org.a2aproject.sdk.grpc.A2AServiceSlimrpc;
import org.a2aproject.sdk.server.agentexecution.AgentExecutor;
import org.a2aproject.sdk.server.agentexecution.RequestContext;
import org.a2aproject.sdk.server.events.InMemoryQueueManager;
import org.a2aproject.sdk.server.events.MainEventBus;
import org.a2aproject.sdk.server.events.MainEventBusProcessor;
import org.a2aproject.sdk.server.requesthandlers.DefaultRequestHandler;
import org.a2aproject.sdk.server.tasks.AgentEmitter;
import org.a2aproject.sdk.server.tasks.InMemoryPushNotificationConfigStore;
import org.a2aproject.sdk.server.tasks.InMemoryTaskStore;
import org.a2aproject.sdk.spec.A2AError;
import org.a2aproject.sdk.spec.AgentCapabilities;
import org.a2aproject.sdk.spec.AgentCard;
import org.a2aproject.sdk.spec.AgentInterface;
import org.a2aproject.sdk.spec.AgentSkill;
import org.a2aproject.sdk.spec.TextPart;

public final class EchoServer {

    static final class EchoExecutor implements AgentExecutor {
        @Override
        public void execute(RequestContext context, AgentEmitter emitter) throws A2AError {
            // Reply with a single message; for task-style replies use
            // emitter.submit() / startWork() / addArtifact(...) / complete().
            emitter.sendMessage(List.of(new TextPart("echo: " + context.getUserInput(), null)));
        }

        @Override
        public void cancel(RequestContext context, AgentEmitter emitter) throws A2AError {
            emitter.cancel();
        }
    }

    public static void main(String[] args) throws Exception {
        String secret = System.getenv("SLIM_SHARED_SECRET");
        String slimUrl = System.getenv().getOrDefault("SLIM_URL", "http://localhost:46357");

        // Call SlimHelper before any other SLIM class (even Name): loading it extracts the native library.
        SlimHelper.initializeDefaults();
        Name local = new Name("agntcy", "demo", "echo_agent");

        AgentCard agentCard = AgentCard.builder()
                .name("Echo Agent")
                .description("Returns the received text")
                .version("1.0.0")
                // Over SLIM the interface "url" is the agent's SLIM name.
                .supportedInterfaces(List.of(new AgentInterface("slimrpc", local.toString())))
                .defaultInputModes(List.of("text"))
                .defaultOutputModes(List.of("text"))
                .capabilities(AgentCapabilities.builder().streaming(true).build())
                .skills(List.of(AgentSkill.builder()
                        .id("echo").name("echo").description("echo").tags(List.of("echo")).build()))
                .build();

        // Standard a2a-java request handler wiring (no CDI container here).
        var taskStore = new InMemoryTaskStore();
        var eventBus = new MainEventBus();
        var queueManager = new InMemoryQueueManager(taskStore, eventBus);
        var eventProcessor = new MainEventBusProcessor(eventBus, taskStore, (event, task) -> {}, queueManager);
        Thread processor = new Thread(eventProcessor, "a2a-event-bus");
        processor.setDaemon(true);
        processor.start();
        var pool = Executors.newCachedThreadPool();
        var requestHandler = DefaultRequestHandler.create(new EchoExecutor(), taskStore, queueManager,
                new InMemoryPushNotificationConfigStore(), eventProcessor, pool, pool);

        // SLIM part: connect, register the A2A service, serve.
        Server server = SlimHelper.createServer(local,
                SlimHelper.sharedSecretProvider(local, secret),
                SlimHelper.sharedSecretVerifier(local, secret),
                SlimBindings.newInsecureClientConfig(slimUrl));
        A2AServiceSlimrpc.registerA2AServiceServer(server, new SlimA2AHandler(requestHandler, agentCard));
        System.out.println("echo agent serving as " + local);
        server.serveBlocking();
    }
}
