import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const INGEST_STATE_ROOT = path.join("scripts", "ingest", ".state");

export function resolveIngestStateDirectory(
  configuredDirectory: string | undefined,
  repositoryRoot = process.cwd(),
): string {
  const stateRoot = path.resolve(repositoryRoot, INGEST_STATE_ROOT);
  const candidate = configuredDirectory?.trim()
    ? path.isAbsolute(configuredDirectory)
      ? path.resolve(configuredDirectory)
      : path.resolve(stateRoot, configuredDirectory)
    : path.join(stateRoot, "default");
  const relative = path.relative(stateRoot, candidate);
  if (
    relative === ""
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(
      "Ingest state directory must be a child directory under the ignored state root scripts/ingest/.state/.",
    );
  }
  return candidate;
}

export async function sha256File(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  const fileStat = await stat(filePath);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return {
    sha256: hash.digest("hex"),
    bytes: fileStat.size,
  };
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export function toPortableRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

export function isPathWithin(parentDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function assertGeneratedStateOutsideRaw(rootDir: string, stateDir: string): void {
  if (isPathWithin(rootDir, stateDir)) {
    throw new Error("Generated state must remain outside the immutable raw source root.");
  }
}
