import type { BudgetImpactPreview } from "@hanbang/shared";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { formatWon } from "@/lib/formatWon";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

export type AmoraBudgetChangeAssessment =
  | { kind: "blocked"; reason: "over_total"; text: string; preview: BudgetImpactPreview }
  | { kind: "needs_confirmation"; reason: string; text: string }
  | { kind: "ready"; action: { tool: "add_custom_category" | "update_category_budget"; input: Record<string, unknown> }; preview: BudgetImpactPreview };

const NUMBER = "(?:[1-9]\\d{0,2}(?:,\\d{3})+|0|[1-9]\\d*)";
const UNIT = "(?:만\\s*원|원)";
const CHANGE = new RegExp(
  `^([\\p{L}\\p{M}\\d][\\p{L}\\p{M}\\d \\t·ㆍ&+()/—–-]*?)\\s*예산(?:을|은)?\\s*(${NUMBER})\\s*(${UNIT})?\\s*(에서|→|->)\\s*(${NUMBER})\\s*(${UNIT})으로\\s*(올려|늘려|줄여|내려|바꿔|변경해|수정해)(?:서)?\\s*(?:반영|적용|저장)(?:해)?\\s*(?:줘|주세요)?[.。!]\\s*`,
  "u",
);
const KEEP_TOTAL = new RegExp(
  `^총(?:예산|액)(?:은|을)?(?:(${NUMBER})(${UNIT}))?(?:으로)?(?:그대로(?:두고|유지하고)?|유지하고)나머지(?:항목(?:의예산)?|예산)?(?:은|는|을|를)?(?:하나도)?줄이지(?:마|마세요|말아줘|말아주세요)[.。!]`,
  "u",
);
const CAP_CONDITION = /^(?:총예산|총액)(?:을|이|가)?(?:넘으면|초과하면)(?:저장|반영|적용)하지말고(?:먼저)?(?:부족액|초과액|부족한금액)(?:을)?알려(?:줘|주세요)[.。!]?$/u;
const CARD_CHANGE = new RegExp(
  `^([\\p{L}\\p{M}\\d][\\p{L}\\p{M}\\d \\t·ㆍ&+()/—–-]*?)\\s*(?:맞춤\\s*)?예산(?:만|을)?\\s*(${NUMBER})\\s*(${UNIT})?\\s*(에서|→|->)\\s*(${NUMBER})\\s*(${UNIT})으로\\s*(수정|변경)(?:하고\\s*싶어|해\\s*(?:줘|주세요))[.。!]\\s*`,
  "u",
);
// 다른 지시를 잘라내지 않도록 보존 조건과 미적용 확인 요청이 끝까지 완결되어야 한다.
const CARD_CONDITION = /^총예산(?:,|과)다른항목,기록지출,분담(?:은|을)그대로두고변경확인카드를먼저보여(?:줘|주세요)[.。!]아직(?:저장|반영|적용)하지(?:마|마세요)[.。!]?$/u;

function normalizeLabel(label: string): string {
  return label.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function needsConfirmation(reason: string, text: string): AmoraBudgetChangeAssessment {
  return { kind: "needs_confirmation", reason, text };
}

function unclear(): AmoraBudgetChangeAssessment {
  return needsConfirmation("request_unclear", "다른 항목과 총예산을 유지하는 조건부터 정확히 확인할게요. 바꿀 항목 하나와 변경 전·후 금액을 원 또는 만원 단위로 알려주세요. 아직 저장하거나 적용할 변경안을 만들지 않았어요.");
}

function amount(number: string, unit: string): number {
  return Number(number.replaceAll(",", "")) * (unit.startsWith("만") ? 10_000 : 1);
}

/**
 * 총액 초과 시 금지 요청과, 나머지 장부를 보존하는 단일 항목 확인 카드 요청만 처리한다.
 * 모델이 낸 합계 대신 승인 시 쓰는 순수 연산의 전후 장부를 사용한다.
 * 권한·승인·저장 경계는 호출자가 유지하며 이 함수는 원본 상태를 바꾸지 않는다.
 */
export function assessAmoraBudgetChange({ userText, context, sourceRevision }: {
  userText: string;
  context: ToolExecutionContext;
  sourceRevision: number | null;
}): AmoraBudgetChangeAssessment | null {
  const compact = userText.replace(/\s+/gu, "");
  const conditionalBudgetChange = /예산/u.test(compact)
    && /(?:총예산|총액)(?:을|이|가)?(?:넘으면|초과하면|넘을경우|초과할경우)/u.test(compact)
    && /(?:저장|반영|적용)하지(?:말|마)/u.test(compact);
  const cardChange = CARD_CHANGE.exec(userText.trim());
  const confirmationOnly = Boolean(cardChange && CARD_CONDITION.test(userText.trim().slice(cardChange[0].length).replace(/\s+/gu, "")));
  if (!conditionalBudgetChange && !confirmationOnly) return null;
  if (userText.length > 4000 || /["'“”‘’`<>\p{Cf}]/u.test(userText)
    || /(?:예시|가정|대략|아마|나중|보류|취소|삭제|지워)/u.test(userText)) return conditionalBudgetChange ? unclear() : null;

  const change = confirmationOnly ? cardChange : CHANGE.exec(userText.trim());
  if (!change) return unclear();
  const remainder = userText.trim().slice(change[0].length).replace(/\s+/gu, "");
  const keep = KEEP_TOTAL.exec(remainder);
  if (!confirmationOnly && (!keep || !CAP_CONDITION.test(remainder.slice(keep[0].length)))) return unclear();
  // 화살표의 마지막 단위는 양쪽 금액에만 공통 적용한다. 총액의 단위를 추정하지 않는다.
  if (!change[3] && change[4] === "에서") return unclear();
  const oldBudget = amount(change[2], change[3] ?? change[6]);
  const newBudget = amount(change[5], change[6]);
  if (![oldBudget, newBudget].every(isValidWeddingWonAmount)
    || ((change[7] === "올려" || change[7] === "늘려") && newBudget <= oldBudget)
    || ((change[7] === "줄여" || change[7] === "내려") && newBudget >= oldBudget)) return unclear();
  if (oldBudget === newBudget) return needsConfirmation("no_change", "변경 전후 금액이 같아요. 바꿀 금액을 다시 확인해주세요. 아직 저장하거나 적용할 변경안을 만들지 않았어요.");
  if (sourceRevision === null || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0
    || !isValidWeddingWonAmount(context.weddingContext.budget) || context.weddingContext.budget === 0) {
    return needsConfirmation("budget_unavailable", "현재 확정된 총예산과 항목별 금액을 먼저 확인해야 정확히 계산할 수 있어요. 예산 탭을 확인한 뒤 다시 요청해주세요. 아직 저장하거나 적용할 변경안을 만들지 않았어요.");
  }
  if (keep?.[1] && amount(keep[1], keep[2]) !== context.weddingContext.budget) {
    return needsConfirmation("total_changed", "말씀하신 총예산이 현재 예산 탭의 금액과 달라요. 사용할 총예산을 먼저 확인해주세요. 아직 저장하거나 적용할 변경안을 만들지 않았어요.");
  }

  const label = change[1].replace(/\s+/gu, " ").trim();
  if (label.length > 60) return unclear();
  const targetLabels = new Set([normalizeLabel(label)]);
  // '맞춤'이 종류 설명인지 실제 이름의 일부인지 정본 항목 전체와 대조한다.
  if (confirmationOnly && /^\s*맞춤\s*예산/u.test(change[0].slice(change[1].length))) {
    targetLabels.add(normalizeLabel(`${label} 맞춤`));
  }
  const progress = context.weddingContext.progress as Record<string, unknown>;
  if (!isRecord(progress) || (progress.__hidden !== undefined
    && (!Array.isArray(progress.__hidden) || !progress.__hidden.every(key => typeof key === "string")))) {
    return needsConfirmation("invalid_budget_state", "현재 항목별 예산을 정확히 확인하기 어려워 계산과 변경안 생성을 멈췄어요. 예산 탭에서 항목을 확인해주세요.");
  }
  const hidden = new Set(Array.isArray(progress.__hidden) ? progress.__hidden : []);
  const targetKeys = new Set(Object.entries(CATEGORY_LABELS)
    .filter(([key, fixedLabel]) => targetLabels.has(normalizeLabel(fixedLabel))
      || targetLabels.has(normalizeLabel(PLANNING_CATEGORY_LABELS[key as keyof typeof PLANNING_CATEGORY_LABELS] ?? "")))
    .map(([key]) => key));
  for (const [key, row] of Object.entries(progress)) {
    if (key.startsWith("__")) continue;
    const known = Object.hasOwn(CATEGORY_LABELS, key);
    if (known && hidden.has(key)) continue;
    const custom = /^custom_[0-9A-Za-z_-]{1,48}$/.test(key) && isRecord(row)
      && typeof row.label === "string" && row.label.trim().length > 0
      && row.label.trim().length <= 60 && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(row.label);
    // 예산 탭과 preview의 집계 대상이 달라질 수 있는 손상된 행은 사실로 계산하지 않는다.
    if ((known || key.startsWith("custom_")) && !isRecord(row)
      || isRecord(row) && (row.budget !== undefined || row.spent !== undefined) && !known && !custom) {
      return needsConfirmation("invalid_budget_state", "현재 항목별 예산을 정확히 확인하기 어려워 계산과 변경안 생성을 멈췄어요. 예산 탭에서 항목을 확인해주세요.");
    }
    if (custom && isRecord(row) && typeof row.label === "string" && targetLabels.has(normalizeLabel(row.label))) targetKeys.add(key);
  }
  if (targetKeys.size !== 1) {
    return needsConfirmation("category_ambiguous", "예산 탭에서 바꿀 항목을 하나로 확인하지 못했어요. 현재 항목 이름을 정확히 알려주세요. 아직 저장하거나 적용할 변경안을 만들지 않았어요.");
  }
  const [targetKey] = targetKeys;
  if (Object.hasOwn(CATEGORY_LABELS, targetKey) && hidden.has(targetKey)) {
    return needsConfirmation("category_hidden", "제외된 예산 항목은 바로 수정하지 않을게요. 예산 탭에서 포함할 항목인지 먼저 확인해주세요.");
  }
  const row = progress[targetKey];
  if (!isRecord(row) || !isValidWeddingWonAmount(row.budget) || row.budget !== oldBudget) {
    return needsConfirmation("amount_changed", "말씀하신 변경 전 금액이 현재 항목 예산과 달라요. 예산 탭의 최신 금액을 확인한 뒤 다시 요청해주세요. 아직 저장하거나 적용할 변경안을 만들지 않았어요.");
  }
  const action: Extract<AmoraBudgetChangeAssessment, { kind: "ready" }>["action"] = targetKey.startsWith("custom_")
    ? { tool: "add_custom_category", input: { label: row.label, budget: newBudget } }
    : { tool: "update_category_budget", input: { category: targetKey, budget: newBudget } };
  const preview = buildAmoraBudgetImpactPreview({
    action: { ...action, inputDigest: getAmoraToolOperationIdentity(action.tool, action.input).inputDigest },
    context,
    sourceRevision,
  });
  if (!preview || preview.delta.totalBudget !== 0 || preview.delta.recordedSpend !== 0
    || preview.categories.length !== 1 || preview.categories[0].key !== targetKey
    || preview.categories[0].currentBudget !== oldBudget || preview.categories[0].proposedBudget !== newBudget) {
    return needsConfirmation("invalid_budget_state", "현재 장부를 기준으로 변경 영향을 확정하지 못했어요. 예산 탭을 확인한 뒤 다시 요청해주세요. 아직 저장하거나 적용할 변경안을 만들지 않았어요.");
  }
  if (preview.proposed.unallocatedBudget < 0) {
    return {
      kind: "blocked", reason: "over_total", preview,
      text: `현재 배정은 ${formatWon(preview.current.allocatedBudget)}이고, 요청한 변경 후에는 ${formatWon(preview.proposed.allocatedBudget)}이에요. 총예산 ${formatWon(preview.proposed.totalBudget)}보다 ${formatWon(-preview.proposed.unallocatedBudget)} 많아 요청하신 조건에 따라 저장하지 않았어요.`,
    };
  }
  return { kind: "ready", action, preview };
}
