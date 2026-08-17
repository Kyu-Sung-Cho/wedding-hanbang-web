import {
  parseAmoraPreparationTopicMessageRefMutationRequest,
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
