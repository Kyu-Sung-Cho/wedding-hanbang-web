import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import ActionCard from "./ActionCard";
import type { ToolExecutionResult } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const receipt = (): ToolExecutionResult => ({
  toolName: "add_decision_record",
  toolInput: { title: "미리보기 제목", status: "decided" },
  toolOutput: {
    verified: true,
    decision: {
      id: "12345678-1234-4234-8234-123456789abc",
      title: "상견례 장소 후보 비교",
      status: "considering",
      memo: "양가 이동 거리를 먼저 확인하기로 했어요.",
      category_key: "meeting",
      created_at: "2026-09-20T01:00:00.000Z",
    },
  },
  success: true,
  displayMessage: "저장했어요.",
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("shows the saved decision title and actual discussion status with a decision-only board link", async () => {
  await act(async () => root.render(<ActionCard result={receipt()} />));
  expect(container.textContent).toContain("상견례 장소 후보 비교");
  expect(container.textContent).toContain("논의 중");
  expect(container.textContent).toContain("양가 이동 거리를 먼저 확인하기로 했어요.");
  expect(container.textContent).toContain("두 사람의 합의를 뜻하지 않아요");
  expect(container.textContent).not.toContain("미리보기 제목");
  const link = container.querySelector("a");
  expect(link?.textContent).toBe("결정 기록 보기");
  expect(link?.getAttribute("href")).toBe("/wedding/chat/board?view=decisions");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.textContent).not.toContain("공유 할 일");
});

it.each([
  { ...receipt().toolOutput, verified: false },
  { verified: true, decision: null },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, status: "completed" } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, title: "" } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, memo: "x".repeat(1001) } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, title: "x".repeat(161) } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, id: "not-an-id" } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, created_at: "not-a-date" } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, memo: undefined } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, category_key: "https://untrusted.example" } },
  { verified: true, decision: { ...receipt().toolOutput.decision as object, category_key: "invented_category" } },
])("does not promote an unverified or malformed result into a saved decision", async toolOutput => {
  await act(async () => root.render(<ActionCard result={{ ...receipt(), toolOutput }} />));
  expect(container.textContent).toContain("저장 여부를 확인하지 못했어요");
  expect(container.textContent).not.toContain("상태로 저장했어요");
  expect(container.textContent).not.toContain("상견례 장소 후보 비교");
  expect(container.querySelector('[class~="text-[var(--hb-success)]"]')).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/wedding/chat/board?view=decisions");
});

it("ignores success prose and receipt-shaped output on a failed operation", async () => {
  await act(async () => root.render(<ActionCard result={{ ...receipt(), success: false }} />));
  expect(container.textContent).toContain("결정 기록을 저장하지 못했어요");
  expect(container.textContent).not.toContain("상태로 저장했어요");
  expect(container.querySelector('[class~="text-[var(--hb-success)]"]')).toBeNull();
});

it.each([
  { error: "TOOL_EXECUTION_UNCERTAIN", requires_state_review: true },
  { error: "TOOL_EXECUTION_UNCERTAIN" },
  { requires_state_review: true },
])("keeps an uncertain commit neutral and directs reconciliation, not another save: %j", async toolOutput => {
  await act(async () => root.render(<ActionCard result={{ ...receipt(), success: false, toolOutput }} />));
  expect(container.textContent).toContain("저장 여부를 확인하지 못했어요");
  expect(container.textContent).toContain("결정 기록에서 확인해 주세요");
  expect(container.textContent).not.toMatch(/저장하지 못했어요|다시 시도|상태로 저장했어요/);
  expect(container.querySelector('[class~="text-danger-700"]')).toBeNull();
  expect(container.querySelector('[class~="text-[var(--hb-success)]"]')).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/wedding/chat/board?view=decisions");
});

it.each([
  ["TOOL_EXECUTION_IN_PROGRESS", false], ["TOOL_EXECUTION_IN_PROGRESS", true],
  ["TOOL_LEDGER_RESULT_INVALID", false], ["TOOL_LEDGER_RESULT_INVALID", true],
] as const)("keeps %s neutral even when success is %s and ignores contradictory receipt data", async (error, success) => {
  const toolOutput = success ? { ...receipt().toolOutput, error } : { error };
  await act(async () => root.render(<ActionCard result={{ ...receipt(), success, toolOutput }} />));
  expect(container.textContent).toContain("저장 여부를 확인하지 못했어요");
  expect(container.textContent).not.toMatch(/저장하지 못했어요|다시 시도|상태로 저장했어요|상견례 장소 후보 비교/);
  expect(container.querySelector('[class~="text-danger-700"]')).toBeNull();
  expect(container.querySelector('[class~="text-[var(--hb-success)]"]')).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/wedding/chat/board?view=decisions");
});

it.each([["exploring", "미정"], ["decided", "확정"]])("preserves the %s state without turning it into another decision state", async (status, label) => {
  const result = receipt();
  result.toolOutput.decision = { ...result.toolOutput.decision as object, status, memo: null };
  await act(async () => root.render(<ActionCard result={result} />));
  expect(container.textContent).toContain(`${label} 상태로 저장했어요.`);
});

it("labels read-only decision lookup as a lookup rather than a completed mutation", async () => {
  await act(async () => root.render(<ActionCard result={{
    toolName: "get_decision_records", toolInput: {}, toolOutput: { records: [] },
    success: true, displayMessage: "저장된 결정 기록이 없어요.",
  }} />));
  expect(container.textContent).toContain("결정 기록 조회");
  expect(container.textContent).not.toContain("작업 완료");
  expect(container.textContent).not.toContain("상태로 저장했어요");
});
