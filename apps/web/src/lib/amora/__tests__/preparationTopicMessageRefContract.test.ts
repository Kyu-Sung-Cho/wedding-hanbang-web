import {
  type AmoraPreparationActionReceiptV2PageResponse,
  AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT,
  AMORA_PREPARATION_NOTES_PAGE_LIMIT,
  AMORA_PREPARATION_SCHEDULE_DECISION_PAGE_LIMIT,
  parseAmoraPreparationTopicMessageRefMutationRequest,
  validateAmoraPreparationActionReceiptPageResponse,
  validateAmoraPreparationActionReceiptV2PageResponse,
  validateAmoraPreparationNotesPageResponse,
  validateAmoraPreparationScheduleDecisionPageResponse,
  validateAmoraPreparationTopicMessageRefCollectionResponse,
  validateAmoraPreparationTopicMessageRefMutationResponse,
  validateAmoraPreparationTopicMessageRefResolveResponse,
  validateAmoraPreparationTopicMessageRefStateResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
import { describe, expect, it } from "vitest";

const RECIPIENT = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";
const REF = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const NOTES_CURSOR = "np1.eyJzbmFwc2hvdEF0IjoiMjAyNi0wOC0xOFQwODowMDowMC4wMDBaIn0";
const RECEIPT_CURSOR = "ap1.eyJzbmFwc2hvdEF0IjoiMjAyNi0wOC0xOFQwODowMDowMC4wMDBaIn0";
const RECEIPT_V2_CURSOR = "ap2.eyJ2IjoyLCJzbmFwc2hvdEF0IjoiMjAyNi0wOC0xOFQwODowMDowMC4wMDBaIn0";
const DECISION_CURSOR = "sd1.eyJzbmFwc2hvdEF0IjoiMjAyNi0wOC0xOFQwODowMDowMC4wMDBaIn0";

describe("Amora preparation-topic message-reference contract", () => {
  it("accepts only an exact recipient-bound bounded collection", () => {
    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      references: [{
        refId: REF,
        topicKey: "venue",
        messageId: MESSAGE,
        audience: "couple_shared",
        revision: 1,
        savedAt: "2026-08-16T01:02:03.000Z",
        sourceCreatedAt: "2026-08-15T01:02:03.000Z",
        excerpt: "예식장 후보를 비교할 때 먼저 확인할 기준이에요.",
        canRemove: true,
        canOpenOriginal: true,
      }],
      partial: false,
    };

    expect(validateAmoraPreparationTopicMessageRefCollectionResponse(
      payload,
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: true, value: payload });

    expect(validateAmoraPreparationTopicMessageRefCollectionResponse(
      { ...payload, recipientUserId: "55555555-5555-4555-8555-555555555555" },
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: false, reason: "recipient" });

    expect(validateAmoraPreparationTopicMessageRefCollectionResponse(
      { ...payload, sourceDigest: "must-not-escape" },
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: false, reason: "collection" });
  });

  it("accepts a privacy-bound notes page with question and answer excerpts plus one opaque cursor", () => {
    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      snapshotAt: "2026-08-18T08:00:00.000Z",
      entries: [{
        refId: REF,
        topicKey: "venue",
        messageId: MESSAGE,
        audience: "owner_private",
        revision: 2,
        savedAt: "2026-08-18T07:00:00.000Z",
        sourceCreatedAt: "2026-08-18T06:00:00.000Z",
        questionExcerpt: "예식장 계약 전에 무엇을 확인해야 할까?",
        answerExcerpt: "대관 범위와 취소 조건을 서면에서 먼저 확인해요.",
        canRemove: true,
        canOpenOriginal: true,
      }],
      nextCursor: NOTES_CURSOR,
      partial: false,
    };

    expect(AMORA_PREPARATION_NOTES_PAGE_LIMIT).toBe(24);
    expect(validateAmoraPreparationNotesPageResponse(
      payload,
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: true, value: payload });

    for (const invalid of [
      { ...payload, recipientUserId: "55555555-5555-4555-8555-555555555555" },
      { ...payload, nextCursor: "2026-08-18T07:00:00.000Z" },
      { ...payload, sourceDigest: "must-not-escape" },
      {
        ...payload,
        entries: [{ ...payload.entries[0], questionExcerpt: "hidden\u200Dquestion" }],
      },
      {
        ...payload,
        entries: Array.from(
          { length: AMORA_PREPARATION_NOTES_PAGE_LIMIT + 1 },
          (_, index) => ({
            ...payload.entries[0],
            refId: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
          }),
        ),
      },
    ]) {
      expect(validateAmoraPreparationNotesPageResponse(
        invalid,
        RECIPIENT,
        COUPLE,
      ).ok).toBe(false);
    }
  });

  it("accepts only a minimal couple-shared canonical action-receipt page", () => {
    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      snapshotAt: "2026-08-18T08:00:00.000Z",
      entries: [{
        receiptMessageId: MESSAGE,
        actionId: "act_1234567890abcdef_1234567890abcdef12345678",
        topicKey: "venue",
        title: "예식장 계약 조건 다시 확인",
        displayMessage: '"예식장 계약 조건 다시 확인"을 아모라 행동 카드로 저장했어요.',
        appliedAt: "2026-08-18T07:00:00.000Z",
        scope: "couple_shared",
        canOpenAction: true,
      }],
      nextCursor: RECEIPT_CURSOR,
      partial: false,
    };

    expect(AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT).toBe(24);
    expect(validateAmoraPreparationActionReceiptPageResponse(
      payload,
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: true, value: payload });

    for (const invalid of [
      { ...payload, recipientUserId: "55555555-5555-4555-8555-555555555555" },
      { ...payload, nextCursor: "2026-08-18T07:00:00.000Z" },
      { ...payload, sourceMessageId: REF },
      { ...payload, entries: [{ ...payload.entries[0], scope: "owner_private" }] },
      { ...payload, entries: [{ ...payload.entries[0], actionId: "unsafe/action" }] },
      { ...payload, entries: [{ ...payload.entries[0], title: "hidden\u200Dtitle" }] },
    ]) {
      expect(validateAmoraPreparationActionReceiptPageResponse(
        invalid,
        RECIPIENT,
        COUPLE,
      ).ok).toBe(false);
    }
  });

  it("accepts an exact v2 approved first action while keeping v1 and provenance fields closed", () => {
    const entry: AmoraPreparationActionReceiptV2PageResponse["entries"][number] = {
      receiptMessageId: MESSAGE,
      actionId: "act_1234567890abcdef_1234567890abcdef12345678",
      topicKey: "venue",
      title: "예식장 후보 비교 기준 정리",
      displayMessage: '"예식장 후보 비교 기준 정리"를 아모라 행동 카드로 저장했어요.',
      appliedAt: "2026-08-18T07:00:00.000Z",
      scope: "couple_shared",
      canOpenAction: true,
      approvedFirstAction: {
        action: "예식장 후보 비교 기준 정리",
        reason: "장소를 보기 전에 두 사람의 공통 기준이 필요해요.",
        completionCriterion: "각자 꼭 지킬 기준을 하나씩 적으면 끝나요.",
      },
    };
    const payload = {
      version: 2,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      snapshotAt: "2026-08-18T08:00:00.000Z",
      entries: [entry],
      nextCursor: RECEIPT_V2_CURSOR,
      partial: false,
    } satisfies AmoraPreparationActionReceiptV2PageResponse;

    expect(validateAmoraPreparationActionReceiptV2PageResponse(
      payload,
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: true, value: payload });
    expect(validateAmoraPreparationActionReceiptV2PageResponse(
      {
        ...payload,
        entries: [{ ...entry, approvedFirstAction: null }],
        nextCursor: null,
      },
      RECIPIENT,
      COUPLE,
    ).ok).toBe(true);

    const legacyWithV2Field = {
      ...payload,
      version: 1,
      nextCursor: RECEIPT_CURSOR,
    };
    expect(validateAmoraPreparationActionReceiptPageResponse(
      legacyWithV2Field,
      RECIPIENT,
      COUPLE,
    ).ok).toBe(false);
    for (const invalid of [
      { ...payload, nextCursor: RECEIPT_CURSOR },
      { ...payload, sourceMessageId: REF },
      { ...payload, entries: [{ ...entry, sourceMessageId: REF }] },
      {
        ...payload,
        entries: [{
          ...entry,
          approvedFirstAction: {
            ...entry.approvedFirstAction,
            promotionId: REF,
          },
        }],
      },
      {
        ...payload,
        entries: [{
          ...entry,
          approvedFirstAction: {
            ...entry.approvedFirstAction,
            action: "다른 행동",
          },
        }],
      },
    ]) {
      expect(validateAmoraPreparationActionReceiptV2PageResponse(
        invalid,
        RECIPIENT,
        COUPLE,
      ).ok).toBe(false);
    }
  });

  it("accepts only a current-journey-bound canonical schedule-decision page", () => {
    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      snapshotAt: "2026-08-18T08:00:00.000Z",
      currentJourneyRevision: 8,
      entries: [{
        decisionId: MESSAGE,
        eventId: "meeting-event",
        topicKey: "meeting",
        title: "일정 추가 · 양가 부모님 첫 만남",
        date: "2026-09-05",
        confirmedAt: "2026-08-18T07:00:00.000Z",
        scope: "couple_shared",
        canOpenSchedule: true,
      }],
      nextCursor: DECISION_CURSOR,
      partial: false,
    };

    expect(AMORA_PREPARATION_SCHEDULE_DECISION_PAGE_LIMIT).toBe(24);
    expect(validateAmoraPreparationScheduleDecisionPageResponse(
      payload,
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: true, value: payload });

    for (const invalid of [
      { ...payload, currentJourneyRevision: -1 },
      { ...payload, nextCursor: "2026-08-18T07:00:00.000Z" },
      { ...payload, sourceRefId: REF },
      { ...payload, entries: [{ ...payload.entries[0], scope: "owner_private" }] },
      { ...payload, entries: [{ ...payload.entries[0], eventId: "unsafe/event" }] },
      { ...payload, entries: [{ ...payload.entries[0], date: "2026-02-30" }] },
      { ...payload, entries: [{ ...payload.entries[0], title: "hidden\u200Dtitle" }] },
    ]) {
      expect(validateAmoraPreparationScheduleDecisionPageResponse(
        invalid,
        RECIPIENT,
        COUPLE,
      ).ok).toBe(false);
    }
  });

  it("accepts only an exact explicit mutation and exact source state", () => {
    const request = {
      topicKey: "venue",
      messageId: MESSAGE,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: "66666666-6666-4666-8666-666666666666",
    };
    expect(parseAmoraPreparationTopicMessageRefMutationRequest(request)).toEqual(request);
    expect(parseAmoraPreparationTopicMessageRefMutationRequest({
      ...request,
      content: "원문을 요청 본문으로 보내면 안 돼요.",
    })).toBeNull();
    expect(parseAmoraPreparationTopicMessageRefMutationRequest({
      ...request,
      topicKey: "ai-guessed-topic",
    })).toBeNull();

    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      reference: {
        topicKey: request.topicKey,
        messageId: request.messageId,
        refId: null,
        audience: "owner_private",
        savedState: "removed",
        revision: 0,
      },
    };
    expect(validateAmoraPreparationTopicMessageRefStateResponse(
      payload,
      RECIPIENT,
      COUPLE,
      request.topicKey,
      request.messageId,
    )).toEqual({ ok: true, value: payload });
    expect(validateAmoraPreparationTopicMessageRefStateResponse(
      { ...payload, reference: { ...payload.reference, messageId: REF } },
      RECIPIENT,
      COUPLE,
      request.topicKey,
      request.messageId,
    )).toEqual({ ok: false, reason: "reference" });
  });

  it("accepts an exact idempotent mutation receipt without private provenance", () => {
    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      reference: {
        topicKey: "venue",
        messageId: MESSAGE,
        refId: REF,
        audience: "couple_shared",
        savedState: "saved",
        revision: 1,
      },
      reused: true,
    };
    expect(validateAmoraPreparationTopicMessageRefMutationResponse(
      payload,
      RECIPIENT,
      COUPLE,
      "venue",
      MESSAGE,
      "saved",
    )).toEqual({ ok: true, value: payload });
    expect(validateAmoraPreparationTopicMessageRefMutationResponse(
      { ...payload, sourceDigest: "must-not-escape" },
      RECIPIENT,
      COUPLE,
      "venue",
      MESSAGE,
      "saved",
    )).toEqual({ ok: false, reason: "reference" });
    expect(validateAmoraPreparationTopicMessageRefMutationResponse(
      payload,
      RECIPIENT,
      COUPLE,
      "venue",
      MESSAGE,
      "removed",
    )).toEqual({ ok: false, reason: "reference" });
  });

  it("rejects impossible saved revisions, chronology, and format controls", () => {
    const collection = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      references: [{
        refId: REF,
        topicKey: "venue",
        messageId: MESSAGE,
        audience: "couple_shared",
        revision: 1,
        savedAt: "2026-08-16T01:02:03.000Z",
        sourceCreatedAt: "2026-08-15T01:02:03.000Z",
        excerpt: "Compare the venue candidates before deciding.",
        canRemove: true,
        canOpenOriginal: true,
      }],
      partial: false,
    };
    const invalidCollections = [
      {
        ...collection,
        references: [{ ...collection.references[0], revision: 0 }],
      },
      {
        ...collection,
        references: [{
          ...collection.references[0],
          sourceCreatedAt: "2026-08-17T01:02:03.000Z",
        }],
      },
      {
        ...collection,
        references: [{
          ...collection.references[0],
          excerpt: "Hidden\u200Dformat control",
        }],
      },
    ];
    for (const payload of invalidCollections) {
      expect(validateAmoraPreparationTopicMessageRefCollectionResponse(
        payload,
        RECIPIENT,
        COUPLE,
      )).toEqual({ ok: false, reason: "collection" });
    }

    const savedRevisionZero = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      reference: {
        topicKey: "venue",
        messageId: MESSAGE,
        refId: REF,
        audience: "owner_private",
        savedState: "saved",
        revision: 0,
      },
    };
    expect(validateAmoraPreparationTopicMessageRefStateResponse(
      savedRevisionZero,
      RECIPIENT,
      COUPLE,
      "venue",
      MESSAGE,
    )).toEqual({ ok: false, reason: "reference" });
  });

  it("accepts only an exact ref-bound original target and paired question", () => {
    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      reference: {
        refId: REF,
        topicKey: "venue",
        messageId: MESSAGE,
        audience: "owner_private",
        revision: 2,
        savedAt: "2026-08-16T01:02:03.000Z",
      },
      target: {
        messageId: MESSAGE,
        lane: "private",
        content: "Compare the two venue contracts clause by clause.",
        createdAt: "2026-08-15T01:02:04.000Z",
      },
      question: {
        messageId: "77777777-7777-4777-8777-777777777777",
        lane: "private",
        senderType: "bride",
        content: "What should I compare before choosing a venue?",
        createdAt: "2026-08-15T01:02:03.000Z",
      },
    };
    expect(validateAmoraPreparationTopicMessageRefResolveResponse(
      payload,
      RECIPIENT,
      COUPLE,
      REF,
    )).toEqual({ ok: true, value: payload });
    expect(validateAmoraPreparationTopicMessageRefResolveResponse(
      { ...payload, reference: { ...payload.reference, refId: MESSAGE } },
      RECIPIENT,
      COUPLE,
      REF,
    )).toEqual({ ok: false, reason: "reference" });
    expect(validateAmoraPreparationTopicMessageRefResolveResponse(
      { ...payload, sourceDigest: "must-not-escape" },
      RECIPIENT,
      COUPLE,
      REF,
    )).toEqual({ ok: false, reason: "reference" });
  });

  it("rejects calendar-invalid timestamps instead of allowing date normalization", () => {
    const payload = {
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      references: [{
        refId: REF,
        topicKey: "venue",
        messageId: MESSAGE,
        audience: "couple_shared",
        revision: 1,
        savedAt: "2026-02-30T01:02:03.000Z",
        sourceCreatedAt: "2026-02-28T01:02:03.000Z",
        excerpt: "Compare the venue candidates before deciding.",
        canRemove: true,
        canOpenOriginal: true,
      }],
      partial: false,
    };

    expect(validateAmoraPreparationTopicMessageRefCollectionResponse(
      payload,
      RECIPIENT,
      COUPLE,
    )).toEqual({ ok: false, reason: "collection" });
  });
});
