import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 무료 상담 한도를 다 쓴 사람이 질문을 보내면 답이 오지 않고
// "답변을 가져오지 못했어요. 다시 시도해 주세요."만 떴다. 몇 번을 눌러도 같았고,
// 사람은 자기 통신 문제로 알았다.
//
// 서버는 이미 사유를 코드로 밝히고 있었다. 앱이 그 코드를 쓰지 않았을 뿐이다.
//
// 서버가 보낸 **문장**은 여전히 그리지 않는다 — 내부 정보가 실릴 수 있고,
// chatStream.test.mjs가 "hides server details"로 그 결정을 고정하고 있다.

const testDir = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(resolve(testDir, "../../app/(tabs)/chat.tsx"), "utf8");
const costGuard = readFileSync(
  resolve(testDir, "../../../web/src/lib/ai/costGuard.ts"),
  "utf8",
);

test("서버가 밝힌 사유 코드마다 앱의 문구가 있다", () => {
  const mapper = chat.slice(
    chat.indexOf("function getServerCodeFailureMessage"),
    chat.indexOf("function getAiFailureMessage"),
  );

  for (const code of [
    "COST_GUARD_COUPLE_QUOTA",
    "COST_GUARD_GLOBAL_DAILY",
    "COST_GUARD_GLOBAL_BUDGET",
    "COST_GUARD_UNAVAILABLE",
  ]) {
    assert.ok(mapper.includes(code), `${code}에 대한 문구가 없다`);
  }
});

test("서버가 실제로 그 코드들을 보낸다", () => {
  // 앱이 기다리는 코드가 서버에 없으면 이 수정은 의미가 없다.
  for (const code of [
    "COST_GUARD_COUPLE_QUOTA",
    "COST_GUARD_GLOBAL_DAILY",
    "COST_GUARD_GLOBAL_BUDGET",
    "COST_GUARD_UNAVAILABLE",
  ]) {
    assert.ok(costGuard.includes(code), `서버가 ${code}를 보내지 않는다`);
  }
});

test("사유가 일반 안내보다 먼저 온다", () => {
  const messageFn = chat.slice(
    chat.indexOf("function getAiFailureMessage"),
    chat.indexOf("function canRetrySameChatRequest"),
  );
  assert.ok(
    messageFn.indexOf("getServerCodeFailureMessage") <
      messageFn.indexOf("답변을 가져오지 못했어요"),
  );
});

test("서버가 보낸 문장 자체는 여전히 그리지 않는다", () => {
  // 이 결정은 chatStream.test.mjs가 "hides server details"로 따로 고정하고 있다.
  // 여기서도 어기지 않는지 실패 경로에 한정해 확인한다.
  const applyEvent = chat.slice(
    chat.indexOf("function applyChatEvent"),
    chat.indexOf("function readChatStreamPayload"),
  );
  // 스트림 오류에서 서버 문장을 담아두지 않는다.
  assert.doesNotMatch(applyEvent, /event\.message/);

  const messageFn = chat.slice(
    chat.indexOf("function getAiFailureMessage"),
    chat.indexOf("function canRetrySameChatRequest"),
  );
  // 화면 문구로 서버 문장을 그대로 돌려주지 않는다.
  assert.doesNotMatch(messageFn, /error\.message/);
});
