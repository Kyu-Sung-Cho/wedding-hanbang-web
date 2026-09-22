import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_VERSION, type V30Draft } from "@/constants/weddingCodeV30";
import { createV30Draft, encodeV30 } from "@/lib/weddingCode/v30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import {
  parseWeddingCodeEntryHash,
  parseWeddingCodeEntryQuery,
  weddingCodeEntryHash,
  weddingCodeEntryKey,
} from "./entry";

const draft = (rating: 1 | 5): V30Draft => ({
  ...createV30Draft(),
  answers: { [WEDDING_CODE_V30_QUESTIONS[0].id]: rating },
});

describe("새 웨딩코드 기본 진입", () => {
  it("맨 주소와 답이 없는 새 버전 주소는 취향 통합판을 연다", () => {
    expect(parseWeddingCodeEntryQuery({}).kind).toBe("v31");
    expect(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V31_VERSION }).kind).toBe("v31");
    expect(parseWeddingCodeEntryQuery({ v: "v3.0-preferences" }).kind).toBe("v30");
  });

  it("명시된 v20 입구는 당시 문항을 유지한다", () => {
    expect(parseWeddingCodeEntryQuery({ v: "v2.0-agreement" }).kind).toBe("v20");
  });

  it("새 응답이 query에 들어오면 해석하지 않는다", () => {
    const code = encodeV30(draft(5));
    expect(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V30_VERSION, a: code }).kind).toBe("error");
    expect(parseWeddingCodeEntryQuery(new URLSearchParams({ v: WEDDING_CODE_V30_VERSION, a: code, b: code })).kind).toBe("error");
  });

  it("먼저 답한 사람과 두 사람 결과를 fragment에서 각각 복원한다", () => {
    const first = draft(1);
    const second = draft(5);
    const firstCode = encodeV30(first);
    const soloHash = `#v=${WEDDING_CODE_V30_VERSION}&a=${firstCode}`;
    expect(parseWeddingCodeEntryHash(soloHash)).toEqual({
      kind: "v30", initial: { partnerDraft: first, partnerCode: firstCode, bothDrafts: null },
    });
    const coupleHash = `${soloHash}&b=${encodeV30(second)}`;
    const parsed = parseWeddingCodeEntryHash(coupleHash);
    expect(parsed).toEqual({
      kind: "v30", initial: { partnerDraft: null, partnerCode: firstCode, bothDrafts: { first, second } },
    });
    if (!parsed) throw new Error("유효한 fragment를 복원하지 못했어요");
    expect(weddingCodeEntryHash(parsed)).toBe(coupleHash);
  });

  it("두 번째 사람의 답이 바뀌면 진입 state의 key도 달라진다", () => {
    const hash = `#v=${WEDDING_CODE_V30_VERSION}&a=${encodeV30(draft(1))}`;
    const firstPair = parseWeddingCodeEntryHash(`${hash}&b=${encodeV30(draft(1))}`);
    const secondPair = parseWeddingCodeEntryHash(`${hash}&b=${encodeV30(draft(5))}`);
    if (!firstPair || !secondPair) throw new Error("커플 fragment를 복원하지 못했어요");
    expect(firstPair.kind).toBe("v30");
    expect(secondPair.kind).toBe("v30");
    expect(weddingCodeEntryKey(firstPair)).not.toBe(weddingCodeEntryKey(secondPair));
  });

  it("새 fragment의 중복, 알 수 없는 필드, 잘린 응답은 복원하지 않는다", () => {
    const code = encodeV30(draft(5));
    const hash = `#v=${WEDDING_CODE_V30_VERSION}&a=${code}`;
    for (const malformed of [
      `${hash}&a=${code}`, `${hash}&b=${code}&b=${code}`,
      `${hash}&v=${WEDDING_CODE_V30_VERSION}`, `${hash}&other=1`,
      `#v=${WEDDING_CODE_V30_VERSION}&b=${code}`, `${hash}&b=broken`,
      `#v=${WEDDING_CODE_V30_VERSION}&a=${code.slice(0, -1)}`,
      `#${"x".repeat(12001)}`,
    ]) expect(parseWeddingCodeEntryHash(malformed)?.kind, malformed).toBe("error");
  });

  it("새 버전 query에서도 중복·알 수 없는 키를 허용하지 않는다", () => {
    expect(parseWeddingCodeEntryQuery({ v: [WEDDING_CODE_V30_VERSION, WEDDING_CODE_V30_VERSION] }).kind).toBe("error");
    expect(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V30_VERSION, other: "1" }).kind).toBe("error");
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(`v=${WEDDING_CODE_V30_VERSION}&other=1`)).kind).toBe("error");
  });

  it("오래된 query 링크와 유입 경로 매개변수는 기존 의미를 유지한다", () => {
    const result = parseWeddingCodeEntryQuery({ v: "v2.0-agreement", a: "5---------------", utm_source: "invite" });
    expect(result.kind).toBe("v20");
    expect(parseWeddingCodeEntryQuery({ utm_source: "landing" }).kind).toBe("v31");
  });

  it("v31의 회피 기준과 새 식순 답을 새 판으로만 복원한다", () => {
    const first = createV31Draft();
    first.answers.B1 = 5;
    first.tastes.ceremony = { status: "answered", values: ["thanks"] };
    first.avoidances = { status: "answered", values: ["crowded_space"] };
    const second = createV31Draft();
    second.answers.B1 = 2;
    const a = encodeV31(first);
    const b = encodeV31(second);
    const solo = parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V31_VERSION}&a=${a}`);
    expect(solo).toEqual({ kind: "v31", initial: { partnerDraft: first, partnerCode: a, bothDrafts: null } });
    const hash = `#v=${WEDDING_CODE_V31_VERSION}&a=${a}&b=${b}`;
    const pair = parseWeddingCodeEntryHash(hash);
    expect(pair).toEqual({ kind: "v31", initial: { partnerDraft: null, partnerCode: a, bothDrafts: { first, second } } });
    expect(weddingCodeEntryHash(pair!)).toBe(hash);
    expect(weddingCodeEntryKey(solo!)).not.toBe(weddingCodeEntryKey(pair!));
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V30_VERSION}&a=${a}`)?.kind).toBe("error");
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V31_VERSION}&a=${encodeV30(draft(5))}`)?.kind).toBe("error");
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V31_VERSION}&a=${a}&b=${encodeV30(draft(5))}`)?.kind).toBe("error");
  });

  it("v31도 query 응답·중복 키·알 수 없는 값·손상된 상대 응답을 거절한다", () => {
    const first = createV31Draft();
    first.answers.G1 = 5;
    const code = encodeV31(first);
    const hash = `#v=${WEDDING_CODE_V31_VERSION}&a=${code}`;
    for (const malformed of [`${hash}&a=${code}`, `${hash}&b=${code}&b=${code}`, `${hash}&other=1`, `${hash}&b=broken`, `#v=${WEDDING_CODE_V31_VERSION}&b=${code}`]) {
      expect(parseWeddingCodeEntryHash(malformed)?.kind).toBe("error");
    }
    for (const query of [{ v: WEDDING_CODE_V31_VERSION, a: code }, { v: WEDDING_CODE_V31_VERSION, other: "1" }, { v: [WEDDING_CODE_V31_VERSION, WEDDING_CODE_V31_VERSION] }]) {
      expect(parseWeddingCodeEntryQuery(query).kind).toBe("error");
    }
  });
});
