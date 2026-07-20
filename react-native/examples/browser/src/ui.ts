// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal shared UI helpers for browser reference examples.
 */

import { describeError, initializeWasm } from "./common";

export type ExampleUi = {
  wasmStatus: HTMLDivElement;
  connectionStatus: HTMLDivElement;
  sessionStatus: HTMLDivElement;
  startButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  messageInput: HTMLInputElement;
  sendButton: HTMLButtonElement;
  messages: HTMLDivElement;
  logOutput: HTMLPreElement;
  configList: HTMLDListElement;
  log: (message: string) => void;
  logError: (message: string, error: unknown) => void;
  setConnectionStatus: (text: string) => void;
  setSessionStatus: (text: string) => void;
  appendMessage: (author: string, text: string, own?: boolean) => void;
  setRunning: (running: boolean) => void;
  renderConfig: (entries: Record<string, string>) => void;
};

export function bindExampleUi(): ExampleUi {
  const wasmStatus = element<HTMLDivElement>("wasm-status");
  const connectionStatus = element<HTMLDivElement>("connection-status");
  const sessionStatus = element<HTMLDivElement>("session-status");
  const startButton = element<HTMLButtonElement>("start");
  const stopButton = element<HTMLButtonElement>("stop");
  const messageInput = element<HTMLInputElement>("message");
  const sendButton = element<HTMLButtonElement>("send");
  const messages = element<HTMLDivElement>("messages");
  const logOutput = element<HTMLPreElement>("log");
  const configList = element<HTMLDListElement>("config");
  const clearLogButton = element<HTMLButtonElement>("clear-log");

  clearLogButton.addEventListener("click", () => {
    logOutput.textContent = "";
  });

  const ui: ExampleUi = {
    wasmStatus,
    connectionStatus,
    sessionStatus,
    startButton,
    stopButton,
    messageInput,
    sendButton,
    messages,
    logOutput,
    configList,
    log: (message) => appendLog(logOutput, message),
    logError: (message, error) => {
      appendLog(logOutput, `${message}: ${describeError(error)}`);
      console.error(message, error);
    },
    setConnectionStatus: (text) => {
      connectionStatus.textContent = text;
    },
    setSessionStatus: (text) => {
      sessionStatus.textContent = text;
    },
    appendMessage: (author, text, own = false) =>
      appendMessageBubble(messages, author, text, own),
    setRunning: (running) => {
      startButton.disabled = running;
      stopButton.disabled = !running;
      messageInput.disabled = !running;
      sendButton.disabled = !running;
    },
    renderConfig: (entries) => renderConfigList(configList, entries),
  };

  return ui;
}

export async function prepareWasm(ui: ExampleUi): Promise<void> {
  try {
    await initializeWasm();
    ui.wasmStatus.textContent = "WASM ready";
    ui.wasmStatus.className = "status status-ready";
    ui.startButton.disabled = false;
    ui.log("WASM bindings initialized");
  } catch (error) {
    ui.wasmStatus.textContent = "WASM failed";
    ui.wasmStatus.className = "status status-error";
    ui.logError("Unable to initialize WASM bindings", error);
  }
}

function renderConfigList(
  list: HTMLDListElement,
  entries: Record<string, string>,
): void {
  list.replaceChildren();
  for (const [key, value] of Object.entries(entries)) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }
}

function appendMessageBubble(
  container: HTMLDivElement,
  author: string,
  text: string,
  own: boolean,
): void {
  container.querySelector(".empty-state")?.remove();

  const item = document.createElement("article");
  item.className = `message-bubble${own ? " own-message" : ""}`;

  const heading = document.createElement("strong");
  heading.textContent = author;
  const body = document.createElement("p");
  body.textContent = text;

  item.append(heading, body);
  container.append(item);
  container.scrollTop = container.scrollHeight;
}

function appendLog(output: HTMLPreElement, message: string): void {
  const time = new Date().toLocaleTimeString();
  output.textContent += `[${time}] ${message}\n`;
  output.scrollTop = output.scrollHeight;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}
