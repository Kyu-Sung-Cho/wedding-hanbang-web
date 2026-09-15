import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import {
  PROFILE_AVATAR_MAX_PHOTO_BYTES,
  buildProfileAvatarJsonBody,
  isSavedProfileAvatarSelection,
  parseProfileAvatarResponse,
  profileAvatarKind,
  profileAvatarSaveErrorMessage,
  readProfileAvatarPhotoAsset,
} from "../lib/profileAvatarPresentation.mjs";

// 2026-09-12 요청: 모바일 내 정보 탭이 이름 첫 글자만 보이고, 웹에서 고른 이모지·사진을
// 보여주지도 바꾸지도 못했다. 서버(PUT /api/profile/avatar)는 Bearer 요청을 받으므로
// 앱에서 같은 계약으로 읽고 저장한다.

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";
const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("avatar responses are accepted only in the exact server shape for this owner", () => {
  assert.deepEqual(parseProfileAvatarResponse({ avatar_url: null, revision: null }, OWNER), { avatar_url: null, revision: null });
  assert.equal(parseProfileAvatarResponse({ avatar_url: null, revision: null }, OWNER, true), null, "저장 응답은 revision 이 있어야 한다");
  assert.deepEqual(parseProfileAvatarResponse({ avatar_url: "🐶", revision: REVISION }, OWNER, true), { avatar_url: "🐶", revision: REVISION });
  const photo = `/api/profile/avatar/image?userId=${OWNER}&version=${REVISION}`;
  assert.deepEqual(parseProfileAvatarResponse({ avatar_url: photo, revision: REVISION }, OWNER, true), { avatar_url: photo, revision: REVISION });
  for (const value of [
    { avatar_url: "🦄", revision: REVISION },
    { avatar_url: `/api/profile/avatar/image?userId=${OTHER}&version=${REVISION}`, revision: REVISION },
    { avatar_url: `/api/profile/avatar/image?userId=${OWNER}&version=${OTHER}`, revision: REVISION },
    { avatar_url: "https://hanbang.ai/api/profile/avatar/image", revision: REVISION },
    { avatar_url: "🐶", revision: "nope" },
    null,
  ]) {
    assert.equal(parseProfileAvatarResponse(value, OWNER, true), null, JSON.stringify(value));
  }
  assert.equal(profileAvatarKind("🐶"), "emoji");
  assert.equal(profileAvatarKind(photo), "photo");
  assert.equal(profileAvatarKind(null), "initial");
});

test("emoji and initial saves send exactly the keys the server accepts", () => {
  // 서버 readSelection 은 키 집합을 정렬해 정확히 비교한다. 키가 하나라도 더 붙으면 400이다.
  const emoji = buildProfileAvatarJsonBody({ kind: "emoji", emoji: "🐶", expectedRevision: REVISION, ownerId: OWNER });
  assert.equal(Object.keys(emoji).sort().join(","), "emoji,expected_revision,expected_user_id,kind");
  assert.deepEqual(emoji, { kind: "emoji", emoji: "🐶", expected_revision: REVISION, expected_user_id: OWNER });
  const initial = buildProfileAvatarJsonBody({ kind: "initial", emoji: "🐶", expectedRevision: null, ownerId: OWNER });
  assert.equal(Object.keys(initial).sort().join(","), "expected_revision,expected_user_id,kind");
  assert.throws(() => buildProfileAvatarJsonBody({ kind: "emoji", emoji: "🦄", expectedRevision: null, ownerId: OWNER }));

  const route = readSource("../../../web/src/app/api/profile/avatar/route.ts");
  assert.match(route, /"emoji,expected_revision,expected_user_id,kind"/u);
  assert.match(route, /"expected_revision,expected_user_id,kind"/u);
  assert.match(route, /key !== "photo" && key !== "expected_revision" && key !== "expected_user_id"/u);
});

test("a save is reported only when the server echoes the chosen value", () => {
  assert.equal(isSavedProfileAvatarSelection({ kind: "emoji", emoji: "🐶" }, { avatar_url: "🐶", revision: REVISION }), true);
  assert.equal(isSavedProfileAvatarSelection({ kind: "emoji", emoji: "🐶" }, { avatar_url: "🐱", revision: REVISION }), false);
  assert.equal(isSavedProfileAvatarSelection({ kind: "initial" }, { avatar_url: null, revision: REVISION }), true);
  assert.equal(isSavedProfileAvatarSelection({ kind: "photo" }, { avatar_url: `/api/profile/avatar/image?userId=${OWNER}&version=${REVISION}`, revision: REVISION }), true);
  assert.equal(isSavedProfileAvatarSelection({ kind: "photo" }, { avatar_url: "🐶", revision: REVISION }), false);
  assert.equal(isSavedProfileAvatarSelection({ kind: "initial" }, null), false);
});

test("photo picks are limited to JPG, PNG, WebP up to 4MB before upload", () => {
  assert.deepEqual(readProfileAvatarPhotoAsset({ uri: "file:///a.jpg", mimeType: "image/jpeg", fileSize: 1024 }), {
    ok: true, photo: { uri: "file:///a.jpg", name: "profile.jpg", type: "image/jpeg" },
  });
  assert.equal(readProfileAvatarPhotoAsset({ uri: "file:///a.png", fileName: "a.png" }).photo.type, "image/png", "형식이 비어 있으면 확장자로 판단한다");
  assert.equal(readProfileAvatarPhotoAsset({ uri: "file:///a.heic", mimeType: "image/heic" }).ok, false);
  assert.equal(readProfileAvatarPhotoAsset({ uri: "file:///a.gif", mimeType: "image/gif" }).ok, false);
  assert.equal(readProfileAvatarPhotoAsset({ uri: "file:///a.jpg", mimeType: "image/jpeg", fileSize: PROFILE_AVATAR_MAX_PHOTO_BYTES + 1 }).ok, false);
  assert.equal(readProfileAvatarPhotoAsset({ uri: "file:///a.jpg", mimeType: "image/jpeg", fileSize: 0 }).ok, false);
  assert.equal(readProfileAvatarPhotoAsset({ mimeType: "image/jpeg" }).ok, false);
  assert.equal(PROFILE_AVATAR_MAX_PHOTO_BYTES, 4 * 1024 * 1024);
});

test("save failures explain what to do without apologizing", () => {
  for (const code of ["AUTH_REQUIRED", "AVATAR_OWNER_CHANGED", "INVALID_IMAGE", "AVATAR_TOO_LARGE", "AVATAR_SAVE_CONFLICT", "RATE_LIMITED", null]) {
    const message = profileAvatarSaveErrorMessage(code);
    assert.match(message, /주세요\.$/u);
    assert.doesNotMatch(message, /죄송|미안/u);
  }
});

test("the server routes accept the mobile Bearer credential this editor relies on", () => {
  // 이 편집기는 서버를 고치지 않고 붙었다. 서버가 Bearer 신뢰를 거두면 앱 저장이 조용히 403이 된다.
  const trusted = readSource("../../../web/src/utils/trustedMutation.ts");
  assert.match(trusted, /if \(authorization\.kind === "bearer"\) return true;/u);
  const route = readSource("../../../web/src/app/api/profile/avatar/route.ts");
  assert.match(route, /createClientFromRequest\(request\)/u);
  const image = readSource("../../../web/src/app/api/profile/avatar/image/route.ts");
  assert.match(image, /createClientFromRequest\(request\)/u);
});

test("profile tab shows the chosen avatar and opens the editor", () => {
  const profile = readSource("../../app/(tabs)/profile.tsx");
  // 표시용 조회는 조용한 헬퍼와 타임아웃으로 읽는다(profileTabAvatarLoad.test.mjs 가 동작을 확인한다).
  assert.match(profile, /apiFetchForExpectedUserQuiet\(user\.id, "\/api\/profile\/avatar", \{ method: "GET", signal \}\)/u);
  assert.match(profile, /<ProfileAvatar\s+name=\{profile\?\.name\}\s+avatarUrl=\{profile && avatar\?\.userId === profile\.userId \? avatar\.avatarUrl : null\}\s+ownerId=\{profile\?\.userId\}/u);
  assert.match(profile, /<ProfileAvatarEditorSheet/u);
  assert.match(profile, /프로필 꾸미기/u);

  const editor = readSource("../components/profile/ProfileAvatarEditorSheet.tsx");
  assert.match(editor, /PROFILE_AVATAR_EMOJIS\.map/u);
  assert.match(editor, /apiFetchForExpectedUser\(ownerId, "\/api\/profile\/avatar", \{\s*method: "PUT"/u);
  assert.match(editor, /form\.append\("expected_user_id", ownerId\)/u);
  assert.match(editor, /"Content-Type": "multipart\/form-data"/u);
  assert.match(editor, /ImagePicker\.launchImageLibraryAsync\(/u);
  assert.doesNotMatch(editor, /requestMediaLibraryPermissionsAsync/u, "시스템 선택기는 앨범 전체 권한을 요구하지 않는다");

  const avatar = readSource("../components/ui/ProfileAvatar.tsx");
  // 개인 사진은 Bearer 로만 읽힌다. 토큰은 검증된 경로 + 앱 API 주소에만 붙는다.
  assert.match(avatar, /uri: `\$\{API_BASE\}\$\{photo\.path\}`, headers: \{ Authorization: `Bearer \$\{photo\.token\}` \}/u);
  assert.match(avatar, /profileAvatarDisplay\(\{ name, avatarUrl, ownerId \}\)/u);
});
