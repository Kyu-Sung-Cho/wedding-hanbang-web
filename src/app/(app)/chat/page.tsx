"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useJourneyStore } from "@/stores/journeyStore";
import { useBudgetStore } from "@/stores/budgetStore";
import { WELCOME_MESSAGE, Message, ButtonOption } from "@/types/chat.types";
import { subscribeToChatMessages } from "@/lib/services/chatService";
import { CATEGORIES } from "@/constants/categories";
import { CategoryId, CategoryStatus } from "@/types";
import ChatBubble from "@/components/app/chat/ChatBubble";
import ChatInput from "@/components/app/chat/ChatInput";
import ButtonOptions from "@/components/app/chat/ButtonOptions";
import VendorCardComponent from "@/components/app/chat/VendorCard";
import { Trash2, Sparkles } from "lucide-react";

export default function ChatPage() {
  const {
    messages,
    isLoading,
    sendMessage,
    clearChat,
    setContext,
  } = useChatStore();

  const { weddingDate, getDaysUntilWedding, categoryStatuses, checklistProgress, role } =
    useJourneyStore();
  const { totalBudget, getTotalSpent } = useBudgetStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // 현재 사용자 역할 (신부/신랑)
  const currentSender = role || "bride";

  // Supabase Realtime 구독 - 상대방 메시지 실시간 수신
  useEffect(() => {
    const coupleId = useChatStore.getState().coupleId;
    if (!coupleId) return;

    const unsubscribe = subscribeToChatMessages(coupleId, (newMessage) => {
      // 이미 로컬에 있는 메시지면 무시 (내가 보낸 것)
      const existing = useChatStore.getState().messages;
      if (existing.some((m) => m.id === newMessage.id)) return;
      useChatStore.getState().addMessage(newMessage);
    });

    return unsubscribe;
  }, []);

  // D-day 기반 긴급 카테고리 계산
  const getUrgentCategories = () => {
    const dday = getDaysUntilWedding();
    if (dday === null) return [];

    return CATEGORIES
      .filter((cat) => {
        const status = categoryStatuses[cat.id] as CategoryStatus | undefined;
        if (status === "completed" || status === "skipped") return false;
        // latestDaysBefore 이하면 긴급
        return dday <= cat.suggestedTiming.latestDaysBefore;
      })
      .sort((a, b) => b.suggestedTiming.latestDaysBefore - a.suggestedTiming.latestDaysBefore)
      .map((cat) => {
        const status = categoryStatuses[cat.id] as CategoryStatus | undefined;
        const checkedCount = cat.checklistItems.filter(
          (item) => checklistProgress[`${cat.id}_${item.id}`]
        ).length;
        const totalCount = cat.checklistItems.length;
        const isOverdue = dday < cat.suggestedTiming.latestDaysBefore;
        return {
          id: cat.id,
          name: cat.name,
          emoji: cat.emoji,
          status: status || "not_started",
          progress: `${checkedCount}/${totalCount}`,
          latestDaysBefore: cat.suggestedTiming.latestDaysBefore,
          isOverdue,
          estimatedCost: cat.estimatedCost,
          nextUncheckedItem: cat.checklistItems.find(
            (item) => !checklistProgress[`${cat.id}_${item.id}`]
          )?.title,
        };
      });
  };

  // 컨텍스트 업데이트
  useEffect(() => {
    const completedCategories = Object.entries(categoryStatuses)
      .filter(([, status]) => status === "completed")
      .map(([id]) => id);

    const inProgressCategories = Object.entries(categoryStatuses)
      .filter(([, status]) => status === "in_progress")
      .map(([id]) => id);

    const urgentCategories = getUrgentCategories();

    setContext({
      weddingDate: weddingDate
        ? new Date(weddingDate).toISOString().split("T")[0]
        : undefined,
      role: role || undefined,
      budget: {
        total: totalBudget || undefined,
        spent: getTotalSpent() || undefined,
        remaining: totalBudget ? totalBudget - getTotalSpent() : undefined,
      },
      completedCategories,
      inProgressCategories,
      urgentCategories,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weddingDate, categoryStatuses, checklistProgress, totalBudget, getTotalSpent, setContext]);

  // 메시지 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 표시할 메시지 (환영 메시지 포함)
  const displayMessages: Message[] =
    messages.length === 0 ? [WELCOME_MESSAGE] : messages;

  // 마지막 AI 메시지의 버튼/빠른답변
  const lastAssistantMsg = [...displayMessages]
    .reverse()
    .find((m) => m.role === "assistant");

  const handleSend = (text: string) => {
    sendMessage(text, currentSender);
  };

  const handleClear = () => {
    clearChat();
    setShowClearConfirm(false);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* 헤더 액션 */}
      <div className="flex items-center justify-end gap-2 pb-4">
        {showClearConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-taupe-500">대화를 초기화할까요?</span>
            <button
              onClick={handleClear}
              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white hover:bg-red-600"
            >
              초기화
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="rounded-lg bg-ivory-200 px-3 py-1.5 text-xs text-noir-800 hover:bg-ivory-100"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-taupe-500 transition-colors hover:bg-ivory-100 hover:text-noir-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
            대화 초기화
          </button>
        )}
      </div>

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-platinum bg-ivory-50 p-4">
        <div className="space-y-4">
          {displayMessages.map((message) => (
            <div key={message.id}>
              <ChatBubble message={message} />

              {/* 버튼 옵션 */}
              {message.role === "assistant" && message.buttons && (
                <div className="mt-2">
                  <ButtonOptions
                    buttons={message.buttons}
                    onSelect={handleSend}
                  />
                </div>
              )}

              {/* 업체 카드 */}
              {message.role === "assistant" &&
                message.vendorCards &&
                message.vendorCards.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {message.vendorCards.map((vendor) => (
                      <VendorCardComponent
                        key={vendor.id}
                        vendor={vendor}
                      />
                    ))}
                  </div>
                )}
            </div>
          ))}

          {/* 타이핑 인디케이터 */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-platinum bg-white px-4 py-3">
                <Sparkles className="h-4 w-4 animate-pulse text-rose-500" />
                <div className="flex gap-1">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-taupe-400 [animation-delay:0ms]" />
                  <div className="h-2 w-2 animate-bounce rounded-full bg-taupe-400 [animation-delay:150ms]" />
                  <div className="h-2 w-2 animate-bounce rounded-full bg-taupe-400 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 입력 */}
      <ChatInput
        onSend={handleSend}
        disabled={isLoading}
        sender={currentSender}
        quickReplies={
          lastAssistantMsg?.quickReplies || [
            "진행 상황 보여줘",
            "뭐부터 해야 해?",
            "예산 현황",
            "오늘 할 일",
          ]
        }
      />
    </div>
  );
}
