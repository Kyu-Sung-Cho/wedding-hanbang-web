// CI가 "이 커밋이 뭔가를 깼는지"를 알려 주는 신호를 유지하는지 잠근다.
//
// 이 저장소의 집계 잡 `Quality Gate`는 **의도적으로 항상 빨간불**이다.
// `production_readiness`가 무조건 실패하고 게이트가 그 성공을 요구한다 —
// "초록불을 보고 배포해도 된다고 믿는 사람이 없게" 하려는 결정이고,
// `vendor-public-rls-probe.test.mjs`가 잡 이름·스텝 이름·`exit 1`·게이트 의존을
// 전부 못 박고 있다. 그 결정은 건드리지 않는다.
//
// 대가는 파손 신호의 부재였다: 집계가 늘 빨간불이라 내가 깬 건지 알 수 없어
// 개별 잡을 열어 봐야 했다(`cebda752`가 pre-push 훅을 만든 이유이기도 하다).
// 그래서 차단은 그대로 두고 **신호 전용 집계**(`code_quality_signal`)를 따로 둔다.
//
// 여기서 지키는 것은 네 가지다.
//   ① 신호 잡이 코드 품질 잡 전부를 실제 조건문에서 확인한다
//   ② 신호 잡이 의도적 차단(항상 실패하는 잡)에 오염되지 않는다
//   ③ 릴리스 차단은 계속 살아 있다(신호를 살리자고 차단을 없애면 안 된다)
//   ④ 진짜 강제 수단(매니페스트 핀·fail-closed 컨트롤러)이 계속 돈다

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

test("웹 두 shard는 전체 파일을 나누고 각 실패를 두 집계에 전달한다", () => {
  const shards = jobs.get("web_tests");
  assert.ok(shards, "웹 테스트 shard 잡이 없다");
  assert.match(shards, /^\s*runs-on:\s*ubuntu-latest\s*$/m);
  assert.match(shards, /^\s*fail-fast:\s*false\s*$/m);
  assert.match(shards, /^\s*max-parallel:\s*2\s*$/m);
  assert.match(shards, /^\s*shard:\s*\[1,\s*2\]\s*$/m);
  assert.doesNotMatch(shards, /continue-on-error\s*:/);
  const testCommand = /^\s*run:\s*([^\n]*vitest run[^\n]*)$/m.exec(shards)?.[1];
  assert.equal(testCommand,
    "pnpm --filter @hanbang/web exec vitest run --shard=${{ matrix.shard }}/2 --maxWorkers=2",
    "shard 인덱스·분모·안정 worker 수를 유지하고 파일 필터나 빈 검사 허용을 넣지 않는다");
  assert.doesNotMatch(jobCommands(jobs.get("web_quality")), /vitest\s+run/);
  assert.equal((jobCommands(jobs.get("web_quality")).match(/pnpm --filter @hanbang\/web build/g) ?? []).length, 1);
  assert.doesNotMatch(jobCommands(shards), /\b(?:build|eslint|tsc)\b/);
  for (const name of [SIGNAL_JOB, "ci"]) {
    const body = jobs.get(name);
    assert.ok(neededJobs(body).includes("web_tests"), `${name}가 두 shard 결과를 기다리지 않는다`);
    const bound = /(\w+):\s*\$\{\{\s*needs\.web_tests\.result/.exec(body);
    assert.ok(bound, `${name}가 두 shard 결과를 받지 않는다`);
    const condition = /^\s*if\s+\[[^\n]*$/m.exec(jobCommands(body))?.[0] ?? "";
    assert.ok(condition.includes(`"$${bound[1]}" != "success"`),
      `${name}는 한 shard라도 실패·취소·누락되면 성공하면 안 된다`);
  }
});

test("워크플로 파싱이 실제로 동작한다 (빈 검사로 통과하지 않게)", () => {
  // 파싱이 깨지면 아래 검사들이 전부 공회전한다. 그 상태를 먼저 막는다.
  assert.ok(jobs.size >= 6, `잡을 ${jobs.size}개만 읽었다 — 파서가 깨졌다`);
  for (const name of [...REQUIRED_QUALITY_JOBS, SIGNAL_JOB, BLOCKING_JOB, "ci"]) {
    assert.ok(jobs.has(name), `잡 '${name}'을 못 찾았다 — 파서가 깨졌거나 잡이 사라졌다`);
  }
  assert.ok(
    neededJobs(jobs.get(SIGNAL_JOB)).length >= 4,
    "신호 잡의 needs를 못 읽었다 — 파서가 깨졌다",
  );
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

test("릴리스 차단은 계속 살아 있다", () => {
  // 신호를 살리자고 차단을 없애면 안 된다. 세부 구조는
  // `vendor-public-rls-probe.test.mjs`가 못 박고 있고, 여기서는 존재만 확인한다.
  const blocking = jobs.get(BLOCKING_JOB);
  assert.ok(
    hasUnconditionalFailure(blocking),
    `'${BLOCKING_JOB}'이 더 이상 무조건 실패하지 않는다`
    + " — 릴리스 차단 선언이 풀렸다. 의도한 변경이면 계약 테스트도 함께 고칠 것",
  );
  assert.match(
    jobs.get("ci"),
    new RegExp(`needs\\.${BLOCKING_JOB}\\.result`),
    "Quality Gate가 릴리스 차단을 더 이상 반영하지 않는다",
  );
});

test("진짜 강제 수단(매니페스트·컨트롤러 검증)은 계속 돈다", () => {
  // 차단을 실제로 하는 것은 이 두 명령이다. 주석·스텝 이름이 아니라 실행 명령으로 확인한다.
  const commands = jobCommands(jobs.get("static_release_contracts"));
  assert.ok(commands.length > 0, "릴리스 계약 잡의 실행 내용을 못 읽었다 — 검사가 공회전한다");
  assert.match(commands, /supabase:release:fence/, "매니페스트 핀 검증이 CI에서 빠졌다");
  assert.match(commands, /supabase:release:test/, "fail-closed 컨트롤러 검증이 CI에서 빠졌다");
});
