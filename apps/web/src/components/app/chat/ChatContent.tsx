"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Send, Sparkles, X, PanelRightOpen, Paperclip, FileText, FileSpreadsheet, Heart, RefreshCw, Lock, Loader2, Search, MessageCircle, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
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
import { weddingPath } from "@/lib/weddingPaths";

type CommunityDraftPrivacyMode = "shared" | "redacted_private";

const MAX_ATTACHMENTS = 5;
// 메시지 수가 이 이상이면 새 채팅 시작 안내
const NEW_CHAT_THRESHOLD = 200;

// 허용 파일 타입
const ALLOWED_TYPES: Record<string, { maxSize: number; label: string }> = {
  "image/jpeg": { maxSize: 5 * 1024 * 1024, label: "이미지" },
  "image/png": { maxSize: 5 * 1024 * 1024, label: "이미지" },
  "image/gif": { maxSize: 5 * 1024 * 1024, label: "이미지" },
  "image/webp": { maxSize: 5 * 1024 * 1024, label: "이미지" },
  "application/pdf": { maxSize: 10 * 1024 * 1024, label: "PDF" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxSize: 10 * 1024 * 1024, label: "Word" },
  "application/msword": { maxSize: 10 * 1024 * 1024, label: "Word" },
};

interface AttachmentItem {
  base64: string;
  mediaType: string;
  previewUrl: string;
  fileName: string;
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
  const text = `${normalizeChatText(userQuestion)} ${normalizeChatText(amoraAnswer).replace(/\*\*/g, "")}`;
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
    add("예식장은 아직 확정하지 않았어요.");
  }

  if (/(호텔|컨벤션|웨딩홀|야외)/.test(text) && /(예식\s*형태|웨딩\s*형태|예식장\s*비중|비중)/.test(text)) {
    add("예식 형태에 따라 예식장/스드메 비중이 달라질 수 있다고 들었어요.");
  }

  if (/스드메|스튜디오|드레스|메이크업/.test(text) && /예산|분배|비중|추가금|비용/.test(text)) {
    add("스드메와 예식장 사이에서 어느 쪽에 더 비중을 둘지 고민 중이에요.");
  }

  if (/계약|환불|위약금|취소|추가금/.test(text) && /견적|계약|업체/.test(text)) {
    add("계약 전에 빠뜨리기 쉬운 비용이나 조건이 있는지도 같이 보고 싶어요.");
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
      "예식장 상담 때 먼저 확인하면 좋은 조건",
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
  const { profile, couple, journey, isDemo, isInitialized: authInitialized, isLoading: authLoading } = useAuthStore();
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingToolResults,
    suggestions,
    error,
    initialLoadDone,
    presence,
    loadMessages,
    sendMessage,
    requestInitialGreeting,
    clearMessages,
    subscribeToMessages,
    pollNewMessages,
    notifyTyping,
    requestSharedClear,
  } = useChatStore();
  const [input, setInput] = useState("");
  // pre-send confirm — 상대방 입력 중이거나 AI 응답 중일 때 마찰 추가
  const [pendingSend, setPendingSend] = useState<{ text?: string } | null>(null);
  // 새 채팅 modal 단계 — closed | shared 옵션 선택 | shared 둘 다 추가확인 | private 확인
  const [clearStep, setClearStep] = useState<
    "closed" | "shared_choose" | "shared_confirm_both" | "private_confirm"
  >("closed");
  const [nowMs, setNowMs] = useState(0);
  const [showNewChatBanner, setShowNewChatBanner] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [messageTarget, setMessageTarget] = useState<ChatMessageTarget>("ai");
  // 채팅 탭 — "shared" (둘이 함께 + 상대방에게) | "private" (나만의 1:1)
  const [activeTab, setActiveTab] = useState<"shared" | "private">("shared");
  const isPrivate = activeTab === "private"; // private 탭일 때만 비공개 모드
  const myPrivateVisibility =
    profile?.role === "groom"
      ? "groom_private"
      : profile?.role === "bride"
        ? "bride_private"
        : null;
  const sharedMessageCount = messages.filter((m) => m.visibility === "shared").length;
  const privateMessageCount = myPrivateVisibility
    ? messages.filter((m) => m.visibility === myPrivateVisibility).length
    : 0;

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const [showMediationBanner, setShowMediationBanner] = useState(false);
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

  // input 외부 비움(전송 후 등) 시 textarea 높이 리셋
  useEffect(() => {
    if (input === "" && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  // URL ?prefill=... 로 진입했을 때 (예: 견적 체크 → "아모라에게 이어서 묻기")
  // input에 미리 채워주고 query string은 한 번 비움 (새로고침 시 재기입 방지).
  const searchParams = useSearchParams();
  const router = useRouter();
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    const prefill = searchParams?.get("prefill");
    if (!prefill) return;
    prefillAppliedRef.current = true;
    setInput(prefill);
    // URL 정리 — prefill만 제거
    const next = new URLSearchParams(searchParams.toString());
    next.delete("prefill");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [searchParams, router]);
  const greetingRequested = useRef(false);
  const coupleId = couple?.id;

  useEffect(() => {
    if (!isDemo || !coupleId || !profile) return;

    const welcomeMessage: ChatMessage = {
      id: "demo-amora-welcome",
      couple_id: coupleId,
      sender_id: null,
      sender_role: "ai",
      visibility: "shared",
      content:
        "안녕하세요, 저는 아모라예요. 데모에서는 실제 저장 없이 예산, 일정, 견적, 준비 체크리스트 상담 흐름을 미리 체험할 수 있어요. 지금 궁금한 준비 항목을 편하게 물어보세요.",
      metadata: {},
      created_at: new Date().toISOString(),
    };

    useChatStore.setState((state) => ({
      initialLoadDone: true,
      messages: state.messages.length > 0 ? state.messages : [welcomeMessage],
      suggestions:
        state.suggestions.length > 0
          ? state.suggestions
          : ["이번 주에 먼저 할 일 알려줘", "스냅 촬영 준비 체크해줘", "예산 배분 다시 봐줘"],
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
    fetch("/api/chat/proactive").catch(() => {});
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

  // ⚠️ 갈등 감지 로직은 서버 사이드(/api/chat/check-couple-conflict)로 이전됨.
  // chatStore.sendMessage 가 커플 메시지 INSERT 직후 fire-and-forget 으로 호출.
  // 서버에서 휴리스틱 + 회상 필터 + 턴 패턴 + (borderline) LLM 검증 → 트리거 시
  // mediation 메시지를 직접 INSERT 하며 Realtime 으로 양쪽 클라이언트에 자동 전달.
  // 단일 진실원본이라 양쪽 디바이스 동시 트리거하는 race condition 제거.

  // 글로벌 붙여넣기 이벤트 (document level)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
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

    files.slice(0, remaining).forEach((file) => {
      const typeInfo = ALLOWED_TYPES[file.type];
      if (!typeInfo) {
        alert(`지원하지 않는 파일 형식이에요: ${file.name}\n(이미지, PDF, Word 가능)`);
        return;
      }
      if (file.size > typeInfo.maxSize) {
        alert(`${typeInfo.label} 파일은 ${typeInfo.maxSize / 1024 / 1024}MB 이하만 가능해요`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : `file:${file.type}:${file.name}`;

        setAttachments((prev) => {
          if (prev.length >= MAX_ATTACHMENTS) return prev;
          return [...prev, { base64, mediaType: file.type, previewUrl, fileName: file.name }];
        });
      };
      reader.readAsDataURL(file);
    });
  }, [attachments.length]);

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
  }, []);

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
    async (text?: string) => {
      const content = text ?? input.trim();
      if ((!content && attachments.length === 0) || !coupleId || !profile) return;

      const currentAttachments = [...attachments];
      setInput("");
      setAttachments([]);

      // 기본 메시지 생성
      let defaultMsg = "";
      if (!content && currentAttachments.length > 0) {
        const hasDoc = currentAttachments.some((a) =>
          a.mediaType.includes("word") || a.mediaType.includes("spreadsheet") || a.mediaType.includes("ms-excel")
        );
        const hasPdf = currentAttachments.some((a) => a.mediaType === "application/pdf");
        if (hasDoc) defaultMsg = "이 문서를 분석해주세요.";
        else if (hasPdf) defaultMsg = "이 문서를 분석해주세요.";
        else defaultMsg = "이 이미지를 분석해주세요.";
      }

      // private mode + AI 대상일 때만 visibility 분리. 그 외는 shared.
      const role = profile.role ?? "bride";
      const visibility = isPrivate && messageTarget === "ai"
        ? (role === "groom" ? "groom_private" : "bride_private")
        : "shared";

      await sendMessage({
        content: content || defaultMsg,
        senderId: profile.id,
        senderRole: role,
        coupleId,
        senderName: profile.name ?? "사용자",
        weddingContext: {
          weddingDate: journey?.wedding_date ?? null,
          budget: journey?.total_budget ?? 0,
          venue: journey?.venue ?? null,
          progress: journey?.progress ?? {},
        },
        images: currentAttachments.length > 0 ? currentAttachments : undefined,
        target: messageTarget,
        visibility,
      });
    },
    [input, attachments, coupleId, profile, journey, sendMessage, messageTarget, isPrivate]
  );

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

  // 배너에서 수동 중재 요청
  const handleManualMediation = useCallback(() => {
    setShowMediationBanner(false);
    setMessageTarget("ai");

    // 최근 대화에서 갈등 주제 추출
    const recentConflictMsgs = messages
      .filter((m) => m.sender_role !== "ai")
      .slice(-5);
    const lastTopic = recentConflictMsgs.length > 0
      ? recentConflictMsgs[recentConflictMsgs.length - 1].content.slice(0, 50)
      : "결혼 준비";

    handleSend(`아모라, 우리가 "${lastTopic}" 관련해서 의견이 다른데 도움 줄 수 있어?`);
  }, [messages, handleSend]);

  // 사용자가 직접 send 버튼/엔터/제안 칩으로 보낼 때 게이트 — 파트너가 입력 중이거나
  // AI가 파트너 메시지에 응답 중이면 confirm 모달.
  const attemptSend = useCallback(
    (text?: string) => {
      const content = text ?? input.trim();
      if ((!content && attachments.length === 0) || !coupleId || !profile) return;

      const aiByMe = aiResponding && aiResponding.triggered_by_user_id === profile.id;
      const partnerInteracting = partnerTypingActive || (aiResponding && !aiByMe);

      if (partnerInteracting) {
        setPendingSend({ text });
        return;
      }
      void handleSend(text);
    },
    [
      input,
      attachments.length,
      coupleId,
      profile,
      partnerTypingActive,
      aiResponding,
      handleSend,
    ]
  );

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
              className="w-full max-w-[36rem] rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#F0EFED] px-5 py-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.18em] text-[#795252]">COMMUNITY</p>
                  <h3 className="mt-1 font-serif-kr text-xl text-[#1A1A1F]">이 내용으로 커뮤니티에 물어볼게요</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCommunityDraft(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#928980] hover:bg-[#F6F3F2] hover:text-[#1A1A1F] transition-colors"
                  aria-label="닫기"
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
                      커뮤니티에 공개되는 글입니다. 이름, 전화번호, 이메일, 계좌, 계약번호가 들어가 있으면 지우고 올려주세요.
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

    <div className="h-full flex flex-col w-full">
      {/* 상단 통합 툴바 — 탭(함께/나만) + 액션(검색·정보·새채팅) 한 줄
          ChatContent root 는 full-width 라 메시지 컨테이너 스크롤바가
          viewport 우측 가장자리에 위치. 툴바·입력박스만 reading column 으로
          가운데 정렬. */}
      <div className="flex items-center gap-2 px-2 pb-2 pt-1 w-full max-w-[70rem] mx-auto">
        {/* 탭 — 좌측 차지 (메인 동작) */}
        <div className="flex items-center gap-1 flex-1 min-w-0 p-1 bg-[#F6F3F2] rounded-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
          <button
            onClick={() => { setActiveTab("shared"); setMessageTarget("ai"); }}
            disabled={isStreaming}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
            onClick={() => { setActiveTab("private"); setMessageTarget("ai"); }}
            disabled={isStreaming}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              activeTab === "private"
                ? "bg-white text-[#5a6147] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                : "text-[#928980] hover:text-[#504444]"
            }`}
            title="아모라와 1:1 — 상대방에게 보이지 않습니다"
          >
            <Lock className="w-4 h-4" />
            나만 (상담)
            {privateMessageCount > 0 && (
              <span className="text-xs text-[#B5ADA3] hidden sm:inline">({privateMessageCount})</span>
            )}
          </button>
        </div>

        {/* 액션 — 우측 (검색/정보/새채팅) */}
        <div className="flex items-center gap-0.5 shrink-0">
          <a
            href="/ai-policy"
            className="hidden sm:flex items-center justify-center h-9 px-2 rounded-lg text-[0.6875rem] font-medium text-[#928980] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors"
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
              aria-label="새 채팅"
              title="새 채팅"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* AI 생성 배지 — 채팅 전체에 한 번만 표시 (메시지별 footer 대체).
          AI 기본법(2026.1.22) 표시 의무를 충족하면서 가독성 회복. */}
      <div className="sr-only">
        <div
          className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] leading-tight text-[#928980]"
          title="아모라 답변은 Anthropic Claude 가 생성합니다. 출처와 정책은 'AI 정책' 페이지에서 확인하세요."
        >
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#795252]/50" />
            AI 생성
          </span>
          <span className="text-[#D5C9C0]">·</span>
          <span>출처: 공정위 표준계약서 · 소비자원 참가격</span>
          <span className="text-[#D5C9C0]">·</span>
          <span>전문가 검토 권장</span>
          <span className="text-[#D5C9C0]">·</span>
          <a
            href="/ai-policy"
            className="underline decoration-dotted underline-offset-2 hover:text-[#795252] transition-colors"
          >
            AI 정책
          </a>
        </div>
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
          <p className="text-sm text-[#795252]">대화가 길어졌어요. 새 채팅을 시작하면 아모라가 더 정확하게 답변할 수 있어요.</p>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <button onClick={() => setShowNewChatBanner(false)} className="px-3.5 py-1.5 text-sm rounded-lg bg-white text-[#504444] hover:bg-[#F6F3F2] shadow-sm">괜찮아요</button>
            <button onClick={openNewChatModal} className="px-3.5 py-1.5 text-sm rounded-lg bg-gradient-to-br from-[#795252] to-[#946a6a] text-white hover:shadow-md">새 채팅</button>
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
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Step 1a: 함께 대화 — 옵션 선택 */}
            {clearStep === "shared_choose" && (
              <>
                <h3 className="text-lg font-semibold text-[#1A1A1F] mb-2">함께 대화 새 채팅</h3>
                <p className="text-sm text-[#504444] leading-relaxed mb-5">
                  지금 대화를 정리하고 싶으세요? 두 가지 방법 중 골라주세요.
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
                      상대방 화면은 그대로. 내 화면에서만 새로 시작합니다. 데이터 보존됨.
                    </div>
                  </button>
                  <button
                    onClick={() => setClearStep("shared_confirm_both")}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#E8DDD3] bg-[#FAF7F2]/50 hover:bg-[#FAF7F2] transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[#795252] mb-1">둘 다 새로 시작 (상대방 동의 필요)</div>
                    <div className="text-[12px] text-[#504444]">
                      상대방에게 동의 요청을 보내요. 상대방이 [동의] 누르면 양쪽 화면이
                      깨끗하게 정리됩니다. <strong>데이터는 보존</strong>돼서 안전해요.
                    </div>
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setClearStep("closed")}
                    autoFocus
                    className="px-4 py-2 text-sm rounded-lg bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE8E5]"
                  >
                    취소
                  </button>
                </div>
              </>
            )}

            {/* Step 1b: 함께 대화 둘 다 — 동의 요청 확인 */}
            {clearStep === "shared_confirm_both" && (
              <>
                <h3 className="text-lg font-semibold text-[#1A1A1F] mb-2">상대방에게 동의 요청 보낼게요</h3>
                <p className="text-sm text-[#504444] leading-relaxed mb-5">
                  채팅에 동의 카드가 올라가고 상대방이 [동의] 누르면 양쪽 화면이
                  정리됩니다. 거절되면 그대로 유지돼요.
                  <br />
                  <span className="text-[#928980] text-[12.5px]">데이터는 보존되므로 안전합니다 (view-reset).</span>
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setClearStep("shared_choose")}
                    autoFocus
                    className="px-4 py-2 text-sm rounded-lg bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE8E5]"
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
                    className="px-4 py-2 text-sm rounded-lg bg-[#795252] text-white hover:bg-[#946a6a]"
                  >
                    동의 요청 보내기
                  </button>
                </div>
              </>
            )}

            {/* Step 2: 나만 (상담) — 단순 확인 */}
            {clearStep === "private_confirm" && (
              <>
                <h3 className="text-lg font-semibold text-[#1A1A1F] mb-2">비공개 상담 기록</h3>
                <p className="text-sm text-[#504444] leading-relaxed mb-5">
                  지금까지의 비공개 상담 기록을 정리하시겠어요?
                  <br />
                  <span className="text-[#928980] text-[12.5px]">상대방은 영향받지 않습니다 (애초에 못 봤음).</span>
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => performClear("view_reset_private")}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#5a6147]/30 bg-[#5a6147]/5 hover:bg-[#5a6147]/10 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-[#5a6147] mb-1">내 화면만 정리 (추천)</div>
                    <div className="text-[12px] text-[#504444]">데이터는 보존. 화면만 새로 시작.</div>
                  </button>
                  <button
                    onClick={() => performClear("delete_private")}
                    className="w-full text-left px-4 py-3 rounded-xl border border-red-300 bg-red-50/50 hover:bg-red-50 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-red-600 mb-1">영구 삭제</div>
                    <div className="text-[12px] text-[#504444]">DB에서 완전히 삭제. <strong>복구 불가</strong>.</div>
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setClearStep("closed")}
                    autoFocus
                    className="px-4 py-2 text-sm rounded-lg bg-[#F6F3F2] text-[#504444] hover:bg-[#EDE8E5]"
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
              비공개 상담 — 이 탭의 대화는 <strong>상대방에게 보이지 않아요</strong>. 아모라와 1:1로 솔직하게 털어놓으세요.
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
              .filter((m) => m.sender_role === "ai")
              .slice(-3)
              .map((m) => m.id)
          );
          return filteredMessages.map((msg, index) => {
            const isCurrentUser = msg.sender_id === profile?.id;
            const hasToolResults =
              msg.sender_role === "ai" &&
              msg.metadata?.toolResults &&
              msg.metadata.toolResults.length > 0;
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
              !isDemo &&
              msg.sender_role === "ai" &&
              !hasSuccessfulSystemAction(msg) &&
              recentAiIds.has(msg.id) &&
              previousHumanMessage?.sender_id === profile?.id &&
              (isSharedCommunityFallback || isPrivateCommunityFallback);
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

            return (
              <div
                key={msg.id}
                className="animate-fade-in"
              >
                <ChatBubble
                  message={msg}
                  isCurrentUser={isCurrentUser}
                  currentUserRole={profile?.role}
                  isRecentAi={recentAiIds.has(msg.id)}
                  onNegativeFeedback={markCommunityFallbackAvailable}
                />
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
                  // 같은 메시지 안에서 동일한 (toolName, success, displayMessage)
                  // 조합으로 중복된 카드는 1개만 표시. AI 가 DB 부족 등으로 같은
                  // tool 을 여러 번 호출해 같은 실패 메시지가 줄줄이 나오는 경우 방어.
                  (() => {
                    const seen = new Set<string>();
                    return msg.metadata!.toolResults!.filter((result) => {
                      const key = `${result.toolName}::${result.success}::${(result.displayMessage ?? "").trim()}`;
                      if (seen.has(key)) return false;
                      seen.add(key);
                      return true;
                    });
                  })().map((result, i) =>
                    VENDOR_TOOL_NAMES.has(result.toolName) ? (
                      <VendorToolCard key={`${msg.id}-tool-${i}`} result={result} onSend={attemptSend} disabled={isStreaming} />
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
              </div>
            );
          });
        })()}

        {isStreaming && (
          <div className="animate-fade-in">
            <StreamingBubble content={streamingContent} toolResults={streamingToolResults} onSend={attemptSend} />
          </div>
        )}

        {/* 파트너 typing 인디케이터 — 본인이 streaming 중이 아닐 때만 (중복 방지) */}
        {!isStreaming && partnerTypingActive && presence.partnerTyping && (() => {
          const isBride = presence.partnerTyping.sender_role === "bride";
          const avatarBg = isBride
            ? "bg-gradient-to-br from-[#C4967E] to-[#E8C4B8]"
            : "bg-gradient-to-br from-[#3B5998] to-[#6B8CCE]";
          const label = isBride ? "신부" : "신랑";
          return (
            <div className="animate-fade-in flex items-center gap-2 px-3">
              <div className={`flex-shrink-0 w-9 h-9 rounded-full ${avatarBg} flex items-center justify-center text-white text-base font-bold shadow-sm`}>
                {label.charAt(0)}
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
        {!isStreaming && aiResponding && profile && aiResponding.triggered_by_user_id !== profile.id && (
          <div className="animate-fade-in">
            <StreamingBubble toolResults={[]} onSend={attemptSend} />
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

      {/* 에러 메시지 */}
      {error && !isStreaming && (
        <div className="mx-2 mt-2 p-3.5 rounded-xl bg-red-50 flex items-center justify-between shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => useChatStore.setState({ error: null })}
            className="ml-2 text-red-400 hover:text-red-600 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Pre-send confirm — 파트너 입력 중이거나 AI가 파트너 메시지에 응답 중일 때 */}
      {pendingSend && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fade-in"
          onClick={() => setPendingSend(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-[#C9A96E]/15 flex items-center justify-center text-[#C9A96E]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-serif-kr text-lg sm:text-xl text-[#1A1A1F] font-light mb-1.5 leading-snug">
                  잠시 기다리시겠어요?
                </h3>
                <p className="text-sm text-[#504444] leading-relaxed">
                  {partnerTypingActive
                    ? `상대방(${presence.partnerTyping?.sender_role === "bride" ? "신부" : "신랑"})이 지금 입력하고 있어요. 같이 보내면 진행 중인 흐름이 꼬일 수 있어요.`
                    : "아모라가 방금 보낸 메시지에 답변하고 있어요. 지금 새 메시지를 보내면 진행 중인 답변이 중단될 수 있어요."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingSend(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-[#1A1A1F] bg-[#F6F3F2] hover:bg-[#EDE8E5] transition-colors"
              >
                기다릴게요
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = pendingSend.text;
                  setPendingSend(null);
                  void handleSend(t);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] hover:shadow-md transition-colors"
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
              onClick={() => { setShowMediationBanner(false); }}
              className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full text-[#B5ADA3] hover:text-[#504444] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base text-[#1A1A1F] leading-relaxed font-medium">
                  두 분 사이에 의견 차이가 있는 것 같아요
                </p>
                <p className="text-sm text-[#504444] leading-relaxed mt-1">
                  아모라가 중립적으로 의견 조율을 도와드릴게요
                </p>
                <button
                  onClick={handleManualMediation}
                  className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-colors"
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
      {suggestions.length > 0 && !isStreaming && (
        <div className="px-2 pt-2 pb-4 sm:pb-5 border-t border-[#F0EFED]/60 mt-2">
          <SuggestionButtons suggestions={suggestions} onSelect={attemptSend} disabled={isStreaming} />
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
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 대상 토글 — 한 단계 컴팩트 (px/py/font 톤다운) */}
        {activeTab === "shared" && (
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 mb-2 px-0.5 sm:px-1">
            <button
              onClick={() => setMessageTarget("ai")}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-[0.8125rem] font-medium transition-colors whitespace-nowrap ${
                messageTarget === "ai"
                  ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_rgba(121,82,82,0.2)]"
                  : "bg-white text-[#504444] shadow-[0_4px_14px_rgba(0,0,0,0.04)] hover:text-[#795252]"
              }`}
            >
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              아모라에게
            </button>
            <button
              onClick={() => setMessageTarget("partner")}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-[0.8125rem] font-medium transition-colors whitespace-nowrap ${
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
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.docx,.doc"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || attachments.length >= MAX_ATTACHMENTS}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            title="파일 첨부 (이미지, PDF, Word)"
          >
            <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // auto-resize: 줄 수에 따라 높이 자동 조절 (최대 ~5줄)
              const ta = e.currentTarget;
              ta.style.height = "auto";
              ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
              // typing broadcast — 디바운스는 store 내부에서 처리, 여기선 매 입력마다 콜
              if (coupleId && profile?.id && (profile.role === "bride" || profile.role === "groom")) {
                notifyTyping({ coupleId, userId: profile.id, senderRole: profile.role });
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
                  : "무엇이든 물어보세요…"
            }
            disabled={isStreaming}
            className="flex-1 min-w-0 px-1 sm:px-2 py-2.5 sm:py-3 text-[0.9375rem] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50 resize-none leading-6 max-h-[7.5rem] overflow-y-auto"
          />
          <button
            onClick={() => attemptSend()}
            disabled={(!input.trim() && attachments.length === 0) || isStreaming}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 ${
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
