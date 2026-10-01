#!/usr/bin/env node
/**
 * 웨딩코드 4.1 단계 2 의 **가드 증명 운전 스크립트**(빌드 계획 11.4, AD21).
 *
 * `scripts/verify-change.mjs` 는 새로 더한 시험 파일(*.test.ts, *.test.tsx, *.test.mjs) **하나하나**에 깨뜨려 본 영수증(.verification/guard-proofs.json)이
 * 있고 allCaught 이며 testMd5 가 지금 파일과 같아야 종료 코드 0 을 낸다. 시험 파일이 서른 개를 넘으면 손으로는 못 돈다.
 * 그래서 각 트랙이 시험 파일마다 변형 파일 `scripts/wedding-code-v41-proof-cases/<트랙>/<시험 파일 이름>.json`
 * (형식은 prove-guard 의 --cases 와 같다: [{ name, target, find, replace }])을 내고, 이 스크립트가 그것을 읽어 prove-guard 를 **직렬로** 돈다.
 *
 * 시험 파일 경로는 json 안에 없다. 파일 이름(json 에서 .json 을 뗀 것)으로 저장소에서 찾고, 같은 이름이 둘이면 멈춘다.
 *
 * 사용법 (저장소 루트에서):
 *   node scripts/wedding-code-v41-prove-all.mjs                 보고만 한다(기본, 아무것도 바꾸지 않는다). 종료 코드 1 이면 verify-change 가 막힌다.
 *   node scripts/wedding-code-v41-prove-all.mjs --run           영수증이 없거나 낡거나 못 잡은 시험만 prove-guard 로 돈다. 영수증이 이미 맞으면 건너뛴다(중간에 죽어도 이어 돈다).
 *   node scripts/wedding-code-v41-prove-all.mjs --run --all     모든 시험을 다시 돈다(통합 트리: 트랙 영수증을 믿지 않는다. 시험이 기대는 공유 파일이 바뀌었을 수 있다).
 *   node scripts/wedding-code-v41-prove-all.mjs --only <글자>   경로에 이 글자가 든 시험만(보고와 --run 모두).
 *   node scripts/wedding-code-v41-prove-all.mjs --strict        대상 파일이 영수증 뒤에 바뀐 것(target-changed)도 막힘으로 센다.
 *   node scripts/wedding-code-v41-prove-all.mjs --pr-evidence   PR 본문에 싣는 증거(엔진 열 개, 처리방침 정제 세 파일, 고정 시험 다섯의 git diff)를 출력한다. 하나라도 바뀌었으면 종료 코드 1.
 *   node scripts/wedding-code-v41-prove-all.mjs --self-check    이 스크립트의 판정 함수를 표본으로 시험한다(저장소를 건드리지 않는다).
 *
 * 옵션: --base <ref>(새 시험 파일을 찾는 기준, 기본 origin/main) --lock-dir <디렉터리>(같은 작업 트리에서 prove-guard 를 도는 다른 프로세스와 같은 잠금을 쓰게 한다)
 *       --cases-dir <디렉터리>(기본 scripts/wedding-code-v41-proof-cases) --receipt <파일>(기본 .verification/guard-proofs.json)
 *
 * 왜 직렬인가: prove-guard 는 대상 파일을 잠깐 바꿔 놓고 시험을 돌린다. 같은 작업 트리에서 둘이 동시에 돌면 서로의 변형을 보고 거짓 빨간불이 나고,
 * 같은 영수증 파일을 읽고 쓰는 사이가 겹친다. 이 스크립트는 디렉터리 하나를 잠금으로 삼는다.
 * 출력은 파일(.verification/prove-all-logs)로 받는다: 파이프로 tail 에 넘기면 종료 코드가 tail 의 것이 되어 실패를 성공으로 읽는다.
 *
 * 이 스크립트가 못 하는 것: 변형이 **옳은 이유로** 빨개졌는지는 보지 않는다(prove-guard 는 시험 파일이 실패했는지만 안다). 규칙마다 어느 시험이 빨개졌는지는 로그(.verification/logs)를 읽어야 한다.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const posix = (p) => p.split("\\").join("/");
const md5Text = (text) => createHash("md5").update(text).digest("hex");
const md5File = (abs) => createHash("md5").update(readFileSync(abs)).digest("hex");

/** 4.1 단계 2 의 기준 커밋. 엔진과 정제 파일이 이 커밋과 한 줄도 다르지 않아야 한다(--pr-evidence). */
export const STAGE2_BASE_COMMIT = "5ac9eda24";

/** 엔진 열 개 파일(빌드 계획 14.4). 한 줄도 바뀌지 않는다. */
export const ENGINE_FILES = [
  "apps/web/src/lib/weddingCode/v40/flow.ts",
  "apps/web/src/lib/weddingCode/v40/codec.ts",
  "apps/web/src/lib/weddingCode/v40/score.ts",
  "apps/web/src/lib/weddingCode/v40/gates.ts",
  "apps/web/src/lib/weddingCode/v40/value.ts",
  "apps/web/src/lib/weddingCode/v40/states.ts",
  "apps/web/src/lib/weddingCode/v40/layout.ts",
  "apps/web/src/lib/weddingCode/v40/bank.ts",
  "apps/web/src/constants/weddingCodeV40Bank.ts",
  "scripts/lib/wedding-code-v40-ref.mjs",
];
/** 주소 꼬리 정제와 이용 통계 허용 목록(이 PR 이 바꾸지 않는다). */
export const PRIVACY_INFRA_FILES = [
  "packages/shared/src/safety/sentryScrub.ts",
  "apps/web/src/lib/analyticsPrivacy.ts",
  "apps/web/src/instrumentation-client.ts",
];
/** 수정 0줄이 목표인 고정 클라이언트 시험 다섯(단계를 끈 testKit 기본값이 옛 흐름을 그대로 돌린다). */
export const PINNED_CLIENT_TESTS = ["interaction", "linked", "history", "privacy", "review"].map((name) => `apps/web/src/app/wedding-code/WeddingCodeV40Client.${name}.test.tsx`);
/** 줄을 더하기만 하는 파일(삭제 0줄). */
export const ADD_ONLY_FILES = ["apps/web/src/constants/weddingCodeV40.ts"];

// ---------------------------------------------------------------------------
// 순수 판정 (--self-check 가 표본으로 시험한다)
// ---------------------------------------------------------------------------

export const caseFileTestName = (caseFile) => basename(caseFile).replace(/\.json$/u, "");

const isTestName = (name) => /\.test\.(?:ts|tsx|mjs)$/u.test(name);

/** 같은 이름의 시험 파일이 저장소에 몇 개인가. files 는 저장소 상대 경로의 목록. */
export function resolveTestPath(testName, files) {
  const found = files.map(posix).filter((file) => basename(file) === testName);
  if (found.length === 1) return { path: found[0] };
  return found.length === 0 ? { error: "저장소에서 이 이름의 시험 파일을 찾지 못했다" } : { error: `같은 이름의 시험 파일이 ${found.length}개다: ${found.join(", ")}` };
}

/**
 * 한 시험 파일의 영수증 상태.
 *   ok             영수증이 있고 allCaught 이고 testMd5 가 지금 파일과 같고 변형 수가 맞고 대상 파일도 영수증 때와 같다.
 *   target-changed 영수증은 맞지만 변형을 심은 대상 파일이 영수증 뒤에 바뀌었다(통합자가 공유 파일을 바꿨을 수 있다. 다시 돌릴 것).
 *   cases-changed  변형 파일의 내용(변형 이름과 찾는 글)이 영수증과 다르다.
 *   missing        영수증이 없다.   stale  시험 파일이 영수증 뒤에 바뀌었다.   uncaught  못 잡은 변형이 있다.
 * missing, stale, uncaught, cases-changed 는 verify-change 를 막는다(앞의 셋). target-changed 는 --strict 일 때만 막힘으로 센다.
 */
export function classifyReceipt({ receipt, cases, testMd5, targetMd5Of }) {
  if (!receipt) return { state: "missing" };
  if (receipt.testMd5 !== testMd5) return { state: "stale", why: "시험 파일이 영수증 뒤에 바뀌었다" };
  const proofs = Array.isArray(receipt.proofs) ? receipt.proofs : [];
  if (receipt.allCaught !== true || proofs.some((proof) => proof.caught !== true)) return { state: "uncaught", why: `못 잡은 변형 ${proofs.filter((proof) => proof.caught !== true).length}개` };
  if (proofs.length !== cases.length) return { state: "cases-changed", why: `영수증의 변형 ${proofs.length}개, 변형 파일 ${cases.length}개` };
  for (const [index, c] of cases.entries()) {
    const proof = proofs[index];
    const want = c.find.length > 200 ? `${c.find.slice(0, 200)}…` : c.find;
    if (proof.case !== (c.name ?? `case-${index + 1}`) || proof.find !== want || proof.target !== posix(c.target)) {
      return { state: "cases-changed", why: `${index + 1}번째 변형이 영수증과 다르다(${c.name ?? `case-${index + 1}`})` };
    }
  }
  for (const proof of proofs) {
    const now = targetMd5Of(proof.target);
    if (now !== proof.targetMd5) return { state: "target-changed", why: `${proof.target} 가 영수증 뒤에 바뀌었다(변형 「${proof.case}」)` };
  }
  return { state: "ok" };
}

/** 막힘(verify-change 를 막는) 상태인가. strict 이면 target-changed 도 막힘이다. */
export const isBlocking = (state, strict = false) => ["missing", "stale", "uncaught", "cases-changed", "no-cases", "bad-cases", "ambiguous", "not-found"].includes(state) || (strict && state === "target-changed");

/** 변형 파일의 모양과 find 가 대상 파일에 정확히 한 번 나오는지 본다. readText(경로) 는 글 또는 null. 문제 목록을 돌려준다. */
export function caseProblems(cases, readText) {
  if (!Array.isArray(cases) || cases.length === 0) return ["변형 파일이 비었다(배열이고 변형이 하나 이상이어야 한다)"];
  const problems = [];
  for (const [index, c] of cases.entries()) {
    const label = `${index + 1}번째 변형(${c?.name ?? "이름 없음"})`;
    if (!c || typeof c.target !== "string" || typeof c.find !== "string" || typeof c.replace !== "string" || c.find === "") {
      problems.push(`${label}: name, target, find, replace 가 문자열이 아니거나 find 가 비었다`);
      continue;
    }
    if (c.find === c.replace) {
      problems.push(`${label}: find 와 replace 가 같다(아무것도 심지 않는다)`);
      continue;
    }
    const text = readText(c.target);
    if (text === null) problems.push(`${label}: 대상 파일이 없다 ${c.target}`);
    else {
      const count = text.split(c.find).length - 1;
      if (count !== 1) problems.push(`${label}: find 가 ${c.target} 에 ${count}번 나온다(정확히 한 번이어야 한다)`);
    }
  }
  return problems;
}

/** `git diff --numstat` 의 줄을 읽는다. 이진 파일은 -\t- 이다. */
export function parseNumstat(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const [added, deleted, ...rest] = line.split("\t");
    rows.push({ path: posix(rest.join("\t")), added: added === "-" ? Number.NaN : Number(added), deleted: deleted === "-" ? Number.NaN : Number(deleted) });
  }
  return rows;
}

/** 증거 보고서가 요구하는 것을 지켰는가. rows 는 parseNumstat 결과. 어긴 것의 문장 목록을 돌려준다. */
export function evidenceProblems(rows, { frozen, addOnly }) {
  const problems = [];
  const byPath = new Map(rows.map((row) => [row.path, row]));
  for (const path of frozen) {
    const row = byPath.get(path);
    if (row && (row.added !== 0 || row.deleted !== 0)) problems.push(`${path}: 더한 줄 ${row.added}, 지운 줄 ${row.deleted} (0줄이어야 한다)`);
  }
  for (const path of addOnly) {
    const row = byPath.get(path);
    if (row && row.deleted !== 0) problems.push(`${path}: 지운 줄 ${row.deleted} (줄을 더하기만 해야 한다)`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 저장소 읽기
// ---------------------------------------------------------------------------

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false, maxBuffer: 256 * 1024 * 1024 });

function walkJson(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

function listRepoTestFiles() {
  const tracked = git(["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").map((line) => line.trim()).filter(Boolean);
  return [...new Set(tracked.filter((file) => isTestName(file) && existsSync(join(ROOT, file))))];
}

/** 새로 더한 시험 파일(verify-change 가 영수증을 요구하는 것과 같은 정의): base...HEAD 에서 추가된 것과 추적하지 않는 것. */
function listNewTestFiles(base) {
  const addedBy = (args) => {
    try {
      return git(["diff", "--name-status", ...args]).split("\n").filter((line) => line.startsWith("A\t")).map((line) => line.slice(2).trim());
    } catch {
      return [];
    }
  };
  const added = [...addedBy([`${base}...HEAD`]), ...addedBy(["--cached"])];
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").map((line) => line.trim()).filter(Boolean);
  return [...new Set([...added, ...untracked])].filter((file) => isTestName(file) && existsSync(join(ROOT, file)));
}

const readRepoText = (path) => {
  const abs = join(ROOT, path);
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : null;
};
const targetMd5Of = (path) => {
  const abs = join(ROOT, path);
  return existsSync(abs) ? md5File(abs) : null;
};

// ---------------------------------------------------------------------------
// 잠금 (같은 작업 트리에서 prove-guard 둘이 동시에 돌지 않게)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function acquireLock(lockDir, label) {
  const staleMs = 30 * 60 * 1000;
  const maxWaitMs = 120 * 60 * 1000;
  const started = Date.now();
  let announced = false;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now(), cmd: label }));
      return () => rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"));
        stale = !processAlive(owner.pid) || Date.now() - owner.at > staleMs;
      } catch {
        try {
          stale = Date.now() - statSync(lockDir).mtimeMs > 60_000;
        } catch {
          stale = true;
        }
      }
      if (stale) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (!announced) {
        console.error(`[prove-all] 다른 prove-guard 가 돌고 있다(${lockDir}). 끝날 때까지 기다린다.`);
        announced = true;
      }
      if (Date.now() - started > maxWaitMs) throw new Error("잠금을 너무 오래 기다렸다");
      await sleep(2000 + Math.floor(Math.random() * 1500));
    }
  }
}

// ---------------------------------------------------------------------------
// 보고와 실행
// ---------------------------------------------------------------------------

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

/** 변형 파일 하나를 읽어 시험 파일에 짝짓고 영수증 상태를 낸다. */
function inspectEntry(caseFileAbs, { casesDir, files, receipts }) {
  const caseFile = posix(relative(ROOT, caseFileAbs));
  const testName = caseFileTestName(caseFileAbs);
  const resolved = resolveTestPath(testName, files);
  const entry = { caseFile, testName, casesRel: caseFile, track: posix(relative(casesDir, caseFileAbs)).split("/")[0] };
  if (resolved.error) return { ...entry, state: resolved.error.startsWith("같은 이름") ? "ambiguous" : "not-found", why: resolved.error };
  entry.testPath = resolved.path;
  let cases;
  try {
    cases = JSON.parse(readFileSync(caseFileAbs, "utf8"));
  } catch (error) {
    return { ...entry, state: "bad-cases", why: `변형 파일을 읽지 못했다: ${error.message}` };
  }
  const problems = caseProblems(cases, readRepoText);
  if (problems.length > 0) return { ...entry, state: "bad-cases", why: problems.join("; "), cases };
  const result = classifyReceipt({ receipt: receipts[resolved.path], cases, testMd5: md5File(join(ROOT, resolved.path)), targetMd5Of });
  return { ...entry, ...result, cases };
}

function runProveGuard(entry, receiptPath, logDir, ordinal) {
  const logPath = join(logDir, `${String(ordinal).padStart(2, "0")}-${entry.testName}.log`);
  const args = [join(ROOT, "scripts", "prove-guard.mjs"), "--test", entry.testPath, "--cases", entry.casesRel];
  if (receiptPath !== null) args.push("--receipt", receiptPath);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 3 * 60 * 60 * 1000 });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, "utf8");
  return { status: result.status, signal: result.signal, seconds: Math.round((Date.now() - started) / 1000), log: posix(relative(ROOT, logPath)) };
}

function readReceipts(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["self-check"]) return selfCheck();
  if (args["pr-evidence"]) return prEvidence();

  const base = typeof args.base === "string" ? args.base : "origin/main";
  const casesDir = resolve(ROOT, typeof args["cases-dir"] === "string" ? args["cases-dir"] : "scripts/wedding-code-v41-proof-cases");
  const receiptPath = resolve(ROOT, typeof args.receipt === "string" ? args.receipt : ".verification/guard-proofs.json");
  const customReceipt = typeof args.receipt === "string" ? receiptPath : null;
  const only = typeof args.only === "string" ? args.only : null;
  const strict = args.strict === true;
  const lockDir = resolve(ROOT, typeof args["lock-dir"] === "string" ? args["lock-dir"] : ".verification/.prove-all-lock");
  const files = listRepoTestFiles();
  const caseFiles = walkJson(casesDir).filter((file) => only === null || posix(file).includes(only));
  if (caseFiles.length === 0) {
    console.error(`[prove-all] 변형 파일이 없다: ${posix(relative(ROOT, casesDir))}${only === null ? "" : ` (--only ${only})`}`);
    return 1;
  }

  let receipts = readReceipts(receiptPath);
  let entries = caseFiles.map((file) => inspectEntry(file, { casesDir, files, receipts }));

  if (args.run) {
    const runnable = (entry) => Boolean(entry.testPath && entry.cases) && !["ambiguous", "not-found", "bad-cases"].includes(entry.state);
    const todo = entries.filter((entry) => runnable(entry) && (args.all === true || entry.state !== "ok"));
    const skipped = entries.length - todo.length;
    console.log(`[prove-all] 시험 ${entries.length}개 중 ${todo.length}개를 prove-guard 로 돈다(영수증이 맞아 건너뛰는 것 ${skipped}개${args.all === true ? ", --all 이라 전부 다시 돈다" : ""}).`);
    mkdirSync(join(ROOT, ".verification"), { recursive: true });
    const logDir = join(ROOT, ".verification", "prove-all-logs");
    mkdirSync(logDir, { recursive: true });
    if (todo.length > 0) {
      const release = await acquireLock(lockDir, `prove-all ${process.pid}`);
      // 한 번만 푼다: 끝난 뒤 프로세스가 내려가는 길에서 또 풀면 그사이 다른 프로세스가 잡은 잠금을 지울 수 있다.
      let released = false;
      const cleanup = () => {
        if (released) return;
        released = true;
        release();
      };
      process.once("exit", cleanup);
      process.once("SIGINT", () => {
        cleanup();
        process.exit(130);
      });
      try {
        for (const [index, entry] of todo.entries()) {
          process.stdout.write(`  (${index + 1}/${todo.length}) ${entry.testPath} … `);
          const run = runProveGuard(entry, customReceipt, logDir, index + 1);
          console.log(run.status === 0 ? `통과 (${run.seconds}초)` : `실패 status=${run.status ?? run.signal} (${run.seconds}초) → ${run.log}`);
        }
      } finally {
        cleanup();
      }
    }
    receipts = readReceipts(receiptPath);
    entries = caseFiles.map((file) => inspectEntry(file, { casesDir, files, receipts }));
  }

  // --only 로 걸러 낸 변형 파일의 시험도 「변형 파일이 있는 시험」이다(걸러 냈다고 변형 파일 없음으로 세지 않는다).
  const covered = new Set(walkJson(casesDir).map((file) => resolveTestPath(caseFileTestName(file), files).path).filter(Boolean));
  return report(entries, { base, strict, files, covered });
}

function report(entries, { base, strict, files, covered }) {
  const label = { ok: "맞음", "target-changed": "대상 바뀜", "cases-changed": "변형 바뀜", missing: "영수증 없음", stale: "시험 바뀜", uncaught: "못 잡음", "no-cases": "변형 파일 없음", "bad-cases": "변형 파일 오류", ambiguous: "이름 겹침", "not-found": "시험 없음" };
  let blocking = 0;
  const counts = {};
  for (const entry of entries) {
    counts[entry.state] = (counts[entry.state] ?? 0) + 1;
    const blocks = isBlocking(entry.state, strict);
    if (blocks) blocking += 1;
    if (entry.state !== "ok") console.log(`  [${label[entry.state] ?? entry.state}${blocks ? ", 막힘" : ""}] ${entry.testPath ?? entry.testName}${entry.why ? ` — ${entry.why}` : ""}`);
  }
  // 새로 더한 시험 파일인데 변형 파일이 없는 것(verify-change 가 영수증이 없다고 막는다).
  const orphans = listNewTestFiles(base).filter((file) => !covered.has(posix(file)));
  for (const file of orphans) {
    counts["no-cases"] = (counts["no-cases"] ?? 0) + 1;
    blocking += 1;
    console.log(`  [변형 파일 없음, 막힘] ${posix(file)} — 새 시험 파일인데 ${posix(relative(ROOT, resolve(ROOT, "scripts/wedding-code-v41-proof-cases")))}/<트랙>/${basename(file)}.json 이 없다(깨뜨릴 대상이 정말 없으면 verify-change 에 --guard-waiver "<파일>: <이유>")`);
  }
  const summary = Object.entries(counts).map(([state, n]) => `${label[state] ?? state} ${n}`).join(", ");
  console.log(`[prove-all] 시험 ${entries.length}개(저장소의 시험 파일 ${files.length}개 가운데): ${summary}. 막힘 ${blocking}개.`);
  if (blocking > 0) console.log("  다음 걸음: node scripts/wedding-code-v41-prove-all.mjs --run (통합 트리에서는 --all)");
  return blocking === 0 ? 0 : 1;
}

function prEvidence() {
  const pathsOf = (list) => list.map((path) => `"${path}"`).join(" ");
  const frozen = [...ENGINE_FILES, ...PRIVACY_INFRA_FILES, ...PINNED_CLIENT_TESTS];
  const numstat = parseNumstat(git(["diff", "--numstat", STAGE2_BASE_COMMIT, "--", ...frozen, ...ADD_ONLY_FILES]));
  const stat = git(["diff", "--stat", STAGE2_BASE_COMMIT, "--", ...frozen, ...ADD_ONLY_FILES]).trim();
  console.log(`## 엔진과 정제 파일이 바뀌지 않았다는 증거 (기준 ${STAGE2_BASE_COMMIT})`);
  console.log("");
  console.log("```text");
  console.log(`git diff --stat ${STAGE2_BASE_COMMIT} -- ${pathsOf(ENGINE_FILES)}`);
  console.log(`git diff --stat ${STAGE2_BASE_COMMIT} -- ${pathsOf(PRIVACY_INFRA_FILES)}`);
  console.log(`git diff --stat ${STAGE2_BASE_COMMIT} -- ${pathsOf(PINNED_CLIENT_TESTS)}`);
  console.log(`git diff --numstat ${STAGE2_BASE_COMMIT} -- ${pathsOf(ADD_ONLY_FILES)}`);
  console.log("");
  console.log(stat === "" ? "(출력 없음: 위 열여덟 파일은 기준 커밋과 한 줄도 다르지 않다)" : stat);
  console.log("```");
  const problems = evidenceProblems(numstat, { frozen, addOnly: ADD_ONLY_FILES });
  if (problems.length === 0) {
    console.log("");
    console.log(`엔진 ${ENGINE_FILES.length}개, 정제와 통계 허용 목록 ${PRIVACY_INFRA_FILES.length}개, 고정 클라이언트 시험 ${PINNED_CLIENT_TESTS.length}개는 0줄이고, ${ADD_ONLY_FILES.join(", ")} 은 줄을 더하기만 했다.`);
    return 0;
  }
  console.error("");
  for (const problem of problems) console.error(`[prove-all] ${problem}`);
  return 1;
}

// ---------------------------------------------------------------------------
// 자가 점검: 판정 함수를 답을 아는 표본으로 잰다
// ---------------------------------------------------------------------------

function selfCheck() {
  let failed = 0;
  const check = (name, actual, expected) => {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (!same) {
      failed += 1;
      console.error(`  실패: ${name}\n    기대 ${JSON.stringify(expected)}\n    실제 ${JSON.stringify(actual)}`);
    }
  };
  const cases = [
    { name: "a", target: "src/a.ts", find: "one", replace: "two" },
    { name: "b", target: "src/b.ts", find: "x".repeat(300), replace: "y" },
  ];
  const good = {
    testMd5: "T",
    allCaught: true,
    proofs: [
      { case: "a", target: "src/a.ts", targetMd5: "A", find: "one", caught: true },
      { case: "b", target: "src/b.ts", targetMd5: "B", find: `${"x".repeat(200)}…`, caught: true },
    ],
  };
  const md5s = { "src/a.ts": "A", "src/b.ts": "B" };
  const classify = (receipt, testMd5 = "T", cs = cases, targets = md5s) => classifyReceipt({ receipt, cases: cs, testMd5, targetMd5Of: (path) => targets[path] ?? null }).state;
  check("맞는 영수증", classify(good), "ok");
  check("영수증 없음", classify(undefined), "missing");
  check("시험 파일이 바뀜", classify(good, "T2"), "stale");
  check("못 잡은 변형", classify({ ...good, allCaught: false }), "uncaught");
  check("한 변형만 못 잡음", classify({ ...good, proofs: [good.proofs[0], { ...good.proofs[1], caught: false }] }), "uncaught");
  check("allCaught 가 참이어도 변형 하나가 못 잡았으면 못 잡음", classify({ ...good, allCaught: true, proofs: [{ ...good.proofs[0], caught: false }, good.proofs[1]] }), "uncaught");
  check("변형이 늘었다", classify(good, "T", [...cases, { name: "c", target: "src/a.ts", find: "o", replace: "p" }]), "cases-changed");
  check("변형의 찾는 글이 바뀜", classify(good, "T", [{ ...cases[0], find: "uno" }, cases[1]]), "cases-changed");
  check("변형 이름이 바뀜", classify(good, "T", [{ ...cases[0], name: "z" }, cases[1]]), "cases-changed");
  check("대상 파일이 바뀜", classify(good, "T", cases, { ...md5s, "src/b.ts": "B2" }), "target-changed");
  check("대상 파일이 없어짐", classify(good, "T", cases, { "src/a.ts": "A" }), "target-changed");
  check("target-changed 는 기본으로 막지 않고 strict 에서만 막는다", [isBlocking("target-changed"), isBlocking("target-changed", true)], [false, true]);
  check("missing, stale, uncaught 는 막는다", ["missing", "stale", "uncaught", "cases-changed", "no-cases"].map((state) => isBlocking(state)), [true, true, true, true, true]);
  check("ok 는 막지 않는다", isBlocking("ok", true), false);

  check("시험 파일 이름으로 찾기", resolveTestPath("a.test.ts", ["x/a.test.ts", "x/b.test.ts"]), { path: "x/a.test.ts" });
  check("같은 이름이 둘", resolveTestPath("a.test.ts", ["x/a.test.ts", "y/a.test.ts"]).error?.startsWith("같은 이름의 시험 파일이 2개다"), true);
  check("이름이 없다", typeof resolveTestPath("a.test.ts", ["x/b.test.ts"]).error, "string");
  check("윈도 경로도 같은 이름으로 본다", resolveTestPath("a.test.ts", ["x\\a.test.ts"]), { path: "x/a.test.ts" });
  check("변형 파일 이름에서 시험 이름", caseFileTestName("scripts/p/guess/GuessSetFlow.test.tsx.json"), "GuessSetFlow.test.tsx");

  const text = { "src/a.ts": "one two", "src/b.ts": "no match" };
  const read = (path) => (path in text ? text[path] : null);
  check("정상 변형", caseProblems([cases[0]], read), []);
  check("find 가 두 번 나옴", caseProblems([{ ...cases[0], find: "o" }], read).length, 1);
  check("find 가 안 나옴", caseProblems([cases[1]], read).length, 1);
  check("대상 파일이 없음", caseProblems([{ ...cases[0], target: "src/none.ts" }], read).length, 1);
  check("find 와 replace 가 같음", caseProblems([{ ...cases[0], replace: "one" }], read).length, 1);
  check("빈 배열", caseProblems([], read).length, 1);
  check("모양이 틀림", caseProblems([{ name: "x", target: "src/a.ts", find: 3, replace: "y" }], read).length, 1);

  const rows = parseNumstat("0\t0\ta.ts\n3\t0\tb.ts\n2\t1\tc.ts\n-\t-\timg.png\n");
  check("numstat 읽기", rows.map((row) => [row.path, row.added, row.deleted]).slice(0, 3), [["a.ts", 0, 0], ["b.ts", 3, 0], ["c.ts", 2, 1]]);
  check("얼린 파일이 0줄", evidenceProblems(parseNumstat("0\t0\ta.ts\n"), { frozen: ["a.ts"], addOnly: [] }), []);
  check("얼린 파일에 줄이 더해짐", evidenceProblems(parseNumstat("1\t0\ta.ts\n"), { frozen: ["a.ts"], addOnly: [] }).length, 1);
  check("얼린 파일에서 줄이 지워짐", evidenceProblems(parseNumstat("0\t2\ta.ts\n"), { frozen: ["a.ts"], addOnly: [] }).length, 1);
  check("더하기만 하는 파일은 더해도 된다", evidenceProblems(parseNumstat("2\t0\tk.ts\n"), { frozen: [], addOnly: ["k.ts"] }), []);
  check("더하기만 하는 파일에서 지우면 안 된다", evidenceProblems(parseNumstat("2\t1\tk.ts\n"), { frozen: [], addOnly: ["k.ts"] }).length, 1);
  check("바뀐 줄이 없는 파일은 numstat 에 안 나온다", evidenceProblems([], { frozen: ["a.ts"], addOnly: ["k.ts"] }), []);
  check("md5 도우미", md5Text("a"), "0cc175b9c0f1b6a831c399e269772661");

  if (failed === 0) console.log("[prove-all] 자가 점검 통과");
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && posix(resolve(process.argv[1])).toLowerCase() === posix(fileURLToPath(import.meta.url)).toLowerCase()) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[prove-all] ${error?.message ?? error}`);
      process.exit(2);
    },
  );
}
