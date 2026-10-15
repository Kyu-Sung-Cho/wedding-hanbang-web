// CI가 "이 커밋이 뭔가를 깼는지"를 알려 주는 신호를 유지하는지 잠근다.
//
// 이 저장소의 집계 잡 `Quality Gate`(`ci`)는 돌면 **반드시 빨간불**이다.
// `production_readiness`가 무조건 실패하고 게이트가 그 성공을 요구한다.
// 2026-07-19에는 "초록불을 보고 배포해도 된다고 믿는 사람이 없게" 이 둘을 PR마다
// 돌렸고, 2026-09-27 파운더 승인으로 수동 실행(workflow_dispatch) 전용이 됐다
// (30일 209회가 전부 '실패'로 보였고 그중 184회는 이 둘만 빨갰다).
// `vendor-public-rls-probe.test.mjs`가 잡 이름·스텝 이름·`exit 1`·게이트 의존을
// 못 박고 있다.
//
// 그래서 파손 신호는 **신호 전용 집계**(`code_quality_signal`)가 낸다. 이 잡의
// 이름이 main 보호의 유일한 필수 검사다.
//
// 여기서 지키는 것:
//   ① 신호 잡이 코드 품질 잡 전부를 실제 조건문에서 확인한다
//   ② 신호 잡이 의도적 차단(항상 실패하는 잡)에 오염되지 않는다
//   ③ 릴리스 차단은 수동 실행에서 계속 살아 있다
//   ④ 진짜 강제 수단(매니페스트 핀·fail-closed 컨트롤러)이 계속 돈다
//   ⑤ 이벤트별로 도는 잡(2026-09-27): push는 캐시 잡만, PR은 코드 검사와 필수 검사,
//      수동 실행은 전부. GitHub의 `if:` 식을 좁게 흉내 내 실제로 평가한다.
//   ⑥ 필수 검사 이름과 needs 다섯 개, 웹 테스트 네 갈래·worker 2

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = resolve(HERE, "..", "..", ".github", "workflows", "ci.yml");
// 줄바꿈을 먼저 정규화한다. Windows에서 편집해 CRLF가 되면 아래 구조 검사가
// 통째로 헛돌고(실측), 그러면 "고장을 못 잡는 가드"라는 이 파일이 막으려는
// 바로 그 상태가 된다.
const workflow = readFileSync(WORKFLOW_PATH, "utf8").replace(/\r\n?/g, "\n");

/** 파손 신호를 내는 집계 잡. 릴리스 인가와 무관해야 한다. */
const SIGNAL_JOB = "code_quality_signal";

/**
 * main 보호가 찾는 필수 검사 이름. 한 글자라도 바뀌면 필수 검사가 영영 안 생겨
 * 모든 PR이 "대기 중"으로 멈춘다. 대시는 U+2014(—)다.
 */
const REQUIRED_CHECK_NAME = "Code Quality (breakage signal only — not a release authorization)";

/** 신호 잡이 성공을 요구해야 하는 코드 품질 잡. */
const REQUIRED_QUALITY_JOBS = [
  "web_quality",
  "web_tests",
  "mobile_quality",
  "vendor_disclosure_quality",
  "static_release_contracts",
];

/** 의도적으로 항상 실패하는 릴리스 차단 잡. 신호 잡이 여기 묶이면 안 된다. */
const BLOCKING_JOB = "production_readiness";

/** 돌면 BLOCKING_JOB 의 실패를 받아 실패하는 최종 게이트. */
const FINAL_GATE_JOB = "ci";

/** main push에서 설치 캐시만 채우는 잡. */
const CACHE_JOB = "main_install_cache";

/**
 * 최상위 `jobs:` 아래의 잡을 이름 → 본문으로 쪼갠다.
 *
 * YAML 파서 의존성을 새로 넣지 않으려고 필요한 구조만 좁게 읽는다. 대신 파싱이
 * 조용히 실패하면 이 테스트가 아무것도 검사하지 않게 되므로(그게 이 저장소가
 * 실제로 겪은 실패 유형이다) 아래에서 파싱 결과 자체를 먼저 단정한다.
 */
function parseJobs(source) {
  const jobsStart = source.indexOf("\njobs:\n");
  if (jobsStart === -1) return new Map();
  const body = source.slice(jobsStart + "\njobs:\n".length);
  const lines = body.split("\n");

  const jobs = new Map();
  let current = null;
  let buffer = [];
  for (const line of lines) {
    const header = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (header) {
      if (current) jobs.set(current, buffer.join("\n"));
      current = header[1];
      buffer = [];
      continue;
    }
    // 들여쓰기가 0인 실제 내용이 나오면 jobs 블록이 끝난 것이다(주석·빈 줄은 제외).
    if (current && line.trim() && !line.startsWith(" ") && !line.startsWith("#")) break;
    // 주석은 본문에 넣지 않는다. 다음 잡을 설명하는 주석이 앞 잡 본문에 붙어,
    // 주석에 적힌 명령 이름 때문에 검사가 통과한 적이 있다(2026-07-27 실측).
    if (current && !/^\s*#/.test(line)) buffer.push(line);
  }
  if (current) jobs.set(current, buffer.join("\n"));
  return jobs;
}

/** `needs: [a, b]`와 여러 줄 형식 모두에서 잡 이름을 뽑는다. */
function neededJobs(jobBody) {
  const inline = /^\s*needs:\s*\[([^\]]*)\]/m.exec(jobBody);
  if (inline) {
    return inline[1].split(",").map((name) => name.trim()).filter(Boolean);
  }
  const block = /^\s*needs:\s*\n((?:\s*-\s*[^\n]+\n?)+)/m.exec(jobBody);
  if (block) {
    return [...block[1].matchAll(/-\s*([^\s#]+)/g)].map((match) => match[1]);
  }
  return [];
}

/** 잡 본문의 `run: |` 블록들. 들여쓰기 폭에 의존하지 않는다. */
function runBlocks(jobBody) {
  return [...jobBody.matchAll(/run:\s*\|\s*\n([\s\S]*?)(?=\n\s*-\s+name:|\n\s{0,4}[a-z_]+:|$)/g)]
    .map((match) => match[1]);
}

/**
 * 잡이 실제로 **실행하는** 내용만 모은다(`run:` 값 전부).
 *
 * 잡 이름·스텝 이름·주석은 실행되지 않으므로 검사 근거가 될 수 없다. 잡 이름에
 * 들어 있는 단어 때문에 본문을 지워도 검사가 통과한 적이 있다.
 */
function jobCommands(jobBody) {
  const blocks = runBlocks(jobBody);
  const inline = [...jobBody.matchAll(/^\s*run:\s*(?!\|)([^\n]+)/gm)].map((match) => match[1]);
  const folded = [...jobBody.matchAll(/run:\s*>-?\s*\n([\s\S]*?)(?=\n\s*-\s+name:|\n\s{0,4}[a-z_]+:|$)/g)]
    .map((match) => match[1]);
  return [...blocks, ...inline, ...folded].join("\n");
}

/**
 * 조건 없이 `exit 1`로 끝나는 run 블록이 있는가(= 파이프라인 실패를 강제하는가).
 *
 * `if [ ... ]; then ... exit 1; fi`처럼 조건 안에 있는 `exit 1`은 정상적인 게이트다.
 * 셸 조건(`if`·`case`·`&&`·`||`)이 하나도 없는데 `exit 1`이 있으면 무조건 실패다.
 */
function hasUnconditionalFailure(jobBody) {
  return runBlocks(jobBody).some((block) => {
    // "블록에 if가 있으면 전부 조건부"로 뭉뚱그리면 **조건문 밖의 맨 `exit 1`**을
    // 놓친다(2026-07-27 실측: 조건부 게이트 앞에 exit 1을 끼워 넣은 변이를 통과시켰다).
    // if/fi 깊이를 세어 최상위에 있는 것만 무조건 실패로 본다.
    let depth = 0;
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (/^(if|case)\b/.test(line)) depth += 1;
      else if (/^(fi|esac)\b/.test(line)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && /^exit\s+[1-9]\d*$/.test(line)) return true;
    }
    return false;
  });
}

/** 잡 수준 `if:`(들여쓰기 4칸). 스텝의 `if:`는 더 깊어서 걸리지 않는다. */
function jobCondition(jobBody) {
  return /^ {4}if:\s*(.+?)\s*$/m.exec(jobBody)?.[1] ?? null;
}

/** 잡 수준 `name:` 값(따옴표를 벗긴 원문). */
function jobName(jobBody) {
  const raw = /^ {4}name:\s*(.+?)\s*$/m.exec(jobBody)?.[1] ?? null;
  if (raw === null) return null;
  const quoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw);
  return quoted ? quoted[1] : raw;
}

/**
 * GitHub Actions `if:` 식의 좁은 흉내.
 *
 * 이 워크플로가 쓰는 문법만 안다: `always()`·`success()`·`failure()`·`cancelled()`,
 * `github.event_name`, 작은따옴표 문자열, `==`·`!=`·`&&`·`||`·`!`, 괄호.
 * **모르는 토큰을 만나면 던진다** — 모르는 식을 참이나 거짓으로 짐작하면 이
 * 테스트가 조용히 틀린다. 새 문법을 쓰면 여기부터 넓혀야 한다.
 *
 * GitHub 규칙대로 상태 함수가 없는 식에는 `success() &&`가 암묵적으로 붙는다.
 * 그래서 앞 잡이 skipped인데 `always()`가 없으면 이 잡도 건너뛴다.
 */
function evaluateCondition(expression, { event, needResults }) {
  let source = String(expression ?? "success()").trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(source);
  if (wrapped) source = wrapped[1].trim();
  if (!/\b(?:always|success|failure|cancelled)\(\)/.test(source)) {
    source = `success() && (${source})`;
  }

  const tokens = [];
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) { i += space[0].length; continue; }
    const operator = /^(?:==|!=|&&|\|\||[()!])/.exec(rest);
    if (operator) { tokens.push({ op: operator[0] }); i += operator[0].length; continue; }
    const string = /^'([^']*)'/.exec(rest);
    if (string) { tokens.push({ value: string[1] }); i += string[0].length; continue; }
    const call = /^(always|success|failure|cancelled)\(\)/.exec(rest);
    if (call) {
      const fn = call[1];
      const value = fn === "always" ? true
        : fn === "success" ? needResults.every((result) => result === "success")
        : fn === "failure" ? needResults.some((result) => result === "failure")
        : false;
      tokens.push({ value });
      i += call[0].length;
      continue;
    }
    const context = /^github\.event_name\b/.exec(rest);
    if (context) { tokens.push({ value: event }); i += context[0].length; continue; }
    throw new Error(`if 식에 이 흉내가 모르는 토큰이 있다: '${rest}' (식: ${expression})`);
  }

  let position = 0;
  const peek = () => tokens[position]?.op;
  const take = () => tokens[position++];
  const primary = () => {
    const token = take();
    if (!token) throw new Error(`if 식이 중간에 끝났다: ${expression}`);
    if (token.op === "(") {
      const value = or();
      if (take()?.op !== ")") throw new Error(`괄호가 닫히지 않았다: ${expression}`);
      return value;
    }
    if (token.op === "!") return !primary();
    if ("value" in token) return token.value;
    throw new Error(`if 식에서 '${token.op}'가 올 자리가 아니다: ${expression}`);
  };
  const compare = () => {
    let left = primary();
    while (peek() === "==" || peek() === "!=") {
      const operator = take().op;
      const right = primary();
      left = operator === "==" ? left === right : left !== right;
    }
    return left;
  };
  const and = () => {
    let left = compare();
    while (peek() === "&&") { take(); left = compare() && left; }
    return left;
  };
  const or = () => {
    let left = and();
    while (peek() === "||") { take(); left = and() || left; }
    return left;
  };
  const result = or();
  if (position !== tokens.length) throw new Error(`if 식 뒤에 남은 토큰이 있다: ${expression}`);
  return Boolean(result);
}

/**
 * 한 이벤트에서 잡마다 결과를 흉내 낸다. `failing`에 든 잡은 돌면 실패하고,
 * 나머지 코드 검사는 통과했다고 둔다.
 *
 * 돈 잡의 결과: 조건 없는 `exit 1`이 있으면 failure, env로 받은 needs 결과를
 * 실패 조건문에서 보는데 그중 success가 아닌 것이 있으면 failure, 아니면 success.
 */
function simulateEvent(event, { failing = [] } = {}) {
  const results = new Map();
  const names = [...jobs.keys()];
  for (let round = 0; round < names.length + 1 && results.size < names.length; round += 1) {
    for (const name of names) {
      if (results.has(name)) continue;
      const body = jobs.get(name);
      const needs = neededJobs(body);
      if (!needs.every((need) => results.has(need))) continue;
      const needResults = needs.map((need) => results.get(need));
      const runs = evaluateCondition(jobCondition(body) ?? "success()", { event, needResults });
      if (!runs) { results.set(name, "skipped"); continue; }
      let result = hasUnconditionalFailure(body) || failing.includes(name) ? "failure" : "success";
      const bindings = new Map([...body.matchAll(/(\w+):\s*\$\{\{\s*needs\.(\w+)\.result\s*\}\}/g)]
        .map((match) => [match[1], match[2]]));
      for (const line of jobCommands(body).split("\n").filter((text) => /^\s*if\s+\[/.test(text))) {
        for (const [, variable] of line.matchAll(/"\$(\w+)"\s*!=\s*"success"/g)) {
          const need = bindings.get(variable);
          if (!need || results.get(need) !== "success") result = "failure";
        }
      }
      results.set(name, result);
    }
  }
  assert.equal(results.size, names.length,
    `${event}: needs 순서를 풀지 못한 잡이 있다 — 순환이거나 없는 잡을 needs에 뒀다`);
  return results;
}

const ranIn = (results) => [...results].filter(([, result]) => result !== "skipped")
  .map(([name]) => name).sort();

const jobs = parseJobs(workflow);

test("웹 품질 검사는 제한된 힙을 공유하고 타입 검사와 실패 전파를 유지한다", () => {
  const quality = jobs.get("web_quality");
  assert.match(quality, /^ {4}env:\s*\n {6}NODE_OPTIONS: ["']?--max-old-space-size=4096["']?\s*$/m,
    "독립 tsc와 Next 타입 검사 자식 모두 명시한 4 GiB 힙을 상속해야 한다");
  assert.equal((workflow.match(/NODE_OPTIONS:/g) ?? []).length, 1,
    "힙 증설은 웹 품질 검사 잡에만 적용한다");
  assert.match(quality, /getHeapStatistics\(\)\.heap_size_limit/,
    "실제 Node 힙 상한을 기록한다");
  assert.match(quality, /totalmem\(\)/, "실제 runner 메모리를 기록한다");
  assert.match(quality, /availableParallelism\(\)/, "실제 runner CPU 한도를 기록한다");
  assert.match(jobCommands(quality), /pnpm --filter @hanbang\/web exec tsc --noEmit/);
  assert.match(jobCommands(quality), /pnpm --filter @hanbang\/web exec eslint \./);
  assert.match(jobCommands(quality), /pnpm --filter @hanbang\/web build/);
  assert.doesNotMatch(quality, /continue-on-error\s*:|\|\|\s*true/);
  const config = readFileSync(resolve(HERE, "..", "..", "apps/web/next.config.ts"), "utf8");
  assert.doesNotMatch(config, /ignoreBuildErrors\s*:\s*true/,
    "독립 tsc가 있어도 Next 빌드의 타입 검사를 생략하지 않는다");
});

test("웹 테스트는 네 갈래로 전체 파일을 나누고 갈래 안 worker는 2로 둔다", () => {
  // 2026-09-27 두 갈래 → 네 갈래(한 갈래 21~27분). 속도는 갈래 수로만 올린다.
  // worker를 4로 올렸던 07-17에 PGlite가 테스트 프로세스를 두 번 죽였다.
  const shards = jobs.get("web_tests");
  assert.ok(shards, "웹 테스트 shard 잡이 없다");
  assert.match(shards, /^\s*runs-on:\s*ubuntu-latest\s*$/m);
  assert.match(shards, /^\s*fail-fast:\s*false\s*$/m);
  assert.match(shards, /^\s*max-parallel:\s*4\s*$/m);
  assert.match(shards, /^\s*shard:\s*\[1,\s*2,\s*3,\s*4\]\s*$/m);
  assert.equal(jobName(shards), "Web Tests (shard ${{ matrix.shard }}/4)",
    "잡 이름의 분모가 실제 갈래 수와 다르면 CI 화면이 거짓말을 한다");
  assert.doesNotMatch(shards, /continue-on-error\s*:/);
  const testCommand = /^\s*run:\s*([^\n]*vitest run[^\n]*)$/m.exec(shards)?.[1];
  assert.equal(testCommand,
    "pnpm --filter @hanbang/web exec vitest run --shard=${{ matrix.shard }}/4 --maxWorkers=2",
    "shard 인덱스·분모·안정 worker 수를 유지하고 파일 필터나 빈 검사 허용을 넣지 않는다");
  const vitestConfig = readFileSync(resolve(HERE, "..", "..", "apps/web/vitest.config.ts"), "utf8");
  assert.match(vitestConfig, /^\s*maxWorkers:\s*2,\s*$/m,
    "로컬·pre-push·CI가 함께 쓰는 PGlite 안정 worker 수 2를 올리지 않는다");
  assert.doesNotMatch(jobCommands(jobs.get("web_quality")), /vitest\s+run/);
  assert.equal((jobCommands(jobs.get("web_quality")).match(/pnpm --filter @hanbang\/web build/g) ?? []).length, 1);
  assert.doesNotMatch(jobCommands(shards), /\b(?:build|eslint|tsc)\b/);
  for (const name of [SIGNAL_JOB, FINAL_GATE_JOB]) {
    const body = jobs.get(name);
    assert.ok(neededJobs(body).includes("web_tests"), `${name}가 갈래 결과를 기다리지 않는다`);
    const bound = /(\w+):\s*\$\{\{\s*needs\.web_tests\.result/.exec(body);
    assert.ok(bound, `${name}가 갈래 결과를 받지 않는다`);
    const condition = /^\s*if\s+\[[^\n]*$/m.exec(jobCommands(body))?.[0] ?? "";
    assert.ok(condition.includes(`"$${bound[1]}" != "success"`),
      `${name}는 한 갈래라도 실패·취소·누락되면 성공하면 안 된다`);
  }
});

test("워크플로 파싱이 실제로 동작한다 (빈 검사로 통과하지 않게)", () => {
  // 파싱이 깨지면 아래 검사들이 전부 공회전한다. 그 상태를 먼저 막는다.
  assert.ok(jobs.size >= 6, `잡을 ${jobs.size}개만 읽었다 — 파서가 깨졌다`);
  for (const name of [...REQUIRED_QUALITY_JOBS, SIGNAL_JOB, BLOCKING_JOB, FINAL_GATE_JOB, CACHE_JOB]) {
    assert.ok(jobs.has(name), `잡 '${name}'을 못 찾았다 — 파서가 깨졌거나 잡이 사라졌다`);
  }
  assert.ok(
    neededJobs(jobs.get(SIGNAL_JOB)).length >= 4,
    "신호 잡의 needs를 못 읽었다 — 파서가 깨졌다",
  );
  // 잡 수준 if를 하나라도 못 읽으면 이벤트 흉내가 그 잡을 "조건 없음"으로 보고
  // 틀린 표를 만든다. 원문의 잡 수준 if 줄 수와 읽은 수가 같아야 한다.
  const rawConditions = (workflow.match(/^ {4}if:/gm) ?? []).length;
  const parsedConditions = [...jobs.values()].filter((body) => jobCondition(body) !== null).length;
  assert.equal(parsedConditions, rawConditions, "잡 수준 if를 일부만 읽었다 — 파서가 깨졌다");
  assert.ok(rawConditions >= 9, `잡 수준 if가 ${rawConditions}개뿐이다 — 이벤트 조건이 빠졌다`);
});

test("필수 검사 잡의 이름과 needs 다섯 개는 바뀌지 않는다", () => {
  // main 보호는 이 이름 하나만 필수로 본다. 이름이 바뀌면 필수 검사가 영영 안
  // 생겨 모든 PR이 멈추고, needs가 줄면 그 잡이 깨져도 초록불이 된다.
  const signal = jobs.get(SIGNAL_JOB);
  assert.equal(jobName(signal), REQUIRED_CHECK_NAME);
  assert.deepEqual([...neededJobs(signal)].sort(), [...REQUIRED_QUALITY_JOBS].sort(),
    "필수 검사의 needs는 코드 검사 다섯 잡과 정확히 같아야 한다(캐시 잡·차단 잡 금지)");
  const names = [...jobs.values()].map(jobName);
  assert.equal(names.filter((name) => name === REQUIRED_CHECK_NAME).length, 1,
    "필수 검사 이름을 가진 잡은 하나여야 한다");
});

test("워크플로는 PR·main push·수동 실행 세 트리거를 유지한다", () => {
  // push 트리거를 지우면 main 범위의 설치 캐시가 사라진다(PR은 main 캐시만 읽는다).
  const head = workflow.slice(0, workflow.indexOf("\njobs:\n"))
    .split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  assert.match(head, /^ {2}workflow_dispatch:\s*\{\}\s*$/m);
  assert.match(head, /^ {2}push:\s*\n {4}branches:\s*\[main\]\s*$/m);
  assert.match(head, /^ {2}pull_request:\s*\n {4}branches:\s*\[main\]\s*$/m);
});

test("main push에서는 설치 캐시 잡만 돈다", () => {
  const push = simulateEvent("push");
  assert.deepEqual(ranIn(push), [CACHE_JOB],
    "main push에서 코드 검사가 다시 돌거나(러너 20~28분 낭비) 캐시 잡이 안 돈다");
  assert.equal(push.get(CACHE_JOB), "success");
});

test("pull_request에서는 코드 검사 다섯 잡과 필수 검사가 돌고 차단 잡은 돌지 않는다", () => {
  // 필수 검사 잡이 PR에서 조건 때문에 skipped가 되면 GitHub은 그것을 성공으로
  // 보고해 **아무것도 검사하지 않고 병합을 허락한다**. 코드 검사 잡 하나가
  // skipped여도 needs 결과가 success가 아니어서 모든 PR이 막힌다.
  const pr = simulateEvent("pull_request");
  assert.deepEqual(ranIn(pr), [...REQUIRED_QUALITY_JOBS, SIGNAL_JOB].sort());
  for (const name of REQUIRED_QUALITY_JOBS) {
    assert.equal(pr.get(name), "success", `PR에서 '${name}'이 돌지 않는다`);
  }
  assert.equal(pr.get(SIGNAL_JOB), "success",
    "코드 검사가 전부 통과한 PR에서 필수 검사가 초록이 아니다");
  assert.equal(pr.get(BLOCKING_JOB), "skipped");
  assert.equal(pr.get(FINAL_GATE_JOB), "skipped");
  assert.equal(pr.get(CACHE_JOB), "skipped");
});

test("pull_request에서 코드 검사 하나가 깨지면 필수 검사는 돌아서 빨개진다", () => {
  // 필수 검사 잡에서 `always()`가 빠지면 앞 잡이 실패할 때 이 잡이 skipped가 되고,
  // GitHub은 skipped 필수 검사를 성공으로 친다 — 깨진 코드가 초록불로 병합된다.
  // 모두 통과하는 경우만 흉내 내면 이 변이를 못 본다(2026-09-27 prove-guard 실측).
  for (const broken of REQUIRED_QUALITY_JOBS) {
    const pr = simulateEvent("pull_request", { failing: [broken] });
    assert.equal(pr.get(broken), "failure");
    assert.equal(pr.get(SIGNAL_JOB), "failure",
      `'${broken}'이 깨진 PR에서 필수 검사가 ${pr.get(SIGNAL_JOB)}다 — 깨진 코드가 병합될 수 있다`);
  }
});

test("수동 실행에서는 전부 돌고 차단 두 잡은 반드시 실패한다", () => {
  const dispatch = simulateEvent("workflow_dispatch");
  assert.deepEqual(ranIn(dispatch),
    [...REQUIRED_QUALITY_JOBS, SIGNAL_JOB, BLOCKING_JOB, FINAL_GATE_JOB].sort());
  assert.equal(dispatch.get(SIGNAL_JOB), "success");
  assert.equal(dispatch.get(BLOCKING_JOB), "failure", "수동 실행에서 릴리스 차단이 fail-closed가 아니다");
  assert.equal(dispatch.get(FINAL_GATE_JOB), "failure", "수동 실행에서 Quality Gate가 차단을 반영하지 않는다");
});

test("차단 두 잡은 수동 실행 전용 조건을 정확히 쓴다", () => {
  // `always()`를 빼면 앞 잡이 실패했을 때 건너뛰어 차단이 사라지고,
  // 이벤트 조건을 빼면 PR마다 다시 빨개진다(2026-09-27 이전 상태).
  for (const name of [BLOCKING_JOB, FINAL_GATE_JOB]) {
    assert.equal(jobCondition(jobs.get(name)),
      "${{ always() && github.event_name == 'workflow_dispatch' }}", `${name}의 조건이 바뀌었다`);
  }
});

test("설치 캐시 잡은 설치만 하고 코드 검사와 같은 액션 핀을 쓴다", () => {
  const cache = jobs.get(CACHE_JOB);
  assert.equal(jobCondition(cache), "${{ github.event_name == 'push' }}");
  assert.deepEqual(neededJobs(cache), [], "캐시 잡은 다른 잡을 기다리지 않는다");
  assert.equal(jobCommands(cache).trim(), "pnpm install --frozen-lockfile",
    "캐시 잡이 설치 말고 다른 것을 돌리면 main 재검사가 몰래 되살아난다");
  const actions = (body) => [...body.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(actions(cache), actions(jobs.get("web_quality")),
    "캐시 잡의 checkout·pnpm·setup-node 핀이 코드 검사와 다르면 캐시 키·경로가 어긋날 수 있다");
  assert.match(cache, /^\s*cache:\s*pnpm\s*$/m, "setup-node가 pnpm 저장소 캐시를 저장해야 한다");
  assert.match(cache, /^\s*persist-credentials:\s*false\s*$/m);
  for (const name of jobs.keys()) {
    assert.ok(!neededJobs(jobs.get(name)).includes(CACHE_JOB),
      `'${name}'이 캐시 잡을 needs에 둔다 — PR에서 캐시 잡은 skipped다`);
  }
});

test("신호 잡은 코드 품질 잡 전부를 실제 조건문에서 확인한다", () => {
  const signal = jobs.get(SIGNAL_JOB);
  // env에 결과를 담아 두고 조건문에서 안 쓰면 그 잡은 깨져도 초록불이다.
  // 선언만 보면 그 변이를 놓친다(2026-07-27 실측) — 실제 실패 조건을 본다.
  const failureCondition = /^\s*if\s+\[[^\n]*$/m.exec(jobCommands(signal))?.[0] ?? "";
  assert.ok(failureCondition.length > 0, "신호 잡의 실패 조건문을 못 찾았다 — 검사가 공회전한다");

  for (const name of REQUIRED_QUALITY_JOBS) {
    assert.ok(
      neededJobs(signal).includes(name),
      `신호 잡이 '${name}'을 needs에 두지 않는다 — 그 잡이 깨져도 초록불이 된다`,
    );
    const bound = new RegExp(`(\\w+):\\s*\\$\\{\\{\\s*needs\\.${name}\\.result`).exec(signal);
    assert.ok(bound, `신호 잡이 '${name}'의 결과를 env로 받지 않는다`);
    assert.ok(
      failureCondition.includes(`$${bound[1]}`),
      `신호 잡의 실패 조건문이 '${name}'(${bound[1]})을 확인하지 않는다`
      + " — 그 잡이 깨져도 신호는 초록불이 된다",
    );
  }
});

test("필수 신호 잡도 다른 품질 잡과 같은 checkout 증거를 남기고 인증정보를 보존하지 않는다", () => {
  const signal = jobs.get(SIGNAL_JOB);
  const checkout = /^\s*uses:\s*(actions\/checkout@[a-f0-9]{40})\b/m;
  const reference = checkout.exec(jobs.get("web_quality"))?.[1];
  assert.ok(reference, "기준 품질 잡의 고정 checkout 액션을 찾지 못했다");
  assert.equal(checkout.exec(signal)?.[1], reference,
    "필수 신호 잡의 실제 checkout이 없으면 운영 admission이 검사된 소스를 검증할 수 없다");
  assert.match(signal, /^\s*persist-credentials:\s*false\s*$/m);
  assert.doesNotMatch(signal, /^\s*ref:\s*/m,
    "신호 잡만 다른 ref를 checkout하면 같은 실행의 코드 검사 증거가 섞인다");
});

test("신호 잡은 의도적 차단에 오염되지 않는다", () => {
  const signal = jobs.get(SIGNAL_JOB);
  assert.ok(
    !neededJobs(signal).includes(BLOCKING_JOB),
    `신호 잡이 '${BLOCKING_JOB}'에 의존한다 — 항상 빨간불이 되어 파손 신호가 다시 죽는다`,
  );
  assert.ok(
    !new RegExp(`needs\\.${BLOCKING_JOB}\\.result`).test(signal),
    `신호 잡이 '${BLOCKING_JOB}'의 결과를 읽는다 — 릴리스 차단이 파손 신호를 덮는다`,
  );
  // 조건 없이 실패하는 다른 잡에 묶여도 같은 결과가 된다. needs 전체를 확인한다.
  for (const name of neededJobs(signal)) {
    const body = jobs.get(name);
    assert.ok(body, `신호 잡이 의존하는 '${name}'의 본문을 못 읽었다 — 검사가 공회전한다`);
    assert.ok(
      !hasUnconditionalFailure(body),
      `신호 잡이 조건 없이 실패하는 '${name}'에 의존한다 — 파손 여부와 무관하게 빨간불이 된다`,
    );
  }
  // 신호 잡 자신은 조건부로만 실패해야 한다.
  assert.ok(
    !hasUnconditionalFailure(signal),
    "신호 잡 자신이 조건 없이 실패한다 — 신호가 아니라 상수다",
  );
});

test("릴리스 차단은 수동 실행에서 계속 살아 있다", () => {
  // 신호를 살리자고 차단을 없애면 안 된다. 2026-09-27부터 PR에서는 돌지 않지만
  // 잡과 무조건 실패는 그대로다. 세부 구조는 `vendor-public-rls-probe.test.mjs`가
  // 못 박고 있고, 여기서는 존재만 확인한다.
  const blocking = jobs.get(BLOCKING_JOB);
  assert.ok(
    hasUnconditionalFailure(blocking),
    `'${BLOCKING_JOB}'이 더 이상 무조건 실패하지 않는다`
    + " — 릴리스 차단 선언이 풀렸다. 의도한 변경이면 계약 테스트도 함께 고칠 것",
  );
  assert.match(
    jobs.get(FINAL_GATE_JOB),
    new RegExp(`needs\\.${BLOCKING_JOB}\\.result`),
    "Quality Gate가 릴리스 차단을 더 이상 반영하지 않는다",
  );
});

test("진짜 강제 수단(매니페스트·컨트롤러 검증)은 계속 돈다", () => {
  // 차단을 실제로 하는 것은 이 두 명령이다. 주석·스텝 이름이 아니라 실행 명령으로 확인한다.
  const commands = jobCommands(jobs.get("static_release_contracts"));
  assert.ok(commands.length > 0, "릴리스 계약 잡의 실행 내용을 못 읽었다 — 검사가 공회전한다");
  assert.match(commands, /node scripts\/wedding-code36-release\.mjs --check-only --expected-commit=\$\{\{ github\.sha \}\}/,
    "정확한 CI 커밋에 묶인 매니페스트 핀 검증이 빠졌다");
  assert.match(commands, /supabase:release:test/, "fail-closed 컨트롤러 검증이 CI에서 빠졌다");
});
