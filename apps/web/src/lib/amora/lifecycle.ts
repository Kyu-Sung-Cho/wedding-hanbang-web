import { getJourneyProgressCounts } from "@hanbang/shared";
import { getFinancialRecords } from "@/lib/amora/financialRecords";
import { weddingPath } from "@/lib/weddingPaths";
import { ddayInKst } from "@/lib/utils/kstDate";
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
  progressPercent: number;
  totalDone: number;
  totalItems: number;
  contractedTotal: number;
  paidToDate: number;
  totalBudget: number;
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
  { id: "foundation", label: "초기 선택", keys: ["meeting", "venue"] },
  { id: "core", label: "업체·의상 선택", keys: ["studio", "dress", "makeup", "ring"] },
  { id: "life", label: "생활 관련 선택", keys: ["hanbok", "yedan", "honeymoon", "houseware", "housing"] },
  { id: "final", label: "예식 전 선택", keys: ["invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek"] },
];

const STAGE_COPY: Record<AmoraLifecycleStage, { label: string; summary: string }> = {
  setup: {
    label: "웨딩 라운지 세팅",
    summary: "예식일이 정해진 뒤 입력하면 직접 정한 일정과 D-day를 한곳에서 볼 수 있어요.",
  },
  foundation: {
    label: "D-day 참고 · 준비 초반",
    summary: "일반적인 준비 순서에서는 상견례, 예식장, 예산 방향을 먼저 살펴봅니다. 내 상황에 맞게 건너뛰거나 순서를 바꿔도 돼요.",
  },
  core_contracts: {
    label: "D-day 참고 · 업체 선택",
    summary: "일반적인 준비 순서 참고로, 업체나 예물을 이용한다면 포함 항목과 조건을 살펴볼 수 있어요. 계약 여부와 시점은 직접 받은 원문을 보고 결정하세요.",
  },
  detail_planning: {
    label: "D-day 참고 · 세부 준비",
    summary: "청첩장, 혼수, 신혼여행, 가족 대화에 참고할 일반적인 순서입니다. 직접 정한 일정이 아닙니다.",
  },
  final_countdown: {
    label: "D-day 참고 · 본식 준비",
    summary: "대본, 하객 안내, 답례품, 당일 동선을 확인할 때 참고하는 일반적인 순서입니다.",
  },
  wedding_day: {
    label: "본식 당일",
    summary: "오늘은 새 결정을 줄이고, 동선과 전달사항만 차분히 확인하면 돼요.",
  },
  aftercare: {
    label: "식후 감사 정리",
    summary: "필요한 경우 감사 인사, 개인 기록, 앨범 수령 일정을 직접 정리할 수 있어요.",
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

function getPhases(progress: Record<string, ProgressItem | unknown>): AmoraPhaseProgress[] {

  return PHASES.map((phase) => {
    const phaseProgress = Object.fromEntries(
      phase.keys
        .filter((key) => Object.prototype.hasOwnProperty.call(progress, key))
        .map((key) => [key, progress[key]])
    );
    const counts = getJourneyProgressCounts(phaseProgress);
    const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    return {
      id: phase.id,
      label: phase.label,
      done: counts.done,
      total: counts.total,
      percent,
      state: percent >= 100 ? "done" : counts.total > 0 ? "active" : "waiting",
    };
  });
}

export function buildAmoraLifecyclePlan(input: BuildAmoraLifecyclePlanInput): AmoraLifecyclePlan {
  const now = input.now ?? new Date();
  const dday = ddayInKst(input.weddingDate, now);
  const hasWeddingDate = dday !== null;
  const stage = getStage(dday);
  const stageCopy = STAGE_COPY[stage];
  const progress = (input.progress ?? {}) as Record<string, ProgressItem | unknown>;
  const rawTotalBudget = Number(input.totalBudget ?? 0);
  const totalBudget = Number.isFinite(rawTotalBudget) && rawTotalBudget > 0 ? rawTotalBudget : 0;
  const { contractedTotal, paidToDate } = getFinancialRecords(progress);
  const overall = getJourneyProgressCounts(progress);
  const progressPercent = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;
  const guardrails: AmoraGuardrail[] = [];

  if (!hasWeddingDate) {
    guardrails.push({
      id: "missing_wedding_date",
      title: "예식일은 아직 미정이에요",
      body: "날짜가 정해진 뒤 입력하면 직접 정한 일정과 D-day를 함께 볼 수 있어요. 지금 정하지 않아도 됩니다.",
      href: weddingPath("/settings"),
      cta: "날짜 설정",
      severity: "steady",
      iconKey: "calendar",
    });
  }

  if (totalBudget > 0 && contractedTotal > totalBudget) {
    guardrails.push({
      id: "budget_over_limit",
      title: "계획 예산과 계약 총액 기록이 맞지 않아요",
      body: "직접 입력한 계획 예산보다 서명한 계약 총액 합계가 큽니다. 계약의 적정성 판단이 아니라 중복 입력이나 금액 단위를 확인하는 안내예요.",
      href: weddingPath("/budget"),
      cta: "입력값 확인",
      severity: "warning",
      iconKey: "wallet",
    });
  }

  if (dday !== null && dday < 0) {
    guardrails.push({
      id: "aftercare_thanks",
      title: "감사 문구가 필요하면 함께 정리해요",
      body: "감사 문자나 앨범 수령처럼 실제로 필요한 일만 직접 일정에 남겨두세요.",
      href: weddingPath("/chat"),
      cta: "감사 문구",
      severity: "steady",
      iconKey: "script",
    });
  }

  if (guardrails.length === 0) {
    guardrails.push({
      id: "all_steady",
      title: "현재 기록에서 먼저 볼 항목이 없어요",
      body: "새로 확인한 일정이나 금액이 생기면 기록하고, 필요할 때 비슷한 단계의 후기를 참고하세요.",
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

  const hasRecordedBudgetMismatch = totalBudget > 0 && contractedTotal > totalBudget;
  const riskLevel: AmoraRiskLevel = hasRecordedBudgetMismatch ? "watch" : "calm";
  const riskLabel = hasRecordedBudgetMismatch ? "입력값 확인" : "준비 기록";

  const quickActions: AmoraQuickAction[] = [
    {
      id: "quote",
      label: "원문 질문 정리",
      text: "업체 문서에서 확인할 문장",
      href: weddingPath("/chat"),
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
      text: "일반적인 준비 순서 참고",
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
    progressPercent,
    totalDone: overall.done,
    totalItems: overall.total,
    contractedTotal,
    paidToDate,
    totalBudget,
    primaryAction: orderedGuardrails[0],
    guardrails: orderedGuardrails.slice(0, 4),
    quickActions,
    phases: getPhases(progress),
  };
}
