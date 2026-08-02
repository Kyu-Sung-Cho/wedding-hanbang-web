// AI 채팅 (아모라) + 파트너 메시지 — 웹과 동일 chat_messages 연동
// 신부=분홍(#F5E6DF), 신랑=파랑(#E8EDF5), AI=noir
import { useState, useRef, useEffect, useCallback, useMemo, type SetStateAction } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { Check, Send, ShieldCheck, Sparkles, Heart, X, Lock, RotateCcw, Users } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import type {
  BudgetImpactPreview,
  BudgetImpactWarning,
} from "@hanbang/shared";
import {
  createEmptyAmoraChatLaneRecord,
  resolveAmoraChatLane,
  updateAmoraChatLaneRecord,
  type AmoraChatLane,
  type AmoraChatLaneRecord,
  type AmoraChatTarget,
} from "@hanbang/shared/chat-lane";
import {
  buildUnmatchedAmoraCrisisRecoveryCard,
  isAmoraCrisisRecoveryCardId,
} from "@hanbang/shared/amora-crisis-recovery";
import { supabase } from "@/lib/supabase";
import { normalizeMediationBlock } from "@/lib/amoraMediation";
import { createChatSessionGenerationGuard } from "@/lib/chatSessionGeneration";
import {
  getAmoraActionApprovalPolicy,
  getPendingAmoraAction,
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  getSharedActionApprovalPresentation,
  parseSharedActionApplicationClaim,
  parseSharedActionApprovalStatus,
  type PendingActionDisabledReason,
  type SharedActionApplicationClaim,
  type SharedActionApprovalStatus,
} from "@/lib/pendingAmoraAction";
import {
  chatVisibilityForScope,
  isMessageInAiContext,
  isMessageInChatScope,
  selectChatScope,
  type ChatScope,
} from "@/lib/chatPrivacyScope";
import { PlaceCards } from "@/components/chat/PlaceCards";
import { EmptyState, IconBadge, StatusPill } from "@/components/ui/AppUI";
import AmoraMediationCard from "@/components/chat/AmoraMediationCard";

const API_BASE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";
const CHAT_REQUEST_TIMEOUT_MS = 180_000;
const PARTNER_CONNECTION_CHANGED_NOTICE =
  "상대방 연결 상태가 바뀌어 메시지를 보내지 않았어요. 잘못 전달되지 않도록 작성 중인 초안은 삭제했어요.";
const NEW_CHAT_MESSAGE_REQUIRED_NOTICE =
  "같은 요청을 다시 보내도 해결되지 않아요. 내용을 확인한 뒤 새 메시지로 보내주세요.";

interface ToolExecutionResult {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown>;
  success: boolean;
  displayMessage: string;
}

interface ChatMessageMetadata {
  target?: string;
  client_request_id?: string;
  partner_recipient_id?: string;
  client_visible_request_id?: string;
  mediation?: unknown;
  pending_amora_action?: unknown;
  pending_amora_action_journey_revision?: unknown;
  pending_amora_action_impact_preview?: unknown;
  confirmed_amora_action_id?: string;
  in_reply_to_user_message_id?: string;
  toolResults?: ToolExecutionResult[];
  [key: string]: unknown;
}

type ChatMessageVisibility = "shared" | "bride_private" | "groom_private";
type ViewerRole = "bride" | "groom" | null;

interface ChatMessage {
  id: string;
  couple_id: string;
  sender_id: string | null;
  role: "user" | "assistant";
  sender_type: "bride" | "groom" | "ai";
  content: string;
  metadata?: ChatMessageMetadata | null;
  created_at?: string;
  visibility: ChatMessageVisibility;
}

type MessageTarget = AmoraChatTarget;
type ChatApiMessage = Pick<ChatMessage, "role" | "content">;

interface ChatRequestBody {
  messages: ChatApiMessage[];
  coupleId: string;
  senderName: string;
  clientRequestId: string;
  userMessageId: string;
  visibility: ChatMessageVisibility;
  confirmedActionId?: string;
}

interface AiDraft {
  text: string;
  clientRequestId: string;
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  senderName: string;
  context: ChatApiMessage[];
  visibility: ChatMessageVisibility;
  sessionGeneration: number;
  confirmedActionId?: string;
  amoraSourceMessageId?: string;
}

interface AiRequest {
  body: ChatRequestBody;
  tempId: string;
  serverRequestKey: string;
  lane: Exclude<AmoraChatLane, "shared_partner">;
  sessionGeneration: number;
}

interface PartnerDraft {
  text: string;
  clientRequestId: string;
  partnerRecipientId: string;
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  visibility: "shared";
  sessionGeneration: number;
}

type SendFailure =
  | { kind: "partner_insert"; message: string; draft: PartnerDraft }
  | { kind: "ai_insert"; message: string; draft: AiDraft }
  | {
      kind: "ai_response";
      message: string;
      request: AiRequest;
      canRetry: boolean;
      unavailableReason: string | null;
    };

type PartnerRecipientVerification = "verified" | "unlinked" | "unavailable";

function aiLaneForVisibility(
  visibility: ChatMessageVisibility,
): Exclude<AmoraChatLane, "shared_partner"> {
  return visibility === "shared" ? "shared_ai" : "private_ai";
}

async function verifyPartnerDraftRecipient(
  draft: PartnerDraft,
): Promise<PartnerRecipientVerification> {
  const [
    { data: couple, error: coupleError },
    { data: partner, error: partnerError },
  ] = await Promise.all([
    supabase.from("couples")
      .select("bride_id, groom_id")
      .eq("id", draft.coupleId)
      .maybeSingle(),
    supabase.from("couple_profile_directory")
      .select("id")
      .eq("couple_id", draft.coupleId)
      .eq("id", draft.partnerRecipientId)
      .maybeSingle(),
  ]);

  if (coupleError || partnerError) return "unavailable";
  if (!couple || !partner) return "unlinked";

  const expectedSelfId = draft.senderType === "bride"
    ? couple.bride_id
    : couple.groom_id;
  const expectedPartnerId = draft.senderType === "bride"
    ? couple.groom_id
    : couple.bride_id;
  const rosterIsValid = Boolean(
    couple.bride_id
    && couple.groom_id
    && couple.bride_id !== couple.groom_id
    && expectedSelfId === draft.userId
    && expectedPartnerId === draft.partnerRecipientId
    && partner.id === draft.partnerRecipientId,
  );

  return rosterIsValid ? "verified" : "unlinked";
}

type ChatStreamEvent = {
  type?: string;
  code?: unknown;
  retryable?: unknown;
  retryPolicy?: unknown;
  content?: unknown;
  fullContent?: unknown;
  text?: unknown;
  chunk?: unknown;
  message?: unknown;
  remaining?: unknown;
  metadata?: unknown;
  delta?: { text?: unknown };
  result?: unknown;
};

type ChatStreamState = {
  streamed: string;
  completed: string | null;
  error: boolean;
  toolResults: ToolExecutionResult[];
  metadata: ChatMessageMetadata | null;
  failure: {
    serverCode: string | null;
    retryable: boolean;
    retryPolicy: "same_request" | "new_message" | null;
  } | null;
};

interface ChatStreamCompletion {
  text: string;
  toolResults: ToolExecutionResult[];
  metadata: ChatMessageMetadata | null;
}

type AmoraSharedActionMethod = "GET" | "POST" | "DELETE" | "PUT";

interface PendingActionApprovalState {
  actionId: string;
  messageId: string;
  status: SharedActionApprovalStatus | null;
  error: string | null;
  mutation: "confirm" | "withdraw" | null;
}

type ChatStreamUpdateCallback = (
  text: string,
  toolResults: ToolExecutionResult[],
  metadata: ChatMessageMetadata | null,
) => void;

class ChatTransportError extends Error {
  constructor(
    public readonly code: "AUTH" | "CANCELLED" | "EMPTY" | "HTTP" | "NETWORK" | "STREAM" | "TIMEOUT",
    public readonly status?: number,
    streamFailure?: {
      serverCode: string | null;
      retryable: boolean;
      retryPolicy: "same_request" | "new_message" | null;
    },
  ) {
    super(code);
    this.name = "ChatTransportError";
    this.serverCode = streamFailure?.serverCode ?? null;
    this.retryable = streamFailure?.retryable ?? null;
    this.retryPolicy = streamFailure?.retryPolicy ?? null;
  }

  public readonly serverCode: string | null;
  public readonly retryable: boolean | null;
  public readonly retryPolicy: "same_request" | "new_message" | null;
}

class AmoraSharedActionRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "AmoraSharedActionRequestError";
  }
}

function normalizeChatVisibility(value: unknown): ChatMessageVisibility | null {
  return value === "shared" || value === "bride_private" || value === "groom_private"
    ? value
    : null;
}

function chatMessageFromRealtimeRow(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const visibility = normalizeChatVisibility(row.visibility);
  const validRole = row.role === "user" || row.role === "assistant";
  const validSender = row.sender_type === "bride"
    || row.sender_type === "groom"
    || row.sender_type === "ai";
  if (
    typeof row.id !== "string"
    || typeof row.couple_id !== "string"
    || (row.sender_id !== null && typeof row.sender_id !== "string")
    || !validRole
    || !validSender
    || typeof row.content !== "string"
    || typeof row.created_at !== "string"
    || !visibility
  ) return null;

  const metadata = asChatMessageMetadata(row.metadata);
  return {
    id: row.id,
    couple_id: row.couple_id,
    sender_id: row.sender_id,
    role: row.role as ChatMessage["role"],
    sender_type: row.sender_type as ChatMessage["sender_type"],
    content: row.content,
    metadata,
    created_at: row.created_at,
    visibility,
  };
}

function canViewerSeeChatMessage(message: ChatMessage, viewerRole: ViewerRole): boolean {
  if (message.visibility === "shared") return true;
  return viewerRole !== null && message.visibility === `${viewerRole}_private`;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asToolExecutionResult(value: unknown): ToolExecutionResult | null {
  if (!isRecord(value) || typeof value.toolName !== "string" || typeof value.success !== "boolean") {
    return null;
  }
  return {
    toolName: value.toolName,
    toolInput: isRecord(value.toolInput) ? value.toolInput : {},
    toolOutput: isRecord(value.toolOutput) ? value.toolOutput : {},
    success: value.success,
    displayMessage: typeof value.displayMessage === "string" ? value.displayMessage : "",
  };
}

function mergeToolResults(
  current: ToolExecutionResult[],
  incoming: ToolExecutionResult[],
): ToolExecutionResult[] {
  const seen = new Set(current.map((result) => JSON.stringify(result)));
  const merged = [...current];
  for (const result of incoming) {
    const key = JSON.stringify(result);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
  }
  return merged;
}

function asChatMessageMetadata(value: unknown): ChatMessageMetadata | null {
  if (!isRecord(value)) return null;
  const toolResults = Array.isArray(value.toolResults)
    ? value.toolResults
      .map(asToolExecutionResult)
      .filter((result): result is ToolExecutionResult =>
        result !== null && result.toolName !== "search_nearby_places"
      )
    : undefined;
  return {
    ...value,
    ...(toolResults ? { toolResults } : {}),
  } as ChatMessageMetadata;
}

function asChatStreamEvent(value: unknown): ChatStreamEvent | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ChatStreamEvent
    : null;
}

function reconcileMobileAmoraCrisisRecovery(
  messages: readonly ChatMessage[],
  userId: string,
  coupleId: string,
  viewerRole: ViewerRole,
): ChatMessage[] {
  const canonicalMessages = messages.filter(
    (message) => !isAmoraCrisisRecoveryCardId(message.id),
  );
  if (!viewerRole || !userId || !coupleId) return [...canonicalMessages];

  const card = buildUnmatchedAmoraCrisisRecoveryCard(
    canonicalMessages.map((message) => ({
      id: message.id,
      coupleId: message.couple_id,
      senderId: message.sender_id,
      senderRole: message.sender_type,
      role: message.role,
      content: message.content,
      visibility: message.visibility,
      target: message.metadata?.target === "partner"
        ? "partner"
        : message.metadata?.target === "ai"
          ? "ai"
          : null,
      createdAt: message.created_at ?? "",
      inReplyToUserMessageId:
        message.metadata?.in_reply_to_user_message_id ?? null,
    })),
    { userId, coupleId, role: viewerRole },
  );
  if (!card) return [...canonicalMessages];

  return [
    ...canonicalMessages,
    {
      id: card.id,
      couple_id: coupleId,
      sender_id: null,
      role: "assistant",
      sender_type: "ai",
      content: card.content,
      metadata: card.metadata,
      created_at: card.createdAt,
      visibility: card.visibility,
    },
  ];
}

function applyChatEvent(
  event: ChatStreamEvent,
  state: ChatStreamState,
): boolean {
  if (event.type === "error") {
    const retryPolicy = event.retryPolicy === "same_request"
      || event.retryPolicy === "new_message"
      ? event.retryPolicy
      : null;
    state.streamed = "";
    state.completed = null;
    state.error = true;
    state.failure = {
      serverCode: typeof event.code === "string" && event.code.length > 0
        ? event.code
        : null,
      retryable: retryPolicy === "same_request"
        ? true
        : retryPolicy === "new_message"
          ? false
          : event.retryable === true,
      retryPolicy,
    };
    return false;
  }

  if (event.type === "text_clear") {
    state.streamed = "";
    state.completed = null;
    return true;
  }

  if (event.type === "tool_result") {
    const result = asToolExecutionResult(event.result);
    if (!result) return false;
    state.toolResults = mergeToolResults(state.toolResults, [result]);
    return true;
  }

  if (event.type === "done") {
    state.completed = nonEmptyString(event.fullContent)
      ?? nonEmptyString(event.content)
      ?? nonEmptyString(event.text)
      ?? state.streamed;
    const metadata = asChatMessageMetadata(event.metadata);
    if (metadata) {
      state.toolResults = mergeToolResults(state.toolResults, metadata.toolResults ?? []);
      state.metadata = { ...metadata, toolResults: state.toolResults };
    }
    return true;
  }

  const delta = event.type === "text_delta"
    ? nonEmptyString(event.content)
    : event.type === "content_block_delta"
      ? nonEmptyString(event.delta?.text)
      : nonEmptyString(event.text) ?? nonEmptyString(event.chunk);

  if (!delta) return false;
  state.streamed += delta;
  return true;
}

function cleanAiText(value: string, final: boolean): string {
  const withoutSuggestions = value.replace(
    /\[suggestions\][\s\S]*?(?:\[\/suggestions\]|$)/gi,
    "",
  );
  return final ? withoutSuggestions.trim() : withoutSuggestions.trimStart();
}

function createChatStreamParser(
  onUpdate: ChatStreamUpdateCallback,
  onQuota: (remaining: number) => void = () => undefined,
  onDoneMetadata: (metadata: Record<string, unknown>) => void = () => undefined,
) {
  const state: ChatStreamState = {
    streamed: "",
    completed: null,
    error: false,
    toolResults: [],
    metadata: null,
    failure: null,
  };
  let buffer = "";
  let raw = "";
  let sawSseData = false;

  function emit() {
    onUpdate(
      cleanAiText(state.completed ?? state.streamed, false),
      [...state.toolResults],
      state.metadata ? { ...state.metadata, toolResults: [...state.toolResults] } : null,
    );
  }

  function consumeBlock(block: string) {
    const dataLines = block
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;

    sawSseData = true;
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") return;

    try {
      const parsed: unknown = JSON.parse(data);
      const event = asChatStreamEvent(parsed);
      if (event) {
        if (event.type === "quota") {
          if (
            typeof event.remaining === "number"
            && Number.isInteger(event.remaining)
            && event.remaining >= 0
          ) {
            onQuota(event.remaining);
          }
          return;
        }
        if (
          event.type === "done"
          && event.metadata !== null
          && typeof event.metadata === "object"
          && !Array.isArray(event.metadata)
        ) {
          onDoneMetadata(event.metadata as Record<string, unknown>);
        }
        const hadVisibleDraft = Boolean(state.completed ?? state.streamed);
        if (applyChatEvent(event, state)) emit();
        else if (event.type === "error" && hadVisibleDraft) onUpdate("", [], null);
      } else if (typeof parsed === "string") {
        state.streamed += parsed;
        emit();
      }
    } catch {
      // Preserve legacy plain SSE text, but never render JSON-looking payloads.
      if (!data.startsWith("{") && !data.startsWith("[") && !data.startsWith("\"")) {
        state.streamed += data;
        emit();
      }
    }
  }

  function push(chunk: string) {
    if (!chunk) return;
    raw += chunk;
    buffer += chunk;

    while (buffer.length > 0) {
      const boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
      if (!boundary || boundary.index === undefined) break;
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      consumeBlock(block);
    }
  }

  function finish(): string {
    if (buffer.trim()) {
      if (sawSseData || /(^|\r?\n)data:/.test(buffer)) consumeBlock(buffer);
      buffer = "";
    }

    if (!sawSseData) {
      const trimmed = raw.trim();
      if (trimmed) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          const event = asChatStreamEvent(parsed);
          if (event) applyChatEvent(event, state);
          else if (typeof parsed === "string") state.completed = parsed;
        } catch {
          // Preserve legacy plain text, but never expose serialized JSON as chat text.
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("\"")) {
            state.completed = trimmed;
          }
        }
      }
    }

    if (state.error) throw new ChatTransportError("STREAM", undefined, state.failure ?? undefined);
    return cleanAiText(state.completed ?? state.streamed, true);
  }

  function getToolResults(): ToolExecutionResult[] {
    return [...state.toolResults];
  }

  function getMetadata(): ChatMessageMetadata | null {
    if (!state.metadata && state.toolResults.length === 0) return null;
    return {
      ...(state.metadata ?? {}),
      toolResults: [...state.toolResults],
    };
  }

  return { push, finish, getToolResults, getMetadata };
}

function applyChatStreamUpdate(
  message: ChatMessage,
  update: ChatStreamCompletion,
): ChatMessage {
  const toolResults = mergeToolResults(
    message.metadata?.toolResults ?? [],
    update.toolResults,
  );
  const shouldUpdateMetadata = update.metadata !== null || toolResults.length > 0;
  return {
    ...message,
    content: update.text,
    metadata: shouldUpdateMetadata
      ? {
        ...(message.metadata ?? {}),
        ...(update.metadata ?? {}),
        ...(toolResults.length > 0 ? { toolResults } : {}),
      }
      : message.metadata,
  };
}

function messageRequestKey(message: ChatMessage): string | null {
  const value = message.metadata?.client_visible_request_id
    ?? message.metadata?.client_request_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mergePersistedMessageWithLocal(
  persisted: ChatMessage,
  local: ChatMessage,
): ChatMessage {
  const toolResults = mergeToolResults(
    persisted.metadata?.toolResults ?? [],
    local.metadata?.toolResults ?? [],
  );
  const hasMetadata = Boolean(persisted.metadata || local.metadata || toolResults.length > 0);
  return {
    ...persisted,
    content: local.content || persisted.content,
    metadata: hasMetadata
      ? {
        ...(persisted.metadata ?? {}),
        ...(local.metadata ?? {}),
        ...(toolResults.length > 0 ? { toolResults } : {}),
      }
      : null,
  };
}

function mergeRealtimeMessage(
  previous: ChatMessage[],
  incoming: ChatMessage,
  incomingRequestKey: string | null,
): ChatMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === incoming.id);
  if (existingIndex >= 0) {
    return previous.map((message, index) =>
      index === existingIndex
        ? mergePersistedMessageWithLocal(incoming, message)
        : message
    );
  }

  const placeholderIndex = incomingRequestKey
    ? previous.findIndex((message) =>
      message.id.startsWith("temp_") && messageRequestKey(message) === incomingRequestKey
    )
    : -1;
  if (placeholderIndex >= 0) {
    return previous.map((message, index) =>
      index === placeholderIndex
        ? mergePersistedMessageWithLocal(incoming, message)
        : message
    );
  }
  return [...previous, incoming];
}

function reconcileChatStreamUpdate(
  previous: ChatMessage[],
  tempId: string,
  serverRequestKey: string,
  update: ChatStreamCompletion,
): ChatMessage[] {
  const metadataServerId = update.metadata?.serverMessageId;
  const serverMessageId = typeof metadataServerId === "string" && metadataServerId.length > 0
    ? metadataServerId
    : null;
  const tempIndex = previous.findIndex((message) => message.id === tempId);
  const serverIndex = previous.findIndex((message) =>
    (serverMessageId !== null && message.id === serverMessageId)
    || (message.sender_type === "ai" && messageRequestKey(message) === serverRequestKey)
  );

  if (serverIndex >= 0) {
    const serverMessage = previous[serverIndex];
    const baseMessage = tempIndex >= 0 && tempIndex !== serverIndex
      ? mergePersistedMessageWithLocal(serverMessage, previous[tempIndex])
      : serverMessage;
    const updatedServer = applyChatStreamUpdate(baseMessage, update);
    return previous
      .filter((_, index) => index !== tempIndex || index === serverIndex)
      .map((message) => message.id === serverMessage.id ? updatedServer : message);
  }

  if (tempIndex >= 0) {
    const updatedTemp = applyChatStreamUpdate(previous[tempIndex], update);
    const reconciled = serverMessageId ? { ...updatedTemp, id: serverMessageId } : updatedTemp;
    return previous.map((message, index) => index === tempIndex ? reconciled : message);
  }

  return previous;
}

function parseChatHttpFailure(text: string): NonNullable<ChatStreamState["failure"]> {
  const failClosed = {
    serverCode: null,
    retryable: false,
    retryPolicy: null,
  } satisfies NonNullable<ChatStreamState["failure"]>;
  if (!text || text.length > 4_096) return failClosed;

  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return failClosed;
    const record = value as Record<string, unknown>;
    const retryPolicy = record.retryPolicy === "same_request"
      || record.retryPolicy === "new_message"
      ? record.retryPolicy
      : null;
    const serverCode = typeof record.code === "string"
      && /^[A-Z0-9_]{1,96}$/.test(record.code)
      ? record.code
      : null;
    return {
      serverCode,
      retryable: retryPolicy === "same_request"
        ? true
        : retryPolicy === "new_message"
          ? false
          : record.retryable === true,
      retryPolicy,
    };
  } catch {
    return failClosed;
  }
}

function streamChatWithXhr(
  body: ChatRequestBody,
  accessToken: string,
  signal: AbortSignal,
  onUpdate: ChatStreamUpdateCallback,
  onQuota: (remaining: number) => void,
  onDoneMetadata: (metadata: Record<string, unknown>) => void,
): Promise<ChatStreamCompletion> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChatTransportError("CANCELLED"));
      return;
    }

    const xhr = new XMLHttpRequest();
    const parser = createChatStreamParser(onUpdate, onQuota, onDoneMetadata);
    let consumedLength = 0;
    let settled = false;

    const cleanup = () => signal.removeEventListener("abort", abortRequest);
    const rejectOnce = (error: ChatTransportError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (value: ChatStreamCompletion) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const consumeAvailableText = () => {
      if (xhr.status < 200 || xhr.status >= 300) return;
      const cumulative = xhr.responseText ?? "";
      if (cumulative.length < consumedLength) consumedLength = 0;
      const chunk = cumulative.slice(consumedLength);
      consumedLength = cumulative.length;
      parser.push(chunk);
    };
    function abortRequest() {
      xhr.abort();
    }

    xhr.open("POST", `${API_BASE}/api/chat`, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.timeout = CHAT_REQUEST_TIMEOUT_MS;
    xhr.onprogress = consumeAvailableText;
    xhr.onload = () => {
      consumeAvailableText();
      if (xhr.status < 200 || xhr.status >= 300) {
        rejectOnce(new ChatTransportError(
          "HTTP",
          xhr.status,
          parseChatHttpFailure(xhr.responseText ?? ""),
        ));
        return;
      }
      try {
        const finalText = parser.finish();
        const toolResults = parser.getToolResults();
        if (!finalText && toolResults.length === 0) throw new ChatTransportError("EMPTY");
        resolveOnce({
          text: finalText,
          toolResults,
          metadata: parser.getMetadata(),
        });
      } catch (error) {
        rejectOnce(error instanceof ChatTransportError ? error : new ChatTransportError("STREAM"));
      }
    };
    xhr.onerror = () => rejectOnce(new ChatTransportError("NETWORK"));
    xhr.ontimeout = () => rejectOnce(new ChatTransportError("TIMEOUT"));
    xhr.onabort = () => rejectOnce(new ChatTransportError("CANCELLED"));
    signal.addEventListener("abort", abortRequest, { once: true });

    try {
      xhr.send(JSON.stringify(body));
    } catch {
      rejectOnce(new ChatTransportError("NETWORK"));
    }
  });
}

function waitForUnlessAborted<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChatTransportError("CANCELLED"));
      return;
    }
    const abort = () => reject(new ChatTransportError("CANCELLED"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function requestChatStream(
  body: ChatRequestBody,
  signal: AbortSignal,
  onUpdate: ChatStreamUpdateCallback,
  onQuota: (remaining: number) => void,
  onDoneMetadata: (metadata: Record<string, unknown>) => void,
): Promise<ChatStreamCompletion> {
  const { data: sessionData } = await waitForUnlessAborted(
    supabase.auth.getSession(),
    signal,
  );
  if (signal.aborted) throw new ChatTransportError("CANCELLED");
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new ChatTransportError("AUTH");

  try {
    return await streamChatWithXhr(body, accessToken, signal, onUpdate, onQuota, onDoneMetadata);
  } catch (error) {
    if (!(error instanceof ChatTransportError) || error.status !== 401 || signal.aborted) {
      throw error;
    }
  }

  // Refresh once and replay the exact same logical request id and payload.
  const { data: refreshed, error: refreshError } = await waitForUnlessAborted(
    supabase.auth.refreshSession(),
    signal,
  );
  if (signal.aborted) throw new ChatTransportError("CANCELLED");
  if (refreshError || !refreshed.session?.access_token) throw new ChatTransportError("AUTH");
  return streamChatWithXhr(
    body,
    refreshed.session.access_token,
    signal,
    onUpdate,
    onQuota,
    onDoneMetadata,
  );
}

async function requestAmoraSharedActionWithToken(
  actionId: string,
  messageId: string,
  method: AmoraSharedActionMethod,
  accessToken: string,
): Promise<unknown> {
  const actionUrl = `${API_BASE}/api/amora/shared-actions/${encodeURIComponent(actionId)}`;
  const response = await fetch(
    method === "GET"
      ? `${actionUrl}?messageId=${encodeURIComponent(messageId)}`
      : actionUrl,
    {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify({ messageId }) }),
    },
  );
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const serverMessage = isRecord(value)
      && typeof value.error === "string"
      && value.error === value.error.trim()
      && value.error.length > 0
      && value.error.length <= 500
      ? value.error
      : "공동 확인 상태를 안전하게 처리하지 못했어요.";
    throw new AmoraSharedActionRequestError(response.status, serverMessage);
  }
  return value;
}

async function requestAmoraSharedAction(
  actionId: string,
  messageId: string,
  method: AmoraSharedActionMethod,
): Promise<unknown> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new ChatTransportError("AUTH");
  try {
    return await requestAmoraSharedActionWithToken(
      actionId,
      messageId,
      method,
      accessToken,
    );
  } catch (error) {
    if (!(error instanceof AmoraSharedActionRequestError) || error.status !== 401) {
      throw error;
    }
  }
  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed.session?.access_token) {
    throw new ChatTransportError("AUTH");
  }
  return requestAmoraSharedActionWithToken(
    actionId,
    messageId,
    method,
    refreshed.session.access_token,
  );
}

async function requestAmoraSharedActionStatus(
  actionId: string,
  messageId: string,
): Promise<SharedActionApprovalStatus> {
  const value = await requestAmoraSharedAction(actionId, messageId, "GET");
  const status = parseSharedActionApprovalStatus(value);
  if (!status) throw new ChatTransportError("STREAM");
  return status;
}

async function requestAmoraSharedActionApproval(
  actionId: string,
  messageId: string,
  method: "POST" | "DELETE",
): Promise<SharedActionApprovalStatus> {
  const value = await requestAmoraSharedAction(actionId, messageId, method);
  const status = parseSharedActionApprovalStatus(value);
  if (!status) throw new ChatTransportError("STREAM");
  return status;
}

async function requestAmoraApplicationClaim(
  actionId: string,
  messageId: string,
): Promise<SharedActionApplicationClaim> {
  const value = await requestAmoraSharedAction(actionId, messageId, "PUT");
  const claim = parseSharedActionApplicationClaim(value);
  if (!claim) throw new ChatTransportError("STREAM");
  return claim;
}

function getAmoraSharedActionFailureMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof AmoraSharedActionRequestError) return error.userMessage;
  if (error instanceof ChatTransportError && error.code === "AUTH") {
    return "로그인이 만료됐어요. 다시 로그인한 뒤 재시도해 주세요.";
  }
  return fallback;
}

function getAiFailureMessage(error: unknown, timedOut: boolean): string {
  if (timedOut || (error instanceof ChatTransportError && error.code === "TIMEOUT")) {
    return "답변이 평소보다 오래 걸렸어요. 같은 요청으로 다시 이어갈 수 있어요.";
  }
  if (error instanceof ChatTransportError) {
    if (error.code === "AUTH") return "로그인이 만료됐어요. 다시 로그인한 뒤 재시도해 주세요.";
    if (error.status === 409) return "아모라가 같은 답변을 아직 만들고 있어요. 잠시 후 다시 시도해 주세요.";
    if (error.status === 429) return "요청이 잠시 몰렸어요. 조금 뒤에 다시 시도해 주세요.";
  }
  return "답변을 가져오지 못했어요. 입력한 질문은 저장되어 있으니 다시 시도해 주세요.";
}

function canRetrySameChatRequest(error: unknown, timedOut = false): boolean {
  if (timedOut) return true;
  if (!(error instanceof ChatTransportError)) return false;
  if (error.retryable !== null) return error.retryable;
  // No terminal server decision exists for transport loss, so replaying the
  // same idempotency key remains the only safe retry. Legacy terminal/HTTP
  // failures without an explicit contract fail closed.
  return error.code === "NETWORK" || error.code === "TIMEOUT";
}

function ThinkingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    function a(d: Animated.Value, dl: number) { return Animated.loop(Animated.sequence([Animated.delay(dl), Animated.timing(d, { toValue: 1, duration: 400, useNativeDriver: true }), Animated.timing(d, { toValue: 0, duration: 400, useNativeDriver: true })])); }
    const anims = [a(dot1, 0), a(dot2, 200), a(dot3, 400)];
    anims.forEach((x) => x.start());
    return () => anims.forEach((x) => x.stop());
  }, [dot1, dot2, dot3]);
  return (
    <View style={{ flexDirection: "row", gap: 4, paddingVertical: 4 }}>
      {[dot1, dot2, dot3].map((d, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.textTertiary, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }} />
      ))}
    </View>
  );
}

const BUDGET_WARNING_COPY: Record<BudgetImpactWarning, string> = {
  allocated_over_total: "변경 후 배분 합계가 총예산보다 커요.",
  recorded_spend_over_total: "기록 지출 합계가 변경 후 총예산보다 커요.",
  category_recorded_spend_over_budget:
    "일부 항목의 기록 지출이 해당 배정 예산보다 커요.",
};

function formatWon(value: number): string {
  const absolute = Math.abs(value).toLocaleString("ko-KR");
  return value < 0 ? `-${absolute}원` : `${absolute}원`;
}

function formatSignedWon(value: number): string {
  if (value === 0) return "변동 없음";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toLocaleString("ko-KR")}원`;
}

function BudgetImpactDetails({ preview }: { preview: BudgetImpactPreview }) {
  const rows = [
    {
      label: "총예산",
      current: preview.current.totalBudget,
      proposed: preview.proposed.totalBudget,
      delta: preview.delta.totalBudget,
    },
    {
      label: "배분 합계",
      current: preview.current.allocatedBudget,
      proposed: preview.proposed.allocatedBudget,
      delta: preview.delta.allocatedBudget,
    },
    {
      label: "기록 지출",
      current: preview.current.recordedSpend,
      proposed: preview.proposed.recordedSpend,
      delta: preview.delta.recordedSpend,
    },
    {
      label: "배분 후 남는 금액",
      current: preview.current.unallocatedBudget,
      proposed: preview.proposed.unallocatedBudget,
      delta: preview.delta.unallocatedBudget,
    },
  ];

  return (
    <View style={st.budgetImpactCard}>
      <Text style={st.budgetImpactTitle}>변경 영향</Text>
      {rows.map((row) => (
        <View key={row.label} style={st.budgetImpactRow}>
          <Text style={st.budgetImpactLabel}>{row.label}</Text>
          <Text style={st.budgetImpactValue}>
            {formatWon(row.current)} → {formatWon(row.proposed)}{" "}
            <Text style={st.budgetImpactDelta}>({formatSignedWon(row.delta)})</Text>
          </Text>
        </View>
      ))}
      {preview.warnings.length > 0 && (
        <View style={st.budgetImpactWarnings}>
          {preview.warnings.map((warning) => (
            <Text key={warning} style={st.budgetImpactWarningText}>
              • {BUDGET_WARNING_COPY[warning]}
            </Text>
          ))}
        </View>
      )}
      <Text style={st.budgetImpactDisclaimer}>
        기록 지출은 사용자가 명시적으로 입력한 금액이며, 결제 증거나 결제 완료를 뜻하지 않아요.
      </Text>
    </View>
  );
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<ViewerRole>(null);
  const [userName, setUserName] = useState("사용자");
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [hasLinkedPartner, setHasLinkedPartner] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [target, setTarget] = useState<MessageTarget>("ai");
  const [activeScope, setActiveScope] = useState<ChatScope>("shared");
  const [inputByLane, setInputByLane] = useState<AmoraChatLaneRecord<string>>(
    () => createEmptyAmoraChatLaneRecord(() => ""),
  );
  const activeLane = resolveAmoraChatLane(activeScope, target, hasLinkedPartner);
  const input = activeLane ? inputByLane[activeLane] : "";
  const setActiveInput = useCallback((nextInput: SetStateAction<string>) => {
    if (!activeLane) return;
    setInputByLane((currentDrafts) => {
      const currentInput = currentDrafts[activeLane];
      const resolvedInput = typeof nextInput === "function"
        ? nextInput(currentInput)
        : nextInput;
      const lane = activeLane;
      return updateAmoraChatLaneRecord(currentDrafts, lane, resolvedInput);
    });
  }, [activeLane]);
  const [sendFailuresByLane, setSendFailuresByLane] = useState<
    AmoraChatLaneRecord<SendFailure | null>
  >(() => createEmptyAmoraChatLaneRecord(() => null));
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissedPendingActionIds, setDismissedPendingActionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [applyingPendingActionId, setApplyingPendingActionId] = useState<string | null>(null);
  const [pendingActionNotice, setPendingActionNotice] = useState<{
    actionId: string;
    message: string;
  } | null>(null);
  const [pendingActionApproval, setPendingActionApproval] =
    useState<PendingActionApprovalState | null>(null);
  const [partnerSafetyNotice, setPartnerSafetyNotice] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const hasLinkedPartnerRef = useRef(false);
  const linkedPartnerIdRef = useRef<string | null>(null);
  const chatSessionGenerationRef = useRef(createChatSessionGenerationGuard());
  const sendingRef = useRef(false);
  const applyingPendingActionRef = useRef<string | null>(null);
  const persistedAiRequestKeysRef = useRef(new Set<string>());
  const previousMessageCountRef = useRef(0);
  const scopedMessages = useMemo(
    () => messages.filter((message) => (
      isMessageInChatScope(message.visibility, activeScope, userRole)
    )),
    [activeScope, messages, userRole],
  );
  const visibleMessages = useMemo(() => [...scopedMessages].reverse(), [scopedMessages]);
  const activeSendFailure = activeLane ? sendFailuresByLane[activeLane] : null;
  const isConfirmedActionRecovery =
    activeSendFailure?.kind === "ai_insert"
    && typeof activeSendFailure.draft.confirmedActionId === "string";
  const latestSharedMessage = useMemo(
    () => [...messages]
      .reverse()
      .find((message) => (
        message.visibility === "shared"
        && message.metadata?.target !== "partner"
      )) ?? null,
    [messages],
  );
  const latestSharedMessageId = latestSharedMessage?.id ?? null;
  const latestPendingAction = useMemo(
    () => latestSharedMessage ? getPendingAmoraAction(latestSharedMessage) : null,
    [latestSharedMessage],
  );
  const latestPendingApprovalPolicy = latestPendingAction
    ? getAmoraActionApprovalPolicy(latestPendingAction.tool, latestPendingAction.input)
    : "blocked";

  const isCurrentChatSession = useCallback((generation: number) => (
    mountedRef.current && chatSessionGenerationRef.current.isCurrent(generation)
  ), []);

  const setLaneFailure = useCallback((
    lane: AmoraChatLane,
    failure: SendFailure | null,
  ) => {
    setSendFailuresByLane((current) => (
      current[lane] === failure
        ? current
        : updateAmoraChatLaneRecord(current, lane, failure)
    ));
  }, []);

  const resetChatSessionState = useCallback(() => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    hasLinkedPartnerRef.current = false;
    linkedPartnerIdRef.current = null;
    sendingRef.current = false;
    applyingPendingActionRef.current = null;
    persistedAiRequestKeysRef.current.clear();
    previousMessageCountRef.current = 0;
    setMessages([]);
    setStreaming(false);
    setCoupleId(null);
    setUserId(null);
    setUserRole(null);
    setUserName("사용자");
    setPartnerName(null);
    setHasLinkedPartner(false);
    setInitialLoaded(false);
    setTarget("ai");
    setActiveScope("shared");
    setInputByLane(createEmptyAmoraChatLaneRecord(() => ""));
    setSendFailuresByLane(createEmptyAmoraChatLaneRecord(() => null));
    setQuotaRemaining(null);
    setDismissedPendingActionIds(new Set());
    setApplyingPendingActionId(null);
    setPendingActionNotice(null);
    setPendingActionApproval(null);
    setPartnerSafetyNotice(null);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      !latestPendingAction
      || !latestSharedMessageId
      || latestPendingApprovalPolicy !== "couple"
    ) {
      setPendingActionApproval(null);
      return;
    }

    const actionId = latestPendingAction.actionId;
    const messageId = latestSharedMessageId;
    const expiresAt = latestPendingAction.expiresAt;
    let active = true;

    setPendingActionApproval({
      actionId,
      messageId,
      status: null,
      error: null,
      mutation: null,
    });

    const loadStatus = async () => {
      if (!active || Date.now() >= expiresAt) return;
      try {
        const status = await requestAmoraSharedActionStatus(actionId, messageId);
        if (!active) return;
        setPendingActionApproval((current) => (
          current?.actionId === actionId && current.messageId === messageId
            ? { ...current, status, error: null }
            : current
        ));
      } catch (error) {
        if (!active) return;
        setPendingActionApproval((current) => (
          current?.actionId === actionId && current.messageId === messageId
            ? {
                ...current,
                error: getAmoraSharedActionFailureMessage(
                  error,
                  "공동 확인 상태를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
                ),
              }
            : current
        ));
      }
    };

    void loadStatus();
    const refreshTimer = setInterval(() => void loadStatus(), 5_000);
    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [
    latestPendingAction,
    latestPendingApprovalPolicy,
    latestSharedMessageId,
  ]);

  useEffect(() => {
    hasLinkedPartnerRef.current = hasLinkedPartner;
    if (hasLinkedPartner) return;
    linkedPartnerIdRef.current = null;
    setTarget((current) => current === "partner" ? "ai" : current);
    setInputByLane((current) => updateAmoraChatLaneRecord(current, "shared_partner", ""));
    setSendFailuresByLane((current) => (
      updateAmoraChatLaneRecord(current, "shared_partner", null)
    ));
  }, [hasLinkedPartner]);

  const scrollToLatest = useCallback((animated = true, delay = 40) => {
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated });
    }, delay);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let authReloadTimer: ReturnType<typeof setTimeout> | null = null;
    let observedAuthUserId: string | null | undefined;

    function scheduleChatSessionReload() {
      chatSessionGenerationRef.current.invalidate();
      resetChatSessionState();
      if (authReloadTimer) clearTimeout(authReloadTimer);
      authReloadTimer = setTimeout(() => {
        authReloadTimer = null;
        if (mountedRef.current) void loadChatSession();
      }, 0);
    }

    async function loadChatSession() {
      const generation = chatSessionGenerationRef.current.begin();
      resetChatSessionState();
      const isCurrentGeneration = () => isCurrentChatSession(generation);

      const { data: { user } } = await supabase.auth.getUser();
      if (!isCurrentGeneration()) return;
      observedAuthUserId = user?.id ?? null;
      if (!user) {
        setInitialLoaded(true);
        return;
      }
      const reloadIdentity = () => {
        if (!isCurrentChatSession(generation)) return;
        scheduleChatSessionReload();
      };

      const { data: profile } = await supabase.from("profiles")
        .select("name, role, couple_id")
        .eq("id", user.id)
        .single();
      if (!isCurrentGeneration()) return;
      const reloadWhenProfileIdentityChanges = (payload: { new: Record<string, unknown> }) => {
        if (!isCurrentGeneration()) return;
        const nextProfile = payload.new;
        if (
          nextProfile.couple_id !== profile?.couple_id
          || nextProfile.role !== profile?.role
        ) reloadIdentity();
      };
      setUserId(user.id);
      if (!profile?.couple_id) {
        const identityChannel = supabase.channel(`chat-identity:${user.id}:${generation}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` }, reloadWhenProfileIdentityChanges)
          .subscribe();
        if (!isCurrentGeneration()) {
          void supabase.removeChannel(identityChannel);
          return;
        }
        channelRef.current = identityChannel;
        setInitialLoaded(true);
        return;
      }

      const viewerRole: ViewerRole = profile.role === "bride" || profile.role === "groom"
        ? profile.role
        : null;
      setCoupleId(profile.couple_id);
      setUserName(profile.name || "사용자");
      setUserRole(viewerRole);

      const [
        { data: couple },
        { data: partners },
      ] = await Promise.all([
        supabase.from("couples")
          .select("bride_id, groom_id")
          .eq("id", profile.couple_id)
          .maybeSingle(),
        supabase.from("couple_profile_directory")
          .select("id, name")
          .eq("couple_id", profile.couple_id)
          .neq("id", user.id),
      ]);
      if (!isCurrentGeneration()) return;

      const expectedSelfId = viewerRole === "bride"
        ? couple?.bride_id
        : viewerRole === "groom"
          ? couple?.groom_id
          : null;
      const expectedPartnerId = viewerRole === "bride"
        ? couple?.groom_id
        : viewerRole === "groom"
          ? couple?.bride_id
          : null;
      const linkedPartner = typeof expectedPartnerId === "string"
        ? partners?.find((partner) => partner.id === expectedPartnerId) ?? null
        : null;
      const partnerIsVerified = Boolean(
        viewerRole
        && couple?.bride_id
        && couple?.groom_id
        && couple.bride_id !== couple.groom_id
        && expectedSelfId === user.id
        && linkedPartner,
      );
      hasLinkedPartnerRef.current = partnerIsVerified;
      linkedPartnerIdRef.current = partnerIsVerified ? expectedPartnerId ?? null : null;
      setHasLinkedPartner(partnerIsVerified);
      setPartnerName(partnerIsVerified ? linkedPartner?.name || "파트너" : null);
      const reloadWhenCoupleRosterChanges = (payload: { new: Record<string, unknown> }) => {
        if (!isCurrentGeneration() || !couple) return;
        const nextCouple = payload.new;
        if (
          nextCouple.bride_id !== couple.bride_id
          || nextCouple.groom_id !== couple.groom_id
        ) reloadIdentity();
      };

      const [
        { data: history },
        { data: latestCanonical },
      ] = await Promise.all([
        supabase.from("chat_messages")
          .select("id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility")
          .eq("couple_id", profile.couple_id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(200),
        supabase.from("chat_messages")
          .select("id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility")
          .eq("couple_id", profile.couple_id)
          .eq("visibility", "shared")
          .or("metadata->>target.is.null,metadata->>target.neq.partner")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!isCurrentGeneration()) return;

      const boundedHistory = [...(history ?? [])];
      if (
        latestCanonical
        && !boundedHistory.some((message) => message.id === latestCanonical.id)
      ) {
        boundedHistory.push(latestCanonical);
      }
      const historyMessages = boundedHistory
        .sort((left, right) => {
          const byCreatedAt =
            new Date(left.created_at ?? 0).getTime()
            - new Date(right.created_at ?? 0).getTime();
          return byCreatedAt || left.id.localeCompare(right.id);
        })
        .map((message) => chatMessageFromRealtimeRow(message))
        .filter((message): message is ChatMessage => (
          message !== null && canViewerSeeChatMessage(message, viewerRole)
        ));
      for (const message of historyMessages) {
        const metadata = message.metadata;
        const persistedRequestKey = metadata?.client_visible_request_id ?? metadata?.client_request_id;
        if (message.sender_type === "ai" && persistedRequestKey) {
          persistedAiRequestKeysRef.current.add(persistedRequestKey);
        }
      }
      setMessages(reconcileMobileAmoraCrisisRecovery(
        historyMessages,
        user.id,
        profile.couple_id,
        viewerRole,
      ));

      const canonicalShared = historyMessages.filter((message) => (
        message.visibility === "shared"
        && message.metadata?.target !== "partner"
      ));
      const durableConfirmation = canonicalShared[canonicalShared.length - 1];
      const confirmedActionId = durableConfirmation?.metadata?.confirmed_amora_action_id;
      if (
        durableConfirmation
        && durableConfirmation.sender_type === viewerRole
        && durableConfirmation.role === "user"
        && typeof confirmedActionId === "string"
        && viewerRole
      ) {
        setLaneFailure("shared_ai", {
          kind: "ai_insert",
          message: "확인은 안전하게 저장됐어요. 반영을 이어서 완료해 주세요.",
          draft: {
            text: durableConfirmation.content,
            clientRequestId: Crypto.randomUUID(),
            coupleId: profile.couple_id,
            userId: user.id,
            senderType: viewerRole,
            senderName: profile.name ?? "사용자",
            context: canonicalShared
              .slice(0, -1)
              .slice(-39)
              .map(({ role, content }) => ({ role, content })),
            visibility: "shared",
            sessionGeneration: generation,
            confirmedActionId,
          },
        });
      }

      const ch = supabase.channel(`chat:${profile.couple_id}:${generation}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
          if (!isCurrentChatSession(generation)) return;
          const incoming = chatMessageFromRealtimeRow(payload.new);
          if (!incoming || !canViewerSeeChatMessage(incoming, viewerRole)) return;
          const incomingMetadata = incoming.metadata;
          const incomingRequestKey = incoming.sender_type === "ai"
            ? incomingMetadata?.client_visible_request_id ?? incomingMetadata?.client_request_id
            : undefined;
          if (incomingRequestKey) {
            persistedAiRequestKeysRef.current.add(incomingRequestKey);
            const lane = aiLaneForVisibility(incoming.visibility);
            setSendFailuresByLane((current) => {
              const failure = current[lane];
              return failure?.kind === "ai_response"
                && failure.request.serverRequestKey === incomingRequestKey
                ? updateAmoraChatLaneRecord(current, lane, null)
                : current;
            });
          }
          setMessages((previous) => reconcileMobileAmoraCrisisRecovery(
            mergeRealtimeMessage(previous, incoming, incomingRequestKey ?? null),
            user.id,
            profile.couple_id,
            viewerRole,
          ));
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
          if (!isCurrentChatSession(generation)) return;
          const updated = chatMessageFromRealtimeRow(payload.new);
          const updatedId = updated?.id
            ?? (payload.new as Record<string, unknown> | null)?.id;
          if (typeof updatedId !== "string") return;
          setMessages((previous) => {
            if (!updated || !canViewerSeeChatMessage(updated, viewerRole)) {
              return reconcileMobileAmoraCrisisRecovery(
                previous.filter((message) => message.id !== updatedId),
                user.id,
                profile.couple_id,
                viewerRole,
              );
            }
            if (!previous.some((message) => message.id === updated.id)) return previous;
            return reconcileMobileAmoraCrisisRecovery(
              previous.map((message) => message.id === updated.id ? updated : message),
              user.id,
              profile.couple_id,
              viewerRole,
            );
          });
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` }, reloadWhenProfileIdentityChanges)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "couples", filter: `id=eq.${profile.couple_id}` }, reloadWhenCoupleRosterChanges)
        .subscribe();
      if (!isCurrentGeneration()) {
        void supabase.removeChannel(ch);
        return;
      }
      channelRef.current = ch;
      setInitialLoaded(true);
    }

    void loadChatSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextAuthUserId = session?.user.id ?? null;
      if (nextAuthUserId === observedAuthUserId) return;
      observedAuthUserId = nextAuthUserId;
      scheduleChatSessionReload();
    });

    return () => {
      mountedRef.current = false;
      chatSessionGenerationRef.current.invalidate();
      if (authReloadTimer) clearTimeout(authReloadTimer);
      subscription.unsubscribe();
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [isCurrentChatSession, resetChatSessionState, setLaneFailure]);

  useEffect(() => {
    if (!initialLoaded || scopedMessages.length === 0) return;

    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = scopedMessages.length;

    if (previousCount === 0) {
      scrollToLatest(false, 0);
      return;
    }

    scrollToLatest(true);
  }, [initialLoaded, scopedMessages.length, scrollToLatest]);

  function pressIn() { Animated.spring(sendBtnScale, { toValue: 0.88, useNativeDriver: true }).start(); }
  function pressOut() { Animated.spring(sendBtnScale, { toValue: 1, friction: 3, tension: 120, useNativeDriver: true }).start(); }

  async function findDurableUserMessage(
    draft: Pick<
      AiDraft,
      | "text"
      | "clientRequestId"
      | "coupleId"
      | "userId"
      | "senderType"
      | "visibility"
      | "confirmedActionId"
    >,
    intendedTarget: MessageTarget,
  ): Promise<ChatMessage | null> {
    let query = supabase.from("chat_messages")
      .select("id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility")
      .eq("couple_id", draft.coupleId)
      .eq("sender_id", draft.userId)
      .eq("sender_type", draft.senderType)
      .eq("role", "user")
      .eq("visibility", draft.visibility);
    query = draft.confirmedActionId
      ? query.contains("metadata", {
          confirmed_amora_action_id: draft.confirmedActionId,
        })
      : query.contains("metadata", {
          client_request_id: draft.clientRequestId,
        });
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const metadata = data.metadata as ChatMessageMetadata | null;
    const targetMatches = intendedTarget === "partner"
      ? metadata?.target === "partner"
      : metadata?.target !== "partner";
    if (!targetMatches) return null;
    return chatMessageFromRealtimeRow(data);
  }

  async function sendPartnerDraft(draft: PartnerDraft, reconcileFirst: boolean) {
    const lane: AmoraChatLane = "shared_partner";
    if (!isCurrentChatSession(draft.sessionGeneration)) return;
    if (
      !hasLinkedPartnerRef.current
      || linkedPartnerIdRef.current !== draft.partnerRecipientId
    ) {
      hasLinkedPartnerRef.current = false;
      linkedPartnerIdRef.current = null;
      setHasLinkedPartner(false);
      setPartnerName(null);
      setTarget("ai");
      setInputByLane((current) => updateAmoraChatLaneRecord(current, lane, ""));
      setLaneFailure(lane, null);
      setPartnerSafetyNotice(PARTNER_CONNECTION_CHANGED_NOTICE);
      return;
    }
    setStreaming(true);
    setLaneFailure(lane, null);
    try {
      const recipientVerification = await verifyPartnerDraftRecipient(draft);
      if (!isCurrentChatSession(draft.sessionGeneration)) return;
      if (recipientVerification === "unlinked") {
        hasLinkedPartnerRef.current = false;
        linkedPartnerIdRef.current = null;
        setHasLinkedPartner(false);
        setPartnerName(null);
        setTarget("ai");
        setInputByLane((current) => updateAmoraChatLaneRecord(current, lane, ""));
        setLaneFailure(lane, null);
        setPartnerSafetyNotice(PARTNER_CONNECTION_CHANGED_NOTICE);
        return;
      }
      if (recipientVerification === "unavailable") {
        throw new Error("partner recipient verification unavailable");
      }

      let durableMessage = reconcileFirst
        ? await findDurableUserMessage(draft, "partner")
        : null;
      if (!isCurrentChatSession(draft.sessionGeneration)) return;

      if (!durableMessage) {
        const { data, error } = await supabase.from("chat_messages")
          .insert({
            couple_id: draft.coupleId,
            sender_id: draft.userId,
            sender_type: draft.senderType,
            role: "user",
            content: draft.text,
            metadata: {
              target: "partner",
              client_request_id: draft.clientRequestId,
              partner_recipient_id: draft.partnerRecipientId,
            },
            visibility: draft.visibility,
          })
          .select("id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility")
          .single();

        const insertedMessage = !error && data
          ? chatMessageFromRealtimeRow(data)
          : null;
        durableMessage = insertedMessage ?? await findDurableUserMessage(draft, "partner");
        if (!isCurrentChatSession(draft.sessionGeneration)) return;
      }

      if (!durableMessage) throw new Error("partner message was not persisted");
      if (isCurrentChatSession(draft.sessionGeneration)) {
        setMessages((previous) => previous.some((message) => message.id === durableMessage.id)
          ? previous
          : [...previous, durableMessage]
        );
        setInputByLane((current) => (
          current[lane].trim() === draft.text
            ? updateAmoraChatLaneRecord(current, lane, "")
            : current
        ));
      }
    } catch {
      if (isCurrentChatSession(draft.sessionGeneration)) {
        setLaneFailure(lane, {
          kind: "partner_insert",
          message: "메시지를 저장하지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.",
          draft,
        });
      }
    } finally {
      if (isCurrentChatSession(draft.sessionGeneration)) setStreaming(false);
    }
  }

  async function streamAiRequest(request: AiRequest) {
    if (!isCurrentChatSession(request.sessionGeneration)) return;
    if (persistedAiRequestKeysRef.current.has(request.serverRequestKey)) {
      setLaneFailure(request.lane, null);
      setStreaming(false);
      return;
    }
    setLaneFailure(request.lane, null);
    setQuotaRemaining(null);
    setStreaming(true);
    setMessages((previous) => {
      const hasPersistedAnswer = previous.some((message) =>
        !message.id.startsWith("temp_") &&
        message.sender_type === "ai" &&
        message.metadata?.client_request_id === request.serverRequestKey
      );
      if (hasPersistedAnswer) return previous;
      const placeholder: ChatMessage = {
        id: request.tempId,
        couple_id: request.body.coupleId,
        sender_id: null,
        role: "assistant",
        sender_type: "ai",
        content: "",
        metadata: { client_request_id: request.serverRequestKey },
        visibility: request.body.visibility,
      };
      const existingIndex = previous.findIndex((message) => message.id === request.tempId);
      if (existingIndex < 0) return [...previous, placeholder];
      return previous.map((message) => message.id === request.tempId ? placeholder : message);
    });
    scrollToLatest(true);

    const controller = new AbortController();
    activeControllerRef.current?.abort();
    activeControllerRef.current = controller;
    let timedOut = false;
    let completionPendingAction: ReturnType<typeof getPendingAmoraAction> = null;
    let pendingUpdate: ChatStreamCompletion = {
      text: "",
      toolResults: [],
      metadata: null,
    };
    let renderFrame: number | null = null;
    const cancelPendingRender = () => {
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      renderFrame = null;
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const completion = await requestChatStream(
        request.body,
        controller.signal,
        (partialText, toolResults, metadata) => {
          if (!isCurrentChatSession(request.sessionGeneration)) return;
          pendingUpdate = { text: partialText, toolResults, metadata };
          if (renderFrame !== null) return;
          renderFrame = requestAnimationFrame(() => {
            renderFrame = null;
            if (!isCurrentChatSession(request.sessionGeneration)) return;
            setMessages((previous) => reconcileChatStreamUpdate(
              previous,
              request.tempId,
              request.serverRequestKey,
              pendingUpdate,
            ));
          });
        },
        (remaining) => {
          if (isCurrentChatSession(request.sessionGeneration)) setQuotaRemaining(remaining);
        },
        (metadata) => {
          completionPendingAction = getPendingAmoraAction({
            sender_type: "ai",
            visibility: request.body.visibility,
            metadata: { pending_amora_action: metadata.pending_amora_action },
          });
        },
      );
      cancelPendingRender();
      if (isCurrentChatSession(request.sessionGeneration)) {
        const crisisBoundCompletion: ChatStreamCompletion =
          completion.metadata?.response_origin === "deterministic_crisis_safety"
          && !completion.metadata.in_reply_to_user_message_id
            ? {
                ...completion,
                metadata: {
                  ...completion.metadata,
                  in_reply_to_user_message_id: request.body.userMessageId,
                },
              }
            : completion;
        const completedUpdate: ChatStreamCompletion = completionPendingAction
          ? {
              ...crisisBoundCompletion,
              metadata: {
                ...(crisisBoundCompletion.metadata ?? {}),
                pending_amora_action: completionPendingAction,
              },
            }
          : crisisBoundCompletion;
        setMessages((previous) => reconcileMobileAmoraCrisisRecovery(
          reconcileChatStreamUpdate(
            previous,
            request.tempId,
            request.serverRequestKey,
            completedUpdate,
          ),
          userId ?? "",
          request.body.coupleId,
          userRole,
        ));
        scrollToLatest(true);
      }
    } catch (error) {
      const cancelledByInactiveSession =
        !isCurrentChatSession(request.sessionGeneration) &&
        error instanceof ChatTransportError &&
        error.code === "CANCELLED";
      if (!cancelledByInactiveSession && isCurrentChatSession(request.sessionGeneration)) {
        cancelPendingRender();
        setMessages((previous) => previous.filter((message) => message.id !== request.tempId));
        if (!persistedAiRequestKeysRef.current.has(request.serverRequestKey)) {
          const canRetry = canRetrySameChatRequest(error, timedOut);
          setLaneFailure(request.lane, {
            kind: "ai_response",
            message: getAiFailureMessage(error, timedOut),
            request,
            canRetry,
            unavailableReason: canRetry
              ? null
              : NEW_CHAT_MESSAGE_REQUIRED_NOTICE,
          });
        }
      }
    } finally {
      cancelPendingRender();
      clearTimeout(timeout);
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      if (isCurrentChatSession(request.sessionGeneration)) setStreaming(false);
    }
  }

  async function sendAiDraft(draft: AiDraft, reconcileFirst: boolean) {
    const lane = aiLaneForVisibility(draft.visibility);
    if (!isCurrentChatSession(draft.sessionGeneration)) return;
    setStreaming(true);
    setLaneFailure(lane, null);
    try {
      let durableMessage = reconcileFirst
        ? await findDurableUserMessage(draft, "ai")
        : null;
      if (!isCurrentChatSession(draft.sessionGeneration)) return;

      if (
        !durableMessage
        && reconcileFirst
        && draft.confirmedActionId
        && draft.amoraSourceMessageId
      ) {
        const claim = await requestAmoraApplicationClaim(
          draft.confirmedActionId,
          draft.amoraSourceMessageId,
        );
        if (!isCurrentChatSession(draft.sessionGeneration)) return;
        if (!claim.applicationGranted) {
          if (isCurrentChatSession(draft.sessionGeneration)) {
            setPendingActionNotice({
              actionId: draft.confirmedActionId,
              message: "다른 화면에서 반영을 진행 중이에요. 잠시 후 다시 시도해 주세요.",
            });
            setStreaming(false);
          }
          return;
        }
      }

      if (!durableMessage) {
        const { data, error } = await supabase.from("chat_messages")
          .insert({
            couple_id: draft.coupleId,
            sender_id: draft.userId,
            sender_type: draft.senderType,
            role: "user",
            content: draft.text,
            metadata: draft.confirmedActionId
              ? {
                  confirmed_amora_action_id: draft.confirmedActionId,
                  client_request_id: draft.clientRequestId,
                }
              : { client_request_id: draft.clientRequestId },
            visibility: draft.visibility,
          })
          .select("id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility")
          .single();

        const insertedMessage = !error && data
          ? chatMessageFromRealtimeRow(data)
          : null;
        durableMessage = insertedMessage ?? await findDurableUserMessage(draft, "ai");
        if (!isCurrentChatSession(draft.sessionGeneration)) return;
      }

      if (!durableMessage) throw new Error("user message was not persisted");

      const serverRequestKey = `chat:${draft.userId}:${draft.clientRequestId}`;
      const request: AiRequest = {
        tempId: `temp_${draft.clientRequestId}`,
        serverRequestKey,
        lane,
        sessionGeneration: draft.sessionGeneration,
        body: {
          messages: [
            ...draft.context,
            { role: "user", content: durableMessage.content },
          ],
          coupleId: draft.coupleId,
          senderName: draft.senderName,
          clientRequestId: draft.clientRequestId,
          userMessageId: durableMessage.id,
          visibility: draft.visibility,
          confirmedActionId: draft.confirmedActionId,
        },
      };

      if (isCurrentChatSession(draft.sessionGeneration)) {
        setMessages((previous) => previous.some((message) => message.id === durableMessage.id)
          ? previous
          : [...previous, durableMessage]
        );
        setInputByLane((current) => (
          current[lane].trim() === draft.text
            ? updateAmoraChatLaneRecord(current, lane, "")
            : current
        ));
      }
      if (!isCurrentChatSession(draft.sessionGeneration)) return;
      await streamAiRequest(request);
    } catch {
      if (isCurrentChatSession(draft.sessionGeneration)) {
        setLaneFailure(lane, {
          kind: "ai_insert",
          message: draft.confirmedActionId
            ? "반영 요청을 끝내지 못했어요. 확인은 유지되니 이어서 완료해 주세요."
            : "질문을 저장하지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.",
          draft,
        });
        setStreaming(false);
      }
    }
  }

  async function handleRetry() {
    if (!activeSendFailure || !activeLane || streaming || sendingRef.current) return;
    const failure = activeSendFailure;
    if (failure.kind === "ai_response" && !failure.canRetry) return;
    const sessionGeneration = failure.kind === "ai_response"
      ? failure.request.sessionGeneration
      : failure.draft.sessionGeneration;
    if (!isCurrentChatSession(sessionGeneration)) return;
    sendingRef.current = true;
    try {
      if (failure.kind === "partner_insert") {
        setInputByLane((current) => (
          updateAmoraChatLaneRecord(current, "shared_partner", failure.draft.text)
        ));
        await sendPartnerDraft(failure.draft, true);
        return;
      }
      if (failure.kind === "ai_insert") {
        const lane = aiLaneForVisibility(failure.draft.visibility);
        setInputByLane((current) => (
          updateAmoraChatLaneRecord(current, lane, failure.draft.text)
        ));
        await sendAiDraft(failure.draft, true);
        return;
      }
      await streamAiRequest(failure.request);
    } finally {
      if (isCurrentChatSession(sessionGeneration)) sendingRef.current = false;
    }
  }

  async function handleSend() {
    const text = input.trim();
    const activeVisibility = chatVisibilityForScope(activeScope, userRole);
    if (
      !text
      || streaming
      || sendingRef.current
      || !coupleId
      || !userId
      || !userRole
      || !activeVisibility
      || !activeLane
    ) return;
    const partnerRecipientId = linkedPartnerIdRef.current;
    if (target === "partner" && (!hasLinkedPartnerRef.current || !partnerRecipientId)) {
      hasLinkedPartnerRef.current = false;
      linkedPartnerIdRef.current = null;
      setHasLinkedPartner(false);
      setPartnerName(null);
      setTarget("ai");
      setInputByLane((current) => (
        updateAmoraChatLaneRecord(current, "shared_partner", "")
      ));
      setLaneFailure("shared_partner", null);
      setPartnerSafetyNotice(PARTNER_CONNECTION_CHANGED_NOTICE);
      return;
    }
    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (!isCurrentChatSession(sessionGeneration)) return;
    sendingRef.current = true;
    try {
      setLaneFailure(activeLane, null);
      const clientRequestId = Crypto.randomUUID();

      if (target === "partner") {
        if (activeVisibility !== "shared" || !partnerRecipientId) return;
        await sendPartnerDraft({
          text,
          clientRequestId,
          partnerRecipientId,
          coupleId,
          userId,
          senderType: userRole,
          visibility: "shared",
          sessionGeneration,
        }, false);
        return;
      }

      const context = messages
        .filter((message) =>
          (!message.id.startsWith("temp_") || Boolean(message.content.trim())) &&
          message.metadata?.target !== "partner" &&
          isMessageInAiContext(message.visibility, activeVisibility)
        )
        .slice(-39)
        .map(({ role, content }) => ({ role, content }));
      await sendAiDraft({
        text,
        clientRequestId,
        coupleId,
        userId,
        senderType: userRole,
        senderName: userName,
        context,
        visibility: activeVisibility,
        sessionGeneration,
      }, false);
    } finally {
      if (isCurrentChatSession(sessionGeneration)) sendingRef.current = false;
    }
  }

  function handleInputChange(value: string) {
    if (!activeLane) return;
    setActiveInput(value);
    setSendFailuresByLane((current) => {
      const failure = current[activeLane];
      return failure?.kind === "partner_insert" || failure?.kind === "ai_insert"
        ? updateAmoraChatLaneRecord(current, activeLane, null)
        : current;
    });
  }

  function handleTargetChange(nextTarget: MessageTarget) {
    if (
      streaming
      || sendingRef.current
      || (activeScope === "private" && nextTarget === "partner")
      || (nextTarget === "partner" && !hasLinkedPartner)
    ) return;
    setTarget(nextTarget);
  }

  function handleAiSuggestion(value: string) {
    if (streaming || sendingRef.current) return;
    const lane: Exclude<AmoraChatLane, "shared_partner"> = activeScope === "private"
      ? "private_ai"
      : "shared_ai";
    setTarget("ai");
    setInputByLane((current) => updateAmoraChatLaneRecord(current, lane, value));
    setSendFailuresByLane((current) => {
      const failure = current[lane];
      return failure?.kind === "ai_insert"
        ? updateAmoraChatLaneRecord(current, lane, null)
        : current;
    });
  }

  async function handleApplyPendingAction(actionId: string) {
    if (
      streaming
      || sendingRef.current
      || applyingPendingActionRef.current
      || !coupleId
      || !userId
      || !userRole
    ) return;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (!isCurrentChatSession(sessionGeneration)) return;

    if (!latestSharedMessage) return;
    const action = getPendingAmoraAction(latestSharedMessage);
    const approvalPolicy = action
      ? getAmoraActionApprovalPolicy(action.tool, action.input)
      : "blocked";
    if (
      !action
      || action.actionId !== actionId
      || approvalPolicy === "blocked"
      || getPendingActionDisabledReason(action, Date.now(), true, false) !== null
    ) return;

    sendingRef.current = true;
    applyingPendingActionRef.current = actionId;
    setActiveScope("shared");
    setTarget("ai");
    setApplyingPendingActionId(actionId);
    setPendingActionNotice(null);
    if (approvalPolicy === "couple") {
      setPendingActionApproval((current) => (
        current?.actionId === actionId && current.messageId === latestSharedMessage.id
          ? { ...current, error: null, mutation: "confirm" }
          : {
              actionId,
              messageId: latestSharedMessage.id,
              status: null,
              error: null,
              mutation: "confirm",
            }
      ));
    }
    try {
      if (approvalPolicy === "couple") {
        const approvalStatus = await requestAmoraSharedActionApproval(
          actionId,
          latestSharedMessage.id,
          "POST",
        );
        if (!isCurrentChatSession(sessionGeneration)) return;
        setPendingActionApproval((current) => (
          current?.actionId === actionId
            ? { ...current, status: approvalStatus, error: null, mutation: null }
            : current
        ));
        if (!approvalStatus.ready) return;
      }

      const claim = await requestAmoraApplicationClaim(
        actionId,
        latestSharedMessage.id,
      );
      if (!isCurrentChatSession(sessionGeneration)) return;
      if (!claim.applicationGranted) {
        const retrySeconds = Math.max(
          1,
          Math.ceil(claim.retryAfterMs / 1_000),
        );
        setPendingActionNotice({
          actionId,
          message:
            `다른 화면에서 반영을 시작했어요. ${retrySeconds}초 뒤에도 반영되지 않으면 다시 눌러 주세요.`,
        });
        return;
      }
      const context = messages
        .filter((message) => (
          (!message.id.startsWith("temp_") || Boolean(message.content.trim()))
          && message.metadata?.target !== "partner"
          && isMessageInAiContext(message.visibility, "shared")
        ))
        .slice(-39)
        .map(({ role, content }) => ({ role, content }));
      const content = "좋아요. 제안한 변경을 적용해 주세요.";
      await sendAiDraft({
        text: content,
        clientRequestId: Crypto.randomUUID(),
        coupleId,
        userId,
        senderType: userRole,
        senderName: userName,
        context,
        visibility: "shared",
        sessionGeneration,
        confirmedActionId: actionId,
        amoraSourceMessageId: latestSharedMessage.id,
      }, false);
    } catch (error) {
      if (isCurrentChatSession(sessionGeneration)) {
        if (approvalPolicy === "couple") {
          setPendingActionApproval((current) => (
            current?.actionId === actionId
              ? {
                  ...current,
                  error: getAmoraSharedActionFailureMessage(
                    error,
                    "내 확인을 안전하게 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
                  ),
                  mutation: null,
                }
              : current
          ));
        }
        if (approvalPolicy !== "couple") {
          setPendingActionNotice({
            actionId,
            message: getAiFailureMessage(error, false),
          });
        }
      }
    } finally {
      if (isCurrentChatSession(sessionGeneration)) {
        applyingPendingActionRef.current = null;
        setApplyingPendingActionId(null);
        sendingRef.current = false;
        if (approvalPolicy === "couple") {
          setPendingActionApproval((current) => (
            current?.actionId === actionId
              ? { ...current, mutation: null }
              : current
          ));
        }
      }
    }
  }

  async function handleWithdrawPendingAction(actionId: string) {
    if (
      streaming
      || sendingRef.current
      || applyingPendingActionRef.current
      || !latestSharedMessage
    ) return;
    const action = getPendingAmoraAction(latestSharedMessage);
    const approval = pendingActionApproval?.actionId === actionId
      && pendingActionApproval.messageId === latestSharedMessage.id
      ? pendingActionApproval
      : null;
    if (
      !action
      || action.actionId !== actionId
      || getAmoraActionApprovalPolicy(action.tool, action.input) !== "couple"
      || getPendingActionDisabledReason(action, Date.now(), true, false) !== null
      || approval?.status?.requiredCount !== 2
      || !approval.status.accepted
      || approval.mutation !== null
    ) return;

    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (!isCurrentChatSession(sessionGeneration)) return;
    applyingPendingActionRef.current = actionId;
    setPendingActionNotice(null);
    setPendingActionApproval((current) => (
      current?.actionId === actionId
        ? { ...current, error: null, mutation: "withdraw" }
        : current
    ));
    try {
      const status = await requestAmoraSharedActionApproval(
        actionId,
        latestSharedMessage.id,
        "DELETE",
      );
      if (!isCurrentChatSession(sessionGeneration)) return;
      setPendingActionApproval((current) => (
        current?.actionId === actionId
          ? { ...current, status, error: null, mutation: null }
          : current
      ));
    } catch (error) {
      if (!isCurrentChatSession(sessionGeneration)) return;
      setPendingActionApproval((current) => (
        current?.actionId === actionId
          ? {
              ...current,
              error: getAmoraSharedActionFailureMessage(
                error,
                "내 확인을 안전하게 취소하지 못했어요. 잠시 후 다시 시도해 주세요.",
              ),
              mutation: null,
            }
          : current
      ));
    } finally {
      if (isCurrentChatSession(sessionGeneration)) {
        applyingPendingActionRef.current = null;
        setPendingActionApproval((current) => (
          current?.actionId === actionId
            ? { ...current, mutation: null }
            : current
        ));
      }
    }
  }

  function handleScopeChange(nextScope: ChatScope) {
    if (streaming || sendingRef.current) return;
    const nextSelection = selectChatScope(
      { scope: activeScope, target },
      nextScope,
      userRole,
    );
    setActiveScope(nextSelection.scope);
    setTarget(nextSelection.target);
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isAi = item.sender_type === "ai";
    const isMe = item.sender_type === userRole;
    const isPinnedSafetyCard = item.metadata?.pinned_safety_card === true;
    const isPartnerMsg = item.metadata?.target === "partner";
    const isBride = item.sender_type === "bride";
    const placeResults = (item.metadata?.toolResults ?? []).filter(
      (result) => result.toolName === "search_nearby_places",
    );
    const hasPlaceResults = placeResults.length > 0;
    const isThinking = isAi && item.id.startsWith("temp_") && !item.content && !hasPlaceResults && streaming;
    const shouldRenderBubble = isThinking || Boolean(item.content.trim());
    const mediationBlock = isAi
      ? normalizeMediationBlock(item.metadata?.mediation)
      : null;
    const pendingActionCandidate = getPendingAmoraAction(item);
    const pendingAction = pendingActionCandidate
      && !dismissedPendingActionIds.has(pendingActionCandidate.actionId)
      ? pendingActionCandidate
      : null;
    const pendingActionDisabledReason: PendingActionDisabledReason = pendingAction
      ? getPendingActionDisabledReason(
          pendingAction,
          nowMs,
          item.id === latestSharedMessageId,
          streaming,
        )
      : null;
    const approvalPolicy = pendingAction
      ? getAmoraActionApprovalPolicy(pendingAction.tool, pendingAction.input)
      : "blocked";
    const requiresCoupleApproval = approvalPolicy === "couple";
    const matchingApproval = pendingAction
      && pendingActionApproval?.actionId === pendingAction.actionId
      && pendingActionApproval.messageId === item.id
      ? pendingActionApproval
      : null;
    const approvalPresentation = getSharedActionApprovalPresentation(
      matchingApproval?.status ?? null,
    );
    const approvalLoading = requiresCoupleApproval
      && (
        !matchingApproval
        || (matchingApproval.status === null && matchingApproval.error === null)
      );
    const approvalCopy = requiresCoupleApproval
      ? matchingApproval?.error ?? approvalPresentation.copy
      : approvalPolicy === "blocked"
        ? "이 변경은 안전 정책상 모바일에서 바로 반영할 수 없어요. 아모라에게 최신 제안을 다시 요청해 주세요."
        : null;
    const approvalMutation = matchingApproval?.mutation ?? null;
    const pendingActionControlDisabled = pendingActionDisabledReason !== null
      || approvalPolicy === "blocked"
      || approvalLoading
      || approvalPresentation.waitingForPartner
      || approvalMutation !== null
      || applyingPendingActionId !== null;
    const canWithdrawApproval = requiresCoupleApproval
      && pendingActionDisabledReason === null
      && approvalPresentation.canWithdraw
      && approvalMutation === null
      && applyingPendingActionId === null;
    const impactPreview = pendingAction
      ? getPendingAmoraBudgetImpactPreview(item, pendingAction)
      : null;
    const applyLabel = applyingPendingActionId === pendingAction?.actionId
      ? "적용 요청 중…"
      : approvalMutation === "confirm"
        ? "내 확인 저장 중…"
        : approvalMutation === "withdraw"
          ? "내 확인 취소 중…"
          : approvalLoading
            ? "확인 상태 불러오는 중…"
            : requiresCoupleApproval && matchingApproval?.error
              ? "내 확인 다시 시도"
            : requiresCoupleApproval
              ? approvalPresentation.applyLabel
              : "이대로 적용";
    const applyAccessibilityLabel = requiresCoupleApproval
      ? matchingApproval?.status?.ready
        || matchingApproval?.status?.requiredCount === 1
        || (
          matchingApproval?.status?.accepted === false
          && (matchingApproval.status.acceptedCount ?? 0) > 0
        )
        ? "이 공동 변경을 확인하고 바로 반영"
        : "이 공동 변경을 확인"
      : "확인한 내용을 이대로 적용";
    const bubbleBg = isAi ? colors.surface : isMe ? colors.noir[800] : isBride ? "#F5E6DF" : "#E8EDF5";
    const textColor = isMe ? "#FFF" : colors.noir[800];

    return (
      <View style={[st.msgRow, isMe && st.msgRowRight]}>
        {!isMe && (
          <View style={[st.avatar, isAi ? st.avatarAi : isBride ? st.avatarBride : st.avatarGroom]}>
            {isAi ? <Sparkles size={12} color={colors.gold.DEFAULT} /> : <Text style={st.avatarLetter}>{isBride ? "신부" : "신랑"}</Text>}
          </View>
        )}
        <View style={[
          st.messageBody,
          isPinnedSafetyCard && st.safetyMessageBody,
          (mediationBlock || pendingAction) && st.mediationMessageBody,
          hasPlaceResults && st.placeMessageBody,
        ]}>
          {!isMe && <Text style={st.senderLabel}>{isAi ? "아모라" : isBride ? (userRole === "bride" ? userName : partnerName ?? "신부") : (userRole === "groom" ? userName : partnerName ?? "신랑")}{isPartnerMsg ? " ♥" : ""}</Text>}
          {shouldRenderBubble && (
            isPinnedSafetyCard ? (
              <View
                style={st.safetyCard}
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                accessibilityLabel={`긴급 안전 안내. ${item.content}`}
              >
                <View style={st.safetyCardHeading} accessibilityElementsHidden>
                  <ShieldCheck size={18} color={colors.danger} />
                  <Text style={st.safetyCardTitle}>긴급 안전 안내</Text>
                </View>
                <Text style={st.safetyCardText}>{item.content}</Text>
              </View>
            ) : (
              <View style={[st.bubble, { backgroundColor: bubbleBg }, !isMe && !isAi && { borderWidth: 1, borderColor: isBride ? "#E8C5B8" : "#C5CEE0" }, isAi && { borderWidth: 1, borderColor: colors.border }, isMe && st.bubbleRight, !isMe && st.bubbleLeft]}>
                {isThinking ? <ThinkingDots /> : <Text style={[st.bubbleText, { color: textColor }, isAi && { lineHeight: 24 }]}>{item.content}</Text>}
              </View>
            )
          )}
          {placeResults.map((result, index) => (
            <PlaceCards key={`${result.toolName}-${index}`} result={result} />
          ))}
          {mediationBlock && (
            <AmoraMediationCard
              key={`${item.id}:${mediationBlock.proposalVersion ?? "draft"}:${mediationBlock.rosterFingerprint ?? "unknown-roster"}`}
              block={mediationBlock}
              messageId={item.id}
            />
          )}
          {pendingAction && (
            <View style={st.pendingActionCard}>
              <View style={st.pendingActionHeading}>
                <View style={st.pendingActionIcon} accessibilityElementsHidden>
                  <ShieldCheck size={18} color="#795252" />
                </View>
                <View style={st.pendingActionCopy}>
                  <Text style={st.pendingActionTitle}>
                    {requiresCoupleApproval
                      ? "두 분 확인이 필요한 변경이에요"
                      : "적용하기 전에 확인해 주세요"}
                  </Text>
                  <Text style={st.pendingActionConfirmation}>{pendingAction.confirmation}</Text>
                </View>
              </View>
              {impactPreview && <BudgetImpactDetails preview={impactPreview} />}
              {pendingActionDisabledReason && (
                <Text style={st.pendingActionStatus} accessibilityLiveRegion="polite">
                  {pendingActionDisabledReason === "expired"
                    ? "안전을 위해 확인 시간이 지났어요. 아모라에게 다시 제안해 달라고 해주세요."
                    : pendingActionDisabledReason === "not_latest"
                      ? "새 대화가 이어져 이 제안은 적용할 수 없어요. 최신 내용으로 다시 확인해 주세요."
                      : "현재 답변이 끝나면 다시 확인할 수 있어요."}
                  </Text>
              )}
              {approvalCopy && (
                <View
                  style={[
                    st.pendingActionApprovalStatus,
                    matchingApproval?.error && st.pendingActionApprovalError,
                  ]}
                  accessibilityLiveRegion="polite"
                >
                  <Users
                    size={15}
                    color={matchingApproval?.error ? "#8A3D31" : "#2F5F51"}
                  />
                  <Text style={[
                    st.pendingActionApprovalText,
                    matchingApproval?.error && st.pendingActionApprovalErrorText,
                  ]}>
                    {approvalCopy}
                  </Text>
                </View>
              )}
              {pendingActionNotice?.actionId === pendingAction.actionId && (
                <Text style={st.pendingActionStatus} accessibilityLiveRegion="polite">
                  {pendingActionNotice.message}
                </Text>
              )}
              <View style={st.pendingActionControls}>
                <Pressable
                  style={({ pressed }) => [
                    st.pendingActionButton,
                    pressed && !pendingActionControlDisabled && { opacity: 0.82 },
                    pendingActionControlDisabled && st.pendingActionButtonDisabled,
                  ]}
                  onPress={() => handleApplyPendingAction(pendingAction.actionId)}
                  disabled={pendingActionControlDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={applyAccessibilityLabel}
                  accessibilityState={{ disabled: pendingActionControlDisabled }}
                >
                  {applyingPendingActionId === pendingAction.actionId
                  || approvalMutation === "confirm"
                  || approvalLoading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Check size={16} color="#FFF" />
                  )}
                  <Text style={st.pendingActionButtonText}>{applyLabel}</Text>
                </Pressable>
                {canWithdrawApproval && (
                  <Pressable
                    style={({ pressed }) => [
                      st.pendingActionDismiss,
                      pressed && { opacity: 0.72 },
                    ]}
                    onPress={() => handleWithdrawPendingAction(pendingAction.actionId)}
                    accessibilityRole="button"
                    accessibilityLabel="내 공동 변경 확인 취소"
                  >
                    <RotateCcw size={16} color="#795252" />
                    <Text style={st.pendingActionWithdrawText}>내 확인 취소</Text>
                  </Pressable>
                )}
                <Pressable
                  style={({ pressed }) => [st.pendingActionDismiss, pressed && { opacity: 0.72 }]}
                  onPress={() => setDismissedPendingActionIds((current) => {
                    const next = new Set(current);
                    next.add(pendingAction.actionId);
                    return next;
                  })}
                  disabled={applyingPendingActionId === pendingAction.actionId}
                  accessibilityRole="button"
                  accessibilityLabel="지금은 적용하지 않기"
                  accessibilityState={{ disabled: applyingPendingActionId === pendingAction.actionId }}
                >
                  <X size={16} color={colors.noir.soft} />
                  <Text style={st.pendingActionDismissText}>지금은 적용하지 않기</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  }

  const isP = activeScope === "shared" && target === "partner";

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <View style={st.header}>
        <View style={st.headerLeft}><View style={st.headerLogo}><Sparkles size={16} color={colors.gold.DEFAULT} /></View><View><Text style={st.headerTitle}>아모라</Text><Text style={st.headerSub}>AI 웨딩 플래너</Text></View></View>
        {scopedMessages.length > 0 && <StatusPill label={`${scopedMessages.length}`} tone="neutral" />}
      </View>

      <View style={st.scopeSection} accessibilityLabel="상담 공개 범위">
        <View style={st.scopeRow}>
          <Pressable
            disabled={streaming}
            accessibilityRole="tab"
            accessibilityLabel="함께 대화, 파트너에게 보임"
            accessibilityState={{ selected: activeScope === "shared", disabled: streaming }}
            style={[st.scopeBtn, activeScope === "shared" && st.scopeBtnActive]}
            onPress={() => handleScopeChange("shared")}
          >
            <Sparkles size={14} color={activeScope === "shared" ? colors.rose[500] : colors.textTertiary} />
            <Text style={[st.scopeText, activeScope === "shared" && st.scopeTextActive]}>함께 대화</Text>
          </Pressable>
          <Pressable
            disabled={streaming || userRole === null}
            accessibilityRole="tab"
            accessibilityLabel="나만 상담, 서비스에 저장되며 상대방에게 보이지 않음"
            accessibilityState={{ selected: activeScope === "private", disabled: streaming || userRole === null }}
            style={[st.scopeBtn, activeScope === "private" && st.privateScopeBtnActive]}
            onPress={() => handleScopeChange("private")}
          >
            <Lock size={14} color={activeScope === "private" ? "#5a6147" : colors.textTertiary} />
            <Text style={[st.scopeText, activeScope === "private" && st.privateScopeTextActive]}>나만 (상담)</Text>
          </Pressable>
        </View>
        <Text
          style={[st.scopeStatus, activeScope === "private" && st.privateScopeStatus]}
          accessibilityLiveRegion="polite"
        >
          {activeScope === "private"
            ? "현재 범위 · 나만 (상담) — 서비스에 저장되며 상대방에게는 보이지 않아요"
            : hasLinkedPartner
              ? "현재 범위 · 함께 대화 — 파트너에게 보여요"
              : "현재 범위 · 함께 대화 — 파트너 연결 후 함께 볼 수 있어요"}
        </Text>
      </View>

      {activeScope === "shared" && (
        <View style={st.targetRow}>
          <Pressable disabled={streaming} accessibilityState={{ disabled: streaming }} style={[st.targetBtn, !isP && st.targetActive]} onPress={() => handleTargetChange("ai")}><Sparkles size={14} color={!isP ? colors.gold.DEFAULT : colors.textTertiary} /><Text style={[st.targetText, !isP && st.targetTextActive]}>아모라</Text></Pressable>
          {hasLinkedPartner && (
            <Pressable disabled={streaming} accessibilityState={{ disabled: streaming }} style={[st.targetBtn, isP && st.targetPartner]} onPress={() => handleTargetChange("partner")}><Heart size={14} color={isP ? colors.rose[500] : colors.textTertiary} /><Text style={[st.targetText, isP && st.targetTextPartner]}>{partnerName ?? "파트너"}</Text></Pressable>
          )}
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {!initialLoaded ? (
          <View style={st.loading}>
            <ActivityIndicator color={colors.rose[500]} />
            <Text style={st.loadingText}>대화를 준비하는 중이에요</Text>
          </View>
        ) : scopedMessages.length === 0 ? (
          <View style={st.empty}>
            <EmptyState
              icon={
                <IconBadge tone="noir" size={64}>
                  <Sparkles size={28} color={colors.gold.DEFAULT} />
                </IconBadge>
              }
              title={activeScope === "private" ? "나만의 상담을 시작해볼까요?" : "안녕하세요, 아모라예요"}
              description={activeScope === "private"
                ? "이 범위의 대화는 서비스에 저장되지만 상대방에게는 보이지 않아요.\n아모라에게 편하게 이야기해 주세요."
                : hasLinkedPartner
                  ? "결혼 준비 뭐든 물어보세요.\n파트너에게도 메시지를 보낼 수 있어요."
                  : "결혼 준비 뭐든 물어보세요.\n파트너 연결 전에는 아모라와 먼저 준비할 수 있어요."}
            />
            {!isP && (
              <View style={st.suggestions}>{["웨딩 사진 촬영 예산을 정리해줘", "지금 먼저 할 일 세 가지를 알려줘", "결혼식장 계약 전에 무엇을 확인해야 해?"].map((q) => (<Pressable key={q} style={({ pressed }) => [st.sugBtn, pressed && { opacity: 0.85 }]} onPress={() => handleAiSuggestion(q)}><Text style={st.sugText}>{q}</Text></Pressable>))}</View>
            )}
          </View>
        ) : (
          <FlatList ref={flatListRef} data={visibleMessages} inverted keyExtractor={(m) => m.id} renderItem={renderMessage} contentContainerStyle={st.messageList} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === "android"} maxToRenderPerBatch={10} windowSize={5} initialNumToRender={12} />
        )}

        {quotaRemaining !== null && !streaming && (
          <View style={st.quotaBar} accessibilityLiveRegion="polite">
            <Text style={st.quotaText}>
              {quotaRemaining > 0
                ? `베타 무료 상담이 ${quotaRemaining}회 남았어요.`
                : "베타 무료 상담을 모두 사용했어요."}
            </Text>
            <Pressable
              style={({ pressed }) => [st.quotaDismiss, pressed && { opacity: 0.62 }]}
              onPress={() => setQuotaRemaining(null)}
              accessibilityRole="button"
              accessibilityLabel="사용량 안내 닫기"
            >
              <X size={17} color={colors.taupe[500]} />
            </Pressable>
          </View>
        )}

        {partnerSafetyNotice && (
          <View style={st.failureBar} accessibilityLiveRegion="assertive">
            <Text style={st.failureText} accessibilityRole="alert">
              {partnerSafetyNotice}
            </Text>
            <Pressable
              style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
              onPress={() => setPartnerSafetyNotice(null)}
              accessibilityRole="button"
              accessibilityLabel="상대방 연결 변경 안내 확인"
            >
              <Text style={st.retryText}>확인</Text>
            </Pressable>
          </View>
        )}

        {activeSendFailure && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {activeSendFailure.message}
            </Text>
            {activeSendFailure.kind === "ai_response" && activeSendFailure.unavailableReason && (
              <Text style={st.failureText}>{activeSendFailure.unavailableReason}</Text>
            )}
            {(activeSendFailure.kind !== "ai_response" || activeSendFailure.canRetry) && (
              <Pressable
                style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
                onPress={handleRetry}
                disabled={streaming}
                accessibilityRole="button"
                accessibilityLabel={
                  isConfirmedActionRecovery
                    ? "확인한 변경 반영 계속하기"
                    : activeSendFailure.kind === "ai_response"
                      ? "아모라 답변 다시 받기"
                      : "메시지 다시 보내기"
                }
              >
                <Text style={st.retryText}>
                  {isConfirmedActionRecovery
                    ? "반영 계속하기"
                    : activeSendFailure.kind === "ai_response"
                      ? "답변 다시 받기"
                      : "다시 보내기"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={[st.inputBar, isP && { borderTopColor: colors.rose.light }]}>
          <TextInput style={st.input} value={input} onChangeText={handleInputChange} placeholder={isP ? `${partnerName ?? "파트너"}에게 메시지...` : activeScope === "private" ? "나만의 상담을 입력하세요..." : "메시지를 입력하세요..."} placeholderTextColor={colors.taupe[400]} multiline maxLength={4000} editable={!streaming} returnKeyType="send" accessibilityLabel="메시지 입력" />
          <Animated.View style={{ transform: [{ scale: sendBtnScale }] }}>
            <Pressable style={[st.sendBtn, isP && { backgroundColor: colors.rose[500] }, (!input.trim() || streaming) && st.sendBtnOff]} onPress={handleSend} onPressIn={pressIn} onPressOut={pressOut} disabled={!input.trim() || streaming} accessibilityLabel="메시지 보내기" accessibilityRole="button">
              {isP ? <Heart size={18} color="#FFF" /> : <Send size={18} color="#FFF" />}
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerLogo: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.noir[800], alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  headerSub: { fontSize: 11, color: colors.textTertiary },
  scopeSection: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  scopeRow: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, backgroundColor: colors.ivory.warm },
  scopeBtn: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10 },
  scopeBtnActive: { backgroundColor: colors.surface },
  privateScopeBtnActive: { backgroundColor: colors.surface },
  scopeText: { fontSize: 13, color: colors.textTertiary, fontWeight: "500" },
  scopeTextActive: { color: colors.rose[500], fontWeight: "600" },
  privateScopeTextActive: { color: "#5a6147", fontWeight: "600" },
  scopeStatus: { paddingHorizontal: 4, paddingTop: 6, fontSize: 11, lineHeight: 16, color: colors.rose[500] },
  privateScopeStatus: { color: "#5a6147" },
  targetRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  targetBtn: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  targetActive: { borderBottomWidth: 2, borderBottomColor: colors.noir[800] },
  targetPartner: { borderBottomWidth: 2, borderBottomColor: colors.rose[500] },
  targetText: { fontSize: 14, color: colors.textTertiary },
  targetTextActive: { color: colors.noir[800], fontWeight: "600" },
  targetTextPartner: { color: colors.rose[500], fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 13, color: colors.textTertiary },
  suggestions: { width: "100%", gap: 8 },
  sugBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sugText: { fontSize: 14, color: colors.noir[800] },
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgRowRight: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  messageBody: { maxWidth: "78%" },
  safetyMessageBody: { flex: 1, maxWidth: "92%" },
  mediationMessageBody: { maxWidth: "92%", flex: 1 },
  placeMessageBody: { flex: 1, maxWidth: 460 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarAi: { backgroundColor: colors.noir[800] },
  avatarBride: { backgroundColor: "#F5E6DF" },
  avatarGroom: { backgroundColor: "#E8EDF5" },
  avatarLetter: { fontSize: 8, fontWeight: "700", color: colors.noir[800] },
  senderLabel: { fontSize: 11, color: colors.textTertiary, marginBottom: 4, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleRight: { borderBottomRightRadius: 4 },
  bubbleLeft: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  safetyCard: { width: "100%", padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.ivory[50] },
  safetyCardHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  safetyCardTitle: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  safetyCardText: { marginTop: 8, fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  pendingActionCard: { width: "100%", marginTop: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: "#D8C7BB", backgroundColor: "#FFFCF8" },
  pendingActionHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  pendingActionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#F2E8DE" },
  pendingActionCopy: { flex: 1 },
  pendingActionTitle: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  pendingActionConfirmation: { marginTop: 4, fontSize: 14, lineHeight: 21, color: colors.noir.soft },
  pendingActionStatus: { marginTop: 10, fontSize: 12, lineHeight: 18, color: "#795252" },
  pendingActionApprovalStatus: { marginTop: 10, flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, backgroundColor: "#F2F7F4" },
  pendingActionApprovalError: { backgroundColor: "#FFF2EF" },
  pendingActionApprovalText: { flex: 1, fontSize: 12, lineHeight: 18, color: "#2F5F51" },
  pendingActionApprovalErrorText: { color: "#8A3D31" },
  pendingActionControls: { marginTop: 12, gap: 8 },
  pendingActionButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#2F5F51" },
  pendingActionButtonDisabled: { backgroundColor: colors.taupe[400] },
  pendingActionButtonText: { fontSize: 14, fontWeight: "700", color: "#FFF" },
  pendingActionDismiss: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "#D8C7BB", backgroundColor: colors.surface },
  pendingActionDismissText: { fontSize: 14, fontWeight: "600", color: colors.noir.soft },
  pendingActionWithdrawText: { fontSize: 14, fontWeight: "600", color: "#795252" },
  budgetImpactCard: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E5D8CE", backgroundColor: "rgba(255,255,255,0.82)" },
  budgetImpactTitle: { marginBottom: 6, fontSize: 12, fontWeight: "700", color: colors.noir[800] },
  budgetImpactRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10, paddingVertical: 3 },
  budgetImpactLabel: { width: 86, fontSize: 11, lineHeight: 17, color: "#746866" },
  budgetImpactValue: { flex: 1, textAlign: "right", fontSize: 11, lineHeight: 17, fontWeight: "600", color: "#3D3434" },
  budgetImpactDelta: { fontWeight: "400", color: "#867976" },
  budgetImpactWarnings: { marginTop: 8, gap: 3, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 9, backgroundColor: "#FFF2EF" },
  budgetImpactWarningText: { fontSize: 11, lineHeight: 17, color: "#8A3D31" },
  budgetImpactDisclaimer: { marginTop: 8, fontSize: 10, lineHeight: 15, color: "#746866" },
  quotaBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, backgroundColor: colors.ivory.warm, borderTopWidth: 1, borderTopColor: colors.border },
  quotaText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.noir.soft },
  quotaDismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  failureBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.ivory.warm, borderTopWidth: 1, borderTopColor: colors.rose.light },
  failureText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.noir.soft },
  retryBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.noir[800] },
  retryText: { fontSize: 14, fontWeight: "600", color: colors.surface },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.noir[800], backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.rose[500], alignItems: "center", justifyContent: "center" },
  sendBtnOff: { backgroundColor: colors.taupe[400] },
});
