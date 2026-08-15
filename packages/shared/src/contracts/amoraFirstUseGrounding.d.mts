export type AmoraFirstUseGroundingKey =
  | "wedding_date"
  | "current_progress"
  | "next_schedule"
  | "total_budget"
  | "venue";

export interface AmoraFirstUseGroundingItem {
  key: AmoraFirstUseGroundingKey;
  label: string;
}

export interface AmoraFirstUseGrounding {
  version: 1;
  sourceRevision: number;
  confirmed: readonly AmoraFirstUseGroundingItem[];
  unknowns: readonly AmoraFirstUseGroundingItem[];
}

export const AMORA_FIRST_USE_GROUNDING_VERSION: 1;

export function buildAmoraFirstUseGrounding(input: {
  sourceRevision: unknown;
  todayYmd: unknown;
  weddingDate: unknown;
  budget: unknown;
  venue: unknown;
  progress: unknown;
  scheduleEvents: unknown;
}): Readonly<AmoraFirstUseGrounding> | null;

export function parseAmoraFirstUseGrounding(
  value: unknown,
  expectedSourceRevision: unknown,
): Readonly<AmoraFirstUseGrounding> | null;
