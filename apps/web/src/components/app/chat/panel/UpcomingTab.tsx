"use client";

import { useState, useEffect, useMemo } from "react";
import { CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { getImminentCategories, getCompletedImminentCategories } from "@/utils/imminentChecklist";
import { getEvents, getScheduleEventStatus } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { ymdInKst } from "@/lib/utils/kstDate";
import CollapsibleSection from "./CollapsibleSection";

const URGENCY_COLORS: Record<string, { badge: string; text: string }> = {
  overdue: { badge: "bg-[#9A6B62] text-white", text: "text-[#9A6B62]" },
  urgent: { badge: "bg-[#C4967E] text-white", text: "text-[#C4967E]" },
  soon: { badge: "bg-[#C9A96E] text-white", text: "text-[#C9A96E]" },
};

const CATEGORY_LABELS: Record<string, string> = {
  ...PLANNING_CATEGORY_LABELS,
  etiquette: "결혼 예절 참고",
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
  const weddingDateValue = journey?.wedding_date;
  const weddingDate = useMemo(
    () => (weddingDateValue ? new Date(weddingDateValue) : null),
    [weddingDateValue]
  );

  // hydration-safe: now는 클라이언트에서만 설정
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const imminentCategories = useMemo(
    () => getImminentCategories(progress, weddingDate),
    [progress, weddingDate]
  );

  const completedImminent = useMemo(
    () => getCompletedImminentCategories(progress, weddingDate),
    [progress, weddingDate]
  );

  // 같은 파일의 getDaysUntil 은 로컬 시간이라 맞다. 이 줄만 UTC 라서 한국 새벽에는
  // 지난 일정이 "1일 전" 라벨을 달고 다가오는 목록에 남았다.
  const todayStr = now ? ymdInKst(now) : "";
  const upcomingEvents: ScheduleEvent[] = useMemo(() => {
    if (!todayStr) return [];
    return getEvents(progress as Record<string, unknown>)
      .filter((e) => e.date >= todayStr && getScheduleEventStatus(e) === "planned")
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
          <div className="flex flex-col gap-2">
            {imminentCategories.map((item) => {
              const colors = URGENCY_COLORS[item.urgency];
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-3 py-2"
                >
                  <Clock className={`w-5 h-5 flex-shrink-0 ${colors.text}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base text-[var(--hb-text-strong)] font-medium truncate">
                        {item.label}
                      </span>
                      <span className="text-sm text-[var(--hb-text-muted)]">
                        {item.doneCount}/{item.totalCount}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${colors.badge}`}>
                    {item.deadlineDaysLeft <= 0
                      ? `기본 확인 시점에서 ${Math.abs(item.deadlineDaysLeft)}일 지남`
                      : `D-${item.deadlineDaysLeft}`}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--hb-text-muted)] py-2 text-center">
            {weddingDate
              ? "임박한 항목이 없습니다"
              // 어디서 설정하는지 안 알려주면 시키기만 하고 길은 안 낸 것이다.
              // 결혼 예정일을 고치는 자리는 설정 화면이다(`app/(app)/settings`).
              : "설정 > 결혼 예정일을 입력하면 곧 확인할 항목을 여기에 모아드려요"}
          </p>
        )}
      </CollapsibleSection>

      {/* 완료된 임박 항목 */}
      <CollapsibleSection
        title="완료된 항목"
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
                  <span className="text-base text-[var(--hb-text-strong)] font-medium truncate block">
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
          <p className="text-sm text-[var(--hb-text-muted)] py-2 text-center">
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
          <div className="flex flex-col gap-2">
            {upcomingEvents.map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-3 py-2"
              >
                <CalendarDays className="w-5 h-5 text-[#C9A96E] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-base text-[var(--hb-text-strong)] font-medium truncate block">
                    {evt.title}
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="w-3.5 h-3.5 text-[var(--hb-text-muted)]" />
                    <span className="text-sm text-[var(--hb-text-muted)]">
                      {formatEventDate(evt.date)}
                    </span>
                    {evt.categoryKey && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[#C9A96E]/10 text-[#C9A96E]">
                        {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-sm text-[var(--hb-text-muted)] flex-shrink-0">
                  {now ? getDaysUntil(evt.date, now) : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--hb-text-muted)] py-2 text-center">
            예정된 일정이 없습니다
          </p>
        )}
      </CollapsibleSection>
    </div>
  );
}
