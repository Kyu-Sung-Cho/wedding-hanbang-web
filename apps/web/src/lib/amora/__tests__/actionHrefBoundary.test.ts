import { describe, expect, it } from "vitest";
import { getAmoraActions, type AmoraActionItem } from "../actions";
import { amoraActionToRow, amoraActionUpdatesToPayload } from "../actionRepository";

const TOKEN = "2026-10-12T00:00:00.123456Z";
const action = { id: "act_href_qa", title: "합성 준비", source: "manual", status: "open", priority: "medium", createdAt: TOKEN, updatedAt: TOKEN } satisfies AmoraActionItem;
const UNSAFE = ["/\\evil.invalid", "//evil.invalid", "https://evil.invalid", "/wedding/\u0000checklist", "/wedding/\tchecklist", "/wedding/\rchecklist", "/wedding/\u007fchecklist"];

describe("action href is an internal relative link", () => {
  it("records the exact WHATWG backslash authority counterexample", () => {
    expect(new URL(UNSAFE[0], "https://hanbang.ai").origin).toBe("https://evil.invalid");
  });
  it.each(UNSAFE)("does not expose unsafe stored href %j or an editable version", href => {
    const [view] = getAmoraActions({ __amora_actions: [{ ...action, href }] });
    expect(view.href).toBeUndefined();
    expect(view.viewVersion).toBeNull();
  });
  it.each(UNSAFE)("rejects unsafe href %j before an update or insert payload can be written", href => {
    expect(() => amoraActionUpdatesToPayload({ status: "done", href })).toThrow();
    expect(() => amoraActionToRow("synthetic-couple", { ...action, href })).toThrow();
  });
});
