// 저장된 한글 복구 스크립트가 **안전 규칙을 실제로 지키는가.**
//
// ## 왜 소스를 읽어서 검사하나
//
// 이 스크립트는 service-role 로 운영 DB 에 쓸 수 있는 물건이다. 돌려 보는 검사를
// 만들려면 그 자격증명이 있어야 하고, 그건 이 저장소에서 금지돼 있다
// (`START_HERE.md` §5). 그래서 **돌리지 않고** 두 가지를 본다.
//
//   1. 판정 논리는 진짜 구현을 불러와 값으로 잰다(공유 모듈을 그 자리에서 컴파일한다).
//   2. 안전 울타리는 소스에 그 배선이 있는지 본다.
//
// 흉내 낸 판정으로 재면 스크립트가 무엇을 쓸지 이 검사가 더 이상 말해 주지 못한다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadStoredTextDiagnosis } from "../lib/stored-text-diagnosis.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SCRIPT = readFileSync(resolve(repoRoot, "scripts/repair-stored-korean.mjs"), "utf8");

/** UTF-8 바이트를 Latin-1 로 잘못 읽었을 때 실제로 나오는 문자열. */
function misreadAsLatin1(text) {
  let out = "";
  for (const byte of Buffer.from(text, "utf8")) out += String.fromCharCode(byte);
  return out;
}

test("판정은 공유 구현을 그대로 쓴다 — 흉내가 아니다", () => {
  const { diagnoseStoredText } = loadStoredTextDiagnosis();
  assert.equal(typeof diagnoseStoredText, "function");

  assert.equal(diagnoseStoredText("드레스 매장 방문").kind, "clean");
  assert.equal(diagnoseStoredText(misreadAsLatin1("드레스 매장 방문")).kind, "repairable");
  assert.equal(diagnoseStoredText("?? ???").kind, "lossy");
});

test("되돌릴 수 없는 행에는 쓸 값이 없다", () => {
  // 스크립트는 `repaired` 가 있을 때만 쓴다. 그 값이 null 인 것이 안전의 근거다.
  const { diagnoseStoredText } = loadStoredTextDiagnosis();
  for (const lost of ["?? ???", "???", "\ufffd\ufffd \ufffd"]) {
    assert.equal(diagnoseStoredText(lost).repaired, null, lost);
  }
});

test("기본이 읽기 전용이다", () => {
  // `--apply` 가 없으면 쓰기 함수가 불릴 수 없어야 한다.
  assert.match(SCRIPT, /apply:\s*false/u, "기본값이 쓰기입니다");
  assert.match(
    SCRIPT,
    /if\s*\(args\.apply\s*&&\s*diagnosis\.kind === "repairable"\)/u,
    "열 쓰기가 --apply 와 되돌림 가능 여부 둘 다에 걸려 있지 않습니다",
  );
});

test("되돌릴 수 있는 행만 쓴다", () => {
  // 열 쓰기는 `diagnosis.repaired` 를, JSONB 쓰기는 `repaired.changed` 를 지난다.
  assert.match(SCRIPT, /writeColumn\(supabase, target, row, diagnosis\.repaired\)/u);
  assert.match(SCRIPT, /if\s*\(repaired\.changed\)\s*\{[\s\S]{0,120}writeJson\(/u);
  // 잃어버린 행을 지우거나 덮는 코드가 없어야 한다.
  assert.doesNotMatch(SCRIPT, /\.delete\(\)/u, "삭제 호출이 있습니다");
  assert.doesNotMatch(SCRIPT, /kind === "lossy"[\s\S]{0,80}write/u, "잃어버린 행에 쓰고 있습니다");
});

test("목적지를 먼저 확인하고, 쓰기면 운영 확인값까지 요구한다", () => {
  assert.match(
    SCRIPT,
    /verifySupabaseServiceDestinationFromEnv\(\{\s*access:\s*args\.apply\s*\?\s*"operator-write"\s*:\s*"read",/u,
    "쓰기 의도가 목적지 확인에 반영되지 않습니다",
  );
  // 확인보다 먼저 클라이언트를 만들면 울타리가 뜻이 없다.
  assert.ok(
    SCRIPT.indexOf("verifySupabaseServiceDestinationFromEnv") < SCRIPT.indexOf("createClient("),
    "목적지 확인보다 먼저 Supabase 클라이언트를 만듭니다",
  );
});

test("쓴 값을 다시 읽어 확인한다", () => {
  assert.match(SCRIPT, /쓴 값이 의도와 다릅니다/u, "쓰기 후 확인이 없습니다");
  assert.equal(
    (SCRIPT.match(/쓴 값이 의도와 다릅니다/gu) ?? []).length,
    2,
    "열 쓰기와 JSONB 쓰기 양쪽에 확인이 있어야 합니다",
  );
});

test("사용자 원문을 출력하지 않는다", () => {
  // 지문은 길이·앞바이트·해시뿐이다. 원문을 찍는 순간 개인정보 경계를 넘는다.
  assert.match(SCRIPT, /function fingerprint\(value\)/u);
  const fingerprintBody = SCRIPT.slice(
    SCRIPT.indexOf("function fingerprint(value)"),
    SCRIPT.indexOf("/** JSONB 안의 문자열을"),
  );
  assert.doesNotMatch(fingerprintBody, /return\s*\{[\s\S]*\bvalue\b\s*[,}]/u, "지문에 원문이 실립니다");
  assert.match(fingerprintBody, /sha256/u);

  // 표본 출력 줄에 원문이 없어야 한다.
  const sampleLine = SCRIPT.slice(SCRIPT.indexOf("for (const sample of samples)"));
  assert.doesNotMatch(sampleLine.slice(0, 400), /sample\.value/u);
});

test("읽기·쓰기가 상한 없이 돌지 않는다", () => {
  assert.match(SCRIPT, /const PAGE_SIZE = \d+;/u, "페이지 크기가 없습니다");
  assert.match(SCRIPT, /depth > 8/u, "JSONB 깊이 상한이 없습니다");
  assert.match(SCRIPT, /budget\.left <= 0/u, "JSONB 노드 상한이 없습니다");
});

test("자격증명이 없으면 아무것도 하지 않고 멈춘다", async () => {
  // 소스를 문자열로만 보면 못 도는 파일도 통과한다. 실제로 불러와 본다.
  //
  // 이 저장소에서는 운영 자격증명으로 무엇도 돌리지 않는다(`START_HERE.md` §5).
  // 그래서 목적지 환경변수를 **비운 채로** 부르고, 울타리가 실제로 막는지 본다.
  // 막지 못하면 그 자체가 결함이다.
  const cleared = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_EXPECTED_URL",
    "SUPABASE_EXPECTED_PROJECT_REF",
    "SUPABASE_PRODUCTION_PROJECT_REF",
    "SUPABASE_PRODUCTION_WRITE_CONFIRM",
  ];
  const saved = new Map(cleared.map((key) => [key, process.env[key]]));
  for (const key of cleared) delete process.env[key];

  const errors = [];
  const originalError = console.error;
  const previousExitCode = process.exitCode;
  console.error = (message) => errors.push(String(message));

  try {
    await import(new URL("../repair-stored-korean.mjs", import.meta.url).href);
    // main() 은 스스로 예외를 잡아 exitCode 만 세운다. 이벤트 루프 한 바퀴를 준다.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
    process.exitCode = previousExitCode;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.ok(errors.length > 0, "자격증명이 없는데 조용히 지나갔습니다");
  assert.match(errors.join("\n"), /중단/u, "중단 메시지가 없습니다");
});
