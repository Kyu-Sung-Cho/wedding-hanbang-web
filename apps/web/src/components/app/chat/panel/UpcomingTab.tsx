"use client";

import { useState, useEffect, useMemo } from "react";
import { CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { getImminentCategories, getCompletedImminentCategories } from "@/utils/imminentChecklist";
import { getEvents } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import CollapsibleSection from "./CollapsibleSection";

const URGENCY_COLORS: Record<string, { badge: string; text: string }> = {
  overdue: { badge: "bg-[#9A6B62] text-white", text: "text-[#9A6B62]" },
  urgent: { badge: "bg-[#C4967E] text-white", text: "text-[#C4967E]" },
  soon: { badge: "bg-[#C9A96E] text-white", text: "text-[#C9A96E]" },
};

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례", venue: "예식장", studio: "스튜디오",
  dress: "드레스/턱시도", makeup: "메이크업", ring: "예물(반지)",
  hanbok: "한복", yedan: "예단", honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)", housing: "신혼집", invitation: "청첩장",
  snap: "본식스냅/영상", shoes: "웨딩구두", bouquet: "부케/꽃장식",
  gift: "답례품", mc: "사회/축가", ham: "함", pyebaek: "폐백",
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
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;
  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;

  // hydration-safe: now는 클라이언트에서만 설정
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  const imminentCategories = useMemo(
    () => getImminentCategories(progress, weddingDate),
    [progress, weddingDate]
  );

  const completedImminent = useMemo(
    () => getCompletedImminentCategories(progress, weddingDate),
    [progress, weddingDate]
  );

  const todayStr = now ? now.toISOString().slice(0, 10) : "";
  const upcomingEvents: ScheduleEvent[] = useMemo(() => {
    if (!todayStr) return [];
    return getEvents(progress as Record<string, unknown>)
      .filter((e) => e.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
  }, [progress, todayStr]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 임박 체크리스트 (미완료) */}
      <CollapsibleSection
        title="임박 체크리스트"
        count={imminentCategories.length}
        defaultOpen
      >
        {imminentCategories.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {imminentCategories.map((item) => {
              const colors = URGENCY_COLORS[item.urgency];
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-2.5 py-1.5"
                >
                  <Clock className={`w-3.5 h-3.5 flex-shrink-0 ${colors.text}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-noir-800 font-medium truncate">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-taupe-400">
                        {item.doneCount}/{item.totalCount}
                      </span>
                    </div>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${colors.badge}`}>
                    {item.deadlineDaysLeft <= 0
                      ? `${Math.abs(item.deadlineDaysLeft)}일 초과`
                      : `D-${item.deadlineDaysLeft}`}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-taupe-400 py-2 text-center">
            {weddingDate ? "임박한 항목이 없습니다" : "결혼 날짜를 설정하세요"}
          </p>
        )}
      </CollapsibleSection>

      {/* 완료된 임박 항목 */}
      <CollapsibleSection
        title="완료된 항목"
        count={completedImminent.length}
      >
        {completedImminent.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {completedImminent.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2.5 py-1.5 opacity-60"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-[#2E7D5A] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-noir-800 font-medium truncate block">
                    {item.label}
                  </span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 bg-[#2E7D5A] text-white">
                  완료
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-taupe-400 py-2 text-center">
            아직 완료된 임박 항목이 없습니다
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
          <div className="flex flex-col gap-1.5">
            {upcomingEvents.map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-2.5 py-1.5"
              >
                <CalendarDays className="w-3.5 h-3.5 text-[#C9A96E] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-noir-800 font-medium truncate block">
                    {evt.title}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-2.5 h-2.5 text-taupe-400" />
                    <span className="text-[10px] text-taupe-400">
                      {formatEventDate(evt.date)}
                    </span>
                    {evt.categoryKey && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-[#C9A96E]/10 text-[#C9A96E]">
                        {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-taupe-400 flex-shrink-0">
                  {now ? getDaysUntil(evt.date, now) : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-taupe-400 py-2 text-center">
            예정된 일정이 없습니다
          </p>
        )}
      </CollapsibleSection>
    </div>
  );
}
