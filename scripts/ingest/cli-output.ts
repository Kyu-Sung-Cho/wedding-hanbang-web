import type { IngestStatus } from "./status.js";

type UnknownRecord = Record<string, unknown>;

const ERROR_CODE_BY_MESSAGE_PREFIX = Object.freeze([
  ["paid_openai_cli_disabled", "PAID_OPENAI_CLI_DISABLED"],
  ["abort_staging_run_blocked_by_unsettled_storage_intents", "STAGING_STORAGE_INTENTS_UNSETTLED"],
  ["storage_upload_reconciliation_requires_confirm_no_inflight_upload_flag", "STORAGE_RECONCILIATION_CONFIRMATION_REQUIRED"],
  ["finalize_staging_run_requires_explicit_apply_finalize_flag", "STAGING_FINALIZE_CONFIRMATION_REQUIRED"],
  ["abort_staging_run_requires_explicit_apply_abort_flag", "STAGING_ABORT_CONFIRMATION_REQUIRED"],
  ["complete_storage_rollback_requires_explicit_apply_completion_flag", "STORAGE_ROLLBACK_CONFIRMATION_REQUIRED"],
  ["invalidate_staging_run_requires_explicit_apply_invalidation_flag", "STAGING_INVALIDATION_CONFIRMATION_REQUIRED"],
] as const);

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function safePrimitive(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === "string" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function pickPrimitives(source: unknown, keys: readonly string[]): UnknownRecord {
  const input = record(source);
  return Object.fromEntries(keys.flatMap((key) => {
    const value = safePrimitive(input[key]);
    return value === undefined ? [] : [[key, value]];
  }));
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function summarizeIngestStatus(status: IngestStatus): Omit<IngestStatus, "failed_unit_details"> & {
  failed_error_code_counts: Record<string, number>;
} {
  const failedErrorCodeCounts: Record<string, number> = {};
  for (const detail of status.failed_unit_details) {
    for (const code of detail.error_codes) {
      if (!/^[a-z][a-z0-9_]{2,63}$/u.test(code)) continue;
      failedErrorCodeCounts[code] = (failedErrorCodeCounts[code] ?? 0) + 1;
    }
  }
  const { failed_unit_details: _redactedIdentifiers, ...aggregate } = status;
  return {
    ...aggregate,
    failed_error_code_counts: failedErrorCodeCounts,
  };
}

export function summarizeScoreReport(value: unknown): UnknownRecord {
  const report = record(value);
  const verification = record(report.verification);
  const gate = record(report.gate);
  const groundTruth = record(report.ground_truth);
  const adjudication = record(groundTruth.adjudication);
  const paidPlanSha256 = verification.paid_plan_sha256;

  return {
    schema_version: safePrimitive(report.schema_version) ?? 1,
    verification: {
      ...pickPrimitives(verification, [
        "mode",
        "candidate_source",
        "validated_artifacts_required",
        "deterministic_artifact_paths_required",
        "artifact_content_hashes_required",
        "review_only",
      ]),
      paid_plan_sha256: paidPlanSha256 === null ? null : "[redacted]",
    },
    ground_truth: {
      ...pickPrimitives(groundTruth, [
        "inventory_occurrences",
        "base_inventory_occurrences",
        "base_readable_occurrences",
        "effective_readable_occurrences",
        "overlay_readable_occurrences",
        "unreadable_cells",
      ]),
      adjudication: {
        ...pickPrimitives(adjudication, [
          "verified_decisions",
          "human_required_decisions",
          "human_required_occurrences",
          "excluded_base_occurrences",
          "added_effective_occurrences",
          "quarantined_occurrences",
        ]),
      },
    },
    gate: {
      ...pickPrimitives(gate, [
        "status",
        "verification_mode",
        "validated_artifacts_required",
        "passed_units",
        "failed_units",
        "blocked_units",
        "eligible_for_25_unit_batch",
        "blocking_passed_units",
        "blocking_failed_units",
        "blocking_blocked_units",
      ]),
      blocking_unit_count: arrayLength(gate.blocking_unit_ids),
      non_blocking_unit_count: arrayLength(gate.non_blocking_unit_ids),
      criteria: pickPrimitives(gate.criteria, [
        "hallucinated_amounts",
        "missing_readable_amounts",
        "unsupported_structured_amounts",
        "linking_errors",
        "manual_linkage_reviews",
        "blocking_validation_issues",
        "actual_coverage_gaps",
        "unreadable_amounts_must_remain_unstructured",
      ]),
      semantic_criteria: pickPrimitives(gate.semantic_criteria, [
        "required_for_expected_units",
        "required_status",
      ]),
    },
    unit_result_count: arrayLength(report.units),
    unit_results_redacted: true,
  };
}

export function ingestCliErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "StagingRollbackIncompleteError") {
    return "STAGING_ROLLBACK_INCOMPLETE";
  }
  const message = error instanceof Error ? error.message : "";
  for (const [prefix, code] of ERROR_CODE_BY_MESSAGE_PREFIX) {
    if (message.startsWith(prefix)) return code;
  }
  if (
    /^unknown_/u.test(message)
    || /(?:argument|option|usage|requires|must be|must not|cannot combine|is required)/iu.test(message)
    || /--[a-z0-9-]+/iu.test(message)
  ) {
    return "INGEST_ARGUMENT_INVALID";
  }
  return "INGEST_OPERATION_FAILED";
}

export function formatIngestCliJson(value: UnknownRecord): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function formatIngestCliFailure(error: unknown): string {
  return `INGEST_BLOCKED [${ingestCliErrorCode(error)}]\n`;
}
