import { sha256Text } from "./io.js";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_PROMPT_VERSION } from "./prompt.js";

export { EXTRACTION_PROMPT_VERSION };

export const ALLOWED_EXTRACTION_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
export type ExtractionModel = (typeof ALLOWED_EXTRACTION_MODELS)[number];

export const SOURCE_MONEY_SCANNER_VERSION = "v18-pdf-layout-money-evidence";
// Paid request/checkpoint identity was authorized with the v9 scanner. Source
// money scanning happens only during deterministic finalization, not in the
// provider request, so evolving that scanner belongs to the separately
// replayed finalization contract. Keeping the authorized request identity
// pinned also lets the known v9 transitional finalizer be verified without
// ever admitting it for an unrelated paid plan.
const PAID_EXTRACTION_REQUEST_SOURCE_MONEY_SCANNER_VERSION =
  "v9-xlsx-auxiliary-locator-money-scanner";
export const EXTRACTION_REQUEST_FORMAT_VERSION =
  "v7.9.0-deterministic-line-cell-aux-source-repair-attested-bytes-and-attempt-hashes";
export const EXTRACTION_MERGE_VERSION =
  "v5-normalized-conflict-safe-merged-evidence-local-guard";
/**
 * Pinned from the provider-specific response format. That module asserts this
 * digest at load time; keeping the digest here leaves local ingestion free of
 * every OpenAI package import.
 */
export const EXTRACTION_SCHEMA_HASH =
  "dd5cddb680d3c97ee4e83108241035307300625bd92d146b5811abca0639fea5" as const;
export const EXTRACTION_PROCESSING_VERSION = sha256Text([
  PAID_EXTRACTION_REQUEST_SOURCE_MONEY_SCANNER_VERSION,
  EXTRACTION_SCHEMA_HASH,
  EXTRACTION_MERGE_VERSION,
].join("\0"));

/**
 * Request/checkpoint identity and final-cache replay are separate contracts.
 * `EXTRACTION_PROCESSING_VERSION` remains the immutable identity that was
 * authorized and paid for. A finalizer compatibility path must never rewrite
 * that request identity or silently pretend to be the current finalizer.
 */
export const EXTRACTION_REQUEST_PROCESSING_VERSION = EXTRACTION_PROCESSING_VERSION;
export const CURRENT_EXTRACTION_FINALIZATION_CONTRACT =
  "v7-guard-first-dotted-thousands-wedding-option-columns" as const;
export const LEGACY_TRANSITIONAL_EXTRACTION_FINALIZATION_CONTRACT =
  "legacy-e258-precommit-note-order-v9-money" as const;
export const LEGACY_TRANSITIONAL_EXTRACTION_PROCESSING_VERSION =
  "e258c99053e76c701dd39e61ef20c71b140f6905a6b06bac19f8a9ff0fafab0e" as const;
export const LEGACY_TRANSITIONAL_EXTRACTION_PROMPT_HASH =
  "a8cde85852e3d86fc586e33fdc204a7552ca330d703887e8ac646f7336cb215a" as const;
export const LEGACY_TRANSITIONAL_EXTRACTION_PROMPT_VERSION =
  "v7.11-exact-xlsx-auxiliary-repair" as const;
export const EXTRACTION_PROMPT_HASH = sha256Text(
  `${EXTRACTION_INSTRUCTIONS}\0${EXTRACTION_REQUEST_FORMAT_VERSION}\0${EXTRACTION_PROCESSING_VERSION}`,
);

export interface ExtractionFingerprintInput {
  scannerParserVersion: string;
  converterVersion: string;
  model: ExtractionModel;
  rawName: string;
  regionCode: string;
  kindHint: "agency" | "hall";
  sourceFingerprint: string;
  artifactFingerprint: string;
}

export function currentExtractionFingerprint(input: ExtractionFingerprintInput): string {
  return sha256Text([
    EXTRACTION_PROMPT_VERSION,
    EXTRACTION_PROMPT_HASH,
    EXTRACTION_PROCESSING_VERSION,
    input.scannerParserVersion,
    input.converterVersion,
    input.model,
    input.rawName,
    input.regionCode,
    input.kindHint,
    input.sourceFingerprint,
    input.artifactFingerprint,
  ].join("\0"));
}
