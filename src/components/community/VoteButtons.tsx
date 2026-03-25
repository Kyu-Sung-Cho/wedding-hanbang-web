"use client";

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
  compact = false,
  isLoggedIn = false,
}: VoteButtonsProps) {
  function handleVote(vote: 1 | -1) {
    if (!isLoggedIn) {
      // 간단한 토스트 대체
      alert("로그인이 필요합니다.");
      return;
    }
    onVote(vote);
  }

  if (compact) {
    // 가로형 (댓글용)
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => handleVote(1)}
          className={`p-0.5 rounded transition-colors ${
            userVote === 1
              ? "text-[#C4967E]"
              : "text-[#B5ADA3] hover:text-[#C4967E]"
          }`}
          aria-label="추천"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <span
          className={`text-xs font-medium min-w-[1.25rem] text-center ${
            userVote === 1
              ? "text-[#C4967E]"
              : userVote === -1
              ? "text-slate-400"
              : "text-[#928980]"
          }`}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={() => handleVote(-1)}
          className={`p-0.5 rounded transition-colors ${
            userVote === -1
              ? "text-slate-400"
              : "text-[#B5ADA3] hover:text-slate-400"
          }`}
          aria-label="비추천"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // 세로형 (기본)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={() => handleVote(1)}
        className={`p-1 rounded-lg transition-colors ${
          userVote === 1
            ? "text-[#C4967E] bg-[#C4967E]/10"
            : "text-[#B5ADA3] hover:text-[#C4967E] hover:bg-[#C4967E]/5"
        }`}
        aria-label="추천"
      >
        <ChevronUp className="w-5 h-5" />
      </button>
      <span
        className={`text-sm font-medium min-w-[1.5rem] text-center ${
          userVote === 1
            ? "text-[#C4967E]"
            : userVote === -1
            ? "text-slate-400"
            : "text-[#928980]"
        }`}
      >
        {count}
      </span>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        className={`p-1 rounded-lg transition-colors ${
          userVote === -1
            ? "text-slate-400 bg-slate-100"
            : "text-[#B5ADA3] hover:text-slate-400 hover:bg-slate-50"
        }`}
        aria-label="비추천"
      >
        <ChevronDown className="w-5 h-5" />
      </button>
    </div>
  );
}
