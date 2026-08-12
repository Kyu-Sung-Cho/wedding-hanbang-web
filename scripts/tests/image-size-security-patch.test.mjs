import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function resolveInstalledFile(relativePath) {
  const pnpmStore = join(root, "node_modules", ".pnpm");
  const entries = (await readdir(pnpmStore)).filter((entry) =>
    entry.startsWith("metro@"),
  );
  assert.ok(entries.length > 0, "Metro must be installed");

  // Resolve through a real production dependency edge. Looking up a matching
  // .pnpm folder directly could accidentally select a stale, unreferenced copy.
  return join(
    pnpmStore,
    entries[0],
    "node_modules",
    "image-size",
    relativePath,
  );
}

function assertTerminates(script, label) {
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 1_500,
  });

  assert.equal(
    result.error,
    undefined,
    `${label} did not terminate: ${result.error?.message ?? "unknown error"}`,
  );
  assert.equal(
    result.status,
    0,
    `${label} exited ${result.status}: ${result.stderr || result.stdout}`,
  );
}

test("patched image-size rejects zero-length ICNS entries without hanging", async () => {
  const indexPath = await resolveInstalledFile(join("dist", "index.js"));
  assertTerminates(
    `
      const { imageSize } = require(${JSON.stringify(indexPath)});
      if (typeof imageSize !== "function") process.exit(12);
      const payload = Uint8Array.from([
        0x69, 0x63, 0x6e, 0x73,
        0x00, 0x00, 0x00, 0x10,
        0x69, 0x73, 0x33, 0x32,
        0x00, 0x00, 0x00, 0x00,
      ]);
      try { imageSize(payload); } catch {}
    `,
    "ICNS zero-length entry parser",
  );
});

test("patched image-size never returns a zero-length ISO box to a caller loop", async () => {
  const utilsPath = await resolveInstalledFile(
    join("dist", "types", "utils.js"),
  );
  assertTerminates(
    `
      const { findBox } = require(${JSON.stringify(utilsPath)});
      if (typeof findBox !== "function") process.exit(12);
      const payload = Uint8Array.from([
        0x00, 0x00, 0x00, 0x00,
        0x6a, 0x78, 0x6c, 0x70,
      ]);
      let offset = 0;
      while (offset < payload.length) {
        const box = findBox(payload, "jxlp", offset);
        if (!box) break;
        offset = box.offset + box.size;
      }
    `,
    "JXL/HEIF zero-length box parser",
  );
});
