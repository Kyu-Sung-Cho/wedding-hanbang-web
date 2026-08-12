import { describe, expect, it } from "vitest";

import {
  buildAmoraCrisisResponse,
  classifyAmoraCrisis,
} from "@/lib/ai/amoraCrisisSafety";
import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";

describe("planAmoraCrisisDelivery", () => {
  it("holds a shared AI crisis locally in the bride private lane", () => {
    const result = planAmoraCrisisDelivery({
      userText: "남편이 지금 칼을 들고 협박해",
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
    });

    expect(result).toEqual(expect.objectContaining({
      disposition: "local_safety_hold",
      classification: { kind: "interpersonal_danger" },
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      response: expect.stringContaining("112"),
    }));
  });

  it("holds an explicit partner crisis delivery instead of exposing it", () => {
    const result = planAmoraCrisisDelivery({
      userText: "나 지금 죽고 싶어",
      requestedVisibility: "shared",
      target: "partner",
      senderRole: "groom",
    });

    expect(result).toEqual(expect.objectContaining({
      disposition: "local_safety_hold",
      effectiveVisibility: "groom_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: true,
      response: expect.stringContaining("109"),
    }));
  });

  it("keeps an existing private crisis private without claiming a redirect", () => {
    const result = planAmoraCrisisDelivery({
      userText: "나 지금 죽고 싶어",
      requestedVisibility: "groom_private",
      target: "ai",
      senderRole: "groom",
    });

    expect(result).toEqual(expect.objectContaining({
      disposition: "local_safety_hold",
      effectiveVisibility: "groom_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
    }));
  });

  it("routes a historical violence disclosure from shared AI to private safety 상담", () => {
    const result = planAmoraCrisisDelivery({
      userText: "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해",
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
    });

    expect(result).toEqual({
      disposition: "private_safety_route",
      safetyResolution: "non_immediate_safety",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      response: null,
    });
  });

  it("holds non-immediate safety content addressed directly to the partner", () => {
    const result = planAmoraCrisisDelivery({
      userText: "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해",
      requestedVisibility: "shared",
      target: "partner",
      senderRole: "bride",
    });

    expect(result).toEqual(expect.objectContaining({
      disposition: "local_safety_hold",
      safetyResolution: "non_immediate_safety",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: true,
      response: expect.stringContaining("바로 보내지 않았어요"),
    }));
  });

  it.each([
    "죽고 싶지 않아",
    "케이크 칼 배송 언제 와?",
  ])("keeps a clear non-crisis in its requested lane: %s", (userText) => {
    expect(planAmoraCrisisDelivery({
      userText,
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
    })).toEqual({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
  });
});

describe("assessAmoraSafetyText", () => {
  it("attributes a partner threat toward the reporter without returning raw text", () => {
    const assessment = assessAmoraSafetyText("남친이 지금 나를 죽이겠다고 해");

    expect(assessment.resolution).toBe("immediate_crisis");
    expect(assessment.kind).toBe("interpersonal_danger");
    expect(assessment.events).toContainEqual({
      actor: "known_other",
      target: "reporter",
      direction: "toward_reporter",
      action: "lethal_threat",
      temporality: "current",
      polarity: "affirmed",
      context: "disclosure",
    });
    expect(JSON.stringify(assessment)).not.toContain("남친");
    expect(JSON.stringify(assessment)).not.toContain("죽이겠");
  });

  it("attributes a partner's current self-harm disclosure to that person", () => {
    const assessment = assessAmoraSafetyText("예비신랑이 자기가 죽겠다고 해");

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "third_party_self_harm",
      responseDirection: "third_party",
    });
    expect(assessment.events).toContainEqual({
      actor: "known_other",
      target: "self",
      direction: "self_directed",
      action: "self_harm_intent",
      temporality: "current",
      polarity: "affirmed",
      context: "disclosure",
    });
  });

  it("keeps both directed violence and partner self-harm in a murder-suicide threat", () => {
    const assessment = assessAmoraSafetyText("신랑이 나를 죽이고 자기도 죽겠대");

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "combined_interpersonal_self_harm",
      responseDirection: "toward_reporter",
    });
    expect(assessment.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: "known_other",
        target: "reporter",
        direction: "toward_reporter",
        action: "lethal_threat",
        polarity: "affirmed",
      }),
      expect.objectContaining({
        actor: "known_other",
        target: "self",
        direction: "self_directed",
        action: "self_harm_intent",
        polarity: "affirmed",
      }),
    ]));
  });

  it.each([
    [
      "남친이 나 죽이겠다고 한 게 아니라 자기가 죽겠다고 해",
      "third_party_self_harm",
      "self_harm_intent",
      "lethal_threat",
    ],
    [
      "남친이 자기가 죽겠다고 한 게 아니라 나를 죽이겠다고 해",
      "interpersonal_danger",
      "lethal_threat",
      "self_harm_intent",
    ],
  ] as const)(
    "scopes a correction to the denied event instead of its affirmed contrast: %s",
    (text, kind, affirmedAction, negatedAction) => {
      const assessment = assessAmoraSafetyText(text);

      expect(assessment.kind).toBe(kind);
      expect(assessment.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: affirmedAction, polarity: "affirmed" }),
        expect.objectContaining({ action: negatedAction, polarity: "negated" }),
      ]));
    },
  );

  it("separates reporter and friend self-harm without inventing interpersonal violence", () => {
    const assessment = assessAmoraSafetyText(
      "친구가 죽고 싶다고 했어. 나도 지금 죽고 싶어",
    );

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "multi_party_self_harm",
      responseDirection: "mixed",
    });
    expect(assessment.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: "known_other", action: "self_harm_intent" }),
      expect.objectContaining({ actor: "self", action: "self_harm_intent" }),
    ]));
  });

  it("records historical violence with current safety as non-immediate", () => {
    const assessment = assessAmoraSafetyText(
      "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해",
    );

    expect(assessment).toMatchObject({
      resolution: "non_immediate_safety",
      kind: null,
      responseDirection: null,
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      actor: "known_other",
      target: "reporter",
      direction: "toward_reporter",
      action: "lethal_threat",
      temporality: "past",
      polarity: "safe_now",
      context: "disclosure",
    }));
  });

  it("does not let a past clause hide violence that resumes in the current clause", () => {
    const assessment = assessAmoraSafetyText("예전에 맞았지만 지금 또 때려");

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
    });
    expect(assessment.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ temporality: "past", action: "physical_violence" }),
      expect.objectContaining({
        temporality: "current",
        action: "physical_violence",
        polarity: "affirmed",
      }),
    ]));
  });

  it("distinguishes the reporter's imminent aggression from victim direction", () => {
    const assessment = assessAmoraSafetyText("나 지금 신랑 죽이러 갈 거야");

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger_reporter_aggressor",
      responseDirection: "reporter_toward_other",
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      actor: "self",
      target: "known_other",
      direction: "reporter_toward_other",
      action: "lethal_threat",
      temporality: "impending",
      polarity: "affirmed",
      context: "disclosure",
    }));
  });

  it("keeps reporter aggression direction when self-harm is also threatened", () => {
    const assessment = assessAmoraSafetyText("내가 남친을 죽이고 나도 죽을 거야");

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "combined_reporter_aggressor_self_harm",
      responseDirection: "reporter_toward_other",
    });
    expect(assessment.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: "reporter_toward_other",
        action: "lethal_threat",
      }),
      expect.objectContaining({
        direction: "self_directed",
        action: "self_harm_intent",
      }),
    ]));
  });

  it.each([
    "내가 남편을 때리고 있어. 남편은 죽고 싶다고 해",
    "친구가 죽고 싶다고 해. 내가 남편에게 칼을 휘두를 거야",
  ])("preserves reporter aggression and another person's self-harm together: %s", (text) => {
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "combined_reporter_aggressor_third_party_self_harm",
      responseDirection: "reporter_toward_other",
    });
    expect(assessment.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: "reporter_toward_other",
        polarity: "affirmed",
      }),
      expect.objectContaining({
        actor: "known_other",
        direction: "self_directed",
        action: "self_harm_intent",
        polarity: "affirmed",
      }),
    ]));
    expect(JSON.stringify(assessment)).not.toContain(text);
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "combined_reporter_aggressor_third_party_self_harm",
    });

    const guidance = buildAmoraCrisisResponse(
      "combined_reporter_aggressor_third_party_self_harm",
    );
    expect(guidance).toContain("행동을 멈추고");
    expect(guidance).toMatch(/경찰\s*112/);
    expect(guidance).toMatch(/소방\s*119/);
    expect(guidance).toContain("그 사람의 안전");
    expect(guidance).toMatch(/자살예방상담전화\s*109/);
    expect(guidance).not.toContain("1366");
  });

  it("preserves reporter aggression and both self-harm directions together", () => {
    const text =
      "친구가 죽고 싶다고 해. 내가 남편을 죽이고 나도 죽을 거야";
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "combined_reporter_aggressor_multi_party_self_harm",
      responseDirection: "mixed",
    });
    expect(assessment.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: "known_other",
        target: "self",
        direction: "self_directed",
        action: "self_harm_intent",
        polarity: "affirmed",
      }),
      expect.objectContaining({
        actor: "self",
        target: "known_other",
        direction: "reporter_toward_other",
        action: "lethal_threat",
        polarity: "affirmed",
      }),
      expect.objectContaining({
        actor: "self",
        target: "self",
        direction: "self_directed",
        action: "self_harm_intent",
        polarity: "affirmed",
      }),
    ]));
    expect(JSON.stringify(assessment)).not.toContain(text);
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "combined_reporter_aggressor_multi_party_self_harm",
    });

    const guidance = buildAmoraCrisisResponse(
      "combined_reporter_aggressor_multi_party_self_harm",
    );
    expect(guidance).toContain("행동을 멈추고");
    expect(guidance).toContain("칼이나 흉기를 들고 있다면 바닥에 내려놓고");
    expect(guidance).toContain("상대방 사이의 거리를");
    expect(guidance).toMatch(/경찰\s*112/);
    expect(guidance).toMatch(/소방\s*119/);
    expect(guidance).toContain("본인도 죽거나 다치고 싶은 마음");
    expect(guidance).toContain("혼자 있지 말고");
    expect(guidance).toContain("그 사람의 안전도");
    expect(guidance).toMatch(/자살예방상담전화\s*109/);
    expect(guidance).not.toContain("1366");
    expect(guidance).not.toContain(text);
  });

  it("keeps a hypothetical request for help non-immediate", () => {
    const assessment = assessAmoraSafetyText(
      "남친이 나를 죽이겠다고 하면 어떻게 해야 해?",
    );

    expect(assessment).toMatchObject({
      resolution: "non_immediate_safety",
      kind: null,
      responseDirection: null,
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      actor: "known_other",
      target: "reporter",
      direction: "toward_reporter",
      action: "lethal_threat",
      temporality: "hypothetical",
      polarity: "affirmed",
      context: "disclosure",
    }));
  });

  it.each([
    "배송 기사가 내 위치를 추적해서 집 앞에서 기다리고 있어",
    "예식장에서 케이크 칼 들고 사진 찍고 있어",
    "드레스 투어가 너무 힘들어서 죽을 것 같아",
  ])("authoritatively excludes a visible benign use of safety vocabulary: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
      events: [],
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "친구가 영화에서 죽고 싶다고 말하는 장면을 분석해줘",
    "친구가 영화에서 죽고 싶다고 말해",
    "뉴스에서 남편이 아내를 죽이겠다고 한 사건을 읽었어",
  ])("keeps fiction and news events out of immediate disclosure: %s", (text) => {
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(assessment.events).toEqual([
      expect.objectContaining({
        temporality: "hypothetical",
        polarity: "affirmed",
        context: "fiction_news",
      }),
    ]);
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    ["남친이 나 죽이겠다고 한 건 아니야", "lethal_threat"],
    ["예비신랑이 죽겠다고 한 건 아니야", "self_harm_intent"],
  ] as const)("makes an explicitly negated event non-immediate: %s", (text, action) => {
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      action,
      polarity: "negated",
      context: "disclosure",
    }));
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it("represents quoted copy review as meta context without retaining the copy", () => {
    const assessment = assessAmoraSafetyText(
      '"죽고 싶다"라는 문구를 검토해줘',
    );

    expect(assessment).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(assessment.events).toEqual([
      expect.objectContaining({
        context: "meta",
        temporality: "hypothetical",
        polarity: "affirmed",
      }),
    ]);
    expect(JSON.stringify(assessment)).not.toContain("문구");
    expect(JSON.stringify(assessment)).not.toContain("죽고 싶다");
  });

  it("normalizes invisible controls before structural self-harm attribution", () => {
    const assessment = assessAmoraSafetyText("나 지금 죽\u200B고 싶어요");

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "self_harm",
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      actor: "self",
      target: "self",
      direction: "self_directed",
      action: "self_harm_intent",
      temporality: "current",
      polarity: "affirmed",
      context: "disclosure",
    }));
  });

  it.each([
    ["졸피뎀 30알 먹었어", "self_harm", "self", "current"],
    [
      "누나가 수면제 30알 먹었어",
      "third_party_self_harm",
      "known_other",
      "current",
    ],
    [
      "상대방이 옥상에서 뛰어내리려고 해",
      "third_party_self_harm",
      "known_other",
      "impending",
    ],
  ] as const)(
    "attributes a concrete self-harm attempt without guessing from role: %s",
    (text, kind, actor, temporality) => {
      const assessment = assessAmoraSafetyText(text);

      expect(assessment).toMatchObject({ resolution: "immediate_crisis", kind });
      expect(assessment.events).toContainEqual(expect.objectContaining({
        actor,
        target: "self",
        direction: "self_directed",
        action: "self_harm_attempt",
        temporality,
        polarity: "affirmed",
        context: "disclosure",
      }));
    },
  );

  it("attributes an overdose to the nearest explicit actor, not any person in the message", () => {
    const assessment = assessAmoraSafetyText(
      "남편과 싸웠고 나는 수면제 30알 먹었어",
    );

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "self_harm",
      responseDirection: null,
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      actor: "self",
      target: "self",
      direction: "self_directed",
      action: "self_harm_attempt",
      polarity: "affirmed",
    }));
    expect(classifyAmoraCrisis("남편과 싸웠고 나는 수면제 30알 먹었어"))
      .toEqual({ kind: "self_harm" });
  });

  it.each([
    [
      "결혼 준비 너무 힘들어 죽겠는데, 남편이 지금 칼을 들고 있어",
      "interpersonal_danger",
      "known_other",
      "weapon_threat",
    ],
    [
      "남편이 나를 죽이겠다고 한 건 아니지만 나는 죽고 싶어",
      "self_harm",
      "self",
      "self_harm_intent",
    ],
    [
      "친구는 약을 많이 먹지 않았지만 나는 수면제 30알 먹었어",
      "self_harm",
      "self",
      "self_harm_attempt",
    ],
  ] as const)(
    "prioritizes a separate affirmed current event without retaining disclosure text: %s",
    (text, kind, actor, action) => {
      const assessment = assessAmoraSafetyText(text);

      expect(assessment).toMatchObject({
        resolution: "immediate_crisis",
        kind,
      });
      expect(assessment.events).toContainEqual(expect.objectContaining({
        actor,
        action,
        polarity: "affirmed",
      }));
      expect(JSON.stringify(assessment)).not.toContain(text);
    },
  );

  it("retains scoped negated events next to a separate affirmed event", () => {
    const threatAssessment = assessAmoraSafetyText(
      "남편이 나를 죽이겠다고 한 건 아니지만 나는 죽고 싶어",
    );
    const ingestionAssessment = assessAmoraSafetyText(
      "친구는 약을 많이 먹지 않았지만 나는 수면제 30알 먹었어",
    );

    expect(threatAssessment.events).toContainEqual(expect.objectContaining({
      actor: "known_other",
      action: "lethal_threat",
      polarity: "negated",
    }));
    expect(ingestionAssessment.events).toContainEqual(expect.objectContaining({
      actor: "known_other",
      action: "self_harm_attempt",
      polarity: "negated",
    }));
  });

  it.each([
    [
      "친구는 수면제 30알을 먹었고 나는 먹지 않았어",
      "third_party_self_harm",
      "known_other",
      "self",
    ],
    [
      "친구는 수면제 30알을 먹지 않았고 나는 먹었어",
      "self_harm",
      "self",
      "known_other",
    ],
  ] as const)(
    "keeps actor and negation local across an elided coordinated ingestion: %s",
    (text, kind, affirmedActor, negatedActor) => {
      const assessment = assessAmoraSafetyText(text);

      expect(assessment).toMatchObject({
        resolution: "immediate_crisis",
        kind,
      });
      expect(assessment.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor: affirmedActor,
          action: "self_harm_attempt",
          polarity: "affirmed",
        }),
        expect.objectContaining({
          actor: negatedActor,
          action: "self_harm_attempt",
          polarity: "negated",
        }),
      ]));
      expect(JSON.stringify(assessment)).not.toContain(text);
      expect(classifyAmoraCrisis(text)).toEqual({ kind });
    },
  );

  it("does not inherit a drug object when the next clause names food", () => {
    expect(
      classifyAmoraCrisis(
        "친구는 수면제 30알을 먹지 않았고 나는 밥을 먹었어",
      ),
    ).toBeNull();

    const assessment = assessAmoraSafetyText(
      "친구는 수면제 30알을 먹었고 나는 밥을 먹지 않았어",
    );
    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "third_party_self_harm",
    });
    expect(assessment.events).not.toContainEqual(expect.objectContaining({
      actor: "self",
      action: "self_harm_attempt",
    }));
  });

  it("keeps a movie scene contextual even when the viewing happened today", () => {
    const text = "오늘 본 영화에서 주인공이 칼을 들고 있어. 장면 분석해줘";
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      temporality: "hypothetical",
      context: "fiction_news",
    }));
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it("limits prevention-education context to its clause before current violence", () => {
    const text =
      "가정폭력 예방 교육 내용인데, 지금 남편이 나를 때리고 있어";
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      direction: "toward_reporter",
      action: "physical_violence",
      temporality: "current",
      polarity: "affirmed",
    }));
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it("starts an independent current disclosure after a meta newline", () => {
    const text =
      "가정폭력 예방 교육 사례를 분석해\n지금 남편이 나를 때리고 있어";
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      actor: "known_other",
      target: "reporter",
      direction: "toward_reporter",
      action: "physical_violence",
      temporality: "current",
      polarity: "affirmed",
      context: "disclosure",
    }));
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it("starts an independent current disclosure after a meta semicolon", () => {
    const text =
      "가정폭력 예방 교육 사례를 분석해; 지금 남편이 나를 때리고 있어";
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      direction: "toward_reporter",
      action: "physical_violence",
      temporality: "current",
      polarity: "affirmed",
    }));
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it("starts an independent weapon disclosure after a fiction newline", () => {
    const text =
      "영화 장면을 분석해\n지금 남편이 칼로 나를 위협하고 있어";
    const assessment = assessAmoraSafetyText(text);

    expect(assessment).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
      responseDirection: "toward_reporter",
    });
    expect(assessment.events).toContainEqual(expect.objectContaining({
      actor: "known_other",
      target: "reporter",
      direction: "toward_reporter",
      action: "weapon_threat",
      temporality: "current",
      polarity: "affirmed",
    }));
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "가정폭력 예방 교육 사례를 분석해\n남편이 아내를 때리는 사례야",
    "영화 장면을 분석해\n남편이 칼로 아내를 위협하는 장면이야",
  ])("keeps a newline-separated meta-only example non-immediate: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
      responseDirection: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });
});

describe("classifyAmoraCrisis", () => {
  it.each([
    "나 죽...고 싶어",
    "나 죽고... 싶어",
    "나 죽고만… 싶어",
  ])("detects a self-harm cue interrupted only by an ellipsis: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
  });

  it.each([
    "더는 못 살겠어",
    "차라리 죽는 게 나아",
    "이제 그만 살래",
  ])("detects an unambiguous first-person self-harm idiom: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
  });

  it("does not escalate a standalone ambiguous ending idiom", () => {
    expect(classifyAmoraCrisis("모든 걸 끝내고 싶어")).toBeNull();
  });

  it("detects a direct self-harm disclosure after Unicode and zero-width normalization", () => {
    expect(classifyAmoraCrisis("지금 죽\u200B고 싶어요")).toEqual({
      kind: "self_harm",
    });
    expect(classifyAmoraCrisis("지금 죽\u2066고 싶어요")).toEqual({
      kind: "self_harm",
    });
    expect(classifyAmoraCrisis("성\u034F폭행을 당했어")).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it("does not treat quoted or educational discussion as a current crisis", () => {
    expect(classifyAmoraCrisis('"죽고 싶다"라는 문구를 검토해줘')).toBeNull();
    expect(classifyAmoraCrisis("자살 예방 캠페인 문구를 추천해줘")).toBeNull();
  });

  it.each([
    '친구가 "죽고 싶다"고 말했는데 어떻게 도와?',
    "친구가 지금 죽으려고 약을 먹었어. 어떻게 도와?",
    "친구가 목숨을 끊고 싶어해. 어떻게 도와야 할까?",
    "동생이 자해할 생각이 든다고 했어",
    "친구가 방금 수면제를 한 통 먹었어요",
    "친구가 수면제 30알을 먹었어요",
    "동생이 약을 다 삼켰어",
    "친구가 목을 맸다가 풀었어",
    "친구가 타이레놀 30알 먹었어",
    "친구가 아세트아미노펜을 과다 복용했어",
    "엄마가 약을 한꺼번에 먹었어",
    "친구가 수면제 열 알 먹었어",
    "친구가 수면제 10개 먹었어",
    "친구가 농약을 마셨어",
    "친구가 락스를 마셨어",
    "친구가 세제를 마셨어",
    "친구가 번개탄 피웠어",
    "친구가 연탄 피웠어",
    "친구가 차 안에 번개탄을 피워놨어",
    "친구가 차 안에서 번개탄을 피우고 있어",
    "친구가 아파트 옥상에서 뛰어내릴 거야",
    "친구가 다리에서 뛰어내리려고 해",
    "친구가 수면제를 먹고 의식이 없어요",
  ])("detects a real third-party self-harm disclosure: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "third_party_self_harm",
    });
  });

  it.each([
    "살고 싶지 않아",
    "자살하고 싶어요",
    "자해할 생각이 들어",
    "지금 목숨을 끊을 거야",
    "극단적 선택을 하려고 해",
    "죽으려고 약을 먹었어",
    "방금 손목을 그었어",
    "그냥 죽어버릴 거야",
    "나 그냥 죽을래",
    "죽어야겠어",
    "죽어 버리고 싶어",
    "목숨을 끊어버리고 싶어",
    "제가 방금 수면제를 한 통 먹었어요",
    "제가 수면제 30알을 먹었어요",
    "나 지금 약을 다 삼켰어",
    "진통제를 너무 많이 먹었어",
    "목을 맸다가 풀었어",
    "옥상 난간에서 뛰어내리려고 해",
    "타이레놀 30알 먹었어",
    "아세트아미노펜을 과다 복용했어",
    "약을 한꺼번에 먹었어",
    "약을 왕창 먹었어",
    "약 한 움큼 먹었어",
    "수면제 열 알 먹었어",
    "수면제 10개 먹었어",
    "농약을 마셨어",
    "락스를 마셨어",
    "세제를 마셨어",
    "부동액을 마셨어",
    "번개탄 피웠어",
    "연탄 피웠어",
    "차 안에서 번개탄 피워놨어",
    "차 안에서 번개탄을 피우고 있어",
    "아파트 옥상에서 뛰어내릴 거야",
    "다리에서 뛰어내릴래",
    "자살 예방 글을 읽다가 오히려 죽고 싶어졌어",
    "영화를 보고 죽고 싶어졌어",
    "자살 예방 영상을 봤는데 나도 죽고 싶어",
    "논문 쓰다가 너무 힘들어서 죽고 싶어",
    "나 죽으려고 해",
    "오늘 죽을 생각이에요",
    "자살 생각이 들어요",
    "약을 먹고 죽으려고 했어요",
    "수면제를 먹었어요. 죽으려고요",
    "베란다에서 뛰어내리려고 해요",
    "한강에서 뛰어내릴 거야",
  ])("detects direct self-harm intent or a reported attempt: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
  });

  it.each([
    ["목숨을 끊고 싶어", "self_harm"],
    ["죽어버릴래", "self_harm"],
    ["협박하고 있어", "interpersonal_danger"],
    ["계속 협박하고 있어", "interpersonal_danger"],
    ["성범죄를 당하고 있어", "interpersonal_danger"],
  ] as const)("detects common Korean crisis phrasing: %s", (text, kind) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind });
  });

  it.each([
    ["그만 살고 싶어", "self_harm"],
    ["죽고만 싶어", "self_harm"],
    ["나 차라리 사라지고 싶어", "self_harm"],
    ["지금 살고 싶은 마음이 하나도 없어", "self_harm"],
    ["약을 잔뜩 털어 넣었어", "self_harm"],
    ["친구가 그만 살고 싶다고 했어", "third_party_self_harm"],
    ["친구가 약을 잔뜩 털어 넣었어", "third_party_self_harm"],
    ["나는 친구가 그만 살고 싶다고 해서 걱정돼", "third_party_self_harm"],
    ["나는 친구가 약을 잔뜩 털어 넣어서 걱정돼", "third_party_self_harm"],
    ["친구는 내가 그만 살고 싶다고 해서 걱정해", "self_harm"],
    ["친구는 내가 약을 잔뜩 털어 넣어서 걱정해", "self_harm"],
  ] as const)("detects high-risk Korean euphemisms without losing attribution: %s", (text, kind) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind });
  });

  it.each([
    "지금 남자친구가 나를 때리고 있어",
    "방금 배우자에게 맞았어",
    "칼을 들고 죽이겠다고 협박해",
    "집에 감금됐어. 못 나가게 해",
    "스토킹 중이고 지금 집 앞에 있어",
    "성\u200B폭행을 당했어",
    "강제로 성관계를 요구하면서 위협하고 있어",
    "데이트폭력을 당하고 있어",
    "배우자가 폭력을 쓰고 있어",
    "상대가 나를 죽일 것 같아",
    "남편이 칼을 들고 있어. 살려줘",
    "상대가 나를 죽여버리겠다고 해",
    "성범죄 피해를 입었어",
    "남편이 위협 중이야",
    "남편에게 맞았는데 법적 도움 받고 싶어",
    "남편에게 맞아서 법적 대응하고 싶어",
    "성폭행을 당했는데 법적 도움을 받고 싶어",
    "남편이 지금 목을 조르고 있어요",
    "남자친구가 성관계를 강요해요",
    "남편이 저를 죽이려고 해요",
    "남편이 내 목을 졸랐어",
    "나를 발로 찼어",
    "신랑이 주먹으로 쳤어",
    "남편이 밀치고 물건을 던지고 있어",
    "칼 들고 집 앞에 찾아왔어",
    "내 위치를 추적해서 집 앞에서 기다리고 있어",
    "강제로 관계를 맺었어",
  ])("detects a current violence, threat, or sexual-violence disclosure: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "interpersonal_danger" });
  });

  it.each([
    "예비신랑이 지금 날 때려",
    "신랑이 지금 죽여버린다고 말해",
    "그 사람이 지금 저를 때려요",
    "파트너가 지금 절 때리고 있어요",
    "상대방이 지금 때리는 중이야",
    "지금 맞는 중이야",
    "지금 집에서 못 나가게 막고 있어",
    "남친이 칼 들고 죽인다고 해",
    "그 사람이 죽여버리겠대",
    "상대가 지금 물건을 던지고 있어",
    "남편이 지금 벽을 치고 물건을 부숴",
    "지금 또 때려",
    "지금 날 때리고 있어",
    "방금 절 때렸어요",
    "예전에 맞았지만 지금 또 때려",
    "전 남친이 지금 집 앞에 와 있어. 무서워",
    "헤어진 애인이 계속 따라와",
    "전 애인이 집 앞에서 기다리고 있어 살려줘",
    "신랑이 지금 방에 가둬놨어",
    "남친이 집에 가둬 두고 있어",
    "남친이 싫다는데 억지로 성관계하려고 해",
    "동의 없이 지금 옷을 벗기고 있어",
  ])("detects natural current Korean interpersonal-danger phrasing: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "interpersonal_danger" });
  });

  it.each([
    ["남편이 문을 잠그고 나를 못 나가게 하고 있어", "coercive_control"],
    ["남편이 베개로 내 얼굴을 누르고 있어", "physical_violence"],
    ["남편이 숨을 못 쉬게 하고 있어", "physical_violence"],
    ["남편이 머리채를 잡고 끌고 있어", "physical_violence"],
    ["남편이 물건을 던져서 내가 맞았어", "physical_violence"],
    ["남편이 나를 때리지 않지만 문을 잠그고 못 나가게 해", "coercive_control"],
    ["남편이 나를 때린 건 아니고 밀쳤어", "physical_violence"],
  ] as const)(
    "routes a distinct current partner danger into the immediate private safety flow: %s",
    (text, action) => {
      expect(assessAmoraSafetyText(text)).toMatchObject({
        resolution: "immediate_crisis",
        kind: "interpersonal_danger",
        responseDirection: "toward_reporter",
        events: expect.arrayContaining([
          expect.objectContaining({
            target: "reporter",
            action,
            polarity: "affirmed",
          }),
        ]),
      });
      expect(classifyAmoraCrisis(text)).toEqual({ kind: "interpersonal_danger" });
    },
  );

  it("does not treat a partner hitting a mosquito as violence toward the reporter", () => {
    expect(assessAmoraSafetyText("남편이 모기를 때리고 있어")).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis("남편이 모기를 때리고 있어")).toBeNull();
  });

  it.each([
    "나 지금 신랑 죽이러 갈 거야",
    "남친 죽여버릴 거야",
    "칼 들고 남편 찾아갈 거야",
    "나 지금 남편 때리고 있어",
  ])("detects current or imminent user-to-partner harm: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger_reporter_aggressor",
    });
  });

  it("keeps interpersonal and self-harm support when the user threatens both", () => {
    expect(classifyAmoraCrisis("내가 남친을 죽이고 나도 죽을 거야")).toEqual({
      kind: "combined_reporter_aggressor_self_harm",
    });
  });

  it.each([
    ["나 지금 뛰어내리려고 옥상에 있어", "self_harm"],
    ["졸피뎀 30알 먹었어", "self_harm"],
    ["예비신랑이 지금 죽겠다고 해", "third_party_self_harm"],
    ["남친이 지금 죽고 싶다고 해", "third_party_self_harm"],
    ["상대방이 옥상에서 뛰어내리려고 해", "third_party_self_harm"],
    ["남친이 지금 나 죽이겠다고 해", "interpersonal_danger"],
    ["예비신랑이 자기가 죽겠다고 해", "third_party_self_harm"],
    ["신랑이 나를 죽이고 자기도 죽겠대", "combined_interpersonal_self_harm"],
    ["남친이 나 죽이겠다고 한 게 아니라 자기가 죽겠다고 해", "third_party_self_harm"],
    ["남친이 자기가 죽겠다고 한 게 아니라 나를 죽이겠다고 해", "interpersonal_danger"],
  ] as const)("keeps expanded self-harm attribution exact: %s", (text, kind) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind });
  });

  it.each([
    "예전에 남편에게 맞았어요",
    "상대가 과거에 칼로 협박했어요",
    "예전에 감금당한 적이 있어요",
    "과거에 성폭행 피해를 입었어요",
    "작년에 신랑이 저를 때렸어요",
    "신랑이 화나면 때릴 것 같아",
    "상대가 때릴까 봐 걱정돼",
    "전 애인이 지금 집 앞에서 기다리고 있어",
    "예전에 남친이 죽여버린다고 말했어",
    "작년에 신랑이 칼 들고 죽인다고 했어",
    "예전에 남편에게 맞았는데 지금은 안전해",
    "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해",
    "작년에 남친이 방에 가둬놨어",
    "예전에 동의 없이 옷을 벗겼어",
  ])("does not label explicit history, fear, or neutral waiting as an immediate crisis: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "가정폭력 상담 페이지 문구를 작성해줘",
    '"죽이겠다"는 협박 표현의 법적 의미가 뭐야?',
    "결혼식장 폭력 예방 정책을 검토해줘",
    "영화의 성폭행 장면에 대한 비평을 써줘",
  ])("does not classify meta discussion of violence as current danger: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "퀴즈 정답을 맞았어",
    "하나를 때리는 장면을 편집해줘",
    "내가 쓴 소설에서 주인공이 자살하고 싶어해",
    "고객이 자살하고 싶다고 쓴 메시지에 어떻게 답해야 해?",
    "누가 죽고 싶다고 말하면 뭐라고 해야 해?",
    "죽고 싶지 않아. 나는 살고 싶어",
    "자해하지 않을 거야",
    '"죽어버릴래"라는 대사를 다듬어줘',
    '"계속 협박하고 있어"라는 문구를 검토해줘',
    "성범죄 예방 교육 문구를 써줘",
    "법적으로 협박이라는 단어의 의미를 검토해줘",
    "누구를 협박하고 있지 않아",
    "성범죄를 당하고 있지 않아",
    "처방대로 수면제를 한 알 먹었어",
    "처방대로 타이레놀 한 알 먹었어",
    "수면제를 한 통 먹으면 어떻게 되나요?",
    "타이레놀 30알 먹으면 어떻게 되나요?",
    "농약을 마시면 어떻게 되나요?",
    "번개탄을 피우면 어떻게 되나요?",
    "옥상에서 뛰어내리면 어떻게 되나요?",
    "약을 다 먹은 건 아니야",
    "타이레놀 30알 먹은 건 아니야",
    "수면제 열 알 먹지 않았어",
    "수면제 열 알 먹으면 위험해?",
    "락스를 마신 건 아니야",
    "세제를 마시지 않았어",
    "세제를 마셨다면 어떻게 해야 해?",
    "번개탄을 피운 건 아니야",
    "번개탄을 피워놓은 건 아니야",
    "번개탄을 피워놓으면 어떻게 돼?",
    "연탄을 피운 건 아니야",
    "옥상에서 뛰어내리려는 건 아니야",
    "목을 매지 않았어",
    "영화에서 주인공이 수면제를 한 통 먹는 장면을 검토해줘",
    '"타이레놀 30알 먹었어"라는 대사를 검토해줘',
    '"차 안에 번개탄을 피워놨어"라는 영화 대사를 검토해줘',
    "뉴스에서 번개탄을 피운 사건을 읽었어",
    "번개탄을 피운 사건을 뉴스에서 읽었어",
    "보일러에 연탄을 갈았어",
    "소설에서 주인공이 농약을 마시는 장면을 검토해줘",
    "드레스 투어 너무 힘들어서 죽을 것 같아",
    "친구가 웃겨서 죽을 것 같아",
    "남편이 게임에서 나를 죽이려고 해",
    "그만 살고 싶은 건 아니야",
    "죽고만 싶은 건 아니야",
    "차라리 사라지고 싶은 건 아니야",
    "살고 싶은 마음이 없는 건 아니야",
    "그만 살고 싶으면 어떻게 도와야 해?",
    "약을 잔뜩 털어 넣은 건 아니야",
    "약을 잔뜩 털어 넣으면 어떻게 돼?",
    "영화에서 주인공이 약을 잔뜩 털어 넣는 장면을 검토해줘",
    "친구가 약을 약통에 잔뜩 털어 넣었어",
    "신랑이 넥타이를 너무 꽉 졸랐어",
    "드레스 허리끈을 졸랐어",
    "축구하다가 공을 발로 찼어",
    "신랑이 축구공을 발로 찼어",
    "신랑이 주먹으로 문을 쳤어",
    "결혼식에서 꽃가루를 던지고 있어",
    "업체와 강제로 관계를 맺었어",
    "강제로 관계를 맺은 건 아니야",
    "영화에서 주인공이 강제로 관계를 맺는 장면을 검토해줘",
    "칼을 들고 집 앞에 찾아온 건 아니야",
    "배송 기사 위치를 추적해서 집 앞에서 기다리고 있어",
    "남편이 내 목을 조른 건 아니야",
    "남편이 내 목을 조르지 않았어",
    "나를 발로 차지 않았어",
    "신랑이 주먹으로 치지 않았어",
    "남편이 게임에서 칼 들고 집 앞에 찾아왔어",
    "나 뛰어내리려고 옥상에 있는 건 아니야",
    "졸피뎀 30알 먹은 건 아니야",
    "예비신랑이 죽겠다고 한 건 아니야",
    "상대방이 옥상에서 뛰어내리려고 한 건 아니야",
    "남친이 나 죽이겠다고 한 건 아니야",
    "내가 남편 때린 건 아니야",
  ])("avoids ambiguous, hypothetical, or non-current false positives: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it("still detects a direct disclosure after a meta or third-person clause", () => {
    expect(classifyAmoraCrisis("친구가 죽고 싶다고 했어. 나도 지금 죽고 싶어")).toEqual({
      kind: "multi_party_self_harm",
    });
    expect(classifyAmoraCrisis("영화 얘기가 아니라, 나 진짜 죽고 싶어")).toEqual({
      kind: "self_harm",
    });
    expect(
      classifyAmoraCrisis("법적 도움 받고 싶은데 남편이 지금 나를 때리고 있어")
    ).toEqual({ kind: "interpersonal_danger" });
    expect(
      classifyAmoraCrisis("예방 교육도 들었는데 오늘 남편이 나를 때리고 있어")
    ).toEqual({ kind: "interpersonal_danger" });
    expect(
      classifyAmoraCrisis('"죽이겠다"라고 말하면서 칼을 들고 있어')
    ).toEqual({ kind: "interpersonal_danger" });
    expect(
      classifyAmoraCrisis('"죽고 싶어"라고 말하고 지금 약을 먹었어')
    ).toEqual({ kind: "self_harm" });
  });

  it("does not let a benign idiom hide a separate current weapon danger", () => {
    expect(
      classifyAmoraCrisis(
        "결혼 준비 너무 힘들어 죽겠는데, 남편이 지금 칼을 들고 있어",
      ),
    ).toEqual({ kind: "interpersonal_danger" });
  });

  it.each([
    "예산 때문에 못 살겠어 그냥 죽고 싶어",
    "그냥 죽고 싶어 예산 때문에 못 살겠어",
    "결혼 준비 때문에 못 살겠어 자살하고 싶어",
    "예산 때문에 못 살겠어 그냥 사라지고 싶어",
    "예산 때문에 죽고 싶고 못 살겠어",
  ])("does not let a no-punctuation benign idiom hide self-harm intent: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind: "self_harm" });
  });

  it.each([
    "예산 늘어나서 못 살겠어요",
    "결혼 준비 때문에 못 살겠어",
    "신혼집 견적 때문에 못 살겠어요",
  ])("keeps a standalone planning idiom non-crisis: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "신혼집에서 남편이 지금 때려서 못 살겠어",
    "예산 때문에 남편이 협박해서 못 살겠어요",
    "웨딩홀 문제로 배우자가 칼로 위협해서 못 살겠어",
    "하객 문제로 남편이 가둬서 못 살겠어",
    "못 살겠어 예산 문제도 있고 남편이 지금 때리고 있어",
  ])("does not let a no-punctuation planning idiom hide current partner violence: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
    });
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "케이크 칼로 사진 찍다가 남편이 칼로 위협해",
    "케이크 칼로 자르고 있는데 남편이 지금 때려",
    "배송 기사가 내 위치를 추적해서 집 앞에서 기다리는데 남편이 지금 때려",
    "택배 기사가 내 위치 추적해서 문 앞 기다리고 있고 남편이 협박해",
  ])("keeps danger outside a benign cake or delivery span: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
    });
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "케이크 칼로 사진 찍었어",
    "케이크 칼로 자르는 중이야",
    "배송 기사가 내 위치를 추적해서 집 앞에서 기다리는 중이야",
    "택배 기사가 내 위치 추적해서 문 앞에서 기다려",
  ])("keeps a standalone benign cake or delivery span non-crisis: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "영화에서 남편이 아내를 때리는 장면을 보다가 지금 남편이 나를 때려",
    "뉴스에서 남편이 아내를 협박한 사건을 읽다가 지금 남편이 나를 협박해",
    "게임에서 칼로 위협하는 장면인데 지금 남편이 칼로 나를 위협해",
    "가정폭력 예방 교육 문구를 보다가 지금 남편이 나를 때려",
  ])("keeps an explicit current disclosure after same-clause context: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
    });
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "남편이 나를 협박한 건 아니지만 지금 칼로 위협해",
    "자해하지 않을 거야 그런데 남편이 지금 때려",
    "남편이 예전에 때린 건 아니고 지금 때리고 있어",
  ])("keeps current danger after a same-clause negation or historical phrase: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
    });
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "남편이 지금 정답을 때려 맞히는 중이야",
    "신랑이 지금 드럼을 때려 연주하고 있어",
    "배우자가 지금 공을 때려서 홈런 쳤어",
    "지금 타자를 때려 잡는 투수 얘기야",
    "신랑이 지금 케이크 장식을 때려 박고 있어",
    "남편이 지금 협박 영화를 보고 있어",
    "배우자가 지금 위협 탐지 교육 영상을 보는 중이야",
  ])("does not turn sports, music, craft, or safety-media language into a crisis: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "배송 기사가 내 위치를 추적하는데 남편이 지금 나를 때려서 집 앞에서 기다려",
    "케이크 칼을 들고 남편이 지금 나를 위협해서 사진을 찍었어",
    "협박 영화를 남편이 지금 나를 때리면서 보고 있어",
  ])("keeps real violence embedded inside a broad benign context span: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
    });
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
    expect(planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
    })).toMatchObject({
      disposition: "local_safety_hold",
      effectiveVisibility: "bride_private",
    });
  });

  it.each([
    "영화에서 남편이 아내를 때리는 장면처럼 지금 남편이 나를 때려",
    "뉴스에서 남편이 아내를 협박한 사건과 다르게 지금 남편이 나를 협박해",
    "영화 속 장면 지금 남편이 나를 때려요",
  ])("evaluates an explicit current-danger suffix after fiction or news: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "남편이 나를 협박하는 건 아니지만 나를 때려요",
    "남편이 나를 협박한 건 아니지만 때리고 있어",
    "남편이 예전에 때렸지만 요즘도 나를 때려요",
  ])("keeps a current event local after negated or historical context: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "immediate_crisis",
      kind: "interpersonal_danger",
    });
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "엄마가 나를 때려요",
    "아빠가 저를 협박해요",
  ])("detects current violence by an explicitly named known other: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "친구가 나한테 죽고 싶다고 했어",
    "친구가 나에게 죽고 싶다고 했어",
  ])("keeps a reporter recipient phrase attributed to the known other: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "third_party_self_harm",
    });
  });

  it.each([
    "남편이 지금 공을 때려요",
    "남편이 지금 드럼을 때려요",
    "신랑이 지금 못을 망치로 때려요",
    "남편이 영화에서 배우를 때려요",
  ])("does not infer reporter violence from an explicit non-reporter hit object: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "뉴스 사건을 읽었는데 지금 엄마가 나를 가둬",
    "뉴스 사건을 읽었어. 지금 엄마가 나를 가둬",
    "뉴스 사건을 읽었는데 지금 엄마가 나를 감금해",
    "뉴스 사건을 읽었는데 지금 엄마가 나를 죽이려고 해",
  ])("keeps confinement or lethal danger after a fiction/news context: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "예산 때문에 못 살겠어 남편이 나를 때려",
    "예산 때문에 못 살겠어 남편이 지금 나를 때려",
    "예산 때문에 못 살겠고 남편이 나를 때려",
  ])("does not let a planning idiom hide a bare current hit: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it.each([
    "영화 장면인데 지금 남편이 나를 때리는 장면을 분석해",
    "영화 장면에서 지금 남편이 나를 때리는 연기를 해",
    "영화 장면인데 지금 남편이 아내를 때리는 장면을 분석해",
  ])("keeps explicit fiction analysis or acting non-crisis: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "남편이 지금 나를 위협하는 게 아니라 정답을 때려 맞히는 중이야",
    "남편이 지금 나를 때리는 게 아니라 공을 때려서 홈런 쳤어",
  ])("scopes a negated danger before an explicit benign hit: %s", (text) => {
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    "영화 장면에서 남편이 나를 때리는 연기를 했는데 촬영 끝나고 남편이 실제로 나를 때려",
    "영화 장면인데 지금 남편이 나를 때리는 장면을 분석하고 현실에서도 계속 나를 때려",
    "남편이 나를 위협하는 게 아니라 정답을 때려 맞히다가 갑자기 나를 위협해",
  ])("keeps affirmed real danger after a benign or negated span: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toEqual({
      kind: "interpersonal_danger",
    });
  });

  it("keeps an explicit media-analysis acting disclosure non-crisis", () => {
    const text = "협박 영상을 분석하고 있는데 남편이 지금 나를 협박하는 연기를 해";
    expect(assessAmoraSafetyText(text)).toMatchObject({
      resolution: "no_safety_signal",
      kind: null,
    });
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it("does not let a negated partner threat hide the reporter's current self-harm intent", () => {
    expect(
      classifyAmoraCrisis(
        "남편이 나를 죽이겠다고 한 건 아니지만 나는 죽고 싶어",
      ),
    ).toEqual({ kind: "self_harm" });
  });

  it("does not let another person's negated ingestion hide the reporter's overdose", () => {
    expect(
      classifyAmoraCrisis(
        "친구는 약을 많이 먹지 않았지만 나는 수면제 30알 먹었어",
      ),
    ).toEqual({ kind: "self_harm" });
  });

  it.each([
    [
      "남편이 나를 죽이겠다고 한 건 아니지만 남편은 지금 나를 때리고 있어",
      "interpersonal_danger",
    ],
    [
      "남편이 때리겠다고 하면 신고하려 했는데 남편이 지금 칼을 들고 있어",
      "interpersonal_danger",
    ],
    [
      "남편이 자살한다고 말하면 109에 전화하려 했는데 나는 지금 죽고 싶어",
      "self_harm",
    ],
  ] as const)(
    "keeps negation or hypothetical context inside its clause before a current crisis: %s",
    (text, kind) => {
      expect(classifyAmoraCrisis(text)).toEqual({ kind });
    },
  );

  it.each([
    "남편이 나를 협박한 건 아니고 그냥 다퉜어",
    "남편이 날 죽일 거라는 건 아니야",
    "남편이 나 죽인다는 건 아니야",
    "남편이 휴대폰을 뺏거나 집에 가둔 건 아니야",
    "남편에게 칼을 휘두를 건 아니야",
    "가정폭력 예방 교육에서 남편이 아내를 때리고 있다고 가정해",
    "영화에서, 남편이 지금 나를 때리고 있는 장면을 분석해줘",
  ])("keeps a negated or contextual violence cue non-immediate: %s", (text) => {
    expect(classifyAmoraCrisis(text)).toBeNull();
  });

  it.each([
    [
      "친구는 수면제 30알을 먹지 않았고, 나는 수면제 30알 먹었어",
      "self_harm",
    ],
    [
      "남편이 나를 죽이겠다고 한 건 아니고, 지금 나를 때리고 있어",
      "interpersonal_danger",
    ],
    [
      "남편이 때리겠다고 하면 신고하고, 지금 남편이 칼을 들고 있어",
      "interpersonal_danger",
    ],
    [
      "남편이 자살한다고 말하면 109에 전화하고, 나는 지금 죽고 싶어",
      "self_harm",
    ],
  ] as const)(
    "starts a new safety clause after a comma and a new actor or current marker: %s",
    (text, kind) => {
      expect(classifyAmoraCrisis(text)).toEqual({ kind });
    },
  );

  it.each([
    ["죽고 싶지 않지만 자해할 생각이 들어", "self_harm"],
    ["남편이 협박하고 있지 않지만 폭력을 쓰고 있어", "interpersonal_danger"],
  ] as const)("scopes a negation to its own cue: %s", (text, kind) => {
    expect(classifyAmoraCrisis(text)).toEqual({ kind });
  });

  it("keeps both safety paths when self-harm and interpersonal danger coexist", () => {
    expect(classifyAmoraCrisis("상대가 칼을 들고 협박해. 나도 죽고 싶어")).toEqual({
      kind: "combined_interpersonal_self_harm",
    });
  });

  it.each([
    "남편이 날 죽일 거야",
    "남편이 나 죽인대",
    "남편이 휴대폰을 뺏고 집에 가뒀어",
    "남편이 집 앞에서 기다리며 계속 따라와",
    "남편이 차로 나를 들이받으려 해",
  ])("keeps lethal, confinement, stalking, and vehicle danger toward the reporter: %s", (text) => {
    const classification = classifyAmoraCrisis(text);

    expect(classification).toEqual({ kind: "interpersonal_danger" });
    expect(buildAmoraCrisisResponse("interpersonal_danger"))
      .toContain("여성긴급전화 1366");
  });

  it.each([
    "내가 남편 목을 조르고 있어",
    "남편에게 칼을 휘두를 거야",
  ])("keeps strangulation or weapon violence directed from the reporter: %s", (text) => {
    const classification = classifyAmoraCrisis(text);

    expect(classification).toEqual({
      kind: "interpersonal_danger_reporter_aggressor",
    });
    const guidance = buildAmoraCrisisResponse(
      "interpersonal_danger_reporter_aggressor",
    );
    expect(guidance).toContain("거리를 두세요");
    expect(guidance).not.toContain("여성긴급전화 1366");
  });
});

describe("buildAmoraCrisisResponse", () => {
  it("uses fixed Korean self-harm contacts and an outside-Korea fallback", () => {
    const response = buildAmoraCrisisResponse("self_harm");

    expect(response).toContain("위기 상담기관이 아니");
    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toContain("24시간");
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toContain("한국 밖");
    expect(response).toContain("현지 긴급번호");
  });

  it("uses fixed violence-support contacts without assuming the user is in Korea", () => {
    const response = buildAmoraCrisisResponse("interpersonal_danger");

    expect(response).toContain("위기 상담기관이 아니");
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toMatch(/여성긴급전화\s*1366/);
    expect(response).toContain("365일 24시간");
    expect(response).toContain("본인과 다른 사람 모두의 안전");
    expect(response).toContain("한국 밖");
    expect(response).toContain("현지 긴급번호");
  });

  it("gives a reporter immediate third-party safety steps and fixed contacts", () => {
    const response = buildAmoraCrisisResponse("third_party_self_harm");

    expect(response).toContain("혼자 책임지려 하지 말고");
    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toContain("함께 전화");
    expect(response).toContain("한국 밖");
  });

  it("includes both 109 and 1366 for interpersonal danger plus self-harm", () => {
    const response = buildAmoraCrisisResponse("combined_interpersonal_self_harm");

    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toMatch(/여성긴급전화\s*1366/);
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toContain("한국 밖");
  });

  it("does not add a violence-support line to multi-party self-harm", () => {
    const response = buildAmoraCrisisResponse("multi_party_self_harm");

    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).not.toMatch(/1366/);
  });

  it("gives direction-specific de-escalation when the reporter may hurt someone", () => {
    const response = buildAmoraCrisisResponse(
      "interpersonal_danger_reporter_aggressor",
    );

    expect(response).toMatch(/다가가거나 따라가지/);
    expect(response).toMatch(/칼이나 흉기.*내려놓/);
    expect(response).toContain("거리를 두세요");
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).toContain("믿을 수 있는 사람");
    expect(response).not.toMatch(/1366/);
  });

  it("adds self-harm support without victim-only services for reporter aggression", () => {
    const response = buildAmoraCrisisResponse(
      "combined_reporter_aggressor_self_harm",
    );

    expect(response).toMatch(/자살예방상담전화\s*109/);
    expect(response).toMatch(/다가가거나 따라가지/);
    expect(response).toMatch(/경찰\s*112/);
    expect(response).toMatch(/소방\s*119/);
    expect(response).not.toMatch(/1366/);
  });
});
