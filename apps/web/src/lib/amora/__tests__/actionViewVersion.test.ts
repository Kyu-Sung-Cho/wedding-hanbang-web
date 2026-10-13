import { describe, expect, it } from "vitest";
import { getAmoraActions, normalizeAmoraAction, type AmoraActionItem } from "../actions";
import { rowToAmoraAction } from "../actionRepository";
import type { AmoraAction } from "@/types/database.types";

const TOKEN = "2026-10-12T01:02:03.123456Z";
const action = { id: "act_raw_version", title: "합성 항목", status: "open", priority: "medium", source: "manual", createdAt: TOKEN, updatedAt: TOKEN } satisfies AmoraActionItem;

describe("view versions are server storage tokens, not display dates", () => {
  it("exposes the raw canonical row version without a Date precision round-trip", () => {
    const row: AmoraAction = { id: action.id, couple_id: "synthetic-couple", title: action.title, priority: action.priority,
      status: action.status, source: action.source, created_at: TOKEN, updated_at: TOKEN, description: null, due_date: null,
      category_key: null, href: null, metadata: {}, created_by: null, completed_at: null, dismissed_at: null };
    expect(rowToAmoraAction(row).viewVersion).toBe(TOKEN);
  });
  it("never turns a missing legacy timestamp or a forged DTO field into a usable token", () => {
    const [missing] = getAmoraActions({ __amora_actions: [{ ...action, updatedAt: undefined, viewVersion: TOKEN }] });
    expect(missing.updatedAt).toEqual(expect.any(String));
    expect(missing.viewVersion).toBeNull();
    expect(normalizeAmoraAction(missing).viewVersion).toBeNull();
    expect(getAmoraActions({ __amora_actions: [missing] })[0].viewVersion).toBeNull();
  });
  it.each(["infinity", "2026-02-30T00:00:00Z", "2026-10-12T01:02:03.1234567Z", "2026-10-12"])("keeps invalid legacy %s unversioned", updatedAt => {
    expect(getAmoraActions({ __amora_actions: [{ ...action, updatedAt, viewVersion: TOKEN }] })[0].viewVersion).toBeNull();
  });
  it("uses only the actual legacy updatedAt, not a stored viewVersion alias", () => {
    expect(getAmoraActions({ __amora_actions: [{ ...action, viewVersion: "2026-10-12T01:02:03.111111Z" }] })[0].viewVersion).toBe(TOKEN);
  });
});
