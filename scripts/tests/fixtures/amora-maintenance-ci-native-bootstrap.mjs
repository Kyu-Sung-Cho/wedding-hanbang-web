import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { lstatSync, realpathSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const MAINTENANCE_CI_TEST_ENTRY = fileURLToPath(new URL("../amora-action-writer-retirement-maintenance.test.mjs", import.meta.url));
const BIN = "/usr/lib/postgresql/17/bin";
const TOOLS = ["initdb", "postgres", "pg_ctl", "pg_dump", "pg_restore"];
const fail = code => { throw new Error(code); };

function validateFile(row, name) {
  const expected = `${BIN}/${name}`;
  if (!row || row.name !== name || row.path !== expected || row.realPath !== expected
      || row.regular !== true || row.symlink !== false || row.uid !== 0
      || !Number.isInteger(row.mode) || (row.mode & 0o022) !== 0 || (row.mode & 0o111) === 0
      || !Number.isSafeInteger(row.size) || row.size <= 0 || row.size > 64 * 1024 * 1024)
    fail("AMORA_MAINTENANCE_CI_TOOLCHAIN_INVALID");
}

/** 내용 판정일 뿐이다. 실제 플랫폼·도구 검증이나 운영 인가를 발급하지 않는다. */
export function selectAmoraMaintenanceCiNativeBinding(value) {
  if (value?.platform !== "linux" || typeof value.entry !== "string"
      || resolve(value.entry) !== MAINTENANCE_CI_TEST_ENTRY)
    return Object.freeze({ required: false, releaseAuthorized: false });
  if (value.githubActions !== "true" && value.requestedBin === undefined)
    return Object.freeze({ required: false, releaseAuthorized: false });
  if (value.context !== "child-v8" || value.githubActions !== "true" || value.runnerOs !== "Linux"
      || !["vendor_disclosure_quality", "static_release_contracts"].includes(value.githubJob)
      || value.requestedBin !== BIN || value.existingSyntheticBin !== undefined)
    fail("AMORA_MAINTENANCE_CI_CONTEXT_INVALID");
  return Object.freeze({ required: true, bin: BIN, releaseAuthorized: false });
}

/** 관찰 metadata의 내용만 확인한다. caller metadata로 실제 실행 증거를 만들지 않는다. */
export function validateAmoraMaintenanceCiNativeMetadata(records) {
  if (!Array.isArray(records) || records.length !== TOOLS.length) fail("AMORA_MAINTENANCE_CI_TOOLCHAIN_INVALID");
  let version;
  for (let i = 0; i < TOOLS.length; i++) {
    const row = records[i], name = TOOLS[i];
    validateFile(row, name);
    if (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)
        || typeof row.versionOutput !== "string") fail("AMORA_MAINTENANCE_CI_TOOLCHAIN_INVALID");
    const matched = new RegExp(`^${name} \\(PostgreSQL\\) (17\\.\\d+)(?: [^\\r\\n]*)?\\r?\\n?$`).exec(row.versionOutput);
    if (!matched || version && matched[1] !== version) fail("AMORA_MAINTENANCE_CI_TOOLCHAIN_INVALID");
    version = matched[1];
  }
  return Object.freeze({ version, toolCount: TOOLS.length, nativeDatabaseVerified: false, releaseAuthorized: false });
}

function configureActualMaintenanceWorker() {
  const binding = selectAmoraMaintenanceCiNativeBinding({ platform: process.platform, entry: process.argv[1],
    context: process.env.NODE_TEST_CONTEXT, githubActions: process.env.GITHUB_ACTIONS,
    runnerOs: process.env.RUNNER_OS, githubJob: process.env.GITHUB_JOB,
    requestedBin: process.env.HANBANG_MAINTENANCE_NATIVE_PG_BIN,
    existingSyntheticBin: process.env.HANBANG_SYNTHETIC_PG_BIN });
  if (!binding.required) return Object.freeze({ status: "not-applicable", mutatedEnvironment: false, releaseAuthorized: false });
  try {
    // 다섯 파일 모두 실행·할당 전에 확인한다. caller 경로·쓰기 가능한 파일은 실행하지 않는다.
    const descriptors = TOOLS.map(name => {
      const path = join(binding.bin, name), before = lstatSync(path);
      const row = { name, path, realPath: realpathSync(path), regular: before.isFile(),
        symlink: before.isSymbolicLink(), uid: before.uid, mode: before.mode, size: before.size };
      validateFile(row, name);
      return { row, before };
    });
    const records = descriptors.map(({ row, before }) => {
      const { name, path } = row;
      const bytes = readFileSync(path);
      const versionOutput = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 10_000, maxBuffer: 16_384,
        stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
      const after = lstatSync(path);
      for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode", "uid"])
        if (before[key] !== after[key]) fail("AMORA_MAINTENANCE_CI_TOOLCHAIN_INVALID");
      if (realpathSync(path) !== row.realPath || bytes.length !== row.size)
        fail("AMORA_MAINTENANCE_CI_TOOLCHAIN_INVALID");
      return { ...row,
        sha256: createHash("sha256").update(bytes).digest("hex"), versionOutput };
    });
    const metadata = validateAmoraMaintenanceCiNativeMetadata(records);
    process.env.HANBANG_SYNTHETIC_PG_BIN = binding.bin;
    console.log(JSON.stringify({ format: "amora-maintenance-ci-native-tools-v1", scope: "maintenance-worker-only",
      version: metadata.version, tools: records.map(({ name, sha256 }) => ({ name, sha256 })),
      nativeDatabaseVerified: false, releaseAuthorized: false }));
    return Object.freeze({ status: "configured-maintenance-worker", mutatedEnvironment: true,
      version: metadata.version, nativeDatabaseVerified: false, releaseAuthorized: false });
  } catch {
    // SDK/process stderr나 caller 환경값은 실패 응답으로 출력하지 않는다.
    fail("AMORA_MAINTENANCE_CI_TOOLCHAIN_INVALID");
  }
}

export const amoraMaintenanceCiNativeBootstrap = configureActualMaintenanceWorker();
