/**
 * **scope-delta 가 조용히 틀리던 두 자리를 지킨다(2026-09-18).**
 *
 * 1. 인자 파싱. `--out` 없이 부르면 `outIdx` 가 -1 이라 `i !== outIdx + 1` 이 **0번 인자(base)**
 *    를 지웠다. 문서의 사용법 그대로 부르면 "인자가 부족하다" 로 죽었다.
 * 2. 바꿔 재는 범위. `amoraQuestionScope.ts` 한 파일만 base 판본으로 바꾸고 그 파일의 해시로
 *    `classifierIdentical` 을 정했다. 위기 판정의 본체는 `packages/shared/src/safety` 에 있어서,
 *    공유 판정기만 고치면 base 측정도 **고친 판정기로** 돌았다 — base == head 가 되어
 *    "동일 — 분류 결과는 바뀔 수 없다 · 달라진 판정 0" 이 찍혔다.
 *
 * **이 파일은 저장소의 실제 안전 파일을 절대 건드리지 않는다.** 측정은 전부 임시 디렉터리에
 * 같은 상대 경로로 만든 가짜 파일 위에서 돌고, vitest 대신 가짜 측정기를 끼운다. 실제
 * 스크립트를 띄우는 검사는 없는 코퍼스 경로를 줘서 사용법 오류(exit 2)에서 멈춘다 —
 * 파일을 바꿔 끼우는 단계까지 가지 않는다.
 *
 * 파일 목록은 **기본값(SAFETY_FILES)을 그대로 쓴다.** 목록을 테스트가 따로 넘기면, 누가
 * 목록에서 공유 판정기를 빼도 이 검사가 초록불로 남는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as scopeDelta from "../scope-delta.mjs";

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SCRIPTS_DIR, "scope-delta.mjs");

const QUESTION_SCOPE = "apps/web/src/lib/ai/amoraQuestionScope.ts";
const CRISIS_SAFETY = "packages/shared/src/safety/amoraCrisisSafety.ts";
const CLASSIFIER = "packages/shared/src/safety/amoraCrisisClassifier.ts";

/** 가짜 판정기가 "위험 문장을 잡는다" 는 표시. 실제 문장은 필요 없어 쓰지 않는다. */
const CATCHES = "CATCHES_DANGER_ROW";
const CORPUS = [
  { text: "row-danger", expect: "danger" },
  { text: "row-safe", expect: "safe" },
  { text: "row-wedding", expect: "wedding" },
];

/**
 * "동일하다" 고 찍는 줄. 없어야 하는 곳과 있어야 하는 곳이 **같은 식**을 쓴다 — 문구가 바뀌어
 * 식이 낡으면 `doesNotMatch` 는 조용히 통과하지만 `match` 쪽이 빨개진다.
 */
const IDENTICAL_CLAIM = /분류 결과가 바뀔 수 없다/;

const sameContent = (f) => `// fixture ${f}\nexport const marker = "same";\n`;

/**
 * 임시 루트에 안전 파일 다섯 개를 같은 상대 경로로 만든다.
 * `head` 는 디스크에 쓰는 내용, `base` 는 `git show <base>:<파일>` 이 돌려줄 내용이다.
 */
function makeFixture({ head = {}, base = {} } = {}) {
  assert.ok(Array.isArray(scopeDelta.SAFETY_FILES), "scope-delta 가 SAFETY_FILES 를 내보내지 않는다");
  const root = mkdtempSync(join(tmpdir(), "scope-delta-fixture-"));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())), "임시 디렉터리 밖이다");
  const headBytes = {};
  const baseText = {};
  for (const f of scopeDelta.SAFETY_FILES) {
    const onDisk = head[f] ?? sameContent(f);
    headBytes[f] = Buffer.from(onDisk, "utf8");
    baseText[f] = Object.hasOwn(base, f) ? base[f] : sameContent(f);
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), headBytes[f]);
  }
  const corpusPath = join(root, "corpus.json");
  writeFileSync(corpusPath, JSON.stringify(CORPUS), "utf8");
  return {
    root,
    corpusPath,
    outPath: join(root, "evidence.json"),
    backupDir: join(root, ".verification", "scope-delta-backup"),
    headBytes,
    baseText,
    abs: (f) => join(root, f),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** 디스크의 가짜 판정기를 읽어 행을 만든다 — 어느 판본이 끼워져 있는지가 결과에 드러난다. */
function fakeRows(fx) {
  const catches = readFileSync(fx.abs(CLASSIFIER), "utf8").includes(CATCHES);
  return CORPUS.map((row) => {
    const safety = row.expect === "danger" && catches;
    return {
      text: row.text,
      expect: row.expect,
      scope: safety ? "W5_safety_override" : row.expect === "wedding" ? "W0_wedding_core" : "W4_out_of_scope",
      reason: null,
      safety,
      toolCount: safety ? 0 : row.expect === "wedding" ? 8 : 1,
    };
  });
}

/** 항상 임시 루트를 넘긴다. 빠뜨리면 실제 저장소를 재게 되므로 여기 한 곳에서만 부른다. */
function runFixture(fx, { argv, measure, duringMeasure, writeSafetyFile } = {}) {
  const logs = [];
  const errors = [];
  const seen = [];
  const defaultMeasure = () => {
    const call = seen.length + 1;
    seen.push(Object.fromEntries(
      scopeDelta.SAFETY_FILES.map((f) => [f, existsSync(fx.abs(f)) ? readFileSync(fx.abs(f), "utf8") : null]),
    ));
    const rows = fakeRows(fx);
    duringMeasure?.(call);
    return rows;
  };
  let code;
  let thrown = null;
  try {
    code = scopeDelta.runScopeDelta({
      argv: argv ?? ["base-ref", fx.corpusPath, "--out", fx.outPath],
      root: fx.root,
      describeBase: () => ({ resolved: "abc1234", subject: "fixture base" }),
      readBase: (_ref, f) => fx.baseText[f] ?? null,
      measure: measure ?? defaultMeasure,
      writeSafetyFile,
      log: (line) => logs.push(String(line)),
      error: (line) => errors.push(String(line)),
      now: () => new Date("2026-09-18T00:00:00.000Z"),
    });
  } catch (err) {
    thrown = err;
  }
  return { code, thrown, logs: logs.join("\n"), errors: errors.join("\n"), seen };
}

function assertAllRestored(fx) {
  for (const f of scopeDelta.SAFETY_FILES) {
    assert.deepEqual(readFileSync(fx.abs(f)), fx.headBytes[f], `${f} 가 바이트 단위로 돌아오지 않았다`);
  }
}

// ── 1) 인자 파싱 ──────────────────────────────────────────────────────

test("인자: --out 없이 불러도 base 와 코퍼스를 그대로 읽는다", () => {
  assert.deepEqual(
    scopeDelta.parseScopeDeltaArgs(["origin/main", "corpus.json"]),
    { baseRef: "origin/main", corpusPath: "corpus.json", outPath: null, outMissingValue: false },
  );
});

test("인자: --out 이 어디에 있어도 나머지 두 인자의 순서가 유지된다", () => {
  const expected = { baseRef: "origin/main", corpusPath: "corpus.json", outPath: "ev.json", outMissingValue: false };
  for (const argv of [
    ["--out", "ev.json", "origin/main", "corpus.json"],
    ["origin/main", "--out", "ev.json", "corpus.json"],
    ["origin/main", "corpus.json", "--out", "ev.json"],
  ]) {
    assert.deepEqual(scopeDelta.parseScopeDeltaArgs(argv), expected, argv.join(" "));
  }
});

test("인자: --out 뒤에 경로가 없으면 조용히 증거 없이 끝내지 않는다", () => {
  const parsed = scopeDelta.parseScopeDeltaArgs(["origin/main", "corpus.json", "--out"]);
  assert.equal(parsed.outMissingValue, true);
  assert.equal(parsed.baseRef, "origin/main");
  assert.equal(parsed.corpusPath, "corpus.json");

  const fx = makeFixture();
  try {
    let measured = 0;
    const r = runFixture(fx, { argv: ["base-ref", fx.corpusPath, "--out"], measure: () => { measured += 1; return []; } });
    assert.equal(r.code, 2);
    assert.match(r.errors, /--out/);
    assert.equal(measured, 0, "사용법 오류인데 측정을 돌렸다");
  } finally {
    fx.cleanup();
  }
});

/**
 * 실제 스크립트를 띄운다. 코퍼스 경로가 없는 파일이라 사용법 오류에서 멈춘다 — 그 오류 문구에
 * 찍힌 경로로 **두 번째 인자가 코퍼스로 읽혔는지** 확인한다. 고장 난 판본은 base 를 지워
 * 코퍼스 자리에 아무것도 없으므로 "인자가 부족하다" 를 낸다.
 */
function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: SCRIPTS_DIR, encoding: "utf8", timeout: 60_000 });
}

test("CLI: 문서의 사용법 `<base> <corpus>` 가 인자 부족으로 죽지 않는다", () => {
  const temp = mkdtempSync(join(tmpdir(), "scope-delta-cli-"));
  try {
    const missingCorpus = join(temp, "no-such-corpus.json");
    const result = runCli(["origin/main", missingCorpus]);
    assert.equal(result.status, 2, `exit ${result.status}\n${result.stderr}`);
    assert.doesNotMatch(result.stderr, /인자가 부족하다/);
    assert.match(result.stderr, /코퍼스 파일이 없다/);
    assert.ok(result.stderr.includes(missingCorpus), result.stderr);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("CLI: --out 을 붙여도 같은 자리에서 같은 코퍼스를 읽는다", () => {
  const temp = mkdtempSync(join(tmpdir(), "scope-delta-cli-"));
  try {
    const missingCorpus = join(temp, "no-such-corpus.json");
    const evidence = join(temp, "evidence.json");
    for (const args of [
      ["origin/main", missingCorpus, "--out", evidence],
      ["--out", evidence, "origin/main", missingCorpus],
    ]) {
      const result = runCli(args);
      assert.equal(result.status, 2, `exit ${result.status}\n${result.stderr}`);
      assert.match(result.stderr, /코퍼스 파일이 없다/);
      assert.ok(result.stderr.includes(missingCorpus), result.stderr);
      assert.equal(existsSync(evidence), false, "측정 없이 증거 파일이 생겼다");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

// ── 2) 안전 파일 목록 ─────────────────────────────────────────────────

test("목록: 공유 판정기 두 파일이 바꿔 재는 대상에 들어 있다", () => {
  assert.ok(scopeDelta.SAFETY_FILES.includes(CLASSIFIER));
  assert.ok(scopeDelta.SAFETY_FILES.includes(CRISIS_SAFETY));
  assert.ok(scopeDelta.SAFETY_FILES.includes(QUESTION_SCOPE));
});

test("목록: verify-change 의 SAFETY_CRITICAL 과 어긋나지 않는다", () => {
  // verify-change.mjs 는 import 하면 본체가 돌아 버려서 목록을 가져올 수 없다. 소스에서 읽는다.
  const source = readFileSync(join(SCRIPTS_DIR, "verify-change.mjs"), "utf8");
  const start = source.indexOf("const SAFETY_CRITICAL");
  assert.ok(start >= 0, "verify-change.mjs 에서 SAFETY_CRITICAL 을 못 찾았다");
  const block = source.slice(start, source.indexOf("];", start));
  const critical = [...block.matchAll(/"([^"]+\.ts)"/g)].map((m) => m[1]);
  assert.ok(critical.length >= 5, `SAFETY_CRITICAL 에서 ${critical.length}개만 읽었다 — 측정기가 고장 났다`);

  // 분류 결과를 바꾸지 않는 파일만 여기 적는다(감사 로그는 판정에 끼지 않는다).
  const NOT_A_CLASSIFIER = new Set(["apps/web/src/lib/compliance/ai-log.ts"]);
  const expected = critical.filter((f) => !NOT_A_CLASSIFIER.has(f)).sort();
  assert.deepEqual(
    [...scopeDelta.SAFETY_FILES].sort(),
    expected,
    "verify-change 가 안전 파일로 막는 판정 파일을 scope-delta 가 base 로 바꿔 재지 않는다",
  );
});

// ── 3) 공유 판정기만 바뀐 경우 ────────────────────────────────────────

test("공유 판정기만 바뀌어도 base 판본으로 바꿔 재고 classifierIdentical 은 false 다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: `// fixed\nexport const marker = "${CATCHES}";\n` },
    base: { [CLASSIFIER]: `// old\nexport const marker = "misses";\n` },
  });
  try {
    const r = runFixture(fx);
    assert.equal(r.thrown, null, r.thrown?.stack);
    assert.equal(r.code, 0, `${r.logs}\n${r.errors}`);

    // 측정은 두 번. 두 번째는 **base 판정기가 디스크에 있는 상태**에서 돌았다.
    assert.equal(r.seen.length, 2, "base 를 따로 재지 않았다");
    assert.equal(r.seen[0][CLASSIFIER], fx.headBytes[CLASSIFIER].toString("utf8"));
    assert.equal(r.seen[1][CLASSIFIER], fx.baseText[CLASSIFIER]);
    for (const f of scopeDelta.SAFETY_FILES.filter((x) => x !== CLASSIFIER)) {
      assert.equal(r.seen[1][f], fx.headBytes[f].toString("utf8"), `${f} 는 같으므로 건드리지 않는다`);
    }

    const evidence = JSON.parse(readFileSync(fx.outPath, "utf8"));
    assert.equal(evidence.classifierIdentical, false);
    assert.deepEqual(evidence.swappedToBase, [CLASSIFIER]);
    assert.equal(evidence.baseline.missed, 1);
    assert.equal(evidence.head.missed, 0);
    assert.equal(evidence.changedVerdicts, 1);
    assert.equal(evidence.regressed, false);
    assert.equal(evidence.safetyFiles[CLASSIFIER], "변경됨");
    assert.equal(evidence.safetyFiles[QUESTION_SCOPE], "동일");
    assert.equal(evidence.base, "base-ref");
    assert.equal(evidence.measuredAt, "2026-09-18T00:00:00.000Z");
    // verify-change 가 받는 파일이다. 기존 필드는 이름 그대로 남는다.
    for (const key of [
      "measuredAt", "base", "classifierIdentical", "safetyFiles", "corpusSize",
      "head", "baseline", "changedVerdicts", "regressed", "overCapture",
    ]) {
      assert.ok(Object.hasOwn(evidence, key), `기존 필드 ${key} 가 사라졌다`);
    }

    assert.match(r.logs, /\* 변경됨\s+packages\/shared\/src\/safety\/amoraCrisisClassifier\.ts/);
    assert.match(r.logs, / {3}동일\s+apps\/web\/src\/lib\/ai\/amoraQuestionScope\.ts/);
    assert.doesNotMatch(r.logs, IDENTICAL_CLAIM);
    assert.match(r.logs, /판정: 회귀 없음/);

    assertAllRestored(fx);
    assert.equal(existsSync(fx.backupDir), false, "원복을 확인했으면 백업을 남기지 않는다");
  } finally {
    fx.cleanup();
  }
});

test("여러 안전 파일이 바뀌면 전부 함께 base 판본으로 바꾼다", () => {
  const fx = makeFixture({
    head: {
      [QUESTION_SCOPE]: "// head scope\n",
      [CRISIS_SAFETY]: "// head safety\n",
      [CLASSIFIER]: `// head classifier ${CATCHES}\n`,
    },
    base: {
      [QUESTION_SCOPE]: "// base scope\n",
      [CRISIS_SAFETY]: "// base safety\n",
      [CLASSIFIER]: "// base classifier\n",
    },
  });
  try {
    const r = runFixture(fx);
    assert.equal(r.code, 0, `${r.logs}\n${r.errors}`);
    for (const f of [QUESTION_SCOPE, CRISIS_SAFETY, CLASSIFIER]) {
      assert.equal(r.seen[1][f], fx.baseText[f], `${f} 가 base 측정 때 base 판본이 아니었다`);
    }
    const evidence = JSON.parse(readFileSync(fx.outPath, "utf8"));
    assert.deepEqual([...evidence.swappedToBase].sort(), [QUESTION_SCOPE, CRISIS_SAFETY, CLASSIFIER].sort());
    assertAllRestored(fx);
  } finally {
    fx.cleanup();
  }
});

test("안전 파일이 전부 같을 때만 classifierIdentical 이 true 다 — 그때는 한 번만 잰다", () => {
  const fx = makeFixture();
  try {
    const r = runFixture(fx);
    assert.equal(r.code, 0, `${r.logs}\n${r.errors}`);
    assert.equal(r.seen.length, 1);
    const evidence = JSON.parse(readFileSync(fx.outPath, "utf8"));
    assert.equal(evidence.classifierIdentical, true);
    assert.deepEqual(evidence.swappedToBase, []);
    assert.equal(evidence.changedVerdicts, 0);
    assert.match(r.logs, IDENTICAL_CLAIM);
    assertAllRestored(fx);
  } finally {
    fx.cleanup();
  }
});

test("--out 없이도 끝까지 돈다(증거 파일만 안 쓴다)", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: `// fixed ${CATCHES}\n` },
    base: { [CLASSIFIER]: "// old\n" },
  });
  try {
    const r = runFixture(fx, { argv: ["base-ref", fx.corpusPath] });
    assert.equal(r.code, 0, `${r.logs}\n${r.errors}`);
    assert.equal(r.seen.length, 2);
    assert.equal(existsSync(fx.outPath), false);
    assert.match(r.logs, /판정이 달라진 것 1건/);
    assertAllRestored(fx);
  } finally {
    fx.cleanup();
  }
});

test("base 가 잡던 위험 문장을 HEAD 가 놓치면 회귀로 exit 1 이다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: "// loosened\n" },
    base: { [CLASSIFIER]: `// strict ${CATCHES}\n` },
  });
  try {
    const r = runFixture(fx);
    assert.equal(r.code, 1, `${r.logs}\n${r.errors}`);
    const evidence = JSON.parse(readFileSync(fx.outPath, "utf8"));
    assert.equal(evidence.regressed, true);
    assert.equal(evidence.baseline.missed, 0);
    assert.equal(evidence.head.missed, 1);
    assert.match(r.logs, /회귀 있음/);
    assertAllRestored(fx);
  } finally {
    fx.cleanup();
  }
});

// ── 4) 원복 ──────────────────────────────────────────────────────────

test("base 측정이 터져도 바꿔 끼운 파일을 전부 바이트 그대로 되돌린다", () => {
  const fx = makeFixture({
    // CRLF·한글·끝 개행 없음 — 문자열로 되돌리면 어긋나기 쉬운 바이트다.
    head: {
      [CLASSIFIER]: `// 고친 판정기 ${CATCHES}\r\nexport const v = 1;`,
      [CRISIS_SAFETY]: "// head safety\r\n",
    },
    base: { [CLASSIFIER]: "// old\n", [CRISIS_SAFETY]: "// base safety\n" },
  });
  try {
    const r = runFixture(fx, {
      duringMeasure: (call) => {
        if (call === 2) throw new Error("vitest 가 죽었다(가짜)");
      },
    });
    assert.ok(r.thrown, "측정 오류를 삼켰다");
    assert.match(r.thrown.message, /vitest 가 죽었다/);
    assert.equal(r.seen.length, 2);
    assert.equal(r.seen[1][CLASSIFIER], "// old\n", "터지기 전에 base 판본이 끼워져 있었어야 한다");
    assertAllRestored(fx);
    assert.equal(existsSync(fx.backupDir), false);
    assert.equal(existsSync(fx.outPath), false, "측정이 실패했는데 증거를 썼다");
  } finally {
    fx.cleanup();
  }
});

test("되돌릴 수 없으면 exit 3 이고 원본 백업을 남긴다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: `// fixed ${CATCHES}\n` },
    base: { [CLASSIFIER]: "// old\n" },
  });
  try {
    const r = runFixture(fx, {
      duringMeasure: (call) => {
        if (call !== 2) return;
        // 파일 자리에 디렉터리를 놓아 되쓰기가 실패하게 만든다.
        rmSync(fx.abs(CLASSIFIER));
        mkdirSync(fx.abs(CLASSIFIER));
      },
    });
    assert.equal(r.thrown, null, r.thrown?.stack);
    assert.equal(r.code, 3, `${r.logs}\n${r.errors}`);
    assert.match(r.errors, /원복 실패/);
    assert.ok(r.errors.includes(CLASSIFIER));
    assert.doesNotMatch(r.logs, /원복 확인/);
    assert.equal(existsSync(fx.outPath), false, "원복이 실패했는데 증거를 썼다");

    const backups = readdirSync(fx.backupDir);
    assert.equal(backups.length, 1, backups.join(", "));
    assert.deepEqual(readFileSync(join(fx.backupDir, backups[0])), fx.headBytes[CLASSIFIER]);
  } finally {
    fx.cleanup();
  }
});

test("되썼는데 바이트가 원본과 다르면 md5 로 잡아 exit 3 이다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: `// fixed ${CATCHES}\n` },
    base: { [CLASSIFIER]: "// old\n" },
  });
  try {
    const r = runFixture(fx, {
      // 바꿔 끼울 때는 문자열, 되돌릴 때는 원본 Buffer 가 온다. 되돌릴 때만 한 바이트를 덧붙인다 —
      // 쓰기는 "성공" 하지만 내용이 다르다. 예외가 아니라 해시만이 이걸 잡는다.
      writeSafetyFile: (path, data, encoding) => {
        writeFileSync(path, Buffer.isBuffer(data) ? Buffer.concat([data, Buffer.from("\n")]) : data, encoding);
      },
    });
    assert.equal(r.thrown, null, r.thrown?.stack);
    assert.equal(r.code, 3, `${r.logs}\n${r.errors}`);
    assert.match(r.errors, /md5 불일치/);
    assert.ok(r.errors.includes(CLASSIFIER), r.errors);
    assert.doesNotMatch(r.logs, /원복 확인/);
    assert.equal(existsSync(fx.outPath), false, "원복을 증명하지 못했는데 증거를 썼다");

    const backups = readdirSync(fx.backupDir);
    assert.equal(backups.length, 1, backups.join(", "));
    assert.deepEqual(readFileSync(join(fx.backupDir, backups[0])), fx.headBytes[CLASSIFIER]);
  } finally {
    fx.cleanup();
  }
});

test("base 판본으로 바꿔 끼운 것이 no-op 이면 base 를 재지 않고 멈춘다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: `// fixed ${CATCHES}\n` },
    base: { [CLASSIFIER]: "// old\n" },
  });
  try {
    const r = runFixture(fx, {
      // 바꿔 끼우는 쓰기(문자열)만 삼킨다. 디스크는 HEAD 판본 그대로다.
      writeSafetyFile: (path, data, encoding) => {
        if (Buffer.isBuffer(data)) writeFileSync(path, data, encoding);
      },
    });
    assert.ok(r.thrown, "no-op 인데 그대로 쟀다");
    assert.match(r.thrown.message, /no-op/);
    assert.equal(r.seen.length, 1, "base 를 HEAD 판본으로 쟀다");
    assertAllRestored(fx);
    assert.equal(existsSync(fx.backupDir), false);
    assert.equal(existsSync(fx.outPath), false);
  } finally {
    fx.cleanup();
  }
});

test("이전 실행이 남긴 백업이 있으면 재지 않는다 — 덮어쓰면 원본이 사라진다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: "// old\n" }, // 죽은 실행이 base 판본을 남겨 둔 상태
    base: { [CLASSIFIER]: "// old\n" },
  });
  try {
    mkdirSync(fx.backupDir, { recursive: true });
    const stale = join(fx.backupDir, "leftover.bak");
    writeFileSync(stale, "// 커밋 안 한 원본\n", "utf8");

    const r = runFixture(fx);
    assert.equal(r.code, 3, `${r.logs}\n${r.errors}`);
    assert.equal(r.seen.length, 0, "백업이 남아 있는데 측정을 돌렸다");
    assert.match(r.errors, /scope-delta-backup/);
    assert.equal(readFileSync(stale, "utf8"), "// 커밋 안 한 원본\n");
    assertAllRestored(fx);
  } finally {
    fx.cleanup();
  }
});

test("바꿔 끼운 동안 다른 곳에서 쓴 내용은 버리지 않고 옆에 남긴다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: `// fixed ${CATCHES}\n` },
    base: { [CLASSIFIER]: "// old\n" },
  });
  try {
    const r = runFixture(fx, {
      duringMeasure: (call) => {
        if (call === 2) writeFileSync(fx.abs(CLASSIFIER), "// 다른 세션이 쓴 내용\n", "utf8");
      },
    });
    assert.equal(r.code, 3, `${r.logs}\n${r.errors}`);
    assertAllRestored(fx);
    const kept = readdirSync(fx.backupDir).filter((name) => name.endsWith(".foreign"));
    assert.equal(kept.length, 1, readdirSync(fx.backupDir).join(", "));
    assert.equal(readFileSync(join(fx.backupDir, kept[0]), "utf8"), "// 다른 세션이 쓴 내용\n");
    assert.equal(existsSync(fx.outPath), false);
  } finally {
    fx.cleanup();
  }
});

test("바꾸지 않은 안전 파일이 측정 중에 바뀌면 덮어쓰지 않고 측정을 무효로 한다", () => {
  const fx = makeFixture({
    head: { [CLASSIFIER]: `// fixed ${CATCHES}\n` },
    base: { [CLASSIFIER]: "// old\n" },
  });
  try {
    const r = runFixture(fx, {
      duringMeasure: (call) => {
        if (call === 1) writeFileSync(fx.abs(QUESTION_SCOPE), "// 다른 세션의 편집\n", "utf8");
      },
    });
    assert.equal(r.code, 3, `${r.logs}\n${r.errors}`);
    assert.ok(r.errors.includes(QUESTION_SCOPE), r.errors);
    assert.equal(readFileSync(fx.abs(QUESTION_SCOPE), "utf8"), "// 다른 세션의 편집\n", "남의 편집을 덮어썼다");
    assert.deepEqual(readFileSync(fx.abs(CLASSIFIER)), fx.headBytes[CLASSIFIER]);
    assert.equal(existsSync(fx.outPath), false);
  } finally {
    fx.cleanup();
  }
});
