import { describe, expect, it } from "vitest";

import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import {
  extractAmoraPendingAction,
  resolveAmoraPendingAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { BUDGET_CATEGORY_KEYS, WEDDING_TOOLS } from "@/lib/ai/tools";

const NOW = Date.parse("2026-09-08T00:00:00.000Z");
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const legacyNames = { yedan: "두 가족에게 드릴 선물", pyebaek: "결혼식 뒤 전통 인사" };
const canonicalNames = { yedan: "예단", pyebaek: "폐백" };
const displayLabels: Readonly<Record<string, string>> = PLANNING_CATEGORY_LABELS;

function issue(tool: string, input: Record<string, unknown>): StoredAmoraPendingAction {
  const action = extractAmoraPendingAction({
    text: "[pending_action]" + JSON.stringify({ tool, input }) + "[/pending_action]",
    allowedTools: WEDDING_TOOLS,
    now: NOW,
    createActionId: () => ACTION_ID,
  }).pendingAction;
  expect(action).not.toBeNull();
  return action!;
}

function resolve(value: unknown, now = NOW + 1) {
  return resolveAmoraPendingAction({
    value,
    confirmedActionId: ACTION_ID,
    allowedTools: WEDDING_TOOLS,
    now,
  });
}

function legacyConfirmation(category: keyof typeof legacyNames): string {
  return [
    "다음 변경을 적용할까요?",
    "- 변경: 카테고리 예산·기록 지출 변경",
    "- 카테고리: " + legacyNames[category],
    "- 예산: 50만 원",
  ].join("\n");
}

const nestedInput = {
  total_budget: 1_200_000,
  allocations: [
    { category: "yedan", budget: 500_000 },
    { category: "pyebaek", budget: 700_000 },
  ],
  intake_summary: "두 가족에게 드릴 선물과 결혼식 뒤 전통 인사는 별도로 논의",
};
const legacyNestedConfirmation = [
  "다음 변경을 적용할까요?",
  "- 변경: 예산 배분안 적용",
  "- 총 예산: 120만 원",
  "- 카테고리별 배분: 1) 카테고리: 두 가족에게 드릴 선물, 예산: 50만 원 / 2) 카테고리: 결혼식 뒤 전통 인사, 예산: 70만 원",
  '- 배분 근거: "두 가족에게 드릴 선물과 결혼식 뒤 전통 인사는 별도로 논의"',
].join("\n");

describe("확인 카드의 결정 항목명과 이전 발급문 경계", () => {
  it.each(["yedan", "pyebaek"] as const)("새 %s 확인문은 정본명으로 발급하고 그대로 확인한다", (category) => {
    const action = issue("update_category_budget", { category, budget: 500_000 });
    expect(action.confirmation).toContain("- 카테고리: " + canonicalNames[category]);
    expect(action.confirmation).not.toContain(legacyNames[category]);
    expect(resolve(action)).toEqual(action);
  });

  it.each(["yedan", "pyebaek"] as const)("이미 발급된 %s의 정확한 이전 확인문은 입력·이름을 바꾸지 않고 읽는다", (category) => {
    const action = issue("update_category_budget", { category, budget: 500_000 });
    const stored = { ...action, confirmation: legacyConfirmation(category) };
    expect(resolve(stored)).toEqual(stored);
  });

  it("기존 2개 항목 배분 확인문의 전체 문자열만 호환하고 신구 이름을 섞은 문장은 거절한다", () => {
    const action = issue("apply_budget_plan", nestedInput);
    expect(action.confirmation).toContain("카테고리: 예단, 예산: 50만 원");
    expect(action.confirmation).toContain("카테고리: 폐백, 예산: 70만 원");
    expect(action.confirmation).toContain('- 배분 근거: "' + nestedInput.intake_summary + '"');
    const legacy = { ...action, confirmation: legacyNestedConfirmation };
    expect(resolve(legacy)).toEqual(legacy);
    expect(resolve({
      ...legacy,
      confirmation: legacyNestedConfirmation.replace("카테고리: 두 가족에게 드릴 선물,", "카테고리: 예단,"),
    })).toBeNull();
  });

  it("이전 이름 호환으로 금액·내용·입력·해시·수명 검증을 느슨하게 만들지 않는다", () => {
    const action = issue("update_category_budget", { category: "yedan", budget: 500_000 });
    const legacy = { ...action, confirmation: legacyConfirmation("yedan") };
    for (const value of [
      { ...legacy, confirmation: legacy.confirmation.replace("50만 원", "5만 원") },
      { ...legacy, confirmation: legacy.confirmation + "\n다른 가족 선물도 모두 생략해요." },
      { ...legacy, confirmation: legacy.confirmation.replace("두 가족에게 드릴 선물", "모든 가족 선물") },
      { ...legacy, confirmation: legacy.confirmation + " " },
      { ...legacy, input: { category: "pyebaek", budget: 500_000 } },
      { ...legacy, input: { category: "yedan", budget: 700_000 } },
      { ...legacy, inputDigest: "a".repeat(64) },
      { ...legacy, operationKey: "b".repeat(64) },
      { ...legacy, expiresAt: legacy.expiresAt + 1 },
      { ...legacy, version: 1 },
    ]) expect(resolve(value)).toBeNull();
    expect(resolve(legacy, legacy.expiresAt)).toBeNull();
  });

  it("카테고리 필드만 변환하고 사용자 제목·메모·배분 근거는 원문 그대로 둔다", () => {
    const title = "예단 대신 두 가족에게 드릴 선물 별도 논의";
    const memo = "폐백과 결혼식 뒤 전통 인사는 같은 범위로 정한 것이 아님";
    const action = issue("add_schedule_event", {
      date: "2026-10-20", title, memo, category_key: "yedan", schedule_scope: "confirmed_fact",
    });
    expect(action.confirmation).toContain('- 제목: "' + title + '"');
    expect(action.confirmation).toContain('- 메모: "' + memo + '"');
    expect(action.confirmation).toContain("- 관련 카테고리: 예단");
    expect(action.input.title).toBe(title);
    expect(action.input.memo).toBe(memo);
    expect(resolve(action)).toEqual(action);
  });

  it("예단·폐백 외의 모든 기존 예산 항목명은 바꾸지 않는다", () => {
    for (const category of BUDGET_CATEGORY_KEYS.filter((key) => key !== "yedan" && key !== "pyebaek")) {
      const action = issue("update_category_budget", { category, budget: 500_000 });
      expect(action.confirmation).toContain("- 카테고리: " + displayLabels[category]);
      expect(resolve(action)).toEqual(action);
    }
  });
});
