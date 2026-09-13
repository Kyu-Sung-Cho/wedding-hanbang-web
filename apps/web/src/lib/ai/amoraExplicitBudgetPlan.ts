import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

export type ExplicitBudgetPlanInput = {
  total_budget: number;
  allocations: Array<{ category: string; label?: string; budget: number }>;
  intake_summary: string;
};

const NUMBER = "(?:[1-9]\\d{0,2}(?:,\\d{3})+|0|[1-9]\\d*)";
const TOTAL = new RegExp(`^(?:총(?:예산|액)?|총\\s+결혼\\s+예산은)\\s*(${NUMBER})\\s*(만\\s*원|원)(?:이야|입니다|이에요|예요)?\\s*[.。:\\n]\\s*`, "u");
const SAVE = /\s*(?:이대로\s*)?(?:실제\s*)?예산(?:표)?에\s*(?:반영|적용|저장)해\s*(?:줘|주세요)[.!。]?$/u;
const FIXED_LABELS: Readonly<Record<string, string>> = PLANNING_CATEGORY_LABELS;
const FIXED_BY_LABEL = new Map(Object.entries(PLANNING_CATEGORY_LABELS)
  .filter(([key]) => key !== "greeting" && key !== "registration")
  .map(([key, label]) => [label as string, key]));
const UPDATE_PREFIX = new RegExp(
  `^기존\\s+예산의\\s+([\\p{L}\\p{M}][\\p{L}\\p{M} \\t·ㆍ&+()/—–-]*?)(?:은|는)\\s+새\\s+항목을\\s+(?:만들지|추가하지)\\s+말고\\s+같은\\s+이름의\\s+금액을\\s+(${NUMBER})\\s*(만\\s*원|원)에서\\s+(${NUMBER})\\s*(만\\s*원|원)으로\\s+(?:바꿔|변경해|수정해)(?:줘|주세요)[.。]\\s*`
  + `총액은\\s+(${NUMBER})\\s*(만\\s*원|원)으로\\s+유지하고\\s+예비비만\\s+(${NUMBER})\\s*(만\\s*원|원)에서\\s+(${NUMBER})\\s*(만\\s*원|원)으로\\s+(줄일게|늘릴게|바꿀게)(?:요)?[.。]\\s*최종\\s+배분은\\s+`,
  "u",
);
const CONFIRMATION_PLAN = /^([\s\S]+?)(?:으로|로)?\s*(?:배분|배정|조정)해\s*(?:줘|주세요)[.。!]\s*([\s\S]+)$/u;
const CONFIRMATION_SCOPE = /^(두|세|네|2|3|4|명시한|말한|위)항목만(?:바꾸고|변경하고|조정하고|반영하고|(?:바꿔|반영해)(?:줘|주세요)[.。!])/u;
const CONFIRMATION_KEEP = /^(.+?)(?:은|는|을|를)?(?:그대로)?(?:유지해(?:줘|주세요)[.。!]|유지하고|두고|둬(?:줘|주세요)?[.。!])(?:,)?(.+)$/u;
const CONFIRMATION_ONLY = /^(?:아직(?:적용|반영|저장)하지말고(?:변경)?확인카드(?:를|만)먼저보여(?:줘|주세요)[.。!]?|(?:변경)?확인카드(?:를|만)먼저보여(?:줘|주세요)[.。!]?(?:아직(?:적용|반영|저장)하지(?:마|마세요|말아줘|말아주세요)[.。!]?)?|적용할변경내용(?:을|만)먼저보여(?:줘|주세요)[.。!]?)$/u;
const CONFIRMATION_COUNTS: Readonly<Record<string, number>> = { 두: 2, 세: 3, 네: 4, "2": 2, "3": 3, "4": 4 };

function normalizedLabel(label: string): string {
  return label.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
}

function currentBudgetRow(progress: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = progress[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && "budget" in value && isValidWeddingWonAmount(value.budget) ? value : null;
}

function existingCustomKey(progress: Record<string, unknown>, label: string): string | null {
  const keys = Object.entries(progress).filter(([key, value]) => key.startsWith("custom_")
    && value !== null && typeof value === "object" && !Array.isArray(value)
    && "label" in value && typeof value.label === "string"
    && normalizedLabel(value.label) === normalizedLabel(label)).map(([key]) => key);
  return keys.length === 1 && /^custom_[0-9A-Za-z_-]{1,48}$/.test(keys[0]) ? keys[0] : null;
}

function confirmationCategory(progress: Record<string, unknown>, label: string): { key: string; label?: string } | null {
  // 이름에 붙은 조사/예산 설명은 정본 이름과 유일하게 일치할 때만 해석한다.
  // 같은 이름의 기본·맞춤 항목이 있으면 어느 쪽을 바꿀지 추측하지 않는다.
  const labels = new Set([
    label,
    label.replace(/(?:은|는|을|를)$/u, ""),
    label.replace(/\s+예산(?:은|는|을|를)?$/u, ""),
  ].map(normalizedLabel));
  const candidates = new Map<string, { key: string; label?: string }>();
  for (const [fixedLabel, key] of FIXED_BY_LABEL) {
    if (labels.has(normalizedLabel(fixedLabel)) || key === "reserve" && labels.has("예비비")) {
      candidates.set(key, { key });
    }
  }
  for (const [key, row] of Object.entries(progress)) {
    if (!/^custom_[0-9A-Za-z_-]{1,48}$/u.test(key) || row === null || typeof row !== "object"
      || Array.isArray(row) || !("label" in row) || typeof row.label !== "string"
      || !labels.has(normalizedLabel(row.label))) continue;
    candidates.set(key, { key, label: row.label.replace(/\s+/gu, " ").trim() });
  }
  if (candidates.size !== 1) return null;
  const candidate = [...candidates.values()][0];
  if (!currentBudgetRow(progress, candidate.key)
    || Array.isArray(progress.__hidden) && progress.__hidden.includes(candidate.key)) return null;
  return candidate;
}

function confirmationScope(text: string): { count: number | undefined } | null {
  const compact = text.replace(/\s+/gu, "");
  const scope = CONFIRMATION_SCOPE.exec(compact);
  if (!scope) return null;
  const names: Readonly<Record<string, string>> = {
    총예산: "total", 총액: "total", 나머지항목: "others", 다른항목: "others",
    기록지출: "spent", 기록한지출: "spent", 분담: "payer", 분담비율: "payer",
  };
  const kept = new Set<string>();
  let remainder = compact.slice(scope[0].length);
  while (!CONFIRMATION_ONLY.test(remainder)) {
    const keep = CONFIRMATION_KEEP.exec(remainder);
    if (!keep) return null;
    const values = keep[1].split(/,|과|와|및/u).map(label => {
      const key = label.replace(/^기존/u, "");
      return Object.hasOwn(names, key) ? names[key] : undefined;
    });
    for (const value of values) {
      if (value === undefined || kept.has(value)) return null;
      kept.add(value);
    }
    remainder = keep[2];
  }
  // 문장을 나누거나 순서를 바꿔도 네 보존 범위를 읽고 제안 요청까지 모두 소비한다.
  if (kept.size !== 4) return null;
  return { count: CONFIRMATION_COUNTS[scope[1]] };
}

function parseConfirmationBudgetPlan(
  text: string,
  progress: Record<string, unknown>,
  currentTotalBudget: number | undefined,
): ExplicitBudgetPlanInput | null {
  const match = CONFIRMATION_PLAN.exec(text.trim());
  const scope = match ? confirmationScope(match[2]) : null;
  if (!match || !scope || !isValidWeddingWonAmount(currentTotalBudget) || currentTotalBudget === 0
    || progress === null || typeof progress !== "object" || Array.isArray(progress)
    || progress.__hidden !== undefined && (!Array.isArray(progress.__hidden) || !progress.__hidden.every(key => typeof key === "string"))
    || /(?:예시|가정|대략|아마|나중|보류|취소|삭제|지워)/u.test(match[1])) return null;
  const listing = match[1].trim();
  const entry = new RegExp(`([\\p{L}\\p{M}][\\p{L}\\p{M} \\t·ㆍ&+()/—–-]*?)\\s+(${NUMBER})\\s*(만\\s*원|원)[ \\t]*(,|\\n|$)`, "uy");
  const allocations: ExplicitBudgetPlanInput["allocations"] = [];
  const seen = new Set<string>();
  let offset = 0;
  while (offset < listing.length) {
    entry.lastIndex = offset;
    const row = entry.exec(listing);
    if (!row) return null;
    const label = row[1].replace(/\s+/gu, " ").trim();
    if (label.length > 70) return null;
    const category = confirmationCategory(progress, label);
    const budget = Number(row[2].replaceAll(",", "")) * (row[3].startsWith("만") ? 10_000 : 1);
    if (!category || seen.has(category.key) || !isValidWeddingWonAmount(budget)) return null;
    seen.add(category.key);
    allocations.push(category.label !== undefined
      ? { category: "custom", label: category.label, budget }
      : { category: category.key, budget });
    if (allocations.length > 20) return null;
    offset = entry.lastIndex;
    if (row[4] && !listing.slice(offset).trim()) return null;
    while (offset < listing.length && /\s/u.test(listing[offset])) offset += 1;
  }
  if (allocations.length < 2 || scope.count !== undefined && allocations.length !== scope.count) return null;
  // 확인 카드 요청만 소비했다. 저장/승인은 기존 route와 원자 저장기의 경계를 유지한다.
  return { total_budget: currentTotalBudget, allocations, intake_summary: "현재 메시지에서 명시한 항목별 예산 배분" };
}

function parseExistingBudgetUpdate(
  request: string,
  progress: Record<string, unknown>,
  currentTotalBudget: number | undefined,
): ExplicitBudgetPlanInput | null {
  const prefix = UPDATE_PREFIX.exec(request);
  if (!prefix || !isValidWeddingWonAmount(currentTotalBudget)) return null;
  const amount = (number: string, unit: string) => Number(number.replaceAll(",", "")) * (unit.startsWith("만") ? 10_000 : 1);
  const label = prefix[1].replace(/\s+/gu, " ").trim();
  const oldBudget = amount(prefix[2], prefix[3]);
  const newBudget = amount(prefix[4], prefix[5]);
  const totalBudget = amount(prefix[6], prefix[7]);
  const oldReserve = amount(prefix[8], prefix[9]);
  const newReserve = amount(prefix[10], prefix[11]);
  if (label.length > 60 || [oldBudget, newBudget, totalBudget, oldReserve, newReserve].some(value => !isValidWeddingWonAmount(value))
    || totalBudget !== currentTotalBudget || oldBudget === newBudget
    || oldBudget + oldReserve !== newBudget + newReserve
    || (prefix[12] === "줄일게" && newReserve >= oldReserve)
    || (prefix[12] === "늘릴게" && newReserve <= oldReserve)) return null;

  // 변경 설명을 모두 읽은 뒤에만 최종 목록을 기존 전체 소비 파서로 넘긴다.
  const plan = parseCompleteBudgetListing(request.slice(prefix[0].length), progress);
  if (!plan || plan.total_budget !== totalBudget) return null;
  const named = plan.allocations.find(row => normalizedLabel(row.label ?? FIXED_LABELS[row.category] ?? "") === normalizedLabel(label));
  if (!named || named.category === "reserve") return null;
  const targetKey = named.category === "custom" ? existingCustomKey(progress, label) : named.category;
  const target = targetKey ? currentBudgetRow(progress, targetKey) : null;
  const reserve = currentBudgetRow(progress, "reserve");
  if (!targetKey || !target || !reserve || target.budget !== oldBudget || reserve.budget !== oldReserve) return null;

  const hidden = Array.isArray(progress.__hidden) ? progress.__hidden : [];
  const seen = new Set<string>();
  for (const row of plan.allocations) {
    const key = row.category === "custom" ? existingCustomKey(progress, row.label ?? "") : row.category;
    const existing = key ? currentBudgetRow(progress, key) : null;
    if (!key || !existing || seen.has(key) || (!key.startsWith("custom_") && hidden.includes(key))) return null;
    const expectedBudget = key === targetKey ? newBudget : key === "reserve" ? newReserve : existing.budget;
    if (row.budget !== expectedBudget) return null;
    seen.add(key);
  }
  if (!seen.has(targetKey) || !seen.has("reserve")) return null;
  // 생략한 금액을 없는 셈 치거나 새 항목을 추가하는 수정으로 바꾸지 않는다.
  for (const key of Object.keys(progress)) {
    if (key.startsWith("__") || (!key.startsWith("custom_") && hidden.includes(key))) continue;
    const existing = currentBudgetRow(progress, key);
    if (existing && Number(existing.budget) > 0 && !seen.has(key)) return null;
  }
  return plan;
}

/** 현재 문장의 완결된 금액 목록만 읽는다. 권한·승인·실제 저장은 기존 pending 경계가 맡는다. */
export function parseExplicitBudgetPlanRequest(
  text: string,
  progress: Record<string, unknown> = {},
  currentTotalBudget?: number,
): ExplicitBudgetPlanInput | null {
  if (typeof text !== "string" || text.length > 4000 || /["'“”‘’`<>\p{Cf}]/u.test(text)) return null;
  if (/^기존\s+예산의/u.test(text.trim())) return parseExistingBudgetUpdate(text.trim(), progress, currentTotalBudget);
  return parseConfirmationBudgetPlan(text, progress, currentTotalBudget)
    ?? parseCompleteBudgetListing(text, progress, currentTotalBudget);
}

function parseCompleteBudgetListing(text: string, progress: Record<string, unknown>, currentTotalBudget?: number): ExplicitBudgetPlanInput | null {
  if (typeof text !== "string" || text.length > 4000
    || /["'“”‘’`<>\p{Cf}]/u.test(text)
    || /(?:예시|가정|대략|아마|나중|보류|하지\s*마|하지\s*말|말고|취소|삭제|지워)/u.test(text)) return null;

  const request = text.trim();
  const save = SAVE.exec(request);
  if (!save) return null;
  let listing = request.slice(0, save.index).trim();
  let declaredTotal: number | null = null;
  const total = TOTAL.exec(listing);
  if (total) {
    declaredTotal = Number(total[1].replaceAll(",", "")) * (total[2].startsWith("만") ? 10_000 : 1);
    if (!isValidWeddingWonAmount(declaredTotal)) return null;
    listing = listing.slice(total[0].length);
  }
  listing = listing.replace(/^(?:항목별 금액을 (?:다시 )?줄게[.!。]|예산 배분\s*:)\s*/u, "")
    .replace(/(?:이야|입니다|이에요|예요)?[.!。]?$/u, "").trim();
  // 쉼표는 금액의 천 단위 구분자일 수도 있으므로 부분 추출 없이 전체를 순서대로 소비한다.
  const entry = new RegExp(`([\\p{L}\\p{M}][\\p{L}\\p{M} \\t·ㆍ&+()/—–-]*?)\\s*:?\\s+(${NUMBER})\\s*(만\\s*원|원)?[ \\t]*(,|\\n|$)`, "uy");
  const rows: Array<{ label: string; value: number; unit: string | null }> = [];
  let offset = 0;
  while (offset < listing.length) {
    entry.lastIndex = offset;
    const match = entry.exec(listing);
    if (!match) return null;
    const label = match[1].replace(/\s+/gu, " ").trim();
    if (!label || label.length > 60 || /^(?:총|총액|총예산|합계)$/u.test(label)) return null;
    rows.push({ label, value: Number(match[2].replaceAll(",", "")), unit: match[3] ?? null });
    if (rows.length > 20) return null;
    offset = entry.lastIndex;
    if (match[4] && !listing.slice(offset).trim()) return null;
    while (offset < listing.length && /\s/u.test(listing[offset])) offset += 1;
  }
  if (rows.length < 2) return null;
  const lastUnit = rows.at(-1)!.unit;
  const allExplicit = rows.every(row => row.unit !== null);
  const lastOnly = lastUnit !== null && rows.slice(0, -1).every(row => row.unit === null);
  if (!allExplicit && !lastOnly) return null;
  const labels = rows.map(row => row.label.toLocaleLowerCase("ko-KR"));
  if (new Set(labels).size !== labels.length) return null;
  const existingCustomLabels = new Set(Object.entries(progress).flatMap(([key, value]) => {
    if (!key.startsWith("custom_") || value === null || typeof value !== "object"
      || Array.isArray(value) || !("label" in value) || typeof value.label !== "string") return [];
    return [value.label.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR")];
  }));
  const allocations = rows.map(row => {
    const budget = row.value * ((row.unit ?? lastUnit)!.startsWith("만") ? 10_000 : 1);
    // 기존 추가 항목은 이동하지 않는다. 키 재사용·중복 거절은 원자 저장기가 검증한다.
    // 새 항목은 구분점이 있어도 기본 이름과 정확히 같으면 같은 예산 항목에 연결한다.
    const category = existingCustomLabels.has(row.label.toLocaleLowerCase("ko-KR"))
      ? undefined
      : row.label === "예비비" ? "reserve" : FIXED_BY_LABEL.get(row.label);
    return category ? { category, budget } : { category: "custom", label: row.label, budget };
  });
  const fixedKeys = allocations.filter(row => row.category !== "custom").map(row => row.category);
  if (new Set(fixedKeys).size !== fixedKeys.length) return null;
  if (allocations.some(row => !isValidWeddingWonAmount(row.budget))) return null;
  const allocatedTotal = allocations.reduce((sum, row) => sum + row.budget, 0);
  if (!isValidWeddingWonAmount(allocatedTotal)
    || (declaredTotal !== null && declaredTotal !== allocatedTotal)) return null;
  // 일부 항목의 합계를 새 총예산으로 만들지 않는다. 생략한 기존 항목·예비비와
  // 배정 합계는 승인 미리보기와 같은 원자 저장기가 현재 값으로 다시 검증한다.
  const totalBudget = declaredTotal ?? (isValidWeddingWonAmount(currentTotalBudget) && currentTotalBudget > 0
    ? currentTotalBudget : allocatedTotal);
  if (totalBudget === 0) return null;
  return { total_budget: totalBudget, allocations, intake_summary: "현재 메시지에서 명시한 항목별 예산 배분" };
}
