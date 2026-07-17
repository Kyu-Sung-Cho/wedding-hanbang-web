/**
 * Per-provider-call cost/latency envelope for the main Amora chat loop.
 *
 * OpenAI exposes an exact input-token count endpoint. We deliberately require
 * that count for every generation input instead of treating a local character
 * estimate as authoritative: provider serialization, tool schemas, images, and
 * PDFs can all change the final token count.
 */
export const AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL = 64_000;
export const AMORA_MAX_OUTPUT_TOKENS_PER_PROVIDER_CALL = 800;
export const AMORA_MAX_TOOL_ROUNDS = 2;
export const AMORA_MAX_PROVIDER_CALLS_PER_TURN = AMORA_MAX_TOOL_ROUNDS + 1;
export const OPENAI_LONG_CONTEXT_SURCHARGE_THRESHOLD = 272_000;
export const AMORA_TOTAL_REQUEST_DEADLINE_MS = 170_000;
// Exact provider counting remains authoritative. These local budgets keep a
// long-running user from becoming permanently trapped above that hard limit.
export const AMORA_MAX_CONVERSATION_CHARS = 32_000;
export const AMORA_MAX_TEXT_ATTACHMENT_CHARS = 24_000;
export const AMORA_MAX_TOOL_RESULT_CHARS = 16_000;
export const AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN = 32_000;
export const AMORA_MAX_TOOL_CALLS_PER_TURN = 8;

/** Conservative cache-write bound for one paid provider call, in micro-USD. */
export const AMORA_MAX_PROVIDER_CALL_COST_MICROUSD_BY_ROLE = {
  fast: 84_800,
  primary: 212_000,
} as const;

/**
 * Atomic daily-budget reservation for one main-chat turn. A chat turn can make
 * at most three paid calls, so reserve the corresponding three-call envelope.
 */
export const AMORA_MAX_TURN_COST_MICROUSD_BY_ROLE = {
  fast: AMORA_MAX_PROVIDER_CALL_COST_MICROUSD_BY_ROLE.fast
    * AMORA_MAX_PROVIDER_CALLS_PER_TURN,
  primary: AMORA_MAX_PROVIDER_CALL_COST_MICROUSD_BY_ROLE.primary
    * AMORA_MAX_PROVIDER_CALLS_PER_TURN,
} as const;

export function getAmoraProviderCallCostReservationMicrousd(
  role: keyof typeof AMORA_MAX_PROVIDER_CALL_COST_MICROUSD_BY_ROLE,
): number {
  return AMORA_MAX_PROVIDER_CALL_COST_MICROUSD_BY_ROLE[role];
}

export function getAmoraTurnCostReservationMicrousd(
  role: keyof typeof AMORA_MAX_TURN_COST_MICROUSD_BY_ROLE,
): number {
  return AMORA_MAX_TURN_COST_MICROUSD_BY_ROLE[role];
}

/**
 * Old fire-and-forget model writers are intentionally disconnected in V2.
 * Keep a runtime paid-call fence in addition to their absent call sites so an
 * accidental import cannot silently bypass the atomic cost ledger.
 */
export function blockLegacyAuxiliaryProviderGeneration(): never {
  throw new Error("LEGACY_AUXILIARY_PROVIDER_DISABLED");
}

export function takeRecentAmoraConversation<T extends { content: string }>(
  messages: readonly T[],
): T[] {
  const selected: T[] = [];
  let remaining = AMORA_MAX_CONVERSATION_CHARS;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.content.length <= remaining) {
      selected.unshift(message);
      remaining -= message.content.length;
      continue;
    }

    const marker = "[이전 메시지 앞부분 생략]\n";
    if (remaining >= marker.length + 256) {
      selected.unshift({
        ...message,
        content: marker + message.content.slice(-(remaining - marker.length)),
      });
    }
    break;
  }

  return selected;
}

export function boundAmoraTextAttachments(texts: readonly string[]): string {
  const combined = texts.join("\n\n");
  if (combined.length <= AMORA_MAX_TEXT_ATTACHMENT_CHARS) return combined;

  const marker = "\n\n[긴 첨부문서의 중간 일부 생략]\n\n";
  const available = AMORA_MAX_TEXT_ATTACHMENT_CHARS - marker.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return combined.slice(0, headLength) + marker + combined.slice(-tailLength);
}

export function boundAmoraToolResultJson(
  value: unknown,
  maxChars = AMORA_MAX_TOOL_RESULT_CHARS,
): string {
  const safeMax = Number.isSafeInteger(maxChars) && maxChars >= 512
    ? Math.min(maxChars, AMORA_MAX_TOOL_RESULT_CHARS)
    : 512;
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = JSON.stringify({
      error_code: "TOOL_RESULT_NOT_SERIALIZABLE",
    });
  }
  if (serialized.length <= safeMax) return serialized;

  const marker = "[도구 결과가 길어 중간 일부 생략]";
  // JSON-encode previews again so arbitrary quotes/control characters cannot
  // break the function-call-output envelope.
  let previewBudget = Math.max(64, Math.floor((safeMax - 180) / 2));
  let bounded = JSON.stringify({
    truncated: true,
    notice: marker,
    preview_head: serialized.slice(0, previewBudget),
    preview_tail: serialized.slice(-previewBudget),
  });
  while (bounded.length > safeMax && previewBudget > 64) {
    const shrinkBy = Math.max(1, Math.ceil((bounded.length - safeMax) / 2));
    const nextBudget = Math.max(64, previewBudget - shrinkBy);
    previewBudget = nextBudget;
    bounded = JSON.stringify({
      truncated: true,
      notice: marker,
      preview_head: serialized.slice(0, nextBudget),
      preview_tail: serialized.slice(-nextBudget),
    });
    if (nextBudget === 64) break;
  }
  return bounded;
}

export interface AmoraProviderRequestPolicy {
  maxInputTokens: number;
  maxOutputTokens: number;
  exactInputCountRequired: true;
}

export function getAmoraProviderRequestPolicy(
  providerCallIndex: number,
): AmoraProviderRequestPolicy {
  if (
    !Number.isSafeInteger(providerCallIndex)
    || providerCallIndex < 1
    || providerCallIndex > AMORA_MAX_PROVIDER_CALLS_PER_TURN
  ) {
    throw new Error(
      `[amora-policy] providerCallIndex must be between 1 and ${AMORA_MAX_PROVIDER_CALLS_PER_TURN}`,
    );
  }
  return {
    maxInputTokens: AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
    maxOutputTokens: AMORA_MAX_OUTPUT_TOKENS_PER_PROVIDER_CALL,
    exactInputCountRequired: true,
  };
}
