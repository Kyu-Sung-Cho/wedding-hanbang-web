import { createHash } from "node:crypto";

import type { TodayOneCareChoice } from "@hanbang/shared";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import type { TodayOneCandidate } from "@/lib/care/todayOne";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

const MAX_BUDGET_CATEGORY_RECORDS = 200;
const SAFE_CATEGORY_KEY_RE = /^[a-z0-9_-]{1,200}$/;
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const PAYMENT_PROOF_UNKNOWN = "기록 지출은 결제 완료 증빙이 아님";
const PAYMENT_STATE_UNKNOWN =
  "환불·취소·최종 결제 여부는 이 기록만으로 확인되지 않아요.";
const BUDGET_IMPACT =
  "예산 화면을 열어 기록을 확인할 뿐, 결제나 예산 값을 자동으로 바꾸지 않아요.";

const BUDGET_CHOICES: TodayOneCareChoice[] = [
  { action: "open_source", label: "예산 열기" },
  { action: "snooze", label: "나중에" },
  { action: "dismiss", label: "오늘 닫기" },
  { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
];

type BudgetRecord = {
  key: string;
  label: string;
  budget?: number;
  spent?: number;
};

export interface BuildTodayOneBudgetGuardrailCandidatesInput {
  totalBudget: unknown;
  progress?: Record<string, unknown> | null;
  stateRevision: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeDisplayText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !UNSAFE_DISPLAY_RE.test(value);
}

function knownCategoryLabel(key: string): string | null {
  const labels = PLANNING_CATEGORY_LABELS as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : null;
}

function categoryLabel(key: string, value: Record<string, unknown>): string | null {
  const known = knownCategoryLabel(key);
  if (known) return known;
  return isSafeDisplayText(value.label, 80) ? value.label.trim() : null;
}

function formatWon(value: number): string {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

function semanticDigest(value: Record<string, unknown>): string {
  return sha256(JSON.stringify(value));
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function choices(): TodayOneCareChoice[] {
  return BUDGET_CHOICES.map((choice) => ({ ...choice }));
}

function commonPresentation() {
  return {
    kind: "budget_guardrail" as const,
    nextAction: { label: "예산 열기", href: "/budget" },
    impact: BUDGET_IMPACT,
    choices: choices(),
  };
}

function readBudgetRecords(
  progress: Record<string, unknown>,
): { ok: true; records: BudgetRecord[] } | { ok: false } {
  const entries = Object.entries(progress).filter(([key]) => !key.startsWith("__"));
  if (entries.length > MAX_BUDGET_CATEGORY_RECORDS) return { ok: false };

  const records: BudgetRecord[] = [];
  for (const [key, value] of entries) {
    if (!SAFE_CATEGORY_KEY_RE.test(key) || !isRecord(value)) {
      return { ok: false };
    }

    const hasBudget = hasOwn(value, "budget");
    const hasSpent = hasOwn(value, "spent");
    if (!hasBudget && !hasSpent) continue;
    if (
      (hasBudget && !isValidWeddingWonAmount(value.budget))
      || (hasSpent && !isValidWeddingWonAmount(value.spent))
    ) {
      return { ok: false };
    }

    const label = categoryLabel(key, value);
    if (!label) return { ok: false };
    records.push({
      key,
      label,
      ...(hasBudget ? { budget: value.budget as number } : {}),
      ...(hasSpent ? { spent: value.spent as number } : {}),
    });
  }
  return { ok: true, records };
}

/**
 * Builds in-app budget guardrails exclusively from explicit journey
 * `total_budget` and category `budget`/`spent` fields. Legacy `cost`, quotes,
 * planned amounts, payment ledgers, and booking data are intentionally unread.
 */
export function buildTodayOneBudgetGuardrailCandidates({
  totalBudget,
  progress = {},
  stateRevision,
}: BuildTodayOneBudgetGuardrailCandidatesInput): TodayOneCandidate[] {
  if (
    !isValidWeddingWonAmount(totalBudget)
    || totalBudget <= 0
    || !Number.isSafeInteger(stateRevision)
    || stateRevision < 0
  ) {
    return [];
  }

  const parsed = readBudgetRecords(progress ?? {});
  if (!parsed.ok) return [];

  const totalSpent = parsed.records.reduce((sum, record) => sum + (record.spent ?? 0), 0);
  const totalAllocated = parsed.records.reduce(
    (sum, record) => sum + (record.budget ?? 0),
    0,
  );
  if (!Number.isSafeInteger(totalSpent) || !Number.isSafeInteger(totalAllocated)) return [];

  const candidates: TodayOneCandidate[] = [];
  if (totalSpent > totalBudget) {
    candidates.push({
      ...commonPresentation(),
      sourceKey: "budget:recorded-total-over-total",
      sourceStateDigest: semanticDigest({
        version: 1,
        reason: "recorded_total_over_total",
        totalBudget,
        totalSpent,
      }),
      sourceRevision: stateRevision,
      whyNow: "직접 기록한 지출 합계가 설정한 총예산보다 커졌어요.",
      confirmed: [
        `설정 총예산: ${formatWon(totalBudget)}`,
        `기록 지출 합계: ${formatWon(totalSpent)}`,
      ],
      unknown: [PAYMENT_PROOF_UNKNOWN, PAYMENT_STATE_UNKNOWN],
      priority: 300,
    });
  }

  for (const record of parsed.records) {
    if (
      record.budget === undefined
      || record.budget <= 0
      || record.spent === undefined
      || record.spent <= record.budget
    ) continue;

    candidates.push({
      ...commonPresentation(),
      sourceKey: `budget:category:${sha256(record.key).slice(0, 24)}:recorded-over-budget`,
      sourceStateDigest: semanticDigest({
        version: 1,
        reason: "category_recorded_over_budget",
        categoryKey: record.key,
        label: record.label,
        budget: record.budget,
        spent: record.spent,
      }),
      sourceRevision: stateRevision,
      whyNow: `${record.label}에 기록한 지출이 이 항목의 설정 예산보다 커졌어요.`,
      confirmed: [
        `항목: ${record.label}`,
        `설정 항목 예산: ${formatWon(record.budget)}`,
        `기록 지출: ${formatWon(record.spent)}`,
      ],
      unknown: [PAYMENT_PROOF_UNKNOWN, PAYMENT_STATE_UNKNOWN],
      priority: 250,
    });
  }

  if (totalAllocated > totalBudget) {
    candidates.push({
      ...commonPresentation(),
      sourceKey: "budget:allocated-total-over-total",
      sourceStateDigest: semanticDigest({
        version: 1,
        reason: "allocated_total_over_total",
        totalBudget,
        totalAllocated,
      }),
      sourceRevision: stateRevision,
      whyNow: "항목별 설정 예산 합계가 전체 예산보다 커졌어요.",
      confirmed: [
        `설정 총예산: ${formatWon(totalBudget)}`,
        `항목별 설정 예산 합계: ${formatWon(totalAllocated)}`,
      ],
      unknown: [
        "항목별 예산은 계획값이며 실제 지출이 아니에요.",
        PAYMENT_PROOF_UNKNOWN,
      ],
      priority: 200,
    });
  }

  return candidates.sort((left, right) => (
    right.priority - left.priority
    || compareAscii(left.sourceKey, right.sourceKey)
  ));
}
