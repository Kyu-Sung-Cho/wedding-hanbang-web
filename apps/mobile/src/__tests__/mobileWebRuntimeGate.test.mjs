import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// 앱을 다시 여는 첫 관문이 네트워크 통화였다. 신호가 나쁘면 예산도 일정도 대화도
// 못 보고 "로그인 상태를 확인하지 못했어요"만 남았다 — 로그인은 멀쩡한데.
//
// 그렇다고 이 검사를 없앨 수는 없다. 앱과 웹이 서로 다른 Supabase 프로젝트를 보면
// 세션이나 딥링크가 엉뚱한 계정을 건드릴 수 있다.
//
// 그래서 "물어볼 수 없었다"와 "물어봤는데 답이 달랐다"를 가른다.

const testDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(testDir, "../lib/mobileWebRuntime.ts");

async function loadVerifier() {
  const source = readFileSync(sourcePath, "utf8")
    // 공유 계약과 URL 헬퍼는 이 테스트의 대상이 아니므로 최소 구현으로 대체한다.
    .replace(/import \{ buildMobileSiteUrl \}[^\n]*\n/, "")
    .replace(/import \{ validateMobileWebRuntimeContract \}[^\n]*\n/, "")
    .replace(
      /^/,
      "const buildMobileSiteUrl = (p, o) => `${o}${p}`;\n"
      + "const validateMobileWebRuntimeContract = (v, u) =>\n"
      + "  v && v.ref === u ? { ok: true } : { ok: false, reason: 'destination' };\n",
    );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );
}

const OK_BODY = JSON.stringify({ ref: "https://proj.supabase.co" });

function response(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => String(Buffer.byteLength(body)) },
    text: async () => body,
  };
}

test("신호가 없으면 앱을 막지 않는다", async () => {
  const { verifyMobileWebRuntime, resetMobileWebRuntimeVerificationForTests } =
    await loadVerifier();
  resetMobileWebRuntimeVerificationForTests();

  const result = await verifyMobileWebRuntime({
    siteOrigin: "https://hanbang.ai",
    supabaseUrl: "https://proj.supabase.co",
    fetchImpl: async () => { throw new Error("Network request failed"); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

test("서버가 오류를 내도 어긋났다고 단정하지 않는다", async () => {
  const { verifyMobileWebRuntime, resetMobileWebRuntimeVerificationForTests } =
    await loadVerifier();
  resetMobileWebRuntimeVerificationForTests();

  const result = await verifyMobileWebRuntime({
    siteOrigin: "https://hanbang.ai",
    supabaseUrl: "https://proj.supabase.co",
    fetchImpl: async () => response("", { ok: false, status: 500 }),
  });

  assert.equal(result.reason, "unreachable");
});

test("답을 받았는데 목적지가 다르면 막는다", async () => {
  const { verifyMobileWebRuntime, resetMobileWebRuntimeVerificationForTests } =
    await loadVerifier();
  resetMobileWebRuntimeVerificationForTests();

  const result = await verifyMobileWebRuntime({
    siteOrigin: "https://hanbang.ai",
    supabaseUrl: "https://proj.supabase.co",
    fetchImpl: async () => response(JSON.stringify({ ref: "https://other.supabase.co" })),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "mismatch");
});

test("정상이면 통과한다", async () => {
  const { verifyMobileWebRuntime, resetMobileWebRuntimeVerificationForTests } =
    await loadVerifier();
  resetMobileWebRuntimeVerificationForTests();

  const result = await verifyMobileWebRuntime({
    siteOrigin: "https://hanbang.ai",
    supabaseUrl: "https://proj.supabase.co",
    fetchImpl: async () => response(OK_BODY),
  });

  assert.equal(result.ok, true);
});

test("첫 화면은 불일치만 막고 나머지는 앱을 연다", () => {
  const gate = readFileSync(resolve(testDir, "../../app/index.tsx"), "utf8");

  // 목적지 확인은 여전히 세션보다 먼저다.
  assert.ok(
    gate.indexOf("await verifyMobileWebRuntime") < gate.indexOf("supabase.auth.getSession"),
  );
  // 런타임 검사가 막는 것은 오직 불일치다 — 물어보지 못한 것은 막지 않는다.
  assert.match(gate, /runtime\.reason === "mismatch"/);
  assert.match(gate, /안전하게 연결할 수 없어요/);

  // 불일치는 재시도로 풀리지 않는다(앱을 업데이트해야 한다). 그래서 그 화면에는
  // 다시 시도 버튼을 두지 않는다.
  const mismatchScreen = gate.slice(
    gate.indexOf('status === "mismatch"'),
    gate.indexOf('status === "error"'),
  );
  assert.doesNotMatch(mismatchScreen, /다시 시도/);

  // 인증·프로필 실패는 예전 그대로 재시도 가능한 오류로 남는다. 이 결정은
  // authReleaseSafety.test.mjs가 따로 고정하고 있고, 이번 변경 범위가 아니다.
  assert.match(gate, /if \(sessionError\) throw sessionError/);
  assert.match(gate, /if \(profileError\) throw profileError/);
  assert.match(gate, /로그인 상태를 확인하지 못했어요/);
});
