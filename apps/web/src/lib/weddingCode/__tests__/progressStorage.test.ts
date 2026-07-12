import { afterEach, describe, expect, it } from "vitest";
import { WEDDING_CODE_V05_QUESTIONS } from "@/constants/weddingCodeV05";
import {
  clearWeddingCodeProgress,
  decodeWeddingCodeProgress,
  findFirstIncompleteWeddingCodeQuestionIndex,
  readWeddingCodeProgress,
  writeWeddingCodeProgress,
} from "@/lib/weddingCode/progressStorage";

const KEY = "wedding-code:test:progress";
const originalLocalStorage = window.localStorage;
const originalSessionStorage = window.sessionStorage;

function throwingStorage(): Storage {
  return {
    get length(): number { throw new DOMException("blocked", "SecurityError"); },
    clear() { throw new DOMException("blocked", "SecurityError"); },
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    key() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
  };
}

function replaceStorages(local: Storage, session: Storage): void {
  Object.defineProperty(window, "localStorage", { configurable: true, value: local });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: session });
}

function inMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

afterEach(() => {
  replaceStorages(originalLocalStorage, originalSessionStorage);
  clearWeddingCodeProgress(KEY);
});

describe("WeddingCode progress storage", () => {
  it("falls through blocked browser storage without crashing", () => {
    replaceStorages(throwingStorage(), throwingStorage());
    expect(writeWeddingCodeProgress(KEY, "memory-progress")).toBe("memory");
    expect(readWeddingCodeProgress(KEY)).toBe("memory-progress");
    expect(() => clearWeddingCodeProgress(KEY)).not.toThrow();
    expect(readWeddingCodeProgress(KEY)).toBeNull();
  });

  it("uses session storage when persistent storage is unavailable", () => {
    const session = inMemoryStorage();
    replaceStorages(throwingStorage(), session);
    expect(writeWeddingCodeProgress(KEY, "session-progress")).toBe("session");
    expect(readWeddingCodeProgress(KEY)).toBe("session-progress");
  });

  it("rejects malformed and expired progress", () => {
    expect(decodeWeddingCodeProgress("not-json", WEDDING_CODE_V05_QUESTIONS)).toBeNull();
    expect(decodeWeddingCodeProgress(JSON.stringify({
      answers: {}, qIndex: 0, step: "questions", expiresAt: 99,
    }), WEDDING_CODE_V05_QUESTIONS, 100)).toBeNull();
  });

  it("restores only valid answers and never resumes past the first unanswered question", () => {
    const first = WEDDING_CODE_V05_QUESTIONS[0];
    const decoded = decodeWeddingCodeProgress(JSON.stringify({
      answers: {
        [first.key]: first.options[0].value,
        unknown_question: "malicious",
      },
      qIndex: 999,
      step: "questions",
      expiresAt: 200,
    }), WEDDING_CODE_V05_QUESTIONS, 100);

    expect(decoded).toEqual({
      answers: { [first.key]: first.options[0].value },
      qIndex: 1,
      step: "questions",
      expiresAt: 200,
    });
  });

  it("clamps a complete response to the last question index", () => {
    const answers = Object.fromEntries(
      WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, question.options[0].value])
    );
    const decoded = decodeWeddingCodeProgress(JSON.stringify({
      answers,
      qIndex: 999,
      step: "questions",
      expiresAt: 200,
    }), WEDDING_CODE_V05_QUESTIONS, 100);

    expect(decoded?.qIndex).toBe(WEDDING_CODE_V05_QUESTIONS.length - 1);
  });

  it("finds an invalid or missing answer even when later answers exist", () => {
    const answers = Object.fromEntries(
      WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, question.options[0].value])
    );
    const missingIndex = 6;
    delete answers[WEDDING_CODE_V05_QUESTIONS[missingIndex].key];

    expect(findFirstIncompleteWeddingCodeQuestionIndex(
      answers,
      WEDDING_CODE_V05_QUESTIONS,
    )).toBe(missingIndex);
    expect(findFirstIncompleteWeddingCodeQuestionIndex(
      { ...answers, [WEDDING_CODE_V05_QUESTIONS[missingIndex].key]: "not-an-option" },
      WEDDING_CODE_V05_QUESTIONS,
    )).toBe(missingIndex);
  });

  it("does not restore the result step until every answer is valid", () => {
    const incomplete = decodeWeddingCodeProgress(JSON.stringify({
      answers: {}, qIndex: 0, step: "result", expiresAt: 200,
    }), WEDDING_CODE_V05_QUESTIONS, 100);
    expect(incomplete?.step).toBe("intro");

    const answers = Object.fromEntries(
      WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, question.options[0].value])
    );
    const complete = decodeWeddingCodeProgress(JSON.stringify({
      answers, qIndex: 15, step: "result", expiresAt: 200,
    }), WEDDING_CODE_V05_QUESTIONS, 100);
    expect(complete?.step).toBe("result");
  });
});
