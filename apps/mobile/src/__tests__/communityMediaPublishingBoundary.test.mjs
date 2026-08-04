import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const mobileRoot = resolve(import.meta.dirname, "../..");
const writeSource = readFileSync(
  resolve(mobileRoot, "app/community/post/write.tsx"),
  "utf8",
);
const envExample = readFileSync(resolve(mobileRoot, ".env.example"), "utf8");

test("mobile community media UI requires an exact-true public flag", () => {
  assert.match(
    writeSource,
    /process\.env\.EXPO_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED\s*===\s*["']true["']/u,
  );
  assert.match(
    writeSource,
    /\{COMMUNITY_MEDIA_UI_ENABLED\s*&&\s*\([\s\S]*?사진 첨부/u,
  );
  assert.match(
    envExample,
    /^EXPO_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED=false$/mu,
  );
});

test("the default-off path cannot request gallery permission or upload bytes", () => {
  const pickerStart = writeSource.indexOf("async function pickImages()");
  const pickerGuard = writeSource.indexOf(
    "if (!COMMUNITY_MEDIA_UI_ENABLED) return;",
    pickerStart,
  );
  const permissionRequest = writeSource.indexOf(
    "ImagePicker.requestMediaLibraryPermissionsAsync()",
    pickerStart,
  );
  assert.ok(pickerStart >= 0);
  assert.ok(pickerGuard > pickerStart);
  assert.ok(permissionRequest > pickerGuard);

  const uploadStart = writeSource.indexOf("async function uploadImages()");
  const uploadGuard = writeSource.indexOf(
    "if (!COMMUNITY_MEDIA_UI_ENABLED)",
    uploadStart,
  );
  const uploadCall = writeSource.indexOf("uploadCommunityMedia(img)", uploadStart);
  assert.ok(uploadStart >= 0);
  assert.ok(uploadGuard > uploadStart);
  assert.ok(uploadCall > uploadGuard);
  assert.match(
    writeSource,
    /const imageUrls = COMMUNITY_MEDIA_UI_ENABLED\s*\?\s*await uploadImages\(\)\s*:\s*\[\]/u,
  );
});

test("an unchanged mobile post retry reuses its command key and finalized upload payload", () => {
  assert.match(writeSource, /pendingPostCommandRef\s*=\s*useRef/u);
  assert.match(
    writeSource,
    /pendingPostCommandRef\.current\?\.fingerprint\s*!==\s*fingerprint[\s\S]*?idempotencyKey:\s*Crypto\.randomUUID\(\)[\s\S]*?body:/u,
  );
  assert.match(
    writeSource,
    /headers:\s*\{\s*["']Idempotency-Key["']:\s*pendingCommand\.idempotencyKey\s*\}/u,
  );
  assert.match(writeSource, /body:\s*JSON\.stringify\(pendingCommand\.body\)/u);

  const requestStart = writeSource.indexOf('apiFetch("/api/community/posts"');
  const failureCheck = writeSource.indexOf("if (!res.ok)", requestStart);
  const clearAfterSuccess = writeSource.indexOf(
    "pendingPostCommandRef.current = null",
    failureCheck,
  );
  assert.ok(requestStart >= 0);
  assert.ok(failureCheck > requestStart);
  assert.ok(clearAfterSuccess > failureCheck);
});
