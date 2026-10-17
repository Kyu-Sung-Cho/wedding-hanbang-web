"use client";

import AmoraMark from "@/components/ui/AmoraMark";
import AmoraAvatar from "@/components/ui/AmoraAvatar";
import ProfileAvatar from "@/components/ui/ProfileAvatar";
import { AMORA_ACTION_CLASS } from "@/components/ui/amoraActionStyles";

import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";

import { personalActionContinuation } from "@/lib/amora/personalActionContinuation";
import { buildWeddingTasteAmoraText } from "@/lib/weddingCode/taste";
import {
  consumeWeddingTasteChat, forgetWeddingTasteChat, getWeddingTasteChatIdentity,
  peekWeddingTasteChat, WEDDING_TASTE_CHAT_PARAM,
} from "@/lib/weddingCode/tasteHandoff";
import { AMORA_PREPARATION_SOURCE_PARAM, resolveAmoraPreparationSource, type AmoraPreparationDraft } from "@/lib/amora/preparationHandoff";

import { useState, useEffect, useMemo, useRef, useCallback, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Send, X, PanelRightOpen, Paperclip, FileText, FileSpreadsheet, Heart, RefreshCw, Lock, Loader2, Search, MessageCircle, AlertTriangle, ShieldCheck, CheckCircle2, ExternalLink } from "lucide-react";
import type { ChatMessage, ChatMessageTarget } from "@/types/database.types";
import type { CommunityCategory } from "@/types/community.types";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import ChatBubble from "@/components/app/chat/ChatBubble";
import ActionCard from "@/components/app/chat/ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "@/components/app/chat/VendorToolCard";
import SuggestionButtons from "@/components/app/chat/SuggestionButtons";
import StreamingBubble from "@/components/app/chat/StreamingBubble";
import ChatInfoPanel from "@/components/app/chat/ChatInfoPanel";
import AmoraWorkspaceNav from "@/components/app/amora/AmoraWorkspaceNav";
import { useAmoraNavigationTarget } from "@/components/app/amora/AmoraNavigationContext";
import Button from "@/components/ui/Button";
import MediationConsentDialog from "@/components/app/chat/MediationConsentDialog";
import {
  AmoraPersonalizationConfirmation,
  AmoraQuickStart,
} from "@/components/app/chat/AmoraPersonalizationPrompt";
import {
  clearPendingAmoraPersonalizationChoice,
  readPendingAmoraPersonalizationChoice,
  rememberPendingAmoraPersonalizationChoice,
  resolveAmoraPersonalizationReply,
  shouldOfferAmoraQuickStart,
  type PendingAmoraPersonalizationChoice,
} from "@/components/app/chat/amoraPersonalizationFlow";
import PendingAmoraActionCard, {
  getPendingAmoraAction,
  getPendingAmoraActionCarryCount,
  getPendingAmoraBudgetImpactPreview,
  getQueuedRemainingCount,
  isPendingAmoraActionContinuedInMessage,
  isPendingAmoraActionExpired,
} from "@/components/app/chat/PendingAmoraActionCard";
import { AMORA_QUEUED_CARD_SKIP_TEXT } from "@/lib/ai/amoraQueuedCardSkip";
import {
  buildAmoraActionConfirmationOutcomes,
  getAmoraPendingActionApplicationState,
  resolveAmoraPendingActionDisabledReason,
} from "@/components/app/chat/amoraPendingActionApplication";
import {
  chatAttachmentKey,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_SNAPSHOT_ERROR,
  CHAT_ATTACHMENT_TYPE_INFO,
  prepareChatAttachmentPayload,
} from "@/lib/chat/attachments";
import { weddingPath } from "@/lib/weddingPaths";
import { subjectParticle } from "@/lib/korean/particles";
import { AMORA_DEMO_SUGGESTIONS, AMORA_DEMO_WELCOME } from "@/lib/chat/amoraDemoCopy";
import { AMORA_STARTER_PROMPTS } from "@/lib/chat/amoraStarterPrompts";
import {
  consumeDemoAmoraPrefill,
  forgetDemoAmoraPrefill,
  START_HERE_HANDOFF_QUERY_PARAM,
} from "@/lib/chat/demoHandoff";
import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
import { useAmoraPersonalization } from "@/hooks/useAmoraPersonalization";
import { useAmoraTextDraftRecovery } from "@/hooks/useAmoraTextDraftRecovery";
import { SHOW_SIGNED_IN_COMMUNITY } from "@/lib/features/signedInCommunity";
import type { AmoraQuickStartOption } from "@/lib/amora/personalization";
import {
  assessSelfReportedConflictOffer,
  shouldOfferMediation,
} from "@/lib/chat/mediationOffer";
import { deduplicateToolResults } from "./toolResultDeduplication";
import {
  resizeChatComposerToContent,
  useChatComposerAutoResize,
} from "./useChatComposerAutoResize";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import {
  amoraFirstHelloBodyForLane,
  buildAmoraFirstHello,
  readPreparationStage,
  type AmoraFirstHello,
} from "@hanbang/shared";
import { JOINED_PLAN_REVIEW_PROMPT } from "@/lib/amora/dashboardCompanion";
import { consumePendingAmoraFirstHello } from "@/lib/amora/pendingFirstHello";
import { isAmoraCommunityBridgeSafetyScoped } from "@/lib/chat/amoraCommunitySafety";
import {
  AMORA_LANE_CHOICE_COPY,
  resolveAmoraLaneEntryScope,
  resolveInitialAmoraLane,
  type AmoraLaneChoice,
} from "@hanbang/shared/amora-lane-choice";
import { readRememberedAmoraLane, rememberAmoraLane } from "@/lib/chat/amoraLaneMemory";
import AmoraLaneChoiceCard from "@/components/app/chat/AmoraLaneChoiceCard";

type CommunityDraftPrivacyMode = "shared" | "redacted_private";

const MAX_ATTACHMENTS = CHAT_ATTACHMENT_MAX_COUNT;
// 메시지 수가 이 이상이면 새 채팅 시작 안내
const NEW_CHAT_THRESHOLD = 200;
/** 말풍선 색 안내를 닫은 계정. 뒤에 사용자 id 를 붙인다. */
const ROLE_COLOR_HINT_STORAGE_PREFIX = "hanbang:chat-role-color-hint-dismissed:";

// 허용 파일 타입
const ALLOWED_TYPES = CHAT_ATTACHMENT_TYPE_INFO;

interface AttachmentItem {
  base64: string;
  mediaType: string;
  previewUrl: string;
  fileName: string;
}

type ChatComposerLane = "shared_ai" | "shared_partner" | "private_ai";

interface ChatComposerDraft {
  input: string;
  preparation: { source: string; draft: AmoraPreparationDraft } | null;
  attachments: AttachmentItem[];
  retryClientRequestId: string | null;
  pendingAttachmentReads: number;
  tasteHandoffNonce?: string;
  tasteHandoffOriginalText?: string;
}

interface PendingSend {
  text?: string;
  target: ChatMessageTarget;
}

function createEmptyComposerDrafts(): Record<ChatComposerLane, ChatComposerDraft> {
  return {
    shared_ai: {
      input: "",
      preparation: null,
      attachments: [],
      retryClientRequestId: null,
      pendingAttachmentReads: 0,
    },
    shared_partner: {
      input: "",
      preparation: null,
      attachments: [],
      retryClientRequestId: null,
      pendingAttachmentReads: 0,
    },
    private_ai: {
      input: "",
      preparation: null,
      attachments: [],
      retryClientRequestId: null,
      pendingAttachmentReads: 0,
    },
  };
}

function fileInputKey(file: File): string {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
}

function uniqueFiles(files: File[]): File[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = fileInputKey(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function revokeObjectPreview(previewUrl: string) {
  if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}

interface CommunityAskDraft {
  sourceMessageId: string;
  title: string;
  content: string;
  category: CommunityCategory;
  postedPostId: string | null;
  privacyMode: CommunityDraftPrivacyMode;
}

interface CommunityAskCue {
  label: string;
  ariaLabel: string;
}

interface ChatContentProps {
  /** 풀페이지(/chat)는 false, 다른 레이아웃 안에서 렌더되면 true. */
  embedded?: boolean;
}

const SENSITIVE_TEXT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "전화번호", pattern: /(?:01[016789]|02|0[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}/ },
  { label: "이메일", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { label: "계좌 정보", pattern: /(계좌|예금주|은행명|계좌번호)/ },
  { label: "연락처", pattern: /(연락처|전화번호|카카오톡|카톡\s*ID|오픈채팅|오픈톡)/i },
  { label: "계약 식별 정보", pattern: /(계약번호|예약번호|주민등록|상세주소|집주소)/ },
  {
    label: "건강·임신·성생활 정보",
    pattern: /(임신|난임|불임|유산|낙태|당뇨|암|우울증|공황장애|병력|진단명|복용약|성생활|성관계)/,
  },
  {
    label: "민감한 가족관계",
    pattern: /(?:부모님|아버지|어머니|엄마|아빠|시댁|친정|가족).{0,24}(?:이혼|재혼|별거|절연|사망|입양|폭력|학대|채무|빚)/,
  },
];

const SYSTEM_ACTION_TOOL_NAMES = new Set([
  "update_budget",
  "update_wedding_date",
  "update_task_status",
  "update_venue",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
  "delete_category",
  "reset_category",
  "add_schedule_event",
  "update_schedule_event",
  "cancel_schedule_event",
  "restore_schedule_event",
  "delete_schedule_event",
  "toggle_checklist_item",
  "add_amora_action",
  "update_amora_action",
  "create_booking",
  "cancel_booking",
]);

const UNCERTAIN_ANSWER_PATTERNS = [
  /확인(?:이|해)?\s*필요/,
  /정확(?:한|히)?[^.!?\n]*(?:확인|문의)/,
  /판단(?:이)?\s*(?:어렵|애매|모호)/,
  /답변(?:이)?\s*(?:어렵|제한)/,
  /상황(?:에)?\s*따라/,
  /업체(?:에|에게)?\s*(?:확인|문의)/,
  /계약서(?:를|에서)?\s*(?:확인|봐야|보셔야)/,
  /다른\s*(?:분들|예비부부|사람들).*?(?:경험|의견|후기)/,
  /커뮤니티(?:에도|에서)?\s*(?:물어|의견|확인)/,
];

const COMMUNITY_EXPERIENCE_PATTERNS = [
  /후기|경험|사례|실제|보통|평균/,
  /견적|비용|예산|추가금|가격|계약|환불|할인/,
  /괜찮|고민|불안|비교|추천|어떻게|해야|맞나|적당/,
  /부모님|상견례|예단|축의금|답례품|지방|지역/,
  /웨딩홀|예식장|스드메|드레스|메이크업|스냅|스튜디오|플래너/,
];

function normalizeChatText(input: string): string {
  return input
    .replace(/\[(?:vendor|product|staff|date|time):[^\]]*\]/g, "")
    .replace(/\[quote_analysis\]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(input: string, maxLength: number): string {
  const text = normalizeChatText(input);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function redactCommunityDraftText(input: string): string {
  return normalizeChatText(input)
    .replace(/(?:01[016789]|02|0[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[연락처 제거]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일 제거]")
    .replace(/(계좌|예금주|은행명|계약번호|예약번호|주민등록|상세주소)\s*[:：]?\s*[^\s,.)]+/g, "$1 [비공개]")
    .replace(/(카카오톡|카톡|오픈채팅|인스타|DM|디엠)\s*(ID|아이디)?\s*[:：]?\s*[^\s,.)]+/gi, "$1 [비공개]")
    .trim();
}

function inferCommunityCategory(text: string): CommunityCategory {
  return /(견적|비용|예산|추가금|가격|계약|환불|식대|대관료|헬퍼비|원본비|수정본)/.test(text)
    ? "tips_v2"
    : "free";
}

function polishCommunityQuestion(input: string): string {
  let question = normalizeChatText(input)
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/하는게/g, "하는 게")
    .replace(/할까[?？]?$/g, "할까요?")
    .replace(/해야해[?？]?$/g, "해야 할까요?")
    .replace(/괜찮아[?？]?$/g, "괜찮을까요?")
    .replace(/좋아[?？]?$/g, "좋을까요?")
    .trim();

  if (!question) return "";
  if (!/[?？.!。]$/.test(question)) question = `${question}?`;
  return question;
}

function buildCommunityTitle(question: string, category: CommunityCategory): string {
  const clean = question.replace(/[?？]+$/g, "").trim();
  if (clean.length >= 8) return truncateText(clean, 56);
  return category === "tips_v2"
    ? "비슷한 상황에서 실제 기준이 궁금해요"
    : "비슷한 상황 겪어본 분들 의견이 궁금해요";
}

function extractCommunityContext(userQuestion: string, amoraAnswer: string): string[] {
  const text = normalizeChatText(userQuestion);
  void amoraAnswer;
  const items: string[] = [];
  const seen = new Set<string>();
  const add = (item: string) => {
    if (!seen.has(item)) {
      seen.add(item);
      items.push(item);
    }
  };

  const budgetMatch = text.match(/(?:총\s*)?예산[^\d]*(\d{1,3}(?:,\d{3})*|\d+)\s*(?:만\s*원|만원)/);
  if (budgetMatch) add(`총 예산은 ${budgetMatch[1]}만원 정도로 보고 있어요.`);

  if (/(예식장|웨딩홀)[^.!?\n]{0,30}(미정|아직|정하지|못 정)/.test(text) || /아직[^.!?\n]{0,20}(예식장|웨딩홀)/.test(text)) {
    add("결혼식장은 아직 확정하지 않았어요.");
  }

  return items.slice(0, 3);
}

function buildCommunityGuideBullets(question: string, category: CommunityCategory): string[] {
  const text = normalizeChatText(question);

  if (/예산|비용|분배|항목|총액|가격/.test(text)) {
    return [
      "처음 예산 잡을 때 먼저 고정하면 좋은 항목",
      "생각보다 많이 늘어나는 항목",
      "줄여도 후회가 적었던 항목이나 반대로 꼭 남겨야 했던 항목",
    ];
  }

  if (/계약|견적|환불|위약금|추가금|원본|수정본|헬퍼비/.test(text)) {
    return [
      "계약 전에 꼭 문서로 확인해야 하는 항목",
      "견적서에 작게 적혀 있어도 나중에 크게 느껴지는 비용",
      "업체에 바로 물어보면 좋은 질문",
    ];
  }

  if (/웨딩홀|예식장|식대|보증|하객|대관료/.test(text)) {
    return [
      "결혼식장 상담 때 먼저 확인하면 좋은 조건",
      "식대나 보증 인원에서 놓치기 쉬운 부분",
      "실제로 계약 후에 알았으면 좋았을 점",
    ];
  }

  return category === "tips_v2"
    ? [
        "실제로 준비하면서 먼저 확인하면 좋은 것",
        "나중에 비용이나 일정이 커질 수 있는 부분",
        "업체에 물어보면 좋은 질문",
      ]
    : [
        "비슷한 상황에서 어떻게 결정했는지",
        "지금 단계에서 놓치기 쉬운 점",
        "경험상 먼저 확인하면 좋은 부분",
      ];
}

function buildCommunityAskDraft(
  userQuestion: string,
  amoraAnswer: string,
  sourceMessageId: string,
  privacyMode: CommunityDraftPrivacyMode = "shared"
): CommunityAskDraft {
  const questionSource = privacyMode === "redacted_private"
    ? redactCommunityDraftText(userQuestion)
    : userQuestion;
  const question = truncateText(polishCommunityQuestion(questionSource), privacyMode === "redacted_private" ? 420 : 520);
  const category = inferCommunityCategory(`${question}\n${amoraAnswer}`);
  const title = buildCommunityTitle(question, category);
  const contextItems = extractCommunityContext(questionSource, amoraAnswer);
  const guideBullets = buildCommunityGuideBullets(question, category);
  const intro = privacyMode === "redacted_private"
    ? "개인적인 내용은 빼고, 비슷한 상황 겪어본 분들 의견을 듣고 싶어요."
    : "실제로 준비해보신 분들 기준이 궁금해서 올려요.";
  const contentLines = [
    intro,
    "",
    "궁금한 점",
    question || "결혼 준비 중 판단이 필요한 부분이 있어요.",
    "",
    ...(contextItems.length > 0
      ? ["현재 상황", ...contextItems.map((item) => `- ${item}`), ""]
      : []),
    "특히 알고 싶은 것",
    ...guideBullets.map((item) => `- ${item}`),
  ];

  if (privacyMode === "redacted_private") {
    return {
      sourceMessageId,
      title,
      category,
      postedPostId: null,
      privacyMode,
      content: contentLines.join("\n"),
    };
  }

  return {
    sourceMessageId,
    title,
    category,
    postedPostId: null,
    privacyMode,
    content: contentLines.join("\n"),
  };
}

function detectSensitiveText(input: string): string[] {
  const labels = SENSITIVE_TEXT_PATTERNS
    .filter((item) => item.pattern.test(input))
    .map((item) => item.label);
  return [...new Set(labels)];
}

function includesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasSuccessfulSystemAction(message: ChatMessage): boolean {
  return (message.metadata?.toolResults ?? []).some(
    (result) => result.success && SYSTEM_ACTION_TOOL_NAMES.has(result.toolName)
  );
}

function isSafetyScopedChatMessage(message: ChatMessage): boolean {
  return isAmoraCommunityBridgeSafetyScoped(message);
}

function getCommunityAskCue(
  aiMessage: ChatMessage,
  userMessage: ChatMessage,
  wasMarkedUnhelpful: boolean
): CommunityAskCue | null {
  if (hasSuccessfulSystemAction(aiMessage)) return null;

  if (wasMarkedUnhelpful) {
    return {
      label: "사람들 의견도 듣기",
      ariaLabel: "아모라 답변이 아쉬워서 커뮤니티에 의견 묻기",
    };
  }

  const answer = normalizeChatText(aiMessage.content);
  const question = normalizeChatText(userMessage.content);

  if (includesAnyPattern(answer, UNCERTAIN_ANSWER_PATTERNS)) {
    return {
      label: "커뮤니티에 물어보기",
      ariaLabel: "아모라가 확실히 답하지 못한 내용을 커뮤니티에 묻기",
    };
  }

  const asksForHumanExperience = includesAnyPattern(question, COMMUNITY_EXPERIENCE_PATTERNS);
  const answerInvitesExperience = includesAnyPattern(answer, [/다른\s*(?:분들|예비부부|사람들).*?(?:경험|의견|후기)/]);
  if (asksForHumanExperience && answerInvitesExperience) {
    return {
      label: "비슷한 경험 물어보기",
      ariaLabel: "비슷한 경험을 커뮤니티에 묻기",
    };
  }

  return null;
}

export default function ChatContent({ embedded = false }: ChatContentProps = {}) {
  const router = useRouter();
  const navigationTarget = useAmoraNavigationTarget();
  const { profile, couple, journey, partner, isDemo, isInitialized: authInitialized, isLoading: authLoading } = useAuthStore();
  const amoraPersonalization = useAmoraPersonalization(
    !isDemo && Boolean(profile?.id),
  );
  const saveAmoraPersonalization = amoraPersonalization.save;
  const {
    messages,
    sharedClearedAt,
    privateClearedAt,
    isStreaming,
    isSending,
    streamingContent,
    streamingToolResults,
    suggestions,
    artifactVisibility,
    error,
    failedRequest,
    isRetrying,
    quotaRemaining,
    initialLoadDone,
    presence,
    loadMessages,
    sendMessage,
    requestInitialGreeting,
    requestMediation: requestStructuredMediation,
    clearMessages,
    subscribeToMessages,
    pollNewMessages,
    notifyTyping,
    stopTyping,
    requestSharedClear,
    retryFailedMessage,
    dismissFailedMessageRetry,
  } = useChatStore();
  const isConfirmedActionRecovery =
    failedRequest?.recoveryKind === "confirmed_action";
  const isInterruptedTurnRecovery =
    failedRequest?.recoveryKind === "interrupted_turn";
  const isRecoveryNotice = Boolean(failedRequest?.recoveryKind);
  const [messageTarget, setMessageTarget] = useState<ChatMessageTarget>("ai");
  // 채팅 탭 — "shared" (둘이 함께 + 상대방에게) | "private" (나만의 1:1)
  const [activeTab, setActiveTab] = useState<"shared" | "private">("shared");
  const isPrivate = activeTab === "private"; // private 탭일 때만 비공개 모드
  const activeComposerLane: ChatComposerLane = isPrivate
    ? "private_ai"
    : messageTarget === "partner"
      ? "shared_partner"
      : "shared_ai";
  const [composerDrafts, setComposerDrafts] = useState<Record<ChatComposerLane, ChatComposerDraft>>(
    createEmptyComposerDrafts,
  );
  const composerDraftsRef = useRef(composerDrafts);
  composerDraftsRef.current = composerDrafts;
  const activeComposerLaneRef = useRef(activeComposerLane);
  activeComposerLaneRef.current = activeComposerLane;
  const input = composerDrafts[activeComposerLane].input;
  const attachments = composerDrafts[activeComposerLane].attachments;
  const retryClientRequestId = composerDrafts[activeComposerLane].retryClientRequestId;
  const pendingAttachmentReads = composerDrafts[activeComposerLane].pendingAttachmentReads;
  const setDraftInput = useCallback((
    lane: ChatComposerLane,
    nextInput: SetStateAction<string>,
  ) => {
    setComposerDrafts((currentDrafts) => {
      const currentDraft = currentDrafts[lane];
      const resolvedInput = typeof nextInput === "function"
        ? nextInput(currentDraft.input)
        : nextInput;
      return {
        ...currentDrafts,
        [lane]: {
          ...currentDraft,
          input: resolvedInput,
          // 질문을 지우면 함께 이어 온 공개 참고 맥락도 해제한다.
          preparation: resolvedInput.trim() ? currentDraft.preparation : null,
          retryClientRequestId:
            resolvedInput === currentDraft.input ? currentDraft.retryClientRequestId : null,
        },
      };
    });
  }, []);
  const setInput = useCallback((nextInput: SetStateAction<string>) => {
    setDraftInput(activeComposerLane, nextInput);
  }, [activeComposerLane, setDraftInput]);
  const setDraftAttachments = useCallback((
    lane: ChatComposerLane,
    nextAttachments: SetStateAction<AttachmentItem[]>,
  ) => {
    setComposerDrafts((currentDrafts) => {
      const currentDraft = currentDrafts[lane];
      const resolvedAttachments = typeof nextAttachments === "function"
        ? nextAttachments(currentDraft.attachments)
        : nextAttachments;
      return {
        ...currentDrafts,
        [lane]: {
          ...currentDraft,
          attachments: resolvedAttachments,
          retryClientRequestId:
            resolvedAttachments === currentDraft.attachments
              ? currentDraft.retryClientRequestId
              : null,
        },
      };
    });
  }, []);
  const setAttachments = useCallback((nextAttachments: SetStateAction<AttachmentItem[]>) => {
    setDraftAttachments(activeComposerLane, nextAttachments);
  }, [activeComposerLane, setDraftAttachments]);
  const adjustPendingAttachmentReads = useCallback((lane: ChatComposerLane, delta: number) => {
    setComposerDrafts((currentDrafts) => {
      const currentDraft = currentDrafts[lane];
      return {
        ...currentDrafts,
        [lane]: {
          ...currentDraft,
          pendingAttachmentReads: Math.max(0, currentDraft.pendingAttachmentReads + delta),
        },
      };
    });
  }, []);
  const setDraftRetryClientRequestId = useCallback((
    lane: ChatComposerLane,
    clientRequestId: string | null,
  ) => {
    setComposerDrafts((currentDrafts) => ({
      ...currentDrafts,
      [lane]: { ...currentDrafts[lane], retryClientRequestId: clientRequestId },
    }));
  }, []);
  // pre-send confirm — 상대방 입력 중이거나 AI 응답 중일 때 마찰 추가
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  // 새 채팅 modal 단계 — closed | shared 옵션 선택 | shared 둘 다 추가확인 | private 확인
  type ClearStep = "closed" | "shared_choose" | "shared_confirm_both" | "private_confirm";
  const [clearStep, setClearStepState] = useState<ClearStep>("closed");
  const clearDialogVersionRef = useRef(0);
  const clearRequestInFlightRef = useRef<Set<string>>(new Set());
  const [pendingClearRequestOwners, setPendingClearRequestOwners] = useState<Set<string>>(() => new Set());
  const [clearRequestError, setClearRequestError] = useState<string | null>(null);
  const setClearStep = useCallback((nextStep: ClearStep) => {
    clearDialogVersionRef.current += 1;
    setClearRequestError(null);
    setClearStepState(nextStep);
  }, []);
  const [nowMs, setNowMs] = useState(0);
  const [dismissedPendingMessageIds, setDismissedPendingMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [applyingPendingActionId, setApplyingPendingActionId] = useState<string | null>(null);
  const applyingPendingActionRef = useRef<string | null>(null);
  // 건너뛰기를 두 번 눌러도 요청은 한 번만 간다. 적용 중 표시(`applyingPendingActionId`)는 쓰지
  // 않는다 — 적용 버튼에 "적용 요청 중…" 이 뜨면 건너뛴 항목이 적용되는 것처럼 읽힌다.
  const skippingPendingActionRef = useRef<string | null>(null);
  const [dismissedNewChatSegments, setDismissedNewChatSegments] = useState<Set<string>>(() => new Set());
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingPersonalization, setPendingPersonalization] =
    useState<PendingAmoraPersonalizationChoice | null>(null);
  const senderRole = profile?.role === "bride" || profile?.role === "groom"
    ? profile.role
    : null;
  const myPrivateVisibility =
    senderRole === "groom"
      ? "groom_private"
      : senderRole === "bride"
        ? "bride_private"
        : null;
  const coupleId = couple?.id;
  const linkedPartnerId = profile !== null
    && typeof coupleId === "string"
    && profile.couple_id === coupleId
    && senderRole === "bride"
    && couple?.bride_id === profile.id
    && typeof couple?.groom_id === "string"
    && couple.groom_id !== profile.id
    ? couple.groom_id
    : profile !== null
      && typeof coupleId === "string"
      && profile.couple_id === coupleId
      && senderRole === "groom"
      && couple?.groom_id === profile.id
      && typeof couple?.bride_id === "string"
      && couple.bride_id !== profile.id
        ? couple.bride_id
        : null;
  const hasLinkedPartner = linkedPartnerId !== null;
  const activeArtifactVisibility = isPrivate ? myPrivateVisibility : "shared";
  const transientArtifactsVisible =
    activeArtifactVisibility !== null && artifactVisibility === activeArtifactVisibility;
  const sendInFlightRef = useRef<number | null>(null);
  const composerEpochRef = useRef(0);
  const greetingRequested = useRef(false);
  /**
   * 아모라가 먼저 건넨 첫마디.
   *
   * 라운지에서 안내를 마친 사람은 사이드바의 "아모라"로 이 화면에 들어올 수 있다.
   * 그 길에는 라운지의 말풍선이 없어서, 여기서 보관을 가져오지 않으면 "먼저 말을 거는
   * 아모라"를 아예 만나지 못한다. 서버에 저장된 메시지가 아니라 이 화면 위에만 있는
   * 말이라, 함께 대화(shared) 탭의 맨 위에 한 번 놓고 답장은 평소 경로로 간다.
   */
  const [firstHello, setFirstHello] = useState<AmoraFirstHello | null>(null);
  // 보관을 확인하기 전에는 "인사가 없다"고 단정하지 않는다. 확인 전에 첫 인사를
  // 요청하면 아모라가 같은 자리에서 두 번 인사한다.
  const [firstHelloChecked, setFirstHelloChecked] = useState(false);
  const composerIdentity = `${profile?.id ?? "anonymous"}:${coupleId ?? "no-couple"}:${senderRole ?? "no-role"}`;
  /**
   * '나만 (상담)'을 고른 사람에게 놓는 화면 전용 첫인사(2026-09-26).
   *
   * 모델 첫 인사(`requestInitialGreeting`)는 서버가 **함께 대화 레인에** 저장한다. 서버와 DB는
   * 이번 결정으로 바꾸지 않으므로, 처음 온 사람이 '나만'을 고르면 그 인사를 볼 길이 없다.
   * 그래서 라운지 첫마디와 같은 `buildAmoraFirstHello` 로 이 화면에만 인사를 놓는다. 저장하지
   * 않고, 모델도 부르지 않는다.
   */
  const [laneGreeting, setLaneGreeting] = useState<{ identity: string; body: string } | null>(null);
  const greetingBody = firstHello?.body
    ?? (laneGreeting?.identity === composerIdentity ? laneGreeting.body : null);
  const composerIdentityRef = useRef(composerIdentity);
  /**
   * 처음 열 때 어느 레인으로 여나(2026-09-26 파운더 결정).
   *
   * 예전에는 누구나 '함께 대화'로 열렸다. 이제는 나만 레인을 쓸 수 있는 사람(역할 있음,
   * 체험 아님)이 이 브라우저에 기억이 없으면 선택 카드를 띄운다. 규칙은
   * `resolveInitialAmoraLane` 한 벌이고, 앱과 옆 패널도 같은 것을 쓴다.
   *
   * - 계정·커플이 바뀌면(`composerIdentity`) 한 번 다시 정한다.
   * - 정하기 전(`laneReady` 가 거짓)에는 보내지 않는다. 기억된 칸이 '나만'인 사람의 글이
   *   정하는 사이 '함께'로 가면 안 된다.
   * - 주소·준비 안내·안전 판정이 탭을 옮기면(`settleLane`) 카드는 거두지만 기억은 쓰지
   *   않는다. 사람이 고른 것만 기억한다(`chooseLane`).
   */
  const [laneGate, setLaneGate] = useState<{ identity: string; needsChoice: boolean } | null>(null);
  const laneGateIdentityRef = useRef(composerIdentity);
  laneGateIdentityRef.current = composerIdentity;
  const laneReady = laneGate?.identity === composerIdentity && !laneGate.needsChoice;
  const laneChoiceNeeded = laneGate?.identity === composerIdentity && laneGate.needsChoice;
  // 어느 계정에 대해 레인을 정했나. 상태는 다음 렌더에야 보이므로, 같은 커밋 안에서 먼저 돈
  // 효과(개인 할 일 이어가기·`?scope=`)가 옮긴 탭을 뒤의 결정 효과가 기억으로 덮지 않게 한다.
  const laneDecidedForRef = useRef<string | null>(null);
  const settleLane = useCallback(() => {
    laneDecidedForRef.current = laneGateIdentityRef.current;
    setLaneGate({ identity: laneGateIdentityRef.current, needsChoice: false });
  }, []);
  // 첫마디는 지금 보는 탭 맨 위에 놓는다. '나만'을 고른 사람도 인사를 만난다.
  // 라운지 첫마디 끝의 초대 문단("…두 사람이 같은 화면을 봐요")은 '함께 대화'로 정해진 뒤에만
  // 남긴다. 나만 레인에서는 거짓이고, 고르기 전에는 선택 카드의 덧붙임과 같은 말이다(2026-09-27).
  const greetingLane = laneReady ? activeTab : null;
  const firstHelloMessage = useMemo<ChatMessage | null>(() => {
    if (!greetingBody || !coupleId || isDemo) return null;
    return {
      id: "amora-first-hello",
      couple_id: coupleId,
      sender_id: null,
      sender_role: "ai",
      visibility: activeArtifactVisibility ?? "shared",
      content: amoraFirstHelloBodyForLane(greetingBody, greetingLane),
      metadata: {},
      created_at: new Date().toISOString(),
    };
  }, [activeArtifactVisibility, coupleId, greetingBody, greetingLane, isDemo]);
  const clearRequestPending = pendingClearRequestOwners.has(composerIdentity);
  const newChatSegmentKey = JSON.stringify([
    composerIdentity, isDemo, activeArtifactVisibility,
    isPrivate ? privateClearedAt ?? null : sharedClearedAt ?? null,
  ]);
  const activeMessageCount = messages.filter(message => message.couple_id === coupleId
    && message.visibility === activeArtifactVisibility).length;
  const showNewChatBanner = initialLoadDone && activeMessageCount >= NEW_CHAT_THRESHOLD
    && !dismissedNewChatSegments.has(newChatSegmentKey);
  const dismissNewChatBanner = useCallback(() => {
    setDismissedNewChatSegments(current => new Set(current).add(newChatSegmentKey));
  }, [newChatSegmentKey]);
  /**
   * 말풍선 색 안내 한 줄.
   *
   * 말풍선 색은 본인이 설정에서 고른 표시 역할(confirmed_role)로만 정한다. 가입 순서로
   * 추측하지 않으므로, 고르기 전에는 두 사람의 말풍선이 같은 중립색이다. 그 이유와 바꾸는
   * 곳을 **고르지 않은 사람에게만** 조용히 한 번 알려주고, 닫으면 그 계정에서는 다시
   * 보이지 않는다(브라우저 저장이 막혀 있으면 이번 화면에서만 닫힌다).
   */
  const viewerId = profile?.id ?? null;
  const viewerHasConfirmedRole = profile?.confirmed_role === "bride" || profile?.confirmed_role === "groom";
  const [roleColorHint, setRoleColorHint] = useState<{ userId: string; dismissed: boolean } | null>(null);
  useEffect(() => {
    if (!viewerId) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(`${ROLE_COLOR_HINT_STORAGE_PREFIX}${viewerId}`) === "1";
    } catch {
      dismissed = false;
    }
    setRoleColorHint({ userId: viewerId, dismissed });
  }, [viewerId]);
  const dismissRoleColorHint = useCallback(() => {
    if (!viewerId) return;
    setRoleColorHint({ userId: viewerId, dismissed: true });
    try {
      window.localStorage.setItem(`${ROLE_COLOR_HINT_STORAGE_PREFIX}${viewerId}`, "1");
    } catch {
      // 저장이 막힌 브라우저에서도 이번 화면에서는 닫는다.
    }
  }, [viewerId]);
  const hasLinkedPartnerRef = useRef(hasLinkedPartner);
  const linkedPartnerIdRef = useRef(linkedPartnerId);
  const partnerComposerEpochRef = useRef(0);
  const sharedTypingContextRef = useRef<{
    coupleId: string;
    userId: string;
    senderRole: "bride" | "groom";
  } | null>(null);
  const stopSharedTyping = useCallback(() => {
    const context = sharedTypingContextRef.current;
    if (!context) return;
    sharedTypingContextRef.current = null;
    stopTyping(context);
  }, [stopTyping]);
  const sharedMessageCount = messages.filter((m) => m.visibility === "shared").length;
  const privateMessageCount = myPrivateVisibility
    ? messages.filter((m) => m.visibility === myPrivateVisibility).length
    : 0;

  /**
   * 이 탭의 대화가 장기 기억으로 정리되는지 — 채팅에서 알 수 있게 한다.
   *
   * 2026-09-03 (1차 UX 5): 기억을 켜고 끄는 곳은 `설정 > 아모라가 기억하는 것`
   * 하나뿐인데, 정작 말을 하는 채팅에는 그 상태가 어디에도 없었다. 켜진 줄 알고
   * 말한 사람과 꺼진 줄 알고 말한 사람이 똑같은 화면을 본다.
   *
   * 설정 화면이 이미 쓰는 GET `/api/amora/memory` 의 `settings[].enabled` 를 그대로
   * 읽기만 한다 — 켜고 끄는 판정도, 저장 경로도 여기서 건드리지 않는다. 못 읽으면
   * 아무 말도 하지 않는다: 틀린 상태를 말하느니 침묵이 낫다.
   */
  const [memoryStatus, setMemoryStatus] =
    useState<{runtimeEnabled:boolean;settings:Record<string,boolean>} | null>(null);

  useEffect(() => {
    setMemoryStatus(null);
    if (isDemo || !coupleId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/amora/memory", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as {
          runtimeEnabled?: unknown;
          settings?: { visibility?: unknown; enabled?: unknown }[];
        };
        if (cancelled || typeof payload?.runtimeEnabled!=="boolean" || !Array.isArray(payload?.settings)) return;
        const next: Record<string, boolean> = {};
        for (const setting of payload.settings) {
          if (typeof setting?.visibility === "string" && typeof setting?.enabled === "boolean") {
            next[setting.visibility] = setting.enabled;
          }
        }
        setMemoryStatus({runtimeEnabled:payload.runtimeEnabled,settings:next});
      } catch {
        // 못 읽으면 상태 줄을 그리지 않는다.
      }
    })();
    return () => { cancelled = true; };
  }, [coupleId, isDemo]);

  // 탭마다 기억 범위가 다르다 — 함께 대화는 공유 기억, 나만 상담은 내 비공개 기억.
  const activeMemoryEnabled = (() => {
    if (!memoryStatus) return null;
    const visibility = isPrivate ? myPrivateVisibility : "shared";
    if (!visibility) return null;
    const enabled = memoryStatus.settings[visibility];
    return typeof enabled === "boolean" ? enabled : null;
  })();

  useEffect(() => {
    if (composerIdentityRef.current === composerIdentity) return;
    composerIdentityRef.current = composerIdentity;
    composerEpochRef.current += 1;
    setDismissedNewChatSegments(new Set());
    sendInFlightRef.current = null;
    greetingRequested.current = false;
    stopSharedTyping();
    const pending = pendingPrefillRef.current;
    const mayHydrate = pending
      && (!pending.ownerId || pending.ownerId === profile?.id)
      && (!pending.coupleId || pending.coupleId === coupleId);
    // 최초 신원 확정만 이어 준다. 확정된 계정·커플을 떠나면 과거 질문을 복원하지 않는다.
    pendingPrefillRef.current = mayHydrate && (!authInitialized || authLoading || !profile?.id || !coupleId || !senderRole)
      ? { ...pending, ownerId: profile?.id ?? null, coupleId: coupleId ?? null }
      : null;
    setComposerDrafts((currentDrafts) => {
      Object.values(currentDrafts).forEach((draft) => {
        draft.attachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
      });
      const emptied = createEmptyComposerDrafts();
      if (mayHydrate && currentDrafts.shared_ai.input === pending.text
        && !currentDrafts.shared_ai.attachments.length && !currentDrafts.shared_ai.pendingAttachmentReads) {
        emptied.shared_ai = { ...emptied.shared_ai, input: pending.text };
      }
      return emptied;
    });
    setActiveTab("shared");
    setMessageTarget("ai");
    setPendingSend(null);
  }, [authInitialized, authLoading, composerIdentity, coupleId, profile?.id, senderRole, stopSharedTyping]);


  // 이전 범위·계정의 늦은 동의 요청 응답이 새 확인 화면을 닫지 않게 한다.
  useEffect(() => {
    setClearStep("closed");
    return () => { clearDialogVersionRef.current += 1; };
  }, [activeArtifactVisibility, composerIdentity, isDemo, setClearStep]);

  useEffect(() => () => stopSharedTyping(), [stopSharedTyping]);

  useEffect(() => {
    const previousLinkedPartnerId = linkedPartnerIdRef.current;
    linkedPartnerIdRef.current = linkedPartnerId;
    hasLinkedPartnerRef.current = hasLinkedPartner;
    if (previousLinkedPartnerId === linkedPartnerId || previousLinkedPartnerId === null) return;

    partnerComposerEpochRef.current += 1;
    setMessageTarget("ai");
    setPendingSend(null);
    setComposerDrafts((currentDrafts) => {
      currentDrafts.shared_partner.attachments.forEach((attachment) => {
        revokeObjectPreview(attachment.previewUrl);
      });
      return {
        ...currentDrafts,
        shared_partner: {
          input: "",
          preparation: null,
          attachments: [],
          retryClientRequestId: null,
          pendingAttachmentReads: 0,
        },
      };
    });
    useChatStore.setState({
      error: "상대방 연결 정보가 바뀌었어요. 이전 상대용 미전송 초안과 첨부는 안전을 위해 삭제했어요. 전송 중이던 메시지는 대화에서 상태를 확인해주세요.",
      artifactVisibility: "shared",
    });
  }, [hasLinkedPartner, linkedPartnerId]);

  const handleScopeChange = useCallback((nextScope: "shared" | "private") => {
    if (
      isStreaming
      || isSending
      || (nextScope === "private" && (isDemo || !myPrivateVisibility))
    ) return false;
    if (nextScope === "private") stopSharedTyping();
    setActiveTab(nextScope);
    setMessageTarget("ai");
    // 레인을 정해서 옮겼으니 선택 카드는 거둔다. 기억은 여기서 쓰지 않는다 — 주소의
    // `?scope=`·준비 안내·개인 할 일 이어가기도 이 길로 온다(사람이 고른 것이 아니다).
    settleLane();
    return true;
  }, [isDemo, isSending, isStreaming, myPrivateVisibility, settleLane, stopSharedTyping]);

  /**
   * 사람이 직접 고른 레인 — 선택 카드와 위쪽 탭. 이것만 이 브라우저에 계정별로 기억한다.
   *
   * 서버가 안전 때문에 '나만'으로 옮긴 경우(`onSafetyPrivacyRedirect`·`ephemeral_safety`)는
   * 여기를 거치지 않는다. 그 사람이 고른 것이 아니고, 판정은 오탐일 수 있다. 기억하면
   * '함께'를 고른 사람이 다음 방문부터 고르지 않은 '나만'으로 열린다. 다음 글도 서버가
   * 글마다 다시 판정하므로 기억이 안전을 더해 주지 않는다. 옮겨진 탭은 이번 화면에서만
   * 유지된다.
   */
  const chooseLane = useCallback((nextScope: AmoraLaneChoice) => {
    if (!handleScopeChange(nextScope)) return;
    // 체험은 늘 '함께'로 열리므로 적어 둘 이유가 없다.
    if (!isDemo) rememberAmoraLane(profile?.id, nextScope);
    if (!embedded) {
      const destination = new URL(window.location.href);
      // 앞선 전환이 아직 주소에 반영되기 전 되돌아 눌러도 최신 선택이 이긴다.
      destination.searchParams.set("scope", nextScope);
      router.push(`${destination.pathname}${destination.search}${destination.hash}`, { scroll: false });
    }
  }, [embedded, handleScopeChange, isDemo, profile?.id, router]);

  useEffect(() => {
    if (!isDemo || activeTab !== "private") return;
    const hasLocalSafetyCard = !!myPrivateVisibility && messages.some((message) => (
      message.visibility === myPrivateVisibility
      && message.metadata?.response_origin === "client_deterministic_crisis_preflight"
    ));
    if (hasLocalSafetyCard) return;
    setActiveTab("shared");
    setMessageTarget("ai");
  }, [activeTab, isDemo, messages, myPrivateVisibility]);

  const handleMessageTargetChange = useCallback((nextTarget: ChatMessageTarget) => {
    if (
      isStreaming
      || isSending
      || activeTab !== "shared"
      || (nextTarget === "partner" && !hasLinkedPartner)
    ) return;
    setMessageTarget(nextTarget);
  }, [activeTab, hasLinkedPartner, isSending, isStreaming]);

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const [mediationDismissed, setMediationDismissed] = useState(false);
  const [mediationConsentOpen, setMediationConsentOpen] = useState(false);
  const mutualConflictOffer =
    activeTab === "shared"
    && !mediationDismissed
    && !mediationConsentOpen
    && shouldOfferMediation(messages);
  // 두 사람이 서로에게 싸운 기록이 없어도, 한 사람이 아모라에게 갈등을
  // 이야기했으면 문은 보여준다. 시작하지는 않는다 — 문구도 다르다.
  const selfReportedConflictOffer =
    activeTab === "shared"
    && !mediationDismissed
    && !mediationConsentOpen
    && !mutualConflictOffer
    && assessSelfReportedConflictOffer(messages, senderRole ?? null).shouldOffer;
  const showMediationBanner = mutualConflictOffer || selfReportedConflictOffer;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  // streaming 중 자동 따라가기 의도 — 사용자가 메시지 보내면 true, 사용자가 직접
  // 스크롤 올리면 false. 매 토큰마다 끌어내리는 yank 방지.
  const followStreamRef = useRef(false);
  const lastMsgCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFilesRef = useRef<(files: File[]) => void>(() => {});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeDialogRef = useRef<HTMLDivElement>(null);
  const closeActiveDialogRef = useRef<() => void>(() => {});
  useChatComposerAutoResize(textareaRef, input);

  // URL ?prefill=... 또는 로그인 없는 준비 순서에서 이어왔을 때 input에 초안을 채운다.
  // 바로 여는 체험은 현재 탭, 가입을 거치는 흐름은 같은 브라우저 저장소에서
  // 유효한 초안만 읽으며 URL에는 날짜를 남기지 않는다.
  const searchParams = useSearchParams();
  useAmoraTextDraftRecovery({
    surface: "conversation", owner: profile?.id && coupleId && senderRole ? composerIdentity : null,
    partnerId: linkedPartnerId, enabled: authInitialized && !authLoading && !isDemo,
    privateHandoffPending: searchParams.has(WEDDING_TASTE_CHAT_PARAM),
    drafts: composerDrafts, setDrafts: setComposerDrafts,
  });
  const preparationRouterRef = useRef(router);
  preparationRouterRef.current = router;
  const preparationValues = searchParams.getAll(AMORA_PREPARATION_SOURCE_PARAM);
  const preparationKey = JSON.stringify(preparationValues);
  const currentSearchRef = useRef(searchParams);
  currentSearchRef.current = searchParams;
  const tasteKey = JSON.stringify(searchParams.getAll(WEDDING_TASTE_CHAT_PARAM));
  const hasTasteHandoff = searchParams.has(WEDDING_TASTE_CHAT_PARAM);
  // 이 방문은 전송 전 검토로 시작했다. URL을 정리한 뒤에도 자동 AI 쓰기를 시작하지 않는다.
  const tasteReviewVisitRef = useRef(hasTasteHandoff);
  if (hasTasteHandoff) tasteReviewVisitRef.current = true;
  const publicHandoffKey = JSON.stringify([
    searchParams.getAll(AMORA_PREPARATION_SOURCE_PARAM),
    searchParams.getAll("prefill"),
    searchParams.getAll(START_HERE_HANDOFF_QUERY_PARAM),
  ]);
  const hasExplicitPublicHandoff = searchParams.has(AMORA_PREPARATION_SOURCE_PARAM) || searchParams.has("prefill");
  const tasteBlockedPublicHandoffRef = useRef<string | null>(null);
  if (hasTasteHandoff) tasteBlockedPublicHandoffRef.current = publicHandoffKey;
  else if (!hasExplicitPublicHandoff && !searchParams.has(START_HERE_HANDOFF_QUERY_PARAM)) {
    tasteBlockedPublicHandoffRef.current = null;
  }
  // 같은 혼합 주소에서 nonce만 사라져도 이전 인계를 시작하지 않는다.
  // 주소가 정리된 뒤 새로 연 source/prefill만 허용하고 자동 인사·저장소 인계는 계속 억제한다.
  const suppressPublicHandoff = tasteReviewVisitRef.current
    && !(hasExplicitPublicHandoff && publicHandoffKey !== tasteBlockedPublicHandoffRef.current);
  const tasteVisitRef = useRef<{ key: string; identity: string; completed: boolean } | null>(null);
  const [tasteNotice, setTasteNotice] = useState<{
    identity: string; epoch: number; nonce?: string; status: "pending" | "applied" | "error";
  } | null>(null);
  const cleanTasteQuery = useCallback(() => {
    const next = new URLSearchParams(currentSearchRef.current.toString());
    next.delete(WEDDING_TASTE_CHAT_PARAM);
    next.delete("prefill"); next.delete(AMORA_PREPARATION_SOURCE_PARAM); next.delete(START_HERE_HANDOFF_QUERY_PARAM);
    const qs = next.toString();
    preparationRouterRef.current.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }, []);
  const tryPlaceWeddingTaste = useCallback((nonce: string, identity: string, epoch: number) => {
    if (identity !== getWeddingTasteChatIdentity() || epoch !== composerEpochRef.current) return;
    const draft = peekWeddingTasteChat(nonce);
    if (!draft) {
      if (tasteVisitRef.current) tasteVisitRef.current.completed = true;
      setTasteNotice({ identity, epoch, status: "error" }); cleanTasteQuery(); return;
    }
    setTasteNotice({ identity, epoch, nonce, status: "pending" });
    if (useChatStore.getState().isStreaming || useChatStore.getState().isSending || sendInFlightRef.current !== null) return;
    const text = buildWeddingTasteAmoraText(draft);
    handleScopeChange("private");
    // React가 앞서 큐에 넣은 타이핑·파일 선택도 확인한다. 저장소 소비는 실제 반영 뒤에 한다.
    setComposerDrafts(previous => {
      const lane = previous.private_ai;
      if (lane.input.length || lane.attachments.length || lane.pendingAttachmentReads || lane.tasteHandoffNonce
        || epoch !== composerEpochRef.current || getWeddingTasteChatIdentity() !== identity
        || useChatStore.getState().isStreaming || useChatStore.getState().isSending || sendInFlightRef.current !== null) return previous;
      return { ...previous, private_ai: { ...lane, input: text, preparation: null, retryClientRequestId: null, tasteHandoffNonce: nonce, tasteHandoffOriginalText: text } };
    });
  }, [cleanTasteQuery, handleScopeChange]);
  useEffect(() => {
    if (!hasTasteHandoff || embedded || !authInitialized || authLoading || !profile?.id || !coupleId || !senderRole) return;
    let active = true;
    const epoch = composerEpochRef.current;
    queueMicrotask(() => {
      if (!active || epoch !== composerEpochRef.current) return;
      const values: string[] = JSON.parse(tasteKey);
      const prior = tasteVisitRef.current;
      if (prior?.key === tasteKey && prior.completed) return;
      const params = currentSearchRef.current;
      const mixed = params.has("prefill") || params.has(AMORA_PREPARATION_SOURCE_PARAM) || params.has(START_HERE_HANDOFF_QUERY_PARAM)
        || params.getAll("scope").length !== 1 || params.get("scope") !== "private";
      if (values.length !== 1 || mixed || isDemo || getWeddingTasteChatIdentity() !== composerIdentity
        || (prior?.key === tasteKey && prior.identity !== composerIdentity)) {
        values.forEach(forgetWeddingTasteChat);
        tasteVisitRef.current = { key: tasteKey, identity: composerIdentity, completed: true };
        setTasteNotice({ identity: composerIdentity, epoch, status: "error" }); cleanTasteQuery(); return;
      }
      tasteVisitRef.current = { key: tasteKey, identity: composerIdentity, completed: false };
      tryPlaceWeddingTaste(values[0], composerIdentity, epoch);
    });
    return () => { active = false; };
  }, [authInitialized, authLoading, cleanTasteQuery, composerIdentity, coupleId, embedded, hasTasteHandoff, isDemo, profile?.id, senderRole, tasteKey, tryPlaceWeddingTaste]);
  const placedTasteNonce = composerDrafts.private_ai.tasteHandoffNonce;
  useEffect(() => {
    if (!placedTasteNonce) return;
    let active = true;
    const epoch = composerEpochRef.current;
    queueMicrotask(() => {
      if (!active || epoch !== composerEpochRef.current) return;
      const draft = getWeddingTasteChatIdentity() === composerIdentity ? consumeWeddingTasteChat(placedTasteNonce) : null;
      if (tasteVisitRef.current) tasteVisitRef.current.completed = true;
      setTasteNotice({ identity: composerIdentity, epoch, status: draft ? "applied" : "error" });
      setComposerDrafts(previous => {
        const lane = previous.private_ai;
        if (lane.tasteHandoffNonce !== placedTasteNonce) return previous;
        return { ...previous, private_ai: { ...lane, input: draft || lane.input !== lane.tasteHandoffOriginalText ? lane.input : "", tasteHandoffNonce: undefined, tasteHandoffOriginalText: undefined } };
      });
      cleanTasteQuery();
      if (draft) requestAnimationFrame(() => {
        if (epoch === composerEpochRef.current && activeComposerLaneRef.current === "private_ai") textareaRef.current?.focus();
      });
    });
    return () => { active = false; };
  }, [cleanTasteQuery, composerIdentity, placedTasteNonce]);
  const preparationVisitRef = useRef<{ key: string; identity: string; completed: boolean } | null>(null);
  const [preparationNotice, setPreparationNotice] = useState<{
    identity: string;
    epoch: number;
    draft?: AmoraPreparationDraft;
    source?: string;
    error?: string;
  } | null>(null);
  const placedPreparation = composerDrafts.shared_ai.preparation;
  const preparationQuestionPlaced = Boolean(preparationNotice?.draft
    && preparationNotice.draft === placedPreparation?.draft
    && preparationNotice.source === placedPreparation?.source);
  useEffect(() => {
    // 입력창에 들어간 질문은 안내로 다시 보여주거나 전송 후 되살리지 않는다.
    if (preparationQuestionPlaced) setPreparationNotice(null);
  }, [preparationQuestionPlaced]);
  useEffect(() => {
    const values: string[] = JSON.parse(preparationKey);
    if (!values.length) { preparationVisitRef.current = null; return; }
    if (hasTasteHandoff || suppressPublicHandoff) return;
    if (embedded || !authInitialized || authLoading || (!isDemo && (!profile?.id || !coupleId || !senderRole))) return;
    const epoch = composerEpochRef.current;
    let active = true;
    const cleanSource = () => {
      if (JSON.stringify(currentSearchRef.current.getAll(AMORA_PREPARATION_SOURCE_PARAM)) !== preparationKey) return;
      const next = new URLSearchParams(currentSearchRef.current.toString());
      next.delete(AMORA_PREPARATION_SOURCE_PARAM);
      next.delete("prefill");
      next.delete(START_HERE_HANDOFF_QUERY_PARAM);
      const qs = next.toString();
      preparationRouterRef.current.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    };
    const visit = preparationVisitRef.current;
    if (visit?.key === preparationKey && (visit.identity !== composerIdentity || visit.completed)) {
      visit.completed = true;
      cleanSource();
      return;
    }
    const currentVisit = { key: preparationKey, identity: composerIdentity, completed: false };
    preparationVisitRef.current = currentVisit;
    void (async () => {
      try {
        const draft = values.length === 1 && !currentSearchRef.current.has(START_HERE_HANDOFF_QUERY_PARAM)
          ? await resolveAmoraPreparationSource(values[0]) : null;
        if (!active || epoch !== composerEpochRef.current) return;
        if (!draft) {
          setPreparationNotice({ identity: composerIdentity, epoch, error: "이어 온 준비 항목을 확인하지 못했어요. 원래 안내에서 다시 열어 주세요." });
          return;
        }
        setPreparationNotice({ identity: composerIdentity, epoch, draft, source: values[0] });
        const current = composerDraftsRef.current.shared_ai;
        if (activeComposerLaneRef.current === "shared_ai" && !current.input.trim()
          && !current.attachments.length && !current.pendingAttachmentReads) {
          setComposerDrafts(previous => {
            const lane = previous.shared_ai;
            if (lane.input.trim() || lane.attachments.length || lane.pendingAttachmentReads) return previous;
            return { ...previous, shared_ai: { ...lane, input: draft.text, preparation: { source: values[0], draft }, retryClientRequestId: null } };
          });
          requestAnimationFrame(() => {
            if (activeComposerLaneRef.current === "shared_ai" && epoch === composerEpochRef.current) textareaRef.current?.focus();
          });
        }
      } catch {
        if (active && epoch === composerEpochRef.current) {
          setPreparationNotice({ identity: composerIdentity, epoch, error: "준비 질문을 불러오지 못했어요. 원래 안내에서 다시 열어 주세요." });
        }
      } finally {
        if (active) { currentVisit.completed = true; cleanSource(); }
      }
    })();
    return () => { active = false; };
  }, [authInitialized, authLoading, composerIdentity, coupleId, embedded, hasTasteHandoff, isDemo, preparationKey, profile?.id, senderRole, suppressPublicHandoff]);
  const appliedRouteScope = useRef<string | null>(null);
  const requestedRouteScope = searchParams.get("scope");
  const [personalContinuationNotice, setPersonalContinuationNotice] = useState<{ identity: string; text: string } | null>(null);
  const privateDraftRef = useRef(composerDrafts.private_ai);
  privateDraftRef.current = composerDrafts.private_ai;
  useEffect(() => {
    if (hasTasteHandoff || tasteReviewVisitRef.current) return;
    if (embedded || !authInitialized || authLoading || !initialLoadDone || isDemo || !profile?.id || !coupleId
      || !myPrivateVisibility || isStreaming || isSending || !personalActionContinuation.hasPending()) return;
    let active = true;
    const epoch = composerEpochRef.current;
    const scope = { ownerId: profile.id, coupleId };
    handleScopeChange("private");
    setPersonalContinuationNotice(null);
    void personalActionContinuation.take(scope).then(text => {
      if (!active || !text || epoch !== composerEpochRef.current) return;
      const current = useAuthStore.getState();
      if (current.user?.id !== scope.ownerId || current.profile?.couple_id !== scope.coupleId) return;
      const existing = privateDraftRef.current;
      if (existing.input.trim() || existing.attachments.length || existing.pendingAttachmentReads) {
        setPersonalContinuationNotice({ identity: composerIdentity, text: "작성 중인 나만 상담은 그대로 두었어요. 보내거나 비운 뒤 개인 목록에서 다시 이어가 주세요." });
        return;
      }
      handleScopeChange("private");
      setDraftInput("private_ai", previous => previous.trim() ? previous : text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }).catch(() => {
      if (active && epoch === composerEpochRef.current) setPersonalContinuationNotice({ identity: composerIdentity, text: "개인 할 일을 다시 확인하지 못했어요. 개인 목록에서 다시 이어가 주세요." });
    });
    return () => { active = false; };
  }, [authInitialized, authLoading, composerIdentity, coupleId, embedded, handleScopeChange, hasTasteHandoff, initialLoadDone, isDemo, isSending, isStreaming, myPrivateVisibility, profile?.id, setDraftInput]);
  useEffect(() => {
    if (embedded || !authInitialized || authLoading || isStreaming || isSending) return;
    if (requestedRouteScope !== "shared" && requestedRouteScope !== "private") return;
    if (appliedRouteScope.current === requestedRouteScope) return;
    if (requestedRouteScope === "private" && (isDemo || !myPrivateVisibility)) return;
    appliedRouteScope.current = requestedRouteScope;
    handleScopeChange(requestedRouteScope);
  }, [authInitialized, authLoading, embedded, handleScopeChange, isDemo, isSending, isStreaming, myPrivateVisibility, requestedRouteScope]);
  /**
   * 레인을 정해서 들어온 길(`resolveAmoraLaneEntryScope`, 앱과 같은 규칙 한 벌). `?scope=` 가
   * 먼저이고, 그다음 준비 안내 질문(`amoraSource`)과 파트너 합류 직후 계획 점검 문장만 '함께'를
   * 정한다.
   *
   * 일반 `prefill`(라운지 '아모라에게 물어보기'·대시보드·온보딩 직후 등)과 가입 인계는 칸을
   * 정하지 않는다(2026-09-27 검토). 처음 온 사람은 카드를 보고, 기억이 있으면 그 칸으로 열린다.
   * 그 초안은 고른 칸의 입력칸에 들어간다(`heldPrefillRef`).
   */
  const preparationLaneEntry = searchParams.has(AMORA_PREPARATION_SOURCE_PARAM);
  const prefillValues = searchParams.getAll("prefill");
  const joinedPlanReviewLaneEntry = prefillValues.length === 1 && prefillValues[0] === JOINED_PLAN_REVIEW_PROMPT;
  const hasSharedLaneEntry = preparationLaneEntry || joinedPlanReviewLaneEntry;
  // 인계를 받은 뒤 주소를 곧바로 정리하므로(router.replace) 한 번 본 것을 기억해 둔다.
  const sharedLaneEntrySeenRef = useRef<{ preparationSource: boolean; joinedPlanReview: boolean } | null>(null);
  if (hasSharedLaneEntry) {
    sharedLaneEntrySeenRef.current = {
      preparationSource: preparationLaneEntry,
      joinedPlanReview: joinedPlanReviewLaneEntry,
    };
  }
  const laneEntryScope = embedded
    ? null
    : resolveAmoraLaneEntryScope({ scope: requestedRouteScope, ...sharedLaneEntrySeenRef.current });
  useEffect(() => {
    // 역할 정보가 오기 전에는 정하지 않는다. 카드가 떴다가 체험·무역할로 판명되면 깜빡인다.
    if (!authInitialized || authLoading) return;
    // 이 계정에서 이미 정했으면 다시 정하지 않는다. 사람이 바꾼 탭을 주소 쪽으로 끌어오지
    // 않기 위해서다. 카드가 떠 있는 동안 레인을 정한 진입이 새로 오면 그것만 받는다.
    const choicePendingWithEntry = laneGate?.identity === composerIdentity
      && laneGate.needsChoice && Boolean(laneEntryScope);
    if (laneDecidedForRef.current === composerIdentity && !choicePendingWithEntry) return;
    laneDecidedForRef.current = composerIdentity;
    const initial = resolveInitialAmoraLane({
      storedLane: readRememberedAmoraLane(profile?.id),
      privateAvailable: Boolean(myPrivateVisibility),
      isDemo,
      explicitScope: laneEntryScope,
      roleKnown: true,
    });
    if (initial.lane) {
      if (initial.lane === "private") stopSharedTyping();
      setActiveTab(initial.lane);
      setMessageTarget("ai");
    }
    setLaneGate({ identity: composerIdentity, needsChoice: initial.needsChoice });
  }, [authInitialized, authLoading, composerIdentity, isDemo, laneEntryScope, laneGate, myPrivateVisibility, profile?.id, stopSharedTyping]);
  useEffect(() => {
    // 주소가 정리됐고 나만 레인을 쓸 수 있는 계정으로 레인이 정해졌으면 인계 표시를 내린다.
    // 남겨 두면 나중에 계정이 바뀌었을 때 그 계정까지 '함께'로 연다.
    if (!hasSharedLaneEntry && laneGate?.identity === composerIdentity && myPrivateVisibility) {
      sharedLaneEntrySeenRef.current = null;
    }
  }, [composerIdentity, hasSharedLaneEntry, laneGate, myPrivateVisibility]);
  const prefillAppliedRef = useRef(false);
  // 적용한 초안을 기억해 둔다. authStore 가 늦게 하이드레이션되면
  // composerIdentity 가 바뀌어 모든 초안을 비우는데, 로그인 직후 진입은 항상
  // 그 순서라 방금 채운 초안이 지워졌다.
  const pendingPrefillRef = useRef<{ text: string; ownerId: string | null; coupleId: string | null } | null>(null);
  /**
   * 칸을 정하지 않는 초안(일반 `prefill`·가입 인계)을 칸이 정해질 때까지 들고 있는다(2026-09-27).
   *
   * 초안은 먼저 함께 대화 입력칸에 받아 둔다(늦은 로그인 복원 `pendingPrefillRef` 가 그 칸을 본다).
   * 칸이 정해지는 순간(기억·선택 카드·위쪽 탭) 한 번만 본다. '나만 (상담)'이면 나만 입력칸으로
   * 옮긴다. 옮기지 않으면 질문이 보이지 않는 함께 대화 입력칸에 남는다. 받은 뒤 사람이 고친 글과
   * 이미 쓰던 나만 입력칸은 건드리지 않는다.
   */
  const heldPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    if (hasTasteHandoff || suppressPublicHandoff) return;
    // 식별자 연결을 임의 본문과 섞지 않는다. 유효하지 않은 source도 legacy 초안으로 우회하지 않는다.
    if (searchParams.has(AMORA_PREPARATION_SOURCE_PARAM)) return;
    const queryPrefill = searchParams?.get("prefill");
    const startHereHandoffId = searchParams?.get(START_HERE_HANDOFF_QUERY_PARAM) ?? null;
    let handoffPrefill: string | null = null;
    if (startHereHandoffId) {
      try {
        // 가입 흐름에서는 redirect nonce와 묶인 브라우저 초안만 한 번 소비한다.
        handoffPrefill = consumeDemoAmoraPrefill(
          window.localStorage,
          startHereHandoffId,
        );
      } catch {
        // 저장소가 막혔거나 nonce가 맞지 않으면 가입 초안을 표시하지 않는다.
      }
      try {
        forgetDemoAmoraPrefill(window.sessionStorage);
      } catch {
        // 현재 탭 저장소 정리가 막혀도 가입 초안 검증 결과는 유지한다.
      }
    } else {
      try {
        // 바로 여는 체험은 현재 탭의 초안만 허용한다.
        handoffPrefill = consumeDemoAmoraPrefill(window.sessionStorage);
      } catch {
        // 브라우저 저장소를 막은 환경에서는 URL prefill만 사용한다.
      }
      try {
        // 일반 채팅 진입에서는 이전 방문자의 가입 초안을 보여주지 않고 바로 폐기한다.
        forgetDemoAmoraPrefill(window.localStorage);
      } catch {
        // 현재 탭 체험 초안이 유효하면 브라우저 공용 저장소 정리 실패와 무관하게 사용한다.
      }
    }
    const requestedPrefill = startHereHandoffId
      ? handoffPrefill
      : queryPrefill ?? handoffPrefill;
    const prefill = requestedPrefill && requestedPrefill.length <= 20_000
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(requestedPrefill)
      && searchParams.getAll("prefill").length <= 1 ? requestedPrefill : null;
    const shouldCleanUrl = Boolean(queryPrefill) || Boolean(startHereHandoffId);
    if (!prefill) {
      if (requestedPrefill) {
        prefillAppliedRef.current = true;
        setPreparationNotice({ identity: composerIdentity, epoch: composerEpochRef.current, error: "이어 온 질문의 형식이나 길이를 확인하지 못했어요. 원래 화면에서 다시 열어 주세요." });
      }
      if (shouldCleanUrl) {
        const next = new URLSearchParams(searchParams?.toString());
        next.delete("prefill");
        next.delete(START_HERE_HANDOFF_QUERY_PARAM);
        const qs = next.toString();
        router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
      }
      return;
    }
    prefillAppliedRef.current = true;
    const currentDraft = composerDraftsRef.current.shared_ai;
    const canPlace = !currentDraft.input.trim() && !currentDraft.attachments.length && !currentDraft.pendingAttachmentReads;
    pendingPrefillRef.current = !authInitialized || authLoading || !profile?.id || !coupleId || !senderRole
      ? { text: prefill, ownerId: profile?.id ?? null, coupleId: coupleId ?? null }
      : null;
    if (canPlace) {
      setDraftInput("shared_ai", previous => previous.trim() ? previous : prefill);
      heldPrefillRef.current = prefill;
    } else {
      pendingPrefillRef.current = null;
      setPreparationNotice({ identity: composerIdentity, epoch: composerEpochRef.current, error: "작성 중인 함께 대화는 그대로 두었어요. 보내거나 비운 뒤 원래 화면에서 질문을 다시 이어 주세요." });
    }
    // 질문 원문과 일회성 가입 표식은 입력창에 적용한 직후 주소에서 제거한다.
    if (shouldCleanUrl) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("prefill");
      next.delete(START_HERE_HANDOFF_QUERY_PARAM);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    }
    if (canPlace && activeComposerLaneRef.current === "shared_ai") requestAnimationFrame(() => textareaRef.current?.focus());
  }, [authInitialized, authLoading, composerIdentity, coupleId, hasTasteHandoff, profile?.id, searchParams, router, senderRole, setDraftInput, suppressPublicHandoff]);
  const sharedAiDraftInput = composerDrafts.shared_ai.input;
  useEffect(() => {
    const held = heldPrefillRef.current;
    if (!held || !laneReady) return;
    heldPrefillRef.current = null;
    if (activeTab !== "private") return;
    setComposerDrafts((previous) => {
      const shared = previous.shared_ai;
      const personal = previous.private_ai;
      if (shared.input !== held || shared.attachments.length || shared.pendingAttachmentReads
        || personal.input.trim() || personal.attachments.length || personal.pendingAttachmentReads) return previous;
      return {
        ...previous,
        shared_ai: { ...shared, input: "", preparation: null, retryClientRequestId: null },
        private_ai: { ...personal, input: held, preparation: null, retryClientRequestId: null },
      };
    });
    requestAnimationFrame(() => {
      if (activeComposerLaneRef.current === "private_ai") textareaRef.current?.focus();
    });
  }, [activeTab, laneReady, sharedAiDraftInput]);

  useEffect(() => {
    if (!profile?.id || !coupleId || isDemo) {
      setPendingPersonalization(null);
      return;
    }
    setPendingPersonalization(
      readPendingAmoraPersonalizationChoice(profile.id, coupleId),
    );
  }, [coupleId, isDemo, profile?.id]);

  useEffect(() => {
    if (!profile?.id || !coupleId || !amoraPersonalization.profile) return;
    clearPendingAmoraPersonalizationChoice(profile.id, coupleId);
    setPendingPersonalization(null);
  }, [amoraPersonalization.profile, coupleId, profile?.id]);

  useEffect(() => {
    if (!isDemo || !coupleId || !profile) return;

    const welcomeMessage: ChatMessage = {
      id: "demo-amora-welcome",
      couple_id: coupleId,
      sender_id: null,
      sender_role: "ai",
      visibility: "shared",
      content: AMORA_DEMO_WELCOME,
      metadata: {},
      created_at: new Date().toISOString(),
    };

    useChatStore.setState((state) => ({
      initialLoadDone: true,
      messages: state.messages.length > 0 ? state.messages : [welcomeMessage],
      suggestions:
        state.suggestions.length > 0
          ? state.suggestions
          : [...AMORA_DEMO_SUGGESTIONS],
      artifactVisibility: "shared",
      error: null,
    }));
  }, [coupleId, isDemo, profile]);

  // 메시지 로드 + 구독
  useEffect(() => {
    if (!coupleId || isDemo) return;
    loadMessages(coupleId);
    const unsubscribe = subscribeToMessages(coupleId);
    return () => {
      unsubscribe();
    };
  }, [coupleId, isDemo, loadMessages, subscribeToMessages]);

  // 모멘트 루프/라이프사이클 proactive 체크 — 채팅 진입 시 1회 fire-and-forget.
  // 발화 시 서버가 chat_messages에 INSERT → Realtime 구독·3초 폴링으로 자연 수신.
  // 중복 발화는 서버측 dedupeKey 유니크 인덱스 + 6시간 쿨다운이 막아줌.
  const proactiveCheckedRef = useRef(false);
  useEffect(() => {
    if (!coupleId || isDemo || proactiveCheckedRef.current || tasteReviewVisitRef.current) return;
    proactiveCheckedRef.current = true;
    void requestProactiveCare();
  }, [coupleId, isDemo]);

  // 탭 복귀 시 놓친 메시지 safety-net fetch (Realtime 구독이 백그라운드에서
  // 끊겼을 때 커버). 단:
  // 1) 마지막 fetch 후 60초 이내면 skip (pollNewMessages 가 3초마다 돌고 있어
  //    잠깐 탭 전환은 굳이 재fetch 불필요)
  // 2) loadMessages 가 messages 배열을 새로 set 하면서 메시지 컨테이너의
  //    scrollTop 이 reset 되는 부수효과 → 사용자가 보던 위치가 맨 위로
  //    날아감. fetch 전에 scrollTop 저장 → fetch 후 복원.
  const lastVisibilityFetchRef = useRef(0);
  useEffect(() => {
    if (!coupleId || isDemo) return;
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibilityFetchRef.current < 60_000) return; // 60s throttle
      lastVisibilityFetchRef.current = now;

      // 현재 스크롤 위치 저장
      const el = messagesContainerRef.current;
      const prevScrollTop = el?.scrollTop ?? 0;
      const prevWasNearBottom = el
        ? el.scrollHeight - el.scrollTop - el.clientHeight < 120
        : true;

      await pollNewMessages(coupleId);

      // 복원 — DOM update 후 다음 frame 에서
      requestAnimationFrame(() => {
        const elNow = messagesContainerRef.current;
        if (!elNow) return;
        if (prevWasNearBottom) {
          elNow.scrollTop = elNow.scrollHeight;
        } else {
          elNow.scrollTop = prevScrollTop;
        }
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [coupleId, isDemo, pollNewMessages]);

  // Realtime 폴링 안전망 — 3초마다 새 메시지 fetch
  // (Realtime 구독이 작동 안 할 경우 최대 3초 딜레이로 동기화 보장)
  useEffect(() => {
    if (!coupleId || isDemo) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        pollNewMessages(coupleId);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [coupleId, isDemo, pollNewMessages]);

  // 라운지에서 만들어 둔 첫마디를 가져온다. 가져오면 보관에서는 지워진다 —
  // 인사는 한 번만 건넨다.
  useEffect(() => {
    const ownerId = profile?.id;
    if (!ownerId || isDemo) {
      setFirstHelloChecked(true);
      return;
    }
    const delivered = consumePendingAmoraFirstHello({ ownerId });
    if (delivered) setFirstHello(delivered);
    setFirstHelloChecked(true);
  }, [isDemo, profile?.id]);

  // 메시지 0개 + 로딩 완료 시 AI 첫 인사
  useEffect(() => {
    if (
      !coupleId ||
      tasteReviewVisitRef.current ||
      !profile ||
      isDemo ||
      // 모델 첫 인사는 서버가 '함께 대화' 레인에 저장한다. 레인을 고르기 전이나 '나만'을
      // 보고 있을 때 부르면, 고르지도 않은 레인에 대화가 먼저 생긴다(2026-09-26).
      !laneReady ||
      activeTab !== "shared" ||
      // 아모라가 첫 실행 안내 직후 이미 먼저 말을 걸어뒀다. 여기서 또 인사를
      // 요청하면 같은 자리에 인사가 두 번 뜬다.
      !firstHelloChecked ||
      firstHello ||
      greetingBody ||
      !initialLoadDone ||
      isStreaming ||
      messages.length > 0 ||
      greetingRequested.current
    )
      return;

    greetingRequested.current = true;

    requestInitialGreeting({
      coupleId,
      senderRole: profile.role ?? "bride",
      senderName: profile.name ?? "사용자",
      weddingContext: {
        weddingDate: journey?.wedding_date ?? null,
        budget: journey?.total_budget ?? 0,
        venue: journey?.venue ?? null,
        progress: journey?.progress ?? {},
      },
    });
  }, [coupleId, profile, journey, initialLoadDone, messages.length, isStreaming, requestInitialGreeting, isDemo, firstHello, firstHelloChecked, laneReady, activeTab, greetingBody]);

  // '나만 (상담)'으로 시작하는 처음 온 사람에게도 인사를 건넨다. 모델 인사는 함께 대화
  // 레인에 저장되므로 부르지 않고, 라운지 첫마디와 같은 결정적 문장을 이 화면에만 놓는다.
  // 파트너 초대 줄은 붙이지 않는다(나만 레인에서 "두 사람이 같은 화면을 봐요"는 어긋난다).
  useEffect(() => {
    if (
      !coupleId ||
      tasteReviewVisitRef.current ||
      !profile ||
      isDemo ||
      !laneReady ||
      activeTab !== "private" ||
      !firstHelloChecked ||
      greetingBody ||
      !initialLoadDone ||
      messages.length > 0 ||
      greetingRequested.current
    )
      return;
    const hello = buildAmoraFirstHello({
      weddingDate: journey?.wedding_date ?? null,
      preparationStage: readPreparationStage(journey?.progress),
      now: Date.now(),
    });
    setLaneGreeting({ identity: composerIdentity, body: hello.body });
  }, [activeTab, composerIdentity, coupleId, firstHelloChecked, greetingBody, initialLoadDone, isDemo, journey, laneReady, messages.length, profile]);

  // 2026-09-04: 첫 인사가 실패하면 `greetingRequested` 가 잠긴 채 "새로고침" 말고는
  // 길이 없었다 — 새 커플의 첫 화면이 막다른 길이었다. 같은 인자로 한 번 더 부른다.
  const retryInitialGreeting = useCallback(() => {
    if (!coupleId || !profile || isDemo || isStreaming) return;
    useChatStore.setState({ error: null });
    greetingRequested.current = true;
    requestInitialGreeting({
      coupleId,
      senderRole: profile.role ?? "bride",
      senderName: profile.name ?? "사용자",
      weddingContext: {
        weddingDate: journey?.wedding_date ?? null,
        budget: journey?.total_budget ?? 0,
        venue: journey?.venue ?? null,
        progress: journey?.progress ?? {},
      },
    });
  }, [coupleId, isDemo, isStreaming, journey, profile, requestInitialGreeting]);

  // 자동 스크롤 정책 — 페이지 전체는 절대 안 건드림, 메시지 컨테이너만 움직임.
  // 이전 사고: scrollIntoView()가 부모 체인 모두 끌고 내려가서 페이지까지 같이 움직임.
  // 해결: el.scrollTo / el.scrollTop 로 컨테이너만 스크롤 (페이지 영향 없음).
  //
  // 자동 동작:
  //   1) 첫 진입 시 1회 — 가장 아래로 즉시 스크롤 (컨테이너만)
  //   2) 본인이 보낸 메시지 — 컨테이너 바닥으로 부드럽게
  //   3) AI streaming 중 — 사용자가 바닥 근처(<120px)면 따라 내려감, 위면 가만히
  //   4) AI 응답 완료 직후 — 사용자가 바닥 근처면 한 번 더 바닥으로 (잘림 방지)
  //   5) "↓" 플로팅 버튼 — 사용자가 직접 누르면 바닥으로

  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const hasInitialScrolledRef = useRef(false);

  // 메시지 검색 — 헤더 검색 바, 클라 사이드 필터
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [communityDraft, setCommunityDraft] = useState<CommunityAskDraft | null>(null);
  const [communityPosting, setCommunityPosting] = useState(false);
  const [communityPostError, setCommunityPostError] = useState<string | null>(null);
  const [communityPromptMessageIds, setCommunityPromptMessageIds] = useState<Set<string>>(() => new Set());
  const hasBlockingDialog = Boolean(communityDraft || pendingSend || clearStep !== "closed");

  closeActiveDialogRef.current = () => {
    if (communityDraft) {
      setCommunityDraft(null);
      return;
    }
    if (pendingSend) {
      setPendingSend(null);
      return;
    }
    setClearStep("closed");
  };

  useEffect(() => {
    if (!hasBlockingDialog) return;

    const dialog = activeDialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const initialControl = dialog?.querySelector<HTMLElement>("[data-modal-initial-focus]")
      ?? dialog?.querySelector<HTMLElement>(focusableSelector);
    initialControl?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveDialogRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [hasBlockingDialog]);

  // 컨테이너 스크롤 추적 — 바닥 근처 여부 + ↓ 버튼 표시
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = distanceFromBottom < 120;
      // 240px 이상 위로 올라가 있으면 ↓ 버튼 표시 (가까이 있을 땐 굳이 안 띄움)
      setShowJumpToBottom(distanceFromBottom > 240);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // 컨테이너 스크롤 헬퍼 — el.scrollTo / scrollTop 직접 만지는 것 자체는 페이지에
  // 영향이 없지만, 새 메시지 렌더링 중에 autoFocus / 이미지 로딩 / scroll anchoring
  // 등 부수효과로 window.scrollY가 함께 움직이는 케이스가 있음. 컨테이너 스크롤
  // 전후에 window.scrollY 를 캡처·복원해 페이지가 절대 안 움직이도록 잠금.
  // (effect보다 위에 선언 — TDZ 방지)
  const scrollContainerToBottom = useCallback((smooth: boolean) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const prevPageY = window.scrollY;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    // 같은 tick + 다음 frame 두 번 복원 — 동기/비동기 페이지 스크롤 모두 잡음
    if (window.scrollY !== prevPageY) window.scrollTo({ top: prevPageY, behavior: "auto" });
    requestAnimationFrame(() => {
      if (window.scrollY !== prevPageY) window.scrollTo({ top: prevPageY, behavior: "auto" });
    });
  }, []);

  // 첫 진입 1회 — 메시지 처음 보일 때 컨테이너만 바닥으로 (페이지 스크롤 절대 안 건드림)
  useEffect(() => {
    if (hasInitialScrolledRef.current) return;
    if (messages.length === 0) return;
    scrollContainerToBottom(false);
    hasInitialScrolledRef.current = true;
    lastMsgCountRef.current = messages.length;
  }, [messages.length, scrollContainerToBottom]);

  // 본인이 방금 보낸 메시지면 컨테이너만 부드럽게 바닥으로 + streaming follow 모드 활성.
  // AI/파트너 메시지에는 적용 안 함 (위에서 옛날 대화 읽고 있을 수 있어서).
  useEffect(() => {
    const prevCount = lastMsgCountRef.current;
    const currCount = messages.length;
    lastMsgCountRef.current = currCount;
    if (currCount <= prevCount) return;
    const last = messages[currCount - 1];
    if (!last) return;
    if (last.sender_id !== profile?.id) return;
    // 본인이 보낸 메시지 → 응답을 보고 싶다는 명시적 의사. streaming 동안 따라감.
    followStreamRef.current = true;
    requestAnimationFrame(() => scrollContainerToBottom(true));
  }, [messages, profile?.id, scrollContainerToBottom]);

  // 사용자 wheel/touch 로 위로 스크롤 시 follow 즉시 해제 — 옛 메시지 읽기 가능.
  // 프로그래매틱 스크롤은 wheel/touchmove 이벤트를 발생시키지 않으므로 분리됨.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) followStreamRef.current = false; // 위로 스크롤
    };
    const handleTouch = () => {
      // 터치 드래그 시작 → 사용자가 직접 조작. follow 중단.
      followStreamRef.current = false;
    };
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("touchmove", handleTouch, { passive: true });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchmove", handleTouch);
    };
  }, []);

  const jumpToBottom = useCallback(() => {
    scrollContainerToBottom(true);
  }, [scrollContainerToBottom]);

  // AI streaming 중 — followStreamRef 가 true 일 때만 컨테이너 바닥으로 따라감.
  // 사용자가 메시지 보내면 follow=true 가 되고, wheel/touch 로 올리면 false 로 풀림.
  // 매 토큰마다 강제 yank 하던 race-condition 회피 (codex P2 review fix).
  useEffect(() => {
    if (!isStreaming) return;
    if (!followStreamRef.current) return;
    scrollContainerToBottom(false);
  }, [isStreaming, streamingContent, scrollContainerToBottom]);

  // AI 응답 완료 직후 — true → false 전환에서 한 번 더 부드럽게 바닥으로,
  // 단 사용자가 아직 follow 모드일 때만. 그 후 follow 해제.
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (!wasStreaming || isStreaming) return;
    if (followStreamRef.current) {
      requestAnimationFrame(() => scrollContainerToBottom(true));
    }
    followStreamRef.current = false; // 응답 완료 → 다음 발화까지 자동 follow 안 함
  }, [isStreaming, scrollContainerToBottom]);

  // 글로벌 붙여넣기 이벤트 (document level)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("textarea,input,[contenteditable='true']")) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        addFilesRef.current(files);
      }
    };

    document.addEventListener("paste", handleGlobalPaste);
    return () => document.removeEventListener("paste", handleGlobalPaste);
  }, []);

  // 파일을 첨부 목록에 추가하는 공통 함수
  const addFiles = useCallback((files: File[]) => {
    // 레인을 정하기 전에는 첨부를 받지 않는다. 받으면 보이지 않는 레인 입력창에 쌓인다.
    if (!laneReady) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) return;
    const originLane = activeComposerLane;
    const originEpoch = composerEpochRef.current;
    const originPartnerEpoch = partnerComposerEpochRef.current;
    const originPartnerRecipientId = originLane === "shared_partner"
      ? linkedPartnerIdRef.current
      : null;
    const originVisibility = activeArtifactVisibility;

    uniqueFiles(files).slice(0, remaining).forEach((file) => {
      const typeInfo = ALLOWED_TYPES[file.type];
      if (!typeInfo) {
        useChatStore.setState({
          error: `지원하지 않는 파일 형식이에요: ${file.name} (이미지, PDF, DOCX만 가능해요.)`,
          artifactVisibility: originVisibility,
        });
        return;
      }
      if (originLane === "shared_partner" && !file.type.startsWith("image/")) {
        useChatStore.setState({
          error: "PDF·Word 문서는 아모라에게만 첨부할 수 있어요. 아모라에게 전환해 분석을 요청해주세요.",
          artifactVisibility: "shared",
        });
        return;
      }
      if (file.size > typeInfo.maxSize) {
        useChatStore.setState({
          error: `${typeInfo.label} 파일은 ${typeInfo.maxSize / 1024 / 1024}MB 이하로 줄인 뒤 다시 첨부해주세요.`,
          artifactVisibility: originVisibility,
        });
        return;
      }

      const reader = new FileReader();
      let readFinished = false;
      const originIsStillValid = () => (
        composerEpochRef.current === originEpoch
        && (
          originLane !== "shared_partner"
          || (
            hasLinkedPartnerRef.current
            && originPartnerRecipientId !== null
            && partnerComposerEpochRef.current === originPartnerEpoch
            && linkedPartnerIdRef.current === originPartnerRecipientId
          )
        )
      );
      const finishRead = () => {
        if (readFinished) return;
        readFinished = true;
        if (
          composerEpochRef.current === originEpoch
          && (
            originLane !== "shared_partner"
            || partnerComposerEpochRef.current === originPartnerEpoch
          )
        ) {
          adjustPendingAttachmentReads(originLane, -1);
        }
      };
      adjustPendingAttachmentReads(originLane, 1);
      reader.onload = () => {
        try {
          if (!originIsStillValid()) return;
          const result = reader.result;
          if (typeof result !== "string" || !result.includes(",")) {
            useChatStore.setState({
              error: CHAT_ATTACHMENT_SNAPSHOT_ERROR,
              artifactVisibility: originVisibility,
            });
            return;
          }
          const base64 = result.split(",")[1];
          const isImage = file.type.startsWith("image/");
          const previewUrl = isImage ? URL.createObjectURL(file) : `file:${file.type}:${file.name}`;
          const attachment = { base64, mediaType: file.type, previewUrl, fileName: file.name };

          setDraftAttachments(originLane, (prev) => {
            if (prev.length >= MAX_ATTACHMENTS) {
              revokeObjectPreview(previewUrl);
              return prev;
            }
            const key = chatAttachmentKey(attachment);
            if (prev.some((item) => chatAttachmentKey(item) === key)) {
              revokeObjectPreview(previewUrl);
              return prev;
            }
            return [...prev, attachment];
          });
        } finally {
          finishRead();
        }
      };
      reader.onerror = () => {
        if (originIsStillValid()) {
          useChatStore.setState({
            error: CHAT_ATTACHMENT_SNAPSHOT_ERROR,
            artifactVisibility: originVisibility,
          });
        }
        finishRead();
      };
      try {
        reader.readAsDataURL(file);
      } catch {
        if (originIsStillValid()) {
          useChatStore.setState({
            error: CHAT_ATTACHMENT_SNAPSHOT_ERROR,
            artifactVisibility: originVisibility,
          });
        }
        finishRead();
      }
    });
  }, [
    activeArtifactVisibility,
    activeComposerLane,
    adjustPendingAttachmentReads,
    attachments.length,
    laneReady,
    setDraftAttachments,
  ]);

  // ref 업데이트 (글로벌 paste에서 최신 addFiles 참조)
  useEffect(() => {
    addFilesRef.current = addFiles;
  }, [addFiles]);

  // 파일 선택 핸들러
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = "";
  }, [addFiles]);

  // 복사/붙여넣기 핸들러
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      addFiles(files);
    }
  }, [addFiles]);

  // 드래그 앤 드롭 핸들러
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  }, [addFiles]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed && removed.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, [setAttachments]);

  // 파트너 typing freshness — broadcast 후 5초 안 → "지금 입력 중"으로 간주
  const partnerTypingActive =
    !!presence.partnerTyping && nowMs > 0 && nowMs - presence.partnerTyping.updated_at < 5000;
  // 입력 중 안내 문장에 쓰는 상대 이름(빈 이름이면 "상대방"). 조사는 받침을 보고 고른다.
  const partnerDisplayName = partner?.name?.trim() || "상대방";

  // AI 응답 중 추론 — 마지막 shared 메시지가 사람이고 30초 이내면 AI 응답 중.
  // ⚠️ "상대방에게" 보낸 메시지(metadata.target === "partner")는 제외 — 그건 AI 가
  // 호출되지 않고 단순 커플 간 대화이므로 응답 대기 표시되면 안 됨.
  // 서버 측 갈등 감지기는 별도로 돌고, 트리거되면 mediation 메시지로 자동 등장.
  const aiResponding = (() => {
    if (nowMs === 0) return null;
    const sharedMessages = messages.filter(
      (m) => m.visibility === "shared" && m.metadata?.target !== "partner"
    );
    const last = sharedMessages[sharedMessages.length - 1];
    if (!last || last.sender_role === "ai") return null;
    const ageMs = nowMs - new Date(last.created_at).getTime();
    if (ageMs > 30_000) return null;
    return { triggered_by_user_id: last.sender_id, triggered_at: last.created_at };
  })();

  const handleSend = useCallback(
    async (text?: string, targetOverride?: ChatMessageTarget) => {
      if (isStreaming || isSending || sendInFlightRef.current !== null) return;
      // 레인을 정하기 전에는 보내지 않는다. 입력창·칩·카드 어느 길로 와도 여기서 멈춘다.
      if (!laneReady) return;
      const usesComposer = text === undefined;
      const content = usesComposer ? input.trim() : text;
      const currentAttachments = usesComposer ? [...attachments] : [];
      const sourceLane = activeComposerLane;
      const submittedPreparation = usesComposer ? composerDraftsRef.current[sourceLane].preparation : null;
      const submittedClientRequestId = usesComposer ? retryClientRequestId : null;
      if (
        (!content && currentAttachments.length === 0)
        || !coupleId
        || !profile
        || !senderRole
        || (usesComposer && pendingAttachmentReads > 0)
      ) return;
      // A private composer has no partner-directed lane. Even nested cards or
      // future callers cannot override this privacy boundary.
      const sendTarget = isPrivate ? "ai" : targetOverride ?? messageTarget;
      const submittedPartnerEpoch = partnerComposerEpochRef.current;
      const submittedPartnerRecipientId = sendTarget === "partner"
        ? linkedPartnerId
        : null;
      const partnerRecipientIsStillCurrent = () => (
        sendTarget !== "partner"
        || (
          submittedPartnerRecipientId !== null
          && partnerComposerEpochRef.current === submittedPartnerEpoch
          && linkedPartnerIdRef.current === submittedPartnerRecipientId
        )
      );
      const requestedVisibility = isPrivate && sendTarget === "ai"
        ? (senderRole === "groom" ? "groom_private" : "bride_private")
        : "shared";
      const crisisPreflight = planAmoraCrisisDelivery({
        userText: content ?? "",
        requestedVisibility,
        target: sendTarget,
        senderRole,
        // 2026-09-03: 스토어(`chatStore.sendMessage`)와 서버가 이미 이 신호로
        // 레인을 정하는데 화면만 안 넘겨서, 폭력·강압 서술이 나만 보기 레인으로
        // 옮겨진 것을 화면이 몰랐다. 그 결과 함께 대화 탭에 내 말풍선도 아모라
        // 답도 오류도 안 뜨고 입력창만 비었다. 안전 판정을 바꾸는 것이 아니라
        // 화면을 이미 내려진 판정에 맞추는 것이다.
        externalSafetySignal: hasAmoraSafetySignal(content ?? "", "chat"),
      });
      const visibility = crisisPreflight.effectiveVisibility;
      const isLocalSafetyHold = crisisPreflight.disposition === "local_safety_hold";
      const isPrivateSafetyRoute = crisisPreflight.disposition === "private_safety_route";
      const canTransmitAttachments = crisisPreflight.disposition === "continue";
      const submittedLane = isPrivateSafetyRoute ? "private_ai" : sourceLane;
      if (!isLocalSafetyHold && sendTarget === "partner" && !hasLinkedPartner) {
        setMessageTarget("ai");
        useChatStore.setState({
          error: "연결된 상대방이 없어 보내지 않았어요. 상대방 연결을 다시 확인해주세요.",
          artifactVisibility: "shared",
        });
        return;
      }
      if (
        canTransmitAttachments
        &&
        sendTarget === "partner"
        && currentAttachments.some((attachment) => !attachment.mediaType.startsWith("image/"))
      ) {
        useChatStore.setState({
          error: "PDF·Word 문서는 아모라에게만 첨부할 수 있어요. 아모라에게 전환해 분석을 요청해주세요.",
          artifactVisibility: "shared",
        });
        return;
      }

      const submittedInput = usesComposer ? input : "";
      const submittedEpoch = composerEpochRef.current;
      if (canTransmitAttachments) {
        const attachmentCheck = prepareChatAttachmentPayload(currentAttachments);
        if (!attachmentCheck.ok) {
          useChatStore.setState({
            error: attachmentCheck.error,
            artifactVisibility: visibility,
          });
          return;
        }
      }

      /**
       * 안전 홀드로 멈춘 글을 작성창에 되돌린다.
       *
       * 2026-09-03: 홀드는 원문을 어디에도 저장하지 않는 계약이라(그건 그대로 둔다)
       * 전송 직전에 비운 작성창을 아무도 되돌리지 않았다. 오탐으로 걸린 사람은
       * 방금 친 문장을 통째로 다시 타이핑해야 했다. 형제 갈래(persistence_unknown ·
       * not_persisted · catch)는 모두 `restoreComposer` 를 부른다.
       *
       * 되돌리는 곳은 보낸 레인이 아니라 `private_ai` 다 — 같은 갈래가 곧바로
       * '나만 (상담)' 으로 옮겨 가므로, 보낸 레인에 넣으면 사용자가 보지 않는
       * 작성창에 글이 들어간다. 첨부는 이미 폐기했으니 텍스트만 되돌린다.
       */
      const restoreHeldComposerText = () => {
        if (!usesComposer || !submittedInput) return;
        if (composerEpochRef.current !== submittedEpoch) return;
        setComposerDrafts((currentDrafts) => {
          const currentDraft = currentDrafts.private_ai;
          if (currentDraft.input) return currentDrafts;
          return {
            ...currentDrafts,
            private_ai: { ...currentDraft, input: submittedInput },
          };
        });
      };

      const restoreComposer = (clientRequestId: string | null) => {
        if (
          isPrivateSafetyRoute
          ||
          !usesComposer
          || composerEpochRef.current !== submittedEpoch
          || !partnerRecipientIsStillCurrent()
        ) return;
        setComposerDrafts((currentDrafts) => {
          const currentDraft = currentDrafts[submittedLane];
          const existingKeys = new Set(currentDraft.attachments.map(chatAttachmentKey));
          return {
            ...currentDrafts,
            [submittedLane]: {
              ...currentDraft,
              input: currentDraft.input || submittedInput,
              preparation: currentDraft.input ? currentDraft.preparation : submittedPreparation,
              attachments: [
                ...currentDraft.attachments,
                ...currentAttachments.filter(
                  (attachment) => !existingKeys.has(chatAttachmentKey(attachment)),
                ),
              ],
              retryClientRequestId: clientRequestId,
            },
          };
        });
      };

      // 기본 메시지 생성
      let defaultMsg = "";
      if (!content && currentAttachments.length > 0) {
        if (sendTarget === "partner") {
          defaultMsg = "파일을 보냈어요. 확인해줘.";
        } else {
          const hasDocument = currentAttachments.some(
            (attachment) => !attachment.mediaType.startsWith("image/"),
          );
          defaultMsg = hasDocument ? "이 문서를 분석해주세요." : "이 이미지를 분석해주세요.";
        }
      }

      sendInFlightRef.current = submittedEpoch;
      if (activeTab === "shared") stopSharedTyping();
      if (usesComposer) {
        setComposerDrafts((currentDrafts) => ({
          ...currentDrafts,
          [sourceLane]: {
            ...currentDrafts[sourceLane],
            input: "",
            preparation: null,
            attachments: [],
            retryClientRequestId: submittedClientRequestId,
          },
        }));
      }
      if (isPrivateSafetyRoute) {
        setActiveTab("private");
        setMessageTarget("ai");
        currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
      }

      // 2026-09-26: 화면 사전 판정은 `continue` 였는데 서버가 나만 레인으로 옮긴 경우. 스토어가
      // 저장 직후(답을 기다리기 전) 알려 주면 곧바로 옮기고, 그 알림이 없었으면 결과를 보고 옮긴다.
      // 안 옮기면 함께 탭에 남은 사용자는 말풍선도 답도 안내도 못 본다.
      let serverPrivacyRedirectShown = false;
      const showServerPrivacyRedirect = () => {
        serverPrivacyRedirectShown = true;
        setActiveTab("private");
        setMessageTarget("ai");
      };
      try {
        const outcome = await sendMessage({
          onSafetyPrivacyRedirect: showServerPrivacyRedirect,
          content: content || defaultMsg,
          senderId: profile.id,
          senderRole,
          coupleId,
          senderName: profile.name ?? "사용자",
          weddingContext: {
            weddingDate: journey?.wedding_date ?? null,
            budget: journey?.total_budget ?? 0,
            venue: journey?.venue ?? null,
            progress: journey?.progress ?? {},
          },
          // 2026-09-03: 비공개 안전 레인에서도 첨부 목록은 그대로 넘긴다. 스토어가
          // 이 갈래에서 첨부를 통째로 버리므로 실제 전송·업로드는 0건이고, 대신
          // 안내 카드가 "첨부 파일은 안전을 위해 전송하지 않았어요" 를 붙일 수 있다.
          // 안 넘기면 사진이 아무 말 없이 사라진다.
          images: (canTransmitAttachments || isPrivateSafetyRoute)
            && currentAttachments.length > 0
            ? currentAttachments
            : undefined,
          target: sendTarget,
          ...(sendTarget === "partner" && linkedPartnerId
            ? { partnerRecipientId: linkedPartnerId }
            : {}),
          visibility,
          ...(submittedPreparation && sourceLane === "shared_ai" && sendTarget === "ai" && !isPrivateSafetyRoute
            ? { preparationSource: submittedPreparation.source } : {}),
          ...(submittedClientRequestId
            ? { clientRequestId: submittedClientRequestId }
            : {}),
        });
        if (outcome?.userMessage === "ephemeral_safety") {
          setActiveTab("private");
          setMessageTarget("ai");
          setDraftRetryClientRequestId(submittedLane, null);
          restoreHeldComposerText();
          currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
          return;
        }
        if (!partnerRecipientIsStillCurrent()) {
          currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
          return;
        }
        if (outcome?.userMessage === "persistence_unknown") {
          restoreComposer(outcome.clientRequestId);
          return;
        }
        if (outcome?.userMessage === "not_persisted") {
          restoreComposer(submittedClientRequestId);
          return;
        }
        if (
          outcome?.userMessage === "persisted"
          && !isPrivateSafetyRoute
          && !serverPrivacyRedirectShown
          && (
            outcome.safetyPrivacyRedirected === true
            || outcome.effectiveVisibility === "bride_private"
            || outcome.effectiveVisibility === "groom_private"
          )
        ) {
          showServerPrivacyRedirect();
        }
        if (usesComposer && composerEpochRef.current === submittedEpoch) {
          setDraftRetryClientRequestId(sourceLane, null);
        }
        currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
      } catch {
        if (!partnerRecipientIsStillCurrent()) {
          currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
          return;
        }
        restoreComposer(submittedClientRequestId);
        useChatStore.setState((state) => ({
          error:
            state.artifactVisibility === visibility && state.error
              ? state.error
              : "메시지를 저장하지 못했습니다. 입력 내용을 복구했어요.",
          artifactVisibility: visibility,
        }));
      } finally {
        if (composerEpochRef.current !== submittedEpoch) {
          currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
        }
        if (sendInFlightRef.current === submittedEpoch) {
          sendInFlightRef.current = null;
        }
      }
    },
    [
      input,
      attachments,
      coupleId,
      profile,
      senderRole,
      journey,
      sendMessage,
      messageTarget,
      activeComposerLane,
      retryClientRequestId,
      pendingAttachmentReads,
      isPrivate,
      activeTab,
      hasLinkedPartner,
      linkedPartnerId,
      isStreaming,
      isSending,
      laneReady,
      setDraftRetryClientRequestId,
      stopSharedTyping,
    ]
  );

  const applyPendingAmoraAction = useCallback(async (actionId: string) => {
    if (
      applyingPendingActionRef.current
      || !coupleId
      || !profile
      || (profile.role !== "bride" && profile.role !== "groom")
    ) return;

    // Re-read the shared store at click time. A stale rendered card must never
    // authorize an action after any newer shared message or after expiry.
    const current = useChatStore.getState();
    if (current.isStreaming || current.isSending) return;
    const latestSharedMessage = [...current.messages]
      .reverse()
      .find((message) => (
        message.visibility === "shared"
        && message.metadata?.target !== "partner"
      ));
    if (!latestSharedMessage) return;
    const action = getPendingAmoraAction(latestSharedMessage);
    if (
      !action
      || action.actionId !== actionId
      || isPendingAmoraActionExpired(action, Date.now())
    ) return;

    applyingPendingActionRef.current = actionId;
    setApplyingPendingActionId(actionId);
    try {
      await sendMessage({
        content: "좋아요. 제안한 변경을 적용해 주세요.",
        senderId: profile.id,
        senderRole: profile.role,
        coupleId,
        senderName: profile.name ?? "사용자",
        weddingContext: {
          weddingDate: journey?.wedding_date ?? null,
          budget: journey?.total_budget ?? 0,
          venue: journey?.venue ?? null,
          progress: journey?.progress ?? {},
        },
        target: "ai",
        visibility: "shared",
        confirmedActionId: actionId,
      });
    } finally {
      applyingPendingActionRef.current = null;
      setApplyingPendingActionId(null);
    }
  }, [coupleId, journey, profile, sendMessage]);

  /**
   * 대기열 카드의 "이 항목 건너뛰기" (2026-09-18).
   *
   * 고정 문장(`AMORA_QUEUED_CARD_SKIP_TEXT`)을 공유 대화로 보낸다. `confirmedActionId` 는
   * 보내지 않는다 — 이것은 적용이 아니다. 서버는 이 문장일 때만 지금 카드를 반영하지 않고
   * 다음 항목을 새 확인 카드로 낸다. 적용과 같은 이유로 누르는 순간의 최신 카드를 다시 읽는다.
   */
  const skipQueuedAmoraAction = useCallback(async (actionId: string) => {
    if (
      applyingPendingActionRef.current
      || skippingPendingActionRef.current
      || !coupleId
      || !profile
      || (profile.role !== "bride" && profile.role !== "groom")
    ) return;

    const current = useChatStore.getState();
    if (current.isStreaming || current.isSending) return;
    const latestSharedMessage = [...current.messages]
      .reverse()
      .find((message) => (
        message.visibility === "shared"
        && message.metadata?.target !== "partner"
      ));
    if (!latestSharedMessage) return;
    const action = getPendingAmoraAction(latestSharedMessage);
    if (
      !action
      || action.actionId !== actionId
      || isPendingAmoraActionExpired(action, Date.now())
      || getQueuedRemainingCount(latestSharedMessage, actionId) === 0
    ) return;

    skippingPendingActionRef.current = actionId;
    try {
      await sendMessage({
        content: AMORA_QUEUED_CARD_SKIP_TEXT,
        senderId: profile.id,
        senderRole: profile.role,
        coupleId,
        senderName: profile.name ?? "사용자",
        weddingContext: {
          weddingDate: journey?.wedding_date ?? null,
          budget: journey?.total_budget ?? 0,
          venue: journey?.venue ?? null,
          progress: journey?.progress ?? {},
        },
        target: "ai",
        visibility: "shared",
      });
    } finally {
      skippingPendingActionRef.current = null;
    }
  }, [coupleId, journey, profile, sendMessage]);

  const dismissPendingAmoraAction = useCallback((actionId: string) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const epoch = composerEpochRef.current;
    const lane = activeComposerLaneRef.current;
    setDismissedPendingMessageIds((current) => {
      const next = new Set(current);
      // 지금 보이는 같은 제안만 미룬다. 새 답변으로 다시 받은 카드는
      // 원래 actionId·서명을 유지해도 확인할 수 있어야 한다.
      for (const message of messages) {
        if (getPendingAmoraAction(message)?.actionId === actionId) next.add(message.id);
      }
      return next.size === current.size ? current : next;
    });
    if (!previousFocus || previousFocus === document.body) return;

    // 시트와 진입 카드가 함께 사라지면 같은 상담의 입력창으로 돌아간다.
    // 그사이 다른 곳을 선택했다면 사용자의 새 초점을 우선한다.
    let focusMoved = false;
    const trackFocus = () => { focusMoved = true; };
    document.addEventListener("focusin", trackFocus);
    requestAnimationFrame(() => {
      document.removeEventListener("focusin", trackFocus);
      if (focusMoved || previousFocus.isConnected
        || document.activeElement !== document.body
        || composerEpochRef.current !== epoch
        || activeComposerLaneRef.current !== lane) return;
      textareaRef.current?.focus();
    });
  }, [messages]);

  const openCommunityDraft = useCallback((aiMessage: ChatMessage, userMessage: ChatMessage) => {
    if (!SHOW_SIGNED_IN_COMMUNITY) return;
    const privacyMode: CommunityDraftPrivacyMode =
      aiMessage.visibility === "shared" && userMessage.visibility === "shared"
        ? "shared"
        : "redacted_private";
    setCommunityDraft(buildCommunityAskDraft(userMessage.content, aiMessage.content, aiMessage.id, privacyMode));
    setCommunityPostError(null);
  }, []);

  const markCommunityFallbackAvailable = useCallback((message: ChatMessage) => {
    setCommunityPromptMessageIds((prev) => {
      if (prev.has(message.id)) return prev;
      const next = new Set(prev);
      next.add(message.id);
      return next;
    });
  }, []);

  const submitCommunityDraft = useCallback(async () => {
    if (!SHOW_SIGNED_IN_COMMUNITY || !communityDraft || communityPosting) return;
    const sensitiveLabels = detectSensitiveText(`${communityDraft.title}\n${communityDraft.content}`);
    if (sensitiveLabels.length > 0) {
      setCommunityPostError(`먼저 ${sensitiveLabels.join(", ")} 표현을 지워주세요.`);
      return;
    }

    setCommunityPosting(true);
    setCommunityPostError(null);
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: communityDraft.category,
          title: communityDraft.title.trim(),
          content: communityDraft.content.trim(),
          images: [],
          visibility: "public",
          vendor_tags: [],
          tags: ["아모라상담"],
          ad_disclosure: "general",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "게시글 작성에 실패했습니다.");
      }
      const postId = typeof data?.post?.id === "string" ? data.post.id : null;
      setCommunityDraft((draft) => draft ? { ...draft, postedPostId: postId } : draft);
    } catch (err) {
      setCommunityPostError(err instanceof Error ? err.message : "게시글 작성에 실패했습니다.");
    } finally {
      setCommunityPosting(false);
    }
  }, [communityDraft, communityPosting]);

  const openMediationConsent = useCallback(() => {
    setMediationConsentOpen(true);
  }, []);

  const cancelMediationConsent = useCallback(() => {
    setMediationConsentOpen(false);
    setMediationDismissed(true);
  }, []);

  const confirmMediationConsent = useCallback(
    async (requesterSummary: string) => {
      if (
        !coupleId
        || !profile
        || (profile.role !== "bride" && profile.role !== "groom")
      ) return;
      setMediationConsentOpen(false);
      setMediationDismissed(true);
      setMessageTarget("ai");
      const outcome = await requestStructuredMediation({
        coupleId,
        senderRole: profile.role,
        senderName: profile.name ?? "사용자",
        weddingContext: {
          weddingDate: journey?.wedding_date ?? null,
          budget: journey?.total_budget ?? 0,
          venue: journey?.venue ?? null,
          progress: journey?.progress ?? {},
        },
        conflictContext: requesterSummary,
      });
      // 안전 홀드로 막히면 안내 카드가 **나만 보기 탭**에 들어간다. 옮겨 주지
      // 않으면 다이얼로그만 닫히고 화면은 그대로다 — 오류도, 안내도, 스피너도
      // 없어서 사용자는 버튼이 고장났다고 읽는다(2026-08-24 감사).
      //
      // 메시지 전송 경로에는 같은 전환이 이미 있다(`ephemeral_safety`).
      // 중재만 빠져 있었다.
      if (outcome === "safety_hold") {
        setActiveTab("private");
        setMessageTarget("ai");
      }
    },
    [coupleId, journey, profile, requestStructuredMediation],
  );

  // 사용자가 직접 send 버튼/엔터/제안 칩으로 보낼 때 게이트 — 파트너가 입력 중이거나
  // AI가 파트너 메시지에 응답 중이면 confirm 모달.
  const attemptSend = useCallback(
    (text?: string, targetOverride?: ChatMessageTarget) => {
      const content = text ?? input.trim();
      if (
        (!content && attachments.length === 0)
        || !coupleId
        || !profile
        || pendingAttachmentReads > 0
        || !laneReady
      ) return;
      const sendTarget = isPrivate ? "ai" : targetOverride ?? messageTarget;

      const aiByMe = aiResponding && aiResponding.triggered_by_user_id === profile.id;
      const partnerInteracting = partnerTypingActive || (aiResponding && !aiByMe);

      if (partnerInteracting) {
        setPendingSend({ text, target: sendTarget });
        return;
      }
      void handleSend(text, sendTarget);
    },
    [
      input,
      attachments.length,
      coupleId,
      profile,
      pendingAttachmentReads,
      isPrivate,
      laneReady,
      messageTarget,
      partnerTypingActive,
      aiResponding,
      handleSend,
    ]
  );
  const sendToAmora = useCallback(
    (text: string) => attemptSend(text, "ai"),
    [attemptSend],
  );

  const personalizationReply = resolveAmoraPersonalizationReply(
    messages,
    profile?.id ?? null,
    coupleId ?? null,
    pendingPersonalization,
  );
  const personalizationReplyMessageId =
    personalizationReply.replyMessageId;

  useEffect(() => {
    if (
      !profile?.id ||
      !coupleId ||
      !pendingPersonalization ||
      !initialLoadDone ||
      amoraPersonalization.status !== "ready" ||
      personalizationReply.state !== "stale"
    ) {
      return;
    }
    clearPendingAmoraPersonalizationChoice(profile.id, coupleId);
    setPendingPersonalization(null);
  }, [
    amoraPersonalization.status,
    coupleId,
    initialLoadDone,
    pendingPersonalization,
    personalizationReply.state,
    profile?.id,
  ]);

  const showPersonalizationConfirmation =
    activeTab === "shared" &&
    amoraPersonalization.status === "ready" &&
    !amoraPersonalization.profile &&
    Boolean(personalizationReplyMessageId) &&
    Boolean(pendingPersonalization) &&
    !isStreaming &&
    !isSending;
  const showAmoraQuickStart = shouldOfferAmoraQuickStart({
    enabled:
      !isDemo &&
      laneReady &&
      initialLoadDone &&
      Boolean(coupleId) &&
      Boolean(profile),
    status: amoraPersonalization.status,
    hasSavedProfile: Boolean(amoraPersonalization.profile),
    hasPendingChoice: Boolean(pendingPersonalization),
    busy:
      isStreaming ||
      isSending ||
      Boolean(aiResponding) ||
      partnerTypingActive ||
      input.trim().length > 0 ||
      attachments.length > 0,
    activeTab,
    currentUserId: profile?.id ?? null,
    messages,
  });

  const handlePersonalizationSelect = useCallback(
    (option: AmoraQuickStartOption) => {
      if (!showAmoraQuickStart || !profile || !coupleId) return;
      const pending = rememberPendingAmoraPersonalizationChoice({
        currentUserId: profile.id,
        coupleId,
        option,
        existingUserMessageIds: messages
          .filter(
            (message) =>
              message.sender_id === profile.id &&
              message.sender_role !== "ai",
          )
          .map((message) => message.id),
      });
      if (!pending) return;
      setPendingPersonalization(pending);
      setMessageTarget("ai");
      void handleSend(option.message, "ai");
    },
    [coupleId, handleSend, messages, profile, showAmoraQuickStart],
  );

  const confirmAmoraPersonalization = useCallback(async () => {
    if (!pendingPersonalization) return;
    const saved = await saveAmoraPersonalization(
      pendingPersonalization.option.changes,
    );
    if (saved) {
      clearPendingAmoraPersonalizationChoice(
        pendingPersonalization.ownerUserId,
        pendingPersonalization.coupleId,
      );
      setPendingPersonalization(null);
    }
  }, [pendingPersonalization, saveAmoraPersonalization]);

  const dismissAmoraPersonalization = useCallback(() => {
    if (pendingPersonalization) {
      clearPendingAmoraPersonalizationChoice(
        pendingPersonalization.ownerUserId,
        pendingPersonalization.coupleId,
      );
    }
    setPendingPersonalization(null);
  }, [pendingPersonalization]);

  // "새 채팅" 버튼 클릭 — activeTab 따라 적절한 modal 단계로
  const openNewChatModal = useCallback(() => {
    if (activeTab === "private") {
      setClearStep("private_confirm");
    } else {
      setClearStep("shared_choose");
    }
  }, [activeTab, setClearStep]);

  const submitSharedClearRequest = useCallback(async () => {
    if (!coupleId || !profile?.id || isDemo || activeTab !== "shared"
      || clearStep !== "shared_confirm_both" || clearRequestInFlightRef.current.has(composerIdentity)) return;
    const version = clearDialogVersionRef.current;
    const epoch = composerEpochRef.current;
    // 모달을 닫고 다시 열어도 같은 계정·커플의 미응답 요청은 한 번만 보낸다.
    clearRequestInFlightRef.current.add(composerIdentity);
    setPendingClearRequestOwners(current => new Set(current).add(composerIdentity));
    setClearRequestError(null);
    const stillCurrent = () => clearDialogVersionRef.current === version
      && composerEpochRef.current === epoch;
    try {
      const result = await requestSharedClear(coupleId);
      if (!stillCurrent()) return;
      if (result.ok) setClearStep("closed");
      else setClearRequestError("동의 요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } catch {
      if (stillCurrent()) setClearRequestError("동의 요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      clearRequestInFlightRef.current.delete(composerIdentity);
      setPendingClearRequestOwners(current => {
        const next = new Set(current);
        next.delete(composerIdentity);
        return next;
      });
    }
  }, [activeTab, clearStep, composerIdentity, coupleId, isDemo, profile?.id, requestSharedClear, setClearStep]);

  // 실제 clear 수행 — mode는 명시적으로 전달
  const performClear = useCallback(
    async (mode: "view_reset_shared" | "delete_shared" | "view_reset_private" | "delete_private") => {
      if (!coupleId) return;
      greetingRequested.current = false;
      try {
        await clearMessages(coupleId, mode);
        setClearStep("closed");
      } catch {
        // chatStore.error renders the failure; keep the modal open so the user can retry.
      }
    },
    [coupleId, clearMessages, setClearStep]
  );

  // 인증 부팅 전 — 빈 데이터로 잘못된 gate 노출 방지
  if (!authInitialized || authLoading) {
    return (
      <div
        className={`${embedded ? "h-full" : "h-[calc(100dvh-144px)]"} flex items-center justify-center bg-[#FAFAF8]`}
      >
        <Loader2 className="w-7 h-7 text-[var(--hb-accent-hover)] animate-spin" />
      </div>
    );
  }

  // 커플이 없는 경우 — 온보딩 안내 + actionable CTA
  if (!coupleId) {
    return (
      <div
        className={`${embedded ? "h-full" : "h-[calc(100dvh-144px)]"} max-w-[800px] mx-auto flex items-center justify-center bg-[#FAFAF8] px-4`}
      >
        <div className="text-center bg-white rounded-[6px] shadow-[var(--shadow-raised)] p-8 sm:p-10 max-w-md w-full">
          <AmoraAvatar sizeClassName="size-16" className="mb-4" />
          <h3 className="font-serif-kr text-[var(--hb-text-strong)] mb-2">
            아모라 상담 시작 전 한 단계만
          </h3>
          <p className="text-sm sm:text-base text-[var(--hb-text-body)] leading-relaxed mb-6">
            결혼식 정보를 한 번만 입력하시면, 아모라가 맞춤 상담을 시작합니다.
            (1분 정도 소요)
          </p>
          <a
            href={weddingPath("/onboarding")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-[6px] text-base font-medium text-white bg-[var(--hb-action)] hover:bg-[var(--hb-action-hover)] shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] transition-colors"
          >
            <AmoraMark className="w-4 h-4" />
            온보딩 시작하기
          </a>
        </div>
      </div>
    );
  }

  // 첨부 파일 아이콘 결정
  const getFileIcon = (mediaType: string) => {
    if (mediaType.includes("word") || mediaType === "application/msword") return <FileText className="w-7 h-7 text-[#4285F4]" />;
    if (mediaType.includes("spreadsheet") || mediaType.includes("ms-excel")) return <FileSpreadsheet className="w-7 h-7 text-[var(--hb-success)]" />;
    if (mediaType === "application/pdf") return <FileText className="w-7 h-7 text-[var(--hb-accent-hover)]" />;
    return <FileText className="w-7 h-7 text-[var(--hb-text-body)]" />;
  };

  const workspaceNavigation = !embedded ? <AmoraWorkspaceNav chatControls={{
    // 레인을 고르기 전에는 어느 탭도 눌린 것으로 보이지 않는다. 탭을 누르면 그게 선택이다.
    activeScope: laneReady ? activeTab : null,
    onScopeChange: chooseLane,
    disabled: isStreaming || isSending,
    privateDisabled: isDemo || !myPrivateVisibility,
    sharedCount: sharedMessageCount,
    privateCount: privateMessageCount,
    privateHint: isDemo
      ? "계정 이용 시 파트너 비공개 상담을 사용할 수 있어요"
      : "아모라와 1:1 — 상대방에게 보이지 않습니다",
  }} /> : null;

  return (
    <div
      className={`relative h-full bg-[#FAFAF8] transition-[padding] duration-300 ${infoPanelOpen ? "md:pr-[390px]" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 범위 상태는 이 인스턴스가 유지하고 버튼만 공통 헤더에 표시한다. */}
      {workspaceNavigation && navigationTarget && createPortal(workspaceNavigation, navigationTarget)}
      {/* 드래그 오버레이 */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-[rgba(54,83,78,0.10)] border-2 border-dashed border-[var(--hb-hairline)] flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-[6px] px-8 py-6 shadow-[var(--shadow-overlay)] text-center">
            <Paperclip className="w-12 h-12 text-[var(--hb-accent-hover)] mx-auto mb-3" />
            <p className="text-lg font-medium text-[var(--hb-text-strong)]">파일을 여기에 놓으세요</p>
            <p className="text-sm text-[var(--hb-text-body)] mt-1">이미지, PDF, Word</p>
          </div>
        </div>
      )}

      {communityDraft && (() => {
        const sensitiveLabels = detectSensitiveText(`${communityDraft.title}\n${communityDraft.content}`);
        const postedHref = communityDraft.postedPostId
          ? weddingPath(`/community/post/${communityDraft.postedPostId}`)
          : null;
        const canPost =
          !communityPosting &&
          !communityDraft.postedPostId &&
          communityDraft.title.trim().length > 0 &&
          communityDraft.content.trim().length > 0 &&
          sensitiveLabels.length === 0;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => setCommunityDraft(null)}
          >
            <div
              ref={activeDialogRef}
              className="w-full max-w-[36rem] rounded-[6px] bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="community-draft-dialog-title"
              tabIndex={-1}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#F0EFED] px-5 py-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.18em] text-[var(--hb-accent-hover)]">COMMUNITY</p>
                  <h3 id="community-draft-dialog-title" className="mt-1 font-serif-kr text-[var(--hb-text-strong)]">이 내용으로 커뮤니티에 물어볼게요</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCommunityDraft(null)}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--hb-text-muted)] hover:bg-[var(--hb-surface-hover)] hover:text-[var(--hb-text-strong)] transition-colors"
                  aria-label="닫기"
                  data-modal-initial-focus
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {communityDraft.postedPostId ? (
                <div className="px-5 py-6">
                  <div className="flex items-start gap-3 rounded-[6px] border border-[#D8E8DF] bg-[#F2FAF5] px-4 py-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2E7D5A]" />
                    <div>
                      <p className="text-sm font-semibold text-[var(--hb-text-strong)]">커뮤니티에 올라갔어요</p>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">
                        다른 예비부부들이 댓글로 의견을 남길 수 있습니다.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCommunityDraft(null)}
                      className="rounded-[6px] border border-[#E8DDD3] px-4 py-2 text-sm font-medium text-[var(--hb-text-body)] hover:bg-[#FAF7F2] transition-colors"
                    >
                      닫기
                    </button>
                    {postedHref && (
                      <a
                        href={postedHref}
                        className="inline-flex items-center gap-2 rounded-[6px] bg-[#2F5F51] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264f43] transition-colors"
                      >
                        글 보러가기
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-h-[72dvh] overflow-y-auto px-5 py-4">
                  <div className="rounded-[6px] border border-[#F0E6D8] bg-[#FFF9EB] px-4 py-3">
                    <p className="text-sm leading-relaxed text-[#6E5732]">
                      커뮤니티에 공개되는 글입니다. 이름과 생년월일, 연락처, 정확한
                      주소, 건강·임신·성생활·민감한 가족관계, 계약·예약번호가
                      들어가 있으면 지우고 올려주세요. 사진 속 글자도 직접 확인해
                      주세요.
                    </p>
                  </div>

                  {communityDraft.privacyMode === "redacted_private" && (
                    <div className="mt-3 rounded-[6px] border border-[#D8E8DF] bg-[#F2FAF5] px-4 py-3">
                      <p className="text-sm leading-relaxed text-[#2F5F51]">
                        비공개 상담에서 만든 익명화 초안입니다. 아모라 답변 원문은 넣지 않았고, 공개 가능한 상황 설명만 남겼어요. 그래도 올리기 전에 개인적인 표현이 남아있는지 한 번만 확인해주세요.
                      </p>
                    </div>
                  )}

                  {sensitiveLabels.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-[6px] border border-[#F2D3C7] bg-[#FFF4EF] px-4 py-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B25A3C]" />
                      <p className="text-sm leading-relaxed text-[#8A4A35]">
                        {sensitiveLabels.join(", ")} 표현이 보입니다. 해당 부분을 지우면 바로 게시할 수 있어요.
                      </p>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-[6px] bg-[var(--hb-surface-hover)] p-1">
                    {[
                      { key: "free" as CommunityCategory, label: "자유게시판" },
                      { key: "tips_v2" as CommunityCategory, label: "정보/체크" },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setCommunityPostError(null);
                          setCommunityDraft((draft) => draft ? { ...draft, category: item.key } : draft);
                        }}
                        className={`rounded-[6px] px-3 py-2 text-sm font-medium transition-colors ${
                          communityDraft.category === item.key
                            ? "bg-white text-[var(--hb-accent-hover)] shadow-sm"
                            : "text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)]"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--hb-text-body)]">제목</span>
                    <input
                      value={communityDraft.title}
                      onChange={(e) => {
                        setCommunityPostError(null);
                        setCommunityDraft((draft) => draft ? { ...draft, title: e.target.value.slice(0, 200) } : draft);
                      }}
                      className="w-full rounded-[6px] border border-[#E8DDD3] bg-white px-3 py-2.5 text-base text-[var(--hb-text-strong)] outline-none focus:border-[#C4967E]"
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium text-[var(--hb-text-body)]">본문</span>
                    <textarea
                      value={communityDraft.content}
                      onChange={(e) => {
                        setCommunityPostError(null);
                        setCommunityDraft((draft) => draft ? { ...draft, content: e.target.value.slice(0, 50000) } : draft);
                      }}
                      rows={11}
                      className="w-full resize-none rounded-[6px] border border-[#E8DDD3] bg-white px-3 py-2.5 text-base leading-relaxed text-[var(--hb-text-strong)] outline-none focus:border-[#C4967E]"
                    />
                  </label>

                  {communityPostError && (
                    <p className="mt-3 rounded-[6px] bg-[#FFF4EF] px-3 py-2 text-sm text-[#8A4A35]">
                      {communityPostError}
                    </p>
                  )}

                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setCommunityDraft(null)}
                      className="rounded-[6px] border border-[#E8DDD3] px-4 py-2.5 text-sm font-medium text-[var(--hb-text-body)] hover:bg-[#FAF7F2] transition-colors"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={submitCommunityDraft}
                      disabled={!canPost}
                      className="inline-flex items-center justify-center gap-2 rounded-[6px] bg-[#2F5F51] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264f43] disabled:cursor-not-allowed disabled:bg-[#A8B6AD] transition-colors"
                    >
                      {communityPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      이대로 게시
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {mediationConsentOpen && (
        <MediationConsentDialog
          onCancel={cancelMediationConsent}
          onConfirm={confirmMediationConsent}
        />
      )}

    <div className="h-full flex flex-col w-full">
      {/* 풀페이지 범위 버튼은 공통 헤더, embedded 버튼은 현재 화면에 둔다. */}
      <div className="mx-auto flex w-full max-w-[70rem] flex-wrap items-center gap-x-3 gap-y-1 px-[18px] pt-[14px] pb-2 md:px-9">
        {embedded && <div className="flex w-full min-w-0 items-center gap-1.5 md:w-auto md:flex-1">
        <div
          className="amora-chat-scopes flex min-w-0 flex-[2] items-center gap-1.5"
          role="group"
          aria-label="대화 공개 범위"
        >
          <button
            type="button"
            onClick={() => chooseLane("shared")}
            disabled={isStreaming || isSending}
            aria-pressed={laneReady && activeTab === "shared"}
            className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 py-[9px] text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              laneReady && activeTab === "shared"
                ? "bg-[var(--amora-selected-bg,var(--hb-selected-bg))] text-[var(--amora-selected-text,var(--hb-selected-text))] ring-1 ring-inset ring-[var(--amora-selected-line,var(--hb-selected-line))]"
                : "text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)]"
            }`}
          >
            <AmoraMark className="w-4 h-4" />
            함께 대화
            {sharedMessageCount > 0 && (
              <span className="text-xs text-[var(--hb-text-muted)] hidden sm:inline">({sharedMessageCount})</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => chooseLane("private")}
            disabled={isDemo || isStreaming || isSending || !myPrivateVisibility}
            aria-pressed={laneReady && activeTab === "private"}
            className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 py-[9px] text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              laneReady && activeTab === "private"
                ? "bg-[var(--amora-selected-bg,var(--hb-selected-bg))] text-[var(--amora-selected-text,var(--hb-selected-text))] ring-1 ring-inset ring-[var(--amora-selected-line,var(--hb-selected-line))]"
                : "text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)]"
            }`}
            title={
              isDemo
                ? "계정 이용 시 파트너 비공개 상담을 사용할 수 있어요"
                : "아모라와 1:1 — 상대방에게 보이지 않습니다"
            }
          >
            <Lock className="w-4 h-4" />
            나만 (상담)
            {isDemo ? (
              <span className="hidden text-xs text-[var(--hb-text-muted)] sm:inline">(계정)</span>
            ) : privateMessageCount > 0 ? (
              <span className="text-xs text-[var(--hb-text-muted)] hidden sm:inline">({privateMessageCount})</span>
            ) : null}
          </button>
        </div>
        </div>}
        {!navigationTarget && workspaceNavigation}

        {/* 액션 — 우측 (검색/정보/새채팅) */}
        <div className="ml-auto flex w-full shrink-0 items-center justify-end gap-1 md:w-auto">
          <a
            href="/ai-policy"
            className="flex size-11 items-center justify-center rounded-full text-[12px] font-medium text-[var(--amora-muted,#6E5A54)] transition-colors hover:bg-[var(--amora-low,#F0EAD9)]"
            aria-label="AI 정책"
            title="AI 정책"
          >
            AI
          </a>
          <button
            onClick={() => {
              setSearchOpen((v) => {
                if (v) setSearchQuery(""); // 닫을 때 검색어 리셋
                return !v;
              });
            }}
            className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-colors ${
              searchOpen
                ? "text-[var(--hb-accent-hover)] bg-[rgba(54,83,78,0.10)]"
                : "text-[var(--amora-muted,#6E5A54)] hover:bg-[var(--amora-low,#F0EAD9)]"
            }`}
            aria-label="대화 검색"
            title="대화 검색"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => setInfoPanelOpen(!infoPanelOpen)}
            className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-colors ${
              infoPanelOpen
                ? "text-[var(--hb-accent-hover)] bg-[rgba(54,83,78,0.10)]"
                : "text-[var(--amora-muted,#6E5A54)] hover:bg-[var(--amora-low,#F0EAD9)]"
            }`}
            aria-label="정보 패널 · 대화 정리와 준비 현황"
            title="대화 정리와 준비 현황"
          >
            <PanelRightOpen className="w-4 h-4" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={openNewChatModal}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--amora-muted,#6E5A54)] transition-colors hover:bg-[var(--amora-low,#F0EAD9)]"
              aria-label="대화 화면 정리"
              title="대화 화면 정리"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={`mx-auto -mt-1 mb-1 w-full max-w-[70rem] px-3 text-[0.6875rem] leading-relaxed ${
          activeTab === "private" ? "text-[#5a6147]" : "text-[var(--hb-accent-hover)]"
        }`}
      >
        {/* 레인을 고르기 전에는 '현재 범위'를 말하지 않는다. 아직 정해진 범위가 없다. */}
        {!laneReady && !isDemo
          ? null
          : isDemo
          ? "현재 범위 · 체험용 함께 대화 — 체험 대화와 변경은 계정의 준비 기록에 남지 않아요"
          : activeTab === "private"
          ? "현재 범위 · 나만 (상담) — 서비스에 저장되며 상대방에게는 보이지 않아요"
          : partner
          ? "현재 범위 · 함께 대화 — 파트너에게 보여요"
          // 아직 배우자를 연결하지 않은 사람에게 "파트너에게 보여요" 는 사실이
          // 아니다. 지금은 아무도 못 본다. 나중에 연결하면 보인다는 것을 말한다.
          : "현재 범위 · 함께 대화 — 파트너를 연결하면 이 대화를 함께 볼 수 있어요"}
      </p>

      {/* 아모라 답변이 AI 생성임을 화면에서도 항상 확인할 수 있게 한 번 표시한다. */}
      <div className="mx-auto mb-1 flex w-full max-w-[70rem] flex-wrap items-center gap-x-2 gap-y-1 px-3 text-[0.6875rem] leading-5 text-[#5F5A55]">
        <span className="inline-flex min-h-6 items-center gap-1 font-semibold text-[var(--hb-accent-hover)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--hb-primary)]" aria-hidden="true" />
          AI 생성 답변
        </span>
        <span aria-hidden="true" className="text-[var(--hb-text-muted)]">·</span>
        <span>계약·가격·중요 일정은 원문을 다시 확인해 주세요</span>
        <span aria-hidden="true" className="text-[var(--hb-text-muted)]">·</span>
        <a
          href="/ai-policy"
          className="inline-flex min-h-6 items-center font-semibold underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--hb-accent-hover)]"
        >
          AI 정책
        </a>
      </div>

      {/* 검색 바 — 헤더 아래 토글 */}
      {searchOpen && (
        <div className="mx-2 mb-2 flex items-center gap-2 px-3 py-2 bg-white border border-[#F0EFED] rounded-[6px] shadow-[var(--shadow-raised)]">
          <Search className="w-4 h-4 text-[var(--hb-text-muted)] shrink-0" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="대화 내용 검색..."
            className="flex-1 min-w-0 text-base text-[var(--hb-text-strong)] placeholder:text-[var(--hb-text-muted)] bg-transparent outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-[var(--hb-text-muted)] hover:text-[var(--hb-text-strong)]"
              aria-label="검색어 지우기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* 새 채팅 안내 배너 (대화가 길어졌을 때) */}
      {showNewChatBanner && !isStreaming && (
        <div className="mx-2 mb-2 p-3.5 rounded-[6px] bg-[rgba(54,83,78,0.10)] flex items-center justify-between shadow-[var(--shadow-raised)]">
          <p className="text-sm text-[var(--hb-accent-hover)]">
            대화가 길어졌어요. 화면을 정리하면 이전 대화는 해당 범위의 이후 상담에서 제외돼요. 원문과 저장한 예산·일정·결정은 남아요.
          </p>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <button onClick={dismissNewChatBanner} className="px-3.5 py-1.5 text-sm rounded-[6px] bg-white text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)] shadow-sm">괜찮아요</button>
            <button onClick={openNewChatModal} className="px-3.5 py-1.5 text-sm rounded-[6px] bg-[var(--hb-action)] hover:bg-[var(--hb-action-hover)] text-white hover:shadow-md">화면 정리</button>
          </div>
        </div>
      )}

      {/* 새 채팅 confirm modal — multi-step + 실수 방지 */}
      {clearStep !== "closed" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setClearStep("closed")}
        >
          <div
            ref={activeDialogRef}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white rounded-[6px] shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-chat-dialog-title"
            tabIndex={-1}
          >
            {/* Step 1a: 함께 대화 — 옵션 선택 */}
            {clearStep === "shared_choose" && (
              <>
                <h3 id="new-chat-dialog-title" className="text-[var(--hb-text-strong)] mb-2">함께 대화 화면 정리</h3>
                <p className="text-sm text-[var(--hb-text-body)] leading-relaxed mb-5">
                  화면에 보이는 이전 대화를 정리할 방법을 골라주세요. 해당 범위의 원문은 보관하지만
                  정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요.
                  <br />
                  <span className="text-[var(--hb-text-muted)] text-[12.5px]">비공개 상담 기록은 영향받지 않아요.</span>
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => performClear("view_reset_shared")}
                    className="w-full text-left px-4 py-3 rounded-[6px] border border-[#5a6147]/30 bg-[#5a6147]/5 hover:bg-[#5a6147]/10 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[#5a6147] mb-1">내 화면만 정리 (추천)</div>
                    <div className="text-[12px] text-[var(--hb-text-body)]">
                      상대방 화면은 그대로 두고, 내 화면에서만 이전 메시지를 정리해요.
                    </div>
                  </button>
                  <button
                    onClick={() => setClearStep("shared_confirm_both")}
                    className="w-full text-left px-4 py-3 rounded-[6px] border border-[#E8DDD3] bg-[#FAF7F2]/50 hover:bg-[#FAF7F2] transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[var(--hb-accent-hover)] mb-1">둘의 화면 함께 정리 (상대방 동의 필요)</div>
                    <div className="text-[12px] text-[var(--hb-text-body)]">
                      상대방에게 동의 요청을 보내요. 상대방이 [동의] 누르면 양쪽 화면이
                      함께 정리되고 이전 대화는 이후 상담에서 제외돼요. <strong>원문과 저장한 예산·일정·결정은 유지</strong>돼요.
                    </div>
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setClearStep("closed")}
                    autoFocus
                    className="min-h-11 px-4 text-sm rounded-[6px] bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] bg-[#f3e9df]"
                    data-modal-initial-focus
                  >
                    취소
                  </button>
                </div>
              </>
            )}

            {/* Step 1b: 함께 대화 둘 다 — 동의 요청 확인 */}
            {clearStep === "shared_confirm_both" && (
              <>
                <h3 id="new-chat-dialog-title" className="text-[var(--hb-text-strong)] mb-2">둘의 화면 정리 동의를 요청할게요</h3>
                <p className="text-sm text-[var(--hb-text-body)] leading-relaxed mb-5">
                  채팅에 동의 카드가 올라가고 상대방이 [동의] 누르면 양쪽 화면이
                  정리됩니다. 거절되면 그대로 유지돼요.
                  <br />
                  <span className="text-[var(--hb-text-muted)] text-[12.5px]">
                    해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요.
                  </span>
                </p>
                {clearRequestError && (
                  <p role="alert" className="mb-4 text-sm leading-relaxed text-red-700">{clearRequestError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setClearStep("shared_choose")}
                    autoFocus
                    className="min-h-11 px-4 text-sm rounded-[6px] bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] bg-[#f3e9df]"
                    data-modal-initial-focus
                  >
                    돌아가기
                  </button>
                  <button
                    onClick={submitSharedClearRequest}
                    disabled={clearRequestPending}
                    aria-busy={clearRequestPending}
                    className="min-h-11 px-4 text-sm rounded-[6px] bg-[var(--amora-action,var(--hb-action))] text-white transition-colors hover:bg-[var(--amora-action-hover,var(--hb-action-hover))] disabled:cursor-wait disabled:opacity-60"
                  >
                    {clearRequestPending ? "동의 요청 보내는 중…" : "동의 요청 보내기"}
                  </button>
                </div>
              </>
            )}

            {/* Step 2: 나만 (상담) — 단순 확인 */}
            {clearStep === "private_confirm" && (
              <>
                <h3 id="new-chat-dialog-title" className="text-[var(--hb-text-strong)] mb-2">비공개 상담 화면 정리</h3>
                <p className="text-sm text-[var(--hb-text-body)] leading-relaxed mb-5">
                  화면만 정리할지, 비공개 대화·기억까지 삭제할지 선택해주세요.
                  <br />
                  <span className="text-[var(--hb-text-muted)] text-[12.5px]">
                    상대방의 비공개 상담에는 영향이 없어요.
                  </span>
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => performClear("view_reset_private")}
                    className="w-full text-left px-4 py-3 rounded-[6px] border border-[#5a6147]/30 bg-[#5a6147]/5 hover:bg-[#5a6147]/10 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[#5a6147] mb-1">내 화면만 정리 (추천)</div>
                    <div className="text-[12px] text-[var(--hb-text-body)]">
                      해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요.
                    </div>
                  </button>
                  <button
                    onClick={() => performClear("delete_private")}
                    className="w-full text-left px-4 py-3 rounded-[6px] border border-red-300 bg-red-50/50 hover:bg-red-50 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-red-600 mb-1">
                      비공개 대화·아모라 기억 삭제
                    </div>
                    <div className="text-[12px] leading-relaxed text-[var(--hb-text-body)]">
                      이 대화와 아모라가 만든 요약·기억을 삭제하고 비공개 기억
                      사용을 꺼요. 이 비공개 대화에서 저장한 개인 할 일도 함께 삭제됩니다.
                      별도 저장 메모·법적/보안 로그·백업은 각 보관
                      정책에 따라 처리돼요.
                    </div>
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setClearStep("closed")}
                    autoFocus
                    className="min-h-11 px-4 text-sm rounded-[6px] bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] bg-[#f3e9df]"
                    data-modal-initial-focus
                  >
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 채팅 영역 — 컨테이너는 full-width 라 스크롤바가 viewport 우측 가장자리.
          안쪽 reading column wrapper 에서 메시지가 가운데 reading 폭으로 정렬. */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-4">
        <div className="w-full max-w-[70rem] mx-auto px-2 sm:px-3 space-y-4">
        {/* 기억 상태 한 줄 — 못 읽었으면(activeMemoryEnabled === null) 아무 말도 하지 않는다 */}
        {activeMemoryEnabled !== null && (
          <div
            data-testid="amora-memory-status"
            className="mb-2 px-3 py-2 rounded-[6px] bg-[var(--hb-surface-hover)] text-[12.5px] leading-relaxed text-[var(--hb-text-muted)]"
          >
            {memoryStatus?.runtimeEnabled===false ? (
              <span>새 기억 저장은 아직 준비 중이에요{" · "}<a href={weddingPath("/settings/amora-memory")} className="underline text-[var(--hb-accent-hover)]">기억 설정 확인</a></span>
            ) : activeMemoryEnabled ? (
              <span>이 탭의 대화는 장기 기억으로 정리돼요</span>
            ) : (
              <span>
                지금은 장기 기억을 저장하지 않아요{" · "}
                <a
                  href={weddingPath("/settings/amora-memory")}
                  className="underline text-[var(--hb-accent-hover)]"
                >
                  설정에서 켜기
                </a>
              </span>
            )}
          </div>
        )}

        {/* 말풍선 색 안내 — 함께 대화 탭, 상대가 연결돼 있고 내가 역할을 고르지 않았을 때만 */}
        {activeTab === "shared" && !isDemo && viewerId && partner?.id && !viewerHasConfirmedRole
          && roleColorHint?.userId === viewerId && !roleColorHint.dismissed && (
          <div
            data-testid="chat-role-color-hint"
            className="mb-2 flex items-center gap-2 px-3 py-1.5 text-[12.5px] leading-relaxed text-[var(--hb-text-muted)]"
          >
            <p className="min-w-0 flex-1">
              설정에서 나의 역할을 신랑·신부로 고르면 내 말풍선이 색으로 구분돼요{" · "}
              <Link
                href={weddingPath("/settings#wedding-role")}
                className="underline text-[var(--hb-accent-hover)]"
              >
                역할 고르기
              </Link>
            </p>
            <Button
              variant="icon"
              size="sm"
              label="말풍선 색 안내 닫기"
              onClick={dismissRoleColorHint}
              className="flex-shrink-0"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}

        {firstHelloMessage && (
          <div className="animate-fade-in" data-testid="amora-first-hello-message">
            <ChatBubble
              message={firstHelloMessage}
              isCurrentUser={false}
            />
          </div>
        )}

        {(() => {
          // 탭별 메시지 필터링: shared 탭은 visibility=shared, private 탭은 본인 private만
          // (RLS가 이미 본인 private만 SELECT 허용하므로 클라이언트는 visibility로만 분기)
          const tabMessages = messages.filter((m) => {
            if (activeTab === "shared") return m.visibility === "shared";
            return !!myPrivateVisibility && m.visibility === myPrivateVisibility;
          });

          // 검색 필터 (검색어 trim 후 case-insensitive 부분 매치)
          const q = searchQuery.trim().toLowerCase();
          const filteredMessages = q
            ? tabMessages.filter((m) => (m.sender_role === "ai" ? getAmoraVisibleText(m.content) : m.content).toLowerCase().includes(q))
            : tabMessages;

          if (q && filteredMessages.length === 0) {
            return (
              <div className="text-center py-12 text-[var(--hb-text-muted)] text-sm">
                <Search className="w-8 h-8 text-[var(--hb-text-muted)] mx-auto mb-2" />
                &ldquo;{searchQuery}&rdquo;에 해당하는 메시지가 없어요
              </div>
            );
          }

          // 최근 3개 AI 메시지 ID 계산 (피드백 버튼 표시용)
          const recentAiIds = new Set(
            filteredMessages
              .filter((m) => (
                m.sender_role === "ai"
                && !isSafetyScopedChatMessage(m)
              ))
              .slice(-3)
              .map((m) => m.id)
          );
          const latestSharedMessage = [...messages]
            .reverse()
            .find((message) => (
              message.visibility === "shared"
              && message.metadata?.target !== "partner"
            )) ?? null;
          const latestSharedMessageId = latestSharedMessage?.id ?? null;
          // 이미 적용된 카드를 가려낸다. 서버가 사용자 확인 행에
          // `confirmed_amora_action_id` 를 남기므로 새로고침해도 유지된다 —
          // 클라이언트 상태로 들고 있으면 새로고침 한 번에 "적용할 수 없어요" 로
          // 되돌아간다.
          //
          // 이게 없으면 **방금 성공시킨 카드**가 `not_latest` 로 잠긴다. 누르는
          // 순간 새 메시지가 생겨 그 카드가 최신이 아니게 되기 때문이다.
          // 2026-08-31 운영에서 재현: 아모라가 "일정을 추가했어요" 라고 말한 바로
          // 옆에 "새 대화가 이어져 이 제안은 적용할 수 없어요" 가 함께 떠 있었다.
          // 2026-09-03 정정: 확인 행이 있다는 것만으로 "적용됐어요" 라고 잠그면,
          // 서버가 거절했거나 도구가 실패를 보고한 경우에도 성공이라고 말한다
          // (그 표식은 도구가 돌기 전에 찍힌다). 반영 성공 증거로 바꾼다 —
          // 판정은 사이드 패널과 같은 헬퍼가 한다.
          const actionConfirmationOutcomes =
            buildAmoraActionConfirmationOutcomes(messages);
          return filteredMessages.map((msg, index) => {
            const isCurrentUser = msg.sender_id === profile?.id;
            const isPinnedSafetyCard = msg.metadata?.pinned_safety_card === true;
            const isCommunityFallbackEligible = !isSafetyScopedChatMessage(msg);
            const hasToolResults =
              msg.sender_role === "ai" &&
              msg.metadata?.toolResults &&
              msg.metadata.toolResults.length > 0;
            const pendingActionCandidate = getPendingAmoraAction(msg);
            const pendingAction = pendingActionCandidate
              && !dismissedPendingMessageIds.has(msg.id)
              ? pendingActionCandidate
              : null;
            const previousHumanMessage = msg.sender_role === "ai"
              ? [...filteredMessages.slice(0, index)].reverse().find((m) => m.sender_role !== "ai")
              : undefined;
            const isSharedCommunityFallback =
              activeTab === "shared" &&
              msg.visibility === "shared" &&
              previousHumanMessage?.visibility === "shared";
            const isPrivateCommunityFallback =
              activeTab === "private" &&
              !!myPrivateVisibility &&
              msg.visibility === myPrivateVisibility &&
              previousHumanMessage?.visibility === myPrivateVisibility;
            const canConsiderCommunityFallback =
              SHOW_SIGNED_IN_COMMUNITY &&
              isCommunityFallbackEligible &&
              !isDemo &&
              msg.sender_role === "ai" &&
              !pendingActionCandidate &&
              !hasSuccessfulSystemAction(msg) &&
              recentAiIds.has(msg.id) &&
              !!previousHumanMessage &&
              previousHumanMessage?.sender_id === profile?.id &&
              (isSharedCommunityFallback || isPrivateCommunityFallback) &&
              !isSafetyScopedChatMessage(previousHumanMessage);
            const communityAskCue = canConsiderCommunityFallback && previousHumanMessage
              ? getCommunityAskCue(
                msg,
                previousHumanMessage,
                communityPromptMessageIds.has(msg.id)
              )
              : null;
            const displayCommunityAskCue = canConsiderCommunityFallback
              ? isPrivateCommunityFallback
                ? {
                    label: "익명으로 물어보기",
                    ariaLabel: "비공개 아모라 상담 내용을 익명화해 커뮤니티에 묻기",
                  }
                : communityAskCue ?? {
                    label: "커뮤니티에 물어보기",
                    ariaLabel: "아모라 답변을 바탕으로 커뮤니티에 의견 묻기",
                  }
              : null;
            const pendingActionDisabledReason = pendingAction
              ? resolveAmoraPendingActionDisabledReason({
                  action: pendingAction,
                  nowMs,
                  isLatest: msg.id === latestSharedMessageId,
                  busy: isStreaming || isSending,
                  applicationState: getAmoraPendingActionApplicationState(
                    pendingAction,
                    actionConfirmationOutcomes,
                  ),
                })
              : null;
            const pendingBudgetImpactPreview = pendingAction
              ? getPendingAmoraBudgetImpactPreview(msg, pendingAction)
              : null;
            // 이 카드가 몇 번 옮겨져 왔는가 — 서버 metadata 값만 쓴다(2026-09-04).
            const pendingActionCarryCount = pendingAction
              ? getPendingAmoraActionCarryCount(msg)
              : 0;
            // 같은 제안이 최신 공유 답변으로 옮겨졌는가(2026-09-15). 옮겨졌으면 이 카드는
            // "적용할 수 없어요" 대신 아래 카드를 가리키고 버튼을 거둔다 — 사이드 패널과 같은 판정.
            const pendingActionContinuesInLatest = pendingAction
              ? isPendingAmoraActionContinuedInMessage(latestSharedMessage, pendingAction)
              : false;

            return (
              <div
                key={msg.id}
                className="animate-fade-in"
              >
                {isPinnedSafetyCard ? (
                  // 제품에서 가장 무거운 메시지일수록 누가 말하는지가 분명해야 한다.
                  // 이 카드만 아모라의 얼굴과 이름 없이 나가면, 곁에 있는 사람이 걱정하는
                  // 것이 아니라 시스템이 사용자를 위험군으로 표시한 것처럼 읽힌다.
                  // 모바일(`apps/mobile/app/(tabs)/chat.tsx`)은 이미 이 카드에도
                  // "아모라" 이름표와 ShieldCheck를 쓰고 있어, 웹을 그 기준에 맞춘다.
                  //
                  // ⚠️ `ChatBubble`을 재사용하지 않는다 — AI 분기가 저장 버튼을 무조건
                  // 붙이고, 그 버튼은 본문을 서버에 영구 저장한다. 이 카드는
                  // `ephemeral_local_only`라 저장·피드백 어포던스를 붙이면 안 된다.
                  // 아바타·이름표 마크업만 복제한다.
                  <div className="flex max-w-[94%] items-start gap-2 sm:max-w-[53.75rem] sm:gap-3">
                    <AmoraAvatar sizeClassName="size-9 sm:size-11" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-base font-medium text-[var(--hb-text-muted)]">아모라</span>
                      <div
                        data-amora-safety-card="true"
                        role="alert"
                        aria-live="assertive"
                        aria-label="긴급 안전 안내"
                        className="rounded-[6px] border border-danger-500/30 bg-danger-500/[0.04] px-4 py-4 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          {/* 경고 삼각형이 아니라 방패다. 색(danger)은 그대로 두어
                              중요도와 대비는 유지하고, 의미만 '경고'에서 '보호'로 옮긴다. */}
                          <ShieldCheck
                            aria-hidden="true"
                            className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger-500"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-danger-700">긴급 안전 안내</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--hb-text-strong)]">
                              {msg.content}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ChatBubble
                    message={msg}
                    senderConfirmedRole={msg.sender_id && msg.sender_id === profile?.id
                      ? profile.confirmed_role : msg.sender_id && msg.sender_id === partner?.id ? partner.confirmed_role : null}
                    isCurrentUser={isCurrentUser}
                    senderName={
                      msg.sender_id && msg.sender_id === partner?.id
                        ? partner.name
                        : null
                    }
                    senderAvatarUrl={msg.sender_id && msg.sender_id === partner?.id ? partner.avatar_url : null}
                    isRecentAi={recentAiIds.has(msg.id)}
                    onNegativeFeedback={markCommunityFallbackAvailable}
                  />
                )}
                {pendingAction && (
                  <PendingAmoraActionCard
                    action={pendingAction}
                    impactPreview={pendingBudgetImpactPreview}
                    messageId={msg.id}
                    disabledReason={pendingActionDisabledReason}
                    isApplying={applyingPendingActionId === pendingAction.actionId}
                    partnerLinked={Boolean(partner)}
                    carryCount={pendingActionCarryCount}
                    continuesInLatestReply={pendingActionContinuesInLatest}
                    queuedRemainingCount={getQueuedRemainingCount(msg, pendingAction.actionId)}
                    onApply={(actionId) => void applyPendingAmoraAction(actionId)}
                    onDismiss={() => dismissPendingAmoraAction(pendingAction.actionId)}
                    onSkip={(actionId) => void skipQueuedAmoraAction(actionId)}
                  />
                )}
                {displayCommunityAskCue && previousHumanMessage && (
                  <div className="ml-11 mt-1 flex max-w-[94%] sm:ml-14 sm:max-w-[53.75rem]">
                    <button
                      type="button"
                      onClick={() => openCommunityDraft(msg, previousHumanMessage)}
                      aria-label={displayCommunityAskCue.ariaLabel}
                      className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#D8C7BB] bg-white/80 px-3 py-1.5 text-sm font-medium text-[#2F5F51] shadow-sm hover:border-[#2F5F51]/40 hover:bg-[#F6FAF7] transition-colors"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {displayCommunityAskCue.label}
                    </button>
                  </div>
                )}
                {hasToolResults &&
                  // 내용까지 동일한 반복 호출만 줄이고 서로 다른 정상 결과는 모두 보존한다.
                  deduplicateToolResults(msg.metadata!.toolResults!).map((result, i) =>
                    VENDOR_TOOL_NAMES.has(result.toolName) ? (
                      <VendorToolCard key={`${msg.id}-tool-${i}`} result={result} onSend={sendToAmora} disabled={isStreaming} />
                    ) : (
                      <div
                        key={`${msg.id}-tool-${i}`}
                        className="animate-fade-in"
                        style={{ animationDelay: `${i * 120}ms` }}
                      >
                        <ActionCard result={result} />
                      </div>
                    )
                  )}
                {pendingPersonalization &&
                  msg.id === personalizationReplyMessageId &&
                  showPersonalizationConfirmation && (
                    <AmoraPersonalizationConfirmation
                      option={pendingPersonalization.option}
                      saving={amoraPersonalization.saving}
                      error={amoraPersonalization.error}
                      onConfirm={() => void confirmAmoraPersonalization()}
                      onDismiss={dismissAmoraPersonalization}
                    />
                  )}
              </div>
            );
          });
        })()}

        {showAmoraQuickStart && (
          <AmoraQuickStart
            disabled={isStreaming || isSending}
            onSelect={handlePersonalizationSelect}
          />
        )}

        {isStreaming && transientArtifactsVisible && (
          <div className="animate-fade-in">
            <StreamingBubble content={streamingContent} toolResults={streamingToolResults} onSend={sendToAmora} />
          </div>
        )}

        {/* 파트너 typing 인디케이터 — 본인이 streaming 중이 아닐 때만 (중복 방지) */}
        {activeTab === "shared" && !isStreaming && partnerTypingActive && presence.partnerTyping && (() => {
          // 타이핑 중인 사람이 실제로 현재 파트너일 때만 이름을 쓴다. presence는
          // 이전 참여자 이벤트를 실어 올 수 있어 id 대조 없이 이름을 붙이면 오귀속이다.
          const typingIsPartner =
            Boolean(partner?.id) && presence.partnerTyping.user_id === partner?.id;
          const label = typingIsPartner ? (partner?.name ?? "파트너") : "파트너";
          return (
            <div className="animate-fade-in flex items-center gap-2 px-3">
              <ProfileAvatar name={typingIsPartner ? partner?.name : null} label={label} avatarUrl={typingIsPartner ? partner?.avatar_url : null} size={36} />
              <div className="bg-white border border-black/[0.06] rounded-[6px] rounded-tl-md px-4 py-3 shadow-sm flex items-center gap-1.5">
                <span className="text-[13px] text-[var(--hb-text-muted)]">{label} 입력 중</span>
                <span className="flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#B5ADA3] animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#B5ADA3] animate-pulse" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#B5ADA3] animate-pulse" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          );
        })()}

        {/* AI 응답 중 인디케이터 — 본인이 streaming 중이 아니고 파트너 메시지에 응답 중일 때 */}
        {activeTab === "shared" && !isStreaming && aiResponding && profile && aiResponding.triggered_by_user_id !== profile.id && (
          <div className="animate-fade-in">
            <StreamingBubble toolResults={[]} onSend={sendToAmora} />
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 최신 메시지로 ↓ 점프 — 사용자가 바닥에서 240px+ 위로 올라가 있을 때만 */}
      {showJumpToBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-[140px] right-4 sm:right-6 z-20 w-11 h-11 rounded-full bg-white text-[var(--hb-accent-hover)] shadow-[var(--shadow-raised)] border border-[#E8DDD3] hover:bg-[#FAF8F5] flex items-center justify-center transition-colors"
          aria-label="최신 메시지로"
          title="최신 메시지로"
        >
          ↓
        </button>
      )}

      {/* 쿼터 소진 예고 — 갑작스런 차단(429) 대신 미리 안내 */}
      {transientArtifactsVisible && quotaRemaining !== null && !isStreaming && (
        <div className="mx-2 mt-2 flex items-center justify-between rounded-[6px] bg-[var(--hb-surface-hover)] p-3 shadow-[var(--shadow-raised)]">
          <p className="text-[13px] font-medium text-[#6d625a]">
            {quotaRemaining > 0
              ? `무료 상담이 ${quotaRemaining}회 남았어요. 소진돼도 예산·일정 기록은 그대로 보관돼요.`
              : "무료 상담을 모두 사용했어요. 예산·일정 기록은 그대로 보관돼요."}
          </p>
          <Button variant="ghost" onClick={() => setInfoPanelOpen(true)} className="shrink-0 px-2! text-xs!">대화 정리</Button>
          <button
            onClick={() => useChatStore.setState({ quotaRemaining: null })}
            className="ml-2 flex-shrink-0 text-[var(--hb-text-muted)] hover:text-[#6d625a]"
            aria-label="안내 닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 에러 메시지 */}
      {tasteNotice?.identity === composerIdentity && tasteNotice.epoch === composerEpochRef.current && (
        <div role="status" className="mx-3 my-2 rounded-lg border border-[var(--hb-hairline)] p-3 text-sm leading-relaxed">
          {tasteNotice.status === "pending" ? <>
            <p>이어 온 내 취향을 잠시 보관하고 있어요. 작성 중인 나만 상담과 첨부 파일은 그대로 두었어요. 입력창을 비우고 전송이 끝나면 불러올 수 있어요.</p>
            <Button variant="ghost" className="mt-2" disabled={isStreaming || isSending || Boolean(composerDrafts.private_ai.input.length) || composerDrafts.private_ai.attachments.length > 0 || composerDrafts.private_ai.pendingAttachmentReads > 0}
              onClick={() => { if (tasteNotice.nonce) tryPlaceWeddingTaste(tasteNotice.nonce, tasteNotice.identity, tasteNotice.epoch); }}>이어 온 내 취향 불러오기</Button>
          </> : tasteNotice.status === "applied"
            ? <p>내가 고른 취향을 나만 상담 입력창에 넣었어요. 내용을 확인하고 보내기를 눌러 주세요. 상대방에게는 보이지 않으며 보내면 서비스에 대화로 저장돼요.</p>
            : <p>이어 온 취향의 계정이나 유효 시간을 확인하지 못했어요. 웨딩 취향 화면에서 현재 계정을 확인한 뒤 다시 이어 주세요.</p>}
        </div>
      )}
      {!preparationQuestionPlaced && preparationNotice?.identity === composerIdentity && preparationNotice.epoch === composerEpochRef.current && (
        <div role="status" className="mx-3 my-2 rounded-lg border border-[var(--hb-hairline)] p-3 text-sm leading-relaxed">
          {preparationNotice.draft ? <>
            <p>작성 중인 내용은 유지했어요. 함께 대화 입력창을 비운 뒤 이어 온 질문을 불러올 수 있어요.</p>
            <button type="button" className="min-h-11 underline disabled:opacity-50"
              disabled={isStreaming || isSending || Boolean(composerDrafts.shared_ai.input.trim()) || composerDrafts.shared_ai.attachments.length > 0 || composerDrafts.shared_ai.pendingAttachmentReads > 0}
              onClick={() => {
                const draft = preparationNotice.draft;
                if (!draft || !preparationNotice.source || preparationNotice.identity !== composerIdentity || preparationNotice.epoch !== composerEpochRef.current || isStreaming || isSending) return;
                const current = composerDraftsRef.current.shared_ai;
                if (current.input.trim() || current.attachments.length || current.pendingAttachmentReads) return;
                const source = preparationNotice.source;
                setComposerDrafts(previous => {
                  const lane = previous.shared_ai;
                  if (lane.input.trim() || lane.attachments.length || lane.pendingAttachmentReads) return previous;
                  return { ...previous, shared_ai: { ...lane, input: draft.text, preparation: { source, draft }, retryClientRequestId: null } };
                });
                handleScopeChange("shared");
                handleMessageTargetChange("ai");
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}>함께 대화에 질문 불러오기</button>
            <Link href={weddingPath(preparationNotice.draft.sourceHref)} className="ml-3 inline-flex min-h-11 items-center underline">원래 안내 보기</Link>
          </> : <p>{preparationNotice.error}</p>}
        </div>
      )}
      {activeTab === "private" && personalContinuationNotice?.identity === composerIdentity && <div role="alert" className="mx-3 my-2 rounded-lg border border-[var(--hb-hairline)] p-3 text-sm leading-relaxed">
        <p>{personalContinuationNotice.text}</p><Link href="/chat/personal" className="inline-flex min-h-11 items-center underline">개인 목록에서 다시 확인</Link>
      </div>}
      {transientArtifactsVisible && error && !isStreaming && (
        <div
          className={`mx-2 mt-2 rounded-[6px] border p-3.5 shadow-[var(--shadow-raised)] ${
            isRecoveryNotice
              ? "border-[#B9DAD5] bg-[#F0F8F6]"
              : "border-red-100 bg-red-50"
          }`}
          role={isRecoveryNotice ? "status" : "alert"}
        >
          <p
            className={`text-sm leading-relaxed ${
              isRecoveryNotice ? "text-[#245B56]" : "text-red-700"
            }`}
          >
            {error}
          </p>
          {failedRequest?.unavailableReason && (
            <p className={`mt-1 text-xs leading-relaxed ${
              isRecoveryNotice ? "text-[#356B66]" : "text-danger-700"
            }`}>
              {failedRequest.unavailableReason}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            {failedRequest?.canRetry && (
              <button
                type="button"
                onClick={() => void retryFailedMessage()}
                disabled={isStreaming || isRetrying}
                className={`min-h-9 rounded-[6px] px-3.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isRecoveryNotice
                    ? "bg-[#2F766F] hover:bg-[#245B56]"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {isConfirmedActionRecovery
                  ? isRetrying
                    ? "반영 확인 중..."
                    : "반영 계속하기"
                  : isInterruptedTurnRecovery
                    ? isRetrying
                      ? "답변 확인 중..."
                      : "답변 이어받기"
                  : isRetrying
                    ? "다시 시도 중..."
                    : "다시 시도"}
              </button>
            )}
            {!failedRequest && !isDemo && coupleId && profile && messages.length === 0 && (
              <button
                type="button"
                onClick={retryInitialGreeting}
                disabled={isStreaming}
                className="min-h-9 rounded-[6px] bg-red-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                다시 시도
              </button>
            )}
            <button
              type="button"
              onClick={dismissFailedMessageRetry}
              disabled={isStreaming || isRetrying}
              className={`min-h-9 rounded-[6px] border bg-white px-3.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isRecoveryNotice
                  ? "border-[#B9DAD5] text-[#356B66] hover:bg-[#E4F3F0]"
                  : "border-red-200 text-red-700 hover:bg-red-100"
              }`}
            >
              {isRecoveryNotice ? "나중에" : "닫기"}
            </button>
          </div>
        </div>
      )}

      {/* Pre-send confirm — 파트너 입력 중이거나 AI가 파트너 메시지에 응답 중일 때 */}
      {pendingSend && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fade-in"
          onClick={() => setPendingSend(null)}
        >
          <div
            ref={activeDialogRef}
            className="bg-white rounded-[6px] shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-send-dialog-title"
            tabIndex={-1}
          >
            <div className="flex items-start gap-3 mb-4">
              <AmoraAvatar sizeClassName="size-10" />
              <div className="flex-1 min-w-0">
                <h3 id="pending-send-dialog-title" className="font-serif-kr text-[var(--hb-text-strong)] mb-1.5">
                  잠시 기다리시겠어요?
                </h3>
                <p className="text-sm text-[var(--hb-text-body)] leading-relaxed">
                  {partnerTypingActive
                    ? `${partnerDisplayName}${subjectParticle(partnerDisplayName)} 지금 입력하고 있어요. 같이 보내면 진행 중인 흐름이 꼬일 수 있어요.`
                    : "아모라가 방금 보낸 메시지에 답변하고 있어요. 지금 새 메시지를 보내면 진행 중인 답변이 중단될 수 있어요."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingSend(null)}
                className="min-h-11 flex-1 px-4 rounded-[6px] text-sm font-medium text-[var(--hb-text-strong)] bg-[var(--hb-surface-hover)] bg-[#f3e9df] transition-colors"
                data-modal-initial-focus
              >
                기다릴게요
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = pendingSend.text;
                  const target = pendingSend.target;
                  setPendingSend(null);
                  void handleSend(t, target);
                }}
                className="min-h-11 flex-1 px-4 rounded-[6px] text-sm font-medium text-white bg-[var(--hb-action)] hover:bg-[var(--hb-action-hover)] hover:shadow-md transition-colors"
              >
                그래도 보내기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 갈등 중재 제안 배너 */}
      {showMediationBanner && !isStreaming && (
        <div className="px-2 pt-2">
          <div className="relative bg-white rounded-[6px] px-5 py-4 shadow-[var(--shadow-raised)]">
            <button
              type="button"
              aria-label="조율 상담 제안 숨기기"
              onClick={() => {
                setMediationDismissed(true);
              }}
              className="absolute top-2.5 right-2.5 tap-area shrink-0 w-6 h-6 rounded-full text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3">
              <AmoraAvatar sizeClassName="size-10" className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base text-[var(--hb-text-strong)] leading-relaxed font-medium">
                  {selfReportedConflictOffer
                    ? "혼자 마음에 담아두고 계신 것 같아요"
                    : "두 분 사이에 의견 차이가 있는 것 같아요"}
                </p>
                <p className="text-sm text-[var(--hb-text-body)] leading-relaxed mt-1">
                  {selfReportedConflictOffer
                    ? "원하시면 아모라가 두 분이 함께 볼 수 있게 정리해 드릴게요"
                    : "아모라가 중립적으로 의견 조율을 도와드릴게요"}
                </p>
                <button
                  onClick={openMediationConsent}
                  className={`${AMORA_ACTION_CLASS} mt-3`}
                >
                  <AmoraMark className="size-5 shrink-0" />
                  아모라에게 도움 요청하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 처음 여는 사람에게 '함께/나만'을 먼저 고르게 한다(2026-09-26). 입력창 바로 위. */}
      {laneChoiceNeeded && (
        <div className="px-2 pt-2 pb-3">
          <AmoraLaneChoiceCard
            onChoose={chooseLane}
            partnerLinked={hasLinkedPartner}
            disabled={isStreaming || isSending}
          />
        </div>
      )}

      {/* 시작 칩 — 첫 화면(사용자 메시지 0개)에만. 모바일과 같은 세 문장. */}
      {!isDemo &&
        laneReady &&
        initialLoadDone &&
        Boolean(coupleId) &&
        Boolean(profile) &&
        activeTab === "shared" &&
        messageTarget === "ai" &&
        transientArtifactsVisible &&
        suggestions.length === 0 &&
        !isStreaming &&
        !showAmoraQuickStart &&
        !showPersonalizationConfirmation &&
        !messages.some((m) => m.sender_role !== "ai") && (
        <div
          className="px-2 pt-2 pb-4 sm:pb-5 border-t border-[#F0EFED]/60 mt-2"
          data-testid="amora-starter-prompts"
        >
          <SuggestionButtons
            suggestions={[...AMORA_STARTER_PROMPTS]}
            onSelect={sendToAmora}
            disabled={isStreaming || isSending}
          />
        </div>
      )}

      {/* 제안 버튼 — 입력창과 충분한 간격 유지 */}
      {messageTarget === "ai" &&
        laneReady &&
        transientArtifactsVisible &&
        suggestions.length > 0 &&
        !isStreaming &&
        !showAmoraQuickStart &&
        !showPersonalizationConfirmation && (
        <div className="px-2 pt-2 pb-4 sm:pb-5 border-t border-[#F0EFED]/60 mt-2">
          <SuggestionButtons
            suggestions={suggestions}
            onSelect={sendToAmora}
            disabled={isStreaming || isSending}
          />
        </div>
      )}

      {/* 입력창 — ChatGPT 스타일로 reading width 유지 + 가운데 정렬 */}
      <div className="px-0 sm:px-2 pt-3 pb-2 w-full max-w-[53.75rem] mx-auto">
        {/* 첨부 미리보기 */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 px-1 sm:px-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="relative group">
                {att.previewUrl.startsWith("blob:") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Local object URLs are previews only, so next/image cannot optimize them.
                  <img
                    src={att.previewUrl}
                    alt={att.fileName}
                    className="w-20 h-20 rounded-[6px] object-cover shadow-sm"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-[6px] bg-[var(--hb-surface-hover)] flex flex-col items-center justify-center gap-1 px-1 shadow-sm">
                    {getFileIcon(att.mediaType)}
                    <span className="text-[9px] text-[var(--hb-text-body)] truncate max-w-[72px] text-center leading-tight">
                      {att.fileName}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label={`${att.fileName} 첨부 제거`}
                  className="absolute -right-4 -top-4 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--hb-action)] hover:bg-[var(--hb-action-hover)] text-white opacity-80 shadow-sm transition-opacity hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 대상 토글 — 한 단계 컴팩트 (px/py/font 톤다운) */}
        {laneReady && activeTab === "shared" && hasLinkedPartner && (
          <div
            className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 mb-2 px-0.5 sm:px-1"
            role="group"
            aria-label="메시지 받을 대상"
          >
            <button
              type="button"
              onClick={() => handleMessageTargetChange("ai")}
              disabled={isStreaming || isSending}
              aria-pressed={messageTarget === "ai"}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 sm:text-[0.8125rem] ${
                messageTarget === "ai"
                  ? "bg-[var(--hb-selected-bg)] text-[var(--hb-selected-text)] ring-1 ring-inset ring-[var(--hb-selected-line)] shadow-[var(--shadow-raised)]"
                  : "bg-white text-[var(--hb-text-body)] shadow-[var(--shadow-raised)] hover:text-[var(--hb-accent-hover)]"
              }`}
            >
              <AmoraMark className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              아모라에게
            </button>
            <button
              type="button"
              onClick={() => handleMessageTargetChange("partner")}
              disabled={isStreaming || isSending}
              aria-pressed={messageTarget === "partner"}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 sm:text-[0.8125rem] ${
                messageTarget === "partner"
                  ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] text-white shadow-[var(--shadow-raised)]"
                  : "bg-white text-[var(--hb-text-body)] shadow-[var(--shadow-raised)] hover:text-rose-700"
              }`}
            >
              <Heart className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              상대방에게
            </button>
          </div>
        )}

        {!isDemo && laneReady && <p className="mb-1.5 text-xs leading-relaxed text-[var(--hb-text-muted)]">미전송 글은 이 탭에서 30분 이내에 복구할 수 있어요. 전송·공유되지는 않으며, 첨부·안전 상담 등 일부 내용은 보관하지 않아요.</p>}
        {/* 입력칸은 outline-none 이라 키보드 초점이 보이지 않는다. 래퍼가 대신 안쪽 윤곽선으로 보여 준다(ring-1 상대 색 표시와 겹치지 않고 모바일 가장자리에서 잘리지 않음). */}
        <div className={`bg-white rounded-[6px] shadow-[var(--shadow-raised)] flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2.5 transition-colors has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:-outline-offset-2 has-[textarea:focus-visible]:outline-[var(--hb-focus-ring)] ${
          messageTarget === "partner"
            ? "ring-1 ring-[#D99C9C]/30"
            : isPrivate
              ? "ring-1 ring-[#5a6147]/30"
              : ""
        }`}>
          {/* 파일 첨부 버튼 */}
          <input
            ref={fileInputRef}
            type="file"
            accept={Object.keys(ALLOWED_TYPES)
              .filter((mediaType) => messageTarget !== "partner" || mediaType.startsWith("image/"))
              .join(",")}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || isSending || !laneReady || attachments.length >= MAX_ATTACHMENTS}
            aria-label="파일 첨부"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[6px] text-[var(--hb-text-muted)] transition-colors bg-[#f3e9df] hover:text-[var(--hb-accent-hover)] disabled:cursor-not-allowed disabled:opacity-30"
            title={
              messageTarget === "partner"
                ? "사진 첨부 (PDF·Word 문서는 아모라에게만 가능)"
                : "파일 첨부 (이미지, PDF, Word)"
            }
          >
            <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            // 고르기 전에는 비워 둔다. 들고 온 초안(`heldPrefillRef`)이 있어도 막힘 안내가 보여야
            // 하고, 그 초안은 고른 칸의 입력칸에 들어간다.
            value={laneChoiceNeeded ? "" : input}
            aria-label={
              messageTarget === "partner"
                ? "상대방에게 보낼 메시지 입력"
                : isPrivate
                  ? "나만의 아모라 상담 메시지 입력"
                  : "함께 보는 아모라 메시지 입력"
            }
            onChange={(e) => {
              setInput(e.target.value);
              resizeChatComposerToContent(e.currentTarget, e.target.value);
              // typing broadcast — 디바운스는 store 내부에서 처리, 여기선 매 입력마다 콜
              if (
                activeTab === "shared"
                && messageTarget === "partner"
                && coupleId
                && profile?.id
                && (profile.role === "bride" || profile.role === "groom")
              ) {
                const typingContext = {
                  coupleId,
                  userId: profile.id,
                  senderRole: profile.role,
                };
                sharedTypingContextRef.current = typingContext;
                notifyTyping(typingContext);
              }
            }}
            onKeyDown={(e) => {
              // Shift+Enter: 줄바꿈 (기본 동작 유지). Enter 단독: 전송.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                attemptSend();
                // 전송 후 높이 리셋
                if (textareaRef.current) {
                  textareaRef.current.style.height = "auto";
                }
              }
            }}
            onPaste={handlePaste}
            placeholder={
              laneChoiceNeeded
                ? AMORA_LANE_CHOICE_COPY.composerBlockedPlaceholder
                : messageTarget === "partner"
                ? "상대방에게 메시지…"
                : isPrivate
                  ? "아모라에게 솔직히…"
                  : "결혼 준비에서 궁금한 점을 물어보세요…"
            }
            // 고르기 전에는 읽기 전용으로 둔다. 비활성(disabled)으로 두면 안내 문구가 흐려져 읽기 어렵다.
            readOnly={laneChoiceNeeded}
            aria-disabled={laneChoiceNeeded || undefined}
            disabled={isStreaming || isSending || (!laneReady && !laneChoiceNeeded)}
            className="flex-1 min-w-0 px-1 sm:px-2 py-2.5 sm:py-3 text-[0.9375rem] text-[var(--hb-text-strong)] placeholder:text-[var(--hb-text-muted)] bg-transparent outline-none disabled:opacity-50 resize-none leading-6 max-h-[10rem] overflow-y-auto"
          />
          <button
            type="button"
            onClick={() => attemptSend()}
            disabled={
              (!input.trim() && attachments.length === 0)
              || !senderRole
              || !laneReady
              || isStreaming
              || isSending
              || pendingAttachmentReads > 0
            }
            aria-label={
              messageTarget === "partner"
                ? "상대방에게 메시지 보내기"
                : isPrivate
                  ? "나만의 아모라 상담 메시지 보내기"
                  : "함께 보는 아모라 메시지 보내기"
            }
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
              messageTarget === "partner"
                ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)]"
                : isPrivate
                  ? "bg-gradient-to-br from-[#5a6147] to-[#6e7755] shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)]"
                  : "bg-[var(--hb-action)] hover:bg-[var(--hb-action-hover)] shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)]"
            }`}
          >
            {messageTarget === "partner"
              ? <Heart className="w-4 h-4 sm:w-[1.125rem] sm:h-[1.125rem]" />
              : isPrivate
                ? <Lock className="w-4 h-4 sm:w-[1.125rem] sm:h-[1.125rem]" />
                : <Send className="w-4 h-4 sm:w-[1.125rem] sm:h-[1.125rem]" />
            }
          </button>
        </div>
      </div>

    </div>
      {/* 정보 패널 */}
      <ChatInfoPanel key={`${activeArtifactVisibility}:${infoPanelOpen}`} isOpen={infoPanelOpen} onClose={() => setInfoPanelOpen(false)}
        recap={activeArtifactVisibility ? {
          visibility: activeArtifactVisibility,
          nowMs,
          canDraft: !isStreaming && !isSending && !isDemo && laneReady
            && !composerDrafts[isPrivate ? "private_ai" : "shared_ai"].input.trim()
            && composerDrafts[isPrivate ? "private_ai" : "shared_ai"].attachments.length === 0
            && composerDrafts[isPrivate ? "private_ai" : "shared_ai"].pendingAttachmentReads === 0,
          onDraft: text => {
            const lane = isPrivate ? "private_ai" : "shared_ai";
            if (isStreaming || isSending || !laneReady || composerDrafts[lane].input.trim()
              || composerDrafts[lane].attachments.length || composerDrafts[lane].pendingAttachmentReads) return;
            setDraftInput(lane, text);
            setMessageTarget("ai");
            setInfoPanelOpen(false);
          },
        } : undefined} />
    </div>
  );
}
