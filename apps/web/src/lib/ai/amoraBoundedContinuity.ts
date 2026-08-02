import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

export const AMORA_W3_PRIOR_USER_MAX_CHARS = 800;
export const AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS = 1_200;

const EXPLICIT_W3_REFERENCE_PATTERN =
  /(?:그것|그거|그게|그걸|그 일|그 문제|그 얘기|그 말|아까|방금|앞에서\s*말한|그래서|그 때문에)/u;

export type AmoraBoundedContinuityRow = {
  id: string;
  sender_id: string | null;
  sender_type: "bride" | "groom" | "ai";
  role: "user" | "assistant";
  content: string;
  metadata: {
    target?: string;
    in_reply_to_user_message_id?: unknown;
  } | null;
  visibility: "shared" | "bride_private" | "groom_private";
  segment_id?: string | null;
};

export type AmoraBoundedContinuityMessage = {
  role: "user" | "assistant";
  content: string;
};

export function hasExplicitAmoraW3ContinuityReference(text: string): boolean {
  return EXPLICIT_W3_REFERENCE_PATTERN.test(text.normalize("NFKC"));
}

function boundFromStart(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join("");
}

/**
 * Carries exactly one server-linked exchange into an otherwise current-only
 * W3 turn. Any ambiguity returns null, preserving the safer one-message path.
 */
export function buildAmoraBoundedW3Continuity(input: {
  /** Exact database order: newest row first, as returned by the route query. */
  newestFirstRows: readonly AmoraBoundedContinuityRow[];
  currentMessageId: string;
  currentUserText: string;
  requesterUserId: string;
  visibility: AmoraBoundedContinuityRow["visibility"];
  segmentId: string;
}): AmoraBoundedContinuityMessage[] | null {
  if (
    input.newestFirstRows.length !== 3
    || !hasExplicitAmoraW3ContinuityReference(input.currentUserText)
  ) {
    return null;
  }

  const [current, assistant, priorUser] = input.newestFirstRows;
  if (!current || !assistant || !priorUser) return null;
  if (new Set([current.id, assistant.id, priorUser.id]).size !== 3) return null;

  const rows = [current, assistant, priorUser];
  if (
    rows.some((row) =>
      row.visibility !== input.visibility
      || row.segment_id !== input.segmentId
      || row.metadata?.target === "partner"
    )
    || current.id !== input.currentMessageId
    || current.content !== input.currentUserText
    || current.role !== "user"
    || current.sender_type === "ai"
    || current.sender_id !== input.requesterUserId
    || assistant.role !== "assistant"
    || assistant.sender_type !== "ai"
    || priorUser.role !== "user"
    || priorUser.sender_type === "ai"
    || priorUser.sender_id !== input.requesterUserId
    || assistant.metadata?.in_reply_to_user_message_id !== priorUser.id
  ) {
    return null;
  }

  const priorScope = classifyAmoraQuestionScope({
    userText: priorUser.content,
  }).scope;
  if (
    priorScope !== "W0_wedding_core"
    && priorScope !== "W1_wedding_adjacent"
  ) {
    return null;
  }

  return [
    {
      role: "user",
      content: boundFromStart(
        priorUser.content,
        AMORA_W3_PRIOR_USER_MAX_CHARS,
      ),
    },
    {
      role: "assistant",
      content: boundFromStart(
        assistant.content,
        AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS,
      ),
    },
    { role: "user", content: current.content },
  ];
}
