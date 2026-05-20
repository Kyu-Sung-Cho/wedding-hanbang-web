"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Send, Sparkles, Trash2, X, PanelRightOpen, Paperclip, FileText, FileSpreadsheet, Heart, RefreshCw, Lock, Loader2, Search } from "lucide-react";
import type { ChatMessageTarget } from "@/types/database.types";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import ChatBubble from "@/components/app/chat/ChatBubble";
import ActionCard from "@/components/app/chat/ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "@/components/app/chat/VendorToolCard";
import SuggestionButtons from "@/components/app/chat/SuggestionButtons";
import StreamingBubble from "@/components/app/chat/StreamingBubble";
import ChatInfoPanel from "@/components/app/chat/ChatInfoPanel";

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

interface ChatContentProps {
  /** 풀페이지(/chat)는 false, 다른 레이아웃 안에서 렌더되면 true. */
  embedded?: boolean;
}

export default function ChatContent({ embedded = false }: ChatContentProps = {}) {
  const { profile, couple, journey, isDemo, isInitialized: authInitialized, isLoading: authLoading } = useAuthStore();
  const {
    messages,
    isLoading,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // 메시지 로드 + 구독
  useEffect(() => {
    if (!coupleId || isDemo) return;
    loadMessages(coupleId);
    const unsubscribe = subscribeToMessages(coupleId);
    return () => {
      unsubscribe();
    };
  }, [coupleId, isDemo, loadMessages, subscribeToMessages]);

  // 탭 복귀 시 놓친 메시지 safety-net fetch
  // (Realtime 구독이 백그라운드에서 끊겼을 때 커버)
  useEffect(() => {
    if (!coupleId || isDemo) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadMessages(coupleId);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [coupleId, isDemo, loadMessages]);

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
      setShowNewChatBanner(true);
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
      await clearMessages(coupleId, mode);
      setClearStep("closed");
      setShowNewChatBanner(false);
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

  // 데모 모드
  if (isDemo) {
    return (
      <div className="max-w-[800px] mx-auto h-[calc(100dvh-144px)] flex items-center justify-center bg-[#FAFAF8]">
        <div className="text-center bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10">
          <Sparkles className="w-14 h-14 text-[#795252]/30 mx-auto mb-4" />
          <h3 className="font-serif-kr text-2xl font-light text-[#1A1A1F] mb-2">
            아모라는 로그인 후 이용할 수 있어요
          </h3>
          <p className="text-base text-[#504444] mb-6 leading-relaxed">
            로그인하면 맞춤 웨딩 상담, 예산 관리,<br />
            일정 체크리스트 등을 아모라가 도와드려요
          </p>
          <a
            href="/login"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-base font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_8px_24px_rgba(121,82,82,0.2)] hover:shadow-[0_12px_32px_rgba(121,82,82,0.25)] transition-all"
          >
            로그인하기
          </a>
        </div>
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
            href="/onboarding"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-base font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
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
      className={`relative ${
        embedded ? "h-full" : "h-[calc(100dvh-144px)]"
      } transition-all duration-300 bg-[#FAFAF8] ${infoPanelOpen ? "md:pr-[390px]" : ""}`}
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

    <div className="max-w-[1080px] mx-auto h-full flex flex-col">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#795252]" />
          <span className="font-serif-kr text-[18px] font-light text-[#1A1A1F]">아모라 상담</span>
          {messages.length > 0 && (
            <span className="text-xs text-[#B5ADA3]">({messages.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setSearchOpen((v) => {
                if (v) setSearchQuery(""); // 닫을 때 검색어 리셋
                return !v;
              });
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              searchOpen
                ? "text-[#795252] bg-[#795252]/10"
                : "text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5"
            }`}
            aria-label="대화 검색"
            title="대화 검색"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">검색</span>
          </button>
          <button
            onClick={() => setInfoPanelOpen(!infoPanelOpen)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              infoPanelOpen
                ? "text-[#795252] bg-[#795252]/10"
                : "text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5"
            }`}
          >
            <PanelRightOpen className="w-4 h-4" />
            정보
          </button>

          {messages.length > 0 && (
            <button
              onClick={openNewChatModal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              새 채팅
            </button>
          )}
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

      {/* 채팅 탭 — 함께 / 나만 */}
      <div className="flex items-center gap-1 mx-2 mb-3 p-1 bg-[#F6F3F2] rounded-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
        <button
          onClick={() => { setActiveTab("shared"); setMessageTarget("ai"); }}
          disabled={isStreaming}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            activeTab === "shared"
              ? "bg-white text-[#795252] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
              : "text-[#928980] hover:text-[#504444]"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          함께 대화
        </button>
        <button
          onClick={() => { setActiveTab("private"); setMessageTarget("ai"); }}
          disabled={isStreaming}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            activeTab === "private"
              ? "bg-white text-[#5a6147] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
              : "text-[#928980] hover:text-[#504444]"
          }`}
          title="아모라와 1:1 — 상대방에게 보이지 않습니다"
        >
          <Lock className="w-4 h-4" />
          나만 (상담)
        </button>
      </div>

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
                    className="w-full text-left px-4 py-3 rounded-xl border border-red-300 bg-red-50/50 hover:bg-red-50 transition-colors"
                  >
                    <div className="text-[14.5px] font-medium text-red-600 mb-1">둘 다 새로 시작</div>
                    <div className="text-[12px] text-[#504444]">
                      두 분 모두의 함께 대화 기록을 영구 삭제합니다. <strong>복구 불가</strong>.
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

            {/* Step 1b: 함께 대화 둘 다 — 추가 확인 */}
            {clearStep === "shared_confirm_both" && (
              <>
                <h3 className="text-lg font-semibold text-red-600 mb-2">정말 둘 다 삭제할까요?</h3>
                <p className="text-sm text-[#504444] leading-relaxed mb-5">
                  두 분의 함께 대화 기록 전부가 사라지고 <strong>복구할 수 없어요</strong>.
                  <br />
                  상대방은 영문도 모르고 빈 화면을 보게 됩니다.
                  <br />
                  <span className="text-[#928980] text-[12.5px]">비공개 상담 기록은 영향받지 않아요.</span>
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
                    onClick={() => performClear("delete_shared")}
                    className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600"
                  >
                    네, 둘 다 삭제
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

      {/* 채팅 영역 */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto pb-4 space-y-4 px-3 sm:px-4 py-4 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
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
            return m.visibility === "bride_private" || m.visibility === "groom_private";
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
          return filteredMessages.map((msg) => {
            const isCurrentUser = msg.sender_id === profile?.id;
            const hasToolResults =
              msg.sender_role === "ai" &&
              msg.metadata?.toolResults &&
              msg.metadata.toolResults.length > 0;

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
                />
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

      {/* 최신 메시지로 ↓ 점프 — 사용자가 바닥에서 240px+ 위로 올라가 있을 때만 */}
      {showJumpToBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-[140px] right-4 sm:right-6 z-20 w-11 h-11 rounded-full bg-white text-[#795252] shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#E8DDD3] hover:bg-[#FAF8F5] flex items-center justify-center transition-all"
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
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] hover:shadow-md transition-all"
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
                  className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
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

      {/* 입력창 */}
      <div className="px-0 sm:px-2 pt-3 pb-2">
        {/* 첨부 미리보기 */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 px-1 sm:px-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="relative group">
                {att.previewUrl.startsWith("blob:") ? (
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

        {/* 대상 토글 — 모바일은 grid 2-col로 동등 폭, sm 이상은 inline */}
        {activeTab === "shared" && (
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 mb-2.5 px-0.5 sm:px-1">
            <button
              onClick={() => setMessageTarget("ai")}
              className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2 rounded-full text-[13px] sm:text-sm font-medium transition-all whitespace-nowrap ${
                messageTarget === "ai"
                  ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_rgba(121,82,82,0.2)]"
                  : "bg-white text-[#504444] shadow-[0_4px_14px_rgba(0,0,0,0.04)] hover:text-[#795252]"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              아모라에게
            </button>
            <button
              onClick={() => setMessageTarget("partner")}
              className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2 rounded-full text-[13px] sm:text-sm font-medium transition-all whitespace-nowrap ${
                messageTarget === "partner"
                  ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] text-white shadow-[0_4px_14px_rgba(217,156,156,0.25)]"
                  : "bg-white text-[#504444] shadow-[0_4px_14px_rgba(0,0,0,0.04)] hover:text-[#D99C9C]"
              }`}
            >
              <Heart className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              상대방에게
            </button>
          </div>
        )}

        <div className={`bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2.5 transition-all ${
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
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            title="파일 첨부 (이미지, PDF, Word)"
          >
            <Paperclip className="w-5 h-5 sm:w-6 sm:h-6" />
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
            className="flex-1 min-w-0 px-1 sm:px-2 py-2.5 sm:py-3 text-[15px] sm:text-[15px] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50 resize-none leading-6 max-h-[120px] overflow-y-auto"
          />
          <button
            onClick={() => attemptSend()}
            disabled={(!input.trim() && attachments.length === 0) || isStreaming}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 ${
              messageTarget === "partner"
                ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] shadow-[0_4px_14px_rgba(217,156,156,0.25)] hover:shadow-[0_6px_20px_rgba(217,156,156,0.3)]"
                : isPrivate
                  ? "bg-gradient-to-br from-[#5a6147] to-[#6e7755] shadow-[0_4px_14px_rgba(90,97,71,0.25)] hover:shadow-[0_6px_20px_rgba(90,97,71,0.3)]"
                  : "bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)]"
            }`}
          >
            {messageTarget === "partner"
              ? <Heart className="w-[18px] h-[18px] sm:w-[22px] sm:h-[22px]" />
              : isPrivate
                ? <Lock className="w-[18px] h-[18px] sm:w-[22px] sm:h-[22px]" />
                : <Send className="w-[18px] h-[18px] sm:w-[22px] sm:h-[22px]" />
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
