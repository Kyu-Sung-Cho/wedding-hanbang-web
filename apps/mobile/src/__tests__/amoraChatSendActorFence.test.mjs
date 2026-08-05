import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  assertAmoraRequestActor,
  SHARED_ACTION_ACTOR_MISMATCH,
} from "../lib/amoraSharedActionActorFence.mjs";

// P0-1: 보내는 문장의 주인은 그것을 쓴 사람이다. 그런데 채팅 전송도 승인과 똑같이
// `requestChatStream`이 전송 시점에 `supabase.auth.getSession()`을 다시 읽어 그 토큰으로
// 보낸다. 그 사이 같은 기기에서 계정이 A→B로 바뀌면 서버는 현재 bearer(B)를 작성자로
// 보고 A가 쓴 문장을 B의 메시지로 INSERT한다.
//
// 개인 상담이었다면 A의 사적인 이야기가 B 소유의 private 메시지가 되고, 소유권을 따라
// audit·삭제·기억·AI 문맥까지 연쇄로 오염된다. 승인(P0-2)보다 더 넓은 표면이다.
//
// 401 뒤 `refreshSession()` 재시도 경로가 특히 위험하다. 세션이 다른 계정으로 바뀔 수
// 있는 바로 그 지점인데 아무 대조가 없다.
//
// 근거: docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md
// §8 P0-1 — `apps/mobile/app/(tabs)/chat.tsx`, `apps/web/src/app/api/chat/messages/route.ts`.

const ACTOR_A = "30000000-0000-4000-8000-0000000000a1";
const ACTOR_B = "30000000-0000-4000-8000-0000000000b2";

const CHAT_SCREEN_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/(tabs)/chat.tsx",
);

test("the send path reuses the same actor rule as approvals", () => {
  assert.equal(typeof assertAmoraRequestActor, "function");
  assert.doesNotThrow(() => assertAmoraRequestActor(ACTOR_A, ACTOR_A));
  assert.throws(
    () => assertAmoraRequestActor(ACTOR_A, ACTOR_B),
    (error) => error instanceof Error && error.message === SHARED_ACTION_ACTOR_MISMATCH,
  );
});

test("a draft written by A is never sent under B's token", () => {
  const source = readFileSync(CHAT_SCREEN_PATH, "utf8");
  const start = source.indexOf("async function requestChatStream(");
  assert.ok(start > 0, "requestChatStream을 찾지 못했다");
  const end = source.indexOf("async function requestAmoraSharedActionWithToken(", start);
  assert.ok(end > start, "requestChatStream의 끝을 찾지 못했다");
  const sendPath = source.slice(start, end);

  const requirements = [
    ["작성자 결박 파라미터", /expectedUserId/u],
    ["첫 전송 전 대조", /assertAmoraRequestActor/u],
    // 갱신은 다른 계정으로 바뀔 수 있는 지점이다. 재시도 전에 다시 본다.
    [
      "세션 갱신 후 재대조",
      /refreshSession\(\)[\s\S]{0,600}?assertAmoraRequestActor/u,
    ],
  ];

  for (const [label, pattern] of requirements) {
    assert.ok(
      pattern.test(sendPath),
      `채팅 전송 경로에 없음: ${label} (${pattern})`,
    );
  }
});

test("the send call site passes the actor captured on screen", () => {
  const source = readFileSync(CHAT_SCREEN_PATH, "utf8");
  // 인자로 넘기는 콜백이 길어 문자 수로 자르면 호출 끝을 놓친다. 호출 구간만 정확히
  // 떼어내 검사한다.
  const callStart = source.indexOf("await requestChatStream(");
  assert.ok(callStart > 0, "전송 호출부를 찾지 못했다");
  const callEnd = source.indexOf("\n      );", callStart);
  assert.ok(callEnd > callStart, "전송 호출부의 끝을 찾지 못했다");
  const callSite = source.slice(callStart, callEnd);

  assert.match(
    callSite,
    /sessionUserIdRef\.current/u,
    "전송 호출부가 화면이 캡처한 사용자를 넘기지 않는다",
  );
});
