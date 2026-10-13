import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const fail = code => { throw new Error(code); };
const exact = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === names.slice().sort().join(",");
const canonical = path => path.replace(/^\.\//, "");

/** 명시 목록만 읽는다. 누락·중복·없는 파일은 실행 전에 닫는다. */
export function loadRepositoryTestManifest({ repoRoot = ROOT } = {}) {
  const root = resolve(repoRoot);
  const manifest = JSON.parse(readFileSync(resolve(root, "scripts/repository-test-manifest.json"), "utf8"));
  if (!exact(manifest, ["format", "concurrency", "modes"])
      || manifest.format !== "hanbang-repository-test-manifest-v1" || manifest.concurrency !== 2
      || !exact(manifest.modes, ["repo", "supabase"])) fail("REPOSITORY_TEST_MANIFEST_INVALID");
  for (const files of Object.values(manifest.modes)) {
    if (!Array.isArray(files) || files.length === 0) fail("REPOSITORY_TEST_MANIFEST_INVALID");
    const seen = new Set();
    for (const path of files) {
      if (typeof path !== "string" || !/^(?:\.\/)?(?:scripts\/tests\/|supabase\/release-candidates\/)[A-Za-z0-9._/-]+\.test\.mjs$/.test(path)
          || canonical(path).split("/").some(part => !part || part === "." || part === "..")) fail("REPOSITORY_TEST_PATH_INVALID");
      const key = canonical(path).toLowerCase();
      if (seen.has(key)) fail("REPOSITORY_TEST_DUPLICATE");
      seen.add(key);
      const target = resolve(root, path);
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(target) !== target) fail("REPOSITORY_TEST_PATH_INVALID");
    }
    Object.freeze(files);
  }
  const repoFiles = new Set(manifest.modes.repo.map(path => canonical(path).toLowerCase()));
  if (readdirSync(resolve(root, "scripts/tests")).filter(path => path.endsWith(".test.mjs"))
    .some(path => !repoFiles.has(`scripts/tests/${path}`.toLowerCase()))) fail("REPOSITORY_TEST_MISSING");
  if (manifest.modes.supabase.some(path => !repoFiles.has(canonical(path).toLowerCase()))) fail("REPOSITORY_TEST_RELEASE_NOT_INCLUDED");
  Object.freeze(manifest.modes);
  return Object.freeze(manifest);
}

export function parseRepositoryTestMode(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || !["--repo", "--supabase"].includes(argv[0]))
    fail("REPOSITORY_TEST_MODE_INVALID");
  return argv[0].slice(2);
}

/** CLI가 다시 정렬하지 않는 전체 API 목록이다. 원본 manifest는 바꾸지 않는다. */
export function buildRepositoryTestSchedule(options) {
  if (!exact(options, ["repoRoot", "mode"]) || !["repo", "supabase"].includes(options.mode))
    fail("REPOSITORY_TEST_MODE_INVALID");
  const manifest = loadRepositoryTestManifest({ repoRoot: options.repoRoot });
  const files = manifest.modes[options.mode].map(file => resolve(options.repoRoot, file)).sort();
  const runtime = resolve(options.repoRoot, "scripts/tests/amora-action-view-v2-runtime.test.mjs");
  return Object.freeze([...files.filter(file => file !== runtime), ...files.filter(file => file === runtime)]);
}

export function buildRepositoryTestInvocation(options) {
  if (!exact(options, ["repoRoot", "mode"]) || !["repo", "supabase"].includes(options.mode))
    fail("REPOSITORY_TEST_MODE_INVALID");
  loadRepositoryTestManifest({ repoRoot: options.repoRoot });
  return Object.freeze({ command: process.execPath, cwd: resolve(options.repoRoot), shell: false,
    args: Object.freeze([resolve(options.repoRoot, "scripts/repository-test-worker.mjs"), `--${options.mode}`]) });
}

/** Windows cmd 문자열을 만들지 않고 같은 Node에 전체 argv를 한 번 전달한다. */
export async function runRepositoryTests(options) {
  const invocation = buildRepositoryTestInvocation(options);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "NODE_TEST_CONTEXT"));
  // node:test 안에서 호출된 실제 자식도 재귀 생략으로 가짜 0을 반환하지 않게 한다.
  return new Promise((done, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd, shell: invocation.shell, stdio: "inherit", windowsHide: true, env: environment,
    });
    const interrupt = () => child.kill("SIGINT"), terminate = () => child.kill("SIGTERM");
    const clean = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", error => { clean(); reject(error); });
    child.once("close", (code, signal) => { clean(); done(signal || !Number.isInteger(code) ? 1 : code); });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runRepositoryTests({ repoRoot: ROOT, mode: parseRepositoryTestMode(process.argv.slice(2)) });
  } catch (error) {
    const code = /^REPOSITORY_TEST_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "REPOSITORY_TEST_RUNNER_FAILED";
    console.error(code);
    process.exitCode = 1;
  }
}
