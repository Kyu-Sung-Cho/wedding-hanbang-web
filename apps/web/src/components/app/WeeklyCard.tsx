"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, BookOpen, CalendarHeart, ClipboardCheck, ListChecks, Sparkles } from "lucide-react";
import { CATEGORY_ETIQUETTE_MAP, ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import { QUOTE_CHECK_ITEMS } from "@/constants/hiddenCosts";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { getAmoraActions, type AmoraActionItem } from "@/lib/amora/actions";
import { getImminentCategories } from "@/utils/imminentChecklist";
import { getEvents } from "@/utils/scheduleEvents";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import type { ProgressItem } from "@/types/database.types";
import { parseLocalDateOnly } from "@hanbang/shared";

/**
 * 주차 카드 — 라운지 최상단의 "이번 주 한 장".
 * 보유 데이터의 정적 조합(LLM 비용 0): 할 일 3 + 예절 1 + 함정 1 + 아모라 한 줄.
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
    const validWedding = weddingDate ? parseLocalDateOnly(weddingDate) : null;

    // 아모라 한 줄 — 정적 안내만 제공하며 선제 메시지 전송을 주장하지 않는다.
    const dueCells = buildDueMomentCells({ weddingDate, progress: progressRecord });
    const topCell = dueCells[0];
    const plan = buildAmoraLifecyclePlan({ weddingDate, totalBudget, progress });
    const brief = topCell
      ? topCell.cellKind === "dAfter"
        ? `어제 ${topCell.momentLabel} 어땠어요? 필요하면 지금 아모라와 정리해보세요.`
        : `${topCell.momentLabel}이(가) 다가와요 — 지금 아모라와 확인할 질문을 정리해보세요.`
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

    // 알아둘 예절 1 — 가장 임박한 카테고리의 예절 파트
    const topCategoryKey = imminent[0]?.key;
    const etiquettePartNumber = topCategoryKey
      ? CATEGORY_ETIQUETTE_MAP[topCategoryKey]?.[0]
      : undefined;
    const etiquettePart = ETIQUETTE_PARTS.find(
      (part) => part.number === (etiquettePartNumber ?? 21)
    );

    // 추가비용 확인 질문 1 — 발생률이나 필수성을 추정하지 않고 계약 확인 질문만 노출한다.
    const trapCategory =
      topCategoryKey === "studio" || topCategoryKey === "dress" || topCategoryKey === "makeup"
        ? topCategoryKey
        : "common";
    const trap =
      QUOTE_CHECK_ITEMS.find((item) => item.category === trapCategory) ??
      QUOTE_CHECK_ITEMS[0];

    // 아모라가 기억하는 다음 행동 (채팅 밖 첫 노출)
    const openActions = (actions ?? getAmoraActions(progressRecord))
      .filter((action) => action.status === "open")
      .slice(0, 3);

    return { brief, briefHref, imminent, etiquettePart, trap, openActions };
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
                : "예식일을 입력하면 이번 주 할 일을 골라드려요."}
            </p>
          )}
        </div>

        {/* 알아둘 예절 */}
        {data.etiquettePart && (
          <Link
            {...weddingLinkProps(`/etiquette?part=${data.etiquettePart.number}`)}
            className="group rounded-[14px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
          >
            <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
              <BookOpen className="h-3.5 w-3.5" />
              알아둘 예절
            </p>
            <p className="text-[13px] font-semibold text-[#263832] group-hover:text-[#36534E]">
              {data.etiquettePart.title}
            </p>
            <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[#928980]">
              {data.etiquettePart.subtitle}
            </p>
          </Link>
        )}

        {/* 추가비용 확인 질문 */}
        {data.trap && (
          <Link
            {...weddingLinkProps("/community/quote-check")}
            className="group rounded-[14px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
          >
            <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
              <ClipboardCheck className="h-3.5 w-3.5" />
              추가비용 확인
            </p>
            <p className="text-[13px] font-semibold text-[#263832] group-hover:text-[#36534E]">
              {data.trap.name}
            </p>
            <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[#928980]">
              {data.trap.checkQuestion}
            </p>
          </Link>
        )}
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
