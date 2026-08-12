"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, ChevronRight, Circle, Search } from "lucide-react";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import {
  getChecklistCounts,
  mergeChecklist,
  summarizePlanningChecklist,
} from "@/utils/checklist";
import type { WeddingJourneyStage } from "@hanbang/shared/constants";

type Filter = "all" | "active" | "completed" | "skipped";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "active", label: "준비 중" },
  { value: "completed", label: "완료" },
  { value: "skipped", label: "해당 없음" },
];

const TEMPLATE_ITEM_COUNT = CATEGORY_CHECKLISTS.reduce(
  (total, category) => total + category.items.length,
  0,
);

const STATUS_LABEL: Record<ProgressItem["status"], string> = {
  not_started: "시작 전",
  in_progress: "준비 중",
  completed: "완료",
  not_applicable: "해당 없음",
};

// 화면에서는 처음 준비하는 사람도 이해할 수 있는 말을 먼저 쓰되, 검색에서는
// 업체·가족과 실제로 주고받는 익숙한 용어도 놓치지 않는다.
const CATEGORY_SEARCH_ALIASES: Record<string, readonly string[]> = {
  foundation: ["결혼 결정", "공동 목표", "역할 분담", "가족 경계"],
  contracts: ["총예산", "계약서", "취소", "환불", "추가금", "소비자 보호"],
  meeting: ["상견례", "양가 부모님 만남"],
  venue: ["웨딩홀", "예식장"],
  studio: ["스튜디오", "웨딩촬영", "스드메"],
  dress: ["웨딩드레스", "예복", "턱시도", "스드메"],
  makeup: ["헤메", "메이크업", "스드메"],
  ring: ["웨딩링", "웨딩밴드", "예물"],
  hanbok: ["혼주 한복"],
  yedan: ["예단", "이바지"],
  honeymoon: ["허니문"],
  houseware: ["혼수", "가전", "가구"],
  housing: ["전세", "월세", "매매"],
  invitation: ["청첩장", "모바일 청첩장"],
  snap: ["본식 스냅", "스냅", "DVD", "본식 영상"],
  shoes: ["웨딩 슈즈"],
  bouquet: ["부케", "부토니에"],
  gift: ["답례품"],
  mc: ["사회자", "주례", "축가"],
  ham: ["함"],
  pyebaek: ["폐백"],
  guests: ["RSVP", "참석 여부", "교통", "숙박", "알레르기", "휠체어"],
  ceremony: ["식순", "큐시트", "리허설", "본식 당일", "축의금", "비상"],
  home_admin: ["전입신고", "확정일자", "임대차", "등기", "이사"],
  health_admin: ["혼인신고", "증인", "예방접종", "여행 건강", "서류"],
  aftercare: ["감사 인사", "정산", "반납", "사진 납품", "백업"],
  special_cases: ["국제결혼", "종교", "무예식", "재혼", "다문화", "접근성"],
};

const JOURNEY_STAGES: ReadonlyArray<{
  key: WeddingJourneyStage;
  label: string;
  description: string;
}> = [
  { key: "foundation", label: "1. 함께 기준 세우기", description: "두 사람의 결정과 가족 대화의 범위를 먼저 맞춰요." },
  { key: "contracts", label: "2. 예산·계약 보호", description: "총액, 추가금, 변경·환불, 증빙을 계약 전후로 확인해요." },
  { key: "home", label: "3. 신혼집·생활", description: "집과 물품뿐 아니라 권리 보호와 이사 행정까지 챙겨요." },
  { key: "vendors", label: "4. 주요 업체·상품", description: "예약부터 수령·반납·납품 조건까지 확인해요." },
  { key: "guests", label: "5. 초대·하객 운영", description: "참석 답변, 식이·접근성, 이동과 숙박을 함께 살펴요." },
  { key: "ceremony", label: "6. 식순·본식 당일", description: "큐시트, 담당자, 비상 대응과 귀중품 인계를 준비해요." },
  { key: "aftercare", label: "7. 결혼식 뒤 마감", description: "정산·감사·반납·사진과 행정 업무를 끝까지 닫아요." },
  { key: "optional", label: "8. 우리에게 필요한 선택", description: "전통·종교·국제·무예식처럼 해당되는 준비만 골라요." },
] as const;

function matchesFilter(status: ProgressItem["status"], filter: Filter) {
  if (filter === "all") return true;
  if (filter === "active") return status === "not_started" || status === "in_progress";
  if (filter === "completed") return status === "completed";
  return status === "not_applicable";
}

export default function ChecklistContent() {
  const { journey } = useAuthStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress],
  );
  const summary = useMemo(
    () => summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress),
    [progress],
  );

  const categories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return CATEGORY_CHECKLISTS.map((template) => {
      const saved = progress[template.key];
      const status = saved?.status ?? "not_started";
      const checklist = mergeChecklist(template.items, saved?.checklist, status);
      const counts = getChecklistCounts(checklist);
      const aliases = CATEGORY_SEARCH_ALIASES[template.key]?.join(" ") ?? "";
      const searchable = `${template.label} ${aliases} ${template.tip} ${checklist.map((item) => item.label).join(" ")}`
        .toLocaleLowerCase("ko-KR");
      return { template, status, counts, guide: mannersPartForCategory(template.key), searchable };
    }).filter(({ status, searchable }) =>
      matchesFilter(status, filter) && (!normalizedQuery || searchable.includes(normalizedQuery)),
    );
  }, [filter, progress, query]);

  const stageGroups = useMemo(() => JOURNEY_STAGES.map((stage) => ({
    ...stage,
    categories: categories.filter(({ template }) => template.journeyStage === stage.key),
  })).filter((stage) => stage.categories.length > 0), [categories]);

  const remaining = Math.max(0, summary.total - summary.done);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-7 sm:px-6 sm:py-10">
      <header className="border-b border-[#eadfc9] pb-7">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-[#9d6f36]">WEDDING CHECKLIST</p>
        <div className="mt-2 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <h1 className="text-[30px] font-semibold leading-tight text-[#071629] sm:text-[36px]">
              웨딩 체크리스트
            </h1>
            <p className="mt-2 max-w-[620px] text-[14px] leading-7 text-[#5d6879] sm:text-[15px]">
              결혼을 함께 결정하는 순간부터 결혼식 뒤 정착까지 {TEMPLATE_ITEM_COUNT}개 준비 항목을 담았어요. 지금 필요한 단계부터 하나씩 확인하세요.
            </p>
          </div>
          <div className="min-w-[240px] rounded-[18px] border border-[#eadfc9] bg-[#fffdf7] px-5 py-4">
            <div className="flex items-end justify-between gap-4">
              <span className="text-[13px] font-medium text-[#5d6879]">전체 진행률</span>
              <strong className="text-[30px] font-semibold leading-none text-[#36534e]">{summary.percent}%</strong>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-[#efe9dc]"
              role="progressbar"
              aria-label="전체 체크리스트 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={summary.percent}
            >
              <div className="h-full rounded-full bg-[#36534e] transition-[width]" style={{ width: `${summary.percent}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-[#7a8290]">
              {summary.done}개 완료 · {remaining}개 남음
              {summary.skippedCategories > 0 ? ` · ${summary.skippedCategories}개 분야 제외` : ""}
            </p>
            {summary.availableNewCategories > 0 && (
              <p className="mt-1.5 text-[11px] leading-4 text-[#8f6331]">
                새로 추가된 {summary.availableNewCategories}개 분야는 시작하면 진행률에 반영돼요.
              </p>
            )}
          </div>
        </div>
      </header>

      <section aria-label="체크리스트 찾기" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-[380px]">
          <span className="sr-only">체크리스트 검색</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a8290]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="예: 상견례, 계약 취소, 청첩장"
            className="h-11 w-full rounded-full border border-[#dcd4c3] bg-white pl-11 pr-4 text-[14px] text-[#071629] outline-none transition focus:border-[#9d6f36] focus:ring-2 focus:ring-[#c9a96e]/20"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="상태 필터">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold transition ${
                filter === item.value
                  ? "border-[#36534e] bg-[#36534e] text-white"
                  : "border-[#dcd4c3] bg-white text-[#5d6879] hover:border-[#9d6f36]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6" aria-labelledby="all-checklist-heading">
        <div className="flex items-center justify-between">
          <h2 id="all-checklist-heading" className="text-[19px] font-semibold text-[#071629]">전체 준비</h2>
          <span className="text-[13px] text-[#7a8290]">{categories.length}개 분야</span>
        </div>

        {stageGroups.length > 0 ? (
          <div className="mt-4 space-y-9">
            {stageGroups.map((stage) => (
              <section key={stage.key} aria-labelledby={`checklist-stage-${stage.key}`}>
                <h3 id={`checklist-stage-${stage.key}`} className="text-[16px] font-semibold text-[#243832]">
                  {stage.label}
                </h3>
                <p className="mt-1 text-[12.5px] leading-5 text-[#6b746f]">{stage.description}</p>
                <ul className="mt-3 grid gap-3 md:grid-cols-2">
                  {stage.categories.map(({ template, status, counts, guide }) => {
              const percent = status === "not_applicable" || counts.total === 0
                ? 0
                : Math.round((counts.done / counts.total) * 100);
              return (
                <li key={template.key} className="rounded-[18px] border border-[#e5dece] bg-white p-4 shadow-[0_8px_24px_rgba(6,26,52,0.035)]">
                  <Link
                    {...weddingLinkProps(`/checklist/${template.key}`)}
                    className="w-full rounded-[12px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50"
                    aria-label={`${template.label} 체크리스트 페이지 열기`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        status === "completed"
                          ? "bg-[#edf4eb] text-[#607044]"
                          : status === "not_applicable"
                            ? "bg-[#f1efeb] text-[#8b857c]"
                            : "bg-[#fff8ec] text-[#9d6f36]"
                      }`}>
                        {status === "completed" ? <CheckCircle2 className="h-5 w-5" /> : status === "not_applicable" ? <Ban className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <strong className="text-[16px] font-semibold text-[#071629]">{template.label}</strong>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#a59d91]" />
                        </span>
                        <span className="mt-1 block text-[13px] leading-5 text-[#5d6879]">
                          {status === "not_applicable"
                            ? "진행률과 알림에서 제외됨"
                            : template.introducedInVersion === 2 && !Object.prototype.hasOwnProperty.call(progress, template.key)
                              ? `새로 추가됨 · ${counts.total}개 · 시작하면 진행률 반영`
                              : `${counts.done}/${counts.total}개 완료 · ${STATUS_LABEL[status]}`}
                        </span>
                      </span>
                    </div>
                    {status !== "not_applicable" && (
                      <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#f0ece4]">
                        <span className="block h-full rounded-full bg-[#36534e]" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                  </Link>
                  {guide && (
                    <Link
                      {...weddingLinkProps(`/manners/${guide.slug}`)}
                      className="mt-3 inline-flex items-center text-[12px] font-semibold text-[#8f5150] underline decoration-[#8f5150]/35 underline-offset-4"
                    >
                      관련 예절 가이드 보기
                    </Link>
                  )}
                </li>
              );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-[18px] border border-dashed border-[#dcd4c3] bg-[#fffdf7] px-5 py-12 text-center">
            <p className="text-[14px] font-medium text-[#5d6879]">검색 조건에 맞는 준비 항목이 없어요.</p>
            <button type="button" onClick={() => { setFilter("all"); setQuery(""); }} className="mt-3 text-[13px] font-semibold text-[#9d6f36] underline underline-offset-4">
              전체 목록 보기
            </button>
          </div>
        )}
      </section>

    </div>
  );
}
