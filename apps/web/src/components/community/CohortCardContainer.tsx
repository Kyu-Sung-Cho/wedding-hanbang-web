"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CohortCard, { type CohortCardMemberPreview } from "./CohortCard";
import { weddingPath } from "@/lib/weddingPaths";
import type { CohortRoom } from "@/types/community.types";
import { useUserScopedClientActor } from "@/components/common/UserScopedClientStateBoundary";

interface CohortInfo {
  room: CohortRoom | null;
  recentMembers?: CohortCardMemberPreview[];
  lastMessagePreview?: string | null;
}

export default function CohortCardContainer() {
  const actor = useUserScopedClientActor();
  const actorKey = actor.status === "ready" ? actor.actorKey : null;
  const router = useRouter();
  const [info, setInfo] = useState<CohortInfo>({ room: null });
  const [loading, setLoading] = useState(true);
  const [stateActorKey, setStateActorKey] = useState<string | null>(null);
  const currentInfo = actorKey !== null && stateActorKey === actorKey ? info : { room: null };
  const currentLoading = actorKey === null || stateActorKey !== actorKey || loading;

  useEffect(() => {
    if (!actorKey) return;
    const controller = new AbortController();
    let cancelled = false;
    let hasLoadedInfo = false;

    const load = async (): Promise<CohortRoom | null> => {
      const res = await fetch("/api/community/cohort", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (cancelled) return null;
      setInfo({
        room: data.room ?? null,
        recentMembers: data.members ?? data.recentMembers ?? [],
        lastMessagePreview: data.lastMessage ?? data.lastMessagePreview ?? null,
      });
      hasLoadedInfo = true;
      setStateActorKey(actorKey);
      return data.room ?? null;
    };

    void (async () => {
      try {
        // 1. 현재 가입된 방 조회
        const currentRoom = await load();
        if (cancelled || currentRoom) return;
        // 2. 미가입이면 wedding_date 기반 자동 매칭 시도 (silent)
        const res = await fetch("/api/community/cohort/auto-assign", {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data?.room_id) {
            // 자동 가입 성공 → 다시 조회해서 멤버/메시지 프리뷰 갱신
            await load();
          }
        }
      } catch {
        /* auto-assign 실패는 silent — UI에선 "동기방 가입하기" 버튼 그대로 노출 */
        if (!cancelled) {
          setInfo({ room: null });
          setStateActorKey(actorKey);
        }
      } finally {
        if (!cancelled) {
          if (!hasLoadedInfo) setInfo({ room: null });
          setStateActorKey(actorKey);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [actorKey]);

  if (currentLoading) {
    return <div className="rounded-xl bg-[#36534E] h-28 animate-pulse" />;
  }

  return (
    <CohortCard
      room={currentInfo.room}
      recentMembers={currentInfo.recentMembers}
      lastMessagePreview={currentInfo.lastMessagePreview}
      onClick={() => {
        if (currentInfo.room) router.push(weddingPath(`/community/cohort/${currentInfo.room.id}`));
      }}
      onAssigned={(roomId) => {
        router.push(weddingPath(`/community/cohort/${roomId}`));
      }}
    />
  );
}
