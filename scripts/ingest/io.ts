import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

const INGEST_STATE_ROOT = path.join("scripts", "ingest", ".state");
const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EPERM",
  "EINVAL",
  "ENOTSUP",
  "ENOSYS",
]);

export type DirectoryMetadataSyncOutcome = "synced" | "unsupported";

/**
 * Windows does not consistently expose directory fsync through Node. We still
 * attempt it, and ignore only the documented unsupported-operation shapes from
 * the sync call itself. Opening the directory and every other error remain
 * fail-closed. POSIX platforms never suppress a directory sync failure.
 */
export function isUnsupportedDirectoryMetadataSyncError(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32"
    && error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES.has(error.code);
}

export async function syncDirectoryMetadata(
  directoryPath: string,
): Promise<DirectoryMetadataSyncOutcome> {
  // Do not suppress an open failure: even on Windows it can mean a missing or
  // inaccessible directory rather than an unsupported directory fsync.
  const directoryHandle = await open(directoryPath, "r");
  try {
    try {
      await directoryHandle.sync();
      return "synced";
    } catch (error) {
      if (isUnsupportedDirectoryMetadataSyncError(error)) return "unsupported";
      throw error;
    }
  } finally {
    await directoryHandle.close();
  }
}

/**
 * Recursively creates a directory and fsyncs the parent of every directory
 * that Node reports as newly created. This preserves the complete path, not
 * only files later written into its deepest directory, across a crash.
 */
export async function mkdirDurably(directoryPath: string): Promise<void> {
  const resolvedDirectory = path.resolve(directoryPath);
  // Windows may return an extended-length (`\\?\`) path from recursive mkdir;
  // compare like with like so a valid child is not mistaken for an escape.
  const durableDirectoryPath = process.platform === "win32"
    ? path.toNamespacedPath(resolvedDirectory)
    : resolvedDirectory;
  const firstCreatedDirectory = await mkdir(durableDirectoryPath, { recursive: true });
  if (firstCreatedDirectory === undefined) return;

  const resolvedFirstCreated = path.resolve(firstCreatedDirectory);
  const remaining = path.relative(resolvedFirstCreated, durableDirectoryPath);
  if (
    remaining === ".."
    || remaining.startsWith(`..${path.sep}`)
    || path.isAbsolute(remaining)
  ) {
    throw new Error("recursive mkdir returned a created path outside the requested directory");
  }

  let currentDirectory = resolvedFirstCreated;
  await syncDirectoryMetadata(path.dirname(currentDirectory));
  for (const segment of remaining.split(path.sep).filter(Boolean)) {
    currentDirectory = path.join(currentDirectory, segment);
    await syncDirectoryMetadata(path.dirname(currentDirectory));
  }
}

export async function unlinkFileDurably(filePath: string): Promise<void> {
  await unlink(filePath);
  await syncDirectoryMetadata(path.dirname(filePath));
}

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
  await mkdirDurably(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
  await syncDirectoryMetadata(path.dirname(filePath));
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
