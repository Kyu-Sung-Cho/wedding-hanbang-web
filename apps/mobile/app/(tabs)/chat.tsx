// AI 채팅 (아모라) + 파트너 메시지 — 웹과 동일 chat_messages 연동
// 기존 공간은 역할별 색을 유지하고, 중립 준비공간은 나/파트너 표기만 사용한다.
import { useState, useRef, useEffect, useCallback, useMemo, type SetStateAction } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, ScrollView, StyleSheet,
  Keyboard, KeyboardAvoidingView, Modal, Platform, Animated, ActivityIndicator,
  AccessibilityInfo,
  type ViewToken,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowRight, Check, CheckCircle2, Send, ShieldCheck, SlidersHorizontal, Sparkles, Heart, X, Lock, RotateCcw, Square, Users } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import type {
  BudgetImpactPreview,
  BudgetImpactWarning,
  PlanningFoundationSelfReportedStage,
} from "@hanbang/shared";
import type { AmoraScheduleCareFollowUpBinding } from "@hanbang/shared/amora-schedule-care-follow-up";
import {
  isAmoraPreparationTopicMessageRefTopicKey,
  type AmoraPreparationTopicMessageRefAudience,
  type AmoraPreparationTopicMessageRefCollectionItem,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
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
import { hasAmoraChatSafetySignal } from "@hanbang/shared/amora-chat-safety-signal";
import {
  assessMediationOffer,
  hasUnresolvedPrivateMediationSafetyHold,
  hasMediationSafetySignal,
} from "@hanbang/shared/mediation-offer";
import { supabase } from "@/lib/supabase";
import {
  assertAmoraRequestActor,
  assertSharedActionActor,
} from "@/lib/amoraSharedActionActorFence.mjs";
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
import AmoraStarterCard from "@/components/chat/AmoraStarterCard";
import AmoraPersonalizationSheet from "@/components/chat/AmoraPersonalizationSheet";
import AmoraFirstUseActionCard from "@/components/chat/AmoraFirstUseActionCard";
import { ActionRow, AppText, EmptyState, IconBadge, PrimaryButton, StatusPill } from "@/components/ui/AppUI";
import AmoraMediationCard from "@/components/chat/AmoraMediationCard";
import AmoraMediationConsentModal from "@/components/chat/AmoraMediationConsentModal";
import {
  buildAmoraMediationRequestBody,
  createAmoraMediationDismissalRecord,
  normalizeAmoraMediationSummary,
  parseAmoraMediationDismissalRecord,
} from "@/lib/amoraMediationRequest.mjs";
import { consumeCompanionChatHandoff } from "@/lib/companionChatHandoff.mjs";
import {
  buildPreparationTopicChatReturnDestination,
  createPreparationTopicChatComposerBinding,
  createPreparationTopicChatReturnReceipt,
  reconcilePreparationTopicChatComposerBinding,
  resolvePreparationTopicChatBindingForSend,
  type PreparationTopicChatComposerBinding,
  type PreparationTopicChatReturnReceipt,
} from "@/lib/preparationTopicChatRoundTrip.mjs";
import {
  createScheduleCareFollowUpComposerBinding,
  createScheduleCareFollowUpOperationGuard,
  getScheduleCareFollowUpActionDraft,
  getScheduleCareFollowUpComposerIssue,
  getScheduleCareFollowUpFailureRecovery,
  loadScheduleCareFollowUpPreview,
  parseScheduleCareFollowUpRouteBinding,
  prepareScheduleCareSharedDraft,
  readScheduleCareFollowUpBindingFromMetadata,
  reconcileScheduleCareFollowUpComposerBinding,
  resolveScheduleCareFollowUpBindingForSend,
  validateScheduleCareFollowUpIngestReceipt,
  SCHEDULE_CARE_FOLLOW_UP_PREVIEW_TIMEOUT_MS,
  type ScheduleCareFollowUpComposerBinding,
  type ScheduleCareFollowUpFailureRecovery,
  type ScheduleCareFollowUpPreview,
  type ScheduleCareFollowUpPreviewStatus,
} from "@/lib/scheduleCarePrivateFollowUp.mjs";
import { stageActionReceiptHomeHandoff } from "@/lib/actionReceiptHomeHandoff.mjs";
import {
  clearPlanningFoundationDraftHandoff,
  readPlanningFoundationDraftHandoff,
} from "@/lib/planningFoundationDraftHandoff";
import {
  buildPlanningFoundationPrivateDraft,
  buildFirstUseCriterionCorrectionDraft,
  buildFirstUseCorrectionDraft,
  getFirstUsePendingActionPresentation,
  getAmoraParticipantPresentation,
  getFirstUseSharedDraftPresentation,
  getReviewedActionContinuationPresentation,
  isFirstUseSharedActionDraftText,
  planFirstUseSharedDraftPrivateRecovery,
  resolveAmoraChatEntry,
  resolveAmoraFirstUseSessionResetScope,
  resolveFirstUseActionBubbleContent,
  resolvePlanningFoundationEntryStage,
  selectPrivateActionDraftForBridge,
} from "@/lib/amoraEntryPlan.mjs";
import {
  createFirstUsePromotionOperationGuard,
  createFirstUseComposerBinding,
  getFirstUsePromotionSendRecovery,
  isPersistedFirstUseSourceMessageId,
  loadAmoraFirstUsePromotionPreview,
  reconcileFirstUseComposerBinding,
  resolveFirstUseSourceMessageIdForSend,
  validateFirstUsePromotionIngestReceipt,
  type FirstUseComposerBinding,
  type FirstUsePromotionSendRecovery,
  type FirstUsePromotionUiStatus,
} from "@/lib/amoraFirstUsePromotion.mjs";
import {
  hasPrivateMediationSafetyHold,
  sealPrivateMediationSafetyHold,
} from "@/lib/privateMediationSafetyHold";
import { apiFetchForExpectedUser } from "@/lib/api";
import { getQuoteAnalysisMessagePresentation } from "@hanbang/shared/quote-analysis-presentation";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  getPreparationTopicMessageReferenceFocusPresentation,
  isPreparationTopicMessageSaveEligible,
  loadPreparationTopicMessageReferenceState,
  loadPreparationTopicMessageReferences,
  mergePreparationTopicResolvedConversation,
  mutatePreparationTopicMessageReference,
  PreparationTopicMessageRefError,
  resolvePreparationTopicMessageReference,
} from "@/lib/preparationTopicMessageRefs.mjs";

const API_BASE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";
const NEUTRAL_PREPARATION_SPACE_ENABLED =
  process.env.EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true";
const CHAT_REQUEST_TIMEOUT_MS = 180_000;
const CHAT_INGEST_TIMEOUT_MS = 30_000;
const MOBILE_DURABLE_SAFETY_SEAL_TIMEOUT_MS = 4_000;
const PREPARATION_TOPIC_OPTIONS = Object.freeze(
  CATEGORY_CHECKLISTS.filter((topic) => (
    isAmoraPreparationTopicMessageRefTopicKey(topic.key)
  )).map((topic) => Object.freeze({ key: topic.key, label: topic.label })),
);
const reviewedActionContinuationPresentation =
  getReviewedActionContinuationPresentation();
const firstUseSharedDraftPresentation =
  getFirstUseSharedDraftPresentation();
const SCHEDULE_CARE_FOLLOW_UP_STATUS_COPY: Record<
  ScheduleCareFollowUpEntryStatus,
  string
> = {
  checking: "어제 가족 만남 일정과 연결 상태를 확인하고 있어요. 아직 아무것도 보내거나 저장하지 않았어요.",
  timeout: "확인이 조금 오래 걸렸어요. 아무것도 보내거나 저장하지 않았어요.",
  unavailable: "어제 가족 만남 일정 상태를 확인하지 못했어요. 아무것도 보내거나 저장하지 않았어요.",
  identity_changed: "계정이나 커플 연결이 바뀌었어요. 이 초안을 열거나 보내지 않았어요.",
  stale: "가족 만남 일정 기록이 바뀌어 예전 질문을 이어오지 않았어요.",
  draft_changed: "일정 안내 부분이 바뀌어 출처 연결을 해제했어요. 현재 내용은 일반 나만 상담 초안으로만 보낼 수 있어요.",
  answer_required: "내 답을 한 문장 이상 적어 주세요. 아직 아무것도 보내거나 저장하지 않았어요.",
  answer_invalid: "답변에 지원하지 않는 문자나 너무 긴 내용이 있어요. 내용을 다듬어 주세요. 아직 아무것도 보내거나 저장하지 않았어요.",
  composer_occupied: "나만 상담에 작성 중인 초안이 있어 덮어쓰지 않았어요. 먼저 보내거나 비운 뒤 다시 불러와 주세요.",
};
const SCHEDULE_CARE_SHARED_DRAFT_FAILURE_COPY: Record<
  ScheduleCareFollowUpPreviewStatus,
  string
> = {
  timeout: "가족 만남 기록 확인이 오래 걸려 이 행동을 우리 준비로 가져오지 않았어요. 아무것도 보내거나 저장하지 않았으니 잠시 후 다시 눌러 주세요.",
  unavailable: "가족 만남 기록을 다시 확인하지 못해 이 행동을 우리 준비로 가져오지 않았어요. 아무것도 보내거나 저장하지 않았어요.",
  identity_changed: "계정이나 커플 연결이 바뀌어 이 행동을 우리 준비로 가져오지 않았어요. 아무것도 보내거나 저장하지 않았어요.",
  stale: "연결한 가족 만남 기록이나 아모라 제안이 바뀌어 이 행동을 우리 준비로 가져오지 않았어요. 아무것도 보내거나 저장하지 않았어요.",
};

async function currentVerifiedChatIdentity(): Promise<{
  userId: string;
  coupleId: string;
} | null> {
  const { data: firstAuth, error: firstAuthError } = await supabase.auth.getUser();
  const userId = firstAuth.user?.id ?? null;
  if (firstAuthError || !userId) return null;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError || typeof profile?.couple_id !== "string") return null;
  const { data: secondAuth, error: secondAuthError } = await supabase.auth.getUser();
  if (secondAuthError || secondAuth.user?.id !== userId) return null;
  return { userId, coupleId: profile.couple_id };
}

async function sealDurableMediationPrivateSafetyHold(
  expectedOwnerUserId: string,
  expectedCoupleId: string,
): Promise<boolean> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    MOBILE_DURABLE_SAFETY_SEAL_TIMEOUT_MS,
  );
  try {
    const response = await apiFetchForExpectedUser(
      expectedOwnerUserId,
      "/api/amora/mediation/private-safety-hold",
      {
        method: "POST",
        signal: timeoutController.signal,
        headers: { "Content-Type": "application/json" },
        // Opaque by contract: never include the disclosure, summary, reason,
        // classification, or inferred partner state.
        body: JSON.stringify({ coupleId: expectedCoupleId }),
      },
    );
    if (response.status !== 200) return false;
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().join(",")
        === "coupleId,recipientUserId,sealed,version"
      && record.version === 1
      && record.sealed === true
      && record.coupleId === expectedCoupleId.toLowerCase()
      && record.recipientUserId === expectedOwnerUserId.toLowerCase();
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
const PARTNER_CONNECTION_CHANGED_NOTICE =
  "상대방 연결 상태가 바뀌어 메시지를 보내지 않았어요. 잘못 전달되지 않도록 작성 중인 초안은 삭제했어요.";
const NEW_CHAT_MESSAGE_REQUIRED_NOTICE =
  "같은 요청을 다시 보내도 해결되지 않아요. 내용을 확인한 뒤 새 메시지로 보내주세요.";
function normalizeAmoraSharedSendIdentity(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
    throw new Error("AMORA_SHARED_SEND_IDENTITY_INVALID");
  }
  return normalized;
}

function amoraSharedSendAcknowledgementKey(userId: string, coupleId: string): string {
  const ownerKey = normalizeAmoraSharedSendIdentity(userId).replaceAll("-", "");
  const coupleKey = normalizeAmoraSharedSendIdentity(coupleId).replaceAll("-", "");
  return `amora_shared_send_ack_v1_${ownerKey}_${coupleKey}`;
}

function createAmoraSharedSendAcknowledgement(userId: string, coupleId: string) {
  return {
    version: 1,
    userId: normalizeAmoraSharedSendIdentity(userId),
    coupleId: normalizeAmoraSharedSendIdentity(coupleId),
    confirmed: true,
  } as const;
}

function parseAmoraSharedSendAcknowledgement(
  raw: string | null,
  expectedUserId: string,
  expectedCoupleId: string,
): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return false;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "confirmed,coupleId,userId,version"
    || record.version !== 1
    || record.confirmed !== true
  ) return false;
  try {
    return normalizeAmoraSharedSendIdentity(String(record.userId))
      === normalizeAmoraSharedSendIdentity(expectedUserId)
      && normalizeAmoraSharedSendIdentity(String(record.coupleId))
      === normalizeAmoraSharedSendIdentity(expectedCoupleId);
  } catch {
    return false;
  }
}

async function loadAmoraSharedSendAcknowledgement(
  userId: string,
  coupleId: string,
): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(
    amoraSharedSendAcknowledgementKey(userId, coupleId),
  );
  return parseAmoraSharedSendAcknowledgement(raw, userId, coupleId);
}

async function saveAmoraSharedSendAcknowledgement(
  userId: string,
  coupleId: string,
): Promise<void> {
  await SecureStore.setItemAsync(
    amoraSharedSendAcknowledgementKey(userId, coupleId),
    JSON.stringify(createAmoraSharedSendAcknowledgement(userId, coupleId)),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
}

function amoraMediationOfferDismissalKey(userId: string, coupleId: string): string {
  const ownerKey = normalizeAmoraSharedSendIdentity(userId).replaceAll("-", "");
  const coupleKey = normalizeAmoraSharedSendIdentity(coupleId).replaceAll("-", "");
  return `amora_mediation_offer_dismissals_v1_${ownerKey}_${coupleKey}`;
}

async function loadAmoraMediationOfferDismissals(
  userId: string,
  coupleId: string,
): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(
    amoraMediationOfferDismissalKey(userId, coupleId),
  );
  return parseAmoraMediationDismissalRecord(raw, { userId, coupleId });
}

async function saveAmoraMediationOfferDismissals(
  userId: string,
  coupleId: string,
  offerKeys: string[],
): Promise<void> {
  await SecureStore.setItemAsync(
    amoraMediationOfferDismissalKey(userId, coupleId),
    createAmoraMediationDismissalRecord({ userId, coupleId, offerKeys }),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
}

interface ToolExecutionResult {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown>;
  success: boolean;
  displayMessage: string;
}

interface MobileToolReceipt {
  toolName: string;
  title: string;
  success: boolean;
  message: string;
  actionId?: string;
}

interface MobileToolReceiptContinuation {
  actionId: string;
  label: string;
  description: string;
}

interface QuoteCheckHandoff {
  toolName: "analyze_quote";
  message: string;
}

interface ChatMessageMetadata {
  target?: string;
  interaction_mode?: "listen_only";
  client_request_id?: string;
  partner_recipient_id?: string;
  client_visible_request_id?: string;
  mediation?: unknown;
  pending_amora_action?: unknown;
  pending_amora_action_journey_revision?: unknown;
  pending_amora_action_impact_preview?: unknown;
  amora_wedding_context_revision?: unknown;
  amora_first_use_grounding?: unknown;
  amora_couple_criterion_decision_id?: unknown;
  amora_first_use_promotion_id?: unknown;
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

interface TopicMessageSaveDialogState {
  sourceMessageId: string;
  audience: AmoraPreparationTopicMessageRefAudience;
  references: readonly AmoraPreparationTopicMessageRefCollectionItem[];
  partial: boolean;
  selectedTopicKey: string | null;
  selectedTopicReadState: "idle" | "loading" | "ready" | "error";
  selectedTopicSavedState: "saved" | "removed" | null;
  loading: boolean;
  collectionLoaded: boolean;
  saving: boolean;
  error: string | null;
}

interface ResolvedTopicMessageFocus {
  refId: string;
  targetMessageId: string;
  audience: AmoraPreparationTopicMessageRefAudience;
}

type TopicMessageFocusState =
  | { status: "loading"; refId: string }
  | { status: "ready"; refId: string; targetMessageId: string }
  | { status: "error"; refId: string; message: string; canRetry: boolean }
  | null;

function isMediationSafetyFenceMessage(
  message: ChatMessage,
  actorRole: ViewerRole,
): boolean {
  if (message.sender_type !== "ai") return false;
  const isSafetyCard = message.metadata?.pinned_safety_card === true
    || typeof message.metadata?.safety_classification === "string";
  if (message.visibility === "shared") return isSafetyCard;
  return actorRole !== null
    && message.visibility === `${actorRole}_private`
    && message.metadata?.pinned_safety_card === true;
}

type MessageTarget = AmoraChatTarget;
type ScheduleCareFollowUpEntryStatus =
  | "checking"
  | "answer_required"
  | "answer_invalid"
  | "draft_changed"
  | "composer_occupied"
  | ScheduleCareFollowUpPreviewStatus;
type FirstUseComposerNotice =
  | "composer_occupied"
  | "draft_changed"
  | "private_composer_occupied";
type PreparationTopicHandoffNotice = "composer_occupied" | "draft_changed";
type ChatApiMessage = Pick<ChatMessage, "role" | "content">;

interface ChatRequestBase {
  messages: ChatApiMessage[];
  coupleId: string;
  senderName: string;
  clientRequestId: string;
  visibility: ChatMessageVisibility;
  confirmedActionId?: string;
  conversationMode?: "listen_only";
}

type ChatRequestBody =
  | (ChatRequestBase & {
      requestKind?: "chat";
      userMessageId: string;
      conflictContext?: never;
    })
  | (ChatRequestBase & {
      requestKind: "mediation";
      conflictContext: string;
      userMessageId?: never;
    });

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
  interactionMode?: "listen_only";
  durableUserMessageId?: string;
  recoveredProviderAttachmentState?: "none" | "discarded_by_safety_policy";
  sessionGeneration: number;
  confirmedActionId?: string;
  amoraSourceMessageId?: string;
  firstUseSourceMessageId?: string;
  scheduleCareFollowUp?: AmoraScheduleCareFollowUpBinding;
  preparationTopic?: PreparationTopicChatComposerBinding;
}

interface AiMessageIngestExpected {
  coupleId: string;
  userId: string;
  senderType: "bride" | "groom";
  text: string;
  clientRequestId: string;
  target: MessageTarget;
  providerAttachmentCount: number;
  interactionMode?: "listen_only";
  partnerRecipientId?: string;
  confirmedActionId?: string;
  firstUseSourceMessageId?: string;
  scheduleCareFollowUp?: AmoraScheduleCareFollowUpBinding;
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
      durableSafetyFenceConfirmed: boolean;
    };

type RawDisclosurePersistence = "none" | "shared" | "private_only" | "unknown";

interface EphemeralSafetyPersistencePresentation {
  notice: string;
  persistence: RawDisclosurePersistence;
  rawDisclosureShared: boolean | null;
}

interface AiRequest {
  body: ChatRequestBody;
  expectedActorUserId: string;
  tempId: string;
  serverRequestKey: string;
  lane: Exclude<AmoraChatLane, "shared_partner">;
  sessionGeneration: number;
  mediationSafetyEpoch?: number;
  scheduleCareFollowUp?: AmoraScheduleCareFollowUpBinding;
  preparationTopic?: PreparationTopicChatComposerBinding;
}

type ChatSendOperationStopReason = "user" | "session" | "superseded" | "safety" | null;
type ChatSendOperationPhase = "preflight" | "ingest" | "ingest_result" | "stream";

interface ChatSendOperation {
  controller: AbortController;
  sessionGeneration: number;
  phase: ChatSendOperationPhase;
  stopReason: ChatSendOperationStopReason;
  requestKind: "chat" | "mediation";
  mediationSafetyEpoch: number | null;
  requestTempId: string | null;
}

interface ChatSendOperationGuard {
  start: (sessionGeneration: number) => ChatSendOperation;
  stopActive: (reason: Exclude<ChatSendOperationStopReason, null>) => ChatSendOperation | null;
  finish: (operation: ChatSendOperation) => boolean;
  current: () => ChatSendOperation | null;
}

interface AmoraSharedSendAcknowledgementSession {
  userId: string;
  coupleId: string;
  confirmed: boolean;
}

interface PendingSharedSendConfirmation {
  userId: string;
  coupleId: string;
  sessionGeneration: number;
  sourceLane: AmoraChatLane;
  text: string;
  saving: boolean;
  error: string | null;
}

interface MediationRequestOwner {
  userId: string;
  coupleId: string;
  sessionGeneration: number;
  offerKey: string;
  privateSafetyEpoch: number;
}

function createChatSendOperationGuard(): ChatSendOperationGuard {
  let activeOperation: ChatSendOperation | null = null;
  return {
    start(sessionGeneration) {
      if (activeOperation) {
        if (activeOperation.stopReason === null) {
          activeOperation.stopReason = "superseded";
        }
        activeOperation.controller.abort();
      }
      const operation: ChatSendOperation = {
        controller: new AbortController(),
        sessionGeneration,
        phase: "preflight",
        stopReason: null,
        requestKind: "chat",
        mediationSafetyEpoch: null,
        requestTempId: null,
      };
      activeOperation = operation;
      return operation;
    },
    stopActive(reason) {
      if (!activeOperation) return null;
      const operation = activeOperation;
      operation.stopReason = reason;
      operation.controller.abort();
      return operation;
    },
    finish(operation) {
      if (activeOperation !== operation) return false;
      activeOperation = null;
      return true;
    },
    current() {
      return activeOperation;
    },
  };
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
      requiresReconciliation: boolean;
      unavailableReason: string | null;
    }
  | {
      kind: "ai_insert";
      message: string;
      draft: AiDraft;
      canRetry: boolean;
      requiresReconciliation: boolean;
      unavailableReason: string | null;
      firstUseRecovery?: Readonly<FirstUsePromotionSendRecovery> | null;
      scheduleCareRecovery?: Readonly<ScheduleCareFollowUpFailureRecovery> | null;
    }
  | {
      kind: "ai_response";
      message: string;
      request: AiRequest;
      canRetry: boolean;
      requiresReconciliation: boolean;
      unavailableReason: string | null;
      firstUseRecovery?: Readonly<FirstUsePromotionSendRecovery> | null;
      scheduleCareRecovery?: Readonly<ScheduleCareFollowUpFailureRecovery> | null;
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
  interactionMode?: "listen_only";
  scheduleCareFollowUp?: AmoraScheduleCareFollowUpBinding;
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
  const interactionMode = metadata.interaction_mode === undefined
    ? null
    : metadata.interaction_mode === "listen_only"
      ? "listen_only" as const
      : undefined;
  if (interactionMode === undefined) return null;
  const scheduleCareFollowUp = readScheduleCareFollowUpBindingFromMetadata(metadata);
  if (
    metadata.amora_schedule_care_follow_up_v1 !== undefined
    && !scheduleCareFollowUp
  ) return null;
  if (scheduleCareFollowUp && context.visibility === "shared") return null;
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
  if (
    interactionMode === "listen_only"
    && (
      disposition !== "resumable"
      || providerAttachmentState !== "none"
      || scheduleCareFollowUp !== null
    )
  ) return null;

  return {
    disposition,
    lane: context.visibility === "shared" ? "shared_ai" : "private_ai",
    userMessageId: candidate.id,
    clientRequestId: metadata.client_request_id,
    content: candidate.content,
    visibility: candidate.visibility,
    providerAttachmentState,
    providerAttachmentCount,
    ...(interactionMode ? { interactionMode } : {}),
    ...(scheduleCareFollowUp ? { scheduleCareFollowUp } : {}),
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

type ChatRetryPolicy =
  | "same_request"
  | "new_message"
  | "regenerate_first_use_action"
  | "refresh_source"
  | "regenerate_schedule_care_follow_up";

function parseChatRetryPolicy(value: unknown): ChatRetryPolicy | null {
  return value === "same_request"
    || value === "new_message"
    || value === "regenerate_first_use_action"
    || value === "refresh_source"
    || value === "regenerate_schedule_care_follow_up"
    ? value
    : null;
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
    retryPolicy: ChatRetryPolicy | null;
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
      retryPolicy: ChatRetryPolicy | null;
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
  public readonly retryPolicy: ChatRetryPolicy | null;
}

class AiMessageIngestError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly serverCode: string | null,
    public readonly retryPolicy: ChatRetryPolicy,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(serverCode ?? "AI_MESSAGE_INGEST_FAILED");
    this.name = "AiMessageIngestError";
    this.retryable = retryPolicy === "same_request";
  }

  public readonly retryable: boolean;
}

function getAiMessageIngestRecovery(
  error: unknown,
  allowUnknownRetry: boolean,
): { canRetry: boolean; requiresReconciliation: boolean } {
  if (error instanceof AiMessageIngestError) {
    const requiresReconciliation = error.retryPolicy === "same_request";
    return {
      canRetry: requiresReconciliation,
      requiresReconciliation,
    };
  }
  return {
    canRetry: allowUnknownRetry,
    requiresReconciliation: false,
  };
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
    if (error.retryPolicy === "regenerate_first_use_action") {
      return "이 행동을 우리 준비에 추가하거나 적용하지 않았어요. 최신 준비 상태와 다시 맞추려면 나만 상담에서 한 가지 제안을 다시 확인해 주세요.";
    }
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
  if ((status >= 200 && status < 300 || status === 503) && isRecord(value)) {
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
      (status === 200 || status === 503)
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
      && value.durableSafetyFenceConfirmed === (status === 200)
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
        durableSafetyFenceConfirmed: value.durableSafetyFenceConfirmed,
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
    const reusedByFirstUseSource = expected.firstUseSourceMessageId !== undefined
      && value.reused === true
      && value.reusedBy === "first_use_source";
    const clientRequestMatches = reusedByFirstUseSource
      ? isPersistedFirstUseSourceMessageId(message?.metadata?.client_request_id)
      : message?.metadata?.client_request_id === expected.clientRequestId;
    const firstUsePromotionReceiptMatches = validateFirstUsePromotionIngestReceipt({
      requestedSourceMessageId: expected.firstUseSourceMessageId ?? null,
      responseStatus: status,
      reused: value.reused,
      reusedBy: value.reusedBy,
      messageMetadata: message?.metadata,
    });
    const scheduleCareFollowUpReceiptMatches = validateScheduleCareFollowUpIngestReceipt({
      requestedBinding: expected.scheduleCareFollowUp ?? null,
      messageMetadata: message?.metadata,
    });
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
    const interactionModeMatches = expected.interactionMode === "listen_only"
      ? message?.metadata?.interaction_mode === "listen_only"
      : message?.metadata?.interaction_mode === undefined;
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
      && firstUsePromotionReceiptMatches
      && scheduleCareFollowUpReceiptMatches
      && ingestContractMatches
      && interactionModeMatches
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
      && clientRequestMatches
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
  const requiresFirstUseRegeneration = (
    isRecord(value)
    && value.retryPolicy === "regenerate_first_use_action"
  ) || (
    typeof serverCode === "string"
    && /^(?:AMORA_)?FIRST_USE_PROMOTION_(?:REQUIRED|STALE|MISMATCH|CRITERION_STALE|IDENTITY_CHANGED|CURRENTNESS_CHANGED)$/.test(serverCode)
  );
  const requiresScheduleCareSourceRefresh = isRecord(value)
    && value.retryPolicy === "refresh_source"
    && typeof serverCode === "string"
    && /^SCHEDULE_CARE_FOLLOW_UP_(?:INVALID|STALE|SCOPE_CHANGED|UNAVAILABLE)$/u.test(serverCode);
  const retryPolicy: ChatRetryPolicy = requiresFirstUseRegeneration
    ? "regenerate_first_use_action"
    : requiresScheduleCareSourceRefresh
      ? "refresh_source"
    : status === 408
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

function getMobileToolReceiptTitle(toolName: string): string {
  if (toolName === "update_budget") return "예산 변경";
  if (toolName === "update_schedule_event") return "일정 변경";
  if (toolName === "add_amora_action") return "아모라 행동 저장";
  if (toolName === "create_booking") return "아모라 예약 요청 기록";
  return "작업 결과";
}

const MOBILE_AMORA_ACTION_ID_PATTERN = /^[0-9A-Za-z_-]{1,200}$/u;

function getMobileToolReceiptActionId(result: ToolExecutionResult): string | null {
  if (result.toolName !== "add_amora_action" || !result.success) return null;
  const action = isRecord(result.toolOutput.action) ? result.toolOutput.action : null;
  if (
    !action
    || action.status !== "open"
    || typeof action.id !== "string"
    || !MOBILE_AMORA_ACTION_ID_PATTERN.test(action.id)
  ) return null;
  return action.id;
}

function containsInternalToolIdentifier(
  result: ToolExecutionResult,
  message: string,
): boolean {
  const inputIdentifiers = Object.entries(result.toolInput)
    .filter(([key, value]) =>
      /(?:^|_)(?:id|uuid)$/i.test(key)
      && typeof value === "string"
      && value.length > 0
    )
    .map(([, value]) => value as string);
  return /\b(?:ID|UUID)\s*:/i.test(message)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(message)
    || /\b(?:act|booking|evt|msg|req|request|action)[_-][A-Za-z0-9_-]{6,}\b/i.test(message)
    || inputIdentifiers.some((identifier) => message.includes(identifier));
}

function getUserFacingToolDisplayMessage(result: ToolExecutionResult): string {
  const message = result.displayMessage.trim();
  if (!message || !containsInternalToolIdentifier(result, message)) return message;
  if (result.success) return "요청한 작업을 완료했어요.";
  if (result.toolName === "update_schedule_event") {
    return "수정할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.";
  }
  if (result.toolName === "cancel_schedule_event") {
    return "취소할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.";
  }
  if (result.toolName === "restore_schedule_event") {
    return "복원할 취소 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.";
  }
  if (result.toolName === "delete_schedule_event") {
    return "일정 삭제는 지원하지 않아요. 일정 목록에서 취소를 다시 선택해 주세요.";
  }
  if (result.toolName === "toggle_checklist_item") {
    return "변경할 체크리스트 항목을 찾지 못했어요. 진행 현황을 새로 불러온 뒤 다시 선택해 주세요.";
  }
  return "요청한 항목을 찾지 못했어요. 목록을 새로 불러온 뒤 다시 시도해 주세요.";
}

function getMobileChatMessagePresentation(
  message: Pick<ChatMessage, "id" | "sender_type" | "content" | "metadata">,
  streaming: boolean,
): {
  placeResults: ToolExecutionResult[];
  receipts: MobileToolReceipt[];
  quoteCheck: QuoteCheckHandoff | null;
  hasQuoteCheck: boolean;
  hasPlaceResults: boolean;
  isThinking: boolean;
  shouldRenderBubble: boolean;
} {
  const toolResults = message.sender_type === "ai"
    ? mergeToolResults([], message.metadata?.toolResults ?? [])
    : [];
  const placeResults = toolResults.filter(
    (result) => result.toolName === "search_nearby_places",
  );
  const quoteCheckResult = toolResults.find(
    (result) => result.toolName === "analyze_quote",
  );
  const quoteCheck = quoteCheckResult
    ? {
        toolName: "analyze_quote" as const,
        message: getUserFacingToolDisplayMessage(quoteCheckResult)
          || "견적 항목을 직접 확인해 주세요.",
      }
    : null;
  const receipts = toolResults.flatMap((result): MobileToolReceipt[] => {
    if (
      result.toolName === "search_nearby_places"
      || result.toolName === "get_wedding_info"
      || result.toolName === "analyze_quote"
    ) {
      return [];
    }
    const receiptMessage = getUserFacingToolDisplayMessage(result);
    if (!receiptMessage) return [];
    const actionId = getMobileToolReceiptActionId(result);
    return [{
      toolName: result.toolName,
      title: getMobileToolReceiptTitle(result.toolName),
      success: result.success,
      message: receiptMessage,
      ...(actionId ? { actionId } : {}),
    }];
  });
  const hasPlaceResults = placeResults.length > 0;
  const hasQuoteCheck = quoteCheck !== null;
  const hasReceipts = receipts.length > 0;
  const isThinking = message.sender_type === "ai"
    && message.id.startsWith("temp_")
    && !message.content
    && !hasPlaceResults
    && !hasQuoteCheck
    && !hasReceipts
    && streaming;
  return {
    placeResults,
    receipts,
    quoteCheck,
    hasQuoteCheck,
    hasPlaceResults,
    isThinking,
    shouldRenderBubble: isThinking || Boolean(message.content.trim()),
  };
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
    const retryPolicy = parseChatRetryPolicy(event.retryPolicy);
    state.streamed = "";
    state.completed = null;
    state.error = true;
    state.failure = {
      serverCode: typeof event.code === "string" && event.code.length > 0
        ? event.code
        : null,
      retryable: retryPolicy === "same_request"
        ? true
        : retryPolicy !== null
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
    || (
      !message.id.startsWith("temp_")
      && message.sender_type === "ai"
      && messageRequestKey(message) === serverRequestKey
    )
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
    const retryPolicy = parseChatRetryPolicy(record.retryPolicy);
    const serverCode = typeof record.code === "string"
      && /^[A-Z0-9_]{1,96}$/.test(record.code)
      ? record.code
      : null;
    return {
      serverCode,
      retryable: retryPolicy === "same_request"
        ? true
        : retryPolicy !== null
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
  expectedActorUserId: string,
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
    xhr.setRequestHeader("X-Hanbang-Mutation-Contract-Version", "2");
    xhr.setRequestHeader(
      "X-Hanbang-Expected-Actor-User-Id",
      expectedActorUserId,
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
  operationSignal?: AbortSignal,
): Promise<AiMessageIngestResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new AiMessageIngestError(401, "AUTH_REQUIRED", "new_message");
  }
  assertAmoraRequestActor(draft.userId, sessionData.session?.user.id);

  const controller = new AbortController();
  const abortForOperation = () => controller.abort();
  if (operationSignal?.aborted) {
    controller.abort();
  } else {
    operationSignal?.addEventListener("abort", abortForOperation, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), CHAT_INGEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Amora-Ingest-Contract-Version": "2",
        "X-Amora-Expected-Actor-User-Id": draft.userId,
        "X-Hanbang-Mutation-Contract-Version": "2",
        "X-Hanbang-Expected-Actor-User-Id": draft.userId,
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
        ...("firstUseSourceMessageId" in draft && draft.firstUseSourceMessageId
          ? { firstUseSourceMessageId: draft.firstUseSourceMessageId }
          : {}),
        ...("scheduleCareFollowUp" in draft && draft.scheduleCareFollowUp
          ? { scheduleCareFollowUp: draft.scheduleCareFollowUp }
          : {}),
        ...("interactionMode" in draft && draft.interactionMode
          ? { interactionMode: draft.interactionMode }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch {
    throw new AiMessageIngestError(null, null, "same_request");
  } finally {
    clearTimeout(timeout);
    operationSignal?.removeEventListener("abort", abortForOperation);
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
    ...("firstUseSourceMessageId" in draft && draft.firstUseSourceMessageId
      ? { firstUseSourceMessageId: draft.firstUseSourceMessageId }
      : {}),
    ...("scheduleCareFollowUp" in draft && draft.scheduleCareFollowUp
      ? { scheduleCareFollowUp: draft.scheduleCareFollowUp }
      : {}),
    ...("interactionMode" in draft && draft.interactionMode
      ? { interactionMode: draft.interactionMode }
      : {}),
  }, parseRetryAfterMs(response.headers.get("Retry-After")));
}

async function requestChatStream(
  body: ChatRequestBody,
  signal: AbortSignal,
  onUpdate: ChatStreamUpdateCallback,
  onQuota: (remaining: number) => void,
  onDoneMetadata: (metadata: Record<string, unknown>) => void,
  expectedActorUserId: string,
): Promise<ChatStreamCompletion> {
  const { data: sessionData } = await waitForUnlessAborted(
    supabase.auth.getSession(),
    signal,
  );
  if (signal.aborted) throw new ChatTransportError("CANCELLED");
  // 쓴 사람과 지금 토큰의 주인이 다르면 보내지 않는다. 저장된 뒤에 되돌릴 수 없다.
  assertAmoraRequestActor(expectedActorUserId, sessionData.session?.user.id);
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new ChatTransportError("AUTH");

  try {
    return await streamChatWithXhr(
      body,
      accessToken,
      signal,
      onUpdate,
      onQuota,
      onDoneMetadata,
      expectedActorUserId,
    );
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
  assertAmoraRequestActor(expectedActorUserId, refreshed.session.user.id);
  return streamChatWithXhr(
    body,
    refreshed.session.access_token,
    signal,
    onUpdate,
    onQuota,
    onDoneMetadata,
    expectedActorUserId,
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
      return "베타 기간에 드리는 무료 상담을 모두 사용했어요. 추가 이용 방법은 아직 정해지지 않았어요.";
    case "COST_GUARD_GLOBAL_DAILY":
      return "오늘은 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요.";
    case "COST_GUARD_GLOBAL_BUDGET":
      return "오늘 아모라의 안전 한도에 도달했어요. 잠시 후 다시 시도해 주세요.";
    case "COST_GUARD_UNAVAILABLE":
      return "아모라 사용량을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
    case "MEDIATION_SAFETY_PREFLIGHT_REQUIRED":
      return "이 내용은 커플 조율로 공유하기 전에 나만의 안전 지원이 먼저 필요해요.";
    default:
      return null;
  }
}

function getAiFailureMessage(
  error: unknown,
  timedOut: boolean,
  requestKind: "chat" | "mediation" = "chat",
): string {
  // 왜 막혔는지 서버가 코드로 밝힌 경우에는 그것부터 전한다.
  if (error instanceof ChatTransportError) {
    const reason = getServerCodeFailureMessage(error.serverCode);
    if (reason) return reason;
  }
  if (requestKind === "mediation") {
    if (error instanceof ChatTransportError && error.code === "AUTH") {
      return "로그인이 만료됐어요. 다시 로그인한 뒤 조율 도움을 요청해 주세요.";
    }
    return timedOut || (error instanceof ChatTransportError && error.code === "TIMEOUT")
      ? "조율 초안이 평소보다 오래 걸렸어요. 같은 요약으로 다시 시도할 수 있어요."
      : "조율 초안을 가져오지 못했어요. 같은 요약으로 다시 시도할 수 있어요.";
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

function getMobileToolReceiptStatusLabel(receipt: MobileToolReceipt): string {
  if (!receipt.success) return "작업 실패";
  if (receipt.toolName === "create_booking") return "예약 요청 기록 완료";
  if (receipt.toolName === "cancel_booking") return "예약 취소 기록 완료";
  return "작업 완료";
}

function getMobileToolReceiptContinuation(
  receipt: MobileToolReceipt,
): MobileToolReceiptContinuation | null {
  if (
    !receipt.success
    || receipt.toolName !== "add_amora_action"
    || typeof receipt.actionId !== "string"
    || !MOBILE_AMORA_ACTION_ID_PATTERN.test(receipt.actionId)
  ) return null;
  return {
    actionId: receipt.actionId,
    label: "홈에서 다음 한 가지 보기",
    description: "방금 저장한 행동의 이유와 완료 기준을 확인하고, 결과를 남기면 다음 준비로 이어져요.",
  };
}

function MobileToolReceiptCard({
  receipt,
  onOpenHome,
}: {
  receipt: MobileToolReceipt;
  onOpenHome: (actionId: string) => void;
}) {
  const statusLabel = getMobileToolReceiptStatusLabel(receipt);
  const statusColor = receipt.success ? colors.success : colors.danger;
  const continuation = getMobileToolReceiptContinuation(receipt);
  return (
    <View
      style={[st.toolReceiptCard, !receipt.success && st.toolReceiptCardFailure]}
    >
      <View
        accessible
        accessibilityRole={receipt.success ? "summary" : "alert"}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${statusLabel}. ${receipt.title}. ${receipt.message}`}
      >
        <View style={st.toolReceiptHeading} accessibilityElementsHidden>
          <View
            style={[
              st.toolReceiptIcon,
              { backgroundColor: receipt.success ? colors.sage.pale : colors.ivory[100] },
            ]}
          >
            {receipt.success
              ? <Check size={15} color={statusColor} />
              : <X size={15} color={statusColor} />}
          </View>
          <Text style={st.toolReceiptTitle}>{receipt.title}</Text>
          <Text style={[st.toolReceiptStatus, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <Text style={st.toolReceiptMessage}>{receipt.message}</Text>
      </View>
      {continuation && (
        <>
          <Text style={st.toolReceiptContinuationDescription}>
            {continuation.description}
          </Text>
          <Pressable
            onPress={() => onOpenHome(continuation.actionId)}
            accessibilityRole="button"
            accessibilityLabel={continuation.label}
            accessibilityHint="개인화된 다음 행동과 그 이유를 확인합니다"
            style={({ pressed }) => [
              st.toolReceiptContinuationButton,
              pressed && st.toolReceiptContinuationButtonPressed,
            ]}
          >
            <Text style={st.toolReceiptContinuationButtonText}>{continuation.label}</Text>
            <ArrowRight size={16} color={colors.ivory[50]} />
          </Pressable>
        </>
      )}
    </View>
  );
}

function MobileQuoteCheckCard({
  message,
  onOpenQuoteCheck,
}: {
  message: string;
  onOpenQuoteCheck: () => void;
}) {
  return (
    <View
      style={st.toolReceiptCard}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`견적 체크. ${message}`}
    >
      <View style={st.toolReceiptHeading} accessibilityElementsHidden>
        <View style={[st.toolReceiptIcon, { backgroundColor: colors.rose.pale }]}>
          <ShieldCheck size={15} color={colors.rose[600]} />
        </View>
        <Text style={st.toolReceiptTitle}>견적 체크</Text>
      </View>
      <Text style={st.toolReceiptMessage}>{message}</Text>
      <Pressable
        onPress={onOpenQuoteCheck}
        accessibilityRole="button"
        accessibilityLabel="비저장 견적 체크 열기"
        style={st.quoteCheckAction}
      >
        <Text style={st.quoteCheckActionText}>견적 체크 열기</Text>
      </Pressable>
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
  const routeParams = useLocalSearchParams<{
    companionHandoff?: string | string[];
    entry?: string | string[];
    foundationStage?: string | string[];
    scheduleCareCardId?: string | string[];
    scheduleCareCardRevision?: string | string[];
    scheduleCareSourceRevision?: string | string[];
    topicMessageRefId?: string | string[];
  }>();
  const companionHandoffParam = Array.isArray(routeParams.companionHandoff)
    ? routeParams.companionHandoff[0] ?? null
    : routeParams.companionHandoff ?? null;
  const firstUseEntry = resolveAmoraChatEntry(routeParams.entry);
  const routePlanningFoundationStage = resolvePlanningFoundationEntryStage(
    routeParams.foundationStage,
  );
  const topicMessageRefIdParam = Array.isArray(routeParams.topicMessageRefId)
    ? routeParams.topicMessageRefId[0] ?? null
    : routeParams.topicMessageRefId ?? null;
  const scheduleCareRouteBinding = useMemo(
    () => parseScheduleCareFollowUpRouteBinding({
      scheduleCareCardId: routeParams.scheduleCareCardId,
      scheduleCareCardRevision: routeParams.scheduleCareCardRevision,
      scheduleCareSourceRevision: routeParams.scheduleCareSourceRevision,
    }),
    [
      routeParams.scheduleCareCardId,
      routeParams.scheduleCareCardRevision,
      routeParams.scheduleCareSourceRevision,
    ],
  );
  const hasScheduleCareRouteParams = routeParams.scheduleCareCardId !== undefined
    || routeParams.scheduleCareCardRevision !== undefined
    || routeParams.scheduleCareSourceRevision !== undefined;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [streaming, setStreaming] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<ViewerRole>(null);
  const [memberModelVersion, setMemberModelVersion] = useState<1 | 2>(1);
  const [storedPlanningFoundationStage, setStoredPlanningFoundationStage] =
    useState<PlanningFoundationSelfReportedStage | null>(null);
  const [planningFoundationDraftRecoveryAllowed, setPlanningFoundationDraftRecoveryAllowed] =
    useState(false);
  const planningFoundationStage = planningFoundationDraftRecoveryAllowed
    ? routePlanningFoundationStage ?? storedPlanningFoundationStage
    : null;
  const planningFoundationDraft = buildPlanningFoundationPrivateDraft(
    planningFoundationStage,
  );
  const [userName, setUserName] = useState("사용자");
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [hasLinkedPartner, setHasLinkedPartner] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [chatSessionRetryVersion, setChatSessionRetryVersion] = useState(0);
  const [personalizationVisible, setPersonalizationVisible] = useState(false);
  const [target, setTarget] = useState<MessageTarget>("ai");
  const [listenOnlySelected, setListenOnlySelected] = useState(false);
  const [activeScope, setActiveScope] = useState<ChatScope>("shared");
  const activeScopeRef = useRef<ChatScope>("shared");
  const firstUseEntryRef = useRef(firstUseEntry);
  const sessionReloadScopeRef = useRef<ChatScope>("shared");
  useEffect(() => {
    activeScopeRef.current = activeScope;
  }, [activeScope]);
  useEffect(() => {
    firstUseEntryRef.current = firstUseEntry;
  }, [firstUseEntry]);
  const [inputByLane, setInputByLane] = useState<AmoraChatLaneRecord<string>>(
    () => createEmptyAmoraChatLaneRecord(() => ""),
  );
  const inputByLaneRef = useRef(inputByLane);
  useEffect(() => {
    inputByLaneRef.current = inputByLane;
  }, [inputByLane]);
  const chatInputRef = useRef<TextInput>(null);
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
  const pendingIngestReconciliation = Object.values(sendFailuresByLane).some(
    (failure) => failure?.requiresReconciliation === true,
  );
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
  const [promotedFirstUseMessageId, setPromotedFirstUseMessageId] =
    useState<string | null>(null);
  const [skippedFirstUseMessageIds, setSkippedFirstUseMessageIds] =
    useState<Set<string>>(() => new Set());
  const [firstUsePromotionPendingMessageId, setFirstUsePromotionPendingMessageId] =
    useState<string | null>(null);
  const [firstUsePromotionUiState, setFirstUsePromotionUiState] = useState<{
    sourceMessageId: string;
    status: FirstUsePromotionUiStatus;
  } | null>(null);
  const [firstUseComposerNotice, setFirstUseComposerNotice] =
    useState<FirstUseComposerNotice | null>(null);
  const [scheduleCareFollowUpEntryStatus, setScheduleCareFollowUpEntryStatus] =
    useState<ScheduleCareFollowUpEntryStatus | null>(null);
  const [scheduleCareFollowUpRetryVersion, setScheduleCareFollowUpRetryVersion] = useState(0);
  const [dismissedScheduleCareActionMessageIds, setDismissedScheduleCareActionMessageIds] =
    useState<Set<string>>(() => new Set());
  const [scheduleCareSharedDraftPendingMessageId, setScheduleCareSharedDraftPendingMessageId] =
    useState<string | null>(null);
  const [scheduleCareActionNotice, setScheduleCareActionNotice] = useState<string | null>(null);
  const [partnerSafetyNotice, setPartnerSafetyNotice] = useState<string | null>(null);
  const [pendingSharedSendConfirmation, setPendingSharedSendConfirmation] =
    useState<PendingSharedSendConfirmation | null>(null);
  const [mediationRequestOwner, setMediationRequestOwner] =
    useState<MediationRequestOwner | null>(null);
  const [mediationRequestPending, setMediationRequestPending] = useState(false);
  const [mediationRequestError, setMediationRequestError] = useState<string | null>(null);
  const [dismissedMediationOfferKeys, setDismissedMediationOfferKeys] =
    useState<Set<string>>(() => new Set());
  const [topicMessageSaveDialog, setTopicMessageSaveDialog] =
    useState<TopicMessageSaveDialogState | null>(null);
  const [topicMessageSaveNotice, setTopicMessageSaveNotice] = useState<{
    messageId: string;
    text: string;
  } | null>(null);
  const [resolvedTopicMessageFocus, setResolvedTopicMessageFocus] =
    useState<ResolvedTopicMessageFocus | null>(null);
  const [topicMessageFocusState, setTopicMessageFocusState] =
    useState<TopicMessageFocusState>(null);
  const [topicMessageFocusRetryVersion, setTopicMessageFocusRetryVersion] = useState(0);
  const [preparationTopicReturnReceipt, setPreparationTopicReturnReceipt] =
    useState<PreparationTopicChatReturnReceipt | null>(null);
  const [preparationTopicHandoffNotice, setPreparationTopicHandoffNotice] =
    useState<PreparationTopicHandoffNotice | null>(null);
  // Fail closed until the exact owner/couple SecureStore fence is read. This
  // state gates mediation only; ordinary chat and care remain available.
  const [hasDevicePrivateMediationSafetyHold, setHasDevicePrivateMediationSafetyHold] =
    useState(true);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const sendBtnScale = useRef(new Animated.Value(1)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const activeChatOperationGuardRef = useRef(createChatSendOperationGuard());
  const sharedSendAcknowledgementRef =
    useRef<AmoraSharedSendAcknowledgementSession | null>(null);
  const sharedSendConfirmationBusyRef =
    useRef<PendingSharedSendConfirmation | null>(null);
  const mountedRef = useRef(true);
  const hasLinkedPartnerRef = useRef(false);
  const linkedPartnerIdRef = useRef<string | null>(null);
  const chatSessionGenerationRef = useRef(createChatSessionGenerationGuard());
  const firstUsePromotionOperationGuardRef =
    useRef(createFirstUsePromotionOperationGuard());
  const firstUseComposerBindingRef = useRef<FirstUseComposerBinding | null>(null);
  const scheduleCareFollowUpOperationGuardRef =
    useRef(createScheduleCareFollowUpOperationGuard());
  const scheduleCareFollowUpComposerBindingRef =
    useRef<ScheduleCareFollowUpComposerBinding | null>(null);
  const preparationTopicChatComposerBindingRef =
    useRef<PreparationTopicChatComposerBinding | null>(null);
  // 공동 승인은 "누가 눌렀는가"가 동의의 주체다. 핸들러가 이 값을 동기적으로 읽어
  // 요청에 실으면, 요청이 나가는 사이 계정이 바뀌어도 fence가 불일치를 잡는다.
  const sessionUserIdRef = useRef<string | null>(null);
  const sessionCoupleIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const safetyHoldLockRef = useRef(false);
  const mediationSafetyEpochRef = useRef(0);
  const mediationSafetyBlockedRef = useRef(false);
  const applyingPendingActionRef = useRef<string | null>(null);
  const persistedAiRequestKeysRef = useRef(new Set<string>());
  const previousMessageCountRef = useRef(0);
  const consumedCompanionHandoffRef = useRef<string | null>(null);
  const consumedScheduleCareEntryRef = useRef<string | null>(null);
  const consumedFirstUseEntryRef = useRef<string | null>(null);
  const consumedPlanningFoundationDraftRef = useRef<string | null>(null);
  const consumedTopicMessageFocusRef = useRef<string | null>(null);
  const topicMessageSaveOperationRef = useRef(0);
  const topicMessageSaveAbortControllerRef = useRef<AbortController | null>(null);
  const topicMessageFocusScrollAttemptsRef = useRef(0);
  const topicMessageFocusTargetRef = useRef<string | null>(null);
  const announcedTopicMessageFocusRef = useRef<string | null>(null);
  const topicMessageViewabilityHandlerRef = useRef(({
    viewableItems,
  }: {
    viewableItems: Array<ViewToken<ChatMessage>>;
  }) => {
    const targetMessageId = topicMessageFocusTargetRef.current;
    if (
      !targetMessageId
      || announcedTopicMessageFocusRef.current === targetMessageId
      || !viewableItems.some((token) => token.item?.id === targetMessageId)
    ) return;
    announcedTopicMessageFocusRef.current = targetMessageId;
    AccessibilityInfo.announceForAccessibility("저장한 원문으로 이동했어요");
  });
  const topicMessageViewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 35 });
  const scopedMessages = useMemo(
    () => messages.filter((message) => (
      isMessageInChatScope(message.visibility, activeScope, userRole)
    )),
    [activeScope, messages, userRole],
  );
  const visibleMessages = useMemo(() => [...scopedMessages].reverse(), [scopedMessages]);
  const localPrivateMediationSafetyEpoch = useMemo(() => {
    if (!userRole) return 0;
    const privateVisibility: ChatMessageVisibility = `${userRole}_private`;
    return messages.filter((message) => (
      message.visibility === privateVisibility
      && message.sender_type === "ai"
      && message.metadata?.pinned_safety_card === true
    )).length;
  }, [messages, userRole]);
  const localCoupleMessages = useMemo(
    () => coupleId
      ? messages.filter((message) => message.couple_id === coupleId)
      : [],
    [coupleId, messages],
  );
  const hasLocalPrivateMediationSafetyHold = useMemo(
    () => hasUnresolvedPrivateMediationSafetyHold(localCoupleMessages, userRole),
    [localCoupleMessages, userRole],
  );
  useEffect(() => {
    if (!hasLocalPrivateMediationSafetyHold || !userId || !coupleId) return;
    // Persist only an owner/couple-bound boolean safety fence. The raw text,
    // summary, reason, classification, and partner state never leave this
    // existing local safety-card path.
    void sealPrivateMediationSafetyHold({
      ownerUserId: userId,
      coupleId,
    }).catch(() => undefined);
  }, [coupleId, hasLocalPrivateMediationSafetyHold, userId]);
  const hasVisibleSharedMediationSafetyCard = useMemo(() => messages.some((message) => (
    message.visibility === "shared"
    && message.sender_type === "ai"
    && (
      message.metadata?.pinned_safety_card === true
      || typeof message.metadata?.safety_classification === "string"
    )
  )), [messages]);
  const hasMediationSafetyFence = hasVisibleSharedMediationSafetyCard
    || hasLocalPrivateMediationSafetyHold
    || hasDevicePrivateMediationSafetyHold;
  // Async stream callbacks keep the function closure from the render that
  // started them. The ref gives those callbacks the newest safety state.
  mediationSafetyBlockedRef.current = hasMediationSafetyFence;
  const mediationOfferMessages = useMemo(() => (
    messages.flatMap((message) => {
      if (!message.created_at) return [];
      return [{
        id: message.id,
        content: message.content,
        sender_role: message.sender_type,
        visibility: message.visibility,
        metadata: {
          target: typeof message.metadata?.target === "string"
            ? message.metadata.target
            : null,
        },
        created_at: message.created_at,
      }];
    })
  ), [messages]);
  const mediationOfferClockMinute = Math.floor(nowMs / 60_000);
  const mediationOffer = useMemo(() => assessMediationOffer(
    mediationOfferMessages,
    { nowMs: mediationOfferClockMinute * 60_000 },
  ), [mediationOfferClockMinute, mediationOfferMessages]);
  const shouldShowMediationOffer = mediationOffer.shouldOffer
    && mediationOffer.offerKey !== null
    && !hasVisibleSharedMediationSafetyCard
    && !hasLocalPrivateMediationSafetyHold
    && !hasDevicePrivateMediationSafetyHold
    && !dismissedMediationOfferKeys.has(mediationOffer.offerKey);
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
  const activeFirstUseSendRecovery = activeSendFailure
    && activeSendFailure.kind !== "partner_ingest"
    ? activeSendFailure.firstUseRecovery ?? null
    : null;
  const activeScheduleCareSendRecovery = activeSendFailure
    && activeSendFailure.kind !== "partner_ingest"
    ? activeSendFailure.scheduleCareRecovery ?? null
    : null;
  const activeSendFailureIsMediation = activeSendFailure?.kind === "ai_response"
    && activeSendFailure.request.body.requestKind === "mediation";
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
  const latestPrivateAiMessageId = useMemo(() => {
    if (!userRole) return null;
    const privateVisibility: ChatMessageVisibility = `${userRole}_private`;
    return [...messages]
      .reverse()
      .find((message) => (
        message.visibility === privateVisibility
        && message.sender_type === "ai"
      ))?.id ?? null;
  }, [messages, userRole]);
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

  const isCurrentChatOperation = useCallback((operation: ChatSendOperation) => (
    operation.stopReason === null
    && activeChatOperationGuardRef.current.current() === operation
    && isCurrentChatSession(operation.sessionGeneration)
  ), [isCurrentChatSession]);

  const isCurrentAiRequest = useCallback((
    request: AiRequest,
    operation: ChatSendOperation,
  ) => (
    isCurrentChatOperation(operation)
    && (
      request.body.requestKind !== "mediation"
      || (
        request.mediationSafetyEpoch !== undefined
        && request.mediationSafetyEpoch === mediationSafetyEpochRef.current
        && !mediationSafetyBlockedRef.current
      )
    )
  ), [isCurrentChatOperation]);

  const beginChatSendOperation = useCallback((
    sessionGeneration: number,
    request?: AiRequest,
  ) => {
    const operation = activeChatOperationGuardRef.current.start(sessionGeneration);
    if (request?.body.requestKind === "mediation") {
      operation.requestKind = "mediation";
      operation.mediationSafetyEpoch = request.mediationSafetyEpoch ?? null;
      operation.requestTempId = request.tempId;
    }
    sendingRef.current = true;
    setStreaming(true);
    return operation;
  }, []);

  const finishChatSendOperation = useCallback((operation: ChatSendOperation) => {
    if (!activeChatOperationGuardRef.current.finish(operation)) return false;
    if (isCurrentChatSession(operation.sessionGeneration)) {
      sendingRef.current = false;
      setStreaming(false);
    }
    return true;
  }, [isCurrentChatSession]);

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

  const applyMediationSafetyFence = useCallback(() => {
    mediationSafetyBlockedRef.current = true;
    mediationSafetyEpochRef.current += 1;

    const activeOperation = activeChatOperationGuardRef.current.current();
    const activeMediationTempId = activeOperation?.requestKind === "mediation"
      ? activeOperation.requestTempId
      : null;
    const stoppedMediation = activeOperation?.requestKind === "mediation"
      ? activeChatOperationGuardRef.current.stopActive("safety")
      : null;

    if (activeMediationTempId) {
      setMessages((previous) => previous.filter(
        (message) => message.id !== activeMediationTempId,
      ));
    }
    setSendFailuresByLane((current) => {
      const failure = current.shared_ai;
      return failure?.kind === "ai_response"
        && failure.request.body.requestKind === "mediation"
        ? updateAmoraChatLaneRecord(current, "shared_ai", null)
        : current;
    });
    setMediationRequestOwner(null);
    setMediationRequestPending(false);
    setMediationRequestError(null);

    if (stoppedMediation) finishChatSendOperation(stoppedMediation);
  }, [finishChatSendOperation]);

  useEffect(() => {
    if (!hasMediationSafetyFence) return;
    applyMediationSafetyFence();
  }, [applyMediationSafetyFence, hasMediationSafetyFence]);

  const resetChatSessionState = useCallback(() => {
    const nextScope = sessionReloadScopeRef.current;
    activeChatOperationGuardRef.current.stopActive("session");
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    hasLinkedPartnerRef.current = false;
    linkedPartnerIdRef.current = null;
    sessionCoupleIdRef.current = null;
    sharedSendAcknowledgementRef.current = null;
    sharedSendConfirmationBusyRef.current = null;
    sendingRef.current = false;
    safetyHoldLockRef.current = false;
    mediationSafetyEpochRef.current += 1;
    mediationSafetyBlockedRef.current = true;
    applyingPendingActionRef.current = null;
    persistedAiRequestKeysRef.current.clear();
    previousMessageCountRef.current = 0;
    consumedPlanningFoundationDraftRef.current = null;
    topicMessageSaveOperationRef.current += 1;
    topicMessageSaveAbortControllerRef.current?.abort();
    topicMessageSaveAbortControllerRef.current = null;
    consumedTopicMessageFocusRef.current = null;
    topicMessageFocusScrollAttemptsRef.current = 0;
    topicMessageFocusTargetRef.current = null;
    announcedTopicMessageFocusRef.current = null;
    setMessages([]);
    setStreaming(false);
    setCoupleId(null);
    setUserId(null);
    setUserRole(null);
    setMemberModelVersion(1);
    setStoredPlanningFoundationStage(null);
    setPlanningFoundationDraftRecoveryAllowed(false);
    setUserName("사용자");
    setPartnerName(null);
    setHasLinkedPartner(false);
    setInitialLoaded(false);
    setInitialLoadError(null);
    setPersonalizationVisible(false);
    setTarget("ai");
    setListenOnlySelected(false);
    activeScopeRef.current = nextScope;
    setActiveScope(nextScope);
    setInputByLane(createEmptyAmoraChatLaneRecord(() => ""));
    setSendFailuresByLane(createEmptyAmoraChatLaneRecord(() => null));
    setColdStartAiRecoveryByLane(createEmptyAmoraChatLaneRecord(() => null));
    setQuotaRemaining(null);
    setDismissedPendingActionIds(new Set());
    setApplyingPendingActionId(null);
    setPendingActionNotice(null);
    setPendingActionApproval(null);
    setPromotedFirstUseMessageId(null);
    setSkippedFirstUseMessageIds(new Set());
    const firstUsePromotionOperation = firstUsePromotionOperationGuardRef.current.current();
    if (firstUsePromotionOperation) {
      firstUsePromotionOperationGuardRef.current.cancel(
        firstUsePromotionOperation.sourceMessageId,
      );
    }
    const scheduleCareFollowUpOperation =
      scheduleCareFollowUpOperationGuardRef.current.current();
    if (scheduleCareFollowUpOperation) {
      scheduleCareFollowUpOperationGuardRef.current.cancel(scheduleCareFollowUpOperation);
    }
    firstUseComposerBindingRef.current = null;
    scheduleCareFollowUpComposerBindingRef.current = null;
    preparationTopicChatComposerBindingRef.current = null;
    consumedScheduleCareEntryRef.current = null;
    setFirstUsePromotionPendingMessageId(null);
    setFirstUsePromotionUiState(null);
    setFirstUseComposerNotice(null);
    setScheduleCareFollowUpEntryStatus(null);
    setDismissedScheduleCareActionMessageIds(new Set());
    setScheduleCareSharedDraftPendingMessageId(null);
    setScheduleCareActionNotice(null);
    setPartnerSafetyNotice(null);
    setPendingSharedSendConfirmation(null);
    setMediationRequestOwner(null);
    setMediationRequestPending(false);
    setMediationRequestError(null);
    setDismissedMediationOfferKeys(new Set());
    setHasDevicePrivateMediationSafetyHold(true);
    setTopicMessageSaveDialog(null);
    setTopicMessageSaveNotice(null);
    setResolvedTopicMessageFocus(null);
    setTopicMessageFocusState(null);
    setTopicMessageFocusRetryVersion(0);
    setPreparationTopicReturnReceipt(null);
    setPreparationTopicHandoffNotice(null);
  }, []);

  useEffect(() => {
    if (
      firstUseEntry !== "first_use"
      || !initialLoaded
      || !userId
      || !userRole
      || !coupleId
    ) return;

    const entryOwnerKey = `${userId}:${coupleId}:first_use`;
    if (consumedFirstUseEntryRef.current === entryOwnerKey) return;
    consumedFirstUseEntryRef.current = entryOwnerKey;
    activeScopeRef.current = "private";
    setActiveScope("private");
    setTarget("ai");
  }, [coupleId, firstUseEntry, initialLoaded, userId, userRole]);

  // planning-foundation draft-only handoff
  useEffect(() => {
    if (
      !planningFoundationStage
      || !planningFoundationDraft
      || !initialLoaded
      || !userId
      || !userRole
      || !coupleId
    ) return;

    const draftOwnerKey = [
      userId,
      coupleId,
      planningFoundationStage,
    ].join(":");
    if (consumedPlanningFoundationDraftRef.current === draftOwnerKey) return;
    consumedPlanningFoundationDraftRef.current = draftOwnerKey;
    setInputByLane((current) => (
      current.private_ai.trim()
        ? current
        : updateAmoraChatLaneRecord(current, "private_ai", planningFoundationDraft)
    ));
    activeScopeRef.current = "private";
    setActiveScope("private");
    setTarget("ai");
  }, [
    coupleId,
    firstUseEntry,
    initialLoaded,
    planningFoundationDraft,
    planningFoundationStage,
    userId,
    userRole,
  ]);

  useEffect(() => {
    if (
      !initialLoaded
      || !userId
      || !userRole
      || !coupleId
      || !companionHandoffParam
      || hasScheduleCareRouteParams
      || consumedCompanionHandoffRef.current === companionHandoffParam
      || streaming
      || pendingIngestReconciliation
    ) return;

    consumedCompanionHandoffRef.current = companionHandoffParam;
    const handoff = consumeCompanionChatHandoff(
      companionHandoffParam,
      userId,
      coupleId,
    );
    if (!handoff || handoff.scheduleCareFollowUp) {
      if (handoff?.scheduleCareFollowUp) setScheduleCareFollowUpEntryStatus("unavailable");
      return;
    }
    if (inputByLaneRef.current.private_ai.trim()) {
      if (handoff.preparationTopic) setPreparationTopicHandoffNotice("composer_occupied");
      return;
    }
    const preparationTopicBinding = handoff.preparationTopic
      ? createPreparationTopicChatComposerBinding({
          preparationTopic: handoff.preparationTopic,
          ownerUserId: userId,
          coupleId,
          prompt: handoff.prompt,
        })
      : null;
    if (handoff.preparationTopic && !preparationTopicBinding) return;
    preparationTopicChatComposerBindingRef.current = preparationTopicBinding;
    setPreparationTopicReturnReceipt(null);
    setPreparationTopicHandoffNotice(null);
    const nextDrafts = updateAmoraChatLaneRecord(
      inputByLaneRef.current,
      "private_ai",
      handoff.prompt,
    );
    inputByLaneRef.current = nextDrafts;
    setInputByLane(nextDrafts);
    setActiveScope("private");
    setTarget("ai");
  }, [
    companionHandoffParam,
    coupleId,
    hasScheduleCareRouteParams,
    initialLoaded,
    pendingIngestReconciliation,
    streaming,
    userId,
    userRole,
  ]);

  useEffect(() => {
    if (!hasScheduleCareRouteParams) return;
    if (
      !initialLoaded
      || !userId
      || !userRole
      || !coupleId
      || streaming
      || pendingIngestReconciliation
    ) return;
    if (!scheduleCareRouteBinding) {
      setScheduleCareFollowUpEntryStatus("unavailable");
      return;
    }

    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (!isCurrentChatSession(sessionGeneration)) return;
    const entryKey = [
      userId,
      coupleId,
      scheduleCareRouteBinding.cardId,
      scheduleCareRouteBinding.cardRevision,
      scheduleCareRouteBinding.sourceRevision,
      scheduleCareFollowUpRetryVersion,
    ].join(":");
    if (consumedScheduleCareEntryRef.current === entryKey) return;
    consumedScheduleCareEntryRef.current = entryKey;
    const operation = scheduleCareFollowUpOperationGuardRef.current.start(
      scheduleCareRouteBinding,
      sessionGeneration,
    );
    if (!operation) {
      setScheduleCareFollowUpEntryStatus("unavailable");
      return;
    }
    setScheduleCareFollowUpEntryStatus("checking");

    void (async () => {
      try {
        let handoff: ReturnType<typeof consumeCompanionChatHandoff> = null;
        if (
          companionHandoffParam
          && consumedCompanionHandoffRef.current !== companionHandoffParam
        ) {
          consumedCompanionHandoffRef.current = companionHandoffParam;
          handoff = consumeCompanionChatHandoff(
            companionHandoffParam,
            userId,
            coupleId,
          );
        }

        let preview: ScheduleCareFollowUpPreview;
        if (!handoff) {
          preview = await loadScheduleCareFollowUpPreview({
            expectedOwnerUserId: userId,
            expectedCoupleId: coupleId,
            binding: scheduleCareRouteBinding,
            fetchForExpectedUser: apiFetchForExpectedUser,
            signal: operation.controller.signal,
          });
        } else if (
          handoff.scheduleCareFollowUp?.cardId === scheduleCareRouteBinding.cardId
          && handoff.scheduleCareFollowUp.cardRevision
            === scheduleCareRouteBinding.cardRevision
          && handoff.scheduleCareFollowUp.sourceRevision
            === scheduleCareRouteBinding.sourceRevision
        ) {
          preview = {
            status: "ready" as const,
            ownerUserId: userId,
            coupleId,
            binding: handoff.scheduleCareFollowUp,
            expiresAt: new Date(Date.now() + 1).toISOString(),
            prompt: handoff.prompt,
          };
        } else {
          setScheduleCareFollowUpEntryStatus("unavailable");
          return;
        }

        if (
          !scheduleCareFollowUpOperationGuardRef.current.isCurrent(operation)
          || !isCurrentChatSession(sessionGeneration)
        ) return;
        const identityAfterPreview = await currentVerifiedChatIdentity();
        if (
          !scheduleCareFollowUpOperationGuardRef.current.isCurrent(operation)
          || !isCurrentChatSession(sessionGeneration)
          || preview.status !== "ready"
          || identityAfterPreview?.userId !== preview.ownerUserId
          || identityAfterPreview?.coupleId !== preview.coupleId
        ) {
          if (preview.status !== "ready") {
            setScheduleCareFollowUpEntryStatus(preview.status);
          } else if (
            identityAfterPreview?.userId !== preview.ownerUserId
            || identityAfterPreview?.coupleId !== preview.coupleId
          ) {
            setScheduleCareFollowUpEntryStatus("identity_changed");
          }
          return;
        }
        const composerBinding = createScheduleCareFollowUpComposerBinding(preview);
        if (!composerBinding) {
          setScheduleCareFollowUpEntryStatus("unavailable");
          return;
        }
        if (inputByLaneRef.current.private_ai.trim()) {
          setScheduleCareFollowUpEntryStatus("composer_occupied");
          return;
        }
        const nextDrafts = updateAmoraChatLaneRecord(
          inputByLaneRef.current,
          "private_ai",
          preview.prompt,
        );
        inputByLaneRef.current = nextDrafts;
        scheduleCareFollowUpComposerBindingRef.current = composerBinding;
        setInputByLane(nextDrafts);
        setScheduleCareFollowUpEntryStatus(null);
        setActiveScope("private");
        setTarget("ai");
        requestAnimationFrame(() => chatInputRef.current?.focus());
      } finally {
        scheduleCareFollowUpOperationGuardRef.current.finish(operation);
      }
    })();

    return () => {
      scheduleCareFollowUpOperationGuardRef.current.cancel(operation);
    };
  }, [
    companionHandoffParam,
    coupleId,
    hasScheduleCareRouteParams,
    initialLoaded,
    isCurrentChatSession,
    pendingIngestReconciliation,
    scheduleCareFollowUpRetryVersion,
    scheduleCareRouteBinding,
    streaming,
    userId,
    userRole,
  ]);

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

  useEffect(() => {
    mountedRef.current = true;
    let authReloadTimer: ReturnType<typeof setTimeout> | null = null;
    let observedAuthUserId: string | null | undefined;
    const retainedReloadScope = resolveAmoraFirstUseSessionResetScope({
      entry: firstUseEntryRef.current,
      activeScope: activeScopeRef.current,
      consumedFirstUseEntryOwnerKey: consumedFirstUseEntryRef.current,
      currentUserId: sessionUserIdRef.current,
      currentCoupleId: sessionCoupleIdRef.current,
    });
    sessionReloadScopeRef.current = retainedReloadScope;

    function scheduleChatSessionReload(nextScope: ChatScope) {
      chatSessionGenerationRef.current.invalidate();
      sessionReloadScopeRef.current = nextScope;
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

      try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!isCurrentGeneration()) return;
      if (authError) {
        sessionUserIdRef.current = null;
        setInitialLoadError("로그인 정보를 안전하게 확인하지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.");
        setInitialLoaded(true);
        return;
      }
      sessionUserIdRef.current = user?.id ?? null;
      observedAuthUserId = user?.id ?? null;
      if (!user) {
        setInitialLoadError("로그인 상태를 확인할 수 없어요. 다시 불러오거나 로그인 상태를 확인해 주세요.");
        setInitialLoaded(true);
        return;
      }
      const reloadIdentity = () => {
        if (!isCurrentChatSession(generation)) return;
        scheduleChatSessionReload("shared");
      };

      const { data: profile, error: profileError } = await supabase.from("profiles")
        .select("name, role, couple_id")
        .eq("id", user.id)
        .single();
      if (!isCurrentGeneration()) return;
      if (profileError?.code === "PGRST116") {
        // profiles.id is the primary key, so a single-row coercion failure here
        // deterministically means this authenticated account still needs setup.
        setUserId(user.id);
        setInitialLoaded(true);
        return;
      }
      if (profileError || !profile) {
        setInitialLoadError("현재 계정의 준비 기록을 불러오지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.");
        setInitialLoaded(true);
        return;
      }
      const reloadWhenProfileIdentityChanges = (payload: { new: Record<string, unknown> }) => {
        if (!isCurrentGeneration()) return;
        const nextProfile = payload.new;
        if (
          nextProfile.couple_id !== profile?.couple_id
          || nextProfile.role !== profile?.role
        ) reloadIdentity();
      };
      setUserId(user.id);
      if (!profile.couple_id) {
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
      if (!viewerRole) {
        setInitialLoadError("현재 계정의 커플 역할 정보를 확인하지 못했어요. 준비 기록을 확인한 뒤 다시 불러와 주세요.");
        setInitialLoaded(true);
        return;
      }
      sessionCoupleIdRef.current = profile.couple_id;
      setCoupleId(profile.couple_id);
      setUserName(profile.name || "사용자");
      setUserRole(viewerRole);

      const [
        sharedSendAcknowledged,
        dismissedOfferKeys,
        deviceSafetyHold,
        storedFoundationStage,
      ] = await Promise.all([
        loadAmoraSharedSendAcknowledgement(
          user.id,
          profile.couple_id,
        ).catch(() => false),
        loadAmoraMediationOfferDismissals(user.id, profile.couple_id).catch(() => []),
        hasPrivateMediationSafetyHold({
          ownerUserId: user.id,
          coupleId: profile.couple_id,
        }),
        NEUTRAL_PREPARATION_SPACE_ENABLED
          ? readPlanningFoundationDraftHandoff({
              ownerUserId: user.id,
              coupleId: profile.couple_id,
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!isCurrentGeneration()) return;
      setHasDevicePrivateMediationSafetyHold(deviceSafetyHold);
      if (deviceSafetyHold) applyMediationSafetyFence();
      const [
        { data: couple, error: coupleError },
        { data: partners },
      ] = await Promise.all([
        supabase.from("couples")
          .select((NEUTRAL_PREPARATION_SPACE_ENABLED
            ? "bride_id, groom_id, member_model_version"
            : "bride_id, groom_id") as "bride_id, groom_id")
          .eq("id", profile.couple_id)
          .maybeSingle(),
        supabase.from("couple_profile_directory")
          .select("id, name")
          .eq("couple_id", profile.couple_id)
          .neq("id", user.id),
      ]);
      if (!isCurrentGeneration()) return;

      const coupleRecord: Record<string, unknown> | null = isRecord(couple)
        ? couple
        : null;
      const brideId = typeof coupleRecord?.bride_id === "string"
        ? coupleRecord.bride_id
        : null;
      const groomId = typeof coupleRecord?.groom_id === "string"
        ? coupleRecord.groom_id
        : null;
      const rawMemberModelVersion = coupleRecord?.member_model_version;
      if (
        NEUTRAL_PREPARATION_SPACE_ENABLED
        && (
          coupleError
          || !coupleRecord
          || (rawMemberModelVersion !== 1 && rawMemberModelVersion !== 2)
        )
      ) {
        setInitialLoadError("현재 준비 공간의 구성 방식을 확인하지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.");
        setInitialLoaded(true);
        return;
      }
      const resolvedMemberModelVersion: 1 | 2 =
        NEUTRAL_PREPARATION_SPACE_ENABLED && rawMemberModelVersion === 2
          ? 2
          : 1;
      setMemberModelVersion(resolvedMemberModelVersion);
      sharedSendAcknowledgementRef.current = {
        userId: user.id,
        coupleId: profile.couple_id,
        confirmed: sharedSendAcknowledged,
      };
      setDismissedMediationOfferKeys(new Set(dismissedOfferKeys));

      const expectedSelfId = viewerRole === "bride"
        ? brideId
        : viewerRole === "groom"
          ? groomId
          : null;
      const expectedPartnerId = viewerRole === "bride"
        ? groomId
        : viewerRole === "groom"
          ? brideId
          : null;
      const linkedPartner = typeof expectedPartnerId === "string"
        ? partners?.find((partner) => partner.id === expectedPartnerId) ?? null
        : null;
      const partnerIsVerified = Boolean(
        viewerRole
        && brideId
        && groomId
        && brideId !== groomId
        && expectedSelfId === user.id
        && linkedPartner,
      );
      hasLinkedPartnerRef.current = partnerIsVerified;
      linkedPartnerIdRef.current = partnerIsVerified ? expectedPartnerId ?? null : null;
      setHasLinkedPartner(partnerIsVerified);
      setPartnerName(partnerIsVerified ? linkedPartner?.name || "파트너" : null);
      const reloadWhenCoupleRosterChanges = (payload: { new: Record<string, unknown> }) => {
        if (!isCurrentGeneration() || !coupleRecord) return;
        const nextCouple = payload.new;
        if (
          nextCouple.bride_id !== brideId
          || nextCouple.groom_id !== groomId
          || (
            NEUTRAL_PREPARATION_SPACE_ENABLED
            && nextCouple.member_model_version !== rawMemberModelVersion
          )
        ) {
          const nextScope = resolveAmoraFirstUseSessionResetScope({
            entry: firstUseEntryRef.current,
            activeScope: activeScopeRef.current,
            consumedFirstUseEntryOwnerKey: consumedFirstUseEntryRef.current,
            currentUserId: user.id,
            currentCoupleId: profile.couple_id,
          });
          scheduleChatSessionReload(nextScope);
        }
      };

      const chatMessageSelect =
        "id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility";
      const privateVisibility: ChatMessageVisibility | null = viewerRole
        ? `${viewerRole}_private`
        : null;
      const latestOwnSharedAiUserRequest = viewerRole
        ? supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("sender_id", user.id)
          .eq("sender_type", viewerRole)
          .eq("role", "user")
          .eq("visibility", "shared")
          .or("metadata->>target.is.null,metadata->>target.eq.ai")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const latestPrivateCanonicalRequest = privateVisibility
        ? supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("visibility", privateVisibility)
          .or("metadata->>target.is.null,metadata->>target.eq.ai")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const latestOwnPrivateAiUserRequest = privateVisibility && viewerRole
        ? supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("sender_id", user.id)
          .eq("sender_type", viewerRole)
          .eq("role", "user")
          .eq("visibility", privateVisibility)
          .or("metadata->>target.is.null,metadata->>target.eq.ai")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [
        { data: history },
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
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(200),
        supabase.from("chat_messages")
          .select(chatMessageSelect)
          .eq("couple_id", profile.couple_id)
          .eq("visibility", "shared")
          .or("metadata->>target.is.null,metadata->>target.neq.partner")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        latestOwnSharedAiUserRequest,
        latestPrivateCanonicalRequest,
        latestOwnPrivateAiUserRequest,
      ]);
      if (!isCurrentGeneration()) return;

      const planningFoundationRecoveryAllowed = Boolean(
        resolvedMemberModelVersion === 2
        && !latestOwnPrivateAiUserError
        && !latestOwnPrivateAiUser,
      );
      setPlanningFoundationDraftRecoveryAllowed(planningFoundationRecoveryAllowed);
      setStoredPlanningFoundationStage(
        planningFoundationRecoveryAllowed ? storedFoundationStage : null,
      );
      if (
        storedFoundationStage
        && resolvedMemberModelVersion === 2
        && !latestOwnPrivateAiUserError
        && latestOwnPrivateAiUser
      ) {
        void clearPlanningFoundationDraftHandoff({
          ownerUserId: user.id,
          coupleId: profile.couple_id,
        });
      }

      const normalizedBoundedHistory = (history ?? [])
        .map((message) => chatMessageFromRealtimeRow(message))
        .filter((message): message is ChatMessage => (
          message !== null && canViewerSeeChatMessage(message, viewerRole)
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
          message !== null && canViewerSeeChatMessage(message, viewerRole)
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
          requiresReconciliation: false,
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
          if (!incoming || !canViewerSeeChatMessage(incoming, viewerRole)) return;
          if (isMediationSafetyFenceMessage(incoming, viewerRole)) {
            applyMediationSafetyFence();
          }
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
          if (
            updated
            && canViewerSeeChatMessage(updated, viewerRole)
            && isMediationSafetyFenceMessage(updated, viewerRole)
          ) {
            applyMediationSafetyFence();
          }
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
      } catch {
        if (!isCurrentGeneration()) return;
        setInitialLoadError("대화 준비 정보를 불러오지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.");
        setInitialLoaded(true);
      }
    }

    void loadChatSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextAuthUserId = session?.user.id ?? null;
      // 아래 early return보다 먼저 갱신한다. 승인 요청이 결박할 대상은 항상 지금 사람이다.
      sessionUserIdRef.current = nextAuthUserId;
      if (nextAuthUserId === observedAuthUserId) return;
      observedAuthUserId = nextAuthUserId;
      scheduleChatSessionReload("shared");
    });

    return () => {
      mountedRef.current = false;
      chatSessionGenerationRef.current.invalidate();
      if (authReloadTimer) clearTimeout(authReloadTimer);
      subscription.unsubscribe();
      activeChatOperationGuardRef.current.stopActive("session");
      topicMessageSaveOperationRef.current += 1;
      topicMessageSaveAbortControllerRef.current?.abort();
      topicMessageSaveAbortControllerRef.current = null;
      const firstUsePromotionOperation = firstUsePromotionOperationGuardRef.current.current();
      if (firstUsePromotionOperation) {
        firstUsePromotionOperationGuardRef.current.cancel(
          firstUsePromotionOperation.sourceMessageId,
        );
      }
      const scheduleCareFollowUpOperation =
        scheduleCareFollowUpOperationGuardRef.current.current();
      if (scheduleCareFollowUpOperation) {
        scheduleCareFollowUpOperationGuardRef.current.cancel(scheduleCareFollowUpOperation);
      }
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [
    applyMediationSafetyFence,
    chatSessionRetryVersion,
    isCurrentChatSession,
    resetChatSessionState,
    setLaneFailure,
  ]);

  useEffect(() => {
    if (!topicMessageRefIdParam) {
      consumedTopicMessageFocusRef.current = null;
      topicMessageFocusScrollAttemptsRef.current = 0;
      topicMessageFocusTargetRef.current = null;
      announcedTopicMessageFocusRef.current = null;
      setResolvedTopicMessageFocus(null);
      setTopicMessageFocusState(null);
      return;
    }
    if (!initialLoaded || !userId || !userRole || !coupleId) return;

    const expectedOwnerUserId = userId;
    const expectedCoupleId = coupleId;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    const focusOperationKey = [
      expectedOwnerUserId,
      expectedCoupleId,
      topicMessageRefIdParam,
      topicMessageFocusRetryVersion,
    ].join(":");
    if (consumedTopicMessageFocusRef.current === focusOperationKey) return;
    consumedTopicMessageFocusRef.current = focusOperationKey;
    topicMessageFocusScrollAttemptsRef.current = 0;
    topicMessageFocusTargetRef.current = null;
    announcedTopicMessageFocusRef.current = null;
    setResolvedTopicMessageFocus(null);
    setTopicMessageFocusState({ status: "loading", refId: topicMessageRefIdParam });

    const isCurrentContext = () => (
      isCurrentChatSession(sessionGeneration)
      && sessionUserIdRef.current === expectedOwnerUserId
      && sessionCoupleIdRef.current === expectedCoupleId
      && consumedTopicMessageFocusRef.current === focusOperationKey
    );

    void resolvePreparationTopicMessageReference({
      apiFetch: (path, options) => (
        apiFetchForExpectedUser(expectedOwnerUserId, path, options)
      ),
      ownerId: expectedOwnerUserId,
      coupleId: expectedCoupleId,
      refId: topicMessageRefIdParam,
      isCurrent: isCurrentContext,
    }).then(async (resolved) => {
      if (!isCurrentContext()) return;
      const verifiedIdentity = await currentVerifiedChatIdentity();
      if (!isCurrentContext()) return;
      if (
        verifiedIdentity?.userId !== expectedOwnerUserId
        || verifiedIdentity.coupleId !== expectedCoupleId
      ) {
        setTopicMessageFocusState({
          status: "error",
          refId: topicMessageRefIdParam,
          message: "계정이나 커플 연결이 바뀌어 저장한 대화를 열지 않았어요.",
          canRetry: false,
        });
        return;
      }

      setActiveScope(resolved.target.lane === "shared" ? "shared" : "private");
      setTarget("ai");
      setMessages((currentMessages) => (
        mergePreparationTopicResolvedConversation(
          currentMessages,
          resolved,
          userRole,
        ) as ChatMessage[]
      ));
      setResolvedTopicMessageFocus({
        refId: resolved.reference.refId,
        targetMessageId: resolved.target.messageId,
        audience: resolved.reference.audience,
      });
      topicMessageFocusTargetRef.current = resolved.target.messageId;
      setTopicMessageFocusState({
        status: "ready",
        refId: resolved.reference.refId,
        targetMessageId: resolved.target.messageId,
      });
    }).catch((error: unknown) => {
      if (!isCurrentContext()) return;
      topicMessageFocusTargetRef.current = null;
      setResolvedTopicMessageFocus(null);
      const presentation = getPreparationTopicMessageReferenceFocusPresentation(error);
      setTopicMessageFocusState({
        status: "error",
        refId: topicMessageRefIdParam,
        ...presentation,
      });
    });
  }, [
    coupleId,
    initialLoaded,
    isCurrentChatSession,
    topicMessageFocusRetryVersion,
    topicMessageRefIdParam,
    userId,
    userRole,
  ]);

  useEffect(() => {
    if (topicMessageFocusState?.status !== "ready") return;
    const targetMessageId = topicMessageFocusState.targetMessageId;
    const targetIndex = visibleMessages.findIndex((message) => message.id === targetMessageId);
    if (targetIndex < 0) return;

    const frame = requestAnimationFrame(() => {
      flatListRef.current?.scrollToIndex({
        index: visibleMessages.findIndex((message) => (
          message.id === targetMessageId
        )),
        animated: true,
        viewPosition: 0.5,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [topicMessageFocusState, visibleMessages]);

  useEffect(() => {
    if (!initialLoaded || scopedMessages.length === 0) return;
    if (topicMessageRefIdParam) return;

    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = scopedMessages.length;

    if (previousCount === 0) {
      scrollToLatest(false, 0);
      return;
    }

    scrollToLatest(true);
  }, [initialLoaded, scopedMessages.length, scrollToLatest, topicMessageRefIdParam]);

  function pressIn() { Animated.spring(sendBtnScale, { toValue: 0.88, useNativeDriver: true }).start(); }
  function pressOut() { Animated.spring(sendBtnScale, { toValue: 1, friction: 3, tension: 120, useNativeDriver: true }).start(); }

  async function findDurableUserMessage(
    draft: AiDraft,
    intendedTarget: "ai",
  ): Promise<ChatMessage | null> {
    if (intendedTarget !== draft.target) return null;
    let firstUseSharedMessageId: string | null = null;
    if (draft.firstUseSourceMessageId) {
      const preview = await loadAmoraFirstUsePromotionPreview({
        expectedOwnerUserId: draft.userId,
        expectedCoupleId: draft.coupleId,
        sourceMessageId: draft.firstUseSourceMessageId,
        fetchForExpectedUser: apiFetchForExpectedUser,
      });
      if (preview.status !== "already_shared") return null;
      firstUseSharedMessageId = preview.sharedMessageId;
    }
    let query = supabase.from("chat_messages")
      .select("id, couple_id, sender_id, role, sender_type, content, metadata, created_at, visibility")
      .eq("couple_id", draft.coupleId)
      .eq("sender_id", draft.userId)
      .eq("sender_type", draft.senderType)
      .eq("role", "user")
      .eq("visibility", draft.visibility);
    query = firstUseSharedMessageId
      ? query.eq("id", firstUseSharedMessageId)
      : draft.confirmedActionId
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
    const firstUsePromotionReceiptMatches = validateFirstUsePromotionIngestReceipt({
      requestedSourceMessageId: draft.firstUseSourceMessageId ?? null,
      responseStatus: 201,
      reused: false,
      reusedBy: null,
      messageMetadata: metadata,
    });
    const scheduleCareFollowUpReceiptMatches = validateScheduleCareFollowUpIngestReceipt({
      requestedBinding: draft.scheduleCareFollowUp ?? null,
      messageMetadata: metadata,
    });
    const interactionModeMatches = draft.interactionMode === "listen_only"
      ? metadata?.interaction_mode === "listen_only"
      : metadata?.interaction_mode === undefined;
    const clientRequestMatches = draft.firstUseSourceMessageId
      ? isPersistedFirstUseSourceMessageId(metadata?.client_request_id)
      : metadata?.client_request_id === draft.clientRequestId;
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
      || !clientRequestMatches
      || (
        metadata?.target !== undefined
        && metadata.target !== "ai"
      )
      || metadata?.partner_recipient_id !== undefined
      || !confirmedActionMatches
      || !firstUsePromotionReceiptMatches
      || !scheduleCareFollowUpReceiptMatches
      || !interactionModeMatches
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

  async function sendPartnerDraft(
    draft: PartnerDraft,
    operation: ChatSendOperation,
  ) {
    const lane: AmoraChatLane = "shared_partner";
    if (!isCurrentChatOperation(operation)) return;
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
    try {
      const recipientVerification = await verifyPartnerDraftRecipient(draft);
      if (!isCurrentChatOperation(operation)) return;
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

      operation.phase = "ingest";
      const ingestResult = await requestAiMessageIngest(
        draft,
        operation.controller.signal,
      );
      operation.phase = "ingest_result";
      const canApplyKnownIngestResult = isCurrentChatOperation(operation)
        || (
          operation.stopReason === "user"
          && isCurrentChatSession(draft.sessionGeneration)
        );
      if (!canApplyKnownIngestResult) return;
      if (ingestResult.outcome === "ephemeral_safety") {
        if (!ingestResult.partnerDeliveryHeld) {
          throw new Error("partner safety hold was not confirmed");
        }
        // 서버가 안전 보류로 답한 순간 기기/프로세스 펜스를 먼저 남긴다. 이 카드는
        // 화면에만 있으므로, 재시작하면 카드가 사라지는데 원격 seal이 실패했다면
        // 홀드가 어디에도 남지 않는다 — 안전 보류가 있었다는 사실이 증발하고
        // 선택형 후속이 다시 자격을 얻는다. 실패해도 안내는 그대로 뜬다.
        const localSafetyHoldWrite = sealPrivateMediationSafetyHold({
          ownerUserId: draft.userId,
          coupleId: draft.coupleId,
        }).catch(() => undefined);
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
            durable_safety_fence_confirmed:
              ingestResult.durableSafetyFenceConfirmed,
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
          current[lane].trim() === draft.text
            ? updateAmoraChatLaneRecord(current, lane, "")
            : current
        ));
        setLaneFailure(lane, null);
        setPartnerSafetyNotice(null);
        setQuotaRemaining(null);
        setActiveScope("private");
        setTarget("ai");
        safetyHoldLockRef.current = true;
        await localSafetyHoldWrite;
        return;
      }
      const durableMessage = ingestResult.message;
      if (canApplyKnownIngestResult) {
        setMessages((previous) => previous.some((message) => message.id === durableMessage.id)
          ? previous
          : [...previous, durableMessage]
        );
        setInputByLane((current) => (
          current[lane].trim() === draft.text
            ? updateAmoraChatLaneRecord(current, lane, "")
            : current
        ));
        setLaneFailure(lane, null);
      }
    } catch (error) {
      if (
        operation.stopReason === "user"
        && operation.phase === "ingest"
        && isCurrentChatSession(draft.sessionGeneration)
      ) {
        setLaneFailure(lane, {
          kind: "partner_ingest",
          message: "전송을 중단했지만 서버 저장이 끝났을 수 있어요. 중복 저장을 막으려면 같은 요청의 저장 여부를 확인하고 이어가 주세요.",
          draft,
          canRetry: true,
          requiresReconciliation: true,
          unavailableReason: null,
        });
        return;
      }
      if (operation.stopReason !== null) return;
      if (isCurrentChatOperation(operation)) {
        const recovery = getAiMessageIngestRecovery(error, true);
        const statusNeedsDifferentAction = error instanceof AiMessageIngestError
          && (error.status === 401 || error.status === 403);
        setLaneFailure(lane, {
          kind: "partner_ingest",
          message: error instanceof AiMessageIngestError
            ? getAiMessageIngestFailureMessage(error, false)
              : "메시지 전송 결과를 확인하지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.",
          draft,
          canRetry: recovery.canRetry,
          requiresReconciliation: recovery.requiresReconciliation,
          unavailableReason: recovery.canRetry || statusNeedsDifferentAction
            ? null
            : NEW_CHAT_MESSAGE_REQUIRED_NOTICE,
        });
      }
    }
  }

  async function streamAiRequest(
    request: AiRequest,
    operation: ChatSendOperation,
  ) {
    if (request.body.requestKind === "mediation") {
      operation.requestKind = "mediation";
      operation.mediationSafetyEpoch = request.mediationSafetyEpoch ?? null;
      operation.requestTempId = request.tempId;
    }
    if (!isCurrentAiRequest(request, operation)) return;
    operation.phase = "stream";
    if (persistedAiRequestKeysRef.current.has(request.serverRequestKey)) {
      setLaneFailure(request.lane, null);
      if (request.preparationTopic) {
        const persistedAnswer = messagesRef.current.find((message) => (
          !message.id.startsWith("temp_")
          && message.couple_id === request.body.coupleId
          && message.sender_type === "ai"
          && message.visibility === request.body.visibility
          && messageRequestKey(message) === request.serverRequestKey
        ));
        const receipt = persistedAnswer
          ? createPreparationTopicChatReturnReceipt({
              binding: request.preparationTopic,
              ownerUserId: request.expectedActorUserId,
              coupleId: request.body.coupleId,
              lane: request.lane,
              visibility: request.body.visibility,
              requestText:
                request.body.messages[request.body.messages.length - 1]?.content ?? "",
              responseText: persistedAnswer.content,
              serverMessageId: persistedAnswer.id,
              serverRequestKey: request.serverRequestKey,
            })
          : null;
        if (receipt) setPreparationTopicReturnReceipt(receipt);
      }
      return;
    }
    setLaneFailure(request.lane, null);
    setQuotaRemaining(null);
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
      operation.controller.abort();
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const completion = await requestChatStream(
        request.body,
        operation.controller.signal,
        (partialText, toolResults, metadata) => {
          if (!isCurrentAiRequest(request, operation)) return;
          pendingUpdate = { text: partialText, toolResults, metadata };
          if (renderFrame !== null) return;
          renderFrame = requestAnimationFrame(() => {
            renderFrame = null;
            if (!isCurrentAiRequest(request, operation)) return;
            setMessages((previous) => reconcileChatStreamUpdate(
              previous,
              request.tempId,
              request.serverRequestKey,
              pendingUpdate,
            ));
          });
        },
        (remaining) => {
          if (isCurrentAiRequest(request, operation)) setQuotaRemaining(remaining);
        },
        (metadata) => {
          if (!isCurrentAiRequest(request, operation)) return;
          completionPendingAction = getPendingAmoraAction({
            sender_type: "ai",
            visibility: request.body.visibility,
            metadata: { pending_amora_action: metadata.pending_amora_action },
          });
        },
        request.expectedActorUserId,
      );
      cancelPendingRender();
      if (isCurrentAiRequest(request, operation)) {
        const crisisBoundCompletion: ChatStreamCompletion =
          completion.metadata?.response_origin === "deterministic_crisis_safety"
          && !completion.metadata.in_reply_to_user_message_id
          && typeof request.body.userMessageId === "string"
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
        const preparationTopicReceipt = request.preparationTopic
          ? createPreparationTopicChatReturnReceipt({
              binding: request.preparationTopic,
              ownerUserId: request.expectedActorUserId,
              coupleId: request.body.coupleId,
              lane: request.lane,
              visibility: request.body.visibility,
              requestText:
                request.body.messages[request.body.messages.length - 1]?.content ?? "",
              responseText: completedUpdate.text,
              serverMessageId: completion.metadata?.serverMessageId,
              serverRequestKey: request.serverRequestKey,
            })
          : null;
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
        if (preparationTopicReceipt) {
          setPreparationTopicReturnReceipt(preparationTopicReceipt);
        }
        scrollToLatest(true);
      }
    } catch (error) {
      if (
        operation.stopReason === "user"
        && isCurrentChatSession(request.sessionGeneration)
      ) {
        cancelPendingRender();
        setMessages((previous) => previous.filter((message) => message.id !== request.tempId));
        return;
      }
      if (operation.stopReason !== null) return;
      if (isCurrentAiRequest(request, operation)) {
        cancelPendingRender();
        setMessages((previous) => previous.filter((message) => message.id !== request.tempId));
        if (!persistedAiRequestKeysRef.current.has(request.serverRequestKey)) {
          const canRetry = canRetrySameChatRequest(error, timedOut);
          const firstUseRecovery = error instanceof ChatTransportError
            ? getFirstUsePromotionSendRecovery({
                serverCode: error.serverCode,
                retryPolicy: error.retryPolicy,
              })
            : null;
          const scheduleCareRecovery = request.scheduleCareFollowUp
            && error instanceof ChatTransportError
            ? getScheduleCareFollowUpFailureRecovery({
                phase: "stream",
                serverCode: error.serverCode,
                retryPolicy: error.retryPolicy,
              })
            : null;
          setLaneFailure(request.lane, {
            kind: "ai_response",
            message: scheduleCareRecovery?.message
              ?? firstUseRecovery?.message
              ?? getAiFailureMessage(error, timedOut, request.body.requestKind),
            request,
            canRetry: scheduleCareRecovery?.action === "retry_same_request"
              ? true
              : scheduleCareRecovery
                ? false
                : canRetry,
            requiresReconciliation: false,
            unavailableReason: scheduleCareRecovery || firstUseRecovery
              ? null
              : canRetry
              ? null
              : NEW_CHAT_MESSAGE_REQUIRED_NOTICE,
            firstUseRecovery,
            scheduleCareRecovery,
          });
        }
      }
    } finally {
      cancelPendingRender();
      clearTimeout(timeout);
    }
  }

  async function sendAiDraft(
    draft: AiDraft,
    reconcileFirst: boolean,
    operation: ChatSendOperation,
  ) {
    const draftLane = aiLaneForVisibility(draft.visibility);
    if (!isCurrentChatOperation(operation)) return;
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
    try {
      let durableMessage = reconcileFirst
        ? await findDurableUserMessage(draft, "ai")
        : null;
      if (!isCurrentChatOperation(operation)) return;
      if (draft.durableUserMessageId && !durableMessage) {
        setLaneFailure(draftLane, {
          kind: "ai_insert",
          message: "저장된 질문을 안전하게 다시 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
          draft,
          canRetry: true,
          requiresReconciliation: false,
          unavailableReason: null,
        });
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
        if (!isCurrentChatOperation(operation)) return;
        if (!claim.applicationGranted) {
          setPendingActionNotice({
            actionId: draft.confirmedActionId,
            message: "다른 화면에서 반영을 진행 중이에요. 잠시 후 다시 시도해 주세요.",
          });
          return;
        }
      }

      let safetyPrivacyRedirected = durableMessage !== null
        && durableMessage.visibility !== draft.requestedVisibility;
      if (!durableMessage) {
        operation.phase = "ingest";
        const ingestResult = await requestAiMessageIngest(
          draft,
          operation.controller.signal,
        );
        operation.phase = "ingest_result";
        const canApplyKnownIngestResult = isCurrentChatOperation(operation)
          || (
            operation.stopReason === "user"
            && isCurrentChatSession(draft.sessionGeneration)
          );
        if (!canApplyKnownIngestResult) return;
        if (ingestResult.outcome === "ephemeral_safety") {
          // 위와 같은 이유로 기기/프로세스 펜스를 카드보다 먼저 남긴다. 이 경로는
          // 서버가 durable seal을 확정하지 못한 503도 포함하므로, 여기서 로컬 홀드를
          // 남기지 않으면 재시작 후 홀드가 SecureStore에도 DB에도 없게 된다.
          const localSafetyHoldWrite = sealPrivateMediationSafetyHold({
            ownerUserId: draft.userId,
            coupleId: draft.coupleId,
          }).catch(() => undefined);
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
              durable_safety_fence_confirmed:
                ingestResult.durableSafetyFenceConfirmed,
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
              ? updateAmoraChatLaneRecord(current, draft.sourceLane, "")
              : current
          ));
          setQuotaRemaining(null);
          setActiveScope("private");
          setTarget("ai");
          safetyHoldLockRef.current = true;
          await localSafetyHoldWrite;
          return;
        }
        durableMessage = ingestResult.message;
        safetyPrivacyRedirected = ingestResult.safetyPrivacyRedirected;
      }

      if (!durableMessage) throw new Error("AI user message was not persisted");
      const effectiveVisibility = durableMessage.visibility;
      const canonicalUserMessage = durableMessage;
      if (draft.interactionMode === "listen_only") {
        setListenOnlySelected(false);
      }
      if (
        draft.firstUseSourceMessageId
        && firstUseComposerBindingRef.current?.sourceMessageId
          === draft.firstUseSourceMessageId
      ) {
        firstUseComposerBindingRef.current = null;
        setFirstUseComposerNotice(null);
      }
      if (draft.scheduleCareFollowUp) {
        scheduleCareFollowUpComposerBindingRef.current = null;
        setScheduleCareFollowUpEntryStatus(null);
      }
      if (
        draft.preparationTopic
        && preparationTopicChatComposerBindingRef.current === draft.preparationTopic
      ) {
        preparationTopicChatComposerBindingRef.current = null;
      }
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

      const canonicalClientRequestId = canonicalUserMessage.metadata!.client_request_id!;
      const serverRequestKey = `chat:${draft.userId}:${canonicalClientRequestId}`;
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
      const canonicalInteractionMode =
        canonicalUserMessage.metadata?.interaction_mode === "listen_only"
          ? "listen_only" as const
          : undefined;
      const canonicalPreparationTopic = draft.preparationTopic
        && effectiveVisibility !== "shared"
        && canonicalUserMessage.content === draft.preparationTopic.prompt
        ? draft.preparationTopic
        : undefined;
      const request: AiRequest = {
        expectedActorUserId: draft.userId,
        tempId: `temp_${draft.clientRequestId}`,
        serverRequestKey,
        lane: effectiveLane,
        sessionGeneration: draft.sessionGeneration,
        ...(draft.scheduleCareFollowUp
          ? { scheduleCareFollowUp: draft.scheduleCareFollowUp }
          : {}),
        ...(canonicalPreparationTopic
          ? { preparationTopic: canonicalPreparationTopic }
          : {}),
        body: {
          messages: [
            ...canonicalContext,
            { role: "user", content: canonicalUserMessage.content },
          ],
          coupleId: canonicalUserMessage.couple_id,
          senderName: draft.senderName,
          clientRequestId: canonicalClientRequestId,
          userMessageId: canonicalUserMessage.id,
          visibility: effectiveVisibility,
          ...(canonicalConfirmedActionId
            ? { confirmedActionId: canonicalConfirmedActionId }
            : {}),
          ...(canonicalInteractionMode
            ? { conversationMode: canonicalInteractionMode }
            : {}),
        },
      };

      const canApplyKnownIngestResult = isCurrentChatOperation(operation)
        || (
          operation.stopReason === "user"
          && operation.phase === "ingest_result"
          && isCurrentChatSession(draft.sessionGeneration)
        );
      if (canApplyKnownIngestResult) {
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
      if (operation.stopReason === "user") return;
      if (!isCurrentChatOperation(operation)) return;
      await streamAiRequest(request, operation);
    } catch (error) {
      if (
        operation.stopReason === "user"
        && operation.phase === "ingest"
        && isCurrentChatSession(draft.sessionGeneration)
      ) {
        setLaneFailure(draftLane, {
          kind: "ai_insert",
          message: "전송을 중단했지만 서버 저장이 끝났을 수 있어요. 중복 저장을 막으려면 같은 요청의 저장 여부를 확인하고 이어가 주세요.",
          draft,
          canRetry: true,
          requiresReconciliation: true,
          unavailableReason: null,
        });
        return;
      }
      if (operation.stopReason !== null) return;
      if (isCurrentChatOperation(operation)) {
        const recovery = getAiMessageIngestRecovery(error, false);
        const firstUseRecovery = error instanceof AiMessageIngestError
          ? getFirstUsePromotionSendRecovery({
              serverCode: error.serverCode,
              retryPolicy: error.retryPolicy,
            })
          : null;
        const scheduleCareRecovery = draft.scheduleCareFollowUp
          && error instanceof AiMessageIngestError
          ? getScheduleCareFollowUpFailureRecovery({
              phase: "ingest",
              serverCode: error.serverCode,
              retryPolicy: error.retryPolicy,
            })
          : null;
        setLaneFailure(draftLane, {
          kind: "ai_insert",
          message: scheduleCareRecovery?.message
            ?? getAiMessageIngestFailureMessage(
              error,
              typeof draft.confirmedActionId === "string",
            ),
          draft,
          canRetry: recovery.canRetry,
          requiresReconciliation: recovery.requiresReconciliation,
          unavailableReason: scheduleCareRecovery || firstUseRecovery
            ? null
            : recovery.canRetry
              ? null
              : NEW_CHAT_MESSAGE_REQUIRED_NOTICE,
          firstUseRecovery,
          scheduleCareRecovery,
          ...(scheduleCareRecovery
            ? {
                canRetry: scheduleCareRecovery.action === "retry_same_request",
                requiresReconciliation: false,
                unavailableReason: null,
              }
            : {}),
        });
      }
    }
  }

  async function handleOpenMediationRequest(offerKey: string | null = "manual") {
    if (!offerKey) return;
    if (
      streaming
      || sendingRef.current
      || pendingIngestReconciliation
      || !hasLinkedPartner
      || !coupleId
      || !userId
      || !userRole
      || hasVisibleSharedMediationSafetyCard
      || hasLocalPrivateMediationSafetyHold
      || hasDevicePrivateMediationSafetyHold
    ) return;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (
      !isCurrentChatSession(sessionGeneration)
      || sessionUserIdRef.current !== userId
    ) return;
    const deviceSafetyHold = await hasPrivateMediationSafetyHold({
      ownerUserId: userId,
      coupleId,
    });
    if (
      !isCurrentChatSession(sessionGeneration)
      || sessionUserIdRef.current !== userId
      || deviceSafetyHold
    ) {
      if (deviceSafetyHold && isCurrentChatSession(sessionGeneration)) {
        setHasDevicePrivateMediationSafetyHold(true);
        applyMediationSafetyFence();
      }
      return;
    }
    setMediationRequestError(null);
    setMediationRequestOwner({
      userId,
      coupleId,
      sessionGeneration,
      offerKey,
      privateSafetyEpoch: localPrivateMediationSafetyEpoch,
    });
  }

  function rememberMediationOfferDismissal(
    ownerUserId: string,
    ownerCoupleId: string,
    offerKey: string,
  ) {
    if (
      sessionUserIdRef.current !== ownerUserId
      || userId !== ownerUserId
      || coupleId !== ownerCoupleId
    ) return;
    const next = new Set(dismissedMediationOfferKeys);
    next.add(offerKey);
    setDismissedMediationOfferKeys(next);
    void saveAmoraMediationOfferDismissals(ownerUserId, ownerCoupleId, [...next]).catch(() => {
      // A failed preference write may show the same optional offer again, but never blocks chat.
    });
  }

  function handleDismissMediationOffer() {
    if (!mediationOffer.offerKey || !userId || !coupleId) return;
    rememberMediationOfferDismissal(userId, coupleId, mediationOffer.offerKey);
  }

  async function handleConfirmMediationRequest(requesterSummary: string) {
    const requestOwner = mediationRequestOwner;
    if (!requestOwner || mediationRequestPending || streaming || sendingRef.current) return;
    if (
      sessionUserIdRef.current !== requestOwner.userId
      || userId !== requestOwner.userId
      || coupleId !== requestOwner.coupleId
      || !isCurrentChatSession(requestOwner.sessionGeneration)
      || !userRole
      || !hasLinkedPartner
      || requestOwner.privateSafetyEpoch !== localPrivateMediationSafetyEpoch
      || hasVisibleSharedMediationSafetyCard
      || hasLocalPrivateMediationSafetyHold
      || hasDevicePrivateMediationSafetyHold
    ) {
      setMediationRequestOwner(null);
      setMediationRequestError(null);
      return;
    }
    const deviceSafetyHold = await hasPrivateMediationSafetyHold({
      ownerUserId: requestOwner.userId,
      coupleId: requestOwner.coupleId,
    });
    if (
      sessionUserIdRef.current !== requestOwner.userId
      || userId !== requestOwner.userId
      || coupleId !== requestOwner.coupleId
      || !isCurrentChatSession(requestOwner.sessionGeneration)
      || deviceSafetyHold
    ) {
      if (deviceSafetyHold && isCurrentChatSession(requestOwner.sessionGeneration)) {
        setHasDevicePrivateMediationSafetyHold(true);
        applyMediationSafetyFence();
      }
      setMediationRequestOwner(null);
      setMediationRequestError(null);
      return;
    }
    const normalized = normalizeAmoraMediationSummary(requesterSummary);
    if (!normalized.ok) {
      setMediationRequestError("상황을 4자 이상 600자 이하로 적어주세요.");
      return;
    }
    if (requestOwner.offerKey !== "manual") {
      rememberMediationOfferDismissal(
        requestOwner.userId,
        requestOwner.coupleId,
        requestOwner.offerKey,
      );
    }

    const mediationSafetyPlan = planAmoraCrisisDelivery({
      userText: normalized.summary,
      requestedVisibility: "shared",
      target: "partner",
      senderRole: userRole,
      externalSafetySignal: hasMediationSafetySignal(normalized.summary),
    });
    if (mediationSafetyPlan.disposition === "local_safety_hold") {
      // Seal the process/device fence synchronously before awaiting the
      // cross-device service fence. Its rejection must not remove guidance.
      const localSafetyHoldWrite = sealPrivateMediationSafetyHold({
        ownerUserId: requestOwner.userId,
        coupleId: requestOwner.coupleId,
      }).catch(() => undefined);
      const safetyCard: ChatMessage = {
        id: `amora-mediation-safety-hold:${requestOwner.userId}:${Crypto.randomUUID()}`,
        couple_id: requestOwner.coupleId,
        sender_id: null,
        role: "assistant",
        sender_type: "ai",
        content: `안전을 위해 이 조율 요청은 상대방에게 보내거나 저장하지 않았어요.\n\n${mediationSafetyPlan.response}`,
        metadata: {
          response_origin: mediationSafetyPlan.safetyResolution === "immediate_crisis"
            ? "client_deterministic_crisis_preflight"
            : "client_deterministic_safety_privacy_preflight",
          question_scope: mediationSafetyPlan.safetyResolution === "immediate_crisis"
            ? "W5_safety_override"
            : "W2_high_risk_adjacent",
          memory_eligible: false,
          persistence_status: "ephemeral_local_only",
          pinned_safety_card: true,
          raw_disclosure_persisted: false,
          raw_disclosure_shared: false,
          raw_disclosure_persistence: "none",
          durable_safety_fence_confirmed: false,
        },
        created_at: new Date().toISOString(),
        visibility: mediationSafetyPlan.effectiveVisibility,
      };
      setMessages((previous) => [...previous, safetyCard]);
      setMediationRequestOwner(null);
      setMediationRequestError(null);
      setActiveScope("private");
      setTarget("ai");
      safetyHoldLockRef.current = true;
      const durableSafetyFenceConfirmed =
        await sealDurableMediationPrivateSafetyHold(
          requestOwner.userId,
          requestOwner.coupleId,
        );
      await localSafetyHoldWrite;
      if (
        sessionUserIdRef.current !== requestOwner.userId
        || userId !== requestOwner.userId
        || coupleId !== requestOwner.coupleId
        || !isCurrentChatSession(requestOwner.sessionGeneration)
      ) return;
      if (durableSafetyFenceConfirmed) {
        setMessages((previous) => previous.map((message) => (
          message.id === safetyCard.id
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  durable_safety_fence_confirmed: true,
                },
              }
            : message
        )));
      }
      return;
    }

    const clientRequestId = Crypto.randomUUID();
    const builtBody = buildAmoraMediationRequestBody({
      summary: normalized.summary,
      senderRole: userRole,
      senderName: userName,
      memberModelVersion,
      coupleId: requestOwner.coupleId,
      clientRequestId,
    });
    const request: AiRequest = {
      expectedActorUserId: requestOwner.userId,
      tempId: `temp_mediation_${clientRequestId}`,
      serverRequestKey: `chat:${requestOwner.userId}:${clientRequestId}`,
      lane: "shared_ai",
      sessionGeneration: requestOwner.sessionGeneration,
      mediationSafetyEpoch: mediationSafetyEpochRef.current,
      body: {
        ...builtBody,
        requestKind: "mediation",
        conflictContext: normalized.summary,
      },
    };
    const operation = beginChatSendOperation(requestOwner.sessionGeneration, request);
    setMediationRequestPending(true);
    setMediationRequestError(null);
    setMediationRequestOwner(null);
    setActiveScope("shared");
    setTarget("ai");
    try {
      await streamAiRequest(request, operation);
    } finally {
      finishChatSendOperation(operation);
      if (isCurrentChatSession(requestOwner.sessionGeneration)) {
        setMediationRequestPending(false);
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
      || pendingIngestReconciliation
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
      ...(recovery.interactionMode
        ? { interactionMode: recovery.interactionMode }
        : {}),
      ...(recovery.scheduleCareFollowUp
        ? { scheduleCareFollowUp: recovery.scheduleCareFollowUp }
        : {}),
    };

    const operation = beginChatSendOperation(sessionGeneration);
    setColdStartAiRecoveryByLane((current) => (
      updateAmoraChatLaneRecord(current, recovery.lane, null)
    ));
    setActiveScope(recovery.visibility === "shared" ? "shared" : "private");
    setTarget("ai");
    try {
      await sendAiDraft(draft, true, operation);
    } finally {
      finishChatSendOperation(operation);
    }
  }

  async function handleRetry() {
    if (!activeSendFailure || !activeLane || streaming || sendingRef.current) return;
    const failure = activeSendFailure;
    if (!failure.canRetry) return;
    if (
      failure.kind === "ai_response"
      && failure.request.body.requestKind === "mediation"
      && (
        failure.request.mediationSafetyEpoch === undefined
        || failure.request.mediationSafetyEpoch !== mediationSafetyEpochRef.current
        || mediationSafetyBlockedRef.current
      )
    ) {
      setLaneFailure("shared_ai", null);
      return;
    }
    const sessionGeneration = failure.kind === "ai_response"
      ? failure.request.sessionGeneration
      : failure.draft.sessionGeneration;
    if (!isCurrentChatSession(sessionGeneration)) return;
    const operation = beginChatSendOperation(
      sessionGeneration,
      failure.kind === "ai_response" ? failure.request : undefined,
    );
    try {
      if (failure.kind === "partner_ingest") {
        setInputByLane((current) => (
          updateAmoraChatLaneRecord(current, "shared_partner", failure.draft.text)
        ));
        await sendPartnerDraft(failure.draft, operation);
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
        await sendAiDraft(failure.draft, true, operation);
        return;
      }
      await streamAiRequest(failure.request, operation);
    } finally {
      finishChatSendOperation(operation);
    }
  }

  function handleRegenerateFirstUseAction() {
    const failure = activeSendFailure;
    if (
      !failure
      || failure.kind === "partner_ingest"
      || !failure.firstUseRecovery
      || streaming
      || sendingRef.current
    ) return;

    const failureLane = failure.kind === "ai_insert"
      ? aiLaneForVisibility(failure.draft.visibility)
      : failure.request.lane;
    const failedSharedText = failure.kind === "ai_insert"
      ? failure.draft.text
      : null;
    firstUseComposerBindingRef.current = null;
    setFirstUseComposerNotice(null);
    setPromotedFirstUseMessageId(null);
    setFirstUsePromotionUiState(null);
    setFirstUsePromotionPendingMessageId(null);
    setInputByLane((current) => (
      failedSharedText
      && current.shared_ai.trim() === failedSharedText.trim()
        ? updateAmoraChatLaneRecord(current, "shared_ai", "")
        : current
    ));
    setLaneFailure(failureLane, null);
    setActiveScope("private");
    setTarget("ai");
  }

  function handleScheduleCareSendRecovery() {
    const failure = activeSendFailure;
    const recovery = activeScheduleCareSendRecovery;
    if (
      !failure
      || failure.kind === "partner_ingest"
      || !recovery
      || streaming
      || sendingRef.current
    ) return;
    if (recovery.action === "retry_same_request") {
      void handleRetry();
      return;
    }

    const failureLane = failure.kind === "ai_insert"
      ? aiLaneForVisibility(failure.draft.visibility)
      : failure.request.lane;
    const failedPrivateText = failure.kind === "ai_insert"
      ? failure.draft.text
      : null;
    scheduleCareFollowUpComposerBindingRef.current = null;
    setScheduleCareFollowUpEntryStatus(null);
    setInputByLane((current) => (
      failedPrivateText
      && current.private_ai.trim() === failedPrivateText.trim()
        ? updateAmoraChatLaneRecord(current, "private_ai", "")
        : current
    ));
    setLaneFailure(failureLane, null);
    router.push("/(tabs)/dashboard");
  }

  function handlePreparationTopicReturn() {
    if (!preparationTopicReturnReceipt || !userId || !coupleId) return;
    const destination = buildPreparationTopicChatReturnDestination(
      preparationTopicReturnReceipt,
      { ownerUserId: userId, coupleId },
    );
    setPreparationTopicReturnReceipt(null);
    if (!destination) return;
    router.push(destination);
  }

  async function handleSend() {
    const text = input.trim();
    const activeVisibility = chatVisibilityForScope(activeScope, userRole);
    if (
      !text
      || streaming
      || sendingRef.current
      || pendingIngestReconciliation
      || !coupleId
      || !userId
      || !userRole
      || !activeVisibility
      || !activeLane
    ) return;
    if (
      activeLane === "private_ai"
      && scheduleCareFollowUpEntryStatus === "draft_changed"
    ) return;
    const activeScheduleCareComposerBinding = activeLane === "private_ai"
      ? scheduleCareFollowUpComposerBindingRef.current
      : null;
    if (activeScheduleCareComposerBinding) {
      const composerIssue = getScheduleCareFollowUpComposerIssue(
        activeScheduleCareComposerBinding,
        {
          ownerUserId: userId,
          coupleId,
          lane: activeLane,
          privateText: text,
        },
      );
      if (composerIssue) {
        if (composerIssue === "source_changed" || composerIssue === "identity_changed") {
          scheduleCareFollowUpComposerBindingRef.current = null;
        }
        setScheduleCareFollowUpEntryStatus(
          composerIssue === "source_changed" ? "draft_changed" : composerIssue,
        );
        return;
      }
      setScheduleCareFollowUpEntryStatus((current) => (
        current === "answer_required" || current === "answer_invalid"
          ? null
          : current
      ));
    }
    const boundFirstUseSourceMessageId = target === "ai"
      && activeLane === "shared_ai"
      && activeVisibility === "shared"
      ? resolveFirstUseSourceMessageIdForSend(
          firstUseComposerBindingRef.current,
          {
            ownerUserId: userId,
            coupleId,
            sharedText: text,
          },
        )
      : null;
    if (
      target === "ai"
      && activeLane === "shared_ai"
      && activeVisibility === "shared"
      && isFirstUseSharedActionDraftText(text)
      && boundFirstUseSourceMessageId === null
    ) {
      Keyboard.dismiss();
      setFirstUseComposerNotice("draft_changed");
      return;
    }
    const crisisPreflight = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: activeVisibility,
      target,
      senderRole: userRole,
      externalSafetySignal: hasAmoraChatSafetySignal(text),
    });
    const effectiveVisibility = crisisPreflight.effectiveVisibility;
    const effectiveLane = aiLaneForVisibility(effectiveVisibility);
    const preparationTopic = target === "ai"
      && crisisPreflight.disposition === "continue"
      && activeLane === "private_ai"
      && effectiveVisibility !== "shared"
      ? resolvePreparationTopicChatBindingForSend(
          preparationTopicChatComposerBindingRef.current,
          {
            ownerUserId: userId,
            coupleId,
            lane: activeLane,
            privateText: text,
          },
        )
      : null;
    const interactionMode = listenOnlySelected
      && crisisPreflight.disposition === "continue"
      && target === "ai"
      && boundFirstUseSourceMessageId === null
      && activeScheduleCareComposerBinding === null
      && preparationTopic === null
        ? "listen_only" as const
        : undefined;
    if (
      listenOnlySelected
      && crisisPreflight.disposition === "continue"
      && interactionMode === undefined
    ) {
      setListenOnlySelected(false);
      return;
    }
    if (listenOnlySelected && crisisPreflight.disposition !== "continue") {
      setListenOnlySelected(false);
    }
    const safetySessionGeneration = chatSessionGenerationRef.current.current();
    if (crisisPreflight.disposition === "local_safety_hold") {
      const safetyHoldWasLocked = safetyHoldLockRef.current;
      safetyHoldLockRef.current = true;
      if (safetyHoldWasLocked) return;
      const localSafetyHoldWrite = sealPrivateMediationSafetyHold({
        ownerUserId: userId,
        coupleId,
      }).catch(() => undefined);
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
          durable_safety_fence_confirmed: false,
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
          ? updateAmoraChatLaneRecord(current, activeLane, "")
          : current
      ));
      setLaneFailure(activeLane, null);
      setPartnerSafetyNotice(null);
      setActiveScope("private");
      setTarget("ai");
      const durableSafetyFenceConfirmed =
        await sealDurableMediationPrivateSafetyHold(userId, coupleId);
      await localSafetyHoldWrite;
      if (
        !isCurrentChatSession(safetySessionGeneration)
        || sessionUserIdRef.current !== userId
        || coupleId !== safetyCard.couple_id
      ) return;
      if (durableSafetyFenceConfirmed) {
        setMessages((previous) => previous.map((message) => (
          message.id === safetyCard.id
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  durable_safety_fence_confirmed: true,
                },
              }
            : message
        )));
      }
      return;
    }
    if (crisisPreflight.disposition === "private_safety_route") {
      safetyHoldLockRef.current = true;
      const localSafetyHoldWrite = sealPrivateMediationSafetyHold({
        ownerUserId: userId,
        coupleId,
      }).catch(() => undefined);
      const safetyCard: ChatMessage = {
        id: `amora-safety-seal-pending:${userId}:${Date.now()}`,
        couple_id: coupleId,
        sender_id: null,
        role: "assistant",
        sender_type: "ai",
        content: "안전을 위해 이 내용은 상대방에게 공유하거나 저장하지 않았어요. 개인 상담에서 안전을 먼저 확인해 주세요.",
        metadata: {
          response_origin: "client_deterministic_safety_privacy_preflight",
          question_scope: "W2_high_risk_adjacent",
          memory_eligible: false,
          persistence_status: "ephemeral_local_only",
          pinned_safety_card: true,
          raw_disclosure_persisted: false,
          raw_disclosure_shared: false,
          raw_disclosure_persistence: "none",
          durable_safety_fence_confirmed: false,
        },
        created_at: new Date().toISOString(),
        visibility: crisisPreflight.effectiveVisibility,
      };
      setMessages((previous) => [...previous, safetyCard]);
      setInputByLane((current) => (
        current[activeLane].trim() === text
          ? updateAmoraChatLaneRecord(current, activeLane, "")
          : current
      ));
      setLaneFailure(activeLane, null);
      setActiveScope("private");
      setTarget("ai");
      const durableSafetyFenceConfirmed =
        await sealDurableMediationPrivateSafetyHold(userId, coupleId);
      await localSafetyHoldWrite;
      if (
        !isCurrentChatSession(safetySessionGeneration)
        || sessionUserIdRef.current !== userId
        || coupleId !== safetyCard.couple_id
      ) return;
      if (durableSafetyFenceConfirmed) {
        // This was a local, pre-network latency card. The canonical ingest
        // result will replace it with truthful persistence scope.
        setMessages((previous) => previous.filter(
          (message) => message.id !== safetyCard.id,
        ));
      } else {
        setInputByLane((current) => (
          current[activeLane].trim() === text
            ? updateAmoraChatLaneRecord(current, activeLane, "")
            : current
        ));
        return;
      }
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
    const sharedSendAcknowledgement = sharedSendAcknowledgementRef.current;
    if (
      effectiveVisibility === "shared"
      && (
        sharedSendAcknowledgement?.userId !== userId
        || sharedSendAcknowledgement.coupleId !== coupleId
        || !sharedSendAcknowledgement.confirmed
      )
    ) {
      Keyboard.dismiss();
      setPendingSharedSendConfirmation({
        userId,
        coupleId,
        sessionGeneration,
        sourceLane: activeLane,
        text,
        saving: false,
        error: null,
      });
      return;
    }
    const firstUseSourceMessageId = effectiveVisibility === "shared"
      ? boundFirstUseSourceMessageId
      : null;
    const scheduleCareFollowUp = target === "ai"
      && activeLane === "private_ai"
      && activeVisibility !== "shared"
      && effectiveVisibility !== "shared"
      ? resolveScheduleCareFollowUpBindingForSend(
          scheduleCareFollowUpComposerBindingRef.current,
          {
            ownerUserId: userId,
            coupleId,
            lane: activeLane,
            privateText: text,
          },
        )
      : null;
    const operation = beginChatSendOperation(sessionGeneration);
    try {
      setPreparationTopicReturnReceipt(null);
      setPreparationTopicHandoffNotice(null);
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
        }, operation);
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
        ...(interactionMode ? { interactionMode: "listen_only" as const } : {}),
        ...(firstUseSourceMessageId ? { firstUseSourceMessageId } : {}),
        ...(scheduleCareFollowUp ? { scheduleCareFollowUp } : {}),
        ...(preparationTopic ? { preparationTopic } : {}),
      }, false, operation);
    } finally {
      finishChatSendOperation(operation);
    }
  }

  async function handleConfirmSharedSend() {
    const confirmation = pendingSharedSendConfirmation;
    if (!confirmation || confirmation.saving || sharedSendConfirmationBusyRef.current) return;
    if (
      !isCurrentChatSession(confirmation.sessionGeneration)
      || sessionUserIdRef.current !== confirmation.userId
      || userId !== confirmation.userId
      || coupleId !== confirmation.coupleId
    ) {
      setPendingSharedSendConfirmation(null);
      return;
    }

    sharedSendConfirmationBusyRef.current = confirmation;
    setPendingSharedSendConfirmation((current) => current === confirmation
      ? { ...current, saving: true, error: null }
      : current
    );
    try {
      await saveAmoraSharedSendAcknowledgement(
        confirmation.userId,
        confirmation.coupleId,
      );
      if (
        !isCurrentChatSession(confirmation.sessionGeneration)
        || sessionUserIdRef.current !== confirmation.userId
        || userId !== confirmation.userId
        || coupleId !== confirmation.coupleId
      ) return;
      sharedSendAcknowledgementRef.current = {
        userId: confirmation.userId,
        coupleId: confirmation.coupleId,
        confirmed: true,
      };
      setPendingSharedSendConfirmation(null);
      if (
        activeLane === confirmation.sourceLane
        && inputByLane[confirmation.sourceLane].trim() === confirmation.text
      ) await handleSend();
    } catch {
      if (isCurrentChatSession(confirmation.sessionGeneration)) {
        setPendingSharedSendConfirmation((current) => (
          current?.userId === confirmation.userId
          && current.coupleId === confirmation.coupleId
            ? {
                ...current,
                saving: false,
                error: "함께 대화 확인을 안전하게 기록하지 못했어요. 메시지는 보내지 않았습니다. 다시 시도해 주세요.",
              }
            : current
        ));
      }
    } finally {
      if (sharedSendConfirmationBusyRef.current === confirmation) {
        sharedSendConfirmationBusyRef.current = null;
      }
    }
  }

  function handleMoveSharedSendToPrivate() {
    const confirmation = pendingSharedSendConfirmation;
    if (!confirmation || confirmation.saving || pendingIngestReconciliation) return;
    if (
      !isCurrentChatSession(confirmation.sessionGeneration)
      || sessionUserIdRef.current !== confirmation.userId
      || userId !== confirmation.userId
      || coupleId !== confirmation.coupleId
    ) {
      setPendingSharedSendConfirmation(null);
      return;
    }
    const privateDraft = inputByLane.private_ai.trim();
    if (privateDraft && privateDraft !== confirmation.text) {
      setPendingSharedSendConfirmation((current) => current
        ? {
            ...current,
            error: "나만 상담에 작성 중인 내용이 있어요. 기존 초안을 먼저 확인해 주세요.",
          }
        : current
      );
      return;
    }
    setInputByLane((current) => {
      let next = updateAmoraChatLaneRecord(current, "private_ai", confirmation.text);
      if (
        confirmation.sourceLane !== "private_ai"
        && current[confirmation.sourceLane].trim() === confirmation.text
      ) {
        next = updateAmoraChatLaneRecord(next, confirmation.sourceLane, "");
      }
      return next;
    });
    if (confirmation.sourceLane === "shared_ai") {
      const sourceMessageId = firstUseComposerBindingRef.current?.sourceMessageId ?? null;
      firstUseComposerBindingRef.current = null;
      setFirstUseComposerNotice(null);
      if (sourceMessageId) {
        setPromotedFirstUseMessageId((current) => (
          current === sourceMessageId ? null : current
        ));
      }
    }
    setPendingSharedSendConfirmation(null);
    setListenOnlySelected(false);
    setActiveScope("private");
    setTarget("ai");
  }

  function handleStop() {
    const stoppedOperation = activeChatOperationGuardRef.current.stopActive("user");
    if (!stoppedOperation) return;
    if (stoppedOperation.phase === "ingest") return;
    finishChatSendOperation(stoppedOperation);
  }

  function handleInputChange(value: string) {
    if (!activeLane || pendingIngestReconciliation) return;
    safetyHoldLockRef.current = false;
    if (activeLane === "private_ai" && preparationTopicChatComposerBindingRef.current) {
      const binding = preparationTopicChatComposerBindingRef.current;
      const retainedBinding = reconcilePreparationTopicChatComposerBinding(
          binding,
          {
            ownerUserId: userId,
            coupleId,
            lane: activeLane,
            privateText: value,
          },
        );
      preparationTopicChatComposerBindingRef.current = retainedBinding;
      if (!retainedBinding) setPreparationTopicHandoffNotice("draft_changed");
    }
    if (activeLane === "shared_ai") {
      const binding = firstUseComposerBindingRef.current;
      const retainedBinding = binding
        ? reconcileFirstUseComposerBinding(binding, {
            ownerUserId: userId,
            coupleId,
            sharedText: value,
          })
        : null;
      if (binding) {
        firstUseComposerBindingRef.current = retainedBinding;
        if (!retainedBinding) {
          setPromotedFirstUseMessageId((current) => (
            current === binding.sourceMessageId ? null : current
          ));
        }
      }
      const isUnboundFirstUseDraft = retainedBinding === null
        && isFirstUseSharedActionDraftText(value.trim());
      setFirstUseComposerNotice((current) => {
        if (isUnboundFirstUseDraft) {
          return current === "private_composer_occupied"
            ? current
            : "draft_changed";
        }
        return current === "draft_changed" || current === "private_composer_occupied"
          ? null
          : current;
      });
    }
    if (activeLane === "private_ai" && scheduleCareFollowUpComposerBindingRef.current) {
      const binding = scheduleCareFollowUpComposerBindingRef.current;
      const retainedBinding = reconcileScheduleCareFollowUpComposerBinding(binding, {
        ownerUserId: userId,
        coupleId,
        lane: activeLane,
        privateText: value,
      });
      scheduleCareFollowUpComposerBindingRef.current = retainedBinding;
      if (!retainedBinding) {
        setScheduleCareFollowUpEntryStatus("draft_changed");
      } else {
        const composerIssue = getScheduleCareFollowUpComposerIssue(binding, {
          ownerUserId: userId,
          coupleId,
          lane: activeLane,
          privateText: value,
        });
        setScheduleCareFollowUpEntryStatus((current) => (
          current === "answer_required" || current === "answer_invalid"
            ? composerIssue === "answer_required" || composerIssue === "answer_invalid"
              ? composerIssue
              : null
            : current
        ));
      }
    }
    if (
      activeLane === "private_ai"
      && firstUseComposerNotice === "private_composer_occupied"
      && !value.trim()
      && isFirstUseSharedActionDraftText(inputByLane.shared_ai.trim())
    ) {
      setFirstUseComposerNotice("draft_changed");
    }
    setActiveInput(value);
    setSendFailuresByLane((current) => {
      const failure = current[activeLane];
      if (failure?.requiresReconciliation) return current;
      return failure?.kind === "partner_ingest" || failure?.kind === "ai_insert"
        ? updateAmoraChatLaneRecord(current, activeLane, null)
        : current;
    });
  }

  function handleFirstUseComposerNoticeAction() {
    if (!firstUseComposerNotice) return;
    if (firstUseComposerNotice === "composer_occupied") {
      setFirstUseComposerNotice(null);
      activeScopeRef.current = "shared";
      setActiveScope("shared");
      setTarget("ai");
      requestAnimationFrame(() => chatInputRef.current?.focus());
      return;
    }
    const recovery = planFirstUseSharedDraftPrivateRecovery({
      sharedText: inputByLane.shared_ai.trim(),
      privateText: inputByLane.private_ai,
    });
    if (recovery.status === "not_applicable") {
      setFirstUseComposerNotice(null);
      activeScopeRef.current = "shared";
      setActiveScope("shared");
      setTarget("ai");
      requestAnimationFrame(() => chatInputRef.current?.focus());
      return;
    }
    if (recovery.status === "private_occupied") {
      setFirstUseComposerNotice("private_composer_occupied");
      activeScopeRef.current = "private";
      setActiveScope("private");
      setTarget("ai");
      requestAnimationFrame(() => chatInputRef.current?.focus());
      return;
    }
    let nextDrafts = updateAmoraChatLaneRecord(
      inputByLane,
      "private_ai",
      recovery.privateDraft,
    );
    nextDrafts = updateAmoraChatLaneRecord(nextDrafts, "shared_ai", "");
    inputByLaneRef.current = nextDrafts;
    firstUseComposerBindingRef.current = null;
    setInputByLane(nextDrafts);
    setPendingSharedSendConfirmation(null);
    setFirstUseComposerNotice(null);
    activeScopeRef.current = "private";
    setActiveScope("private");
    setTarget("ai");
    requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  function handleTargetChange(nextTarget: MessageTarget) {
    if (
      streaming
      || sendingRef.current
      || pendingIngestReconciliation
      || (activeScope === "private" && nextTarget === "partner")
      || (nextTarget === "partner" && !hasLinkedPartner)
    ) return;
    safetyHoldLockRef.current = false;
    if (nextTarget !== target) setListenOnlySelected(false);
    setTarget(nextTarget);
  }

  function handleAiSuggestion(value: string) {
    if (streaming || sendingRef.current || pendingIngestReconciliation) return;
    safetyHoldLockRef.current = false;
    setListenOnlySelected(false);
    const lane: Exclude<AmoraChatLane, "shared_partner"> = activeScope === "private"
      ? "private_ai"
      : "shared_ai";
    if (lane === "private_ai" && scheduleCareFollowUpComposerBindingRef.current) {
      const retainedBinding = reconcileScheduleCareFollowUpComposerBinding(
        scheduleCareFollowUpComposerBindingRef.current,
        {
          ownerUserId: userId,
          coupleId,
          lane,
          privateText: value,
        },
      );
      scheduleCareFollowUpComposerBindingRef.current = retainedBinding;
      if (!retainedBinding) {
        setScheduleCareFollowUpEntryStatus("draft_changed");
      } else {
        const composerIssue = getScheduleCareFollowUpComposerIssue(retainedBinding, {
          ownerUserId: userId,
          coupleId,
          lane,
          privateText: value,
        });
        setScheduleCareFollowUpEntryStatus((current) => (
          current === "answer_required" || current === "answer_invalid"
            ? composerIssue === "answer_required" || composerIssue === "answer_invalid"
              ? composerIssue
              : null
            : current
        ));
      }
    }
    if (lane === "shared_ai" && firstUseComposerBindingRef.current) {
      const binding = firstUseComposerBindingRef.current;
      const retainedBinding = reconcileFirstUseComposerBinding(binding, {
        ownerUserId: userId,
        coupleId,
        sharedText: value,
      });
      firstUseComposerBindingRef.current = retainedBinding;
      if (!retainedBinding) {
        setFirstUseComposerNotice("draft_changed");
        setPromotedFirstUseMessageId((current) => (
          current === binding.sourceMessageId ? null : current
        ));
      }
    }
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
      || pendingIngestReconciliation
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
    let operation: ChatSendOperation | null = null;
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
      operation = beginChatSendOperation(sessionGeneration);
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
      }, false, operation);
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
      if (operation) finishChatSendOperation(operation);
      if (isCurrentChatSession(sessionGeneration)) {
        applyingPendingActionRef.current = null;
        setApplyingPendingActionId(null);
        if (!operation) sendingRef.current = false;
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
    if (streaming || sendingRef.current || pendingIngestReconciliation) return;
    const nextSelection = selectChatScope(
      { scope: activeScope, target },
      nextScope,
      userRole,
    );
    if (nextSelection.scope !== activeScope) setListenOnlySelected(false);
    activeScopeRef.current = nextSelection.scope;
    setActiveScope(nextSelection.scope);
    setTarget(nextSelection.target);
  }

  function handleCorrectFirstUseAction(sourceMessageId: string) {
    if (!sourceMessageId) return;
    firstUsePromotionOperationGuardRef.current.cancel(sourceMessageId);
    setFirstUsePromotionPendingMessageId((current) => (
      current === sourceMessageId ? null : current
    ));
    setFirstUsePromotionUiState((current) => (
      current?.sourceMessageId === sourceMessageId ? null : current
    ));
    if (
      streaming
      || sendingRef.current
      || pendingIngestReconciliation
      || !userId
      || !userRole
      || !coupleId
      || inputByLane.private_ai.trim()
    ) return;
    const correctionDraft = buildFirstUseCorrectionDraft();
    setInputByLane((current) => (
      current.private_ai.trim()
        ? current
        : updateAmoraChatLaneRecord(current, "private_ai", correctionDraft)
    ));
    setActiveScope("private");
    setTarget("ai");
    requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  function handleSkipFirstUseAction(sourceMessageId: string) {
    if (!sourceMessageId) return;
    firstUsePromotionOperationGuardRef.current.cancel(sourceMessageId);
    setFirstUsePromotionPendingMessageId((current) => (
      current === sourceMessageId ? null : current
    ));
    setFirstUsePromotionUiState((current) => (
      current?.sourceMessageId === sourceMessageId ? null : current
    ));
    setSkippedFirstUseMessageIds((current) => {
      const next = new Set(current);
      next.add(sourceMessageId);
      return next;
    });
  }

  function handleRestoreFirstUseAction(sourceMessageId: string) {
    if (!sourceMessageId) return;
    setSkippedFirstUseMessageIds((current) => {
      const next = new Set(current);
      next.delete(sourceMessageId);
      return next;
    });
  }

  function handleFirstUsePromotionRecovery(sourceMessageId: string) {
    const current = firstUsePromotionUiState;
    if (!current || current.sourceMessageId !== sourceMessageId) return;
    if (current.status === "timeout" || current.status === "unavailable") {
      void handleContinueFirstUseAction(sourceMessageId);
      return;
    }
    if (current.status === "identity_changed") {
      setFirstUsePromotionUiState(null);
      setChatSessionRetryVersion((version) => version + 1);
      return;
    }
    if (current.status === "already_shared") {
      setFirstUsePromotionUiState(null);
      setPromotedFirstUseMessageId(sourceMessageId);
      setActiveScope("shared");
      setTarget("ai");
      return;
    }
    if (current.status === "stale" || current.status === "criterion_stale") {
      const correctionDraft = current.status === "criterion_stale"
        ? buildFirstUseCriterionCorrectionDraft()
        : buildFirstUseCorrectionDraft();
      setInputByLane((laneDrafts) => (
        laneDrafts.private_ai.trim()
          ? laneDrafts
          : updateAmoraChatLaneRecord(laneDrafts, "private_ai", correctionDraft)
      ));
      setFirstUsePromotionUiState(null);
      setActiveScope("private");
      setTarget("ai");
      requestAnimationFrame(() => chatInputRef.current?.focus());
    }
  }

  async function handleContinueFirstUseAction(sourceMessageId: string) {
    if (
      streaming
      || sendingRef.current
      || pendingIngestReconciliation
      || firstUsePromotionOperationGuardRef.current.current() !== null
      || !userId
      || !userRole
      || !coupleId
    ) return;
    if (inputByLaneRef.current.shared_ai.trim()) {
      setFirstUseComposerNotice("composer_occupied");
      return;
    }
    const expectedOwnerUserId = userId;
    const expectedCoupleId = coupleId;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (!isCurrentChatSession(sessionGeneration)) return;
    const operation = firstUsePromotionOperationGuardRef.current.start(
      sourceMessageId,
      sessionGeneration,
    );
    if (!operation) return;
    setFirstUsePromotionPendingMessageId(sourceMessageId);
    setFirstUsePromotionUiState({ sourceMessageId, status: "checking" });

    try {
      const preview = await loadAmoraFirstUsePromotionPreview({
        expectedOwnerUserId,
        expectedCoupleId,
        sourceMessageId,
        fetchForExpectedUser: apiFetchForExpectedUser,
        signal: operation.controller.signal,
      });
      if (
        !firstUsePromotionOperationGuardRef.current.isCurrent(operation)
        || !isCurrentChatSession(sessionGeneration)
        || sessionUserIdRef.current !== expectedOwnerUserId
      ) return;
      if (preview.status !== "ready") {
        setFirstUsePromotionUiState({
          sourceMessageId,
          status: preview.status,
        });
        return;
      }
      if (inputByLaneRef.current.shared_ai.trim()) {
        setFirstUsePromotionUiState(null);
        setFirstUseComposerNotice("composer_occupied");
        return;
      }
      const binding = createFirstUseComposerBinding(preview);
      if (!binding) {
        setFirstUsePromotionUiState({ sourceMessageId, status: "unavailable" });
        return;
      }
      const nextDrafts = updateAmoraChatLaneRecord(
        inputByLaneRef.current,
        "shared_ai",
        preview.draft.sharedText,
      );
      inputByLaneRef.current = nextDrafts;
      firstUseComposerBindingRef.current = binding;
      setInputByLane(nextDrafts);
      setFirstUsePromotionUiState(null);
      setFirstUseComposerNotice(null);
      setPromotedFirstUseMessageId(sourceMessageId);
      setActiveScope("shared");
      setTarget("ai");
    } finally {
      if (firstUsePromotionOperationGuardRef.current.finish(operation)) {
        setFirstUsePromotionPendingMessageId((current) => (
          current === sourceMessageId ? null : current
        ));
      }
    }
  }

  async function handleStageScheduleCareSharedDraft(messageId: string) {
    if (
      !messageId
      || streaming
      || sendingRef.current
      || pendingIngestReconciliation
      || scheduleCareSharedDraftPendingMessageId !== null
      || !userId
      || !userRole
      || !coupleId
    ) return;
    const expectedOwnerUserId = userId;
    const expectedCoupleId = coupleId;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    if (!isCurrentChatSession(sessionGeneration)) return;
    const expectedPrivateVisibility: ChatMessageVisibility = `${userRole}_private`;
    const sourceMessage = [...messagesRef.current]
      .reverse()
      .find((message) => (
        message.sender_type === "ai"
        && message.couple_id === expectedCoupleId
        && message.visibility === expectedPrivateVisibility
      ));
    const sourceBinding = sourceMessage?.id === messageId
      ? readScheduleCareFollowUpBindingFromMetadata(sourceMessage.metadata)
      : null;
    const sourceActionDraft = sourceMessage?.id === messageId
      ? getScheduleCareFollowUpActionDraft(sourceMessage.metadata)
      : null;
    if (!sourceMessage || !sourceBinding || !sourceActionDraft) {
      setScheduleCareActionNotice("이 제안이 최신 가족 만남 기록과 연결됐는지 확인하지 못해 우리 준비로 가져오지 않았어요.");
      return;
    }
    setScheduleCareSharedDraftPendingMessageId(messageId);
    setScheduleCareActionNotice(null);
    try {
      const identity = await currentVerifiedChatIdentity();
      if (
        !isCurrentChatSession(sessionGeneration)
        || sessionUserIdRef.current !== expectedOwnerUserId
      ) return;
      if (
        userId !== expectedOwnerUserId
        || coupleId !== expectedCoupleId
        || identity?.userId !== expectedOwnerUserId
        || identity?.coupleId !== expectedCoupleId
      ) {
        setScheduleCareActionNotice("계정이나 커플 연결이 바뀌어 이 행동을 우리 준비로 가져오지 않았어요.");
        return;
      }
      const preparation = await prepareScheduleCareSharedDraft({
        expectedOwnerUserId,
        expectedCoupleId,
        expectedSessionGeneration: sessionGeneration,
        sourceMessageId: messageId,
        sourceMetadata: sourceMessage.metadata,
        fetchForExpectedUser: apiFetchForExpectedUser,
        timeoutMs: SCHEDULE_CARE_FOLLOW_UP_PREVIEW_TIMEOUT_MS,
        readCurrentContext: async () => {
          const currentIdentity = await currentVerifiedChatIdentity();
          const latestPrivateAiMessage = [...messagesRef.current]
            .reverse()
            .find((message) => (
              message.sender_type === "ai"
              && message.couple_id === expectedCoupleId
              && message.visibility === expectedPrivateVisibility
            ));
          return {
            ownerUserId: currentIdentity?.userId ?? null,
            coupleId: currentIdentity?.coupleId ?? null,
            sessionGeneration: chatSessionGenerationRef.current.current(),
            latestPrivateAiMessageId: latestPrivateAiMessage?.id ?? null,
            sourceMetadata: latestPrivateAiMessage?.id === messageId
              ? latestPrivateAiMessage.metadata
              : null,
          };
        },
      });
      if (
        !isCurrentChatSession(sessionGeneration)
        || sessionUserIdRef.current !== expectedOwnerUserId
      ) return;
      if (preparation.status !== "ready") {
        setScheduleCareActionNotice(
          SCHEDULE_CARE_SHARED_DRAFT_FAILURE_COPY[preparation.status],
        );
        return;
      }
      const sharedDraft = preparation.sharedDraft;
      if (inputByLaneRef.current.shared_ai.trim()) {
        setScheduleCareActionNotice("함께 대화에 작성 중인 초안이 있어 덮어쓰지 않았어요. 먼저 보내거나 비운 뒤 다시 눌러주세요.");
        return;
      }
      const nextDrafts = updateAmoraChatLaneRecord(
        inputByLaneRef.current,
        "shared_ai",
        sharedDraft,
      );
      inputByLaneRef.current = nextDrafts;
      firstUseComposerBindingRef.current = null;
      setFirstUseComposerNotice(null);
      setPromotedFirstUseMessageId(null);
      setInputByLane(nextDrafts);
      setDismissedScheduleCareActionMessageIds((current) => {
        const next = new Set(current);
        next.add(messageId);
        return next;
      });
      setActiveScope("shared");
      setTarget("ai");
      requestAnimationFrame(() => chatInputRef.current?.focus());
    } finally {
      if (isCurrentChatSession(sessionGeneration)) {
        setScheduleCareSharedDraftPendingMessageId((current) => (
          current === messageId ? null : current
        ));
      }
    }
  }

  function handleDismissScheduleCareAction(messageId: string) {
    setDismissedScheduleCareActionMessageIds((current) => {
      const next = new Set(current);
      next.add(messageId);
      return next;
    });
    setScheduleCareActionNotice(null);
  }

  function beginTopicMessageSaveOperation() {
    const operationId = topicMessageSaveOperationRef.current + 1;
    topicMessageSaveOperationRef.current = operationId;
    topicMessageSaveAbortControllerRef.current?.abort();
    const operationController = new AbortController();
    topicMessageSaveAbortControllerRef.current = operationController;
    return { operationId, operationController };
  }

  function finishTopicMessageSaveOperation(
    operationId: number,
    operationController: AbortController,
  ) {
    if (
      topicMessageSaveOperationRef.current === operationId
      && topicMessageSaveAbortControllerRef.current === operationController
    ) {
      topicMessageSaveAbortControllerRef.current = null;
    }
  }

  const closeTopicMessageSaveDialog = () => {
    topicMessageSaveOperationRef.current += 1;
    topicMessageSaveAbortControllerRef.current?.abort();
    topicMessageSaveAbortControllerRef.current = null;
    setTopicMessageSaveDialog(null);
  };

  async function handleOpenTopicMessageSaveDialog(sourceMessage: ChatMessage) {
    if (!userId || !userRole || !coupleId) return;
    const isStrictResolvedSource =
      resolvedTopicMessageFocus?.targetMessageId === sourceMessage.id;
    if (
      !isStrictResolvedSource
      && !isPreparationTopicMessageSaveEligible(sourceMessage, {
        coupleId,
        viewerRole: userRole,
      })
    ) return;

    const expectedOwnerUserId = userId;
    const expectedCoupleId = coupleId;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    const { operationId, operationController } = beginTopicMessageSaveOperation();
    const audience: AmoraPreparationTopicMessageRefAudience = isStrictResolvedSource
      ? resolvedTopicMessageFocus.audience
      : sourceMessage.visibility === "shared"
        ? "couple_shared"
        : "owner_private";
    setTopicMessageSaveNotice((current) => (
      current?.messageId === sourceMessage.id ? null : current
    ));
    setTopicMessageSaveDialog({
      sourceMessageId: sourceMessage.id,
      audience,
      references: [],
      partial: false,
      selectedTopicKey: null,
      selectedTopicReadState: "idle",
      selectedTopicSavedState: null,
      loading: true,
      collectionLoaded: false,
      saving: false,
      error: null,
    });

    const isCurrentContext = () => (
      isCurrentChatSession(sessionGeneration)
      && sessionUserIdRef.current === expectedOwnerUserId
      && sessionCoupleIdRef.current === expectedCoupleId
      && topicMessageSaveOperationRef.current === operationId
    );

    try {
      const collection = await loadPreparationTopicMessageReferences({
        apiFetch: (path, options) => (
          apiFetchForExpectedUser(expectedOwnerUserId, path, options)
        ),
        ownerId: expectedOwnerUserId,
        coupleId: expectedCoupleId,
        isCurrent: isCurrentContext,
        signal: operationController.signal,
      });
      if (!isCurrentContext()) return;
      const verifiedIdentity = await currentVerifiedChatIdentity();
      if (!isCurrentContext()) return;
      if (
        verifiedIdentity?.userId !== expectedOwnerUserId
        || verifiedIdentity.coupleId !== expectedCoupleId
      ) {
        setTopicMessageSaveDialog((current) => (
          current?.sourceMessageId === sourceMessage.id
            ? {
                ...current,
                loading: false,
                error: "계정이나 커플 연결이 바뀌어 저장 정보를 열지 않았어요.",
              }
            : current
        ));
        return;
      }
      setTopicMessageSaveDialog((current) => (
        current?.sourceMessageId === sourceMessage.id
          ? {
              ...current,
              references: collection.references.filter((reference) => (
                reference.messageId === sourceMessage.id
              )),
              partial: collection.partial,
              loading: false,
              collectionLoaded: true,
              error: null,
            }
          : current
      ));
    } catch (error: unknown) {
      if (!isCurrentContext()) return;
      setTopicMessageSaveDialog((current) => (
        current?.sourceMessageId === sourceMessage.id
          ? {
              ...current,
              loading: false,
              error: error instanceof PreparationTopicMessageRefError
                && error.code === "stale_context"
                ? "계정이나 커플 연결이 바뀌어 저장 정보를 열지 않았어요."
                : error instanceof PreparationTopicMessageRefError
                  && error.code === "timeout"
                  ? "저장 정보를 확인하는 데 시간이 오래 걸렸어요. 다시 불러와 주세요."
                : "저장 정보를 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
            }
          : current
      ));
    } finally {
      finishTopicMessageSaveOperation(operationId, operationController);
    }
  }

  async function handleSelectTopicMessageSaveTopic(topicKey: string) {
    const dialog = topicMessageSaveDialog;
    if (
      !dialog
      || !dialog.collectionLoaded
      || dialog.loading
      || dialog.saving
      || !isAmoraPreparationTopicMessageRefTopicKey(topicKey)
      || !userId
      || !userRole
      || !coupleId
    ) return;
    const sourceMessage = messagesRef.current.find((message) => (
      message.id === dialog.sourceMessageId
    ));
    if (!sourceMessage) {
      setTopicMessageSaveDialog({
        ...dialog,
        selectedTopicKey: topicKey,
        selectedTopicReadState: "error",
        selectedTopicSavedState: null,
        error: "원문을 찾지 못해 저장 상태를 확인하지 않았어요. 대화를 다시 불러와 주세요.",
      });
      return;
    }

    const expectedOwnerUserId = userId;
    const expectedCoupleId = coupleId;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    const { operationId, operationController } = beginTopicMessageSaveOperation();
    setTopicMessageSaveDialog((current) => (
      current?.sourceMessageId === dialog.sourceMessageId
        ? {
            ...current,
            selectedTopicKey: topicKey,
            selectedTopicReadState: "loading",
            selectedTopicSavedState: null,
            error: null,
          }
        : current
    ));

    const isCurrentContext = () => (
      isCurrentChatSession(sessionGeneration)
      && sessionUserIdRef.current === expectedOwnerUserId
      && sessionCoupleIdRef.current === expectedCoupleId
      && topicMessageSaveOperationRef.current === operationId
    );

    try {
      const state = await loadPreparationTopicMessageReferenceState({
        apiFetch: (path, options) => (
          apiFetchForExpectedUser(expectedOwnerUserId, path, options)
        ),
        ownerId: expectedOwnerUserId,
        coupleId: expectedCoupleId,
        topicKey,
        messageId: dialog.sourceMessageId,
        isCurrent: isCurrentContext,
        signal: operationController.signal,
      });
      if (!isCurrentContext()) return;
      setTopicMessageSaveDialog((current) => (
        current?.sourceMessageId === dialog.sourceMessageId
        && current.selectedTopicKey === topicKey
          ? {
              ...current,
              audience: state.reference.audience,
              selectedTopicReadState: "ready",
              selectedTopicSavedState: state.reference.savedState,
              error: null,
            }
          : current
      ));
    } catch (error: unknown) {
      if (!isCurrentContext()) return;
      setTopicMessageSaveDialog((current) => (
        current?.sourceMessageId === dialog.sourceMessageId
        && current.selectedTopicKey === topicKey
          ? {
              ...current,
              selectedTopicReadState: "error",
              selectedTopicSavedState: null,
              error: error instanceof PreparationTopicMessageRefError
                && error.code === "stale_context"
                ? "계정이나 커플 연결이 바뀌어 저장 상태를 확인하지 않았어요."
                : error instanceof PreparationTopicMessageRefError
                  && error.code === "timeout"
                  ? "저장 상태 확인이 오래 걸렸어요. 결과를 단정하지 않았으니 항목을 다시 눌러 주세요."
                : "이 준비의 저장 상태를 확인하지 못했어요. 항목을 다시 눌러 주세요.",
            }
          : current
      ));
    } finally {
      finishTopicMessageSaveOperation(operationId, operationController);
    }
  }

  async function handleConfirmTopicMessageSave() {
    const dialog = topicMessageSaveDialog;
    if (
      !dialog
      || dialog.loading
      || dialog.saving
      || !dialog.selectedTopicKey
      || dialog.selectedTopicReadState !== "ready"
      || dialog.selectedTopicSavedState === null
      || !isAmoraPreparationTopicMessageRefTopicKey(dialog.selectedTopicKey)
      || !userId
      || !userRole
      || !coupleId
    ) return;

    const sourceMessage = messagesRef.current.find((message) => (
      message.id === dialog.sourceMessageId
    ));
    if (!sourceMessage) {
      setTopicMessageSaveDialog({
        ...dialog,
        error: "원문을 찾지 못해 준비에 연결하지 않았어요. 대화를 다시 불러와 주세요.",
      });
      return;
    }
    const isStrictResolvedSource =
      resolvedTopicMessageFocus?.targetMessageId === sourceMessage.id;
    if (
      !isStrictResolvedSource
      && !isPreparationTopicMessageSaveEligible(sourceMessage, {
        coupleId,
        viewerRole: userRole,
      })
    ) {
      setTopicMessageSaveDialog({
        ...dialog,
        error: "현재 대화는 준비에 저장할 수 있는 원문으로 확인되지 않았어요.",
      });
      return;
    }

    const selectedTopic = PREPARATION_TOPIC_OPTIONS.find((topic) => (
      topic.key === dialog.selectedTopicKey
    ));
    if (!selectedTopic) return;
    const selectedTopicSavedState = dialog.selectedTopicSavedState;
    const desiredState = selectedTopicSavedState === "saved" ? "removed" : "saved";
    const expectedOwnerUserId = userId;
    const expectedCoupleId = coupleId;
    const sessionGeneration = chatSessionGenerationRef.current.current();
    const { operationId, operationController } = beginTopicMessageSaveOperation();
    setTopicMessageSaveDialog((current) => (
      current?.sourceMessageId === dialog.sourceMessageId
        ? { ...current, saving: true, error: null }
        : current
    ));

    const isCurrentContext = () => (
      isCurrentChatSession(sessionGeneration)
      && sessionUserIdRef.current === expectedOwnerUserId
      && sessionCoupleIdRef.current === expectedCoupleId
      && topicMessageSaveOperationRef.current === operationId
    );

    try {
      await mutatePreparationTopicMessageReference({
        apiFetch: (path, options) => (
          apiFetchForExpectedUser(expectedOwnerUserId, path, options)
        ),
        ownerId: expectedOwnerUserId,
        coupleId: expectedCoupleId,
        topicKey: dialog.selectedTopicKey,
        messageId: dialog.sourceMessageId,
        desiredState,
        requestId: Crypto.randomUUID(),
        isCurrent: isCurrentContext,
        signal: operationController.signal,
      });
      if (!isCurrentContext()) return;
      const verifiedIdentity = await currentVerifiedChatIdentity();
      if (!isCurrentContext()) return;
      if (
        verifiedIdentity?.userId !== expectedOwnerUserId
        || verifiedIdentity.coupleId !== expectedCoupleId
      ) {
        setTopicMessageSaveDialog((current) => (
          current?.sourceMessageId === dialog.sourceMessageId
            ? {
                ...current,
                saving: false,
                error: "계정이나 커플 연결이 바뀌어 결과를 표시하지 않았어요. 다시 확인해 주세요.",
              }
            : current
        ));
        return;
      }

      setTopicMessageSaveDialog(null);
      setTopicMessageSaveNotice({
        messageId: dialog.sourceMessageId,
        text: desiredState === "saved"
          ? `${selectedTopic.label} 준비에 저장했어요.`
          : `${selectedTopic.label} 준비에서 뺐어요. 대화 원문은 그대로 남아 있어요.`,
      });
      AccessibilityInfo.announceForAccessibility(
        desiredState === "saved"
          ? `${selectedTopic.label} 준비에 저장했어요.`
          : `${selectedTopic.label} 준비에서 뺐어요.`,
      );
    } catch (error: unknown) {
      if (!isCurrentContext()) return;
      setTopicMessageSaveDialog((current) => (
        current?.sourceMessageId === dialog.sourceMessageId
          ? {
              ...current,
              saving: false,
              error: error instanceof PreparationTopicMessageRefError
                && error.code === "stale_revision"
                ? "저장 상태가 방금 바뀌었어요. 최신 상태를 다시 확인한 뒤 한 번 더 눌러 주세요."
                : error instanceof PreparationTopicMessageRefError
                  && error.code === "timeout"
                  ? "확인이 오래 걸려 변경 결과를 표시하지 않았어요. 다시 누르면 최신 저장 상태부터 확인해요."
                : "준비 연결을 바꾸지 못했어요. 저장 상태를 다시 확인한 뒤 시도해 주세요.",
            }
          : current
      ));
    } finally {
      finishTopicMessageSaveOperation(operationId, operationController);
    }
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isAi = item.sender_type === "ai";
    const isMe = item.sender_type === userRole;
    const isResolvedTopicSource =
      resolvedTopicMessageFocus?.targetMessageId === item.id;
    const canSaveToPreparationTopic = isResolvedTopicSource
      || isPreparationTopicMessageSaveEligible(item, {
        coupleId: coupleId ?? "",
        viewerRole: userRole,
      });
    const isFocusedTopicOriginal = topicMessageFocusState?.status === "ready"
      && topicMessageFocusState.targetMessageId === item.id;
    const isPinnedSafetyCard = item.metadata?.pinned_safety_card === true;
    const isPartnerMsg = item.metadata?.target === "partner";
    const isBride = item.sender_type === "bride";
    const participantPresentation = (
      item.sender_type === "bride" || item.sender_type === "groom"
    ) && userRole
      ? getAmoraParticipantPresentation({
          memberModelVersion,
          senderType: item.sender_type,
          viewerRole: userRole,
          userName,
          partnerName,
        })
      : null;
    const {
      placeResults,
      receipts,
      quoteCheck,
      hasPlaceResults,
      isThinking,
      shouldRenderBubble,
    } = getMobileChatMessagePresentation(item, streaming);
    const mediationBlock = isAi
      ? normalizeMediationBlock(item.metadata?.mediation)
      : null;
    const pendingActionCandidate = getPendingAmoraAction(item);
    const pendingAction = pendingActionCandidate
      && !dismissedPendingActionIds.has(pendingActionCandidate.actionId)
      ? pendingActionCandidate
      : null;
    const pendingActionPresentation = pendingAction
      ? getFirstUsePendingActionPresentation({
          metadata: item.metadata,
          pendingAction,
        })
      : null;
    const firstUseActionDraft = selectPrivateActionDraftForBridge({
      activeScope,
      senderType: item.sender_type,
      isLatestPrivateAiMessage: item.id === latestPrivateAiMessageId,
      isAlreadyPromoted: item.id === promotedFirstUseMessageId,
      content: item.content,
      sourceRevision: item.metadata?.amora_wedding_context_revision,
      grounding: item.metadata?.amora_first_use_grounding,
      criterionDecisionId:
        item.metadata?.amora_couple_criterion_decision_id,
    });
    const scheduleCareActionDraft = activeScope === "private"
      && isAi
      && item.id === latestPrivateAiMessageId
      && !dismissedScheduleCareActionMessageIds.has(item.id)
      ? getScheduleCareFollowUpActionDraft(item.metadata)
      : null;
    const visibleBubbleContent = activeScope === "private" && isAi
      ? resolveFirstUseActionBubbleContent({
          content: item.content,
          groundedDraft: firstUseActionDraft,
        })
      : item.content;
    const shouldRenderPersonalizedNarrative = isThinking
      || Boolean(visibleBubbleContent?.trim());
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
              : pendingActionPresentation
                ? pendingActionPresentation.applyLabel
                : "이대로 적용";
    const applyAccessibilityLabel = pendingActionPresentation
      ? pendingActionPresentation.accessibilityLabel
      : requiresCoupleApproval
        ? matchingApproval?.status?.ready
          || matchingApproval?.status?.requiredCount === 1
          || (
            matchingApproval?.status?.accepted === false
            && (matchingApproval.status.acceptedCount ?? 0) > 0
          )
          ? "이 공동 변경을 확인하고 바로 반영"
          : "이 공동 변경을 확인"
        : "확인한 내용을 이대로 적용";
    const bubbleBg = isAi
      ? colors.surface
      : isMe
        ? colors.noir[800]
        : participantPresentation?.tone === "partner_neutral"
          ? colors.ivory[200]
          : isBride ? "#F5E6DF" : "#E8EDF5";
    const textColor = isMe ? "#FFF" : colors.noir[800];

    return (
      <View style={[st.msgRow, isMe && st.msgRowRight]}>
        {!isMe && (
          <View style={[
            st.avatar,
            isAi
              ? st.avatarAi
              : participantPresentation?.tone === "partner_neutral"
                ? st.avatarPartner
                : isBride ? st.avatarBride : st.avatarGroom,
          ]}>
            {isAi
              ? <Sparkles size={12} color={colors.gold.DEFAULT} />
              : <Text style={st.avatarLetter}>{participantPresentation?.avatarLabel}</Text>}
          </View>
        )}
        <View style={[
          st.messageBody,
          isPinnedSafetyCard && st.safetyMessageBody,
          (mediationBlock || pendingAction || firstUseActionDraft) && st.mediationMessageBody,
          scheduleCareActionDraft && st.mediationMessageBody,
          hasPlaceResults && st.placeMessageBody,
          receipts.length > 0 && st.toolReceiptMessageBody,
          isFocusedTopicOriginal && st.focusedTopicMessageBody,
        ]}>
          {!isMe && <Text style={st.senderLabel}>{isAi ? "아모라" : participantPresentation?.senderLabel ?? "파트너"}{isPartnerMsg ? " ♥" : ""}</Text>}
          {isFocusedTopicOriginal && (
            <Text style={st.focusedTopicMessageLabel} accessibilityLiveRegion="polite">
              저장한 원문
            </Text>
          )}
          {shouldRenderBubble && mediationBlock?.renderSafetyFallback !== true && (
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
            ) : shouldRenderPersonalizedNarrative ? (
              <View style={[st.bubble, { backgroundColor: bubbleBg }, !isMe && !isAi && { borderWidth: 1, borderColor: isBride ? "#E8C5B8" : "#C5CEE0" }, isAi && { borderWidth: 1, borderColor: colors.border }, isMe && st.bubbleRight, !isMe && st.bubbleLeft]}>
                {isThinking ? <ThinkingDots /> : <Text style={[st.bubbleText, { color: textColor }, isAi && { lineHeight: 24 }]}>{getQuoteAnalysisMessagePresentation(visibleBubbleContent ?? "").text}</Text>}
              </View>
            ) : null
          )}
          {placeResults.map((result, index) => (
            <PlaceCards key={`${result.toolName}-${index}`} result={result} />
          ))}
          {receipts.map((receipt, index) => (
            <MobileToolReceiptCard
              key={`${item.id}-${receipt.toolName}-${index}`}
              receipt={receipt}
              onOpenHome={(actionId) => {
                if (!userId || !coupleId) return;
                const actionReceiptHandoff = stageActionReceiptHomeHandoff({
                  handoffId: Crypto.randomUUID(),
                  ownerUserId: userId,
                  coupleId,
                  actionId,
                });
                if (!actionReceiptHandoff) return;
                router.push({
                  pathname: "/(tabs)/dashboard",
                  params: { actionReceiptHandoff },
                });
              }}
            />
          ))}
          {quoteCheck && (
            <MobileQuoteCheckCard
              message={quoteCheck.message}
              onOpenQuoteCheck={() => router.push("/quote-check")}
            />
          )}
          {firstUseActionDraft && (
            <AmoraFirstUseActionCard
              draft={firstUseActionDraft}
              skipped={skippedFirstUseMessageIds.has(item.id)}
              promotionStatus={
                firstUsePromotionUiState?.sourceMessageId === item.id
                  ? firstUsePromotionUiState.status
                  : null
              }
              disabled={
                streaming
                || pendingIngestReconciliation
                || !userId
                || !userRole
                || !coupleId
                || firstUsePromotionPendingMessageId === item.id
              }
              correctionDisabled={
                streaming
                || pendingIngestReconciliation
                || !userId
                || !userRole
                || !coupleId
                || Boolean(inputByLane.private_ai.trim())
              }
              onCorrect={() => handleCorrectFirstUseAction(item.id)}
              onRecovery={() => handleFirstUsePromotionRecovery(item.id)}
              onSkip={() => handleSkipFirstUseAction(item.id)}
              onRestore={() => handleRestoreFirstUseAction(item.id)}
              onContinue={() => {
                void handleContinueFirstUseAction(item.id);
              }}
            />
          )}
          {scheduleCareActionDraft && (
            <View style={st.scheduleCareActionCard} accessibilityLabel="어제 만남 뒤 다음 할 일 제안">
              <View style={st.pendingActionHeading}>
                <View
                  style={[st.pendingActionIcon, st.scheduleCareActionIcon]}
                  accessibilityElementsHidden
                >
                  <CheckCircle2 size={18} color={colors.sage[500]} />
                </View>
                <View style={st.pendingActionCopy}>
                  <Text style={st.pendingActionTitle}>둘이 이어서 할 한 가지</Text>
                  <Text style={st.pendingActionConfirmation}>{scheduleCareActionDraft.title}</Text>
                </View>
              </View>
              <Text style={st.scheduleCareActionReason}>{scheduleCareActionDraft.reason}</Text>
              <Text style={st.scheduleCareActionCriterion}>
                완료 기준 · {scheduleCareActionDraft.completionCriterion}
              </Text>
              <Text style={[st.pendingActionStatus, st.scheduleCareActionStatus]}>
                {reviewedActionContinuationPresentation.scopeCopy}{"\n"}
                {reviewedActionContinuationPresentation.promise}
              </Text>
              <View style={st.pendingActionControls}>
                <Pressable
                  style={({ pressed }) => [
                    st.pendingActionButton,
                    st.scheduleCareActionButton,
                    pressed && scheduleCareSharedDraftPendingMessageId !== item.id && { opacity: 0.82 },
                    (streaming || scheduleCareSharedDraftPendingMessageId !== null)
                      && st.pendingActionButtonDisabled,
                  ]}
                  onPress={() => void handleStageScheduleCareSharedDraft(item.id)}
                  disabled={streaming || scheduleCareSharedDraftPendingMessageId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={reviewedActionContinuationPresentation.accessibilityLabel}
                  accessibilityHint={reviewedActionContinuationPresentation.accessibilityHint}
                  accessibilityState={{
                    disabled: streaming || scheduleCareSharedDraftPendingMessageId !== null,
                  }}
                >
                  {scheduleCareSharedDraftPendingMessageId === item.id ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <ArrowRight size={16} color="#FFF" />
                  )}
                  <Text style={[st.pendingActionButtonText, st.scheduleCareActionButtonText]}>
                    {scheduleCareSharedDraftPendingMessageId === item.id
                      ? "연결 상태 확인 중…"
                      : reviewedActionContinuationPresentation.label}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [st.pendingActionDismiss, pressed && { opacity: 0.72 }]}
                  onPress={() => handleDismissScheduleCareAction(item.id)}
                  disabled={scheduleCareSharedDraftPendingMessageId === item.id}
                  accessibilityRole="button"
                  accessibilityLabel="어제 만남 뒤 다음 할 일 제안 지금은 넘어가기"
                  accessibilityState={{
                    disabled: scheduleCareSharedDraftPendingMessageId === item.id,
                  }}
                >
                  <X size={16} color={colors.noir.soft} />
                  <Text style={st.pendingActionDismissText}>지금은 넘어가기</Text>
                </Pressable>
              </View>
            </View>
          )}
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
                    {pendingActionPresentation?.stageLabel
                      ?? (requiresCoupleApproval
                      ? "두 분 확인이 필요한 변경이에요"
                      : "적용하기 전에 확인해 주세요")}
                  </Text>
                  {pendingActionPresentation && (
                    <Text style={st.firstUsePendingActionPrompt}>
                      {pendingActionPresentation.prompt}
                    </Text>
                  )}
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
                    pendingActionPresentation && st.firstUsePendingActionButton,
                    pressed && !pendingActionControlDisabled && { opacity: 0.82 },
                    pendingActionControlDisabled && st.pendingActionButtonDisabled,
                  ]}
                  onPress={() => handleApplyPendingAction(pendingAction.actionId)}
                  disabled={pendingActionControlDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={applyAccessibilityLabel}
                  accessibilityHint={pendingActionPresentation?.accessibilityHint}
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
          {isAi && canSaveToPreparationTopic && !streaming && !isThinking && (
            <Pressable
              style={({ pressed }) => [
                st.topicMessageSaveAction,
                pressed && st.topicMessageSaveActionPressed,
              ]}
              onPress={() => void handleOpenTopicMessageSaveDialog(item)}
              accessibilityRole="button"
              accessibilityLabel="이 아모라 답변을 준비에 저장"
              accessibilityHint="준비 항목을 직접 고르는 창을 엽니다"
            >
              <CheckCircle2 size={15} color={colors.sage[500]} />
              <Text style={st.topicMessageSaveActionText}>준비에 저장</Text>
            </Pressable>
          )}
          {topicMessageSaveNotice?.messageId === item.id && (
            <Text style={st.topicMessageSaveNotice} accessibilityLiveRegion="polite">
              {topicMessageSaveNotice.text}
            </Text>
          )}
        </View>
      </View>
    );
  }

  const isP = activeScope === "shared" && target === "partner";
  const stagedFirstUseSourceMessageId = activeScope === "shared"
    && target === "ai"
    && userId
    && coupleId
    ? resolveFirstUseSourceMessageIdForSend(
        firstUseComposerBindingRef.current,
        {
          ownerUserId: userId,
          coupleId,
          sharedText: inputByLane.shared_ai,
        },
      )
    : null;
  const confirmedFirstUseSourceMessageId = pendingSharedSendConfirmation
    ? resolveFirstUseSourceMessageIdForSend(
        firstUseComposerBindingRef.current,
        {
          ownerUserId: pendingSharedSendConfirmation.userId,
          coupleId: pendingSharedSendConfirmation.coupleId,
          sharedText: pendingSharedSendConfirmation.text,
        },
    )
    : null;
  const listenOnlyAvailable = !isP
    && target === "ai"
    && stagedFirstUseSourceMessageId === null
    && firstUseComposerBindingRef.current === null
    && scheduleCareFollowUpComposerBindingRef.current === null
    && preparationTopicChatComposerBindingRef.current === null
    && !hasActiveW5SafetyCard
    && !hasVisibleSharedMediationSafetyCard
    && !hasLocalPrivateMediationSafetyHold
    && !hasDevicePrivateMediationSafetyHold;
  const needsOnboarding = initialLoaded && userId !== null && coupleId === null;
  const topicMessageDialogSource = topicMessageSaveDialog
    ? messages.find((message) => message.id === topicMessageSaveDialog.sourceMessageId) ?? null
    : null;
  const selectedTopicMessageIsSaved =
    topicMessageSaveDialog?.selectedTopicReadState === "ready"
    && topicMessageSaveDialog.selectedTopicSavedState === "saved";

  if (initialLoadError) {
    return (
      <SafeAreaView style={st.container} edges={["top"]}>
        <View style={st.header}>
          <View style={st.headerLeft}>
            <View style={st.headerLogo}>
              <Sparkles size={16} color={colors.gold.DEFAULT} />
            </View>
            <View>
              <Text style={st.headerTitle}>아모라</Text>
              <Text style={st.headerSub}>AI 결혼 준비 동반자</Text>
            </View>
          </View>
        </View>
        <View style={st.setupGate} accessibilityLiveRegion="polite">
          <EmptyState
            icon={
              <IconBadge tone="noir" size={64}>
                <RotateCcw size={28} color={colors.gold.DEFAULT} />
              </IconBadge>
            }
            title="대화를 불러오지 못했어요"
            description={initialLoadError}
          />
          <Pressable
            style={({ pressed }) => [st.setupGateButton, pressed && { opacity: 0.78 }]}
            onPress={() => {
              setInitialLoadError(null);
              setInitialLoaded(false);
              setChatSessionRetryVersion((version) => version + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel="아모라 대화 다시 불러오기"
          >
            <RotateCcw size={17} color="#FFFFFF" />
            <Text style={st.setupGateButtonText}>다시 불러오기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (needsOnboarding) {
    return (
      <SafeAreaView style={st.container} edges={["top"]}>
        <View style={st.header}>
          <View style={st.headerLeft}>
            <View style={st.headerLogo}>
              <Sparkles size={16} color={colors.gold.DEFAULT} />
            </View>
            <View>
              <Text style={st.headerTitle}>아모라</Text>
              <Text style={st.headerSub}>AI 결혼 준비 동반자</Text>
            </View>
          </View>
        </View>
        <View style={st.setupGate}>
          <EmptyState
            icon={
              <IconBadge tone="noir" size={64}>
                <Sparkles size={28} color={colors.gold.DEFAULT} />
              </IconBadge>
            }
            title="먼저 기본 설정을 마쳐주세요"
            description="현재 계정의 준비 기록과 공개 범위를 안전하게 확인한 뒤 아모라와 대화를 시작할 수 있어요."
          />
          <Pressable
            style={({ pressed }) => [st.setupGateButton, pressed && { opacity: 0.78 }]}
            onPress={() => router.push("/onboarding")}
            accessibilityRole="button"
            accessibilityLabel="기본 설정 이어가기"
          >
            <Text style={st.setupGateButtonText}>설정 이어가기</Text>
            <ArrowRight size={17} color="#FFFFFF" />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <AmoraPersonalizationSheet
        visible={personalizationVisible}
        expectedOwnerUserId={userId}
        onClose={() => setPersonalizationVisible(false)}
      />
      <AmoraMediationConsentModal
        visible={mediationRequestOwner !== null
          && mediationRequestOwner.privateSafetyEpoch === localPrivateMediationSafetyEpoch
          && !hasVisibleSharedMediationSafetyCard
          && !hasLocalPrivateMediationSafetyHold
          && !hasDevicePrivateMediationSafetyHold}
        pending={mediationRequestPending}
        error={mediationRequestError}
        onCancel={() => {
          if (mediationRequestPending) return;
          setMediationRequestOwner(null);
          setMediationRequestError(null);
        }}
        onConfirm={handleConfirmMediationRequest}
      />
      <Modal
        visible={topicMessageSaveDialog !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeTopicMessageSaveDialog}
      >
        <SafeAreaView
          style={st.topicMessageSaveModal}
          edges={["top", "bottom"]}
          accessibilityViewIsModal
        >
          <View style={st.topicMessageSaveHeader}>
            <AppText variant="subtitle">준비에 저장</AppText>
            <Pressable
              style={({ pressed }) => [
                st.topicMessageSaveClose,
                pressed && { opacity: 0.62 },
              ]}
              onPress={closeTopicMessageSaveDialog}
              accessibilityRole="button"
              accessibilityLabel="준비에 저장 닫기"
            >
              <X size={20} color={colors.noir[800]} />
            </Pressable>
          </View>
          <View style={st.topicMessageSaveScope}>
            <AppText variant="bodyStrong">어느 준비에서 다시 볼까요?</AppText>
            <AppText variant="caption" style={st.topicMessageSaveScopeCopy}>
              {topicMessageSaveDialog?.audience === "couple_shared"
                ? "두 분 모두 볼 수 있어요. 함께 대화의 답변을 고른 준비 항목에서 다시 찾을 수 있어요."
                : "상대방에게 보이지 않아요. 나만 상담의 답변은 나만 고른 준비 항목에서 볼 수 있어요."}
            </AppText>
          </View>
          <ScrollView
            style={st.topicMessageSaveScroll}
            contentContainerStyle={st.topicMessageSaveList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {topicMessageSaveDialog?.loading ? (
              <View style={st.topicMessageSaveLoading} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.rose[500]} />
                <AppText variant="body">저장 상태를 확인하는 중이에요</AppText>
              </View>
            ) : null}
            {topicMessageSaveDialog?.error ? (
              <Text
                style={st.topicMessageSaveError}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {topicMessageSaveDialog.error}
              </Text>
            ) : null}
            {topicMessageSaveDialog
              && !topicMessageSaveDialog.loading
              && !topicMessageSaveDialog.collectionLoaded
              && topicMessageDialogSource ? (
                <Pressable
                  style={({ pressed }) => [
                    st.topicMessageSaveRetry,
                    pressed && { opacity: 0.72 },
                  ]}
                  onPress={() => void handleOpenTopicMessageSaveDialog(topicMessageDialogSource)}
                  accessibilityRole="button"
                  accessibilityLabel="준비 저장 상태 다시 불러오기"
                >
                  <RotateCcw size={16} color={colors.noir[800]} />
                  <Text style={st.topicMessageSaveRetryText}>다시 불러오기</Text>
                </Pressable>
            ) : null}
            {topicMessageSaveDialog?.collectionLoaded ? PREPARATION_TOPIC_OPTIONS.map((topic) => {
              const selected = topicMessageSaveDialog.selectedTopicKey === topic.key;
              const savedInCollection = topicMessageSaveDialog.references.some((reference) => (
                reference.messageId === topicMessageSaveDialog.sourceMessageId
                && reference.topicKey === topic.key
              ));
              const checkingExactState = selected
                && topicMessageSaveDialog.selectedTopicReadState === "loading";
              const saved = selected
                && topicMessageSaveDialog.selectedTopicReadState === "ready"
                ? topicMessageSaveDialog.selectedTopicSavedState === "saved"
                : savedInCollection;
              return (
                <Pressable
                  key={topic.key}
                  style={({ pressed }) => [
                    st.topicMessageSaveOption,
                    selected && st.topicMessageSaveOptionSelected,
                    pressed && { opacity: 0.76 },
                  ]}
                  onPress={() => void handleSelectTopicMessageSaveTopic(topic.key)}
                  disabled={topicMessageSaveDialog.saving}
                  accessibilityRole="radio"
                  accessibilityLabel={`${topic.label}${checkingExactState ? ", 저장 상태 확인 중" : saved ? ", 이미 저장됨" : ""}`}
                  accessibilityState={{
                    checked: selected,
                    disabled: topicMessageSaveDialog.saving,
                    busy: checkingExactState,
                  }}
                >
                  <View style={[
                    st.topicMessageSaveRadio,
                    selected && st.topicMessageSaveRadioSelected,
                  ]} accessibilityElementsHidden>
                    {selected ? <View style={st.topicMessageSaveRadioDot} /> : null}
                  </View>
                  <Text style={st.topicMessageSaveOptionLabel}>{topic.label}</Text>
                  {checkingExactState ? (
                    <ActivityIndicator size="small" color={colors.rose[500]} />
                  ) : saved ? (
                    <Text style={st.topicMessageSavedMark}>저장됨</Text>
                  ) : null}
                </Pressable>
              );
            }) : null}
            {topicMessageSaveDialog?.partial ? (
              <Text style={st.topicMessageSavePartial} accessibilityLiveRegion="polite">
                일부 오래된 저장 기록을 확인하지 못했어요. 변경 전 최신 상태를 다시 확인해요.
              </Text>
            ) : null}
          </ScrollView>
          <View style={st.topicMessageSaveFooter}>
            {selectedTopicMessageIsSaved ? (
              <Text style={st.topicMessageSaveRemovalCopy} accessibilityLiveRegion="polite">
                {topicMessageSaveDialog?.audience === "couple_shared"
                  ? "이 준비에서 빼면 두 분 모두 이 준비 항목의 대화 링크를 볼 수 없어요. 원래 함께 대화는 그대로 남아요."
                  : "이 준비에서 빼도 원래 나만 상담 대화는 그대로 남아요."}
              </Text>
            ) : null}
            <PrimaryButton
              style={st.topicMessageSavePrimary}
              onPress={() => void handleConfirmTopicMessageSave()}
              disabled={
                !topicMessageSaveDialog?.collectionLoaded
                || !topicMessageSaveDialog.selectedTopicKey
                || topicMessageSaveDialog.selectedTopicReadState !== "ready"
                || topicMessageSaveDialog.saving
              }
              accessibilityLabel={selectedTopicMessageIsSaved
                ? "선택한 준비에서 이 대화 링크 빼기"
                : "선택한 준비에 이 대화 저장"}
            >
              {topicMessageSaveDialog?.saving
                ? "최신 상태 확인 중…"
                : topicMessageSaveDialog?.selectedTopicReadState === "loading"
                  ? "저장 상태 확인 중…"
                : selectedTopicMessageIsSaved
                  ? "이 준비에서 빼기"
                  : "선택한 준비에 저장"}
            </PrimaryButton>
          </View>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={pendingSharedSendConfirmation !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!pendingSharedSendConfirmation?.saving) {
            setPendingSharedSendConfirmation(null);
          }
        }}
      >
        <View
          style={st.sharedConfirmOverlay}
          accessibilityViewIsModal
          accessibilityLabel="첫 함께 대화 전송 확인"
          importantForAccessibility="yes"
        >
          <View style={st.sharedConfirmSheet}>
            <View style={st.sharedConfirmIcon}>
              <Users size={18} color={colors.rose[600]} />
            </View>
            <Text style={st.sharedConfirmTitle}>함께 대화로 보낼까요?</Text>
            <Text style={st.sharedConfirmBody}>
              {hasLinkedPartner
                ? "지금 함께 대화에 저장되며, 연결된 파트너가 이 내용을 볼 수 있어요."
                : "지금 함께 대화에 저장되며, 파트너가 연결되면 이 내용을 볼 수 있어요."}
            </Text>
            {confirmedFirstUseSourceMessageId && (
              <Text style={st.sharedConfirmPurpose}>
                {firstUseSharedDraftPresentation.sendConfirmationCopy}
              </Text>
            )}
            <Text style={st.sharedConfirmHint}>
              이 기기에서는 같은 커플의 함께 대화에 대해 다음부터 다시 묻지 않아요.
            </Text>
            {pendingSharedSendConfirmation?.error && (
              <Text
                style={st.sharedConfirmError}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {pendingSharedSendConfirmation.error}
              </Text>
            )}
            <Pressable
              style={({ pressed }) => [
                st.sharedConfirmPrimary,
                pressed && !pendingSharedSendConfirmation?.saving && { opacity: 0.8 },
              ]}
              onPress={() => void handleConfirmSharedSend()}
              disabled={pendingSharedSendConfirmation?.saving}
              accessibilityRole="button"
              accessibilityLabel="함께 대화로 보내기"
              accessibilityState={{ disabled: pendingSharedSendConfirmation?.saving === true }}
            >
              {pendingSharedSendConfirmation?.saving && (
                <ActivityIndicator size="small" color="#FFF" />
              )}
              <Text style={st.sharedConfirmPrimaryText}>함께 대화로 보내기</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                st.sharedConfirmSecondary,
                pressed && !pendingSharedSendConfirmation?.saving && { opacity: 0.72 },
              ]}
              onPress={handleMoveSharedSendToPrivate}
              disabled={pendingSharedSendConfirmation?.saving}
              accessibilityRole="button"
              accessibilityLabel="나만 상담으로 바꾸기"
              accessibilityState={{ disabled: pendingSharedSendConfirmation?.saving === true }}
            >
              <Lock size={15} color="#5a6147" />
              <Text style={st.sharedConfirmSecondaryText}>나만 상담으로 바꾸기</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                st.sharedConfirmCancel,
                pressed && !pendingSharedSendConfirmation?.saving && { opacity: 0.62 },
              ]}
              onPress={() => setPendingSharedSendConfirmation(null)}
              disabled={pendingSharedSendConfirmation?.saving}
              accessibilityRole="button"
              accessibilityLabel="함께 대화 전송 취소"
              accessibilityState={{ disabled: pendingSharedSendConfirmation?.saving === true }}
            >
              <Text style={st.sharedConfirmCancelText}>취소</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <View style={st.header}>
        <View style={st.headerLeft}>
          <View style={st.headerLogo}>
            <Sparkles size={16} color={colors.gold.DEFAULT} />
          </View>
          <View style={st.headerBrandText}>
            <Text style={st.headerTitle} numberOfLines={1}>아모라</Text>
            <Text style={st.headerSub} numberOfLines={1}>AI 결혼 준비 동반자</Text>
          </View>
        </View>
        <View style={st.headerActions}>
          <Pressable
            style={({ pressed }) => [st.headerNotes, pressed && { opacity: 0.7 }]}
            onPress={() => router.push("/amora-notes" as never)}
            accessibilityRole="button"
            accessibilityLabel="우리 준비 노트 열기"
          >
            <Text style={st.headerNotesText}>준비 노트</Text>
          </Pressable>
          {!isP && userId && initialLoaded ? (
            <Pressable
              style={({ pressed }) => [st.headerPersonalize, pressed && { opacity: 0.7 }]}
              onPress={() => setPersonalizationVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="아모라 도움 방식 다시 맞추기"
            >
              <SlidersHorizontal size={18} color={colors.noir[800]} />
            </Pressable>
          ) : null}
          {scopedMessages.length > 0 && <StatusPill label={`${scopedMessages.length}`} tone="neutral" />}
        </View>
      </View>

      <View style={st.scopeSection} accessibilityLabel="상담 공개 범위">
        <View style={st.scopeRow}>
          <Pressable
            disabled={streaming || pendingIngestReconciliation}
            accessibilityRole="tab"
            accessibilityLabel={hasLinkedPartner
              ? "함께 대화, 저장되며 연결된 파트너에게 보임"
              : "함께 대화, 저장되며 파트너 연결 시 보임"}
            accessibilityState={{
              selected: activeScope === "shared",
              disabled: streaming || pendingIngestReconciliation,
            }}
            style={[st.scopeBtn, activeScope === "shared" && st.scopeBtnActive]}
            onPress={() => handleScopeChange("shared")}
          >
            <Sparkles size={14} color={activeScope === "shared" ? colors.rose[500] : colors.textTertiary} />
            <Text style={[st.scopeText, activeScope === "shared" && st.scopeTextActive]}>함께 대화</Text>
          </Pressable>
          <Pressable
            disabled={streaming || pendingIngestReconciliation || userRole === null}
            accessibilityRole="tab"
            accessibilityLabel="나만 상담, 서비스에 저장되며 상대방에게 보이지 않음"
            accessibilityState={{
              selected: activeScope === "private",
              disabled: streaming || pendingIngestReconciliation || userRole === null,
            }}
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
              ? "현재 범위 · 함께 대화 — 지금 저장되며, 연결된 파트너에게 보여요"
              : "현재 범위 · 함께 대화 — 지금 저장되며, 파트너가 연결되면 볼 수 있어요"}
        </Text>
      </View>

      {activeScope === "shared" && (
        <>
          <View style={st.targetRow}>
            <Pressable
              disabled={streaming || pendingIngestReconciliation}
              accessibilityRole="tab"
              accessibilityLabel="AI 결혼 준비 동반자 아모라와 대화"
              accessibilityState={{
                selected: !isP,
                disabled: streaming || pendingIngestReconciliation,
              }}
              style={[st.targetBtn, !isP && st.targetActive]}
              onPress={() => handleTargetChange("ai")}
            >
              <Sparkles size={14} color={!isP ? colors.gold.DEFAULT : colors.textTertiary} />
              <Text style={[st.targetText, !isP && st.targetTextActive]}>아모라</Text>
            </Pressable>
            {hasLinkedPartner && (
              <Pressable
                disabled={streaming || pendingIngestReconciliation}
                accessibilityRole="tab"
                accessibilityLabel={`${partnerName ?? "파트너"}와 대화`}
                accessibilityState={{
                  selected: isP,
                  disabled: streaming || pendingIngestReconciliation,
                }}
                style={[st.targetBtn, isP && st.targetPartner]}
                onPress={() => handleTargetChange("partner")}
              >
                <Heart size={14} color={isP ? colors.rose[500] : colors.textTertiary} />
                <Text style={[st.targetText, isP && st.targetTextPartner]}>{partnerName ?? "파트너"}</Text>
              </Pressable>
            )}
          </View>
          {hasLinkedPartner && !hasActiveW5SafetyCard && !hasVisibleSharedMediationSafetyCard && !hasLocalPrivateMediationSafetyHold && !hasDevicePrivateMediationSafetyHold && (
            <View style={st.mediationEntryRow}>
              <Pressable
                style={({ pressed }) => [
                  st.mediationEntryButton,
                  pressed && !streaming && { opacity: 0.76 },
                ]}
                onPress={() => handleOpenMediationRequest("manual")}
                disabled={streaming || pendingIngestReconciliation}
                accessibilityRole="button"
                accessibilityLabel="아모라에게 커플 조율 초안 요청"
                accessibilityState={{ disabled: streaming || pendingIngestReconciliation }}
              >
                <Users size={14} color={colors.noir.soft} />
                <Text style={st.mediationEntryText}>의견이 엇갈렸다면 조율 도움 받기</Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {!initialLoaded ? (
          <View style={st.loading}>
            <ActivityIndicator color={colors.rose[500]} />
            <Text style={st.loadingText}>대화를 준비하는 중이에요</Text>
          </View>
        ) : scopedMessages.length === 0 ? (
          <ScrollView
            style={st.emptyScroll}
            contentContainerStyle={st.empty}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
            {!isP ? (
              <AmoraStarterCard
                activeScope={activeScope}
                hasLinkedPartner={hasLinkedPartner}
                disabled={streaming || pendingIngestReconciliation}
                onSelect={handleAiSuggestion}
                onPersonalize={() => setPersonalizationVisible(true)}
              />
            ) : null}
          </ScrollView>
        ) : (
          <FlatList
            ref={flatListRef}
            data={visibleMessages}
            extraData={`${topicMessageFocusState?.status ?? "idle"}:${resolvedTopicMessageFocus?.targetMessageId ?? "none"}:${topicMessageSaveNotice?.messageId ?? "none"}`}
            inverted
            keyExtractor={(message) => message.id}
            renderItem={renderMessage}
            contentContainerStyle={st.messageList}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={Platform.OS === "android"}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={12}
            onViewableItemsChanged={topicMessageViewabilityHandlerRef.current}
            viewabilityConfig={topicMessageViewabilityConfigRef.current}
            onScrollToIndexFailed={(info) => {
              if (topicMessageFocusState?.status !== "ready") return;
              topicMessageFocusScrollAttemptsRef.current += 1;
              if (topicMessageFocusScrollAttemptsRef.current > 2) {
                topicMessageFocusTargetRef.current = null;
                setTopicMessageFocusState({
                  status: "error",
                  refId: topicMessageFocusState.refId,
                  message: "저장한 대화 원문 위치를 찾지 못했어요. 다시 불러와 주세요.",
                  canRetry: true,
                });
                return;
              }
              const sessionGeneration = chatSessionGenerationRef.current.current();
              flatListRef.current?.scrollToOffset({
                offset: Math.max(0, info.averageItemLength * info.index),
                animated: false,
              });
              setTimeout(() => {
                if (!isCurrentChatSession(sessionGeneration)) return;
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.5,
                });
              }, 160);
            }}
          />
        )}

        {activeScope === "shared" && hasLinkedPartner && !hasVisibleSharedMediationSafetyCard && !hasLocalPrivateMediationSafetyHold && !hasDevicePrivateMediationSafetyHold && shouldShowMediationOffer && mediationOffer.offerKey && (
          <View style={st.mediationOffer} accessibilityLiveRegion="polite">
            <View style={st.mediationOfferHeading}>
              <View style={st.mediationOfferIcon} accessibilityElementsHidden>
                <Users size={16} color={colors.noir.soft} />
              </View>
              <View style={st.mediationOfferCopy}>
                <Text style={st.mediationOfferTitle}>대화 정리가 필요할까요?</Text>
                <Text style={st.mediationOfferBody}>
                  원한다면 한쪽 편을 들지 않는 조율 초안을 만들 수 있어요. 두 분이 모두 확인해야 공동 결정으로 남아요.
                </Text>
              </View>
              <Pressable
                style={st.mediationOfferDismiss}
                onPress={handleDismissMediationOffer}
                accessibilityRole="button"
                accessibilityLabel="이번 조율 도움 제안 닫기"
              >
                <X size={17} color={colors.textTertiary} />
              </Pressable>
            </View>
            <Pressable
              style={({ pressed }) => [st.mediationOfferAction, pressed && { opacity: 0.8 }]}
              onPress={() => handleOpenMediationRequest(mediationOffer.offerKey)}
              disabled={streaming || pendingIngestReconciliation}
              accessibilityRole="button"
              accessibilityLabel="아모라에게 이번 대화 조율 초안 요청"
              accessibilityState={{ disabled: streaming || pendingIngestReconciliation }}
            >
              <Sparkles size={15} color="#FFFFFF" />
              <Text style={st.mediationOfferActionText}>조율 도움 받기</Text>
            </Pressable>
          </View>
        )}

        {!hasActiveW5SafetyCard && quotaRemaining !== null && !streaming && (
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

        {topicMessageFocusState?.status === "loading" && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText}>저장한 대화 원문을 불러오는 중이에요.</Text>
            <ActivityIndicator size="small" color={colors.rose[500]} />
          </View>
        )}

        {topicMessageFocusState?.status === "error" && (
          <View style={st.failureBar} accessibilityLiveRegion="assertive">
            <Text style={st.failureText} accessibilityRole="alert">
              {topicMessageFocusState.message}
            </Text>
            {topicMessageFocusState.canRetry && (
              <Pressable
                style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
                onPress={() => {
                  consumedTopicMessageFocusRef.current = null;
                  setTopicMessageFocusState({
                    status: "loading",
                    refId: topicMessageFocusState.refId,
                  });
                  setTopicMessageFocusRetryVersion((version) => version + 1);
                }}
                accessibilityRole="button"
                accessibilityLabel="저장한 대화 원문 다시 불러오기"
              >
                <Text style={st.retryText}>원문 다시 불러오기</Text>
              </Pressable>
            )}
          </View>
        )}

        {preparationTopicReturnReceipt && activeScope === "private" && (
          <View style={st.preparationTopicReturn}>
            <ActionRow
              title="이 준비 주제로 돌아가기"
              description={`${preparationTopicReturnReceipt.preparationTopic.topicLabel} 화면에서 다음 행동을 이어가요. 이번 상담만으로 준비 기록은 바뀌지 않았어요.`}
              onPress={handlePreparationTopicReturn}
              disabled={streaming}
            />
          </View>
        )}

        {preparationTopicHandoffNotice && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {preparationTopicHandoffNotice === "composer_occupied"
                ? "나만 상담에 작성 중인 내용이 있어 준비 주제 질문을 덮어쓰지 않았어요. 먼저 보내거나 비운 뒤 준비 화면에서 다시 눌러 주세요."
                : "질문을 수정해 일반 나만 상담으로 이어가요. 답변 뒤에는 원래 준비 주제 복귀 버튼을 표시하지 않아요."}
            </Text>
          </View>
        )}

        {stagedFirstUseSourceMessageId && (
          <View
            style={st.firstUseComposerStage}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`${firstUseSharedDraftPresentation.accessibilityLabel}. ${firstUseSharedDraftPresentation.copy}`}
          >
            <Text style={st.firstUseComposerStageLabel}>
              {firstUseSharedDraftPresentation.stageLabel}
            </Text>
            <Text style={st.firstUseComposerStageCopy}>
              {firstUseSharedDraftPresentation.copy}
            </Text>
          </View>
        )}

        {firstUseComposerNotice && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {firstUseComposerNotice === "composer_occupied"
                ? firstUseSharedDraftPresentation.composerOccupiedCopy
                : firstUseComposerNotice === "private_composer_occupied"
                  ? firstUseSharedDraftPresentation.privateComposerOccupiedCopy
                : firstUseSharedDraftPresentation.draftChangedCopy}
            </Text>
            <Pressable
              style={({ pressed }) => [
                st.firstUseComposerNoticeAction,
                pressed && { opacity: 0.72 },
              ]}
              onPress={handleFirstUseComposerNoticeAction}
              accessibilityRole="button"
              accessibilityLabel={firstUseComposerNotice === "composer_occupied"
                ? firstUseSharedDraftPresentation.composerOccupiedActionLabel
                : firstUseComposerNotice === "private_composer_occupied"
                  ? firstUseSharedDraftPresentation.privateComposerOccupiedActionLabel
                : firstUseSharedDraftPresentation.draftChangedActionLabel}
              accessibilityHint={firstUseComposerNotice === "composer_occupied"
                ? "같은 화면의 함께 대화 입력란으로 이동하며 자동으로 보내거나 저장하지 않습니다"
                : firstUseComposerNotice === "private_composer_occupied"
                  ? "나만 상담의 작성 중 초안을 열며 어느 초안도 지우거나 덮어쓰지 않습니다"
                  : "현재 세 항목을 나만 상담 입력란으로 옮기고 함께 대화 초안을 비우며 자동으로 보내거나 저장하지 않습니다"}
            >
              <Text style={st.retryText}>
                {firstUseComposerNotice === "composer_occupied"
                  ? firstUseSharedDraftPresentation.composerOccupiedActionLabel
                  : firstUseComposerNotice === "private_composer_occupied"
                    ? firstUseSharedDraftPresentation.privateComposerOccupiedActionLabel
                  : firstUseSharedDraftPresentation.draftChangedActionLabel}
              </Text>
            </Pressable>
          </View>
        )}

        {scheduleCareFollowUpEntryStatus && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {SCHEDULE_CARE_FOLLOW_UP_STATUS_COPY[scheduleCareFollowUpEntryStatus]}
            </Text>
            {scheduleCareFollowUpEntryStatus === "checking" ? (
              <ActivityIndicator size="small" color={colors.rose[500]} />
            ) : (
              <Pressable
                style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
                onPress={() => {
                  if (
                    (scheduleCareFollowUpEntryStatus === "timeout"
                      || scheduleCareFollowUpEntryStatus === "unavailable")
                    && scheduleCareRouteBinding
                  ) {
                    setScheduleCareFollowUpEntryStatus(null);
                    setScheduleCareFollowUpRetryVersion((version) => version + 1);
                    return;
                  }
                  if (
                    scheduleCareFollowUpEntryStatus === "answer_required"
                    || scheduleCareFollowUpEntryStatus === "answer_invalid"
                  ) {
                    setScheduleCareFollowUpEntryStatus(null);
                    requestAnimationFrame(() => chatInputRef.current?.focus());
                    return;
                  }
                  if (scheduleCareFollowUpEntryStatus === "composer_occupied") {
                    setScheduleCareFollowUpEntryStatus(null);
                    setActiveScope("private");
                    setTarget("ai");
                    setScheduleCareFollowUpRetryVersion((version) => version + 1);
                    requestAnimationFrame(() => chatInputRef.current?.focus());
                    return;
                  }
                  if (scheduleCareFollowUpEntryStatus === "draft_changed") {
                    setScheduleCareFollowUpEntryStatus(null);
                    return;
                  }
                  if (scheduleCareFollowUpEntryStatus === "identity_changed") {
                    setScheduleCareFollowUpEntryStatus(null);
                    setChatSessionRetryVersion((version) => version + 1);
                    return;
                  }
                  if (
                    scheduleCareFollowUpEntryStatus === "stale"
                    || !scheduleCareRouteBinding
                  ) {
                    router.push("/(tabs)/dashboard");
                    return;
                  }
                  setScheduleCareFollowUpEntryStatus(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  scheduleCareFollowUpEntryStatus === "composer_occupied"
                    ? "작성 중 초안 확인 · 비운 뒤 다시 열기"
                    : "어제 가족 만남 뒤 이어가기 복구"
                }
              >
                <Text style={st.retryText}>
                  {scheduleCareFollowUpEntryStatus === "timeout"
                  || scheduleCareFollowUpEntryStatus === "unavailable"
                    ? scheduleCareRouteBinding ? "다시 확인" : "홈에서 다시 시작"
                    : scheduleCareFollowUpEntryStatus === "answer_required"
                      || scheduleCareFollowUpEntryStatus === "answer_invalid"
                      ? "답 이어 쓰기"
                    : scheduleCareFollowUpEntryStatus === "composer_occupied"
                      ? "작성 중 초안 확인 · 비운 뒤 다시 열기"
                    : scheduleCareFollowUpEntryStatus === "draft_changed"
                      ? "일반 나만 상담으로 계속"
                    : scheduleCareFollowUpEntryStatus === "identity_changed"
                      ? "다시 불러오기"
                      : scheduleCareFollowUpEntryStatus === "stale"
                        ? "홈에서 최신 내용 보기"
                        : "확인"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {scheduleCareActionNotice && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {scheduleCareActionNotice}
            </Text>
            <Pressable
              style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
              onPress={() => setScheduleCareActionNotice(null)}
              accessibilityRole="button"
              accessibilityLabel="어제 만남 뒤 초안 안내 확인"
            >
              <Text style={st.retryText}>확인</Text>
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
                  ? "이 질문은 첨부파일이 있어 모바일에서 이어받을 수 없어요. 웹에서 첨부파일을 다시 선택해 새 메시지로 보내 주세요."
                  : "첨부 상태를 확인할 수 없어 모바일에서 이어받지 않았어요. 웹에서 첨부파일을 다시 선택해 새 메시지로 보내 주세요."
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

        {!hasActiveW5SafetyCard && activeSendFailure
          && !(hasMediationSafetyFence && activeSendFailureIsMediation)
          && (
          <View style={st.failureBar} accessibilityLiveRegion="polite">
            <Text style={st.failureText} accessibilityRole="alert">
              {activeSendFailure.message}
            </Text>
            {activeSendFailure.unavailableReason && (
              <Text style={st.failureText}>{activeSendFailure.unavailableReason}</Text>
            )}
            {activeScheduleCareSendRecovery ? (
              <Pressable
                style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
                onPress={handleScheduleCareSendRecovery}
                disabled={streaming}
                accessibilityRole="button"
                accessibilityLabel={activeScheduleCareSendRecovery.actionLabel}
                accessibilityHint={
                  activeScheduleCareSendRecovery.action === "restart_from_home"
                    ? "자동으로 보내거나 저장하지 않고 홈의 최신 가족 만남 질문으로 돌아갑니다"
                    : "같은 전송 식별 정보로 나만 상담 답의 저장 여부를 먼저 확인합니다"
                }
                accessibilityState={{ disabled: streaming }}
              >
                <Text style={st.retryText}>{activeScheduleCareSendRecovery.actionLabel}</Text>
              </Pressable>
            ) : activeFirstUseSendRecovery ? (
              <Pressable
                style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
                onPress={handleRegenerateFirstUseAction}
                disabled={streaming}
                accessibilityRole="button"
                accessibilityLabel="나만 상담에서 첫 실행 제안 다시 만들기"
                accessibilityHint="자동으로 보내거나 저장하지 않고 개인 상담의 확인 카드로 돌아갑니다"
                accessibilityState={{ disabled: streaming }}
              >
                <Text style={st.retryText}>{activeFirstUseSendRecovery.actionLabel}</Text>
              </Pressable>
            ) : activeSendFailure.canRetry && (
              <Pressable
                style={({ pressed }) => [st.retryBtn, pressed && { opacity: 0.72 }]}
                onPress={handleRetry}
                disabled={streaming}
                accessibilityRole="button"
                accessibilityLabel={
                  activeSendFailure.requiresReconciliation
                    ? "중단된 전송의 저장 여부를 확인하고 이어가기"
                    : isConfirmedActionRecovery
                    ? "확인한 변경 반영 계속하기"
                    : activeSendFailure.kind === "ai_response"
                      ? "아모라 답변 다시 받기"
                      : "메시지 다시 보내기"
                }
              >
                <Text style={st.retryText}>
                  {activeSendFailure.requiresReconciliation
                    ? "저장 여부를 확인하고 이어가기"
                    : isConfirmedActionRecovery
                    ? "반영 계속하기"
                    : activeSendFailure.kind === "ai_response"
                      ? "답변 다시 받기"
                      : "다시 보내기"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {listenOnlyAvailable && (
          <View style={st.listenOnlyBar}>
            <Pressable
              style={({ pressed }) => [
                st.listenOnlyButton,
                listenOnlySelected && st.listenOnlyButtonSelected,
                pressed && { opacity: 0.76 },
              ]}
              onPress={() => setListenOnlySelected((selected) => !selected)}
              disabled={streaming || pendingIngestReconciliation}
              accessibilityRole="checkbox"
              accessibilityLabel="그냥 들어줘"
              accessibilityHint="이번 한 번만 해결책이나 준비 기록 제안 없이 아모라가 이야기를 듣습니다"
              accessibilityState={{
                checked: listenOnlySelected,
                disabled: streaming || pendingIngestReconciliation,
              }}
            >
              <View style={[
                st.listenOnlyCheck,
                listenOnlySelected && st.listenOnlyCheckSelected,
              ]}>
                {listenOnlySelected && <Check size={12} color="#FFFFFF" />}
              </View>
              <Text style={st.listenOnlyLabel}>그냥 들어줘</Text>
            </Pressable>
            {listenOnlySelected && (
              <Text style={st.listenOnlyCopy} accessibilityLiveRegion="polite">
                대화는 현재 공개 범위에 저장돼요. 준비 기록·아모라 기억은 바꾸지 않아요.
              </Text>
            )}
          </View>
        )}

        <View style={[st.inputBar, isP && { borderTopColor: colors.rose.light }]}>
          <TextInput ref={chatInputRef} style={st.input} value={input} onChangeText={handleInputChange} placeholder={isP ? `${partnerName ?? "파트너"}에게 메시지...` : activeScope === "private" ? "나만의 상담을 입력하세요..." : "메시지를 입력하세요..."} placeholderTextColor={colors.taupe[400]} multiline maxLength={4000} editable={!streaming && !pendingIngestReconciliation} returnKeyType="send" accessibilityLabel="메시지 입력" />
          <Animated.View style={{ transform: [{ scale: sendBtnScale }] }}>
            {streaming ? (
              <Pressable
                style={({ pressed }) => [st.stopBtn, pressed && { opacity: 0.78 }]}
                onPress={handleStop}
                accessibilityLabel="현재 메시지 전송 중단"
                accessibilityRole="button"
              >
                <Square size={12} color="#FFF" fill="#FFF" />
                <Text style={st.stopBtnText}>중단</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[
                  st.sendBtn,
                  stagedFirstUseSourceMessageId && st.firstUseComposerSendButton,
                  isP && { backgroundColor: colors.rose[500] },
                  (!input.trim() || pendingIngestReconciliation) && st.sendBtnOff,
                ]}
                onPress={handleSend}
                onPressIn={pressIn}
                onPressOut={pressOut}
                disabled={!input.trim() || pendingIngestReconciliation}
                accessibilityLabel={stagedFirstUseSourceMessageId
                  ? "2단계 함께 볼 초안 보내기"
                  : "메시지 보내기"}
                accessibilityHint={stagedFirstUseSourceMessageId
                  ? "첫 함께 대화 확인을 거쳐 저장하며 준비 기록에는 아직 반영하지 않습니다"
                  : undefined}
                accessibilityRole="button"
              >
                {isP ? <Heart size={18} color="#FFF" /> : <Send size={18} color="#FFF" />}
              </Pressable>
            )}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  preparationTopicReturn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  topicMessageSaveModal: { flex: 1, backgroundColor: colors.bg },
  topicMessageSaveHeader: { minHeight: 60, paddingLeft: spacing[5], paddingRight: spacing[2], flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  topicMessageSaveClose: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  topicMessageSaveScope: { paddingHorizontal: spacing[5], paddingTop: spacing[4], paddingBottom: spacing[3], backgroundColor: colors.surface },
  topicMessageSaveScopeCopy: { marginTop: spacing[1], color: colors.textSecondary },
  topicMessageSaveScroll: { flex: 1 },
  topicMessageSaveList: { paddingHorizontal: spacing[5], paddingTop: spacing[3], paddingBottom: spacing[5], gap: spacing[2] },
  topicMessageSaveLoading: { minHeight: 120, alignItems: "center", justifyContent: "center", gap: spacing[2] },
  topicMessageSaveError: { padding: spacing[3], borderRadius: radius.lg, fontSize: 13, lineHeight: 20, color: colors.danger, backgroundColor: colors.rose.glow },
  topicMessageSaveRetry: { minHeight: 48, paddingHorizontal: spacing[4], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  topicMessageSaveRetryText: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  topicMessageSaveOption: { minHeight: 48, paddingHorizontal: spacing[3], paddingVertical: spacing[2], flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  topicMessageSaveOptionSelected: { borderColor: colors.rose[500], backgroundColor: colors.rose.glow },
  topicMessageSaveRadio: { width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.taupe[400], backgroundColor: colors.surface },
  topicMessageSaveRadioSelected: { borderColor: colors.rose[500] },
  topicMessageSaveRadioDot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.rose[500] },
  topicMessageSaveOptionLabel: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.noir[800] },
  topicMessageSavedMark: { fontSize: 12, lineHeight: 18, fontWeight: "600", color: colors.sage[500] },
  topicMessageSavePartial: { marginTop: spacing[2], fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  topicMessageSaveFooter: { paddingHorizontal: spacing[5], paddingTop: spacing[3], paddingBottom: spacing[4], gap: spacing[2], borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  topicMessageSaveRemovalCopy: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  topicMessageSavePrimary: { minHeight: 48 },
  sharedConfirmOverlay: { flex: 1, justifyContent: "flex-end", padding: 16, backgroundColor: "rgba(13, 13, 15, 0.38)" },
  sharedConfirmSheet: { borderRadius: 22, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sharedConfirmIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.rose.light, marginBottom: 12 },
  sharedConfirmTitle: { fontSize: 18, lineHeight: 25, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  sharedConfirmBody: { marginTop: 8, fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  sharedConfirmPurpose: { marginTop: 8, padding: 10, borderRadius: 10, fontSize: 12, lineHeight: 18, color: colors.sage[500], backgroundColor: colors.sage.pale },
  sharedConfirmHint: { marginTop: 6, marginBottom: 16, fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  sharedConfirmError: { marginBottom: 12, padding: 10, borderRadius: 10, fontSize: 12, lineHeight: 18, color: "#8A4444", backgroundColor: "#FDF2F2" },
  sharedConfirmPrimary: { minHeight: 46, borderRadius: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.noir[800] },
  sharedConfirmPrimaryText: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: "#FFF" },
  sharedConfirmSecondary: { minHeight: 46, marginTop: 8, borderRadius: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#F1F3EA" },
  sharedConfirmSecondaryText: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: "#5a6147" },
  sharedConfirmCancel: { minHeight: 42, marginTop: 2, alignItems: "center", justifyContent: "center" },
  sharedConfirmCancelText: { fontSize: 13, color: colors.textTertiary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  headerLeft: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  headerBrandText: { flex: 1, minWidth: 0 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerNotes: { minHeight: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.ivory[100] },
  headerNotesText: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  headerPersonalize: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: colors.ivory[100] },
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
  mediationEntryRow: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface },
  mediationEntryButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12, backgroundColor: colors.ivory.warm },
  mediationEntryText: { fontSize: 12, fontWeight: "600", color: colors.noir.soft },
  emptyScroll: { flex: 1 },
  empty: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 24 },
  setupGate: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 },
  setupGateButton: { minHeight: 48, minWidth: 180, paddingHorizontal: 20, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.noir[800] },
  setupGateButtonText: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: "#FFFFFF" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 13, color: colors.textTertiary },
  suggestions: { width: "100%", gap: 8 },
  sugBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sugText: { fontSize: 14, color: colors.noir[800] },
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgRowRight: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  messageBody: { maxWidth: "78%" },
  focusedTopicMessageBody: { padding: spacing[1], borderRadius: radius.xl, borderWidth: 2, borderColor: colors.sage[500], backgroundColor: colors.ivory[100] },
  safetyMessageBody: { flex: 1, maxWidth: "92%" },
  mediationMessageBody: { maxWidth: "92%", flex: 1 },
  placeMessageBody: { flex: 1, maxWidth: 460 },
  toolReceiptMessageBody: { flex: 1, maxWidth: 460 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarAi: { backgroundColor: colors.noir[800] },
  avatarPartner: { backgroundColor: colors.ivory[200] },
  avatarBride: { backgroundColor: "#F5E6DF" },
  avatarGroom: { backgroundColor: "#E8EDF5" },
  avatarLetter: { fontSize: 8, fontWeight: "700", color: colors.noir[800] },
  senderLabel: { fontSize: 11, color: colors.textTertiary, marginBottom: 4, marginLeft: 4 },
  focusedTopicMessageLabel: { alignSelf: "flex-start", marginLeft: spacing[1], marginBottom: spacing[1], paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: radius.full, overflow: "hidden", fontSize: 11, lineHeight: 16, fontWeight: "600", color: colors.sage[500], backgroundColor: colors.sage.pale },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleRight: { borderBottomRightRadius: 4 },
  bubbleLeft: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  toolReceiptCard: { width: "100%", marginTop: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.sage.pale, backgroundColor: colors.ivory[50] },
  toolReceiptCardFailure: { borderColor: colors.rose.light, backgroundColor: colors.ivory[100] },
  toolReceiptHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  toolReceiptIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  toolReceiptTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  toolReceiptStatus: { fontSize: 11, fontWeight: "700" },
  toolReceiptMessage: { marginTop: 8, fontSize: 13, lineHeight: 20, color: colors.noir.soft },
  toolReceiptContinuationDescription: { marginTop: 12, fontSize: 13, lineHeight: 20, color: colors.noir.soft },
  toolReceiptContinuationButton: { minHeight: 48, marginTop: 10, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, backgroundColor: colors.noir[800] },
  toolReceiptContinuationButtonPressed: { opacity: 0.82 },
  toolReceiptContinuationButtonText: { fontSize: 14, fontWeight: "700", color: colors.ivory[50] },
  quoteCheckAction: { minHeight: 44, marginTop: 12, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.noir[800] },
  quoteCheckActionText: { fontSize: 14, fontWeight: "700", color: colors.ivory[50] },
  topicMessageSaveAction: { minHeight: 44, alignSelf: "flex-start", marginTop: spacing[2], paddingHorizontal: spacing[3], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], borderRadius: radius.lg, backgroundColor: colors.ivory[100] },
  topicMessageSaveActionPressed: { opacity: 0.68 },
  topicMessageSaveActionText: { fontSize: 12, lineHeight: 18, fontWeight: "600", color: colors.sage[500] },
  topicMessageSaveNotice: { marginTop: spacing[1], fontSize: 12, lineHeight: 18, color: colors.sage[500] },
  safetyCard: { width: "100%", padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.ivory[50] },
  safetyCardHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  safetyCardTitle: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  safetyCardText: { marginTop: 8, fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  pendingActionCard: { width: "100%", marginTop: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: "#D8C7BB", backgroundColor: "#FFFCF8" },
  scheduleCareActionCard: { width: "100%", marginTop: 8, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.sage.pale, backgroundColor: colors.ivory[50] },
  scheduleCareActionIcon: { backgroundColor: colors.sage.pale },
  scheduleCareActionReason: { marginTop: 10, fontSize: 13, lineHeight: 20, color: colors.noir.soft },
  scheduleCareActionCriterion: { marginTop: 8, padding: 8, borderRadius: 8, fontSize: 12, lineHeight: 18, color: colors.sage[500], backgroundColor: colors.sage.pale },
  scheduleCareActionStatus: { color: colors.noir.soft },
  scheduleCareActionButton: { minHeight: 48, backgroundColor: colors.sage[500] },
  scheduleCareActionButtonText: { color: colors.ivory[50] },
  pendingActionHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  pendingActionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#F2E8DE" },
  pendingActionCopy: { flex: 1 },
  pendingActionTitle: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  firstUsePendingActionPrompt: { marginTop: 4, fontSize: 14, lineHeight: 21, fontWeight: "600", color: colors.noir[800] },
  pendingActionConfirmation: { marginTop: 4, fontSize: 14, lineHeight: 21, color: colors.noir.soft },
  pendingActionStatus: { marginTop: 10, fontSize: 12, lineHeight: 18, color: "#795252" },
  pendingActionApprovalStatus: { marginTop: 10, flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, backgroundColor: "#F2F7F4" },
  pendingActionApprovalError: { backgroundColor: "#FFF2EF" },
  pendingActionApprovalText: { flex: 1, fontSize: 12, lineHeight: 18, color: "#2F5F51" },
  pendingActionApprovalErrorText: { color: "#8A3D31" },
  pendingActionControls: { marginTop: 12, gap: 8 },
  pendingActionButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "#2F5F51" },
  firstUsePendingActionButton: { minHeight: 48 },
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
  mediationOffer: { marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.sage.pale, backgroundColor: colors.ivory[50] },
  mediationOfferHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  mediationOfferIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.sage.pale },
  mediationOfferCopy: { flex: 1 },
  mediationOfferTitle: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.noir[800] },
  mediationOfferBody: { marginTop: 3, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  mediationOfferDismiss: { width: 44, height: 44, marginRight: -10, marginTop: -8, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  mediationOfferAction: { minHeight: 44, marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12, backgroundColor: colors.noir[800] },
  mediationOfferActionText: { fontSize: 13, fontWeight: "600", color: "#FFFFFF" },
  quotaBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, backgroundColor: colors.ivory.warm, borderTopWidth: 1, borderTopColor: colors.border },
  quotaText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.noir.soft },
  quotaDismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  firstUseComposerStage: { minHeight: 48, gap: 2, paddingHorizontal: 16, paddingVertical: 8, justifyContent: "center", borderTopWidth: 1, borderTopColor: colors.sage.pale, backgroundColor: colors.ivory[50] },
  firstUseComposerStageLabel: { fontSize: 12, lineHeight: 18, fontWeight: "700", color: colors.sage[500] },
  firstUseComposerStageCopy: { fontSize: 12, lineHeight: 18, color: colors.noir.soft },
  firstUseComposerNoticeAction: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.noir[800] },
  failureBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.ivory.warm, borderTopWidth: 1, borderTopColor: colors.rose.light },
  failureText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.noir.soft },
  retryBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.noir[800] },
  retryText: { fontSize: 14, fontWeight: "600", color: colors.surface },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  listenOnlyBar: { paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: spacing[1], gap: spacing[1], borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  listenOnlyButton: { minHeight: 40, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[3], borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.ivory[100] },
  listenOnlyButtonSelected: { borderColor: colors.sage[500], backgroundColor: colors.sage.pale },
  listenOnlyCheck: { width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, borderColor: colors.taupe[400], backgroundColor: colors.surface },
  listenOnlyCheckSelected: { borderColor: colors.sage[500], backgroundColor: colors.sage[500] },
  listenOnlyLabel: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: colors.noir[800] },
  listenOnlyCopy: { paddingHorizontal: spacing[1], fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.noir[800], backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.rose[500], alignItems: "center", justifyContent: "center" },
  firstUseComposerSendButton: { width: 48, height: 48 },
  sendBtnOff: { backgroundColor: colors.taupe[400] },
  stopBtn: { minWidth: 68, height: 44, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.noir[800], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  stopBtnText: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: "#FFF" },
});
