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
      <div className="max-w-[1250px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-[#C4967E]/30 mx-auto mb-4" />
          <h3 className="text-[25px] font-medium text-[#1A1A1F] mb-2">
            아모라는 로그인 후 이용할 수 있어요
          </h3>
          <p className="text-[25px] text-[#928980] mb-6 leading-relaxed">
            로그인하면 맞춤 웨딩 상담, 예산 관리,<br />
            일정 체크리스트 등을 아모라가 도와드려요
          </p>
          <a
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[23px] font-medium text-white bg-gradient-to-r from-[#C4967E] to-[#C9A96E] hover:shadow-md transition-all"
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
      <div className="max-w-[1250px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-[#C4967E]/30 mx-auto mb-4" />
          <p className="text-[38px] text-[#928980]">
            온보딩을 완료하면 아모라와 상담할 수 있어요
          </p>
        </div>
      </div>
    );
  }

  // 첨부 파일 아이콘 결정
  const getFileIcon = (mediaType: string) => {
    if (mediaType.includes("word") || mediaType === "application/msword") return <FileText className="w-6 h-6 text-[#4285F4]" />;
    if (mediaType.includes("spreadsheet") || mediaType.includes("ms-excel")) return <FileSpreadsheet className="w-6 h-6 text-[#34A853]" />;
    if (mediaType === "application/pdf") return <FileText className="w-6 h-6 text-[#C4967E]" />;
    return <FileText className="w-6 h-6 text-[#928980]" />;
  };

  return (
    <div
      className={`h-[calc(100vh-144px)] transition-all duration-300 ${infoPanelOpen ? "md:pr-[390px]" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 드래그 오버레이 */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-[#C4967E]/10 border-2 border-dashed border-[#C4967E] flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-lg text-center">
            <Paperclip className="w-10 h-10 text-[#C4967E] mx-auto mb-3" />
            <p className="text-[38px] font-medium text-[#1A1A1F]">파일을 여기에 놓으세요</p>
            <p className="text-[38px] text-[#928980] mt-1">이미지, PDF, Word, Excel</p>
          </div>
        </div>
      )}

    <div className="max-w-[1250px] mx-auto h-full flex flex-col">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#C4967E]" />
          <span className="text-[25px] font-medium text-[#1A1A1F]">아모라 상담</span>
          {messages.length > 0 && (
            <span className="text-[25px] text-[#B5ADA3]">({messages.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setInfoPanelOpen(!infoPanelOpen)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[25px] transition-colors ${
              infoPanelOpen
                ? "text-[#C4967E] bg-[#C4967E]/10"
                : "text-[#B5ADA3] hover:text-[#C4967E] hover:bg-[#C4967E]/5"
            }`}
          >
            <PanelRightOpen className="w-3 h-3" />
            정보
          </button>

          {messages.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[25px] text-[#B5ADA3] hover:text-[#C4967E] hover:bg-[#C4967E]/5 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              새 채팅
            </button>
          )}
        </div>
      </div>

      {/* 새 채팅 안내 배너 (대화가 길어졌을 때) */}
      {showNewChatBanner && !isStreaming && (
        <div className="mx-2 mb-2 p-3 rounded-xl bg-[#C4967E]/5 border border-[#C4967E]/20 flex items-center justify-between">
          <p className="text-xs text-[#9A6B62]">대화가 길어졌어요. 새 채팅을 시작하면 아모라가 더 정확하게 답변할 수 있어요.</p>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <button onClick={() => setShowNewChatBanner(false)} className="px-3 py-1 text-xs rounded-lg bg-white border border-black/[0.06] text-[#928980] hover:bg-gray-50">괜찮아요</button>
            <button onClick={handleNewChat} className="px-3 py-1 text-xs rounded-lg bg-[#C4967E] text-white hover:bg-[#9A6B62]">새 채팅</button>
          </div>
        </div>
      )}

      {/* 초기화 확인 */}
      {showClearConfirm && (
        <div className="mx-2 mb-2 p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
          <p className="text-xs text-red-600">대화를 모두 지우고 새로 시작할까요?</p>
          <div className="flex gap-2">
            <button onClick={() => setShowClearConfirm(false)} className="px-3 py-1 text-xs rounded-lg bg-white border border-black/[0.06] text-[#928980] hover:bg-gray-50">취소</button>
            <button onClick={handleNewChat} className="px-3 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600">새 채팅</button>
          </div>
        </div>
      )}

      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-4 px-2">
        {messages.map((msg) => {
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
          })}

        {isStreaming && (
          <div className="animate-fade-in">
            <StreamingBubble content={streamingContent} toolResults={streamingToolResults} onSend={handleSend} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 에러 메시지 */}
      {error && !isStreaming && (
        <div className="mx-2 mb-2 p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
          <p className="text-xs text-red-600">{error}</p>
          <button
            onClick={() => useChatStore.setState({ error: null })}
            className="ml-2 text-red-400 hover:text-red-600 flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 갈등 중재 제안 배너 */}
      {showMediationBanner && !isStreaming && (
        <div className="px-2 pb-2">
          <div className="relative bg-gradient-to-r from-pink-50 via-rose-50 to-orange-50 border border-pink-200/60 rounded-2xl px-4 py-3.5 shadow-sm">
            <button
              onClick={() => { setShowMediationBanner(false); }}
              className="absolute top-2 right-2 w-5 h-5 rounded-full text-[#B5ADA3] hover:text-[#928980] flex items-center justify-center"
            >
              <X className="w-3 h-3" />
            </button>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[25px] text-[#1A1A1F] leading-relaxed font-medium">
                  두 분 사이에 의견 차이가 있는 것 같아요
                </p>
                <p className="text-[38px] text-[#928980] leading-relaxed mt-0.5">
                  아모라가 중립적으로 의견 조율을 도와드릴게요
                </p>
                <button
                  onClick={handleManualMediation}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[38px] font-medium text-white bg-gradient-to-r from-[#C4967E] to-[#C9A96E] hover:shadow-md transition-all"
                >
                  <Sparkles className="w-3 h-3" />
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
      <div className="px-2 pb-2">
        {/* 첨부 미리보기 */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 px-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="relative group">
                {att.previewUrl.startsWith("blob:") ? (
                  <img
                    src={att.previewUrl}
                    alt={att.fileName}
                    className="w-16 h-16 rounded-lg object-cover border border-black/[0.06]"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-black/[0.06] bg-[#FAF8F5] flex flex-col items-center justify-center gap-1 px-1">
                    {getFileIcon(att.mediaType)}
                    <span className="text-[7px] text-[#928980] truncate max-w-[56px] text-center leading-tight">
                      {att.fileName}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#1A1A1F] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 대상 토글 */}
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <button
            onClick={() => setMessageTarget("ai")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[23px] font-medium transition-all ${
              messageTarget === "ai"
                ? "bg-[#1A1A1F] text-white shadow-sm"
                : "bg-white text-[#928980] border border-black/[0.06] hover:border-[#C4967E] hover:text-[#C4967E]"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            아모라에게
          </button>
          <button
            onClick={() => setMessageTarget("partner")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[23px] font-medium transition-all ${
              messageTarget === "partner"
                ? "bg-gradient-to-r from-pink-400 to-rose-400 text-white shadow-sm"
                : "bg-white text-[#928980] border border-black/[0.06] hover:border-pink-400 hover:text-pink-400"
            }`}
          >
            <Heart className="w-3 h-3" />
            상대방에게
          </button>
        </div>

        <div className={`bg-white rounded-2xl border shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex items-center gap-2 p-2 transition-colors ${
          messageTarget === "partner" ? "border-pink-200" : "border-black/[0.06]"
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
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[#B5ADA3] hover:text-[#C4967E] hover:bg-[#C4967E]/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            title="파일 첨부 (이미지, PDF, Word, Excel)"
          >
            <Paperclip className="w-5 h-5" />
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
            className="flex-1 px-2 py-3 text-[23px] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={(!input.trim() && attachments.length === 0) || isStreaming}
            className={`w-11 h-11 rounded-xl flex items-center justify-center text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 ${
              messageTarget === "partner"
                ? "bg-gradient-to-r from-pink-400 to-rose-400 hover:from-pink-500 hover:to-rose-500"
                : "bg-[#1A1A1F] hover:bg-[#2A2A2F]"
            }`}
          >
            {messageTarget === "partner" ? <Heart className="w-[18px] h-[18px]" /> : <Send className="w-[18px] h-[18px]" />}
          </button>
        </div>
      </div>

    </div>
      {/* 정보 패널 */}
      <ChatInfoPanel isOpen={infoPanelOpen} onClose={() => setInfoPanelOpen(false)} />
    </div>
  );
}
