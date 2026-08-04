"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  BarChart3,
  Check,
  Lock,
  Users,
  EyeOff,
  Clock,
  CheckSquare,
  Loader2,
} from "lucide-react";
import type { PollWithOptions } from "@/types/community.types";
import { submitPollVoteIntent } from "@/lib/community/pollVoteIntent";

interface PollDisplayProps {
  poll: PollWithOptions;
  isAuthenticated: boolean;
  onLoginRequired: () => void;
  onChange?: (next: PollWithOptions) => void;
}

export default function PollDisplay({
  poll: initialPoll,
  isAuthenticated,
  onLoginRequired,
  onChange,
}: PollDisplayProps) {
  const [poll, setPoll] = useState<PollWithOptions>(initialPoll);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setPoll(initialPoll);
  }, [initialPoll]);

  // 마감 카운트다운 갱신 (1분 간격)
  useEffect(() => {
    if (!poll.closes_at) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [poll.closes_at]);

  const hasVoted = poll.user_voted_option_ids.length > 0;
  const isClosed = poll.closes_at ? new Date(poll.closes_at).getTime() <= now : false;
  // 집계 공개 여부는 클라이언트가 추측하지 않는다. 서버 actor projection이
  // 공개 가능한 경우에만 숫자를 반환하며, 숨김 상태는 반드시 null이다.
  const showResults = poll.results_hidden !== true
    && poll.total_voters !== null
    && poll.options.every((option) => option.vote_count !== null);
  const totalForBars = showResults ? Math.max(1, poll.total_voters ?? 0) : 1;

  const remaining = useMemo(() => {
    if (!poll.closes_at) return null;
    const ms = new Date(poll.closes_at).getTime() - now;
    if (ms <= 0) return "마감됨";
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    if (days > 0) return `${days}일 ${hours}시간 후 마감`;
    if (hours > 0) return `${hours}시간 ${minutes}분 후 마감`;
    return `${minutes}분 후 마감`;
  }, [poll.closes_at, now]);

  const handleVote = async (optionId: string) => {
    if (!isAuthenticated) {
      onLoginRequired();
      return;
    }
    if (isClosed) {
      setError("마감된 투표입니다.");
      return;
    }
    if (pendingOptionId) return;

    setError(null);
    setPendingOptionId(optionId);

    // 낙관적 업데이트 (단일 선택은 교체, 다중은 토글)
    const wasVoted = poll.user_voted_option_ids.includes(optionId);
    const desiredSelected = !wasVoted;
    const optimisticOptionIds = poll.allow_multiple
      ? wasVoted
        ? poll.user_voted_option_ids.filter((id) => id !== optionId)
        : [...poll.user_voted_option_ids, optionId]
      : wasVoted
        ? []
        : [optionId];

    const optimistic: PollWithOptions = {
      ...poll,
      user_voted_option_ids: optimisticOptionIds,
      options: poll.options.map((opt) => {
        if (opt.vote_count === null) return opt;
        const wasInOpt = poll.user_voted_option_ids.includes(opt.id);
        const isInOpt = optimisticOptionIds.includes(opt.id);
        if (wasInOpt && !isInOpt) return { ...opt, vote_count: Math.max(0, opt.vote_count - 1) };
        if (!wasInOpt && isInOpt) return { ...opt, vote_count: opt.vote_count + 1 };
        return opt;
      }),
      total_voters:
        poll.total_voters === null
          ? null
          : poll.allow_multiple
          ? optimisticOptionIds.length > 0
            ? Math.max(poll.total_voters, 1)
            : Math.max(0, poll.total_voters - 1)
          : optimisticOptionIds.length > 0
            ? Math.max(poll.total_voters, 1)
            : Math.max(0, poll.total_voters - 1),
    };
    setPoll(optimistic);

    try {
      const res = await submitPollVoteIntent({
        pollId: poll.id,
        optionId,
        selected: desiredSelected,
        pollVersion: poll.version,
        idempotencyKey: globalThis.crypto.randomUUID(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "투표에 실패했습니다.");
      }
      const data = (await res.json()) as { poll: PollWithOptions };
      setPoll(data.poll);
      onChange?.(data.poll);
    } catch (err) {
      // 롤백
      setPoll(poll);
      setError(err instanceof Error ? err.message : "투표에 실패했습니다.");
    } finally {
      setPendingOptionId(null);
    }
  };

  return (
    <section className="mt-5 bg-gradient-to-br from-[#fbf8f2] to-white border border-[#f0eeec] rounded-2xl p-5 shadow-[0_4px_20px_rgb(121,82,82,0.04)]">
      {/* 헤더 */}
      <div className="flex items-start gap-3 mb-4">
        <div className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-[#36534E]/10 text-[#36534E]">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-[#263832] leading-snug break-words">
            {poll.question}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#928980]">
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {poll.total_voters === null
                ? "참여 후 인원 공개"
                : `${poll.total_voters.toLocaleString()}명 참여`}
            </span>
            {poll.allow_multiple && (
              <span className="inline-flex items-center gap-1">
                <CheckSquare className="w-3.5 h-3.5" />
                중복 선택
              </span>
            )}
            {poll.is_anonymous && (
              <span className="inline-flex items-center gap-1">
                <EyeOff className="w-3.5 h-3.5" />
                익명
              </span>
            )}
            {remaining && (
              <span
                className={`inline-flex items-center gap-1 ${
                  isClosed ? "text-[#928980]" : "text-[#36534E] font-medium"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                {remaining}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 안내: 결과 가림 */}
      {!showResults && (
        <div className="mb-3 px-3 py-2 text-xs text-[#36534E] bg-[#fbf8f2] border border-[#f0eeec] rounded-lg flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" />
          투표하면 결과가 공개돼요. 다른 사람들의 의견에 영향받지 않게 먼저 골라주세요.
        </div>
      )}

      {/* 안내: 마감됨 */}
      {isClosed && (
        <div className="mb-3 px-3 py-2 text-xs text-[#635b51] bg-[#f6efe5] border border-[#e5d8ca] rounded-lg flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" />
          마감된 투표예요. 더 이상 변경할 수 없어요.
        </div>
      )}

      {/* 옵션 리스트 */}
      <div className="space-y-2">
        {poll.options.map((opt) => {
          const isSelected = poll.user_voted_option_ids.includes(opt.id);
          const voteCount = opt.vote_count;
          const optionResultsVisible = showResults && voteCount !== null;
          const percent = showResults && voteCount !== null
            ? Math.round((voteCount / totalForBars) * 100)
            : 0;
          const isPending = pendingOptionId === opt.id;
          const disabled = isClosed || isPending || pendingOptionId !== null;

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleVote(opt.id)}
              disabled={disabled}
              className={`group relative w-full overflow-hidden rounded-xl border transition-all duration-200 ${
                isSelected
                  ? "border-[#36534E] bg-white shadow-[0_2px_8px_rgb(121,82,82,0.12)]"
                  : "border-[#e5d8ca] bg-white hover:border-[#36534E] hover:bg-[#fbf8f2]"
              } ${disabled && !isPending ? "cursor-not-allowed opacity-90" : ""}`}
            >
              {/* 결과 막대 (배경) */}
              {optionResultsVisible && (
                <div
                  className={`absolute inset-y-0 left-0 transition-all duration-500 ease-out ${
                    isSelected ? "bg-[#36534E]/12" : "bg-[#f6efe5]"
                  }`}
                  style={{ width: `${percent}%` }}
                  aria-hidden
                />
              )}

              {/* 콘텐츠 */}
              <div className="relative flex items-center gap-3 px-3 py-3">
                {/* 옵션 이미지 */}
                {opt.image_url && (
                  <div className="shrink-0 relative w-12 h-12 rounded-lg overflow-hidden border border-[#f0eeec] bg-[#f6efe5]">
                    <Image
                      src={opt.image_url}
                      alt=""
                      fill
                      className="object-cover"
                    />
                  </div>
                )}

                {/* 체크박스/라디오 */}
                <div
                  className={`shrink-0 flex items-center justify-center transition-colors ${
                    poll.allow_multiple
                      ? "w-5 h-5 rounded border-2"
                      : "w-5 h-5 rounded-full border-2"
                  } ${
                    isSelected
                      ? "border-[#36534E] bg-[#36534E] text-white"
                      : "border-[#B5ADA3] bg-white"
                  }`}
                >
                  {isSelected &&
                    (poll.allow_multiple ? (
                      <Check className="w-3 h-3" strokeWidth={3} />
                    ) : (
                      <span className="block w-2 h-2 rounded-full bg-white" />
                    ))}
                </div>

                {/* 라벨 */}
                <div className="flex-1 text-left min-w-0">
                  <p
                    className={`text-base leading-snug break-words ${
                      isSelected ? "font-semibold text-[#263832]" : "font-medium text-[#263832]"
                    }`}
                  >
                    {opt.label}
                  </p>
                </div>

                {/* 결과 숫자 */}
                <div className="shrink-0 flex items-center gap-2 text-right">
                  {isPending && <Loader2 className="w-4 h-4 text-[#36534E] animate-spin" />}
                  {showResults && voteCount !== null && (
                    <>
                      <span className="text-xs text-[#928980] tabular-nums">
                        {voteCount.toLocaleString()}표
                      </span>
                      <span
                        className={`text-base font-semibold tabular-nums ${
                          isSelected ? "text-[#36534E]" : "text-[#635b51]"
                        }`}
                      >
                        {percent}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 에러 / 안내 */}
      {error && (
        <p className="mt-3 text-sm text-red-500">{error}</p>
      )}
      {!isAuthenticated && (
        <p className="mt-3 text-xs text-[#928980] text-center">
          로그인하면 투표하고 결과를 볼 수 있어요.
        </p>
      )}
      {hasVoted && !isClosed && !poll.allow_multiple && (
        <p className="mt-3 text-xs text-[#928980] text-center">
          선택을 다시 누르면 취소되고, 다른 옵션을 누르면 변경돼요.
        </p>
      )}
    </section>
  );
}
