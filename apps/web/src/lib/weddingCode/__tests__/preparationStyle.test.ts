import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V12_QUESTIONS, WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";
import { isPreparationStyleAnswer, parsePreparationStyleSnapshot } from "../preparationStyle";

const owner = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
const couple = "33333333-3333-4333-8333-333333333333";
const answer = { sceneVersion: WEDDING_CODE_V12_VERSION, answerCode: "A".repeat(20), revision: 7, savedAt: "2026-09-20T00:00:00.000Z" };
const personal = { ownerUserId: owner, stateRevision: 7, coupleId: couple, partnerUserId: peer, own: answer, sharing: null, partner: null };

describe("preparation style strict persistence boundary", () => {
  it("allows every actual choice and partial answers, but no invented options at any position", () => {
    for (const [index, question] of WEDDING_CODE_V12_QUESTIONS.entries()) {
      for (const character of ["A", "B", "C", "D", "E", "-"]) {
        const code = "A".repeat(index) + character + "A".repeat(19 - index);
        expect(isPreparationStyleAnswer(WEDDING_CODE_V12_VERSION, code), `${question.key}:${character}`).toBe(character === "-" || question.options.some(option => option.value === character));
      }
    }
    expect(isPreparationStyleAnswer(WEDDING_CODE_V12_VERSION, "A" + "-".repeat(19))).toBe(true);
  });
  it.each(["-".repeat(20), "a".repeat(20), " " + "A".repeat(20), "A".repeat(20) + "\n", "A".repeat(16)])("rejects empty, unversioned-era or noncanonical answers: %j", code => {
    expect(isPreparationStyleAnswer(WEDDING_CODE_V12_VERSION, code)).toBe(false);
  });
  it.each([undefined, null, "v1.2", "v1.1-code", "v1.2-code "])("does not infer a response version from %j", version => {
    expect(isPreparationStyleAnswer(version, answer.answerCode)).toBe(false);
  });
  it("accepts private and explicitly mutual snapshots, including partial responses", () => {
    expect(parsePreparationStyleSnapshot(personal)).toEqual(personal);
    const paired = { ...personal, sharing: { responseRevision: 7, sharedAt: answer.savedAt }, partner: { ...answer, answerCode: "B" + "-".repeat(19) } };
    expect(parsePreparationStyleSnapshot(paired)).toEqual(paired);
  });
  it("distinguishes never-saved state from an empty deletion tombstone and rejects mismatched control revisions", () => {
    const deleted = { ...personal, stateRevision: 42, own: null };
    expect(parsePreparationStyleSnapshot(deleted)).toEqual(deleted);
    expect(parsePreparationStyleSnapshot({ ...deleted, stateRevision: null })).not.toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, stateRevision: null })).toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, stateRevision: 8 })).toBeNull();
  });
  it("rejects partner payload without an effective own share or with a stale revision", () => {
    expect(parsePreparationStyleSnapshot({ ...personal, partner: answer })).toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, sharing: { responseRevision: 6, sharedAt: answer.savedAt }, partner: answer })).toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, own: null, sharing: { responseRevision: 7, sharedAt: answer.savedAt } })).toBeNull();
  });
  it("rejects identity, extra fields, invalid revision and unsupported returned version", () => {
    expect(parsePreparationStyleSnapshot({ ...personal, partnerUserId: owner })).toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, coupleId: null })).toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, privateNote: "unexpected" })).toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, own: { ...answer, revision: 1.5 } })).toBeNull();
    expect(parsePreparationStyleSnapshot({ ...personal, own: { ...answer, sceneVersion: "v0.6-code" } })).toBeNull();
  });
});
