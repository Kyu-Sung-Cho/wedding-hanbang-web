"use client";

import { useState, useEffect } from "react";
import { Users, ChevronRight, Sparkles } from "lucide-react";
import { useToast } from "./Toast";
import type { CohortRoom, CommunityProfile } from "@/types/community.types";
import { normalizeCommunityAvatar } from "@/lib/community/avatar";

export interface CohortCardMemberPreview {
  id: string;
  user_id: string;
  profile?: CommunityProfile | null;
}

interface CohortCardProps {
  room: CohortRoom | null;
  recentMembers?: CohortCardMemberPreview[];
  lastMessagePreview?: string | null;
  onClick?: () => void;
  onAssigned?: (roomId: string) => void;
}

export default function CohortCard({
  room,
  recentMembers = [],
  lastMessagePreview,
  onClick,
  onAssigned,
}: CohortCardProps) {
  const { toast } = useToast();
  const [now, setNow] = useState<Date | null>(null);
  const [year, setYear] = useState<number>(2026);
  const [quarter, setQuarter] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const d = new Date();
    setNow(d);
    setYear(d.getFullYear());
    setQuarter(Math.ceil((d.getMonth() + 1) / 3));
  }, []);

  // 배정 플로우 — 분기의 첫 달로 전달
  async function handleAssign() {
    setLoading(true);
    const monthFromQuarter = (quarter - 1) * 3 + 1; // Q1→1, Q2→4, Q3→7, Q4→10
    try {
      const res = await fetch("/api/community/profile/wedding-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month: monthFromQuarter }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "동기방 배정에 실패했습니다.");
        return;
      }
      toast.success("동기방에 입장했어요");
      onAssigned?.(data.room_id);
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // 아직 배정 안된 상태 → CTA 카드
  if (!room) {
    return (
      <div className="rounded-xl border border-[#F0EFED] bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#36534E]" />
          <h3 className="font-serif text-base text-[#1A1A1F]">
            대략 언제쯤 결혼하시나요?
          </h3>
        </div>
        <p className="mb-2 text-xs leading-relaxed text-[#878680]">
          같은 분기에 결혼하는 동기들과 실시간으로 정보·가격·고민을 나눠보세요.
        </p>
        <p className="mb-4 text-[11px] leading-relaxed text-[#36534E]">
          ✨ 정확한 날짜 몰라도 OK — 대략적인 분기로 가입할 수 있어요. 나중에 변경 가능합니다.
        </p>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-full rounded-lg border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2.5 text-sm text-[#1A1A1F] outline-none focus:border-[#36534E] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23B5ADA3%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center]"
          >
            {[0, 1, 2].map((offset) => {
              const y = (now?.getFullYear() ?? year) + offset;
              return (
                <option key={y} value={y}>
                  {y}년
                </option>
              );
            })}
          </select>
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            className="w-full rounded-lg border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2.5 text-sm text-[#1A1A1F] outline-none focus:border-[#36534E] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23B5ADA3%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center]"
          >
            {[
              { v: 1, label: "1분기" },
              { v: 2, label: "2분기" },
              { v: 3, label: "3분기" },
              { v: 4, label: "4분기" },
            ].map((q) => (
              <option key={q.v} value={q.v}>
                {q.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleAssign}
          disabled={loading}
          className="w-full rounded-lg bg-[#36534E] px-4 py-3 text-sm font-medium text-white shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all disabled:opacity-60"
        >
          {loading ? "배정 중..." : "동기방 입장하기"}
        </button>
      </div>
    );
  }

  // 멤버 아바타
  const previewCount = Math.min(recentMembers.length, 5);
  const extraCount = Math.max(0, (room.member_count ?? 0) - previewCount);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-[#F0EFED] bg-[#36534E] p-5 text-left transition-all hover:border-[#36534E]/40 shadow-[0_4px_14px_0_rgba(6,26,52,0.15)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.2)]"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-serif text-base text-white">{room.name}</h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[#B5ADA3]">
            <Users className="h-3.5 w-3.5" />
            <span>{room.member_count}명 참여</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-[#878680] transition-transform group-hover:translate-x-0.5" />
      </div>

      {/* 멤버 아바타 row */}
      <div className="mb-3 flex items-center">
        <div className="flex -space-x-2">
          {recentMembers.slice(0, 5).map((m) => {
            const initial = m.profile?.nickname?.[0] ?? "?";
            const avatar = normalizeCommunityAvatar(m.profile?.avatar_url);
            return (
              <div
                key={m.id}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#36534E] bg-[#36534E] text-xs font-medium text-white"
              >
                {avatar ?? initial}
              </div>
            );
          })}
        </div>
        {extraCount > 0 && (
          <span className="ml-2 text-xs text-[#878680]">
            +{extraCount}명
          </span>
        )}
      </div>

      {/* 활동 표시 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B89785] opacity-70"></span>
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#B89785]"></span>
        </span>
        <span className="text-xs text-[#B89785]">
          지금 {Math.max(1, Math.min(room.member_count, previewCount || 1))}명
          활동 중
        </span>
      </div>

      {/* 최근 메시지 */}
      {lastMessagePreview && (
        <p className="truncate text-sm text-[#B5ADA3]">
          최근: {lastMessagePreview}
        </p>
      )}
    </button>
  );
}
