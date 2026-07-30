// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * SLIM Group Messaging — Participant
 *
 * Waits for an incoming group session invitation and exchanges messages.
 * Mirrors the participant path in slim-bindings/node/examples/group.ts.
 */

import {
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
  toArrayBuffer,
} from "./common";
import {
  refreshParticipants,
  startParticipantPolling,
  logSessionSecurity,
} from "./group-common";
import { bindExampleUi, prepareWasm, requireMessageControls } from "./ui";

import "./style.css";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const DEFAULT_LOCAL_ID = "org/default/participant-one";

type ExampleConfig = {
  local: string;
  server: string;
  sharedSecret: string;
};

let app: AppLike | undefined;
let service: ServiceLike | undefined;
let connId: bigint | undefined;
let session: SessionLike | undefined;
let stopRequested = false;
let listenController: AbortController | undefined;
let receiveController: AbortController | undefined;
let stopParticipantPolling: (() => void) | undefined;

const ui = bindExampleUi();
const messageControls = requireMessageControls(ui);

ui.startButton.addEventListener("click", () => void startExample());
ui.stopButton.addEventListener("click", () => void stopExample());
messageControls.sendButton.addEventListener("click", () => void sendMessage());
messageControls.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void sendMessage();
  }
});
window.addEventListener("pagehide", () => void stopExample());

void prepareWasm(ui);
ui.clearParticipants();

function loadConfig(): ExampleConfig {
  const params = parseQueryParams({
    local: DEFAULT_LOCAL_ID,
    server: DEFAULT_ENDPOINT,
    secret: DEFAULT_SHARED_SECRET,
  });

  return {
    local: params.local,
    server: params.server,
    sharedSecret: params.secret,
  };
}

function renderConfig(config: ExampleConfig): void {
  ui.renderConfig({
    "Local ID": config.local,
    Server: config.server,
    "Shared secret": config.sharedSecret,
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
    await runParticipant(app);
  } catch (error) {
    ui.logError("Example failed", error);
    await stopExample();
  }
}

async function runParticipant(currentApp: AppLike): Promise<void> {
  const controller = new AbortController();
  listenController = controller;
  ui.setSessionStatus("Waiting for group invitation");
  ui.log("Waiting for incoming group session invitation…");

  try {
    const incoming = await currentApp.listenForSessionAsync(60_000, {
      signal: controller.signal,
    });
    if (stopRequested || app !== currentApp) return;

    session = incoming;
    const channelName = incoming.destination().toString();
    ui.setSessionStatus(`Group session · ${channelName}`);
    ui.log(`Joined group session for channel: ${channelName}`);
    logSessionSecurity(ui, incoming);
    startReceiveLoop(incoming);
    stopParticipantPolling?.();
    stopParticipantPolling = startParticipantPolling(
      ui,
      () => session,
      () => stopRequested,
    );
    await refreshParticipants(ui, incoming);
    ui.log("Participant ready — type a message and press Enter to send");
  } catch (error) {
    if (!controller.signal.aborted) {
      ui.logError("Failed to join group session", error);
      await stopExample();
    }
  } finally {
    if (listenController === controller) listenController = undefined;
  }
}

async function sendMessage(): Promise<void> {
  const currentSession = session;
  const text = messageControls.messageInput.value.trim();
  if (!currentSession || !text || stopRequested) return;

  try {
    await currentSession.publishAndWaitAsync(
      toArrayBuffer(textEncoder.encode(text)),
      "text/plain",
      undefined,
    );
    ui.appendMessage("You", text, true);
    messageControls.messageInput.value = "";
    ui.log("Sent to group");
  } catch (error) {
    ui.logError("Failed to send message", error);
  }
}

function startReceiveLoop(currentSession: SessionLike): void {
  receiveController?.abort();
  const controller = new AbortController();
  receiveController = controller;
  const sourceName = currentSession.source().toString();

  void (async () => {
    while (session === currentSession && !controller.signal.aborted) {
      try {
        const received = await currentSession.getMessageAsync(1_000, {
          signal: controller.signal,
        });
        const ctx = received.context;
        const text = textDecoder.decode(received.payload);
        ui.appendMessage(ctx.sourceName.toString(), text);
        ui.log(`${ctx.sourceName.toString()} > ${text}`);

        if (!ctx.metadata.has("PUBLISH_TO")) {
          const reply = `message received by ${sourceName}`;
          await currentSession.publishToAndWaitAsync(
            ctx,
            toArrayBuffer(textEncoder.encode(reply)),
            undefined,
            ctx.metadata,
          );
        }
      } catch (error) {
        if (controller.signal.aborted || stopRequested) return;
        const message = describeError(error).toLowerCase();
        if (message.includes("timeout")) continue;
        ui.log(`Session ended: ${describeError(error)}`);
        return;
      }
    }
  })();
}

async function stopExample(): Promise<void> {
  stopRequested = true;
  stopParticipantPolling?.();
  stopParticipantPolling = undefined;
  listenController?.abort();
  receiveController?.abort();
  listenController = undefined;
  receiveController = undefined;

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
  ui.clearParticipants();
  ui.setRunning(false);
}
