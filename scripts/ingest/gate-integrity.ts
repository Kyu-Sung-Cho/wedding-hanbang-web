import { createHash, randomUUID } from "node:crypto";
import { link, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";

import { isPathWithin, mkdirDurably, syncDirectoryMetadata } from "./io.js";

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON does not support non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function writeContentAddressedJsonNoOverwrite(
  stateDir: string,
  subdirectory: string,
  fileName: string,
  value: unknown,
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9.-]*\.json$/u.test(fileName)) {
    throw new Error("content-addressed journal filename is invalid");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(subdirectory)) {
    throw new Error("content-addressed journal subdirectory is invalid");
  }
  const resolvedStateDir = path.resolve(stateDir);
  await mkdirDurably(resolvedStateDir);
  const realStateDir = await realpath(resolvedStateDir);
  const requestedOutputDirectory = path.join(resolvedStateDir, subdirectory);
  if (!isPathWithin(resolvedStateDir, requestedOutputDirectory)) {
    throw new Error("content-addressed journal path escapes state directory");
  }
  await mkdirDurably(requestedOutputDirectory);
  const outputDirectory = await realpath(requestedOutputDirectory);
  if (!isPathWithin(realStateDir, outputDirectory) || outputDirectory === realStateDir) {
    throw new Error("content-addressed journal directory resolves outside state directory");
  }
  const outputPath = path.join(outputDirectory, fileName);
  const temporaryPath = path.join(outputDirectory, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    // Hard-link publication is atomic and refuses an existing content-addressed name.
    await link(temporaryPath, outputPath);
    await syncDirectoryMetadata(outputDirectory);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return outputPath;
}
