import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  assertSharedActionActor,
  SHARED_ACTION_ACTOR_MISMATCH,
} from "../lib/amoraSharedActionActorFence.mjs";

// P0-2: 공동 승인은 "누가 눌렀는가"가 곧 동의의 주체다. 그런데 모바일 승인 요청은
// 버튼을 누른 사용자를 고정하지 않고 요청을 보내는 시점의 세션 토큰을 그대로 쓴다.
// 그 사이 같은 기기에서 계정이 A→B로 바뀌면 서버는 현재 bearer(B)를 승인자로 기록한다.
// B가 누르지 않은 동의가 B의 동의로 남고, 그 결과가 예산·일정 변경과 decision_nodes에
// 정본으로 들어간다.
//
// 화면에는 이미 `isCurrentChatSession(sessionGeneration)`이 있지만 **응답을 받은 뒤**에만
// 검사한다. 그때는 서버가 이미 승인을 기록한 뒤라 되돌릴 수 없다. 필요한 것은 요청을
// 보내기 **전에** 막는 것이다.
//
// 근거: docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md
// §8 P0-2 — `apps/mobile/app/(tabs)/chat.tsx:1467-1531`,
// `apps/web/src/app/api/amora/shared-actions/[actionId]/route.ts:136-168`.
//
// 이 파일은 실제 사용자 ID 대신 합성 UUID만 쓴다.

const ACTOR_A = "20000000-0000-4000-8000-0000000000a1";
const ACTOR_B = "20000000-0000-4000-8000-0000000000b2";

const CHAT_SCREEN_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/(tabs)/chat.tsx",
);

test("the same actor passes, regardless of letter case", () => {
  assert.doesNotThrow(() => assertSharedActionActor(ACTOR_A, ACTOR_A));
  assert.doesNotThrow(() =>
    assertSharedActionActor(ACTOR_A.toUpperCase(), ACTOR_A.toLowerCase()));
});

test("an approval started by A is refused once the session became B", () => {
  assert.throws(
    () => assertSharedActionActor(ACTOR_A, ACTOR_B),
    (error) => error instanceof Error && error.message === SHARED_ACTION_ACTOR_MISMATCH,
  );
});

test("a missing actor on either side fails closed rather than defaulting", () => {
  for (const [expected, session] of [
    [ACTOR_A, null],
    [ACTOR_A, undefined],
    [ACTOR_A, ""],
    [null, ACTOR_A],
    [undefined, ACTOR_A],
    ["", ACTOR_A],
    [null, null],
  ]) {
    assert.throws(
      () => assertSharedActionActor(expected, session),
      (error) => error instanceof Error && error.message === SHARED_ACTION_ACTOR_MISMATCH,
      `expected=${String(expected)} session=${String(session)} 는 거부돼야 한다`,
    );
  }
});

test("a value that is not a user id is refused instead of being compared loosely", () => {
  for (const malformed of ["not-a-uuid", "20000000-0000-4000-8000", 42, {}, []]) {
    assert.throws(
      () => assertSharedActionActor(malformed, malformed),
      (error) => error instanceof Error && error.message === SHARED_ACTION_ACTOR_MISMATCH,
      `${String(malformed)} 는 같은 값이어도 신원으로 인정하면 안 된다`,
    );
  }
});

test("the chat screen binds every shared-action request to the actor who pressed", () => {
  const source = readFileSync(CHAT_SCREEN_PATH, "utf8");

  const requirements = [
    ["actor fence 사용", /assertSharedActionActor/u],
    ["승인 요청이 expectedUserId를 받음", /requestAmoraSharedAction[\s\S]{0,400}?expectedUserId/u],
    // 401 갱신 뒤에도 같은 사람인지 다시 본다. 갱신은 다른 계정으로 바뀔 수 있는 지점이다.
    ["세션 갱신 후 재확인", /refreshSession\(\)[\s\S]{0,600}?assertSharedActionActor/u],
  ];

  for (const [label, pattern] of requirements) {
    assert.ok(
      pattern.test(source),
      `아모라 채팅 화면에 없음: ${label} (${pattern})`,
    );
  }
});
