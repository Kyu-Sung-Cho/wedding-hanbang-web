import { describe, expect, it } from "vitest";

import { assessMediationOffer } from "../mediationOffer";

function message(
  sender_role: "bride" | "groom",
  content: string,
  target: "partner" | "ai" = "partner",
) {
  return {
    content,
    sender_role,
    visibility: "shared" as const,
    metadata: { target },
  };
}

describe("assessMediationOffer", () => {
  it("offers help only when both people have direct conflict evidence", () => {
    const result = assessMediationOffer([
      message("bride", "너는 맨날 내 말을 안 들어서 너무 서운해."),
      message("groom", "난 절대 반대야. 그건 동의 못 해."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: true,
      evidenceCount: 2,
      reason: "mutual_conflict_evidence",
    });
    expect(new Set(result.evidenceRoles)).toEqual(new Set(["bride", "groom"]));
  });

  it("does not treat a neutral reply as the second side's conflict evidence", () => {
    const result = assessMediationOffer([
      message("bride", "너는 맨날 내 말을 안 들어. 너무 답답해."),
      message("groom", "알겠어. 저녁에 이야기하자."),
      message("bride", "진짜 화가 나."),
    ]);

    expect(result.shouldOffer).toBe(false);
    expect(result.reason).toBe("one_sided_evidence");
    expect(result.evidenceRoles).toEqual(["bride"]);
  });

  it("excludes current third-party complaints even when both roles speak", () => {
    const result = assessMediationOffer([
      message("bride", "친구가 남자친구 때문에 너무 화가 났대."),
      message("groom", "엄마가 그 업체는 절대 안 된다고 반대래."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: false,
      evidenceCount: 0,
      reason: "one_sided_evidence",
    });
  });

  it("never reads private or Amora-addressed messages for the banner", () => {
    const result = assessMediationOffer([
      message("bride", "너는 맨날 내 말을 안 들어.", "ai"),
      message("groom", "난 절대 반대야.", "ai"),
      {
        ...message("bride", "너무 화가 나."),
        visibility: "bride_private" as const,
      },
    ]);

    expect(result).toMatchObject({
      shouldOffer: false,
      reason: "insufficient_direct_messages",
    });
  });
});
