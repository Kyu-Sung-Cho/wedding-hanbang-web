import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

export type ExplicitBudgetPlanInput = {
  total_budget: number;
  allocations: Array<{ category: string; label?: string; budget: number }>;
  intake_summary: string;
};

const NUMBER = "(?:[1-9]\\d{0,2}(?:,\\d{3})+|0|[1-9]\\d*)";
const TOTAL = new RegExp(`^총(?:예산|액)?\\s*(${NUMBER})\\s*(만\\s*원|원)\\s*[.。:\\n]\\s*`, "u");
const SAVE = /\s*(?:이대로\s*)?(?:실제\s*)?예산(?:표)?에\s*(?:반영|적용|저장)해\s*(?:줘|주세요)[.!。]?$/u;
const FIXED_BY_LABEL = new Map(Object.entries(PLANNING_CATEGORY_LABELS)
  .filter(([key]) => key !== "greeting" && key !== "registration")
  .map(([key, label]) => [label as string, key]));

/** 현재 문장의 완결된 금액 목록만 읽는다. 권한·승인·실제 저장은 기존 pending 경계가 맡는다. */
export function parseExplicitBudgetPlanRequest(
  text: string,
  progress: Record<string, unknown> = {},
): ExplicitBudgetPlanInput | null {
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
  const totalBudget = allocations.reduce((sum, row) => sum + row.budget, 0);
  if (!isValidWeddingWonAmount(totalBudget) || totalBudget === 0
    || (declaredTotal !== null && declaredTotal !== totalBudget)) return null;
  return { total_budget: totalBudget, allocations, intake_summary: "현재 메시지에서 명시한 항목별 예산 배분" };
}
