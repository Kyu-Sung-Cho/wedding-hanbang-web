#!/usr/bin/env node
/**
 * **바꾸기 전과 나란히 재서 차이를 센다.**
 *
 * 2026-09-02: 안전 갈래를 넓히고 "오탐 0" 이라고 보고했는데, 이전 버전과 나란히
 * 재보니 평범한 문장 오탐이 1→15 였다. 내 코퍼스만으로는 절대 안 보였다. 같은
 * 이틀에 같은 병으로 회귀를 셋 만들었다.
 *
 * 손으로 할 때 두 번 사고가 났다 — `cd` 때문에 상대 경로가 틀어져 원본을 못
 * 되돌렸고(파일이 옛 버전인 채로 남았다), 정규식이 낡아 파일을 안 고쳤는데
 * 초록불이 나왔다. 그래서 절차를 스크립트로 굳힌다:
 *
 *   - 경로는 전부 절대 경로
 *   - 바꾸기 전에 md5 를 찍고, 끝나면 대조해서 원복을 **증명**한다
 *   - 변형이 실제로 파일을 바꿨는지 `cmp` 로 먼저 확인한다(no-op 이면 중단)
 *   - 예외가 나도 finally 에서 반드시 되돌린다
 *
 * 사용법:
 *   node scripts/scope-delta.mjs <base-ref> <corpus.json> [--out <증거.json>]
 *
 * **이 도구 자신이 조용히 틀리던 두 자리(2026-09-18 고침).**
 *   - `--out` 없이 부르면 첫 인자(base)를 지워 "인자가 부족하다" 로 죽었다. 위 사용법
 *     그대로는 한 번도 돌지 않았다.
 *   - `amoraQuestionScope.ts` 한 파일만 base 판본으로 바꾸고 그 파일의 해시로 "판정기가
 *     동일하다" 를 정했다. 위기 판정의 본체는 `packages/shared/src/safety` 에 있어서, 공유
 *     판정기만 고치면 base 측정도 **고친 판정기로** 돌았다 — base == head 가 되어 "동일 —
 *     분류 결과는 바뀔 수 없다 · 달라진 판정 0" 이 찍혔다. 이제 `SAFETY_FILES` 전체를 base
 *     판본으로 함께 바꿔 재고, 파일마다 md5 로 원복을 증명한다.
 *   - 검사는 `scripts/tests/scope-delta.test.mjs` — 임시 디렉터리의 가짜 파일로만 돈다.
 *
 * 코퍼스 형식: [{ "text": "...", "expect": "safe" | "wedding" | "danger" }]
 *   safe    = 안전 레인으로 가면 안 되는 평범한 문장
 *   wedding = 결혼 도구를 받아야 하는 문장
 *   danger  = 안전 신호가 잡혀야 하는 문장
 *
 * **과포획(도구 확장)도 회귀로 센다(2026-09-15).** 예전 판정은 안전 신호 오탐·위험
 * 미탐·결혼 문장 도구 0개만 비교해서, 결혼 밖 문장이 W4(맥락 무관 조회 도구 1개)에서
 * W0(결혼 도구 전부)로 넘어가도 "회귀 없음" 이었다. 이제 safe·danger 문장이 base 보다
 * 도구를 더 받으면서 결혼 레인(W0·W1)에 들어가면 그 행을 과포획으로 적고 회귀로 친다.
 * 행 단위로 세므로 넓어진 문장과 좁아진 문장이 서로 상쇄되지 않는다.
 *
 * 이 도구는 safe 문장이 결혼 문장인지 결혼 밖 문장인지 구분하지 못한다. 과포획으로
 * 적힌 행이 실제로 결혼 도구를 받아야 하는 문장이면 코퍼스에서 wedding 으로 고칠 것 —
 * 넓어진 쪽을 조용히 넘기지 않고 사람에게 보여 주는 편을 골랐다.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync, readFileSync, writeFileSync, unlinkSync, existsSync, realpathSync,
  mkdirSync, readdirSync, rmdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** 러너는 `amoraQuestionScope.ts` 를 import 한다. base 로 바꿔 재는 파일은 `SAFETY_FILES` 전체다. */
const RUNNER = join(ROOT, "apps", "web", "src", "lib", "ai", "__tests__", "__scopeDelta.gen.test.ts");

/**
 * base 판본으로 **함께** 바꿔 재는 안전 파일. 이 목록 하나를 바꿔 끼우기·동일성 판정·보고가
 * 같이 쓴다.
 *
 * `verify-change.mjs` 의 `SAFETY_CRITICAL` 가운데 분류 결과를 바꿀 수 있는 파일 전부다
 * (감사 로그 `ai-log.ts` 는 판정에 끼지 않아 뺐다). 그 파일은 import 하면 본체가 돌아서
 * 목록을 가져올 수 없다 — 두 목록이 어긋나면 `scripts/tests/scope-delta.test.mjs` 가 막는다.
 *
 * 한 파일만 바꾸면 서로 import 하는 판본이 섞이는 문제도 있었다. 전부 함께 바꾸면 없어진다.
 */
export const SAFETY_FILES = Object.freeze([
  "apps/web/src/lib/ai/amoraQuestionScope.ts",
  "apps/web/src/lib/ai/amoraClarificationContinuity.ts",
  "apps/web/src/lib/ai/amoraBoundedContinuity.ts",
  "packages/shared/src/safety/amoraCrisisSafety.ts",
  "packages/shared/src/safety/amoraCrisisClassifier.ts",
]);

const hashBytes = (v) => createHash("md5").update(v).digest("hex");
const hashText = (v) => createHash("md5").update(v, "utf8").digest("hex");
const md5 = (p) => hashBytes(readFileSync(p));
/**
 * `git` 은 **shell 없이** 부른다.
 *
 * Windows cmd 에서 `^` 는 이스케이프 문자다. shell 을 거치면 `a6e374c15^` 가
 * `a6e374c15` 로 조리돼 **부모가 아니라 그 커밋 자신**을 base 로 재게 된다.
 * 2026-09-02 에 실제로 당했다 — base 오탐이 1인데 12로 나왔고, 하마터면
 * "회귀 없음" 이라는 반대 결론을 낼 뻔했다. 비교 도구가 조용히 틀리면
 * 그 위의 모든 판단이 틀린다.
 */
const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false, ...opts });

/** npm 계열은 Windows 에서 `.cmd` 라 shell 이 필요하다. 인자에 `^` 를 넣지 마라. */
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });

const usageText = (msg) =>
  `${msg}\n\n사용법: node scripts/scope-delta.mjs <base-ref> <corpus.json> [--out <증거.json>]`;

/**
 * 인자를 읽는다. `--out <파일>` 은 어디에 있어도 되고 없어도 된다.
 *
 * 예전 식은 `argv.filter((a, i) => i !== outIdx && i !== outIdx + 1)` 하나였다. `--out` 이
 * 없으면 `outIdx` 가 -1 이라 `outIdx + 1` 이 0 이 되어 **첫 인자(base)를 지웠다.**
 */
export function parseScopeDeltaArgs(argv) {
  const outIdx = argv.indexOf("--out");
  if (outIdx < 0) {
    const [baseRef, corpusPath] = argv;
    return { baseRef, corpusPath, outPath: null, outMissingValue: false };
  }
  const outPath = argv[outIdx + 1] ?? null;
  const [baseRef, corpusPath] = argv.filter((_, i) => i !== outIdx && i !== outIdx + 1);
  // 경로 없이 `--out` 만 주면 예전에는 증거 없이 exit 0 으로 끝났다. 그건 거절한다.
  return { baseRef, corpusPath, outPath, outMissingValue: outPath === null };
}

// ── 비교(순수 함수) ─────────────────────────────────────────────────
//
// 측정은 vitest 를 돌리고 판정기 파일을 바꿔 끼우므로 무겁다. 비교는 행 두 벌만 있으면
// 되므로 따로 내보내 `scripts/tests/verification-gates-hold.test.mjs` 가 직접 잰다.

/** 결혼 레인: 커플 데이터를 읽거나 바꾸는 도구가 열리는 범위. */
const WEDDING_TOOL_SCOPES = new Set(["W0_wedding_core", "W1_wedding_adjacent"]);

const count = (rows, pred) => rows.filter(pred).length;
const falsePos = (rows) => count(rows, (r) => r.expect === "safe" && r.safety);
const missed = (rows) => count(rows, (r) => r.expect === "danger" && !r.safety);
const noTools = (rows) => count(rows, (r) => r.expect === "wedding" && r.toolCount === 0);
/**
 * 참고용 절대값: 결혼 레인에서 도구를 받은 safe·danger 문장 수. safe 에는 결혼 문장도
 * 섞여 있어 이 수만으로는 판정하지 않는다 — 판정은 아래 행 단위 비교로 한다.
 */
const weddingLaneNonWedding = (rows) => count(rows, (r) =>
  (r.expect === "safe" || r.expect === "danger")
  && WEDDING_TOOL_SCOPES.has(r.scope)
  && r.toolCount > 0);

/**
 * 한 행이 **과포획(도구 확장)** 인가 — safe·danger 문장이 base 보다 도구를 더 받으면서
 * 결혼 레인에 들어갔다. base 판본이 도구 필터를 몰라 -1 이면 비교할 수 없어 세지 않는다.
 */
function isOverCaptureChange(c) {
  return (c.expect === "safe" || c.expect === "danger")
    && typeof c.from.toolCount === "number"
    && c.from.toolCount >= 0
    && typeof c.to.toolCount === "number"
    && c.to.toolCount > c.from.toolCount
    && WEDDING_TOOL_SCOPES.has(c.to.scope);
}

function isWorseChange(c) {
  return (c.expect === "safe" && c.to.safety && !c.from.safety)
    || (c.expect === "danger" && !c.to.safety && c.from.safety)
    || (c.expect === "wedding" && c.to.toolCount === 0 && c.from.toolCount > 0)
    || isOverCaptureChange(c);
}

const countsOf = (rows) => ({
  falsePositives: falsePos(rows),
  missed: missed(rows),
  noTools: noTools(rows),
  overCapture: weddingLaneNonWedding(rows),
});

export function compareScopeDelta({ base, head }) {
  const byText = new Map(base.map((r) => [r.text, r]));
  const changed = [];
  for (const h of head) {
    const b = byText.get(h.text);
    if (!b) continue;
    if (b.scope !== h.scope || b.safety !== h.safety || b.toolCount !== h.toolCount) {
      changed.push({ text: h.text, expect: h.expect, from: b, to: h });
    }
  }
  const overCaptureRows = changed.filter(isOverCaptureChange);
  const headCounts = countsOf(head);
  const baselineCounts = countsOf(base);
  const regressed =
    headCounts.falsePositives > baselineCounts.falsePositives
    || headCounts.missed > baselineCounts.missed
    || headCounts.noTools > baselineCounts.noTools
    || overCaptureRows.length > 0;
  return {
    corpusSize: head.length,
    changed,
    overCaptureRows,
    head: headCounts,
    baseline: baselineCounts,
    regressed,
  };
}

const OVER_CAPTURE_EVIDENCE_MAX_ROWS = 50;
const verdictLabel = (row) => `${row.scope}/도구${row.toolCount}`;

/**
 * `--out` 증거. 기존 필드는 이름을 그대로 두고 과포획과 `swappedToBase` 만 더한다.
 *
 * `classifierIdentical` 은 이제 **안전 파일 전체**가 base 와 같다는 뜻이다(예전에는
 * `amoraQuestionScope.ts` 한 파일). `swappedToBase` 는 base 측정 때 실제로 base 판본으로
 * 바꿔 끼운 파일이다 — `safetyFiles` 에 "변경됨" 인데 여기 없으면 그 측정은 믿을 수 없다.
 */
export function buildScopeDeltaEvidence({
  measuredAt,
  baseRef,
  classifierIdentical,
  safetyFiles,
  swappedToBase = [],
  comparison,
}) {
  return {
    measuredAt,
    base: baseRef,
    classifierIdentical,
    safetyFiles,
    swappedToBase,
    corpusSize: comparison.corpusSize,
    head: comparison.head,
    baseline: comparison.baseline,
    changedVerdicts: comparison.changed.length,
    regressed: comparison.regressed,
    overCapture: {
      definition:
        "safe·danger 문장이 base 보다 도구를 더 받으며 결혼 레인(W0·W1)에 들어간 행. "
        + "head/baseline.overCapture 는 결혼 레인에서 도구를 받은 safe·danger 문장의 참고용 절대값",
      count: comparison.overCaptureRows.length,
      rows: comparison.overCaptureRows.slice(0, OVER_CAPTURE_EVIDENCE_MAX_ROWS).map((c) => ({
        text: c.text,
        expect: c.expect,
        from: verdictLabel(c.from),
        to: verdictLabel(c.to),
      })),
    },
  };
}

/** 코퍼스를 돌려 결과를 JSON 으로 뱉는 임시 테스트를 만든다. */
function writeRunner(corpus) {
  writeFileSync(
    RUNNER,
    `import { test } from "vitest";
import { writeFileSync } from "node:fs";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
  hasAmoraSafetySignal,
} from "../amoraQuestionScope";

const CORPUS = ${JSON.stringify(corpus)};

// 범위 필터가 실제로 무엇을 남기는지만 잰다. 도구 선택기(selectAmoraTools)는
// 사용자 문장의 의도도 함께 보므로, W4 가 앗아가는 몫만 분리해서 보려면
// **고정된 목록**을 통과시켜 몇 개가 살아남는지 세는 편이 정확하다.
const PROBE_TOOLS = [
  "get_budget", "update_budget", "get_schedule", "create_schedule_event",
  "get_checklist", "update_checklist", "search_place", "get_market_price",
].map((name) => ({ type: "function", name, description: name, parameters: {} }));

test("__scope_delta", () => {
  const rows = CORPUS.map((row) => {
    const c = classifyAmoraQuestionScope({ userText: row.text });
    let toolCount = -1;
    try {
      toolCount = filterAmoraToolsByQuestionScope(PROBE_TOOLS, c).length;
    } catch { /* 판본이 다르면 -1 로 둔다 */ }
    return {
      text: row.text,
      expect: row.expect,
      scope: c.scope,
      reason: c.highRiskReason ?? null,
      safety: hasAmoraSafetySignal(row.text),
      toolCount,
    };
  });
  writeFileSync(process.env.SCOPE_DELTA_OUT, JSON.stringify(rows), "utf8");
});
`,
    "utf8",
  );
}

function runOnce(corpus, outPath) {
  writeRunner(corpus);
  try {
    sh("npx", ["vitest", "run", "src/lib/ai/__tests__/__scopeDelta.gen.test.ts"], {
      cwd: join(ROOT, "apps", "web"),
      env: { ...process.env, SCOPE_DELTA_OUT: outPath },
      stdio: "pipe",
    });
  } finally {
    if (existsSync(RUNNER)) unlinkSync(RUNNER);
  }
  return JSON.parse(readFileSync(outPath, "utf8"));
}

// ── 안전 파일을 base 판본으로 바꿔 끼우기 ────────────────────────────
//
// 아래 함수들은 루트·파일 목록·base 읽기·측정기를 **인자로 받는다.** 검사가 임시 디렉터리의
// 가짜 파일 위에서 같은 코드를 돌릴 수 있게 하려는 것이다. 실제 저장소 파일을 바꿔 끼우는
// 검사는 두지 않는다 — 이 저장소는 그러다 변형을 남긴 적이 있다.

const BASE_SHOW_MAX_BUFFER = 32 * 1024 * 1024;

/** `git show <base>:<파일>`. base 에 없는 파일이면 null. */
function readBaseFromGit(baseRef, f) {
  try {
    return git(["show", `${baseRef}:${f}`], { maxBuffer: BASE_SHOW_MAX_BUFFER });
  } catch {
    return null;
  }
}

/**
 * **어느 커밋을 재는지 눈으로 확인할 수 있게 찍는다.** ref 표기가 조용히 다른 커밋으로
 * 풀리면 아래 숫자는 전부 거짓이 된다.
 */
function describeBaseFromGit(baseRef) {
  const resolved = git(["rev-parse", "--short", baseRef]).trim();
  const subject = git(["log", "-1", "--format=%s", resolved]).trim();
  return { resolved, subject };
}

/**
 * 파일마다 원본 바이트·해시·base 판본·상태를 잡는다. 아무것도 쓰지 않는다.
 *
 * 상태: "동일" | "변경됨" | "base 에 없음"(HEAD 에서 새로 생긴 파일) | "없음"(HEAD 에 없다).
 * base 로 바꿔 끼우는 것은 "변경됨" 뿐이다.
 */
export function planSafetySwap({ root = ROOT, files = SAFETY_FILES, readBase }) {
  return files.map((f) => {
    const absFile = join(root, f);
    if (!existsSync(absFile)) return { f, absFile, state: "없음" };
    const originalBytes = readFileSync(absFile);
    const beforeHash = hashBytes(originalBytes);
    const baseSrc = readBase(f);
    if (baseSrc === null) return { f, absFile, originalBytes, beforeHash, state: "base 에 없음" };
    return {
      f, absFile, originalBytes, beforeHash, baseSrc,
      state: hashText(baseSrc) === hashText(originalBytes.toString("utf8")) ? "동일" : "변경됨",
    };
  });
}

/** 원복을 증명하지 못했거나 측정 중에 안전 파일이 바뀌었다. 이 측정은 증거가 아니다 → exit 3. */
export class ScopeDeltaRestoreError extends Error {
  constructor(failures, options) {
    super(`안전 파일 원복을 증명하지 못했다: ${failures.map((x) => x.f).join(", ")}`, options);
    this.name = "ScopeDeltaRestoreError";
    this.failures = failures;
  }
}

const backupNameOf = (f) => `${f.replace(/[\\/]/g, "__")}.bak`;

/**
 * 바꿔 끼운 파일을 메모리에 쥔 원본 바이트로 되돌리고, **파일마다** md5 로 증명한다.
 *
 * - 이 도구가 쓴 파일만 되쓴다. 안 쓴 파일이 달라져 있으면 다른 세션의 편집이다 — 덮어쓰지
 *   않고 측정을 무효로 돌린다.
 * - 바꿔 끼운 동안 누가 그 파일을 썼으면(내용이 base 도 원본도 아니다) 그 내용을 버리지
 *   않고 백업 디렉터리에 `.foreign` 으로 남긴다.
 * - 증명된 파일의 디스크 백업만 지운다. 실패하면 백업이 남는다.
 */
function restoreSafetyFiles({ plan, written, backupDir, writeFile }) {
  const failures = [];
  for (const p of plan) {
    if (!p.originalBytes) continue;
    const backup = written.get(p.f) ?? null;
    try {
      if (backup) {
        const current = readFileSync(p.absFile);
        const currentHash = hashBytes(current);
        if (currentHash !== hashText(p.baseSrc) && currentHash !== p.beforeHash) {
          const foreign = `${backup}.foreign`;
          writeFileSync(foreign, current);
          failures.push({
            f: p.f,
            why: `바꿔 끼운 동안 다른 곳에서 이 파일을 썼다. 원본으로 되돌렸고, 그때 있던 내용은 ${foreign} 에 남겼다`,
          });
        }
        writeFile(p.absFile, p.originalBytes);
      }
      // 되썼다는 사실이 아니라 **디스크에서 다시 읽은 해시**가 증거다.
      const afterHash = md5(p.absFile);
      if (afterHash !== p.beforeHash) {
        failures.push({
          f: p.f,
          why: backup
            ? `원복 실패 — md5 불일치 (${p.beforeHash} → ${afterHash}). 원본 백업: ${backup}`
            : `측정 중에 바뀌었다 — md5 (${p.beforeHash} → ${afterHash}). 이 도구가 쓴 파일이 아니라 되돌리지 않았다`,
        });
      } else if (backup) {
        unlinkSync(backup);
      }
    } catch (err) {
      failures.push({
        f: p.f,
        why: `원복 실패 — ${err.message}${backup ? `. 원본 백업: ${backup}` : ""}`,
      });
    }
  }
  try {
    if (existsSync(backupDir) && readdirSync(backupDir).length === 0) rmdirSync(backupDir);
  } catch { /* 빈 디렉터리 정리는 증거가 아니다 */ }
  return failures;
}

/**
 * HEAD 를 재고, "변경됨" 인 안전 파일을 **전부** base 판본으로 바꿔 끼운 뒤 base 를 잰다.
 * 무슨 일이 나도 finally 에서 되돌리고 md5 로 증명한다. 증명하지 못하면
 * `ScopeDeltaRestoreError` 를 던진다(원래 오류는 `cause` 에 남는다).
 *
 * 원본은 메모리에도 쥐지만 **디스크에도 백업한다.** 프로세스가 죽으면(Ctrl-C, 전원) finally 가
 * 돌지 않는다. 커밋 안 한 편집이 그 파일에 있으면 백업이 유일한 사본이다.
 */
export function measureHeadAndBase({
  plan, backupDir, measureHead, measureBase, log = console.log, writeFile = writeFileSync,
}) {
  const swappable = plan.filter((p) => p.state === "변경됨");
  /** 디스크에 쓰기 시작한 파일 → 백업 경로. 쓰기 **전에** 적어서 반쯤 쓴 파일도 되돌린다. */
  const written = new Map();
  let head;
  let base;
  let thrown;
  try {
    head = measureHead();
    if (swappable.length === 0) {
      // 바꿔 끼울 것이 없으면 다시 재도 같은 숫자다.
      base = head;
    } else {
      // HEAD 를 재는 동안 누가 안전 파일을 고쳤으면 어느 판본을 쟀는지 알 수 없다.
      // 쓰기 전에 멈춘다 — 여기서 덮어쓰면 그 편집이 원복 때 사라진다.
      for (const p of plan) {
        if (p.originalBytes && md5(p.absFile) !== p.beforeHash) {
          throw new Error(`${p.f} 가 HEAD 측정 중에 바뀌었다. 어느 판본을 쟀는지 알 수 없다.`);
        }
      }
      mkdirSync(backupDir, { recursive: true });
      for (const p of swappable) {
        const backup = join(backupDir, backupNameOf(p.f));
        copyFileSync(p.absFile, backup);
        written.set(p.f, backup);
        writeFile(p.absFile, p.baseSrc, "utf8");
        // **변형이 실제로 일어났는지 먼저 확인한다.** no-op 이면 base 숫자는 무의미하다.
        if (md5(p.absFile) === p.beforeHash) {
          throw new Error(`${p.f} 를 base 판본으로 바꿨는데 해시가 그대로다(no-op).`);
        }
        log(`    ← ${p.f}`);
      }
      base = measureBase();
    }
  } catch (err) {
    thrown = err;
    throw err;
  } finally {
    const failures = restoreSafetyFiles({ plan, written, backupDir, writeFile });
    if (failures.length) throw new ScopeDeltaRestoreError(failures, { cause: thrown });
  }
  log(`원복 확인 (안전 파일 ${plan.filter((p) => p.originalBytes).length}개 md5 일치).`);
  return {
    head,
    base,
    /**
     * 안전 파일이 **전부** base 와 바이트 단위로 같은가. 같으면 분류 결과가 바뀔 수 없다 —
     * 주장이 아니라 해시로 증명된다. 그때는 HEAD 절대값만 남긴다.
     */
    classifierIdentical: plan.every((p) => p.state === "동일"),
    swappedToBase: swappable.map((p) => p.f),
  };
}

/**
 * 도구 본체. 종료 코드를 돌려준다(0 회귀 없음 · 1 회귀 · 2 사용법 · 3 원복/측정 무효).
 *
 * 기본값은 실제 저장소·git·vitest 다. 검사는 `root`·`readBase`·`describeBase`·`measure` 를
 * 바꿔 끼워 임시 디렉터리에서 돌린다. `writeSafetyFile` 은 안전 파일을 바꿔 끼우고 되돌릴 때
 * 쓰는 쓰기 함수다 — 검사가 "되썼는데 바이트가 다르다" 를 만들어 md5 증명을 깨뜨려 본다.
 */
export function runScopeDelta({
  argv,
  root = ROOT,
  files = SAFETY_FILES,
  readBase = readBaseFromGit,
  describeBase = describeBaseFromGit,
  measure = runOnce,
  writeSafetyFile = writeFileSync,
  log = console.log,
  error = console.error,
  now = () => new Date(),
}) {
  const usage = (msg) => { error(usageText(msg)); return 2; };

  // `--out <파일>` 은 증거를 JSON 으로 남긴다. verify-change 의 --safety-delta 가 이것을 받는다.
  const { baseRef, corpusPath, outPath, outMissingValue } = parseScopeDeltaArgs(argv);
  if (outMissingValue) return usage("--out 뒤에 증거 파일 경로가 없다.");
  if (!baseRef || !corpusPath) return usage("인자가 부족하다.");
  if (!existsSync(corpusPath)) return usage(`코퍼스 파일이 없다: ${corpusPath}`);

  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  if (!Array.isArray(corpus) || corpus.length === 0) return usage("코퍼스가 비었다.");

  const OUT_HEAD = join(root, ".scope-delta-head.json");
  const OUT_BASE = join(root, ".scope-delta-base.json");
  // `.verification/` 은 git 이 무시한다. 죽은 실행의 백업이 커밋에 섞이지 않는다.
  const backupDir = join(root, ".verification", "scope-delta-backup");

  // 이전 실행이 원복 없이 죽었으면 디스크의 안전 파일이 base 판본일 수 있고, 남은 백업이
  // 원본의 유일한 사본이다. 그대로 다시 돌면 그 백업을 덮어쓴다.
  if (existsSync(backupDir) && readdirSync(backupDir).length > 0) {
    error(
      `\n!! 이전 실행이 남긴 백업이 있다: ${backupDir}`
      + `\n   안전 파일이 base 판본인 채로 남았을 수 있다. 백업과 대조해 손으로 되돌린 뒤`
      + `\n   그 디렉터리를 비우고 다시 돌릴 것. 그대로 재면 원본 사본을 덮어쓴다.`,
    );
    return 3;
  }

  // ref 가 틀렸으면 HEAD 를 재기 전에 죽는다.
  const { resolved, subject } = describeBase(baseRef);
  log(`base = ${baseRef} → ${resolved}  "${subject}"`);
  const plan = planSafetySwap({ root, files, readBase: (f) => readBase(baseRef, f) });
  const swapCount = plan.filter((p) => p.state === "변경됨").length;

  let measured;
  try {
    measured = measureHeadAndBase({
      plan,
      backupDir,
      log,
      writeFile: writeSafetyFile,
      measureHead: () => {
        log(`현재(HEAD) 측정 중 …`);
        return measure(corpus, OUT_HEAD);
      },
      measureBase: () => {
        log(`${baseRef} 판본으로 바꿔서 측정 중 … (위 ${swapCount}개 파일)`);
        return measure(corpus, OUT_BASE);
      },
    });
  } catch (err) {
    if (!(err instanceof ScopeDeltaRestoreError)) throw err;
    for (const x of err.failures) error(`\n!! ${x.f}: ${x.why}`);
    if (err.cause) error(`\n   (그 전에 난 오류: ${err.cause.message})`);
    error(`\n!! 이 측정은 증거가 아니다. 위 파일을 손으로 확인할 것.`);
    return 3;
  }
  const { head, base, classifierIdentical, swappedToBase } = measured;

  // ── 비교 ────────────────────────────────────────────────────────────
  const comparison = compareScopeDelta({ base, head });
  const { changed, overCaptureRows, regressed } = comparison;

  log(`\n=== ${baseRef} → HEAD ===`);
  log(`코퍼스 ${head.length}건 · 판정이 달라진 것 ${changed.length}건\n`);
  log(`                        ${baseRef}   HEAD`);
  log(`평범한 문장 오탐        ${String(comparison.baseline.falsePositives).padStart(6)}   ${comparison.head.falsePositives}`);
  log(`위험 문장 미탐          ${String(comparison.baseline.missed).padStart(6)}   ${comparison.head.missed}`);
  log(`결혼 문장 도구 0개      ${String(comparison.baseline.noTools).padStart(6)}   ${comparison.head.noTools}`);
  log(`결혼 레인 safe·danger   ${String(comparison.baseline.overCapture).padStart(6)}   ${comparison.head.overCapture}   (참고용 절대값)`);
  log(`과포획(도구 확장) 행    ${String(overCaptureRows.length).padStart(6)}   (행 단위, 1건이라도 있으면 회귀)`);

  if (changed.length) {
    log(`\n--- 달라진 판정 ---`);
    for (const c of changed.slice(0, 40)) {
      const worse = isWorseChange(c);
      log(
        `  ${worse ? "나빠짐" : "좋아짐"}  [${c.expect}] ${c.text.slice(0, 40)}`
        + `\n           ${c.from.scope}/도구${c.from.toolCount} → ${c.to.scope}/도구${c.to.toolCount}`,
      );
    }
    if (changed.length > 40) log(`  … 외 ${changed.length - 40}건`);
  }

  if (overCaptureRows.length) {
    // 달라진 판정이 40건을 넘으면 위 목록에서 잘릴 수 있으므로 과포획은 따로 전부 찍는다.
    log(`\n--- 과포획(도구 확장): safe·danger 문장이 결혼 도구를 새로 받았다 ---`);
    for (const c of overCaptureRows) {
      log(
        `  [${c.expect}] ${c.text.slice(0, 60)}`
        + `\n           ${c.from.scope}/도구${c.from.toolCount} → ${c.to.scope}/도구${c.to.toolCount}`,
      );
    }
    log(`  결혼 도구를 받아야 하는 문장이면 코퍼스에서 wedding 으로 고칠 것.`);
  }

  // ── 안전 파일 전체의 동일성 기록 ────────────────────────────────────
  //
  // "변경됨" 인 파일은 위에서 **전부** base 판본으로 바꿔 쟀다. 이 목록 밖의 파일은 바꾸지
  // 않았다 — 목록의 파일이 import 하는 `packages/shared/src/safety/amoraCrisisEnglish.ts`·
  // `coerciveControlSignals.ts`, `apps/web/src/lib/ai/amoraPersonalActionConversation.ts` 도
  // 그렇다(2026-09-18 현재 `verify-change` 의 SAFETY_CRITICAL 에도 없다). 그런 파일이
  // 바뀌었으면 그 파일에 맞는 증거를 따로 대야 한다. 그걸 안 적으면 "안전 델타 통과" 가
  // 실제보다 넓은 것을 증명한 것처럼 읽힌다.
  const fileState = Object.fromEntries(plan.map((p) => [p.f, p.state]));
  const swappedSet = new Set(swappedToBase);

  log(`\n=== 안전 파일 (${baseRef} 대비) ===`);
  for (const [f, st] of Object.entries(fileState)) {
    log(`  ${st === "동일" ? " " : "*"} ${st.padEnd(10)} ${f}${swappedSet.has(f) ? "   ← base 판본으로 바꿔 쟀다" : ""}`);
  }
  if (classifierIdentical) {
    log(`\n위 안전 파일이 전부 base 와 **동일**하다 — 이 파일들로는 분류 결과가 바뀔 수 없다(해시로 증명).`);
    log(`  위 숫자는 델타가 아니라 HEAD 절대값이다.`);
  } else if (swappedToBase.length === 0) {
    // "base 에 없음"·"없음" 뿐이라 바꿔 끼울 것이 없었다. 같다고 증명된 것은 아니다.
    log(`\n!! base 판본으로 바꿔 잴 수 있는 파일이 없었다 — 위 숫자는 델타가 아니라 HEAD 절대값이다.`);
    log(`  "*" 표시 파일은 이 숫자가 다루지 않는다.`);
  }
  log(`  이 목록 밖에서 바뀐 파일은 이 숫자가 다루지 않는다. 그 파일에 맞는 증거를 따로 댈 것.`);

  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(buildScopeDeltaEvidence({
      measuredAt: now().toISOString(),
      baseRef,
      classifierIdentical,
      safetyFiles: fileState,
      swappedToBase,
      comparison,
    }), null, 2)}\n`, "utf8");
    log(`  증거: ${outPath}`);
  }

  log(`\n판정: ${regressed ? "회귀 있음 — 넣지 말 것" : "회귀 없음"}`);
  return regressed ? 1 : 0;
}

function main() {
  process.exit(runScopeDelta({ argv: process.argv.slice(2) }));
}

/**
 * 테스트가 비교 함수만 가져갈 때는 측정을 돌리지 않는다.
 *
 * **실제 경로끼리 비교한다(2026-09-15 재검사).** Node 는 ESM 진입점의 `import.meta.url` 을
 * realpath 로 풀지만 `process.argv[1]` 은 주어진 경로를 절대 경로로만 만든다. 둘을 그대로
 * 비교하면 심볼릭 링크·정션을 거친 경로(macOS /tmp → /private/tmp, 링크로 연결한 워크트리)
 * 로 실행했을 때 `main()` 을 건너뛰고 측정도 `--out` 증거도 없이 exit 0 으로 끝난다.
 * 그 조용한 통과가 '회귀 없음'처럼 읽힌다.
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  const canonical = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const self = canonical(fileURLToPath(import.meta.url));
  const invoked = canonical(process.argv[1]);
  return process.platform === "win32"
    ? self.toLowerCase() === invoked.toLowerCase()
    : self === invoked;
}

if (isMainModule()) main();
