import { zodTextFormat } from "openai/helpers/zod";

import { sha256Text } from "./io.js";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_PROMPT_VERSION } from "./prompt.js";
import { DisclosureExtractionSchema } from "./schemas.js";

export { EXTRACTION_PROMPT_VERSION };

export const ALLOWED_EXTRACTION_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
export type ExtractionModel = (typeof ALLOWED_EXTRACTION_MODELS)[number];

export const SOURCE_MONEY_SCANNER_VERSION = "v8-compound-contextual-unit-money-scanner";
export const EXTRACTION_REQUEST_FORMAT_VERSION =
  "v7.8.0-deterministic-line-cell-source-repair-attested-bytes-and-attempt-hashes";
export const EXTRACTION_MERGE_VERSION = "v4-normalized-conflict-safe-merged-evidence";
export const EXTRACTION_RESPONSE_FORMAT = zodTextFormat(
  DisclosureExtractionSchema,
  "vendor_disclosure_v2",
);
export const EXTRACTION_SCHEMA_HASH = sha256Text(JSON.stringify(EXTRACTION_RESPONSE_FORMAT));
export const EXTRACTION_PROCESSING_VERSION = sha256Text([
  SOURCE_MONEY_SCANNER_VERSION,
  EXTRACTION_SCHEMA_HASH,
  EXTRACTION_MERGE_VERSION,
].join("\0"));
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
