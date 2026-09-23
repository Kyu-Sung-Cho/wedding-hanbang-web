import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 채팅 화면의 안내 세 줄 (2026-09-18).
 *
 * (a) 이 탭의 대화가 장기 기억으로 정리되는지 — 웹 채팅은 탭마다 한 줄로 알려 주는데 앱에는 없었다.
 *     켜진 줄 알고 말한 사람과 꺼진 줄 알고 말한 사람이 같은 화면을 봤다.
 * (b) 무료 상담 안내 — 웹은 "소진돼도 예산·일정 기록은 그대로 보관돼요"를 붙이는데 앱은 횟수만 말했다.
 * (c) 앱에는 첨부 기능이 없는데, 첨부가 붙은 질문을 이어받지 못할 때 "첨부파일을 다시 선택해"라고 했다.
 *     앱에서는 할 수 없는 일을 시켰다.
 */
function compile(relative) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (specifier === "@hanbang/shared") return compile("../../../../packages/shared/src/contracts/amoraQuotaNotice.ts");
    throw new Error(`amoraChatNotices 는 의존성이 없어야 한다: ${specifier}`);
  });
  return module.exports;
}
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const notices = compile("../lib/amoraChatNotices.ts");
const chat = read("../../app/(tabs)/chat.tsx");
const webChat = read("../../../web/src/components/app/chat/ChatContent.tsx");

const payload = (runtimeEnabled, settings) => ({ runtimeEnabled, settings, memories: [] });

test("기억 상태는 GET /api/amora/memory 의 settings[].enabled 만 읽고, 모양이 다르면 아무 말도 하지 않는다", () => {
  for (const broken of [null, "x", [], {}, { settings: "x" }, { runtimeEnabled: "true", settings: [] }]) {
    assert.equal(notices.readAmoraMemoryStatus(broken), null, JSON.stringify(broken));
  }
  const status = notices.readAmoraMemoryStatus(payload(true, [
    { visibility: "shared", enabled: true },
    { visibility: "bride_private", enabled: false },
    { visibility: "groom_private", enabled: "yes" },
    { visibility: "someone_else", enabled: true },
  ]));
  assert.deepEqual(status, { runtimeEnabled: true, enabled: { shared: true, bride_private: false } });
});

test("탭마다 자기 범위의 기억을 말한다 — 함께 대화는 공유 기억, 나만 상담은 내 비공개 기억", () => {
  const status = notices.readAmoraMemoryStatus(payload(true, [
    { visibility: "shared", enabled: true },
    { visibility: "bride_private", enabled: false },
  ]));
  assert.deepEqual(notices.resolveAmoraMemoryLine(status, "shared", "bride"), { kind: "on" });
  assert.deepEqual(notices.resolveAmoraMemoryLine(status, "private", "bride"), { kind: "off", canEnable: true });
  // 내 역할을 모르면 비공개 범위를 고를 수 없다. 틀린 상태를 말하느니 침묵한다.
  assert.equal(notices.resolveAmoraMemoryLine(status, "private", null), null);
  // 서버가 그 범위를 돌려주지 않았으면 말하지 않는다.
  assert.equal(notices.resolveAmoraMemoryLine(status, "private", "groom"), null);
  assert.equal(notices.resolveAmoraMemoryLine(null, "shared", "bride"), null);
});

test("기억 연결이 운영에서 꺼져 있으면 켜져 있다고도, 설정에서 켤 수 있다고도 말하지 않는다", () => {
  const status = notices.readAmoraMemoryStatus(payload(false, [{ visibility: "shared", enabled: true }]));
  // 설정 화면은 이때 스위치를 잠그고 "준비 중"이라고 한다 — 채팅이 그 스위치로 보내면 막다른 길이다.
  assert.deepEqual(notices.resolveAmoraMemoryLine(status, "shared", "bride"), { kind: "off", canEnable: false });
});

test("기억 안내 문구는 웹 채팅과 같다", () => {
  for (const copy of [notices.AMORA_MEMORY_ON_COPY, notices.AMORA_MEMORY_OFF_COPY, notices.AMORA_MEMORY_SETTINGS_LINK]) {
    assert.ok(webChat.includes(copy), `웹에 없는 문구: ${copy}`);
  }
  assert.equal(notices.AMORA_MEMORY_ON_COPY, "이 탭의 장기 기억 사용이 켜져 있어요");
});

test("채팅 화면이 기억 상태 줄을 실제로 읽고 그린다", () => {
  assert.match(chat, /apiFetchForExpectedUserQuiet\(userId, "\/api\/amora\/memory"\)/);
  assert.match(chat, /readAmoraMemoryStatus\(/);
  assert.match(chat, /resolveAmoraMemoryLine\(memoryStatus, activeScope, userRole\)/);
  assert.match(chat, /router\.push\("\/settings\/amora-memory"\)/);
  assert.match(chat, /\{AMORA_MEMORY_ON_COPY\}|AMORA_MEMORY_ON_COPY/);
  // 계정이 바뀌면 이전 사람의 기억 상태를 남기지 않는다.
  const reset = chat.slice(chat.indexOf("const resetChatSessionState"), chat.indexOf("useEffect(() => {\n    const timer = setInterval"));
  assert.match(reset, /setMemoryStatus\(null\)/);
});

test("무료 상담 안내는 소진돼도 기록이 남는다고 웹과 같은 말로 알린다", () => {
  assert.equal(
    notices.formatAmoraQuotaNotice(3),
    "무료 상담이 3회 남았어요. 소진돼도 예산·일정 기록은 그대로 보관돼요.",
  );
  assert.equal(notices.formatAmoraQuotaNotice(0), "무료 상담을 모두 사용했어요. 예산·일정 기록은 그대로 보관돼요.");
  assert.match(notices.formatAmoraQuotaNotice(3, "daily"), /오늘.*약 3회/);
  assert.match(notices.formatAmoraQuotaNotice(3, "daily"), /대화 정리/);
  assert.match(chat, /formatAmoraQuotaNotice\(quotaRemaining, quotaPeriod\)/);
  assert.doesNotMatch(chat, /`무료 상담이 \$\{quotaRemaining\}회 남았어요\.`/);
});

test("첨부를 이어받지 못하는 질문에 앱에서 할 수 없는 일을 시키지 않는다", () => {
  // 주석은 걷어낸다 — 왜 바꿨는지 적은 주석이 검사에 걸리면 안 된다. 보는 것은 화면에 나가는 글자다.
  const code = ts.transpileModule(chat, {
    fileName: "chat.tsx",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
  const start = code.indexOf('activeColdStartAiRecovery.disposition === "reattach_required"');
  const end = code.indexOf("저장된 질문의 아모라 답변을 이어받을 수 있어요.", start);
  assert.ok(start > 0 && end > start, "이어받기 안내 자리를 찾지 못했다");
  const copy = code.slice(start, end);
  assert.doesNotMatch(copy, /다시 선택/, "앱에는 첨부를 고르는 곳이 없다");
  assert.match(copy, /첨부파일이 포함된 질문/);
  assert.match(copy, /첨부 상태를 확인할 수 없어요/);
  assert.equal((copy.match(/새 메시지로 보내 주세요/g) ?? []).length, 2);
});
