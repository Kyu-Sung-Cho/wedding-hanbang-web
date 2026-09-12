"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Check, ChevronRight, Heart, Mail, Plane, Search, ShoppingBag, Video } from "lucide-react";

import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import Button from "@/components/ui/Button";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ICON_ACTION_CLASS } from "@/components/ui/amoraActionStyles";
import { FEATURE_SUMMARY_CLASS, SUMMARY_LABEL_CLASS, SUMMARY_VALUE_CLASS } from "@/components/ui/featureSummaryStyles";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { buildAmoraPreparationHref } from "@/lib/amora/preparationHandoff";
import { directionParticle } from "@/lib/korean/particles";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import { getChecklistCounts, mergeChecklist, summarizePlanningChecklist, resolveStatus, isStatusDeclared } from "@/utils/checklist";

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

// 화면의 묶음만 정의한다. 항목 ID와 저장 순서는 공유 체크리스트 원본을 유지한다.
const PREPARATION_STAGES = [
  { key: "family", label: "상견례 준비", icon: Heart, categoryKeys: ["greeting", "meeting"] },
  { key: "booking", label: "예산·업체 확정", icon: ShoppingBag, categoryKeys: ["venue", "studio", "dress", "makeup", "ring"] },
  { key: "guests", label: "청첩장·하객", icon: Mail, categoryKeys: ["invitation", "gift"] },
  { key: "ceremony", label: "촬영·본식 준비", icon: Video, categoryKeys: ["hanbok", "yedan", "snap", "shoes", "bouquet", "mc", "ham", "pyebaek"] },
  { key: "newlywed", label: "신혼여행·혼인신고", icon: Plane, categoryKeys: ["honeymoon", "houseware", "housing", "registration"] },
];

const PROGRESS_CLASS = "block w-full appearance-none overflow-hidden rounded-full border-0 bg-[var(--amora-low)] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-[var(--amora-low)] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[var(--amora-rose)] [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-[var(--amora-rose)]";
const COMPLETED_PROGRESS_CLASS = "block w-full appearance-none overflow-hidden rounded-full border-0 bg-[var(--amora-low)] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-[var(--amora-low)] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[var(--amora-sage)] [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-[var(--amora-sage)]";

const STATUS_LABEL: Record<ProgressItem["status"], string> = {
  not_started: "시작 전",
  in_progress: "준비 중",
  completed: "완료",
  not_applicable: "해당 없음",
};

// 화면에서는 처음 준비하는 사람도 이해할 수 있는 말을 먼저 쓰되, 검색에서는
// 업체·가족과 실제로 주고받는 익숙한 용어도 놓치지 않는다.
const CATEGORY_SEARCH_ALIASES: Record<string, readonly string[]> = {
  meeting: ["상견례", "양가 부모님 만남"],
  venue: ["웨딩홀", "예식장"],
  studio: ["스튜디오", "웨딩촬영", "스드메"],
  dress: ["웨딩드레스", "예복", "턱시도", "스드메"],
  makeup: ["헤메", "메이크업", "스드메"],
  ring: ["웨딩링", "웨딩밴드", "예물"],
  hanbok: ["혼주 한복"],
  yedan: ["예단"],
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
};

function matchesFilter(status: ProgressItem["status"], filter: Filter) {
  if (filter === "all") return true;
  if (filter === "active") return status === "not_started" || status === "in_progress";
  if (filter === "completed") return status === "completed";
  return status === "not_applicable";
}

export default function ChecklistContent() {
  const { journey } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCategory = searchParams.get("category");
  const validRequestedCategory = requestedCategory
    && CATEGORY_CHECKLISTS.some((category) => category.key === requestedCategory)
    ? requestedCategory
    : null;
  const [selectedCategory, setSelectedCategory] = useState(
    validRequestedCategory,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stageRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setSelectedCategory(validRequestedCategory);
  }, [validRequestedCategory]);

  const selectCategory = useCallback((categoryKey: string | null) => {
    setSelectedCategory(categoryKey);
    const params = new URLSearchParams(searchParams.toString());
    if (categoryKey) params.set("category", categoryKey);
    else params.delete("category");

    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress],
  );
  const summary = useMemo(
    () => summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress),
    [progress],
  );

  const allCategories = useMemo(() => {
    return CATEGORY_CHECKLISTS.map((template) => {
      const saved = progress[template.key];
      // 저장값을 그대로 쓰면 항목이 늘었을 때 `11/12개 완료 · 완료`가 된다 — 개수는
      // 병합본에서 세는데 상태만 낡은 값이기 때문이다. 항목 기록이 있으면 파생한다.
      const status = resolveStatus(template.items, saved);
      // 항목 기록 없이 분야만 완료로 표시된 경우다. 개수를 나란히 쓰면
      // `0/9개 완료 · 완료` 가 되어 고장난 것처럼 읽힌다.
      const declared = isStatusDeclared(saved);
      const checklist = mergeChecklist(template.items, saved?.checklist, status);
      const counts = getChecklistCounts(checklist);
      const aliases = CATEGORY_SEARCH_ALIASES[template.key]?.join(" ") ?? "";
      const guide = mannersPartForCategory(template.key);
      // 이 카드가 여는 예절 편의 제목도 검색 대상이다. 없을 때는 "이바지"처럼
      // 항목 라벨에 없는 말을 별칭에 억지로 박아야 했고, 그러다 엉뚱한 분야로
      // 보냈다 — 「이바지·답례품 예절」을 여는 것은 예단이 아니라 선물 분야다.
      const searchable = `${template.label} ${aliases} ${guide?.title ?? ""} ${template.tip} ${checklist.map((item) => `${item.label} ${item.note ?? ""}`).join(" ")}`
        .toLocaleLowerCase("ko-KR");
      return { template, status, counts, declared, guide, searchable };
    });
  }, [progress]);

  const categories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return allCategories.filter(({ status, searchable }) =>
      matchesFilter(status, filter) && (!normalizedQuery || searchable.includes(normalizedQuery)),
    );
  }, [allCategories, filter, query]);

  const stages = useMemo(() => PREPARATION_STAGES.map((stage) => {
    const members = stage.categoryKeys.flatMap((key) => allCategories.filter(({ template }) => template.key === key));
    return {
      ...stage,
      categories: stage.categoryKeys.flatMap((key) => categories.filter(({ template }) => template.key === key)),
      summary: summarizePlanningChecklist(members.map(({ template }) => template), progress),
      complete: members.every(({ status }) => status === "completed" || status === "not_applicable"),
    };
  }), [allCategories, categories, progress]);

  const currentStage = stages.findIndex((stage) => !stage.complete);

  const goToStage = (stageKey: string) => {
    setGrouped(true);
    window.requestAnimationFrame(() => {
      const section = stageRefs.current[stageKey];
      section?.scrollIntoView({ behavior: "auto", block: "start" });
      section?.focus({ preventScroll: true });
    });
  };

  const remaining = Math.max(0, summary.total - summary.done);

  const renderCategories = (items: typeof categories) => (
    <ul className="grid gap-[9px] md:grid-cols-2 md:gap-[14px] xl:grid-cols-3">
      {items.map(({ template, status, counts, declared, guide }) => {
        const amoraHref = buildAmoraPreparationHref({ kind: "checklist", categoryKey: template.key });
        const percent = status === "not_applicable" || counts.total === 0
          ? 0
          : Math.round((counts.done / counts.total) * 100);
        const completed = status === "completed";
        const statusClass = completed
          ? "text-[#33473a]"
          : status === "in_progress" ? "text-[var(--amora-rose-deep)]" : "text-[var(--amora-muted)]";

        return (
          <li key={template.key} className={`relative rounded-[13px] border border-[var(--amora-line)] transition-colors md:rounded-[14px] ${completed ? "bg-[var(--amora-warm)]" : "bg-white hover:border-[var(--amora-rose)]/60"}`}>
            <button
              type="button"
              onClick={() => selectCategory(template.key)}
              className="block h-full min-h-[93px] w-full rounded-[inherit] px-[15px] py-[14px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)] md:min-h-[112px] md:px-[18px] md:py-[17px]"
              aria-label={`${template.label} 체크리스트 열기`}
              aria-describedby={`checklist-status-${template.key}`}
            >
              <span className="flex items-start justify-between gap-2 md:min-h-11 md:pr-[84px]">
                <strong className="text-[13px] font-semibold leading-[1.4] text-[var(--amora-ink)] md:text-[14px]">{template.label}</strong>
                <ChevronRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[var(--amora-muted)] md:hidden" />
              </span>
              <span id={`checklist-status-${template.key}`} className="mt-[7px] flex items-center justify-between gap-2 text-[11px] leading-[1.5] text-[var(--amora-muted)] md:mt-[10px] md:text-[11.5px]">
                {status === "not_applicable" ? (
                  <><span>진행률과 알림에서 제외됨</span><span className="shrink-0">해당 없음</span></>
                ) : declared ? (
                  <><span className={`font-semibold ${statusClass}`}>{STATUS_LABEL[status]}{directionParticle(STATUS_LABEL[status])} 표시함</span><span className="shrink-0">항목은 확인 전</span></>
                ) : (
                  <><span>{counts.done}/{counts.total}개 완료</span><span className={`shrink-0 ${statusClass} ${status === "not_started" ? "" : "font-semibold"}`}>{STATUS_LABEL[status]}</span></>
                )}
              </span>
              {status !== "not_applicable" && !declared ? (
                <progress value={percent} max={100} aria-label={`${template.label} 항목 완료율`} className={`mt-[7px] h-1 md:mt-[9px] ${completed ? COMPLETED_PROGRESS_CLASS : PROGRESS_CLASS}`} />
              ) : (
                <span aria-hidden="true" className={`mt-[7px] block h-1 rounded-full md:mt-[9px] ${declared && completed ? "bg-[var(--amora-sage)]" : "bg-[var(--amora-low)]"}`} />
              )}
            </button>
            <div className="absolute right-[14px] top-[14px] hidden items-center gap-1 md:flex">
              {guide && (
                <Link
                  {...weddingLinkProps(`/manners/${guide.slug}`)}
                  aria-label={`${template.label} 관련 예절 가이드 보기`}
                  title={`${template.label} 관련 예절 가이드 보기`}
                  className="inline-flex size-8 items-center justify-center rounded-[7px] bg-[var(--amora-low)] text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-rose-pale)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)]"
                >
                  <BookOpen aria-hidden="true" className="size-[14px]" strokeWidth={1.7} />
                </Link>
              )}
              {amoraHref && (
                <Link
                  {...weddingLinkProps(amoraHref)}
                  aria-label={`${template.label} 아모라에 질문하기`}
                  title={`${template.label} 아모라에 질문하기`}
                  className={AMORA_ICON_ACTION_CLASS}
                >
                  <AmoraMark className="size-5" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="mx-auto w-full max-w-[1440px] px-[18px] pb-8 pt-4 md:pt-[30px] lg:px-9">
      <header className={`${FEATURE_SUMMARY_CLASS} mb-4 px-4 py-3.5 md:mb-[18px] md:flex md:items-center md:justify-between md:gap-6 md:px-6 md:py-5`}>
        <div className="hidden md:block">
          <h2 className="planning-display text-[26px] leading-[1.4] text-[var(--amora-ink)]">웨딩 체크리스트</h2>
          <p className="mt-1.5 max-w-[640px] text-[13px] leading-[1.7] text-[var(--amora-muted)]">
            첫인사부터 혼인신고까지 {TEMPLATE_ITEM_COUNT}개 항목. 지금 필요한 것부터 하나씩 확인하세요.
          </p>
        </div>
        <div className="min-w-0 md:min-w-[220px] md:shrink-0 md:text-right">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 md:justify-end">
            <span className={SUMMARY_LABEL_CLASS}>전체 진행</span>
            <strong className={SUMMARY_VALUE_CLASS}>{summary.percent}<span className="ml-0.5 text-sm">%</span></strong>
          </div>
          <progress
            className={`mt-2.5 h-1.5 ${PROGRESS_CLASS}`}
            value={summary.percent}
            max={100}
            role="progressbar"
            aria-label="전체 체크리스트 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.percent}
          />
          <p className="mt-2 text-[12px] leading-[1.6] text-[#624A3C]">
            {summary.done}개 완료 · {remaining}개 남음
          </p>
          {summary.skippedCategories > 0 && <p className="mt-1 text-[12px] leading-[1.6] text-[#624A3C]">{summary.skippedCategories}개 분야는 진행률에서 제외했어요</p>}
        </div>
      </header>

      <section aria-label="체크리스트 찾기" className="mb-4 flex flex-wrap items-center gap-[10px] md:mb-[22px] md:gap-4">
        <label className="relative block w-full md:min-w-[200px] md:max-w-[360px] md:flex-1">
          <span className="sr-only">체크리스트 검색</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-[14px] top-1/2 size-[15px] -translate-y-1/2 text-[var(--amora-muted)]" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="예: 상견례, 취소, 보증금"
            className="h-11 w-full rounded-[11px] border border-[var(--amora-line)] bg-white pl-[38px] pr-[14px] text-[12.5px] text-[var(--amora-ink)] outline-none transition placeholder:text-[var(--amora-muted)] focus:border-[var(--amora-accent)] focus:ring-2 focus:ring-[var(--amora-accent)]/20 md:text-[13px]"
          />
        </label>
        <div className="flex w-full gap-[5px] rounded-[11px] border border-[var(--amora-line)] bg-white p-1 md:w-auto md:gap-1.5" role="group" aria-label="상태 필터">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`min-h-9 min-w-0 flex-1 whitespace-nowrap rounded-[7px] px-2 py-[7px] text-[11.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)] md:flex-none md:rounded-lg md:px-[15px] md:text-[12.5px] ${filter === item.value ? "bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)] ring-1 ring-inset ring-[var(--amora-selected-line)]" : "text-[var(--amora-muted)] hover:bg-[var(--amora-warm)]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="hidden items-center gap-2 text-[12px] text-[var(--amora-muted)] md:ml-auto md:flex" role="group" aria-label="체크리스트 보기 방식">
          <Button variant="ghost" type="button" aria-pressed={grouped} onClick={() => setGrouped(true)} className={`min-[769px]:!min-h-9 !rounded-md !px-0 !text-[12px] hover:!bg-transparent ${grouped ? "!font-semibold !text-[var(--amora-selected-text)]" : "!font-normal !text-[var(--amora-muted)] hover:!text-[var(--amora-ink)]"}`}>단계별로 묶어보기</Button>
          <span aria-hidden="true">·</span>
          <Button variant="ghost" type="button" aria-label="전체 분야 펼쳐보기" aria-pressed={!grouped} onClick={() => setGrouped(false)} className={`min-[769px]:!min-h-9 !rounded-md !px-0 !text-[12px] hover:!bg-transparent ${!grouped ? "!font-semibold !text-[var(--amora-selected-text)]" : "!font-normal !text-[var(--amora-muted)] hover:!text-[var(--amora-ink)]"}`}>전체 {CATEGORY_CHECKLISTS.length}개 펼쳐보기</Button>
        </div>
      </section>

      <nav aria-label="결혼 준비 단계" className="mb-5 rounded-[16px] border border-[var(--amora-line)] bg-white px-4 py-[17px] md:mb-[26px] md:rounded-[18px] md:px-[26px] md:py-[22px]">
        <div className="mb-[14px] md:mb-[18px] md:flex md:items-baseline md:justify-between md:gap-4">
          <h2 className="text-[12px] font-semibold text-[var(--amora-ink)] md:text-[14px]">결혼 준비 {stages.length}단계</h2>
          <p className="mt-[3px] text-[10.5px] leading-[1.6] text-[var(--amora-muted)] md:mt-0 md:text-[11.5px]">
            {CATEGORY_CHECKLISTS.length}개 분야를 준비 흐름 순서로 묶었어요{currentStage >= 0 ? ` · 지금은 ${currentStage + 1}단계` : " · 모든 분야를 확인했어요"}
          </p>
        </div>
        <div className="relative -mx-1 flex gap-[14px] overflow-x-auto px-1 pb-1 pt-1 md:mx-0 md:gap-0 md:overflow-visible md:px-0 md:before:absolute md:before:left-[8%] md:before:right-[8%] md:before:top-[26px] md:before:h-0.5 md:before:bg-[var(--amora-line)]">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const current = currentStage === index;
            return (
              <Button
                variant="ghost"
                key={stage.key}
                type="button"
                disabled={stage.categories.length === 0}
                aria-current={current ? "step" : undefined}
                aria-label={`${index + 1}단계 ${stage.label} 보기`}
                onClick={() => goToStage(stage.key)}
                className="relative !flex w-[60px] shrink-0 flex-col !gap-0 !whitespace-normal !rounded-lg !p-0 !font-normal hover:!bg-transparent disabled:!opacity-40 md:w-auto md:flex-1"
              >
                <span className={`mb-1.5 flex size-[34px] items-center justify-center rounded-full border-2 md:mb-[9px] md:size-11 ${current ? "border-[var(--amora-selected-line)] bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)] ring-4 ring-[var(--amora-rose-pale)] md:ring-[5px]" : stage.complete ? "border-[var(--amora-sage)] bg-[var(--amora-sage-pale)] text-[#33473a]" : "border-[var(--amora-line)] bg-white text-[var(--amora-muted)]"}`}>
                  {stage.complete ? <Check aria-hidden="true" className="size-[15px] md:size-[19px]" strokeWidth={1.7} /> : <Icon aria-hidden="true" className="size-[15px] md:size-[19px]" strokeWidth={1.7} />}
                </span>
                <span className="text-[10px] font-semibold leading-[1.3] text-[var(--amora-ink)] md:text-[13px]">{stage.label}</span>
                <span className="mt-0.5 text-[9px] text-[var(--amora-muted)] md:mt-[3px] md:text-[11px]">{stage.summary.done}/{stage.summary.total}<span className="hidden md:inline">개 완료</span></span>
              </Button>
            );
          })}
        </div>
      </nav>

      {categories.length > 0 ? grouped ? (
        <div className="space-y-[22px] md:space-y-[30px]">
          {stages.map((stage, index) => {
            if (stage.categories.length === 0) return null;
            const Icon = stage.icon;
            return (
              <section key={stage.key} data-checklist-stage={stage.key} ref={(element) => { stageRefs.current[stage.key] = element; }} tabIndex={-1} aria-labelledby={`checklist-stage-${stage.key}`} className="scroll-mt-28 outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)]">
                <div className="mb-[11px] flex items-center gap-[11px] md:mb-4 md:gap-[14px]">
                  <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-[10px] md:size-[42px] md:rounded-xl ${stage.complete ? "bg-[var(--amora-sage-pale)] text-[#33473a]" : "bg-[var(--amora-rose-pale)] text-[var(--amora-rose-deep)]"}`}><Icon aria-hidden="true" className="size-4 md:size-5" strokeWidth={1.7} /></span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-[var(--amora-rose-deep)] md:mb-0.5 md:text-[11px]">{index + 1}단계</p>
                    <h2 id={`checklist-stage-${stage.key}`} className="planning-display text-[15.5px] leading-[1.4] text-[var(--amora-ink)] md:text-[19px]">{stage.label}</h2>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <p className="text-[11.5px] font-semibold text-[var(--amora-ink)] md:text-[13px]">{stage.summary.done}/{stage.summary.total}개<span className="hidden md:inline"> 완료</span></p>
                    <progress value={stage.summary.percent} max={100} aria-label={`${stage.label} 항목 완료율`} className={`mt-[7px] hidden h-[5px] md:block md:w-[140px] ${stage.complete ? COMPLETED_PROGRESS_CLASS : PROGRESS_CLASS}`} />
                  </div>
                </div>
                {renderCategories(stage.categories)}
              </section>
            );
          })}
        </div>
      ) : (
        <section aria-labelledby="all-checklist-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="all-checklist-heading" className="planning-display text-[19px] text-[var(--amora-ink)]">전체 준비</h2>
            <span className="text-[12px] text-[var(--amora-muted)]">{categories.length}개 분야</span>
          </div>
          {renderCategories(categories)}
        </section>
      ) : (
        <div className="rounded-[13px] border border-dashed border-[var(--amora-line)] bg-white px-5 py-12 text-center">
          <p className="text-[14px] font-medium text-[var(--hb-text-body)]">검색 조건에 맞는 준비 항목이 없어요.</p>
          <button type="button" onClick={() => { setFilter("all"); setQuery(""); searchInputRef.current?.focus(); }} className="mt-3 min-h-11 rounded-md text-[13px] font-semibold text-[var(--amora-rose-deep)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)]">전체 목록 보기</button>
        </div>
      )}

      <div className="mt-6 hidden flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11.5px] leading-[1.6] text-[var(--amora-muted)] md:flex">
        <p>질문 초안을 확인한 뒤 직접 보내요.</p>
        <p className="flex items-center gap-3"><span className="inline-flex items-center gap-1"><BookOpen aria-hidden="true" className="size-3.5" />예절 가이드</span><span className="inline-flex items-center gap-1"><AmoraMark className="size-3.5" />아모라 질문</span></p>
      </div>

      <CategoryChecklistModal presentation="planning" categoryKey={selectedCategory ?? ""} isOpen={Boolean(selectedCategory)} onClose={() => selectCategory(null)} />
    </div>
  );
}
