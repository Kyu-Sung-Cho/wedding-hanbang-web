import { SELF_SEND_COPY } from "@hanbang/shared/invitation";
import { describe, expect, it } from "vitest";
import type { LetterVersionRow, StoredShares } from "../inquiryRepository";
import { LIVE_COPY } from "../liveCopy";
import { selfSendView } from "../selfSend";

const HALL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HALL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OFF = { on: false, value: null };

function version(shares: Partial<StoredShares> = {}, overrides: Partial<LetterVersionRow> = {}): LetterVersionRow {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    letterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    version: 3,
    recipientHallIds: [HALL_A, HALL_B],
    recipientNames: ["소담 하우스", "가온 웨딩홀"],
    body: "2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다. 하객은 200명 정도예요.",
    signature: "민지와 준호 드림",
    shares: { name: OFF, phone: OFF, budget: OFF, ...shares },
    fingerprint: "a".repeat(64),
    createdAt: "2026-11-18T01:00:00Z",
    approvalCompletedAt: null,
    queuedAt: null,
    ...overrides,
  };
}

describe("self-send text (D-83 stage 1)", () => {
  it("writes one message per recipient from the saved version, in the saved order", () => {
    const view = selfSendView(version({ budget: { on: true, value: "3,000만 원" } }));
    expect(view.versionId).toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(view.fingerprint).toBe("a".repeat(64));
    expect(view.phoneOmitted).toBe(false);
    expect(view.messages.map((message) => [message.hallId, message.name])).toEqual([
      [HALL_A, "소담 하우스"],
      [HALL_B, "가온 웨딩홀"],
    ]);
    expect(view.messages[0].text).toBe([
      "소담 하우스께",
      "",
      "안녕하세요. 2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다. 하객은 200명 정도예요.",
      "예산은 3,000만 원 정도예요.",
      "",
      "민지와 준호 드림",
      "AI 웨딩 비서의 도움을 받아 쓴 문의예요.",
    ].join("\n"));
    expect(view.messages[1].text.startsWith("가온 웨딩홀께\n\n")).toBe(true);
  });

  it("builds the text only from the shared copy and the stored fields", () => {
    const view = selfSendView(version({ budget: { on: true, value: "3,000만 원" } }));
    const text = view.messages[0].text;
    expect(text.startsWith(`소담 하우스께\n\n${SELF_SEND_COPY.greeting} `)).toBe(true);
    expect(text).toContain(SELF_SEND_COPY.budgetLine("3,000만 원"));
    expect(text.endsWith(`\n\n민지와 준호 드림\n${SELF_SEND_COPY.aiNote}`)).toBe(true);
  });

  it("leaves the budget line out when the budget share is off", () => {
    const text = selfSendView(version()).messages[0].text;
    expect(text).toBe([
      "소담 하우스께",
      "",
      "안녕하세요. 2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다. 하객은 200명 정도예요.",
      "",
      "민지와 준호 드림",
      "AI 웨딩 비서의 도움을 받아 쓴 문의예요.",
    ].join("\n"));
    expect(text).not.toContain("예산");
  });

  it("says the budget is not decided yet when that is what the version stored", () => {
    const text = selfSendView(version({ budget: { on: true, value: LIVE_COPY.letter.budgetUnsetStored } })).messages[0].text;
    expect(text).toContain(`\n${SELF_SEND_COPY.budgetUnsetLine}\n\n`);
    expect(text).not.toContain(SELF_SEND_COPY.budgetLine(LIVE_COPY.letter.budgetUnsetStored));
  });

  it("never makes up a budget when a switched-on budget has no stored value", () => {
    const text = selfSendView(version({ budget: { on: true, value: null } })).messages[0].text;
    expect(text).not.toContain("예산");
    expect(text).not.toContain("null");
  });

  it("never puts the phone number in the text and says it was left out", () => {
    const view = selfSendView(version({ phone: { on: true, value: "010-1234-5678" } }));
    expect(view.phoneOmitted).toBe(true);
    for (const message of view.messages) {
      expect(message.text).not.toMatch(/010|1234|5678|\*{2,}/);
    }
    expect(selfSendView(version()).phoneOmitted).toBe(false);
  });

  it("adds no name line: the signature already carries the names when the name share is on", () => {
    const named = selfSendView(version({ name: { on: true, value: "김민지" } })).messages[0].text;
    expect(named).not.toContain("김민지");
    const anonymous = selfSendView(version({}, { signature: LIVE_COPY.letter.anonymousSignature })).messages[0].text;
    expect(anonymous).toContain(`\n\n${LIVE_COPY.letter.anonymousSignature}\n`);
  });

  it("never uses the screen-only display sentences", () => {
    const text = selfSendView(version({ budget: { on: true, value: "3,000만 원" }, phone: { on: true, value: "010-1234-5678" } })).messages[0].text;
    expect(text).not.toContain(LIVE_COPY.letter.budgetDisplay("3,000"));
    expect(text).not.toContain("알려요");
  });

  it("does not greet twice when the couple started the body with their own greeting", () => {
    for (const body of ["안녕하세요, 2027년 5월에 예식을 생각하고 있어요.", "안녕하세요. 2027년 5월에 예식을 생각하고 있어요."]) {
      const text = selfSendView(version({}, { body })).messages[0].text;
      expect(text.match(/안녕/g), body).toHaveLength(1);
      expect(text).toContain(`께\n\n${body}`);
    }
  });

  it("keeps the line breaks the couple wrote in the saved body", () => {
    const text = selfSendView(version({}, { body: "첫 줄이에요.\n둘째 줄이에요." })).messages[0].text;
    expect(text).toContain("안녕하세요. 첫 줄이에요.\n둘째 줄이에요.\n\n민지와 준호 드림");
  });
});
