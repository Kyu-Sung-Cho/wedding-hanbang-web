import { describe, expect, it } from "vitest";
import { parsePreparationDecisions } from "../preparationBoard";

const coupleId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const base = {
  id: "33333333-3333-4333-8333-333333333333", couple_id: coupleId, visibility: "shared",
  category: "general", title: "일정 취소: 확인할 일정", reasoning: null, decision_type: "scheduled",
  source: "schedule", created_at: "2026-09-11T00:00:00Z", superseded_at: null, memory_key: null,
};
function schedule(kind: "cancel" | "restore", origin = "couple_plan_change_request") {
  const before = { id: eventId, title: "확인할 일정", status: kind === "cancel" ? "planned" : "cancelled" };
  const after = { ...before, status: kind === "cancel" ? "cancelled" : "planned" };
  return {
    ...base, title: `일정 ${kind === "cancel" ? "취소" : "복원"}: 확인할 일정`,
    metadata: { origin, mutationKind: kind, eventId },
    chosen_value: { schemaVersion: 1, eventId, before, after,
      ...(origin === "couple_plan_change_request" ? { mutationKind: kind, changes: { __events: [after] } } : { operation: kind }) },
  };
}
function budget(title = "venue 예산: 13000000원 → 12500000원") {
  return { ...base, category: "plan", source: "manual", decision_type: "decided", title,
    metadata: { origin: "couple_plan_change_request" },
    chosen_value: { schemaVersion: 1, changes: { progress_patch: {
      venue: { budget: 12500000, spent: 123000, payer: "both_parents", status: "not_started", category: "venue" },
    }, progress_remove_keys: [] } },
  };
}
const parse = (row: unknown) => parsePreparationDecisions([row], coupleId).records[0];

describe("preparation decision historical display", () => {
  it.each(["couple_plan_change_request", "amora_shared_action"])("labels structured cancel/restore as records for %s without moving their stored category or column", origin => {
    for (const kind of ["cancel", "restore"] as const) {
      const row = schedule(kind, origin); const original = structuredClone(row);
      expect(parse(row)).toMatchObject({ title: row.title, category: "general", source: "schedule", status: "confirmed",
        stateLabel: kind === "cancel" ? "일정 취소 기록" : "일정 복원 기록" });
      expect(row).toEqual(original);
    }
  });

  it("uses a neutral record label for legacy, unsupported or inconsistent evidence instead of reading cancellation from prose", () => {
    const row = schedule("cancel");
    for (const value of [
      { ...base, metadata: {} }, { ...row, chosen_value: null }, { ...row, chosen_value: "cancel" },
      { ...row, source: "chat" }, { ...row, metadata: { ...row.metadata, origin: "other" } },
      { ...row, metadata: { ...row.metadata, mutationKind: "restore" } },
      { ...row, chosen_value: { ...row.chosen_value, schemaVersion: 2 } },
      { ...row, chosen_value: { ...row.chosen_value, eventId: coupleId } },
      { ...row, chosen_value: { ...row.chosen_value, after: { ...row.chosen_value.after, status: "planned" } } },
      { ...row, chosen_value: { ...row.chosen_value, before: null } },
      { ...schedule("restore"), chosen_value: { ...schedule("restore").chosen_value, before: { id: eventId, status: "planned" } } },
    ]) expect(parse(value).stateLabel).toBe("일정 기록");
  });

  it.each([
    ["venue 예산: 13000000원 → 12500000원", "결혼식장 예산: 13000000원 → 12500000원"],
    ["venue 부담: 미정 → 두 가족", "결혼식장 부담: 미정 → 두 가족"],
    ["venue 지출: 미정 → 123000원", "결혼식장 지출: 미정 → 123000원"],
    ["venue 예산: 13000000원 → 12500000원 · venue 부담: 미정 → 두 가족", "결혼식장 예산: 13000000원 → 12500000원 · 결혼식장 부담: 미정 → 두 가족"],
  ])("formats proven generated legacy title %s while retaining the original", (title, displayTitle) => {
    const row = budget(title); const original = structuredClone(row);
    expect(parse(row)).toMatchObject({ title, displayTitle, category: "plan", status: "confirmed", source: "manual" });
    expect(row).toEqual(original);
  });

  it("preserves custom names, arbitrary prose, unknown provenance and unmatched amounts unchanged", () => {
    const row = budget(); const patch = row.chosen_value.changes.progress_patch.venue;
    for (const value of [
      { ...row, source: "budget" }, { ...row, metadata: {} }, { ...row, chosen_value: null },
      { ...row, title: "venue에 상담한 뒤 예산을 정했어요" },
      { ...row, title: "venue 예산: 13000000원 → 12500001원" },
      { ...row, title: "venue 지출: 미정 → 999원" },
      { ...row, title: "venue 부담: 미정 → 두 사람" },
      { ...row, title: `${row.title} · 직접 남긴 메모` },
      { ...row, title: `인용: ${row.title}` },
      ...[{ label: "venue" }, { name: "내 venue" }, { category: "custom_venue" }].map(change => ({ ...row,
        chosen_value: { ...row.chosen_value, changes: { progress_patch: { venue: { ...patch, ...change } } } },
      })),
      { ...row, title: "custom_venue 예산: 13000000원 → 12500000원", chosen_value: { schemaVersion: 1,
        changes: { progress_patch: { custom_venue: { ...patch, category: "custom_venue" } } } } },
    ]) {
      expect(parse(value).title).toBe(value.title);
      expect(parse(value)).not.toHaveProperty("displayTitle");
    }
  });
});
