"use client";

import { useState } from "react";
import { CalendarDays, Check, Heart, Pencil, Plus } from "lucide-react";
import { MISSION_GROUPS } from "@/lib/amora/missions";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import type { ScheduleEvent } from "@/types/database.types";
import type { ImminentCategory } from "@/utils/imminentChecklist";
import {
  getScheduleEventAssigneeLabel,
  getScheduleEventStatus,
  type ScheduleEventAssigneeContext,
} from "@/utils/scheduleEvents";
import { daysUntilWedding } from "@/lib/utils/weddingDate";

const CATEGORY_LABELS: Record<string, string> = { ...PLANNING_CATEGORY_LABELS, general: "일반", etiquette: "결혼 예절 참고" };

type DatedEntry =
  | { kind: "event"; date: string; event: ScheduleEvent }
  | { kind: "wedding"; date: string };

interface Props {
  events: ScheduleEvent[];
  items: ImminentCategory[];
  today: string;
  weddingDate: string | null | undefined;
  assigneeContext: ScheduleEventAssigneeContext;
  onAddEvent: () => void;
  onEditEvent: (event: ScheduleEvent) => void;
  onCategoryClick: (key: string) => void;
  onScheduleClick: (key: string) => void;
  mutationBlocked: boolean;
}

function shortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function eventDistance(value: string): string {
  const days = daysUntilWedding(value);
  if (days === null) return "";
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  return days > 0 ? `${days}일 후` : `${Math.abs(days)}일 전`;
}

export default function PreparationTimeline({
  events, items, today, weddingDate, assigneeContext,
  onAddEvent, onEditEvent, onCategoryClick, onScheduleClick, mutationBlocked,
}: Props) {
  const [showAllNeeds, setShowAllNeeds] = useState(false);
  const undated = items.filter((item) => !item.hasScheduledEvent);
  const visibleUndated = showAllNeeds ? undated : undated.slice(0, 5);
  const plannedEvents = events
    .filter((event) => event.date >= today && getScheduleEventStatus(event) !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  const datedEntries: DatedEntry[] = plannedEvents.map((event) => ({ kind: "event", date: event.date, event }));
  if (weddingDate) datedEntries.push({ kind: "wedding", date: weddingDate });
  datedEntries.sort((a, b) => a.date.localeCompare(b.date)
    || (a.kind === "event" ? a.event.time ?? "" : "").localeCompare(b.kind === "event" ? b.event.time ?? "" : ""));
  const months = [...new Set(datedEntries.map((entry) => entry.date.slice(0, 7)))];

  return (
    <section aria-labelledby="preparation-timeline-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="preparation-timeline-heading" className="text-[15px] font-semibold text-[var(--amora-ink)]">준비 타임라인</h2>
        <button type="button" onClick={onAddEvent} disabled={mutationBlocked} className="flex items-center gap-1.5 rounded-full border border-[var(--amora-line)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-warm)] disabled:opacity-50">
          <Plus className="h-3 w-3" /> 일정 추가
        </button>
      </div>
      <p className="mb-5 text-[11px] leading-[1.8] text-[var(--amora-muted)]">등록한 일정과 날짜를 정할 항목을 함께 확인해요. 점선 카드는 아직 날짜가 필요해요.</p>
      {months.map((month) => (
        <div key={month} className="mb-6">
          <p className="mb-3 pl-[43px] text-[11px] font-medium text-[var(--amora-muted)]">{month.slice(0, 4)}년 {Number(month.slice(5))}월 · 등록 일정</p>
          <div className="relative space-y-3 before:absolute before:bottom-4 before:left-[14px] before:top-4 before:w-0.5 before:bg-[var(--amora-line)]">
            {datedEntries.filter((entry) => entry.date.startsWith(month)).map((entry) => {
              if (entry.kind === "wedding") {
                return (
                  <article key="wedding" className="relative flex items-start gap-3.5">
                    <span className="relative z-[1] mt-3 flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-full bg-[var(--amora-ink)] text-white"><Heart className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1 rounded-[13px] bg-[var(--amora-ink)] px-4 py-4 text-white">
                      <p className="planning-display text-[17px]">우리의 결혼식</p>
                      <p className="mt-1.5 text-[10.5px] text-white/75">{entry.date.slice(0, 4)}년 {shortDate(entry.date)} · {eventDistance(entry.date)}</p>
                    </div>
                  </article>
                );
              }
              const event = entry.event;
              const completed = getScheduleEventStatus(event) === "completed";
              return (
                <article key={`event:${event.id}`} className="relative flex items-start gap-3.5">
                  <span className={`relative z-[1] mt-3 flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-full ${completed ? "bg-[var(--amora-sage-pale)] text-[var(--amora-sage)]" : "bg-[var(--amora-rose-pale)] text-[var(--amora-rose-deep)]"}`}>{completed ? <Check className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}</span>
                  <div className="min-w-0 flex-1 rounded-[13px] border border-[var(--amora-line)] bg-white px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`break-words text-[13px] font-semibold ${completed ? "text-[var(--amora-muted)] line-through" : "text-[var(--amora-ink)]"}`}>{event.title}</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px] text-[var(--amora-muted)]"><span>{shortDate(event.date)}{event.time ? ` ${event.time}` : ""}</span>{event.categoryKey && <span>· {CATEGORY_LABELS[event.categoryKey] ?? event.categoryKey}</span>}<span>· {getScheduleEventAssigneeLabel(event.assignee, assigneeContext)}</span></p>
                        {event.completionCriteria && <p className="mt-1.5 break-words text-[10.5px] leading-[1.7] text-[var(--amora-soft)]">완료 기준 · {event.completionCriteria}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className="text-[10px] text-[var(--amora-rose-deep)]">{completed ? "완료" : eventDistance(event.date)}</span>
                        <button type="button" aria-label={`${event.title} 일정 수정`} onClick={() => onEditEvent(event)} disabled={mutationBlocked} className="flex items-center gap-1 rounded-full border border-[var(--amora-line)] px-2 py-1 text-[10px] text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-warm)] disabled:opacity-50"><Pencil className="h-2.5 w-2.5" /> 수정</button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}
      {visibleUndated.length > 0 && (
        <div className="mb-6">
          <p className="mb-3 pl-[43px] text-[11px] font-medium text-[var(--amora-muted)]">날짜 미정 · 날짜를 정할 항목</p>
          <div className="relative space-y-3 before:absolute before:bottom-4 before:left-[14px] before:top-4 before:w-0.5 before:bg-[var(--amora-line)]">
            {visibleUndated.map((item) => (
              <div key={item.key} className="relative flex items-start gap-3.5">
                <span className="relative z-[1] mt-3 flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--amora-rose)] bg-[var(--amora-bg)] text-[var(--amora-rose-deep)]"><CalendarDays className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1 rounded-[13px] border border-dashed border-[var(--amora-rose)]/60 bg-[var(--amora-warm)] px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => onCategoryClick(item.key)} className="min-w-0 text-left">
                      <span className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold text-[var(--amora-ink)]">{item.label}</span><span className="rounded-full bg-[var(--amora-rose-pale)] px-2 py-0.5 text-[9px] text-[var(--amora-rose-deep)]">날짜 필요</span></span>
                      <span className="mt-1.5 block text-[10.5px] leading-[1.7] text-[var(--amora-muted)]">{item.doneCount}/{item.totalCount} 완료 · {item.deadlineDaysLeft <= 0 ? "기본 확인 시점이 지난 항목" : `기본 확인 시점까지 ${item.deadlineDaysLeft}일`}</span>
                    </button>
                    <button type="button" onClick={() => onScheduleClick(item.key)} disabled={mutationBlocked} className="shrink-0 rounded-full border border-[var(--amora-line)] bg-white px-3 py-1.5 text-[10.5px] font-medium text-[var(--amora-soft)] transition-colors hover:border-[var(--amora-rose)] disabled:opacity-50">날짜 잡기</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {undated.length > 5 && <button type="button" onClick={() => setShowAllNeeds(!showAllNeeds)} aria-expanded={showAllNeeds} className="ml-[43px] mt-3 text-[11px] text-[var(--amora-rose-deep)] underline underline-offset-4">{showAllNeeds ? "간단히 보기" : `날짜가 필요한 ${undated.length}개 항목 모두 보기`}</button>}
        </div>
      )}
      {!weddingDate && !plannedEvents.length && !undated.length && <div className="rounded-[13px] border border-dashed border-[var(--amora-line)] bg-white px-5 py-8 text-center text-[12px] leading-[1.8] text-[var(--amora-muted)]">아직 등록한 일정이 없어요.<br />날짜가 정해진 일부터 일정에 추가해 보세요.</div>}
      <p className="mt-5 pl-[43px] text-[10px] leading-[1.8] text-[var(--amora-muted)]">기본 확인 시점은 준비를 돕는 예시이며, 업체나 가족과 정한 실제 날짜가 우선입니다.</p>
    </section>
  );
}

export function ScheduleStageSummary({ items }: { items: ImminentCategory[] }) {
  return (
    <section className="rounded-[16px] border border-[var(--amora-line)] bg-white px-[19px] py-[18px]">
      <h3 className="mb-3 text-[12px] font-semibold text-[var(--amora-ink)]">단계별 날짜 필요 현황</h3>
      <div className="divide-y divide-[var(--amora-line)]">
        {MISSION_GROUPS.map((stage) => {
          const categoryKeys: readonly string[] = stage.categoryKeys;
          const count = items.filter((item) => !item.hasScheduledEvent && categoryKeys.includes(item.key)).length;
          return <div key={stage.label} className="flex items-center justify-between py-2.5 text-[11px]"><span className="text-[var(--amora-soft)]">{stage.label}</span><span className={count ? "font-medium text-[var(--amora-rose-deep)]" : "text-[var(--amora-muted)]"}>{count ? `${count}건` : "—"}</span></div>;
        })}
      </div>
      <p className="mt-2 text-[10px] leading-[1.7] text-[var(--amora-muted)]">기본 확인 시점이 지났거나 60일 안에 다가오는 항목 기준입니다.</p>
    </section>
  );
}
