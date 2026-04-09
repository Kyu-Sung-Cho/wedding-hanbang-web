"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown } from "lucide-react";

interface VoteButtonsProps {
  count: number;
  userVote: 1 | -1 | null;
  onVote: (vote: 1 | -1) => void;
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
  // 낙관적 UI 상태
  const [optimisticVote, setOptimisticVote] = useState<1 | -1 | null | undefined>(undefined);
  const [optimisticDelta, setOptimisticDelta] = useState(0);

  const displayVote = optimisticVote !== undefined ? optimisticVote : userVote;
  const displayCount = count + optimisticDelta;

  const handleVote = useCallback(
    async (vote: 1 | -1) => {
      if (!isLoggedIn) {
        router.push("/login");
        return;
      }
      if (isVoting) return;

      // 낙관적 업데이트 계산
      const prevVote = userVote;
      let newVote: 1 | -1 | null;
      let delta = 0;

      if (prevVote === vote) {
        newVote = null;
        delta = -vote;
      } else if (prevVote === null) {
        newVote = vote;
        delta = vote;
      } else {
        newVote = vote;
        delta = vote * 2;
      }

      setOptimisticVote(newVote);
      setOptimisticDelta(delta);
      setIsVoting(true);

      try {
        await onVote(vote);
      } catch {
        setOptimisticVote(undefined);
        setOptimisticDelta(0);
      } finally {
        setIsVoting(false);
      }
    },
    [isLoggedIn, isVoting, userVote, onVote, router]
  );

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => handleVote(1)}
        disabled={isVoting}
        className={`p-1 rounded-lg transition-all duration-200 hover:scale-105 ${
          displayVote === 1
            ? "text-[#C4967E]"
            : "text-[#B5ADA3] hover:text-[#C4967E]"
        } disabled:opacity-50`}
        aria-label="추천"
      >
        <ChevronUp
          className="w-5 h-5"
          strokeWidth={displayVote === 1 ? 2.5 : 2}
        />
      </button>
      <span
        className={`text-sm font-medium min-w-[1.25rem] text-center ${
          displayVote === 1
            ? "text-[#C4967E]"
            : displayVote === -1
            ? "text-[#878680]"
            : "text-[#1A1A1F]"
        }`}
      >
        {displayCount}
      </span>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        disabled={isVoting}
        className={`p-1 rounded-lg transition-all duration-200 hover:scale-105 ${
          displayVote === -1
            ? "text-[#878680]"
            : "text-[#B5ADA3] hover:text-[#878680]"
        } disabled:opacity-50`}
        aria-label="비추천"
      >
        <ChevronDown
          className="w-5 h-5"
          strokeWidth={displayVote === -1 ? 2.5 : 2}
        />
      </button>
    </div>
  );
}
