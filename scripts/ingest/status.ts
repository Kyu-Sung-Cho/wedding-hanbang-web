import { loadManifest } from "./manifest.js";
import { readAiLedger } from "./ledger.js";
import type { UnitStage } from "./types.js";

export interface StatusOptions {
  stateDir: string;
}

export interface IngestStatus {
  total_units: number;
  by_stage: Record<UnitStage, number>;
  manual_source_files: number;
  failed_units: number;
  pending_review_units: number;
  extraction_input_tokens: number;
  extraction_output_tokens: number;
  extraction_estimated_cost_usd: number;
  validation_issues: number;
  failed_unit_details: Array<{
    unit_id: string;
    error_codes: string[];
  }>;
}

const STAGE_ORDER: UnitStage[] = [
  "scanned",
  "converted",
  "needs_manual_conversion",
  "extracted",
  "validated",
  "loaded",
  "error",
];

function contentSafeFailureCodes(notices: string[]): string[] {
  const codes = new Set<string>();
  for (const notice of notices) {
    const normalized = notice.toLowerCase();
    if (normalized.startsWith("extract ") || normalized.startsWith("extract_")) {
      codes.add("extract_failed");
    } else if (normalized.startsWith("convert ") || normalized.startsWith("convert_")) {
      codes.add("convert_failed");
    } else if (normalized.startsWith("validate ") || normalized.startsWith("validate_")) {
      codes.add("validate_failed");
    } else if (normalized.startsWith("load ") || normalized.startsWith("load_")) {
      codes.add("load_failed");
    }
  }
  if (codes.size === 0) codes.add("pipeline_failed");
  return [...codes].sort();
}

export function formatIngestStatus(status: IngestStatus): string {
  const stageWidth = Math.max("Stage".length, ...STAGE_ORDER.map((stage) => stage.length));
  const lines = [
    `${"Stage".padEnd(stageWidth)}  Count`,
    `${"-".repeat(stageWidth)}  -----`,
    ...STAGE_ORDER.map((stage) => `${stage.padEnd(stageWidth)}  ${status.by_stage[stage]}`),
    "",
    `Total units: ${status.total_units}`,
    `Manual source files: ${status.manual_source_files}`,
    `Failed units: ${status.failed_units}`,
    `Pending review units: ${status.pending_review_units}`,
    `Validation issues: ${status.validation_issues}`,
    `AI tokens: ${status.extraction_input_tokens} input / ${status.extraction_output_tokens} output`,
    `Estimated AI cost (USD): ${status.extraction_estimated_cost_usd.toFixed(6)}`,
  ];
  if (status.failed_unit_details.length > 0) {
    lines.push(
      "",
      "Failed unit details (content-safe):",
      ...status.failed_unit_details.map(
        (detail) => `${detail.unit_id}: ${detail.error_codes.join(", ")}`,
      ),
    );
  }
  return lines.join("\n");
}

export async function getIngestStatus(options: StatusOptions): Promise<IngestStatus> {
  const manifest = await loadManifest(options.stateDir);
  const ledger = await readAiLedger(options.stateDir);
  const byStage: Record<UnitStage, number> = {
    scanned: 0,
    converted: 0,
    needs_manual_conversion: 0,
    extracted: 0,
    validated: 0,
    loaded: 0,
    error: 0,
  };
  for (const unit of manifest.units) byStage[unit.stage] += 1;

  return {
    total_units: manifest.units.length,
    by_stage: byStage,
    manual_source_files: manifest.units
      .filter((unit) => unit.stage === "needs_manual_conversion")
      .flatMap((unit) => unit.source_files)
      .filter((source) => source.ext === "hwp" || source.ext === "pdf")
      .length,
    failed_units: byStage.error,
    pending_review_units: manifest.units.filter((unit) => unit.validation?.review_status === "pending").length,
    extraction_input_tokens: manifest.units.reduce((sum, unit) => sum + (unit.extraction?.input_tokens ?? 0), 0),
    extraction_output_tokens: manifest.units.reduce((sum, unit) => sum + (unit.extraction?.output_tokens ?? 0), 0),
    extraction_estimated_cost_usd: ledger.reduce((sum, entry) => sum + entry.estimated_cost_usd, 0),
    validation_issues: manifest.units.reduce((sum, unit) => sum + (unit.validation?.issue_count ?? 0), 0),
    failed_unit_details: manifest.units
      .filter((unit) => unit.stage === "error")
      .map((unit) => ({
        unit_id: unit.unit_id,
        error_codes: contentSafeFailureCodes(unit.notices),
      })),
  };
}
