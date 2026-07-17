import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_TOOL_BYTES = 16 * 1024 * 1024;

export const PINNED_WINDOWS_PRODUCTION_TOOLCHAIN = Object.freeze({
  git: Object.freeze({
    path: "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
    sha256: "CAB4C4EEA1D869CF9F7BE73868DC9A90AD2DF1B1B673E5F8C8714A576C25EA96",
  }),
  powershell: Object.freeze({
    path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    sha256: "7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5",
  }),
  windowsRoot: "C:\\Windows",
});

export class ProductionToolchainError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionToolchainError";
    this.code = "PRODUCTION_TOOLCHAIN_INVALID";
  }
}

function invalid(message) {
  throw new ProductionToolchainError(message);
}

function sameFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

export async function verifyPinnedExecutableSnapshot(path, expectedSha256) {
  if (!/^[A-F0-9]{64}$/.test(expectedSha256 ?? "")) {
    invalid("trusted executable SHA-256 pin is invalid");
  }
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()
      || before.size < 1 || before.size > MAX_TOOL_BYTES) {
    invalid("trusted executable is missing, linked or oversized");
  }
  let handle;
  let bytes;
  try {
    handle = await open(path, "r");
    const opened = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    if (!opened.isFile() || !linked?.isFile() || linked.isSymbolicLink()
        || !sameFile(before, opened) || !sameFile(opened, linked)) {
      invalid("trusted executable changed while it was opened");
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== opened.size || !sameFile(opened, after)) {
      invalid("trusted executable changed while it was hashed");
    }
  } finally {
    await handle?.close().catch(() => {});
  }
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (digest !== expectedSha256) invalid("trusted executable hash differs from its release pin");
  const canonical = await realpath(path).catch(() => null);
  if (!canonical || resolve(canonical).toLowerCase() !== resolve(path).toLowerCase()) {
    invalid("trusted executable path is not canonical");
  }
  return canonical;
}

export async function resolvePinnedWindowsProductionToolchain({
  platform = process.platform,
  environment = process.env,
} = {}) {
  if (platform !== "win32") {
    invalid("this DPAPI-bound production release requires the pinned Windows host");
  }
  const expectedRoot = resolve(
    PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.windowsRoot,
  ).toLowerCase();
  for (const name of ["SystemRoot", "WINDIR"]) {
    const value = environment[name];
    if (value && resolve(value).toLowerCase() !== expectedRoot) {
      invalid(`${name} differs from the release-pinned Windows root`);
    }
  }
  const [git, powershell] = await Promise.all([
    verifyPinnedExecutableSnapshot(
      PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git.path,
      PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git.sha256,
    ),
    verifyPinnedExecutableSnapshot(
      PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.powershell.path,
      PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.powershell.sha256,
    ),
  ]);
  return Object.freeze({ git, powershell });
}
