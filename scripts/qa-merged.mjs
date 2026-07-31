/**
 * `qa:merged` — **머지된 결과**를 CI와 같은 조건으로 검사한다.
 *
 * ## 왜 필요한가
 *
 * 이 저장소의 GitHub Actions는 계정 수준에서 막혀 한 번도 실행된 적이 없다(실측: 전체 이력
 * 91회가 전부 스텝 0개로 1~9초 만에 실패). 그래서 실제로 코드를 검사하는 것은
 * `.githooks/pre-push` 하나뿐인데, 그 훅에는 **원리적인 구멍**이 있다:
 *
 * 1. **머지에는 안 뛴다.** 훅은 `git push`에만 걸린다. GitHub에서 PR을 머지하면 아무것도
 *    안 돈다. 두 브랜치가 각자 통과해도 합쳐진 결과는 아무도 검사하지 않는다.
 * 2. **캐시를 믿는다.** 실측: 어제 푸시에서 게이트가 `Time: 1.297s >>> FULL TURBO`로
 *    끝났다. 테스트를 돈 게 아니라 「아까 돌렸으니 됐다」고 캐시를 신뢰한 것이다.
 * 3. **낡은 파일에 속는다.** 실측: `apps/web/.next`에 남은 옛 라우트 타입 때문에 typecheck가
 *    깨진 적이 있다. 코드는 멀쩡했다.
 *
 * 이 명령은 셋을 다 막는다 — 검사 대상이 정말 `origin/main`인지 먼저 확인하고, 캐시를
 * 지우고, `qa:local`과 **같은 목록**으로 돌린다.
 *
 * ## 쓰는 법
 *
 *   npx pnpm@11.7.0 qa:merged
 *
 * 옵션:
 *   --allow-unclean   커밋 안 된 변경이 있어도 진행(그 경우 결과는 origin/main이 아니다)
 *   --allow-branch    main이 아닌 브랜치에서도 진행
 *   --no-fetch        원격 조회를 건너뛴다(오프라인)
 *   --skip-build      빌드를 건너뛴다(빠른 확인용 — 프리렌더 오류는 못 잡는다)
 *   --preflight-only  전제만 확인하고 끝낸다. 12분 돌리기 전에 「내가 지금 origin/main을
 *                     보고 있나」만 3초로 확인할 때 쓴다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checks, runCheck } from "./verify-local.mjs";
import { buildQaMergedSummary } from "./lib/qa-merged-summary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));

const LABEL = "qa:merged";
const log = (message) => console.log(`[${LABEL}] ${message}`);
const fail = (message, hint) => {
  console.error(`\n[${LABEL}] 중단 — ${message}`);
  if (hint) console.error(`         ${hint}`);
  process.exit(1);
};

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return null;
    fail(`git ${args.join(" ")} 실패`, (result.stderr ?? "").trim());
  }
  return (result.stdout ?? "").trim();
}

// ── 1. 전제 확인 — 무엇을 검사하는지가 먼저 참이어야 한다 ────────────────
//
// 이 단계가 이 명령의 존재 이유다. 낡은 main이나 더러운 작업 트리를 검사하고 초록불을
// 받으면, 그 초록불은 origin/main에 대한 것이 아니다. 그런 초록불은 없는 것보다 나쁘다.

if (!flags.has("--no-fetch")) {
  log("원격 조회 중…");
  const fetched = spawnSync("git", ["fetch", "origin", "--quiet"], { cwd: repoRoot });
  if (fetched.status !== 0) {
    fail(
      "origin 조회 실패 — 지금 origin/main이 무엇인지 알 수 없다.",
      "오프라인이면 --no-fetch 로 로컬 기준으로만 검사할 수 있다(그 경우 최신 여부는 보장 안 됨).",
    );
  }
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main" && !flags.has("--allow-branch")) {
  fail(
    `현재 브랜치가 "${branch}"다. 이 명령은 머지된 main을 검사하는 용도다.`,
    "git checkout main && git pull --ff-only origin main   (또는 --allow-branch)",
  );
}

// Untracked source, SQL, or configuration changes affect the build just as
// tracked edits do. Ignoring them can produce a green result for a tree that
// is not the exact origin/main candidate.
const dirty = git(["status", "--porcelain", "--untracked-files=all"]);
if (dirty && !flags.has("--allow-unclean")) {
  fail(
    "커밋되지 않은 변경이 있어 검사 결과가 origin/main에 대한 것이 아니게 된다.",
    "커밋하거나 stash한 뒤 다시 실행한다(또는 --allow-unclean).",
  );
}

const head = git(["rev-parse", "HEAD"]);
const remote = git(["rev-parse", "origin/main"], { allowFailure: true });
if (!remote && !flags.has("--no-fetch")) {
  fail(
    "origin/main을 확인할 수 없다.",
    "origin의 main 브랜치가 존재하는지 확인하거나, 오프라인 검사라면 --no-fetch를 사용한다.",
  );
}
if (remote && head !== remote && !flags.has("--allow-branch")) {
  const behind = git(["rev-list", "--count", `HEAD..origin/main`], { allowFailure: true });
  const ahead = git(["rev-list", "--count", `origin/main..HEAD`], { allowFailure: true });
  fail(
    `HEAD가 origin/main과 다르다 (뒤처짐 ${behind ?? "?"} · 앞섬 ${ahead ?? "?"}).`,
    "git pull --ff-only origin main 후 다시 실행한다.",
  );
}

const shortHead = head.slice(0, 8);
log(`검사 대상 확정: ${branch} @ ${shortHead}`);

if (flags.has("--preflight-only")) {
  console.log(`\n[${LABEL}] 전제 확인만 하고 끝낸다 — 검사는 돌리지 않았다.`);
  process.exit(0);
}

// ── 2. 청소 — 캐시와 낡은 산출물을 없앤다 ─────────────────────────────
//
// 이걸 안 하면 turbo가 「아까 통과했다」는 기록만 보고 실제로 돌지 않는다.

const researchLock = path.join(repoRoot, "apps", "web", ".wedding-code-research.lock");
if (existsSync(researchLock)) {
  // 자동 삭제는 의도적으로 꺼져 있다(연구 라우트가 살아 있는 채로 빌드되는 것을 막는 장치).
  fail(
    "웨딩코드 연구 락이 남아 있어 빌드가 막힌다.",
    `dev 서버를 모두 끈 뒤 이 파일을 지운다: ${researchLock}`,
  );
}

const stale = [
  "apps/web/.next",
  ".turbo",
  "apps/web/.turbo",
  "apps/mobile/.turbo",
  "packages/shared/.turbo",
  "packages/design-tokens/.turbo",
];
for (const relative of stale) {
  const target = path.join(repoRoot, relative);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    log(`지움: ${relative}`);
  }
}

// ── 3. 검사 — qa:local과 같은 목록, 캐시 없이, 빠른 것부터 ──────────────

const ORDER = { typecheck: 0, lint: 1, check: 2, test: 3, build: 4 };

// turbo를 거치는 검사가 캐시를 다시 만들어 쓰지 못하게 한다. 위에서 `.turbo`를 지웠지만
// 원격/글로벌 캐시가 붙는 환경에서도 확실히 강제하려면 이 변수가 필요하다.
const extraEnv = { TURBO_FORCE: "true" };

/**
 * `qa:local`이 안 도는 저장소 수준 검사.
 *
 * - **ingest 타입체크**: 루트 `typecheck`(`pnpm ingest:typecheck && turbo run typecheck`)의
 *   앞쪽 절반이다. `verify-local`의 검사들은 패키지별 `tsc`만 돌아서 `scripts/ingest/**`가
 *   빠진다. 이 줄을 빼면 ingest 코드는 **아무 데서도 타입체크되지 않는다**
 *   (`qa:local`도 안 돈다 — 실측으로 확인했다).
 * - **저장소 스크립트 테스트**: `scripts/tests/**` 25개 + ingest 테스트. 배포 펜스·인계 문서
 *   계약·훅 배선이 전부 여기 있다.
 *
 * 루트 `test`가 아니라 `test:repo`를 쓴다. `test`는 `turbo run test`를 포함해서
 * web·mobile vitest를 한 번 더 돌리는데, 그건 위 `checks`에 이미 들어 있다(4분 낭비).
 */
const repositoryChecks = [
  { kind: "typecheck", name: "ingest typecheck", args: ["pnpm", "ingest:typecheck"] },
  { kind: "test", name: "repository scripts + ingest tests", args: ["pnpm", "test:repo"] },
];

// 느린 빌드를 뒤로 미뤄 실패를 빨리 본다. `kind`를 안 붙인 검사는 맨 뒤로 밀린다 —
// 그래도 돌기는 하므로 검사가 조용히 사라지지는 않는다.
const ordered = [...checks, ...repositoryChecks]
  .filter((check) => !(flags.has("--skip-build") && check.kind === "build"))
  .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));

const started = Date.now();
const failures = [];
const passed = [];

for (const check of ordered) {
  const failure = runCheck(check, { label: LABEL, extraEnv });
  if (failure) failures.push(failure);
  else passed.push(check.name);
}

// ── 4. 요약 — 어떤 커밋을 검사했는지 남긴다 ────────────────────────────

const minutes = Math.round((Date.now() - started) / 60000);

/**
 * 전제를 우회했으면 **통과 문구가 달라져야 한다.**
 *
 * 첫 판이 「주의: 이 결과는 origin/main에 대한 것이 아니다」를 찍고 바로 다음 줄에
 * 「머지된 결과가 깨끗하다」고 단언했다. 사람은 마지막 줄을 읽는다 — 경고를 위에 적어두는
 * 것으로는 거짓 초록불을 막지 못한다.
 */
const summary = buildQaMergedSummary({
  branch,
  shortHead,
  dirty: Boolean(dirty),
  headMatchesRemote: Boolean(remote && head === remote),
  flags,
  passedCount: passed.length,
  failures,
  minutes,
});

console.log();
for (const line of summary.lines) {
  const output = line ? `[${LABEL}] ${line}` : "";
  if (summary.exitCode === 1) console.error(output);
  else console.log(output);
}
process.exit(summary.exitCode);
