"use client";

import { useState } from "react";
import type { InvitationGuestbook as GuestbookEntry } from "@/types/invitation.types";
import { Send } from "lucide-react";

interface Props {
  entries: GuestbookEntry[];
  colors: string[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

export default function InviteGuestbook({ entries, colors, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !message.trim()) return;
    setSubmitting(true);
    await onSubmit({ guest_name: name, message, password });
    setName("");
    setMessage("");
    setPassword("");
    setSubmitting(false);
  };

  return (
    <section className="py-12 px-6">
      <div className="animate-fade-in" style={{ animationDuration: "0.6s" }}>
        <h3 className="text-center text-[21px] tracking-[0.2em] uppercase mb-6" style={{ color: colors[0] }}>
          Guestbook
        </h3>

        {/* 입력 폼 */}
        <div className="p-4 rounded-2xl mb-4" style={{ background: `${colors[0]}08` }}>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름"
              className="flex-1 px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-[21px] placeholder:opacity-40 focus:outline-none"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              className="w-24 px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-[21px] placeholder:opacity-40 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="축하 메시지를 남겨주세요"
              rows={2}
              className="flex-1 px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-[21px] placeholder:opacity-40 focus:outline-none resize-none"
            />
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || !message.trim() || submitting}
              className="self-end px-4 py-2 rounded-lg text-white text-[21px] font-medium disabled:opacity-40"
              style={{ background: colors[0] }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 기존 방명록 */}
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="p-3 rounded-xl bg-white border border-black/[0.04] animate-fade-in"
              style={{ animationDuration: "0.3s" }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[21px] font-medium">{entry.guest_name}</span>
                <span className="text-[21px] opacity-30">
                  {new Date(entry.created_at).toLocaleDateString("ko-KR")}
                </span>
              </div>
              <p className="text-[21px] opacity-70 leading-relaxed">{entry.message}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
