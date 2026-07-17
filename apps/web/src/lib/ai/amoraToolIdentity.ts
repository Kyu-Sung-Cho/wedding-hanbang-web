import { createHash } from "node:crypto";

export interface AmoraToolOperationIdentity {
  canonicalInput: string;
  inputDigest: string;
  operationKey: string;
}

export function canonicalAmoraToolInput(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite tool input");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalAmoraToolInput(item ?? null)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalAmoraToolInput(item)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported tool input value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function getAmoraToolOperationIdentity(
  toolName: string,
  toolInput: Record<string, unknown>,
): AmoraToolOperationIdentity {
  const canonicalInput = canonicalAmoraToolInput(toolInput);
  return {
    canonicalInput,
    inputDigest: sha256(canonicalInput),
    operationKey: sha256(`${toolName}\n${canonicalInput}`),
  };
}
