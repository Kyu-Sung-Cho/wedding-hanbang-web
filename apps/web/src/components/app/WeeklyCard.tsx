"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, BookOpen, CalendarHeart, ListChecks } from "lucide-react";
import AmoraAvatar from "@/components/ui/AmoraAvatar";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS } from "@/components/ui/amoraActionStyles";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { getAmoraActions, type AmoraActionItem } from "@/lib/amora/actions";
import { guideLinkForCategory } from "@/lib/etiquette/guideLink";
import { getWeeklyImminentCategories } from "@/utils/imminentChecklist";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import type { ProgressItem } from "@/types/database.types";

/**
 * 주차 카드 — 라운지 최상단의 "이번 주 한 장".
 * 보유 데이터의 정적 조합(LLM 비용 0): 할 일 3 + 가족 조율 원칙 + 견적 확인 + 아모라 한 줄.
 * 원칙: 제로 지식 유저에게 체크리스트 전체를 보여주지 않는다 — 지금 볼 것만.
 *
 * 고르는 기준은 `getImminentCategories`이고 그 창은 **기본 확인 시점까지 60일**이다.
 * 일정 화면의 임박 목록과 같은 헬퍼를 쓴다. 그래서 화면 문구도 "이번 주"가 아니라
 * "곧 확인할"이라고 쓴다 — 60일 뒤 항목을 이번 주 할 일이라고 부르면, 바로 옆에
 * 붙는 "기본 확인 시점까지 55일"과 어긋난다. 창을 정말 이번 주로 좁히는 것은
 * 카드가 자주 비게 되는 제품 결정이라 여기서 하지 않았다.
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
    // 아모라 한 줄 — 1순위 오늘의 모멘트, 2순위 lifecycle 경고, 3순위 저장 정보 범위 안내
    const dueCells = buildDueMomentCells({ weddingDate, progress: progressRecord });
    const topCell = dueCells[0];
    const plan = buildAmoraLifecyclePlan({ weddingDate, totalBudget, progress });
    const brief = topCell
      ? topCell.cellKind === "dAfter"
        ? `지난 일정: ${topCell.momentLabel}. 기억해 둘 내용을 지금 정리할까요?`
        : `다가오는 일정: ${topCell.momentLabel}. 준비 항목을 지금 확인할까요?`
      : plan.primaryAction.severity === "critical" || plan.primaryAction.severity === "warning"
        ? plan.primaryAction.title
        : "현재 저장된 정보 기준으로 오늘 확인된 마감은 없어요. 등록하지 않은 일정과 계약은 포함되지 않아요.";
    const briefHref = topCell
      ? weddingPath(topCell.cellKind === "dAfter" ? "/chat" : "/schedule")
      : plan.primaryAction.severity === "critical" || plan.primaryAction.severity === "warning"
        ? plan.primaryAction.href
        : null;

    // 곧 확인할 분야 3 — 기본 확인 시점이 가까운 것.
    // 고르는 규칙은 `getWeeklyImminentCategories` 한 곳에 있다. 라운지 아래쪽
    // 「놓치기 쉬운 항목」이 **여기 나온 것을 빼야** 해서, 두 곳이 같은 함수를 본다.
    const imminent = getWeeklyImminentCategories(progress, weddingDate);

    // 알아둘 예절 — 가장 임박한 카테고리에 해당하는 파트가 있을 때만.
    // 없으면 null이고, 그 자리는 아래에서 가족 이야기 카드가 대신한다.
    const mannersPart = guideLinkForCategory(imminent[0]?.key);

    // 아모라가 기억하는 다음 행동 (채팅 밖 첫 노출)
    const openActions = (actions ?? getAmoraActions(progressRecord))
      .filter((action) => action.status === "open")
      .slice(0, 3);

    return { brief, briefHref, imminent, mannersPart, openActions };
  }, [weddingDate, totalBudget, progress, actions]);

  return (
    <section className="rounded-[6px] border border-[var(--hb-hairline)] bg-white/90 p-4 shadow-[var(--shadow-raised)] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--hb-accent-hover)]">
          이번 주 한 장
          <CalendarHeart className="h-4 w-4" />
        </p>
      </div>

      {/* 아모라 한 줄 브리핑 — 저장된 정보의 범위를 숨기지 않는다. */}
      <div className="mt-3 flex items-start gap-2.5 rounded-[6px] bg-[#f6f9f6] px-4 py-3">
        <AmoraAvatar sizeClassName="size-6" className="mt-0.5" />
        <p className="text-[14px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
          {data.brief}
          {data.briefHref && (
            <Link
              {...weddingLinkProps(data.briefHref)}
              className={/^\/(?:wedding\/)?chat(?:[?#]|$)/u.test(data.briefHref) ? `${AMORA_ACTION_CLASS} ml-2` : "ml-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--hb-text-strong)] underline-offset-2 hover:underline"}
            >
              {/^\/(?:wedding\/)?chat(?:[?#]|$)/u.test(data.briefHref) && <AmoraMark size={20} />}
              보러 가기
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {/* 곧 확인할 분야 */}
        <div className="rounded-[6px] border border-[#f0e9da] p-3.5">
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--hb-text-body)]">
            <ListChecks className="h-3.5 w-3.5" />
            곧 확인할 분야
          </p>
          {data.imminent.length > 0 ? (
            <ul className="space-y-1.5">
              {data.imminent.map((category) => (
                <li key={category.key}>
                  <Link
                    {...weddingLinkProps("/schedule")}
                    className="group flex items-center justify-between gap-2 text-[13px] font-medium text-[var(--hb-text-strong)]"
                  >
                    <span className="truncate">{category.label}</span>
                    <span
                      className={`shrink-0 text-[11px] font-semibold ${
                        category.urgency === "overdue"
                          ? "text-[#c2410c]"
                          : category.urgency === "urgent"
                            ? "text-[var(--hb-accent-hover)]"
                            : "text-[var(--hb-text-muted)]"
                      }`}
                    >
                      {category.deadlineDaysLeft < 0
                        ? `기본 확인 시점에서 ${Math.abs(category.deadlineDaysLeft)}일 지남`
                        : `기본 확인 시점까지 ${category.deadlineDaysLeft}일`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] font-medium leading-[1.5] text-[var(--hb-text-muted)]">
              {weddingDate
                ? "현재 저장된 일정 기준으로 곧 확인할 항목은 없어요. 등록하지 않은 일정은 포함되지 않아요."
                : "결혼식 날짜를 입력하면 곧 확인할 분야를 골라드려요."}
            </p>
          )}
        </div>

        {/* 알아둘 예절 — 임박한 카테고리에 맞는 파트가 있을 때만 그린다.
            없으면 가족 이야기 카드로 돌아간다. 2026-08-19에 레거시 25파트를 되살리면서
            덮이는 카테고리가 10개 → 19개로 늘었다. 출처 계약을 통과한 `/manners`를
            먼저 쓰고, 없을 때만 레거시로 내려간다(`guideLinkForCategory`). */}
        {data.mannersPart ? (
          <Link
            {...weddingLinkProps(data.mannersPart.href)}
            className="group rounded-[6px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
          >
            <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--hb-text-body)]">
              <BookOpen className="h-3.5 w-3.5" />
              알아둘 예절
            </p>
            <p className="text-[13px] font-semibold text-[var(--hb-text-strong)] group-hover:text-[var(--hb-text-strong)]">
              {data.mannersPart.title}
            </p>
            <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[var(--hb-text-muted)]">
              {data.mannersPart.subtitle}
            </p>
          </Link>
        ) : (
          /* 가족 조율은 정답을 주는 페이지 대신 아모라 대화로 — 가족·지역마다 달라
             일반 안내보다 상황을 듣고 정리하는 쪽이 맞다(2026-07-25 페이지 제거). */
          <Link
            {...weddingLinkProps("/chat")}
            className="group rounded-xl border border-[var(--hb-amora-line)] bg-[var(--hb-amora-surface)] p-3.5 transition-colors hover:bg-[var(--hb-amora-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2"
          >
            <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--hb-text-body)]">
              <AmoraMark className="h-3.5 w-3.5 text-[var(--hb-amora-ink)]" />
              가족 이야기
            </p>
            <p className="text-[13px] font-semibold text-[var(--hb-text-strong)] group-hover:text-[var(--hb-text-strong)]">
              정답보다 두 사람의 기준부터
            </p>
            <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[var(--hb-text-muted)]">
              두 가족에게 드릴 선물·서로 부를 호칭·방문 순서가 부담되면 아모라에게 상황을 말해보세요.
            </p>
          </Link>
        )}

        <Link
          {...weddingLinkProps("/community/quote-check")}
          className="group rounded-[6px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
        >
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--hb-text-body)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            계약 전 확인
          </p>
          <p className="text-[13px] font-semibold text-[var(--hb-text-strong)] group-hover:text-[var(--hb-text-strong)]">
            포함·불포함 항목을 서면으로
          </p>
          <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[var(--hb-text-muted)]">
            견적서에 없는 항목은 비용과 상한을 업체에 확인해요.
          </p>
        </Link>
      </div>

      {/* 아모라가 기억하는 다음 행동 — 채팅 밖 첫 노출 */}
      {data.openActions.length > 0 && (
        <div className="mt-3 rounded-[6px] border border-[#f0e9da] bg-[var(--hb-surface-page)] p-3.5">
          <p className="mb-2 text-[12px] font-semibold text-[var(--hb-text-body)]">아모라가 기억하는 다음 행동</p>
          <ul className="space-y-1.5">
            {data.openActions.map((action) => (
              <li key={action.id}>
                <Link
                  {...weddingLinkProps(action.href ? action.href.replace(/^\/wedding/, "") : "/chat")}
                  className={!action.href || /^\/(?:wedding\/)?chat(?:[?#]|$)/u.test(action.href) ? `${AMORA_ACTION_CLASS} w-full` : "flex items-center justify-between gap-2 text-[13px] font-medium text-[var(--hb-text-strong)] hover:text-[var(--hb-text-strong)]"}
                >
                  {(!action.href || /^\/(?:wedding\/)?chat(?:[?#]|$)/u.test(action.href)) && <AmoraMark size={20} />}
                  <span className="truncate">{action.title}</span>
                  {action.dueDate && (
                    <span className="shrink-0 text-[11px] font-semibold text-[var(--hb-text-muted)]">{action.dueDate}</span>
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
