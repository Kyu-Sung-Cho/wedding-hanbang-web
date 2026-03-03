"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Plus, Trash2, X, MessageSquare, PanelRightOpen } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import ChatBubble from "@/components/app/chat/ChatBubble";
import ActionCard from "@/components/app/chat/ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "@/components/app/chat/VendorToolCard";
import SuggestionButtons from "@/components/app/chat/SuggestionButtons";
import StreamingBubble from "@/components/app/chat/StreamingBubble";
import ChatInfoPanel from "@/components/app/chat/ChatInfoPanel";

const MAX_ROOMS = 5;

export default function ChatPage() {
  const { profile, couple, journey, isDemo } = useAuthStore();
  const {
    messages,
    rooms,
    activeRoomId,
    isLoading,
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
    reset,
  } = useChatStore();
  const [input, setInput] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const greetingRequestedForRoom = useRef<Set<string>>(new Set());
  const coupleId = couple?.id;

  // 방 목록 초기화
  useEffect(() => {
    if (!coupleId || isDemo) return;
    initRooms(coupleId);
  }, [coupleId, isDemo, initRooms]);

  // 방 전환 또는 처음 로드 시 메시지 로드
  useEffect(() => {
    if (!coupleId || isDemo) return;
    loadMessages(coupleId);
    const unsubscribe = subscribeToMessages(coupleId);
    return () => {
      unsubscribe();
    };
  }, [coupleId, isDemo, activeRoomId, loadMessages, subscribeToMessages]);

  // 메시지 0개 + 로딩 완료 시 AI 첫 인사
  useEffect(() => {
    if (
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
  }, [coupleId, profile, journey, initialLoadDone, messages.length, isStreaming, activeRoomId, requestInitialGreeting]);

  // 스크롤 자동 이동
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, streamingContent]);

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

  const handleCreateRoom = () => {
    if (!coupleId) return;
    const newRoomId = createRoom(coupleId);
    if (!newRoomId) {
      alert(`최대 ${MAX_ROOMS}개까지만 만들 수 있어요.`);
    }
    // 새 방은 greeting tracker에 없으므로 자동으로 AI 인사가 트리거됨
  };

  const handleClearRoom = async () => {
    if (!coupleId) return;
    // tracker를 먼저 삭제해야 clearRoom의 set({messages:[]}) 후
    // 재렌더링에서 greeting effect가 바로 트리거됨
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

  const handleSwitchRoom = (roomId: string) => {
    if (roomId === activeRoomId) return;
    switchRoom(roomId);
  };

  // 데모 모드: AI 상담 비활성화
  if (isDemo) {
    return (
      <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-[#C4967E]/30 mx-auto mb-4" />
          <h3 className="text-[16px] font-medium text-[#1A1A1F] mb-2">
            아리아는 로그인 후 이용할 수 있어요
          </h3>
          <p className="text-[13px] text-[#928980] mb-6 leading-relaxed">
            로그인하면 맞춤 웨딩 상담, 예산 관리,<br />
            일정 체크리스트 등을 아리아가 도와드려요
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
            온보딩을 완료하면 아리아와 상담할 수 있어요
          </p>
        </div>
      </div>
    );
  }

  const allRoomTabs = [
    { id: "default", title: defaultRoomTitle || "새 상담" },
    ...rooms.map((r) => ({ id: r.id, title: r.title || "새 상담" })),
  ];
  const totalRooms = allRoomTabs.length;

  return (
    <div className={`h-[calc(100vh-144px)] transition-all duration-300 ${
      infoPanelOpen ? "md:pr-[390px]" : ""
    }`}>
    <div className="max-w-[800px] mx-auto h-full flex flex-col">
      {/* 방 탭 바 */}
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-1 overflow-x-auto scrollbar-hide">
        {allRoomTabs.map((tab) => (
          <div key={tab.id} className="relative group flex-shrink-0">
            <button
              onClick={() => handleSwitchRoom(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeRoomId === tab.id
                  ? "bg-[#1A1A1F] text-white shadow-sm"
                  : "bg-white text-[#928980] border border-black/[0.06] hover:border-[#C4967E] hover:text-[#C4967E]"
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              {tab.title}
            </button>
            {/* 삭제 버튼 (기본방 제외, 호버 시) */}
            {tab.id !== "default" && activeRoomId !== tab.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(tab.id);
                }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        ))}

        {/* 새 방 버튼 */}
        {totalRooms < MAX_ROOMS && (
          <button
            onClick={handleCreateRoom}
            className="flex-shrink-0 w-7 h-7 rounded-lg border border-dashed border-[#B5ADA3] text-[#B5ADA3] flex items-center justify-center hover:border-[#C4967E] hover:text-[#C4967E] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 정보 패널 토글 */}
        <button
          onClick={() => setInfoPanelOpen(!infoPanelOpen)}
          className={`flex-shrink-0 ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] transition-colors ${
            infoPanelOpen
              ? "text-[#C4967E] bg-[#C4967E]/10"
              : "text-[#B5ADA3] hover:text-[#C4967E] hover:bg-[#C4967E]/5"
          }`}
        >
          <PanelRightOpen className="w-3 h-3" />
          정보
        </button>

        {/* 현재 방 초기화 버튼 */}
        {messages.length > 0 && (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            초기화
          </button>
        )}
      </div>

      {/* 초기화 확인 모달 */}
      {showClearConfirm && (
        <div className="mx-2 mb-2 p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
          <p className="text-xs text-red-600">이 대화를 모두 삭제할까요?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowClearConfirm(false)}
              className="px-3 py-1 text-xs rounded-lg bg-white border border-black/[0.06] text-[#928980] hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={handleClearRoom}
              className="px-3 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600"
            >
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 방 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <div className="mx-2 mb-2 p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
          <p className="text-xs text-red-600">이 채팅방을 삭제할까요?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeleteConfirm(null)}
              className="px-3 py-1 text-xs rounded-lg bg-white border border-black/[0.06] text-[#928980] hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={() => handleDeleteRoom(showDeleteConfirm)}
              className="px-3 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600"
            >
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-4 px-2">
        <AnimatePresence>
          {messages.map((msg) => {
            const isCurrentUser = msg.sender_id === profile?.id;
            const hasToolResults =
              msg.sender_role === "ai" &&
              msg.metadata?.toolResults &&
              msg.metadata.toolResults.length > 0;

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
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
              </motion.div>
            );
          })}
        </AnimatePresence>

        {isStreaming && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <StreamingBubble content={streamingContent} toolResults={streamingToolResults} onSend={handleSend} />
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 제안 버튼 */}
      {suggestions.length > 0 && !isStreaming && (
        <div className="px-2 pb-2">
          <SuggestionButtons suggestions={suggestions} onSelect={handleSend} disabled={isStreaming} />
        </div>
      )}

      {/* 입력창 */}
      <div className="px-2 pb-2">
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex items-center gap-3 p-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleSend()}
            placeholder="예산, 일정, 준비 현황 등 무엇이든 물어보세요..."
            disabled={isStreaming}
            className="flex-1 px-4 py-3 text-[14px] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isStreaming}
            className="w-11 h-11 rounded-xl bg-[#1A1A1F] flex items-center justify-center text-white hover:bg-[#2A2A2F] transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Send className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

    </div>
      {/* 정보 패널 */}
      <ChatInfoPanel isOpen={infoPanelOpen} onClose={() => setInfoPanelOpen(false)} />
    </div>
  );
}
