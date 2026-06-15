"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CohortCard, { type CohortCardMemberPreview } from "./CohortCard";
import { weddingPath } from "@/lib/weddingPaths";
import type { CohortRoom } from "@/types/community.types";

interface CohortInfo {
  room: CohortRoom | null;
  recentMembers?: CohortCardMemberPreview[];
  lastMessagePreview?: string | null;
}

export default function CohortCardContainer() {
  const router = useRouter();
  const [info, setInfo] = useState<CohortInfo>({ room: null });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/community/cohort", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setInfo({
          room: data.room ?? null,
          recentMembers: data.members ?? data.recentMembers ?? [],
          lastMessagePreview: data.lastMessage ?? data.lastMessagePreview ?? null,
        });
        return data.room ?? null;
      }
      setInfo({ room: null });
    } catch {
      setInfo({ room: null });
    } finally {
      setLoading(false);
    }
    return null;
  }

  useEffect(() => {
    // 1. 현재 가입된 방 조회
    load().then(async (currentRoom) => {
      // 2. 미가입이면 wedding_date 기반 자동 매칭 시도 (silent)
      if (currentRoom) return;
      try {
        const res = await fetch("/api/community/cohort/auto-assign", {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.room_id) {
            // 자동 가입 성공 → 다시 조회해서 멤버/메시지 프리뷰 갱신
            await load();
          }
        }
      } catch {
        /* auto-assign 실패는 silent — UI에선 "동기방 가입하기" 버튼 그대로 노출 */
      }
    });
  }, []);

  if (loading) {
    return <div className="rounded-xl bg-[#36534E] h-28 animate-pulse" />;
  }

  return (
    <CohortCard
      room={info.room}
      recentMembers={info.recentMembers}
      lastMessagePreview={info.lastMessagePreview}
      onClick={() => {
        if (info.room) router.push(weddingPath(`/community/cohort/${info.room.id}`));
      }}
      onAssigned={(roomId) => {
        router.push(weddingPath(`/community/cohort/${roomId}`));
      }}
    />
  );
}
