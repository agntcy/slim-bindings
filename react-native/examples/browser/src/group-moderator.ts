// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * SLIM Group Messaging — Moderator
 *
 * Creates a multicast (group) session for a channel and invites participants.
 * Mirrors the moderator path in slim-bindings/node/examples/group.ts.
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
  parseInviteList,
  parseQueryParams,
  sleep,
  splitId,
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

const DEFAULT_LOCAL_ID = "org/default/me";
const DEFAULT_CHANNEL_ID = "org/default/channel";
const DEFAULT_INVITES = "org/default/participant-one,org/default/participant-two";

type ExampleConfig = {
  local: string;
  remote: string;
  server: string;
  sharedSecret: string;
  enableMls: boolean;
  invites: string[];
};

let app: AppLike | undefined;
let service: ServiceLike | undefined;
let connId: bigint | undefined;
let session: SessionLike | undefined;
let stopRequested = false;
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
    remote: DEFAULT_CHANNEL_ID,
    server: DEFAULT_ENDPOINT,
    secret: DEFAULT_SHARED_SECRET,
    invites: DEFAULT_INVITES,
    enableMls: "false",
  });

  return {
    local: params.local,
    remote: params.remote,
    server: params.server,
    sharedSecret: params.secret,
    enableMls: params.enableMls === "true",
    invites: parseInviteList(params.invites),
  };
}

function renderConfig(config: ExampleConfig): void {
  ui.renderConfig({
    "Local ID": config.local,
    Channel: config.remote,
    Server: config.server,
    "Shared secret": config.sharedSecret,
    "MLS enabled": String(config.enableMls),
    Invites: config.invites.join(", ") || "(none)",
  });
}

async function startExample(): Promise<void> {
  if (app) return;

  const config = loadConfig();
  if (config.invites.length < 2) {
    ui.logError(
      "Invalid configuration",
      new Error("At least two invitees are required for the group example"),
    );
    return;
  }

  renderConfig(config);
  ui.renderParticipants(config.invites);
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
    await runModerator(app, connId, config);
  } catch (error) {
    ui.logError("Example failed", error);
    await stopExample();
  }
}

async function runModerator(
  currentApp: AppLike,
  currentConnId: bigint,
  config: ExampleConfig,
): Promise<void> {
  const channelName = splitId(config.remote);

  ui.log(`Creating group session for ${config.remote}…`);
  const created = await currentApp.createSessionAndWaitAsync(
    {
      sessionType: SessionType.Group,
      maxRetries: 5,
      interval: 5_000,
      metadata: new Map(),
      mlsSettings: config.enableMls
        ? { headerIntegrityValidationPercent: 100 }
        : undefined,
    },
    channelName,
  );

  session = created;
  await sleep(100);
  ui.setSessionStatus(`Group session · ${channelName.toString()}`);
  ui.log("Group session created");
  logSessionSecurity(ui, created);
  startReceiveLoop(created);

  for (const inviteId of config.invites) {
    if (stopRequested) return;
    try {
      const inviteName = splitId(inviteId);
      await currentApp.setRouteAsync(inviteName, currentConnId);
      await created.inviteAndWaitAsync(inviteName);
      ui.log(`Invited ${inviteId}`);
      await refreshParticipants(ui, created);
    } catch (error) {
      ui.logError(`Failed to invite ${inviteId}`, error);
    }
  }

  stopParticipantPolling?.();
  stopParticipantPolling = startParticipantPolling(
    ui,
    () => session,
    () => stopRequested,
  );
  await refreshParticipants(ui, created);

  ui.log("Moderator ready — type a message and press Enter to send");
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
  receiveController?.abort();
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
