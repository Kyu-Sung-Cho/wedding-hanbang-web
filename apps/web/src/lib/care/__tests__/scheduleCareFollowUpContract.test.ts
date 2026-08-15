import { describe, expect, it } from "vitest";

import {
  AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY,
  buildAmoraScheduleCareFollowUpPrivateMetadata,
  extractAmoraScheduleCareFollowUpAnswer,
  parseAmoraScheduleCareFollowUpPrivateMetadata,
  validateAmoraScheduleCareActionDraft,
  validateAmoraScheduleCareFollowUpBinding,
  validateAmoraScheduleCareFollowUpPreview,
} from "@hanbang/shared/amora-schedule-care-follow-up";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const CARD_ID = "20000000-0000-4000-8000-000000000001";
const NOW_MS = Date.parse("2026-08-15T01:00:00.000Z");

describe("Amora schedule-care D+1 follow-up contract", () => {
  it("accepts one exact owner-and-couple-bound unexpired private preview", () => {
    const result = validateAmoraScheduleCareFollowUpPreview({
      version: 1,
      state: "ready",
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      binding: {
        cardId: CARD_ID,
        cardRevision: 2,
        sourceRevision: 7,
      },
      expiresAt: "2026-08-15T15:00:00.000Z",
      prompt: "어제 상견례를 나만 아모라와 정리할게요.\n\n먼저 실제로 합의된 내용을 알려주세요.\n\n내 답:",
    }, {
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      nowMs: NOW_MS,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        binding: {
          cardId: CARD_ID,
          cardRevision: 2,
          sourceRevision: 7,
        },
      },
    });
  });

  it.each([
    ["foreign owner", { recipientUserId: "00000000-0000-4000-8000-000000000099" }],
    ["foreign couple", { coupleId: "10000000-0000-4000-8000-000000000099" }],
    ["expired", { expiresAt: "2026-08-15T00:59:59.999Z" }],
    ["non-canonical timestamp", { expiresAt: "2026-08-15T15:00:00Z" }],
    ["single-line prompt", { prompt: "한 줄뿐인 프롬프트" }],
    ["extra preview key", { extra: "forged" }],
  ])("rejects a %s preview", (_label, override) => {
    const result = validateAmoraScheduleCareFollowUpPreview({
      version: 1,
      state: "ready",
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      binding: { cardId: CARD_ID, cardRevision: 2, sourceRevision: 7 },
      expiresAt: "2026-08-15T15:00:00.000Z",
      prompt: "상견례를 비공개로 정리해요.\n\n확인 전에는 저장하지 않아요.\n\n내 답:",
      ...override,
    }, { recipientUserId: USER_ID, coupleId: COUPLE_ID, nowMs: NOW_MS });

    expect(result.ok).toBe(false);
  });

  it("rejects legacy, extra, and unsafe action drafts at the shared boundary", () => {
    expect(validateAmoraScheduleCareActionDraft({
      version: 1,
      title: "상견례에서 확인할 한 가지",
      reason: "실제로 합의된 내용만 다시 확인해요.",
      completionCriterion: "둘이 같은 내용을 확인하면 끝나요.",
    }).ok).toBe(true);
    for (const value of [
      {
        version: 1,
        title: " 앞뒤 공백",
        reason: "이유",
        completionCriterion: "완료",
      },
      {
        version: 1,
        title: "제목",
        reason: "줄바꿈\n주입",
        completionCriterion: "완료",
      },
      {
        version: 1,
        title: "제목",
        reason: "가".repeat(221),
        completionCriterion: "완료",
      },
      {
        version: 1,
        title: "제목",
        reason: "이유",
        completionCriterion: "나".repeat(221),
      },
      {
        version: 1,
        title: "제목",
        reason: "이유",
        completionCriterion: "완료",
        eventTitle: "상견례",
      },
    ]) {
      expect(validateAmoraScheduleCareActionDraft(value).ok).toBe(false);
    }
    expect(AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY).toBe(
      "amora_schedule_care_action_draft_v1",
    );
  });

  it("round-trips only the opaque binding metadata and rejects extra or legacy fields", () => {
    const binding = { cardId: CARD_ID, cardRevision: 2, sourceRevision: 0 };
    expect(validateAmoraScheduleCareFollowUpBinding(binding).ok).toBe(true);
    const metadata = buildAmoraScheduleCareFollowUpPrivateMetadata(binding);
    expect(metadata).toEqual({
      version: 1,
      card_id: CARD_ID,
      card_revision: 2,
      source_revision: 0,
    });
    expect(parseAmoraScheduleCareFollowUpPrivateMetadata(metadata)).toEqual(metadata);
    expect(parseAmoraScheduleCareFollowUpPrivateMetadata({
      ...metadata,
      event_title: "상견례",
    })).toBeNull();
    expect(validateAmoraScheduleCareFollowUpBinding({
      ...binding,
      sourceKey: "schedule:forged",
    }).ok).toBe(false);
  });

  it("extracts only a nonempty bounded answer after the byte-exact canonical prefix", () => {
    const prompt = "상견례를 비공개로 정리해요.\n\n확인 전에는 저장하지 않아요.\n\n내 답:";
    expect(extractAmoraScheduleCareFollowUpAnswer(
      `${prompt} 실제로 합의한 것은 예식 시기를 다시 확인하는 거예요.`,
      prompt,
    )).toBe("실제로 합의한 것은 예식 시기를 다시 확인하는 거예요.");
    for (const content of [
      prompt,
      `${prompt} `,
      `앞에 추가${prompt} 답`,
      `${prompt.replace("비공개", "공개")} 답`,
      `${prompt} ${"가".repeat(4_001)}`,
      `${prompt} 제어\u0000문자`,
    ]) {
      expect(extractAmoraScheduleCareFollowUpAnswer(content, prompt)).toBeNull();
    }
  });
});
