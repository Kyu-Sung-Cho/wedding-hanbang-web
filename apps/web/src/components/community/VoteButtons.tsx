"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

interface VoteButtonsProps {
  count: number;
  userVote: 1 | -1 | null;
  onVote: (vote: 1 | 0) => void;
  compact?: boolean;
  isLoggedIn?: boolean;
}

export default function VoteButtons({
  count,
  userVote,
  onVote,
  isLoggedIn = false,
}: VoteButtonsProps) {
  const router = useRouter();
  const [isVoting, setIsVoting] = useState(false);
  const [optimisticVote, setOptimisticVote] = useState<1 | null | undefined>(undefined);
  const [optimisticDelta, setOptimisticDelta] = useState(0);

  const displayVote = optimisticVote !== undefined ? optimisticVote : userVote === 1 ? 1 : null;
  const displayCount = count + optimisticDelta;
  const isLiked = displayVote === 1;

  const handleLike = useCallback(async () => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    if (isVoting) return;

    const nextVote = isLiked ? null : 1;
    const delta = isLiked ? -1 : 1;
    setOptimisticVote(nextVote);
    setOptimisticDelta(delta);
    setIsVoting(true);

    try {
      await onVote(nextVote === null ? 0 : 1);
    } catch {
      setOptimisticVote(undefined);
      setOptimisticDelta(0);
    } finally {
      setIsVoting(false);
    }
  }, [isLiked, isLoggedIn, isVoting, onVote, router]);

  return (
    <button
      type="button"
      onClick={handleLike}
      disabled={isVoting}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm transition-colors disabled:opacity-50 ${
        isLiked ? "bg-[#fff8ec] text-[#C4967E]" : "text-[#5d6879] hover:bg-[#FAFAF8] hover:text-[#C4967E]"
      }`}
      aria-label="좋아요"
    >
      <Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
      {displayCount > 0 ? displayCount : "좋아요"}
    </button>
  );
}
