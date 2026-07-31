"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, BookOpen, CalendarHeart, ListChecks, Sparkles } from "lucide-react";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { getAmoraActions, type AmoraActionItem } from "@/lib/amora/actions";
import { getImminentCategories } from "@/utils/imminentChecklist";
import { getEvents } from "@/utils/scheduleEvents";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import type { ProgressItem } from "@/types/database.types";

/**
 * 주차 카드 — 라운지 최상단의 "이번 주 한 장".
 * 보유 데이터의 정적 조합(LLM 비용 0): 할 일 3 + 가족 조율 원칙 + 견적 확인 + 아모라 한 줄.
 * 원칙: 제로 지식 유저에게 132개 체크리스트를 보여주지 않는다 — 이번 주 것만.
 */

interface WeeklyCardProps {
  weddingDate?: string | null;
  totalBudget?: number | null;
  progress: Record<string, ProgressItem>;
  actions?: AmoraActionItem[];
}

export default function WeeklyCard({ weddingDate, totalBudget, progress, actions }: WeeklyCardProps) {
  const data = useMemo(() => {
    const progressRecord = progress as Record<string, unknown>;
    const weddingDateObj = weddingDate ? new Date(weddingDate) : null;
    const validWedding =
      weddingDateObj && !Number.isNaN(weddingDateObj.getTime()) ? weddingDateObj : null;

    // 아모라 한 줄 — 1순위 오늘의 모멘트, 2순위 lifecycle 경고, 3순위 "오늘은 괜찮아"
    const dueCells = buildDueMomentCells({ weddingDate, progress: progressRecord });
    const topCell = dueCells[0];
    const plan = buildAmoraLifecyclePlan({ weddingDate, totalBudget, progress });
    const brief = topCell
      ? topCell.cellKind === "dAfter"
        ? `어제 ${topCell.momentLabel} 어땠어요? 아모라가 채팅에 안부를 남겨뒀어요.`
        : `${topCell.momentLabel}이(가) 다가와요 — 챙길 것들을 아모라가 채팅에 정리해뒀어요.`
      : plan.primaryAction.severity === "critical" || plan.primaryAction.severity === "warning"
        ? plan.primaryAction.title
        : "오늘은 급한 일 없어요. 이번 주 것만 천천히 보면 돼요.";
    const briefHref = topCell
      ? weddingPath("/chat")
      : plan.primaryAction.severity === "critical" || plan.primaryAction.severity === "warning"
        ? plan.primaryAction.href
        : null;

    // 이번 주 할 일 3 — 마감 임박 카테고리
    const events = getEvents(progressRecord);
    const imminent = getImminentCategories(progress, validWedding, events).slice(0, 3);

    // 아모라가 기억하는 다음 행동 (채팅 밖 첫 노출)
    const openActions = (actions ?? getAmoraActions(progressRecord))
      .filter((action) => action.status === "open")
      .slice(0, 3);

    return { brief, briefHref, imminent, openActions };
  }, [weddingDate, totalBudget, progress, actions]);

  return (
    <section className="rounded-[20px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_14px_36px_rgba(8,22,38,0.045)] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-[#eadfc9] bg-[#fff8ec] px-3.5 py-1.5 text-[12px] font-semibold text-[#9d6f36]">
          이번 주 한 장
          <CalendarHeart className="h-4 w-4" />
        </p>
      </div>

      {/* 아모라 한 줄 브리핑 — "할 일 없다"도 말해주는 사람이 있는 화면 */}
      <div className="mt-3 flex items-start gap-2.5 rounded-[14px] bg-[#f6f9f6] px-4 py-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#36534E]" />
        <p className="text-[14px] font-medium leading-[1.55] text-[#263832]">
          {data.brief}
          {data.briefHref && (
            <Link
              {...weddingLinkProps(data.briefHref)}
              className="ml-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#36534E] underline-offset-2 hover:underline"
            >
              보러 가기
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {/* 이번 주 할 일 */}
        <div className="rounded-[14px] border border-[#f0e9da] p-3.5">
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
            <ListChecks className="h-3.5 w-3.5" />
            이번 주 할 일
          </p>
          {data.imminent.length > 0 ? (
            <ul className="space-y-1.5">
              {data.imminent.map((category) => (
                <li key={category.key}>
                  <Link
                    {...weddingLinkProps("/schedule")}
                    className="group flex items-center justify-between gap-2 text-[13px] font-medium text-[#263832]"
                  >
                    <span className="truncate">{category.label}</span>
                    <span
                      className={`shrink-0 text-[11px] font-semibold ${
                        category.urgency === "overdue"
                          ? "text-[#c2410c]"
                          : category.urgency === "urgent"
                            ? "text-[#9d6f36]"
                            : "text-[#928980]"
                      }`}
                    >
                      {category.deadlineDaysLeft < 0
                        ? `${Math.abs(category.deadlineDaysLeft)}일 지남`
                        : `${category.deadlineDaysLeft}일 남음`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] font-medium leading-[1.5] text-[#928980]">
              {weddingDate
                ? "이번 주 마감 임박 항목이 없어요. 좋은 흐름이에요."
                : "결혼식 날짜를 입력하면 이번 주 할 일을 골라드려요."}
            </p>
          )}
        </div>

        {/* 가족 조율은 정답을 주는 페이지 대신 아모라 대화로 — 가족·지역마다 달라
            일반 안내보다 상황을 듣고 정리하는 쪽이 맞다(2026-07-25 페이지 제거). */}
        <Link
          {...weddingLinkProps("/chat")}
          className="group rounded-[14px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
        >
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
            <BookOpen className="h-3.5 w-3.5" />
            가족 이야기
          </p>
          <p className="text-[13px] font-semibold text-[#263832] group-hover:text-[#36534E]">
            정답보다 두 사람의 기준부터
          </p>
          <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[#928980]">
            두 가족에게 드릴 선물·서로 부를 호칭·방문 순서가 부담되면 아모라에게 상황을 말해보세요.
          </p>
        </Link>

        <Link
          {...weddingLinkProps("/community/quote-check")}
          className="group rounded-[14px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
        >
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
            <AlertTriangle className="h-3.5 w-3.5" />
            계약 전 확인
          </p>
          <p className="text-[13px] font-semibold text-[#263832] group-hover:text-[#36534E]">
            포함·불포함 항목을 서면으로
          </p>
          <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[#928980]">
            견적서에 없는 항목은 비용과 상한을 업체에 확인해요.
          </p>
        </Link>
      </div>

      {/* 아모라가 기억하는 다음 행동 — 채팅 밖 첫 노출 */}
      {data.openActions.length > 0 && (
        <div className="mt-3 rounded-[14px] border border-[#f0e9da] bg-[#fffdf7] p-3.5">
          <p className="mb-2 text-[12px] font-semibold text-[#5d6879]">아모라가 기억하는 다음 행동</p>
          <ul className="space-y-1.5">
            {data.openActions.map((action) => (
              <li key={action.id}>
                <Link
                  {...weddingLinkProps(action.href ? action.href.replace(/^\/wedding/, "") : "/chat")}
                  className="flex items-center justify-between gap-2 text-[13px] font-medium text-[#263832] hover:text-[#36534E]"
                >
                  <span className="truncate">{action.title}</span>
                  {action.dueDate && (
                    <span className="shrink-0 text-[11px] font-semibold text-[#928980]">{action.dueDate}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
