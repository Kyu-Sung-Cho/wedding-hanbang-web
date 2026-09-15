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
 *   node scripts/scope-delta.mjs <base-ref> <corpus.json>
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
import { copyFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = "apps/web/src/lib/ai/amoraQuestionScope.ts";
const ABS_TARGET = join(ROOT, TARGET);
const RUNNER = join(ROOT, "apps", "web", "src", "lib", "ai", "__tests__", "__scopeDelta.gen.test.ts");

const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");
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

function usage(msg) {
  console.error(`${msg}\n\n사용법: node scripts/scope-delta.mjs <base-ref> <corpus.json>`);
  process.exit(2);
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

/** `--out` 증거. 기존 필드는 이름·뜻을 그대로 두고 과포획만 더한다. */
export function buildScopeDeltaEvidence({
  measuredAt,
  baseRef,
  classifierIdentical,
  safetyFiles,
  comparison,
}) {
  return {
    measuredAt,
    base: baseRef,
    classifierIdentical,
    safetyFiles,
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

function main() {
  const argv = process.argv.slice(2);
  // `--out <파일>` 은 증거를 JSON 으로 남긴다. verify-change 의 --safety-delta 가 이것을 받는다.
  const outIdx = argv.indexOf("--out");
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;
  const [baseRef, corpusPath] = argv.filter((a, i) => i !== outIdx && i !== outIdx + 1);
  if (!baseRef || !corpusPath) usage("인자가 부족하다.");
  if (!existsSync(corpusPath)) usage(`코퍼스 파일이 없다: ${corpusPath}`);

  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  if (!Array.isArray(corpus) || corpus.length === 0) usage("코퍼스가 비었다.");

  const OUT_HEAD = join(ROOT, ".scope-delta-head.json");
  const OUT_BASE = join(ROOT, ".scope-delta-base.json");
  const BACKUP = join(ROOT, ".scope-delta-backup.ts");

  const beforeHash = md5(ABS_TARGET);
  copyFileSync(ABS_TARGET, BACKUP);

  let head;
  let base;
  /** 판정기가 base 와 바이트 단위로 같은가. 같으면 분류 결과가 바뀔 수 없다. */
  let classifierIdentical = false;
  try {
    console.log(`현재(HEAD) 측정 중 …`);
    head = runOnce(corpus, OUT_HEAD);

    // **어느 커밋을 재는지 눈으로 확인할 수 있게 찍는다.** ref 표기가 조용히
    // 다른 커밋으로 풀리면 아래 숫자는 전부 거짓이 된다.
    const resolved = git(["rev-parse", "--short", baseRef]).trim();
    const subject = git(["log", "-1", "--format=%s", resolved]).trim();
    console.log(`base = ${baseRef} → ${resolved}  "${subject}"`);
    console.log(`${baseRef} 판본으로 바꿔서 측정 중 …`);
    const baseSource = git(["show", `${baseRef}:${TARGET}`], { maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(ABS_TARGET, baseSource, "utf8");

    // **변형이 실제로 일어났는지 먼저 확인한다.** no-op 이면 아래 숫자는 무의미하다.
    //
    // 다만 "같다" 는 것 자체가 증거다. 판정기를 안 건드렸다는 뜻이므로 분류 결과가
    // 바뀔 수 없다 — 주장이 아니라 해시로 증명된다. 그때는 오류가 아니라 그 사실을
    // 기록하고 HEAD 절대값만 남긴다.
    if (md5(ABS_TARGET) === beforeHash) {
      classifierIdentical = true;
      base = head;
    } else {
      base = runOnce(corpus, OUT_BASE);
    }
  } finally {
    copyFileSync(BACKUP, ABS_TARGET);
    unlinkSync(BACKUP);
    const afterHash = md5(ABS_TARGET);
    if (afterHash !== beforeHash) {
      console.error(`\n!! 원복 실패 — md5 불일치 (${beforeHash} → ${afterHash}). 손으로 확인할 것.`);
      process.exit(3);
    }
    console.log(`원복 확인 (md5 일치).`);
  }

  // ── 비교 ────────────────────────────────────────────────────────────
  const comparison = compareScopeDelta({ base, head });
  const { changed, overCaptureRows, regressed } = comparison;

  console.log(`\n=== ${baseRef} → HEAD ===`);
  console.log(`코퍼스 ${head.length}건 · 판정이 달라진 것 ${changed.length}건\n`);
  console.log(`                        ${baseRef}   HEAD`);
  console.log(`평범한 문장 오탐        ${String(comparison.baseline.falsePositives).padStart(6)}   ${comparison.head.falsePositives}`);
  console.log(`위험 문장 미탐          ${String(comparison.baseline.missed).padStart(6)}   ${comparison.head.missed}`);
  console.log(`결혼 문장 도구 0개      ${String(comparison.baseline.noTools).padStart(6)}   ${comparison.head.noTools}`);
  console.log(`결혼 레인 safe·danger   ${String(comparison.baseline.overCapture).padStart(6)}   ${comparison.head.overCapture}   (참고용 절대값)`);
  console.log(`과포획(도구 확장) 행    ${String(overCaptureRows.length).padStart(6)}   (행 단위, 1건이라도 있으면 회귀)`);

  if (changed.length) {
    console.log(`\n--- 달라진 판정 ---`);
    for (const c of changed.slice(0, 40)) {
      const worse = isWorseChange(c);
      console.log(
        `  ${worse ? "나빠짐" : "좋아짐"}  [${c.expect}] ${c.text.slice(0, 40)}`
        + `\n           ${c.from.scope}/도구${c.from.toolCount} → ${c.to.scope}/도구${c.to.toolCount}`,
      );
    }
    if (changed.length > 40) console.log(`  … 외 ${changed.length - 40}건`);
  }

  if (overCaptureRows.length) {
    // 달라진 판정이 40건을 넘으면 위 목록에서 잘릴 수 있으므로 과포획은 따로 전부 찍는다.
    console.log(`\n--- 과포획(도구 확장): safe·danger 문장이 결혼 도구를 새로 받았다 ---`);
    for (const c of overCaptureRows) {
      console.log(
        `  [${c.expect}] ${c.text.slice(0, 60)}`
        + `\n           ${c.from.scope}/도구${c.from.toolCount} → ${c.to.scope}/도구${c.to.toolCount}`,
      );
    }
    console.log(`  결혼 도구를 받아야 하는 문장이면 코퍼스에서 wedding 으로 고칠 것.`);
  }

  // ── 안전 파일 전체의 동일성 기록 ────────────────────────────────────
  //
  // 이 도구가 바꿔 재는 것은 판정기 한 파일이다. 그런데 안전은 그 파일 하나에만
  // 있지 않으므로, 나머지 안전 파일이 base 와 같은지 **해시로** 함께 남긴다.
  // 다른 파일이 바뀌었으면 그 파일에 맞는 증거를 따로 대야 한다 — 이 숫자는 그
  // 파일에 대해 아무것도 말하지 않는다. 그걸 안 적으면 "안전 델타 통과" 가
  // 실제보다 넓은 것을 증명한 것처럼 읽힌다.
  const SAFETY_FILES = [
    "apps/web/src/lib/ai/amoraQuestionScope.ts",
    "apps/web/src/lib/ai/amoraClarificationContinuity.ts",
    "apps/web/src/lib/ai/amoraBoundedContinuity.ts",
    "packages/shared/src/safety/amoraCrisisSafety.ts",
    "packages/shared/src/safety/amoraCrisisClassifier.ts",
  ];
  const fileState = {};
  for (const f of SAFETY_FILES) {
    const absFile = join(ROOT, f);
    if (!existsSync(absFile)) { fileState[f] = "없음"; continue; }
    let baseSrc = null;
    try { baseSrc = git(["show", `${baseRef}:${f}`], { maxBuffer: 32 * 1024 * 1024 }); } catch { /* base 에 없는 새 파일 */ }
    const hash = (v) => createHash("md5").update(v, "utf8").digest("hex");
    fileState[f] = baseSrc === null
      ? "base 에 없음"
      : hash(baseSrc) === hash(readFileSync(absFile, "utf8")) ? "동일" : "변경됨";
  }

  console.log(`\n=== 안전 파일 (${baseRef} 대비) ===`);
  for (const [f, st] of Object.entries(fileState)) {
    console.log(`  ${st === "동일" ? " " : "*"} ${st.padEnd(10)} ${f}`);
  }
  if (classifierIdentical) {
    console.log(`\n판정기가 base 와 **동일**하다 — 분류 결과는 바뀔 수 없다(해시로 증명).`);
    console.log(`  위 숫자는 델타가 아니라 HEAD 절대값이다.`);
  }
  console.log(`  "변경됨" 인 파일은 이 숫자가 다루지 않는다. 그 파일에 맞는 증거를 따로 댈 것.`);

  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(buildScopeDeltaEvidence({
      measuredAt: new Date().toISOString(),
      baseRef,
      classifierIdentical,
      safetyFiles: fileState,
      comparison,
    }), null, 2)}\n`, "utf8");
    console.log(`  증거: ${outPath}`);
  }

  console.log(`\n판정: ${regressed ? "회귀 있음 — 넣지 말 것" : "회귀 없음"}`);
  process.exit(regressed ? 1 : 0);
}

/** 테스트가 비교 함수만 가져갈 때는 측정을 돌리지 않는다. */
function isMainModule() {
  if (!process.argv[1]) return false;
  const self = import.meta.url;
  const invoked = pathToFileURL(process.argv[1]).href;
  return process.platform === "win32"
    ? self.toLowerCase() === invoked.toLowerCase()
    : self === invoked;
}

if (isMainModule()) main();
