import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { weddingPath } from "@/lib/weddingPaths";
import { ddayInKst } from "@/lib/utils/kstDate";
import { getChecklistCounts, mergeChecklist } from "@/utils/checklist";
import type { ProgressItem } from "@/types/database.types";

export type AmoraLifecycleStage =
  | "setup"
  | "foundation"
  | "core_contracts"
  | "detail_planning"
  | "final_countdown"
  | "wedding_day"
  | "aftercare";

export type AmoraRiskLevel = "calm" | "watch" | "urgent";
export type AmoraGuardrailSeverity = "critical" | "warning" | "steady" | "celebrate";
export type AmoraActionIconKey =
  | "calendar"
  | "wallet"
  | "quote"
  | "schedule"
  | "chat"
  | "invitation"
  | "script"
  | "money"
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
  riskLevel: AmoraRiskLevel;
  riskLabel: string;
  riskScore: number;
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
  { id: "final", label: "본식 마무리", keys: ["invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek"] },
];

const STAGE_COPY: Record<AmoraLifecycleStage, { label: string; summary: string }> = {
  setup: {
    label: "웨딩 라운지 세팅",
    summary: "예식일과 예산을 먼저 잡으면 아모라가 모든 알림을 정확히 맞출 수 있어요.",
  },
  foundation: {
    label: "기초 결정기",
    summary: "상견례, 예식장, 큰 예산 방향을 안정적으로 잡아야 이후 선택이 쉬워져요.",
  },
  core_contracts: {
    label: "핵심 계약기",
    summary: "스드메와 예물은 견적의 빠진 항목을 먼저 확인하고 계약하는 구간이에요.",
  },
  detail_planning: {
    label: "세부 준비기",
    summary: "청첩장, 혼수, 신혼여행, 가족 합의처럼 놓치기 쉬운 일을 정리할 때예요.",
  },
  final_countdown: {
    label: "본식 카운트다운",
    summary: "대본, 하객 안내, 답례품, 당일 동선을 실수 없이 잠그는 구간이에요.",
  },
  wedding_day: {
    label: "본식 당일",
    summary: "오늘은 새 결정을 줄이고, 동선과 전달사항만 차분히 확인하면 돼요.",
  },
  aftercare: {
    label: "식후 감사 정리",
    summary: "감사 인사, 축의금 기록, 후기, 앨범 수령까지 마무리해야 진짜 끝나요.",
  },
};

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
  return CATEGORY_CHECKLISTS.reduce(
    (acc, cat) => {
      const counts = getCategoryCompletion(progress, cat.key);
      return { done: acc.done + counts.done, total: acc.total + counts.total };
    },
    { done: 0, total: 0 }
  );
}

function getSpentBudget(progress: Record<string, ProgressItem | unknown>): number {
  return Object.entries(progress).reduce((sum, [key, value]) => {
    if (key.startsWith("__")) return sum;
    const item = value as { spent?: unknown; cost?: unknown } | undefined;
    const amount = Number(item?.spent ?? item?.cost ?? 0);
    return Number.isFinite(amount) ? sum + amount : sum;
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
    title: `${label}, 놓치지 않게 볼게요`,
    body: isOverdue
      ? `권장 마감보다 ${Math.abs(daysUntilDeadline)}일 늦었어요. 오늘 체크리스트에서 빠진 항목부터 잠가요.`
      : `권장 마감까지 ${daysUntilDeadline}일 남았어요. 지금 열어두면 급하게 결정하지 않아도 돼요.`,
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
  const dday = ddayInKst(input.weddingDate, now);
  const hasWeddingDate = dday !== null;
  const stage = getStage(dday);
  const stageCopy = STAGE_COPY[stage];
  const progress = (input.progress ?? {}) as Record<string, ProgressItem | unknown>;
  const totalBudget = Number(input.totalBudget ?? 0);
  const spentBudget = getSpentBudget(progress);
  const budgetPercent = totalBudget > 0 ? Math.round((spentBudget / totalBudget) * 100) : 0;
  const overall = getOverallCounts(progress);
  const progressPercent = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;
  const guardrails: AmoraGuardrail[] = [];

  if (!hasWeddingDate) {
    guardrails.push({
      id: "missing_wedding_date",
      title: "예식일을 먼저 잡아둘게요",
      body: "D-day가 있어야 일정, 청첩장, 본식 준비, 식후 감사 인사까지 정확히 이어져요.",
      href: weddingPath("/settings"),
      cta: "날짜 설정",
      severity: "critical",
      iconKey: "calendar",
    });
  }

  if (totalBudget <= 0) {
    guardrails.push({
      id: "missing_total_budget",
      title: "전체 예산을 세우면 실수가 줄어요",
      body: "아모라가 견적과 숨은 추가금을 예산 안에서 같이 봐줄 수 있어요.",
      href: weddingPath("/budget"),
      cta: "예산 입력",
      severity: hasWeddingDate ? "warning" : "steady",
      iconKey: "wallet",
    });
  } else if (budgetPercent >= 100) {
    guardrails.push({
      id: "budget_over_limit",
      title: "예산을 이미 넘었어요",
      body: "계약 전 항목, 추가금, 부모님 분담 항목을 다시 나눠서 정리해야 해요.",
      href: weddingPath("/budget"),
      cta: "예산 보기",
      severity: "critical",
      iconKey: "wallet",
    });
  } else if (budgetPercent >= 85) {
    guardrails.push({
      id: "budget_near_limit",
      title: "예산 여유가 줄고 있어요",
      body: "남은 큰 지출을 먼저 표시하고, 견적서에 빠진 비용이 없는지 점검하세요.",
      href: weddingPath("/budget"),
      cta: "예산 점검",
      severity: "warning",
      iconKey: "wallet",
    });
  }

  if (dday !== null && dday > 0) {
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
      .filter((item) => item.status !== "completed")
      .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);

    for (const item of deadlineItems.filter((entry) => entry.daysUntilDeadline < 0).slice(0, 2)) {
      pushUnique(guardrails, makeCategoryGuardrail(item.key, item.label, item.daysUntilDeadline, "critical"));
    }

    for (const item of deadlineItems.filter((entry) => entry.daysUntilDeadline >= 0 && entry.daysUntilDeadline <= 21).slice(0, 2)) {
      pushUnique(guardrails, makeCategoryGuardrail(item.key, item.label, item.daysUntilDeadline, "warning"));
    }

    const hasCoreOpen = ["venue", "studio", "dress", "makeup", "ring"].some((key) => {
      const item = getCategoryCompletion(progress, key);
      return item.status !== "completed";
    });
    if (hasCoreOpen && dday <= 300) {
      guardrails.push({
        id: "quote_before_contract",
        title: "받은 견적은 계약 전 한번 점검해요",
        body: "원본, 수정본, 헬퍼비, 얼리스타트처럼 나중에 붙는 비용을 먼저 확인해요.",
        href: weddingPath("/community/quote-check"),
        cta: "견적 체크리스트",
        severity: "warning",
        iconKey: "quote",
      });
    }

    if (dday <= 45) {
      guardrails.push({
        id: "final_script_ready",
        title: "본식 문구와 진행을 준비해요",
        body: "사회자 대본, 부모님 편지, 하객 안내, 감사 인사 초안을 아모라와 함께 잡아두면 당일이 편해져요.",
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
      body: "축의금 정리, 감사 문자, 업체 후기, 앨범 수령 일정을 이어서 관리하세요.",
      href: weddingPath("/chat"),
      cta: "감사 문구",
      severity: "warning",
      iconKey: "script",
    });
    guardrails.push({
      id: "aftercare_money",
      title: "받은 마음을 기록해둘게요",
      body: "축의금과 참석 여부를 남기면 나중에 감사 인사와 경조사 왕래를 놓치지 않아요.",
      href: weddingPath("/money"),
      cta: "축의금 정리",
      severity: "steady",
      iconKey: "money",
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

  const riskScore = Math.min(
    100,
    orderedGuardrails.reduce((score, item) => {
      if (item.severity === "critical") return score + 34;
      if (item.severity === "warning") return score + 18;
      if (item.severity === "steady") return score + 6;
      return score;
    }, budgetPercent >= 100 ? 10 : 0)
  );
  const riskLevel: AmoraRiskLevel = riskScore >= 55 ? "urgent" : riskScore >= 20 ? "watch" : "calm";
  const riskLabel = riskLevel === "urgent" ? "지금 점검" : riskLevel === "watch" ? "주의 관찰" : "안정";

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
      label: dday !== null && dday < 0 ? "감사 인사" : "본식 문구",
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
    riskLevel,
    riskLabel,
    riskScore,
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
