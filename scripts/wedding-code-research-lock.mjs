import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const weddingCodeResearchLockPath = path.resolve(
  scriptDirectory,
  "../apps/web/.wedding-code-research.lock"
);

async function existingOwnerIsAlive() {
  try {
    const owner = JSON.parse(await readFile(weddingCodeResearchLockPath, "utf8"));
    if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return true;
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      return true;
    }
  } catch {
    return true;
  }
}

export async function acquireWeddingCodeResearchLock(mode) {
  let handle;
  try {
    handle = await open(weddingCodeResearchLockPath, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (!(await existingOwnerIsAlive())) {
      await rm(weddingCodeResearchLockPath, { force: true });
      handle = await open(weddingCodeResearchLockPath, "wx");
    } else {
      throw new Error(
        `WeddingCode research/build lock is active at ${weddingCodeResearchLockPath}. ` +
          "Stop the web dev/research server or wait for the production build to finish."
      );
    }
  }

  await handle.writeFile(
    JSON.stringify({ mode, pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
    "utf8"
  );

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close().catch(() => undefined);
    await rm(weddingCodeResearchLockPath, { force: true });
  };
}
