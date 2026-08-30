"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type SetStateAction } from "react";
import { Send, Sparkles, X, Maximize2, EyeOff, Paperclip, FileText, FileSpreadsheet, Heart, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatMessageTarget } from "@/types/database.types";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import ChatBubble from "./ChatBubble";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";
import SuggestionButtons from "./SuggestionButtons";
import StreamingBubble from "./StreamingBubble";
import MediationConsentDialog from "./MediationConsentDialog";
import {
  AmoraPersonalizationConfirmation,
  AmoraQuickStart,
} from "./AmoraPersonalizationPrompt";
import {
  clearPendingAmoraPersonalizationChoice,
  readPendingAmoraPersonalizationChoice,
  rememberPendingAmoraPersonalizationChoice,
  resolveAmoraPersonalizationReply,
  shouldOfferAmoraQuickStart,
  type PendingAmoraPersonalizationChoice,
} from "./amoraPersonalizationFlow";
import PendingAmoraActionCard, {
  getPendingAmoraAction,
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  isPendingAmoraActionExpired,
} from "./PendingAmoraActionCard";
import {
  chatAttachmentKey,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_SNAPSHOT_ERROR,
  CHAT_ATTACHMENT_TYPE_INFO,
  prepareChatAttachmentPayload,
} from "@/lib/chat/attachments";
import { weddingPath } from "@/lib/weddingPaths";
import { AMORA_DEMO_SUGGESTIONS, AMORA_DEMO_WELCOME } from "@/lib/chat/amoraDemoCopy";
import { useAmoraPersonalization } from "@/hooks/useAmoraPersonalization";
import type { AmoraQuickStartOption } from "@/lib/amora/personalization";
import { shouldOfferMediation } from "@/lib/chat/mediationOffer";
import { deduplicateToolResults } from "./toolResultDeduplication";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";

const MAX_ATTACHMENTS = CHAT_ATTACHMENT_MAX_COUNT;

const ALLOWED_TYPES = CHAT_ATTACHMENT_TYPE_INFO;

interface AttachmentItem {
  base64: string;
  mediaType: string;
  previewUrl: string;
  fileName: string;
}

function revokeObjectPreview(previewUrl: string) {
  if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}

function fileInputKey(file: File): string {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
}

interface ChatSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 아모라가 먼저 건넨 첫마디 전문. 첫 실행 안내가 끝난 직후에만 들어온다.
   *
   * 이 값이 있으면 모델에게 인사를 **다시 요청하지 않는다** — 아모라가 이미 말을
   * 걸어둔 자리에 인사가 두 번 뜨면 먼저 말을 건 것이 아니라 두 번 말한 것이 된다.
   */
  firstHello?: string | null;
}

type ChatScope = "shared" | "private";
type ChatComposerLane = "shared_ai" | "shared_partner" | "private_ai";

interface ChatComposerDraft {
  input: string;
  attachments: AttachmentItem[];
  retryClientRequestId: string | null;
}

export default function ChatSidePanel({
  isOpen,
  onClose,
  firstHello = null,
}: ChatSidePanelProps) {
  const router = useRouter();
  const { profile, couple, journey, partner, isDemo } = useAuthStore();
  const amoraPersonalization = useAmoraPersonalization(
    isOpen && !isDemo && Boolean(profile?.id),
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
    quotaRemaining,
    failedRequest,
    isRetrying,
    initialLoadDone,
    loadMessages,
    sendMessage,
    requestInitialGreeting,
    requestMediation: requestStructuredMediation,
    clearMessages,
    subscribeToMessages,
    retryFailedMessage,
    dismissFailedMessageRetry,
  } = useChatStore();

  const [activeScope, setActiveScope] = useState<ChatScope>("shared");
  const [messageTarget, setMessageTarget] = useState<ChatMessageTarget>("ai");
  const activeComposerLane: ChatComposerLane = activeScope === "private"
    ? "private_ai"
    : messageTarget === "partner"
      ? "shared_partner"
      : "shared_ai";
  const [composerDrafts, setComposerDrafts] = useState<Record<ChatComposerLane, ChatComposerDraft>>({
    shared_ai: { input: "", attachments: [], retryClientRequestId: null },
    shared_partner: { input: "", attachments: [], retryClientRequestId: null },
    private_ai: { input: "", attachments: [], retryClientRequestId: null },
  });
  const input = composerDrafts[activeComposerLane].input;
  const attachments = composerDrafts[activeComposerLane].attachments;
  const retryClientRequestId = composerDrafts[activeComposerLane].retryClientRequestId;
  const setInput = useCallback((nextInput: SetStateAction<string>) => {
    setComposerDrafts((currentDrafts) => {
      const currentDraft = currentDrafts[activeComposerLane];
      const resolvedInput = typeof nextInput === "function"
        ? nextInput(currentDraft.input)
        : nextInput;
      return {
        ...currentDrafts,
        [activeComposerLane]: {
          ...currentDraft,
          input: resolvedInput,
          retryClientRequestId:
            resolvedInput === currentDraft.input ? currentDraft.retryClientRequestId : null,
        },
      };
    });
  }, [activeComposerLane]);
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
  const setDraftRetryClientRequestId = useCallback((
    lane: ChatComposerLane,
    clientRequestId: string | null,
  ) => {
    setComposerDrafts((currentDrafts) => ({
      ...currentDrafts,
      [lane]: { ...currentDrafts[lane], retryClientRequestId: clientRequestId },
    }));
  }, []);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [dismissedPendingActionIds, setDismissedPendingActionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [applyingPendingActionId, setApplyingPendingActionId] = useState<string | null>(null);
  const applyingPendingActionRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitLocked, setIsSubmitLocked] = useState(false);
  const submitInFlightRef = useRef(false);
  const composerSessionGenerationRef = useRef(0);
  const [pendingFileReads, setPendingFileReads] = useState<Record<ChatComposerLane, number>>({
    shared_ai: 0,
    shared_partner: 0,
    private_ai: 0,
  });
  const pendingFileReadsRef = useRef<Record<ChatComposerLane, number>>({
    shared_ai: 0,
    shared_partner: 0,
    private_ai: 0,
  });
  const [pendingPersonalization, setPendingPersonalization] =
    useState<PendingAmoraPersonalizationChoice | null>(null);
  const [mediationDismissed, setMediationDismissed] = useState(false);
  const [mediationConsentOpen, setMediationConsentOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const greetingRequested = useRef(false);
  const subscribed = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const coupleId = couple?.id;
  const senderRole = profile?.role === "bride" || profile?.role === "groom"
    ? profile.role
    : null;
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
  const hasCouplePartner = linkedPartnerId !== null;
  const myPrivateVisibility = senderRole ? `${senderRole}_private` as const : null;
  const composerSessionKey = [
    profile?.id ?? "anonymous",
    coupleId ?? "no-couple",
    senderRole ?? "no-role",
  ].join(":");
  const composerSessionKeyRef = useRef(composerSessionKey);
  const linkedPartnerIdRef = useRef(linkedPartnerId);
  const partnerComposerEpochRef = useRef(0);
  const activeVisibility = activeScope === "shared" ? "shared" : myPrivateVisibility;
  const isActiveFileReadPending = pendingFileReads[activeComposerLane] > 0;
  const isComposerBusy =
    isStreaming || isSending || isSubmitLocked || isActiveFileReadPending;
  const hasProviderOnlyAttachment = attachments.some(
    (attachment) => !attachment.mediaType.startsWith("image/"),
  );
  const scopedMessages = useMemo(
    () => messages.filter((message) => (
      activeScope === "shared"
        ? message.visibility === "shared"
        : !!myPrivateVisibility && message.visibility === myPrivateVisibility
    )),
    [activeScope, messages, myPrivateVisibility],
  );
  /**
   * 아모라의 첫마디. 서버에 저장된 메시지가 아니라 이 화면 위에만 있는 말이다 —
   * 모델 호출도 DB 쓰기도 없이 온보딩 입력만으로 만들어졌기 때문이다.
   * 그래서 함께 대화(shared) 범위의 맨 위에 한 번 놓고, 답장은 평소 경로로 간다.
   */
  const firstHelloMessage = useMemo<ChatMessage | null>(() => {
    if (!firstHello || !coupleId || isDemo) return null;
    return {
      id: "amora-first-hello",
      couple_id: coupleId,
      sender_id: null,
      sender_role: "ai",
      visibility: "shared",
      content: firstHello,
      metadata: {},
      created_at: new Date().toISOString(),
    };
  }, [coupleId, firstHello, isDemo]);

  const artifactsMatchActiveVisibility =
    !!activeVisibility && artifactVisibility === activeVisibility;
  const errorMatchesActiveVisibility = artifactsMatchActiveVisibility
    && (!failedRequest || failedRequest.visibility === activeVisibility);
  const isConfirmedActionRecovery =
    failedRequest?.recoveryKind === "confirmed_action";
  const isInterruptedTurnRecovery =
    failedRequest?.recoveryKind === "interrupted_turn";
  const isRecoveryNotice = Boolean(failedRequest?.recoveryKind);
  const showMediationBanner =
    !mediationDismissed
    && !mediationConsentOpen
    && shouldOfferMediation(messages);

  useEffect(() => {
    if (composerSessionKeyRef.current === composerSessionKey) return;
    composerSessionKeyRef.current = composerSessionKey;
    composerSessionGenerationRef.current += 1;
    greetingRequested.current = false;
    submitInFlightRef.current = false;
    pendingFileReadsRef.current = {
      shared_ai: 0,
      shared_partner: 0,
      private_ai: 0,
    };
    setPendingFileReads({ shared_ai: 0, shared_partner: 0, private_ai: 0 });
    setComposerDrafts({
      shared_ai: { input: "", attachments: [], retryClientRequestId: null },
      shared_partner: { input: "", attachments: [], retryClientRequestId: null },
      private_ai: { input: "", attachments: [], retryClientRequestId: null },
    });
    setActiveScope("shared");
    setMessageTarget("ai");
    setIsSubmitLocked(false);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [composerSessionKey]);

  useEffect(() => {
    const previousLinkedPartnerId = linkedPartnerIdRef.current;
    linkedPartnerIdRef.current = linkedPartnerId;
    if (previousLinkedPartnerId === linkedPartnerId || previousLinkedPartnerId === null) return;

    partnerComposerEpochRef.current += 1;
    pendingFileReadsRef.current = {
      ...pendingFileReadsRef.current,
      shared_partner: 0,
    };
    setPendingFileReads((current) => ({ ...current, shared_partner: 0 }));
    setComposerDrafts((currentDrafts) => ({
      ...currentDrafts,
      shared_partner: { input: "", attachments: [], retryClientRequestId: null },
    }));
    setMessageTarget("ai");
    useChatStore.setState({
      error: "상대방 연결 정보가 바뀌었어요. 이전 상대용 미전송 초안과 첨부는 안전을 위해 삭제했어요. 전송 중이던 메시지는 대화에서 상태를 확인해주세요.",
      artifactVisibility: "shared",
    });
  }, [linkedPartnerId]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
    if (!isOpen) return;

    const panel = panelRef.current;
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

    const initialControl = panel?.querySelector<HTMLElement>("[data-panel-initial-focus]")
      ?? panel?.querySelector<HTMLElement>(focusableSelector);
    initialControl?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (mediationConsentOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [isOpen, mediationConsentOpen]);

  const handleScopeChange = useCallback((nextScope: ChatScope) => {
    if (
      isStreaming
      || isSending
      || submitInFlightRef.current
      || pendingFileReadsRef.current[activeComposerLane] > 0
      || (nextScope === "private" && !myPrivateVisibility)
    ) return;
    setActiveScope(nextScope);
    setMessageTarget("ai");
    // Suggestions are derived from the previous answer and have no scope field.
    // Discard them on a scope change rather than showing private-derived copy in shared chat.
    useChatStore.setState({ suggestions: [] });
  }, [activeComposerLane, isStreaming, isSending, myPrivateVisibility]);

  const handleMessageTargetChange = useCallback((nextTarget: ChatMessageTarget) => {
    if (
      isStreaming
      || isSending
      || submitInFlightRef.current
      || pendingFileReadsRef.current[activeComposerLane] > 0
      || activeScope !== "shared"
      || (nextTarget === "partner" && !hasCouplePartner)
    ) return;
    setMessageTarget(nextTarget);
    // Suggestions are generated for an Amora reply. Never carry them into a
    // partner-directed composer where one tap would change the recipient.
    useChatStore.setState({ suggestions: [] });
  }, [activeComposerLane, activeScope, hasCouplePartner, isSending, isStreaming]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const updateNow = () => setNowMs(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 1_000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isDemo || !coupleId || !profile) return;

    const welcomeMessage: ChatMessage = {
      id: "demo-amora-sidepanel-welcome",
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
  }, [isOpen, isDemo, coupleId, profile]);

  // 패널 열릴 때 채팅 초기화
  useEffect(() => {
    if (!isOpen || !coupleId || isDemo) return;

    loadMessages(coupleId);

    if (!subscribed.current) {
      const unsubscribe = subscribeToMessages(coupleId);
      subscribed.current = true;
      return () => {
        unsubscribe();
        subscribed.current = false;
      };
    }
  }, [isOpen, coupleId, isDemo, loadMessages, subscribeToMessages]);

  // 메시지 0개일 때 AI 첫 인사
  useEffect(() => {
    if (
      !isOpen ||
      !coupleId ||
      !profile ||
      !senderRole ||
      isDemo ||
      // 아모라가 첫 실행 안내 직후 이미 먼저 말을 걸어뒀다. 여기서 또 인사를
      // 요청하면 같은 자리에 인사가 두 번 뜬다.
      firstHello ||
      !initialLoadDone ||
      isStreaming ||
      messages.length > 0 ||
      greetingRequested.current
    )
      return;

    greetingRequested.current = true;
    requestInitialGreeting({
      coupleId,
      senderRole,
      senderName: profile.name ?? "사용자",
      weddingContext: {
        weddingDate: journey?.wedding_date ?? null,
        budget: journey?.total_budget ?? 0,
        venue: journey?.venue ?? null,
        progress: journey?.progress ?? {},
      },
    });
  }, [isOpen, coupleId, profile, senderRole, journey, initialLoadDone, messages.length, isStreaming, requestInitialGreeting, isDemo, firstHello]);

  // 자동 스크롤
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages, isStreaming, streamingContent]);

  // 첨부파일 처리
  const adjustPendingFileReads = useCallback((lane: ChatComposerLane, delta: 1 | -1) => {
    const nextCount = Math.max(0, pendingFileReadsRef.current[lane] + delta);
    pendingFileReadsRef.current = {
      ...pendingFileReadsRef.current,
      [lane]: nextCount,
    };
    setPendingFileReads((current) => ({ ...current, [lane]: nextCount }));
  }, []);

  const processFile = useCallback((file: File) => {
    const submittedLane = activeComposerLane;
    const submittedVisibility = activeVisibility;
    const submittedSessionGeneration = composerSessionGenerationRef.current;
    const submittedPartnerEpoch = partnerComposerEpochRef.current;
    const submittedPartnerRecipientId = submittedLane === "shared_partner"
      ? linkedPartnerIdRef.current
      : null;
    const partnerDraftIsStillCurrent = () => (
      submittedLane !== "shared_partner"
      || (
        submittedPartnerRecipientId !== null
        && partnerComposerEpochRef.current === submittedPartnerEpoch
        && linkedPartnerIdRef.current === submittedPartnerRecipientId
      )
    );
    if (submittedLane === "shared_partner" && !file.type.startsWith("image/")) {
      useChatStore.setState({
        error: "파트너에게 보내는 첨부파일은 이미지 형식만 지원해요.",
        artifactVisibility: "shared",
      });
      return;
    }
    const typeInfo = ALLOWED_TYPES[file.type];
    if (!typeInfo) {
      useChatStore.setState({
        error: `지원하지 않는 파일 형식이에요: ${file.name} (이미지, PDF, DOCX만 가능해요.)`,
        artifactVisibility: submittedVisibility,
      });
      return;
    }
    if (file.size > typeInfo.maxSize) {
      useChatStore.setState({
        error: `${typeInfo.label} 파일은 ${typeInfo.maxSize / 1024 / 1024}MB 이하로 줄인 뒤 다시 첨부해주세요.`,
        artifactVisibility: submittedVisibility,
      });
      return;
    }

    const reader = new FileReader();
    let readFinished = false;
    const finishRead = () => {
      if (readFinished) return;
      readFinished = true;
      if (
        composerSessionGenerationRef.current !== submittedSessionGeneration
        || !partnerDraftIsStillCurrent()
      ) return;
      adjustPendingFileReads(submittedLane, -1);
    };
    adjustPendingFileReads(submittedLane, 1);
    reader.onload = () => {
      if (
        composerSessionGenerationRef.current !== submittedSessionGeneration
        || !partnerDraftIsStillCurrent()
      ) {
        finishRead();
        return;
      }
      const base64Full = reader.result;
      if (typeof base64Full !== "string" || !base64Full.includes(",")) {
        useChatStore.setState({
          error: CHAT_ATTACHMENT_SNAPSHOT_ERROR,
          artifactVisibility: submittedVisibility,
        });
        finishRead();
        return;
      }
      const base64Data = base64Full.split(",")[1];
      const attachment = {
        base64: base64Data,
        mediaType: file.type,
        previewUrl: file.type.startsWith("image/") ? base64Full : "",
        fileName: file.name,
      };
      setDraftAttachments(submittedLane, (prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev;
        const key = chatAttachmentKey(attachment);
        if (prev.some((item) => chatAttachmentKey(item) === key)) return prev;
        return [...prev, attachment];
      });
      finishRead();
    };
    reader.onerror = () => {
      if (
        composerSessionGenerationRef.current !== submittedSessionGeneration
        || !partnerDraftIsStillCurrent()
      ) {
        finishRead();
        return;
      }
      useChatStore.setState({
        error: CHAT_ATTACHMENT_SNAPSHOT_ERROR,
        artifactVisibility: submittedVisibility,
      });
      finishRead();
    };
    reader.onabort = finishRead;
    try {
      reader.readAsDataURL(file);
    } catch {
      useChatStore.setState({
        error: CHAT_ATTACHMENT_SNAPSHOT_ERROR,
        artifactVisibility: submittedVisibility,
      });
      finishRead();
    }
  }, [activeComposerLane, activeVisibility, adjustPendingFileReads, setDraftAttachments]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const seen = new Set<string>();
    Array.from(files).forEach((file) => {
      const key = fileInputKey(file);
      if (seen.has(key)) return;
      seen.add(key);
      processFile(file);
    });
    e.target.value = "";
  }, [processFile]);

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // 드래그 & 드롭
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
    const files = e.dataTransfer.files;
    Array.from(files).forEach(processFile);
  }, [processFile]);

  const handleSend = useCallback(
    async (text?: string, targetOverride?: ChatMessageTarget) => {
      if (
        isStreaming
        || isSending
        || submitInFlightRef.current
        || pendingFileReadsRef.current[activeComposerLane] > 0
      ) return;
      const usesComposer = text === undefined;
      const content = usesComposer ? input.trim() : text;
      const submittedInput = usesComposer ? input : "";
      const currentAttachments = usesComposer ? [...attachments] : [];
      const sourceLane = activeComposerLane;
      const submittedSessionGeneration = composerSessionGenerationRef.current;
      const submittedClientRequestId = usesComposer ? retryClientRequestId : null;
      if (
        (!content && currentAttachments.length === 0)
        || !coupleId
        || !profile
        || !senderRole
        || !activeVisibility
      ) return;

      const submittedTarget = activeScope === "private"
        ? "ai"
        : targetOverride ?? messageTarget;
      const crisisPreflight = planAmoraCrisisDelivery({
        userText: content ?? "",
        requestedVisibility: activeVisibility,
        target: submittedTarget,
        senderRole,
      });
      const effectiveVisibility = crisisPreflight.effectiveVisibility;
      const isLocalSafetyHold = crisisPreflight.disposition === "local_safety_hold";
      const isPrivateSafetyRoute = crisisPreflight.disposition === "private_safety_route";
      const canTransmitAttachments = crisisPreflight.disposition === "continue";
      const submittedLane = isPrivateSafetyRoute ? "private_ai" : sourceLane;
      if (canTransmitAttachments) {
        const attachmentCheck = prepareChatAttachmentPayload(currentAttachments);
        if (!attachmentCheck.ok) {
          useChatStore.setState({
            error: attachmentCheck.error,
            artifactVisibility: activeVisibility,
          });
          return;
        }
      }
      const submittedPartnerEpoch = partnerComposerEpochRef.current;
      const submittedPartnerRecipientId = submittedTarget === "partner"
        ? linkedPartnerId
        : null;
      const partnerRecipientIsStillCurrent = () => (
        submittedTarget !== "partner"
        || (
          submittedPartnerRecipientId !== null
          && partnerComposerEpochRef.current === submittedPartnerEpoch
          && linkedPartnerIdRef.current === submittedPartnerRecipientId
        )
      );
      if (!isLocalSafetyHold && submittedTarget === "partner" && !hasCouplePartner) {
        setMessageTarget("ai");
        useChatStore.setState({
          error: "연결된 상대방이 없어 보내지 않았어요. 상대방 연결을 다시 확인해주세요.",
          artifactVisibility: "shared",
        });
        return;
      }

      submitInFlightRef.current = true;
      setIsSubmitLocked(true);

      if (usesComposer) {
        setInput("");
        setAttachments([]);
      }
      if (isPrivateSafetyRoute) {
        setActiveScope("private");
        setMessageTarget("ai");
        currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
      }

      const restoreComposer = () => {
        if (
          isPrivateSafetyRoute
          ||
          !usesComposer
          || composerSessionGenerationRef.current !== submittedSessionGeneration
          || !partnerRecipientIsStillCurrent()
        ) return;
        setInput((current) => current || submittedInput);
        setAttachments((current) => {
          const existingKeys = new Set(current.map(chatAttachmentKey));
          return [
            ...current,
            ...currentAttachments.filter((attachment) => !existingKeys.has(chatAttachmentKey(attachment))),
          ];
        });
      };

      // 첨부만 있고 텍스트 없으면 기본 메시지 생성
      let finalContent = content;
      if (!content && currentAttachments.length > 0) {
        const hasDoc = currentAttachments.some((a) =>
          a.mediaType.includes("word") || a.mediaType.includes("spreadsheet") || a.mediaType.includes("ms-excel")
        );
        const hasPdf = currentAttachments.some((a) => a.mediaType === "application/pdf");
        if (submittedTarget === "partner") finalContent = "이 이미지를 확인해주세요.";
        else if (hasDoc || hasPdf) finalContent = "이 문서를 분석해주세요.";
        else finalContent = "이 이미지를 분석해주세요.";
      }

      try {
        const outcome = await sendMessage({
          content: finalContent,
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
          target: submittedTarget,
          ...(submittedTarget === "partner" && linkedPartnerId
            ? { partnerRecipientId: linkedPartnerId }
            : {}),
          visibility: effectiveVisibility,
          ...(submittedClientRequestId
            ? { clientRequestId: submittedClientRequestId }
            : {}),
        });
        if (composerSessionGenerationRef.current !== submittedSessionGeneration) return;
        if (outcome?.userMessage === "ephemeral_safety") {
          setActiveScope("private");
          setMessageTarget("ai");
          setDraftRetryClientRequestId(submittedLane, null);
          currentAttachments.forEach((attachment) => revokeObjectPreview(attachment.previewUrl));
          return;
        }
        if (!partnerRecipientIsStillCurrent()) return;
        if (outcome?.userMessage === "persistence_unknown") {
          restoreComposer();
          setDraftRetryClientRequestId(submittedLane, outcome.clientRequestId);
        } else if (outcome?.userMessage === "not_persisted") {
          restoreComposer();
          setDraftRetryClientRequestId(
            submittedLane,
            outcome.clientRequestId ?? submittedClientRequestId,
          );
        } else {
          setDraftRetryClientRequestId(sourceLane, null);
        }
      } catch {
        if (
          composerSessionGenerationRef.current !== submittedSessionGeneration
          || !partnerRecipientIsStillCurrent()
        ) return;
        restoreComposer();
        setDraftRetryClientRequestId(submittedLane, submittedClientRequestId);
        useChatStore.setState((state) => ({
          error: state.error ?? "메시지를 저장하지 못했습니다. 입력 내용을 복구했어요.",
          artifactVisibility: state.artifactVisibility ?? effectiveVisibility,
        }));
      } finally {
        if (composerSessionGenerationRef.current === submittedSessionGeneration) {
          submitInFlightRef.current = false;
          setIsSubmitLocked(false);
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
      hasCouplePartner,
      linkedPartnerId,
      activeScope,
      activeVisibility,
      activeComposerLane,
      retryClientRequestId,
      setInput,
      setAttachments,
      setDraftRetryClientRequestId,
      isStreaming,
      isSending,
    ]
  );
  const handleAmoraSend = useCallback(
    (text: string) => handleSend(text, "ai"),
    [handleSend],
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
    activeScope === "shared" &&
    amoraPersonalization.status === "ready" &&
    !amoraPersonalization.profile &&
    Boolean(personalizationReplyMessageId) &&
    Boolean(pendingPersonalization) &&
    !isStreaming &&
    !isSending &&
    input.trim().length === 0 &&
    attachments.length === 0;
  const showAmoraQuickStart = shouldOfferAmoraQuickStart({
    enabled:
      isOpen &&
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
      input.trim().length > 0 ||
      attachments.length > 0,
    activeTab: activeScope,
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

  const openMediationConsent = useCallback(() => {
    setMediationConsentOpen(true);
  }, []);

  const cancelMediationConsent = useCallback(() => {
    setMediationConsentOpen(false);
    setMediationDismissed(true);
  }, []);

  const confirmMediationConsent = useCallback(
    async (requesterSummary: string) => {
      if (!coupleId || !profile || !senderRole) return;
      setMediationConsentOpen(false);
      setMediationDismissed(true);
      setMessageTarget("ai");
      await requestStructuredMediation({
        coupleId,
        senderRole,
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
      journey,
      profile,
      requestStructuredMediation,
      senderRole,
    ],
  );

  const applyPendingAmoraAction = useCallback(async (actionId: string) => {
    if (
      applyingPendingActionRef.current
      || !coupleId
      || !profile
      || (profile.role !== "bride" && profile.role !== "groom")
    ) return;

    // Re-read the canonical AI-context boundary at click time. Direct partner
    // messages are deliberately outside Amora context and must not invalidate
    // an otherwise current server proposal.
    const current = useChatStore.getState();
    if (current.isStreaming || current.isSending) return;
    const latestSharedAmoraMessage = [...current.messages]
      .reverse()
      .find((message) => (
        message.visibility === "shared"
        && message.metadata?.target !== "partner"
      ));
    if (!latestSharedAmoraMessage) return;
    const action = getPendingAmoraAction(latestSharedAmoraMessage);
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

  const handleExpand = () => {
    onClose();
    router.push(weddingPath("/chat"));
  };

  const handleClearChat = async () => {
    if (!coupleId) return;
    greetingRequested.current = false;
    // SidePanel에서는 실제 DB 삭제 없이, 현재 보고 있는 범위만 내 화면에서 정리한다.
    await clearMessages(
      coupleId,
      activeScope === "private" ? "view_reset_private" : "view_reset_shared",
    );
    setShowClearConfirm(false);
  };

  const getFileIcon = (mediaType: string) => {
    if (mediaType.includes("pdf")) return <FileText className="w-4 h-4 text-red-500" />;
    if (mediaType.includes("word")) return <FileText className="w-4 h-4 text-blue-500" />;
    if (mediaType.includes("excel") || mediaType.includes("spreadsheet")) return <FileSpreadsheet className="w-4 h-4 text-green-500" />;
    return null;
  };

  const showEmpty = !coupleId;

  return (
    <>
      {/* 모바일 오버레이 */}
      <div
        className={`fixed inset-0 z-40 bg-[#071629]/45 backdrop-blur-[2px] transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* 패널 */}
      <div
        ref={panelRef}
        className={`fixed z-50 flex flex-col overflow-hidden bg-[var(--hb-surface-page)] shadow-[-4px_0_24px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-out
          md:top-0 md:right-0 md:w-[400px] md:h-full md:border-l md:border-black/[0.06]
          max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:h-[78dvh] max-md:min-h-[420px] max-md:max-h-[calc(100dvh-4.5rem)] max-md:rounded-t-[22px] max-md:border-t max-md:border-black/[0.06] max-md:shadow-[var(--shadow-raised)]
          ${isOpen
            ? "md:translate-x-0 max-md:translate-y-0"
            : "md:translate-x-full max-md:translate-y-full"
        }`}
        role="dialog"
        aria-modal={isOpen}
        aria-hidden={!isOpen}
        aria-label="아모라 AI 상담 패널"
        tabIndex={-1}
        inert={!isOpen}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 드래그 오버레이 */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-rose-50/90 border-2 border-dashed border-rose-300 rounded-2xl flex items-center justify-center">
            <div className="text-center">
              <Paperclip className="w-8 h-8 text-rose-400 mx-auto mb-2" />
              <p className="text-[0.8125rem] text-rose-600 font-medium">파일을 놓아주세요</p>
            </div>
          </div>
        )}

        {/* 모바일 핸들 */}
        <div className="md:hidden flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-taupe-400/30" />
        </div>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--hb-text-strong)]">아모라 AI</h3>
              <p className="text-[0.6875rem] text-[var(--hb-text-muted)]">AI 동반자</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {scopedMessages.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-[#F6F3F2]"
                title="대화 화면 정리"
                aria-label="현재 대화 범위를 내 화면에서 정리"
              >
                <EyeOff className="w-4 h-4 text-[var(--hb-text-body)]" />
              </button>
            )}
            <button
              type="button"
              onClick={handleExpand}
              className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.04]"
              title="전체 화면으로 보기"
              aria-label="아모라 상담 전체 화면으로 보기"
            >
              <Maximize2 className="w-4 h-4 text-[var(--hb-text-body)]" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.04]"
              title="닫기"
              aria-label="아모라 상담 패널 닫기"
              data-panel-initial-focus
            >
              <X className="w-4 h-4 text-[var(--hb-text-body)]" />
            </button>
          </div>
        </div>

        {showEmpty ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <Sparkles className="w-10 h-10 text-rose-500/30 mx-auto mb-3" />
              <p className="text-[0.8125rem] text-[var(--hb-text-body)] mb-1">
                {isDemo ? "로그인 후 이용할 수 있어요" : "온보딩을 완료해주세요"}
              </p>
              {isDemo && (
                <a href="/login" className="text-xs text-[var(--color-rose-700)] font-medium hover:underline">
                  로그인하기
                </a>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-black/[0.05] bg-white px-3 py-2">
              <div
                role="group"
                aria-label="상담 공개 범위"
                className="grid grid-cols-2 gap-1 rounded-xl bg-[#F6F3F2] p-1"
              >
                <button
                  type="button"
                  onClick={() => handleScopeChange("shared")}
                  disabled={isComposerBusy}
                  aria-pressed={activeScope === "shared"}
                  className={`min-h-11 rounded-lg px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    activeScope === "shared"
                      ? "bg-white text-[#795252] shadow-sm"
                      : "text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)]"
                  }`}
                >
                  함께 대화
                </button>
                <button
                  type="button"
                  onClick={() => handleScopeChange("private")}
                  disabled={isComposerBusy || !myPrivateVisibility}
                  aria-pressed={activeScope === "private"}
                  title="아모라와 1:1 — 서비스에 저장되지만 상대방에게는 보이지 않습니다"
                  className={`flex min-h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    activeScope === "private"
                      ? "bg-white text-[#5a6147] shadow-sm"
                      : "text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)]"
                  }`}
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  나만 (상담)
                </button>
              </div>
              <p
                role="status"
                aria-live="polite"
                className={`mt-1.5 flex items-center gap-1 text-[0.6875rem] leading-relaxed ${
                  activeScope === "private" ? "text-[#5a6147]" : "text-[#795252]"
                }`}
              >
                {activeScope === "private" && <Lock className="h-3 w-3" aria-hidden="true" />}
                {activeScope === "private"
                  ? "현재 범위 · 나만 (상담) — 서비스에 저장되며 상대방에게는 보이지 않아요"
                  : partner
          ? "현재 범위 · 함께 대화 — 파트너에게 보여요"
          // 아직 배우자를 연결하지 않은 사람에게 "파트너에게 보여요" 는 사실이
          // 아니다. 지금은 아무도 못 본다. 나중에 연결하면 보인다는 것을 말한다.
          : "현재 범위 · 함께 대화 — 파트너를 연결하면 이 대화를 함께 볼 수 있어요"}
              </p>
            </div>

            {/* 대화 화면 정리 확인 */}
            {showClearConfirm && (
              <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-xl border border-[#E8DDD3] bg-[#FAF7F2] p-2.5">
                <p className="text-xs leading-relaxed text-[var(--hb-text-body)]">
                  {activeScope === "private"
                    ? "나만의 상담 이전 메시지를 내 화면에서만 숨길까요?"
                    : "함께 대화의 이전 메시지를 내 화면에서만 숨길까요?"}
                  <span className="mt-1 block text-[#795252]">
                    서버 원문과 아모라가 참고하는 기존 맥락은 그대로 유지돼요.
                  </span>
                </p>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => setShowClearConfirm(false)} className="min-h-11 px-3 text-[0.6875rem] rounded-lg bg-white border border-black/[0.06] text-[var(--hb-text-body)] hover:bg-gray-50">취소</button>
                  <button type="button" onClick={handleClearChat} className="min-h-11 rounded-lg bg-[#795252] px-3 text-[0.6875rem] text-white hover:bg-[#946a6a]">내 화면에서만 숨기기</button>
                </div>
              </div>
            )}

            {quotaRemaining !== null
              && !isStreaming
              && messageTarget === "ai"
              && artifactsMatchActiveVisibility && (
              <div className="mx-3 mt-2 flex items-center justify-between rounded-xl bg-[var(--hb-surface-hover)] p-2.5">
                <p className="text-xs font-medium leading-relaxed text-[#6d625a]">
                  {quotaRemaining > 0
                    ? `무료 상담이 ${quotaRemaining}회 남았어요. 소진돼도 예산·일정 기록은 그대로 보관돼요.`
                    : "무료 상담을 모두 사용했어요. 예산·일정 기록은 그대로 보관돼요."}
                </p>
                <button
                  type="button"
                  onClick={() => useChatStore.setState({ quotaRemaining: null })}
                  className="ml-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[var(--hb-text-muted)] hover:text-[#6d625a]"
                  aria-label="상담 횟수 안내 닫기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* 에러 표시 */}
            {error && errorMatchesActiveVisibility && (
              <div
                className={`mx-3 mt-2 rounded-xl border p-2.5 ${
                  isRecoveryNotice
                    ? "border-[#B9DAD5] bg-[#F0F8F6]"
                    : "border-red-200 bg-red-50"
                }`}
                role={isRecoveryNotice ? "status" : "alert"}
              >
                <p
                  className={`text-xs leading-relaxed ${
                    isRecoveryNotice ? "text-[#245B56]" : "text-red-700"
                  }`}
                >
                  {error}
                </p>
                {failedRequest?.unavailableReason && (
                  <p className={`mt-1 text-[0.6875rem] leading-relaxed ${
                    isRecoveryNotice ? "text-[#356B66]" : "text-red-600"
                  }`}>
                    {failedRequest.unavailableReason}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {failedRequest?.canRetry && (
                    <button
                      type="button"
                      onClick={() => void retryFailedMessage()}
                      disabled={isComposerBusy || isRetrying}
                      className={`min-h-11 rounded-lg px-3 text-[0.6875rem] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
                    disabled={isComposerBusy || isRetrying}
                    className={`min-h-11 rounded-lg border bg-white px-3 text-[0.6875rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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

            {/* 메시지 영역 */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {firstHelloMessage && activeScope === "shared" && (
                <div className="animate-fade-in" data-testid="amora-first-hello-message">
                  <ChatBubble
                    message={firstHelloMessage}
                    isCurrentUser={false}
                  />
                </div>
              )}
              {(() => {
                // 최근 3개 AI 메시지 ID 계산 (피드백 버튼 표시용)
                const recentAiIds = new Set(
                  scopedMessages
                    .filter((m) => m.sender_role === "ai")
                    .slice(-3)
                    .map((m) => m.id)
                );
                const latestSharedAmoraMessageId = [...messages]
                  .reverse()
                  .find((message) => (
                    message.visibility === "shared"
                    && message.metadata?.target !== "partner"
                  ))?.id ?? null;
                return scopedMessages.map((msg) => {
                  const isCurrentUser = msg.sender_id === profile?.id;
                  const hasToolResults =
                    msg.sender_role === "ai" &&
                    msg.metadata?.toolResults &&
                    msg.metadata.toolResults.length > 0;
                  const pendingActionCandidate = getPendingAmoraAction(msg);
                  const pendingAction = pendingActionCandidate
                    && !dismissedPendingActionIds.has(pendingActionCandidate.actionId)
                    ? pendingActionCandidate
                    : null;
                  const pendingActionDisabledReason = pendingAction
                    ? getPendingActionDisabledReason(
                        pendingAction,
                        nowMs,
                        msg.id === latestSharedAmoraMessageId,
                        isStreaming || isSending,
                      )
                    : null;
                  const pendingBudgetImpactPreview = pendingAction
                    ? getPendingAmoraBudgetImpactPreview(msg, pendingAction)
                    : null;

                  return (
                    <div key={msg.id} className="animate-fade-in">
                      <ChatBubble
                        message={msg}
                        isCurrentUser={isCurrentUser}
                        senderName={
                          msg.sender_id && msg.sender_id === partner?.id
                            ? partner.name
                            : null
                        }
                        isRecentAi={recentAiIds.has(msg.id)}
                      />
                      {pendingAction && (
                        <PendingAmoraActionCard
                          action={pendingAction}
                          impactPreview={pendingBudgetImpactPreview}
                          messageId={msg.id}
                          disabledReason={pendingActionDisabledReason}
                          isApplying={applyingPendingActionId === pendingAction.actionId}
                          partnerLinked={Boolean(partner)}
                          onApply={(pendingActionId) => void applyPendingAmoraAction(pendingActionId)}
                          onDismiss={() => dismissPendingAmoraAction(pendingAction.actionId)}
                        />
                      )}
                      {hasToolResults &&
                        // 같은 메시지 안에서 내용까지 동일한 도구 결과만 1개로 줄인다.
                        // 문구가 같아도 입력/출력이 다른 정상 작업 카드는 모두 보존한다.
                        deduplicateToolResults(msg.metadata!.toolResults!).map((result, i) =>
                          VENDOR_TOOL_NAMES.has(result.toolName) ? (
                            <VendorToolCard key={`${msg.id}-tool-${i}`} result={result} onSend={handleAmoraSend} disabled={isComposerBusy} />
                          ) : (
                            <ActionCard key={`${msg.id}-tool-${i}`} result={result} />
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
                  disabled={isComposerBusy}
                  onSelect={handlePersonalizationSelect}
                />
              )}

              {isStreaming
                && messageTarget === "ai"
                && artifactsMatchActiveVisibility && (
                <div className="animate-fade-in">
                  <StreamingBubble content={streamingContent} toolResults={streamingToolResults} onSend={handleAmoraSend} />
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 갈등 중재 제안 배너 */}
            {activeScope === "shared" && showMediationBanner && !isStreaming && (
              <div className="px-3 pb-2">
                <div className="relative bg-gradient-to-r from-pink-50 via-rose-50 to-orange-50 border border-pink-200/60 rounded-2xl px-3 py-3 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setMediationDismissed(true)}
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full text-[var(--hb-text-muted)] hover:text-[var(--hb-text-muted)]"
                    aria-label="조율 상담 제안 숨기기"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--hb-text-strong)] leading-relaxed">
                        혹시 의견 조율이 필요하시면, 아모라가 도와드릴 수 있어요
                      </p>
                      <button
                        type="button"
                        onClick={openMediationConsent}
                        className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#C4967E] to-[#C9A96E] px-3 text-[0.6875rem] font-medium text-white transition-colors hover:shadow-md"
                      >
                        <Sparkles className="w-3 h-3" />
                        아모라에게 상담 요청하기
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 제안 버튼 — 입력창과 충분한 간격 */}
            {messageTarget === "ai" &&
              artifactsMatchActiveVisibility &&
              suggestions.length > 0 &&
              !isStreaming &&
              !showAmoraQuickStart &&
              !showPersonalizationConfirmation && (
              <div className="px-3 pt-2 pb-4 border-t border-[#F0EFED]/60 mt-2">
                <SuggestionButtons
                  suggestions={suggestions}
                  onSelect={handleAmoraSend}
                  disabled={isComposerBusy}
                />
              </div>
            )}

            {/* 첨부파일 프리뷰 */}
            {attachments.length > 0 && (
              <div className="px-4 pb-1 flex gap-2 flex-wrap">
                {attachments.map((att, i) => (
                  <div key={i} className="relative group">
                    {att.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Local object URLs are previews only, so next/image cannot optimize them.
                      <img src={att.previewUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-black/[0.06]" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border border-black/[0.06] bg-gray-50 flex flex-col items-center justify-center">
                        {getFileIcon(att.mediaType)}
                        <span className="text-[8px] text-[var(--hb-text-muted)] mt-0.5 truncate max-w-[40px]">{att.fileName.split(".").pop()}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      disabled={isComposerBusy}
                      className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full text-red-600 opacity-70 transition-opacity hover:bg-red-50 hover:opacity-100 focus:opacity-100"
                      aria-label={`${att.fileName} 첨부 제거`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {messageTarget === "ai" && hasProviderOnlyAttachment && (
              <p
                role="note"
                className="px-4 pb-1 text-[0.6875rem] leading-relaxed text-[#795252]"
              >
                PDF·DOCX 파일은 아모라 분석에만 사용되며 대화 첨부로 저장되지 않아요.
              </p>
            )}

            {/* 입력 영역 */}
            <div className="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-1">
              {/* 대상 토글 (커플 연동 시) */}
              {activeScope === "shared" && hasCouplePartner && (
                <div
                  className="flex items-center gap-1.5 mb-1.5"
                  role="group"
                  aria-label="메시지 받을 대상"
                >
                  <button
                    type="button"
                    onClick={() => handleMessageTargetChange("ai")}
                    disabled={isComposerBusy}
                    aria-pressed={messageTarget === "ai"}
                    className={`flex min-h-11 items-center gap-1 rounded-[6px] px-3 text-[0.625rem] font-medium transition-colors ${
                      messageTarget === "ai"
                        ? "bg-gradient-to-r from-rose-500/10 to-gold/10 text-rose-600 border border-rose-200"
                        : "text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)] border border-transparent"
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    아모라에게
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMessageTargetChange("partner")}
                    disabled={isComposerBusy}
                    aria-pressed={messageTarget === "partner"}
                    className={`flex min-h-11 items-center gap-1 rounded-[6px] px-3 text-[0.625rem] font-medium transition-colors ${
                      messageTarget === "partner"
                        ? "bg-gradient-to-r from-pink-500/10 to-purple-500/10 text-pink-600 border border-pink-200"
                        : "text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)] border border-transparent"
                    }`}
                  >
                    <Heart className="w-3 h-3" />
                    상대방에게
                  </button>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[var(--shadow-raised)] flex items-center gap-1.5 p-1.5">
                {/* 첨부파일 버튼 */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isComposerBusy || attachments.length >= MAX_ATTACHMENTS}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.04] disabled:opacity-30"
                  title="파일 첨부"
                  aria-label="파일 첨부"
                >
                  <Paperclip className="w-4 h-4 text-[var(--hb-text-muted)]" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={Object.keys(ALLOWED_TYPES)
                    .filter((mediaType) => (
                      activeComposerLane !== "shared_partner" || mediaType.startsWith("image/")
                    ))
                    .join(",")}
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={messageTarget === "partner" ? "상대방에게 메시지..." : "결혼 준비에서 궁금한 점을 물어보세요…"}
                  disabled={isComposerBusy}
                  aria-label="메시지 입력"
                  className="flex-1 px-2 py-2 text-[0.8125rem] text-[var(--hb-text-strong)] placeholder:text-[var(--hb-text-muted)] bg-transparent outline-none disabled:opacity-50 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={
                    (!input.trim() && attachments.length === 0)
                    || isComposerBusy
                  }
                  aria-label="메시지 보내기"
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    messageTarget === "partner"
                      ? "bg-pink-500 hover:bg-pink-600"
                      : "bg-[#795252] hover:bg-[#946a6a]"
                  }`}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {mediationConsentOpen && (
        <MediationConsentDialog
          onCancel={cancelMediationConsent}
          onConfirm={confirmMediationConsent}
        />
      )}
    </>
  );
}
