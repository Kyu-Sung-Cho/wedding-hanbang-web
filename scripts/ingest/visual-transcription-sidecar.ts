import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import { canonicalSha256 } from "./gate-integrity.js";
import { isPathWithin, readJsonFile, sha256File, sha256Text, writeJsonFile } from "./io.js";
import { sourceFileId } from "./provenance.js";
import {
  DisclosureExtractionSchema,
  type DisclosureExtraction,
  type VisualTranscriptionExtractionBinding,
} from "./schemas.js";
import type { IngestManifest, ManifestUnit, SourceFile } from "./types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VISUAL_RECORD_PATH_PATTERN = /^(?:agency_packages|partner_vendors|halls|sections|money_occurrences)\[\d+\](?:\.(?:options|policies)\[\d+\])?$/u;
const APPROVED_TEXT_BLOCK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const OCR_MASQUERADE_PATTERN = /(?:^|\n)\s*(?:\[OCR_REVIEW_ONLY\]|ocr:|engine_name\s*:\s*Windows\.Media\.Ocr)/iu;
const TEXT_ENCODING_CORRUPTION_PATTERN = /\uFFFD|\?{2,}|(?:^|\s)\?(?=\s|$)/u;
const MAX_SIDECAR_BYTES = 16 * 1024 * 1024;

export const VISUAL_TRANSCRIPTION_HUMAN_CONFIRMATION_ISSUE =
  "visual_transcription_requires_human_confirmation" as const;
export const VISUAL_TRANSCRIPTION_HUMAN_REVIEW_ISSUE =
  "visual_transcription_human_confirmed_pending_admin_review" as const;

const HashSchema = z.string().regex(SHA256_PATTERN);
const BoundSourceSchema = z.object({
  path: z.string().min(1).max(10_000),
  sha256: HashSchema,
  bytes: z.number().int().nonnegative(),
}).strict();

const LocatorMigrationConfirmationSchema = z.object({
  contract_version: z.literal("page-to-image-v1"),
  derived_overlay_content_sha256: HashSchema,
  transformed_locator_count: z.number().int().positive().max(100_000),
  transformed_unit_count: z.number().int().positive().max(10_000),
}).strict();

export function normalizeApprovedVisualText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export interface ApprovedVisualTextBlockHashInput {
  id: string;
  source_locator: string;
  normalized_content: string;
  evidence_id: string;
  source_sha256: string;
}

export function approvedVisualTextBlockHash(
  block: ApprovedVisualTextBlockHashInput,
): string {
  return sha256Text([
    "approved-visual-text-block-v1",
    block.id,
    block.source_locator,
    block.normalized_content,
    block.evidence_id,
    block.source_sha256,
  ].join("\0"));
}

const ApprovedTextBlockSchema = z.object({
  id: z.string().regex(APPROVED_TEXT_BLOCK_ID_PATTERN),
  source_locator: z.string().min(1).max(200),
  normalized_content: z.string().min(1).max(20_000),
  evidence_id: HashSchema,
  source_sha256: HashSchema,
  block_sha256: HashSchema,
}).strict();

const RecordFieldBindingSchema = z.object({
  field_path: z.string().min(1).max(500),
  approved_text_block_id: z.string().regex(APPROVED_TEXT_BLOCK_ID_PATTERN),
  binding_kind: z.enum(["exact", "extractive", "enum_derivation"]),
}).strict();

const HumanConfirmationSchema = z.object({
  overlay_artifact_relative_path: z.string().min(1).max(10_000),
  source_ground_truth_sha256: HashSchema,
  overlay_entry_sha256: HashSchema,
  approval_reference: z.string().min(1).max(500),
  locator_migration: LocatorMigrationConfirmationSchema.optional(),
}).strict();

const OverlayOccurrenceSchema = z.object({
  raw: z.string().min(1).max(200),
  krw: z.number().int().nonnegative(),
  line_context: z.string().min(1).max(1_000),
  source_locator: z.string().min(1).max(200),
}).strict();

const OverlayUnitSchema = z.object({
  unit_id: HashSchema,
  readable_occurrences: z.array(OverlayOccurrenceSchema).max(10_000),
  unreadable_cells: z.array(z.object({
    source_locator: z.string().min(1).max(300),
    visible_amounts_krw: z.array(z.number().int().nonnegative()).max(100),
    estimated_content: z.string().min(1).max(2_000),
    reason: z.string().min(1).max(1_000),
  }).strict()).max(10_000),
  expectations: z.object({
    doc_kinds: z.array(DisclosureExtractionSchema.shape.doc_kind).min(1),
    allowed_partner_categories: z.array(z.enum([
      "studio",
      "dress",
      "makeup",
      "hall",
      "other",
    ])).min(1).optional(),
    policies: z.boolean(),
    pricing_basis: z.boolean(),
    sections: z.boolean(),
    halls_min: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const VisualGroundTruthOverlaySchema = z.object({
  schema_version: z.literal(1),
  created_at: z.string().datetime(),
  units: z.array(OverlayUnitSchema).min(1).max(10_000),
}).strict();

const DerivedVisualGroundTruthOverlaySchema = z.object({
  schema_version: z.literal(1),
  artifact_kind: z.literal("derived_visual_ground_truth_overlay"),
  content_sha256: HashSchema,
  source_overlay_relative_path: z.string().min(1).max(10_000),
  source_overlay_sha256: HashSchema,
  locator_migration: z.object({
    contract_version: z.literal("page-to-image-v1"),
    transformed_locator_count: z.number().int().positive().max(100_000),
    transformed_unit_count: z.number().int().positive().max(10_000),
  }).strict(),
  overlay: VisualGroundTruthOverlaySchema,
}).strict();

export type DerivedVisualGroundTruthOverlay = z.infer<
  typeof DerivedVisualGroundTruthOverlaySchema
>;

const ReviewerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("codex_assisted_unconfirmed"),
    recorded_at: z.string().datetime(),
  }).strict(),
  z.object({
    kind: z.literal("human_confirmed"),
    recorded_at: z.string().datetime(),
    confirmation: HumanConfirmationSchema,
    approved_text_blocks: z.array(ApprovedTextBlockSchema).min(1).max(10_000),
    record_field_bindings: z.array(RecordFieldBindingSchema).min(1).max(50_000),
  }).strict(),
]);

const VisualEvidenceSchema = z.object({
  evidence_id: HashSchema,
  evidence_kind: z.literal("visual_transcription"),
  source_file_id: HashSchema,
  source_sha256: HashSchema,
  source_bytes: z.number().int().nonnegative(),
  image_artifact_index: z.number().int().nonnegative().max(10_000),
  image_sha256: HashSchema,
  image_bytes: z.number().int().positive(),
  page: z.number().int().positive().max(10_000),
}).strict();

const RecordEvidenceSchema = z.object({
  record_path: z.string().regex(VISUAL_RECORD_PATH_PATTERN),
  evidence_ids: z.array(HashSchema).min(1).max(32),
  source_locators: z.array(z.string().min(1).max(200)).min(1).max(100),
}).strict();

const VisualCoverageGapSchema = z.object({
  evidence_id: HashSchema,
  source_locator: z.string().min(1).max(300),
  visible_amounts_krw: z.array(z.number().int().nonnegative()).max(100),
  estimated_content: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(1_000),
}).strict();

const VisualTranscriptionFragmentSchema = z.object({
  doc_kind: DisclosureExtractionSchema.shape.doc_kind,
  business_name: DisclosureExtractionSchema.shape.business_name.optional().default(null),
  region_hint: DisclosureExtractionSchema.shape.region_hint.optional().default(null),
  agency_packages: DisclosureExtractionSchema.shape.agency_packages,
  partner_vendors: DisclosureExtractionSchema.shape.partner_vendors,
  halls: DisclosureExtractionSchema.shape.halls,
  sections: DisclosureExtractionSchema.shape.sections,
  money_occurrences: DisclosureExtractionSchema.shape.money_occurrences,
}).strict();

type VisualTranscriptionFragment = z.infer<typeof VisualTranscriptionFragmentSchema>;

interface FragmentRecord {
  path: string;
  sourceQuote: string;
  sourceFileIds: string[];
}

interface HumanConfirmedField {
  path: string;
  value: string;
  kind: "text" | "enum";
  recordPath: string | null;
}

interface CanonicalVisualLocator {
  value: string;
  page: number;
}

function parseCanonicalVisualLocator(value: string): CanonicalVisualLocator | null {
  if (value !== value.trim() || value !== value.normalize("NFKC") || value.includes("\\")) {
    return null;
  }
  const matched = /^image:([1-9]\d*)\/(.{1,180})$/u.exec(value);
  if (!matched) return null;
  const segments = matched[2]!.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return { value, page: Number.parseInt(matched[1]!, 10) };
}

function fragmentRecords(fragment: VisualTranscriptionFragment): FragmentRecord[] {
  const records: FragmentRecord[] = [];
  fragment.agency_packages.forEach((row, index) => {
    records.push({
      path: `agency_packages[${index}]`,
      sourceQuote: row.source_quote,
      sourceFileIds: row.source_file_ids,
    });
    row.options.forEach((option, optionIndex) => records.push({
      path: `agency_packages[${index}].options[${optionIndex}]`,
      sourceQuote: option.source_quote,
      sourceFileIds: option.source_file_ids,
    }));
  });
  fragment.partner_vendors.forEach((row, index) => {
    records.push({
      path: `partner_vendors[${index}]`,
      sourceQuote: row.source_quote,
      sourceFileIds: row.source_file_ids,
    });
    row.options.forEach((option, optionIndex) => records.push({
      path: `partner_vendors[${index}].options[${optionIndex}]`,
      sourceQuote: option.source_quote,
      sourceFileIds: option.source_file_ids,
    }));
    row.policies.forEach((policy, policyIndex) => records.push({
      path: `partner_vendors[${index}].policies[${policyIndex}]`,
      sourceQuote: policy.source_quote,
      sourceFileIds: policy.source_file_ids,
    }));
  });
  fragment.halls.forEach((row, index) => {
    records.push({
      path: `halls[${index}]`,
      sourceQuote: row.source_quote,
      sourceFileIds: row.source_file_ids,
    });
    row.options.forEach((option, optionIndex) => records.push({
      path: `halls[${index}].options[${optionIndex}]`,
      sourceQuote: option.source_quote,
      sourceFileIds: option.source_file_ids,
    }));
  });
  fragment.sections.forEach((row, index) => records.push({
    path: `sections[${index}]`,
    sourceQuote: row.source_quote,
    sourceFileIds: row.source_file_ids,
  }));
  fragment.money_occurrences.forEach((row, index) => records.push({
    path: `money_occurrences[${index}]`,
    sourceQuote: row.source_quote,
    sourceFileIds: row.source_file_ids,
  }));
  return records;
}

function humanConfirmedFields(fragment: VisualTranscriptionFragment): HumanConfirmedField[] {
  const fields: HumanConfirmedField[] = [{
    path: "doc_kind",
    value: fragment.doc_kind,
    kind: "enum",
    recordPath: null,
  }];
  const add = (
    path: string,
    value: string | null,
    kind: HumanConfirmedField["kind"],
    recordPath: string,
  ): void => {
    if (value !== null) fields.push({ path, value, kind, recordPath });
  };
  if (fragment.business_name !== null) {
    fields.push({
      path: "business_name",
      value: fragment.business_name,
      kind: "text",
      recordPath: null,
    });
  }
  if (fragment.region_hint !== null) {
    fields.push({
      path: "region_hint",
      value: fragment.region_hint,
      kind: "text",
      recordPath: null,
    });
  }
  const addOption = (
    option: VisualTranscriptionFragment["agency_packages"][number]["options"][number],
    pathValue: string,
  ): void => {
    add(`${pathValue}.name`, option.name, "text", pathValue);
    add(`${pathValue}.unit`, option.unit, "text", pathValue);
    add(`${pathValue}.condition`, option.condition, "text", pathValue);
    add(`${pathValue}.raw_text`, option.raw_text, "text", pathValue);
    add(`${pathValue}.source_quote`, option.source_quote, "text", pathValue);
  };
  fragment.agency_packages.forEach((row, index) => {
    const recordPath = `agency_packages[${index}]`;
    add(`${recordPath}.package_name`, row.package_name, "text", recordPath);
    row.category_scope.forEach((category, categoryIndex) => add(
      `${recordPath}.category_scope[${categoryIndex}]`,
      category,
      "enum",
      recordPath,
    ));
    add(`${recordPath}.vat_note`, row.vat_note, "text", recordPath);
    add(`${recordPath}.price_note`, row.price_note, "text", recordPath);
    add(`${recordPath}.source_quote`, row.source_quote, "text", recordPath);
    row.options.forEach((option, optionIndex) => addOption(
      option,
      `${recordPath}.options[${optionIndex}]`,
    ));
  });
  fragment.partner_vendors.forEach((row, index) => {
    const recordPath = `partner_vendors[${index}]`;
    add(`${recordPath}.vendor_name`, row.vendor_name, "text", recordPath);
    row.old_names.forEach((oldName, oldNameIndex) => add(
      `${recordPath}.old_names[${oldNameIndex}]`,
      oldName,
      "text",
      recordPath,
    ));
    add(`${recordPath}.category`, row.category, "enum", recordPath);
    add(`${recordPath}.base_spec`, row.base_spec, "text", recordPath);
    add(`${recordPath}.price_note`, row.price_note, "text", recordPath);
    add(`${recordPath}.source_quote`, row.source_quote, "text", recordPath);
    row.options.forEach((option, optionIndex) => addOption(
      option,
      `${recordPath}.options[${optionIndex}]`,
    ));
    row.policies.forEach((policy, policyIndex) => {
      const policyPath = `${recordPath}.policies[${policyIndex}]`;
      add(`${policyPath}.policy_type`, policy.policy_type, "enum", policyPath);
      add(`${policyPath}.raw_text`, policy.raw_text, "text", policyPath);
      add(`${policyPath}.source_quote`, policy.source_quote, "text", policyPath);
    });
  });
  fragment.halls.forEach((row, index) => {
    const recordPath = `halls[${index}]`;
    add(`${recordPath}.hall_name`, row.hall_name, "text", recordPath);
    add(`${recordPath}.venue_fee_note`, row.venue_fee_note, "text", recordPath);
    add(`${recordPath}.decoration_note`, row.decoration_note, "text", recordPath);
    add(`${recordPath}.source_quote`, row.source_quote, "text", recordPath);
    row.options.forEach((option, optionIndex) => addOption(
      option,
      `${recordPath}.options[${optionIndex}]`,
    ));
  });
  fragment.sections.forEach((row, index) => {
    const recordPath = `sections[${index}]`;
    add(`${recordPath}.section_type`, row.section_type, "enum", recordPath);
    add(`${recordPath}.title`, row.title, "text", recordPath);
    add(`${recordPath}.content_verbatim`, row.content_verbatim, "text", recordPath);
    add(`${recordPath}.summary`, row.summary, "text", recordPath);
    add(`${recordPath}.source_quote`, row.source_quote, "text", recordPath);
  });
  fragment.money_occurrences.forEach((row, index) => {
    const recordPath = `money_occurrences[${index}]`;
    add(`${recordPath}.raw_text`, row.raw_text, "text", recordPath);
    add(`${recordPath}.source_quote`, row.source_quote, "text", recordPath);
    add(`${recordPath}.kind`, row.kind, "enum", recordPath);
  });
  return fields;
}

function assertHumanApprovedTextBindings(sidecar: VisualTranscriptionSidecar): void {
  if (sidecar.reviewer.kind !== "human_confirmed") return;
  const scanEncoding = (value: unknown, valuePath: string): void => {
    if (typeof value === "string") {
      if (TEXT_ENCODING_CORRUPTION_PATTERN.test(value)) {
        throw new Error(`visual_transcription_human_text_encoding_corruption:${valuePath}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scanEncoding(item, `${valuePath}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        scanEncoding(item, valuePath ? `${valuePath}.${key}` : key);
      }
    }
  };
  const { fragment: _fragment, ...sidecarMetadata } = sidecar;
  scanEncoding(sidecarMetadata, "");
  const blocks = sidecar.reviewer.approved_text_blocks;
  const bindings = sidecar.reviewer.record_field_bindings;
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  if (blocksById.size !== blocks.length) {
    throw new Error("visual_transcription_human_approved_text_block_id_duplicated");
  }
  const evidenceById = new Map(sidecar.evidence.map((evidence) => [evidence.evidence_id, evidence]));
  for (const block of blocks) {
    const normalized = normalizeApprovedVisualText(block.normalized_content);
    if (!normalized || normalized !== block.normalized_content) {
      throw new Error(`visual_transcription_human_approved_text_not_normalized:${block.id}`);
    }
    if (TEXT_ENCODING_CORRUPTION_PATTERN.test(normalized)) {
      throw new Error(`visual_transcription_human_text_encoding_corruption:approved_text_blocks.${block.id}`);
    }
    if (!parseCanonicalVisualLocator(block.source_locator)) {
      throw new Error(`visual_transcription_human_approved_text_locator_invalid:${block.id}`);
    }
    const evidence = evidenceById.get(block.evidence_id);
    if (
      !evidence
      || evidence.source_sha256 !== block.source_sha256
      || evidence.page !== parseCanonicalVisualLocator(block.source_locator)?.page
    ) {
      throw new Error(`visual_transcription_human_approved_text_evidence_mismatch:${block.id}`);
    }
    if (block.block_sha256 !== approvedVisualTextBlockHash(block)) {
      throw new Error(`visual_transcription_human_approved_text_block_hash_mismatch:${block.id}`);
    }
  }
  const bindingsByPath = new Map(bindings.map((binding) => [binding.field_path, binding]));
  if (bindingsByPath.size !== bindings.length) {
    throw new Error("visual_transcription_human_field_binding_duplicated");
  }
  const recordEvidenceByPath = new Map(sidecar.record_evidence.map((binding) => [
    binding.record_path,
    binding,
  ]));
  const fields = humanConfirmedFields(sidecar.fragment);
  const expectedPaths = new Set(fields.map((field) => field.path));
  const referencedBlockIds = new Set<string>();
  for (const binding of bindings) {
    if (!expectedPaths.has(binding.field_path)) {
      throw new Error(`visual_transcription_human_field_binding_unknown:${binding.field_path}`);
    }
  }
  for (const field of fields) {
    if (TEXT_ENCODING_CORRUPTION_PATTERN.test(field.value)) {
      throw new Error(`visual_transcription_human_text_encoding_corruption:${field.path}`);
    }
    const binding = bindingsByPath.get(field.path);
    if (!binding) {
      throw new Error(`visual_transcription_human_text_field_unbound:${field.path}`);
    }
    const block = blocksById.get(binding.approved_text_block_id);
    if (!block) {
      throw new Error(`visual_transcription_human_field_block_missing:${field.path}`);
    }
    referencedBlockIds.add(block.id);
    if (field.recordPath) {
      const recordEvidence = recordEvidenceByPath.get(field.recordPath);
      if (
        !recordEvidence
        || !recordEvidence.evidence_ids.includes(block.evidence_id)
        || !recordEvidence.source_locators.includes(block.source_locator)
      ) {
        throw new Error(`visual_transcription_human_field_evidence_mismatch:${field.path}`);
      }
    }
    if (field.kind === "enum") {
      if (binding.binding_kind !== "enum_derivation") {
        throw new Error(`visual_transcription_human_enum_derivation_invalid:${field.path}`);
      }
      continue;
    }
    if (binding.binding_kind === "enum_derivation") {
      throw new Error(`visual_transcription_human_text_binding_kind_invalid:${field.path}`);
    }
    const value = normalizeApprovedVisualText(field.value);
    const approved = block.normalized_content;
    const matches = binding.binding_kind === "exact"
      ? value === approved
      : approved.includes(value);
    if (!matches) {
      throw new Error(`visual_transcription_human_text_field_not_approved:${field.path}`);
    }
  }
  for (const block of blocks) {
    if (!referencedBlockIds.has(block.id)) {
      throw new Error(`visual_transcription_human_approved_text_block_unbound:${block.id}`);
    }
  }
}

export function visualTranscriptionEvidenceId(input: {
  source_file_id: string;
  image_sha256: string;
  page: number;
}): string {
  return sha256Text([
    "visual-transcription-evidence-v1",
    input.source_file_id,
    input.image_sha256,
    String(input.page),
  ].join("\0"));
}

export function visualTranscriptionExtractionBinding(
  sidecar: LoadedVisualTranscriptionSidecar,
): VisualTranscriptionExtractionBinding {
  const issueCode = sidecar.validation_issue_codes[0];
  if (!issueCode || sidecar.validation_issue_codes.length !== 1) {
    throw new Error("visual_transcription_issue_binding_invalid");
  }
  return {
    schema_version: 1,
    content_sha256: sidecar.content_sha256,
    reviewer_kind: sidecar.reviewer.kind,
    reviewer_sha256: canonicalSha256(sidecar.reviewer),
    evidence_sha256: canonicalSha256(sidecar.evidence),
    record_evidence_sha256: canonicalSha256(sidecar.record_evidence),
    coverage_gaps_sha256: canonicalSha256(sidecar.coverage_gaps),
    fragment_sha256: canonicalSha256(sidecar.fragment),
    validation_issue_codes: [issueCode],
    review_status: "pending",
    needs_review: true,
    bulk_approval_eligible: false,
  };
}

export function visualTranscriptionBoundLocalExtractionFingerprint(
  baseFingerprint: string,
  binding: VisualTranscriptionExtractionBinding | null | undefined,
): string {
  if (!binding) return baseFingerprint;
  return sha256Text([
    "visual-transcription-bound-local-extraction-v1",
    baseFingerprint,
    binding.content_sha256,
    canonicalSha256(binding),
  ].join("\0"));
}

export const VisualTranscriptionSidecarSchema = z.object({
  schema_version: z.literal(1),
  artifact_kind: z.literal("visual_transcription_sidecar"),
  content_sha256: HashSchema,
  unit_id: HashSchema,
  source_fingerprint: HashSchema,
  conversion_artifact_fingerprint: HashSchema,
  source_files: z.array(BoundSourceSchema).min(1).max(100),
  reviewer: ReviewerSchema,
  review_status: z.literal("pending"),
  needs_review: z.literal(true),
  bulk_approval_eligible: z.literal(false),
  evidence: z.array(VisualEvidenceSchema).min(1).max(10_000),
  record_evidence: z.array(RecordEvidenceSchema).max(10_000),
  coverage_gaps: z.array(VisualCoverageGapSchema).max(10_000),
  fragment: VisualTranscriptionFragmentSchema,
  created_at: z.string().datetime(),
}).strict().superRefine((sidecar, context) => {
  const evidenceById = new Map(sidecar.evidence.map((evidence) => [evidence.evidence_id, evidence]));
  if (evidenceById.size !== sidecar.evidence.length) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "evidence_id values must be unique" });
  }
  sidecar.evidence.forEach((evidence, index) => {
    const expectedId = visualTranscriptionEvidenceId(evidence);
    if (evidence.evidence_id !== expectedId) {
      context.addIssue({
        code: "custom",
        path: ["evidence", index, "evidence_id"],
        message: "evidence_id is not bound to source_file_id, page-image SHA-256, and page",
      });
    }
  });

  const bindingsByPath = new Map(sidecar.record_evidence.map((binding) => [binding.record_path, binding]));
  if (bindingsByPath.size !== sidecar.record_evidence.length) {
    context.addIssue({ code: "custom", path: ["record_evidence"], message: "record_path values must be unique" });
  }
  const records = fragmentRecords(sidecar.fragment);
  const expectedPaths = new Set(records.map((record) => record.path));
  for (const binding of sidecar.record_evidence) {
    if (!expectedPaths.has(binding.record_path)) {
      context.addIssue({
        code: "custom",
        path: ["record_evidence"],
        message: `record_evidence contains an unknown record path: ${binding.record_path}`,
      });
    }
    if (new Set(binding.evidence_ids).size !== binding.evidence_ids.length) {
      context.addIssue({ code: "custom", path: ["record_evidence"], message: "evidence_ids must be unique" });
    }
    if (new Set(binding.source_locators).size !== binding.source_locators.length) {
      context.addIssue({ code: "custom", path: ["record_evidence"], message: "source_locators must be unique" });
    }
    for (const locator of binding.source_locators) {
      const parsedLocator = parseCanonicalVisualLocator(locator);
      if (!parsedLocator) {
        context.addIssue({
          code: "custom",
          path: ["record_evidence"],
          message: `record evidence locator is not canonical visual evidence: ${locator}`,
        });
        continue;
      }
      if (!binding.evidence_ids.some((evidenceId) => (
        evidenceById.get(evidenceId)?.page === parsedLocator.page
      ))) {
        context.addIssue({
          code: "custom",
          path: ["record_evidence"],
          message: `record locator page is not bound to its page-image evidence: ${locator}`,
        });
      }
    }
  }
  for (const record of records) {
    const binding = bindingsByPath.get(record.path);
    if (!binding) {
      context.addIssue({
        code: "custom",
        path: ["record_evidence"],
        message: `visual record is missing image evidence: ${record.path}`,
      });
      continue;
    }
    const boundEvidence = binding.evidence_ids.flatMap((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        context.addIssue({
          code: "custom",
          path: ["record_evidence"],
          message: `record references unknown visual evidence: ${evidenceId}`,
        });
        return [];
      }
      return [evidence];
    });
    const boundSourceIds = [...new Set(boundEvidence.map((evidence) => evidence.source_file_id))].sort();
    const recordSourceIds = [...new Set(record.sourceFileIds)].sort();
    if (
      recordSourceIds.length !== record.sourceFileIds.length
      || JSON.stringify(boundSourceIds) !== JSON.stringify(recordSourceIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fragment"],
        message: `record source_file_ids do not match visual image evidence: ${record.path}`,
      });
    }
    if (OCR_MASQUERADE_PATTERN.test(record.sourceQuote)) {
      context.addIssue({
        code: "custom",
        path: ["fragment"],
        message: `OCR output cannot masquerade as visual transcription evidence: ${record.path}`,
      });
    }
  }
  for (const gap of sidecar.coverage_gaps) {
    const evidence = evidenceById.get(gap.evidence_id);
    if (!evidence) {
      context.addIssue({
        code: "custom",
        path: ["coverage_gaps"],
        message: `coverage gap references unknown visual evidence: ${gap.evidence_id}`,
      });
      continue;
    }
    const locator = parseCanonicalVisualLocator(gap.source_locator);
    if (!locator || locator.page !== evidence.page) {
      context.addIssue({
        code: "custom",
        path: ["coverage_gaps"],
        message: `coverage gap locator is not bound to its page-image evidence: ${gap.source_locator}`,
      });
    }
  }
});

export type VisualTranscriptionSidecar = z.infer<typeof VisualTranscriptionSidecarSchema>;

export interface LoadedVisualTranscriptionSidecar extends VisualTranscriptionSidecar {
  validation_issue_codes: Array<
    | typeof VISUAL_TRANSCRIPTION_HUMAN_CONFIRMATION_ISSUE
    | typeof VISUAL_TRANSCRIPTION_HUMAN_REVIEW_ISSUE
  >;
  evidence: Array<VisualTranscriptionSidecar["evidence"][number] & {
    page_locator: string;
  }>;
}

export interface LoadVisualTranscriptionSidecarOptions {
  stateDir: string;
  manifest: IngestManifest;
  unitId: string;
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLocaleLowerCase("en-US") === resolvedRight.toLocaleLowerCase("en-US")
    : resolvedLeft === resolvedRight;
}

function expectedSidecarRelativePath(unit: ManifestUnit): string {
  return path.join(
    "visual-transcriptions",
    unit.unit_id,
    `${unit.source_fingerprint}.json`,
  );
}

export function visualTranscriptionSidecarPath(
  stateDir: string,
  unit: Pick<ManifestUnit, "unit_id" | "source_fingerprint">,
): string {
  if (!SHA256_PATTERN.test(unit.unit_id) || !SHA256_PATTERN.test(unit.source_fingerprint)) {
    throw new Error("visual_transcription_unit_identity_invalid");
  }
  return path.join(
    path.resolve(stateDir),
    "visual-transcriptions",
    unit.unit_id,
    `${unit.source_fingerprint}.json`,
  );
}

async function verifyRawSources(manifest: IngestManifest, unit: ManifestUnit): Promise<void> {
  const rootDir = path.resolve(manifest.root_dir);
  const rootRealPath = await realpath(rootDir);
  for (const source of unit.source_files) {
    const expectedPath = path.resolve(rootDir, source.path);
    if (
      !isPathWithin(rootDir, expectedPath)
      || !samePath(source.absolute_path, expectedPath)
    ) {
      throw new Error(`visual_transcription_source_path_mismatch:${source.path}`);
    }
    const sourceRealPath = await realpath(expectedPath);
    if (!isPathWithin(rootRealPath, sourceRealPath) || !samePath(sourceRealPath, expectedPath)) {
      throw new Error(`visual_transcription_source_path_escape:${source.path}`);
    }
    const digest = await sha256File(sourceRealPath);
    if (digest.sha256 !== source.sha256 || digest.bytes !== source.bytes) {
      throw new Error(`visual_transcription_source_changed:${source.path}`);
    }
  }
}

async function verifyConversionArtifacts(
  stateDir: string,
  unit: ManifestUnit,
): Promise<Array<{ path: string; sha256: string; bytes: number; kind: "text" | "image" }>> {
  const conversion = unit.conversion;
  if (!conversion || conversion.source_fingerprint !== unit.source_fingerprint) {
    throw new Error("visual_transcription_conversion_missing_or_stale");
  }
  const unitRoot = path.join(
    path.resolve(stateDir),
    ".converted",
    unit.unit_id,
    unit.source_fingerprint,
  );
  const rawPngPaths = new Set(unit.source_files
    .filter((source) => source.ext === "png")
    .map((source) => path.resolve(source.absolute_path)));
  const artifacts = [
    ...conversion.text_artifacts.map((artifactPath) => ({ path: artifactPath, kind: "text" as const })),
    ...conversion.image_artifacts.map((artifactPath) => ({ path: artifactPath, kind: "image" as const })),
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (artifacts.length === 0) throw new Error("visual_transcription_conversion_artifacts_missing");
  const verified = [] as Array<{
    path: string;
    sha256: string;
    bytes: number;
    kind: "text" | "image";
  }>;
  const fingerprintRecords: string[] = [];
  for (const artifact of artifacts) {
    const resolvedPath = path.resolve(artifact.path);
    const convertedArtifact = isPathWithin(unitRoot, resolvedPath) && !samePath(unitRoot, resolvedPath);
    const rawPngArtifact = artifact.kind === "image" && rawPngPaths.has(resolvedPath);
    if (!convertedArtifact && !rawPngArtifact) {
      throw new Error(`visual_transcription_conversion_artifact_path_escape:${artifact.path}`);
    }
    if (convertedArtifact) {
      await verifyDeterministicStateArtifactPath({
        stateDir,
        artifactPath: resolvedPath,
        expectedRelativePath: path.relative(path.resolve(stateDir), resolvedPath),
      });
    } else {
      const realArtifactPath = await realpath(resolvedPath);
      if (!samePath(realArtifactPath, resolvedPath)) {
        throw new Error(`visual_transcription_conversion_artifact_path_escape:${artifact.path}`);
      }
    }
    const digest = await sha256File(resolvedPath);
    fingerprintRecords.push(`${resolvedPath}\0${digest.sha256}`);
    verified.push({ path: resolvedPath, sha256: digest.sha256, bytes: digest.bytes, kind: artifact.kind });
  }
  if (sha256Text(fingerprintRecords.join("\n")) !== conversion.artifact_fingerprint) {
    throw new Error("visual_transcription_conversion_artifact_changed");
  }
  return verified;
}

function sourceForPageImage(
  stateDir: string,
  unit: ManifestUnit,
  imagePath: string,
  page: number,
): SourceFile {
  const exactPng = unit.source_files.find((source) =>
    source.ext === "png" && samePath(source.absolute_path, imagePath)
  );
  if (exactPng) {
    if (page !== 1) throw new Error("visual_transcription_png_page_mismatch");
    return exactPng;
  }
  const conversionRoot = path.join(
    path.resolve(stateDir),
    ".converted",
    unit.unit_id,
    unit.source_fingerprint,
  );
  const imageRelativePath = path.relative(conversionRoot, imagePath);
  const normalized = imageRelativePath.split(path.sep).join("/");
  const matched = /^(\d+)-pdf-pages\/page-(\d+)\.png$/u.exec(normalized);
  if (!matched) throw new Error("visual_transcription_image_page_locator_invalid");
  const sourceIndex = Number.parseInt(matched[1]!, 10) - 1;
  const locatedPage = Number.parseInt(matched[2]!, 10);
  if (locatedPage !== page) throw new Error("visual_transcription_image_page_mismatch");
  const source = unit.source_files.filter((candidate) => candidate.ext !== "hwp")[sourceIndex];
  if (!source || source.ext !== "pdf") {
    throw new Error("visual_transcription_image_source_mapping_invalid");
  }
  return source;
}

function expectedSourceFiles(unit: ManifestUnit) {
  return unit.source_files.map((source) => ({
    path: source.path,
    sha256: source.sha256,
    bytes: source.bytes,
  }));
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function stateArtifactRelativePath(stateDir: string, artifactPath: string): string {
  const resolvedStateDir = path.resolve(stateDir);
  const resolvedArtifactPath = path.resolve(artifactPath);
  const relativePath = path.relative(resolvedStateDir, resolvedArtifactPath);
  if (
    !isPathWithin(resolvedStateDir, resolvedArtifactPath)
    || samePath(resolvedStateDir, resolvedArtifactPath)
    || path.isAbsolute(relativePath)
  ) {
    throw new Error("visual_transcription_ground_truth_outside_state");
  }
  return relativePath;
}

function migrateExactPageLocator(sourceLocator: string): {
  sourceLocator: string;
  transformed: boolean;
} {
  if (!sourceLocator.startsWith("page:")) {
    return { sourceLocator, transformed: false };
  }
  if (
    sourceLocator !== sourceLocator.trim()
    || sourceLocator !== sourceLocator.normalize("NFKC")
    || sourceLocator.includes("\\")
  ) {
    throw new Error(`visual_transcription_locator_migration_invalid:${sourceLocator}`);
  }
  const matched = /^page:([1-9]\d*)\/(.{1,180})$/u.exec(sourceLocator);
  const segments = matched?.[2]?.split("/") ?? [];
  if (
    !matched
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`visual_transcription_locator_migration_invalid:${sourceLocator}`);
  }
  return {
    sourceLocator: `image:${matched[1]!}/${matched[2]!}`,
    transformed: true,
  };
}

function derivePageToImageOverlay(
  source: z.infer<typeof VisualGroundTruthOverlaySchema>,
): {
  overlay: z.infer<typeof VisualGroundTruthOverlaySchema>;
  transformedLocatorCount: number;
  transformedUnitCount: number;
} {
  let transformedLocatorCount = 0;
  let transformedUnitCount = 0;
  const units = source.units.map((unit) => {
    let unitTransformed = false;
    const migrate = (sourceLocator: string): string => {
      const result = migrateExactPageLocator(sourceLocator);
      if (result.transformed) {
        transformedLocatorCount += 1;
        unitTransformed = true;
      }
      return result.sourceLocator;
    };
    const transformed = {
      ...unit,
      readable_occurrences: unit.readable_occurrences.map((occurrence) => ({
        ...occurrence,
        source_locator: migrate(occurrence.source_locator),
      })),
      unreadable_cells: unit.unreadable_cells.map((cell) => ({
        ...cell,
        source_locator: migrate(cell.source_locator),
      })),
    };
    if (unitTransformed) transformedUnitCount += 1;
    return transformed;
  });
  if (transformedLocatorCount === 0 || transformedUnitCount === 0) {
    throw new Error("visual_transcription_locator_migration_empty");
  }
  return {
    overlay: VisualGroundTruthOverlaySchema.parse({ ...source, units }),
    transformedLocatorCount,
    transformedUnitCount,
  };
}

async function readVerifiedStateJson(options: {
  stateDir: string;
  artifactPath: string;
}): Promise<{
  relativePath: string;
  digest: Awaited<ReturnType<typeof sha256File>>;
  value: unknown;
}> {
  const relativePath = stateArtifactRelativePath(options.stateDir, options.artifactPath);
  await verifyDeterministicStateArtifactPath({
    stateDir: options.stateDir,
    artifactPath: options.artifactPath,
    expectedRelativePath: relativePath,
  });
  return {
    relativePath,
    digest: await sha256File(options.artifactPath),
    value: await readJsonFile(options.artifactPath),
  };
}

export interface CompilePageToImageVisualGroundTruthOverlayOptions {
  stateDir: string;
  sourceOverlayPath: string;
  expectedSourceOverlaySha256: string;
  outputPath: string;
}

/**
 * Produces a reviewable derived artifact by applying exactly one mechanical
 * locator rewrite: canonical `page:N/...` becomes `image:N/...`. Every other
 * field and every other locator protocol is preserved byte-for-value at the
 * parsed JSON data boundary, and import replays this compiler before trust.
 */
export async function compilePageToImageVisualGroundTruthOverlay(
  options: CompilePageToImageVisualGroundTruthOverlayOptions,
): Promise<{ artifactPath: string; artifact: DerivedVisualGroundTruthOverlay }> {
  const stateDir = path.resolve(options.stateDir);
  const sourceOverlayPath = path.resolve(options.sourceOverlayPath);
  const outputPath = path.resolve(options.outputPath);
  const sourceSnapshot = await readVerifiedStateJson({
    stateDir,
    artifactPath: sourceOverlayPath,
  });
  if (sourceSnapshot.digest.sha256 !== options.expectedSourceOverlaySha256) {
    throw new Error("visual_transcription_ground_truth_sha256_mismatch");
  }
  const source = VisualGroundTruthOverlaySchema.safeParse(sourceSnapshot.value);
  if (!source.success) {
    throw new Error("visual_transcription_ground_truth_schema_invalid");
  }
  if (samePath(sourceOverlayPath, outputPath)) {
    throw new Error("visual_transcription_derived_overlay_must_not_replace_source");
  }
  const outputRelativePath = stateArtifactRelativePath(stateDir, outputPath);
  const derived = derivePageToImageOverlay(source.data);
  const candidate = {
    schema_version: 1 as const,
    artifact_kind: "derived_visual_ground_truth_overlay" as const,
    content_sha256: "0".repeat(64),
    source_overlay_relative_path: sourceSnapshot.relativePath.split(path.sep).join("/"),
    source_overlay_sha256: sourceSnapshot.digest.sha256,
    locator_migration: {
      contract_version: "page-to-image-v1" as const,
      transformed_locator_count: derived.transformedLocatorCount,
      transformed_unit_count: derived.transformedUnitCount,
    },
    overlay: derived.overlay,
  };
  candidate.content_sha256 = canonicalJsonSha256ExcludingField(
    candidate,
    "content_sha256",
  );
  const artifact = DerivedVisualGroundTruthOverlaySchema.parse(candidate);
  await prepareDeterministicStateArtifactWritePath({
    stateDir,
    artifactPath: outputPath,
    expectedRelativePath: outputRelativePath,
  });
  await writeJsonFile(outputPath, artifact);
  return { artifactPath: outputPath, artifact };
}

export interface ImportHumanConfirmedVisualGroundTruthOptions {
  stateDir: string;
  overlayPath: string;
  expectedSourceGroundTruthSha256: string;
  expectedDerivedOverlayContentSha256?: string;
  unitId: string;
  approvalReference: string;
}

export async function importHumanConfirmedVisualGroundTruth(
  options: ImportHumanConfirmedVisualGroundTruthOptions,
): Promise<{
  confirmation: z.infer<typeof HumanConfirmationSchema>;
  entry: z.infer<typeof OverlayUnitSchema>;
}> {
  const stateDir = path.resolve(options.stateDir);
  const overlayPath = path.resolve(options.overlayPath);
  const overlaySnapshot = await readVerifiedStateJson({ stateDir, artifactPath: overlayPath });
  let overlay: z.infer<typeof VisualGroundTruthOverlaySchema>;
  let sourceGroundTruthSha256: string;
  let locatorMigration: z.infer<typeof LocatorMigrationConfirmationSchema> | undefined;
  const rawRecord = overlaySnapshot.value && typeof overlaySnapshot.value === "object"
    ? overlaySnapshot.value as Record<string, unknown>
    : null;
  if (rawRecord?.artifact_kind === "derived_visual_ground_truth_overlay") {
    const parsedDerived = DerivedVisualGroundTruthOverlaySchema.safeParse(overlaySnapshot.value);
    if (!parsedDerived.success) {
      throw new Error("visual_transcription_derived_overlay_schema_invalid");
    }
    verifyJsonContentHash(rawRecord, "content_sha256");
    const artifact = parsedDerived.data;
    if (
      !options.expectedDerivedOverlayContentSha256
      || artifact.content_sha256 !== options.expectedDerivedOverlayContentSha256
    ) {
      throw new Error("visual_transcription_derived_overlay_content_sha256_mismatch");
    }
    const sourceOverlayPath = path.join(stateDir, artifact.source_overlay_relative_path);
    const sourceSnapshot = await readVerifiedStateJson({
      stateDir,
      artifactPath: sourceOverlayPath,
    });
    if (
      artifact.source_overlay_relative_path
        !== sourceSnapshot.relativePath.split(path.sep).join("/")
      || sourceSnapshot.digest.sha256 !== artifact.source_overlay_sha256
      || sourceSnapshot.digest.sha256 !== options.expectedSourceGroundTruthSha256
    ) {
      throw new Error("visual_transcription_ground_truth_sha256_mismatch");
    }
    const parsedSource = VisualGroundTruthOverlaySchema.safeParse(sourceSnapshot.value);
    if (!parsedSource.success) {
      throw new Error("visual_transcription_ground_truth_schema_invalid");
    }
    const replayed = derivePageToImageOverlay(parsedSource.data);
    if (
      replayed.transformedLocatorCount
        !== artifact.locator_migration.transformed_locator_count
      || replayed.transformedUnitCount
        !== artifact.locator_migration.transformed_unit_count
      || canonicalSha256(replayed.overlay) !== canonicalSha256(artifact.overlay)
    ) {
      throw new Error("visual_transcription_derived_overlay_mechanical_mismatch");
    }
    overlay = artifact.overlay;
    sourceGroundTruthSha256 = artifact.source_overlay_sha256;
    locatorMigration = {
      contract_version: artifact.locator_migration.contract_version,
      derived_overlay_content_sha256: artifact.content_sha256,
      transformed_locator_count: artifact.locator_migration.transformed_locator_count,
      transformed_unit_count: artifact.locator_migration.transformed_unit_count,
    };
  } else {
    if (options.expectedDerivedOverlayContentSha256) {
      throw new Error("visual_transcription_derived_overlay_expected_but_missing");
    }
    if (overlaySnapshot.digest.sha256 !== options.expectedSourceGroundTruthSha256) {
      throw new Error("visual_transcription_ground_truth_sha256_mismatch");
    }
    const parsed = VisualGroundTruthOverlaySchema.safeParse(overlaySnapshot.value);
    if (!parsed.success) throw new Error("visual_transcription_ground_truth_schema_invalid");
    overlay = parsed.data;
    sourceGroundTruthSha256 = overlaySnapshot.digest.sha256;
  }
  const matching = overlay.units.filter((entry) => entry.unit_id === options.unitId);
  if (matching.length !== 1) {
    throw new Error("visual_transcription_ground_truth_unit_missing_or_duplicated");
  }
  const approvalReference = options.approvalReference.trim();
  if (!approvalReference) throw new Error("visual_transcription_approval_reference_missing");
  const entry = matching[0]!;
  return {
    confirmation: {
      overlay_artifact_relative_path: overlaySnapshot.relativePath.split(path.sep).join("/"),
      source_ground_truth_sha256: sourceGroundTruthSha256,
      overlay_entry_sha256: canonicalSha256(entry),
      approval_reference: approvalReference,
      ...(locatorMigration ? { locator_migration: locatorMigration } : {}),
    },
    entry,
  };
}

function exactMultiset(values: readonly unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = canonicalSha256(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sameExactMultiset(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  const leftCounts = exactMultiset(left);
  const rightCounts = exactMultiset(right);
  if (leftCounts.size !== rightCounts.size) return false;
  return [...leftCounts].every(([key, count]) => rightCounts.get(key) === count);
}

function uniqueEvidenceSourceForLocator(
  sidecar: VisualTranscriptionSidecar,
  locatorValue: string,
  allowedEvidenceIds?: ReadonlySet<string>,
): string {
  const locator = parseCanonicalVisualLocator(locatorValue);
  if (!locator) throw new Error("visual_transcription_human_locator_not_canonical");
  const sources = new Set(sidecar.evidence
    .filter((evidence) => (
      evidence.page === locator.page
      && (!allowedEvidenceIds || allowedEvidenceIds.has(evidence.evidence_id))
    ))
    .map((evidence) => evidence.source_file_id));
  if (sources.size !== 1) {
    throw new Error("visual_transcription_human_locator_source_ambiguous");
  }
  return [...sources][0]!;
}

function structuredAmountsByRecord(
  fragment: VisualTranscriptionFragment,
): Array<{ path: string; amounts: number[] }> {
  const result: Array<{ path: string; amounts: number[] }> = [];
  const add = (recordPath: string, values: readonly (number | null)[]): void => {
    const amounts = [...new Set(values.filter((value): value is number => value !== null))];
    if (amounts.length > 0) result.push({ path: recordPath, amounts });
  };
  fragment.agency_packages.forEach((row, index) => {
    add(`agency_packages[${index}]`, [row.price_min_krw, row.price_max_krw]);
    row.options.forEach((option, optionIndex) => add(
      `agency_packages[${index}].options[${optionIndex}]`,
      [option.price_min_krw, option.price_max_krw],
    ));
  });
  fragment.partner_vendors.forEach((row, index) => {
    add(`partner_vendors[${index}]`, [row.price_min_krw, row.price_max_krw]);
    row.options.forEach((option, optionIndex) => add(
      `partner_vendors[${index}].options[${optionIndex}]`,
      [option.price_min_krw, option.price_max_krw],
    ));
  });
  fragment.halls.forEach((row, index) => {
    add(`halls[${index}]`, [
      row.meal_price_min_krw,
      row.meal_price_max_krw,
      row.venue_fee_min_krw,
      row.venue_fee_max_krw,
      row.decoration_fee_min_krw,
      row.decoration_fee_max_krw,
    ]);
    row.options.forEach((option, optionIndex) => add(
      `halls[${index}].options[${optionIndex}]`,
      [option.price_min_krw, option.price_max_krw],
    ));
  });
  return result;
}

function assertHumanExpectations(
  fragment: VisualTranscriptionFragment,
  expectations: z.infer<typeof OverlayUnitSchema>["expectations"],
  coverageGaps: VisualTranscriptionSidecar["coverage_gaps"],
): void {
  if (!expectations.doc_kinds.includes(fragment.doc_kind)) {
    throw new Error("visual_transcription_human_expectation_miss:doc_kind");
  }
  if (expectations.allowed_partner_categories) {
    const allowed = new Set(expectations.allowed_partner_categories);
    if (fragment.partner_vendors.some((vendor) => !allowed.has(vendor.category))) {
      throw new Error("visual_transcription_human_expectation_miss:category");
    }
  }
  if (
    fragment.doc_kind === "agency_disclosure"
    && fragment.partner_vendors.length === 0
    && fragment.agency_packages.length === 0
  ) {
    throw new Error("visual_transcription_human_expectation_miss:agency_packages");
  }
  const policyCount = fragment.partner_vendors.reduce(
    (sum, vendor) => sum + vendor.policies.length,
    0,
  ) + fragment.sections.filter((section) => (
    section.section_type === "refund_policy" || section.section_type === "penalty"
  )).length;
  if (expectations.policies && policyCount === 0) {
    const policyGap = coverageGaps.some((gap) => (
      /(?:policy|refund|penalty|위약|환불|소비자안내)/iu.test(gap.source_locator)
    ));
    if (!policyGap) throw new Error("visual_transcription_human_expectation_miss:policies");
  }
  if (
    expectations.pricing_basis
    && !fragment.sections.some((section) => section.section_type === "pricing_basis")
  ) {
    throw new Error("visual_transcription_human_expectation_miss:pricing_basis");
  }
  if (expectations.sections && fragment.sections.length === 0) {
    throw new Error("visual_transcription_human_expectation_miss:sections");
  }
  if (fragment.halls.length < expectations.halls_min) {
    throw new Error("visual_transcription_human_expectation_miss:halls");
  }
}

function assertHumanConfirmedFragmentMatchesOverlay(
  sidecar: VisualTranscriptionSidecar,
  entry: z.infer<typeof OverlayUnitSchema>,
): void {
  const bindings = new Map(sidecar.record_evidence.map((binding) => [binding.record_path, binding]));
  const actualOccurrences = sidecar.fragment.money_occurrences.map((occurrence, index) => {
    const binding = bindings.get(`money_occurrences[${index}]`);
    if (!binding || binding.source_locators.length !== 1 || occurrence.source_file_ids.length !== 1) {
      throw new Error("visual_transcription_human_money_occurrence_binding_invalid");
    }
    const sourceFileIdValue = uniqueEvidenceSourceForLocator(
      sidecar,
      binding.source_locators[0]!,
      new Set(binding.evidence_ids),
    );
    return {
      krw: occurrence.amount_krw,
      raw: occurrence.raw_text,
      source_locator: binding.source_locators[0]!,
      source_file_id: occurrence.source_file_ids[0]!,
      locator_source_file_id: sourceFileIdValue,
    };
  });
  if (actualOccurrences.some((occurrence) => (
    occurrence.source_file_id !== occurrence.locator_source_file_id
  ))) {
    throw new Error("visual_transcription_human_money_occurrence_source_mismatch");
  }
  const expectedOccurrences = entry.readable_occurrences.map((occurrence) => ({
    krw: occurrence.krw,
    raw: occurrence.raw,
    source_locator: occurrence.source_locator,
    source_file_id: uniqueEvidenceSourceForLocator(sidecar, occurrence.source_locator),
    locator_source_file_id: uniqueEvidenceSourceForLocator(sidecar, occurrence.source_locator),
  }));
  if (!sameExactMultiset(actualOccurrences, expectedOccurrences)) {
    throw new Error("visual_transcription_human_money_occurrence_mismatch");
  }

  const occurrencesByLocator = new Map<string, Set<number>>();
  for (const occurrence of entry.readable_occurrences) {
    const amounts = occurrencesByLocator.get(occurrence.source_locator) ?? new Set<number>();
    amounts.add(occurrence.krw);
    occurrencesByLocator.set(occurrence.source_locator, amounts);
  }
  for (const record of structuredAmountsByRecord(sidecar.fragment)) {
    const binding = bindings.get(record.path);
    if (!binding) throw new Error("visual_transcription_human_structured_amount_binding_missing");
    const allowedEvidenceIds = new Set(binding.evidence_ids);
    for (const locator of binding.source_locators) {
      uniqueEvidenceSourceForLocator(sidecar, locator, allowedEvidenceIds);
    }
    if (record.amounts.some((amount) => !binding.source_locators.some((locator) => (
      occurrencesByLocator.get(locator)?.has(amount) === true
    )))) {
      throw new Error("visual_transcription_human_structured_amount_not_grounded");
    }
  }

  const actualGaps = sidecar.coverage_gaps.map((gap) => {
    const evidence = sidecar.evidence.find((candidate) => candidate.evidence_id === gap.evidence_id);
    if (!evidence) throw new Error("visual_transcription_human_coverage_gap_binding_invalid");
    const sourceFileIdValue = uniqueEvidenceSourceForLocator(
      sidecar,
      gap.source_locator,
      new Set([gap.evidence_id]),
    );
    return {
      source_locator: gap.source_locator,
      visible_amounts_krw: gap.visible_amounts_krw,
      estimated_content: gap.estimated_content,
      reason: gap.reason,
      source_file_id: sourceFileIdValue,
    };
  });
  const expectedGaps = entry.unreadable_cells.map((gap) => ({
    source_locator: gap.source_locator,
    visible_amounts_krw: gap.visible_amounts_krw,
    estimated_content: gap.estimated_content,
    reason: gap.reason,
    source_file_id: uniqueEvidenceSourceForLocator(sidecar, gap.source_locator),
  }));
  const expectedGapKeys = exactMultiset(expectedGaps);
  const actualOverlayGaps = actualGaps.filter((gap) => {
    const key = canonicalSha256(gap);
    const remaining = expectedGapKeys.get(key) ?? 0;
    if (remaining === 0) return false;
    if (remaining === 1) expectedGapKeys.delete(key);
    else expectedGapKeys.set(key, remaining - 1);
    return true;
  });
  if (!sameExactMultiset(actualOverlayGaps, expectedGaps)) {
    throw new Error("visual_transcription_human_coverage_gaps_mismatch");
  }
  const readableAmountsByLocator = new Map<string, Set<number>>();
  for (const occurrence of entry.readable_occurrences) {
    const amounts = readableAmountsByLocator.get(occurrence.source_locator) ?? new Set<number>();
    amounts.add(occurrence.krw);
    readableAmountsByLocator.set(occurrence.source_locator, amounts);
  }
  for (const gap of actualGaps) {
    if (expectedGaps.some((expected) => canonicalSha256(expected) === canonicalSha256(gap))) continue;
    if (gap.visible_amounts_krw.some((amount) => (
      readableAmountsByLocator.get(gap.source_locator)?.has(amount) !== true
    ))) {
      throw new Error("visual_transcription_human_coverage_gap_not_grounded");
    }
  }
  assertHumanExpectations(sidecar.fragment, entry.expectations, sidecar.coverage_gaps);
}

export async function loadVisualTranscriptionSidecar(
  options: LoadVisualTranscriptionSidecarOptions,
): Promise<LoadedVisualTranscriptionSidecar | null> {
  const stateDir = path.resolve(options.stateDir);
  if (!samePath(stateDir, options.manifest.state_dir)) {
    throw new Error("visual_transcription_state_manifest_mismatch");
  }
  const unit = options.manifest.units.find((candidate) => candidate.unit_id === options.unitId);
  if (!unit) throw new Error(`visual_transcription_unknown_unit:${options.unitId}`);
  const artifactPath = visualTranscriptionSidecarPath(stateDir, unit);
  try {
    await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath,
      expectedRelativePath: expectedSidecarRelativePath(unit),
    });
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  const digest = await sha256File(artifactPath);
  if (digest.bytes > MAX_SIDECAR_BYTES) throw new Error("visual_transcription_sidecar_too_large");
  const raw = await readJsonFile(artifactPath);
  const parsed = VisualTranscriptionSidecarSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`visual_transcription_sidecar_schema_invalid:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
  const sidecar = parsed.data;
  const conversion = unit.conversion;
  if (
    !conversion
    || sidecar.unit_id !== unit.unit_id
    || sidecar.source_fingerprint !== unit.source_fingerprint
    || sidecar.conversion_artifact_fingerprint !== conversion.artifact_fingerprint
    || JSON.stringify(sidecar.source_files) !== JSON.stringify(expectedSourceFiles(unit))
  ) {
    throw new Error("visual_transcription_sidecar_provenance_mismatch");
  }
  await verifyRawSources(options.manifest, unit);
  const conversionArtifacts = await verifyConversionArtifacts(stateDir, unit);
  for (const evidence of sidecar.evidence) {
    const imageArtifactPath = conversion.image_artifacts[evidence.image_artifact_index];
    if (!imageArtifactPath) throw new Error("visual_transcription_image_artifact_index_invalid");
    const verifiedImage = conversionArtifacts.find((artifact) =>
      artifact.kind === "image" && samePath(artifact.path, imageArtifactPath)
    );
    if (
      !verifiedImage
      || verifiedImage.sha256 !== evidence.image_sha256
      || verifiedImage.bytes !== evidence.image_bytes
    ) {
      throw new Error("visual_transcription_page_image_changed");
    }
    const source = sourceForPageImage(stateDir, unit, verifiedImage.path, evidence.page);
    if (
      sourceFileId(source) !== evidence.source_file_id
      || source.sha256 !== evidence.source_sha256
      || source.bytes !== evidence.source_bytes
    ) {
      throw new Error("visual_transcription_page_source_mismatch");
    }
  }
  if (sidecar.reviewer.kind === "human_confirmed") {
    const imported = await importHumanConfirmedVisualGroundTruth({
      stateDir,
      overlayPath: path.join(
        stateDir,
        sidecar.reviewer.confirmation.overlay_artifact_relative_path,
      ),
      expectedSourceGroundTruthSha256:
        sidecar.reviewer.confirmation.source_ground_truth_sha256,
      ...(sidecar.reviewer.confirmation.locator_migration
        ? {
            expectedDerivedOverlayContentSha256:
              sidecar.reviewer.confirmation.locator_migration
                .derived_overlay_content_sha256,
          }
        : {}),
      unitId: unit.unit_id,
      approvalReference: sidecar.reviewer.confirmation.approval_reference,
    });
    if (
      canonicalSha256(imported.confirmation)
        !== canonicalSha256(sidecar.reviewer.confirmation)
    ) {
      throw new Error("visual_transcription_ground_truth_entry_mismatch");
    }
    assertHumanConfirmedFragmentMatchesOverlay(sidecar, imported.entry);
    assertHumanApprovedTextBindings(sidecar);
  }
  const issueCode = sidecar.reviewer.kind === "codex_assisted_unconfirmed"
    ? VISUAL_TRANSCRIPTION_HUMAN_CONFIRMATION_ISSUE
    : VISUAL_TRANSCRIPTION_HUMAN_REVIEW_ISSUE;
  return {
    ...sidecar,
    validation_issue_codes: [issueCode],
    evidence: sidecar.evidence.map((evidence) => ({
      ...evidence,
      page_locator: `image:sha256:${evidence.image_sha256}:page:${evidence.page}`,
    })),
  };
}

function forceFragmentReviewOnly(
  fragment: VisualTranscriptionFragment,
  reviewerKind: VisualTranscriptionSidecar["reviewer"]["kind"],
): VisualTranscriptionFragment {
  const result = VisualTranscriptionFragmentSchema.parse(structuredClone(fragment));
  const confidenceCeiling = reviewerKind === "codex_assisted_unconfirmed" ? 0.5 : 0.89;
  for (const row of result.agency_packages) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, confidenceCeiling);
  }
  for (const row of result.partner_vendors) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, confidenceCeiling);
  }
  for (const row of result.halls) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, confidenceCeiling);
  }
  for (const row of result.sections) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, confidenceCeiling);
  }
  for (const row of result.money_occurrences) row.needs_review = true;
  return result;
}

export interface VisualTranscriptionMergeResult {
  data: ReturnType<typeof DisclosureExtractionSchema.parse>;
  review_status: "pending";
  needs_review: true;
  bulk_approval_eligible: false;
  publish_allowed: false;
  validation_issue_codes: LoadedVisualTranscriptionSidecar["validation_issue_codes"];
  evidence: LoadedVisualTranscriptionSidecar["evidence"];
  coverage_gaps: LoadedVisualTranscriptionSidecar["coverage_gaps"];
}

export function mergeVisualTranscriptionSidecar(
  baseData: DisclosureExtraction,
  sidecar: LoadedVisualTranscriptionSidecar,
): VisualTranscriptionMergeResult {
  const data = DisclosureExtractionSchema.parse(structuredClone(baseData));
  const fragment = forceFragmentReviewOnly(sidecar.fragment, sidecar.reviewer.kind);
  if (fragment.business_name && (
    sidecar.reviewer.kind === "human_confirmed" || data.business_name === null
  )) {
    data.business_name = fragment.business_name;
  }
  if (fragment.region_hint && data.region_hint === null) data.region_hint = fragment.region_hint;
  if (data.doc_kind === "unknown") data.doc_kind = fragment.doc_kind;
  else if (data.doc_kind !== fragment.doc_kind) data.doc_kind = "mixed";
  data.agency_packages.push(...fragment.agency_packages);
  data.partner_vendors.push(...fragment.partner_vendors);
  data.halls.push(...fragment.halls);
  data.sections.push(...fragment.sections);
  data.money_occurrences.push(...fragment.money_occurrences);
  data.extraction_notes = [
    "[visual_transcription_pending_review]",
    data.extraction_notes,
  ].filter(Boolean).join("\n").slice(0, 4_000);
  return {
    data: DisclosureExtractionSchema.parse(data),
    review_status: "pending",
    needs_review: true,
    bulk_approval_eligible: false,
    publish_allowed: false,
    validation_issue_codes: [...sidecar.validation_issue_codes],
    evidence: structuredClone(sidecar.evidence),
    coverage_gaps: structuredClone(sidecar.coverage_gaps),
  };
}
