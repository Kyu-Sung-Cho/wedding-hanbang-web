import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EAS_CLI_PACKAGE = "eas-cli@21.0.2";

export const MOBILE_EAS_COMMAND_INVALID = "MOBILE_EAS_COMMAND_INVALID";

export const MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED =
  "MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED";

const NON_PRODUCTION_PROFILES = new Set(["development", "preview"]);
const MOBILE_PLATFORMS = new Set(["ios", "android", "all"]);

export const PNPM_REQUIRES_SHELL = process.platform === "win32";
export const MOBILE_EAS_WORKING_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/mobile",
);

function runPinnedProvider({ command, args, cwd }) {
  // Node cannot execute a Windows .cmd shim directly with shell:false. Every
  // forwarded token has already passed the closed allowlist below, so using
  // the Windows command shell here does not expose arbitrary EAS arguments.
  const result = PNPM_REQUIRES_SHELL
    ? spawnSync([command, ...args].join(" "), { cwd, shell: true, stdio: "inherit" })
    : spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function optionValues(argv, optionName) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === optionName) {
      values.push(argv[index + 1] ?? "");
      index += 1;
    } else if (argument.startsWith(`${optionName}=`)) {
      values.push(argument.slice(optionName.length + 1));
    }
  }
  return values;
}

function countFlag(argv, flag) {
  return argv.filter((argument) => argument === flag).length;
}

function isApprovedNonProductionBuild(argv) {
  if (argv[0] !== "build") return false;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--platform" || argument === "--profile") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) return false;
      index += 1;
      continue;
    }
    if (argument.startsWith("--platform=") || argument.startsWith("--profile=")) {
      if (argument.endsWith("=")) return false;
      continue;
    }
    if (argument === "--non-interactive" || argument === "--freeze-credentials") {
      continue;
    }
    return false;
  }

  const profiles = optionValues(argv, "--profile");
  const platforms = optionValues(argv, "--platform");
  return profiles.length === 1
    && NON_PRODUCTION_PROFILES.has(profiles[0])
    && platforms.length === 1
    && MOBILE_PLATFORMS.has(platforms[0])
    && countFlag(argv, "--non-interactive") === 1
    && countFlag(argv, "--freeze-credentials") === 1;
}

export function runMobileEasCommand(argv, { runProvider = runPinnedProvider } = {}) {
  const profiles = optionValues(argv, "--profile");
  if (profiles.includes("production")) {
    const error = new Error(
      `${MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED}: mobile production release authorization is not implemented`,
    );
    error.code = MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED;
    throw error;
  }
  if (!isApprovedNonProductionBuild(argv)) {
    const error = new Error(
      `${MOBILE_EAS_COMMAND_INVALID}: only an explicit development or preview build with one platform, --non-interactive, and --freeze-credentials is allowed`,
    );
    error.code = MOBILE_EAS_COMMAND_INVALID;
    throw error;
  }
  return runProvider({
    command: "corepack",
    args: ["pnpm", "dlx", EAS_CLI_PACKAGE, ...argv],
    cwd: MOBILE_EAS_WORKING_DIRECTORY,
  });
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const status = runMobileEasCommand(process.argv.slice(2));
    if (status !== 0) process.exitCode = status;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
