// AI 채팅 (아모라) + 파트너 메시지 — 웹과 동일 chat_messages 연동
// 색은 성별이 아니라 나/상대/AI 축으로 가른다. 라벨은 이름을 쓴다.
import { useState, useRef, useEffect, useCallback, useMemo, type SetStateAction } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator, Linking, AppState } from "react-native";
import { buildMobileSiteUrl, resolveMobileSiteOrigin } from "@/lib/siteUrl.mjs";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Check, Send, ShieldCheck, Sparkles, Heart, X, Lock, RotateCcw, User, Users } from "lucide-react-native";
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
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import {
  buildAmoraActionConfirmationOutcomes,
  getAmoraPendingActionApplicationState,
  buildAmoraConversationRecap,
} from "@hanbang/shared";
import {
  assertAmoraRequestActor,
  assertSharedActionActor,
} from "@/lib/amoraSharedActionActorFence.mjs";
import { normalizeMediationBlock } from "@/lib/amoraMediation";
import {
  describeAmoraCitations,
  parseAmoraCitations,
} from "@/lib/amoraCitations.mjs";
import {
  consumePendingAmoraFirstHello,
  getDeliveredAmoraFirstHello,
} from "@/lib/amoraFirstHello";
import {
  AMORA_CHAT_ENTRY_PARAM,
  getAmoraChatEntryPrefill,
} from "@/lib/amoraChatEntry";
import { createChatSessionGenerationGuard } from "@/lib/chatSessionGeneration";
import {
  CARRIED_PENDING_ACTION_LABEL,
  getAmoraActionApprovalPolicy,
  getPendingAmoraAction,
  getPendingAmoraActionCarryCount,
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  getSharedActionApprovalPresentation,
  isPendingActionPastDated,
  parseSharedActionApplicationClaim,
  parseSharedActionApprovalStatus,
  PAST_SCHEDULE_DATE_NOTICE,
  type PendingActionDisabledReason,
  type SharedActionApplicationClaim,
  type SharedActionApprovalStatus,
} from "@/lib/pendingAmoraAction";
import {
  chatVisibilityForScope,
  readChatViewCursors,
  hasChatViewCursorAdvanced,
  isMessageAfterChatViewCursor,
  buildChatViewCursorFilter,
  withChatViewCursor,
  isMessageInAiContext,
  isMessageInChatScope,
  selectChatScope,
  type ChatScope,
  type ChatViewCursors,
} from "@/lib/chatPrivacyScope";
import { PlaceCards } from "@/components/chat/PlaceCards";
import { ToolResultCard } from "@/components/chat/ToolResultCard";
import { PersonalActionSave } from "@/components/chat/PersonalActionSave";
import { AmoraConversationRecap } from "@/components/chat/AmoraConversationRecap";
import { personalActionContinuation } from "@/lib/personalActionContinuation";
import {
  dedupeToolResultCards,
  getToolResultCardModel,
} from "@/components/chat/toolResultCardModel";
import { EmptyState, IconBadge, StatusPill } from "@/components/ui/AppUI";
import AmoraMediationCard from "@/components/chat/AmoraMediationCard";

// 사이트 주소는 헬퍼로 짓는다. 운영에서 EXPO_PUBLIC_SITE_URL 이 없거나 안전하지
// 않으면 이 헬퍼가 던진다 — 하드코딩하면 그 보호가 사라진다.
const amoraSiteOrigin = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const AI_POLICY_URL = buildMobileSiteUrl("/ai-policy", amoraSiteOrigin);

const API_BASE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";
const CHAT_REQUEST_TIMEOUT_MS = 180_000;
const CHAT_INGEST_TIMEOUT_MS = 30_000;
const PARTNER_CONNECTION_CHANGED_NOTICE =
  "상대방 연결 상태가 바뀌어 메시지를 보내지 않았어요. 잘못 전달되지 않도록 작성 중인 초안은 삭제했어요.";
const NEW_CHAT_MESSAGE_REQUIRED_NOTICE =
  "같은 요청을 다시 보내도 해결되지 않아요. 내용을 확인한 뒤 새 메시지로 보내주세요.";
/**
 * 아모라가 먼저 건넨 첫마디의 자리.
 *
 * chat_messages에 저장하지 않는다 — 이건 대화 기록이 아니라 인사이고, DB에 남기면 모델이
 * 나중에 "내가 그렇게 말했다"를 근거로 삼는다. 그래서 화면에만 놓이는 로컬 메시지이고,
 * 서버로 보내는 대화 맥락(messages)에도 들어가지 않는다.
 */
const AMORA_FIRST_HELLO_MESSAGE_ID = "amora_first_hello_local";
/**
 * 처음 온 사람이 무엇부터 물어볼지 고르는 칩.
 *
 * 빈 화면에만 있었는데, 아모라가 먼저 건넨 첫마디가 놓이면 화면은 더 이상 비어 있지 않다.
 * 그때 칩까지 사라지면 정작 칩이 가장 필요한 사람이 칩을 못 본다. 그래서 목록을 여기 한 벌만
 * 두고 두 자리에서 같이 쓴다.
 */
const AMORA_STARTER_PROMPTS = [
  "웨딩 사진 촬영 예산을 정리해줘",
  "지금 먼저 할 일 세 가지를 알려줘",
  "결혼식장 계약 전에 무엇을 확인해야 해?",
] as const;

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
  sourceLane: AmoraChatLane;
  target: "ai";
  clientRequestId: string;
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  senderName: string;
  requestedVisibility: ChatMessageVisibility;
  visibility: ChatMessageVisibility;
  providerAttachmentCount: number;
  durableUserMessageId?: string;
  recoveredProviderAttachmentState?: "none" | "discarded_by_safety_policy";
  sessionGeneration: number;
  confirmedActionId?: string;
  amoraSourceMessageId?: string;
}

interface AiMessageIngestExpected {
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  text: string;
  clientRequestId: string;
  target: MessageTarget;
  providerAttachmentCount: number;
  partnerRecipientId?: string;
  confirmedActionId?: string;
}

type AiSafetyResolution = "non_immediate_safety" | "immediate_crisis";

type AiMessageIngestResult =
  | {
      outcome: "persisted";
      reused: boolean;
      effectiveVisibility: ChatMessageVisibility;
      safetyPrivacyRedirected: boolean;
      safetyResolution: AiSafetyResolution | null;
      message: ChatMessage;
    }
  | {
      outcome: "ephemeral_safety";
      effectiveVisibility: ChatMessageVisibility;
      safetyPrivacyRedirected: boolean;
      partnerDeliveryHeld: boolean;
      safetyResolution: AiSafetyResolution;
      classification: string | null;
      response: string;
      rawDisclosurePersisted: boolean | null;
      rawDisclosureVisibility: ChatMessageVisibility | null;
    };

type RawDisclosurePersistence = "none" | "shared" | "private_only" | "unknown";

interface EphemeralSafetyPersistencePresentation {
  notice: string;
  persistence: RawDisclosurePersistence;
  rawDisclosureShared: boolean | null;
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
  target: "partner";
  clientRequestId: string;
  partnerRecipientId: string;
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  requestedVisibility: "shared";
  visibility: "shared";
  providerAttachmentCount: 0;
  sessionGeneration: number;
}

type SendFailure =
  | {
      kind: "partner_ingest";
      message: string;
      draft: PartnerDraft;
      canRetry: boolean;
      unavailableReason: string | null;
    }
  | {
      kind: "ai_insert";
      message: string;
      draft: AiDraft;
      canRetry: boolean;
      unavailableReason: string | null;
    }
  | {
      kind: "ai_response";
      message: string;
      request: AiRequest;
      canRetry: boolean;
      unavailableReason: string | null;
    };

type PartnerRecipientVerification = "verified" | "unlinked" | "unavailable";

type ProviderAttachmentState = "none" | "present" | "discarded_by_safety_policy";

interface ColdStartAiRecoveryContext {
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  visibility: ChatMessageVisibility;
}

interface ColdStartAiRecovery {
  disposition: "resumable" | "reattach_required";
  lane: Exclude<AmoraChatLane, "shared_partner">;
  userMessageId: string;
  clientRequestId: string;
  content: string;
  visibility: ChatMessageVisibility;
  providerAttachmentState: ProviderAttachmentState | "unknown";
  providerAttachmentCount: number | null;
}

function mergeColdStartRecoveryHistory(
  boundedHistory: readonly ChatMessage[],
  supplementalCanonicalTurns: readonly (ChatMessage | null)[],
): ChatMessage[] {
  const messagesById = new Map<string, ChatMessage>();
  for (const message of boundedHistory) messagesById.set(message.id, message);
  for (const message of supplementalCanonicalTurns) {
    if (message) messagesById.set(message.id, message);
  }

  return [...messagesById.values()].sort((left, right) => {
    const byCreatedAt =
      new Date(left.created_at ?? 0).getTime()
      - new Date(right.created_at ?? 0).getTime();
    return byCreatedAt || left.id.localeCompare(right.id);
  });
}

function findColdStartAiRecovery(
  messages: readonly ChatMessage[],
  context: ColdStartAiRecoveryContext,
): ColdStartAiRecovery | null {
  const ownPrivateVisibility: ChatMessageVisibility = `${context.senderType}_private`;
  if (
    context.visibility !== "shared"
    && context.visibility !== ownPrivateVisibility
  ) return null;

  const canonicalLaneMessages = messages
    .filter((message) => (
      message.couple_id === context.coupleId
      && message.visibility === context.visibility
      && message.metadata?.target !== "partner"
    ))
    .sort((left, right) => {
      const byCreatedAt =
        new Date(left.created_at ?? 0).getTime()
        - new Date(right.created_at ?? 0).getTime();
      return byCreatedAt || left.id.localeCompare(right.id);
    });
  const latestLaneRow = canonicalLaneMessages[canonicalLaneMessages.length - 1];
  const candidate = [...canonicalLaneMessages].reverse().find((message) => (
    message.couple_id === context.coupleId
    && message.sender_id === context.userId
    && message.sender_type === context.senderType
    && message.role === "user"
    && message.visibility === context.visibility
    && (
      message.metadata?.target === undefined
      || message.metadata.target === "ai"
    )
    && message.metadata?.pinned_safety_card !== true
  ));
  if (!candidate?.metadata) return null;
  if (latestLaneRow?.id !== candidate.id) return null;

  const metadata = candidate.metadata;
  const providerAttachmentState: ProviderAttachmentState | "unknown" =
    metadata.provider_attachment_state === "none"
    || metadata.provider_attachment_state === "present"
    || metadata.provider_attachment_state === "discarded_by_safety_policy"
    ? metadata.provider_attachment_state
    : "unknown";
  const providerAttachmentCount = Number.isSafeInteger(
    metadata.provider_attachment_count,
  ) && (metadata.provider_attachment_count as number) >= 0
    ? metadata.provider_attachment_count as number
    : null;
  const providerAttachmentManifest = metadata.provider_attachment_manifest;
  const hasCanonicalV2AttachmentManifest =
    metadata.amora_ingest_contract_version === 2
    && providerAttachmentState === "present"
    && providerAttachmentCount !== null
    && providerAttachmentCount > 0
    && Array.isArray(providerAttachmentManifest)
    && providerAttachmentManifest.length === providerAttachmentCount
    && providerAttachmentManifest.every((entry) => {
      if (!isRecord(entry) || Object.keys(entry).length !== 3) return false;
      return typeof entry.media_type === "string"
        && entry.media_type.length > 0
        && Number.isSafeInteger(entry.byte_length)
        && (entry.byte_length as number) > 0
        && typeof entry.sha256 === "string"
        && /^[0-9a-f]{64}$/.test(entry.sha256);
    });
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const hasSupportedIngestContract =
    metadata.amora_ingest_contract_version === 1
    || hasCanonicalV2AttachmentManifest;
  if (
    !hasSupportedIngestContract
    || metadata.ai_response_requested !== true
    || typeof metadata.client_request_id !== "string"
    || !uuidPattern.test(candidate.id)
    || !uuidPattern.test(metadata.client_request_id)
    || metadata.confirmed_amora_action_id !== undefined
  ) return null;

  const visibleRequestKey = `chat:${context.userId}:${metadata.client_request_id}`;
  const hasAssistantReply = messages.some((message) => (
    message.couple_id === context.coupleId
    && message.sender_type === "ai"
    && message.role === "assistant"
    && message.visibility === candidate.visibility
    && (
      message.metadata?.in_reply_to_user_message_id === candidate.id
      || message.metadata?.client_visible_request_id === visibleRequestKey
      || message.metadata?.client_request_id === visibleRequestKey
      || message.metadata?.client_visible_request_id === metadata.client_request_id
      || message.metadata?.client_request_id === metadata.client_request_id
    )
  ));
  if (hasAssistantReply) return null;

  const disposition = providerAttachmentCount === 0
    && (
      providerAttachmentState === "none"
      || providerAttachmentState === "discarded_by_safety_policy"
    )
    ? "resumable"
    : "reattach_required";

  return {
    disposition,
    lane: context.visibility === "shared" ? "shared_ai" : "private_ai",
    userMessageId: candidate.id,
    clientRequestId: metadata.client_request_id,
    content: candidate.content,
    visibility: candidate.visibility,
    providerAttachmentState,
    providerAttachmentCount,
  };
}

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

/**
 * 이 앱이 카드로 그릴 수 있는 도구.
 *
 * 장소 검색(`PlaceCards`)과, 2026-09-04 부터 예산·일정·체크리스트·할 일 변경의 결과
 * (`ToolResultCard`). 카드를 새로 만들면 여기에 더한다 — 더하지 않으면 서버가 계속
 * 글로 답하게 두므로 사용자는 답을 받는다.
 */
// 펼침(spread) 없이 이름을 그대로 적는다 — chatStream.test.mjs 가 이 줄을 소스에서 리터럴로
// 뽑아 평가한다. 모델(`TOOL_RESULT_CARD_TOOLS`)과 같은지는 toolResultCard.test.mjs 가 잰다.
const MOBILE_RENDERED_TOOLS = [
  "search_nearby_places",
  "update_budget",
  "update_category_budget",
  "add_custom_category",
  "apply_budget_plan",
  "update_wedding_date",
  "update_venue",
  "update_task_status",
  "toggle_checklist_item",
  "add_schedule_event",
  "update_schedule_event",
  "cancel_schedule_event",
  "restore_schedule_event",
  "add_amora_action",
  "log_wedding_event",
] as const;

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

class AiMessageIngestError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly serverCode: string | null,
    public readonly retryPolicy: "same_request" | "new_message",
    public readonly retryAfterMs: number | null = null,
  ) {
    super(serverCode ?? "AI_MESSAGE_INGEST_FAILED");
    this.name = "AiMessageIngestError";
    this.retryable = retryPolicy === "same_request";
  }

  public readonly retryable: boolean;
}

function parseRetryAfterMs(
  value: string | null,
  nowMs = Date.now(),
): number | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const seconds = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  const unboundedMs = Number.isSafeInteger(seconds)
    ? seconds * 1_000
    : Date.parse(normalized) - nowMs;
  if (!Number.isFinite(unboundedMs) || unboundedMs < 0) return null;
  return Math.min(unboundedMs, 5 * 60_000);
}

function getAiMessageIngestFailureMessage(
  error: unknown,
  isConfirmedAction: boolean,
): string {
  if (error instanceof AiMessageIngestError) {
    if (error.status === 401) {
      return "로그인이 만료됐어요. 다시 로그인한 뒤 메시지를 보내 주세요.";
    }
    if (error.status === 403) {
      return "현재 대화 권한을 확인하지 못했어요. 연결 상태를 새로고침해 주세요.";
    }
    if (error.status === 409) {
      return "같은 전송 식별 정보가 다른 메시지와 충돌했어요. 내용을 확인해 새 메시지로 보내주세요.";
    }
    if (error.status === 429) {
      const retrySeconds = error.retryAfterMs === null
        ? null
        : Math.max(1, Math.ceil(error.retryAfterMs / 1_000));
      return retrySeconds === null
        ? "요청이 잠시 몰렸어요. 조금 뒤 같은 메시지로 다시 시도해 주세요."
        : `요청이 잠시 몰렸어요. ${retrySeconds}초 후 같은 메시지로 다시 시도해 주세요.`;
    }
  }
  if (isConfirmedAction) {
    return "반영 요청을 끝내지 못했어요. 확인은 유지되니 이어서 완료해 주세요.";
  }
  if (error instanceof AiMessageIngestError && error.retryable) {
    return "전송 결과를 확인하지 못했어요. 같은 메시지로 다시 확인해 주세요.";
  }
  return "질문을 안전하게 저장하지 못했어요. 내용을 확인해 새 메시지로 보내주세요.";
}

function getEphemeralSafetyPersistencePresentation(
  rawDisclosurePersisted: boolean | null,
  rawDisclosureVisibility: ChatMessageVisibility | null,
  partnerDeliveryHeld: boolean,
): EphemeralSafetyPersistencePresentation {
  const wasShared = rawDisclosurePersisted === true
    && (rawDisclosureVisibility === "shared" || partnerDeliveryHeld);
  const persistence: RawDisclosurePersistence = rawDisclosurePersisted === false
    ? "none"
    : wasShared
      ? "shared"
      : rawDisclosureVisibility === "bride_private"
          || rawDisclosureVisibility === "groom_private"
        ? "private_only"
        : "unknown";
  const rawDisclosureShared = rawDisclosurePersisted === null
    || persistence === "unknown"
    ? null
    : wasShared;
  const notice = rawDisclosurePersisted === false
    ? "안전을 위해 이 내용은 상대방에게 공유하거나 저장하지 않았어요."
    : rawDisclosurePersisted === null
      ? "이 내용의 이전 저장·전달 여부를 지금 확인하지 못했어요. 추가 공유와 AI 전송은 멈추고 안전 안내만 보여드려요."
      : wasShared
        ? "이 내용은 이전 전송에서 이미 상대방에게 전달·저장됐어요. 지금은 추가 공유와 AI 전송을 멈추고 안전 안내만 보여드려요."
        : persistence === "private_only"
          ? "이 내용은 이전 전송에서 비공개 대화에 이미 저장됐어요. 지금은 추가 전송을 멈추고 안전 안내만 보여드려요."
          : "이 내용은 이전 전송에서 이미 저장됐지만 저장 범위는 지금 확인하지 못했어요. 추가 공유와 AI 전송은 멈추고 안전 안내만 보여드려요.";
  return { notice, persistence, rawDisclosureShared };
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

function parseAiMessageIngestResult(
  status: number,
  value: unknown,
  expected: AiMessageIngestExpected,
  retryAfterMs: number | null = null,
): AiMessageIngestResult {
  if (status >= 200 && status < 300 && isRecord(value)) {
    const effectiveVisibility = normalizeChatVisibility(value.effectiveVisibility);
    const ownPrivateVisibility: ChatMessageVisibility = `${expected.senderType}_private`;
    const expectedTarget = expected.target;
    const expectedPartnerDeliveryHeld = expectedTarget === "partner";
    const rawDisclosurePersisted = typeof value.rawDisclosurePersisted === "boolean"
      || value.rawDisclosurePersisted === null
      ? value.rawDisclosurePersisted
      : undefined;
    const rawDisclosureVisibility = normalizeChatVisibility(value.rawDisclosureVisibility);
    const rawDisclosureVisibilityIsValid = value.rawDisclosureVisibility === undefined
      || value.rawDisclosureVisibility === null
      || rawDisclosureVisibility !== null;
    const rawDisclosureVisibilityMatchesPersistence = rawDisclosurePersisted === true
      || rawDisclosureVisibility === null;
    const safetyResolution = value.safetyResolution === "non_immediate_safety"
      || value.safetyResolution === "immediate_crisis"
      ? value.safetyResolution
      : null;
    const ephemeralSafetyResolutionMatches = safetyResolution === "immediate_crisis"
      || (
        expectedTarget === "partner"
        && safetyResolution === "non_immediate_safety"
      );
    if (
      status === 200
      && value.outcome === "ephemeral_safety"
      && effectiveVisibility === ownPrivateVisibility
      && typeof value.safetyPrivacyRedirected === "boolean"
      && value.partnerDeliveryHeld === expectedPartnerDeliveryHeld
      && safetyResolution !== null
      && ephemeralSafetyResolutionMatches
      && (typeof value.classification === "string" || value.classification === null)
      && typeof value.response === "string"
      && value.response.trim().length > 0
      && value.response.length <= 4_000
      && rawDisclosurePersisted !== undefined
      && rawDisclosureVisibilityIsValid
      && rawDisclosureVisibilityMatchesPersistence
    ) {
      return {
        outcome: "ephemeral_safety",
        effectiveVisibility,
        safetyPrivacyRedirected: value.safetyPrivacyRedirected,
        partnerDeliveryHeld: expectedPartnerDeliveryHeld,
        safetyResolution,
        classification: value.classification,
        response: value.response,
        rawDisclosurePersisted,
        rawDisclosureVisibility,
      };
    }
    const message = chatMessageFromRealtimeRow(value.message);
    const targetMatches = expectedTarget === "partner"
      ? message?.metadata?.target === "partner"
        && typeof expected.partnerRecipientId === "string"
        && message.metadata.partner_recipient_id === expected.partnerRecipientId
      : (
          message?.metadata?.target === undefined
          || message.metadata.target === "ai"
        )
        && message?.metadata?.partner_recipient_id === undefined;
    const persistedVisibilityMatchesTarget = expectedTarget === "partner"
      ? effectiveVisibility === "shared"
      : effectiveVisibility === "shared" || effectiveVisibility === ownPrivateVisibility;
    const canonicalConfirmedActionId =
      typeof message?.metadata?.confirmed_amora_action_id === "string"
        ? message.metadata.confirmed_amora_action_id
        : null;
    const expectedConfirmedActionId = expected.confirmedActionId ?? null;
    const confirmedActionMatches = value.safetyPrivacyRedirected === true
      ? canonicalConfirmedActionId === null
      : canonicalConfirmedActionId === expectedConfirmedActionId;
    const canonicalProviderAttachmentCount = value.safetyPrivacyRedirected === true
      ? 0
      : expected.providerAttachmentCount;
    const canonicalProviderAttachmentState = value.safetyPrivacyRedirected === true
      && expected.providerAttachmentCount > 0
      ? "discarded_by_safety_policy"
      : canonicalProviderAttachmentCount > 0
        ? "present"
        : "none";
    const ingestContractMatches =
      message?.metadata?.amora_ingest_contract_version === 1
      && message.metadata.ai_response_requested === (expectedTarget === "ai")
      && message.metadata.provider_attachment_state === canonicalProviderAttachmentState
      && message.metadata.provider_attachment_count === canonicalProviderAttachmentCount;
    const safetyContractMatches = value.safetyPrivacyRedirected === true
      ? effectiveVisibility === ownPrivateVisibility
        && safetyResolution === "non_immediate_safety"
      : safetyResolution === null;
    if (
      value.outcome === "persisted"
      && typeof value.reused === "boolean"
      && status === (value.reused ? 200 : 201)
      && typeof value.safetyPrivacyRedirected === "boolean"
      && safetyContractMatches
      && confirmedActionMatches
      && ingestContractMatches
      && targetMatches
      && effectiveVisibility !== null
      && persistedVisibilityMatchesTarget
      && message !== null
      && message.couple_id === expected.coupleId
      && message.sender_id === expected.userId
      && message.sender_type === expected.senderType
      && message.role === "user"
      && message.content === expected.text
      && message.visibility === effectiveVisibility
      && message.metadata?.client_request_id === expected.clientRequestId
    ) {
      return {
        outcome: "persisted",
        reused: value.reused,
        effectiveVisibility,
        safetyPrivacyRedirected: value.safetyPrivacyRedirected,
        safetyResolution,
        message,
      };
    }
  }
  const serverCode = isRecord(value)
    && typeof value.code === "string"
    && /^[A-Z0-9_]{1,96}$/.test(value.code)
    ? value.code
    : null;
  const retryPolicy = status === 408
    || status === 429
    || status >= 500
    || (status >= 200 && status < 300)
    || (
      isRecord(value)
      && value.retryPolicy === "same_request"
    )
    ? "same_request"
    : "new_message";
  throw new AiMessageIngestError(
    status,
    serverCode,
    retryPolicy,
    status === 429 ? retryAfterMs : null,
  );
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

/** 저장된 장소 검색 결과에는 제공자 텍스트가 없고 이 표만 붙는다. (2026-09-03) */
function isPlaceSearchPlaceholder(result: ToolExecutionResult): boolean {
  return result.toolName === "search_nearby_places"
    && result.toolOutput.displayOnlyPlaceholder === true;
}

function asChatMessageMetadata(value: unknown): ChatMessageMetadata | null {
  if (!isRecord(value)) return null;
  const toolResults = Array.isArray(value.toolResults)
    ? value.toolResults
      .map(asToolExecutionResult)
      .filter((result): result is ToolExecutionResult =>
        // 네이버 항목이 실린 결과는 예전처럼 받지 않는다. 우리 값만 남은 자리표시는
        // 받아서 다시 열었을 때 카드 자리를 그린다(2026-09-03).
        result !== null
        && (result.toolName !== "search_nearby_places" || isPlaceSearchPlaceholder(result))
      )
    : undefined;
  const metadata = { ...value };
  if (toolResults) metadata.toolResults = toolResults;
  else delete metadata.toolResults;
  return metadata as ChatMessageMetadata;
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
    // 이 앱이 실제로 카드로 그릴 수 있는 도구를 알린다.
    //
    // 서버는 도구 결과 뒤에 "이 결과는 카드로 자동 표시되니 텍스트로 나열하지
    // 마세요" 라는 지시를 붙이는데, 그 판정이 클라이언트를 구분하지 않았다.
    // 모바일에는 견적·계약 확인·하객 보증 카드가 없어서, 모델은 답을 글로도
    // 쓰지 않고 카드도 안 나와 **화면에 아무것도 남지 않았다.**
    xhr.setRequestHeader(
      "x-hanbang-rendered-tools",
      MOBILE_RENDERED_TOOLS.join(","),
    );
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

async function requestAiMessageIngest(
  draft: AiDraft | PartnerDraft,
): Promise<AiMessageIngestResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new AiMessageIngestError(401, "AUTH_REQUIRED", "new_message");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_INGEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        coupleId: draft.coupleId,
        content: draft.text,
        clientRequestId: draft.clientRequestId,
        requestedVisibility: draft.requestedVisibility,
        target: draft.target,
        providerAttachmentCount: draft.target === "partner"
          ? 0
          : draft.providerAttachmentCount,
        ...("confirmedActionId" in draft && draft.confirmedActionId
          ? { confirmedActionId: draft.confirmedActionId }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch {
    throw new AiMessageIngestError(null, null, "same_request");
  } finally {
    clearTimeout(timeout);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A malformed response can hide a committed INSERT. The only safe retry
    // is the same immutable client request id, which the server reconciles.
  }
  const expectedCanonicalMetadata = "confirmedActionId" in draft && draft.confirmedActionId
    ? {
        confirmed_amora_action_id: draft.confirmedActionId,
        client_request_id: draft.clientRequestId,
      }
    : { client_request_id: draft.clientRequestId };
  return parseAiMessageIngestResult(response.status, payload, {
    coupleId: draft.coupleId,
    userId: draft.userId,
    senderType: draft.senderType,
    text: draft.text,
    clientRequestId: expectedCanonicalMetadata.client_request_id,
    target: draft.target,
    providerAttachmentCount: draft.target === "partner"
      ? 0
      : draft.providerAttachmentCount,
    ...(draft.target === "partner"
      ? { partnerRecipientId: draft.partnerRecipientId }
      : {}),
    ...(expectedCanonicalMetadata.confirmed_amora_action_id
      ? { confirmedActionId: expectedCanonicalMetadata.confirmed_amora_action_id }
      : {}),
  }, parseRetryAfterMs(response.headers.get("Retry-After")));
}

async function requestChatStream(
  body: ChatRequestBody,
  signal: AbortSignal,
  onUpdate: ChatStreamUpdateCallback,
  onQuota: (remaining: number) => void,
  onDoneMetadata: (metadata: Record<string, unknown>) => void,
  expectedUserId: string | null,
): Promise<ChatStreamCompletion> {
  const { data: sessionData } = await waitForUnlessAborted(
    supabase.auth.getSession(),
    signal,
  );
  if (signal.aborted) throw new ChatTransportError("CANCELLED");
  // 쓴 사람과 지금 토큰의 주인이 다르면 보내지 않는다. 저장된 뒤에 되돌릴 수 없다.
  assertAmoraRequestActor(expectedUserId, sessionData.session?.user.id);
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
  // 세션 갱신은 다른 계정으로 바뀔 수 있는 지점이므로 재시도 전에 다시 대조한다.
  assertAmoraRequestActor(expectedUserId, refreshed.session.user.id);
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
  expectedUserId: string | null,
): Promise<unknown> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  // 누른 사람과 지금 토큰의 주인이 다르면 요청 자체를 보내지 않는다. 응답을 받은 뒤에
  // 버리는 것으로는 늦다. 그때는 서버가 이미 다른 사람의 승인으로 기록한 뒤다.
  assertSharedActionActor(expectedUserId, data.session?.user.id);
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
  // 세션 갱신은 다른 계정으로 바뀔 수 있는 지점이므로 같은 사람인지 다시 본다.
  assertSharedActionActor(expectedUserId, refreshed.session.user.id);
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
  expectedUserId: string | null,
): Promise<SharedActionApprovalStatus> {
  const value = await requestAmoraSharedAction(actionId, messageId, "GET", expectedUserId);
  const status = parseSharedActionApprovalStatus(value);
  if (!status) throw new ChatTransportError("STREAM");
  return status;
}

async function requestAmoraSharedActionApproval(
  actionId: string,
  messageId: string,
  method: "POST" | "DELETE",
  expectedUserId: string | null,
): Promise<SharedActionApprovalStatus> {
  const value = await requestAmoraSharedAction(actionId, messageId, method, expectedUserId);
  const status = parseSharedActionApprovalStatus(value);
  if (!status) throw new ChatTransportError("STREAM");
  return status;
}

async function requestAmoraApplicationClaim(
  actionId: string,
  messageId: string,
  expectedUserId: string | null,
): Promise<SharedActionApplicationClaim> {
  const value = await requestAmoraSharedAction(actionId, messageId, "PUT", expectedUserId);
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

/**
 * 서버가 밝힌 사유 코드를 앱의 말로 옮긴다.
 *
 * 서버가 보낸 문장 자체는 화면에 그리지 않는다 — 내부 정보가 실릴 수 있고, 그
 * 결정은 `chatStream.test.mjs`가 "hides server details"로 고정하고 있다. 대신 코드만
 * 읽고 앱이 자기 문구를 고른다.
 *
 * 코드까지 무시하면 한도를 다 쓴 사람이 "다시 시도해 주세요"를 받고 몇 번을 눌러도
 * 같은 결과를 만난다. 자기 통신 문제인 줄 알고 계속 누르게 된다.
 */
function getServerCodeFailureMessage(serverCode: string | null): string | null {
  switch (serverCode) {
    case "COST_GUARD_COUPLE_QUOTA":
      return "무료 상담을 모두 사용했어요. 예산·일정 기록은 그대로 보관돼요. 추가 이용 방법은 정해지면 알려드릴게요.";
    case "COST_GUARD_GLOBAL_DAILY":
      return "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요.";
    case "COST_GUARD_COUPLE_DAILY":
      return "오늘 이 대화에서 쓸 수 있는 상담 횟수를 다 썼어요. 내일 다시 이어서 도와드릴게요.";
    case "COST_GUARD_GLOBAL_BUDGET":
      // "안전 한도" 는 우리 내부 용어이고, 카운터는 한국 시간 자정에 풀리므로
      // "잠시 후" 는 사용자를 헛되이 다시 누르게 만든다. 서버가 이미 고친 문구다.
      return "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요.";
    case "COST_GUARD_UNAVAILABLE":
      return "아모라 사용량을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
    default:
      return null;
  }
}

function getAiFailureMessage(error: unknown, timedOut: boolean): string {
  // 왜 막혔는지 서버가 코드로 밝힌 경우에는 그것부터 전한다.
  if (error instanceof ChatTransportError) {
    // 코드 표가 정본이고 서버 문장은 그리지 않는다(위 주석). 표에 없는 코드만 아래로 간다.
    const reason = getServerCodeFailureMessage(error.serverCode);
    if (reason) return reason;
  }
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

/**
 * 안전 보류로 보내지 못한 원문을 **나만 상담** 입력칸으로 옮긴다.
 *
 * 웹(`ChatContent.tsx` 의 restoreHeldComposerText)과 같은 행동. 서버에는 아무것도
 * 남지 않는다 — 로컬 입력칸 사이를 옮길 뿐이다. 이미 나만 상담 칸에 글이 있으면
 * 덮어쓰지 않고, 보류가 그 칸에서 났으면 그대로 비운다(같은 말이 되돌아오면 또
 * 막힌다).
 */
function moveHeldDraftToPrivateLane(
  current: AmoraChatLaneRecord<string>,
  lane: AmoraChatLane,
  text: string,
): AmoraChatLaneRecord<string> {
  const cleared = updateAmoraChatLaneRecord(current, lane, "");
  if (lane === "private_ai" || cleared.private_ai.trim().length > 0) return cleared;
  return updateAmoraChatLaneRecord(cleared, "private_ai", text);
}

function canRetrySameChatRequest(error: unknown, timedOut = false): boolean {
  if (timedOut) return true;
  if (!(error instanceof ChatTransportError)) return false;
  // 2026-09-04: 상한(COST_GUARD_*)은 서버가 같은 키 재시도를 허용해도 자정까지는
  // 눌러도 같다. "내일 다시" 문구 아래 "다시 받기" 버튼을 두지 않는다.
  if (
    typeof error.serverCode === "string"
    && error.serverCode.startsWith("COST_GUARD_")
    && error.serverCode !== "COST_GUARD_UNAVAILABLE"
  ) {
    return false;
  }
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
  // 총예산을 아직 안 정한 커플에게 "배분 후 남는 금액" 은 뜻이 없다.
  //
  // 신규 커플의 총예산은 0이라, 첫 항목 예산을 잡으면 이 줄이
  // "0원 → -2,200만원" 이 된다. 처음 저장해 보는 사람이 자기 첫 카드에서
  // 마이너스를 본다.
  //
  // 웹은 2026-08-25 에 고쳤는데(`PendingAmoraActionCard.tsx`) 모바일은 같은 줄을
  // 따로 갖고 있어서 그대로 남아 있었다. 제품 계약상 모바일이 주 제품이다.
  const totalBudgetIsSet =
    preview.current.totalBudget > 0 || preview.proposed.totalBudget > 0;
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
    ...(totalBudgetIsSet
      ? [{
          label: "배분 후 남는 금액",
          current: preview.current.unallocatedBudget,
          proposed: preview.proposed.unallocatedBudget,
          delta: preview.delta.unallocatedBudget,
        }]
      : []),
  ];

  return (
    <View style={st.budgetImpactCard}>
      <Text style={st.budgetImpactTitle}>변경 영향</Text>
      {!totalBudgetIsSet && (
        <Text style={st.budgetImpactLabel}>
          총예산을 아직 정하지 않아 남는 금액은 계산하지 않았어요.
        </Text>
      )}
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
  const [chatLoadError, setChatLoadError] = useState<string | null>(null);
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
  const [coldStartAiRecoveryByLane, setColdStartAiRecoveryByLane] = useState<
    AmoraChatLaneRecord<ColdStartAiRecovery | null>
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
  const [firstHelloBody, setFirstHelloBody] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const hasLinkedPartnerRef = useRef(false);
  const linkedPartnerIdRef = useRef<string | null>(null);
  const chatSessionGenerationRef = useRef(createChatSessionGenerationGuard());
  const chatViewCursorsRef = useRef<ChatViewCursors>({ shared: null, private: null });
  const inputByLaneRef = useRef(inputByLane);
  inputByLaneRef.current = inputByLane;
  const pendingChatDraftRestoreRef = useRef<{
    userId: string; coupleId: string; drafts: AmoraChatLaneRecord<string>;
  } | null>(null);
  const reloadChatSessionRef = useRef<() => void>(() => {});
  const refreshChatSessionRef = useRef<(() => Promise<void>) | null>(null);
  // 공동 승인은 "누가 눌렀는가"가 동의의 주체다. 핸들러가 이 값을 동기적으로 읽어
  // 요청에 실으면, 요청이 나가는 사이 계정이 바뀌어도 fence가 불일치를 잡는다.
  const sessionUserIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const safetyHoldLockRef = useRef(false);
  const applyingPendingActionRef = useRef<string | null>(null);
  const persistedAiRequestKeysRef = useRef(new Set<string>());
  const previousMessageCountRef = useRef(0);
  const scopedMessages = useMemo(
    () => messages.filter((message) => (
      isMessageInChatScope(message.visibility, activeScope, userRole)
    )),
    [activeScope, messages, userRole],
  );
  /**
   * 라운지에서 아모라가 먼저 건넨 첫마디. 사람이 먼저 말을 걸어야 대화가 시작되는 게
   * 아니라, 열었을 때 이미 놓여 있어야 한다.
   *
   * `messages`에 섞지 않는 이유: 그 배열은 서버로 보내는 맥락이자 리얼타임 동기화 대상이라,
   * 저장되지 않은 로컬 메시지를 넣으면 새로고침마다 사라졌다 나타나고 모델에게는 없는
   * 기록으로 간다. 화면에 그릴 때만 앞에 붙인다.
   */
  const firstHelloMessage = useMemo<ChatMessage | null>(() => {
    if (!firstHelloBody || activeScope !== "shared" || target === "partner") {
      return null;
    }
    return {
      id: AMORA_FIRST_HELLO_MESSAGE_ID,
      couple_id: coupleId ?? "",
      sender_id: null,
      role: "assistant",
      sender_type: "ai",
      content: firstHelloBody,
      metadata: null,
      visibility: "shared",
    };
  }, [activeScope, coupleId, firstHelloBody, target]);
  const displayedMessages = useMemo(
    () => (firstHelloMessage ? [firstHelloMessage, ...scopedMessages] : scopedMessages),
    [firstHelloMessage, scopedMessages],
  );
  const visibleMessages = useMemo(() => [...displayedMessages].reverse(), [displayedMessages]);
  const conversationRecap = useMemo(() => buildAmoraConversationRecap({
    messages: messages.filter(message => !!message.created_at).map(message => ({ ...message, created_at: message.created_at! })),
    coupleId: coupleId ?? "", userId: userId ?? "", role: userRole ?? "bride",
    visibility: activeScope === "shared" ? "shared" : `${userRole ?? "bride"}_private`,
    clearedAt: chatViewCursorsRef.current[activeScope], nowMs, readPending: getPendingAmoraAction,
  }), [activeScope, coupleId, messages, nowMs, userId, userRole]);

  // 어느 문으로 들어왔는가. 라운지의 버튼·카드·첫 도착 CTA는 서로 다른 키를 들고 오고,
  // 그 키가 입력창 초안 한 줄을 정한다(웹의 ?prefill=과 같은 자리다). 탭으로 그냥 들어온
  // 사람에게는 키가 없고, 그러면 아무것도 채우지 않는다.
  const entryParam = useLocalSearchParams()[AMORA_CHAT_ENTRY_PARAM];
  const entryPrefillAppliedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!initialLoaded || !userId || !coupleId || !userRole || chatLoadError || streaming
      || sendingRef.current || !personalActionContinuation.hasPending()) return;
    let active = true;
    const generation = chatSessionGenerationRef.current.current();
    void personalActionContinuation.take({ ownerId: userId, coupleId }).then(text => {
      if (!active || !text || !chatSessionGenerationRef.current.isCurrent(generation) || sessionUserIdRef.current !== userId) return;
      if (inputByLaneRef.current.private_ai.trim()) {
        setPartnerSafetyNotice("작성 중인 나만 상담은 그대로 두었어요. 보내거나 비운 뒤 개인 목록에서 다시 이어가 주세요.");
        return;
      }
      setActiveScope("private"); setTarget("ai");
      setInputByLane(current => current.private_ai.trim() ? current : updateAmoraChatLaneRecord(current, "private_ai", text));
    }).catch(() => {
      if (active && chatSessionGenerationRef.current.isCurrent(generation)) setPartnerSafetyNotice("개인 할 일을 다시 확인하지 못했어요. 개인 목록에서 다시 이어가 주세요.");
    });
    return () => { active = false; };
  }, [chatLoadError, coupleId, initialLoaded, streaming, userId, userRole]));
  useEffect(() => {
    if (!initialLoaded || !userId || !coupleId || chatLoadError) return;
    if (entryPrefillAppliedRef.current) return;
    const prefill = getAmoraChatEntryPrefill(entryParam);
    if (!prefill) return;
    // 한 번만 놓는다. 다시 놓으면 사람이 지운 초안이 화면이 다시 그려질 때마다 되살아난다.
    entryPrefillAppliedRef.current = true;
    // 공유 아모라 레인에만 놓는다. 파트너 대화나 비공개 상담에 진입 문구가 섞이면,
    // 사람은 자기가 쓰지 않은 말을 상대에게 보낼 뻔한다.
    setInputByLane((current) =>
      current.shared_ai.trim() ? current : updateAmoraChatLaneRecord(current, "shared_ai", prefill),
    );
  }, [chatLoadError, coupleId, entryParam, initialLoaded, userId]);

  // 라운지에서 만들어 둔 첫마디를 가져온다. 모델을 부르지 않으므로 네트워크가 느려도
  // 대화를 열자마자 놓여 있다.
  useEffect(() => {
    if (!initialLoaded || !userId || !coupleId || chatLoadError || chatViewCursorsRef.current.shared !== null) return;
    let active = true;
    const generation = chatSessionGenerationRef.current.current();
    const owner = { userId, coupleId };
    void (async () => {
      const delivered = getDeliveredAmoraFirstHello({ owner });
      const hello =
        delivered ?? (await consumePendingAmoraFirstHello({ storage: AsyncStorage, owner }));
      if (!active || !hello || !mountedRef.current || !chatSessionGenerationRef.current.isCurrent(generation)) return;
      setFirstHelloBody(hello.body);
    })();
    return () => {
      active = false;
    };
  }, [chatLoadError, coupleId, initialLoaded, userId]);
  const activeW5PersistenceState = useMemo<{
    rawDisclosurePersisted: boolean | null;
    persistence: RawDisclosurePersistence;
  } | null>(() => {
    const latestMessage = scopedMessages[scopedMessages.length - 1];
    if (
      latestMessage?.metadata?.pinned_safety_card !== true
      || latestMessage.metadata.question_scope !== "W5_safety_override"
    ) return null;
    const persisted = latestMessage.metadata.raw_disclosure_persisted;
    const declaredPersistence = latestMessage.metadata.raw_disclosure_persistence;
    const persistence: RawDisclosurePersistence = declaredPersistence === "none"
      || declaredPersistence === "shared"
      || declaredPersistence === "private_only"
      || declaredPersistence === "unknown"
      ? declaredPersistence
      : persisted === false
        ? "none"
        : "unknown";
    return {
      rawDisclosurePersisted: typeof persisted === "boolean" ? persisted : null,
      persistence,
    };
  }, [scopedMessages]);
  const hasActiveW5SafetyCard = activeW5PersistenceState !== null;
  const activeSendFailure = activeLane ? sendFailuresByLane[activeLane] : null;
  const activeColdStartAiRecovery = activeLane
    ? coldStartAiRecoveryByLane[activeLane]
    : null;
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
  const actionConfirmationOutcomes = useMemo(
    () => buildAmoraActionConfirmationOutcomes(messages),
    [messages],
  );
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
    safetyHoldLockRef.current = false;
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
    setChatLoadError(null);
    setFirstHelloBody(null);
    setTarget("ai");
    setActiveScope("shared");
    setInputByLane(createEmptyAmoraChatLaneRecord(() => ""));
    setSendFailuresByLane(createEmptyAmoraChatLaneRecord(() => null));
    setColdStartAiRecoveryByLane(createEmptyAmoraChatLaneRecord(() => null));
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
        const status = await requestAmoraSharedActionStatus(
          actionId,
          messageId,
          sessionUserIdRef.current,
        );
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

  useFocusEffect(useCallback(() => {
    void refreshChatSessionRef.current?.();
  }, []));

  useEffect(() => {
    mountedRef.current = true;
    let authReloadTimer: ReturnType<typeof setTimeout> | null = null;
    let observedAuthUserId: string | null | undefined;

    function scheduleChatSessionReload(preserveDrafts = false) {
      if (!preserveDrafts) pendingChatDraftRestoreRef.current = null;
      chatSessionGenerationRef.current.invalidate();
      resetChatSessionState();
      if (authReloadTimer) clearTimeout(authReloadTimer);
      authReloadTimer = setTimeout(() => {
        authReloadTimer = null;
        if (mountedRef.current) void loadChatSession();
      }, 0);
    }
    reloadChatSessionRef.current = () => scheduleChatSessionReload(true);

    async function loadChatSession() {
      const generation = chatSessionGenerationRef.current.begin();
      refreshChatSessionRef.current = null;
      resetChatSessionState();
      const isCurrentGeneration = () => isCurrentChatSession(generation);
      try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!isCurrentGeneration()) return;
      if (authError) throw authError;
      sessionUserIdRef.current = user?.id ?? null;
      observedAuthUserId = user?.id ?? null;
      if (!user) {
        setInitialLoaded(true);
        return;
      }
      const reloadIdentity = () => {
        if (!isCurrentChatSession(generation)) return;
        scheduleChatSessionReload();
      };

      const profileSelect = "name, role, couple_id, shared_chat_cleared_at, private_chat_cleared_at";
      const { data: profile, error: profileError } = await supabase.from("profiles")
        .select(profileSelect)
        .eq("id", user.id)
        .single();
      if (!isCurrentGeneration()) return;
      if (profileError || !profile) throw new Error("대화 범위를 확인하지 못했어요.");
      const viewCursors = readChatViewCursors(profile);
      chatViewCursorsRef.current = viewCursors;
      const reloadWhenProfileIdentityChanges = (payload: { new: Record<string, unknown> }) => {
        if (!isCurrentGeneration()) return;
        const nextProfile = payload.new;
        if (
          nextProfile.couple_id !== profile?.couple_id
          || nextProfile.role !== profile?.role
        ) reloadIdentity();
        else {
          try {
            if (hasChatViewCursorAdvanced(viewCursors, readChatViewCursors(nextProfile))) reloadIdentity();
          } catch {
            reloadIdentity();
          }
        }
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

      const chatMessageSelect =
        "id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility";
      const privateVisibility: ChatMessageVisibility | null = viewerRole
        ? `${viewerRole}_private`
        : null;
      const verifyLoadedChatBoundary = async () => {
        const [{ data: currentProfile, error }, { data: currentCouple, error: coupleError }] = await Promise.all([
          supabase.from("profiles").select(profileSelect).eq("id", user.id).single(),
          supabase.from("couples").select("bride_id, groom_id").eq("id", profile.couple_id).maybeSingle(),
        ]);
        if (!isCurrentGeneration()) return false;
        if (error || coupleError || !currentProfile || !currentCouple) throw new Error("대화 범위를 확인하지 못했어요.");
        if (currentProfile.couple_id !== profile.couple_id || currentProfile.role !== profile.role ||
          currentCouple.bride_id !== couple?.bride_id || currentCouple.groom_id !== couple?.groom_id ||
          hasChatViewCursorAdvanced(viewCursors, readChatViewCursors(currentProfile))) {
          reloadIdentity();
          return false;
        }
        return true;
      };
      const reconcilePersistedReplies = (rows: readonly ChatMessage[]) => {
        for (const reply of rows) {
          if (reply.sender_type !== "ai") continue;
          const key = reply.metadata?.client_visible_request_id ?? reply.metadata?.client_request_id;
          const questionId = reply.metadata?.in_reply_to_user_message_id;
          if (key) persistedAiRequestKeysRef.current.add(key);
          const lane = aiLaneForVisibility(reply.visibility);
          setSendFailuresByLane((current) => {
            const failure = current[lane];
            const matchesResponse = failure?.kind === "ai_response" && reply.couple_id === failure.request.body.coupleId &&
              (Boolean(key && key === failure.request.serverRequestKey) || Boolean(questionId && questionId === failure.request.body.userMessageId));
            const matchesDraft = failure?.kind === "ai_insert" && reply.couple_id === failure.draft.coupleId &&
              (key === failure.draft.clientRequestId || key === `chat:${failure.draft.userId}:${failure.draft.clientRequestId}`);
            return matchesResponse || matchesDraft ? updateAmoraChatLaneRecord(current, lane, null) : current;
          });
          setColdStartAiRecoveryByLane((current) => {
            const recovery = current[lane];
            if (!recovery) return current;
            const answersRecovery = questionId === recovery.userMessageId || Boolean(key &&
              (key === recovery.clientRequestId || key === `chat:${user.id}:${recovery.clientRequestId}`));
            return answersRecovery ? updateAmoraChatLaneRecord(current, lane, null) : current;
          });
        }
      };
      const latestOwnSharedAiUserRequest = viewerRole
        ? withChatViewCursor(supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("sender_id", user.id)
          .eq("sender_type", viewerRole)
          .eq("role", "user")
          .eq("visibility", "shared")
          .or("metadata->>target.is.null,metadata->>target.eq.ai"), viewCursors.shared)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const latestPrivateCanonicalRequest = privateVisibility
        ? withChatViewCursor(supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("visibility", privateVisibility)
          .or("metadata->>target.is.null,metadata->>target.eq.ai"), viewCursors.private)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const latestOwnPrivateAiUserRequest = privateVisibility && viewerRole
        ? withChatViewCursor(supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("sender_id", user.id)
          .eq("sender_type", viewerRole)
          .eq("role", "user")
          .eq("visibility", privateVisibility)
          .or("metadata->>target.is.null,metadata->>target.eq.ai"), viewCursors.private)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [
        { data: history, error: historyError },
        {
          data: latestSharedCanonical,
          error: latestSharedCanonicalError,
        },
        {
          data: latestOwnSharedAiUser,
          error: latestOwnSharedAiUserError,
        },
        {
          data: latestPrivateCanonical,
          error: latestPrivateCanonicalError,
        },
        {
          data: latestOwnPrivateAiUser,
          error: latestOwnPrivateAiUserError,
        },
      ] = await Promise.all([
        supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .or(buildChatViewCursorFilter(viewCursors, viewerRole))
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(200),
        withChatViewCursor(supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("visibility", "shared")
          .or("metadata->>target.is.null,metadata->>target.neq.partner"), viewCursors.shared)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        latestOwnSharedAiUserRequest,
        latestPrivateCanonicalRequest,
        latestOwnPrivateAiUserRequest,
      ]);
      if (!isCurrentGeneration()) return;
      if (historyError || latestSharedCanonicalError || latestOwnSharedAiUserError ||
        latestPrivateCanonicalError || latestOwnPrivateAiUserError) throw new Error("대화를 불러오지 못했어요.");
      if (!await verifyLoadedChatBoundary()) return;

      const normalizedBoundedHistory = (history ?? [])
        .map((message) => chatMessageFromRealtimeRow(message))
        .filter((message): message is ChatMessage => (
          message !== null && canViewerSeeChatMessage(message, viewerRole) && isMessageAfterChatViewCursor(message, viewCursors)
        ));
      const sharedSupplementalCanonicalTurns =
        latestSharedCanonicalError || latestOwnSharedAiUserError
          ? []
          : [latestSharedCanonical, latestOwnSharedAiUser];
      const privateSupplementalCanonicalTurns =
        latestPrivateCanonicalError || latestOwnPrivateAiUserError
          ? []
          : [latestPrivateCanonical, latestOwnPrivateAiUser];
      const supplementalCanonicalTurns = [
        ...sharedSupplementalCanonicalTurns,
        ...privateSupplementalCanonicalTurns,
      ]
        .map((message) => chatMessageFromRealtimeRow(message))
        .filter((message): message is ChatMessage => (
          message !== null && canViewerSeeChatMessage(message, viewerRole) && isMessageAfterChatViewCursor(message, viewCursors)
        ));
      const boundedHistory = mergeColdStartRecoveryHistory(
        normalizedBoundedHistory,
        supplementalCanonicalTurns,
      );
      const historyMessages = boundedHistory
        .sort((left, right) => {
          const byCreatedAt =
            new Date(left.created_at ?? 0).getTime()
            - new Date(right.created_at ?? 0).getTime();
          return byCreatedAt || left.id.localeCompare(right.id);
        });
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
        && message.metadata?.pinned_safety_card !== true
      ));
      const durableConfirmation = canonicalShared[canonicalShared.length - 1];
      const confirmedActionId = durableConfirmation?.metadata?.confirmed_amora_action_id;
      const confirmationClientRequestId =
        durableConfirmation?.metadata?.client_request_id;
      if (
        durableConfirmation
        && durableConfirmation.sender_type === viewerRole
        && durableConfirmation.role === "user"
        && typeof confirmedActionId === "string"
        && typeof confirmationClientRequestId === "string"
        && viewerRole
      ) {
        setLaneFailure("shared_ai", {
          kind: "ai_insert",
          message: "확인은 안전하게 저장됐어요. 반영을 이어서 완료해 주세요.",
          canRetry: true,
          unavailableReason: null,
          draft: {
            text: durableConfirmation.content,
            sourceLane: "shared_ai",
            target: "ai",
            clientRequestId: confirmationClientRequestId,
            coupleId: profile.couple_id,
            userId: user.id,
            senderType: viewerRole,
            senderName: profile.name ?? "사용자",
            requestedVisibility: "shared",
            visibility: "shared",
            providerAttachmentCount: 0,
            sessionGeneration: generation,
            confirmedActionId,
          },
        });
      } else if (viewerRole) {
        const sharedRecovery = findColdStartAiRecovery(historyMessages, {
          coupleId: profile.couple_id,
          userId: user.id,
          senderType: viewerRole,
          visibility: "shared",
        });
        const privateRecovery = findColdStartAiRecovery(historyMessages, {
          coupleId: profile.couple_id,
          userId: user.id,
          senderType: viewerRole,
          visibility: `${viewerRole}_private`,
        });
        setColdStartAiRecoveryByLane((current) => ({
          ...current,
          shared_ai: sharedRecovery,
          private_ai: privateRecovery,
          shared_partner: null,
        }));
      }

      const ch = supabase.channel(`chat:${profile.couple_id}:${generation}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `couple_id=eq.${profile.couple_id}` }, (payload) => {
          if (!isCurrentChatSession(generation)) return;
          const incoming = chatMessageFromRealtimeRow(payload.new);
          if (!incoming || !canViewerSeeChatMessage(incoming, viewerRole) || !isMessageAfterChatViewCursor(incoming, viewCursors)) return;
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
          const lane = aiLaneForVisibility(incoming.visibility);
          setColdStartAiRecoveryByLane((current) => {
            const recovery = current[lane];
            if (!recovery) return current;
            const visibleRecoveryKey =
              `chat:${user.id}:${recovery.clientRequestId}`;
            const answersRecovery =
              incomingMetadata?.in_reply_to_user_message_id === recovery.userMessageId
              || incomingRequestKey === visibleRecoveryKey
              || incomingRequestKey === recovery.clientRequestId;
            const supersedesRecovery =
              incoming.id !== recovery.userMessageId
              && incomingMetadata?.target !== "partner";
            return answersRecovery || supersedesRecovery
              ? updateAmoraChatLaneRecord(current, lane, null)
              : current;
          });
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
            if (!updated || !canViewerSeeChatMessage(updated, viewerRole) || !isMessageAfterChatViewCursor(updated, viewCursors)) {
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
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void refreshChatSessionRef.current?.();
        });
      if (!isCurrentGeneration()) {
        void supabase.removeChannel(ch);
        return;
      }
      channelRef.current = ch;
      let refreshing = false;
      refreshChatSessionRef.current = async () => {
        if (refreshing || !isCurrentGeneration()) return;
        refreshing = true;
        try {
          if (!await verifyLoadedChatBoundary()) return;
          const { data: currentHistory, error } = await supabase.from("chat_messages").select(chatMessageSelect)
            .eq("couple_id", profile.couple_id).or(buildChatViewCursorFilter(viewCursors, viewerRole))
            .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
          if (!isCurrentGeneration()) return;
          if (error) throw error;
          if (!await verifyLoadedChatBoundary()) return;
          const incoming = (currentHistory ?? []).map(chatMessageFromRealtimeRow).filter((message): message is ChatMessage =>
            message !== null && canViewerSeeChatMessage(message, viewerRole) && isMessageAfterChatViewCursor(message, viewCursors));
          reconcilePersistedReplies(incoming);
          setMessages((previous) => reconcileMobileAmoraCrisisRecovery(
            mergeColdStartRecoveryHistory(previous, incoming), user.id, profile.couple_id, viewerRole));
          setChatLoadError(null);
        } catch {
          if (isCurrentGeneration()) {
            pendingChatDraftRestoreRef.current = { userId: user.id, coupleId: profile.couple_id, drafts: inputByLaneRef.current };
            chatSessionGenerationRef.current.invalidate();
            activeControllerRef.current?.abort();
            setStreaming(false);
            setMessages([]);
            setSendFailuresByLane(createEmptyAmoraChatLaneRecord(() => null));
            setColdStartAiRecoveryByLane(createEmptyAmoraChatLaneRecord(() => null));
            setChatLoadError("대화 상태를 확인하지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.");
          }
        } finally {
          refreshing = false;
        }
      };
      // 구독 연결 전 생긴 변경도 두 번째 범위 조회로 확인한다.
      if (!await verifyLoadedChatBoundary()) return;
      const restoreDraft = pendingChatDraftRestoreRef.current;
      pendingChatDraftRestoreRef.current = null;
      if (restoreDraft?.userId === user.id && restoreDraft.coupleId === profile.couple_id) setInputByLane(restoreDraft.drafts);
      setInitialLoaded(true);
      } catch {
        if (!isCurrentGeneration()) return;
        resetChatSessionState();
        setChatLoadError("대화를 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.");
        setInitialLoaded(true);
      }
    }

    void loadChatSession();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshChatSessionRef.current?.();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextAuthUserId = session?.user.id ?? null;
      // 아래 early return보다 먼저 갱신한다. 승인 요청이 결박할 대상은 항상 지금 사람이다.
      sessionUserIdRef.current = nextAuthUserId;
      if (nextAuthUserId === observedAuthUserId) return;
      observedAuthUserId = nextAuthUserId;
      scheduleChatSessionReload();
    });

    return () => {
      mountedRef.current = false;
      chatSessionGenerationRef.current.invalidate();
      if (authReloadTimer) clearTimeout(authReloadTimer);
      subscription.unsubscribe();
      appStateSubscription.remove();
      refreshChatSessionRef.current = null;
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
    draft: AiDraft,
    intendedTarget: "ai",
  ): Promise<ChatMessage | null> {
    if (intendedTarget !== draft.target) return null;
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
    if (draft.durableUserMessageId) {
      query = query.eq("id", draft.durableUserMessageId);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const durableMessage = chatMessageFromRealtimeRow(data);
    const metadata = durableMessage?.metadata;
    const confirmedActionMatches = draft.confirmedActionId
      ? metadata?.confirmed_amora_action_id === draft.confirmedActionId
      : metadata?.confirmed_amora_action_id === undefined;
    const legacyConfirmedActionRow = Boolean(
      draft.confirmedActionId
      && !draft.durableUserMessageId
      && metadata?.amora_ingest_contract_version === undefined
      && metadata?.ai_response_requested === undefined
      && metadata?.provider_attachment_state === undefined
      && metadata?.provider_attachment_count === undefined,
    );
    const providerAttachmentStateMatches = draft.recoveredProviderAttachmentState
      ? metadata?.provider_attachment_state === draft.recoveredProviderAttachmentState
      : draft.providerAttachmentCount === 0
        ? metadata?.provider_attachment_state === "none"
          || metadata?.provider_attachment_state === "discarded_by_safety_policy"
        : metadata?.provider_attachment_state === "present";
    const ingestContractMatches = legacyConfirmedActionRow || (
      metadata?.amora_ingest_contract_version === 1
      && metadata.ai_response_requested === true
      && metadata.provider_attachment_count === draft.providerAttachmentCount
      && providerAttachmentStateMatches
    );
    if (
      !durableMessage
      || (
        typeof draft.durableUserMessageId === "string"
        && durableMessage.id !== draft.durableUserMessageId
      )
      || durableMessage.couple_id !== draft.coupleId
      || durableMessage.sender_id !== draft.userId
      || durableMessage.sender_type !== draft.senderType
      || durableMessage.role !== "user"
      || durableMessage.content !== draft.text
      || durableMessage.visibility !== draft.visibility
      || metadata?.client_request_id !== draft.clientRequestId
      || (
        metadata?.target !== undefined
        && metadata.target !== "ai"
      )
      || metadata?.partner_recipient_id !== undefined
      || !confirmedActionMatches
      || !ingestContractMatches
    ) return null;
    if (draft.durableUserMessageId) {
      const visibleRequestKey = `chat:${draft.userId}:${draft.clientRequestId}`;
      const answerCorrelationFilter = [
        `metadata->>in_reply_to_user_message_id.eq.${durableMessage.id}`,
        `metadata->>client_visible_request_id.eq.${visibleRequestKey}`,
        `metadata->>client_request_id.eq.${visibleRequestKey}`,
        `metadata->>client_visible_request_id.eq.${draft.clientRequestId}`,
        `metadata->>client_request_id.eq.${draft.clientRequestId}`,
      ].join(",");
      const { data: answerRows, error: answerLookupError } = await supabase
        .from("chat_messages")
        .select("id")
        .eq("couple_id", draft.coupleId)
        .eq("sender_type", "ai")
        .eq("role", "assistant")
        .eq("visibility", draft.visibility)
        .or(answerCorrelationFilter)
        .limit(1);
      if (answerLookupError || (answerRows ?? []).length > 0) return null;
    }
    return durableMessage;
  }

  async function sendPartnerDraft(draft: PartnerDraft) {
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

      const ingestResult = await requestAiMessageIngest(draft);
      if (!isCurrentChatSession(draft.sessionGeneration)) return;
      if (ingestResult.outcome === "ephemeral_safety") {
        if (!ingestResult.partnerDeliveryHeld) {
          throw new Error("partner safety hold was not confirmed");
        }
        const safetyCardId =
          `amora-server-partner-safety:${draft.userId}:${draft.clientRequestId}`;
        const safetyPersistence = getEphemeralSafetyPersistencePresentation(
          ingestResult.rawDisclosurePersisted,
          ingestResult.rawDisclosureVisibility,
          ingestResult.partnerDeliveryHeld,
        );
        const safetyCard: ChatMessage = {
          id: safetyCardId,
          couple_id: draft.coupleId,
          sender_id: null,
          role: "assistant",
          sender_type: "ai",
          content: `${safetyPersistence.notice}\n\n${ingestResult.response}`,
          metadata: {
            response_origin: ingestResult.safetyResolution === "immediate_crisis"
              ? "server_authoritative_partner_crisis_hold"
              : "server_authoritative_partner_safety_hold",
            ...(ingestResult.classification
              ? { safety_classification: ingestResult.classification }
              : {}),
            question_scope: ingestResult.safetyResolution === "immediate_crisis"
              ? "W5_safety_override"
              : "W2_high_risk_adjacent",
            memory_eligible: false,
            persistence_status: "ephemeral_local_only",
            pinned_safety_card: true,
            ...(ingestResult.rawDisclosurePersisted === null
              ? {}
              : { raw_disclosure_persisted: ingestResult.rawDisclosurePersisted }),
            ...(safetyPersistence.rawDisclosureShared === null
              ? {}
              : { raw_disclosure_shared: safetyPersistence.rawDisclosureShared }),
            raw_disclosure_persistence: safetyPersistence.persistence,
          },
          created_at: new Date().toISOString(),
          visibility: ingestResult.effectiveVisibility,
        };
        setMessages((previous) => previous.some((message) => message.id === safetyCardId)
          ? previous
          : [...previous, safetyCard]
        );
        // 2026-09-04: 웹은 보류된 원문을 나만 상담 입력칸으로 옮겨 준다. 여기서는
        // 지우기만 해서, 힘든 이야기를 꺼낸 사람이 같은 말을 다시 쳐야 했다.
        // 저장은 여전히 안 한다 — 로컬 입력칸 사이를 옮길 뿐이다.
        setInputByLane((current) => (
          current[lane].trim() === draft.text
            ? moveHeldDraftToPrivateLane(current, lane, draft.text)
            : current
        ));
        setLaneFailure(lane, null);
        setPartnerSafetyNotice(null);
        setQuotaRemaining(null);
        setActiveScope("private");
        setTarget("ai");
        safetyHoldLockRef.current = true;
        return;
      }
      const durableMessage = ingestResult.message;
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
    } catch (error) {
      if (isCurrentChatSession(draft.sessionGeneration)) {
        const canRetry = !(error instanceof AiMessageIngestError) || error.retryable;
        const statusNeedsDifferentAction = error instanceof AiMessageIngestError
          && (error.status === 401 || error.status === 403);
        setLaneFailure(lane, {
          kind: "partner_ingest",
          message: error instanceof AiMessageIngestError
            ? getAiMessageIngestFailureMessage(error, false)
            : "메시지 전송 결과를 확인하지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.",
          draft,
          canRetry,
          unavailableReason: canRetry || statusNeedsDifferentAction
            ? null
            : NEW_CHAT_MESSAGE_REQUIRED_NOTICE,
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
        sessionUserIdRef.current,
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
    const draftLane = aiLaneForVisibility(draft.visibility);
    if (!isCurrentChatSession(draft.sessionGeneration)) return;
    if (
      draft.durableUserMessageId
      && (
        draft.providerAttachmentCount !== 0
        || (
          draft.recoveredProviderAttachmentState !== "none"
          && draft.recoveredProviderAttachmentState !== "discarded_by_safety_policy"
        )
      )
    ) return;
    setStreaming(true);
    setLaneFailure(draftLane, null);
    try {
      let durableMessage = reconcileFirst
        ? await findDurableUserMessage(draft, "ai")
        : null;
      if (!isCurrentChatSession(draft.sessionGeneration)) return;
      if (draft.durableUserMessageId && !durableMessage) {
        setLaneFailure(draftLane, {
          kind: "ai_insert",
          message: "저장된 질문을 안전하게 다시 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
          draft,
          canRetry: true,
          unavailableReason: null,
        });
        setStreaming(false);
        return;
      }
      if (
        !durableMessage
        && reconcileFirst
        && draft.confirmedActionId
        && draft.amoraSourceMessageId
      ) {
        const claim = await requestAmoraApplicationClaim(
          draft.confirmedActionId,
          draft.amoraSourceMessageId,
          sessionUserIdRef.current,
        );
        if (!isCurrentChatSession(draft.sessionGeneration)) return;
        if (!claim.applicationGranted) {
          setPendingActionNotice({
            actionId: draft.confirmedActionId,
            message: "다른 화면에서 반영을 진행 중이에요. 잠시 후 다시 시도해 주세요.",
          });
          setStreaming(false);
          return;
        }
      }

      let safetyPrivacyRedirected = durableMessage !== null
        && durableMessage.visibility !== draft.requestedVisibility;
      if (!durableMessage) {
        const ingestResult = await requestAiMessageIngest(draft);
        if (!isCurrentChatSession(draft.sessionGeneration)) return;
        if (ingestResult.outcome === "ephemeral_safety") {
          const safetyCardId =
            `amora-server-crisis-preflight:${draft.userId}:${draft.clientRequestId}`;
          const safetyPersistence = getEphemeralSafetyPersistencePresentation(
            ingestResult.rawDisclosurePersisted,
            ingestResult.rawDisclosureVisibility,
            ingestResult.partnerDeliveryHeld,
          );
          const safetyCard: ChatMessage = {
            id: safetyCardId,
            couple_id: draft.coupleId,
            sender_id: null,
            role: "assistant",
            sender_type: "ai",
            content: `${safetyPersistence.notice}\n\n${ingestResult.response}`,
            metadata: {
              response_origin: "server_authoritative_crisis_fallback",
              ...(ingestResult.classification
                ? { safety_classification: ingestResult.classification }
                : {}),
              question_scope: "W5_safety_override",
              memory_eligible: false,
              persistence_status: "ephemeral_local_only",
              pinned_safety_card: true,
              ...(ingestResult.rawDisclosurePersisted === null
                ? {}
                : { raw_disclosure_persisted: ingestResult.rawDisclosurePersisted }),
              ...(safetyPersistence.rawDisclosureShared === null
                ? {}
                : { raw_disclosure_shared: safetyPersistence.rawDisclosureShared }),
              raw_disclosure_persistence: safetyPersistence.persistence,
            },
            created_at: new Date().toISOString(),
            visibility: ingestResult.effectiveVisibility,
          };
          setMessages((previous) => previous.some((message) => message.id === safetyCardId)
            ? previous
            : [...previous, safetyCard]
          );
          setInputByLane((current) => (
            current[draft.sourceLane].trim() === draft.text
              ? moveHeldDraftToPrivateLane(current, draft.sourceLane, draft.text)
              : current
          ));
          setQuotaRemaining(null);
          setActiveScope("private");
          setTarget("ai");
          safetyHoldLockRef.current = true;
          setStreaming(false);
          return;
        }
        durableMessage = ingestResult.message;
        safetyPrivacyRedirected = ingestResult.safetyPrivacyRedirected;
      }

      if (!durableMessage) throw new Error("AI user message was not persisted");
      const effectiveVisibility = durableMessage.visibility;
      const canonicalUserMessage = durableMessage;
      const effectiveLane = aiLaneForVisibility(effectiveVisibility);
      setLaneFailure(draftLane, null);
      if (effectiveLane !== draftLane) setLaneFailure(effectiveLane, null);

      const safetyPrivacyCard: ChatMessage | null = safetyPrivacyRedirected
        ? {
            id: `amora-safety-privacy-preflight:${draft.userId}:${draft.clientRequestId}`,
            couple_id: canonicalUserMessage.couple_id,
            sender_id: null,
            role: "assistant",
            sender_type: "ai",
            content: "민감한 안전 관련 내용이라 상대방에게 공유하지 않고 나만 상담으로 옮겼어요.",
            metadata: {
              response_origin: "server_authoritative_safety_privacy_route",
              question_scope: "W2_high_risk_adjacent",
              memory_eligible: false,
              persistence_status: "ephemeral_local_only",
              pinned_safety_card: true,
              raw_disclosure_persisted: true,
              raw_disclosure_shared: false,
              raw_disclosure_persistence: "private_only",
            },
            created_at: new Date().toISOString(),
            visibility: effectiveVisibility,
          }
        : null;

      const serverRequestKey = `chat:${draft.userId}:${draft.clientRequestId}`;
      const canonicalContext = messages
        .filter((message) =>
          message.id !== canonicalUserMessage.id
          && (!message.id.startsWith("temp_") || Boolean(message.content.trim()))
          && message.metadata?.target !== "partner"
          && message.metadata?.pinned_safety_card !== true
          && isMessageInAiContext(
            message.visibility,
            effectiveVisibility,
          )
        )
        .slice(-39)
        .map(({ role, content }) => ({ role, content }));
      const canonicalConfirmedActionId =
        typeof canonicalUserMessage.metadata?.confirmed_amora_action_id === "string"
          ? canonicalUserMessage.metadata.confirmed_amora_action_id
          : undefined;
      const request: AiRequest = {
        tempId: `temp_${draft.clientRequestId}`,
        serverRequestKey,
        lane: effectiveLane,
        sessionGeneration: draft.sessionGeneration,
        body: {
          messages: [
            ...canonicalContext,
            { role: "user", content: canonicalUserMessage.content },
          ],
          coupleId: canonicalUserMessage.couple_id,
          senderName: draft.senderName,
          clientRequestId: canonicalUserMessage.metadata!.client_request_id!,
          userMessageId: canonicalUserMessage.id,
          visibility: effectiveVisibility,
          ...(canonicalConfirmedActionId
            ? { confirmedActionId: canonicalConfirmedActionId }
            : {}),
        },
      };

      if (isCurrentChatSession(draft.sessionGeneration)) {
        if (effectiveVisibility !== "shared") {
          setActiveScope("private");
          setTarget("ai");
        }
        setMessages((previous) => {
          const withDurableMessage = previous.some((message) => message.id === canonicalUserMessage.id)
            ? previous
            : [...previous, canonicalUserMessage];
          return safetyPrivacyCard
            && !withDurableMessage.some((message) => message.id === safetyPrivacyCard.id)
            ? [...withDurableMessage, safetyPrivacyCard]
            : withDurableMessage;
        });
        setInputByLane((current) => (
          current[draft.sourceLane].trim() === draft.text
            ? updateAmoraChatLaneRecord(current, draft.sourceLane, "")
            : current
        ));
      }
      if (!isCurrentChatSession(draft.sessionGeneration)) return;
      await streamAiRequest(request);
    } catch (error) {
      if (isCurrentChatSession(draft.sessionGeneration)) {
        const canRetry = error instanceof AiMessageIngestError && error.retryable;
        setLaneFailure(draftLane, {
          kind: "ai_insert",
          message: getAiMessageIngestFailureMessage(
            error,
            typeof draft.confirmedActionId === "string",
          ),
          draft,
          canRetry,
          unavailableReason: canRetry ? null : NEW_CHAT_MESSAGE_REQUIRED_NOTICE,
        });
        setStreaming(false);
      }
    }
  }

  async function handleColdStartAiRecovery() {
    const recovery = activeColdStartAiRecovery;
    if (
      !recovery
      || recovery.disposition !== "resumable"
      || streaming
      || sendingRef.current
      || !coupleId
      || !userId
      || !userRole
    ) return;
    if (
      recovery.providerAttachmentCount !== 0
      || (
        recovery.providerAttachmentState !== "none"
        && recovery.providerAttachmentState !== "discarded_by_safety_policy"
      )
    ) return;

    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (!isCurrentChatSession(sessionGeneration)) return;
    const draft: AiDraft = {
      text: recovery.content,
      sourceLane: recovery.lane,
      target: "ai",
      clientRequestId: recovery.clientRequestId,
      coupleId,
      userId,
      senderType: userRole,
      senderName: userName,
      requestedVisibility: recovery.visibility,
      visibility: recovery.visibility,
      providerAttachmentCount: 0,
      durableUserMessageId: recovery.userMessageId,
      recoveredProviderAttachmentState: recovery.providerAttachmentState,
      sessionGeneration,
    };

    sendingRef.current = true;
    setColdStartAiRecoveryByLane((current) => (
      updateAmoraChatLaneRecord(current, recovery.lane, null)
    ));
    setActiveScope(recovery.visibility === "shared" ? "shared" : "private");
    setTarget("ai");
    try {
      await sendAiDraft(draft, true);
    } finally {
      if (isCurrentChatSession(sessionGeneration)) sendingRef.current = false;
    }
  }

  async function handleRetry() {
    if (!activeSendFailure || !activeLane || streaming || sendingRef.current) return;
    const failure = activeSendFailure;
    if (!failure.canRetry) return;
    const sessionGeneration = failure.kind === "ai_response"
      ? failure.request.sessionGeneration
      : failure.draft.sessionGeneration;
    if (!isCurrentChatSession(sessionGeneration)) return;
    sendingRef.current = true;
    try {
      if (failure.kind === "partner_ingest") {
        setInputByLane((current) => (
          updateAmoraChatLaneRecord(current, "shared_partner", failure.draft.text)
        ));
        await sendPartnerDraft(failure.draft);
        return;
      }
      if (failure.kind === "ai_insert") {
        setInputByLane((current) => (
          updateAmoraChatLaneRecord(
            current,
            failure.draft.sourceLane,
            failure.draft.text,
          )
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
      || !initialLoaded
      || chatLoadError !== null
      || !coupleId
      || !userId
      || !userRole
      || !activeVisibility
      || !activeLane
    ) return;
    const crisisPreflight = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: activeVisibility,
      target,
      senderRole: userRole,
    });
    const effectiveVisibility = crisisPreflight.effectiveVisibility;
    const effectiveLane = aiLaneForVisibility(effectiveVisibility);
    if (crisisPreflight.disposition === "local_safety_hold") {
      if (safetyHoldLockRef.current) return;
      safetyHoldLockRef.current = true;
      const privacyNotice = crisisPreflight.partnerDeliveryHeld
        ? "안전을 위해 이 메시지는 상대방에게 보내거나 저장하지 않았어요."
        : "안전을 위해 이 내용은 상대방에게 공유하거나 저장하지 않았어요.";
      const safetyCard: ChatMessage = {
        id: `amora-crisis-preflight:${userId}:${Date.now()}`,
        couple_id: coupleId,
        sender_id: null,
        role: "assistant",
        sender_type: "ai",
        content: `${privacyNotice}\n\n${crisisPreflight.response}`,
        metadata: {
          response_origin: crisisPreflight.safetyResolution === "immediate_crisis"
            ? "client_deterministic_crisis_preflight"
            : "client_deterministic_safety_privacy_preflight",
          ...(crisisPreflight.classification
            ? { safety_classification: crisisPreflight.classification.kind }
            : {}),
          question_scope: crisisPreflight.safetyResolution === "immediate_crisis"
            ? "W5_safety_override"
            : "W2_high_risk_adjacent",
          memory_eligible: false,
          persistence_status: "ephemeral_local_only",
          pinned_safety_card: true,
          raw_disclosure_persisted: false,
        },
        created_at: new Date().toISOString(),
        visibility: crisisPreflight.effectiveVisibility,
      };
      setMessages((previous) => previous.some((message) => message.id === safetyCard.id)
        ? previous
        : [...previous, safetyCard]
      );
      setInputByLane((current) => (
        current[activeLane].trim() === text
          ? moveHeldDraftToPrivateLane(current, activeLane, text)
          : current
      ));
      setLaneFailure(activeLane, null);
      setPartnerSafetyNotice(null);
      setActiveScope("private");
      setTarget("ai");
      return;
    }
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
      if (effectiveLane !== activeLane) setLaneFailure(effectiveLane, null);
      setColdStartAiRecoveryByLane((current) => (
        updateAmoraChatLaneRecord(current, activeLane, null)
      ));
      const clientRequestId = Crypto.randomUUID();

      if (target === "partner") {
        if (activeVisibility !== "shared" || !partnerRecipientId) return;
        await sendPartnerDraft({
          text,
          target: "partner",
          clientRequestId,
          partnerRecipientId,
          coupleId,
          userId,
          senderType: userRole,
          requestedVisibility: "shared",
          visibility: "shared",
          providerAttachmentCount: 0,
          sessionGeneration,
        });
        return;
      }

      if (
        crisisPreflight.disposition === "private_safety_route"
        && crisisPreflight.safetyPrivacyRedirected
      ) {
        setActiveScope("private");
        setTarget("ai");
      }

      await sendAiDraft({
        text,
        sourceLane: activeLane,
        target: "ai",
        clientRequestId,
        coupleId,
        userId,
        senderType: userRole,
        senderName: userName,
        requestedVisibility: activeVisibility,
        visibility: effectiveVisibility,
        providerAttachmentCount: 0,
        sessionGeneration,
      }, false);
    } finally {
      if (isCurrentChatSession(sessionGeneration)) sendingRef.current = false;
    }
  }

  function handleInputChange(value: string) {
    if (!activeLane) return;
    safetyHoldLockRef.current = false;
    setActiveInput(value);
    setSendFailuresByLane((current) => {
      const failure = current[activeLane];
      return failure?.kind === "partner_ingest" || failure?.kind === "ai_insert"
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
    safetyHoldLockRef.current = false;
    setTarget(nextTarget);
  }

  function handleAiSuggestion(value: string) {
    if (streaming || sendingRef.current) return;
    safetyHoldLockRef.current = false;
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
          sessionUserIdRef.current,
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
        sessionUserIdRef.current,
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
      const content = "좋아요. 제안한 변경을 적용해 주세요.";
      await sendAiDraft({
        text: content,
        sourceLane: "shared_ai",
        target: "ai",
        clientRequestId: Crypto.randomUUID(),
        coupleId,
        userId,
        senderType: userRole,
        senderName: userName,
        requestedVisibility: "shared",
        visibility: "shared",
        providerAttachmentCount: 0,
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
        sessionUserIdRef.current,
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
    // userRole이 아직 null이면 isMe가 false로 떨어져 내 메시지도 왼쪽으로 온다.
    // 그 상태에서 상대 이름을 붙이면 오귀속이므로 sender_id로 한 겹 더 막는다.
    const isSelfMessage = Boolean(userId) && item.sender_id === userId;
    const allPlaceResults = (item.metadata?.toolResults ?? []).filter(
      (result) => result.toolName === "search_nearby_places",
    );
    // 방금 받은 결과와 저장된 자리표시가 같은 메시지에 함께 있을 수 있다.
    // 그때는 실제 결과만 그린다 — 둘 다 그리면 카드가 두 벌 나온다.
    const livePlaceResults = allPlaceResults.filter(
      (result) => !isPlaceSearchPlaceholder(result),
    );
    const placeResults = livePlaceResults.length > 0 ? livePlaceResults : allPlaceResults;
    const hasPlaceResults = placeResults.length > 0;
    // 2026-09-04: 반영 결과 영수증. 카드로 못 그리는 도구는 모델이 null 을 주고,
    // 같은 실패가 여러 번 온 턴은 한 장으로 접는다.
    // 그리는 도구를 이름으로 걸러낸다(renderedToolsAreDeclared.test.mjs 가 선언 목록과 대조).
    const toolResultCards = isAi
      ? dedupeToolResultCards(
          (item.metadata?.toolResults ?? [])
            .filter((result) => (
              result.toolName === "update_budget"
              || result.toolName === "update_category_budget"
              || result.toolName === "add_custom_category"
              || result.toolName === "apply_budget_plan"
              || result.toolName === "update_wedding_date"
              || result.toolName === "update_venue"
              || result.toolName === "update_task_status"
              || result.toolName === "toggle_checklist_item"
              || result.toolName === "add_schedule_event"
              || result.toolName === "update_schedule_event"
              || result.toolName === "cancel_schedule_event"
              || result.toolName === "restore_schedule_event"
              || result.toolName === "add_amora_action"
              || result.toolName === "log_wedding_event"
            ))
            .map((result) => getToolResultCardModel(result))
            .filter((model): model is NonNullable<typeof model> => model !== null),
        )
      : [];
    const isThinking = isAi && item.id.startsWith("temp_") && !item.content && !hasPlaceResults && streaming;
    // 근거 표식은 아모라만 붙인다. 사용자가 대괄호를 직접 쓴 것을 지우면 안 되므로
    // 사람이 쓴 메시지는 손대지 않는다.
    const citation = isAi
      ? parseAmoraCitations(item.content)
      : { text: item.content, parts: [] as number[] };
    const citationText = citation.text;
    const citationNotice = isAi ? describeAmoraCitations(citation.parts) : null;
    const shouldRenderBubble = isThinking || Boolean(citationText.trim());
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
          getAmoraPendingActionApplicationState(pendingAction, actionConfirmationOutcomes),
        )
      : null;
    // 지난 날짜를 저장하려는 카드인가 (2026-09-03). 막지 않고 한 줄만 덧붙인다 —
    // 웹 카드와 같은 판정을 쓴다(`isPendingActionPastDated`).
    const pendingActionIsPastDated = pendingAction
      ? isPendingActionPastDated(pendingAction, nowMs)
      : false;
    // 직전 턴에서 옮겨져 온 카드인가 (2026-09-04). 서버 metadata 값만 본다 —
    // 화면이 직전 행을 뒤져 추측하지 않는다. 웹과 같은 판정을 쓴다.
    const pendingActionIsCarriedForward = pendingAction
      ? getPendingAmoraActionCarryCount(item) >= 1
      : false;
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
    const bubbleBg = isAi ? colors.surface : isMe ? colors.noir[800] : colors.ivory.warm;
    const textColor = isMe ? "#FFF" : colors.noir[800];

    return (
      <View style={[st.msgRow, isMe && st.msgRowRight]}>
        {!isMe && (
          <View style={[st.avatar, isAi ? st.avatarAi : st.avatarPerson]}>
            {isAi ? <Sparkles size={12} color={colors.gold.DEFAULT} /> : <User size={12} color={colors.noir[800]} />}
          </View>
        )}
        <View style={[
          st.messageBody,
          isPinnedSafetyCard && st.safetyMessageBody,
          (mediationBlock || pendingAction) && st.mediationMessageBody,
          hasPlaceResults && st.placeMessageBody,
        ]}>
          {!isMe && <Text style={st.senderLabel}>{isAi ? "아모라" : isSelfMessage ? userName : partnerName ?? "파트너"}{isPartnerMsg ? " ♥" : ""}</Text>}
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
              <View style={[st.bubble, { backgroundColor: bubbleBg }, !isMe && !isAi && { borderWidth: 1, borderColor: colors.border }, isAi && { borderWidth: 1, borderColor: colors.border }, isMe && st.bubbleRight, !isMe && st.bubbleLeft]}>
                {isThinking ? <ThinkingDots /> : (
                  <>
                    <Text style={[st.bubbleText, { color: textColor }, isAi && { lineHeight: 24 }]}>
                      {citationText}
                    </Text>
                    {/* 아모라가 예절 안내를 근거로 답하면 본문 끝에 `[etiquette:N]`을 붙인다.
                        웹은 그 표식을 안내 카드로 바꾸는데 모바일은 그대로 그려서
                        사용자가 `[etiquette:9]`를 읽고 있었다. 근거를 대라고 만든 표식이
                        깨진 텍스트로 보이던 것이다. 번호를 주제별 링크로 바꾸려면
                        번호→슬러그 자료가 필요한데 지금은 웹 안에만 있어, 우선 표식을
                        걷어내고 무엇을 근거로 했는지만 말한다. */}
                    {citationNotice !== null && (
                      <Text style={st.citationNotice}>{citationNotice}</Text>
                    )}
                  </>
                )}
              </View>
            )
          )}
          {placeResults.map((result, index) => (
            <PlaceCards key={`${result.toolName}-${index}`} result={result} />
          ))}
          {toolResultCards.map((model, index) => (
            <ToolResultCard key={`${model.toolName}-${index}`} model={model} />
          ))}
          {isAi && !isThinking && !isPinnedSafetyCard && userId && (item.visibility === "bride_private" || item.visibility === "groom_private") && (
            <PersonalActionSave key={`${userId}:${item.couple_id}:${item.id}`} ownerId={userId} coupleId={item.couple_id} messageId={item.id} content={item.content} personalActionDraft={item.metadata?.personal_action_draft} personalActionsView={item.metadata?.personal_actions_view} />
          )}
          {mediationBlock && (
            <AmoraMediationCard
              key={`${item.id}:${mediationBlock.proposalVersion ?? "draft"}:${mediationBlock.rosterFingerprint ?? "unknown-roster"}`}
              block={mediationBlock}
              messageId={item.id}
            />
          )}
          {pendingAction && (
            <View style={[st.pendingActionCard, pendingActionIsCarriedForward && st.pendingActionCarriedCard]}>
              <View style={st.pendingActionHeading}>
                <View style={st.pendingActionIcon} accessibilityElementsHidden>
                  <ShieldCheck size={18} color="#795252" />
                </View>
                <View style={st.pendingActionCopy}>
                  {/* 이월된 카드는 **무엇을 바꾸는지가 먼저**다(2026-09-04). 새 답변
                      문장 바로 아래에 "적용하기 전에 확인해 주세요" 가 붙으면 사용자는
                      방금 읽은 내용을 확인하는 것으로 읽는다. 이월일 때만 서버가 발급한
                      확인문을 라벨 아래 제목 자리에 그대로 올리고 일반 문장을 내린다.
                      확인 버튼 문구는 그대로다. 웹 카드와 같은 순서다. */}
                  {pendingActionIsCarriedForward && (
                    <View style={st.pendingActionCarryBadge}>
                      <Text style={st.pendingActionCarryBadgeText}>
                        {CARRIED_PENDING_ACTION_LABEL}
                      </Text>
                    </View>
                  )}
                  <Text style={st.pendingActionTitle}>
                    {pendingActionIsCarriedForward
                      ? pendingAction.confirmation
                      : requiresCoupleApproval
                        ? "두 분 확인이 필요한 변경이에요"
                        : "적용하기 전에 확인해 주세요"}
                  </Text>
                  <Text
                    style={[
                      st.pendingActionConfirmation,
                      pendingActionIsCarriedForward && st.pendingActionCarriedPurpose,
                    ]}
                  >
                    {pendingActionIsCarriedForward
                      ? requiresCoupleApproval
                        ? "두 분 확인이 필요한 변경이에요"
                        : "적용하기 전에 확인해 주세요"
                      : pendingAction.confirmation}
                  </Text>
                </View>
              </View>
              {impactPreview && <BudgetImpactDetails preview={impactPreview} />}
              {pendingActionIsPastDated && (
                <View
                  style={[st.pendingActionApprovalStatus, st.pendingActionApprovalError]}
                  accessibilityLiveRegion="polite"
                >
                  <Text style={[st.pendingActionApprovalText, st.pendingActionApprovalErrorText]}>
                    {PAST_SCHEDULE_DATE_NOTICE}
                  </Text>
                </View>
              )}
              {pendingActionDisabledReason && (
                <Text style={st.pendingActionStatus} accessibilityLiveRegion="polite">
                  {pendingActionDisabledReason === "applied"
                    ? "이 제안은 적용됐어요."
                    : pendingActionDisabledReason === "expired"
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
        <View style={st.headerLeft}><View style={st.headerLogo}><Sparkles size={16} color={colors.gold.DEFAULT} /></View><View><Text style={st.headerTitle}>아모라</Text><Text style={st.headerSub}>결혼 준비 동반자</Text></View></View>
        {scopedMessages.length > 0 && <StatusPill label={`${scopedMessages.length}`} tone="neutral" />}
      </View>

      {/*
        아모라 답변이 AI 생성물임을 화면에서 항상 확인할 수 있게 한다.

        모바일에는 이 표시가 **한 곳도 없었다**(2026-08-28 감사). 그런데 약관과
        AI 정책은 표시가 포함된다고 대외에 공표하고 있었고, 웹은
        `ChatContent` 헤더에 같은 배지를 늘 그린다. 주 제품인 앱에서만 사용자가
        그 표시를 한 번도 못 보고, AI 정책으로 갈 경로도 앱 안에 없었다.

        문구는 웹과 같은 것을 쓴다 — 두 화면이 같은 사실을 다르게 말하면 안 된다.
      */}
      <View style={st.aiNotice}>
        <View style={st.aiDot} />
        <Text style={st.aiNoticeStrong}>AI 생성 답변</Text>
        <Text style={st.aiNoticeText}>· 계약·가격·중요 일정은 원문을 다시 확인해 주세요</Text>
        <Pressable
          onPress={() => { void Linking.openURL(AI_POLICY_URL); }}
          accessibilityRole="link"
          accessibilityLabel="AI 정책 열기"
          hitSlop={8}
        >
          <Text style={st.aiNoticeLink}>AI 정책</Text>
        </Pressable>
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
            ? hasActiveW5SafetyCard
              ? activeW5PersistenceState.persistence === "none"
                ? "현재 안전 안내 · 입력 내용은 저장되지 않았어요. 안전 안내는 이 화면에만 표시되고 상대방에게 보이지 않아요"
                : activeW5PersistenceState.persistence === "shared"
                  ? "현재 안전 안내 · 입력 내용은 이전 전송에서 이미 상대방에게 전달·저장됐어요. 지금은 추가 공유를 멈췄어요"
                  : activeW5PersistenceState.persistence === "private_only"
                    ? "현재 안전 안내 · 입력 내용은 이전 전송에서 비공개 대화에 저장됐어요. 지금은 추가 전송을 멈췄어요"
                    : activeW5PersistenceState.rawDisclosurePersisted === true
                      ? "현재 안전 안내 · 입력 내용은 이전 전송에서 저장됐지만 저장 범위는 확인하지 못했어요. 지금은 추가 전송을 멈췄어요"
                      : "현재 안전 안내 · 입력 내용의 이전 저장·전달 여부를 확인하지 못했어요. 지금은 추가 공유를 멈췄어요"
              : "현재 범위 · 나만 (상담) — 서비스에 저장되며 상대방에게는 보이지 않아요"
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
        {initialLoaded && !chatLoadError && !!userRole && !isP && <AmoraConversationRecap
          key={`${userId}:${coupleId}:${activeScope}`} recap={conversationRecap} scopeLabel={activeScope === "private" ? "나만 상담" : "함께 대화"} disabled={streaming}
          onPrefill={text => {
            if (streaming || sendingRef.current || !activeLane || inputByLaneRef.current[activeLane].trim()) return false;
            setInputByLane(current => current[activeLane].trim() ? current : updateAmoraChatLaneRecord(current, activeLane, text));
            return true;
          }} />}
        {!initialLoaded ? (
          <View style={st.loading}>
            <ActivityIndicator color={colors.rose[500]} />
            <Text style={st.loadingText}>대화를 준비하는 중이에요</Text>
          </View>
        ) : chatLoadError ? (
          <View style={st.empty}>
            <EmptyState title="대화를 불러오지 못했어요" description={chatLoadError}
              action={<Pressable style={st.retryBtn} onPress={() => reloadChatSessionRef.current()} accessibilityRole="button" accessibilityLabel="대화 다시 불러오기"><Text style={st.retryText}>다시 불러오기</Text></Pressable>} />
          </View>
        ) : displayedMessages.length === 0 ? (
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
              <View style={st.suggestions}>{AMORA_STARTER_PROMPTS.map((q) => (<Pressable key={q} style={({ pressed }) => [st.sugBtn, pressed && { opacity: 0.85 }]} onPress={() => handleAiSuggestion(q)}><Text style={st.sugText}>{q}</Text></Pressable>))}</View>
            )}
          </View>
        ) : (
          <FlatList ref={flatListRef} data={visibleMessages} inverted keyExtractor={(m) => m.id} renderItem={renderMessage} contentContainerStyle={st.messageList} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === "android"} maxToRenderPerBatch={10} windowSize={5} initialNumToRender={12} />
        )}

        {/* 아모라의 첫마디만 놓여 있고 아직 오간 말이 없을 때. 화면은 비어 있지 않지만
            이 사람은 여전히 "무엇부터 물어보지"에 서 있다. */}
        {initialLoaded && scopedMessages.length === 0 && firstHelloMessage && !isP && (
          <View style={st.suggestions}>{AMORA_STARTER_PROMPTS.map((q) => (<Pressable key={q} style={({ pressed }) => [st.sugBtn, pressed && { opacity: 0.85 }]} onPress={() => handleAiSuggestion(q)}><Text style={st.sugText}>{q}</Text></Pressable>))}</View>
        )}

        {!hasActiveW5SafetyCard && quotaRemaining !== null && !streaming && (
          <View style={st.quotaBar} accessibilityLiveRegion="polite">
            <Text style={st.quotaText}>
              {quotaRemaining > 0
                ? `무료 상담이 ${quotaRemaining}회 남았어요.`
                : "무료 상담을 모두 사용했어요."}
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

        {!hasActiveW5SafetyCard && !activeSendFailure && activeColdStartAiRecovery && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText}>
              {activeColdStartAiRecovery.disposition === "reattach_required"
                ? activeColdStartAiRecovery.providerAttachmentState === "present"
                  ? "첨부파일이 포함된 질문이에요. 첨부파일을 다시 선택해 새 메시지로 보내 주세요."
                  : "이 질문의 첨부 상태를 확인할 수 없어요. 첨부파일을 다시 선택해 새 메시지로 보내 주세요."
                : "저장된 질문의 아모라 답변을 이어받을 수 있어요."}
            </Text>
            {activeColdStartAiRecovery.disposition === "resumable" && (
              <Pressable
                style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
                onPress={handleColdStartAiRecovery}
                disabled={streaming}
                accessibilityRole="button"
                accessibilityLabel="저장된 질문의 아모라 답변 이어받기"
                accessibilityState={{ disabled: streaming }}
              >
                <Text style={st.retryText}>답변 이어받기</Text>
              </Pressable>
            )}
          </View>
        )}

        {!hasActiveW5SafetyCard && activeSendFailure && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {activeSendFailure.message}
            </Text>
            {activeSendFailure.unavailableReason && (
              <Text style={st.failureText}>{activeSendFailure.unavailableReason}</Text>
            )}
            {activeSendFailure.canRetry && (
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
          <TextInput style={st.input} value={input} onChangeText={handleInputChange} placeholder={isP ? `${partnerName ?? "파트너"}에게 메시지...` : activeScope === "private" ? "나만의 상담을 입력하세요..." : "메시지를 입력하세요..."} placeholderTextColor={colors.taupe[400]} multiline maxLength={4000} editable={!streaming && initialLoaded && !chatLoadError} returnKeyType="send" accessibilityLabel="메시지 입력" />
          <Animated.View style={{ transform: [{ scale: sendBtnScale }] }}>
            <Pressable style={[st.sendBtn, isP && { backgroundColor: colors.rose[500] }, (!input.trim() || streaming || !initialLoaded || Boolean(chatLoadError)) && st.sendBtnOff]} onPress={handleSend} onPressIn={pressIn} onPressOut={pressOut} disabled={!input.trim() || streaming || !initialLoaded || Boolean(chatLoadError)} accessibilityLabel="메시지 보내기" accessibilityRole="button">
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
  aiNotice: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 6,
    backgroundColor: colors.surface,
  },
  aiDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.rose[500] },
  aiNoticeStrong: { fontSize: 11, fontWeight: "600", color: colors.rose[500] },
  aiNoticeText: { fontSize: 11, color: colors.textTertiary },
  aiNoticeLink: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textTertiary,
    textDecorationLine: "underline",
  },
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
  avatarPerson: { backgroundColor: colors.ivory.warm },
  senderLabel: { fontSize: 11, color: colors.textTertiary, marginBottom: 4, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleRight: { borderBottomRightRadius: 4 },
  bubbleLeft: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  // 근거 문구는 답변보다 작고 조용하게. 본문을 밀어내지 않되, 무엇에 기대어 답했는지는
  // 보이게 한다.
  citationNotice: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textTertiary,
  },
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
  // 이월된 카드 (2026-09-04) — 테두리를 점선으로, 바탕을 한 톤 낮춰 원본 턴 카드와 가른다.
  pendingActionCarriedCard: { borderStyle: "dashed", borderColor: "#B99A7E", backgroundColor: "#FBF5EE" },
  pendingActionCarryBadge: { alignSelf: "flex-start", marginBottom: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: "#B99A7E", backgroundColor: "#F2E8DE" },
  pendingActionCarryBadgeText: { fontSize: 12, lineHeight: 17, fontWeight: "700", color: "#795252" },
  pendingActionCarriedPurpose: { fontSize: 12, lineHeight: 18, color: "#795252" },
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
