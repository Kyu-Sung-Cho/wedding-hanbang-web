import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **원장 쓰기는 응답보다 오래 살아야 한다.**
 *
 * 2026-09-02 원인 조사 — `ai_interactions_log` 삽입 실패 경보가 Sentry 에 32건
 * 쌓였는데, 정작 원장이 빠진 턴은 507건 중 1건뿐이었다. DB 제약은 전부
 * 배제됐다(CHECK 목록은 TS 타입의 상위집합, 외래키 결손 0건, NOT NULL 은
 * 기본값 보유). 남은 설명은 하나였다:
 *
 *   `void logAIInteraction(...)` 로 부르면 삽입 fetch 가 아직 날아가는 중에
 *   라우트가 응답을 돌려준다. Vercel 은 응답이 끝나면 함수를 얼리므로 그
 *   fetch 는 응답을 못 받고 끊긴다. 요청 자체는 대개 DB 에 닿아 저장까지
 *   끝나므로 **행은 남고 우리만 실패로 본다** — 32 대 1 이 그래서 나온다.
 *
 * 고친 방법은 `after()` 다. 응답이 끝난 뒤 콜백을 돌리되 플랫폼에는 아직
 * 끝나지 않았다고 알린다(`waitUntil`). 사용자는 여전히 기다리지 않는다.
 *
 * 이 검사는 `void logAIInteraction(` 이 되돌아오는 것을 막는다. 같은 병을
 * 이 저장소에서 여러 번 봤다 — 배선이 조용히 끊겨도 초록불이 뜬다.
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..", "apps", "web", "src");

const OWNER = "lib/compliance/ai-log.ts";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** 줄 처음이든 줄 끝이든 주석은 걷어낸다 — 주석이 코드 대신 대답하면 안 된다. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const FIRE_AND_FORGET = /\bvoid\s+logAIInteraction\s*\(/;

test("어디에서도 void logAIInteraction 을 쓰지 않는다 (응답과 함께 끊긴다)", () => {
  const offenders = [];
  for (const file of walk(WEB_SRC)) {
    if (FIRE_AND_FORGET.test(stripComments(readFileSync(file, "utf8")))) {
      offenders.push(relative(WEB_SRC, file).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `응답이 끝나면 끊길 원장 쓰기가 있다. logAIInteractionAfterResponse 를 쓸 것:\n  ${offenders.join("\n  ")}`,
  );
});

test("after 에 콜백이 아니라 이미 시작한 프로미스를 넘긴다", () => {
  // **이 구분이 이 파일의 핵심이다.** 콜백을 넘기면 Next 가 큐에 넣고
  // `res.on("close")` 로 깨우는데, 사용자가 스트림 도중 끊으면 res 가 먼저 닫혀
  // 그 리스너가 영원히 안 불린다 — 실행 0회·예외 0회·경보 0회로 원장이 사라진다.
  // Next 16.2.11 실물로 재현해 확인했다(2026-09-02).
  const source = stripComments(readFileSync(join(WEB_SRC, OWNER), "utf8"));
  assert.ok(
    /export function logAIInteractionAfterResponse/.test(source),
    "logAIInteractionAfterResponse 가 없다",
  );
  assert.ok(
    /const\s+pending\s*=\s*logAIInteraction\s*\(/.test(source),
    "쓰기를 먼저 시작하지 않으면 after 를 못 쓰는 환경에서 원장이 통째로 사라진다",
  );
  assert.ok(
    /\bafter\s*\(\s*pending\s*\)/.test(source),
    "after 에 프로미스를 넘겨야 onClose 큐를 타지 않는다",
  );
  assert.ok(
    !/\bafter\s*\(\s*(?:async\s*)?\(\s*\)\s*=>/.test(source),
    "after 에 콜백을 넘기면 중단된 요청에서 조용히 유실된다",
  );
});

test("검사 자체가 살아 있다 — 위반을 실제로 찾아낸다", () => {
  // 이 검사가 통과하는 이유가 "찾는 방법이 고장 나서" 이면 안 된다.
  assert.ok(
    FIRE_AND_FORGET.test("if (!isDemo) void logAIInteraction({ userId });"),
    "위반을 못 알아본다",
  );
  assert.ok(
    !FIRE_AND_FORGET.test("logAIInteractionAfterResponse({ userId });"),
    "고친 형태를 위반으로 오인한다",
  );
  // 주석에 적힌 예시는 위반이 아니다.
  assert.ok(
    !FIRE_AND_FORGET.test(stripComments("//   void logAIInteraction({ ... });")),
    "주석을 코드로 센다",
  );
  assert.ok(
    !FIRE_AND_FORGET.test(stripComments("const url = \"https://x\"; // void logAIInteraction(")),
    "줄 끝 주석을 못 걷어낸다",
  );
});
