import { allQuestions, type Question } from "@/app/customersurvey/data/questions";
import { isRecord } from "@/utils/requestValidation";

const MAX_MONTHLY_PRICE_WON = 10_000_000;
const RETIRED_FREE_TEXT_ANSWER_IDS = new Set(["q21"]);

type NormalizedSurvey = {
  answers: Record<string, unknown>;
};

export type SurveySubmissionValidation =
  | { ok: true; data: NormalizedSurvey }
  | { ok: false; reason: "invalid" | "free_text_disabled" };

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

function hasNonEmptyFreeText(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : !isMissing(value);
}

function normalizeAnswer(
  question: Question,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false } {
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
    case "text_input":
      // Anonymous free text is retired until a reviewed DLP and automatic
      // retention/deletion contract exists. New question definitions cannot
      // silently reopen this storage lane.
      return { ok: false };
  }
}

export function validateSurveySubmission(
  rawAnswers: unknown,
  rawOtherTexts: unknown,
): SurveySubmissionValidation {
  if (!isRecord(rawAnswers) || !isRecord(rawOtherTexts)) {
    return { ok: false, reason: "invalid" };
  }

  if (
    [...RETIRED_FREE_TEXT_ANSWER_IDS].some((id) =>
      hasNonEmptyFreeText(rawAnswers[id]))
    || Object.values(rawOtherTexts).some(hasNonEmptyFreeText)
  ) {
    return { ok: false, reason: "free_text_disabled" };
  }

  const answers: Record<string, unknown> = Object.create(null);

  for (const question of allQuestions) {
    if (!isVisible(question, answers)) continue;
    const raw = rawAnswers[question.id];
    if (isMissing(raw)) {
      if (question.required) return { ok: false, reason: "invalid" };
      continue;
    }

    const normalized = normalizeAnswer(question, raw);
    if (!normalized.ok) {
      return { ok: false, reason: "invalid" };
    }
    answers[question.id] = normalized.value;
  }

  return { ok: true, data: { answers } };
}
