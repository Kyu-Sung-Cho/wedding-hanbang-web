import {
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05OptionValue,
  type WeddingCodeV05QuestionKey,
} from "@/constants/weddingCodeV05";
import type { WeddingCodeV05Answers } from "./score";

const OPTION_VALUES = new Set<string>(["A", "B", "C", "D"]);
const QUESTION_KEYS = new Set<string>(WEDDING_CODE_V05_QUESTIONS.map((question) => question.key));

export function toWeddingCodeV05Answers(raw: unknown): WeddingCodeV05Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const answers: WeddingCodeV05Answers = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!QUESTION_KEYS.has(key) || typeof value !== "string" || !OPTION_VALUES.has(value)) continue;
    answers[key as WeddingCodeV05QuestionKey] = value as WeddingCodeV05OptionValue;
  }
  return answers;
}

