"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Search,
  SlidersHorizontal,
  UserRound,
  Users,
} from "lucide-react";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { CHECKLIST_ITEM_GUIDANCE } from "@hanbang/shared/constants";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import {
  buildPlanningChecklistInsights,
  calculateStatus,
  getChecklistCounts,
  hasChecklistReviewEvidence,
  mergeChecklist,
  summarizePlanningChecklist,
} from "@/utils/checklist";
import type {
  PlanningChecklistAssignee,
  PlanningChecklistInsight,
  PlanningChecklistItemState,
  WeddingJourneyStage,
} from "@hanbang/shared";

type CategoryFilter = "all" | "active" | "completed" | "skipped";
type View = "today" | "week" | "all";
type FocusFilter = "all" | "mine" | "partner" | "overdue";

const CATEGORY_FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "active", label: "준비 중" },
  { value: "completed", label: "완료" },
  { value: "skipped", label: "해당 없음" },
];

const VIEW_TABS: Array<{ value: View; label: string }> = [
  { value: "today", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "all", label: "전체" },
];

const FOCUS_FILTERS: Array<{ value: FocusFilter; label: string }> = [
  { value: "all", label: "모두" },
  { value: "mine", label: "내 일" },
  { value: "partner", label: "파트너" },
  { value: "overdue", label: "늦은 일" },
];

const STATE_LABEL: Record<PlanningChecklistItemState, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  waiting: "답변 기다림",
  blocked: "막힘",
  completed: "완료",
  not_applicable: "해당 없음",
};

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
  special_cases: ["국제결혼", "종교", "무예식", "재혼", "다문화", "접근성", "반려동물"],
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

function localIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function matchesCategoryFilter(status: ProgressItem["status"], filter: CategoryFilter) {
  if (filter === "all") return true;
  if (filter === "active") return status === "not_started" || status === "in_progress";
  if (filter === "completed") return status === "completed";
  return status === "not_applicable";
}

function assigneeLabel(
  assignee: PlanningChecklistAssignee | null | undefined,
  viewer: { id: string; name: string } | null,
  partner: { id: string; name: string } | null,
) {
  if (!assignee) return "담당 미정";
  if (assignee.kind === "couple") return "둘이 함께";
  if (assignee.kind === "external") return assignee.label;
  if (assignee.profileId === viewer?.id) return `${viewer.name || "나"} (나)`;
  if (assignee.profileId === partner?.id) return `${partner.name || "파트너"} (파트너)`;
  return "연결된 구성원";
}

function dueLabel(item: PlanningChecklistInsight) {
  if (item.daysUntilDue === undefined) return "날짜 미정";
  if (item.daysUntilDue < 0) return `${Math.abs(item.daysUntilDue)}일 지남`;
  if (item.daysUntilDue === 0) return "오늘까지";
  return `${item.daysUntilDue}일 남음`;
}

function FocusList({
  items,
  heading,
  emptyMessage,
  viewer,
  partner,
}: {
  items: PlanningChecklistInsight[];
  heading: string;
  emptyMessage: string;
  viewer: { id: string; name: string } | null;
  partner: { id: string; name: string } | null;
}) {
  return (
    <section aria-labelledby="checklist-focus-heading" className="mt-5">
      <div className="flex items-center justify-between gap-4">
        <h2 id="checklist-focus-heading" className="text-[20px] font-semibold text-[#172a27]">{heading}</h2>
        <span className="text-[12.5px] text-[#747d78]">{items.length}개</span>
      </div>
      {items.length > 0 ? (
        <ol className="mt-3 divide-y divide-[#e6dfd3] border-y border-[#e6dfd3] bg-white">
          {items.map((item) => (
            <li key={`${item.categoryKey}-${item.itemId}`}>
              <Link
                {...weddingLinkProps(`/checklist/${item.categoryKey}#task-${item.itemId}`)}
                className="group grid min-h-[78px] gap-2 px-2 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-[#8f6331]">{item.categoryLabel}</span>
                  <strong className="mt-1 block text-[14.5px] font-semibold leading-6 text-[#243832] group-hover:text-[#36534e]">{item.label}</strong>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[#6c7671]">
                    <span className={item.state === "blocked" ? "font-semibold text-[#a15445]" : undefined}>{STATE_LABEL[item.state]}</span>
                    <span>{assigneeLabel(item.assignee, viewer, partner)}</span>
                    {item.dueDateSource === "suggested" && <span>기본 일정 제안</span>}
                  </span>
                </span>
                <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${
                  item.timing === "overdue"
                    ? "bg-[#fff0ec] text-[#a15445]"
                    : item.timing === "today"
                      ? "bg-[#fff4db] text-[#8f6331]"
                      : "bg-[#eef4ed] text-[#36534e]"
                }`}>
                  <Clock3 className="h-3.5 w-3.5" />
                  {dueLabel(item)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-3 rounded-[16px] border border-dashed border-[#d9d1c2] bg-[#fffdf8] px-5 py-9 text-center">
          <p className="text-[13.5px] font-medium text-[#5d6864]">{emptyMessage}</p>
          <p className="mt-1.5 text-[12px] leading-5 text-[#7a827e]">전체 보기에서 항목 기한과 담당자를 정하면 이곳에 자동으로 모여요.</p>
        </div>
      )}
    </section>
  );
}

export default function ChecklistContent() {
  const { journey, profile, partner } = useAuthStore();
  const [view, setView] = useState<View>("today");
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");

  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress],
  );
  const summary = useMemo(
    () => summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress),
    [progress],
  );
  const insights = useMemo(
    () => buildPlanningChecklistInsights(CATEGORY_CHECKLISTS, progress, {
      weddingDate: journey?.wedding_date,
      today: localIsoDate(),
      currentProfileId: profile?.id,
      guidance: CHECKLIST_ITEM_GUIDANCE,
      upcomingWindowDays: 7,
    }),
    [journey?.wedding_date, profile?.id, progress],
  );

  const focusedItems = useMemo(() => {
    const base = view === "today"
      ? [...insights.overdue, ...insights.today]
      : view === "week"
        ? [...insights.overdue, ...insights.today, ...insights.upcoming]
        : insights.all;
    return base.filter((item) => {
      if (
        view !== "all"
        && item.dueDateSource !== "personal"
        && !Object.prototype.hasOwnProperty.call(progress, item.categoryKey)
      ) return false;
      if (focusFilter === "mine") return item.assignee?.kind === "member" && item.assignee.profileId === profile?.id;
      if (focusFilter === "partner") return item.assignee?.kind === "member" && item.assignee.profileId === partner?.id;
      if (focusFilter === "overdue") return item.timing === "overdue";
      return true;
    });
  }, [focusFilter, insights, partner?.id, profile?.id, progress, view]);
  const reviewSuggestions = useMemo(
    () => focusedItems.length === 0 && view !== "all" ? insights.review.slice(0, 3) : [],
    [focusedItems.length, insights.review, view],
  );

  const categories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return CATEGORY_CHECKLISTS.map((template) => {
      const saved = progress[template.key];
      const checklist = mergeChecklist(template.items, saved?.checklist, saved?.status);
      const status = saved?.status === "not_applicable"
        ? "not_applicable"
        : calculateStatus(checklist);
      const counts = getChecklistCounts(checklist);
      const aliases = CATEGORY_SEARCH_ALIASES[template.key]?.join(" ") ?? "";
      const searchable = `${template.label} ${aliases} ${template.tip} ${checklist.map((item) => item.label).join(" ")}`
        .toLocaleLowerCase("ko-KR");
      return { template, status, counts, guide: mannersPartForCategory(template.key), searchable };
    }).filter(({ status, searchable }) =>
      matchesCategoryFilter(status, categoryFilter) && (!normalizedQuery || searchable.includes(normalizedQuery)),
    );
  }, [categoryFilter, progress, query]);

  const stageGroups = useMemo(() => JOURNEY_STAGES.map((stage) => ({
    ...stage,
    categories: categories.filter(({ template }) => template.journeyStage === stage.key),
  })).filter((stage) => stage.categories.length > 0), [categories]);

  const remaining = Math.max(0, summary.total - summary.done);
  const focusHeading = view === "today" ? "오늘 먼저 볼 일" : view === "week" ? "이번 주에 볼 일" : "모든 실행 항목";
  const focusEmpty = view === "today" ? "오늘까지로 정한 일이 없어요." : view === "week" ? "이번 주까지로 정한 일이 없어요." : "필터 조건에 맞는 일이 없어요.";

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-7 sm:px-6 sm:py-10">
      <header className="border-b border-[#eadfc9] pb-7">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-[#9d6f36]">WEDDING CHECKLIST</p>
        <div className="mt-2 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-[30px] font-semibold leading-tight text-[#071629] sm:text-[36px]">웨딩 체크리스트</h1>
            <p className="mt-2 max-w-[620px] text-[14px] leading-7 text-[#5d6879] sm:text-[15px]">
              결혼을 함께 결정하는 순간부터 결혼식 뒤 정착까지 {TEMPLATE_ITEM_COUNT}개 준비 항목을 담았어요. 오늘 할 일부터 차분히 닫아가세요.
            </p>
            <Link
              {...weddingLinkProps("/settings/wedding-profile")}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#d8c7ad] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#36534e] hover:border-[#36534e]"
            >
              <SlidersHorizontal className="h-4 w-4" />
              우리 상황 설정
            </Link>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:min-w-[470px]">
            <div className="border-l-2 border-[#c9a96e] bg-[#fffdf7] px-4 py-3.5">
              <div className="flex items-end justify-between gap-3">
                <span className="text-[12.5px] font-semibold text-[#5d6879]">준비 범위 검토</span>
                <strong className="text-[24px] font-semibold leading-none text-[#36534e]">{summary.coveragePercent}%</strong>
              </div>
              <p className="mt-2 text-[11.5px] leading-5 text-[#747d78]">{summary.reviewedCategories}/{CATEGORY_CHECKLISTS.length}개 분야 · {summary.unreviewedCategories}개 미검토</p>
            </div>
            <div className="border-l-2 border-[#55716a] bg-[#fffdf7] px-4 py-3.5">
              <div className="flex items-end justify-between gap-3">
                <span className="text-[12.5px] font-semibold text-[#5d6879]">실행 완료</span>
                <strong className="text-[24px] font-semibold leading-none text-[#36534e]">{summary.percent}%</strong>
              </div>
              <p className="mt-2 text-[11.5px] leading-5 text-[#747d78]">{summary.done}개 완료 · {remaining}개 남음</p>
            </div>
            <p className="sm:col-span-2 text-[11.5px] leading-5 text-[#8f6331]">
              아직 검토하지 않은 분야도 전체 완료율에 포함했어요. 필요 없는 분야와 항목은 직접 ‘해당 없음’으로 정하면 분모에서 빠집니다.
            </p>
          </div>
        </div>
      </header>

      <div className="mt-6 border-b border-[#e4ddd1]" role="tablist" aria-label="체크리스트 보기">
        <div className="flex gap-7">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={view === tab.value}
              onClick={() => setView(tab.value)}
              className={`relative min-h-11 pb-3 text-[14px] font-semibold ${view === tab.value ? "text-[#36534e]" : "text-[#7a827e]"}`}
            >
              {tab.label}
              {view === tab.value && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#36534e]" />}
            </button>
          ))}
        </div>
      </div>

      <section aria-label="실행 항목 필터" className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {FOCUS_FILTERS.filter((filter) => filter.value !== "partner" || partner).map((filter) => {
          const Icon = filter.value === "mine" ? UserRound : filter.value === "partner" ? Users : filter.value === "overdue" ? AlertCircle : CalendarDays;
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={focusFilter === filter.value}
              onClick={() => setFocusFilter(filter.value)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px] font-semibold ${focusFilter === filter.value ? "border-[#36534e] bg-[#36534e] text-white" : "border-[#dcd4c3] bg-white text-[#5d6879]"}`}
            >
              <Icon className="h-3.5 w-3.5" />{filter.label}
            </button>
          );
        })}
      </section>

      <FocusList
        items={focusedItems}
        heading={focusHeading}
        emptyMessage={focusEmpty}
        viewer={profile ? { id: profile.id, name: profile.name } : null}
        partner={partner ? { id: partner.id, name: partner.name } : null}
      />

      {reviewSuggestions.length > 0 && (
        <section aria-labelledby="checklist-review-heading" className="mt-6 border-t border-[#e4ddd1] pt-5">
          <h2 id="checklist-review-heading" className="text-[18px] font-semibold text-[#243832]">먼저 검토할 분야</h2>
          <p className="mt-1 text-[12.5px] leading-5 text-[#65706d]">이 분야들은 아직 우리에게 필요한지 확인하지 않았어요. 늦은 일로 보지 않고 범위부터 정해요.</p>
          <ul className="mt-3 divide-y divide-[#e7e0d5] border-y border-[#e7e0d5]">
            {reviewSuggestions.map((suggestion) => (
              <li key={suggestion.categoryKey}>
                <Link
                  {...weddingLinkProps(`/checklist/${suggestion.categoryKey}`)}
                  className="flex min-h-[58px] items-center justify-between gap-3 px-2 py-3 text-[13.5px] font-semibold text-[#243832] outline-none hover:text-[#36534e] focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50"
                >
                  <span>{suggestion.categoryLabel}</span>
                  <span className="shrink-0 text-[11.5px] font-medium text-[#8f6331]">필요 여부 보기</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "all" && (
        <>
          <section aria-label="체크리스트 찾기" className="mt-10 flex flex-col gap-3 border-t border-[#e4ddd1] pt-7 sm:flex-row sm:items-center sm:justify-between">
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
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="분야 상태 필터">
              {CATEGORY_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={categoryFilter === item.value}
                  onClick={() => setCategoryFilter(item.value)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold transition ${categoryFilter === item.value ? "border-[#36534e] bg-[#36534e] text-white" : "border-[#dcd4c3] bg-white text-[#5d6879] hover:border-[#9d6f36]"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-6" aria-labelledby="all-checklist-heading">
            <div className="flex items-center justify-between">
              <h2 id="all-checklist-heading" className="text-[19px] font-semibold text-[#071629]">전체 준비 분야</h2>
              <span className="text-[13px] text-[#7a8290]">{categories.length}개 분야</span>
            </div>

            {stageGroups.length > 0 ? (
              <div className="mt-4 space-y-9">
                {stageGroups.map((stage) => (
                  <section key={stage.key} aria-labelledby={`checklist-stage-${stage.key}`}>
                    <h3 id={`checklist-stage-${stage.key}`} className="text-[16px] font-semibold text-[#243832]">{stage.label}</h3>
                    <p className="mt-1 text-[12.5px] leading-5 text-[#6b746f]">{stage.description}</p>
                    <ul className="mt-3 grid gap-3 md:grid-cols-2">
                      {stage.categories.map(({ template, status, counts, guide }) => {
                        const percent = status === "not_applicable" || counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
                        const reviewed = hasChecklistReviewEvidence(progress[template.key]);
                        return (
                          <li key={template.key} className="border-b border-[#e5dece] bg-white px-2 py-4">
                            <Link
                              {...weddingLinkProps(`/checklist/${template.key}`)}
                              className="w-full rounded-[8px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50"
                              aria-label={`${template.label} 체크리스트 페이지 열기`}
                            >
                              <div className="flex items-start gap-3">
                                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${status === "completed" ? "bg-[#edf4eb] text-[#607044]" : status === "not_applicable" ? "bg-[#f1efeb] text-[#8b857c]" : "bg-[#fff8ec] text-[#9d6f36]"}`}>
                                  {status === "completed" ? <CheckCircle2 className="h-5 w-5" /> : status === "not_applicable" ? <Ban className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center justify-between gap-3">
                                    <strong className="text-[16px] font-semibold text-[#071629]">{template.label}</strong>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-[#a59d91]" />
                                  </span>
                                  <span className="mt-1 block text-[13px] leading-5 text-[#5d6879]">
                                    {status === "not_applicable" ? "진행률과 알림에서 제외됨" : `${counts.done}/${counts.total}개 완료 · ${STATUS_LABEL[status]}${reviewed ? "" : " · 아직 검토 전"}`}
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
                              <Link {...weddingLinkProps(`/manners/${guide.slug}`)} className="mt-3 inline-flex text-[12px] font-semibold text-[#8f5150] underline decoration-[#8f5150]/35 underline-offset-4">
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
                <button type="button" onClick={() => { setCategoryFilter("all"); setQuery(""); }} className="mt-3 text-[13px] font-semibold text-[#9d6f36] underline underline-offset-4">전체 목록 보기</button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
