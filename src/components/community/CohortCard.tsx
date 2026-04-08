"use client";

import { useState } from "react";
import { Users, ChevronRight, Sparkles, Calendar } from "lucide-react";
import { useToast } from "./Toast";
import type { CohortRoom, CommunityProfile } from "@/types/community.types";

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
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);

  // 배정 플로우
  async function handleAssign() {
    setLoading(true);
    try {
      const res = await fetch("/api/community/profile/wedding-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month }),
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
      <div className="rounded-2xl border border-[#F0EFED] bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#C4967E]" />
          <h3 className="font-serif text-base text-[#1A1A1F]">
            결혼 예정일이 언제인가요?
          </h3>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-[#878680]">
          같은 달 결혼하는 동기들과 실시간으로 정보·가격·고민을 나눠보세요.
        </p>

        <div className="mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#B5ADA3]" />
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="flex-1 rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm text-[#1A1A1F] outline-none focus:border-[#C4967E]"
          >
            {[0, 1, 2].map((offset) => {
              const y = now.getFullYear() + offset;
              return (
                <option key={y} value={y}>
                  {y}년
                </option>
              );
            })}
          </select>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="flex-1 rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm text-[#1A1A1F] outline-none focus:border-[#C4967E]"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleAssign}
          disabled={loading}
          className="w-full rounded-xl bg-[#1A1A1F] px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
      className="group w-full rounded-2xl border border-[#F0EFED] bg-[#1A1A1F] p-5 text-left transition-all hover:border-[#C4967E]/40"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-serif text-base text-white">{room.name}</h3>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-[#B5ADA3]">
            <Users className="h-3 w-3" />
            <span>{room.member_count}명 참여</span>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-[#878680] transition-transform group-hover:translate-x-0.5" />
      </div>

      {/* 멤버 아바타 row */}
      <div className="mb-3 flex items-center">
        <div className="flex -space-x-2">
          {recentMembers.slice(0, 5).map((m) => {
            const initial = m.profile?.nickname?.[0] ?? "?";
            return (
              <div
                key={m.id}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#1A1A1F] bg-[#C4967E] text-[21px] font-medium text-white"
              >
                {m.profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.profile.avatar_url}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  initial
                )}
              </div>
            );
          })}
        </div>
        {extraCount > 0 && (
          <span className="ml-2 text-[21px] text-[#878680]">
            +{extraCount}명
          </span>
        )}
      </div>

      {/* 활동 표시 */}
      <div className="mb-2 flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#C9A96E] opacity-70"></span>
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#C9A96E]"></span>
        </span>
        <span className="text-[21px] text-[#C9A96E]">
          지금 {Math.max(1, Math.min(room.member_count, previewCount || 1))}명
          활동 중
        </span>
      </div>

      {/* 최근 메시지 */}
      {lastMessagePreview && (
        <p className="truncate text-xs text-[#B5ADA3]">
          최근: {lastMessagePreview}
        </p>
      )}
    </button>
  );
}
