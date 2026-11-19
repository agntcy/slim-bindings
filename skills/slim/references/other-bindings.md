# Kotlin, Rust and React Native

These have SLIM bindings (sessions, groups, identity, slimrpc) but **no slim-a2a SDK**. For A2A in Rust use `a2aproject/a2a-rs` (`a2a-slimrpc`). For A2A on the JVM, Java's `io.agntcy.slim:slim-a2a-java` SDK is usable from Kotlin — but it needs JDK 21 with `--enable-preview` and brings its own `slim-bindings-java`, so don't also add `slim-bindings-kotlin` (see `a2a-java.md`).

Written against slim-bindings **3.3.9**.

| Language | Install | Docs | Examples |
|---|---|---|---|
| Kotlin (JVM 17+, coroutines) | `implementation("io.agntcy.slim:slim-bindings-kotlin:<ver>")` + `kotlinx-coroutines-core` | https://docs.agntcy.org/slim/components/sdk/kotlin/ | `agntcy/slim-bindings/kotlin/examples/` (point-to-point, group, slimrpc); package `io.agntcy.slim.bindings` |
| React Native (iOS) and browser (WASM, WebSocket transport) | `npm install @agntcy/slim-bindings-react-native` | https://docs.agntcy.org/slim/components/sdk/react-native/ | `agntcy/slim-bindings/react-native/examples/` (`react-native`, `browser`) |
| Rust | the SLIM crates from `agntcy/slim` (`crates/`) | https://docs.agntcy.org/slim/components/sdk/ | `agntcy/slim` repo examples |

Notes:
- React Native: Android is not supported yet. Call `await waitForJSIBindings()` then `initializeWithDefaults()` once at startup. For plain Node.js use `@agntcy/slim-bindings` instead.
- Browsers can't open raw gRPC; the browser build connects over WebSocket, so the node needs a websocket listener (`config/websocket/` in the slim repo).
- The API shape matches the other languages (Name → App with identity → connect → subscribe → session). Read the language's tutorial before writing code: https://docs.agntcy.org/slim/components/sdk/tutorials/tutorial-connect/
