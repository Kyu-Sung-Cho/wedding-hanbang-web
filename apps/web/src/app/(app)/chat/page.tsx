"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Sparkles, Trash2, X, PanelRightOpen, Paperclip, FileText, FileSpreadsheet, Heart, RefreshCw } from "lucide-react";
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
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { maxSize: 10 * 1024 * 1024, label: "Excel" },
  "application/vnd.ms-excel": { maxSize: 10 * 1024 * 1024, label: "Excel" },
};

interface AttachmentItem {
  base64: string;
  mediaType: string;
  previewUrl: string;
  fileName: string;
}

export default function ChatPage() {
  const { profile, couple, journey, isDemo } = useAuthStore();
  const {
    messages,
    isLoading,
    isStreaming,
    streamingContent,
    streamingToolResults,
    suggestions,
    error,
    initialLoadDone,
    loadMessages,
    sendMessage,
    requestInitialGreeting,
    requestMediation,
    clearMessages,
    subscribeToMessages,
  } = useChatStore();
  const [input, setInput] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showNewChatBanner, setShowNewChatBanner] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [messageTarget, setMessageTarget] = useState<ChatMessageTarget>("ai");
  const [showMediationBanner, setShowMediationBanner] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFilesRef = useRef<(files: File[]) => void>(() => {});
  const greetingRequested = useRef(false);
  const mediationTriggeredAt = useRef<number>(0);
  const lastCheckedMsgCount = useRef<number>(0);
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

  // 스크롤 자동 이동
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, streamingContent]);

  // 갈등 감지: 새 메시지가 추가될 때만 + 최근 5분 이내 메시지만 분석
  useEffect(() => {
    // 새 메시지가 없으면 스킵 (AI 응답, 스크롤 등으로 re-render 방지)
    const currentCount = messages.length;
    if (currentCount <= lastCheckedMsgCount.current) return;
    lastCheckedMsgCount.current = currentCount;

    // 스트리밍 중이면 스킵
    if (isStreaming) return;

    // 마지막 메시지가 AI면 스킵 (유저 메시지가 올 때만 감지)
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.sender_role === "ai") return;

    // 5분 쿨다운 (한 번 중재 후 최소 5분 대기)
    const now = Date.now();
    if (now - mediationTriggeredAt.current < 5 * 60 * 1000) return;

    const CONFLICT_CATEGORIES: { id: string; patterns: string[]; weight: number }[] = [
      {
        id: "fight", weight: 5,
        patterns: [
          "싸우자", "싸웠어", "싸운 거", "크게 싸", "다퉜어", "다투고", "다투었",
          "말 안 해", "말 안해", "말을 안 해", "연락 끊", "연락도 안",
          "무시하지 마", "무시하는 거", "무시당하", "무시해",
          "대화가 안 돼", "대화가 안돼", "말이 안 통해", "소통이 안",
          "이해를 못 해", "이해를 안 해", "이해가 안 돼",
          "헤어지자", "결혼 안 해", "결혼 취소", "파혼",
        ],
      },
      {
        id: "blame", weight: 4,
        patterns: [
          "왜 맨날 너만", "나만 양보", "너는 맨날", "너만 맨날",
          "맨날 나한테", "내 말은 안 듣", "내 말을 안 듣",
          "관심이 없는 거", "관심도 없", "신경도 안 써", "신경을 안 써",
          "니가 알아서 해", "너 혼자 해", "나 몰라",
          "왜 항상 나만", "너는 왜 그래",
          "맨날 이래", "또 이러네", "또 시작이야",
          "말을 안 해줘", "얘기를 안 해",
          "걔가 맨날", "쟤가 맨날", "남편이 맨날", "와이프가 맨날",
          "신랑이 맨날", "신부가 맨날", "그 사람이 맨날",
          "안 들어줘", "안들어줘", "말을 안 들어",
        ],
      },
      {
        id: "disagree", weight: 3,
        patterns: [
          "난 절대 반대", "나는 반대야", "절대 안 돼", "절대 안돼",
          "그건 절대 싫", "왜 꼭 그걸", "왜 그걸 해야",
          "말도 안 되는", "말이 되냐", "말이 돼?",
          "돈이 어디서 나", "돈이 어디 있", "그 돈으로 뭘",
          "내가 언제 그랬", "그렇게 정한 적 없",
          "의견이 달라", "의견이 안 맞", "생각이 달라", "생각이 안 맞",
          "동의 못 해", "동의 안 해", "합의가 안",
          "안 된다니까", "싫다니까", "하기 싫",
        ],
      },
      {
        id: "emotion", weight: 2,
        patterns: [
          "너 때문에 속상", "너한테 서운", "서운한 게", "서운했어", "서운해",
          "답답해 진짜", "진짜 답답", "너무 답답", "답답해서",
          "화가 나", "화나는", "너 때문에 화", "화났어", "화가 많이",
          "짜증나 진짜", "진짜 짜증", "너무 짜증", "짜증이 나",
          "지쳤어 이제", "진짜 지쳤", "너무 힘들어", "힘들다",
          "스트레스", "속상해", "속상하다", "울었어", "울고 싶",
          "불안해", "걱정돼", "걱정이 돼",
        ],
      },
    ];

    // 최근 5분 이내 유저 메시지만 필터 (오래된 싸움 무시)
    const WINDOW_MS = 5 * 60 * 1000;
    const cutoff = new Date(now - WINDOW_MS).toISOString();
    const recentUserMsgs = messages
      .filter((m) => m.sender_role !== "ai" && m.created_at && m.created_at >= cutoff)
      .slice(-10);

    if (recentUserMsgs.length < 2) return;

    // 점수 계산
    let totalScore = 0;
    let messagesWithConflict = 0;
    const hitCategories = new Set<string>();
    const senderHits: Record<string, number> = {};

    for (const msg of recentUserMsgs) {
      let msgScore = 0;
      for (const cat of CONFLICT_CATEGORIES) {
        for (const pattern of cat.patterns) {
          if (msg.content.includes(pattern)) {
            msgScore += cat.weight;
            hitCategories.add(cat.id);
            break;
          }
        }
      }
      if (msgScore > 0) {
        messagesWithConflict++;
        totalScore += msgScore;
        const role = msg.sender_role ?? "unknown";
        senderHits[role] = (senderHits[role] || 0) + 1;
      }
    }

    // 양쪽 다 부정적 → 1.5배
    if (Object.keys(senderHits).length >= 2) {
      totalScore = Math.round(totalScore * 1.5);
    }

    // 총점 6+ / 갈등 메시지 2+ / 카테고리 조건
    const THRESHOLD = 6;
    const multiCategory = hitCategories.size >= 2 || hitCategories.has("fight");
    const isConflict = totalScore >= THRESHOLD && messagesWithConflict >= 2 && multiCategory;

    if (isConflict && coupleId && profile && journey) {
      mediationTriggeredAt.current = now;

      // 갈등 맥락 추출
      const conflictMsgs = recentUserMsgs
        .filter((m) => {
          for (const cat of CONFLICT_CATEGORIES) {
            for (const pattern of cat.patterns) {
              if (m.content.includes(pattern)) return true;
            }
          }
          return false;
        })
        .map((m) => m.content.slice(0, 50))
        .join(" / ");

      requestMediation({
        coupleId,
        senderRole: profile.role ?? "bride",
        senderName: profile.name ?? "사용자",
        weddingContext: {
          weddingDate: journey?.wedding_date ?? null,
          budget: journey?.total_budget ?? 0,
          venue: journey?.venue ?? null,
          progress: journey?.progress ?? {},
        },
        conflictContext: conflictMsgs || "커플 간 의견 차이",
      });
    }
  }, [messages.length, isStreaming, coupleId, profile, journey, requestMediation]);

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
        alert(`지원하지 않는 파일 형식이에요: ${file.name}\n(이미지, PDF, Word, Excel 가능)`);
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

      await sendMessage({
        content: content || defaultMsg,
        senderId: profile.id,
        senderRole: profile.role ?? "bride",
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
      });
    },
    [input, attachments, coupleId, profile, journey, sendMessage, messageTarget]
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

  const handleNewChat = async () => {
    if (!coupleId) return;
    greetingRequested.current = false;
    await clearMessages(coupleId);
    setShowClearConfirm(false);
    setShowNewChatBanner(false);
  };

  // 데모 모드
  if (isDemo) {
    return (
      <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center bg-[#FAFAF8]">
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

  // 커플이 없는 경우
  if (!coupleId) {
    return (
      <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center bg-[#FAFAF8]">
        <div className="text-center bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10">
          <Sparkles className="w-14 h-14 text-[#795252]/30 mx-auto mb-4" />
          <p className="text-base text-[#504444]">
            온보딩을 완료하면 아모라와 상담할 수 있어요
          </p>
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
      className={`h-[calc(100vh-144px)] transition-all duration-300 bg-[#FAFAF8] ${infoPanelOpen ? "md:pr-[390px]" : ""}`}
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
            <p className="text-sm text-[#504444] mt-1">이미지, PDF, Word, Excel</p>
          </div>
        </div>
      )}

    <div className="max-w-[800px] mx-auto h-full flex flex-col">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between px-2 pb-3 pt-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#795252]" />
          <span className="font-serif-kr text-[22px] font-light text-[#1A1A1F]">아모라 상담</span>
          {messages.length > 0 && (
            <span className="text-sm text-[#B5ADA3]">({messages.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
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
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              새 채팅
            </button>
          )}
        </div>
      </div>

      {/* 새 채팅 안내 배너 (대화가 길어졌을 때) */}
      {showNewChatBanner && !isStreaming && (
        <div className="mx-2 mb-2 p-3.5 rounded-xl bg-[#795252]/5 flex items-center justify-between shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <p className="text-sm text-[#795252]">대화가 길어졌어요. 새 채팅을 시작하면 아모라가 더 정확하게 답변할 수 있어요.</p>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <button onClick={() => setShowNewChatBanner(false)} className="px-3.5 py-1.5 text-sm rounded-lg bg-white text-[#504444] hover:bg-[#F6F3F2] shadow-sm">괜찮아요</button>
            <button onClick={handleNewChat} className="px-3.5 py-1.5 text-sm rounded-lg bg-gradient-to-br from-[#795252] to-[#946a6a] text-white hover:shadow-md">새 채팅</button>
          </div>
        </div>
      )}

      {/* 초기화 확인 */}
      {showClearConfirm && (
        <div className="mx-2 mb-2 p-3.5 rounded-xl bg-red-50 flex items-center justify-between shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <p className="text-sm text-red-600">대화를 모두 지우고 새로 시작할까요?</p>
          <div className="flex gap-2">
            <button onClick={() => setShowClearConfirm(false)} className="px-3.5 py-1.5 text-sm rounded-lg bg-white text-[#504444] hover:bg-[#F6F3F2] shadow-sm">취소</button>
            <button onClick={handleNewChat} className="px-3.5 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">새 채팅</button>
          </div>
        </div>
      )}

      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-4 px-4 py-4 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {(() => {
          // 최근 3개 AI 메시지 ID 계산 (피드백 버튼 표시용)
          const recentAiIds = new Set(
            messages
              .filter((m) => m.sender_role === "ai")
              .slice(-3)
              .map((m) => m.id)
          );
          return messages.map((msg) => {
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
                  msg.metadata!.toolResults!.map((result, i) =>
                    VENDOR_TOOL_NAMES.has(result.toolName) ? (
                      <VendorToolCard key={`${msg.id}-tool-${i}`} result={result} onSend={handleSend} disabled={isStreaming} />
                    ) : (
                      <ActionCard key={`${msg.id}-tool-${i}`} result={result} />
                    )
                  )}
              </div>
            );
          });
        })()}

        {isStreaming && (
          <div className="animate-fade-in">
            <StreamingBubble content={streamingContent} toolResults={streamingToolResults} onSend={handleSend} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

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

      {/* 제안 버튼 */}
      {suggestions.length > 0 && !isStreaming && (
        <div className="px-2 pb-2">
          <SuggestionButtons suggestions={suggestions} onSelect={handleSend} disabled={isStreaming} />
        </div>
      )}

      {/* 입력창 */}
      <div className="px-2 pt-3 pb-2">
        {/* 첨부 미리보기 */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 px-2 flex-wrap">
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

        {/* 대상 토글 */}
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <button
            onClick={() => setMessageTarget("ai")}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              messageTarget === "ai"
                ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_rgba(121,82,82,0.2)]"
                : "bg-white text-[#504444] shadow-[0_4px_14px_rgba(0,0,0,0.04)] hover:text-[#795252]"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            아모라에게
          </button>
          <button
            onClick={() => setMessageTarget("partner")}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              messageTarget === "partner"
                ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] text-white shadow-[0_4px_14px_rgba(217,156,156,0.25)]"
                : "bg-white text-[#504444] shadow-[0_4px_14px_rgba(0,0,0,0.04)] hover:text-[#D99C9C]"
            }`}
          >
            <Heart className="w-4 h-4" />
            상대방에게
          </button>
        </div>

        <div className={`bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-2 p-2.5 transition-all ${
          messageTarget === "partner" ? "ring-1 ring-[#D99C9C]/30" : ""
        }`}>
          {/* 파일 첨부 버튼 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.docx,.doc,.xlsx,.xls"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || attachments.length >= MAX_ATTACHMENTS}
            className="w-12 h-12 rounded-xl flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] hover:bg-[#795252]/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            title="파일 첨부 (이미지, PDF, Word, Excel)"
          >
            <Paperclip className="w-6 h-6" />
          </button>

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
            onPaste={handlePaste}
            placeholder={messageTarget === "partner" ? "상대방에게 메시지를 보내세요..." : "예산, 일정, 준비 현황 등 무엇이든 물어보세요..."}
            disabled={isStreaming}
            className="flex-1 px-2 py-3 text-[17px] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={(!input.trim() && attachments.length === 0) || isStreaming}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 ${
              messageTarget === "partner"
                ? "bg-gradient-to-br from-[#D99C9C] to-[#E8B4B4] shadow-[0_4px_14px_rgba(217,156,156,0.25)] hover:shadow-[0_6px_20px_rgba(217,156,156,0.3)]"
                : "bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)]"
            }`}
          >
            {messageTarget === "partner" ? <Heart className="w-[22px] h-[22px]" /> : <Send className="w-[22px] h-[22px]" />}
          </button>
        </div>
      </div>

    </div>
      {/* 정보 패널 */}
      <ChatInfoPanel isOpen={infoPanelOpen} onClose={() => setInfoPanelOpen(false)} />
    </div>
  );
}
