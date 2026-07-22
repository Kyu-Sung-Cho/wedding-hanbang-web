import type { ToolExecutionResult } from "@/types/database.types";

export function deduplicateToolResults(
  results: readonly ToolExecutionResult[],
): ToolExecutionResult[] {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = JSON.stringify([
      result.toolName,
      result.success,
      (result.displayMessage ?? "").trim(),
      result.toolInput,
      result.toolOutput,
    ]);

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
