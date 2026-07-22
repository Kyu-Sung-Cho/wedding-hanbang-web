import type { ToolExecutionResult } from "@/types/database.types";

export const EPHEMERAL_PLACE_SEARCH_TOOL = "search_nearby_places";

/** NAVER Search results are display-only and must never enter chat storage. */
export function getPersistableToolResults(
  results: ToolExecutionResult[]
): ToolExecutionResult[] {
  return results.filter((result) => result.toolName !== EPHEMERAL_PLACE_SEARCH_TOOL);
}

/**
 * Search output is untrusted third-party content rendered directly by clients.
 * The model receives only a fixed status marker, never provider content.
 */
export function getModelSafeToolOutput(result: ToolExecutionResult): Record<string, unknown> {
  if (result.toolName !== EPHEMERAL_PLACE_SEARCH_TOOL) return result.toolOutput;
  return {
    success: result.success,
    status: result.success ? "rendered_in_client" : "unavailable",
  };
}

export function hasEphemeralPlaceSearchResult(results: ToolExecutionResult[]): boolean {
  return results.some((result) => result.toolName === EPHEMERAL_PLACE_SEARCH_TOOL);
}
