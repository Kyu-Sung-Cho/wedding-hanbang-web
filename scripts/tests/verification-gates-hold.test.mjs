import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **관문 자신을 지킨다.**
 *
 * `VERIFICATION.md` 의 관문은 실행되는 명령이라 조용히 무력화될 수 있다 —
 * 인자 하나가 선택이 되거나, 거절 경로가 종료 코드 0을 내거나, 변형 감지가
 * 고장 나면 관문은 남아 있는데 아무것도 안 막는다. 그건 관문이 없는 것보다
 * 나쁘다. 있다고 믿게 만들기 때문이다.
 *
 * 이 저장소는 그 병을 여러 번 겪었다 — `.not.toMatch` 라 무조건 통과한 가드,
 * 정규식이 낡아 아무것도 안 고치는데 초록불이던 변형, `tail` 이 삼켜 실패가
 * 성공으로 읽히던 종료 코드.
 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** 종료 코드를 **잃지 않고** 실행한다. 파이프를 쓰면 그 코드가 사라진다. */
/**
 * 프로브 실행은 **격리된 영수증**에 쓴다.
 *
 * 이 파일은 `prove-guard` 를 시험하려고 일부러 안 잡히는 변형을 돌린다. 그
 * 결과가 정본 영수증(`.verification/guard-proofs.json`)을 덮어쓰면, 관문이
 * "이 검사는 못 잡는 변형이 있다" 며 엉뚱한 이유로 막는다. 2026-09-02 에 실제로
 * 그렇게 막혔다.
 */
const PROBE_RECEIPT = join(ROOT, ".verification", "probe-receipt.json");

function runScript(script, args) {
  try {
    const stdout = execFileSync("node", [join(ROOT, "scripts", script), ...args], {
      cwd: ROOT, encoding: "utf8", stdio: "pipe", timeout: 120_000,
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}\n${err.stderr ?? ""}` };
  }
}

test("verify-change: 재지 못한 것을 안 적으면 거절한다 — 그리고 즉시 거절한다", () => {
  const started = Date.now();
  const r = runScript("verify-change.mjs", []);
  assert.equal(r.code, 1, "인자 없이 통과하면 관문이 아니다");
  assert.match(r.out, /--not-verified/);
  // 테스트를 20분 돌린 뒤에 거절하면 사람은 관문을 건너뛸 방법부터 찾는다.
  assert.ok(
    Date.now() - started < 20_000,
    `거절이 너무 느리다(${Date.now() - started}ms). 인자 검사는 맨 앞이어야 한다.`,
  );
});

test("prove-guard: 아무것도 안 고치는 변형을 거절한다", () => {
  // no-op 을 통과시키면 "가드가 잡았다" 가 아니라 "테스트가 그냥 돌았다" 를
  // 잡았다고 읽는다. 2026-09-02 에 실제로 당한 함정이다.
  const r = runScript("prove-guard.mjs", [
    "--receipt", PROBE_RECEIPT,
    "--test", "scripts/tests/verification-gates-hold.test.mjs",
    "--target", "VERIFICATION.md",
    "--find", "이_문자열은_이_저장소에_없다_2026",
    "--replace", "x",
  ]);
  assert.equal(r.code, 1, "없는 문자열로 변형을 시도했는데 통과했다");
  assert.match(r.out, /변형이 일어나지 않는다|없다/);
});

test("prove-guard: 대상 파일을 반드시 되돌린다", () => {
  const dir = mkdtempSync(join(tmpdir(), "prove-guard-"));
  const target = join(dir, "target.txt");
  try {
    writeFileSync(target, "KEEP_ME\n", "utf8");
    const before = createHash("md5").update(readFileSync(target)).digest("hex");

    // 일부러 실패하는 조합: 대상은 바뀌지만 테스트는 그 파일을 안 보므로
    // "못 잡았다" 로 끝난다. 그래도 원복은 되어야 한다.
    runScript("prove-guard.mjs", [
      "--receipt", PROBE_RECEIPT,
      "--test", "scripts/tests/verification-gates-hold.test.mjs",
      "--target", target,
      "--find", "KEEP_ME",
      "--replace", "MUTATED",
    ]);

    const after = createHash("md5").update(readFileSync(target)).digest("hex");
    assert.equal(after, before, "변형 뒤 원복되지 않았다 — 파일이 오염된 채 남는다");
    assert.equal(readFileSync(target, "utf8"), "KEEP_ME\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify-change: 안전 파일 목록이 비어 있지 않다", () => {
  // 목록을 비우면 관문이 조용히 꺼진다. 파일이 사라지거나 이름이 바뀌면
  // 여기가 알려 준다.
  const source = readFileSync(join(ROOT, "scripts", "verify-change.mjs"), "utf8");
  const block = source.slice(
    source.indexOf("const SAFETY_CRITICAL"),
    source.indexOf("];", source.indexOf("const SAFETY_CRITICAL")),
  );
  const listed = [...block.matchAll(/"([^"]+\.ts)"/g)].map((m) => m[1]);
  assert.ok(listed.length >= 5, `안전 파일 목록이 ${listed.length}개로 줄었다`);
  for (const f of listed) {
    assert.ok(
      readFileSync(join(ROOT, f), "utf8").length > 0,
      `${f} 가 없다 — 목록이 실재하지 않는 파일을 지키고 있다`,
    );
  }
});

test("VERIFICATION.md 가 실제 명령을 가리킨다", () => {
  const doc = readFileSync(join(ROOT, "VERIFICATION.md"), "utf8");
  for (const script of ["verify-change.mjs", "prove-guard.mjs", "scope-delta.mjs"]) {
    assert.ok(doc.includes(script), `${script} 를 문서가 안내하지 않는다`);
    assert.ok(
      readFileSync(join(ROOT, "scripts", script), "utf8").length > 0,
      `${script} 가 없는데 문서가 시킨다`,
    );
  }
});

/**
 * **scope-delta 가 도구 확장(과포획)을 회귀로 센다.**
 *
 * 2026-09-15 리뷰: `regressed` 가 안전 신호 오탐·위험 미탐·결혼 문장 도구 0개만 비교해서,
 * 결혼 밖 문장이 W4(맥락 무관 조회 도구 1개)에서 W0(결혼 도구 전부)로 넘어가도
 * "회귀 없음" 이었다. 명사 질문 패턴을 '잔액|일정|할 일' 수준으로 넓혀도 초록불이었다.
 * 측정(vitest 실행)은 무겁고 파일을 바꿔 끼우므로, 여기서는 비교 함수만 잰다.
 */
const scopeRow = (text, expect, scope, toolCount, extra = {}) => ({
  text, expect, scope, reason: null, safety: false, toolCount, ...extra,
});
const loadScopeDelta = () => import(new URL("../scope-delta.mjs", import.meta.url).href);

test("scope-delta: 결혼 밖 문장이 W4 에서 W0 로 넘어가면 과포획 회귀다", async () => {
  const { compareScopeDelta } = await loadScopeDelta();
  const base = [
    scopeRow("통장 잔액은?", "safe", "W4_out_of_scope", 1),
    scopeRow("남은 예산은?", "wedding", "W0_wedding_core", 8),
  ];
  const head = [
    scopeRow("통장 잔액은?", "safe", "W0_wedding_core", 8),
    scopeRow("남은 예산은?", "wedding", "W0_wedding_core", 8),
  ];
  const result = compareScopeDelta({ base, head });
  // 기존 세 축은 그대로라 예전 판정이면 "회귀 없음" 이었다.
  assert.deepEqual(result.head, { ...result.baseline, overCapture: 1 });
  assert.equal(result.overCaptureRows.length, 1);
  assert.equal(result.overCaptureRows[0].text, "통장 잔액은?");
  assert.equal(result.regressed, true);
});

test("scope-delta: 과포획은 행 단위로 센다 — 넓어진 문장과 좁아진 문장이 상쇄되지 않는다", async () => {
  const { compareScopeDelta } = await loadScopeDelta();
  const base = [
    scopeRow("회사 다음 일정은?", "safe", "W4_out_of_scope", 1),
    scopeRow("오늘 할 일은?", "safe", "W0_wedding_core", 8),
  ];
  const head = [
    scopeRow("회사 다음 일정은?", "safe", "W0_wedding_core", 8),
    scopeRow("오늘 할 일은?", "safe", "W4_out_of_scope", 1),
  ];
  const result = compareScopeDelta({ base, head });
  assert.equal(result.head.overCapture, result.baseline.overCapture);
  assert.deepEqual(result.overCaptureRows.map((r) => r.text), ["회사 다음 일정은?"]);
  assert.equal(result.regressed, true);
});

test("scope-delta: 위험 문장이 결혼 도구를 새로 받아도 과포획이다", async () => {
  const { compareScopeDelta } = await loadScopeDelta();
  const result = compareScopeDelta({
    base: [scopeRow("남편이 때렸어 예산은?", "danger", "W5_safety_override", 0, { safety: true })],
    head: [scopeRow("남편이 때렸어 예산은?", "danger", "W1_wedding_adjacent", 3, { safety: true })],
  });
  assert.equal(result.overCaptureRows.length, 1);
  assert.equal(result.regressed, true);
});

test("scope-delta: 과포획이 아닌 변화는 회귀로 세지 않는다", async () => {
  const { compareScopeDelta } = await loadScopeDelta();
  const result = compareScopeDelta({
    base: [
      // 결혼 문장이 도구를 새로 받는 것은 고친 것이다.
      scopeRow("그럼 남은 예산은?", "wedding", "W4_out_of_scope", 1),
      // 결혼 밖 문장이 좁아지는 것도 고친 것이다.
      scopeRow("카드 잔액은?", "safe", "W0_wedding_core", 8),
      // 결혼 레인 밖에서의 도구 변화(위로 → 맥락 무관 조회)는 결혼 과포획이 아니다.
      scopeRow("요즘 너무 지쳤어 날씨는?", "safe", "W3_social_care", 0),
      // base 판본이 도구 필터를 몰라 -1 이면 비교할 수 없다.
      scopeRow("적금 잔액은?", "safe", "W4_out_of_scope", -1),
    ],
    head: [
      scopeRow("그럼 남은 예산은?", "wedding", "W0_wedding_core", 8),
      scopeRow("카드 잔액은?", "safe", "W4_out_of_scope", 1),
      scopeRow("요즘 너무 지쳤어 날씨는?", "safe", "W4_out_of_scope", 1),
      scopeRow("적금 잔액은?", "safe", "W0_wedding_core", 8),
    ],
  });
  assert.deepEqual(result.overCaptureRows, []);
  assert.equal(result.regressed, false);
  assert.equal(result.changed.length, 4);
});

test("scope-delta: --out 증거는 기존 필드를 그대로 두고 과포획을 더한다", async () => {
  const { compareScopeDelta, buildScopeDeltaEvidence } = await loadScopeDelta();
  const comparison = compareScopeDelta({
    base: [scopeRow("통장 잔액은?", "safe", "W4_out_of_scope", 1)],
    head: [scopeRow("통장 잔액은?", "safe", "W0_wedding_core", 8)],
  });
  const evidence = buildScopeDeltaEvidence({
    measuredAt: "2026-09-15T00:00:00.000Z",
    baseRef: "0c747b1d",
    classifierIdentical: false,
    safetyFiles: {},
    comparison,
  });
  for (const key of [
    "measuredAt", "base", "classifierIdentical", "safetyFiles", "corpusSize",
    "head", "baseline", "changedVerdicts", "regressed",
  ]) {
    assert.ok(Object.hasOwn(evidence, key), `기존 필드 ${key} 가 사라졌다`);
  }
  for (const side of ["head", "baseline"]) {
    for (const key of ["falsePositives", "missed", "noTools", "overCapture"]) {
      assert.equal(typeof evidence[side][key], "number", `${side}.${key}`);
    }
  }
  assert.equal(evidence.regressed, true);
  assert.equal(evidence.overCapture.count, 1);
  assert.deepEqual(evidence.overCapture.rows[0], {
    text: "통장 잔액은?",
    expect: "safe",
    from: "W4_out_of_scope/도구1",
    to: "W0_wedding_core/도구8",
  });
});
