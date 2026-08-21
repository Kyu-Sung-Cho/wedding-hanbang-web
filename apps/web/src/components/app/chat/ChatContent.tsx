"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type SetStateAction } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Send, Sparkles, X, PanelRightOpen, Paperclip, FileText, FileSpreadsheet, Heart, RefreshCw, Lock, Loader2, Search, MessageCircle, AlertTriangle, ShieldCheck, CheckCircle2, ExternalLink, User } from "lucide-react";
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
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  isPendingAmoraActionExpired,
} from "@/components/app/chat/PendingAmoraActionCard";
import {
  chatAttachmentKey,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_SNAPSHOT_ERROR,
  CHAT_ATTACHMENT_TYPE_INFO,
  prepareChatAttachmentPayload,
} from "@/lib/chat/attachments";
import { weddingPath } from "@/lib/weddingPaths";
import { AMORA_DEMO_SUGGESTIONS, AMORA_DEMO_WELCOME } from "@/lib/chat/amoraDemoCopy";
import {
  consumeDemoAmoraPrefill,
  forgetDemoAmoraPrefill,
  START_HERE_HANDOFF_QUERY_PARAM,
} from "@/lib/chat/demoHandoff";
import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
import { useAmoraPersonalization } from "@/hooks/useAmoraPersonalization";
import type { AmoraQuickStartOption } from "@/lib/amora/personalization";
import {
  assessMediationOffer,
  hasUnresolvedPrivateMediationSafetyHold,
} from "@/lib/chat/mediationOffer";
import { useMediationOfferDismissal } from "@/lib/chat/useMediationOfferDismissal";
import { deduplicateToolResults } from "./toolResultDeduplication";
import {
  resizeChatComposerToContent,
  useChatComposerAutoResize,
} from "./useChatComposerAutoResize";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { isAmoraCommunityBridgeSafetyScoped } from "@/lib/chat/amoraCommunitySafety";
import { getVisibleQuoteAnalysisMessage } from "@/lib/ai/quoteAnalysisSelection";

type CommunityDraftPrivacyMode = "shared" | "redacted_private";

const MAX_ATTACHMENTS = CHAT_ATTACHMENT_MAX_COUNT;
// 메시지 수가 이 이상이면 새 채팅 시작 안내
const NEW_CHAT_THRESHOLD = 200;

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
  attachments: AttachmentItem[];
  retryClientRequestId: string | null;
  pendingAttachmentReads: number;
}

interface PendingSend {
  text?: string;
  target: ChatMessageTarget;
}

interface MediationConsentContext {
  ownerUserId: string;
  coupleId: string;
  source: "automatic" | "manual";
  offerKey: string | null;
  privateSafetyEpoch: number;
}

function createEmptyComposerDrafts(): Record<ChatComposerLane, ChatComposerDraft> {
  return {
    shared_ai: {
      input: "",
      attachments: [],
      retryClientRequestId: null,
      pendingAttachmentReads: 0,
    },
    shared_partner: {
      input: "",
      attachments: [],
      retryClientRequestId: null,
      pendingAttachmentReads: 0,
    },
    private_ai: {
      input: "",
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
  return getVisibleQuoteAnalysisMessage(input)
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
  const { profile, couple, journey, partner, isDemo, isInitialized: authInitialized, isLoading: authLoading } = useAuthStore();
  const amoraPersonalization = useAmoraPersonalization(
    !isDemo && Boolean(profile?.id),
  );
  const saveAmoraPersonalization = amoraPersonalization.save;
  const {
    messages,
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
    mediationPersistentSafetyHold,
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
    applyMediationSafetyFence,
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
  const [clearStep, setClearStep] = useState<
    "closed" | "shared_choose" | "shared_confirm_both" | "private_confirm"
  >("closed");
  const [nowMs, setNowMs] = useState(0);
  const [dismissedPendingActionIds, setDismissedPendingActionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [applyingPendingActionId, setApplyingPendingActionId] = useState<string | null>(null);
  const applyingPendingActionRef = useRef<string | null>(null);
  const [showNewChatBanner, setShowNewChatBanner] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingPersonalization, setPendingPersonalization] =
    useState<PendingAmoraPersonalizationChoice | null>(null);
  const [mediationConsentContext, setMediationConsentContext] =
    useState<MediationConsentContext | null>(null);
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
  const composerIdentity = `${profile?.id ?? "anonymous"}:${coupleId ?? "no-couple"}:${senderRole ?? "no-role"}`;
  const composerIdentityRef = useRef(composerIdentity);
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

  useEffect(() => {
    if (composerIdentityRef.current === composerIdentity) return;
    composerIdentityRef.current = composerIdentity;
    composerEpochRef.current += 1;
    sendInFlightRef.current = null;
    greetingRequested.current = false;
    stopSharedTyping();
    setComposerDrafts((currentDrafts) => {
      Object.values(currentDrafts).forEach((draft) => {
        draft.attachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
      });
      return createEmptyComposerDrafts();
    });
    setActiveTab("shared");
    setMessageTarget("ai");
    setPendingSend(null);
    setMediationConsentContext(null);
  }, [composerIdentity, stopSharedTyping]);

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
    ) return;
    if (nextScope === "private") stopSharedTyping();
    setActiveTab(nextScope);
    setMessageTarget("ai");
  }, [isDemo, isSending, isStreaming, myPrivateVisibility, stopSharedTyping]);

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
  const {
    dismissedOfferKey: dismissedMediationOfferKey,
    dismissalReady: mediationDismissalReady,
    dismissOffer: dismissMediationOffer,
  } = useMediationOfferDismissal(profile?.id, coupleId);
  const mediationConsentOwned = mediationConsentContext !== null
    && mediationConsentContext.ownerUserId === profile?.id
    && mediationConsentContext.coupleId === coupleId;
  const mediationOfferClockMinute = Math.floor(nowMs / 60_000);
  const mediationOfferAssessment = useMemo(
    () => assessMediationOffer(messages, {
      nowMs: mediationOfferClockMinute * 60_000,
    }),
    [mediationOfferClockMinute, messages],
  );
  const localPrivateMediationSafetyEpoch = myPrivateVisibility
    ? messages.filter((message) => (
        message.visibility === myPrivateVisibility
        && message.sender_role === "ai"
        && message.metadata?.pinned_safety_card === true
      )).length
    : 0;
  const hasLocalPrivateMediationSafetyHold =
    hasUnresolvedPrivateMediationSafetyHold(messages, senderRole);
  const hasVisibleSharedSafetyCard = messages.some((message) => (
    message.visibility === "shared"
    && message.sender_role === "ai"
    && (
      message.metadata?.pinned_safety_card === true
      || typeof message.metadata?.safety_classification === "string"
    )
  ));
  const mediationRetryBlockedBySafety = failedRequest?.requestKind === "mediation"
    && (
      mediationPersistentSafetyHold
      || hasVisibleSharedSafetyCard
      || hasLocalPrivateMediationSafetyHold
    );
  useEffect(() => {
    if (coupleId && (hasVisibleSharedSafetyCard || hasLocalPrivateMediationSafetyHold)) {
      applyMediationSafetyFence(coupleId);
    }
  }, [applyMediationSafetyFence, coupleId, hasLocalPrivateMediationSafetyHold, hasVisibleSharedSafetyCard]);
  const mediationConsentOpen = mediationConsentOwned
    && mediationConsentContext.privateSafetyEpoch === localPrivateMediationSafetyEpoch
    && !hasVisibleSharedSafetyCard
    && !hasLocalPrivateMediationSafetyHold
    && !mediationPersistentSafetyHold;
  useEffect(() => {
    if (
      mediationConsentContext
      && (
        mediationPersistentSafetyHold
        || hasVisibleSharedSafetyCard
        || hasLocalPrivateMediationSafetyHold
      )
    ) {
      setMediationConsentContext(null);
    }
  }, [hasLocalPrivateMediationSafetyHold, hasVisibleSharedSafetyCard, mediationConsentContext, mediationPersistentSafetyHold]);
  const showMediationBanner =
    activeTab === "shared"
    && mediationDismissalReady
    && mediationOfferAssessment.shouldOffer
    && mediationOfferAssessment.offerKey !== null
    && dismissedMediationOfferKey !== mediationOfferAssessment.offerKey
    && !hasVisibleSharedSafetyCard
    && !hasLocalPrivateMediationSafetyHold
    && !mediationPersistentSafetyHold
    && !mediationConsentOpen;
  const showManualMediationEntry =
    activeTab === "shared"
    && hasLinkedPartner
    && mediationDismissalReady
    && !showMediationBanner
    && !hasVisibleSharedSafetyCard
    && !hasLocalPrivateMediationSafetyHold
    && !mediationPersistentSafetyHold
    && !mediationConsentOpen
    && !isStreaming
    && !isSending;
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
  const router = useRouter();
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
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
    const prefill = startHereHandoffId
      ? handoffPrefill
      : queryPrefill ?? handoffPrefill;
    const shouldCleanUrl = Boolean(queryPrefill) || Boolean(startHereHandoffId);
    if (!prefill) {
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
    setDraftInput("shared_ai", prefill);
    // 질문 원문과 일회성 가입 표식은 입력창에 적용한 직후 주소에서 제거한다.
    if (shouldCleanUrl) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("prefill");
      next.delete(START_HERE_HANDOFF_QUERY_PARAM);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    }
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [searchParams, router, setDraftInput]);

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
    if (!coupleId || isDemo || proactiveCheckedRef.current) return;
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

  // 메시지가 threshold 넘으면 새 채팅 안내
  useEffect(() => {
    if (messages.length >= NEW_CHAT_THRESHOLD && !showNewChatBanner) {
      const timer = window.setTimeout(() => setShowNewChatBanner(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [messages.length, showNewChatBanner]);

  // 메시지 0개 + 로딩 완료 시 AI 첫 인사
  useEffect(() => {
    if (
      !coupleId ||
      !profile ||
      isDemo ||
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
  }, [coupleId, profile, journey, initialLoadDone, messages.length, isStreaming, requestInitialGreeting, isDemo]);

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
      const usesComposer = text === undefined;
      const content = usesComposer ? input.trim() : text;
      const currentAttachments = usesComposer ? [...attachments] : [];
      const sourceLane = activeComposerLane;
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

      try {
        const outcome = await sendMessage({
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
          images: canTransmitAttachments && currentAttachments.length > 0
            ? currentAttachments
            : undefined,
          target: sendTarget,
          ...(sendTarget === "partner" && linkedPartnerId
            ? { partnerRecipientId: linkedPartnerId }
            : {}),
          visibility,
          ...(submittedClientRequestId
            ? { clientRequestId: submittedClientRequestId }
            : {}),
        });
        if (outcome?.userMessage === "ephemeral_safety") {
          setActiveTab("private");
          setMessageTarget("ai");
          setDraftRetryClientRequestId(submittedLane, null);
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

  const dismissPendingAmoraAction = useCallback((actionId: string) => {
    setDismissedPendingActionIds((current) => {
      if (current.has(actionId)) return current;
      const next = new Set(current);
      next.add(actionId);
      return next;
    });
  }, []);

  const openCommunityDraft = useCallback((aiMessage: ChatMessage, userMessage: ChatMessage) => {
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
    if (!communityDraft || communityPosting) return;
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
    if (
      !hasVisibleSharedSafetyCard
      && !hasLocalPrivateMediationSafetyHold
      && !mediationPersistentSafetyHold
      && profile?.id
      && coupleId
      && mediationOfferAssessment.offerKey
    ) {
      setMediationConsentContext({
        ownerUserId: profile.id,
        coupleId,
        source: "automatic",
        offerKey: mediationOfferAssessment.offerKey,
        privateSafetyEpoch: localPrivateMediationSafetyEpoch,
      });
    }
  }, [coupleId, hasLocalPrivateMediationSafetyHold, hasVisibleSharedSafetyCard, localPrivateMediationSafetyEpoch, mediationOfferAssessment.offerKey, mediationPersistentSafetyHold, profile?.id]);

  const openManualMediationConsent = useCallback(() => {
    if (mediationPersistentSafetyHold || hasVisibleSharedSafetyCard || hasLocalPrivateMediationSafetyHold || !profile?.id || !coupleId) return;
    setMediationConsentContext({
      ownerUserId: profile.id,
      coupleId,
      source: "manual",
      offerKey: null,
      privateSafetyEpoch: localPrivateMediationSafetyEpoch,
    });
  }, [coupleId, hasLocalPrivateMediationSafetyHold, hasVisibleSharedSafetyCard, localPrivateMediationSafetyEpoch, mediationPersistentSafetyHold, profile?.id]);

  const cancelMediationConsent = useCallback(() => {
    if (
      mediationConsentContext
      && mediationConsentContext.ownerUserId === profile?.id
      && mediationConsentContext.coupleId === coupleId
      && mediationConsentContext.source === "automatic"
      && mediationConsentContext.offerKey
    ) {
      dismissMediationOffer(mediationConsentContext.offerKey);
    }
    setMediationConsentContext(null);
  }, [coupleId, dismissMediationOffer, mediationConsentContext, profile?.id]);

  const confirmMediationConsent = useCallback(
    async (requesterSummary: string) => {
      const consentContext = mediationConsentContext;
      if (
        !coupleId
        || !profile
        || (profile.role !== "bride" && profile.role !== "groom")
        || !consentContext
        || consentContext.ownerUserId !== profile.id
        || consentContext.coupleId !== coupleId
        || consentContext.privateSafetyEpoch !== localPrivateMediationSafetyEpoch
        || hasVisibleSharedSafetyCard
        || hasLocalPrivateMediationSafetyHold
        || mediationPersistentSafetyHold
      ) {
        setMediationConsentContext(null);
        return;
      }
      if (
        consentContext.source === "automatic"
        && consentContext.offerKey
      ) {
        dismissMediationOffer(consentContext.offerKey);
      }
      setMediationConsentContext(null);
      setMessageTarget("ai");
      if (!isDemo) setActiveTab("private");
      await requestStructuredMediation({
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
    },
    [
      coupleId,
      hasLocalPrivateMediationSafetyHold,
      hasVisibleSharedSafetyCard,
      mediationPersistentSafetyHold,
      localPrivateMediationSafetyEpoch,
      dismissMediationOffer,
      isDemo,
      journey,
      mediationConsentContext,
      profile,
      requestStructuredMediation,
    ],
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
  }, [activeTab]);

  // 실제 clear 수행 — mode는 명시적으로 전달
  const performClear = useCallback(
    async (mode: "view_reset_shared" | "delete_shared" | "view_reset_private" | "delete_private") => {
      if (!coupleId) return;
      greetingRequested.current = false;
      try {
        await clearMessages(coupleId, mode);
        setClearStep("closed");
        setShowNewChatBanner(false);
      } catch {
        // chatStore.error renders the failure; keep the modal open so the user can retry.
      }
    },
    [coupleId, clearMessages]
  );

  // 인증 부팅 전 — 빈 데이터로 잘못된 gate 노출 방지
  if (!authInitialized || authLoading) {
    return (
      <div
        className={`${embedded ? "h-full" : "h-[calc(100dvh-144px)]"} flex items-center justify-center bg-[#FAFAF8]`}
      >
        <Loader2 className="w-7 h-7 text-[#795252] animate-spin" />
      </div>
    );
  }

  // 커플이 없는 경우 — 온보딩 안내 + actionable CTA
  if (!coupleId) {
    return (
      <div
        className={`${embedded ? "h-full" : "h-[calc(100dvh-144px)]"} max-w-[800px] mx-auto flex items-center justify-center bg-[#FAFAF8] px-4`}
      >
        <div className="text-center bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 sm:p-10 max-w-md w-full">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#C4967E]/15 to-[#C9A96E]/15 mb-4">
            <Sparkles className="w-7 h-7 text-[#795252]" />
          </div>
          <h3 className="font-serif-kr text-xl sm:text-2xl text-[#1A1A1F] font-light mb-2">
            아모라 상담 시작 전 한 단계만
          </h3>
          <p className="text-sm sm:text-base text-[#504444] leading-relaxed mb-6">
            결혼식 정보를 한 번만 입력하시면, 아모라가 맞춤 상담을 시작합니다.
            (1분 정도 소요)
          </p>
          <a
            href={weddingPath("/onboarding")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-base font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            온보딩 시작하기
          </a>
        </div>
      </div>
    );
  }

  // 첨부 파일 아이콘 결정
  const getFileIcon = (mediaType: string) => {
    if (mediaType.includes("word") || mediaType === "application/msword") return <FileText className="w-7 h-7 text-[#4285F4]" />;
    if (mediaType.includes("spreadsheet") || mediaType.includes("ms-excel")) return <FileSpreadsheet className="w-7 h-7 text-[#34A853]" />;
    if (mediaType === "application/pdf") return <FileText className="w-7 h-7 text-[#795252]" />;
    return <FileText className="w-7 h-7 text-[#504444]" />;
  };

  return (
    <div
      className={`relative h-full bg-[#FAFAF8] transition-[padding] duration-300 ${infoPanelOpen ? "md:pr-[390px]" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 드래그 오버레이 */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-[#795252]/10 border-2 border-dashed border-[#795252] flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-xl px-8 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.15)] text-center">
            <Paperclip className="w-12 h-12 text-[#795252] mx-auto mb-3" />
            <p className="text-lg font-medium text-[#1A1A1F]">파일을 여기에 놓으세요</p>
            <p className="text-sm text-[#504444] mt-1">이미지, PDF, Word</p>
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
              className="w-full max-w-[36rem] rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="community-draft-dialog-title"
              tabIndex={-1}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#F0EFED] px-5 py-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.18em] text-[#795252]">COMMUNITY</p>
                  <h3 id="community-draft-dialog-title" className="mt-1 font-serif-kr text-xl text-[#1A1A1F]">이 내용으로 커뮤니티에 물어볼게요</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCommunityDraft(null)}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[#928980] hover:bg-[#F6F3F2] hover:text-[#1A1A1F] transition-colors"
                  aria-label="닫기"
                  data-modal-initial-focus
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {communityDraft.postedPostId ? (
                <div className="px-5 py-6">
                  <div className="flex items-start gap-3 rounded-xl border border-[#D8E8DF] bg-[#F2FAF5] px-4 py-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2E7D5A]" />
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A1F]">커뮤니티에 올라갔어요</p>
                      <p className="mt-1 text-sm leading-relaxed text-[#504444]">
                        다른 예비부부들이 댓글로 의견을 남길 수 있습니다.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCommunityDraft(null)}
                      className="rounded-xl border border-[#E8DDD3] px-4 py-2 text-sm font-medium text-[#504444] hover:bg-[#FAF7F2] transition-colors"
                    >
                      닫기
                    </button>
                    {postedHref && (
                      <a
                        href={postedHref}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#2F5F51] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264f43] transition-colors"
                      >
                        글 보러가기
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-h-[72dvh] overflow-y-auto px-5 py-4">
                  <div className="rounded-xl border border-[#F0E6D8] bg-[#FFF9EB] px-4 py-3">
                    <p className="text-sm leading-relaxed text-[#6E5732]">
                      커뮤니티에 공개되는 글입니다. 이름과 생년월일, 연락처, 정확한
                      주소, 건강·임신·성생활·민감한 가족관계, 계약·예약번호가
                      들어가 있으면 지우고 올려주세요. 사진 속 글자도 직접 확인해
                      주세요.
                    </p>
                  </div>

                  {communityDraft.privacyMode === "redacted_private" && (
                    <div className="mt-3 rounded-xl border border-[#D8E8DF] bg-[#F2FAF5] px-4 py-3">
                      <p className="text-sm leading-relaxed text-[#2F5F51]">
                        비공개 상담에서 만든 익명화 초안입니다. 아모라 답변 원문은 넣지 않았고, 공개 가능한 상황 설명만 남겼어요. 그래도 올리기 전에 개인적인 표현이 남아있는지 한 번만 확인해주세요.
                      </p>
                    </div>
                  )}

                  {sensitiveLabels.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#F2D3C7] bg-[#FFF4EF] px-4 py-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B25A3C]" />
                      <p className="text-sm leading-relaxed text-[#8A4A35]">
                        {sensitiveLabels.join(", ")} 표현이 보입니다. 해당 부분을 지우면 바로 게시할 수 있어요.
                      </p>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#F6F3F2] p-1">
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
                        className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          communityDraft.category === item.key
                            ? "bg-white text-[#795252] shadow-sm"
                            : "text-[#928980] hover:text-[#504444]"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium text-[#504444]">제목</span>
                    <input
                      value={communityDraft.title}
                      onChange={(e) => {
                        setCommunityPostError(null);
                        setCommunityDraft((draft) => draft ? { ...draft, title: e.target.value.slice(0, 200) } : draft);
                      }}
                      className="w-full rounded-xl border border-[#E8DDD3] bg-white px-3 py-2.5 text-base text-[#1A1A1F] outline-none focus:border-[#C4967E]"
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium text-[#504444]">본문</span>
                    <textarea
                      value={communityDraft.content}
                      onChange={(e) => {
                        setCommunityPostError(null);
                        setCommunityDraft((draft) => draft ? { ...draft, content: e.target.value.slice(0, 50000) } : draft);
                      }}
                      rows={11}
                      className="w-full resize-none rounded-xl border border-[#E8DDD3] bg-white px-3 py-2.5 text-base leading-relaxed text-[#1A1A1F] outline-none focus:border-[#C4967E]"
                    />
                  </label>

                  {communityPostError && (
                    <p className="mt-3 rounded-xl bg-[#FFF4EF] px-3 py-2 text-sm text-[#8A4A35]">
                      {communityPostError}
                    </p>
                  )}

                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setCommunityDraft(null)}
                      className="rounded-xl border border-[#E8DDD3] px-4 py-2.5 text-sm font-medium text-[#504444] hover:bg-[#FAF7F2] transition-colors"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={submitCommunityDraft}
                      disabled={!canPost}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2F5F51] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264f43] disabled:cursor-not-allowed disabled:bg-[#A8B6AD] transition-colors"
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
      {/* 상단 통합 툴바 — 탭(함께/나만) + 액션(검색·정보·새채팅) 한 줄
          ChatContent root 는 full-width 라 메시지 컨테이너 스크롤바가
          viewport 우측 가장자리에 위치. 툴바·입력박스만 reading column 으로
          가운데 정렬. */}
      <div className="flex items-center gap-2 px-2 pb-2 pt-1 w-full max-w-[70rem] mx-auto">
        {/* 탭 — 좌측 차지 (메인 동작) */}
        <div
          className="flex items-center gap-1 flex-1 min-w-0 p-1 bg-[#F6F3F2] rounded-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
          role="group"
          aria-label="대화 공개 범위"
        >
          <button
            type="button"
            onClick={() => handleScopeChange("shared")}
            disabled={isStreaming || isSending}
            aria-pressed={activeTab === "shared"}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activeTab === "shared"
                ? "bg-white text-[#795252] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                : "text-[#928980] hover:text-[#504444]"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            함께 대화
            {sharedMessageCount > 0 && (
              <span className="text-xs text-[#B5ADA3] hidden sm:inline">({sharedMessageCount})</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleScopeChange("private")}
            disabled={isDemo || isStreaming || isSending || !myPrivateVisibility}
            aria-pressed={activeTab === "private"}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activeTab === "private"
                ? "bg-white text-[#5a6147] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                : "text-[#928980] hover:text-[#504444]"
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
              <span className="hidden text-xs text-[#928980] sm:inline">(계정)</span>
            ) : privateMessageCount > 0 ? (
              <span className="text-xs text-[#B5ADA3] hidden sm:inline">({privateMessageCount})</span>
            ) : null}
          </button>
        </div>

        {/* 액션 — 우측 (검색/정보/새채팅) */}
        <div className="flex items-center gap-0.5 shrink-0">
          <a
            href="/ai-policy"
            className="flex items-center justify-center h-9 px-2 rounded-lg text-[0.6875rem] font-medium text-[#928980] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors"
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
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              searchOpen
                ? "text-[#795252] bg-[#795252]/10"
                : "text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5"
            }`}
            aria-label="대화 검색"
            title="대화 검색"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => setInfoPanelOpen(!infoPanelOpen)}
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              infoPanelOpen
                ? "text-[#795252] bg-[#795252]/10"
                : "text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5"
            }`}
            aria-label="정보 패널"
            title="정보 패널"
          >
            <PanelRightOpen className="w-4 h-4" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={openNewChatModal}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors"
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
          activeTab === "private" ? "text-[#5a6147]" : "text-[#795252]"
        }`}
      >
        {isDemo
          ? "현재 범위 · 체험용 함께 대화 — 체험 대화와 변경은 계정의 준비 기록에 남지 않아요"
          : activeTab === "private"
          ? "현재 범위 · 나만 (상담) — 서비스에 저장되며 상대방에게는 보이지 않아요"
          : "현재 범위 · 함께 대화 — 파트너에게 보여요"}
      </p>

      {/* 아모라 답변이 AI 생성임을 화면에서도 항상 확인할 수 있게 한 번 표시한다. */}
      <div className="mx-auto mb-1 flex w-full max-w-[70rem] flex-wrap items-center gap-x-2 gap-y-1 px-3 text-[0.6875rem] leading-5 text-[#5F5A55]">
        <span className="inline-flex min-h-6 items-center gap-1 font-semibold text-[#795252]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#795252]" aria-hidden="true" />
          AI 생성 답변
        </span>
        <span aria-hidden="true" className="text-[#928980]">·</span>
        <span>계약·가격·중요 일정은 원문을 다시 확인해 주세요</span>
        <span aria-hidden="true" className="text-[#928980]">·</span>
        <a
          href="/ai-policy"
          className="inline-flex min-h-6 items-center font-semibold underline decoration-dotted underline-offset-2 transition-colors hover:text-[#795252]"
        >
          AI 정책
        </a>
      </div>

      {/* 검색 바 — 헤더 아래 토글 */}
      {searchOpen && (
        <div className="mx-2 mb-2 flex items-center gap-2 px-3 py-2 bg-white border border-[#F0EFED] rounded-xl shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
          <Search className="w-4 h-4 text-[#B5ADA3] shrink-0" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="대화 내용 검색..."
            className="flex-1 min-w-0 text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-[#B5ADA3] hover:text-[#1A1A1F]"
              aria-label="검색어 지우기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* 새 채팅 안내 배너 (대화가 길어졌을 때) */}
      {showNewChatBanner && !isStreaming && (
        <div className="mx-2 mb-2 p-3.5 rounded-xl bg-[#795252]/5 flex items-center justify-between shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <p className="text-sm text-[#795252]">
            대화가 길어졌어요. 이전 메시지를 화면에서 정리해도 원문 데이터와 아모라가 참고하는 기존 맥락은 유지돼요.
          </p>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <button onClick={() => setShowNewChatBanner(false)} className="px-3.5 py-1.5 text-sm rounded-lg bg-white text-[#504444] hover:bg-[#F6F3F2] shadow-sm">괜찮아요</button>
            <button onClick={openNewChatModal} className="px-3.5 py-1.5 text-sm rounded-lg bg-gradient-to-br from-[#795252] to-[#946a6a] text-white hover:shadow-md">화면 정리</button>
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
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-chat-dialog-title"
            tabIndex={-1}
          >
            {/* Step 1a: 함께 대화 — 옵션 선택 */}
            {clearStep === "shared_choose" && (
              <>
                <h3 id="new-chat-dialog-title" className="text-lg font-semibold text-[#1A1A1F] mb-2">함께 대화 화면 정리</h3>
                <p className="text-sm text-[#504444] leading-relaxed mb-5">
                  화면에 보이는 이전 대화를 정리할 방법을 골라주세요. 원문 데이터와
                  아모라가 참고하는 기존 맥락은 그대로 유지돼요.
                  <br />
                  <span className="text-[#928980] text-[12.5px]">비공개 상담 기록은 영향받지 않아요.</span>
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => performClear("view_reset_shared")}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#5a6147]/30 bg-[#5a6147]/5 hover:bg-[#5a6147]/10 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[#5a6147] mb-1">내 화면만 정리 (추천)</div>
                    <div className="text-[12px] text-[#504444]">
                      상대방 화면은 그대로 두고, 내 화면에서만 이전 메시지를 정리해요.
                    </div>
                  </button>
                  <button
                    onClick={() => setClearStep("shared_confirm_both")}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#E8DDD3] bg-[#FAF7F2]/50 hover:bg-[#FAF7F2] transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[#795252] mb-1">둘의 화면 함께 정리 (상대방 동의 필요)</div>
                    <div className="text-[12px] text-[#504444]">
                      상대방에게 동의 요청을 보내요. 상대방이 [동의] 누르면 양쪽 화면이
                      함께 정리돼요. <strong>원문과 아모라의 기존 맥락은 유지</strong>돼요.
                    </div>
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setClearStep("closed")}
                    autoFocus
                    className="min-h-11 px-4 text-sm rounded-lg bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE8E5]"
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
                <h3 id="new-chat-dialog-title" className="text-lg font-semibold text-[#1A1A1F] mb-2">둘의 화면 정리 동의를 요청할게요</h3>
                <p className="text-sm text-[#504444] leading-relaxed mb-5">
                  채팅에 동의 카드가 올라가고 상대방이 [동의] 누르면 양쪽 화면이
                  정리됩니다. 거절되면 그대로 유지돼요.
                  <br />
                  <span className="text-[#928980] text-[12.5px]">
                    원문 데이터와 아모라가 참고하는 기존 맥락은 유지돼요.
                  </span>
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setClearStep("shared_choose")}
                    autoFocus
                    className="min-h-11 px-4 text-sm rounded-lg bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE8E5]"
                    data-modal-initial-focus
                  >
                    돌아가기
                  </button>
                  <button
                    onClick={async () => {
                      if (!coupleId) return;
                      const result = await requestSharedClear(coupleId);
                      if (!result.ok) {
                        // 실패 시 별도 처리 안 함 — 사용자가 다시 시도 가능
                      }
                      setClearStep("closed");
                    }}
                    className="min-h-11 px-4 text-sm rounded-lg bg-[#795252] text-white hover:bg-[#946a6a]"
                  >
                    동의 요청 보내기
                  </button>
                </div>
              </>
            )}

            {/* Step 2: 나만 (상담) — 단순 확인 */}
            {clearStep === "private_confirm" && (
              <>
                <h3 id="new-chat-dialog-title" className="text-lg font-semibold text-[#1A1A1F] mb-2">비공개 상담 화면 정리</h3>
                <p className="text-sm text-[#504444] leading-relaxed mb-5">
                  화면만 정리할지, 비공개 대화·기억까지 삭제할지 선택해주세요.
                  <br />
                  <span className="text-[#928980] text-[12.5px]">
                    상대방의 비공개 상담에는 영향이 없어요.
                  </span>
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => performClear("view_reset_private")}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#5a6147]/30 bg-[#5a6147]/5 hover:bg-[#5a6147]/10 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[#5a6147] mb-1">내 화면만 정리 (추천)</div>
                    <div className="text-[12px] text-[#504444]">
                      원문 데이터와 아모라가 참고하는 기존 맥락은 유지돼요.
                    </div>
                  </button>
                  <button
                    onClick={() => performClear("delete_private")}
                    className="w-full text-left px-4 py-3 rounded-xl border border-red-300 bg-red-50/50 hover:bg-red-50 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-red-600 mb-1">
                      비공개 대화·아모라 기억 삭제
                    </div>
                    <div className="text-[12px] leading-relaxed text-[#504444]">
                      이 대화와 아모라가 만든 요약·기억을 삭제하고 비공개 기억
                      사용을 꺼요. 별도 저장 메모·법적/보안 로그·백업은 각 보관
                      정책에 따라 처리돼요.
                    </div>
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setClearStep("closed")}
                    autoFocus
                    className="min-h-11 px-4 text-sm rounded-lg bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE8E5]"
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
        {/* Private 탭 안내 (탭 들어가면 항상 보임) */}
        {activeTab === "private" && (
          <div className="mb-2 px-3 py-2.5 rounded-lg bg-[#5a6147]/8 border border-[#5a6147]/20 flex items-start gap-2 text-[12.5px] text-[#5a6147] leading-relaxed">
            <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-[2px]" />
            <span>
              비공개 상담 — 이 탭의 대화는 <strong>서비스에 저장되지만 상대방에게는 보이지 않아요</strong>. 아모라와 1:1로 이야기할 수 있어요.
            </span>
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
            ? tabMessages.filter((m) => m.content.toLowerCase().includes(q))
            : tabMessages;

          if (q && filteredMessages.length === 0) {
            return (
              <div className="text-center py-12 text-[#928980] text-sm">
                <Search className="w-8 h-8 text-[#B5ADA3]/40 mx-auto mb-2" />
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
          const latestSharedMessageId = [...messages]
            .reverse()
            .find((message) => (
              message.visibility === "shared"
              && message.metadata?.target !== "partner"
            ))?.id ?? null;
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
              && !dismissedPendingActionIds.has(pendingActionCandidate.actionId)
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
              ? getPendingActionDisabledReason(
                  pendingAction,
                  nowMs,
                  msg.id === latestSharedMessageId,
                  isStreaming || isSending,
                )
              : null;
            const pendingBudgetImpactPreview = pendingAction
              ? getPendingAmoraBudgetImpactPreview(msg, pendingAction)
              : null;

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
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] shadow-sm sm:h-11 sm:w-11">
                      <Sparkles aria-hidden="true" className="h-4 w-4 text-white sm:h-5 sm:w-5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-base font-medium text-[#928980]">아모라</span>
                      <div
                        data-amora-safety-card="true"
                        role="alert"
                        aria-live="assertive"
                        aria-label="긴급 안전 안내"
                        className="rounded-2xl border border-danger-500/30 bg-danger-500/[0.04] px-4 py-4 shadow-sm"
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
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#263832]">
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
                    isCurrentUser={isCurrentUser}
                    senderName={
                      msg.sender_id && msg.sender_id === partner?.id
                        ? partner.name
                        : null
                    }
                    isRecentAi={recentAiIds.has(msg.id)}
                    onNegativeFeedback={markCommunityFallbackAvailable}
                    onMediationDraftShared={(draftMessageId, sharedMessageId) => {
                      useChatStore.setState((state) => ({
                        messages: state.messages.map((message) => message.id === draftMessageId
                          ? {
                              ...message,
                              metadata: {
                                ...(message.metadata ?? {}),
                                mediation_draft_state: "sent",
                                mediation_shared_message_id: sharedMessageId,
                              },
                            }
                          : message),
                      }));
                      if (coupleId) void loadMessages(coupleId);
                    }}
                    onMediationDraftDiscarded={(draftMessageId) => {
                      useChatStore.setState((state) => ({
                        messages: state.messages.filter((message) => message.id !== draftMessageId),
                      }));
                    }}
                    onOpenSharedMediation={() => setActiveTab("shared")}
                  />
                )}
                {pendingAction && (
                  <PendingAmoraActionCard
                    action={pendingAction}
                    impactPreview={pendingBudgetImpactPreview}
                    messageId={msg.id}
                    disabledReason={pendingActionDisabledReason}
                    isApplying={applyingPendingActionId === pendingAction.actionId}
                    onApply={(actionId) => void applyPendingAmoraAction(actionId)}
                    onDismiss={() => dismissPendingAmoraAction(pendingAction.actionId)}
                  />
                )}
                {displayCommunityAskCue && previousHumanMessage && (
                  <div className="ml-11 mt-1 flex max-w-[94%] sm:ml-14 sm:max-w-[53.75rem]">
                    <button
                      type="button"
                      onClick={() => openCommunityDraft(msg, previousHumanMessage)}
                      aria-label={displayCommunityAskCue.ariaLabel}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#D8C7BB] bg-white/80 px-3 py-1.5 text-sm font-medium text-[#2F5F51] shadow-sm hover:border-[#2F5F51]/40 hover:bg-[#F6FAF7] transition-colors"
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
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center text-white shadow-sm">
                <User className="w-4 h-4" />
              </div>
              <div className="bg-white border border-black/[0.06] rounded-2xl rounded-tl-md px-4 py-3 shadow-sm flex items-center gap-1.5">
                <span className="text-[13px] text-[#928980]">{label} 입력 중</span>
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
          className="absolute bottom-[140px] right-4 sm:right-6 z-20 w-11 h-11 rounded-full bg-white text-[#795252] shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#E8DDD3] hover:bg-[#FAF8F5] flex items-center justify-center transition-colors"
          aria-label="최신 메시지로"
          title="최신 메시지로"
        >
          ↓
        </button>
      )}

      {/* 쿼터 소진 예고 — 갑작스런 차단(429) 대신 미리 안내 */}
      {transientArtifactsVisible && quotaRemaining !== null && !isStreaming && (
        <div className="mx-2 mt-2 flex items-center justify-between rounded-xl bg-[#f6efe5] p-3 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <p className="text-[13px] font-medium text-[#6d625a]">
            {quotaRemaining > 0
              ? `베타 무료 상담이 ${quotaRemaining}회 남았어요. 소진돼도 예산·일정 기록은 그대로 보관돼요.`
              : "베타 무료 상담을 모두 사용했어요. 예산·일정 기록은 그대로 보관돼요."}
          </p>
          <button
            onClick={() => useChatStore.setState({ quotaRemaining: null })}
            className="ml-2 flex-shrink-0 text-[#b5ada3] hover:text-[#6d625a]"
            aria-label="안내 닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 에러 메시지 */}
      {transientArtifactsVisible && error && !isStreaming && (
        <div
          className={`mx-2 mt-2 rounded-xl border p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] ${
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
              isRecoveryNotice ? "text-[#356B66]" : "text-red-600"
            }`}>
              {failedRequest.unavailableReason}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            {failedRequest?.canRetry && !mediationRetryBlockedBySafety && (
              <button
                type="button"
                onClick={() => void retryFailedMessage()}
                disabled={isStreaming || isRetrying}
                className={`min-h-9 rounded-lg px-3.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
            <button
              type="button"
              onClick={dismissFailedMessageRetry}
              disabled={isStreaming || isRetrying}
              className={`min-h-9 rounded-lg border bg-white px-3.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-send-dialog-title"
            tabIndex={-1}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-[#C9A96E]/15 flex items-center justify-center text-[#C9A96E]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 id="pending-send-dialog-title" className="font-serif-kr text-lg sm:text-xl text-[#1A1A1F] font-light mb-1.5 leading-snug">
                  잠시 기다리시겠어요?
                </h3>
                <p className="text-sm text-[#504444] leading-relaxed">
                  {partnerTypingActive
                    ? `${partner?.name ?? "상대방"}이 지금 입력하고 있어요. 같이 보내면 진행 중인 흐름이 꼬일 수 있어요.`
                    : "아모라가 방금 보낸 메시지에 답변하고 있어요. 지금 새 메시지를 보내면 진행 중인 답변이 중단될 수 있어요."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingSend(null)}
                className="min-h-11 flex-1 px-4 rounded-xl text-sm font-medium text-[#1A1A1F] bg-[#F6F3F2] hover:bg-[#EDE8E5] transition-colors"
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
                className="min-h-11 flex-1 px-4 rounded-xl text-sm font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] hover:shadow-md transition-colors"
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
          <div className="relative bg-white rounded-xl px-5 py-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <button
              type="button"
              onClick={() => {
                if (mediationOfferAssessment.offerKey) {
                  dismissMediationOffer(mediationOfferAssessment.offerKey);
                }
              }}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full text-[#B5ADA3] hover:text-[#504444]"
              aria-label="조율 상담 제안 숨기기"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base text-[#1A1A1F] leading-relaxed font-medium">
                  대화 정리가 필요할까요?
                </p>
                <p className="text-sm text-[#504444] leading-relaxed mt-1">
                  원하시면 한쪽 편을 들지 않는 조율 초안을 함께 만들어 볼 수 있어요
                </p>
                <button
                  type="button"
                  onClick={openMediationConsent}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 px-5 rounded-xl text-sm font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  아모라에게 도움 요청하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 제안 버튼 — 입력창과 충분한 간격 유지 */}
      {messageTarget === "ai" &&
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
                    className="w-20 h-20 rounded-lg object-cover shadow-sm"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-[#F6F3F2] flex flex-col items-center justify-center gap-1 px-1 shadow-sm">
                    {getFileIcon(att.mediaType)}
                    <span className="text-[9px] text-[#504444] truncate max-w-[72px] text-center leading-tight">
                      {att.fileName}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label={`${att.fileName} 첨부 제거`}
                  className="absolute -right-4 -top-4 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white opacity-80 shadow-sm transition-opacity hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showManualMediationEntry && (
          <div className="mb-1 flex justify-end px-0.5 sm:px-1">
            <button
              type="button"
              data-mediation-entry="manual"
              onClick={openManualMediationConsent}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-[#795252] transition-colors hover:bg-[#795252]/5"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              의견이 엇갈렸다면 조율 도움 받기
            </button>
          </div>
        )}

        {/* 대상 토글 — 한 단계 컴팩트 (px/py/font 톤다운) */}
        {activeTab === "shared" && hasLinkedPartner && (
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
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 sm:text-[0.8125rem] ${
                messageTarget === "ai"
                  ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_rgba(121,82,82,0.2)]"
                  : "bg-white text-[#504444] shadow-[0_4px_14px_rgba(0,0,0,0.04)] hover:text-[#795252]"
              }`}
            >
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              아모라에게
            </button>
            <button
              type="button"
              onClick={() => handleMessageTargetChange("partner")}
              disabled={isStreaming || isSending}
              aria-pressed={messageTarget === "partner"}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 sm:text-[0.8125rem] ${
                messageTarget === "partner"
                  ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] text-white shadow-[0_4px_14px_rgba(217,156,156,0.25)]"
                  : "bg-white text-[#504444] shadow-[0_4px_14px_rgba(0,0,0,0.04)] hover:text-[#D99C9C]"
              }`}
            >
              <Heart className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              상대방에게
            </button>
          </div>
        )}

        <div className={`bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2.5 transition-colors ${
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
            disabled={isStreaming || isSending || attachments.length >= MAX_ATTACHMENTS}
            aria-label="파일 첨부"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-[#B5ADA3] transition-colors hover:bg-[#795252]/5 hover:text-[#795252] disabled:cursor-not-allowed disabled:opacity-30"
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
            value={input}
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
              messageTarget === "partner"
                ? "상대방에게 메시지…"
                : isPrivate
                  ? "아모라에게 솔직히…"
                  : "결혼 준비에서 궁금한 점을 물어보세요…"
            }
            disabled={isStreaming || isSending}
            className="flex-1 min-w-0 px-1 sm:px-2 py-2.5 sm:py-3 text-[0.9375rem] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50 resize-none leading-6 max-h-[10rem] overflow-y-auto"
          />
          <button
            type="button"
            onClick={() => attemptSend()}
            disabled={
              (!input.trim() && attachments.length === 0)
              || !senderRole
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
                ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] shadow-[0_4px_14px_rgba(217,156,156,0.25)] hover:shadow-[0_6px_20px_rgba(217,156,156,0.3)]"
                : isPrivate
                  ? "bg-gradient-to-br from-[#5a6147] to-[#6e7755] shadow-[0_4px_14px_rgba(90,97,71,0.25)] hover:shadow-[0_6px_20px_rgba(90,97,71,0.3)]"
                  : "bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)]"
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
      <ChatInfoPanel isOpen={infoPanelOpen} onClose={() => setInfoPanelOpen(false)} />
    </div>
  );
}
