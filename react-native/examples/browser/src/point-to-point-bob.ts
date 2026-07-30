// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * SLIM Point-to-Point Bob (Sender)
 *
 * Creates a point-to-point session with a remote peer and sends messages,
 * waiting for a reply after each publish.
 * Mirrors slim-bindings/node/examples/point-to-point-bob.ts.
 */

import {
  SessionType,
  type AppLike,
  type ServiceLike,
  type SessionLike,
} from "@agntcy/slim-bindings-react-native/web";

import {
  DEFAULT_ENDPOINT,
  DEFAULT_SHARED_SECRET,
  createAndConnectApp,
  describeError,
  parseQueryParams,
  sleep,
  splitId,
  toArrayBuffer,
} from "./common";
import { bindExampleUi, prepareWasm } from "./ui";

import "./style.css";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const DEFAULT_LOCAL_ID = "org/bob/app";
const DEFAULT_REMOTE_ID = "org/alice/app";
const DEFAULT_MESSAGE = "Hello from Bob";
const DEFAULT_ITERATIONS = "5";

type ExampleConfig = {
  local: string;
  remote: string;
  server: string;
  sharedSecret: string;
  message: string;
  iterations: number;
};

let app: AppLike | undefined;
let service: ServiceLike | undefined;
let connId: bigint | undefined;
let session: SessionLike | undefined;
let stopRequested = false;

const ui = bindExampleUi();

ui.startButton.addEventListener("click", () => void startExample());
ui.stopButton.addEventListener("click", () => void stopExample());
window.addEventListener("pagehide", () => void stopExample());

void prepareWasm(ui);

function loadConfig(): ExampleConfig {
  const params = parseQueryParams({
    local: DEFAULT_LOCAL_ID,
    remote: DEFAULT_REMOTE_ID,
    server: DEFAULT_ENDPOINT,
    secret: DEFAULT_SHARED_SECRET,
    message: DEFAULT_MESSAGE,
    iterations: DEFAULT_ITERATIONS,
  });

  const iterations = Number.parseInt(params.iterations, 10);
  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error("iterations must be a positive number");
  }

  return {
    local: params.local,
    remote: params.remote,
    server: params.server,
    sharedSecret: params.secret,
    message: params.message,
    iterations,
  };
}

function renderConfig(config: ExampleConfig): void {
  ui.renderConfig({
    "Local ID": config.local,
    "Remote ID": config.remote,
    Server: config.server,
    "Shared secret": config.sharedSecret,
    Message: config.message,
    Iterations: String(config.iterations),
  });
}

async function startExample(): Promise<void> {
  if (app) return;

  let config: ExampleConfig;
  try {
    config = loadConfig();
  } catch (error) {
    ui.logError("Invalid configuration", error);
    return;
  }

  renderConfig(config);
  stopRequested = false;
  ui.setRunning(true);
  ui.setConnectionStatus("Connecting…");
  ui.setSessionStatus("No session");

  try {
    const connected = await createAndConnectApp({
      endpoint: config.server,
      localId: config.local,
      sharedSecret: config.sharedSecret,
    });
    app = connected.app;
    service = connected.service;
    connId = connected.connId;

    ui.setConnectionStatus(`Connected · conn ${connId}`);
    ui.log(`Connected as ${app.name().toString()}`);
    await runSender(app, connId, config);
  } catch (error) {
    ui.logError("Example failed", error);
    await stopExample();
  }
}

async function runSender(
  currentApp: AppLike,
  currentConnId: bigint,
  config: ExampleConfig,
): Promise<void> {
  const remoteName = splitId(config.remote);

  ui.log(`Setting route to ${config.remote}…`);
  await currentApp.setRouteAsync(remoteName, currentConnId);
  ui.log("Route established");
  await sleep(100);

  ui.log("Creating session…");
  const created = await currentApp.createSessionAndWaitAsync(
    {
      sessionType: SessionType.PointToPoint,
      maxRetries: 5,
      interval: 5_000,
      metadata: new Map(),
      mlsSettings: undefined,
    },
    remoteName,
  );

  session = created;
  ui.setSessionStatus(`Session · ${created.sessionId()}`);
  ui.log(`Session established (${created.sessionId()})`);

  for (let i = 0; i < config.iterations && !stopRequested; i++) {
    const text = `${config.message} (${i + 1}/${config.iterations})`;
    ui.log(`Sending: ${text}`);
    await created.publishAndWaitAsync(
      toArrayBuffer(textEncoder.encode(text)),
      "text/plain",
      undefined,
    );
    ui.appendMessage("You", text, true);

    try {
      const received = await created.getMessageAsync(30_000);
      const reply = textDecoder.decode(received.payload);
      ui.appendMessage(received.context.sourceName.toString(), reply);
      ui.log(`Received reply: ${reply}`);
    } catch (error) {
      const message = describeError(error).toLowerCase();
      if (message.includes("timeout")) {
        ui.log("No reply received (timeout)");
      } else {
        ui.logError("Error receiving reply", error);
      }
    }

    if (i < config.iterations - 1) await sleep(1_000);
  }

  ui.log("All messages sent");
  await stopExample();
}

async function stopExample(): Promise<void> {
  stopRequested = true;

  const currentApp = app;
  const currentService = service;
  const currentConnId = connId;
  const currentSession = session;
  app = undefined;
  service = undefined;
  connId = undefined;
  session = undefined;

  if (currentApp) {
    if (currentSession) {
      try {
        await currentApp.deleteSessionAndWaitAsync(currentSession);
        ui.log("Session closed");
      } catch (error) {
        ui.logError("Session cleanup failed", error);
      }
    }
    if (currentService && currentConnId !== undefined) {
      try {
        currentService.disconnect(currentConnId);
        ui.log("Disconnected from SLIM");
      } catch (error) {
        ui.logError("Disconnect failed", error);
      }
    }
  }

  ui.setConnectionStatus("Disconnected");
  ui.setSessionStatus("No session");
  ui.setRunning(false);
}
