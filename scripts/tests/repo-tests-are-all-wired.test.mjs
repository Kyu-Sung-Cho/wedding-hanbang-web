// `scripts/tests` 에 있는 가드가 **전부 실제로 돌고 있는가.**
//
// ## 무엇이 있었나
//
// 2026-08-22 실측: `scripts/tests` 에 29개가 있는데 `test:repo` 는 27개만 돌고 있었다.
// 빠진 둘은 껍데기가 아니었다 —
//
//   - `amora-release-sql-contract.test.mjs` (498줄): 릴리스 점검 SQL 이 읽기 전용이고
//     fail-closed 인지 본다. 뮤테이션으로 확인: `BEGIN TRANSACTION READ ONLY;` 를
//     `BEGIN;` 으로 바꾸니 6/6 → 5/6. **진짜로 무는 가드인데 아무도 안 불렀다.**
//   - `community-release-readiness.test.mjs` (31줄): 빈 디렉터리로 fail-closed 자가검증까지
//     내장하고 있다.
//
// 가드를 새로 쓰면서 `package.json` 의 긴 한 줄에 파일명을 덧붙이는 것을 잊으면,
// 그 가드는 **초록불도 빨간불도 아닌 채로** 저장소에 눕는다. 아무도 모른다.
//
// ## 왜 목록을 손으로 안 적나
//
// 손으로 적은 목록은 그 자체가 같은 방식으로 썩는다. 디렉터리를 읽어 대조한다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, lstatSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadRepositoryTestManifest } from "../run-repository-tests.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const testsDir = resolve(repoRoot, "scripts/tests");

function wiredFiles() {
  return new Set(
    loadRepositoryTestManifest({ repoRoot }).modes.repo
      .map(path => /^\.\//.test(path) ? path.slice(2) : path)
      .filter(path => path.startsWith("scripts/tests/"))
      .map(path => path.slice("scripts/tests/".length)),
  );
}

test("측정기가 살아 있다", () => {
  // 어느 쪽이든 0건이면 아래 대조가 조용히 통과한다. 그쪽을 먼저 막는다.
  const onDisk = readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs"));
  assert.ok(onDisk.length > 20, `scripts/tests 에서 ${onDisk.length}개만 찾았습니다`);
  assert.ok(wiredFiles().size > 20, `test:repo 에서 ${wiredFiles().size}개만 찾았습니다`);
});

test("scripts/tests 의 모든 가드가 test:repo 에서 실제로 돈다", () => {
  const onDisk = readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs"));
  const wired = wiredFiles();

  const missing = onDisk.filter((f) => !wired.has(f));
  assert.deepEqual(
    missing,
    [],
    `아무도 부르지 않는 가드가 있습니다: ${missing.join(", ")}. `
      + "scripts/repository-test-manifest.json 의 repo 목록에 넣으세요.",
  );
});

test("test:repo 가 없는 파일을 부르지 않는다", () => {
  // 반대 방향도 본다. 파일을 지우면서 스크립트를 안 고치면 게이트가 통째로 죽는다.
  const onDisk = new Set(readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs")));
  const ghosts = [...wiredFiles()].filter((f) => !onDisk.has(f));
  assert.deepEqual(ghosts, [], `test:repo 가 없는 파일을 부릅니다: ${ghosts.join(", ")}`);
});

test("DB 검증의 동시 실행 제한은 파일명 앞의 실제 Node 옵션으로 전달한다", async () => {
  const { buildRepositoryTestInvocation, parseRepositoryTestMode } = await import("../run-repository-tests.mjs");
  const manifest = loadRepositoryTestManifest({ repoRoot });
  for (const mode of ["repo", "supabase"]) {
    const invocation = buildRepositoryTestInvocation({ repoRoot, mode });
    assert.equal(invocation.command, process.execPath);
    assert.deepEqual(invocation.args, ["--test", "--test-concurrency=2", ...manifest.modes[mode]]);
    assert.equal(invocation.shell, false);
    assert.equal(invocation.args.filter(arg => arg.startsWith("--test-concurrency=")).length, 1);
    assert.equal(parseRepositoryTestMode([`--${mode}`]), mode);
  }
});

test("정상 게이트 명령은 Windows 셸 길이 제한 없이 같은 runner의 명시 모드로 시작한다", () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:repo"], "pnpm test:ingest && node ./scripts/run-repository-tests.mjs --repo");
  assert.equal(pkg.scripts["supabase:release:test"], "node ./scripts/run-repository-tests.mjs --supabase");
  for (const name of ["test:repo", "supabase:release:test"]) assert.ok(pkg.scripts[name].length < 1024);
});

test("두 명시 목록은 원래 전체 검사와 릴리스 검사를 빠짐없이 보존한다", async () => {
  const { loadRepositoryTestManifest } = await import("../run-repository-tests.mjs");
  const manifest = loadRepositoryTestManifest({ repoRoot });
  assert.equal(manifest.concurrency, 2);
  assert.equal(manifest.modes.repo.length, 148);
  assert.equal(manifest.modes.supabase.length, 104);
  for (const mode of ["repo", "supabase"]) {
    for (const name of ["transport-native", "transport-identity-native", "transport-plan-native"]) {
      assert.ok(manifest.modes[mode].includes(`./supabase/release-candidates/amora-action-writer-retirement-v1/${name}.test.mjs`));
    }
  }
});

function ownedFixture() {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, "hanbang-test-runner-"));
  const marker = "repository-test-runner-synthetic-only";
  writeFileSync(join(root, ".owner"), marker, { flag: "wx" });
  mkdirSync(join(root, "scripts/tests"), { recursive: true });
  const good = "./scripts/tests/good.test.mjs", bad = "./scripts/tests/bad.test.mjs";
  writeFileSync(join(root, good), "import test from 'node:test'; import assert from 'node:assert/strict'; test('actual child success',()=>assert.ok(true));\n");
  writeFileSync(join(root, bad), "import test from 'node:test'; import assert from 'node:assert/strict'; test('EXPECTED synthetic child failure for exit propagation',()=>assert.ok(false));\n");
  const manifest = { format: "hanbang-repository-test-manifest-v1", concurrency: 2, modes: { repo: [good, bad], supabase: [good] } };
  const write = value => writeFileSync(join(root, "scripts/repository-test-manifest.json"), JSON.stringify(value));
  write(manifest);
  return { root, manifest, write, close() {
    const target = realpathSync(root), delta = relative(parent, target);
    assert.ok(delta.startsWith("hanbang-test-runner-") && !delta.includes(sep) && !lstatSync(root).isSymbolicLink());
    assert.equal(readFileSync(join(target, ".owner"), "utf8"), marker);
    rmSync(target, { recursive: true, force: false });
  } };
}

test("실제 자식 Node 실행은 각 모드의 전체 목록을 실행하고 실패 상태를 그대로 돌려준다", async () => {
  const { runRepositoryTests } = await import("../run-repository-tests.mjs");
  const f = ownedFixture();
  try {
    assert.equal(await runRepositoryTests({ repoRoot: f.root, mode: "supabase" }), 0);
    assert.equal(await runRepositoryTests({ repoRoot: f.root, mode: "repo" }), 1);
  } finally { f.close(); }
});

test("manifest 누락은 자식 실행 전에 거절하고 전용 릴리스 검사는 전체 목록의 부분집합이어야 한다", () => {
  const f = ownedFixture();
  try {
    const missing = structuredClone(f.manifest);
    missing.modes.repo.pop();
    f.write(missing);
    assert.throws(() => loadRepositoryTestManifest({ repoRoot: f.root }), /REPOSITORY_TEST_MISSING/);
    const outside = "./supabase/release-candidates/synthetic/extra.test.mjs";
    mkdirSync(join(f.root, "supabase/release-candidates/synthetic"), { recursive: true });
    writeFileSync(join(f.root, outside), "// synthetic only\n");
    const disjoint = structuredClone(f.manifest);
    disjoint.modes.supabase.push(outside);
    f.write(disjoint);
    assert.throws(() => loadRepositoryTestManifest({ repoRoot: f.root }), /REPOSITORY_TEST_RELEASE_NOT_INCLUDED/);
  } finally { f.close(); }
});

test("manifest schema·중복·없는 파일과 허용되지 않은 CLI 모드는 fail-closed로 끝낸다", async () => {
  const { parseRepositoryTestMode, buildRepositoryTestInvocation } = await import("../run-repository-tests.mjs");
  const f = ownedFixture();
  try {
    for (const edit of [
      value => { value.format = "unreviewed"; }, value => { value.concurrency = 1; },
      value => { value.concurrency = "2"; }, value => { value.concurrency = [2]; },
      value => { value.extra = true; }, value => { value.modes.ignored = []; },
      value => { value.modes.repo = []; }, value => { value.modes.supabase = null; },
      value => { value.modes.repo.push("scripts/tests/good.test.mjs"); },
      value => { value.modes.supabase.push("./scripts/tests/missing.test.mjs"); },
      value => { value.modes.repo[0] = "../scripts/tests/good.test.mjs"; },
      value => { value.modes.repo[0] = "./scripts/tests/good.test.mjs; echo hidden"; },
    ]) {
      const value = structuredClone(f.manifest); edit(value); f.write(value);
      assert.throws(() => loadRepositoryTestManifest({ repoRoot: f.root }));
    }
    f.write(f.manifest);
    for (const argv of [[], ["--unknown"], ["--repo", "--supabase"], ["--repo", "--test-name-pattern=skip"], null, "--repo"])
      assert.throws(() => parseRepositoryTestMode(argv), /REPOSITORY_TEST_MODE_INVALID/);
    for (const mode of ["unsupported", "--repo", null, [], true])
      assert.throws(() => buildRepositoryTestInvocation({ repoRoot: f.root, mode }), /REPOSITORY_TEST_MODE_INVALID/);
    assert.throws(() => buildRepositoryTestInvocation({ repoRoot: f.root, mode: "repo", skip: true }), /REPOSITORY_TEST_MODE_INVALID/);
  } finally { f.close(); }
});

test("실제 CLI도 짧은 명령으로 모드를 선택하고 혼합·비밀 인자를 출력하지 않는다", () => {
  const f = ownedFixture(), runner = join(f.root, "scripts/run-repository-tests.mjs");
  try {
    writeFileSync(runner, readFileSync(new URL("../run-repository-tests.mjs", import.meta.url)));
    const result = spawnSync(process.execPath, [runner, "--supabase"], {
      cwd: f.root, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /actual child success/);
    for (const args of [["--repo", "--supabase"], ["--secret=SYNTHETIC_SECRET_MUST_NOT_ECHO"]]) {
      const invalid = spawnSync(process.execPath, [runner, ...args], {
        cwd: f.root, encoding: "utf8", timeout: 10_000, windowsHide: true,
      });
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /REPOSITORY_TEST_MODE_INVALID/);
      assert.doesNotMatch(invalid.stdout + invalid.stderr, /SYNTHETIC_SECRET_MUST_NOT_ECHO|actual child/);
    }
  } finally { f.close(); }
});
