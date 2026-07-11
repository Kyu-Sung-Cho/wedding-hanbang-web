"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Sparkles, X, Maximize2, Trash2, Paperclip, FileText, FileSpreadsheet, Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatMessageTarget } from "@/types/database.types";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import ChatBubble from "./ChatBubble";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";
import SuggestionButtons from "./SuggestionButtons";
import StreamingBubble from "./StreamingBubble";
import { chatAttachmentKey } from "@/lib/chat/attachments";
import { weddingPath } from "@/lib/weddingPaths";

const MAX_ATTACHMENTS = 3;
const MAX_TOTAL_ATTACHMENT_BYTES = 2 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, { maxSize: number; label: string }> = {
  "image/jpeg": { maxSize: 2 * 1024 * 1024, label: "이미지" },
  "image/png": { maxSize: 2 * 1024 * 1024, label: "이미지" },
  "image/gif": { maxSize: 2 * 1024 * 1024, label: "이미지" },
  "image/webp": { maxSize: 2 * 1024 * 1024, label: "이미지" },
  "application/pdf": { maxSize: 2 * 1024 * 1024, label: "PDF" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxSize: 2 * 1024 * 1024, label: "DOCX" },
};

interface AttachmentItem {
  base64: string;
  mediaType: string;
  previewUrl: string;
  fileName: string;
  byteSize: number;
}

function fileInputKey(file: File): string {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
}

interface ChatSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatSidePanel({ isOpen, onClose }: ChatSidePanelProps) {
  const router = useRouter();
  const { profile, couple, journey, isDemo } = useAuthStore();
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingToolResults,
    suggestions,
    error,
    initialLoadDone,
    loadMessages,
    sendMessage,
    clearMessages,
    subscribeToMessages,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [messageTarget, setMessageTarget] = useState<ChatMessageTarget>("ai");
  const [showMediationBanner, setShowMediationBanner] = useState(false);
  const [mediationDismissed, setMediationDismissed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const subscribed = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coupleId = couple?.id;
  const hasCouplePartner = !!(couple?.bride_id && couple?.groom_id);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isDemo || !coupleId || !profile) return;

    const welcomeMessage: ChatMessage = {
      id: "demo-amora-sidepanel-welcome",
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

  // 자동 스크롤
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages, isStreaming, streamingContent]);

  // 갈등 감지: 점수 기반 + 패턴 분석
  useEffect(() => {
    if (mediationDismissed) return;

    const timer = window.setTimeout(() => {
      const CONFLICT_SIGNALS: { keywords: string[]; weight: number }[] = [
        { keywords: ["싸우자", "싸웠", "다퉜", "말 안 해", "무시하", "대화가 안", "말이 안 통", "이해를 못 해"], weight: 5 },
        { keywords: ["왜 맨날 너만", "나만 양보", "너는 맨날", "맨날 나한테", "내 말은 안 듣", "관심이 없", "니가 알아서"], weight: 4 },
        { keywords: ["난 반대", "절대 안 돼", "그건 싫어", "왜 그걸 해야", "말도 안 돼", "너무 비싸다고", "돈이 어디 있", "예산 초과"], weight: 3 },
        { keywords: ["속상해", "서운해", "답답해", "화나", "짜증나", "지쳤어", "힘들어"], weight: 2 },
        { keywords: ["비싸", "별로", "아깝", "싫어", "안돼", "그만"], weight: 1 },
      ];

      const recentPartnerMsgs = messages
        .filter((m) => m.metadata?.target === "partner" && m.sender_role !== "ai")
        .slice(-6);

      if (recentPartnerMsgs.length < 3) {
        setShowMediationBanner(false);
        return;
      }

      const senders = new Set(recentPartnerMsgs.map((m) => m.sender_role));
      const bothSides = senders.size >= 2;

      let totalScore = 0;
      let messagesWithConflict = 0;

      for (const msg of recentPartnerMsgs) {
        let msgScore = 0;
        for (const signal of CONFLICT_SIGNALS) {
          for (const kw of signal.keywords) {
            if (msg.content.includes(kw)) {
              msgScore += signal.weight;
              break;
            }
          }
        }
        if (msgScore > 0) {
          messagesWithConflict++;
          totalScore += msgScore;
        }
      }

      if (bothSides) totalScore = Math.round(totalScore * 1.5);

      const THRESHOLD = 7;
      const isConflict = totalScore >= THRESHOLD && messagesWithConflict >= 2;
      setShowMediationBanner(isConflict);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [messages, mediationDismissed]);

  // 첨부파일 처리
  const processFile = useCallback((file: File) => {
    const typeInfo = ALLOWED_TYPES[file.type];
    if (!typeInfo) {
      alert(`지원하지 않는 파일 형식이에요: ${file.name}\n(이미지, PDF, DOCX 가능)`);
      return;
    }
    if (file.size > typeInfo.maxSize) {
      alert(`${typeInfo.label} 파일은 2MB 이하만 가능해요.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Full = reader.result as string;
      const base64Data = base64Full.split(",")[1];
      const attachment = {
        base64: base64Data,
        mediaType: file.type,
        previewUrl: file.type.startsWith("image/") ? base64Full : "",
        fileName: file.name,
        byteSize: file.size,
      };
      setAttachments((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev;
        const key = chatAttachmentKey(attachment);
        if (prev.some((item) => chatAttachmentKey(item) === key)) return prev;
        if (prev.reduce((sum, item) => sum + item.byteSize, 0) + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
          alert("첨부파일 합계는 2MB 이하만 가능해요.");
          return prev;
        }
        return [...prev, attachment];
      });
    };
    reader.readAsDataURL(file);
  }, []);

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
    async (text?: string) => {
      const content = text ?? input.trim();
      if (!content || !coupleId || !profile) return;

      const currentAttachments = [...attachments];
      setInput("");
      setAttachments([]);

      // 첨부만 있고 텍스트 없으면 기본 메시지 생성
      let finalContent = content;
      if (!content && currentAttachments.length > 0) {
        const hasDoc = currentAttachments.some((a) =>
          a.mediaType.includes("word") || a.mediaType.includes("spreadsheet") || a.mediaType.includes("ms-excel")
        );
        const hasPdf = currentAttachments.some((a) => a.mediaType === "application/pdf");
        if (hasDoc || hasPdf) finalContent = "이 문서를 분석해주세요.";
        else finalContent = "이 이미지를 분석해주세요.";
      }

      await sendMessage({
        content: finalContent,
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

  // 중재 요청
  const requestMediation = useCallback(() => {
    setShowMediationBanner(false);
    setMediationDismissed(true);
    setMessageTarget("ai");

    const recentPartnerMsgs = messages
      .filter((m) => m.metadata?.target === "partner" && m.sender_role !== "ai")
      .slice(-3);
    const lastTopic = recentPartnerMsgs.length > 0
      ? recentPartnerMsgs[recentPartnerMsgs.length - 1].content.slice(0, 30)
      : "결혼 준비";

    handleSend(`아모라, 우리가 "${lastTopic}" 관련해서 의견이 다른데 도움 줄 수 있어?`);
  }, [messages, handleSend]);

  const handleExpand = () => {
    onClose();
    router.push(weddingPath("/chat"));
  };

  const handleClearChat = async () => {
    if (!coupleId) return;
    // SidePanel에서는 가장 안전한 default — "내 화면만 정리 (함께 대화)"
    // 진짜 삭제는 메인 채팅 modal에서만 가능
    await clearMessages(coupleId, "view_reset_shared");
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
        className={`fixed z-50 flex flex-col overflow-hidden bg-ivory-50 shadow-[-4px_0_24px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-out
          md:top-0 md:right-0 md:w-[400px] md:h-full md:border-l md:border-black/[0.06]
          max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:h-[78dvh] max-md:min-h-[420px] max-md:max-h-[calc(100dvh-4.5rem)] max-md:rounded-t-[22px] max-md:border-t max-md:border-black/[0.06] max-md:shadow-[0_-18px_45px_rgba(7,22,41,0.18)]
          ${isOpen
            ? "md:translate-x-0 max-md:translate-y-0"
            : "md:translate-x-full max-md:translate-y-full"
        }`}
        role="dialog"
        aria-modal={isOpen}
        aria-hidden={!isOpen}
        aria-label="아모라 AI 상담 패널"
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
              <h3 className="text-sm font-medium text-noir-800">아모라 AI</h3>
              <p className="text-[0.6875rem] text-taupe-400">웨딩 플래너</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors"
                title="대화 초기화"
                aria-label="내 화면의 대화 목록 정리"
              >
                <Trash2 className="w-4 h-4 text-taupe-500 hover:text-red-400" />
              </button>
            )}
            <button
              onClick={handleExpand}
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-black/[0.04] transition-colors"
              title="전체 화면으로 보기"
              aria-label="아모라 채팅 전체 화면으로 보기"
            >
              <Maximize2 className="w-4 h-4 text-taupe-500" />
            </button>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-black/[0.04] transition-colors"
              title="닫기"
              aria-label="아모라 상담 패널 닫기"
            >
              <X className="w-4 h-4 text-taupe-500" />
            </button>
          </div>
        </div>

        <div className="flex min-h-9 items-center justify-center gap-2 border-b border-black/[0.05] bg-[#FBF8F2] px-4 text-xs text-[#5F5B52]">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-gold" aria-hidden="true" />
            AI 생성 · GPT-5.6
          </span>
          <span aria-hidden="true" className="text-[#B8AEA6]">·</span>
          <a href="/ai-policy" className="underline underline-offset-2 hover:text-[#795252]">
            AI 정책
          </a>
        </div>

        {showEmpty ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <Sparkles className="w-10 h-10 text-rose-500/30 mx-auto mb-3" />
              <p className="text-[0.8125rem] text-taupe-500 mb-1">
                {isDemo ? "로그인 후 이용할 수 있어요" : "온보딩을 완료해주세요"}
              </p>
              {isDemo && (
                <a href="/login" className="text-xs text-rose-500 font-medium hover:underline">
                  로그인하기
                </a>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 초기화 확인 */}
            {showClearConfirm && (
              <div className="mx-3 mt-2 p-2.5 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
                <p className="text-xs text-red-600">내 화면의 대화 목록을 정리할까요? 서버 데이터는 보존됩니다.</p>
                <div className="flex gap-1.5">
                  <button onClick={() => setShowClearConfirm(false)} className="px-2.5 py-1 text-[0.6875rem] rounded-lg bg-white border border-black/[0.06] text-taupe-500 hover:bg-gray-50">취소</button>
                  <button onClick={handleClearChat} className="px-2.5 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600">화면 정리</button>
                </div>
              </div>
            )}

            {/* 에러 표시 */}
            {error && (
              <div className="mx-3 mt-2 p-2.5 rounded-xl bg-red-50 border border-red-200">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            {/* 메시지 영역 */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && initialLoadDone && (
                <div className="py-10 text-center" role="status">
                  <Sparkles className="mx-auto mb-3 h-8 w-8 text-rose-500/30" aria-hidden="true" />
                  <p className="text-sm font-medium text-noir-800">안녕하세요, 아모라예요.</p>
                  <p className="mt-2 text-xs leading-relaxed text-taupe-500">
                    채팅을 여는 것만으로 상담 횟수는 차감되지 않아요.
                    <br />궁금한 준비를 직접 입력해 주세요.
                  </p>
                </div>
              )}
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
                    <div key={msg.id} className="animate-fade-in">
                      <ChatBubble
                        message={msg}
                        isCurrentUser={isCurrentUser}
                        currentUserRole={profile?.role}
                        isRecentAi={recentAiIds.has(msg.id)}
                      />
                      {hasToolResults &&
                        // 같은 메시지 안에서 동일 (toolName, success, displayMessage)
                        // 중복 카드 1개만 표시 — DB 부족 등으로 반복 실패 시 X 카드
                        // 줄줄이 나오는 문제 방어.
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

            {/* 갈등 중재 제안 배너 */}
            {showMediationBanner && !isStreaming && (
              <div className="px-3 pb-2">
                <div className="relative bg-gradient-to-r from-pink-50 via-rose-50 to-orange-50 border border-pink-200/60 rounded-2xl px-3 py-3 shadow-sm">
                  <button
                    onClick={() => { setShowMediationBanner(false); setMediationDismissed(true); }}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full text-[#B5ADA3] hover:text-[#928980] flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#1A1A1F] leading-relaxed">
                        혹시 의견 조율이 필요하시면, 아모라가 도와드릴 수 있어요
                      </p>
                      <button
                        onClick={requestMediation}
                        className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[0.6875rem] font-medium text-white bg-gradient-to-r from-[#C4967E] to-[#C9A96E] hover:shadow-md transition-colors"
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
            {suggestions.length > 0 && !isStreaming && (
              <div className="px-3 pt-2 pb-4 border-t border-[#F0EFED]/60 mt-2">
                <SuggestionButtons suggestions={suggestions} onSelect={handleSend} disabled={isStreaming} />
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
                        <span className="text-[8px] text-taupe-400 mt-0.5 truncate max-w-[40px]">{att.fileName.split(".").pop()}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 입력 영역 */}
            <div className="px-3 pb-3 pt-1">
              {/* 대상 토글 (커플 연동 시) */}
              {hasCouplePartner && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <button
                    onClick={() => setMessageTarget("ai")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.625rem] font-medium transition-colors ${
                      messageTarget === "ai"
                        ? "bg-gradient-to-r from-rose-500/10 to-gold/10 text-rose-600 border border-rose-200"
                        : "text-taupe-400 hover:text-taupe-500 border border-transparent"
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    아모라에게
                  </button>
                  <button
                    onClick={() => setMessageTarget("partner")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.625rem] font-medium transition-colors ${
                      messageTarget === "partner"
                        ? "bg-gradient-to-r from-pink-500/10 to-purple-500/10 text-pink-600 border border-pink-200"
                        : "text-taupe-400 hover:text-taupe-500 border border-transparent"
                    }`}
                  >
                    <Heart className="w-3 h-3" />
                    상대방에게
                  </button>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.04)] flex items-center gap-1.5 p-1.5">
                {/* 첨부파일 버튼 */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming || attachments.length >= MAX_ATTACHMENTS}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04] transition-colors disabled:opacity-30 flex-shrink-0"
                  title="파일 첨부"
                >
                  <Paperclip className="w-4 h-4 text-taupe-400" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={Object.keys(ALLOWED_TYPES).join(",")}
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
                  placeholder={messageTarget === "partner" ? "상대방에게 메시지..." : "무엇이든 물어보세요..."}
                  disabled={isStreaming}
                  className="flex-1 px-2 py-2 text-[0.8125rem] text-noir-800 placeholder:text-taupe-400 bg-transparent outline-none disabled:opacity-50 min-w-0"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={(!input.trim() && attachments.length === 0) || isStreaming}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 ${
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
    </>
  );
}
