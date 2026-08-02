import { composeAmoraPersistenceTerminal } from "./amoraPersistenceClaims";

const STRUCTURED_OUTPUT_MARKER_RE =
  /(?:\[\/?(?:suggestions?|pending_action|mediation)\b|\[추천(?:\s*(?:질문|대화))?\s*\])/iu;
const COMPLETE_SENTENCE_RE = /[.!?。！？]["'”’）)\]]*(?=\s|$)/u;

export type AmoraProviderPreviewGate = {
  push: (delta: string) => void;
  matchesTerminal: (terminalText: string) => boolean;
};

/**
 * Provider deltas are previews, not trusted completion evidence. Emit only
 * complete, claim-safe sentences. Structured UI markers and unfinished text
 * stay buffered until the server has parsed and reconciled the terminal turn.
 */
export function createAmoraProviderPreviewGate(
  emit: (safeDelta: string) => void,
): AmoraProviderPreviewGate {
  let pending = "";
  let emitted = "";
  let structuredOutputSeen = false;
  let contentSuppressed = false;

  const push = (delta: string) => {
    if (!delta || structuredOutputSeen) return;
    pending += delta;

    if (STRUCTURED_OUTPUT_MARKER_RE.test(pending)) {
      structuredOutputSeen = true;
      return;
    }

    while (pending) {
      const boundary = pending.match(COMPLETE_SENTENCE_RE);
      if (!boundary || boundary.index === undefined) return;

      const end = boundary.index + boundary[0].length;
      const sentence = pending.slice(0, end);
      pending = pending.slice(end);

      const screened = composeAmoraPersistenceTerminal({
        text: sentence,
        toolResults: [],
        hasPendingAction: false,
        persistenceMode: "durable",
      });
      if (screened.source !== "provider") {
        contentSuppressed = true;
        continue;
      }

      emitted += sentence;
      emit(sentence);
    }
  };

  return {
    push,
    matchesTerminal: (terminalText) =>
      !structuredOutputSeen
      && !contentSuppressed
      && pending.trim() === ""
      && emitted.trim() === terminalText.trim(),
  };
}
