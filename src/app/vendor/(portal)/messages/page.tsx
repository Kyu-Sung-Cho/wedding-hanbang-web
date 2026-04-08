"use client";

import { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, ArrowLeft, User, Loader2 } from "lucide-react";
import type { MessageThread, VendorMessage } from "@/types/vendor.types";

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "방금";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function VendorMessagesPage() {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<VendorMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 스레드 목록 가져오기
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/messages/threads");
        if (res.ok) {
          const data = await res.json();
          setThreads(data.threads ?? []);
        }
      } catch (err) {
        console.error("Fetch threads error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 메시지 가져오기
  useEffect(() => {
    if (!activeThread) return;
    const thread = threads.find((t) => t.customerId === activeThread);
    if (!thread) return;

    (async () => {
      try {
        const res = await fetch(`/api/messages?vendorId=${thread.vendorId}&customerId=${thread.customerId}`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages ?? []);
        }
      } catch (err) {
        console.error("Fetch messages error:", err);
      }
    })();
  }, [activeThread, threads]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !activeThread) return;
    const thread = threads.find((t) => t.customerId === activeThread);
    if (!thread) return;

    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: thread.vendorId,
          customerId: thread.customerId,
          content: newMessage.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
        setNewMessage("");
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setSending(false);
    }
  };

  const activeThreadData = threads.find((t) => t.customerId === activeThread);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden" style={{ height: "calc(100vh - 160px)" }}>
        <div className="flex h-full">
          {/* 스레드 목록 */}
          <div className={`w-[320px] border-r border-black/[0.04] flex flex-col max-md:w-full ${activeThread ? "max-md:hidden" : ""}`}>
            <div className="px-5 py-4 border-b border-black/[0.04]">
              <h2 className="font-serif-kr text-[21px] font-normal text-noir-800">고객 문의</h2>
              <p className="text-[38px] text-taupe-400 font-light mt-0.5">{threads.length}개 대화</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-5">
                  <MessageSquare className="w-10 h-10 text-taupe-400/20 mb-3" />
                  <p className="text-[23px] text-taupe-400">아직 문의가 없습니다</p>
                  <p className="text-[38px] text-taupe-400/70 font-light mt-1">고객이 문의를 보내면 여기에 표시됩니다</p>
                </div>
              ) : (
                threads.map((thread) => (
                  <button
                    key={thread.customerId}
                    onClick={() => setActiveThread(thread.customerId)}
                    className={`w-full flex items-start gap-3 px-5 py-4 border-b border-black/[0.02] hover:bg-ivory-50 transition-colors text-left ${
                      activeThread === thread.customerId ? "bg-ivory-warm" : ""
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-500/20 to-gold/20 flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-rose-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-[23px] font-medium text-noir-800 truncate">{thread.customerName}</p>
                        <span className="text-[23px] text-taupe-400 flex-shrink-0 ml-2">{formatTime(thread.lastMessageAt)}</span>
                      </div>
                      <p className="text-[38px] text-taupe-500 font-light truncate">{thread.lastMessage}</p>
                    </div>
                    {thread.unreadCount > 0 && (
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-500 text-white text-[25px] font-medium flex items-center justify-center">
                        {thread.unreadCount}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 메시지 영역 */}
          <div className={`flex-1 flex flex-col ${!activeThread ? "max-md:hidden" : ""}`}>
            {activeThread && activeThreadData ? (
              <>
                {/* 헤더 */}
                <div className="px-5 py-4 border-b border-black/[0.04] flex items-center gap-3">
                  <button onClick={() => setActiveThread(null)} className="md:hidden p-1 rounded-lg hover:bg-ivory-warm">
                    <ArrowLeft className="w-5 h-5 text-taupe-400" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-500/20 to-gold/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-rose-500" />
                  </div>
                  <div>
                    <p className="text-[23px] font-medium text-noir-800">{activeThreadData.customerName}</p>
                    <p className="text-[23px] text-taupe-400">고객</p>
                  </div>
                </div>

                {/* 메시지 */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.senderType === "vendor" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-[25px] ${
                        msg.senderType === "vendor"
                          ? "bg-noir-800 text-white rounded-br-sm"
                          : "bg-ivory-warm text-noir-800 rounded-bl-sm"
                      }`}>
                        <p>{msg.content}</p>
                        <p className={`text-[25px] mt-1 ${msg.senderType === "vendor" ? "text-white/50" : "text-taupe-400"}`}>
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* 입력 */}
                <div className="px-5 py-4 border-t border-black/[0.04]">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      placeholder="메시지를 입력하세요..."
                      className="flex-1 px-4 py-3 border border-platinum rounded-xl text-[25px] outline-none focus:border-rose-500 transition-colors"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!newMessage.trim() || sending}
                      className="w-11 h-11 rounded-xl bg-noir-800 text-white flex items-center justify-center hover:bg-noir-soft transition-colors disabled:opacity-50"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageSquare className="w-12 h-12 text-taupe-400/20 mx-auto mb-3" />
                  <p className="text-[23px] text-taupe-400">대화를 선택해주세요</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
