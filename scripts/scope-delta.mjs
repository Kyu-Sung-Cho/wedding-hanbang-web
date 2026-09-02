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
 * 코퍼스 형식: [{ "text": "...", "expect": "safe" | "wedding" }]
 *   safe    = 안전 레인으로 가면 안 되는 평범한 문장
 *   wedding = 결혼 도구를 받아야 하는 문장
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const [baseRef, corpusPath] = process.argv.slice(2);
if (!baseRef || !corpusPath) usage("인자가 부족하다.");
if (!existsSync(corpusPath)) usage(`코퍼스 파일이 없다: ${corpusPath}`);

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
if (!Array.isArray(corpus) || corpus.length === 0) usage("코퍼스가 비었다.");

/** 코퍼스를 돌려 결과를 JSON 으로 뱉는 임시 테스트를 만든다. */
function writeRunner() {
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

function runOnce(outPath) {
  writeRunner();
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

const OUT_HEAD = join(ROOT, ".scope-delta-head.json");
const OUT_BASE = join(ROOT, ".scope-delta-base.json");
const BACKUP = join(ROOT, ".scope-delta-backup.ts");

const beforeHash = md5(ABS_TARGET);
copyFileSync(ABS_TARGET, BACKUP);

let head;
let base;
try {
  console.log(`현재(HEAD) 측정 중 …`);
  head = runOnce(OUT_HEAD);

  // **어느 커밋을 재는지 눈으로 확인할 수 있게 찍는다.** ref 표기가 조용히
  // 다른 커밋으로 풀리면 아래 숫자는 전부 거짓이 된다.
  const resolved = git(["rev-parse", "--short", baseRef]).trim();
  const subject = git(["log", "-1", "--format=%s", resolved]).trim();
  console.log(`base = ${baseRef} → ${resolved}  "${subject}"`);
  console.log(`${baseRef} 판본으로 바꿔서 측정 중 …`);
  const baseSource = git(["show", `${baseRef}:${TARGET}`], { maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(ABS_TARGET, baseSource, "utf8");

  // **변형이 실제로 일어났는지 먼저 확인한다.** no-op 이면 아래 숫자는 무의미하다.
  if (md5(ABS_TARGET) === beforeHash) {
    throw new Error(`${baseRef} 판본이 현재와 같다 — 비교할 것이 없다.`);
  }
  base = runOnce(OUT_BASE);
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
const byText = new Map(base.map((r) => [r.text, r]));
const changed = [];
for (const h of head) {
  const b = byText.get(h.text);
  if (!b) continue;
  if (b.scope !== h.scope || b.safety !== h.safety || b.toolCount !== h.toolCount) {
    changed.push({ text: h.text, expect: h.expect, from: b, to: h });
  }
}

const count = (rows, pred) => rows.filter(pred).length;
const falsePos = (rows) => count(rows, (r) => r.expect === "safe" && r.safety);
const missed = (rows) => count(rows, (r) => r.expect === "danger" && !r.safety);
const noTools = (rows) => count(rows, (r) => r.expect === "wedding" && r.toolCount === 0);

console.log(`\n=== ${baseRef} → HEAD ===`);
console.log(`코퍼스 ${head.length}건 · 판정이 달라진 것 ${changed.length}건\n`);
console.log(`                        ${baseRef}   HEAD`);
console.log(`평범한 문장 오탐        ${String(falsePos(base)).padStart(6)}   ${falsePos(head)}`);
console.log(`위험 문장 미탐          ${String(missed(base)).padStart(6)}   ${missed(head)}`);
console.log(`결혼 문장 도구 0개      ${String(noTools(base)).padStart(6)}   ${noTools(head)}`);

if (changed.length) {
  console.log(`\n--- 달라진 판정 ---`);
  for (const c of changed.slice(0, 40)) {
    const worse =
      (c.expect === "safe" && c.to.safety && !c.from.safety)
      || (c.expect === "danger" && !c.to.safety && c.from.safety)
      || (c.expect === "wedding" && c.to.toolCount === 0 && c.from.toolCount > 0);
    console.log(
      `  ${worse ? "나빠짐" : "좋아짐"}  [${c.expect}] ${c.text.slice(0, 40)}`
      + `\n           ${c.from.scope}/도구${c.from.toolCount} → ${c.to.scope}/도구${c.to.toolCount}`,
    );
  }
  if (changed.length > 40) console.log(`  … 외 ${changed.length - 40}건`);
}

const regressed =
  falsePos(head) > falsePos(base)
  || missed(head) > missed(base)
  || noTools(head) > noTools(base);

console.log(`\n판정: ${regressed ? "회귀 있음 — 넣지 말 것" : "회귀 없음"}`);
process.exit(regressed ? 1 : 0);
