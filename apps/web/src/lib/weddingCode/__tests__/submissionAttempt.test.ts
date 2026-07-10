import { describe, expect, it, vi } from "vitest";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import {
  clearSubmissionId,
  getOrCreateSubmissionId,
  parseWeddingCodeSubmissionResult,
  type SubmissionAttemptIdentity,
  WC_PENDING_SUBMISSION_ID_PREFIX,
} from "../submissionAttempt";

const INVITE_A = "223e4567-e89b-42d3-a456-426614174000";
const INVITE_B = "523e4567-e89b-42d3-a456-426614174000";

function emptyRef(): { current: SubmissionAttemptIdentity | null } {
  return { current: null };
}

function validCanonicalResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    id: "323e4567-e89b-42d3-a456-426614174000",
    paired: false,
    recovered: false,
    pairingStatus: "waiting",
    coupleToken: INVITE_A,
    formVersion: WEDDING_CODE_V05_VERSION,
    scoringVersion: WEDDING_CODE_V05_SCORING_VERSION,
    participantStage: "venue_search",
    quoteStatus: "none",
    answers: Object.fromEntries(
      WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "A"])
    ),
    ...overrides,
  };
}

describe("WeddingCode submission attempt identity", () => {
  it("keeps the same id after an ambiguous response loss", () => {
    const ref = emptyRef();
    const storage = window.sessionStorage;
    storage.clear();
    const createId = vi
      .fn()
      .mockReturnValueOnce("323e4567-e89b-42d3-a456-426614174000")
      .mockReturnValueOnce("423e4567-e89b-42d3-a456-426614174000");

    const firstAttempt = getOrCreateSubmissionId(ref, INVITE_A, createId, storage);
    const retry = getOrCreateSubmissionId(ref, INVITE_A, createId, storage);

    expect(retry).toBe(firstAttempt);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("recovers the pending id after a form remount or reload", () => {
    const storage = window.sessionStorage;
    storage.clear();
    const createId = vi
      .fn()
      .mockReturnValueOnce("323e4567-e89b-42d3-a456-426614174000")
      .mockReturnValueOnce("423e4567-e89b-42d3-a456-426614174000");

    const firstAttempt = getOrCreateSubmissionId(emptyRef(), INVITE_A, createId, storage);
    const afterRemount = getOrCreateSubmissionId(emptyRef(), INVITE_A, createId, storage);

    expect(afterRemount).toBe(firstAttempt);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(storage.getItem(`${WC_PENDING_SUBMISSION_ID_PREFIX}${INVITE_A}`)).toBe(firstAttempt);
  });

  it("clears the pending id only after a confirmed success", () => {
    const storage = window.sessionStorage;
    const storageKey = `${WC_PENDING_SUBMISSION_ID_PREFIX}${INVITE_A}`;
    storage.setItem(
      storageKey,
      "323e4567-e89b-42d3-a456-426614174000"
    );
    const ref: { current: SubmissionAttemptIdentity | null } = {
      current: {
        id: "323e4567-e89b-42d3-a456-426614174000",
        context: INVITE_A,
      },
    };

    clearSubmissionId(ref, storage);

    expect(ref.current).toBeNull();
    expect(storage.getItem(storageKey)).toBeNull();
  });

  it("does not reuse a pending id for a different invite context", () => {
    const storage = window.sessionStorage;
    storage.clear();
    const createId = vi
      .fn()
      .mockReturnValueOnce("323e4567-e89b-42d3-a456-426614174000")
      .mockReturnValueOnce("423e4567-e89b-42d3-a456-426614174000");
    const ref = emptyRef();

    const firstInvite = getOrCreateSubmissionId(ref, INVITE_A, createId, storage);
    const secondInvite = getOrCreateSubmissionId(ref, INVITE_B, createId, storage);

    expect(secondInvite).not.toBe(firstInvite);
    expect(storage.getItem(`${WC_PENDING_SUBMISSION_ID_PREFIX}${INVITE_A}`)).toBe(firstInvite);
    expect(storage.getItem(`${WC_PENDING_SUBMISSION_ID_PREFIX}${INVITE_B}`)).toBe(secondInvite);
  });

  it("canonicalizes UUID case so the same invite cannot consume a second slot", () => {
    const storage = window.sessionStorage;
    storage.clear();
    const createId = vi
      .fn()
      .mockReturnValueOnce("323e4567-e89b-42d3-a456-426614174000")
      .mockReturnValueOnce("423e4567-e89b-42d3-a456-426614174000");

    const uppercaseAttempt = getOrCreateSubmissionId(
      emptyRef(),
      INVITE_A.toUpperCase(),
      createId,
      storage
    );
    const lowercaseRetry = getOrCreateSubmissionId(
      emptyRef(),
      INVITE_A,
      createId,
      storage
    );

    expect(lowercaseRetry).toBe(uppercaseAttempt);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("accepts a complete canonical DB snapshot", () => {
    expect(parseWeddingCodeSubmissionResult(validCanonicalResult())).toMatchObject({
      id: "323e4567-e89b-42d3-a456-426614174000",
      pairingStatus: "waiting",
      coupleToken: INVITE_A,
    });
  });

  it("rejects malformed 2xx success payloads without clearing retry identity", () => {
    expect(parseWeddingCodeSubmissionResult({ success: true })).toBeNull();
    expect(
      parseWeddingCodeSubmissionResult(
        validCanonicalResult({ pairingStatus: "paired", paired: false })
      )
    ).toBeNull();
    expect(
      parseWeddingCodeSubmissionResult(validCanonicalResult({ coupleToken: null }))
    ).toBeNull();
    expect(
      parseWeddingCodeSubmissionResult(validCanonicalResult({ answers: { A1: "A" } }))
    ).toBeNull();
  });
});
