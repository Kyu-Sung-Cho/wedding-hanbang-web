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
          className={`p-0.5 transition-colors ${
            userVote === 1
              ? "text-[#FF4500]"
              : "text-[#878A8C] hover:text-[#FF4500]"
          }`}
          aria-label="추천"
        >
          <ArrowBigUp
            className="w-5 h-5"
            fill={userVote === 1 ? "#FF4500" : "none"}
          />
        </button>
        <span
          className={`text-xs font-bold min-w-[1.25rem] text-center ${
            userVote === 1
              ? "text-[#FF4500]"
              : userVote === -1
              ? "text-[#7193FF]"
              : "text-[#878A8C]"
          }`}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={() => handleVote(-1)}
          className={`p-0.5 transition-colors ${
            userVote === -1
              ? "text-[#7193FF]"
              : "text-[#878A8C] hover:text-[#7193FF]"
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
    <div className="flex flex-col items-center py-2 gap-0.5">
      <button
        type="button"
        onClick={() => handleVote(1)}
        className={`p-0.5 rounded-sm transition-colors ${
          userVote === 1
            ? "text-[#FF4500]"
            : "text-[#878A8C] hover:text-[#FF4500] hover:bg-[#FF4500]/10"
        }`}
        aria-label="추천"
      >
        <ArrowBigUp
          className="w-6 h-6"
          fill={userVote === 1 ? "#FF4500" : "none"}
        />
      </button>
      <span
        className={`text-xs font-bold min-w-[1.5rem] text-center ${
          userVote === 1
            ? "text-[#FF4500]"
            : userVote === -1
            ? "text-[#7193FF]"
            : "text-[#878A8C]"
        }`}
      >
        {count}
      </span>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        className={`p-0.5 rounded-sm transition-colors ${
          userVote === -1
            ? "text-[#7193FF]"
            : "text-[#878A8C] hover:text-[#7193FF] hover:bg-[#7193FF]/10"
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
