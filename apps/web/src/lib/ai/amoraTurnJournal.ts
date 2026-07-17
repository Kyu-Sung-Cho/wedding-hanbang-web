import type { ChatWithToolsResult, ToolCallBlock } from "@/lib/ai/openai";
import {
  canonicalAmoraToolInput,
  getAmoraToolOperationIdentity,
} from "@/lib/ai/amoraToolIdentity";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_CHECKPOINT_BYTES = 96 * 1024;
const MAX_OUTPUT_ITEMS = 8;
const MAX_TOOL_CALLS = 1;
const MAX_CALL_ID_LENGTH = 128;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export interface DurableAmoraToolCall extends ToolCallBlock {
  inputDigest: string;
  operationKey: string;
}

export interface AmoraToolRoundCheckpoint {
  version: 1;
  callIndex: number;
  phase: "tool_round";
  toolCalls: DurableAmoraToolCall[];
  outputItems: ChatWithToolsResult["outputItems"];
}

type AdminClient = ReturnType<typeof createAdminClient>;

export class AmoraTurnJournalError extends Error {
  readonly code = "AMORA_TURN_JOURNAL_UNAVAILABLE";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AmoraTurnJournalError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertReplayableOutputItems(
  outputItems: ChatWithToolsResult["outputItems"],
  toolCall: ToolCallBlock,
): void {
  if (!Array.isArray(outputItems) || outputItems.length < 1 || outputItems.length > MAX_OUTPUT_ITEMS) {
    throw new Error("[amora-journal] output item count is invalid");
  }

  let matchingFunctionCall = 0;
  for (const item of outputItems) {
    if (!isRecord(item) || !["message", "function_call", "reasoning"].includes(String(item.type))) {
      throw new Error("[amora-journal] output item type is invalid");
    }
    if (item.type === "reasoning") {
      if (typeof item.encrypted_content !== "string" || item.encrypted_content.length < 1) {
        throw new Error("[amora-journal] encrypted reasoning is required");
      }
      if (
        item.summary !== undefined
        && (!Array.isArray(item.summary) || item.summary.length > 0)
      ) {
        throw new Error("[amora-journal] plaintext reasoning summary is forbidden");
      }
      const allowedReasoningKeys = new Set([
        "type",
        "id",
        "summary",
        "encrypted_content",
        "status",
      ]);
      if (Object.keys(item).some((key) => !allowedReasoningKeys.has(key))) {
        throw new Error("[amora-journal] plaintext reasoning fields are forbidden");
      }
    }
    if (item.type === "function_call") {
      if (item.call_id !== toolCall.callId || item.name !== toolCall.name) {
        throw new Error("[amora-journal] unbound function call is forbidden");
      }
      matchingFunctionCall += 1;
      if (typeof item.arguments !== "string") {
        throw new Error("[amora-journal] function arguments are invalid");
      }
      if (!toolCall.parseError || toolCall.parseError !== "invalid_json") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(item.arguments);
        } catch {
          throw new Error("[amora-journal] function arguments are not replayable");
        }
        if (
          !isRecord(parsed)
          || canonicalAmoraToolInput(parsed)
            !== canonicalAmoraToolInput(toolCall.input)
        ) {
          throw new Error("[amora-journal] function call identity is inconsistent");
        }
      }
    }
  }
  if (matchingFunctionCall !== 1) {
    throw new Error("[amora-journal] exact function call output is required");
  }
}

function assertToolCall(toolCall: ToolCallBlock): void {
  if (
    typeof toolCall.callId !== "string"
    || toolCall.callId.length < 1
    || toolCall.callId.length > MAX_CALL_ID_LENGTH
    || !TOOL_NAME_PATTERN.test(toolCall.name)
    || !isRecord(toolCall.input)
    || (
      toolCall.parseError !== undefined
      && !["invalid_json", "invalid_shape", "schema_validation"].includes(toolCall.parseError)
    )
  ) {
    throw new Error("[amora-journal] tool call is invalid");
  }
}

export function buildAmoraToolRoundCheckpoint(
  callIndex: number,
  result: Pick<ChatWithToolsResult, "fullText" | "toolCalls" | "outputItems">,
): AmoraToolRoundCheckpoint {
  if (!Number.isSafeInteger(callIndex) || callIndex < 1 || callIndex > 2) {
    throw new Error("[amora-journal] call index is invalid");
  }
  if (!Array.isArray(result.toolCalls) || result.toolCalls.length !== MAX_TOOL_CALLS) {
    throw new Error("[amora-journal] exactly one tool call is required");
  }
  const toolCall = result.toolCalls[0]!;
  assertToolCall(toolCall);
  assertReplayableOutputItems(result.outputItems, toolCall);

  const { inputDigest, operationKey } = getAmoraToolOperationIdentity(
    toolCall.name,
    toolCall.input,
  );
  const checkpoint: AmoraToolRoundCheckpoint = {
    version: 1,
    callIndex,
    phase: "tool_round",
    toolCalls: [{ ...toolCall, inputDigest, operationKey }],
    outputItems: result.outputItems,
  };
  if (byteLength(checkpoint) > MAX_CHECKPOINT_BYTES) {
    throw new Error("[amora-journal] checkpoint is too large");
  }
  return checkpoint;
}

export function parseAmoraToolRoundCheckpoint(
  value: unknown,
): AmoraToolRoundCheckpoint | null {
  if (!isRecord(value) || value.version !== 1 || value.phase !== "tool_round") return null;
  const toolCalls = value.toolCalls;
  if (!Array.isArray(toolCalls) || toolCalls.length !== 1) return null;
  const rawToolCall = toolCalls[0];
  if (!isRecord(rawToolCall)) return null;
  const toolCall: ToolCallBlock = {
    callId: rawToolCall.callId as string,
    name: rawToolCall.name as string,
    input: rawToolCall.input as Record<string, unknown>,
    ...(rawToolCall.parseError === undefined
      ? {}
      : { parseError: rawToolCall.parseError as ToolCallBlock["parseError"] }),
  };
  try {
    const checkpoint = buildAmoraToolRoundCheckpoint(value.callIndex as number, {
      fullText: "",
      toolCalls: [toolCall],
      outputItems: value.outputItems as ChatWithToolsResult["outputItems"],
    });
    if (
      rawToolCall.inputDigest !== checkpoint.toolCalls[0]?.inputDigest
      || rawToolCall.operationKey !== checkpoint.toolCalls[0]?.operationKey
      || !DIGEST_PATTERN.test(String(rawToolCall.inputDigest))
      || !DIGEST_PATTERN.test(String(rawToolCall.operationKey))
    ) return null;
    return checkpoint;
  } catch {
    return null;
  }
}

export function parseAmoraTurnJournal(value: unknown): AmoraToolRoundCheckpoint[] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const checkpoints = value.map(parseAmoraToolRoundCheckpoint);
  if (checkpoints.some((checkpoint) => checkpoint === null)) return null;
  const parsed = checkpoints as AmoraToolRoundCheckpoint[];
  if (parsed.some((checkpoint, index) => checkpoint.callIndex !== index + 1)) return null;
  return parsed;
}

export async function loadAmoraToolRoundJournal(
  params: { coupleId: string; requestKey: string; attemptCount: number },
  admin: AdminClient = createAdminClient(),
): Promise<AmoraToolRoundCheckpoint[]> {
  if (!Number.isSafeInteger(params.attemptCount) || params.attemptCount < 1) {
    throw new AmoraTurnJournalError("Chat claim generation is invalid");
  }
  const { data, error } = await admin.rpc("get_amora_tool_round_journal", {
    p_couple_id: params.coupleId,
    p_request_key: params.requestKey,
    p_attempt_count: params.attemptCount,
  });
  if (error || !isRecord(data) || data.action !== "loaded") {
    throw new AmoraTurnJournalError(
      data && isRecord(data) && data.action === "expired"
        ? "Tool-round recovery window expired"
        : "Tool-round journal could not be loaded",
      { cause: error },
    );
  }
  const journal = parseAmoraTurnJournal(data.journal);
  if (!journal) {
    throw new AmoraTurnJournalError("Tool-round journal is invalid");
  }
  return journal;
}
