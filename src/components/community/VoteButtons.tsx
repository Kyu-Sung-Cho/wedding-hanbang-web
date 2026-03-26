"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowBigUp, ArrowBigDown } from "lucide-react";

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
  compact = false,
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
        // 같은 버튼 다시 누르면 취소
        newVote = null;
        delta = -vote;
      } else if (prevVote === null) {
        // 투표 없는 상태에서 새 투표
        newVote = vote;
        delta = vote;
      } else {
        // 반대 투표로 변경
        newVote = vote;
        delta = vote * 2;
      }

      setOptimisticVote(newVote);
      setOptimisticDelta(delta);
      setIsVoting(true);

      try {
        await onVote(vote);
      } catch {
        // 실패 시 원복
        setOptimisticVote(undefined);
        setOptimisticDelta(0);
      } finally {
        setIsVoting(false);
      }
    },
    [isLoggedIn, isVoting, userVote, onVote, router]
  );

  if (compact) {
    // 가로형 (댓글용)
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => handleVote(1)}
          disabled={isVoting}
          className={`p-1 rounded-lg transition-all duration-200 active:scale-110 ${
            displayVote === 1
              ? "text-[#FF4500] bg-[#FFF1EE]"
              : "text-[#6B7280] hover:text-[#FF4500] hover:bg-[#FFF1EE]"
          } disabled:opacity-50`}
          aria-label="추천"
        >
          <ArrowBigUp
            className="w-5 h-5"
            fill={displayVote === 1 ? "#FF4500" : "none"}
          />
        </button>
        <span
          className={`text-sm min-w-[1.25rem] text-center ${
            displayVote === 1
              ? "text-[#FF4500] font-semibold"
              : displayVote === -1
              ? "text-[#7193FF] font-semibold"
              : "text-[#6B7280] font-bold"
          }`}
        >
          {displayCount}
        </span>
        <button
          type="button"
          onClick={() => handleVote(-1)}
          disabled={isVoting}
          className={`p-1 rounded-lg transition-all duration-200 active:scale-110 ${
            displayVote === -1
              ? "text-[#7193FF] bg-[#EEF1FF]"
              : "text-[#6B7280] hover:text-[#7193FF] hover:bg-[#EEF1FF]"
          } disabled:opacity-50`}
          aria-label="비추천"
        >
          <ArrowBigDown
            className="w-5 h-5"
            fill={displayVote === -1 ? "#7193FF" : "none"}
          />
        </button>
      </div>
    );
  }

  // 세로형 (기본 - Reddit 스타일)
  return (
    <div className="flex flex-col items-center py-2 gap-1">
      <button
        type="button"
        onClick={() => handleVote(1)}
        disabled={isVoting}
        className={`p-1 rounded-lg transition-all duration-200 active:scale-110 ${
          displayVote === 1
            ? "text-[#FF4500] bg-[#FFF1EE]"
            : "text-[#6B7280] hover:text-[#FF4500] hover:bg-[#FFF1EE]"
        } disabled:opacity-50`}
        aria-label="추천"
      >
        <ArrowBigUp
          className="w-6 h-6"
          fill={displayVote === 1 ? "#FF4500" : "none"}
        />
      </button>
      <span
        className={`text-sm font-semibold min-w-[1.5rem] text-center ${
          displayVote === 1
            ? "text-[#FF4500] font-semibold"
            : displayVote === -1
            ? "text-[#7193FF] font-semibold"
            : "text-[#6B7280] font-bold"
        }`}
      >
        {displayCount}
      </span>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        disabled={isVoting}
        className={`p-1 rounded-lg transition-all duration-200 active:scale-110 ${
          displayVote === -1
            ? "text-[#7193FF] bg-[#EEF1FF]"
            : "text-[#6B7280] hover:text-[#7193FF] hover:bg-[#EEF1FF]"
        } disabled:opacity-50`}
        aria-label="비추천"
      >
        <ArrowBigDown
          className="w-6 h-6"
          fill={displayVote === -1 ? "#7193FF" : "none"}
        />
      </button>
    </div>
  );
}
