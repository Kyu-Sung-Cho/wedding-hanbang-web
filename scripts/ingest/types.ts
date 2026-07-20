export const SUPPORTED_SOURCE_EXTENSIONS = ["xlsx", "docx", "hwp", "pdf", "png"] as const;

export type SourceExtension = (typeof SUPPORTED_SOURCE_EXTENSIONS)[number];
export type DocumentKindHint = "agency" | "hall";
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
  validation?: {
    fingerprint: string;
    content_sha256?: string;
    extraction_content_sha256?: string;
    validator_version?: string;
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
}
