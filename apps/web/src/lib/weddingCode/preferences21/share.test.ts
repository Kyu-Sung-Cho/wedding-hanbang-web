import { beforeEach, describe, expect, it } from "vitest";
import { VERSIONS, createEmptyAnswers } from "./bank";
import { isPreferences21PlainObject } from "./storage";
import {
  PREFERENCES21_SHARE_TTL_MS, buildPreferences21FriendCard, createPreferences21ReturnFragment,
  createPreferences21ShareFragment, parsePreferences21ShareFragment,
} from "./share";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
function encoded(raw: string): string { return `#wc-preferences21=${btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`; }
function unpack(fragment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(atob(fragment.split("=")[1].replaceAll("-", "+").replaceAll("_", "/")));
  if (!isPreferences21PlainObject(value)) throw new Error("Expected payload");
  return value;
}
function invitation() {
  const answers = { ...createEmptyAnswers(), Q01: 1, Q05: 5, Q06: "unknown", Q13: "not-applicable", Q18: "skipped", Q21: 4 };
  const fragment = createPreferences21ShareFragment({ kind: "partner-invitation", answers, consent: true }, NOW);
  if (!fragment) throw new Error("Expected invitation");
  const parsed = parsePreferences21ShareFragment(fragment, NOW);
  if (parsed.status !== "ready" || parsed.payload.kind !== "partner-invitation") throw new Error("Expected read invitation");
  return { answers, fragment, payload: parsed.payload };
}

describe("21문항 요약 공유·원답 초대 계약", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it("defaults to a nonfamily summary without raw responses, partner or family", () => {
    const answers = { ...createEmptyAnswers(), Q01: 5, Q05: 4, Q06: 3, Q13: 5, Q14: 5, Q15: 5, Q16: 5 };
    const fragment = createPreferences21ShareFragment({ kind: "summary", answers }, NOW);
    if (!fragment) throw new Error("Expected summary");
    expect(JSON.stringify(unpack(fragment))).not.toMatch(/answers|Q13|Q14|Q15|Q16|first|second|partner/u);
    const read = parsePreferences21ShareFragment(fragment, NOW);
    expect(read.status).toBe("ready");
    if (read.status !== "ready" || read.payload.kind !== "summary") throw new Error("Expected summary card");
    expect(read.payload.card).toEqual(buildPreferences21FriendCard(answers));
    expect(read.payload.card.lines.map((line) => line.itemId)).toEqual(["Q01", "Q05"]);
    expect(read.payload).not.toHaveProperty("answers");
  });
  it("requires separate raw-answer consent and preserves states, versions and original dates", () => {
    expect(createPreferences21ShareFragment({ kind: "partner-invitation", answers: createEmptyAnswers(), consent: false }, NOW)).toBeNull();
    const { answers, payload } = invitation();
    expect(payload.answers).toEqual(answers);
    expect(payload).toMatchObject({ ...VERSIONS, createdAt: NOW, expiresAt: NOW + PREFERENCES21_SHARE_TTL_MS });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.answers)).toBe(true);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
  it("creates the partner's own return only with fresh consent and keeps the first sender immutable", () => {
    const { payload } = invitation();
    const ownAnswers = { ...createEmptyAnswers(), Q05: 2, Q17: 5 };
    expect(createPreferences21ReturnFragment(payload, ownAnswers, { consent: false, now: NOW + 1000 })).toBeNull();
    const returned = createPreferences21ReturnFragment(payload, ownAnswers, { consent: true, now: NOW + 1000 });
    if (!returned) throw new Error("Expected partner return");
    const read = parsePreferences21ShareFragment(returned, NOW + 1000);
    if (read.status !== "ready" || read.payload.kind !== "partner-return") throw new Error("Expected read return");
    expect(read.payload.first).toEqual(payload);
    expect(read.payload.second.answers).toEqual(ownAnswers);
    expect(read.payload.second.createdAt).toBe(NOW + 1000);
    expect(read.payload.expiresAt).toBe(payload.expiresAt);
    expect(buildPreferences21FriendCard(ownAnswers)?.lines.map((line) => line.itemId)).toEqual(["Q17"]);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
  it("expires from the original first invitation and cannot be refreshed by reading or returning", () => {
    const { fragment, payload } = invitation();
    const returned = createPreferences21ReturnFragment(payload, createEmptyAnswers(), { consent: true, now: NOW + 1000 });
    if (!returned) throw new Error("Expected return");
    expect(parsePreferences21ShareFragment(fragment, NOW + PREFERENCES21_SHARE_TTL_MS - 1).status).toBe("ready");
    expect(parsePreferences21ShareFragment(fragment, NOW + PREFERENCES21_SHARE_TTL_MS).status).toBe("expired");
    expect(parsePreferences21ShareFragment(returned, NOW + PREFERENCES21_SHARE_TTL_MS).status).toBe("expired");
    expect(createPreferences21ReturnFragment(payload, createEmptyAnswers(), { consent: true, now: NOW + PREFERENCES21_SHARE_TTL_MS })).toBeNull();
  });
  it.each(["questionnaireVersion", "interpretationVersion", "displayVersion"])("rejects another %s without reinterpreting it", (key) => {
    const { fragment } = invitation();
    expect(parsePreferences21ShareFragment(encoded(JSON.stringify({ ...unpack(fragment), [key]: "old-or-future" })), NOW).status).toBe("version-mismatch");
  });
  it("rejects malformed, future, excessive, duplicated and extra-field tokens", () => {
    const { fragment } = invitation();
    const data = unpack(fragment);
    const invalidTokens = [
      "#wc-preferences21=bad%", `${fragment}&wc-preferences21=again`, "#wc-preferences21=" + "a".repeat(13000),
      encoded(JSON.stringify({ ...data, createdAt: NOW + 1, expiresAt: NOW + 1 + PREFERENCES21_SHARE_TTL_MS })),
      encoded(JSON.stringify({ ...data, expiresAt: NOW + PREFERENCES21_SHARE_TTL_MS + 1 })),
      encoded(JSON.stringify({ ...data, answers: Array(30).fill(5) })),
      encoded(JSON.stringify({ ...data, partner: createEmptyAnswers() })),
      encoded(JSON.stringify(data).replace('"Q01":1', '"Q01":1,"Q01":5')),
      encoded(JSON.stringify(data).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')),
      encoded("[]"), encoded("null"),
    ];
    for (const token of invalidTokens) expect(parsePreferences21ShareFragment(token, NOW).status).toBe("invalid");
  });
  it("rejects family IDs, duplicate IDs and raw fields injected into a friend summary", () => {
    const fragment = createPreferences21ShareFragment({ kind: "summary", answers: createEmptyAnswers() }, NOW);
    if (!fragment) throw new Error("Expected summary");
    const data = unpack(fragment);
    for (const change of [{ summaryItemIds: ["Q13"] }, { summaryItemIds: ["Q01", "Q01"] }, { summaryItemIds: ["Q22"] }, { answers: createEmptyAnswers() }, { text: "family" }]) {
      expect(parsePreferences21ShareFragment(encoded(JSON.stringify({ ...data, ...change })), NOW).status).toBe("invalid");
    }
  });
  it("rejects changes to the return's versions or original lifetime", () => {
    const { payload } = invitation();
    const fragment = createPreferences21ReturnFragment(payload, createEmptyAnswers(), { consent: true, now: NOW + 1000 });
    if (!fragment) throw new Error("Expected return");
    const data = unpack(fragment);
    if (!isPreferences21PlainObject(data.second) || !isPreferences21PlainObject(data.first)) throw new Error("Expected pair snapshots");
    const changedSecond = { ...data, second: { ...data.second, questionnaireVersion: "old" } };
    expect(parsePreferences21ShareFragment(encoded(JSON.stringify(changedSecond)), NOW + 1000).status).toBe("version-mismatch");
    for (const change of [
      { ...data, expiresAt: NOW + 1000 + PREFERENCES21_SHARE_TTL_MS },
      { ...data, second: { ...data.second, createdAt: NOW + 999 } },
      { ...data, first: { ...data.first, answers: { ...createEmptyAnswers(), Q01: "unexpected" } } },
      { ...data, first: { ...data.first, kind: "partner-return" } },
    ]) expect(parsePreferences21ShareFragment(encoded(JSON.stringify(change)), NOW + 1000).status).toBe("invalid");
  });
  it("leaves older namespaces for their original reader and never rewrites them", () => {
    for (const fragment of ["#wc-likert=old30", "#v=v3.1-preferences&a=old", "#v=v4.0-tendency&a=old", ""]) {
      expect(parsePreferences21ShareFragment(fragment, NOW).status).toBe("absent");
    }
  });
});
