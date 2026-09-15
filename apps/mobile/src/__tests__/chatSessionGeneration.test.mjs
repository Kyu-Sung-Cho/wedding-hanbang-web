import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(
  new URL("../lib/chatSessionGeneration.ts", import.meta.url),
);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Function("exports", "module", compiled.outputText)(module.exports, module);
const { createChatSessionGenerationGuard } = module.exports;

test("a new identity generation rejects results from every earlier session", () => {
  const guard = createChatSessionGenerationGuard();
  const firstIdentity = guard.begin();
  assert.equal(guard.isCurrent(firstIdentity), true);

  const secondIdentity = guard.begin();
  assert.equal(guard.isCurrent(firstIdentity), false);
  assert.equal(guard.isCurrent(secondIdentity), true);

  guard.invalidate();
  assert.equal(guard.isCurrent(secondIdentity), false);
});

// 2026-09-15 리뷰: 루트 스택 화면에서 채팅 탭으로 push 하면 ChatScreen 이 둘 마운트된다. 둘 다
// generation 1 에서 시작해 토픽이 `chat:<couple>:1` 로 같았고, realtime-js 는 같은 토픽이면 이미
// 있는 채널을 돌려준다. 두 번째 화면은 이미 join 된 채널에 붙어 이벤트를 못 받고, 뒤로 가면
// 첫 화면의 채널까지 끊었다. 화면(가드)마다 다른 번호를 토픽에 넣는다.
test("each chat screen instance gets its own realtime topic even at the same generation", () => {
  const first = createChatSessionGenerationGuard();
  const second = createChatSessionGenerationGuard();
  const firstGeneration = first.begin();
  const secondGeneration = second.begin();
  assert.equal(firstGeneration, secondGeneration, "두 화면은 같은 세대 번호에서 시작한다 — 세대만으로는 구분되지 않는다");
  assert.equal(typeof first.instanceId(), "number");
  assert.notEqual(first.instanceId(), second.instanceId());
  assert.equal(first.instanceId(), first.instanceId(), "한 화면 안에서는 세대가 바뀌어도 같은 번호를 쓴다");
  first.begin();
  first.invalidate();
  assert.equal(first.instanceId(), first.instanceId());
});

test("realtime-js hands back the same channel for a repeated topic, so the instance must be in the topic", async () => {
  const { createRequire } = await import("node:module");
  const appRequire = createRequire(new URL("../../package.json", import.meta.url));
  const supabaseRequire = createRequire(appRequire.resolve("@supabase/supabase-js/package.json"));
  const { RealtimeClient } = supabaseRequire("@supabase/realtime-js");
  const client = new RealtimeClient("ws://127.0.0.1:1/realtime/v1", { params: { apikey: "test" } });
  const coupleId = "couple-a";
  const first = createChatSessionGenerationGuard();
  const second = createChatSessionGenerationGuard();
  const generation = first.begin();
  second.begin();

  assert.equal(client.channel(`chat:${coupleId}:${generation}`), client.channel(`chat:${coupleId}:${generation}`), "전제: 같은 토픽은 같은 채널 객체");
  const firstChannel = client.channel(`chat:${coupleId}:${first.instanceId()}:${generation}`);
  const secondChannel = client.channel(`chat:${coupleId}:${second.instanceId()}:${generation}`);
  assert.notEqual(firstChannel, secondChannel);
});

test("chat screen puts its instance id into every realtime topic it opens", () => {
  const chat = readFileSync(fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)), "utf8");
  const topics = [...chat.matchAll(/supabase\.channel\((`[^`]*`)\)/gu)].map((match) => match[1]);
  assert.deepEqual(topics, [
    "`chat-identity:${user.id}:${realtimeInstance}:${generation}`",
    "`chat:${profile.couple_id}:${realtimeInstance}:${generation}`",
  ]);
  assert.match(chat, /const realtimeInstance = chatSessionGenerationRef\.current\.instanceId\(\);/u);
  assert.doesNotMatch(chat, /supabase\.channel\((?!`)/u, "토픽을 변수로 넘기면 이 검사를 피한다");
});
