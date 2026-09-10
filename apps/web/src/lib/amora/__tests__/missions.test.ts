import { describe, expect, it } from "vitest";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import type { AmoraActionItem } from "@/lib/amora/actions";
import type { ProgressItem } from "@/types/database.types";
import { buildAmoraMissionModel, getMissionActionHref, MISSION_GROUPS } from "../missions";

function action(overrides: Partial<AmoraActionItem> = {}): AmoraActionItem {
  return {
    id: "action-1", title: "저장한 공유 할 일", status: "open", priority: "medium",
    source: "chat", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("아모라 미션의 표시 그룹과 실제 기록", () => {
  it("날짜 없는 중요한 할 일을 날짜가 있는 낮은 중요도보다 먼저 선택한다", () => {
    const model = buildAmoraMissionModel({}, [
      action({ id: "low-dated", priority: "low", dueDate: "2026-09-10" }),
      action({ id: "high-undated", priority: "high" }),
    ]);
    expect(model.cards[0].id).toBe("high-undated");
    expect(model.cards[1].kind).toBe("checklist");
  });

  it("같은 중요도는 유효한 절대 날짜를 먼저 보고 달력 날짜 오름차순으로 고른다", () => {
    expect(buildAmoraMissionModel(null, [
      action({ id: "invalid", dueDate: "2026-02-30", createdAt: "2026-09-10T00:00:00Z" }),
      action({ id: "later", dueDate: "2026-10-01" }),
      action({ id: "earlier", dueDate: "2026-09-30" }),
    ]).cards.map(card => card.id)).toEqual(["earlier", "later"]);
  });

  it("9월·10월 자유 문구는 달력으로 해석하지 않고 같은 미정 그룹에서 생성시각을 따른다", () => {
    const actions = [
      action({ id: "old", dueDate: "10월 중 상담 후", createdAt: "2026-09-01T00:00:00Z" }),
      action({ id: "new", dueDate: "9월 중 두 사람이 가능한 날", createdAt: "2026-09-02T00:00:00Z" }),
    ];
    const before = structuredClone(actions);
    const cards = buildAmoraMissionModel(null, actions).cards;
    expect(cards.map(card => card.id)).toEqual(["new", "old"]);
    expect(cards.map(card => card.dueDate)).toEqual([actions[1].dueDate, actions[0].dueDate]);
    expect(actions).toEqual(before);
  });

  it("절대일 두 개와 자유 문구의 모든 입력 순열에서 선택 순서가 같다", () => {
    const first = action({ id: "first", dueDate: "2026-09-12", createdAt: "2026-09-01T00:00:00Z" });
    const second = action({ id: "second", dueDate: "2026-09-13", createdAt: "2026-09-03T00:00:00Z" });
    const free = action({ id: "free", dueDate: "상담 후", createdAt: "2026-09-02T00:00:00Z" });
    for (const input of [[first, second, free], [first, free, second], [second, first, free], [second, free, first], [free, first, second], [free, second, first]]) {
      expect(buildAmoraMissionModel(null, input).cards.map(card => card.id)).toEqual(["first", "second"]);
    }
  });

  it("같은 날짜·생성시각은 id로 안정화하며 기존 완료 카드의 순서는 바꾸지 않는다", () => {
    const a = action({ id: "a", dueDate: "2026-09-12" });
    const b = action({ id: "b", dueDate: "2026-09-12" });
    expect(buildAmoraMissionModel(null, [b, a]).cards.map(card => card.id)).toEqual(["a", "b"]);
    const doneEarly = action({ id: "done-early", status: "done", priority: "low", dueDate: "2026-09-01" });
    const doneHigh = action({ id: "done-high", status: "done", priority: "high", dueDate: "2026-09-02" });
    expect(buildAmoraMissionModel({}, [doneHigh, doneEarly, b, a]).completedCard?.id).toBe("done-early");
  });

  it("공유 할 일의 예정일 원문만 보존하고 빈 값이나 체크리스트에는 날짜를 만들지 않는다", () => {
    const dueDate = "  다음 상담 후, 두 사람이 가능한 날  ";
    const model = buildAmoraMissionModel({}, [action({ dueDate })]);
    expect(model.cards.find(card => card.kind === "action")).toHaveProperty("dueDate", dueDate);
    expect(model.cards.find(card => card.kind === "checklist")).not.toHaveProperty("dueDate");
    for (const empty of [undefined, "", "   "]) {
      expect(buildAmoraMissionModel(null, [action({ dueDate: empty })]).cards[0].dueDate).toBeUndefined();
    }
  });

  it("현재 체크리스트 분야를 다섯 그룹에 빠짐과 중복 없이 배치한다", () => {
    const keys = MISSION_GROUPS.flatMap((group) => [...group.categoryKeys]);
    expect(MISSION_GROUPS).toHaveLength(5);
    expect([...keys].sort()).toEqual(CATEGORY_CHECKLISTS.map((item) => item.key).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("저장된 항목만 세며 직접 추가한 항목도 보존한다", () => {
    const items = CHECKLIST_MAP.meeting.items;
    const model = buildAmoraMissionModel({ meeting: {
      status: "completed",
      checklist: [{ ...items[0], done: true }, { id: "custom", label: "직접 추가", done: true }],
    } }, []);
    const group = model.groups[0];
    expect(group.done).toBe(2);
    expect(group.total).toBe(CHECKLIST_MAP.greeting.items.length + items.length + 1);
    expect(group.state).toBe("current");
    expect(model.cards[0].categoryKey).toBe("meeting");
    expect(model.cards[0].counts?.done).toBe(2);
  });

  it("분야 단위 완료 선언으로 개별 항목 완료나 추천을 만들지 않는다", () => {
    const model = buildAmoraMissionModel({ greeting: { status: "completed" } }, []);
    expect(model.groups[0].done).toBe(0);
    expect(model.groups[0].declaredCompleted).toBe(1);
    expect(model.cards.some((card) => card.categoryKey === "greeting")).toBe(false);
    expect(model.groups[0].state).not.toBe("done");
  });

  it("해당 없음은 분모와 추천에서 제외하고 다음 그룹의 이동을 잠그지 않는다", () => {
    const model = buildAmoraMissionModel({ greeting: { status: "not_applicable" }, meeting: { status: "not_applicable" } }, []);
    expect(model.groups[0].total).toBe(0);
    expect(model.groups[0].state).toBe("skipped");
    expect(model.groups[1].state).toBe("current");
    expect(model.cards.some((card) => ["greeting", "meeting"].includes(card.categoryKey ?? ""))).toBe(false);
    expect(model.groups.every((group) => group.href.startsWith("/checklist?category="))).toBe(true);
  });

  it("진행 중인 실제 분야를 먼저 제안하고 열린 공유 할 일과 같은 분야는 중복하지 않는다", () => {
    const model = buildAmoraMissionModel({ dress: { status: "in_progress" } }, [action({ categoryKey: "dress" })]);
    expect(model.cards[0].kind).toBe("action");
    expect(model.cards.filter((card) => card.categoryKey === "dress")).toHaveLength(1);
    expect(model.currentGroupId).toBe("contracts");
    expect(model.cards.some((card) => card.kind === "checklist")).toBe(true);
  });

  it("가져온 완료만 완료 카드로 표시하며 숨김 기록은 진행·완료에 넣지 않는다", () => {
    const model = buildAmoraMissionModel({}, [
      action({ id: "hidden", status: "dismissed" }),
      action({ id: "done", status: "done" }),
      action({ id: "urgent", priority: "high" }),
      action({ id: "normal" }),
    ]);
    expect(model.cards.filter((card) => card.kind === "action").map((card) => card.id)).toEqual(["urgent"]);
    expect(model.cards).toHaveLength(2);
    expect(model.cards[1].kind).toBe("checklist");
    expect(model.completedCard?.id).toBe("done");
    expect(model.loadedDoneCount).toBe(1);
  });

  it("준비 정보가 없는 상태에서는 템플릿을 실제 기록처럼 표시하지 않는다", () => {
    const model = buildAmoraMissionModel(null, []);
    expect(model.hasChecklistData).toBe(false);
    expect(model.cards).toEqual([]);
    expect(model.groups.every((group) => group.total === 0 && group.state === "unknown")).toBe(true);
  });

  it("선택한 모든 분야가 완료되면 남은 미션을 지어내지 않는다", () => {
    const progress = Object.fromEntries(CATEGORY_CHECKLISTS.map((item) => [item.key, {
      status: "completed", checklist: item.items.map((entry) => ({ ...entry, done: true })),
    }])) as Record<string, ProgressItem>;
    const model = buildAmoraMissionModel(progress, []);
    expect(model.cards).toEqual([]);
    expect(model.groups.every((group) => group.state === "done")).toBe(true);
  });

  it("단계의 모든 분야를 완료로 선언하면 실제 단계는 완료하되 항목 체크 수를 만들지 않는다", () => {
    const model = buildAmoraMissionModel({ greeting: { status: "completed" }, meeting: { status: "completed" } }, []);
    expect(model.groups[0].state).toBe("done");
    expect(model.groups[0].done).toBe(0);
    expect(model.groups[0].completedCategories).toBe(2);
    expect(model.groups[0].applicableCategories).toBe(2);
    expect(model.currentGroupId).toBe("contracts");
  });

  it("마지막 체크 완료와 해제로 추천 단계가 전진하고 다시 돌아온다", () => {
    const progress: Record<string, ProgressItem> = Object.fromEntries(["greeting", "meeting"].map(key => [key, {
      status: "completed", checklist: CHECKLIST_MAP[key].items.map(item => ({ ...item, done: true })),
    }]));
    expect(buildAmoraMissionModel(progress, []).currentGroupId).toBe("contracts");
    progress.greeting.checklist![0].done = false;
    const restored = buildAmoraMissionModel(progress, []);
    expect(restored.currentGroupId).toBe("family");
    expect(restored.groups[0].state).toBe("current");
    expect(restored.groups[0].categories.find(category => category.key === "greeting")?.nextItem).toBe(CHECKLIST_MAP.greeting.items[0].label);
  });

  it("해당 없는 분야를 목록에는 남겨 복구하고 복구 후 추천에 다시 포함한다", () => {
    const progress: Record<string, ProgressItem> = { greeting: { status: "not_applicable" }, meeting: { status: "not_applicable" } };
    const skipped = buildAmoraMissionModel(progress, []);
    expect(skipped.groups[0].state).toBe("skipped");
    expect(skipped.groups[0].categories.map(category => category.key)).toEqual(["greeting", "meeting"]);
    expect(skipped.groups[0].excludedCategories).toBe(2);
    progress.greeting = { status: "not_started" };
    const restored = buildAmoraMissionModel(progress, []);
    expect(restored.groups[0].excludedCategories).toBe(1);
    expect(restored.currentGroupId).toBe("family");
    expect(restored.recommendation?.categoryKey).toBe("greeting");
  });
});

describe("미션에서 실제 화면으로 이어가기", () => {
  it("기존 내부 목적지와 카테고리 체크리스트 링크를 유지한다", () => {
    expect(getMissionActionHref(action({ href: "/wedding/budget?category=venue" }))).toBe("/budget?category=venue");
    expect(getMissionActionHref(action({ categoryKey: "venue" }))).toBe("/checklist?category=venue");
  });

  it.each(["javascript:alert(1)", "//evil.example", "/\\evil.example", "/api/auth/logout", "/chat/../../api/auth/logout", "/%2f%2fevil.example", "https://evil.example"]) (
    "저장된 위험한 목적지 %s 대신 확인 가능한 채팅 초안으로 연결한다", (href) => {
      const result = getMissionActionHref(action({ href, title: "노출되면 안 되는 개인 문구" }));
      expect(result).toMatch(/^\/chat\?source=amora_missions&prefill=/);
      expect(decodeURIComponent(result)).not.toContain("노출되면 안 되는 개인 문구");
      expect(result).not.toMatch(/auto.?send/i);
    },
  );
});
