import { describe, expect, it } from "vitest";

import {
  assessMediationOffer,
  hasUnresolvedPrivateMediationSafetyHold,
  hasMediationSafetySignal,
} from "../mediationOffer";

function message(
  sender_role: "bride" | "groom",
  content: string,
  target: "partner" | "ai" = "partner",
  createdAt = new Date().toISOString(),
) {
  return {
    id: `${sender_role}-${content}`,
    content,
    sender_role,
    visibility: "shared" as const,
    metadata: { target },
    created_at: createdAt,
  };
}

describe("assessMediationOffer", () => {
  it("keeps a private safety hold unresolved after later ordinary private replies", () => {
    const privateMessages = [
      {
        visibility: "bride_private",
        sender_role: "ai",
        metadata: { pinned_safety_card: true },
      },
      {
        visibility: "bride_private",
        sender_role: "bride",
        metadata: null,
      },
      {
        visibility: "bride_private",
        sender_role: "ai",
        metadata: {},
      },
    ] as const;

    expect(hasUnresolvedPrivateMediationSafetyHold(privateMessages, "bride"))
      .toBe(true);
    expect(hasUnresolvedPrivateMediationSafetyHold(privateMessages, "groom"))
      .toBe(false);
    expect(hasUnresolvedPrivateMediationSafetyHold(privateMessages.slice(1), "bride"))
      .toBe(false);
    expect(hasUnresolvedPrivateMediationSafetyHold([{
      visibility: "bride_private",
      sender_role: "bride",
      metadata: { pinned_safety_card: true },
    }], "bride")).toBe(false);
  });

  it("exposes the same conservative pre-network safety gate", () => {
    expect(hasMediationSafetySignal("나를 때렸잖아.")).toBe(true);
    expect(hasMediationSafetySignal("제 폰을 매일 확인해요.")).toBe(true);
    expect(hasMediationSafetySignal("예산을 같이 확인해요.")).toBe(false);
  });

  it.each([
    "성관계를 강요해.",
    "강제로 성관계를 하려고 해.",
    "원치 않는 성관계를 요구해.",
    "싫다는데 성적 행위를 강요해.",
    "싫다는데 관계하자고 압박해.",
    "피임을 못하게 해.",
    "임신을 강요해.",
    "어디 가는지 매번 검사해.",
  ])("stops ordinary mediation for explicit sexual coercion: %s", (text) => {
    expect(hasMediationSafetySignal(text)).toBe(true);
  });

  it.each([
    "일정을 같이 검사해 보자.",
    "임신 계획을 상의하고 있어.",
    "피임 방법을 같이 알아보고 있어.",
    "어디로 신혼여행 갈지 매번 이야기해.",
  ])("keeps ordinary collaborative planning outside the safety gate: %s", (text) => {
    expect(hasMediationSafetySignal(text)).toBe(false);
  });

  it("never offers ordinary mediation when any recent direct message contains violence", () => {
    const result = assessMediationOffer([
      message("bride", "너 때문에 속상해. 나를 때렸잖아."),
      message("groom", "내 말은 안 듣고 너는 맨날 이래."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: false,
      reason: "safety_signal",
    });
  });

  it.each([
    "어제 날 벽으로 밀었어.",
    "남친이 또 손을 올렸어.",
    "나를 다치게 할 거라고 했어.",
    "화나면 물건을 던져.",
    "내 사진을 가족한테 보내겠다고 협박해. 너무 화가 나.",
  ])("fails closed for natural danger phrasing before offering mediation: %s", (danger) => {
    expect(hasMediationSafetySignal(danger)).toBe(true);
    expect(assessMediationOffer([
      message("bride", danger),
      message("groom", "내 말은 안 듣고 너는 맨날 이래."),
    ])).toMatchObject({ shouldOffer: false, reason: "safety_signal" });
  });

  it("stops mediation when a partner throws a phone at the requester", () => {
    expect(hasMediationSafetySignal("남편이 휴대폰을 나한테 던졌어"))
      .toBe(true);
  });

  it.each([
    "남편이 숨 못 쉬게 목을 눌렀어",
    "남편이 머리채를 잡았어",
    "남편이 팔을 비틀었어",
  ])("stops mediation for direct physical assault phrased without violence labels: %s", (text) => {
    expect(hasMediationSafetySignal(text)).toBe(true);
  });

  it.each([
    "성관계 싫다고 했는데 억지로 했어",
    "관계를 거부했는데 억지로 했어",
  ])("stops mediation for colloquial non-consensual sexual conduct: %s", (text) => {
    expect(hasMediationSafetySignal(text)).toBe(true);
  });

  it.each([
    "외출할 때마다 위치 보내라고 해",
    "내 사진을 뿌리겠다고 겁줘",
  ])("stops mediation for coercive tracking or image-disclosure threats: %s", (text) => {
    expect(hasMediationSafetySignal(text)).toBe(true);
  });

  it.each([
    "어제 일정 날짜를 뒤로 밀었어.",
    "남친이 사진 찍으며 손을 올렸어.",
    "나를 다치게 할 거라는 말은 아니야.",
    "화나면 물건을 던지는 건 아니야.",
  ])("does not broaden natural danger phrases into unrelated or negated text: %s", (ordinary) => {
    expect(hasMediationSafetySignal(ordinary)).toBe(false);
  });

  it.each([
    "내가 남편을 밀쳤어. 조율해줘.",
    "제가 아내 목을 졸랐어요. 중재해 주세요.",
    "내가 신랑한테 화가 나서 물건을 던졌어.",
    "내가 물건을 아내에게 던졌어. 조율해줘.",
    "내가 여자친구에게 성관계를 강요했어. 합의안을 만들어줘.",
  ])("stops shared mediation when the requester discloses harming their partner: %s", (danger) => {
    expect(hasMediationSafetySignal(danger)).toBe(true);
  });

  it.each([
    "내가 남편과 상의해서 일정을 뒤로 밀었어.",
    "제가 아내 목도리를 느슨하게 매어 줬어요.",
    "내가 신랑한테 꽃다발을 던져 줬어.",
    "내가 물건을 아내에게 건네줬어.",
    "내가 남편을 밀친 건 아니야.",
    "내가 여자친구에게 성관계에 대한 생각을 물었고 서로 동의했어.",
  ])("does not mistake benign first-person actions involving a partner for harm: %s", (ordinary) => {
    expect(hasMediationSafetySignal(ordinary)).toBe(false);
  });

  it("recognizes mutual resignation without labeling a neutral message as conflict", () => {
    const result = assessMediationOffer([
      message("bride", "그래, 네가 원하는 대로 해."),
      message("groom", "또 내가 다 정하는 사람이 됐네."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: true,
      evidenceCount: 2,
      reason: "mutual_conflict_evidence",
    });
  });

  it("does not mistake an explicit permission for resigned conflict", () => {
    const result = assessMediationOffer([
      message("bride", "그래, 네가 원하는 대로 해도 돼."),
      message("groom", "또 내가 다 정하는 사람이 됐네."),
    ]);

    expect(result.shouldOffer).toBe(false);
    expect(result.reason).toBe("one_sided_evidence");
  });

  it("does not treat fictional conflict dialogue as the couple's own conflict", () => {
    const result = assessMediationOffer([
      message("bride", "영화에서 신부가 너는 맨날 내 말은 안 들어라고 해."),
      message("groom", "소설 속 신랑은 나만 양보한다고 싸웠어."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: false,
      evidenceCount: 0,
      reason: "one_sided_evidence",
    });
  });

  it("keeps direct current couple clauses after a fictional example", () => {
    const result = assessMediationOffer([
      message("bride", "영화에서 신부가 너는 맨날 내 말은 안 들어라고 해. 하지만 너도 내 말을 안 들어서 서운해."),
      message("groom", "소설 속 신랑은 나만 양보한다고 싸웠어. 그런데 나는 반대야."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: true,
      evidenceCount: 2,
      reason: "mutual_conflict_evidence",
    });
  });

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

  it("does not label a shared complaint about a planner and vendor as couple conflict", () => {
    const result = assessMediationOffer([
      message("bride", "플래너랑 싸웠어. 너무 답답해."),
      message("groom", "그 업체랑 말이 안 통해. 나도 화가 나."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: false,
      evidenceCount: 0,
      reason: "one_sided_evidence",
    });
  });

  it("scores direct couple clauses even when the same messages also mention third parties", () => {
    const result = assessMediationOffer([
      message("bride", "엄마가 예산이 크다고 걱정해. 하지만 너는 맨날 내 말을 안 들어서 서운해."),
      message("groom", "친구가 괜찮다는데. 나는 반대야."),
    ]);

    expect(result).toMatchObject({
      shouldOffer: true,
      evidenceCount: 2,
      reason: "mutual_conflict_evidence",
    });
  });

  it("does not revive a conflict offer after its evidence is stale", () => {
    const nowMs = Date.parse("2026-08-12T12:00:00.000Z");
    const oldCreatedAt = "2026-08-12T09:00:00.000Z";
    const result = assessMediationOffer([
      message("bride", "너는 맨날 내 말을 안 들어서 너무 서운해.", "partner", oldCreatedAt),
      message("groom", "난 절대 반대야. 그건 동의 못 해.", "partner", oldCreatedAt),
    ], { nowMs });

    expect(result).toMatchObject({
      shouldOffer: false,
      offerKey: null,
      reason: "stale_conflict_evidence",
    });
  });

  it("returns an opaque event key derived from durable message identity and time", () => {
    const first = {
      ...message("bride", "너는 맨날 내 말을 안 들어서 너무 서운해.", "partner", "2026-08-12T12:00:00.000Z"),
      id: "message-bride-1",
    };
    const second = {
      ...message("groom", "난 절대 반대야. 그건 동의 못 해.", "partner", "2026-08-12T12:01:00.000Z"),
      id: "message-groom-1",
    };

    const result = assessMediationOffer([first, second], {
      nowMs: Date.parse("2026-08-12T12:05:00.000Z"),
    });

    expect(result.shouldOffer).toBe(true);
    expect(result.offerKey).toContain("message-bride-1");
    expect(result.offerKey).toContain("2026-08-12T12:00:00.000Z");
  });

  it("keeps the event key stable when a long incident exceeds the scoring window", () => {
    const startedAt = Date.parse("2026-08-12T12:00:00.000Z");
    const messages = Array.from({ length: 8 }, (_, index) => ({
      ...message(
        index % 2 === 0 ? "bride" : "groom",
        index === 0
          ? "너는 맨날 내 말을 안 들어서 서운해."
          : index === 1
            ? "난 절대 반대야."
            : index % 2 === 0
              ? "너한테 서운해."
              : "나도 화가 나.",
        "partner",
        new Date(startedAt + index * 60_000).toISOString(),
      ),
      id: `incident-${index + 1}`,
    }));

    const firstKey = assessMediationOffer(messages.slice(0, 2), {
      nowMs: startedAt + 2 * 60_000,
    }).offerKey;
    const laterKey = assessMediationOffer(messages, {
      nowMs: startedAt + 8 * 60_000,
    }).offerKey;

    expect(firstKey).not.toBeNull();
    expect(laterKey).toBe(firstKey);
  });

  it("starts a new offer event after a quiet gap instead of reviving the earlier incident", () => {
    const result = assessMediationOffer([
      {
        ...message("bride", "너는 맨날 내 말을 안 들어.", "partner", "2026-08-12T10:00:00.000Z"),
        id: "old-bride",
      },
      {
        ...message("groom", "난 절대 반대야.", "partner", "2026-08-12T10:01:00.000Z"),
        id: "old-groom",
      },
      {
        ...message("bride", "너한테 너무 서운해.", "partner", "2026-08-12T11:00:00.000Z"),
        id: "new-bride",
      },
      {
        ...message("groom", "이번에도 의견이 안 맞네.", "partner", "2026-08-12T11:01:00.000Z"),
        id: "new-groom",
      },
    ], { nowMs: Date.parse("2026-08-12T11:05:00.000Z") });

    expect(result.shouldOffer).toBe(true);
    expect(result.evidenceCount).toBe(2);
    expect(result.offerKey).toContain("new-bride");
    expect(result.offerKey).not.toContain("old-bride");
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
