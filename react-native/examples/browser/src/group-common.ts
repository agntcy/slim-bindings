// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

import type { SessionLike } from "@agntcy/slim-bindings-react-native/web";

import type { ExampleUi } from "./ui";

export async function refreshParticipants(
  ui: ExampleUi,
  currentSession: SessionLike,
): Promise<void> {
  try {
    const participants = await currentSession.participantsListAsync();
    ui.renderParticipants(
      participants.map((participant) => participant.toString()),
    );
  } catch (error) {
    ui.logError("Failed to list participants", error);
  }
}

export function startParticipantPolling(
  ui: ExampleUi,
  getSession: () => SessionLike | undefined,
  stopWhen: () => boolean,
): () => void {
  const timer = window.setInterval(() => {
    const currentSession = getSession();
    if (!currentSession || stopWhen()) return;
    void refreshParticipants(ui, currentSession);
  }, 3_000);

  return () => window.clearInterval(timer);
}

export function logSessionSecurity(ui: ExampleUi, session: SessionLike): void {
  const security = session.config().mlsSettings ? "MLS" : "No MLS";
  ui.log(`Session security: ${security}`);
}
