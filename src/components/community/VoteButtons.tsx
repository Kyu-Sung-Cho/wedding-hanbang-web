"use client";

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
  function handleVote(vote: 1 | -1) {
    if (!isLoggedIn) {
      alert("로그인이 필요합니다.");
      return;
    }
    onVote(vote);
  }

  if (compact) {
    // 가로형 (댓글용)
    return (
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => handleVote(1)}
          className={`p-1 rounded-md transition-all ${
            userVote === 1
              ? "text-[#FF4500] bg-[#FFF1EE]"
              : "text-[#6B7280] hover:text-[#FF4500] hover:bg-[#FFF1EE]"
          }`}
          aria-label="추천"
        >
          <ArrowBigUp
            className="w-5 h-5"
            fill={userVote === 1 ? "#FF4500" : "none"}
          />
        </button>
        <span
          className={`text-xs min-w-[1.25rem] text-center ${
            userVote === 1
              ? "text-[#FF4500] font-semibold"
              : userVote === -1
              ? "text-[#7193FF] font-semibold"
              : "text-[#6B7280] font-bold"
          }`}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={() => handleVote(-1)}
          className={`p-1 rounded-md transition-all ${
            userVote === -1
              ? "text-[#7193FF] bg-[#EEF1FF]"
              : "text-[#6B7280] hover:text-[#7193FF] hover:bg-[#EEF1FF]"
          }`}
          aria-label="비추천"
        >
          <ArrowBigDown
            className="w-5 h-5"
            fill={userVote === -1 ? "#7193FF" : "none"}
          />
        </button>
      </div>
    );
  }

  // 세로형 (기본 - Reddit 스타일)
  return (
    <div className="flex flex-col items-center py-2.5 gap-0.5">
      <button
        type="button"
        onClick={() => handleVote(1)}
        className={`p-1 rounded-md transition-all ${
          userVote === 1
            ? "text-[#FF4500] bg-[#FFF1EE]"
            : "text-[#6B7280] hover:text-[#FF4500] hover:bg-[#FFF1EE]"
        }`}
        aria-label="추천"
      >
        <ArrowBigUp
          className="w-6 h-6"
          fill={userVote === 1 ? "#FF4500" : "none"}
        />
      </button>
      <span
        className={`text-xs min-w-[1.5rem] text-center ${
          userVote === 1
            ? "text-[#FF4500] font-semibold"
            : userVote === -1
            ? "text-[#7193FF] font-semibold"
            : "text-[#6B7280] font-bold"
        }`}
      >
        {count}
      </span>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        className={`p-1 rounded-md transition-all ${
          userVote === -1
            ? "text-[#7193FF] bg-[#EEF1FF]"
            : "text-[#6B7280] hover:text-[#7193FF] hover:bg-[#EEF1FF]"
        }`}
        aria-label="비추천"
      >
        <ArrowBigDown
          className="w-6 h-6"
          fill={userVote === -1 ? "#7193FF" : "none"}
        />
      </button>
    </div>
  );
}
