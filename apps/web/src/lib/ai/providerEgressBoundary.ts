import { createHash } from "node:crypto";

export type ProviderEgressOperation =
  | "responses.input_tokens.count"
  | "responses.create";

export interface ProviderEgressAuthorizationRequest {
  operation: ProviderEgressOperation;
  /** SHA-256 only. Raw provider content must never enter the grant ledger. */
  contentBinding: string;
}
export type ProviderEgressAuthorizer = (
  request: ProviderEgressAuthorizationRequest,
) => void | Promise<void>;

/**
 * Binds an authorization to the exact JSON payload handed to the provider SDK.
 * The domain separator prevents a count grant from authorizing generation even
 * if a future SDK happened to serialize both request bodies identically.
 */
export function bindProviderEgressContent(
  operation: ProviderEgressOperation,
  payload: unknown,
): string {
  const serialized = JSON.stringify(payload);
  if (typeof serialized !== "string") {
    throw new Error("[ai-egress] provider payload is not JSON serializable");
  }
  return createHash("sha256")
    .update("amora-provider-egress:v1\0", "utf8")
    .update(operation, "utf8")
    .update("\0", "utf8")
    .update(serialized, "utf8")
    .digest("hex");
}
