// 상한에 걸린 사람이 **왜 막혔는지** 듣는가.
//
// ## 무엇이 있었나 (2026-08-28 감사)
//
// 서버는 사유를 코드로 밝히고(`COST_GUARD_*`) 앱은 코드→문구 표를 들고 있다. 그
// 표에 두 구멍이 있었다.
//
//   1. `COST_GUARD_COUPLE_DAILY` 가 **아예 없었다.** 하루치를 다 쓴 커플이
//      "답변을 가져오지 못했어요 … 다시 시도해 주세요" 만 받았고, 앱이 재시도 버튼까지
//      주므로 자정까지 몇 시간을 반복해서 눌렀다. `chatQuotaFailureCopy.test.mjs` 의
//      주석이 적어 둔 바로 그 사고가 새 사유 코드로 되돌아온 것이다.
//   2. `COST_GUARD_GLOBAL_BUDGET` 에는 서버가 "틀렸다"고 기록하고 폐기한 옛 문구가
//      남아 있었다 — "안전 한도"(우리 내부 용어)·"잠시 후"(실제로는 한국 시간 자정).
//      웹은 서버 문장을 그대로 그려 고쳐진 문구를 보여주는데, 모바일은 코드만 읽고
//      자기 문구를 쓰기 때문에 수정이 따라오지 않았다.
//
// ## 왜 "서버 문장을 그대로 쓰기" 가 아닌가
//
// 처음에 그렇게 고쳤다가 되돌렸다. `chatQuotaFailureCopy.test.mjs` 와
// `chatStream.test.mjs`("hides server details")가 **서버 문장을 화면에 그리지 않는
// 것을 의도적으로 고정**하고 있다 — 그 문장에는 내부 정보가 실릴 수 있다. 계약이
// 먼저다.
//
// 대신 갈라짐 자체를 막는다: 표의 문구를 **서버 소스에서 뽑아 대조**한다. 서버가
// 문구를 고치면 여기가 먼저 깨진다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const chat = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
  "utf8",
);
const costGuard = readFileSync(
  fileURLToPath(new URL("../../../web/src/lib/ai/costGuard.ts", import.meta.url)),
  "utf8",
);

/** 코드→문구 표만 잘라 본다. 다른 곳의 문자열이 대신 답하지 않게 한다. */
const mapper = chat.slice(
  chat.indexOf("function getServerCodeFailureMessage"),
  chat.indexOf("function getAiFailureMessage"),
);

/**
 * 서버가 실제로 보내는 사유 코드 전부.
 *
 * 손으로 적지 않고 서버 소스에서 뽑는다 — 이 저장소에는 "운영이 절대 만들지 않는
 * 입력" 으로 재서 안내가 한 번도 안 나가는데 초록불이 난 이력이 있다.
 */
function serverCostGuardCodes() {
  // `this.code = ...` 삼항에서만 뽑는다. 파일 전체를 훑으면 환경변수
  // `AMORA_COST_GUARD_ENABLED` 와 내부 메시지 `AMORA_COST_GUARD_BLOCKED` 까지
  // 주워서, 클라이언트로 나가지도 않는 코드를 "구멍" 이라고 부른다 — 처음에
  // 실제로 그렇게 잘못 쟀다.
  const at = costGuard.indexOf("this.code =");
  const end = costGuard.indexOf(";", at);
  const block = at > -1 ? costGuard.slice(at, end) : "";
  const found = new Set(block.match(/"(COST_GUARD_[A-Z_]+)"/gu) ?? []);
  return [...found].map((quoted) => quoted.replace(/"/gu, "")).sort();
}

test("서버가 보내는 사유 코드마다 앱의 문구가 있다", () => {
  const codes = serverCostGuardCodes();
  assert.ok(codes.length >= 4, `서버에서 코드를 못 찾았습니다: ${codes.length}`);
  const missing = codes.filter((code) => !mapper.includes(code));
  assert.deepEqual(
    missing,
    [],
    `이 코드로 막힌 사람은 이유를 못 듣습니다: ${missing.join(", ")}`,
  );
});

test("폴백 문구가 서버 문구와 같다", () => {
  // 손으로 적으면 서버가 문구를 고쳐도 여기가 따라가지 않는다 — 정확히 그래서
  // 두 화면이 갈라졌다.
  const pairs = [
    ["DENY_COUPLE_DAILY", "커플 하루 상한"],
    ["DENY_GLOBAL_BUDGET", "전역 예산"],
    ["DENY_GLOBAL", "전역 하루 상한"],
  ];
  for (const [name, label] of pairs) {
    const m = costGuard.match(
      new RegExp(`${name}[\\s\\S]{0,300}?message:\\s*\\n?\\s*"([^"]+)"`, "u"),
    );
    assert.ok(m, `서버에서 ${label} 문구를 찾지 못했습니다`);
    assert.ok(
      mapper.includes(m[1]),
      `폴백이 서버와 다릅니다(${label}): ${m[1]}`,
    );
  }
});

test("폐기된 문구가 남아 있지 않다", () => {
  // 서버가 무엇이 틀렸는지 주석으로 기록해 둔 표현들이다.
  // "안전 한도" 는 우리 내부 용어이고, 카운터는 한국 시간 자정에 풀리므로
  // "잠시 후" 는 사용자를 헛되이 다시 누르게 만든다.
  assert.equal(mapper.includes("안전 한도에 도달했어요"), false);
  assert.equal(mapper.includes("안전 예산"), false);
});

test("서버 문장 자체는 여전히 그리지 않는다", () => {
  // `chatQuotaFailureCopy.test.mjs`·`chatStream.test.mjs` 의 결정을 여기서도
  // 어기지 않는지 확인한다 — 서버 문장에는 내부 정보가 실릴 수 있다.
  const applyEvent = chat.slice(
    chat.indexOf("function applyChatEvent"),
    chat.indexOf("function readChatStreamPayload"),
  );
  assert.doesNotMatch(applyEvent, /event\.message/u);
});
