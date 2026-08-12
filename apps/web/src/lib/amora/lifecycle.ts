import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { objectParticle } from "@/lib/ai/tools/toolTypes";
import { kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";
import { weddingPath } from "@/lib/weddingPaths";
import { getChecklistCounts, mergeChecklist, summarizePlanningChecklist } from "@/utils/checklist";
import type { ProgressItem } from "@/types/database.types";

export type AmoraLifecycleStage =
  | "setup"
  | "foundation"
  | "core_contracts"
  | "detail_planning"
  | "final_countdown"
  | "wedding_day"
  | "aftercare";

export type AmoraGuardrailSeverity = "critical" | "warning" | "steady" | "celebrate";
export type AmoraActionIconKey =
  | "calendar"
  | "wallet"
  | "quote"
  | "schedule"
  | "chat"
  | "invitation"
  | "script"
  | "community";

export interface AmoraGuardrail {
  id: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  severity: AmoraGuardrailSeverity;
  iconKey: AmoraActionIconKey;
  categoryKey?: string;
  dueLabel?: string;
}

export interface AmoraQuickAction {
  id: string;
  label: string;
  text: string;
  href: string;
  iconKey: AmoraActionIconKey;
}

export interface AmoraPhaseProgress {
  id: string;
  label: string;
  done: number;
  total: number;
  percent: number;
  state: "done" | "active" | "waiting";
}

export interface AmoraLifecyclePlan {
  dday: number | null;
  stage: AmoraLifecycleStage;
  stageLabel: string;
  stageSummary: string;
  progressPercent: number;
  totalDone: number;
  totalItems: number;
  spentBudget: number;
  totalBudget: number;
  budgetPercent: number;
  primaryAction: AmoraGuardrail;
  guardrails: AmoraGuardrail[];
  quickActions: AmoraQuickAction[];
  phases: AmoraPhaseProgress[];
}

interface BuildAmoraLifecyclePlanInput {
  weddingDate?: string | Date | null;
  venue?: string | null;
  totalBudget?: number | null;
  progress?: Record<string, ProgressItem | unknown> | null;
  now?: Date;
}

const PHASES = [
  { id: "foundation", label: "기초 결정", keys: ["meeting", "venue"] },
  { id: "core", label: "핵심 계약", keys: ["studio", "dress", "makeup", "ring"] },
  { id: "life", label: "생활 준비", keys: ["hanbok", "yedan", "honeymoon", "houseware", "housing"] },
  { id: "final", label: "결혼식 마무리", keys: ["invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek"] },
];

const STAGE_COPY: Record<AmoraLifecycleStage, { label: string; summary: string }> = {
  setup: {
    label: "기본 정보 입력",
    summary: "결혼식 날짜와 예산을 입력하면 아모라가 준비 일정을 날짜에 맞춰 정리해요.",
  },
  foundation: {
    label: "기초 결정기",
    summary: "양쪽 부모님의 첫 만남, 결혼식장, 전체 예산처럼 큰 결정을 정리하는 시기예요.",
  },
  core_contracts: {
    label: "핵심 계약기",
    summary: "사진 촬영·드레스·헤어·메이크업과 결혼반지·기념 선물의 견적 내용을 확인하고 계약하는 시기예요.",
  },
  detail_planning: {
    label: "세부 준비기",
    summary: "종이·모바일 초대장, 가전·가구·생활용품, 신혼여행, 가족 합의처럼 놓치기 쉬운 일을 정리할 때예요.",
  },
  final_countdown: {
    label: "결혼식 전 최종 확인",
    summary: "진행 대본, 하객 안내, 결혼식에 온 분께 드릴 선물, 당일 이동 순서를 마지막으로 확인하는 시기예요.",
  },
  wedding_day: {
    label: "결혼식 당일",
    summary: "오늘은 새 결정을 줄이고, 동선과 전달사항만 차분히 확인하면 돼요.",
  },
  aftercare: {
    label: "결혼식 뒤 감사 정리",
    summary: "감사 인사, 사진·영상·앨범 받기와 빌린 물품 반납처럼 남은 일을 정리해요.",
  },
};

function toDate(value: BuildAmoraLifecyclePlanInput["weddingDate"]): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDday(weddingDate: Date | null, now: Date): number | null {
  if (!weddingDate) return null;
  const weddingMidnight = kstMidnightFromYmd(ymdInKst(weddingDate));
  const todayMidnight = kstMidnightFromYmd(ymdInKst(now));
  return Math.round((weddingMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
}

function getStage(dday: number | null): AmoraLifecycleStage {
  if (dday === null) return "setup";
  if (dday < 0) return "aftercare";
  if (dday === 0) return "wedding_day";
  if (dday <= 90) return "final_countdown";
  if (dday <= 180) return "detail_planning";
  if (dday <= 300) return "core_contracts";
  return "foundation";
}

function getProgressItem(progress: Record<string, ProgressItem | unknown>, key: string): ProgressItem | undefined {
  const item = progress[key] as Partial<ProgressItem> | undefined;
  if (!item || typeof item !== "object") return undefined;
  return item as ProgressItem;
}

function getCategoryCompletion(progress: Record<string, ProgressItem | unknown>, key: string) {
  const template = CHECKLIST_MAP[key];
  const item = getProgressItem(progress, key);
  const status = item?.status ?? "not_started";
  const checklist = template ? mergeChecklist(template.items, item?.checklist, status) : [];
  const counts = getChecklistCounts(checklist);
  return { status, done: counts.done, total: counts.total };
}

function getOverallCounts(progress: Record<string, ProgressItem | unknown>) {
  const summary = summarizePlanningChecklist(
    CATEGORY_CHECKLISTS,
    progress as Record<string, ProgressItem | undefined>,
  );
  return { done: summary.done, total: summary.total };
}

function getSpentBudget(progress: Record<string, ProgressItem | unknown>): number {
  return Object.entries(progress).reduce((sum, [key, value]) => {
    if (key.startsWith("__")) return sum;
    const item = value as { spent?: unknown } | undefined;
    const amount = item?.spent;
    return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
      ? sum + amount
      : sum;
  }, 0);
}

function getPhases(progress: Record<string, ProgressItem | unknown>, stage: AmoraLifecycleStage): AmoraPhaseProgress[] {
  const activePhaseId =
    stage === "foundation" || stage === "setup"
      ? "foundation"
      : stage === "core_contracts"
        ? "core"
        : stage === "detail_planning"
          ? "life"
          : "final";

  return PHASES.map((phase) => {
    const counts = phase.keys.reduce(
      (acc, key) => {
        const item = getCategoryCompletion(progress, key);
        return { done: acc.done + item.done, total: acc.total + item.total };
      },
      { done: 0, total: 0 }
    );
    const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    return {
      id: phase.id,
      label: phase.label,
      done: counts.done,
      total: counts.total,
      percent,
      state: percent >= 100 ? "done" : phase.id === activePhaseId ? "active" : "waiting",
    };
  });
}

function makeCategoryGuardrail(
  key: string,
  label: string,
  daysUntilDeadline: number,
  severity: AmoraGuardrailSeverity
): AmoraGuardrail {
  const isOverdue = daysUntilDeadline < 0;
  return {
    id: `category_${key}_${severity}`,
    title: `${label}${objectParticle(label)} 놓치지 않게 볼게요`,
    body: isOverdue
      ? `기본 일정의 확인 시점보다 ${Math.abs(daysUntilDeadline)}일 지났어요. 업체나 가족과 정한 실제 날짜가 있다면 그 날짜가 우선이에요.`
      : `기본 일정의 확인 시점까지 ${daysUntilDeadline}일 남았어요. 업체나 가족과 정한 실제 날짜가 있다면 그 날짜가 우선이에요.`,
    href: weddingPath("/schedule"),
    cta: "체크리스트",
    severity,
    iconKey: "schedule",
    categoryKey: key,
    dueLabel: isOverdue ? `${Math.abs(daysUntilDeadline)}일 지남` : `${daysUntilDeadline}일 남음`,
  };
}

function pushUnique(items: AmoraGuardrail[], item: AmoraGuardrail) {
  if (!items.some((existing) => existing.id === item.id || existing.categoryKey === item.categoryKey)) {
    items.push(item);
  }
}

export function buildAmoraLifecyclePlan(input: BuildAmoraLifecyclePlanInput): AmoraLifecyclePlan {
  const now = input.now ?? new Date();
  const weddingDate = toDate(input.weddingDate ?? null);
  const dday = getDday(weddingDate, now);
  const stage = getStage(dday);
  const stageCopy = STAGE_COPY[stage];
  const progress = (input.progress ?? {}) as Record<string, ProgressItem | unknown>;
  const totalBudget = Number(input.totalBudget ?? 0);
  const spentBudget = getSpentBudget(progress);
  const budgetPercent = totalBudget > 0 ? Math.round((spentBudget / totalBudget) * 100) : 0;
  const overall = getOverallCounts(progress);
  const progressPercent = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;
  const guardrails: AmoraGuardrail[] = [];

  if (!weddingDate) {
    guardrails.push({
      id: "missing_wedding_date",
      title: "결혼식 날짜를 먼저 입력해 주세요",
      body: "결혼식 날짜가 있어야 일정, 초대장 전달, 당일 준비, 결혼식 뒤 감사 인사를 날짜에 맞춰 정리할 수 있어요.",
      href: weddingPath("/settings"),
      cta: "날짜 설정",
      severity: "critical",
      iconKey: "calendar",
    });
  }

  if (totalBudget <= 0) {
    guardrails.push({
      id: "missing_total_budget",
      title: "전체 예산을 입력하면 비교 기준이 생겨요",
      body: "아모라가 견적 금액과 견적에 포함되지 않은 항목을 예산과 함께 정리할 수 있어요.",
      href: weddingPath("/budget"),
      cta: "예산 입력",
      severity: weddingDate ? "warning" : "steady",
      iconKey: "wallet",
    });
  } else if (budgetPercent >= 100) {
    guardrails.push({
      id: "budget_over_limit",
      title: "기록 지출 합계가 전체 예산보다 커요",
      body: "직접 기록한 금액 기준이며 결제 완료 여부와는 별도예요. 누락·중복을 확인하고 계약 전 항목, 추가금, 가족 분담 항목을 다시 나눠서 정리해요.",
      href: weddingPath("/budget"),
      cta: "예산 보기",
      severity: "critical",
      iconKey: "wallet",
    });
  } else if (budgetPercent >= 85) {
    guardrails.push({
      id: "budget_near_limit",
      title: "예산 여유가 줄고 있어요",
      body: "앞으로 예상하는 큰 금액을 먼저 표시하고, 견적서에 빠진 비용이 없는지 점검하세요.",
      href: weddingPath("/budget"),
      cta: "예산 점검",
      severity: "warning",
      iconKey: "wallet",
    });
  }

  if (weddingDate && dday !== null && dday > 0) {
    const deadlineItems = CATEGORY_CHECKLISTS
      .map((cat) => {
        const item = getCategoryCompletion(progress, cat.key);
        return {
          key: cat.key,
          label: cat.label,
          status: item.status,
          daysUntilDeadline: dday - cat.ddayDeadline,
        };
      })
      // "해당 없음"은 마감 가드레일에서도 빼야 잔소리가 되지 않는다.
      .filter((item) => item.status !== "completed" && item.status !== "not_applicable")
      .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);

    for (const item of deadlineItems.filter((entry) => entry.daysUntilDeadline < 0).slice(0, 2)) {
      pushUnique(guardrails, makeCategoryGuardrail(item.key, item.label, item.daysUntilDeadline, "critical"));
    }

    for (const item of deadlineItems.filter((entry) => entry.daysUntilDeadline >= 0 && entry.daysUntilDeadline <= 21).slice(0, 2)) {
      pushUnique(guardrails, makeCategoryGuardrail(item.key, item.label, item.daysUntilDeadline, "warning"));
    }

    const hasCoreOpen = ["venue", "studio", "dress", "makeup", "ring"].some((key) => {
      const item = getCategoryCompletion(progress, key);
      return item.status !== "completed" && item.status !== "not_applicable";
    });
    if (hasCoreOpen && dday <= 300) {
      guardrails.push({
        id: "quote_before_contract",
        title: "받은 견적은 계약 전 한번 점검해요",
        body: "받는 사진 파일 수, 보정해 주는 사진 수, 드레스를 돕는 직원 비용, 이른 시간 추가 비용을 확인해요.",
        href: weddingPath("/community/quote-check"),
        cta: "견적 체크리스트",
        severity: "warning",
        iconKey: "quote",
      });
    }

    if (dday <= 45) {
      guardrails.push({
        id: "final_script_ready",
        title: "결혼식 문구와 진행 순서를 준비해요",
        body: "결혼식을 진행하는 사람이 읽을 대본, 부모님 편지, 하객 안내, 감사 인사 초안을 아모라와 함께 정리해 두세요.",
        href: weddingPath("/chat"),
        cta: "아모라와 준비",
        severity: dday <= 14 ? "critical" : "warning",
        iconKey: "script",
      });
    }
  }

  if (dday !== null && dday < 0) {
    guardrails.push({
      id: "aftercare_thanks",
      title: "식 후 감사 인사까지 같이 챙길게요",
      body: "감사 인사를 보낼 사람과 문구를 정리하고, 아직 받지 못한 사진·영상·앨범 일정을 확인하세요.",
      href: weddingPath("/chat"),
      cta: "감사 문구",
      severity: "warning",
      iconKey: "script",
    });
    guardrails.push({
      id: "aftercare_tasks",
      title: "결혼식 뒤 남은 일을 일정에 모아두세요",
      body: "사진·영상·앨범 받기, 빌린 물품 반납, 업체와 다시 확인할 날짜를 할 일·일정에 적어두세요.",
      href: weddingPath("/schedule"),
      cta: "남은 일 정리",
      severity: "steady",
      iconKey: "schedule",
    });
  }

  if (guardrails.length === 0) {
    guardrails.push({
      id: "all_steady",
      title: "오늘은 흐름이 좋아요",
      body: "급한 경고는 없어요. 커뮤니티에서 비슷한 단계의 실제 후기를 보며 다음 선택을 준비하세요.",
      href: weddingPath(),
      cta: "후기 보기",
      severity: "celebrate",
      iconKey: "community",
    });
  }

  const orderedGuardrails = guardrails.sort((a, b) => {
    const order: Record<AmoraGuardrailSeverity, number> = {
      critical: 0,
      warning: 1,
      steady: 2,
      celebrate: 3,
    };
    return order[a.severity] - order[b.severity];
  });

  const quickActions: AmoraQuickAction[] = [
    {
      id: "quote",
      label: "견적 점검",
      text: "계약 전 빠진 항목 확인",
      href: weddingPath("/community/quote-check"),
      iconKey: "quote",
    },
    {
      id: "chat",
      label: "아모라 상담",
      text: "업체 질문·가족 대화 정리",
      href: weddingPath("/chat"),
      iconKey: "chat",
    },
    {
      id: "schedule",
      label: "준비 일정",
      text: "D-day별 급한 할 일 확인",
      href: weddingPath("/schedule"),
      iconKey: "schedule",
    },
    {
      id: "script",
      label: dday !== null && dday < 0 ? "감사 인사" : "결혼식 문구",
      text: "식 전후 문구는 아모라와 함께",
      href: weddingPath("/chat"),
      iconKey: "script",
    },
  ];

  return {
    dday,
    stage,
    stageLabel: stageCopy.label,
    stageSummary: stageCopy.summary,
    progressPercent,
    totalDone: overall.done,
    totalItems: overall.total,
    spentBudget,
    totalBudget,
    budgetPercent,
    primaryAction: orderedGuardrails[0],
    guardrails: orderedGuardrails.slice(0, 4),
    quickActions,
    phases: getPhases(progress, stage),
  };
}
