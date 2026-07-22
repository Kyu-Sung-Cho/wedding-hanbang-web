import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";
import type { ToolExecutionResult } from "@/types/database.types";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// Every known non-vendor tool needs an honest operation title instead of the generic "작업 완료".

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: null, updateJourney: vi.fn() }),
}));

const EXPECTED_TITLES: Record<string, string> = {
  apply_budget_plan: "예산안 적용",
  add_custom_category: "예산 항목 추가",
  delete_category: "예산 항목 삭제",
  reset_category: "예산 항목 초기화",
  add_schedule_event: "일정 추가",
  update_schedule_event: "일정 변경",
  delete_schedule_event: "일정 삭제",
  get_schedule_events: "등록 일정",
  log_wedding_event: "웨딩 일정 기록",
  get_my_bookings: "예약 현황",
  get_market_price: "결혼 비용 시세",
};

function result(toolName: string): ToolExecutionResult {
  return {
    toolName,
    toolInput: {},
    toolOutput: { value: true },
    success: true,
    displayMessage: "도구 결과입니다.",
  };
}

describe("ActionCard known tool titles", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it.each(Object.entries(EXPECTED_TITLES))(
    "labels %s as %s",
    async (toolName, expectedTitle) => {
      await act(async () => {
        root.render(<ActionCard result={result(toolName)} />);
      });

      expect(container.textContent).toContain(expectedTitle);
      expect(container.textContent).not.toContain("작업 완료");
    },
  );
});
