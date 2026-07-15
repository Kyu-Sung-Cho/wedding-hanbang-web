"use client";

import { BarChart3, Clock, EyeOff, Lock, Users } from "lucide-react";
import type { PollWithOptions } from "@/types/community.types";

export default function PollDisplay({ poll }: { poll: PollWithOptions }) {
  // 투표 기능 자체가 종료됐으므로 과거의 결과 숨김 설정을 현재 UI에
  // 적용하지 않는다. 참여할 방법 없이 결과만 가리는 상태가 되기 때문이다.
  const showResults = true;
  const totalForBars = Math.max(1, poll.total_votes);

  return (
    <section className="mt-5 rounded-2xl border border-[#e5d8ca] bg-[#fbf8f2] p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#36534e]/10 text-[#36534e]">
          <BarChart3 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold leading-snug text-[#263832]">
            {poll.question}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-[#7d7166]">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {poll.total_voters.toLocaleString()}명 참여
            </span>
            {poll.is_anonymous && (
              <span className="inline-flex items-center gap-1">
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                익명
              </span>
            )}
            {poll.closes_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                과거 투표 기록
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#dfd5c8] bg-white px-3 py-2 text-xs leading-5 text-[#635b51]">
        <Lock className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        새 투표와 투표 변경은 종료되었습니다. 아래 내용은 과거 기록이며 현재 의견을 보장하지 않습니다.
      </div>

      <div className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const percent = showResults
            ? Math.round((option.vote_count / totalForBars) * 100)
            : null;
          return (
            <div key={option.id} className="relative overflow-hidden rounded-xl border border-[#e5d8ca] bg-white px-4 py-3">
              {percent !== null && (
                <div
                  className="absolute inset-y-0 left-0 bg-[#36534e]/8"
                  style={{ width: `${percent}%` }}
                  aria-hidden="true"
                />
              )}
              <div className="relative flex items-center justify-between gap-4">
                <span className="min-w-0 break-words text-sm font-medium text-[#263832]">
                  {option.label}
                </span>
                {percent !== null && (
                  <span className="shrink-0 text-xs font-semibold text-[#36534e]">
                    {percent}% · {option.vote_count.toLocaleString()}표
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
