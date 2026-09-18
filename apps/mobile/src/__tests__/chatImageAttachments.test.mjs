// 채팅에서 받은/보낸 사진 보기 (2026-09-18, wave 2 · 2.5a — 보내기 없음).
//
// 확인한 것(E):
//   - 웹은 사진을 보내고(ChatContent 클립 버튼, 사진만 보내면 "파일을 보냈어요. 확인해줘.") 받은 사진을
//     ChatBubble 에서 POST /api/chat/image-urls 로 받은 서명 URL 로 사람 말풍선 위에 그린다.
//   - 앱은 metadata.imagePaths 를 그대로 받으면서도 읽는 코드가 없었다. 그래서 사진 없이 "확인해줘"
//     말풍선만 보였다.
//
// 지키는 것:
//   - 요청은 사람이 보낸 메시지(내 것·상대 것) · 서버가 받는 UUID id · 첨부가 있을 때만 나간다. 본문은
//     정확히 {"messageId":"<uuid>"} 이고 apiFetchForExpectedUserQuiet 로 Bearer 를 붙인다.
//     아모라 메시지·pinned 안전 카드·temp_ 같은 임시 id·첨부 없는 메시지는 요청 0건이다.
//   - 메시지별 캐시(세대·소유자·메시지·첨부 키), 50분 안에는 다시 묻지 않고, 동시에 붙으면 한 요청을 나눈다.
//     사진이 onError 를 내면 정확히 한 번 다시 받고, 그래도 안 되면 오류와 재시도를 보인다.
//   - 세션(세대)이 바뀌면 캐시를 비우고, 이전 세션에서 시작한 요청의 결과는 그리지 않는다.
//   - 서명 URL 은 console·진단·Sentry 어디로도 가지 않는다. 진단은 개수만 담는다.
//   - 앱에는 chat-image 버킷 직접 접근이 없고, 사진을 보낼 수 있다고 암시하는 문구·버튼도 없다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import * as lib from "../lib/chatImageAttachments.mjs";
import {
  CHAT_IMAGE_CLIENT_REFRESH_TTL_MS,
  getChatImageAttachmentRefs,
} from "@hanbang/shared/chat-image-attachments";

/* global Response, setImmediate, console */

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const read = (relative) => readFileSync(here(relative), "utf8");

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const OWNER = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const OTHER_MESSAGE = "66666666-6666-4666-8666-666666666666";
const PATH = `${COUPLE}/${PARTNER}/55555555-5555-4555-8555-555555555555.png`;
const PATH_2 = `${COUPLE}/${PARTNER}/77777777-7777-4777-8777-777777777777.jpg`;
const signed = (path, token = "tkn") => `${SUPABASE_URL}/storage/v1/object/sign/chat-image/${path}?token=${token}`;

function message(overrides = {}) {
  return {
    id: MESSAGE,
    couple_id: COUPLE,
    sender_id: PARTNER,
    role: "user",
    sender_type: "groom",
    content: "파일을 보냈어요. 확인해줘.",
    metadata: { imagePaths: [PATH] },
    visibility: "shared",
    ...overrides,
  };
}

// ── 요청 대상 판정 ──────────────────────────────────────────────────
test("사람이 보낸 메시지이고 UUID id 이고 첨부가 있을 때만 요청 대상이다", () => {
  for (const sender_type of ["bride", "groom"]) {
    assert.deepEqual(lib.getChatImageAttachmentTarget(message({ sender_type })), {
      messageId: MESSAGE,
      attachmentKey: PATH,
      count: 1,
    });
  }
  const legacy = `${SUPABASE_URL}/storage/v1/object/public/chat-image/${COUPLE}/1700000000000-a1b2c.png`;
  assert.deepEqual(
    lib.getChatImageAttachmentTarget(message({ metadata: { imagePaths: [PATH, PATH_2], imageUrls: [legacy], target: "ai" } })),
    { messageId: MESSAGE, attachmentKey: getChatImageAttachmentRefs({ imagePaths: [PATH, PATH_2], imageUrls: [legacy] }).attachmentKey, count: 3 },
  );
  const skipped = [
    message({ sender_type: "ai", role: "assistant" }),
    message({ metadata: { imagePaths: [PATH], pinned_safety_card: true } }),
    message({ id: `temp_${MESSAGE}` }),
    message({ id: "temp_1726650000000" }),
    message({ id: "amora_first_hello_local" }),
    message({ id: "44444444-4444-4444-8444-44444444444" }),
    message({ id: "44444444-4444-9444-8444-444444444444" }),
    message({ id: ` ${MESSAGE}` }),
    message({ metadata: {} }),
    message({ metadata: null }),
    message({ metadata: { imagePaths: [] } }),
    message({ metadata: { imagePaths: [1, null] } }),
    message({ sender_type: undefined }),
    null,
  ];
  for (const item of skipped) assert.equal(lib.getChatImageAttachmentTarget(item), null, JSON.stringify(item));
  // 서버 route 와 같은 UUID 규칙이다 — 앱이 400 을 받을 요청을 보내지 않는다.
  const route = read("../../../web/src/app/api/chat/image-urls/route.ts");
  assert.ok(route.includes(`const UUID_PATTERN = ${lib.CHAT_MESSAGE_ID_PATTERN.toString()};`), "route 의 UUID 규칙과 다르다");
});

// ── 캐시 저장소 ──────────────────────────────────────────────────────
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function harness({ supabaseUrl = SUPABASE_URL } = {}) {
  const calls = [];
  const pending = [];
  const diagnostics = [];
  let clock = 1_000_000;
  const store = lib.createChatImageAttachmentStore({
    request: (ownerId, path, init) => {
      calls.push({ ownerId, path, init });
      const next = deferred();
      pending.push(next);
      return next.promise;
    },
    supabaseUrl,
    now: () => clock,
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  return {
    store,
    calls,
    pending,
    diagnostics,
    advance: (ms) => { clock += ms; },
    get notified() { return notified; },
    reply: async (index, status, body) => {
      pending[index].resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
      await flush();
    },
    fail: async (index, error = new Error("Network request failed")) => {
      pending[index].reject(error);
      await flush();
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const params = (overrides = {}) => ({ generation: 1, ownerId: OWNER, messageId: MESSAGE, attachmentKey: PATH, ...overrides });

test("본문은 정확히 {messageId} 이고 소유자와 엔드포인트를 그대로 넘긴다", async () => {
  const h = harness();
  assert.equal(h.store.getSnapshot(params()).status, "idle");
  const loading = h.store.load(params());
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], {
    ownerId: OWNER,
    path: "/api/chat/image-urls",
    init: { method: "POST", body: `{"messageId":"${MESSAGE}"}` },
  });
  assert.equal(h.store.getSnapshot(params()).status, "loading");
  await h.reply(0, 200, { urls: [{ path: PATH, signedUrl: signed(PATH) }] });
  await loading;
  assert.deepEqual(h.store.getSnapshot(params()), { status: "ready", urls: [signed(PATH)] });
  // 같은 상태를 다시 읽으면 같은 객체다(useSyncExternalStore 가 다시 그리지 않는다).
  assert.equal(h.store.getSnapshot(params()), h.store.getSnapshot(params()));
});

test("동시에 붙으면 요청 하나를 나누고, 50분 안에는 다시 묻지 않는다", async () => {
  const h = harness();
  const first = h.store.load(params());
  const second = h.store.load(params());
  assert.equal(h.calls.length, 1, "진행 중 요청을 나눈다");
  assert.equal(first, second);
  await h.reply(0, 200, { urls: [{ signedUrl: signed(PATH) }] });

  h.advance(CHAT_IMAGE_CLIENT_REFRESH_TTL_MS - 1);
  h.store.load(params());
  assert.equal(h.calls.length, 1, "갱신 TTL 보다 어리면 다시 묻지 않는다");
  assert.equal(h.store.getSnapshot(params()).status, "ready");

  h.advance(1);
  h.store.load(params());
  assert.equal(h.calls.length, 2, "갱신 TTL 이 지나면 새로 받는다");
  await h.reply(1, 200, { urls: [{ signedUrl: signed(PATH, "fresh") }] });
  assert.deepEqual(h.store.getSnapshot(params()).urls, [signed(PATH, "fresh")]);

  // 다른 메시지·다른 첨부 키는 따로 캐시한다.
  h.store.load(params({ messageId: OTHER_MESSAGE }));
  h.store.load(params({ attachmentKey: `${PATH}|${PATH_2}` }));
  assert.equal(h.calls.length, 4);
});

test("404 와 {urls:[]} 는 아무것도 그리지 않는 빈 상태이고, 빈 상태도 캐시한다", async () => {
  const h = harness();
  h.store.load(params());
  await h.reply(0, 404, { error: "메시지를 찾을 수 없습니다." });
  assert.equal(h.store.getSnapshot(params()).status, "empty");
  h.store.load(params());
  assert.equal(h.calls.length, 1);

  h.store.load(params({ messageId: OTHER_MESSAGE }));
  await h.reply(1, 200, { urls: [] });
  assert.equal(h.store.getSnapshot(params({ messageId: OTHER_MESSAGE })).status, "empty");
  assert.deepEqual(h.diagnostics, [], "빈 목록은 진단 대상이 아니다");
});

test("5xx·429·네트워크 오류·깨진 응답은 오류이고, 재시도는 누를 때만 나간다", async () => {
  const cases = [
    (h) => h.reply(0, 500, { error: "x" }),
    (h) => h.reply(0, 502, "<html>"),
    (h) => h.reply(0, 429, { error: "rate" }),
    (h) => h.reply(0, 401, { error: "auth" }),
    (h) => h.fail(0),
    (h) => h.fail(0, new Error("API_SESSION_OWNER_MISMATCH")),
    (h) => h.reply(0, 200, "not json"),
  ];
  for (const settle of cases) {
    const h = harness();
    h.store.load(params());
    await settle(h);
    assert.equal(h.store.getSnapshot(params()).status, "error");
    // 다시 붙어도(스크롤로 다시 마운트) 저절로 다시 묻지 않는다 — 분당 60회 제한을 지킨다.
    h.store.load(params());
    assert.equal(h.calls.length, 1);
    // 갱신 TTL(50분)이 지나도 오류는 저절로 다시 묻지 않는다. 오래 열어 둔 채팅에서 목록을 오르내릴 때마다
    // 실패한 사진이 요청을 내면 안 된다 — 재시도는 사람이 누를 때만이다.
    h.advance(CHAT_IMAGE_CLIENT_REFRESH_TTL_MS + 1);
    h.store.load(params());
    assert.equal(h.calls.length, 1, "TTL 이 지난 오류가 저절로 다시 묻는다");
    const retried = h.store.retry(params());
    assert.equal(h.calls.length, 2);
    assert.equal(h.store.getSnapshot(params()).status, "loading");
    await h.reply(1, 200, { urls: [{ signedUrl: signed(PATH) }] });
    await retried;
    assert.equal(h.store.getSnapshot(params()).status, "ready");
    // 서버가 실패를 말한 것은 출처 설정 문제가 아니다 — 진단을 남기지 않는다.
    assert.deepEqual(h.diagnostics, []);
  }
});

test("받은 URL 을 모두 버렸거나 응답 모양이 틀리면 오류로 보이고 개수만 담은 진단을 남긴다", async () => {
  const h = harness();
  h.store.load(params());
  await h.reply(0, 200, {
    urls: [
      { path: PATH, signedUrl: signed(PATH).replace(SUPABASE_URL, "https://evil.example") },
      { path: PATH_2, signedUrl: `${SUPABASE_URL}/storage/v1/object/sign/avatars/${PATH_2}?token=secret` },
    ],
  });
  assert.equal(h.store.getSnapshot(params()).status, "error");
  assert.deepEqual(h.diagnostics, [{ received: 2, accepted: 0, rejected: 2, malformed: false }]);

  h.store.load(params({ messageId: OTHER_MESSAGE }));
  await h.reply(1, 200, { urls: "nope" });
  assert.equal(h.store.getSnapshot(params({ messageId: OTHER_MESSAGE })).status, "error");
  assert.deepEqual(h.diagnostics[1], { received: 0, accepted: 0, rejected: 0, malformed: true });

  // 일부만 버렸으면 남은 사진은 그리고, 버린 개수를 남긴다.
  h.store.load(params({ attachmentKey: `${PATH}|${PATH_2}` }));
  await h.reply(2, 200, { urls: [{ signedUrl: signed(PATH) }, { signedUrl: signed(PATH_2).replace("https:", "http:") }] });
  assert.deepEqual(h.store.getSnapshot(params({ attachmentKey: `${PATH}|${PATH_2}` })), { status: "ready", urls: [signed(PATH)] });
  assert.deepEqual(h.diagnostics[2], { received: 2, accepted: 1, rejected: 1, malformed: false });

  const serialized = JSON.stringify(h.diagnostics);
  assert.doesNotMatch(serialized, /http|token|secret|storage|chat-image|33333333/);
});

test("설정된 Supabase URL 의 끝 슬래시는 문제가 되지 않는다", async () => {
  const h = harness({ supabaseUrl: `${SUPABASE_URL}/` });
  h.store.load(params());
  await h.reply(0, 200, { urls: [{ signedUrl: signed(PATH) }] });
  assert.deepEqual(h.store.getSnapshot(params()).urls, [signed(PATH)]);
  assert.deepEqual(h.diagnostics, []);
});

test("사진이 onError 를 내면 정확히 한 번 다시 받고, 그래도 안 되면 오류다", async () => {
  const h = harness();
  h.store.load(params());
  await h.reply(0, 200, { urls: [{ signedUrl: signed(PATH, "old") }, { signedUrl: signed(PATH_2, "old") }] });

  h.store.reportImageError(params(), signed(PATH, "old"));
  assert.equal(h.calls.length, 2, "첫 onError 는 새로 받는다");
  assert.equal(h.store.getSnapshot(params()).status, "loading");
  // 같은 메시지의 다른 사진이 받는 중에 onError 를 내도 요청을 더 보내지 않는다.
  h.store.reportImageError(params(), signed(PATH_2, "old"));
  assert.equal(h.calls.length, 2);
  await h.reply(1, 200, { urls: [{ signedUrl: signed(PATH, "new") }, { signedUrl: signed(PATH_2, "new") }] });
  assert.equal(h.store.getSnapshot(params()).status, "ready");

  // 새로 받기 전 URL 의 늦은 onError 는 무시한다.
  h.store.reportImageError(params(), signed(PATH, "old"));
  assert.equal(h.store.getSnapshot(params()).status, "ready");
  assert.equal(h.calls.length, 2);

  // 새 URL 도 실패하면 더 묻지 않고 오류를 보인다.
  h.store.reportImageError(params(), signed(PATH, "new"));
  assert.equal(h.calls.length, 2, "두 번째 onError 는 요청을 보내지 않는다");
  assert.equal(h.store.getSnapshot(params()).status, "error");

  // 사람이 누른 재시도는 새 한 바퀴다 — 다시 한 번의 자동 재요청을 갖는다.
  h.store.retry(params());
  await h.reply(2, 200, { urls: [{ signedUrl: signed(PATH, "retry") }] });
  h.store.reportImageError(params(), signed(PATH, "retry"));
  assert.equal(h.calls.length, 4);
  await h.reply(3, 500, {});
  assert.equal(h.store.getSnapshot(params()).status, "error");
});

test("세션(세대)이 바뀌면 캐시를 비우고 이전 세션에서 시작한 요청의 결과는 그리지 않는다", async () => {
  const h = harness();
  h.store.load(params());
  await h.reply(0, 200, { urls: [{ signedUrl: signed(PATH) }] });
  const before = h.notified;

  // 로그아웃·계정 전환·다시 불러오기 모두 채팅 화면의 세대를 올리고 reset 을 부른다.
  h.store.reset(2);
  assert.ok(h.notified > before, "구독자에게 알린다");
  assert.equal(h.store.getSnapshot(params()).status, "idle", "이전 세대 캐시는 사라진다");
  assert.equal(h.store.getSnapshot(params({ generation: 2 })).status, "idle");

  // 새 세대에서 시작한 요청이 걸려 있는 동안 또 세대가 바뀌면, 그 결과는 어디에도 남지 않는다.
  h.store.load(params({ generation: 2 }));
  assert.equal(h.calls.length, 2);
  h.store.reset(3);
  const beforeStale = h.notified;
  await h.reply(1, 200, { urls: [{ signedUrl: signed(PATH, "stale") }] });
  assert.equal(h.notified, beforeStale, "지난 세대의 결과는 화면을 다시 그리게 하지도 않는다");
  for (const generation of [1, 2, 3]) {
    assert.equal(h.store.getSnapshot(params({ generation })).status, "idle", `세대 ${generation}`);
  }

  // 옛 세대의 늦은 load 는 요청을 보내지 않는다.
  h.store.load(params({ generation: 2 }));
  assert.equal(h.calls.length, 2);

  // 계정이 바뀐 새 세대는 새 소유자로 새로 받는다.
  h.store.load(params({ generation: 3, ownerId: PARTNER }));
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].ownerId, PARTNER);
  await h.reply(2, 200, { urls: [{ signedUrl: signed(PATH, "new-owner") }] });
  assert.deepEqual(h.store.getSnapshot(params({ generation: 3, ownerId: PARTNER })).urls, [signed(PATH, "new-owner")]);
  assert.equal(h.store.getSnapshot(params({ generation: 3 })).status, "idle", "다른 소유자의 캐시를 섞지 않는다");

  // 더 높은 세대가 먼저 오면 그것을 받아들이고 캐시를 비운다.
  h.store.load(params({ generation: 4, ownerId: PARTNER }));
  assert.equal(h.store.getSnapshot(params({ generation: 3, ownerId: PARTNER })).status, "idle");

  // 옛 세대 결과의 onError·재시도도 아무것도 하지 않는다.
  const calls = h.calls.length;
  h.store.reportImageError(params({ generation: 3, ownerId: PARTNER }), signed(PATH, "new-owner"));
  h.store.retry(params({ generation: 2 }));
  assert.equal(h.calls.length, calls);
});

test("소유자가 없으면 요청하지 않는다", () => {
  const h = harness();
  h.store.load(params({ ownerId: "" }));
  h.store.load(params({ ownerId: null }));
  assert.equal(h.calls.length, 0);
});

test("기본 진단은 코드와 개수만 console.warn 으로 남긴다", () => {
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args);
  try {
    lib.reportChatImageDiagnostic({ received: 2, accepted: 0, rejected: 2, malformed: false, url: signed(PATH) });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warned, [[lib.CHAT_IMAGE_DIAGNOSTIC_CODE, { received: 2, accepted: 0, rejected: 2, malformed: false }]]);
});

test("저장소는 서명 URL 을 console 에 남기지 않는다", async () => {
  const logged = [];
  const methods = ["log", "info", "warn", "error", "debug"];
  const originals = Object.fromEntries(methods.map((name) => [name, console[name]]));
  for (const name of methods) console[name] = (...args) => logged.push(args);
  try {
    const store = lib.createChatImageAttachmentStore({
      request: async () => new Response(JSON.stringify({ urls: [{ signedUrl: signed(PATH, "secret") }, { signedUrl: "https://evil.example/x?token=secret" }] }), { status: 200 }),
      supabaseUrl: SUPABASE_URL,
    });
    await store.load(params());
    store.reportImageError(params(), signed(PATH, "secret"));
    await flush();
  } finally {
    for (const name of methods) console[name] = originals[name];
  }
  assert.ok(logged.length >= 1, "기본 진단은 남는다");
  assert.doesNotMatch(JSON.stringify(logged), /secret|evil|https?:|chat-image/);
});

// ── 화면 ───────────────────────────────────────────────────────────
function compile(relative, deps) {
  const compiled = ts.transpileModule(read(relative), {
    fileName: "module.tsx",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}

const { colors } = compile("../../../../packages/design-tokens/src/colors.ts", {});

function loadComponent(hooks = {}) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  return compile("../components/chat/ChatImageAttachments.tsx", {
    react: {
      useEffect: hooks.useEffect ?? (() => {}),
      useState: hooks.useState ?? ((initial) => [typeof initial === "function" ? initial() : initial, () => {}]),
      useSyncExternalStore: hooks.useSyncExternalStore ?? ((subscribe, getSnapshot) => getSnapshot()),
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      ActivityIndicator: "ActivityIndicator",
      Image: "Image",
      Modal: "Modal",
      Pressable: "Pressable",
      View: "View",
      StyleSheet: { create: (value) => value, absoluteFill: { position: "absolute" }, absoluteFillObject: { position: "absolute" } },
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "lucide-react-native": { ImageOff: "ImageOff", RefreshCw: "RefreshCw", X: "X" },
    "@/components/ui/AppText": { Text: "Text" },
    "@hanbang/design-tokens": { colors },
    "@/lib/chatImageAttachments.mjs": lib,
  });
}

function walk(tree) {
  const nodes = [];
  const texts = [];
  (function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node === "string" || typeof node === "number") return void texts.push(String(node));
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "function") return visit(node.type(node.props));
    nodes.push(node);
    visit(node.props.children);
  })(tree);
  const style = (node) => Object.assign({}, ...[typeof node.props.style === "function" ? node.props.style({ pressed: false }) : node.props.style].flat(5).filter(Boolean));
  return { nodes, text: texts.join(" "), style, byType: (type) => nodes.filter((node) => node.type === type) };
}

function renderView(props) {
  const component = loadComponent();
  const calls = [];
  const tree = component.ChatImageAttachmentsView({
    snapshot: { status: "ready", urls: [signed(PATH), signed(PATH_2)] },
    count: 2,
    align: "start",
    viewerIndex: null,
    onOpen: (index) => calls.push(["open", index]),
    onClose: () => calls.push(["close"]),
    onRetry: () => calls.push(["retry"]),
    onImageError: (url) => calls.push(["imageError", url]),
    ...props,
  });
  return { tree, calls, ...walk(tree) };
}

test("불러오는 동안 첨부 수만큼 고정 크기 자리를 그려 목록이 튀지 않는다", () => {
  for (const status of ["idle", "loading"]) {
    const view = renderView({ snapshot: { status, urls: [] }, count: 3 });
    const slots = view.nodes.filter((node) => node.props.testID === "chat-image-placeholder");
    assert.equal(slots.length, 3, status);
    const size = lib.chatImageThumbnailSize(3);
    for (const slot of slots) {
      assert.equal(view.style(slot).width, size);
      assert.equal(view.style(slot).height, size);
    }
    assert.equal(view.byType("Image").length, 0);
    assert.equal(view.byType("Pressable").length, 0);
    assert.ok(view.nodes.some((node) => node.props.accessibilityLabel === lib.CHAT_IMAGE_ATTACHMENT_COPY.loadingAccessibilityLabel));
  }
  // 한 장이면 크게, 여러 장이면 두 칸씩. 320pt 화면의 말풍선 폭(78%·약 224pt) 안에 들어간다.
  assert.ok(lib.chatImageThumbnailSize(1) <= 224);
  assert.ok(lib.chatImageThumbnailSize(2) * 2 + lib.CHAT_IMAGE_THUMBNAIL_GAP <= 224);
  assert.ok(lib.chatImageThumbnailSize(2) >= 44);
});

test("404·빈 목록이면 빈 틀 없이 아무것도 그리지 않는다", () => {
  assert.equal(renderView({ snapshot: { status: "empty", urls: [] } }).tree, null);
});

test("불러오지 못하면 문구와 44pt 이상 재시도를 보인다", () => {
  const view = renderView({ snapshot: { status: "error", urls: [] } });
  assert.match(view.text, /사진을 불러오지 못했어요/);
  const retry = view.byType("Pressable").find((node) => node.props.accessibilityLabel === lib.CHAT_IMAGE_ATTACHMENT_COPY.retryAccessibilityLabel);
  assert.ok(retry, "재시도 버튼이 없다");
  assert.equal(retry.props.accessibilityRole, "button");
  assert.ok(view.style(retry).minHeight >= 44);
  assert.ok(view.style(retry).minWidth >= 44);
  retry.props.onPress();
  assert.deepEqual(view.calls, [["retry"]]);
});

test("썸네일은 첨부 사진 N 으로 읽히고, 누르면 그 사진을 연다. 정렬은 보낸 쪽을 따른다", () => {
  for (const align of ["start", "end"]) {
    const view = renderView({ align });
    const thumbs = view.byType("Pressable");
    assert.deepEqual(thumbs.map((node) => node.props.accessibilityLabel), ["첨부 사진 1", "첨부 사진 2"]);
    for (const thumb of thumbs) {
      assert.equal(thumb.props.accessibilityRole, "imagebutton");
      assert.ok(view.style(thumb).width >= 44 && view.style(thumb).height >= 44);
    }
    const images = view.byType("Image");
    assert.deepEqual(images.map((node) => node.props.source.uri), [signed(PATH), signed(PATH_2)]);
    for (const image of images) assert.equal(image.props.resizeMode, "cover");
    thumbs[1].props.onPress();
    images[0].props.onError();
    assert.deepEqual(view.calls, [["open", 1], ["imageError", signed(PATH)]]);
    const container = view.nodes.find((node) => node.props.testID === "chat-image-attachments");
    assert.equal(view.style(container).alignSelf, align === "end" ? "flex-end" : "flex-start");
    assert.equal(view.style(container).justifyContent, align === "end" ? "flex-end" : "flex-start");
  }
  assert.equal(renderView({}).byType("Modal").length, 0, "닫혀 있으면 보기 창을 그리지 않는다");
});

test("전체 화면 보기는 contain 으로 그리고, 44pt 닫기와 Android 뒤로가기로 닫힌다. 저장·공유는 없다", () => {
  const view = renderView({ viewerIndex: 1 });
  const [modal] = view.byType("Modal");
  assert.ok(modal, "보기 창이 없다");
  assert.equal(modal.props.visible, true);
  modal.props.onRequestClose();
  const viewer = walk(modal);
  const image = viewer.byType("Image").find((node) => node.props.resizeMode === "contain");
  assert.ok(image, "contain 사진이 없다");
  assert.equal(image.props.source.uri, signed(PATH_2));
  assert.equal(image.props.accessibilityLabel, "첨부 사진 2");
  const close = viewer.byType("Pressable").find((node) => node.props.accessibilityLabel === lib.CHAT_IMAGE_ATTACHMENT_COPY.closeAccessibilityLabel);
  assert.ok(close, "닫기 버튼이 없다");
  assert.ok(viewer.style(close).minWidth >= 44 && viewer.style(close).minHeight >= 44);
  close.props.onPress();
  image.props.onError();
  assert.deepEqual(view.calls, [["close"], ["close"], ["imageError", signed(PATH_2)]]);
  assert.deepEqual(viewer.byType("Pressable").map((node) => node.props.accessibilityLabel), [lib.CHAT_IMAGE_ATTACHMENT_COPY.closeAccessibilityLabel]);
  assert.doesNotMatch(viewer.text, /저장|공유|다운로드|내려받/);
  assert.equal(viewer.style(viewer.nodes.find((node) => node.type === "SafeAreaView")).backgroundColor, colors.paper.inkPressed);

  // 다시 받는 중이면 자리표시, 끝내 못 받으면 문구와 재시도를 보기 창 안에서도 보인다.
  const reloading = walk(renderView({ viewerIndex: 0, snapshot: { status: "loading", urls: [] } }).byType("Modal")[0]);
  assert.equal(reloading.byType("ActivityIndicator").length, 1);
  const failed = renderView({ viewerIndex: 0, snapshot: { status: "error", urls: [] } });
  const failedViewer = walk(failed.byType("Modal")[0]);
  assert.match(failedViewer.text, /사진을 불러오지 못했어요/);
  failedViewer.byType("Pressable").find((node) => node.props.accessibilityLabel === lib.CHAT_IMAGE_ATTACHMENT_COPY.retryAccessibilityLabel).props.onPress();
  assert.deepEqual(failed.calls, [["retry"]]);
});

test("화면 컴포넌트는 저장소를 구독하고 마운트될 때 이 메시지를 불러온다", () => {
  const effects = [];
  const subscribed = [];
  const loaded = [];
  const component = loadComponent({
    useEffect: (effect) => effects.push(effect),
    useSyncExternalStore: (subscribe, getSnapshot) => {
      subscribed.push(subscribe);
      return getSnapshot();
    },
  });
  const store = {
    subscribe: () => () => {},
    getSnapshot: (p) => { loaded.push(["snapshot", p]); return { status: "loading", urls: [] }; },
    load: (p) => loaded.push(["load", p]),
    retry: () => {},
    reportImageError: () => {},
  };
  const target = { messageId: MESSAGE, attachmentKey: PATH, count: 1 };
  const tree = component.ChatImageAttachments({ store, generation: 7, ownerId: OWNER, target, align: "end" });
  assert.equal(subscribed[0], store.subscribe);
  for (const effect of effects) effect();
  const expected = { generation: 7, ownerId: OWNER, messageId: MESSAGE, attachmentKey: PATH };
  assert.deepEqual(loaded, [["snapshot", expected], ["load", expected]]);
  const view = walk(tree);
  assert.equal(view.nodes.filter((node) => node.props.testID === "chat-image-placeholder").length, 1);
});

// ── 채팅 화면 연결 ───────────────────────────────────────────────────
const chat = read("../../app/(tabs)/chat.tsx");
const renderMessageSource = chat.slice(chat.indexOf("function renderMessage({ item }"), chat.indexOf("async function handleClearRequestResponse"));

test("말풍선 위에 붙이고, 판정 함수를 통과한 메시지에만 붙인다", () => {
  assert.match(renderMessageSource, /const imageAttachmentTarget = getChatImageAttachmentTarget\(item\);/);
  const mount = /\{imageAttachmentTarget && userId && \(\s*<ChatImageAttachments\s+store=\{chatImageAttachmentStore\}\s+generation=\{chatSessionGenerationRef\.current\.current\(\)\}\s+ownerId=\{userId\}\s+target=\{imageAttachmentTarget\}\s+align=\{isMe \? "end" : "start"\}\s*\/>\s*\)\}/;
  assert.match(renderMessageSource, mount);
  const mountAt = renderMessageSource.search(mount);
  assert.ok(mountAt > renderMessageSource.indexOf("st.senderLabel"), "보낸 사람 이름 아래에 있다");
  assert.ok(mountAt < renderMessageSource.indexOf("{shouldRenderBubble && ("), "말풍선보다 위에 있다");
  assert.equal(renderMessageSource.match(/<ChatImageAttachments/g).length, 1);
});

test("요청은 apiFetchForExpectedUserQuiet 로, 출처 확인은 앱의 Supabase URL 로 한다", () => {
  assert.match(chat, /import \{ ChatImageAttachments \} from "@\/components\/chat\/ChatImageAttachments";/);
  assert.match(chat, /createChatImageAttachmentStore\(\{\s*request: \(ownerId, path, init\) => apiFetchForExpectedUserQuiet\(ownerId, path, init\),\s*supabaseUrl: process\.env\.EXPO_PUBLIC_SUPABASE_URL,\s*\}\)/);
});

test("세션이 바뀌는 모든 자리에서 캐시를 비운다", () => {
  const reset = chat.slice(chat.indexOf("const resetChatSessionState = useCallback"), chat.indexOf("useEffect(() => {\n    const timer = setInterval"));
  assert.match(reset, /chatImageAttachmentStore\.reset\(chatSessionGenerationRef\.current\.current\(\)\);/);
  const invalidations = chat.match(/chatSessionGenerationRef\.current\.invalidate\(\);\n(\s*)(.+)/g) ?? [];
  assert.ok(invalidations.length >= 3);
  for (const site of invalidations) {
    assert.match(site, /resetChatSessionState\(\);|chatImageAttachmentStore\.reset\(chatSessionGenerationRef\.current\.current\(\)\);/, site);
  }
  assert.match(chat, /const generation = chatSessionGenerationRef\.current\.begin\(\);[\s\S]{0,400}resetChatSessionState\(\);/);
});

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

test("앱에는 chat-image 버킷 직접 접근이 없다", () => {
  const files = [...sourceFiles(here("../")), ...sourceFiles(here("../../app"))];
  assert.ok(files.length > 50);
  const hits = files.filter((file) => /\.from\(\s*["'`]chat-image["'`]\s*\)/.test(readFileSync(file, "utf8")));
  assert.deepEqual(hits, []);
});

// 주석은 걷어내고 잰다 — 왜 보내지 않는지 적은 설명이 위반으로 읽히면 안 된다.
function codeOnly(relative, kind) {
  const file = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.ES2022, true, kind);
  return ts.createPrinter({ removeComments: true }).printFile(file);
}

test("서명 URL 은 console·Sentry 로 가지 않는다", () => {
  const libSource = codeOnly("../lib/chatImageAttachments.mjs", ts.ScriptKind.JS);
  const componentSource = codeOnly("../components/chat/ChatImageAttachments.tsx", ts.ScriptKind.TSX);
  assert.match(libSource, /reportChatImageDiagnostic/, "주석 걷기가 코드까지 지우지 않았다");
  assert.match(componentSource, /ChatImageAttachmentsView/);
  for (const source of [libSource, componentSource]) {
    assert.doesNotMatch(source, /Sentry|logDiagnostic|captureException|captureMessage|addBreadcrumb/);
  }
  assert.doesNotMatch(componentSource, /console\./);
  const consoleCalls = libSource.match(/console\.\w+\([^)]*\)/g) ?? [];
  assert.deepEqual(consoleCalls, ["console.warn(CHAT_IMAGE_DIAGNOSTIC_CODE, { received, accepted, rejected, malformed })"]);
});

test("사진을 보낼 수 있다고 암시하지 않는다", () => {
  for (const value of Object.values(lib.CHAT_IMAGE_ATTACHMENT_COPY)) {
    assert.doesNotMatch(value, /보내|올리|업로드|첨부하기|선택/);
  }
  assert.doesNotMatch(chat, /expo-image-picker|ImagePicker|launchImageLibrary/);
  assert.doesNotMatch(chat, /사진 보내기|사진 첨부|파일 첨부|첨부하기/);
  // 이어받기 안내는 그대로다 — 앱에는 첨부를 고르는 곳이 없다.
  assert.ok(chat.includes("첨부파일이 포함된 질문이라 앱에서는 답변을 이어받을 수 없어요. 필요한 내용을 글로 적어 새 메시지로 보내 주세요."));
  assert.ok(chat.includes("이 질문의 첨부 상태를 확인할 수 없어요. 필요한 내용을 글로 적어 새 메시지로 보내 주세요."));
});
