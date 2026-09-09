// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AmoraActionItem } from "../actions";
import { manualActionIdForRequest, matchesManualActionCreateRow, parseManualActionRequestId } from "../manualActionCreate";

const request = "abcdef01-2345-4678-9abc-def012345678";
const item: AmoraActionItem = { id: "amora_manual_test", title: "상담 질문", status: "open", priority: "medium", source: "manual", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
const row = { id: item.id, couple_id: "couple", created_by: "actor", title: item.title, description: null, due_date: null, category_key: null, href: null, status: "open", priority: "medium", source: "manual", created_at: item.createdAt, updated_at: item.updatedAt, completed_at: null };

describe("manual task retry identity and current receipt", () => {
  it("normalizes a UUID once and partitions IDs by authenticated actor, couple, and request", () => {
    expect(parseManualActionRequestId(request.toUpperCase())).toBe(request);
    const first = manualActionIdForRequest("actor", "couple", request);
    expect(first).toMatch(/^amora_manual_[0-9a-f]{64}$/);
    expect(manualActionIdForRequest("actor", "couple", request)).toBe(first);
    expect(new Set([first, manualActionIdForRequest("other", "couple", request), manualActionIdForRequest("actor", "other", request), manualActionIdForRequest("actor", "couple", "abcdef01-2345-4678-9abc-def012345679")]).size).toBe(4);
  });
  it.each([undefined, null, "", "abcdef01-2345-1678-9abc-def012345678", ` ${request}`, {}, 42])("rejects malformed request identity %j", value => {
    expect(parseManualActionRequestId(value)).toBeNull();
  });
  it("matches a complete owned current row and the server's nullable field representation", () => {
    expect(matchesManualActionCreateRow(row, item, "actor", "couple")).toBe(true);
    expect(matchesManualActionCreateRow({ ...row, description: "설명", due_date: "다음 주" }, { ...item, description: "설명", dueDate: "다음 주" }, "actor", "couple")).toBe(true);
    expect(matchesManualActionCreateRow(row, { ...item, description: "", dueDate: " " }, "actor", "couple")).toBe(true);
  });
  it.each([
    { id: "other" }, { created_by: "other" }, { couple_id: "other" }, { title: "수정된 제목" },
    { description: "수정된 설명" }, { due_date: "다른 날" }, { category_key: "venue" }, { href: "/chat" },
    { status: "done" }, { priority: "high" }, { source: "chat" },
    { description: undefined }, { due_date: 40 }, { created_at: null }, { updated_at: {} }, { completed_at: false },
  ])("rejects a changed, foreign, or malformed current row: %j", change => {
    expect(matchesManualActionCreateRow({ ...row, ...change }, item, "actor", "couple")).toBe(false);
  });
});
