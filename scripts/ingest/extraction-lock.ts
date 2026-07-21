import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

interface ExtractionLockMetadata {
  schema_version: 1;
  lock_id: string;
  pid: number;
  hostname: string;
  started_at: string;
  state_dir: string;
}

function parseExtractionLockMetadata(value: unknown): ExtractionLockMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExtractionLockMetadata>;
  if (
    candidate.schema_version !== 1
    || typeof candidate.lock_id !== "string"
    || !candidate.lock_id
    || !Number.isSafeInteger(candidate.pid)
    || (candidate.pid ?? 0) < 1
    || typeof candidate.hostname !== "string"
    || !candidate.hostname
    || typeof candidate.started_at !== "string"
    || !Number.isFinite(Date.parse(candidate.started_at))
    || typeof candidate.state_dir !== "string"
    || !candidate.state_dir
  ) {
    return null;
  }
  return candidate as ExtractionLockMetadata;
}

function isLocalProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true;
    return false;
  }
}

async function readExtractionLock(lockPath: string): Promise<ExtractionLockMetadata> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    throw new Error(`extract_lock_invalid: inspect ${lockPath} before manual recovery`);
  }
  const metadata = parseExtractionLockMetadata(parsed);
  if (!metadata) {
    throw new Error(`extract_lock_invalid: inspect ${lockPath} before manual recovery`);
  }
  return metadata;
}

/**
 * Serializes every extraction mode that can write or derive state-bound
 * artifacts. Stale locks require explicit inspection instead of unsafe
 * automatic deletion.
 */
export async function acquireExtractionLock(stateDir: string): Promise<() => Promise<void>> {
  const resolvedStateDirectory = path.resolve(stateDir);
  const lockDirectory = path.join(resolvedStateDirectory, ".cache", "locks");
  const lockPath = path.join(lockDirectory, "extract.lock");
  await mkdir(lockDirectory, { recursive: true });
  const metadata: ExtractionLockMetadata = {
    schema_version: 1,
    lock_id: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    started_at: new Date().toISOString(),
    state_dir: resolvedStateDirectory,
  };
  const temporaryLockPath = `${lockPath}.${process.pid}.${metadata.lock_id}.tmp`;
  const lockHandle = await open(temporaryLockPath, "wx", 0o600);
  try {
    await lockHandle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await lockHandle.sync();
  } catch (error) {
    await lockHandle.close().catch(() => undefined);
    await unlink(temporaryLockPath).catch(() => undefined);
    throw error;
  }
  await lockHandle.close();
  try {
    await link(temporaryLockPath, lockPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      await unlink(temporaryLockPath).catch(() => undefined);
      throw error;
    }
    await unlink(temporaryLockPath).catch(() => undefined);
    const owner = await readExtractionLock(lockPath);
    if (path.resolve(owner.state_dir) !== resolvedStateDirectory) {
      throw new Error(`extract_lock_state_mismatch: inspect ${lockPath} before manual recovery`);
    }
    if (owner.hostname === hostname() && !isLocalProcessAlive(owner.pid)) {
      throw new Error(
        `extract_lock_stale_local_pid: pid=${owner.pid} started_at=${owner.started_at}; inspect ${lockPath} before manual recovery`,
      );
    }
    throw new Error(
      `extract_lock_active: pid=${owner.pid} host=${owner.hostname} started_at=${owner.started_at}`,
    );
  }
  try {
    await unlink(temporaryLockPath);
  } catch (error) {
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    let current: ExtractionLockMetadata;
    try {
      current = await readExtractionLock(lockPath);
    } catch (error) {
      throw new Error(
        `extract_lock_ownership_lost: ${error instanceof Error ? error.message : "lock unavailable"}`,
      );
    }
    if (current.lock_id !== metadata.lock_id) {
      throw new Error("extract_lock_ownership_lost: lock owner changed before release");
    }
    await unlink(lockPath);
    released = true;
  };
}
