import { zodTextFormat } from "openai/helpers/zod";

import { EXTRACTION_SCHEMA_HASH } from "./extraction-contract.js";
import { sha256Text } from "./io.js";
import { DisclosureExtractionSchema } from "./schemas.js";

export const EXTRACTION_RESPONSE_FORMAT = zodTextFormat(
  DisclosureExtractionSchema,
  "vendor_disclosure_v2",
);

if (sha256Text(JSON.stringify(EXTRACTION_RESPONSE_FORMAT)) !== EXTRACTION_SCHEMA_HASH) {
  throw new Error("openai_extraction_response_format_hash_mismatch");
}
