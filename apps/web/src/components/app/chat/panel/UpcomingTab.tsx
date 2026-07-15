"use client";

import { useState, useEffect, useMemo } from "react";
import { CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { getImminentCategories, getCompletedImminentCategories } from "@/utils/imminentChecklist";
import { getEvents } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import { formatLocalDateOnly } from "@hanbang/shared";
import CollapsibleSection from "./CollapsibleSection";

const REFERENCE_COLORS = { badge: "bg-[#fff8ec] text-[#9d6f36]", text: "text-[#9d6f36]" };

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례", venue: "예식장", studio: "스튜디오",
  dress: "드레스/턱시도", makeup: "메이크업", ring: "예물(반지)",
  hanbok: "한복", yedan: "예단", honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)", housing: "신혼집", invitation: "청첩장",
  snap: "본식스냅/영상", shoes: "웨딩구두", bouquet: "부케/꽃장식",
  gift: "답례품", mc: "사회/축가", ham: "함", pyebaek: "폐백",
  etiquette: "예절가이드",
};

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`;
}

function getDaysUntil(dateStr: string, now: Date): string {
  const diff = Math.ceil(
    (new Date(dateStr + "T00:00:00").getTime() - now.getTime()) /
      (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff < 0) return `${Math.abs(diff)}일 전`;
  return `${diff}일 후`;
}

export default function UpcomingTab() {
  const { journey } = useAuthStore();
  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress]
  );
  // hydration-safe: now는 클라이언트에서만 설정
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const imminentCategories = useMemo(
    () => getImminentCategories(progress),
    [progress]
  );

  const completedImminent = useMemo(
    () => getCompletedImminentCategories(progress),
    [progress]
  );

  const todayStr = now ? formatLocalDateOnly(now) : "";
  const upcomingEvents: ScheduleEvent[] = useMemo(() => {
    if (!todayStr) return [];
    return getEvents(progress as Record<string, unknown>)
      .filter((e) => e.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
  }, [progress, todayStr]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 사용자가 직접 시작한 일정 미등록 항목 */}
      <CollapsibleSection
        title="시작한 항목의 일정 확인"
        count={imminentCategories.length}
        defaultOpen
      >
        {imminentCategories.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="pb-1 text-center text-xs leading-relaxed text-taupe-400">
              업체 마감으로 계산한 값이 아닙니다. 날짜가 필요한 경우에만 내 일정에 추가하세요.
            </p>
            {imminentCategories.map((item) => {
              const colors = REFERENCE_COLORS;
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-3 py-2"
                >
                  <Clock className={`w-5 h-5 flex-shrink-0 ${colors.text}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base text-noir-800 font-medium truncate">
                        {item.label}
                      </span>
                      <span className="text-sm text-taupe-400">
                        {item.doneCount}/{item.totalCount}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${colors.badge}`}>
                    일정 미설정
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-taupe-400 py-2 text-center">
            시작한 항목 중 일정 미등록 항목이 없습니다
          </p>
        )}
      </CollapsibleSection>

      {/* 완료한 참고 항목 */}
      <CollapsibleSection
        title="완료한 참고 항목"
        count={completedImminent.length}
      >
        {completedImminent.length > 0 ? (
          <div className="flex flex-col gap-2">
            {completedImminent.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-3 py-2 opacity-60"
              >
                <CheckCircle2 className="w-5 h-5 text-[#2E7D5A] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-base text-noir-800 font-medium truncate block">
                    {item.label}
                  </span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-[#2E7D5A] text-white">
                  완료
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-taupe-400 py-2 text-center">
            아직 완료한 참고 항목이 없습니다
          </p>
        )}
      </CollapsibleSection>

      {/* 다가오는 이벤트 */}
      <CollapsibleSection
        title="다가오는 이벤트"
        count={upcomingEvents.length}
        defaultOpen
      >
        {upcomingEvents.length > 0 ? (
          <div className="flex flex-col gap-2">
            {upcomingEvents.map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-3 py-2"
              >
                <CalendarDays className="w-5 h-5 text-[#C9A96E] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-base text-noir-800 font-medium truncate block">
                    {evt.title}
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="w-3.5 h-3.5 text-taupe-400" />
                    <span className="text-sm text-taupe-400">
                      {formatEventDate(evt.date)}
                    </span>
                    {evt.categoryKey && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[#C9A96E]/10 text-[#C9A96E]">
                        {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-sm text-taupe-400 flex-shrink-0">
                  {now ? getDaysUntil(evt.date, now) : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-taupe-400 py-2 text-center">
            예정된 일정이 없습니다
          </p>
        )}
      </CollapsibleSection>
    </div>
  );
}
