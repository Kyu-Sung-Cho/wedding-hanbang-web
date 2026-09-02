#!/usr/bin/env node
/**
 * **가드는 깨뜨려 봐야 센다 — 그 일을 손이 아니라 기계가 한다.**
 *
 * 새 테스트가 초록불인 이유는 두 가지다: 정말 지키고 있거나, **찾는 방법이
 * 고장 나서**다. 이 저장소는 후자를 여러 번 겪었다. 정규식에 `\b` 대신 백스페이스가
 * 박혀 있었고, 템플릿 리터럴이 `[\s\S]` 를 `[sS]` 로 조리했고, `.not.toMatch` 라
 * 무조건 통과했고, 주석 제거기가 위반을 대신 지웠다. 전부 초록불이었다.
 *
 * 그래서 규칙은 하나다: **위반을 심어 빨간불을 본 뒤에만 통과로 친다.**
 *
 * 손으로 하면 세 가지가 어긋난다. 실제로 다 당했다(2026-09-02):
 *   - `cd` 로 경로가 틀어져 **원본을 못 되돌린 채** 다음 작업을 이어갔다
 *   - 치환 정규식이 낡아 **파일을 안 고쳤는데** 초록불이 나왔다(no-op)
 *   - Windows cmd 가 `^` 를 먹어 **다른 커밋**을 재고 있었다
 *
 * 이 스크립트는 그 셋을 구조로 막는다. 경로는 전부 절대 경로, 치환은 정규식이
 * 아니라 **문자열 완전일치**, 변형 후 `md5` 가 그대로면 즉시 중단, 그리고 무슨 일이
 * 있어도 `finally` 에서 되돌리고 **되돌아왔음을 md5 로 증명**한다.
 *
 * 사용법:
 *   node scripts/prove-guard.mjs \
 *     --test  apps/web/src/lib/ai/__tests__/foo.test.ts \
 *     --target apps/web/src/lib/ai/foo.ts \
 *     --find  "const LIMIT = 3" \
 *     --replace "const LIMIT = 999"
 *
 * 여러 변형을 한 번에 증명하려면 `--cases <파일.json>` 을 쓴다:
 *   [{ "name": "…", "target": "…", "find": "…", "replace": "…" }]
 *
 * 통과 조건 (둘 다여야 한다):
 *   1. 변형 없이 테스트가 **통과**한다      — 지금 코드가 규칙을 지킨다
 *   2. 변형을 심으면 테스트가 **실패**한다  — 검사가 그 위반을 실제로 본다
 *
 * 통과하면 `.verification/guard-proofs.json` 에 영수증을 남긴다. 영수증은 대상
 * 파일의 해시를 함께 적으므로, 대상이 바뀌면 **묵은 영수증인 것이 드러난다**.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_DIR = join(ROOT, ".verification");
const RECEIPT = join(RECEIPT_DIR, "guard-proofs.json");

const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");
const abs = (p) => (isAbsolute(p) ? p : join(ROOT, p));
const rel = (p) => relative(ROOT, abs(p)).replace(/\\/g, "/");

function die(msg) {
  console.error(`\n[prove-guard] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? (i += 1, next) : true;
  }
  return out;
}

/**
 * 테스트를 돌리고 **통과 여부만** 돌려준다.
 *
 * 출력은 파일로 받는다. 파이프로 `tail` 에 넘기면 종료 코드가 `tail` 것이 되어
 * 실패를 성공으로 읽는다 — 2026-09-02 에 실제로 두 번 그럴 뻔했다.
 */
function runTest(testPath, logPath) {
  const isNodeTest = /\.mjs$/.test(testPath);
  const cwd = isNodeTest ? ROOT : join(ROOT, "apps", "web");
  const [cmd, args] = isNodeTest
    ? ["node", ["--test", abs(testPath)]]
    : ["npx", ["vitest", "run", relative(join(ROOT, "apps", "web"), abs(testPath)).replace(/\\/g, "/")]];

  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: "pipe",
      timeout: 15 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(logPath, out, "utf8");
    return true;
  } catch (err) {
    writeFileSync(logPath, `${err.stdout ?? ""}\n${err.stderr ?? ""}`, "utf8");
    // 타임아웃·크래시는 "실패" 로 셈하면 안 된다. 그러면 테스트가 아예 안 도는
    // 것을 "위반을 잡았다" 로 오독한다.
    if (err.killed || err.signal) die(`테스트가 죽었다(${err.signal ?? "timeout"}): ${testPath}`);
    return false;
  }
}

function loadCases(args) {
  if (args.cases) {
    const parsed = JSON.parse(readFileSync(abs(args.cases), "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) die("--cases 파일이 비었다.");
    return parsed;
  }
  if (!args.target || !args.find || args.replace === undefined) {
    die("--target · --find · --replace 가 모두 필요하다 (또는 --cases <파일>).");
  }
  return [{ name: "case-1", target: args.target, find: args.find, replace: args.replace }];
}

const args = parseArgs(process.argv.slice(2));
if (!args.test) die("--test <테스트 파일> 이 필요하다.");
const testPath = args.test;
if (!existsSync(abs(testPath))) die(`테스트 파일이 없다: ${testPath}`);

const cases = loadCases(args);
mkdirSync(RECEIPT_DIR, { recursive: true });
const logDir = join(RECEIPT_DIR, "logs");
mkdirSync(logDir, { recursive: true });

// ── 1) 변형 없이 통과하는가 ────────────────────────────────────────
console.log(`[prove-guard] ${rel(testPath)}`);
console.log(`  1/2 변형 없이 …`);
const cleanLog = join(logDir, "clean.log");
if (!runTest(testPath, cleanLog)) {
  die(`변형도 없이 실패한다. 먼저 초록불을 만들 것.\n  로그: ${rel(cleanLog)}`);
}
console.log(`      통과`);

// ── 2) 각 변형이 빨간불을 내는가 ──────────────────────────────────
const proofs = [];
for (const [i, c] of cases.entries()) {
  const name = c.name ?? `case-${i + 1}`;
  const targetAbs = abs(c.target);
  if (!existsSync(targetAbs)) die(`대상 파일이 없다: ${c.target}`);

  const before = md5(targetAbs);

  // **원본을 메모리에 쥔다.** 디스크 백업만 믿으면 안 된다 — 2026-09-02 에
  // 실제로 당했다. 변형 중에 돌린 테스트가 하위 프로세스로 저장소를 훑다가
  // 백업 디렉터리를 지웠고, `finally` 의 copyFile 이 ENOENT 로 죽어 **대상 파일이
  // 사보타주된 채 남았다.** 복원이 외부 상태에 기대면 복원이 아니다.
  const originalBytes = readFileSync(targetAbs);
  const backup = join(RECEIPT_DIR, `.backup-${i}`);
  writeFileSync(backup, originalBytes);

  // 프로세스가 중간에 죽어도 되돌린다(Ctrl+C·예외·타임아웃).
  const emergencyRestore = () => {
    try {
      if (md5(targetAbs) !== before) writeFileSync(targetAbs, originalBytes);
    } catch { /* 여기서 더 할 수 있는 것이 없다 */ }
  };
  process.once("exit", emergencyRestore);
  process.once("SIGINT", () => { emergencyRestore(); process.exit(130); });

  let caught = false;
  let mutatedHash = null;
  try {
    const source = originalBytes.toString("utf8");
    // **정규식이 아니라 문자열 완전일치.** 정규식은 낡으면 조용히 아무것도
    // 안 고치고, 그 no-op 이 "가드가 잡았다" 로 읽힌다.
    const occurrences = source.split(c.find).length - 1;
    if (occurrences === 0) {
      die(`[${name}] --find 문자열이 ${rel(c.target)} 에 없다. 변형이 일어나지 않는다.\n  찾은 것: ${JSON.stringify(c.find).slice(0, 120)}`);
    }
    const mutated = source.split(c.find).join(c.replace);
    // 줄끝을 바꾸지 않도록 원문을 그대로 이어 붙인 결과만 쓴다.
    writeFileSync(targetAbs, mutated, "utf8");

    mutatedHash = md5(targetAbs);
    if (mutatedHash === before) {
      die(`[${name}] 변형 후에도 파일이 그대로다(no-op). find/replace 가 같은 값일 수 있다.`);
    }

    console.log(`  2/2 [${name}] 변형 ${occurrences}곳 심고 …`);
    const mutLog = join(logDir, `mutated-${i}.log`);
    caught = !runTest(testPath, mutLog);
    console.log(`      ${caught ? "빨간불 — 검사가 위반을 본다" : "!! 초록불 — 검사가 이 위반을 못 본다"}`);
    if (!caught) console.log(`      로그: ${rel(mutLog)}`);
  } finally {
    // 메모리에 쥔 원본으로 되돌린다. 디스크 백업은 참고용이다.
    writeFileSync(targetAbs, originalBytes);
    try { if (existsSync(backup)) unlinkSync(backup); } catch { /* 지워졌으면 그만 */ }
    const after = md5(targetAbs);
    if (after !== before) {
      console.error(`\n!! [${name}] 원복 실패 — md5 불일치 (${before} → ${after}). 손으로 확인할 것.`);
      process.exit(3);
    }
  }

  proofs.push({
    case: name,
    target: rel(c.target),
    targetMd5: before,
    mutatedMd5: mutatedHash,
    find: c.find.length > 200 ? `${c.find.slice(0, 200)}…` : c.find,
    caught,
  });
}

// ── 3) 영수증 ────────────────────────────────────────────────────
const failed = proofs.filter((p) => !p.caught);
const receipt = existsSync(RECEIPT) ? JSON.parse(readFileSync(RECEIPT, "utf8")) : {};
receipt[rel(testPath)] = {
  provenAt: new Date().toISOString(),
  testMd5: md5(abs(testPath)),
  proofs,
  allCaught: failed.length === 0,
};
writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

console.log(`\n[prove-guard] 변형 ${proofs.length}개 중 잡은 것 ${proofs.length - failed.length}개`);
console.log(`  영수증: ${rel(RECEIPT)}`);
if (failed.length) {
  console.error(`\n못 잡은 변형 ${failed.length}개 — 이 검사는 그 위반을 막지 못한다:`);
  failed.forEach((p) => console.error(`  ${p.case}  ${p.target}`));
  process.exit(1);
}
console.log(`  판정: 이 검사는 심은 위반을 전부 잡는다.`);
