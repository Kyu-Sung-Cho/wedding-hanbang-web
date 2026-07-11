import { createHash } from "node:crypto";

const HASH_NAMESPACE = "amora-openai-safety-v1";

/** OpenAI에 내부 사용자 식별자를 직접 보내지 않는 64자 고정 해시. */
export function createSafetyIdentifier(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return createHash("sha256")
    .update(`${HASH_NAMESPACE}:${normalized}`, "utf8")
    .digest("hex");
}
