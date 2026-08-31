"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, CheckCircle2, ChevronRight, Circle, Search } from "lucide-react";

import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";
import { weddingLinkProps } from "@/lib/weddingPaths";
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

  const categories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
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
    }).filter(({ status, searchable }) =>
      matchesFilter(status, filter) && (!normalizedQuery || searchable.includes(normalizedQuery)),
    );
  }, [filter, progress, query]);

  const remaining = Math.max(0, summary.total - summary.done);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 py-7 sm:px-6 sm:py-10">
      <header className="border-b border-[var(--hb-hairline)] pb-7">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-[var(--hb-accent-hover)]">WEDDING CHECKLIST</p>
        <div className="mt-2 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <h1 className="text-[30px] font-semibold leading-tight text-[var(--hb-text-strong)] sm:text-[36px]">
              웨딩 체크리스트
            </h1>
            <p className="mt-2 max-w-[620px] text-[14px] leading-7 text-[var(--hb-text-body)] sm:text-[15px]">
              첫인사부터 혼인신고까지 {TEMPLATE_ITEM_COUNT}개 준비 항목을 한꺼번에 하지 않아도 돼요. 지금 필요한 것부터 하나씩 확인하세요.
            </p>
          </div>
          <div className="min-w-[240px] rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-4">
            <div className="flex items-end justify-between gap-4">
              <span className="text-[13px] font-medium text-[var(--hb-text-body)]">전체 진행률</span>
              <strong className="text-[30px] font-semibold leading-none text-[var(--hb-text-strong)]">{summary.percent}%</strong>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-[#efe9dc]"
              role="progressbar"
              aria-label="전체 체크리스트 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={summary.percent}
            >
              <div className="h-full rounded-full bg-[var(--hb-primary)] transition-[width]" style={{ width: `${summary.percent}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-[var(--hb-text-body)]">
              {summary.done}개 완료 · {remaining}개 남음
              {summary.skippedCategories > 0 ? ` · ${summary.skippedCategories}개 분야 제외` : ""}
            </p>
          </div>
        </div>
      </header>

      <section aria-label="체크리스트 찾기" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-[380px]">
          <span className="sr-only">체크리스트 검색</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--hb-text-body)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="예: 상견례, 취소, 보증금"
            className="h-11 w-full rounded-full border border-[#dcd4c3] bg-white pl-11 pr-4 text-[14px] text-[var(--hb-text-strong)] outline-none transition focus:border-[#9d6f36] focus:ring-2 focus:ring-[#c9a96e]/20"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="상태 필터">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`shrink-0 rounded-[6px] border px-4 py-2 text-[13px] font-semibold transition ${
                filter === item.value
                  ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white"
                  : "border-[#dcd4c3] bg-white text-[var(--hb-text-body)] hover:border-[#9d6f36]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6" aria-labelledby="all-checklist-heading">
        <div className="flex items-center justify-between">
          <h2 id="all-checklist-heading" className="text-[19px] font-semibold text-[var(--hb-text-strong)]">전체 준비</h2>
          <span className="text-[13px] text-[var(--hb-text-body)]">{categories.length}개 분야</span>
        </div>

        {categories.length > 0 ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {categories.map(({ template, status, counts, declared, guide }) => {
              const percent = status === "not_applicable" || counts.total === 0
                ? 0
                : Math.round((counts.done / counts.total) * 100);
              return (
                <li key={template.key} className="rounded-[6px] border border-[#e5dece] bg-white p-4 shadow-[var(--shadow-raised)]">
                  <button
                    type="button"
                    onClick={() => selectCategory(template.key)}
                    className="w-full rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50"
                    aria-label={`${template.label} 체크리스트 열기`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        status === "completed"
                          ? "bg-[#edf4eb] text-[#607044]"
                          : status === "not_applicable"
                            ? "bg-[#f1efeb] text-[#8b857c]"
                            : "bg-[var(--hb-surface-hover)] text-[var(--hb-accent-hover)]"
                      }`}>
                        {status === "completed" ? <CheckCircle2 className="h-5 w-5" /> : status === "not_applicable" ? <Ban className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <strong className="text-[16px] font-semibold text-[var(--hb-text-strong)]">{template.label}</strong>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#a59d91]" />
                        </span>
                        <span className="mt-1 block text-[13px] leading-5 text-[var(--hb-text-body)]">
                          {status === "not_applicable"
                            ? "진행률과 알림에서 제외됨"
                            : declared
                              ? `${STATUS_LABEL[status]}${directionParticle(STATUS_LABEL[status])} 표시함 · 항목은 확인 전`
                              : `${counts.done}/${counts.total}개 완료 · ${STATUS_LABEL[status]}`}
                        </span>
                      </span>
                    </div>
                    {status !== "not_applicable" && (
                      <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#f0ece4]">
                        <span className="block h-full rounded-full bg-[var(--hb-primary)]" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                  </button>
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
        ) : (
          <div className="mt-3 rounded-[6px] border border-dashed border-[#dcd4c3] bg-[var(--hb-surface-page)] px-5 py-12 text-center">
            <p className="text-[14px] font-medium text-[var(--hb-text-body)]">검색 조건에 맞는 준비 항목이 없어요.</p>
            <button type="button" onClick={() => { setFilter("all"); setQuery(""); }} className="mt-3 text-[13px] font-semibold text-[var(--hb-accent-hover)] underline underline-offset-4">
              전체 목록 보기
            </button>
          </div>
        )}
      </section>

      <CategoryChecklistModal
        categoryKey={selectedCategory ?? ""}
        isOpen={Boolean(selectedCategory)}
        onClose={() => selectCategory(null)}
      />
    </main>
  );
}
