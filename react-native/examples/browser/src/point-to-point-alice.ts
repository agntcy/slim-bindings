// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * SLIM Point-to-Point Alice (Receiver)
 *
 * Listens for incoming point-to-point sessions and replies to each message.
 * Mirrors slim-bindings/node/examples/point-to-point-alice.ts.
 */

import {
  type AppLike,
  type ReceivedMessage,
  type SessionLike,
} from "@agntcy/slim-bindings-react-native/web";

import {
  DEFAULT_ENDPOINT,
  DEFAULT_SHARED_SECRET,
  createAndConnectApp,
  describeError,
  parseQueryParams,
  sleep,
  toArrayBuffer,
} from "./common";
import { bindExampleUi, prepareWasm } from "./ui";

import "./style.css";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const DEFAULT_LOCAL_ID = "org/alice/app";
const DEFAULT_REPLY = "Hello from Alice";

type ExampleConfig = {
  local: string;
  server: string;
  sharedSecret: string;
  reply: string;
};

let app: AppLike | undefined;
let activeSession: SessionLike | undefined;
let stopRequested = false;
let listenController: AbortController | undefined;

const ui = bindExampleUi();

ui.startButton.addEventListener("click", () => void startExample());
ui.stopButton.addEventListener("click", () => void stopExample());
window.addEventListener("pagehide", () => void stopExample());

void prepareWasm(ui);

function loadConfig(): ExampleConfig {
  const params = parseQueryParams({
    local: DEFAULT_LOCAL_ID,
    server: DEFAULT_ENDPOINT,
    secret: DEFAULT_SHARED_SECRET,
    reply: DEFAULT_REPLY,
  });

  return {
    local: params.local,
    server: params.server,
    sharedSecret: params.secret,
    reply: params.reply,
  };
}

function renderConfig(config: ExampleConfig): void {
  ui.renderConfig({
    "Local ID": config.local,
    Server: config.server,
    "Shared secret": config.sharedSecret,
    Reply: config.reply,
  });
}

async function startExample(): Promise<void> {
  if (app) return;

  const config = loadConfig();
  renderConfig(config);
  stopRequested = false;
  ui.setRunning(true);
  ui.setConnectionStatus("Connecting…");
  ui.setSessionStatus("No session");

  try {
    app = await createAndConnectApp({
      endpoint: config.server,
      localId: config.local,
      sharedSecret: config.sharedSecret,
    });

    ui.setConnectionStatus(`Connected · ${app.remoteConnectionId()}`);
    ui.log(`Connected as ${app.name().toString()}`);
    ui.log("Waiting for incoming sessions…");

    await listenLoop(app, config);
  } catch (error) {
    ui.logError("Example failed", error);
    await stopExample();
  }
}

async function listenLoop(
  currentApp: AppLike,
  config: ExampleConfig,
): Promise<void> {
  while (!stopRequested && app === currentApp) {
    const controller = new AbortController();
    listenController = controller;
    ui.setSessionStatus("Waiting for incoming session");

    try {
      const session = await currentApp.listenForSessionAsync(undefined, {
        signal: controller.signal,
      });
      if (stopRequested || app !== currentApp) return;

      activeSession = session;
      ui.setSessionStatus(
        `Session · ${session.source().toString()} → ${session.destination().toString()}`,
      );
      ui.log("Incoming session accepted");
      await handleSession(currentApp, session, config);
    } catch (error) {
      if (!controller.signal.aborted && !stopRequested) {
        ui.logError("Session listener failed", error);
        await sleep(1_000);
      }
    } finally {
      if (listenController === controller) listenController = undefined;
      activeSession = undefined;
      if (!stopRequested) ui.setSessionStatus("Waiting for incoming session");
    }
  }
}

async function handleSession(
  currentApp: AppLike,
  session: SessionLike,
  config: ExampleConfig,
): Promise<void> {
  const receiveController = new AbortController();

  try {
    while (!stopRequested && activeSession === session) {
      try {
        const received = await session.getMessageAsync(undefined, {
          signal: receiveController.signal,
        });
        renderReceivedMessage(received);

        const reply = config.reply;
        await session.publishToAndWaitAsync(
          received.context,
          toArrayBuffer(textEncoder.encode(reply)),
          "text/plain",
          received.context.metadata,
        );
        ui.log(`Sent reply: ${reply}`);
      } catch (error) {
        if (receiveController.signal.aborted || stopRequested) return;
        const message = describeError(error).toLowerCase();
        if (message.includes("timeout")) continue;
        ui.log(`Session ended: ${describeError(error)}`);
        return;
      }
    }
  } finally {
    receiveController.abort();
    try {
      await currentApp.deleteSessionAndWaitAsync(session);
      ui.log("Session closed");
    } catch (error) {
      ui.logError("Failed to delete session", error);
    }
  }
}

function renderReceivedMessage(received: ReceivedMessage): void {
  const source = received.context.sourceName.toString();
  const text = textDecoder.decode(received.payload);
  ui.appendMessage(source, text);
  ui.log(`Received ${received.payload.byteLength} bytes from ${source}`);
}

async function stopExample(): Promise<void> {
  stopRequested = true;
  listenController?.abort();
  listenController = undefined;

  const currentApp = app;
  const currentSession = activeSession;
  app = undefined;
  activeSession = undefined;

  if (currentApp) {
    if (currentSession) {
      try {
        await currentApp.deleteSessionAndWaitAsync(currentSession);
      } catch (error) {
        ui.logError("Session cleanup failed", error);
      }
    }
    try {
      currentApp.disconnect();
      ui.log("Disconnected from SLIM");
    } catch (error) {
      ui.logError("Disconnect failed", error);
    }
  }

  ui.setConnectionStatus("Disconnected");
  ui.setSessionStatus("No session");
  ui.setRunning(false);
}
