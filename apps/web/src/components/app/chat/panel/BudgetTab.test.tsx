import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import BudgetTab from "./BudgetTab";

const fixture = vi.hoisted(() => ({ journey: { total_budget: 30_000_000, progress: {} as Record<string, unknown> } }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => fixture }));

let container: HTMLDivElement;
let root: Root;
const categoryLabel = (key: string) => CATEGORY_CHECKLISTS.find((item) => item.key === key)!.label;
function row(label: string) {
  const labelNode = Array.from(container.querySelectorAll("span")).find((node) => node.textContent === label);
  expect(labelNode, `budget row ${label}`).toBeDefined();
  return labelNode!.parentElement!.parentElement!;
}
async function showCompleted() {
  const trigger = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("완료·해당 없음"));
  expect(trigger).toBeDefined();
  await act(async () => trigger!.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.journey = { total_budget: 30_000_000, progress: {
    venue: { category: "venue", status: "completed", budget: 12_000_000, spent: 1_000_000 },
    reserve: { category: "reserve", status: "not_started", budget: 4_000_000, spent: 200_000 },
    custom_photo: { category: "custom_photo", label: "포토부스", status: "in_progress", budget: 800_000, spent: 100_000 },
  } };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the chat budget panel reflects recorded journey allocations", () => {
  it("keeps completed-category allocation and recorded spend separately visible", async () => {
    await act(async () => root.render(<BudgetTab />));
    await showCompleted();
    const venue = row(categoryLabel("venue"));
    expect(venue.textContent).toContain("배정 1,200만원");
    expect(venue.textContent).toContain("기록 100만원");
    expect(venue.textContent).toContain("완료");
  });

  it("lists the stored reserve and custom name with the same total spend as the budget page", async () => {
    await act(async () => root.render(<BudgetTab />));
    expect(row(PLANNING_CATEGORY_LABELS.reserve).textContent).toContain("배정 400만원");
    expect(row("포토부스").textContent).toContain("배정 80만원");
    expect(row("포토부스").textContent).toContain("기록 10만원");
    expect(container.textContent).toContain("총 예산3,000만원");
    expect(container.textContent).toContain("기록 지출130만원");
  });

  it("matches the budget page by hiding fixed rows while retaining custom rows and their spend", async () => {
    fixture.journey.progress.__hidden = ["venue", "custom_photo"];
    await act(async () => root.render(<BudgetTab />));
    await showCompleted();
    expect(container.textContent).not.toContain(categoryLabel("venue"));
    expect(container.textContent).toContain("포토부스");
    expect(container.textContent).toContain("기록 지출30만원");
    expect(container.textContent).toContain(PLANNING_CATEGORY_LABELS.reserve);
    expect(fixture.journey.progress.__hidden).toEqual(["venue", "custom_photo"]);
  });

  it("does not describe a not-applicable category as completed or hide its allocation", async () => {
    fixture.journey.progress.venue = { category: "venue", status: "not_applicable", budget: 12_000_000 };
    await act(async () => root.render(<BudgetTab />));
    await showCompleted();
    expect(row(categoryLabel("venue")).textContent).toContain("배정 1,200만원");
    expect(row(categoryLabel("venue")).textContent).toContain("해당 없음");
    expect(row(categoryLabel("venue")).textContent).not.toContain("완료");
  });

  it("does not render malformed amounts or internal progress keys as allocations", async () => {
    fixture.journey.progress = {
      venue: { category: "venue", status: "in_progress", budget: "12000000", spent: -1 },
      custom_: { budget: 700_000, spent: 700_000 },
      __events: [{ title: "내부 일정", budget: 900_000 }],
    };
    await act(async () => root.render(<BudgetTab />));
    expect(row(categoryLabel("venue")).textContent).not.toContain("만원");
    expect(container.textContent).toContain("기록 지출0원");
    expect(container.textContent).not.toMatch(/NaN|내부 일정|custom_/);
  });

  it("shows exact won amounts without rounding allocations or spend to ten thousand won", async () => {
    fixture.journey.progress = { venue: { category: "venue", status: "in_progress", budget: 5_000, spent: 14_999 } };
    await act(async () => root.render(<BudgetTab />));
    expect(row(categoryLabel("venue")).textContent).toContain("배정 5,000원");
    expect(row(categoryLabel("venue")).textContent).toContain("기록 14,999원");
    expect(container.textContent).toContain("기록 지출14,999원");
  });

  it("uses a human label for custom allocations whose display name is missing", async () => {
    fixture.journey.progress = { custom_internal_id: { category: "custom_internal_id", status: "in_progress", budget: 500_000 } };
    await act(async () => root.render(<BudgetTab />));
    expect(row("사용자 항목").textContent).toContain("배정 50만원");
    expect(container.textContent).not.toContain("custom_internal_id");
  });
});
