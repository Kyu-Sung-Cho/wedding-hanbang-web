import { SOURCE_MONEY_SCANNER_VERSION } from "./extraction-contract.js";
import { sha256Text } from "./io.js";

export const LOCAL_DETERMINISTIC_PROVIDER_MODE = "local_deterministic" as const;
export const LOCAL_DETERMINISTIC_MODEL = "local-deterministic-v1" as const;
export const LOCAL_DETERMINISTIC_ENGINE_VERSION =
  "v51-bounded-long-row-evidence";
export const LOCAL_DETERMINISTIC_ENGINE_HASH = sha256Text([
  LOCAL_DETERMINISTIC_MODEL,
  LOCAL_DETERMINISTIC_ENGINE_VERSION,
  SOURCE_MONEY_SCANNER_VERSION,
  "no-network",
  "no-provider",
  "pending-only",
].join("\0"));

export interface LocalExtractionFingerprintInput {
  scannerParserVersion: string;
  converterVersion: string;
  rawName: string;
  regionCode: string;
  kindHint: "agency" | "hall";
  sourceFingerprint: string;
  artifactFingerprint: string;
}

export function currentLocalExtractionFingerprint(
  input: LocalExtractionFingerprintInput,
): string {
  return sha256Text([
    LOCAL_DETERMINISTIC_PROVIDER_MODE,
    LOCAL_DETERMINISTIC_MODEL,
    LOCAL_DETERMINISTIC_ENGINE_VERSION,
    LOCAL_DETERMINISTIC_ENGINE_HASH,
    input.scannerParserVersion,
    input.converterVersion,
    input.rawName,
    input.regionCode,
    input.kindHint,
    input.sourceFingerprint,
    input.artifactFingerprint,
  ].join("\0"));
}
