import type { SpecialistType } from "@/types/moat.types";
import {
  AMORA_FINAL_TURN_GUARD,
  AMORA_MEDIATION_TURN_GUARD,
} from "@/lib/ai/amoraVoice";
import {
  getWeddingPlannerSystemPrompt,
  type WeddingPlannerPromptContext,
} from "@/lib/ai/prompts";
import { getSpecialistPromptAddon } from "@/lib/ai/stage-router";

type BuildAmoraSystemPromptOptions = {
  specialist?: SpecialistType;
  maxChars?: number;
  mode?: "chat" | "mediation";
};

const TRUNCATION_MARKER = "\n[저장 문맥 일부는 길이 제한으로 생략됨]\n";

function truncateAtLineBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const contentBudget = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  const lastNewline = value.lastIndexOf("\n", contentBudget);
  const boundary = lastNewline > 0 ? lastNewline : contentBudget;
  return `${value.slice(0, boundary)}${TRUNCATION_MARKER}`;
}

/**
 * Server-only prompt composition. When a route has a character ceiling, the
 * final trust/turn guard is reserved first so truncation cannot remove it.
 */
export function buildAmoraSystemPrompt(
  context: WeddingPlannerPromptContext,
  options: BuildAmoraSystemPromptOptions = {},
): string {
  const basePrompt = getWeddingPlannerSystemPrompt(context);
  const specialistPrompt = options.specialist
    ? getSpecialistPromptAddon(options.specialist)
    : "";
  const modeGuard = options.mode === "mediation" ? AMORA_MEDIATION_TURN_GUARD : "";
  const finalSuffix = `${modeGuard}${AMORA_FINAL_TURN_GUARD}`;
  const maxChars = options.maxChars;

  if (maxChars === undefined) {
    return `${basePrompt}${specialistPrompt}${finalSuffix}`;
  }
  if (!Number.isInteger(maxChars) || maxChars <= finalSuffix.length) {
    throw new Error("maxChars must be an integer larger than the final Amora guard");
  }

  const specialistBudget = Math.max(
    0,
    maxChars - finalSuffix.length - TRUNCATION_MARKER.length,
  );
  const boundedSpecialist = specialistPrompt.slice(0, specialistBudget);
  const baseBudget = maxChars - boundedSpecialist.length - finalSuffix.length;
  const boundedBase = truncateAtLineBoundary(basePrompt, baseBudget);
  return `${boundedBase}${boundedSpecialist}${finalSuffix}`;
}
