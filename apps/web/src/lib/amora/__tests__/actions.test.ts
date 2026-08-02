import { describe, expect, it } from "vitest";
import {
  createAmoraActionId,
  getAmoraActions,
  mergeAmoraActions,
  sanitizeAmoraActionHref,
  withUpdatedAmoraAction,
  type AmoraActionItem,
} from "../actions";

describe("Amora action identifier", () => {
  it("uses cryptographically random UUIDs", () => {
    const first = createAmoraActionId();
    const second = createAmoraActionId();

    expect(first).toMatch(/^act_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(second).not.toBe(first);
  });
});

const baseAction: AmoraActionItem = {
  id: "act_base",
  title: "기본 액션",
  priority: "medium",
  status: "open",
  source: "chat",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

describe("아모라 액션", () => {
  it.each([
    "//attacker.example/path",
    "/%2F%2Fattacker.example/path",
    "/%252f%252fattacker.example/path",
    "/safe\\attacker.example",
    "https://attacker.example/path",
  ])("rejects a non-canonical action href: %s", (href) => {
    expect(sanitizeAmoraActionHref(href)).toBeUndefined();
  });

  it("keeps a bounded first-party action href", () => {
    expect(sanitizeAmoraActionHref(" /wedding/budget?tab=plan#next ")).toBe(
      "/wedding/budget?tab=plan#next",
    );
  });

  it("progress에 저장된 legacy 액션을 정렬해서 읽는다", () => {
    const actions = getAmoraActions({
      __amora_actions: [
        { ...baseAction, id: "act_low", title: "낮은 우선순위", priority: "low" },
        { ...baseAction, id: "act_high", title: "높은 우선순위", priority: "high" },
      ],
    });

    expect(actions.map((action) => action.id)).toEqual(["act_high", "act_low"]);
  });

  it("테이블 액션이 legacy 액션보다 우선한다", () => {
    const legacy: AmoraActionItem[] = [
      { ...baseAction, id: "act_same", title: "옛 제목", priority: "low" },
      { ...baseAction, id: "act_legacy", title: "legacy만 있는 액션" },
    ];
    const stored: AmoraActionItem[] = [
      { ...baseAction, id: "act_same", title: "새 제목", priority: "high" },
    ];

    const merged = mergeAmoraActions(stored, legacy);

    expect(merged.find((action) => action.id === "act_same")?.title).toBe("새 제목");
    expect(merged.find((action) => action.id === "act_legacy")).toBeTruthy();
  });

  it("완료한 액션을 숨기면 completedAt을 지운다", () => {
    const doneAt = "2026-06-02T00:00:00.000Z";
    const progress = {
      __amora_actions: [{ ...baseAction, status: "done", completedAt: doneAt }],
    };

    const next = withUpdatedAmoraAction(progress, "act_base", { status: "dismissed" });
    const [updated] = getAmoraActions(next);

    expect(updated.status).toBe("dismissed");
    expect(updated.completedAt).toBeUndefined();
  });
});
