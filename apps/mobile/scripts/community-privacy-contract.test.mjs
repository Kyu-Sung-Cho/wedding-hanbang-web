import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(mobileRoot, relativePath), "utf8");
}

test("account-name saves never request community nickname synchronization", () => {
  const settings = readSource("app/settings/index.tsx");

  assert.doesNotMatch(settings, /sync_community_nickname|communityProfileSynced/);
  assert.doesNotMatch(settings, /실명을 입력|이름 \(실명\)/);
  assert.match(settings, /이름 또는 서로 부를 이름/);
  assert.match(settings, /커뮤니티 별명과는 별개/);
  assert.match(settings, /JSON\.stringify\(\{ name: nextData\.nickname \}\)/);
  assert.match(settings, /if \(communityNicknameChanged\)[\s\S]*?\/api\/community\/profile/);
});

test("mobile public actors reject remote and mixed-text avatars", async () => {
  const moduleUrl = pathToFileURL(
    resolve(mobileRoot, "src/lib/communityPublicPayload.ts"),
  ).href;
  const { hasTrustedCommunityActor, normalizeMobileCommunityAvatar } = await import(moduleUrl);
  const actor = (avatar_url) => ({
    author_id: "11111111-1111-4111-8111-111111111111",
    viewer_is_author: false,
    author: {
      user_id: "11111111-1111-4111-8111-111111111111",
      nickname: "웨딩친구",
      avatar_url,
    },
  });

  assert.equal(normalizeMobileCommunityAvatar(" 🌿 "), "🌿");
  assert.equal(normalizeMobileCommunityAvatar("https://tracker.example/pixel"), null);
  assert.equal(normalizeMobileCommunityAvatar("🌿tracking"), null);
  assert.equal(hasTrustedCommunityActor(actor("🌿")), true);
  assert.equal(hasTrustedCommunityActor(actor("https://tracker.example/pixel")), false);
  assert.equal(hasTrustedCommunityActor(actor("🌿tracking")), false);
});

test("mobile renderer never loads a public avatar as a remote image", () => {
  const avatar = readSource("src/components/community/CommunityAvatar.tsx");

  assert.match(avatar, /normalizeMobileCommunityAvatar\(avatarUrl\)/);
  assert.doesNotMatch(avatar, /<Image|ImageBackground|source=\{\{\s*uri/);
});
