import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const helperPath = fileURLToPath(new URL("../lib/communityUpload.ts", import.meta.url));
const helperSource = readFileSync(helperPath, "utf8");
const writePath = fileURLToPath(new URL("../../app/community/post/write.tsx", import.meta.url));
const writeSource = readFileSync(writePath, "utf8");

test("mobile sends file bytes directly to the exact Supabase signed path as ArrayBuffer", () => {
  assert.match(helperSource, /const localResponse = await fetch\(asset\.uri\)/);
  assert.match(helperSource, /const bytes = await localResponse\.arrayBuffer\(\)/);
  assert.match(
    helperSource,
    /apiFetchForExpectedUser\(\s*ownerUserId,\s*"\/api\/community\/upload"/s,
  );
  assert.match(helperSource, /body: JSON\.stringify\(\{ mimeType, size: bytes\.byteLength \}\)/);
  assert.match(helperSource, /\.from\(signed\.bucket\)[\s\S]*\.uploadToSignedUrl\([\s\S]*signed\.path,[\s\S]*signed\.token,[\s\S]*bytes/);
  assert.doesNotMatch(helperSource, /FormData/);
});

test("mobile exposes a URL only after the idempotent finalize endpoint succeeds", () => {
  const uploadIndex = helperSource.indexOf("uploadToSignedUrl(");
  const finalizeIndex = helperSource.lastIndexOf(
    "return finalizeWithRetry(signed.uploadId, ownerUserId)",
  );
  const returnIndex = helperSource.indexOf("return { url: finalized.url, type: finalized.type }");
  assert.ok(uploadIndex >= 0);
  assert.ok(finalizeIndex > uploadIndex);
  assert.ok(returnIndex >= 0);
  assert.doesNotMatch(helperSource, /publicUrl|getPublicUrl/);
});

test("mobile disables unsanitized video, caps all uploads at six MiB, and bounds finalize retry", () => {
  assert.doesNotMatch(helperSource, /"video\//);
  assert.match(helperSource, /MOBILE_MAX_UPLOAD_BYTES\s*=\s*6\s*\*\s*1024\s*\*\s*1024/);
  assert.match(helperSource, /FINALIZE_MAX_ATTEMPTS\s*=\s*3/);
  assert.match(helperSource, /attempt\s*<\s*FINALIZE_MAX_ATTEMPTS/);
  assert.match(helperSource, /response\.status\s*===\s*409\s*\|\|\s*response\.status\s*>=\s*500/);
  assert.match(helperSource, /Math\.min\(retryAfterMs,[\s\S]*FINALIZE_MAX_DELAY_MS\)/);
});

test("mobile rejects an unknown or oversized picker file before buffering its bytes", () => {
  const sizeCheckIndex = helperSource.indexOf("asset.fileSize");
  const fetchIndex = helperSource.indexOf("fetch(asset.uri)");
  assert.ok(sizeCheckIndex >= 0);
  assert.ok(fetchIndex > sizeCheckIndex);
  assert.match(writeSource, /fileSize:\s*asset\.fileSize/);
});

test("mobile binds init, signed path, upload, and finalize to one verified account", () => {
  assert.match(helperSource, /const ownerUserId = await verifiedUserId\(\)/);
  assert.match(helperSource, /isValidSignedUpload\(signed, mimeType, ownerUserId\)/);
  assert.match(helperSource, /value\.path\.toLowerCase\(\) ===/);
  assert.match(
    helperSource,
    /await assertExpectedUser\(ownerUserId\);[\s\S]*uploadToSignedUrl/,
  );
  assert.match(
    helperSource,
    /apiFetchForExpectedUser\(\s*expectedUserId,\s*"\/api\/community\/upload\/finalize"/s,
  );
  assert.match(
    helperSource,
    /await assertExpectedUser\(expectedUserId\);[\s\S]*return \{ url: finalized\.url/,
  );
  assert.match(helperSource, /error\.message === "API_SESSION_OWNER_MISMATCH"/);
});

test("mobile write screen has no legacy hard-coded multipart upload path", () => {
  assert.match(writeSource, /import \{ uploadCommunityMedia \} from "@\/lib\/communityUpload"/);
  assert.match(writeSource, /await uploadCommunityMedia\(img\)/);
  assert.doesNotMatch(writeSource, /UPLOAD_URL|new FormData|formData\.append/);
  assert.doesNotMatch(writeSource, /supabase\.auth\.getSession/);
});
