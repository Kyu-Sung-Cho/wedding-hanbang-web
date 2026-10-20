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

// ⚠️ 행을 `div.rounded-xl.border` 로 찾고 있었다. **모서리는 스타일이지 표식이 아니다** —
// 2026-08-30 모서리를 시안에 맞추자 이 선택자가 아무것도 못 찾아 `rows[index]` 가
// undefined 로 터졌다. 검사하려던 것은 상태 어휘인데 스타일 바뀜에 깨진 것이다.
// 컴포넌트에 `data-checklist-row` 를 두고 그것으로 찾는다.
function rowButtons(container: HTMLElement, key: string): HTMLButtonElement[] {
  const row = container.querySelector<HTMLElement>(`[data-checklist-row="${key}"]`);
  if (!row) throw new Error(`체크리스트 행을 못 찾았다: ${key}`);
  return Array.from(row.querySelectorAll("button"));
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

  it("예식 형태 빠른 선택 버튼이 진행 중·완료 항목은 보존하고 미시작 생략 항목만 '안 해요'로 표시한다", async () => {
    const onStatusChange = vi.fn<(key: string, status: ChecklistStatus) => void>();

    await act(async () =>
      root.render(
        <ProgressChecklist
          items={PROGRESS_CHECKLIST_ITEMS.map((item) =>
            item.key === "venue" ? { ...item, status: "in_progress" } : item,
          )}
          onStatusChange={onStatusChange}
          onCostChange={() => {}}
        />,
      ),
    );

    const presetBox = container.querySelector('[data-testid="onboarding-ceremony-format-presets"]');
    expect(presetBox).not.toBeNull();
    const noWeddingBtn = Array.from(presetBox!.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("노웨딩"),
    );
    expect(noWeddingBtn).toBeDefined();

    await act(async () => noWeddingBtn!.click());
    // 이미 준비 중인 결혼식장(venue)은 덮어쓰지 않는다.
    expect(onStatusChange).not.toHaveBeenCalledWith("venue", "not_applicable");
    // 미시작 생략 항목들은 '안 해요'로 전환 호출된다.
    expect(onStatusChange).toHaveBeenCalledWith("snap", "not_applicable");
    expect(onStatusChange).toHaveBeenCalledWith("pyebaek", "not_applicable");
    expect(onStatusChange).toHaveBeenCalledWith("ham", "not_applicable");
  });
});
