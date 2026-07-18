import path from "node:path";

import { readJsonFile, writeJsonFile } from "./io.js";
import { IngestManifestSchema } from "./schemas.js";
import type { IngestManifest } from "./types.js";

export function manifestPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), "manifest.json");
}

export async function loadManifest(stateDir: string): Promise<IngestManifest> {
  const parsed = IngestManifestSchema.safeParse(await readJsonFile(manifestPath(stateDir)));
  if (!parsed.success) {
    throw new Error(`manifest.json 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  const requestedStateDirectory = path.resolve(stateDir);
  if (path.resolve(parsed.data.state_dir) !== requestedStateDirectory) {
    throw new Error("manifest state_dir does not match the requested state directory.");
  }
  return parsed.data;
}

export async function saveManifest(manifest: IngestManifest): Promise<void> {
  await writeJsonFile(manifestPath(manifest.state_dir), manifest);
}
