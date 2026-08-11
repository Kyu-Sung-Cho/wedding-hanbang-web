// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";

const source = readFileSync(
  resolve(process.cwd(), "src/components/app/checklist/ChecklistCategoryTasks.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  resolve(process.cwd(), "src/components/app/checklist/ChecklistCategoryView.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
  "utf8",
);
const topNavSource = readFileSync(
  resolve(process.cwd(), "src/components/app/TopNav.tsx"),
  "utf8",
);
const scheduleSource = readFileSync(
  resolve(process.cwd(), "src/components/app/schedule/ScheduleContent.tsx"),
  "utf8",
);
const timelineSource = readFileSync(
  resolve(process.cwd(), "src/components/app/schedule/TimelineView.tsx"),
  "utf8",
);

describe("dedicated checklist category page accessibility contract", () => {
  it("uses native checkboxes and announces progress and save results", () => {
    expect(source).toContain('type="checkbox"');
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="alert"');
  });

  it("is a document page rather than a dialog or fixed overlay", () => {
    expect(pageSource).toContain("<h1");
    expect(pageSource).not.toContain('role="dialog"');
    expect(pageSource).not.toContain('aria-modal="true"');
    expect(pageSource).not.toContain("fixed inset-");
    expect(source).not.toContain("document.body.style.overflow");
  });

  it("routes dashboard and notification entry points to the same full page", () => {
    expect(dashboardSource).not.toContain("CategoryPanel");
    expect(dashboardSource).toContain("weddingLinkProps(`/checklist/${category.key}`)");
    expect(topNavSource).toContain('prefix: "/checklist/"');
    expect(topNavSource).toContain("weddingPath(`/checklist/${categoryKey}`)");
  });

  it("has an intentional icon for every canonical category", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      expect(pageSource, `${category.key}: ${category.icon}`).toContain(`${category.icon},`);
    }
  });

  it("keeps schedule as navigation into the same checklist pages instead of a second editor", () => {
    expect(timelineSource).toContain("weddingLinkProps(`/checklist/${cat.key}`)");
    expect(timelineSource).not.toContain('role="checkbox"');
    expect(timelineSource).not.toContain("onToggleChecklistItem");
    expect(scheduleSource).not.toContain("ChecklistSchedulePrompt");
  });
});
