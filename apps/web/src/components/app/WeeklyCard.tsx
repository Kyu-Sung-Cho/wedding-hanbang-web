"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, BookOpen, CalendarHeart, ClipboardCheck, ListChecks, Sparkles } from "lucide-react";
import { CATEGORY_ETIQUETTE_MAP, ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { getImminentCategories } from "@/utils/imminentChecklist";
import { getEvents } from "@/utils/scheduleEvents";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import type { ProgressItem } from "@/types/database.types";

/**
 * 주차 카드 — 라운지 최상단의 "이번 주 한 장".
 * 보유 데이터의 정적 조합(LLM 비용 0): 할 일 3 + 예절 1 + 함정 1 + 아모라 한 줄.
 * 원칙: 제로 지식 유저에게 132개 체크리스트를 보여주지 않는다 — 이번 주 것만.
 */

interface WeeklyCardProps {
  weddingDate?: string | null;
  totalBudget?: number | null;
  progress: Record<string, ProgressItem>;
}

export default function WeeklyCard({ weddingDate, totalBudget, progress }: WeeklyCardProps) {
  const data = useMemo(() => {
    const progressRecord = progress as Record<string, unknown>;
    // 아모라 한 줄 — 정적 안내만 제공하며 선제 메시지 전송을 주장하지 않는다.
    const dueCells = buildDueMomentCells({ weddingDate, progress: progressRecord });
    const topCell = dueCells[0];
    const plan = buildAmoraLifecyclePlan({ weddingDate, totalBudget, progress });
    const brief = topCell
      ? topCell.cellKind === "dAfter"
        ? `어제로 등록한 ${topCell.momentLabel} 일정이 있어요. 실제로 진행했다면 아모라와 정리해보세요.`
        : `${topCell.momentLabel} 일정이 등록돼 있어요. 필요하면 아모라와 확인할 질문을 정리해보세요.`
      : plan.primaryAction.severity === "critical" || plan.primaryAction.severity === "warning"
        ? plan.primaryAction.title
        : "현재 기록에서 먼저 확인할 입력값은 없어요. 필요한 항목만 천천히 보면 돼요.";
    const briefHref = topCell
      ? weddingPath("/chat")
      : plan.primaryAction.severity === "critical" || plan.primaryAction.severity === "warning"
        ? plan.primaryAction.href
        : null;

    // 사용자가 직접 시작했지만 아직 일정을 정하지 않은 항목
    const events = getEvents(progressRecord);
    const imminent = getImminentCategories(progress, events).slice(0, 3);

    // 알아둘 예절 1 — 가장 임박한 카테고리의 예절 파트
    const topCategoryKey = imminent[0]?.key;
    const etiquettePartNumber = topCategoryKey
      ? CATEGORY_ETIQUETTE_MAP[topCategoryKey]?.[0]
      : undefined;
    const etiquettePart = ETIQUETTE_PARTS.find(
      (part) => part.number === (etiquettePartNumber ?? 21)
    );

    return { brief, briefHref, imminent, etiquettePart };
  }, [weddingDate, totalBudget, progress]);

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
        {/* 직접 시작한 항목의 일정 확인 */}
        <div className="rounded-[14px] border border-[#f0e9da] p-3.5">
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
            <ListChecks className="h-3.5 w-3.5" />
            시작한 항목의 일정 확인
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-[#928980]">업체 마감으로 계산한 값이 아니라, 직접 시작한 항목만 표시합니다.</p>
          {data.imminent.length > 0 ? (
            <ul className="space-y-1.5">
              {data.imminent.map((category) => (
                <li key={category.key}>
                  <Link
                    {...weddingLinkProps("/schedule")}
                    className="group flex items-center justify-between gap-2 text-[13px] font-medium text-[#263832]"
                  >
                    <span className="truncate">{category.label}</span>
                    <span className="shrink-0 text-[11px] font-semibold text-[#928980]">
                      일정 미설정
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] font-medium leading-[1.5] text-[#928980]">
              시작한 항목 중 일정 미등록 항목이 없어요.
            </p>
          )}
        </div>

        {/* 일반 예절 참고 */}
        {data.etiquettePart && (
          <Link
            {...weddingLinkProps(`/etiquette?part=${data.etiquettePart.number}`)}
            className="group rounded-[14px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
          >
            <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
              <BookOpen className="h-3.5 w-3.5" />
              일반 예절 참고
            </p>
            <p className="text-[13px] font-semibold text-[#263832] group-hover:text-[#36534E]">
              {data.etiquettePart.title}
            </p>
            <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[#928980]">
              {data.etiquettePart.subtitle}
            </p>
          </Link>
        )}

        {/* 원문이 있을 때만 질문을 정리한다. 별도 항목 입력이나 자동 판정은 하지 않는다. */}
        <Link
          {...weddingLinkProps("/chat")}
          className="group rounded-[14px] border border-[#f0e9da] p-3.5 transition-colors hover:border-[#dfc9c1]"
        >
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5d6879]">
            <ClipboardCheck className="h-3.5 w-3.5" />
            업체 원문 질문 정리
          </p>
          <p className="text-[13px] font-semibold text-[#263832] group-hover:text-[#36534E]">
            받은 문서가 있을 때만
          </p>
          <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[#928980]">
            견적서·계약서에 적힌 포함 범위와 변경·취소 조건을 업체에 다시 물을 문장으로 정리해요.
          </p>
        </Link>
      </div>

    </section>
  );
}
