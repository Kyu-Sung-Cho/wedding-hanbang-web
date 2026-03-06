"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Sparkles, X, Maximize2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import ChatBubble from "./ChatBubble";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";
import SuggestionButtons from "./SuggestionButtons";
import StreamingBubble from "./StreamingBubble";

interface ChatSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatSidePanel({ isOpen, onClose }: ChatSidePanelProps) {
  const router = useRouter();
  const { profile, couple, journey, isDemo } = useAuthStore();
  const {
    messages,
    rooms,
    activeRoomId,
    isStreaming,
    streamingContent,
    streamingToolResults,
    suggestions,
    initialLoadDone,
    defaultRoomTitle,
    initRooms,
    createRoom,
    switchRoom,
    deleteRoom,
    clearRoom,
    loadMessages,
    sendMessage,
    requestInitialGreeting,
    subscribeToMessages,
  } = useChatStore();

  const MAX_ROOMS = 5;
  const [input, setInput] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const greetingRequestedForRoom = useRef<Set<string>>(new Set());
  const subscribed = useRef(false);
  const coupleId = couple?.id;

  // 패널 열릴 때 채팅 초기화
  useEffect(() => {
    if (!isOpen || !coupleId || isDemo) return;

    initRooms(coupleId);
    loadMessages(coupleId);

    if (!subscribed.current) {
      const unsubscribe = subscribeToMessages(coupleId);
      subscribed.current = true;
      return () => {
        unsubscribe();
        subscribed.current = false;
      };
    }
  }, [isOpen, coupleId, isDemo, initRooms, loadMessages, subscribeToMessages]);

  // 방 전환 시 메시지 리로드
  useEffect(() => {
    if (!isOpen || !coupleId || isDemo) return;
    loadMessages(coupleId);
  }, [activeRoomId, isOpen, coupleId, isDemo, loadMessages]);

  // 메시지 0개일 때 AI 첫 인사
  useEffect(() => {
    if (
      !isOpen ||
      !coupleId ||
      !profile ||
      isDemo ||
      !initialLoadDone ||
      isStreaming ||
      messages.length > 0 ||
      greetingRequestedForRoom.current.has(activeRoomId)
    )
      return;

    greetingRequestedForRoom.current.add(activeRoomId);
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
  }, [isOpen, coupleId, profile, journey, initialLoadDone, messages.length, isStreaming, activeRoomId, requestInitialGreeting, isDemo]);

  // 자동 스크롤
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages, isStreaming, streamingContent]);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = text ?? input.trim();
      if (!content || !coupleId || !profile) return;
      setInput("");

      await sendMessage({
        content,
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
      });
    },
    [input, coupleId, profile, journey, sendMessage]
  );

  const handleExpand = () => {
    onClose();
    router.push("/chat");
  };

  const handleCreateRoom = () => {
    if (!coupleId) return;
    const newRoomId = createRoom(coupleId);
    if (!newRoomId) alert(`최대 ${MAX_ROOMS}개까지만 만들 수 있어요.`);
  };

  const handleSwitchRoom = (roomId: string) => {
    if (roomId === activeRoomId) return;
    switchRoom(roomId);
  };

  const handleClearRoom = async () => {
    if (!coupleId) return;
    greetingRequestedForRoom.current.delete(activeRoomId);
    await clearRoom(coupleId, activeRoomId);
    setShowClearConfirm(false);
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!coupleId) return;
    await deleteRoom(coupleId, roomId);
    greetingRequestedForRoom.current.delete(roomId);
    setShowDeleteConfirm(null);
  };

  // 로그인 안 됨 / 커플 없음
  const showEmpty = isDemo || !coupleId;

  const allRoomTabs = [
    { id: "default", title: defaultRoomTitle || "새 상담" },
    ...rooms.map((r) => ({ id: r.id, title: r.title || "새 상담" })),
  ];
  const totalRooms = allRoomTabs.length;

  return (
    <>
      {/* 모바일 오버레이 */}
      <div
        className={`fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* 패널 */}
      <div
        className={`fixed z-40 bg-ivory-50 shadow-[-4px_0_24px_rgba(0,0,0,0.08)] flex flex-col transition-transform duration-300 ease-out
          md:top-0 md:right-0 md:w-[400px] md:h-full md:border-l md:border-black/[0.06]
          max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:h-[85vh] max-md:rounded-t-2xl
          ${isOpen
            ? "md:translate-x-0 max-md:translate-y-0"
            : "md:translate-x-full max-md:translate-y-full"
          }`}
      >
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
              <h3 className="text-[14px] font-medium text-noir-800">아모라 AI</h3>
              <p className="text-[10px] text-taupe-400">웨딩 플래너</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleExpand}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04] transition-colors"
              title="전체 화면으로 보기"
            >
              <Maximize2 className="w-4 h-4 text-taupe-500" />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04] transition-colors"
            >
              <X className="w-4 h-4 text-taupe-500" />
            </button>
          </div>
        </div>

        {showEmpty ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <Sparkles className="w-10 h-10 text-rose-500/30 mx-auto mb-3" />
              <p className="text-[13px] text-taupe-500 mb-1">
                {isDemo ? "로그인 후 이용할 수 있어요" : "온보딩을 완료해주세요"}
              </p>
              {isDemo && (
                <a href="/login" className="text-[12px] text-rose-500 font-medium hover:underline">
                  로그인하기
                </a>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 방 탭 바 */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-black/[0.04] overflow-x-auto scrollbar-hide">
              {allRoomTabs.map((tab) => (
                <div key={tab.id} className="relative group flex-shrink-0">
                  <button
                    onClick={() => handleSwitchRoom(tab.id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      activeRoomId === tab.id
                        ? "bg-noir-800 text-white shadow-sm"
                        : "bg-white text-taupe-500 border border-black/[0.06] hover:border-rose-500 hover:text-rose-500"
                    }`}
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span className="max-w-[80px] truncate">{tab.title}</span>
                  </button>
                  {tab.id !== "default" && activeRoomId !== tab.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(tab.id); }}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2 h-2" />
                    </button>
                  )}
                </div>
              ))}

              {totalRooms < MAX_ROOMS && (
                <button
                  onClick={handleCreateRoom}
                  className="flex-shrink-0 w-6 h-6 rounded-lg border border-dashed border-taupe-400 text-taupe-400 flex items-center justify-center hover:border-rose-500 hover:text-rose-500 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}

              {messages.length > 0 && (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="flex-shrink-0 ml-auto w-6 h-6 rounded-lg flex items-center justify-center text-taupe-400 hover:text-red-400 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 초기화 확인 */}
            {showClearConfirm && (
              <div className="mx-3 mt-2 p-2.5 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
                <p className="text-[11px] text-red-600">대화를 모두 삭제할까요?</p>
                <div className="flex gap-1.5">
                  <button onClick={() => setShowClearConfirm(false)} className="px-2.5 py-1 text-[11px] rounded-lg bg-white border border-black/[0.06] text-taupe-500 hover:bg-gray-50">취소</button>
                  <button onClick={handleClearRoom} className="px-2.5 py-1 text-[11px] rounded-lg bg-red-500 text-white hover:bg-red-600">삭제</button>
                </div>
              </div>
            )}

            {/* 방 삭제 확인 */}
            {showDeleteConfirm && (
              <div className="mx-3 mt-2 p-2.5 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
                <p className="text-[11px] text-red-600">이 채팅방을 삭제할까요?</p>
                <div className="flex gap-1.5">
                  <button onClick={() => setShowDeleteConfirm(null)} className="px-2.5 py-1 text-[11px] rounded-lg bg-white border border-black/[0.06] text-taupe-500 hover:bg-gray-50">취소</button>
                  <button onClick={() => handleDeleteRoom(showDeleteConfirm)} className="px-2.5 py-1 text-[11px] rounded-lg bg-red-500 text-white hover:bg-red-600">삭제</button>
                </div>
              </div>
            )}

            {/* 메시지 영역 */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.map((msg) => {
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

            {/* 제안 버튼 */}
            {suggestions.length > 0 && !isStreaming && (
              <div className="px-4 pb-2">
                <SuggestionButtons suggestions={suggestions} onSelect={handleSend} disabled={isStreaming} />
              </div>
            )}

            {/* 입력창 */}
            <div className="px-4 pb-4 pt-2">
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.04)] flex items-center gap-2 p-1.5">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleSend()}
                  placeholder="무엇이든 물어보세요..."
                  disabled={isStreaming}
                  className="flex-1 px-3 py-2.5 text-[13px] text-noir-800 placeholder:text-taupe-400 bg-transparent outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isStreaming}
                  className="w-9 h-9 rounded-xl bg-noir-800 flex items-center justify-center text-white hover:bg-noir-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
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
