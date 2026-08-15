import { describe, expect, it } from "vitest";

import {
  AMORA_SCHEDULE_CARE_ACTION_DRAFT_CLOSE_TAG,
  AMORA_SCHEDULE_CARE_ACTION_DRAFT_OPEN_TAG,
  AMORA_SCHEDULE_CARE_SHARED_ACTION_CONFIRMATION,
  AMORA_SCHEDULE_CARE_SHARED_ACTION_INTRO,
  buildAmoraScheduleCareDAfterContext,
  extractAmoraScheduleCareActionDraft,
  parseAmoraScheduleCareSharedActionDraft,
} from "@/lib/ai/amoraScheduleCareFollowUp";

const canonicalCare = {
  eventTitle: "양가 부모님 첫 만남",
  eventDate: "2026-08-14",
  question:
    "실제로 합의된 내용과 아직 의견만 나온 내용을 나눠서 정리해볼까? 저장은 네가 원하는 항목만 할게.",
};

function marker(value: unknown): string {
  return `${AMORA_SCHEDULE_CARE_ACTION_DRAFT_OPEN_TAG}${JSON.stringify(value)}${AMORA_SCHEDULE_CARE_ACTION_DRAFT_CLOSE_TAG}`;
}

describe("Amora sanggyeonrye D+1 provider boundary", () => {
  it("builds a bounded private context from only the canonical event fields", () => {
    const context = buildAmoraScheduleCareDAfterContext(canonicalCare);

    expect(context).toContain("sanggyeonrye");
    expect(context).toContain("dAfter");
    expect(context).toContain(JSON.stringify(canonicalCare.eventTitle));
    expect(context).toContain(JSON.stringify(canonicalCare.eventDate));
    expect(context).toContain(JSON.stringify(canonicalCare.question));
    expect(context).toContain("사용자가 직접 말한 내용");
    expect(context).toContain("합의된 내용");
    expect(context).toContain("아직 논의 중인 내용");
    expect(context).toContain("저장하거나 공유하거나 전송하지 마세요");
    expect(context).toContain("최대 한 개");
    expect(context).not.toContain("sourceEventId");
    expect(context).not.toContain("sourceStateDigest");
  });

  it("accepts one strictly valid private action draft and removes its marker", () => {
    const draft = {
      version: 1,
      title: "상견례에서 나온 항목을 둘이 구분하기",
      reason: "합의된 내용과 아직 논의 중인 내용을 같은 기준으로 확인해요.",
      completionCriterion: "두 목록을 나누고 서로 확인하면 끝나요.",
    };
    const result = extractAmoraScheduleCareActionDraft(
      `먼저 사실과 의견을 나눠볼게요.\n${marker(draft)}`,
    );

    expect(result).toEqual({
      cleanText: "먼저 사실과 의견을 나눠볼게요.",
      draft,
      hadMarker: true,
      replacedUnsafeClaim: false,
    });
  });

  it("drops malformed or multiple drafts while stripping every private marker", () => {
    const validDraft = {
      version: 1,
      title: "한 가지 확인하기",
      reason: "둘이 같은 이해인지 확인해요.",
      completionCriterion: "서로 확인하면 끝나요.",
    };
    const result = extractAmoraScheduleCareActionDraft(
      `정리해볼게요.\n${marker(validDraft)}\n${marker(validDraft)}`,
    );

    expect(result.cleanText).toBe("정리해볼게요.");
    expect(result.draft).toBeNull();
    expect(result.hadMarker).toBe(true);
    expect(result.replacedUnsafeClaim).toBe(false);
    expect(result.cleanText).not.toContain("amora_schedule_care_action_draft");
  });

  it("keeps a marker-only valid draft from producing a blank assistant reply", () => {
    const result = extractAmoraScheduleCareActionDraft(marker({
      version: 1,
      title: "한 가지 확인하기",
      reason: "둘이 같은 이해인지 확인해요.",
      completionCriterion: "서로 확인하면 끝나요.",
    }));

    expect(result.cleanText).toBe(
      "둘이 확인할 수 있는 작은 다음 행동으로 정리했어요. 아직 저장하거나 공유하지 않았어요.",
    );
    expect(result.draft).not.toBeNull();
  });

  it("turns a marker-only malformed draft into nonblank private recovery copy", () => {
    const result = extractAmoraScheduleCareActionDraft(
      `${AMORA_SCHEDULE_CARE_ACTION_DRAFT_OPEN_TAG}{"version":1`,
    );

    expect(result.cleanText).toBe(
      "지금 내용은 확정하거나 저장하지 않았어요. 상견례에서 나온 내용을 다시 한 문장으로 알려주면 함께 정리할게요.",
    );
    expect(result.draft).toBeNull();
    expect(result.hadMarker).toBe(true);
    expect(result.cleanText).not.toContain("amora_schedule_care_action_draft");
  });

  it("strips a malformed internal tag fragment instead of exposing it", () => {
    const result = extractAmoraScheduleCareActionDraft(
      "[amora_schedule_care_action_draft malformed",
    );

    expect(result.cleanText).toBe(
      "지금 내용은 확정하거나 저장하지 않았어요. 상견례에서 나온 내용을 다시 한 문장으로 알려주면 함께 정리할게요.",
    );
    expect(result.draft).toBeNull();
    expect(result.hadMarker).toBe(true);
    expect(result.cleanText).not.toContain("amora_schedule_care_action_draft");
  });

  it.each([
    {
      label: "unsupported payment claim",
      title: "계약금 500만원 결제 완료로 저장하기",
      reason: "부모님이 이미 송금했다고 확정했어요.",
      completionCriterion: "결제 완료로 기록하면 끝나요.",
    },
    {
      label: "unsupported agreement claim",
      title: "예단 금액 합의 확정하기",
      reason: "양가가 모두 동의한 것으로 결정됐어요.",
      completionCriterion: "합의된 사실로 저장하면 끝나요.",
    },
    {
      label: "unsupported deadline claim",
      title: "8월 20일까지 예단을 보내기",
      reason: "상견례에서 마감일이 확정됐어요.",
      completionCriterion: "2026-08-20까지 보내면 끝나요.",
    },
  ])("replaces an $label with one verification action and safe visible text", ({
    title,
    reason,
    completionCriterion,
  }) => {
    const result = extractAmoraScheduleCareActionDraft(
      `모두 확정됐고 저장했어요.\n${marker({
        version: 1,
        title,
        reason,
        completionCriterion,
      })}`,
    );

    expect(result.replacedUnsafeClaim).toBe(true);
    expect(result.cleanText).toBe(
      "말씀해 주신 내용을 확정된 합의나 결제 사실로 단정하지 않고, 둘이 확인할 다음 단계로만 정리했어요. 아직 저장하거나 공유하지 않았어요.",
    );
    expect(result.draft).toEqual({
      version: 1,
      title: "상견례에서 나온 내용을 둘이 확인하기",
      reason:
        "금액·기한·합의 여부는 확인된 기록 없이 확정하지 않고, 두 사람이 같은 이해인지 먼저 확인해요.",
      completionCriterion:
        "합의된 내용과 아직 논의 중인 내용을 나눠 적고 서로 확인하면 끝나요.",
    });
    expect(JSON.stringify(result.draft)).not.toContain(title);
    expect(JSON.stringify(result.draft)).not.toContain(reason);
    expect(JSON.stringify(result.draft)).not.toContain(completionCriterion);
  });

  it("replaces an unsupported hard claim even when the provider omits the draft marker", () => {
    const result = extractAmoraScheduleCareActionDraft(
      "양가 모두 예단 500만원 부담에 합의했어요.",
    );

    expect(result).toEqual({
      cleanText:
        "말씀해 주신 내용을 확정된 합의나 결제 사실로 단정하지 않고, 둘이 확인할 다음 단계로만 정리했어요. 아직 저장하거나 공유하지 않았어요.",
      draft: {
        version: 1,
        title: "상견례에서 나온 내용을 둘이 확인하기",
        reason:
          "금액·기한·합의 여부는 확인된 기록 없이 확정하지 않고, 두 사람이 같은 이해인지 먼저 확인해요.",
        completionCriterion:
          "합의된 내용과 아직 논의 중인 내용을 나눠 적고 서로 확인하면 끝나요.",
      },
      hadMarker: false,
      replacedUnsafeClaim: true,
    });
  });

  it.each([
    {
      label: "damaged",
      text:
        `양가 모두 예단 500만원 부담에 합의했어요.\n${AMORA_SCHEDULE_CARE_ACTION_DRAFT_OPEN_TAG}{"version":1`,
    },
    {
      label: "duplicated",
      text: [
        "양가 모두 예단 500만원 부담에 합의했어요.",
        marker({
          version: 1,
          title: "둘이 확인하기",
          reason: "같은 이해인지 확인해요.",
          completionCriterion: "서로 확인하면 끝나요.",
        }),
        marker({
          version: 1,
          title: "둘이 확인하기",
          reason: "같은 이해인지 확인해요.",
          completionCriterion: "서로 확인하면 끝나요.",
        }),
      ].join("\n"),
    },
  ])("replaces an unsupported hard claim when the draft marker is $label", ({
    text,
  }) => {
    const result = extractAmoraScheduleCareActionDraft(text);

    expect(result.cleanText).toContain("확정된 합의나 결제 사실로 단정하지 않고");
    expect(result.cleanText).not.toContain("500만원");
    expect(result.draft?.title).toBe("상견례에서 나온 내용을 둘이 확인하기");
    expect(result.hadMarker).toBe(true);
    expect(result.replacedUnsafeClaim).toBe(true);
  });

  it("preserves an ordinary non-claim answer when the provider omits the draft marker", () => {
    expect(extractAmoraScheduleCareActionDraft(
      "어제 나온 이야기를 합의된 내용과 아직 논의 중인 내용으로 나눠볼게요.",
    )).toEqual({
      cleanText:
        "어제 나온 이야기를 합의된 내용과 아직 논의 중인 내용으로 나눠볼게요.",
      draft: null,
      hadMarker: false,
      replacedUnsafeClaim: false,
    });
  });

  it("parses only the explicit ordinary shared composer bridge", () => {
    const text = [
      AMORA_SCHEDULE_CARE_SHARED_ACTION_INTRO,
      "",
      "다음 할 일: 상견례에서 나온 항목을 둘이 구분하기",
      "이유: 합의된 내용과 아직 논의 중인 내용을 같은 기준으로 확인해요.",
      "완료 기준: 두 목록을 나누고 서로 확인하면 끝나요.",
      "",
      AMORA_SCHEDULE_CARE_SHARED_ACTION_CONFIRMATION,
    ].join("\n");

    expect(parseAmoraScheduleCareSharedActionDraft(text)).toEqual({
      status: "valid",
      value: {
        title: "상견례에서 나온 항목을 둘이 구분하기",
        description:
          "이유: 합의된 내용과 아직 논의 중인 내용을 같은 기준으로 확인해요. 완료 기준: 두 목록을 나누고 서로 확인하면 끝나요.",
        category_key: "general",
        priority: "medium",
        source: "chat",
      },
    });
    expect(JSON.stringify(parseAmoraScheduleCareSharedActionDraft(text))).not.toMatch(
      /card_id|source_revision|sourceEventId|private/u,
    );
  });

  it("fails a lookalike shared bridge closed and leaves ordinary text absent", () => {
    const lookalike = [
      AMORA_SCHEDULE_CARE_SHARED_ACTION_INTRO,
      "",
      "다음 할 일: 부모님께 연락하기",
      "이유: 같이 확인해요.",
      "완료 기준: 서로 확인하면 끝나요.",
      "private_card_id: 20000000-0000-4000-8000-000000000001",
      AMORA_SCHEDULE_CARE_SHARED_ACTION_CONFIRMATION,
    ].join("\n");

    expect(parseAmoraScheduleCareSharedActionDraft(lookalike)).toEqual({
      status: "invalid",
    });
    expect(parseAmoraScheduleCareSharedActionDraft("상견례는 어땠어?")).toEqual({
      status: "absent",
    });
  });
});
