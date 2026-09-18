import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AMORA_CHANGE_DETAILS,
  AMORA_CHANGE_REVIEW_COPY,
  AMORA_EXISTING_CUSTOM_CATEGORY_EFFECT,
  AMORA_UNKNOWN_CHANGE_DETAIL,
  type BudgetImpactPreview,
} from "@hanbang/shared";
import AmoraSaveSheet from "./AmoraSaveSheet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 웹 확인 창이 `@hanbang/shared` 의 도구별 분야·안내 표와 문구를 그대로 보여 주는가 (2026-09-18).
 *
 * 표가 웹 확인 창 안에만 있다가 앱 확인 시트와 함께 쓰려고 shared 로 옮겼다. 웹에서 보이는 글자는
 * 한 글자도 바뀌지 않아야 하고, 앞으로 한쪽만 고치면 이 검사가 갈라진 것을 잡는다.
 */
describe("웹 확인 창의 분야·안내는 shared 표에서 온다", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    document.body.style.overflow = "auto";
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  async function renderSheet(tool: string, extra: { inputDigest?: string; impactPreview?: BudgetImpactPreview | null } = {}) {
    await act(async () => root.render(
      <AmoraSaveSheet
        confirmation="확인문"
        tool={tool}
        disabled={false}
        busy={false}
        applyLabel="이대로 적용"
        applyAriaLabel="확인한 내용을 이대로 적용"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        onDefer={vi.fn()}
        {...extra}
      />,
    ));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    return dialog!.textContent ?? "";
  }

  it.each(Object.entries(AMORA_CHANGE_DETAILS))("%s 의 분야와 안내를 그대로 보여 준다", async (tool, detail) => {
    const text = await renderSheet(tool);
    expect(text).toContain(detail.category);
    expect(text).toContain(detail.effect);
    for (const copy of [
      AMORA_CHANGE_REVIEW_COPY.title,
      AMORA_CHANGE_REVIEW_COPY.description,
      AMORA_CHANGE_REVIEW_COPY.confirmationLabel,
      AMORA_CHANGE_REVIEW_COPY.reasonLabel,
      AMORA_CHANGE_REVIEW_COPY.reason,
      AMORA_CHANGE_REVIEW_COPY.categoryLabel,
      AMORA_CHANGE_REVIEW_COPY.scopeTitle,
      AMORA_CHANGE_REVIEW_COPY.scopeBody,
      AMORA_CHANGE_REVIEW_COPY.defer,
    ]) {
      expect(text).toContain(copy);
    }
  });

  it("예약·취소 도구는 아모라가 대신 하지 않는 일을 누르기 전에 말한다", async () => {
    expect(await renderSheet("update_venue")).toContain("예약을 대신 진행하지 않아요.");
    expect(await renderSheet("cancel_schedule_event")).toContain("업체 예약을 취소하지 않아요.");
  });

  it("표에 없는 도구는 반영할 수 없다고 말한다", async () => {
    const text = await renderSheet("book_vendor");
    expect(text).toContain(AMORA_UNKNOWN_CHANGE_DETAIL.category);
    expect(text).toContain(AMORA_UNKNOWN_CHANGE_DETAIL.effect);
  });

  it("묶인 미리보기가 기존 맞춤 항목 금액 변경이면 그렇게 부른다", async () => {
    const inputDigest = "a".repeat(64);
    const impactPreview: BudgetImpactPreview = {
      version: 1,
      kind: "budget_change",
      tool: "add_custom_category",
      inputDigest,
      sourceRevision: 3,
      recordedSpendBasis: "explicit_spent_only",
      current: { totalBudget: 50_000_000, allocatedBudget: 20_000_000, recordedSpend: 0, unallocatedBudget: 30_000_000 },
      proposed: { totalBudget: 50_000_000, allocatedBudget: 23_000_000, recordedSpend: 0, unallocatedBudget: 27_000_000 },
      delta: { totalBudget: 0, allocatedBudget: 3_000_000, recordedSpend: 0, unallocatedBudget: -3_000_000 },
      categories: [{ key: "custom_flowers", label: "플라워", currentBudget: 2_000_000, proposedBudget: 5_000_000, currentRecordedSpend: 0, proposedRecordedSpend: 0 }],
      warnings: [],
    };
    const text = await renderSheet("add_custom_category", { inputDigest, impactPreview });
    expect(text).toContain(AMORA_EXISTING_CUSTOM_CATEGORY_EFFECT);
    expect(text).not.toContain(AMORA_CHANGE_DETAILS.add_custom_category.effect);
    // 다른 입력에 묶인 미리보기는 믿지 않는다 — 새 항목 안내로 돌아간다.
    const unbound = await renderSheet("add_custom_category", { inputDigest: "b".repeat(64), impactPreview });
    expect(unbound).toContain(AMORA_CHANGE_DETAILS.add_custom_category.effect);
  });
});
