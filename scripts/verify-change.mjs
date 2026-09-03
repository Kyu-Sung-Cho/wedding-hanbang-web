#!/usr/bin/env node
/**
 * **완료라고 말하기 전에 통과해야 하는 관문.**
 *
 * 2026-09-02 하루에 같은 병으로 네 번 틀렸다. 전부 "내가 고른 방법으로, 내가 만든
 * 것을 재고, 그 결과를 사실처럼 보고" 한 것이다:
 *
 *   - 타입 검사와 테스트 316개가 통과했다고 보고했는데 채팅 테스트 133개가 깨져
 *     있었다. **내가 검증 범위를 골랐기 때문**이다.
 *   - 원장 쓰기를 고쳤다고 보고했는데 그 수정이 고치기 전보다 나빴다. 조용히
 *     실패하는 형태라 테스트도 경보도 통과했다.
 *   - 안전 갈래를 넓히고 "오탐 0" 이라고 보고했는데 이전 판본과 나란히 재보니
 *     0→12 였다. **내 코퍼스가 한 구조만 겨냥**했다.
 *   - 원장 누락이 1건이라고 보고했는데 27건이었다. 근사 조인이 뭉갰다.
 *
 * 그래서 이 스크립트는 **내가 고를 수 있는 것을 줄인다.** 검증 범위는 diff 에서
 * 기계적으로 정해지고, 출력은 파일로 받아 종료 코드를 잃지 않으며, 새로 만든
 * 검사는 `prove-guard` 영수증이 있어야 하고, 안전 파일을 건드리면 별도 확인을
 * 요구한다. 그리고 **검증하지 못한 것을 반드시 적게** 한다 — 빈 목록도 의도로
 * 적어야 한다.
 *
 * 사용법:
 *   node scripts/verify-change.mjs [--base origin/main] [--not-verified "a; b"]
 *
 * 종료 코드 0 이면 그때 "완료" 라고 말해도 된다. 그 전엔 안 된다.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, ".verification");
const LOG_DIR = join(OUT_DIR, "logs");
const RECEIPT = join(OUT_DIR, "verification-receipt.json");
const GUARD_PROOFS = join(OUT_DIR, "guard-proofs.json");

/**
 * 이 파일들은 안전·개인정보 판정을 진다. 건드리면 별도 확인을 요구한다.
 *
 * 파운더 지시(2026-09-02): "충돌이나 기능을 무력화시키는 건 하면 안 된다."
 * 그리고 그 이전부터: 안전 분류(W2/W5)를 느슨하게 만들어 문제를 '해결' 하지 말 것.
 */
const SAFETY_CRITICAL = [
  "apps/web/src/lib/ai/amoraQuestionScope.ts",
  "apps/web/src/lib/ai/amoraClarificationContinuity.ts",
  "apps/web/src/lib/ai/amoraBoundedContinuity.ts",
  "packages/shared/src/safety/amoraCrisisSafety.ts",
  "packages/shared/src/safety/amoraCrisisClassifier.ts",
  "apps/web/src/lib/compliance/ai-log.ts",
];

const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? (i += 1, next) : true;
  }
  return out;
}

/** git 은 **shell 없이**. cmd 가 `^` 를 이스케이프로 먹어 다른 커밋을 재게 된다. */
const git = (args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });

/**
 * 명령을 돌리고 **출력을 파일로** 받는다.
 *
 * 파이프로 `tail` 에 넘기면 종료 코드가 `tail` 것이 되어 실패가 성공으로 읽힌다.
 * 2026-09-02 에 실제로 두 번 그럴 뻔했다.
 */
function run(label, cmd, args, cwd) {
  const logPath = join(LOG_DIR, `${label}.log`);
  process.stdout.write(`  ${label} … `);
  const started = Date.now();
  try {
    const out = execFileSync(cmd, args, {
      cwd, encoding: "utf8", shell: process.platform === "win32",
      stdio: "pipe", timeout: 45 * 60 * 1000, maxBuffer: 128 * 1024 * 1024,
    });
    writeFileSync(logPath, out, "utf8");
    console.log(`통과 (${Math.round((Date.now() - started) / 1000)}초)`);
    return { ok: true, log: logPath };
  } catch (err) {
    writeFileSync(logPath, `${err.stdout ?? ""}\n${err.stderr ?? ""}`, "utf8");
    const why = err.killed || err.signal ? `죽음(${err.signal ?? "timeout"})` : "실패";
    console.log(`${why} → ${logPath.replace(ROOT, ".")}`);
    return { ok: false, log: logPath, killed: Boolean(err.killed || err.signal) };
  }
}

const args = parseArgs(process.argv.slice(2));
const base = typeof args.base === "string" ? args.base : "origin/main";

// ── 0) 인자 검사는 **맨 앞에서** ────────────────────────────────────
// 테스트를 20분 돌린 뒤에 "인자가 없다" 고 거절하면, 다음번엔 사람이 관문을
// 건너뛸 방법부터 찾는다. 거절할 것은 1초 안에 거절한다.
const notVerified = typeof args["not-verified"] === "string"
  ? args["not-verified"].split(";").map((s) => s.trim()).filter(Boolean)
  : null;

if (notVerified === null) {
  console.error(
    `[verify] --not-verified 가 없다.`
    + `\n  검증하지 못한 것을 적어야 한다. 없으면 --not-verified "없음" 이라고 적을 것.`
    + `\n  오늘 틀린 네 번 모두, 안 잰 것을 안 잰 채로 "됐다" 고 말해서 생겼다.`,
  );
  process.exit(1);
}

// **재진입 금지.** 변형이 관문 하나를 끄면 이 스크립트가 자기를 다시 부르는
// 고리가 생긴다(전체 테스트 -> 그 안의 메타 검사 -> 다시 이 스크립트). 실제로
// 2026-09-02 에 그 고리가 돌아 하위 프로세스가 백업을 지웠다.
if (process.env.HANBANG_VERIFY_RUNNING === "1") {
  console.error("[verify] 이미 검증이 돌고 있다. 중첩 실행은 거절한다.");
  process.exit(2);
}
process.env.HANBANG_VERIFY_RUNNING = "1";

mkdirSync(LOG_DIR, { recursive: true });

// ── 1) 무엇이 바뀌었나 — 범위를 내가 고르지 않는다 ──────────────────
let changed;
try {
  const tracked = git(["diff", "--name-only", `${base}...HEAD`]).split("\n");
  const working = git(["status", "--porcelain"]).split("\n")
    .map((l) => l.slice(3).trim()).filter(Boolean);
  changed = [...new Set([...tracked, ...working])]
    .map((f) => f.trim()).filter(Boolean)
    .filter((f) => !f.startsWith(".verification/"));
} catch {
  console.error(`[verify] base 를 못 읽었다: ${base}. --base 로 지정할 것.`);
  process.exit(2);
}

if (changed.length === 0) {
  console.error(`[verify] ${base} 대비 바뀐 파일이 없다. 검증할 것이 없다.`);
  process.exit(2);
}

const touched = {
  web: changed.some((f) => f.startsWith("apps/web/")),
  mobile: changed.some((f) => f.startsWith("apps/mobile/")),
  shared: changed.some((f) => f.startsWith("packages/")),
  repoScripts: changed.some((f) => f.startsWith("scripts/") || f === "package.json"),
  migrations: changed.some((f) => f.startsWith("supabase/migrations/")),
};
// 공유 패키지를 건드리면 그것을 쓰는 앱도 전부 다시 돈다.
if (touched.shared) { touched.web = true; touched.mobile = true; }

console.log(`\n[verify] base=${base} · 바뀐 파일 ${changed.length}개`);
console.log(`  범위: ${Object.entries(touched).filter(([, v]) => v).map(([k]) => k).join(", ") || "(없음)"}`);

const results = {};
const notes = [];

// ── 2) 안전 파일을 건드렸는가 ────────────────────────────────────
const touchedSafety = changed.filter((f) => SAFETY_CRITICAL.includes(f));
if (touchedSafety.length) {
  console.log(`\n[verify] 안전·개인정보 판정을 지는 파일을 건드렸다:`);
  touchedSafety.forEach((f) => console.log(`    ${f}`));
  if (!args["safety-delta"]) {
    console.error(
      `\n  이 파일을 고쳤으면 **이전 판본과 나란히 잰 결과**가 있어야 한다.`
      + `\n  scripts/scope-delta.mjs 로 재고 그 결과 파일을 넘길 것:`
      + `\n    node scripts/verify-change.mjs --safety-delta <결과.json>`
      + `\n  "안전을 안 건드렸다" 는 주장은 근거가 아니다.`,
    );
    process.exit(1);
  }
  notes.push(`안전 파일 ${touchedSafety.length}개 변경 — 델타 근거: ${args["safety-delta"]}`);
}

// ── 3) 새로 만든 검사는 깨뜨려 본 영수증이 있어야 한다 ──────────────
/**
 * **새로 만든** 검사만 요구한다.
 *
 * 초록불이 거짓인 병은 거의 언제나 새 가드에서 난다 — 정규식이 처음부터 아무것도
 * 안 잡거나, 자기 반례만 겨냥했거나, 주석·문자열이 대신 대답하는 경우다. 기존
 * 검사를 손본 것까지 매번 요구하면 관문이 잡음이 되고, 잡음이 되면 사람은 관문을
 * 끈다. 넓게 걸어서 꺼지는 것보다 좁게 걸어서 살아 있는 편이 낫다.
 */
const addedInDiff = (() => {
  try {
    return git(["diff", "--name-status", `${base}...HEAD`]).split("\n")
      .filter((l) => l.startsWith("A\t")).map((l) => l.slice(2).trim());
  } catch { return []; }
})();
const untracked = (() => {
  try {
    return git(["ls-files", "--others", "--exclude-standard"]).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
})();
const newTests = [...new Set([...addedInDiff, ...untracked])]
  .filter((f) => /\.test\.(ts|tsx|mjs)$/.test(f) && existsSync(join(ROOT, f)));
if (newTests.length) {
  const proofs = existsSync(GUARD_PROOFS) ? JSON.parse(readFileSync(GUARD_PROOFS, "utf8")) : {};
  const unproven = [];
  for (const t of newTests) {
    const p = proofs[t];
    if (!p) { unproven.push(`${t} — 영수증 없음`); continue; }
    if (!p.allCaught) { unproven.push(`${t} — 못 잡은 변형이 있다`); continue; }
    // **묵은 영수증을 걸러낸다.** 테스트가 바뀌었으면 다시 증명해야 한다.
    if (p.testMd5 !== md5(join(ROOT, t))) unproven.push(`${t} — 영수증이 옛 판본 것이다`);
  }
  // 면제는 가능하되 **이유가 영수증에 남는다.** 조용히 건너뛸 수는 없다.
  const waivers = typeof args["guard-waiver"] === "string"
    ? args["guard-waiver"].split(";").map((s) => s.trim()).filter(Boolean)
    : [];
  const waivedFiles = new Set(waivers.map((w) => w.split(":")[0].trim()));
  const blocking = unproven.filter((u) => !waivedFiles.has(u.split(" — ")[0]));

  if (blocking.length) {
    console.error(`\n[verify] 새 검사를 깨뜨려 보지 않았다:`);
    blocking.forEach((u) => console.error(`    ${u}`));
    console.error(`\n  node scripts/prove-guard.mjs --test <파일> --target <대상> --find <문자열> --replace <문자열>`);
    console.error(`  초록불의 이유가 "찾는 방법이 고장 나서" 인 것을 이 저장소에서 여러 번 봤다.`);
    console.error(`  정말 깨뜨릴 수 없는 검사면 --guard-waiver "<파일>: <이유>" 로 이유를 남길 것.`);
    process.exit(1);
  }
  if (waivers.length) notes.push(`가드 증명 면제: ${waivers.join(" · ")}`);
  console.log(`\n[verify] 새 검사 ${newTests.length}개 — 전부 깨뜨려 본 영수증 있음`);
}

// ── 4) 관문 실행 — 범위는 위에서 기계적으로 정해졌다 ────────────────
console.log(`\n[verify] 관문 실행`);
if (touched.web) {
  results.typecheckWeb = run("typecheck-web", "npx", ["tsc", "--noEmit", "-p", "apps/web/tsconfig.json"], ROOT);
  // **전체를 돈다.** 바뀐 파일 근처만 고르면 오늘 같은 일이 또 난다.
  results.testWeb = run("test-web", "npx", ["vitest", "run"], join(ROOT, "apps", "web"));
}
// **각 패키지의 자기 `test` 스크립트를 부른다.**
//
// 여기는 `npx vitest run` 이 박혀 있었는데 `apps/mobile` 과 `packages/shared` 는
// 둘 다 vitest 를 쓰지 않는다(`node --test`). 그래서 그 두 폴더를 건드리는 변경은
// **코드와 무관하게 항상 실패**했고, 관문이 통과할 수 없으니 아무도 통과시키지
// 못했다. 2026-09-03 감사에서 확인하고, 안전 파일 수정이 여기 막혀서 고친다.
//
// 러너 이름을 여기 다시 적지 않는다 — 적는 순간 같은 어긋남이 다시 생긴다.
if (touched.mobile) {
  results.testMobile = run("test-mobile", "npx", ["pnpm", "--filter", "./apps/mobile", "test"], ROOT);
}
if (touched.shared) {
  results.testShared = run("test-shared", "npx", ["pnpm", "--filter", "./packages/shared", "test"], ROOT);
}
results.testRepo = run("test-repo", "npx", ["pnpm", "test:repo"], ROOT);

if (touched.migrations) {
  notes.push("마이그레이션이 바뀌었다 — 릴리스 매니페스트 sha256 과 Vercel 서명을 함께 갱신해야 프로덕션 빌드가 죽지 않는다.");
}

// ── 5) 영수증 ────────────────────────────────────────────────────
const failed = Object.entries(results).filter(([, r]) => !r.ok);
const receipt = {
  verifiedAt: new Date().toISOString(),
  base,
  head: git(["rev-parse", "HEAD"]).trim(),
  changedFiles: changed,
  scope: touched,
  safetyCriticalTouched: touchedSafety,
  gates: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.ok ? "pass" : "fail"])),
  provenGuards: newTests,
  notVerified,
  notes,
  verdict: failed.length === 0 ? "pass" : "fail",
};
writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

console.log(`\n[verify] 영수증: ${RECEIPT.replace(ROOT, ".")}`);
console.log(`  검증 못 한 것: ${notVerified.join(" · ")}`);
if (failed.length) {
  console.error(`\n판정: 실패 — ${failed.map(([k]) => k).join(", ")}`);
  console.error(`  "완료" 라고 말하지 말 것. 로그는 ${LOG_DIR.replace(ROOT, ".")} 에 있다.`);
  process.exit(1);
}
console.log(`\n판정: 통과 — 이제 완료라고 말해도 된다. 단 위의 "검증 못 한 것" 을 함께 말할 것.`);
