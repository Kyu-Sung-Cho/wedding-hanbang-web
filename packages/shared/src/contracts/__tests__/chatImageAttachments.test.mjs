// 채팅 사진 첨부 계약 — 웹 ChatBubble 과 앱이 같은 판정으로 첨부를 읽고, 앱은 서명 URL 을
// 출처·버킷까지 확인한 뒤에만 그린다(2026-09-18, wave 2 · 2.5a 보기 전용).
//
// 지키는 것:
// - 첨부 판정: imagePaths 다음 legacy imageUrls, 문자열만, 중복 없이, 최대 10개.
//   정상 자료(문자열 배열)에서는 웹이 예전에 쓰던 인라인 키와 **글자 하나까지 같다**.
// - 서명 URL: https · 설정된 Supabase URL 과 같은 origin · /storage/v1/object/sign/chat-image/ 경로만.
//   적대적 입력은 모두 버리고, 받은 개수와 버린 개수를 돌려줘 호출부가 진단을 남길 수 있게 한다.
// - 상수는 서버(image-urls route)의 최대 개수·서명 유효시간과 어긋나지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  CHAT_IMAGE_CLIENT_REFRESH_TTL_MS,
  CHAT_IMAGE_MAX_ATTACHMENTS,
  CHAT_IMAGE_SIGNED_URL_PATH_PREFIX,
  CHAT_IMAGE_URLS_ENDPOINT,
  getChatImageAttachmentRefs,
  hasChatImageAttachments,
  parseChatImageUrlsResponse,
} from "../chatImageAttachments.mjs";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const COUPLE = "33333333-3333-4333-8333-333333333333";
const SENDER = "11111111-1111-4111-8111-111111111111";
const path = (n) => `${COUPLE}/${SENDER}/5555555${n}-5555-4555-8555-555555555555.png`;
const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const signed = (objectPath, origin = SUPABASE_URL, bucket = "chat-image") =>
  `${origin}/storage/v1/object/sign/${bucket}/${objectPath}?token=eyJhbGciOiJIUzI1NiJ9.e30.sig`;

// 웹 ChatBubble 이 이 모듈을 쓰기 전에 인라인으로 쓰던 판정 그대로다(2026-09-18 이전 107-110행).
function legacyWebInline(messageId, metadata) {
  const storedImageUrls = metadata?.imageUrls ?? [];
  const storedImagePaths = metadata?.imagePaths ?? [];
  return {
    attachmentKey: `${messageId}|${[...storedImagePaths, ...storedImageUrls].join("|")}`,
    hasAttachments: storedImagePaths.length > 0 || storedImageUrls.length > 0,
  };
}

test("imagePaths 다음 legacy imageUrls 순서로 읽고, 키는 그 순서를 | 로 잇는다", () => {
  const legacyUrl = `${SUPABASE_URL}/storage/v1/object/public/chat-image/${COUPLE}/1700000000000-a1b2c.png`;
  const result = getChatImageAttachmentRefs({ imagePaths: [path(1), path(2)], imageUrls: [legacyUrl] });
  assert.deepEqual(result.refs, [path(1), path(2), legacyUrl]);
  assert.equal(result.attachmentKey, `${path(1)}|${path(2)}|${legacyUrl}`);
  assert.equal(hasChatImageAttachments({ imagePaths: [path(1)] }), true);
  assert.equal(hasChatImageAttachments({ imageUrls: [legacyUrl] }), true);
});

test("정상 자료에서는 웹이 예전에 쓰던 인라인 판정과 키·요청 조건이 같다", () => {
  const legacyUrl = `${SUPABASE_URL}/storage/v1/object/public/chat-image/${COUPLE}/1700000000001-d3e4f.webp`;
  const samples = [
    {},
    { imagePaths: [] },
    { imageUrls: [] },
    { imagePaths: [path(1)] },
    { imagePaths: [path(1), path(2), path(3)] },
    { imageUrls: [legacyUrl] },
    { imagePaths: [path(4)], imageUrls: [legacyUrl] },
    { target: "partner", imagePaths: [path(5)] },
    { imagePaths: Array.from({ length: 10 }, (_, i) => path(i)) },
  ];
  for (const metadata of [...samples, null, undefined]) {
    const legacy = legacyWebInline("m1", metadata);
    const refs = getChatImageAttachmentRefs(metadata);
    assert.equal(`m1|${refs.attachmentKey}`, legacy.attachmentKey, JSON.stringify(metadata));
    assert.equal(refs.refs.length > 0, legacy.hasAttachments, JSON.stringify(metadata));
    assert.equal(hasChatImageAttachments(metadata), legacy.hasAttachments);
  }
});

test("문자열만 받고, 중복을 없애고, 최대 10개로 자른다", () => {
  assert.deepEqual(getChatImageAttachmentRefs({ imagePaths: [path(1), 7, null, { path: path(2) }, path(1)], imageUrls: [path(1), false] }).refs, [path(1)]);
  const many = Array.from({ length: 14 }, (_, i) => `${COUPLE}/${SENDER}/file-${String(i).padStart(2, "0")}.png`);
  const capped = getChatImageAttachmentRefs({ imagePaths: many.slice(0, 8), imageUrls: many.slice(8) });
  assert.equal(capped.refs.length, CHAT_IMAGE_MAX_ATTACHMENTS);
  assert.deepEqual(capped.refs, many.slice(0, 10));
  assert.equal(capped.attachmentKey, many.slice(0, 10).join("|"));
});

test("배열이 아닌 값·객체가 아닌 metadata 는 첨부 없음이다", () => {
  for (const metadata of [null, undefined, "imagePaths", 3, [path(1)], { imagePaths: path(1) }, { imagePaths: { 0: path(1) } }, { imageUrls: "https://x" }, { imagePaths: [1, 2] }]) {
    const result = getChatImageAttachmentRefs(metadata);
    assert.deepEqual(result.refs, [], JSON.stringify(metadata));
    assert.equal(result.attachmentKey, "");
    assert.equal(hasChatImageAttachments(metadata), false);
  }
});

test("상수는 서버 image-urls route 와 어긋나지 않는다", () => {
  assert.equal(CHAT_IMAGE_URLS_ENDPOINT, "/api/chat/image-urls");
  assert.equal(CHAT_IMAGE_MAX_ATTACHMENTS, 10);
  assert.equal(CHAT_IMAGE_CLIENT_REFRESH_TTL_MS, 50 * 60 * 1000);
  assert.equal(CHAT_IMAGE_SIGNED_URL_PATH_PREFIX, "/storage/v1/object/sign/chat-image/");
  const route = read("../../../../../apps/web/src/app/api/chat/image-urls/route.ts");
  assert.match(route, /const MAX_PATHS = 10;/);
  const ttl = /const SIGNED_URL_TTL_SECONDS = 60 \* 60;/.exec(route);
  assert.ok(ttl, "서버 서명 유효시간 선언을 찾지 못했다");
  // 클라이언트는 서명이 끝나기 전에 새로 받는다.
  assert.ok(CHAT_IMAGE_CLIENT_REFRESH_TTL_MS < 60 * 60 * 1000);
  assert.match(route, /\.from\("chat-image"\)/);
  const manifest = JSON.parse(read("../../../package.json"));
  assert.equal(manifest.exports["./chat-image-attachments"], "./src/contracts/chatImageAttachments.mjs");
});

test("https · 같은 origin · chat-image 서명 경로만 남긴다", () => {
  const good = [signed(path(1)), signed(path(2))];
  const result = parseChatImageUrlsResponse({ urls: good.map((signedUrl, i) => ({ path: path(i + 1), signedUrl })) }, { supabaseUrl: SUPABASE_URL });
  assert.deepEqual(result, { urls: good, received: 2, rejected: 0, malformed: false });
});

test("설정값에 끝 슬래시나 대문자 호스트가 있어도 정상 URL 은 통과한다", () => {
  const payload = { urls: [{ signedUrl: signed(path(1)) }] };
  for (const supabaseUrl of [`${SUPABASE_URL}/`, "https://ABCDEFGHIJKLMNOPQRST.supabase.co", `${SUPABASE_URL}/rest/v1`]) {
    assert.deepEqual(parseChatImageUrlsResponse(payload, { supabaseUrl }).urls, [signed(path(1))], supabaseUrl);
  }
});

test("적대적 항목은 하나씩 버리고 받은 개수·버린 개수를 센다", () => {
  const hostile = [
    { signedUrl: signed(path(1)).replace("https://", "http://") },
    { signedUrl: signed(path(1), "https://evil.example") },
    { signedUrl: signed(path(1), "https://abcdefghijklmnopqrst.supabase.co.evil.example") },
    { signedUrl: signed(path(1), `${SUPABASE_URL}:8443`) },
    { signedUrl: signed(path(1), "https://user:pass@abcdefghijklmnopqrst.supabase.co") },
    { signedUrl: signed(path(1), "https://user@abcdefghijklmnopqrst.supabase.co") },
    { signedUrl: signed(path(1), "https://:pass@abcdefghijklmnopqrst.supabase.co") },
    { signedUrl: signed(path(1), SUPABASE_URL, "avatars") },
    { signedUrl: signed(path(1), SUPABASE_URL, "chat-image-other") },
    { signedUrl: `${SUPABASE_URL}/storage/v1/object/public/chat-image/${path(1)}` },
    { signedUrl: `${SUPABASE_URL}/storage/v1/object/sign/chat-image/../avatars/${path(1)}?token=x` },
    { signedUrl: `${SUPABASE_URL}/storage/v1/object/sign/chat-image/%2e%2e/avatars/x.png?token=x` },
    { signedUrl: `${SUPABASE_URL}/storage/v1/object/sign/chat-image/` },
    { signedUrl: "javascript:alert(1)" },
    { signedUrl: "not a url" },
    { signedUrl: null },
    { signedUrl: 42 },
    { path: path(1) },
    null,
    "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/chat-image/x.png",
  ];
  const good = { signedUrl: signed(path(2)) };
  for (const item of hostile) {
    const label = JSON.stringify(item);
    // 적대적 항목은 버리고 옆의 정상 항목은 그대로 둔다.
    assert.deepEqual(
      parseChatImageUrlsResponse({ urls: [item, good] }, { supabaseUrl: SUPABASE_URL }),
      { urls: [signed(path(2))], received: 2, rejected: 1, malformed: false },
      label,
    );
    // 그것 하나만 왔으면 받은 1개를 모두 버린 것이다 — 호출부가 개수로 진단을 남긴다.
    assert.deepEqual(
      parseChatImageUrlsResponse({ urls: [item] }, { supabaseUrl: SUPABASE_URL }),
      { urls: [], received: 1, rejected: 1, malformed: false },
      label,
    );
  }
  const batch = parseChatImageUrlsResponse({ urls: [...hostile.slice(0, 9), good] }, { supabaseUrl: SUPABASE_URL });
  assert.deepEqual(batch, { urls: [signed(path(2))], received: 10, rejected: 9, malformed: false });
});

test("urls 가 배열이 아니거나 11개 이상이면 응답 전체를 버린다", () => {
  for (const payload of [null, undefined, "urls", [], {}, { urls: null }, { urls: "https://x" }, { urls: { 0: { signedUrl: signed(path(1)) } } }]) {
    const result = parseChatImageUrlsResponse(payload, { supabaseUrl: SUPABASE_URL });
    assert.deepEqual(result, { urls: [], received: 0, rejected: 0, malformed: true }, JSON.stringify(payload));
  }
  const eleven = Array.from({ length: 11 }, (_, i) => ({ signedUrl: signed(`${COUPLE}/${SENDER}/f${i}.png`) }));
  assert.deepEqual(parseChatImageUrlsResponse({ urls: eleven }, { supabaseUrl: SUPABASE_URL }), { urls: [], received: 11, rejected: 11, malformed: true });
  const ten = eleven.slice(0, 10);
  assert.equal(parseChatImageUrlsResponse({ urls: ten }, { supabaseUrl: SUPABASE_URL }).urls.length, 10);
});

test("빈 목록은 빈 결과이고 진단 대상이 아니다", () => {
  assert.deepEqual(parseChatImageUrlsResponse({ urls: [] }, { supabaseUrl: SUPABASE_URL }), { urls: [], received: 0, rejected: 0, malformed: false });
});

test("설정된 Supabase URL 이 없거나 https 가 아니면 아무것도 남기지 않는다", () => {
  const payload = { urls: [{ signedUrl: signed(path(1)) }] };
  for (const supabaseUrl of [undefined, null, "", "not a url", "http://abcdefghijklmnopqrst.supabase.co"]) {
    assert.deepEqual(parseChatImageUrlsResponse(payload, { supabaseUrl }), { urls: [], received: 1, rejected: 1, malformed: false }, String(supabaseUrl));
  }
  const local = parseChatImageUrlsResponse(
    { urls: [{ signedUrl: "http://127.0.0.1:54321/storage/v1/object/sign/chat-image/a/b.png?token=x" }] },
    { supabaseUrl: "http://127.0.0.1:54321" },
  );
  assert.deepEqual(local.urls, []);
  assert.throws(() => parseChatImageUrlsResponse(payload), TypeError);
});
