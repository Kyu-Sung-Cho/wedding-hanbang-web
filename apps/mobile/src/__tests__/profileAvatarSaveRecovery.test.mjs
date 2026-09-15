import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import * as avatar from "../lib/profileAvatarPresentation.mjs";

/**
 * 결과를 모르는 프로필 저장 실패 뒤의 복구.
 *
 * 2026-09-15 리뷰: 느린 망에서 사진 저장이 30초 타임아웃에 걸리면 앱은 요청을 끊지만 서버는 이미
 * 저장했을 수 있다. 앱은 예전 revision 을 그대로 들고 있어서 다시 누르면 서버가 409 를 돌려주고,
 * 화면에는 「다른 곳에서 프로필이 바뀌었어요」가 떴다. 실제로 바꾼 것은 같은 기기의 직전 요청이다.
 * 결과를 모르는 실패(끊김, 네트워크 오류, 5xx, 모양이 틀린 응답, 저장 충돌)는 서버 값을 다시 읽어
 * 판단하고, 누가 바꿨는지 단정하지 않는다.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const OLD_REVISION = "33333333-3333-4333-8333-333333333333";
const NEW_REVISION = "44444444-4444-4444-8444-444444444444";
const photoPath = (revision) => `/api/profile/avatar/image?userId=${OWNER}&version=${revision}`;
const json = (status, body) => new globalThis.Response(JSON.stringify(body), { status });
const abortError = () => Object.assign(new Error("Aborted"), { name: "AbortError" });
const GENERIC = "프로필 저장 결과를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";

function run({ selection, expectedRevision = OLD_REVISION, send, current }) {
  const rereads = [];
  const result = avatar.saveProfileAvatarSelection({
    selection,
    expectedRevision,
    ownerId: OWNER,
    send,
    reread: async () => {
      rereads.push(true);
      if (current instanceof Error) throw current;
      return current;
    },
  });
  return { result, rereads };
}

test("the reported sequence: a timed-out save that committed late is recognised as saved on the retry's 409", async () => {
  assert.equal(typeof avatar.saveProfileAvatarSelection, "function");
  const selection = { kind: "emoji", emoji: "🐶" };
  // 1) 첫 저장이 끊겼고, 다시 읽었을 때 서버는 아직 예전 revision 이다 → 저장됐다고 말하지 않는다.
  const first = run({ selection, send: async () => { throw abortError(); }, current: { ok: true, avatarUrl: null, revision: OLD_REVISION } });
  assert.deepEqual(await first.result, { type: "failed", message: GENERIC });
  assert.equal(first.rereads.length, 1);
  // 2) 서버가 늦게 커밋했다. 같은 revision 으로 다시 누르면 409 — 다시 읽으면 고른 이모지가 저장돼 있다.
  const retry = run({
    selection,
    send: async () => json(409, { code: "AVATAR_SAVE_CONFLICT" }),
    current: { ok: true, avatarUrl: "🐶", revision: NEW_REVISION },
  });
  assert.deepEqual(await retry.result, { type: "saved", avatarUrl: "🐶", revision: NEW_REVISION });
});

test("a timeout or network error whose save did land is reported as saved for emoji and initial", async () => {
  for (const failure of [abortError(), new TypeError("Network request failed")]) {
    const emoji = run({ selection: { kind: "emoji", emoji: "🐶" }, send: async () => { throw failure; }, current: { ok: true, avatarUrl: "🐶", revision: NEW_REVISION } });
    assert.deepEqual(await emoji.result, { type: "saved", avatarUrl: "🐶", revision: NEW_REVISION });
    const initial = run({ selection: { kind: "initial" }, send: async () => { throw failure; }, current: { ok: true, avatarUrl: null, revision: NEW_REVISION } });
    assert.deepEqual(await initial.result, { type: "saved", avatarUrl: null, revision: NEW_REVISION });
  }
});

test("5xx, a missing error code and a malformed success body are also checked against the server", async () => {
  for (const send of [
    async () => json(503, { code: "AVATAR_SAVE_FAILED" }),
    async () => json(500, {}),
    async () => json(200, { avatar_url: "🐶" }),
  ]) {
    const { result, rereads } = run({ selection: { kind: "emoji", emoji: "🐶" }, send, current: { ok: true, avatarUrl: "🐶", revision: NEW_REVISION } });
    assert.equal((await result).type, "saved");
    assert.equal(rereads.length, 1);
  }
});

test("a photo cannot be proven identical, so a changed server value refreshes the sheet instead of claiming success", async () => {
  const { result } = run({
    selection: { kind: "photo" },
    send: async () => { throw abortError(); },
    current: { ok: true, avatarUrl: photoPath(NEW_REVISION), revision: NEW_REVISION },
  });
  const outcome = await result;
  assert.equal(outcome.type, "refreshed");
  assert.equal(outcome.avatarUrl, photoPath(NEW_REVISION));
  assert.equal(outcome.revision, NEW_REVISION);
  assert.equal(outcome.message, "프로필이 이미 바뀌었어요. 지금 저장된 모습을 확인해 주세요.");
});

test("a conflict with a different saved value refreshes to that value without saying who changed it", async () => {
  const { result } = run({
    selection: { kind: "emoji", emoji: "🐶" },
    send: async () => json(409, { code: "AVATAR_SAVE_CONFLICT" }),
    current: { ok: true, avatarUrl: "🐱", revision: NEW_REVISION },
  });
  const outcome = await result;
  assert.deepEqual(outcome, { type: "refreshed", avatarUrl: "🐱", revision: NEW_REVISION, message: "프로필이 이미 바뀌었어요. 지금 저장된 모습을 확인해 주세요." });
});

test("if the server value cannot be re-read, the message stays honest about what is known", async () => {
  const afterConflict = run({ selection: { kind: "emoji", emoji: "🐶" }, send: async () => json(409, { code: "AVATAR_SAVE_CONFLICT" }), current: { ok: false } });
  assert.deepEqual(await afterConflict.result, { type: "failed", message: "프로필이 이미 바뀌었어요. 닫은 뒤 다시 열어 확인해 주세요." });
  const afterTimeout = run({ selection: { kind: "emoji", emoji: "🐶" }, send: async () => { throw abortError(); }, current: new Error("offline") });
  assert.deepEqual(await afterTimeout.result, { type: "failed", message: GENERIC });
});

test("definitive rejections are not re-read and keep their specific guidance", async () => {
  // 과한 수정 방지: 서버가 저장 전에 거절한 경우는 결과가 확실하다.
  for (const [response, message] of [
    [json(400, { code: "INVALID_IMAGE" }), avatar.profileAvatarSaveErrorMessage("INVALID_IMAGE")],
    [json(413, { code: "AVATAR_TOO_LARGE" }), avatar.profileAvatarSaveErrorMessage("AVATAR_TOO_LARGE")],
    [json(429, {}), avatar.profileAvatarSaveErrorMessage("RATE_LIMITED")],
    [json(409, { code: "AVATAR_OWNER_CHANGED" }), avatar.profileAvatarSaveErrorMessage("AVATAR_OWNER_CHANGED")],
    [json(401, { code: "AUTH_REQUIRED" }), avatar.profileAvatarSaveErrorMessage("AUTH_REQUIRED")],
  ]) {
    const { result, rereads } = run({ selection: { kind: "emoji", emoji: "🐶" }, send: async () => response, current: { ok: true, avatarUrl: "🐶", revision: NEW_REVISION } });
    assert.deepEqual(await result, { type: "failed", message });
    assert.equal(rereads.length, 0, JSON.stringify(message));
  }
  const owner = run({ selection: { kind: "emoji", emoji: "🐶" }, send: async () => { throw new Error("API_SESSION_OWNER_MISMATCH"); }, current: { ok: true, avatarUrl: "🐶", revision: NEW_REVISION } });
  assert.deepEqual(await owner.result, { type: "failed", message: avatar.profileAvatarSaveErrorMessage("AVATAR_OWNER_CHANGED") });
  assert.equal(owner.rereads.length, 0, "계정이 바뀌었으면 다시 읽지 않는다");
  const expired = run({ selection: { kind: "emoji", emoji: "🐶" }, send: async () => { throw new Error("세션이 만료되었습니다."); }, current: { ok: true, avatarUrl: "🐶", revision: NEW_REVISION } });
  assert.deepEqual(await expired.result, { type: "failed", message: GENERIC });
  assert.equal(expired.rereads.length, 0, "요청을 보내기 전에 멈춘 오류는 다시 읽지 않는다");
});

test("a clean success is reported without an extra read", async () => {
  const { result, rereads } = run({
    selection: { kind: "emoji", emoji: "🐶" },
    send: async () => json(200, { avatar_url: "🐶", revision: NEW_REVISION }),
    current: { ok: false },
  });
  assert.deepEqual(await result, { type: "saved", avatarUrl: "🐶", revision: NEW_REVISION });
  assert.equal(rereads.length, 0);
});

test("no avatar copy claims the change came from somewhere else", () => {
  for (const code of ["AUTH_REQUIRED", "AVATAR_OWNER_CHANGED", "INVALID_IMAGE", "AVATAR_TOO_LARGE", "AVATAR_SAVE_CONFLICT", "RATE_LIMITED", null]) {
    assert.doesNotMatch(avatar.profileAvatarSaveErrorMessage(code), /다른 곳/u);
  }
});

test("display reads split success (including an empty avatar) from failure and give up after the timeout", async () => {
  assert.equal(typeof avatar.readProfileAvatarForDisplay, "function");
  assert.deepEqual(
    await avatar.readProfileAvatarForDisplay(OWNER, async () => json(200, { avatar_url: null, revision: null })),
    { ok: true, avatarUrl: null, revision: null },
    "성공한 빈 값은 글자로 되돌려야 한다",
  );
  assert.deepEqual(
    await avatar.readProfileAvatarForDisplay(OWNER, async () => json(200, { avatar_url: photoPath(NEW_REVISION), revision: NEW_REVISION })),
    { ok: true, avatarUrl: photoPath(NEW_REVISION), revision: NEW_REVISION },
  );
  for (const request of [
    async () => json(503, { code: "PROFILE_AVATAR_UNAVAILABLE" }),
    async () => json(401, {}),
    async () => json(200, { avatar_url: "https://evil.invalid/a.png", revision: NEW_REVISION }),
    async () => { throw new TypeError("Network request failed"); },
  ]) {
    assert.deepEqual(await avatar.readProfileAvatarForDisplay(OWNER, request), { ok: false });
  }
  let aborted = false;
  const started = Date.now();
  const hung = await avatar.readProfileAvatarForDisplay(OWNER, (signal) => new Promise(() => {
    signal.addEventListener("abort", () => { aborted = true; });
  }), 20);
  assert.deepEqual(hung, { ok: false });
  assert.equal(aborted, true, "타임아웃이면 요청도 끊는다");
  assert.ok(Date.now() - started < 2000);
});

test("the editor sheet saves through the recovery helper and gives photo uploads more time", () => {
  const editor = readFileSync(new URL("../components/profile/ProfileAvatarEditorSheet.tsx", import.meta.url), "utf8");
  assert.match(editor, /await saveProfileAvatarSelection\(\{/u);
  assert.match(editor, /reread: \(\) => readProfileAvatarForDisplay\(ownerId, \(signal\) => apiFetchForExpectedUserQuiet\(ownerId, "\/api\/profile\/avatar", \{ method: "GET", signal \}\)\)/u);
  assert.match(editor, /const PHOTO_SAVE_TIMEOUT_MS = 60_000;/u);
  assert.match(editor, /withTimeout\(kind === "photo" \? PHOTO_SAVE_TIMEOUT_MS : REQUEST_TIMEOUT_MS\)/u);
  // 새로 읽은 값이 저장이 아니면 시트를 서버 값으로 맞추고, 내 정보 탭에도 알린다.
  assert.match(editor, /outcome\.type === "refreshed"[\s\S]{0,600}setExpectedRevision\(outcome\.revision\)[\s\S]{0,400}onAvatarChanged\(outcome\.avatarUrl\)/u);
});
