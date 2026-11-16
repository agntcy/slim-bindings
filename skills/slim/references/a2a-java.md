# A2A over SLIM — Java (and Kotlin/JVM)

**Written against:** `io.agntcy.slim:slim-a2a-java` 0.4.2, `slim-bindings-java` 3.3.6 (pulled by it), A2A Java SDK `org.a2aproject.sdk` 1.1.0.Final, A2A protocol v1.0, **JDK 21**. Verified end to end against a `ghcr.io/agntcy/slim:3.4.6` node.
If the installed `slim-a2a-java` is newer, check https://github.com/agntcy/slim-a2a-java/tree/main/examples/echo-agent at the matching tag before trusting the code below.

Kotlin/JVM projects use this same SDK (there is no separate Kotlin slim-a2a); the JDK 21 and `--enable-preview` rules below apply to them too.

## Contents
1. Install
2. Connect to a node
3. Serve an agent
4. Call an agent
5. Identity and TLS
6. Multi-agent: multicast and groups
7. A2A v0.3 compatibility
8. Gotchas
9. More examples

## 1. Install

Maven:

```xml
<dependency>
  <groupId>io.agntcy.slim</groupId>
  <artifactId>slim-a2a-java</artifactId>
  <version>0.4.2</version>
</dependency>
<!-- maven-compiler-plugin: <release>21</release> + <compilerArgs><arg>--enable-preview</arg></compilerArgs> -->
```

Gradle (Kotlin DSL):

```kotlin
dependencies { implementation("io.agntcy.slim:slim-a2a-java:0.4.2") }
java { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }
tasks.withType<JavaCompile> { options.compilerArgs.add("--enable-preview") }
tasks.withType<JavaExec> { jvmArgs("--enable-preview", "--enable-native-access=ALL-UNNAMED") }
```

It pulls compatible `slim-bindings-java` and `a2a-java-sdk-server-common` / `-spec-grpc`; don't pin those yourself. `slim-bindings-java` uses the FFM API, a **preview** feature in Java 21, so compile with `--enable-preview` and run on **JDK 21 exactly** with `--enable-preview --enable-native-access=ALL-UNNAMED`. For `mvn exec:java` put those flags in `.mvn/jvm.config` (the snippet project does). The native library ships inside the jar; `SlimHelper` extracts it, so no `java.library.path` setup is needed.

## 2. Connect to a node

`SlimHelper` (in `io.agntcy.slim.a2a`) creates the app with an identity, connects, subscribes, and hands back a slimrpc `Server` or `Channel`:

```java
SlimHelper.initializeDefaults();                          // first SLIM call, before even `new Name(...)`
Name local = new Name("agntcy", "demo", "echo_agent");    // → SLIM name agntcy/demo/echo_agent
String secret = System.getenv("SLIM_SHARED_SECRET");      // >= 32 chars

Server server = SlimHelper.createServer(local,
        SlimHelper.sharedSecretProvider(local, secret),
        SlimHelper.sharedSecretVerifier(local, secret),
        SlimBindings.newInsecureClientConfig("http://localhost:46357"));   // or newSecureClientConfig for TLS
```

`SlimHelper.createChannel(localName, remoteName, provider, verifier, clientConfig)` is the client-side twin. Shortcut overloads `createServer(instance, org, ns, secret, url)` / `createChannel(instance, org, ns, remoteInstance, secret, url)` exist but force client and server into the same `org/ns`. For anything else use raw `SlimBindings.getGlobalService()` → `service.createApp(...)`, `service.connect(...)`, `app.subscribe(app.name(), connId)`.

## 3. Serve an agent

Full runnable project: `snippets/java/` (`pom.xml`, `.mvn/jvm.config`, `src/main/java/example/EchoServer.java`; copy and adapt it). The SLIM-specific part is only this:

```java
import io.agntcy.slim.a2a.SlimA2AHandler;
import org.a2aproject.sdk.grpc.A2AServiceSlimrpc;

// agentCard: org.a2aproject.sdk.spec.AgentCard; requestHandler: a2a-java DefaultRequestHandler
A2AServiceSlimrpc.registerA2AServiceServer(server, new SlimA2AHandler(requestHandler, agentCard));
server.serveBlocking();
```

Everything else (`AgentExecutor`, `AgentEmitter`, `InMemoryTaskStore`, `DefaultRequestHandler`) is ordinary a2a-java code. Outside Quarkus/CDI you wire the request handler by hand: `MainEventBus`, `InMemoryQueueManager`, a `MainEventBusProcessor` **running on its own thread**, `InMemoryPushNotificationConfigStore`, then `DefaultRequestHandler.create(...)`. Copy the exact sequence from the snippet.

Agent card: `.supportedInterfaces(List.of(new AgentInterface("slimrpc", "agntcy/demo/echo_agent")))` (argument order is binding, then URL).

Executor: `emitter.sendMessage(...)` replies with a plain message. For task-style replies call `emitter.submit()`, `startWork()`, `addArtifact(...)`, `complete()`; the emitter creates the Task for you (no manual "enqueue a Task first" step as in Python).

## 4. Call an agent

Full runnable file: `snippets/java/src/main/java/example/EchoClient.java`. Core:

```java
import io.agntcy.slim.a2a.SlimA2AClient;

Channel channel = SlimHelper.createChannel(local /* agntcy/demo/echo_client */, agent /* agntcy/demo/echo_agent */,
        provider, verifier, SlimBindings.newInsecureClientConfig(slimUrl));
SlimA2AClient client = new SlimA2AClient(channel);        // optional 2nd arg: per-call timeout, default 30s
EventKind result = client.sendMessage(MessageSendParams.builder().message(message).build());
switch (result) { case Message m -> ...; case Task t -> ...; default -> {} }   // handle both
channel.closeBlocking(Duration.ofSeconds(5));
```

A `Channel` is bound to one remote name, so there's no agent card or client factory; one channel per agent. `SlimA2AClient` also has `getTask`, `cancelTask`, `getExtendedAgentCard`. `sendStreamingMessage` and `subscribeToTask` return a raw `ResponseStreamReader` of protobuf bytes: decode with `ProtoUtils.FromProto.streamingEventKind(StreamResponse.parseFrom(bytes))` (copy `A2AEventStream.java` from the repo example).

The client must use its **own** SLIM name and the same identity trust as the server.

## 5. Identity and TLS

- **Shared secret** (dev): `SlimHelper.sharedSecretProvider/Verifier(name, secret)` on both sides, same value, ≥ 32 chars.
- **JWT / SPIRE** (per-agent identity): pass `new IdentityProviderConfig.Jwt(...)` / `new IdentityVerifierConfig.Jwt(...)` (also `Spire`; provider-only `StaticJwt`) to the general `createServer` / `createChannel` overloads. The slim-a2a-java README ("Identity and Node Connections") has a complete Ed25519 + JWKS example; copy it from there rather than reconstructing it.
- **TLS to the node:** `ClientConfig node = SlimBindings.newSecureClientConfig("https://slim.example.com:443")`, optionally `node.setAuth(new ClientAuthenticationConfig.StaticJwt(new StaticJwtAuth(path, Duration.ofMinutes(5))))`, and pass it as `clientConfig`.
- **Who called me (server side):** `context.getCallContext().getUser()` in the executor is an `io.agntcy.slim.a2a.SlimUser` (`getSubject()`, `getIssuer()`) when the MLS token carried a subject, otherwise anonymous/unauthenticated. Authorize on this, never on request metadata. With a shared secret the subject is self-asserted.

## 6. Multi-agent: multicast and groups

**No high-level multicast in slim-a2a-java 0.4.2**: `SlimA2AClient` is single-agent and `SlimHelper` has no group helper. The generated group stub does work (verified against two agents), with proto types and manual decoding:

```java
Service service = SlimBindings.getGlobalService();
App app = service.createApp(local, provider, verifier);
long connId = service.connect(SlimBindings.newInsecureClientConfig(slimUrl));
app.subscribe(app.name(), connId);
Channel group = Channel.newGroupWithConnection(app, List.of(agentA, agentB), connId);
var stub = new A2AServiceSlimrpc.A2AServiceGroupClientImpl(group);

var stream = stub.SendMessage(ProtoUtils.ToProto.sendMessageRequest(params), Duration.ofSeconds(30), null);
for (MulticastStreamMessage m; !((m = stream.next()) instanceof MulticastStreamMessage.End); ) {
    if (m instanceof MulticastStreamMessage.Data d) {
        var resp = org.a2aproject.sdk.grpc.SendMessageResponse.parseFrom(d.item().message());
        System.out.println(d.item().context().source() + " -> " + resp);   // source = which agent answered
    } else if (m instanceof MulticastStreamMessage.Error e) { /* e.error() */ }
}
```

Each agent is an ordinary server (section 3) with its own name. For an orchestrator calling agents one at a time, open one `Channel` + `SlimA2AClient` per agent.

For non-RPC group messaging (chat-room style channels, moderator invites), use slim-bindings group sessions directly: https://docs.agntcy.org/slim/components/sdk/tutorials/tutorial-session/ and `agntcy/slim-bindings/java/examples` (`Group`).

## 7. A2A v0.3 compatibility

Not available in slim-a2a-java 0.4.2: it speaks A2A v1.0 only, with no compat servicer or transport. Java agents can't talk to v0.3-only SLIM agents; the peer must speak v1.0 (Python's slima2a, for example, can serve v1.0 and v0.3 side by side).

## 8. Gotchas

- **JDK 21 exactly.** On JDK 17 the build fails with `release version 21 not supported`. On newer JDKs (e.g. 26) it fails at runtime with `UnsupportedClassVersionError: io/agntcy/slim/bindings/SlimBindings (class file version 65.65535) was compiled with preview features that are unsupported`. Point `JAVA_HOME` at a 21 install.
- Missing JVM flags: `UnsupportedClassVersionError: Preview features are not enabled for io/agntcy/slim/bindings/SlimBindings ... Try running with '--enable-preview'`. Add `.mvn/jvm.config` (Maven) or `jvmArgs` (Gradle).
- `no slim_bindings in java.library.path`: a SLIM class (even `new Name(...)`) was touched before `SlimHelper` was loaded, so the bundled native library wasn't extracted. Call `SlimHelper.initializeDefaults()` first thing.
- Start the server before the client; a client calling a name nobody serves fails after about 10 s with `RpcException$Rpc: code=UNAVAILABLE, message=Session handshake failed: failed to add participant to session: message send retries exhausted for id=...`. The same error appears when the secrets differ — check both.
- A secret under 32 chars fails immediately with `SlimException$AuthException: message=hmac key is too short`. An unset `SLIM_SHARED_SECRET` gives a bare `NullPointerException: secret`.
- `mvn exec:java -Dexec.args="hello world"` splits on spaces into two args; the snippet client joins them.
- Kotlin: build on `slim-a2a-java` (which brings `slim-bindings-java`); don't mix in `slim-bindings-kotlin`, a separate binding of the same core that also uses the `io.agntcy.slim.bindings` package.
- `serveBlocking()` blocks the calling thread; `serveAsync()` returns a `CompletableFuture`.
- SLF4J "No providers" warnings at startup are harmless; add `slf4j-simple` if you want a2a-java logs.

## 9. More examples

https://github.com/agntcy/slim-a2a-java/tree/main/examples/echo-agent — one server plus a client that exercises every call shape: `SendMessage`, `SendStreamingMessage` + `GetTask`, `SubscribeToTask` + `CancelTask`, `GetExtendedAgentCard` (agent behaviour picked by a `stream:` / `slow:` text prefix).
