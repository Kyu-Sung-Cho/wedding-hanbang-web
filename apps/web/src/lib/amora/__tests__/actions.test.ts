import { describe, expect, it } from "vitest";
import {
  getAmoraActions,
  mergeAmoraActions,
  parseAmoraActionDueDateInput,
  withUpdatedAmoraAction,
  type AmoraActionItem,
} from "../actions";

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
  it("accepts only a real user-confirmed calendar date as an action deadline", () => {
    expect(parseAmoraActionDueDateInput("2028-02-29")).toEqual({
      ok: true,
      dueDate: "2028-02-29",
    });
    expect(parseAmoraActionDueDateInput(" 2028-02-29 ")).toEqual({
      ok: true,
      dueDate: "2028-02-29",
    });
    expect(parseAmoraActionDueDateInput("")).toEqual({ ok: true, dueDate: undefined });
    expect(parseAmoraActionDueDateInput(null)).toEqual({ ok: true, dueDate: undefined });
    expect(parseAmoraActionDueDateInput("2026-02-31")).toEqual({ ok: false });
    expect(parseAmoraActionDueDateInput("next Saturday")).toEqual({ ok: false });
    expect(parseAmoraActionDueDateInput(20260814)).toEqual({ ok: false });
  });

  it("drops an impossible legacy deadline instead of presenting it as personalized truth", () => {
    const [action] = getAmoraActions({
      __amora_actions: [{ ...baseAction, dueDate: "2026-02-31" }],
    });

    expect(action.dueDate).toBeUndefined();
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
