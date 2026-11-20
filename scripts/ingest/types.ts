export const SUPPORTED_SOURCE_EXTENSIONS = ["xlsx", "docx", "hwp", "pdf", "png"] as const;

export type SourceExtension = (typeof SUPPORTED_SOURCE_EXTENSIONS)[number];
export type DocumentKindHint = "agency" | "hall";

export interface VisualTranscriptionExtractionBinding {
  schema_version: 1;
  content_sha256: string;
  reviewer_kind: "codex_assisted_unconfirmed" | "human_confirmed";
  reviewer_sha256: string;
  evidence_sha256: string;
  record_evidence_sha256: string;
  coverage_gaps_sha256: string;
  fragment_sha256: string;
  validation_issue_codes: Array<
    | "visual_transcription_requires_human_confirmation"
    | "visual_transcription_human_confirmed_pending_admin_review"
  >;
  review_status: "pending";
  needs_review: true;
  bulk_approval_eligible: false;
}
export type UnitStage =
  | "scanned"
  | "converted"
  | "needs_manual_conversion"
  | "extracted"
  | "validated"
  | "loaded"
  | "error";

export interface ParsedUnitName {
  region_code: string;
  raw_name: string;
  normalized_name: string;
  corporate_name: string | null;
  kind_hint: DocumentKindHint;
}

export interface SourceFile {
  path: string;
  absolute_path: string;
  ext: SourceExtension;
  sha256: string;
  bytes: number;
}

/**
 * A raw file the scanner could not turn into a convertible source.
 *
 * Dropping these silently is how a 대행사 disappears between the download
 * folder and the manifest: a CSV price sheet or a photographed price table
 * leaves no unit, no notice, and no count. `unit_id === null` means no unit
 * covers this path at all, so the vendor is invisible downstream.
 */
export interface SkippedSourceFile {
  path: string;
  ext: string;
  unit_id: string | null;
}

export interface ManifestUnit {
  unit_id: string;
  display_name: string;
  parsed: ParsedUnitName;
  source_files: SourceFile[];
  source_fingerprint: string;
  stage: UnitStage;
  notices: string[];
  conversion?: {
    converter_version?: string;
    source_fingerprint: string;
    text_artifacts: string[];
    image_artifacts: string[];
    text_characters: number;
    cell_count: number;
    artifact_fingerprint: string;
    converted_at: string;
    ocr_review?: {
      contract_version: string;
      contract_hash: string;
      language: "ko-KR";
      review_only: true;
      authoritative: false;
      bulk_approval_eligible: false;
      artifacts: Array<{
        artifact_path: string;
        source_image_sha256: string;
        page: number;
        engine_name: "Windows.Media.Ocr";
        engine_version: string;
        engine_hash: string;
        line_count: number;
      }>;
    };
  };
  extraction?: {
    provider_mode?: "production_paid" | "test_only";
    paid_plan_sha256?: string | null;
    fingerprint: string;
    content_sha256?: string;
    source_fingerprint: string;
    artifact_fingerprint: string;
    prompt_version: string;
    prompt_hash?: string;
    processing_version?: string;
    scanner_parser_version?: string;
    converter_version?: string;
    model: "gpt-5.6-luna" | "gpt-5.6-terra";
    artifact_path: string;
    cache_hit: boolean;
    attempts: number;
    input_tokens: number;
    output_tokens: number;
    extracted_at: string;
  };
  local_extraction?: {
    provider_mode: "local_deterministic";
    model: "local-deterministic-v1";
    fingerprint: string;
    content_sha256: string;
    source_fingerprint: string;
    artifact_fingerprint: string;
    scanner_parser_version: string;
    converter_version: string;
    engine_version: string;
    engine_hash: string;
    artifact_path: string;
    cache_hit: boolean;
    attempts: 0;
    input_tokens: 0;
    output_tokens: 0;
    estimated_cost_usd: 0;
    review_status: "pending";
    needs_review: true;
    bulk_approval_eligible: false;
    visual_transcription?: VisualTranscriptionExtractionBinding;
    paid_review_only_override?: true;
    extracted_at: string;
  };
  validation?: {
    fingerprint: string;
    content_sha256?: string;
    extraction_content_sha256?: string;
    validator_version?: string;
    provider_mode?: "local_deterministic";
    model?: "local-deterministic-v1";
    engine_version?: string;
    engine_hash?: string;
    needs_review?: true;
    bulk_approval_eligible?: false;
    visual_transcription?: VisualTranscriptionExtractionBinding;
    artifact_path: string;
    review_status: "pending";
    issue_count: number;
    validated_at: string;
  };
}

export interface IngestManifest {
  schema_version: 1;
  scanner_parser_version: string;
  root_dir: string;
  state_dir: string;
  scanned_at: string;
  units: ManifestUnit[];
  skipped_sources: SkippedSourceFile[];
}
