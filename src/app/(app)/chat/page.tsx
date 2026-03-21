"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Sparkles, Trash2, X, PanelRightOpen, Paperclip, FileText, FileSpreadsheet, Heart } from "lucide-react";
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
    clearMessages,
    subscribeToMessages,
  } = useChatStore();
  const [input, setInput] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [messageTarget, setMessageTarget] = useState<ChatMessageTarget>("ai");
  const [showMediationBanner, setShowMediationBanner] = useState(false);
  const [mediationDismissed, setMediationDismissed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFilesRef = useRef<(files: File[]) => void>(() => {});
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

  // 갈등 감지: 점수 기반 + 패턴 분석 (단순 키워드 매칭 X)
  useEffect(() => {
    if (mediationDismissed) return;

    // 가중치 기반 키워드 (높을수록 갈등 확률 높음)
    const CONFLICT_SIGNALS: { keywords: string[]; weight: number }[] = [
      // 5점: 직접적 커플 갈등 표현 (거의 확실)
      { keywords: ["싸우자", "싸웠", "다퉜", "말 안 해", "무시하", "대화가 안", "말이 안 통", "이해를 못 해"], weight: 5 },
      // 4점: 강한 감정 + 상대방 향한 불만
      { keywords: ["왜 맨날 너만", "나만 양보", "너는 맨날", "맨날 나한테", "내 말은 안 듣", "관심이 없", "니가 알아서"], weight: 4 },
      // 3점: 결혼 준비 관련 의견 충돌
      { keywords: ["난 반대", "절대 안 돼", "그건 싫어", "왜 그걸 해야", "말도 안 돼", "너무 비싸다고", "돈이 어디 있", "예산 초과"], weight: 3 },
      // 2점: 감정 표현 (혼자 스트레스일 수도 있음)
      { keywords: ["속상해", "서운해", "답답해", "화나", "짜증나", "지쳤어", "힘들어"], weight: 2 },
      // 1점: 약한 부정 (일상 대화에서도 흔함 → 단독으로는 갈등 아님)
      { keywords: ["비싸", "별로", "아깝", "싫어", "안돼", "그만"], weight: 1 },
    ];

    // 최근 partner 메시지만 (최근 6개)
    const recentPartnerMsgs = messages
      .filter((m) => m.metadata?.target === "partner" && m.sender_role !== "ai")
      .slice(-6);

    // 조건 1: 최소 partner 메시지 3개 이상 (대화가 오가야 갈등)
    if (recentPartnerMsgs.length < 3) {
      setShowMediationBanner(false);
      return;
    }

    // 조건 2: 양쪽 다 메시지가 있어야 함 (한 명만 말하면 일방적 대화)
    const senders = new Set(recentPartnerMsgs.map((m) => m.sender_role));
    const bothSides = senders.size >= 2;

    // 점수 계산
    let totalScore = 0;
    let messagesWithConflict = 0;

    for (const msg of recentPartnerMsgs) {
      let msgScore = 0;
      for (const signal of CONFLICT_SIGNALS) {
        for (const kw of signal.keywords) {
          if (msg.content.includes(kw)) {
            msgScore += signal.weight;
            break; // 같은 가중치 그룹에서 한 번만 카운트
          }
        }
      }
      if (msgScore > 0) {
        messagesWithConflict++;
        totalScore += msgScore;
      }
    }

    // 양쪽이 대화 중이면 점수 1.5배 (진짜 갈등일 확률 높음)
    if (bothSides) totalScore = Math.round(totalScore * 1.5);

    // 판정 기준:
    // - 5점짜리 키워드 1개만 있어도 → 바로 (5 × 1.5 = 7.5)
    // - 3점짜리 2개 + 양쪽 대화 → 바로 (6 × 1.5 = 9)
    // - 2점짜리만 여러 개 → 4개 이상이어야 (8 × 1.5 = 12, 보수적)
    // - 1점짜리만 → 절대 안 뜸 (1 × 6 × 1.5 = 9 안 됨, messagesWithConflict 조건)
    const THRESHOLD = 7;
    const isConflict = totalScore >= THRESHOLD && messagesWithConflict >= 2;

    setShowMediationBanner(isConflict);
  }, [messages, mediationDismissed]);

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

  // 아모라에게 중재 요청
  const requestMediation = useCallback(() => {
    setShowMediationBanner(false);
    setMediationDismissed(true);
    setMessageTarget("ai");

    // 최근 partner 대화 주제를 간단히 추출
    const recentPartnerMsgs = messages
      .filter((m) => m.metadata?.target === "partner" && m.sender_role !== "ai")
      .slice(-3);
    const lastTopic = recentPartnerMsgs.length > 0
      ? recentPartnerMsgs[recentPartnerMsgs.length - 1].content.slice(0, 30)
      : "결혼 준비";

    // 자동 메시지 전송
    handleSend(`아모라, 우리가 "${lastTopic}" 관련해서 의견이 다른데 도움 줄 수 있어?`);
  }, [messages, handleSend]);

  const handleClear = async () => {
    if (!coupleId) return;
    greetingRequested.current = false;
    await clearMessages(coupleId);
    setShowClearConfirm(false);
  };

  // 데모 모드
  if (isDemo) {
    return (
      <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-[#C4967E]/30 mx-auto mb-4" />
          <h3 className="text-[16px] font-medium text-[#1A1A1F] mb-2">
            아모라는 로그인 후 이용할 수 있어요
          </h3>
          <p className="text-[13px] text-[#928980] mb-6 leading-relaxed">
            로그인하면 맞춤 웨딩 상담, 예산 관리,<br />
            일정 체크리스트 등을 아모라가 도와드려요
          </p>
          <a
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-medium text-white bg-gradient-to-r from-[#C4967E] to-[#C9A96E] hover:shadow-md transition-all"
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
      <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-[#C4967E]/30 mx-auto mb-4" />
          <p className="text-[15px] text-[#928980]">
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
            <p className="text-[15px] font-medium text-[#1A1A1F]">파일을 여기에 놓으세요</p>
            <p className="text-[12px] text-[#928980] mt-1">이미지, PDF, Word, Excel</p>
          </div>
        </div>
      )}

    <div className="max-w-[800px] mx-auto h-full flex flex-col">
      {/* 상단 바 */}
      <div className="flex items-center justify-end gap-1.5 px-2 pb-2 pt-1">
        <button
          onClick={() => setInfoPanelOpen(!infoPanelOpen)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] transition-colors ${
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
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            초기화
          </button>
        )}
      </div>

      {/* 초기화 확인 */}
      {showClearConfirm && (
        <div className="mx-2 mb-2 p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
          <p className="text-xs text-red-600">이 대화를 모두 삭제할까요?</p>
          <div className="flex gap-2">
            <button onClick={() => setShowClearConfirm(false)} className="px-3 py-1 text-xs rounded-lg bg-white border border-black/[0.06] text-[#928980] hover:bg-gray-50">취소</button>
            <button onClick={handleClear} className="px-3 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600">삭제</button>
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
              onClick={() => { setShowMediationBanner(false); setMediationDismissed(true); }}
              className="absolute top-2 right-2 w-5 h-5 rounded-full text-[#B5ADA3] hover:text-[#928980] flex items-center justify-center"
            >
              <X className="w-3 h-3" />
            </button>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-[#1A1A1F] leading-relaxed">
                  혹시 의견 조율이 필요하시면, 아모라가 도와드릴 수 있어요
                </p>
                <button
                  onClick={requestMediation}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-medium text-white bg-gradient-to-r from-[#C4967E] to-[#C9A96E] hover:shadow-md transition-all"
                >
                  <Sparkles className="w-3 h-3" />
                  아모라에게 상담 요청하기
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${
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
            className="flex-1 px-2 py-3 text-[14px] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50"
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
