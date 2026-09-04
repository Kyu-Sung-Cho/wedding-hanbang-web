import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActionCard from "./ActionCard";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// A user-facing failure message must not disappear merely because its structured output is empty.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: null, updateJourney: vi.fn() }),
}));

describe("ActionCard actionable failures", () => {
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

  it("replaces a legacy schedule failure ID with actionable consumer copy even when toolOutput is empty", async () => {
    const eventId = "018f4dc8-3ac1-7f31-9c45-1b8b46bf6e89";
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "update_schedule_event",
            toolInput: { event_id: eventId },
            toolOutput: {},
            success: false,
            displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("일정 변경");
    expect(container.textContent).toContain("일정 목록을 새로 불러온 뒤 다시 선택해 주세요");
    expect(container.textContent).not.toContain(eventId);
    expect(container.textContent).not.toContain("ID:");
  });

  it.each([
    [
      "delete_schedule_event",
      "event_id",
      "018f4dc8-3ac1-7f31-9c45-1b8b46bf6e90",
      "일정 삭제는 지원하지 않아요",
    ],
    [
      "toggle_checklist_item",
      "item_id",
      "018f4dc8-3ac1-7f31-9c45-1b8b46bf6e91",
      "변경할 체크리스트 항목을 찾지 못했어요",
    ],
  ] as const)("never renders the internal ID from %s", async (toolName, idKey, internalId, expected) => {
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName,
            toolInput: { [idKey]: internalId },
            toolOutput: {},
            success: false,
            displayMessage: `항목을 찾을 수 없습니다 (ID: ${internalId})`,
          }}
        />,
      );
    });

    expect(container.textContent).toContain(expected);
    expect(container.textContent).toContain("다시 선택해 주세요");
    expect(container.textContent).not.toContain(internalId);
    expect(container.textContent).not.toContain("ID:");
  });

  it("fails safe when an unknown tool failure contains an internal ID", async () => {
    const internalId = "018f4dc8-3ac1-7f31-9c45-1b8b46bf6e92";
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "future_schedule_tool",
            toolInput: { event_id: internalId },
            toolOutput: {},
            success: false,
            displayMessage: `처리할 항목이 없습니다 (ID: ${internalId})`,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("목록을 새로 불러온 뒤 다시 시도해 주세요");
    expect(container.textContent).not.toContain(internalId);
    expect(container.textContent).not.toContain("ID:");
  });

  it.each([
    ["booking_id", "booking_018f4dc83ac17f31"],
    ["action_id", "act_018f4dc83ac17f31"],
  ] as const)("redacts an unknown %s identifier even without an ID label", async (idKey, internalId) => {
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "future_tool",
            toolInput: { [idKey]: internalId },
            toolOutput: {},
            success: false,
            displayMessage: `처리하지 못한 항목 ${internalId}`,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("목록을 새로 불러온 뒤 다시 시도해 주세요");
    expect(container.textContent).not.toContain(internalId);
  });

  it("does not use a successful checklist item's internal ID as its visible label", async () => {
    const internalId = "018f4dc8-3ac1-7f31-9c45-1b8b46bf6e93";
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "toggle_checklist_item",
            toolInput: { category: "venue", item_id: internalId, done: true },
            toolOutput: { done: true },
            success: true,
            displayMessage: `체크리스트 ${internalId} 변경을 완료했어요.`,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("체크리스트 항목");
    expect(container.textContent).toContain("요청한 작업을 완료했어요");
    expect(container.textContent).not.toContain(internalId);
  });

  // 2026-09-04: 설명 없는 실패를 숨기면 사용자는 아모라의 산문만 보고 저장된 줄 안다.
  // 이제 한 장은 남긴다 — 내부 식별자 없는 일반 문구로.
  it("shows a silent internal failure as a generic failure card", async () => {
    await act(async () => {
      root.render(
        <ActionCard
          result={{
            toolName: "update_schedule_event",
            toolInput: { event_id: "missing-event" },
            toolOutput: {},
            success: false,
            displayMessage: "",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("요청한 항목을 찾지 못했어요");
    expect(container.textContent).not.toContain("missing-event");
  });
});
