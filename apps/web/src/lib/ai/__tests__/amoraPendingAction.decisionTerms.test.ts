import { describe, expect, it } from "vitest";

import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import {
  extractAmoraPendingAction,
  resolveAmoraPendingAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { BUDGET_CATEGORY_KEYS, WEDDING_TOOLS } from "@/lib/ai/tools";

/**
 * 확인 카드의 분야 이름 경계.
 *
 * 2026-09-08 ~ 09-15 에는 모델 문맥용 원명칭(예단·폐백)이 카드에도 실렸다. 그런데 카드는
 * 사용자가 예산 화면과 나란히 읽는 문장이라, 카드의 "예단" 과 화면의 "두 가족에게 드릴
 * 선물" 이 같은 항목인지 알 수 없었다. 2026-09-15 부터 카드는 화면 이름으로 발급한다.
 * 이 파일은 원래 "새 카드는 원명칭" 을 고정했는데, 제품 규칙(사용자에게 보이는 분야
 * 이름 = PLANNING_CATEGORY_LABELS)에 맞춰 뒤집었다. 이미 발급된 두 세대 문장은 만료 전까지
 * 그대로 확인할 수 있어야 한다.
 */
const NOW = Date.parse("2026-09-08T00:00:00.000Z");
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const screenNames = { yedan: "두 가족에게 드릴 선물", pyebaek: "결혼식 뒤 전통 인사" };
const decisionTermNames = { yedan: "예단", pyebaek: "폐백" };
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

function fieldListConfirmation(names: Record<"yedan" | "pyebaek", string>, category: "yedan" | "pyebaek"): string {
  return [
    "다음 변경을 적용할까요?",
    "- 변경: 카테고리 예산·기록 지출 변경",
    "- 카테고리: " + names[category],
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
function nestedFieldListConfirmation(names: Record<"yedan" | "pyebaek", string>): string {
  return [
    "다음 변경을 적용할까요?",
    "- 변경: 예산 배분안 적용",
    "- 총 예산: 120만 원",
    `- 카테고리별 배분: 1) 카테고리: ${names.yedan}, 예산: 50만 원 / 2) 카테고리: ${names.pyebaek}, 예산: 70만 원`,
    '- 배분 근거: "두 가족에게 드릴 선물과 결혼식 뒤 전통 인사는 별도로 논의"',
  ].join("\n");
}

describe("확인 카드의 분야 이름과 이전 발급문 경계", () => {
  it.each(["yedan", "pyebaek"] as const)("새 %s 확인문은 예산 화면 이름으로 발급하고 그대로 확인한다", (category) => {
    const action = issue("update_category_budget", { category, budget: 500_000 });
    expect(action.confirmation).toBe(fieldListConfirmation(screenNames, category));
    expect(action.confirmation).not.toContain(decisionTermNames[category]);
    expect(resolve(action)).toEqual(action);
  });

  it.each(["yedan", "pyebaek"] as const)("이미 발급된 %s의 두 세대 이전 확인문은 입력·이름을 바꾸지 않고 읽는다", (category) => {
    const action = issue("update_category_budget", { category, budget: 500_000 });
    for (const names of [decisionTermNames, screenNames]) {
      const stored = { ...action, confirmation: fieldListConfirmation(names, category) };
      expect(resolve(stored)).toEqual(stored);
    }
  });

  it("새 예산안은 화면 이름으로 한 줄씩 적고, 이전 필드 목록 문장은 전체 문자열만 호환한다", () => {
    const action = issue("apply_budget_plan", nestedInput);
    expect(action.confirmation).toBe([
      "다음 예산안을 적용할까요?",
      "- 총예산: 120만 원",
      "- 두 가족에게 드릴 선물: 50만 원",
      "- 결혼식 뒤 전통 인사: 70만 원",
      "- 말하지 않은 항목의 배정은 그대로 둬요",
    ].join("\n"));
    // 모델이 쓴 배분 근거는 확인 대상이 아니다 — 저장되지도 않는다.
    expect(action.confirmation).not.toContain("별도로 논의");
    for (const names of [decisionTermNames, screenNames]) {
      const legacy = { ...action, confirmation: nestedFieldListConfirmation(names) };
      expect(resolve(legacy)).toEqual(legacy);
    }
    // 신구 이름을 한 문장에 섞은 것은 서버가 발급한 적이 없다.
    expect(resolve({
      ...action,
      confirmation: nestedFieldListConfirmation(screenNames).replace("카테고리: 두 가족에게 드릴 선물,", "카테고리: 예단,"),
    })).toBeNull();
    expect(resolve({
      ...action,
      confirmation: action.confirmation.replace("- 두 가족에게 드릴 선물:", "- 예단:"),
    })).toBeNull();
  });

  it("이전 이름 호환으로 금액·내용·입력·해시·수명 검증을 느슨하게 만들지 않는다", () => {
    const action = issue("update_category_budget", { category: "yedan", budget: 500_000 });
    const legacy = { ...action, confirmation: fieldListConfirmation(decisionTermNames, "yedan") };
    for (const value of [
      { ...legacy, confirmation: legacy.confirmation.replace("50만 원", "5만 원") },
      { ...legacy, confirmation: legacy.confirmation + "\n다른 가족 선물도 모두 생략해요." },
      { ...legacy, confirmation: legacy.confirmation.replace("예단", "모든 가족 선물") },
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

  it("카테고리 필드만 화면 이름으로 바꾸고 사용자 제목·메모는 원문 그대로 둔다", () => {
    const title = "예단 대신 두 가족에게 드릴 선물 별도 논의";
    const memo = "폐백과 결혼식 뒤 전통 인사는 같은 범위로 정한 것이 아님";
    const action = issue("add_schedule_event", {
      date: "2026-10-20", title, memo, category_key: "yedan", schedule_scope: "confirmed_fact",
    });
    expect(action.confirmation).toContain('- 제목: "' + title + '"');
    expect(action.confirmation).toContain('- 메모: "' + memo + '"');
    expect(action.confirmation).toContain("- 관련 카테고리: 두 가족에게 드릴 선물");
    expect(action.input.title).toBe(title);
    expect(action.input.memo).toBe(memo);
    expect(resolve(action)).toEqual(action);
  });

  it("모든 고정 예산 항목의 카드 이름이 예산 화면 이름과 같다", () => {
    for (const category of BUDGET_CATEGORY_KEYS) {
      const action = issue("update_category_budget", { category, budget: 500_000 });
      expect(action.confirmation).toContain("- 카테고리: " + displayLabels[category]);
      expect(resolve(action)).toEqual(action);
    }
  });
});
