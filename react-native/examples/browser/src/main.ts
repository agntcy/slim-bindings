import {
  App,
  Direction,
  Name,
  SessionType,
  uniffiInitAsync,
  type AppLike,
  type NameLike,
  type ReceivedMessage,
  type SessionLike,
} from "@agntcy/slim-bindings-react-native/web";

import "./style.css";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type PresetAction = "create" | "listen";
type SessionTypeValue = "point-to-point" | "group";

type ScenarioPreset = {
  description: string;
  action: PresetAction;
  localName: string;
  sessionType: SessionTypeValue;
  remoteName?: string;
  groupName?: string;
  participants?: string[];
};

const scenarioPresets: Record<string, ScenarioPreset> = {
  "unicast-alice": {
    description:
      "Alice creates a two-party session after Bob is connected and waiting in another tab.",
    action: "create",
    localName: "org/default/alice",
    sessionType: "point-to-point",
    remoteName: "org/default/bob",
  },
  "unicast-bob": {
    description:
      "Bob receives the unicast session created by Alice in another browser tab.",
    action: "listen",
    localName: "org/default/bob",
    sessionType: "point-to-point",
    remoteName: "org/default/alice",
  },
  "browser-group-moderator": {
    description:
      "The browser moderator creates a multicast group and invites two browser participants.",
    action: "create",
    localName: "org/default/browser-mod",
    sessionType: "group",
    groupName: "org/default/browser-group",
    participants: ["org/default/browser-one", "org/default/browser-two"],
  },
  "browser-group-one": {
    description:
      "Browser participant one connects and waits for the browser moderator's group invitation.",
    action: "listen",
    localName: "org/default/browser-one",
    sessionType: "group",
    groupName: "org/default/browser-group",
    participants: [],
  },
  "browser-group-two": {
    description:
      "Browser participant two connects and waits for the browser moderator's group invitation.",
    action: "listen",
    localName: "org/default/browser-two",
    sessionType: "group",
    groupName: "org/default/browser-group",
    participants: [],
  },
  "mixed-moderator": {
    description:
      "The browser creates one multicast session for native WebSocket and native gRPC participants.",
    action: "create",
    localName: "org/default/browser",
    sessionType: "group",
    groupName: "org/default/mixed-demo",
    participants: ["org/default/native-ws", "org/default/native-grpc"],
  },
  "mixed-participant": {
    description:
      "The browser waits for a group invitation from a native moderator using either transport.",
    action: "listen",
    localName: "org/default/browser",
    sessionType: "group",
    groupName: "org/default/mixed-demo",
    participants: [],
  },
};

const connectionForm = element<HTMLFormElement>("connection-form");
const messageForm = element<HTMLFormElement>("message-form");
const endpointInput = element<HTMLInputElement>("endpoint");
const tokenInput = element<HTMLInputElement>("token");
const localNameInput = element<HTMLInputElement>("local-name");
const remoteNameInput = element<HTMLInputElement>("remote-name");
const groupNameInput = element<HTMLInputElement>("group-name");
const participantsInput = element<HTMLTextAreaElement>("participants");
const secretInput = element<HTMLInputElement>("shared-secret");
const sessionTypeInput = element<HTMLSelectElement>("session-type");
const mlsEnabledInput = element<HTMLInputElement>("mls-enabled");
const scenarioPresetInput = element<HTMLSelectElement>("scenario-preset");
const messageInput = element<HTMLInputElement>("message");
const connectButton = element<HTMLButtonElement>("connect");
const disconnectButton = element<HTMLButtonElement>("disconnect");
const listenButton = element<HTMLButtonElement>("listen");
const createSessionButton = element<HTMLButtonElement>("create-session");
const closeSessionButton = element<HTMLButtonElement>("close-session");
const applyPresetButton = element<HTMLButtonElement>("apply-preset");
const sendButton = element<HTMLButtonElement>("send");
const clearLogButton = element<HTMLButtonElement>("clear-log");
const wasmStatus = element<HTMLDivElement>("wasm-status");
const connectionStatus = element<HTMLDivElement>("connection-status");
const sessionStatus = element<HTMLDivElement>("session-status");
const pointToPointFields = element<HTMLDivElement>("point-to-point-fields");
const groupFields = element<HTMLDivElement>("group-fields");
const modeInstructions = element<HTMLParagraphElement>("mode-instructions");
const scenarioDescription = element<HTMLParagraphElement>(
  "scenario-description",
);
const sessionSummary = element<HTMLDivElement>("session-summary");
const messages = element<HTMLDivElement>("messages");
const logOutput = element<HTMLPreElement>("log");

let wasmReady = false;
let app: AppLike | undefined;
let session: SessionLike | undefined;
let listenController: AbortController | undefined;
let receiveController: AbortController | undefined;
let appliedPreset = "custom";

connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void connect();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage();
});

disconnectButton.addEventListener("click", () => void disconnect());
listenButton.addEventListener("click", () => void listenForSession());
createSessionButton.addEventListener(
  "click",
  () => void createOutgoingSession(),
);
closeSessionButton.addEventListener("click", () => void closeSession());
applyPresetButton.addEventListener("click", applyScenarioPreset);
scenarioPresetInput.addEventListener("change", updatePresetDescription);
sessionTypeInput.addEventListener("change", () => {
  markPresetCustom();
  updateSessionMode();
});
mlsEnabledInput.addEventListener("change", updateSessionSummary);
for (const input of [
  localNameInput,
  remoteNameInput,
  groupNameInput,
  participantsInput,
]) {
  input.addEventListener("input", () => {
    markPresetCustom();
    updateSessionSummary();
  });
}
clearLogButton.addEventListener("click", () => {
  logOutput.textContent = "";
});
window.addEventListener("pagehide", () => {
  listenController?.abort();
  receiveController?.abort();
  app?.disconnect();
});

updateSessionMode();
updatePresetDescription();
void initializeWasm();

async function initializeWasm(): Promise<void> {
  try {
    await uniffiInitAsync();
    wasmReady = true;
    wasmStatus.textContent = "WASM ready";
    wasmStatus.className = "status status-ready";
    connectButton.disabled = false;
    log("WASM bindings initialized");
  } catch (error) {
    wasmStatus.textContent = "WASM failed";
    wasmStatus.className = "status status-error";
    logError("Unable to initialize WASM bindings", error);
  }
}

async function connect(): Promise<void> {
  if (!wasmReady || app) return;

  setButtonBusy(connectButton, true, "Connecting…");
  try {
    const local = Name.fromString(localNameInput.value.trim());
    const token = tokenInput.value.trim() || undefined;

    const connectedApp = await App.connectWithSecret(
      endpointInput.value.trim(),
      token,
      local,
      secretInput.value,
      Direction.Bidirectional,
    );

    app = connectedApp;
    connectionStatus.textContent = `Connected · ${connectedApp.remoteConnectionId()}`;
    setConnectedControls(true);
    log(`Connected as ${connectedApp.name().toString()}`);
  } catch (error) {
    logError("Connection failed", error);
    await disconnect();
  } finally {
    setButtonBusy(connectButton, false, "Connect");
    connectButton.disabled = Boolean(app) || !wasmReady;
  }
}

async function createOutgoingSession(): Promise<void> {
  const currentApp = app;
  if (!currentApp || session) return;

  setButtonBusy(createSessionButton, true, "Creating…");
  listenButton.disabled = true;
  try {
    const group = sessionTypeInput.value === "group";
    const mlsEnabled = mlsEnabledInput.checked;
    const destination = Name.fromString(
      group ? groupNameInput.value.trim() : remoteNameInput.value.trim(),
    );
    const participants = group ? parseParticipants() : [destination];

    for (const participant of participants) {
      await currentApp.setRouteViaUpstreamAsync(participant);
      log(
        `Route to ${participant.toString()} installed through the upstream WebSocket`,
      );
    }

    const created = await currentApp.createSessionAndWaitAsync(
      {
        sessionType: group ? SessionType.Group : SessionType.PointToPoint,
        maxRetries: 10,
        interval: 1_000,
        metadata: new Map([
          ["example", "slim-wasm-browser-chat"],
          ["delivery-mode", group ? "multicast" : "unicast"],
          ["security", mlsEnabled ? "mls" : "plaintext"],
        ]),
        mlsSettings: mlsEnabled
          ? { headerIntegrityValidationPercent: 100 }
          : undefined,
      },
      destination,
    );

    attachSession(created, "Outgoing session established");

    if (group) {
      for (const participant of participants) {
        log(`Inviting ${participant.toString()}…`);
        await created.inviteAndWaitAsync(participant);
        log(`${participant.toString()} joined the multicast session`);
      }
      log(
        `Multicast session ready with ${participants.length} invited participant${participants.length === 1 ? "" : "s"}`,
      );
    }
  } catch (error) {
    logError("Unable to create or initialize the session", error);
    log("Check that every participant is connected and uses the same shared secret.");
  } finally {
    setButtonBusy(createSessionButton, false, "Create session");
    updateActionControls();
  }
}

function parseParticipants(): NameLike[] {
  const values = participantsInput.value
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error("Multicast sessions require at least one participant");
  }

  return [...new Set(values)].map((value) => Name.fromString(value));
}

async function listenForSession(): Promise<void> {
  const currentApp = app;
  if (!currentApp || listenController) return;

  const controller = new AbortController();
  listenController = controller;
  setButtonBusy(listenButton, true, "Waiting…");
  createSessionButton.disabled = true;
  sessionStatus.textContent = "Waiting for incoming session";
  log("Waiting for an incoming session");

  try {
    const incoming = await currentApp.listenForSessionAsync(undefined, {
      signal: controller.signal,
    });
    if (app === currentApp && !controller.signal.aborted) {
      attachSession(incoming, "Incoming session accepted");
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      logError("Incoming session listener failed", error);
      sessionStatus.textContent = "No session";
    }
  } finally {
    if (listenController === controller) listenController = undefined;
    setButtonBusy(listenButton, false, "Wait for incoming");
    updateActionControls();
  }
}

function attachSession(nextSession: SessionLike, message: string): void {
  receiveController?.abort();
  session = nextSession;
  const config = nextSession.config();
  const delivery =
    config.sessionType === SessionType.Group ? "Multicast" : "Unicast";
  const security = config.mlsSettings ? "MLS" : "No MLS";
  sessionStatus.textContent = `${delivery} · ${security}`;
  messageInput.disabled = false;
  sendButton.disabled = false;
  updateActionControls();
  clearEmptyState();
  log(
    `${message} (${delivery}, ${security}): ${nextSession.source().toString()} → ${nextSession.destination().toString()}`,
  );
  startReceiveLoop(nextSession);
  messageInput.focus();
}

function startReceiveLoop(currentSession: SessionLike): void {
  const controller = new AbortController();
  receiveController = controller;

  void (async () => {
    while (session === currentSession && !controller.signal.aborted) {
      try {
        const received = await currentSession.getMessageAsync(undefined, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) renderReceivedMessage(received);
      } catch (error) {
        if (!controller.signal.aborted) {
          logError("Message receive loop stopped", error);
          sessionStatus.textContent = "Session receive stopped";
        }
        return;
      }
    }
  })();
}

async function sendMessage(): Promise<void> {
  const currentSession = session;
  const text = messageInput.value.trim();
  if (!currentSession || !text) return;

  setButtonBusy(sendButton, true, "Sending…");
  try {
    await currentSession.publishAndWaitAsync(
      toArrayBuffer(textEncoder.encode(text)),
      "text/plain",
      new Map([["sent-by", localNameInput.value.trim()]]),
    );
    appendMessage("You", text, true);
    messageInput.value = "";
  } catch (error) {
    logError("Message publish failed", error);
  } finally {
    setButtonBusy(sendButton, false, "Send");
    sendButton.disabled = !session;
    messageInput.focus();
  }
}

function renderReceivedMessage(received: ReceivedMessage): void {
  const source = received.context.sourceName.toString();
  const text = textDecoder.decode(received.payload);
  appendMessage(source, text, false);
  log(`Received ${received.payload.byteLength} bytes from ${source}`);
}

async function closeSession(): Promise<void> {
  const currentApp = app;
  const currentSession = session;
  if (!currentApp || !currentSession) return;

  setButtonBusy(closeSessionButton, true, "Closing…");
  receiveController?.abort();
  receiveController = undefined;

  try {
    await currentApp.deleteSessionAndWaitAsync(currentSession);
    if (session === currentSession) {
      session = undefined;
      sessionStatus.textContent = "No session";
      messageInput.disabled = true;
      sendButton.disabled = true;
    }
    log("Session closed");
  } catch (error) {
    logError("Unable to close session", error);
    if (session === currentSession) startReceiveLoop(currentSession);
  } finally {
    setButtonBusy(closeSessionButton, false, "Close session");
    updateActionControls();
  }
}

async function disconnect(): Promise<void> {
  const currentApp = app;
  const currentSession = session;
  listenController?.abort();
  receiveController?.abort();
  listenController = undefined;
  receiveController = undefined;

  if (currentApp) {
    setButtonBusy(disconnectButton, true, "Disconnecting…");
    if (currentSession) {
      try {
        await currentApp.deleteSessionAndWaitAsync(currentSession);
        log("Session closed");
      } catch (error) {
        logError("Session cleanup failed", error);
      }
    }
    try {
      currentApp.disconnect();
      log("Disconnected from SLIM");
    } catch (error) {
      logError("Disconnect failed", error);
    }
  }
  session = undefined;
  app = undefined;
  connectionStatus.textContent = "Disconnected";
  sessionStatus.textContent = "No session";
  disconnectButton.textContent = "Disconnect";
  setConnectedControls(false);
}

function setConnectedControls(connected: boolean): void {
  connectButton.disabled = connected || !wasmReady;
  updateActionControls();
  messageInput.disabled = !connected || !session;
  sendButton.disabled = !connected || !session;
  scenarioPresetInput.disabled = connected;
  applyPresetButton.disabled = connected || scenarioPresetInput.value === "custom";

  for (const input of [
    endpointInput,
    tokenInput,
    localNameInput,
    secretInput,
  ]) {
    input.disabled = connected;
  }
}

function updateActionControls(): void {
  const connected = Boolean(app);
  const active = Boolean(session);
  const listening = Boolean(listenController);
  disconnectButton.disabled = !connected;
  listenButton.disabled = !connected || active || listening;
  createSessionButton.disabled = !connected || active || listening;
  closeSessionButton.disabled = !connected || !active;
}

function updateSessionMode(): void {
  const group = sessionTypeInput.value === "group";
  pointToPointFields.hidden = group;
  groupFields.hidden = !group;
  modeInstructions.innerHTML = group
    ? "Start every invited participant first, then create the multicast session. The browser acts as moderator and broadcasts each message to the group."
    : "On the remote participant choose <strong>Wait for incoming</strong>, then create the unicast session here.";
  updateSessionSummary();
}

function updatePresetDescription(): void {
  const preset = scenarioPresets[scenarioPresetInput.value];
  scenarioDescription.textContent = preset
    ? `${preset.description} Apply the preset, connect, then ${preset.action === "create" ? "create the session" : "wait for incoming"}.`
    : "Configure the fields manually, or select a repeatable demo role.";
  applyPresetButton.disabled = Boolean(app) || !preset;
}

function applyScenarioPreset(): void {
  if (app) return;
  const presetId = scenarioPresetInput.value;
  const preset = scenarioPresets[presetId];
  if (!preset) return;

  localNameInput.value = preset.localName;
  sessionTypeInput.value = preset.sessionType;
  if (preset.remoteName) remoteNameInput.value = preset.remoteName;
  if (preset.groupName) groupNameInput.value = preset.groupName;
  participantsInput.value = (preset.participants ?? []).join("\n");
  appliedPreset = presetId;
  updateSessionMode();
  updateRecommendedAction();
  log(`Applied scenario preset: ${scenarioPresetInput.selectedOptions[0]?.textContent?.trim()}`);
}

function markPresetCustom(): void {
  if (appliedPreset === "custom") return;
  appliedPreset = "custom";
  scenarioPresetInput.value = "custom";
  updatePresetDescription();
  updateRecommendedAction();
}

function updateRecommendedAction(): void {
  const action = scenarioPresets[appliedPreset]?.action;
  listenButton.classList.toggle("recommended", action === "listen");
  createSessionButton.classList.toggle("recommended", action === "create");
}

function updateSessionSummary(): void {
  const mls = mlsEnabledInput.checked ? "MLS enabled" : "MLS disabled";
  const preset = scenarioPresets[appliedPreset];
  const nextAction = preset
    ? ` Recommended action after connecting: ${preset.action === "create" ? "Create session" : "Wait for incoming"}.`
    : "";

  if (sessionTypeInput.value === "group") {
    const participantCount = participantsInput.value
      .split(/[\s,]+/)
      .filter(Boolean).length;
    sessionSummary.textContent = `Multicast channel ${groupNameInput.value.trim() || "<required>"} · ${mls} · ${participantCount} configured invitee${participantCount === 1 ? "" : "s"}.${nextAction}`;
  } else {
    sessionSummary.textContent = `Unicast to ${remoteNameInput.value.trim() || "<required>"} · ${mls}.${nextAction}`;
  }
}

function appendMessage(author: string, text: string, own: boolean): void {
  clearEmptyState();
  const item = document.createElement("article");
  item.className = `message-bubble${own ? " own-message" : ""}`;

  const heading = document.createElement("strong");
  heading.textContent = author;
  const body = document.createElement("p");
  body.textContent = text;

  item.append(heading, body);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function clearEmptyState(): void {
  messages.querySelector(".empty-state")?.remove();
}

function setButtonBusy(
  button: HTMLButtonElement,
  busy: boolean,
  label: string,
): void {
  button.textContent = label;
  button.disabled = busy;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function log(message: string): void {
  const time = new Date().toLocaleTimeString();
  logOutput.textContent += `[${time}] ${message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function logError(message: string, error: unknown): void {
  log(`${message}: ${formatError(error)}`);
  console.error(message, error);
}

function formatError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const uniffiError = error as {
      tag?: unknown;
      inner?: { message?: unknown };
    };
    if (typeof uniffiError.inner?.message === "string") {
      const tag =
        typeof uniffiError.tag === "string" ? `${uniffiError.tag}: ` : "";
      return `${tag}${uniffiError.inner.message}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}
