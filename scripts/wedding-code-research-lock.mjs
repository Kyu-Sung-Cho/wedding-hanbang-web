import { randomUUID } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const weddingCodeResearchLockPath = path.resolve(
  scriptDirectory,
  "../apps/web/.wedding-code-research.lock"
);

async function readOwnerSnapshot(lockPath) {
  try {
    const raw = await readFile(lockPath, "utf8");
    return { raw, owner: JSON.parse(raw) };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { raw: null, owner: null };
  }
}

async function removeIfSnapshotMatches(lockPath, expectedRaw) {
  const current = await readOwnerSnapshot(lockPath);
  if (!current || current.raw === null || current.raw !== expectedRaw) return false;
  await rm(lockPath, { force: true });
  return true;
}

export function createWeddingCodeResearchLock({
  lockPath = weddingCodeResearchLockPath,
  ownerPid = process.pid,
  nonceFactory = randomUUID,
} = {}) {
  async function acquire(mode) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const snapshot = await readOwnerSnapshot(lockPath);
      const owner = snapshot?.owner;
      const ownerDescription = Number.isInteger(owner?.pid) && owner.pid > 0
        ? ` Owner PID: ${owner.pid}.`
        : " Owner metadata is missing or malformed.";
      throw new Error(
        `WeddingCode research/build lock is active at ${lockPath}.${ownerDescription} ` +
          "Stop every web dev/research/build process first. Automatic stale-lock deletion is disabled; " +
          "only then remove the lock manually and retry."
      );
    }

    const owner = {
      mode,
      pid: ownerPid,
      nonce: nonceFactory(),
      startedAt: new Date().toISOString(),
    };
    const ownerRaw = `${JSON.stringify(owner)}\n`;
    try {
      await handle.writeFile(ownerRaw, "utf8");
    } catch (error) {
      await handle.close().catch(() => undefined);
      await removeIfSnapshotMatches(lockPath, ownerRaw).catch(() => undefined);
      throw error;
    }

    let releasePromise;
    return async () => {
      releasePromise ??= (async () => {
        await handle.close().catch(() => undefined);
        await removeIfSnapshotMatches(lockPath, ownerRaw);
      })();
      try {
        await releasePromise;
      } catch (error) {
        releasePromise = undefined;
        throw error;
      }
    };
  }

  return { acquire };
}

const defaultWeddingCodeResearchLock = createWeddingCodeResearchLock();

export async function acquireWeddingCodeResearchLock(mode) {
  return defaultWeddingCodeResearchLock.acquire(mode);
}
