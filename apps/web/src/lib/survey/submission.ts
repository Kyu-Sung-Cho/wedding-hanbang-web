import { allQuestions, type Question } from "@/app/customersurvey/data/questions";
import { isRecord } from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";

const MAX_MONTHLY_PRICE_WON = 10_000_000;
const EMAIL_IN_TEXT = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const PHONE_IN_TEXT = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/u;
const URL_IN_TEXT = /(?:https?:\/\/|www\.)\S+/iu;

type NormalizedSurvey = {
  answers: Record<string, unknown>;
  otherTexts: Record<string, string>;
};

export type SurveySubmissionValidation =
  | { ok: true; data: NormalizedSurvey }
  | { ok: false; reason: "invalid" | "direct_identifier" };

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isVisible(question: Question, answers: Record<string, unknown>): boolean {
  const condition = question.conditionalDisplay;
  if (!condition) return true;
  const parent = answers[condition.questionId];
  if (condition.value !== undefined) return parent === condition.value;
  if (condition.valueNot !== undefined) {
    return parent !== undefined && parent !== condition.valueNot;
  }
  if (condition.valueIn !== undefined) {
    return condition.valueIn.includes(parent as number);
  }
  return true;
}

function allowedOption(question: Question, value: unknown): boolean {
  return question.options?.some(
    (option) => option.value === value && option.screenOut !== true,
  ) === true;
}

function cleanAnonymousText(
  value: unknown,
  maxLength: number,
): { ok: true; value: string } | { ok: false; directIdentifier: boolean } {
  if (typeof value !== "string" || value.length > maxLength) {
    return { ok: false, directIdentifier: false };
  }
  const cleaned = sanitizeText(value);
  if (
    EMAIL_IN_TEXT.test(cleaned)
    || PHONE_IN_TEXT.test(cleaned)
    || URL_IN_TEXT.test(cleaned)
  ) {
    return { ok: false, directIdentifier: true };
  }
  return { ok: true, value: cleaned };
}

function normalizeAnswer(
  question: Question,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; directIdentifier?: boolean } {
  switch (question.type) {
    case "single_choice":
      return allowedOption(question, raw)
        ? { ok: true, value: raw }
        : { ok: false };

    case "likert_5":
      return Number.isInteger(raw) && Number(raw) >= 1 && Number(raw) <= 5
        ? { ok: true, value: raw }
        : { ok: false };

    case "multiple_choice": {
      if (!Array.isArray(raw) || raw.length === 0) return { ok: false };
      const max = question.maxSelect ?? question.options?.length ?? 0;
      if (raw.length > max || new Set(raw).size !== raw.length) return { ok: false };
      return raw.every((value) => allowedOption(question, value))
        ? { ok: true, value: [...raw] }
        : { ok: false };
    }

    case "ranking": {
      const required = question.maxRank ?? 3;
      if (!Array.isArray(raw) || raw.length !== required || new Set(raw).size !== raw.length) {
        return { ok: false };
      }
      return raw.every((value) => allowedOption(question, value))
        ? { ok: true, value: [...raw] }
        : { ok: false };
    }

    case "nps": {
      const min = question.npsScale?.min ?? 0;
      const max = question.npsScale?.max ?? 10;
      return Number.isInteger(raw) && Number(raw) >= min && Number(raw) <= max
        ? { ok: true, value: raw }
        : { ok: false };
    }

    case "price_input": {
      if (!isRecord(raw) || !question.subQuestions) return { ok: false };
      const value: Record<string, number> = {};
      for (const subQuestion of question.subQuestions) {
        const amount = raw[subQuestion.id];
        if (
          !Number.isSafeInteger(amount)
          || Number(amount) < 0
          || Number(amount) > MAX_MONTHLY_PRICE_WON
        ) {
          return { ok: false };
        }
        value[subQuestion.id] = Number(amount);
      }
      if (value.q15_a !== undefined && value.q15_b !== undefined && value.q15_b < value.q15_a) {
        return { ok: false };
      }
      return { ok: true, value };
    }

    case "demographic": {
      if (!isRecord(raw) || !question.subQuestions) return { ok: false };
      const value: Record<string, string> = {};
      for (const subQuestion of question.subQuestions) {
        const selected = raw[subQuestion.id];
        if (typeof selected !== "string" || !subQuestion.options?.includes(selected)) {
          return { ok: false };
        }
        value[subQuestion.id] = selected;
      }
      return { ok: true, value };
    }

    case "text_area":
    case "text_input": {
      const cleaned = cleanAnonymousText(raw, question.maxLength ?? 500);
      return cleaned.ok
        ? { ok: true, value: cleaned.value }
        : { ok: false, directIdentifier: cleaned.directIdentifier };
    }
  }
}

function selectedOtherOption(question: Question, answer: unknown): boolean {
  const option = question.options?.find((candidate) => candidate.hasTextInput);
  if (!option) return false;
  return Array.isArray(answer)
    ? answer.includes(option.value)
    : answer === option.value;
}

export function validateSurveySubmission(
  rawAnswers: unknown,
  rawOtherTexts: unknown,
): SurveySubmissionValidation {
  if (!isRecord(rawAnswers) || !isRecord(rawOtherTexts)) {
    return { ok: false, reason: "invalid" };
  }

  const answers: Record<string, unknown> = Object.create(null);
  const otherTexts: Record<string, string> = Object.create(null);

  for (const question of allQuestions) {
    if (!isVisible(question, answers)) continue;
    const raw = rawAnswers[question.id];
    if (isMissing(raw)) {
      if (question.required) return { ok: false, reason: "invalid" };
      continue;
    }

    const normalized = normalizeAnswer(question, raw);
    if (!normalized.ok) {
      return {
        ok: false,
        reason: normalized.directIdentifier ? "direct_identifier" : "invalid",
      };
    }
    answers[question.id] = normalized.value;

    if (selectedOtherOption(question, normalized.value)) {
      const cleanedOther = cleanAnonymousText(rawOtherTexts[question.id], 1000);
      if (!cleanedOther.ok) {
        return {
          ok: false,
          reason: cleanedOther.directIdentifier ? "direct_identifier" : "invalid",
        };
      }
      if (!cleanedOther.value) return { ok: false, reason: "invalid" };
      otherTexts[question.id] = cleanedOther.value;
    }
  }

  return { ok: true, data: { answers, otherTexts } };
}
