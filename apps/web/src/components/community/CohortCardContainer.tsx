"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CohortCard, { type CohortCardMemberPreview } from "./CohortCard";
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
      const res = await fetch("/api/community/cohort");
      if (res.ok) {
        const data = await res.json();
        setInfo({
          room: data.room ?? null,
          recentMembers: data.members ?? data.recentMembers ?? [],
          lastMessagePreview: data.lastMessage ?? data.lastMessagePreview ?? null,
        });
      } else {
        setInfo({ room: null });
      }
    } catch {
      setInfo({ room: null });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <div className="rounded-2xl bg-gradient-to-br from-[#795252] to-[#946a6a] h-32 animate-pulse" />;
  }

  return (
    <CohortCard
      room={info.room}
      recentMembers={info.recentMembers}
      lastMessagePreview={info.lastMessagePreview}
      onClick={() => {
        if (info.room) router.push(`/community/cohort/${info.room.id}`);
      }}
      onAssigned={(roomId) => {
        router.push(`/community/cohort/${roomId}`);
      }}
    />
  );
}
