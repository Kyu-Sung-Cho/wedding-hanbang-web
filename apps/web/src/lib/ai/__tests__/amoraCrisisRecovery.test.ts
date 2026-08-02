import { describe, expect, it } from "vitest";
import {
  buildUnmatchedAmoraCrisisRecoveryCard,
  type AmoraCrisisRecoveryMessage,
} from "@hanbang/shared/amora-crisis-recovery";

const viewer = {
  coupleId: "couple-1",
  userId: "user-1",
  role: "bride" as const,
};

function message(
  overrides: Partial<AmoraCrisisRecoveryMessage> = {},
): AmoraCrisisRecoveryMessage {
  return {
    id: "message-1",
    coupleId: viewer.coupleId,
    senderId: viewer.userId,
    senderRole: viewer.role,
    role: "user",
    content: "지금 죽고 싶어",
    visibility: "shared",
    target: "ai",
    createdAt: "2026-08-02T12:00:00.000Z",
    inReplyToUserMessageId: null,
    ...overrides,
  };
}

describe("unmatched Amora crisis recovery", () => {
  it("rebuilds one generic local-only card for the current owner's latest canonical disclosure", () => {
    const card = buildUnmatchedAmoraCrisisRecoveryCard([message()], viewer);

    expect(card).toEqual(expect.objectContaining({
      visibility: "shared",
      inReplyToUserMessageId: "message-1",
      safetyClassification: "self_harm",
    }));
    expect(card?.content).toContain("112");
    expect(card?.content).toContain("119");
    expect(card?.content).toContain("109");
    expect(JSON.stringify(card?.metadata)).not.toContain("죽고 싶어");
  });

  it.each([
    ["another couple", message({ coupleId: "couple-2" })],
    ["another owner", message({ senderId: "user-2" })],
    ["another role", message({ senderRole: "groom" })],
    ["partner delivery", message({ target: "partner" })],
    ["hidden private scope", message({ visibility: "groom_private" })],
    ["ordinary wedding text", message({ content: "스튜디오 견적을 비교해줘" })],
    ["meta discussion", message({ content: '"죽고 싶다"라는 문구를 검토해줘' })],
  ])("fails closed across the %s fence", (_label, candidate) => {
    expect(buildUnmatchedAmoraCrisisRecoveryCard([candidate], viewer)).toBeNull();
  });

  it("does not duplicate the card after a later canonical AI answer in the same visibility", () => {
    const crisis = message();
    const answer = message({
      id: "message-2",
      senderId: null,
      senderRole: "ai",
      role: "assistant",
      content: "이미 표시된 안전 안내",
      createdAt: "2026-08-02T12:00:01.000Z",
      inReplyToUserMessageId: crisis.id,
    });

    expect(
      buildUnmatchedAmoraCrisisRecoveryCard([crisis, answer], viewer),
    ).toBeNull();
  });

  it("keeps shared and private lanes independent and returns only the newest unmatched crisis", () => {
    const answeredSharedCrisis = message();
    const sharedAnswer = message({
      id: "message-2",
      senderId: null,
      senderRole: "ai",
      role: "assistant",
      content: "shared answer",
      createdAt: "2026-08-02T12:00:01.000Z",
      inReplyToUserMessageId: answeredSharedCrisis.id,
    });
    const privateCrisis = message({
      id: "message-3",
      content: "남편이 지금 나를 때리고 있어",
      visibility: "bride_private",
      createdAt: "2026-08-02T12:00:02.000Z",
    });

    expect(buildUnmatchedAmoraCrisisRecoveryCard(
      [answeredSharedCrisis, sharedAnswer, privateCrisis],
      viewer,
    )).toEqual(expect.objectContaining({
      visibility: "bride_private",
      inReplyToUserMessageId: privateCrisis.id,
      safetyClassification: "interpersonal_danger",
    }));
  });

  it("keeps the latest unmatched crisis across later ordinary users and unrelated AI turns", () => {
    const crisis = message();
    const unrelatedAnswer = message({
      id: "message-2",
      senderId: null,
      senderRole: "ai",
      role: "assistant",
      content: "다른 질문의 답변",
      createdAt: "2026-08-02T12:00:01.000Z",
      inReplyToUserMessageId: "different-user-message",
    });
    const ordinary = message({
      id: "message-3",
      content: "내일 드레스 투어 일정도 확인해줘",
      createdAt: "2026-08-02T12:00:02.000Z",
    });

    expect(buildUnmatchedAmoraCrisisRecoveryCard(
      [crisis, unrelatedAnswer, ordinary],
      viewer,
    )).toEqual(expect.objectContaining({
      inReplyToUserMessageId: crisis.id,
      safetyClassification: "self_harm",
    }));
  });
});
