import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import ActionCard from "./ActionCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows uncertain budget outcomes neutrally and offers state review, never retry or success", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ActionCard result={{ toolName: "update_budget", toolInput: {},
      toolOutput: { error: "TOOL_EXECUTION_UNCERTAIN" }, success: false, displayMessage: "저장했어요" }} />));
    expect(container.textContent).toContain("반영 여부를 확인하지 못했어요");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/budget");
    expect(container.textContent).not.toMatch(/저장했어요|다시 시도|반영되지/);
    expect(container.querySelector(".lucide-circle-x, .lucide-circle-check")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
it.each([
  { error: "TOOL_EXECUTION_IN_PROGRESS" }, { error: "TOOL_LEDGER_RESULT_INVALID" }, { requires_state_review: true },
].flatMap(toolOutput => [false, true].map(success => ({ toolOutput, success }))))("unknown metadata overrides a contradictory schedule result: %j", async ({ toolOutput, success }) => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<ActionCard result={{ toolName: "add_schedule_event", toolInput: {}, toolOutput, success, displayMessage: "성공했어요" }} />));
    expect(container.textContent).toContain("반영 확인 필요");
    expect(container.textContent).not.toContain("성공했어요");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/schedule");
  } finally { await act(async () => root.unmount()); }
});
it("keeps a definite rejection a failure rather than treating any error as uncertain", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<ActionCard result={{ toolName: "update_budget", toolInput: {}, toolOutput: { error: "AMORA_ATOMIC_INVALID", requires_state_review: "true" }, success: false, displayMessage: "변경할 수 없어요" }} />));
    expect(container.textContent).toContain("변경할 수 없어요");
    expect(container.textContent).not.toContain("반영 확인 필요");
  } finally { await act(async () => root.unmount()); }
});
