import { z } from "zod";

import { SUPPORTED_SOURCE_EXTENSIONS } from "./types.js";

export const SourceFileSchema = z.object({
  path: z.string().min(1),
  absolute_path: z.string().min(1),
  ext: z.enum(SUPPORTED_SOURCE_EXTENSIONS),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
});

export const ManifestUnitSchema = z.object({
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  display_name: z.string().min(1),
  parsed: z.object({
    region_code: z.string().min(1),
    raw_name: z.string().min(1),
    normalized_name: z.string().min(1),
    corporate_name: z.string().min(1).nullable(),
    kind_hint: z.enum(["agency", "hall"]),
  }),
  source_files: z.array(SourceFileSchema).min(1),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  stage: z.enum([
    "scanned",
    "converted",
    "needs_manual_conversion",
    "extracted",
    "validated",
    "loaded",
    "error",
  ]),
  notices: z.array(z.string()),
  conversion: z.object({
    converter_version: z.string().min(1).max(100).default("v1-legacy"),
    source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    text_artifacts: z.array(z.string()),
    image_artifacts: z.array(z.string()),
    text_characters: z.number().int().nonnegative(),
    cell_count: z.number().int().nonnegative(),
    artifact_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    converted_at: z.string().datetime(),
  }).optional(),
  extraction: z.object({
    provider_mode: z.enum(["production_paid", "test_only"]).optional(),
    paid_plan_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    artifact_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    prompt_version: z.string().min(1),
    prompt_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    processing_version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    scanner_parser_version: z.string().min(1).max(100).optional(),
    converter_version: z.string().min(1).max(100).optional(),
    model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
    artifact_path: z.string().min(1),
    cache_hit: z.boolean(),
    attempts: z.number().int().positive(),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    extracted_at: z.string().datetime(),
  }).optional(),
  validation: z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    extraction_content_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    validator_version: z.string().min(1).max(100).optional(),
    artifact_path: z.string().min(1),
    review_status: z.literal("pending"),
    issue_count: z.number().int().nonnegative(),
    validated_at: z.string().datetime(),
  }).optional(),
}).passthrough();

export const IngestManifestSchema = z.object({
  schema_version: z.literal(1),
  // Legacy v1 manifests had no parser identity. Parsing them remains possible,
  // but the next scan treats this sentinel as stale and resets downstream data.
  scanner_parser_version: z.string().min(1).max(100).default("v1-legacy"),
  root_dir: z.string().min(1),
  state_dir: z.string().min(1),
  scanned_at: z.string().datetime(),
  units: z.array(ManifestUnitSchema),
});

const NullableMoneySchema = z.number().int().nonnegative().nullable();
const ConfidenceSchema = z.number().min(0).max(1);
const SourceFileIdsSchema = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(16).default([]);

export const PriceOptionSchema = z.object({
  name: z.string().min(1).max(300),
  price_min_krw: NullableMoneySchema,
  price_max_krw: NullableMoneySchema,
  unit: z.string().min(1).max(100).nullable(),
  condition: z.string().min(1).max(1_000).nullable(),
  raw_text: z.string().min(1).max(2_000),
  source_quote: z.string().min(1).max(1_000),
  source_file_ids: SourceFileIdsSchema,
}).strict();

export const VendorPolicySchema = z.object({
  policy_type: z.enum(["penalty", "refund", "change", "other"]),
  raw_text: z.string().min(1).max(10_000),
  source_quote: z.string().min(1).max(2_000),
  source_file_ids: SourceFileIdsSchema,
}).strict();

export const DisclosureSectionSchema = z.object({
  section_type: z.enum([
    "pricing_basis",
    "refund_policy",
    "penalty",
    "contract_terms",
    "reservation",
    "validity",
    "included_items",
    "usage_guide",
    "notice",
    "other",
  ]),
  title: z.string().min(1).max(300),
  content_verbatim: z.string().min(1).max(20_000),
  summary: z.string().min(1).max(1_000),
  source_quote: z.string().min(1).max(2_000),
  source_file_ids: SourceFileIdsSchema,
  confidence: ConfidenceSchema,
  needs_review: z.boolean(),
}).strict();

export const AuditMoneyOccurrenceSchema = z.object({
  amount_krw: z.number().int().nonnegative(),
  raw_text: z.string().min(1).max(200),
  source_quote: z.string().min(1).max(2_000),
  source_file_ids: SourceFileIdsSchema,
  kind: z.enum(["price", "policy", "other_money"]),
  needs_review: z.boolean(),
}).strict();

export const HallDisclosureSchema = z.object({
  hall_name: z.string().min(1).max(300).nullable(),
  guarantee_min: z.number().int().nonnegative().nullable(),
  meal_price_min_krw: NullableMoneySchema,
  meal_price_max_krw: NullableMoneySchema,
  venue_fee_min_krw: NullableMoneySchema,
  venue_fee_max_krw: NullableMoneySchema,
  venue_fee_note: z.string().min(1).max(4_000).nullable(),
  decoration_fee_min_krw: NullableMoneySchema,
  decoration_fee_max_krw: NullableMoneySchema,
  decoration_note: z.string().min(1).max(4_000).nullable(),
  options: z.array(PriceOptionSchema).max(200),
  source_quote: z.string().min(1).max(2_000),
  source_file_ids: SourceFileIdsSchema,
  confidence: ConfidenceSchema,
  needs_review: z.boolean(),
}).strict();

export const DisclosureExtractionSchema = z.object({
  doc_kind: z.enum([
    "agency_disclosure",
    "hall_disclosure",
    "partner_price_list",
    "mixed",
    "unknown",
  ]),
  business_name: z.string().min(1).max(300).nullable(),
  region_hint: z.string().min(1).max(200).nullable(),
  agency_packages: z.array(z.object({
    package_name: z.string().min(1).max(300),
    category_scope: z.array(z.enum(["studio", "dress", "makeup"])).max(3),
    price_min_krw: NullableMoneySchema,
    price_max_krw: NullableMoneySchema,
    vat_note: z.string().min(1).max(1_000).nullable(),
    price_note: z.string().min(1).max(2_000).nullable(),
    options: z.array(PriceOptionSchema).max(100),
    source_quote: z.string().min(1).max(1_000),
    source_file_ids: SourceFileIdsSchema,
    confidence: ConfidenceSchema,
    needs_review: z.boolean(),
  }).strict()).max(100),
  partner_vendors: z.array(z.object({
    vendor_name: z.string().min(1).max(300),
    old_names: z.array(z.string().min(1).max(200).regex(/\S/)).max(20),
    category: z.enum(["studio", "dress", "makeup", "hall", "other"]),
    price_min_krw: NullableMoneySchema,
    price_max_krw: NullableMoneySchema,
    base_spec: z.string().min(1).max(2_000).nullable(),
    price_note: z.string().min(1).max(2_000).nullable(),
    options: z.array(PriceOptionSchema).max(100),
    policies: z.array(VendorPolicySchema).max(100).default([]),
    source_quote: z.string().min(1).max(1_000),
    source_file_ids: SourceFileIdsSchema,
    confidence: ConfidenceSchema,
    needs_review: z.boolean(),
  }).strict()).max(500),
  halls: z.array(HallDisclosureSchema).max(100).default([]),
  sections: z.array(DisclosureSectionSchema).max(500).default([]),
  // Internal, non-load-bearing audit ledger. One entry is required for every
  // monetary occurrence so duplicate values in the same cell remain countable.
  money_occurrences: z.array(AuditMoneyOccurrenceSchema).max(5_000).default([]),
  hall: z.object({
    venue_fee_krw: NullableMoneySchema,
    meal_price_min_krw: NullableMoneySchema,
    meal_price_max_krw: NullableMoneySchema,
    venue_fee_source_quote: z.string().min(1).max(1_000).nullable(),
    meal_price_source_quote: z.string().min(1).max(1_000).nullable(),
    venue_fee_source_file_ids: SourceFileIdsSchema,
    meal_price_source_file_ids: SourceFileIdsSchema,
    items: z.array(z.object({
      name: z.string().min(1).max(300),
      price_min_krw: NullableMoneySchema,
      price_max_krw: NullableMoneySchema,
      raw_text: z.string().min(1).max(2_000),
      source_quote: z.string().min(1).max(1_000),
      source_file_ids: SourceFileIdsSchema,
      confidence: ConfidenceSchema,
      needs_review: z.boolean(),
    }).strict()).max(200),
    confidence: ConfidenceSchema,
    needs_review: z.boolean(),
  }).strict(),
  extraction_notes: z.string().max(4_000),
}).strict();

type ParsedDisclosureExtraction = z.infer<typeof DisclosureExtractionSchema>;
type ParsedPriceOption = ParsedDisclosureExtraction["agency_packages"][number]["options"][number];
type CompatiblePriceOption = Omit<ParsedPriceOption, "source_file_ids"> & {
  // In-memory test/provider adapters created before prompt v4 may omit this.
  // Schema parsing always materializes it; validation fails closed when a
  // multi-source row reaches staging without attribution.
  source_file_ids?: string[];
};
type CompatibleAgencyPackage = Omit<
  ParsedDisclosureExtraction["agency_packages"][number],
  "source_file_ids" | "options"
> & {
  source_file_ids?: string[];
  options: CompatiblePriceOption[];
};
type CompatiblePartnerVendor = Omit<
  ParsedDisclosureExtraction["partner_vendors"][number],
  "source_file_ids" | "options" | "policies"
> & {
  source_file_ids?: string[];
  options: CompatiblePriceOption[];
  policies?: ParsedDisclosureExtraction["partner_vendors"][number]["policies"];
};
type CompatibleHallItem = Omit<
  ParsedDisclosureExtraction["hall"]["items"][number],
  "source_file_ids"
> & { source_file_ids?: string[] };

export type DisclosureExtraction = Omit<
  ParsedDisclosureExtraction,
  "agency_packages" | "partner_vendors" | "halls" | "sections" | "money_occurrences" | "hall"
> & {
  agency_packages: CompatibleAgencyPackage[];
  partner_vendors: CompatiblePartnerVendor[];
  halls?: ParsedDisclosureExtraction["halls"];
  sections?: ParsedDisclosureExtraction["sections"];
  money_occurrences?: ParsedDisclosureExtraction["money_occurrences"];
  hall: Omit<
    ParsedDisclosureExtraction["hall"],
    "venue_fee_source_file_ids" | "meal_price_source_file_ids" | "items"
  > & {
    venue_fee_source_file_ids?: string[];
    meal_price_source_file_ids?: string[];
    items: CompatibleHallItem[];
  };
};

const ExtractionEvidenceModalitySchema = z.object({
  path: z.string().min(1).max(500),
  source_file_id: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  modality: z.enum(["text", "image", "mixed"]),
}).strict();

export const LegacyExtractionArtifactSchema = z.object({
  schema_version: z.literal(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  artifact_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  prompt_version: z.string().min(1),
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  data: DisclosureExtractionSchema,
  attempts: z.number().int().positive(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  evidence_modalities: z.array(ExtractionEvidenceModalitySchema).max(10_000).optional(),
  created_at: z.string().datetime(),
});

export const StrictExtractionArtifactSchema = z.object({
  schema_version: z.literal(3),
  provider_mode: z.enum(["production_paid", "test_only"]),
  paid_plan_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  artifact_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  prompt_version: z.string().min(1),
  prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  processing_version: z.string().regex(/^[a-f0-9]{64}$/),
  scanner_parser_version: z.string().min(1).max(100),
  converter_version: z.string().min(1).max(100),
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  data: DisclosureExtractionSchema,
  attempts: z.number().int().positive(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  evidence_modalities: z.array(ExtractionEvidenceModalitySchema).max(10_000).optional(),
  batch_checkpoint_fingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(96),
  batch_checkpoint_result_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(96),
  created_at: z.string().datetime(),
}).strict().superRefine((artifact, context) => {
  if (artifact.provider_mode === "production_paid" && artifact.paid_plan_sha256 === null) {
    context.addIssue({
      code: "custom",
      path: ["paid_plan_sha256"],
      message: "production extraction caches require paid_plan_sha256",
    });
  }
  if (artifact.provider_mode === "test_only" && artifact.paid_plan_sha256 !== null) {
    context.addIssue({
      code: "custom",
      path: ["paid_plan_sha256"],
      message: "test-only extraction caches cannot claim a paid plan",
    });
  }
  if (artifact.batch_checkpoint_fingerprints.length !== artifact.batch_checkpoint_result_hashes.length) {
    context.addIssue({
      code: "custom",
      path: ["batch_checkpoint_result_hashes"],
      message: "checkpoint fingerprint and result hash arrays must have the same length",
    });
  }
});

export const ExtractionArtifactSchema = z.union([
  LegacyExtractionArtifactSchema,
  StrictExtractionArtifactSchema,
]);

export type StrictExtractionArtifact = z.infer<typeof StrictExtractionArtifactSchema>;
export type ExtractionArtifact = z.infer<typeof ExtractionArtifactSchema>;

export const ExtractionBatchCheckpointSchema = z.object({
  schema_version: z.literal(3),
  provider_mode: z.enum(["production_paid", "test_only"]),
  paid_plan_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  checkpoint_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  batch_index: z.number().int().nonnegative(),
  prompt_version: z.string().min(1).max(100),
  prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  processing_version: z.string().regex(/^[a-f0-9]{64}$/),
  scanner_parser_version: z.string().min(1).max(100),
  converter_version: z.string().min(1).max(100),
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  canonical_identity: z.object({
    canonical_name: z.string().min(1).max(500),
    region_code: z.string().min(1).max(100),
    kind_hint: z.enum(["agency", "hall"]),
  }).strict(),
  artifact_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  attempt_request_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(4),
  successful_request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  result_hash: z.string().regex(/^[a-f0-9]{64}$/),
  data: DisclosureExtractionSchema,
  attempts: z.number().int().positive().max(4),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  success_ledger_id: z.string().regex(/^[a-f0-9]{64}$/),
  successful_input_tokens: z.number().int().nonnegative(),
  successful_output_tokens: z.number().int().nonnegative(),
  request_id: z.string().min(1).max(200).nullable(),
  created_at: z.string().datetime(),
}).strict().superRefine((checkpoint, context) => {
  if (checkpoint.provider_mode === "production_paid" && checkpoint.paid_plan_sha256 === null) {
    context.addIssue({
      code: "custom",
      path: ["paid_plan_sha256"],
      message: "production checkpoints require paid_plan_sha256",
    });
  }
  if (checkpoint.provider_mode === "test_only" && checkpoint.paid_plan_sha256 !== null) {
    context.addIssue({
      code: "custom",
      path: ["paid_plan_sha256"],
      message: "test-only checkpoints cannot claim a paid plan",
    });
  }
});

export type ExtractionBatchCheckpoint = z.infer<typeof ExtractionBatchCheckpointSchema>;
