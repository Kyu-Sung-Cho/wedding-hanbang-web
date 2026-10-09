import { describe, expect, it } from "vitest";
import { ITEMS } from "./bank";
import { answeredCount, buildShareUrl, createDraft, createSnapshot, EXPRESSION_CORRECTION_NOTICE, isComplete, loadDraft, parseDraft, readShareFragment, saveDraft } from "./io";
import { BANK_REVISION, EXPRESSION_VERSION, MEASUREMENT_VERSION, STORAGE_KEY, type Answer, type Answers, type Draft } from "./types";

function all(answer: Answer): Answers {
  return Object.fromEntries(ITEMS.map(item => [item.id, { ...answer }]));
}
function memory() {
  const values = new Map<string, string>([["hanbang:legacy:answers", "preserve-me"]]);
  const writes: string[] = [];
  return { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); } };
}
function changeLinkVersion(url: string, change: Record<string, string | undefined>): string {
  const encoded = new URL(url).hash.split("=")[1];
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
  const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, ...change }));
  return "#wc-likert=" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("isolated Likert IO", () => {
  it("restores cursor and original answers without touching old keys", () => {
    const storage = memory();
    const draft = { ...createDraft(), answers: { [ITEMS[0].id]: { status: "rated" as const, value: 3 as const } }, cursor: 1, screen: "questions" as const };
    expect(saveDraft(storage, draft).saved).toBe(true);
    expect(loadDraft(storage).draft).toEqual(draft);
    expect(storage.writes).toEqual([STORAGE_KEY]);
    expect(storage.values.get("hanbang:legacy:answers")).toBe("preserve-me");
  });
  it("does not turn unknown, not-applicable, skipped or 3 into each other", () => {
    const answers = all({ status: "rated", value: 3 });
    answers[ITEMS[0].id] = { status: "unknown" };
    answers[ITEMS[1].id] = { status: "not_applicable" };
    answers[ITEMS[2].id] = { status: "skipped" };
    const own = createSnapshot(answers);
    const url = buildShareUrl("http://127.0.0.1:43917", own);
    expect(url).not.toBeNull();
    const decoded = readShareFragment(new URL(url!).hash);
    expect(decoded.kind).toBe("invite");
    if (decoded.kind === "invite") expect(decoded.first).toEqual(own);
    expect(isComplete(answers)).toBe(true);
    expect(answeredCount(answers)).toBe(ITEMS.length);
  });
  it("roundtrips two separately owned snapshots in their original order", () => {
    const first = createSnapshot(all({ status: "rated", value: 5 }));
    const second = createSnapshot(all({ status: "rated", value: 1 }));
    const url = buildShareUrl("http://127.0.0.1:43917", first, second)!;
    expect(new URL(url).search).toBe("");
    const decoded = readShareFragment(new URL(url).hash);
    expect(decoded.kind).toBe("couple");
    if (decoded.kind === "couple") { expect(decoded.first).toEqual(first); expect(decoded.second).toEqual(second); }
  });
  it("refuses incomplete, wrong-version and wrong-revision sharing", () => {
    expect(() => createSnapshot({})).toThrow();
    const snapshot = createSnapshot(all({ status: "unknown" }));
    expect(buildShareUrl("http://127.0.0.1:43917", { ...snapshot, version: "v3.1-preferences" as typeof MEASUREMENT_VERSION })).toBeNull();
    expect(buildShareUrl("http://127.0.0.1:43917", { ...snapshot, revision: "old" as typeof BANK_REVISION })).toBeNull();
    expect(buildShareUrl("javascript:alert(1)", snapshot)).toBeNull();
  });
  it("never reinterprets an old fragment or corrupted payload", () => {
    expect(readShareFragment("#wcd5=old").kind).toBe("unsupported");
    expect(readShareFragment("#wc-likert=%%%").kind).toBe("invalid");
    expect(readShareFragment("#wc-likert=a&wc-likert=b").kind).toBe("invalid");
    expect(readShareFragment("#wc-likert=" + "x".repeat(25_000)).kind).toBe("invalid");
  });
  it("rejects impossible ratings and unknown IDs in drafts", () => {
    expect(parseDraft(JSON.stringify({ ...createDraft(), answers: { [ITEMS[0].id]: { status: "rated", value: 6 } } }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...createDraft(), answers: { unknown: { status: "unknown" } } }))).toBeNull();
  });
  it("does not delete or rewrite incompatible stored answers", () => {
    const storage = memory();
    const original = JSON.stringify({ ...createDraft(), version: "legacy-version" });
    storage.values.set(STORAGE_KEY, original);
    expect(loadDraft(storage).draft).toBeNull();
    expect(storage.values.get(STORAGE_KEY)).toBe(original);
    expect(storage.writes).toEqual([]);
  });
  it("allows continuation in memory when storage is blocked", () => {
    const denied = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadDraft(denied).draft).toBeNull();
    expect(saveDraft(denied, createDraft()).saved).toBe(false);
  });
  it("does not alias later answer edits into a shared snapshot", () => {
    const answers = all({ status: "rated", value: 4 });
    const snapshot = createSnapshot(answers);
    answers[ITEMS[0].id] = { status: "rated", value: 1 };
    expect(snapshot.answers[ITEMS[0].id]).toEqual({ status: "rated", value: 4 });
  });
  it("reads the identical-bank alpha.1 draft without writing and explains the expression correction", () => {
    const storage = memory();
    const answers: Answers = {
      [ITEMS[0].id]: { status: "rated", value: 3 },
      [ITEMS[1].id]: { status: "unknown" },
      [ITEMS[2].id]: { status: "not_applicable" },
      [ITEMS[3].id]: { status: "skipped" },
    };
    const previous = { ...createDraft(), expressionVersion: "likert-letters-alpha.1", answers, cursor: 4, screen: "questions" };
    const original = JSON.stringify(previous);
    storage.values.set(STORAGE_KEY, original);
    const restored = loadDraft(storage);
    expect(restored.draft).toEqual({ ...previous, expressionVersion: EXPRESSION_VERSION });
    expect(restored.expressionNotice).toBe(EXPRESSION_CORRECTION_NOTICE);
    expect(restored.expressionNotice).toContain("T");
    expect(restored.expressionNotice).toContain("L");
    expect(storage.values.get(STORAGE_KEY)).toBe(original);
    expect(storage.writes).toEqual([]);
    expect(saveDraft(storage, restored.draft!).saved).toBe(true);
    expect(JSON.parse(storage.values.get(STORAGE_KEY)!)).toEqual(restored.draft);
    expect(storage.writes).toEqual([STORAGE_KEY]);
    expect(storage.values.get("hanbang:legacy:answers")).toBe("preserve-me");
  });
  it("preserves the actual J4/T5 raw answers in alpha.1 invite and couple links", () => {
    const answers = all({ status: "rated", value: 3 });
    for (const item of ITEMS) {
      if (item.facet === "J") answers[item.id] = { status: "rated", value: 4 };
      if (item.facet === "T") answers[item.id] = { status: "rated", value: 5 };
    }
    const first = createSnapshot(answers);
    const second = createSnapshot(all({ status: "unknown" }));
    for (const includeSecond of [false, true]) {
      const current = buildShareUrl("http://127.0.0.1:43917", first, includeSecond ? second : undefined)!;
      const restored = readShareFragment(changeLinkVersion(current, { expression: "likert-letters-alpha.1" }));
      expect(restored.kind).toBe(includeSecond ? "couple" : "invite");
      if (restored.kind === "invite" || restored.kind === "couple") {
        expect(restored.first).toEqual(first);
        expect(restored.first.answers).toEqual(answers);
        expect(restored.notice).toBe(EXPRESSION_CORRECTION_NOTICE);
        if (restored.kind === "couple") expect(restored.second).toEqual(second);
      }
    }
  });
  it("generates an alpha.3 pair from an alpha.1 invitation with original snapshot order and dates", () => {
    const invited = createSnapshot(all({ status: "rated", value: 5 }));
    const oldHash = changeLinkVersion(buildShareUrl("http://127.0.0.1:43917", invited)!, { expression: "likert-letters-alpha.1" });
    const restored = readShareFragment(oldHash);
    expect(restored.kind).toBe("invite");
    if (restored.kind !== "invite") throw new Error("Compatible old invitation was lost");
    const own = createSnapshot(all({ status: "rated", value: 1 }));
    const paired = readShareFragment(new URL(buildShareUrl("http://127.0.0.1:43917", restored.first, own)!).hash);
    expect(paired.kind).toBe("couple");
    if (paired.kind === "couple") {
      expect(paired.first).toEqual(invited);
      expect(paired.second).toEqual(own);
      expect(paired.notice).toBeUndefined();
      expect(paired.first.expressionVersion).toBe("likert-letters-alpha.3");
    }
  });
  it("reads an alpha.2 draft as alpha.3 without changing its answers, cursor, date or stored bytes", () => {
    const storage = memory();
    const answers: Answers = {
      [ITEMS[0].id]: { status: "rated", value: 3 },
      [ITEMS[1].id]: { status: "unknown" },
      [ITEMS[2].id]: { status: "not_applicable" },
      [ITEMS[3].id]: { status: "skipped" },
    };
    const previous = {
      ...createDraft(), expressionVersion: "likert-letters-alpha.2", answers,
      cursor: 4, screen: "questions", updatedAt: "2026-10-08T17:47:34.161Z",
    };
    const original = JSON.stringify(previous);
    storage.values.set(STORAGE_KEY, original);
    const restored = loadDraft(storage);
    expect(restored.draft).toEqual({ ...previous, expressionVersion: "likert-letters-alpha.3" });
    expect(restored.expressionNotice).toContain("L");
    expect(restored.expressionNotice).toContain("장면");
    expect(restored.expressionNotice).toContain("원답");
    expect(restored.expressionNotice).not.toContain("T 결과");
    expect(storage.values.get(STORAGE_KEY)).toBe(original);
    expect(storage.values.get("hanbang:legacy:answers")).toBe("preserve-me");
    expect(storage.writes).toEqual([]);
    expect(saveDraft(storage, restored.draft!).saved).toBe(true);
    expect(JSON.parse(storage.values.get(STORAGE_KEY)!)).toEqual(restored.draft);
    expect(storage.writes).toEqual([STORAGE_KEY]);
  });
  it("reads alpha.2 invite and couple links with the original people, dates and every raw response", () => {
    const answers = all({ status: "rated", value: 3 });
    answers[ITEMS[0].id] = { status: "unknown" };
    answers[ITEMS[1].id] = { status: "not_applicable" };
    answers[ITEMS[2].id] = { status: "skipped" };
    const first = { ...createSnapshot(answers), createdAt: "2026-10-08T17:00:00.000Z" };
    const second = { ...createSnapshot(all({ status: "rated", value: 1 })), createdAt: "2026-10-08T18:00:00.000Z" };
    for (const includeSecond of [false, true]) {
      const current = buildShareUrl("http://127.0.0.1:43917", first, includeSecond ? second : undefined)!;
      const restored = readShareFragment(changeLinkVersion(current, { expression: "likert-letters-alpha.2" }));
      expect(restored.kind).toBe(includeSecond ? "couple" : "invite");
      if (restored.kind !== "invite" && restored.kind !== "couple") throw new Error("Compatible alpha.2 answers were lost");
      expect(restored.first).toEqual({ ...first, expressionVersion: "likert-letters-alpha.3" });
      expect(restored.notice).toContain("L");
      expect(restored.notice).toContain("장면");
      expect(restored.notice).not.toContain("T 결과");
      if (restored.kind === "couple") expect(restored.second).toEqual({ ...second, expressionVersion: "likert-letters-alpha.3" });
      const regenerated = buildShareUrl("http://127.0.0.1:43917", restored.first,
        restored.kind === "couple" ? restored.second : undefined)!;
      const reread = readShareFragment(new URL(regenerated).hash);
      expect(reread.kind).toBe(restored.kind);
      if (reread.kind === "invite" || reread.kind === "couple") {
        expect(reread.first).toEqual(restored.first);
        expect(reread.notice).toBeUndefined();
        if (reread.kind === "couple" && restored.kind === "couple") expect(reread.second).toEqual(restored.second);
      }
    }
  });
  it("does not add a correction notice to current alpha.3 drafts or links", () => {
    const storage = memory();
    const current = { ...createDraft(), expressionVersion: "likert-letters-alpha.3" };
    const original = JSON.stringify(current);
    storage.values.set(STORAGE_KEY, original);
    expect(loadDraft(storage).draft).toEqual(current);
    expect(loadDraft(storage).expressionNotice).toBeUndefined();
    expect(storage.writes).toEqual([]);
    expect(storage.values.get(STORAGE_KEY)).toBe(original);
    const url = buildShareUrl("http://127.0.0.1:43917", createSnapshot(all({ status: "unknown" })))!;
    const linked = readShareFragment(changeLinkVersion(url, { expression: "likert-letters-alpha.3" }));
    expect(linked.kind).toBe("invite");
    if (linked.kind === "invite") expect(linked.notice).toBeUndefined();
  });
  it("does not extend wording compatibility to other banks, measurements or future expressions", () => {
    const currentUrl = buildShareUrl("http://127.0.0.1:43917", createSnapshot(all({ status: "rated", value: 3 })))!;
    for (const change of [
      { expression: "likert-letters-alpha.4" },
      { expression: "likert-letters-alpha.1", revision: "preferences-20261008-r1" },
      { expression: "likert-letters-alpha.1", version: "likert-preferences-alpha.0" },
      { expression: "likert-letters-alpha.2", revision: "preferences-20261008-r1" },
      { expression: "likert-letters-alpha.2", version: "likert-preferences-alpha.0" },
    ]) expect(readShareFragment(changeLinkVersion(currentUrl, change)).kind).toBe("unsupported");
    for (const change of [
      { expressionVersion: "likert-letters-alpha.4" },
      { expressionVersion: "likert-letters-alpha.1", revision: "preferences-20261008-r1" },
      { expressionVersion: "likert-letters-alpha.1", version: "likert-preferences-alpha.0" },
      { expressionVersion: "likert-letters-alpha.2", revision: "preferences-20261008-r1" },
      { expressionVersion: "likert-letters-alpha.2", version: "likert-preferences-alpha.0" },
    ]) {
      const storage = memory();
      const original = JSON.stringify({ ...createDraft(), ...change });
      storage.values.set(STORAGE_KEY, original);
      expect(loadDraft(storage).draft).toBeNull();
      expect(storage.values.get(STORAGE_KEY)).toBe(original);
      expect(storage.writes).toEqual([]);
    }
  });
  it("rejects non-string screen values without rewriting alpha.1, alpha.2 or current stored answers", () => {
    const invalidScreens = [["intro"], ["questions"], ["result"], ["compare"], [], ["intro", "result"], {}, { value: "intro" }, null, true, false, 0, "", "unknown-screen"];
    for (const expressionVersion of ["likert-letters-alpha.1", "likert-letters-alpha.2", EXPRESSION_VERSION]) {
      for (const screen of invalidScreens) {
        const storage = memory();
        const malformed = { ...createDraft(), expressionVersion, answers: all({ status: "rated", value: 3 }), screen };
        const original = JSON.stringify(malformed);
        storage.values.set(STORAGE_KEY, original);
        expect(parseDraft(original), JSON.stringify({ expressionVersion, screen })).toBeNull();
        expect(loadDraft(storage).draft).toBeNull();
        expect(saveDraft(storage, malformed as unknown as Draft).saved).toBe(false);
        expect(storage.values.get(STORAGE_KEY)).toBe(original);
        expect(storage.values.get("hanbang:legacy:answers")).toBe("preserve-me");
        expect(storage.writes).toEqual([]);
      }
    }
  });
  it("retains all four valid string screens and both previous expressions without read writes", () => {
    const answers = all({ status: "rated", value: 3 });
    for (const expressionVersion of ["likert-letters-alpha.1", "likert-letters-alpha.2", EXPRESSION_VERSION]) {
      for (const screen of ["intro", "questions", "result", "compare"] as const) {
        const storage = memory();
        const original = JSON.stringify({ ...createDraft(), expressionVersion, answers, cursor: 7, screen });
        storage.values.set(STORAGE_KEY, original);
        const restored = loadDraft(storage);
        expect(restored.draft?.screen).toBe(screen === "compare" ? "result" : screen);
        expect(restored.draft?.answers).toEqual(answers);
        expect(restored.draft?.cursor).toBe(7);
        expect(restored.draft?.expressionVersion).toBe(EXPRESSION_VERSION);
        if (expressionVersion === "likert-letters-alpha.1") expect(restored.expressionNotice).toBe(EXPRESSION_CORRECTION_NOTICE);
        else if (expressionVersion === "likert-letters-alpha.2") {
          expect(restored.expressionNotice).toContain("L");
          expect(restored.expressionNotice).toContain("장면");
        } else expect(restored.expressionNotice).toBeUndefined();
        expect(storage.values.get(STORAGE_KEY)).toBe(original);
        expect(storage.writes).toEqual([]);
      }
    }
  });
});
