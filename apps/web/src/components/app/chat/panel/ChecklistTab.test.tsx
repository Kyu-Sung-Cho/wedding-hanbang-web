import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import ChecklistTab from "./ChecklistTab";

/**
 * 채팅 옆 체크리스트 탭의 상태 이름 (2026-09-15).
 *
 * 이 탭만 "진행중·시작전·해당 없음" 으로 적어, 예산 화면에서 "준비 중·아직·안 해요" 로 보던
 * 같은 분야가 여기서는 다른 말로 보였다. 상태 이름은 정본 한 벌을 쓴다.
 */

const fixture = vi.hoisted(() => ({ journey: { progress: {} as Record<string, unknown> } }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => fixture }));

let container: HTMLDivElement;
let root: Root;
const categoryLabel = (key: string) => CATEGORY_CHECKLISTS.find((item) => item.key === key)!.label;

function row(label: string) {
  const labelNode = Array.from(container.querySelectorAll("span")).find((node) => node.textContent === label);
  expect(labelNode, `checklist row ${label}`).toBeDefined();
  return labelNode!.closest("button")!;
}

async function openSection(title: string) {
  const trigger = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.startsWith(title));
  expect(trigger, `section ${title}`).toBeDefined();
  await act(async () => trigger!.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.journey = {
    progress: {
      venue: { category: "venue", status: "in_progress" },
      studio: { category: "studio", status: "completed" },
      pyebaek: { category: "pyebaek", status: "not_applicable" },
    },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("채팅 체크리스트 탭의 상태 이름", () => {
  it("예산 화면과 같은 네 이름을 쓴다", async () => {
    await act(async () => root.render(<ChecklistTab />));
    expect(row(categoryLabel("venue")).textContent).toContain(PREPARATION_PROGRESS_STATUS_LABELS.in_progress);
    expect(row(categoryLabel("dress")).textContent).toContain(PREPARATION_PROGRESS_STATUS_LABELS.not_started);

    await openSection(PREPARATION_PROGRESS_STATUS_LABELS.completed);
    expect(row(categoryLabel("studio")).textContent).toContain(PREPARATION_PROGRESS_STATUS_LABELS.completed);

    await openSection(PREPARATION_PROGRESS_STATUS_LABELS.not_applicable);
    expect(row(categoryLabel("pyebaek")).textContent).toContain(PREPARATION_PROGRESS_STATUS_LABELS.not_applicable);
    expect(row(categoryLabel("pyebaek")).textContent).not.toContain(PREPARATION_PROGRESS_STATUS_LABELS.completed);

    expect(container.textContent).not.toMatch(/진행중|시작전|해당 없음/);
  });
});
