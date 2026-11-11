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
import ts from "typescript";
import { buildHomeServices } from "../lib/dashboardExperience.mjs";

const chat = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
  "utf8",
);
const costGuard = readFileSync(
  fileURLToPath(new URL("../../../web/src/lib/ai/costGuard.ts", import.meta.url)),
  "utf8",
);
const costGuardTree = ts.createSourceFile(
  "costGuard.ts",
  costGuard,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
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
    const message = serverDenyMessage(name);
    assert.ok(message, `서버에서 ${label} 문구를 찾지 못했습니다`);
    assert.ok(
      mapper.includes(message),
      `폴백이 서버와 다릅니다(${label}): ${message}`,
    );
  }
});

/**
 * 서버의 거절 상수 하나에서 화면 문장을 읽는다.
 *
 * 글자가 아니라 구문 트리에서 읽는다. 최상위 `const 이름 = { …, message: "…" }` 의 message 가
 * 문자열 하나일 때만 그 값을 돌려주고, 그 밖의 꼴이면 null 이다. 문장을 `+` 로 이어 붙였을 때
 * 앞부분만 읽거나, 주석에 적힌 `message:` 를 읽는 일이 없게 하려는 것이다.
 *
 * 예전에는 이름이 처음 나오는 곳에서 300자 안의 첫 `message:` 를 글자로 집었다. 2026-11-11 에
 * 하루 상한 문장이 짧아지고 그 뒤의 상수 하나가 없어지면서 그 창이 다음 상수의 문장까지 닿게 됐고,
 * 주석에 이름만 적혀 있어도 거기서 시작할 수 있었다.
 */
function serverDenyMessage(name) {
  for (const statement of costGuardTree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const value = declaration.initializer;
      if (!value || !ts.isObjectLiteralExpression(value)) return null;
      const messages = value.properties.filter(
        (property) =>
          ts.isPropertyAssignment(property)
          && property.name.getText(costGuardTree) === "message",
      );
      if (messages.length !== 1) return null;
      const text = messages[0].initializer;
      return ts.isStringLiteralLike(text) ? text.text : null;
    }
  }
  return null;
}

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

// ## 2026-11-11: 문장에 적힌 횟수가 운영과 달랐다
//
// 하루 한도는 서버 환경변수로 정한다. 2026-11-11 에 읽은 운영 값은 새 커플 50회, 기준 시각 이전
// 커플 천장 80회였는데, 서버와 앱 코드의 문장은 10-20 부터 "기본 하루 10회, 파트너 연결 시 15회 …
// 누적 보너스(+30회)"였다(웹은 서버 문장을 그대로 보여 준다. 그 문장이 실린 앱은 나간 적이 없다).
// 앱은 서버의 설정값을 모르고, 새 커플과 기존 커플이 같은 사유 코드를 받는다. 그래서 문장에
// 횟수와 한쪽에만 맞는 말을 적지 않는다.
//
// 같은 날 하나 더 고쳤다. 상한에 걸린 사람에게 "내일 다시" 안내 아래로 "새 메시지로 보내주세요"가
// 붙어 나갔다. 웹은 2026-09-04 에 같은 뜻의 줄을 뺐는데(chatStore.ts 의 isCapExhausted) 앱은
// 따라오지 않았다.
//
// 위의 "폴백 문구가 서버 문구와 같다"는 표 어딘가에 서버 문장이 있는지만 본다. 다른 코드에
// 붙어 있어도 통과한다. 아래 검사들은 chat.tsx 의 실제 선언을 꺼내 돌려서 잰다.

const chatTree = ts.createSourceFile(
  "chat.tsx",
  chat,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

/**
 * chat.tsx 에서 이름으로 찾은 함수·클래스 선언의 원문.
 *
 * 그 이름을 선언하는 곳은 파일 어디에도 하나뿐이어야 하고, 그 하나가 최상위의 함수나 클래스여야
 * 한다. 컴포넌트 안에 같은 이름의 함수나 변수가 하나 더 생기면 화면은 그쪽을 부르는데 시험은
 * 최상위 것을 재게 된다. 그래서 둘이 되면 실패한다.
 */
function chatDeclaration(name) {
  const declarations = [];
  const visit = (node) => {
    const declaresName =
      ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
        && node.name?.text === name)
      || (ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.name.text === name);
    if (declaresName) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(chatTree);
  assert.equal(
    declarations.length,
    1,
    `chat.tsx 에 ${name} 선언이 ${declarations.length}개입니다`,
  );
  const [declaration] = declarations;
  assert.ok(
    chatTree.statements.includes(declaration)
      && (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)),
    `chat.tsx 의 ${name} 은 최상위 함수나 클래스 선언이어야 합니다`,
  );
  return declaration.getText(chatTree);
}

/** chat.tsx 의 실제 선언을 꺼내 돌린다. 선언 밖의 이름은 bindings 로 준다. */
function loadFromChat(names, bindings = {}) {
  const output = ts.transpileModule(names.map(chatDeclaration).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    "bindings",
    `with(bindings){${output};return {${names.join(",")}};}`,
  )(bindings);
}

function serverCoupleDailyMessage() {
  const message = serverDenyMessage("DENY_COUPLE_DAILY");
  assert.ok(message, "서버에서 커플 하루 상한 문구를 찾지 못했습니다");
  return message;
}

/** chat.tsx 의 함수 선언 하나(깊이 무관)의 구문 트리 마디. 주석은 마디가 아니다. */
function chatFunctionNode(functionName) {
  const functions = [];
  const findFunction = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functions.push(node);
    }
    ts.forEachChild(node, findFunction);
  };
  findFunction(chatTree);
  assert.equal(
    functions.length,
    1,
    `chat.tsx 에 ${functionName} 선언이 ${functions.length}개입니다`,
  );
  return functions[0];
}

/** 마디 안에서 이름이 propertyName 인 속성에 넣는 식을 모두 모은다. */
function propertyInitializersIn(root, propertyName) {
  const initializers = [];
  const collect = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(chatTree) === propertyName) {
      initializers.push(node.initializer.getText(chatTree));
    }
    ts.forEachChild(node, collect);
  };
  collect(root);
  return initializers;
}

/** 마디 안에서 그 이름을 실제로 쓰는 곳의 수. */
function identifierUsesIn(root, identifierName) {
  let uses = 0;
  const count = (node) => {
    if (ts.isIdentifier(node) && node.text === identifierName) uses += 1;
    ts.forEachChild(node, count);
  };
  count(root);
  return uses;
}

const NEW_MESSAGE_NOTICE = "새 메시지 안내(시험용)";

function loadRetryDecision() {
  return loadFromChat(
    [
      "ChatTransportError",
      "isUsageCapRefusal",
      "canRetrySameChatRequest",
      "getRetryUnavailableReason",
    ],
    { NEW_CHAT_MESSAGE_REQUIRED_NOTICE: NEW_MESSAGE_NOTICE },
  );
}

test("하루 상한 코드에는 서버의 하루 상한 문장이 그대로 온다", () => {
  const { getServerCodeFailureMessage } = loadFromChat(["getServerCodeFailureMessage"]);
  assert.equal(
    getServerCodeFailureMessage("COST_GUARD_COUPLE_DAILY"),
    serverCoupleDailyMessage(),
  );
});

test("하루 상한 안내에 횟수와 파트너 보너스를 적지 않는다", () => {
  const { getServerCodeFailureMessage } = loadFromChat(["getServerCodeFailureMessage"]);
  const message = getServerCodeFailureMessage("COST_GUARD_COUPLE_DAILY");
  assert.doesNotMatch(message, /\d/u, "하루 상한 안내에 숫자가 있습니다");
  // "무료"도 적지 않는다. 돈을 내면 더 쓸 수 있다고 읽히는데 그런 길은 없다.
  for (const wrong of ["파트너", "보너스", "무료", "이 대화"]) {
    assert.equal(
      message.includes(wrong),
      false,
      `하루 상한 안내에 "${wrong}"가 있습니다`,
    );
  }
  assert.ok(message.includes("내일"), "언제 다시 되는지 말하지 않습니다");
});

test("하루 상한 안내가 말하는 기능은 웨딩 라운지에 그 이름으로 있다", () => {
  // 2026-10-20 부터 서버와 앱 코드의 이 안내는 "견적 진단"을 쓸 수 있다고 했는데 그런 이름의 칸은 없었다.
  // 문장만 따로 고정해 두면 칸 이름이 바뀌어도 아무도 모른다. 그래서 칸 이름과 대조한다.
  const { getServerCodeFailureMessage } = loadFromChat(["getServerCodeFailureMessage"]);
  const message = getServerCodeFailureMessage("COST_GUARD_COUPLE_DAILY");
  const named = message.match(/([^.]+) 기능은 지금도/u);
  assert.ok(named, "안내에서 기능 이름을 찾지 못했습니다");
  const names = named[1].split("·").map((name) => name.trim());
  assert.ok(names.length >= 2, `기능 이름을 나누지 못했습니다: ${named[1]}`);
  // 모든 사람에게 보이는 칸만 센다. 기록이 있는 사람에게만 보이는 칸은 이 안내에 쓸 수 없다.
  const tiles = buildHomeServices().map((service) => service.title);
  for (const name of names) {
    assert.ok(tiles.includes(name), `웨딩 라운지에 "${name}"라는 칸이 없습니다`);
  }
});

test("상한에 걸린 사람에게 새 메시지를 보내라고 하지 않는다", () => {
  // 상한에 걸리면 같은 요청을 다시 보내도, 새 메시지를 보내도 똑같이 막힌다. 하루 상한과 서비스 전체
  // 상한은 한국 시간 자정에 풀리고 누적 한도는 저절로 풀리지 않는다. 그런데 "내일 다시 이어서
  // 도와드릴게요" 바로 아래에 "새 메시지로 보내주세요"가 붙어 나갔다.
  const { ChatTransportError, canRetrySameChatRequest, getRetryUnavailableReason } =
    loadRetryDecision();
  for (const code of [
    "COST_GUARD_COUPLE_DAILY",
    "COST_GUARD_COUPLE_QUOTA",
    "COST_GUARD_GLOBAL_DAILY",
    "COST_GUARD_GLOBAL_BUDGET",
  ]) {
    // 서버가 같은 요청을 다시 보내도 된다고 해도 상한은 오늘 안에 풀리지 않는다.
    for (const retryable of [false, true]) {
      const error = new ChatTransportError("STREAM", undefined, {
        serverCode: code,
        retryable,
        retryPolicy: null,
      });
      const canRetry = canRetrySameChatRequest(error, false);
      assert.equal(canRetry, false, `${code}: 다시 받기 버튼을 주면 안 됩니다`);
      assert.equal(
        getRetryUnavailableReason(error, canRetry),
        null,
        `${code}: 새 메시지를 보내라고 하면 안 됩니다`,
      );
    }
  }
});

test("상한이 아닌 실패에는 새 메시지 안내가 그대로 붙는다", () => {
  const { ChatTransportError, canRetrySameChatRequest, getRetryUnavailableReason } =
    loadRetryDecision();
  const failure = (serverCode, retryable) =>
    new ChatTransportError("STREAM", undefined, {
      serverCode,
      retryable,
      retryPolicy: null,
    });

  // 사용량을 확인하지 못한 것은 상한이 아니다. 서버의 재시도 판단을 따른다.
  const unavailable = failure("COST_GUARD_UNAVAILABLE", false);
  assert.equal(canRetrySameChatRequest(unavailable, false), false);
  assert.equal(getRetryUnavailableReason(unavailable, false), NEW_MESSAGE_NOTICE);
  const unavailableRetryable = failure("COST_GUARD_UNAVAILABLE", true);
  assert.equal(canRetrySameChatRequest(unavailableRetryable, false), true);
  assert.equal(getRetryUnavailableReason(unavailableRetryable, true), null);

  // 다시 보내도 소용없는 다른 실패.
  const terminal = failure("CHAT_REQUEST_REJECTED", false);
  assert.equal(canRetrySameChatRequest(terminal, false), false);
  assert.equal(getRetryUnavailableReason(terminal, false), NEW_MESSAGE_NOTICE);

  // 서버 코드가 없는 실패.
  assert.equal(getRetryUnavailableReason(new Error("unknown"), false), NEW_MESSAGE_NOTICE);
});

test("답변 요청이 실패한 자리가 그 판단을 쓴다", () => {
  // 글자로만 찾으면 옛 줄을 주석으로 남기고 식을 바꿔도 통과한다. 그래서 구문 트리에서
  // `unavailableReason` 에 실제로 들어가는 식을 읽는다.
  const streamAiRequest = chatFunctionNode("streamAiRequest");
  assert.deepEqual(propertyInitializersIn(streamAiRequest, "unavailableReason"), [
    "getRetryUnavailableReason(error, canRetry)",
  ]);
  // 이 함수가 안내 상수를 직접 쓰면(실패 문장 뒤에 이어 붙이는 것 포함) 상한 판단을 건너뛴다.
  assert.equal(identifierUsesIn(streamAiRequest, "NEW_CHAT_MESSAGE_REQUIRED_NOTICE"), 0);
  // 실패 문장도 이 한 가지 식으로만 만든다. 문장 뒤에 다른 말을 글자로 이어 붙이면 여기서 걸린다.
  assert.deepEqual(propertyInitializersIn(streamAiRequest, "message"), [
    "getAiFailureMessage(error, timedOut)",
  ]);
});
