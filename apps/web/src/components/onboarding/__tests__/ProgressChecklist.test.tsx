// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREPARATION_PROGRESS_STATUS_OPTIONS } from "@hanbang/shared";
import ProgressChecklist from "@/components/onboarding/ProgressChecklist";
import {
  PROGRESS_CHECKLIST_ITEMS,
  type ChecklistStatus,
} from "@/types/onboarding.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function rowButtons(container: HTMLElement, key: string): HTMLButtonElement[] {
  const index = PROGRESS_CHECKLIST_ITEMS.findIndex((item) => item.key === key);
  const rows = container.querySelectorAll<HTMLElement>("div.rounded-xl.border");
  return Array.from(rows[index].querySelectorAll("button"));
}

describe("ProgressChecklist 상태 어휘", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("공유 정본의 네 가지 상태를 모든 항목에 그린다", async () => {
    await act(async () =>
      root.render(
        <ProgressChecklist
          items={PROGRESS_CHECKLIST_ITEMS}
          onStatusChange={() => {}}
          onCostChange={() => {}}
        />,
      ),
    );

    const labels = PREPARATION_PROGRESS_STATUS_OPTIONS.map(({ label }) => label);
    expect(labels).toEqual(["아직", "준비 중", "완료", "안 해요"]);
    for (const item of PROGRESS_CHECKLIST_ITEMS) {
      expect(rowButtons(container, item.key).map((button) => button.textContent))
        .toEqual(labels);
    }
    // 앱과 갈라져 있던 "예정"은 화면에서 사라졌다.
    expect(container.textContent).not.toContain("예정");
  });

  it('"안 해요"를 고르고 다시 "아직"으로 되돌릴 수 있다', async () => {
    const onStatusChange = vi.fn<(key: string, status: ChecklistStatus) => void>();

    await act(async () =>
      root.render(
        <ProgressChecklist
          items={PROGRESS_CHECKLIST_ITEMS.map((item) =>
            item.key === "ham" ? { ...item, status: "not_applicable" } : item,
          )}
          onStatusChange={onStatusChange}
          onCostChange={() => {}}
        />,
      ),
    );

    const [notStarted, , , notApplicable] = rowButtons(container, "ham");
    await act(async () => notApplicable.click());
    expect(onStatusChange).toHaveBeenLastCalledWith("ham", "not_applicable");

    await act(async () => notStarted.click());
    expect(onStatusChange).toHaveBeenLastCalledWith("ham", "not_started");
  });
});
