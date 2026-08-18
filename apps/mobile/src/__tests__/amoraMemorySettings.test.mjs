import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const settingsSource = readFileSync(new URL("../../app/settings/index.tsx", import.meta.url), "utf8");
const memorySource = readFileSync(new URL("../../app/settings/amora-memory.tsx", import.meta.url), "utf8");

test("native settings exposes Amora memory controls without a sessionless WebView", () => {
  assert.match(settingsSource, /router\.push\("\/settings\/amora-memory"/);
  // 여전히 네이티브에서 직접 호출한다(WebView 아님). P0-4 이후로는 그 호출이
  // 요청 시작 사용자에 결박돼야 하므로 결박된 형태까지 함께 고정한다.
  assert.match(
    memorySource,
    /apiJsonForExpectedUser<MemoryResponse>\([\s\S]*?"\/api\/amora\/memory"/,
  );
  assert.doesNotMatch(memorySource, /WebView|Linking\.openURL/);
});

test("mobile memory deletion and full reset require explicit confirmation", () => {
  assert.match(memorySource, /Alert\.alert\(\s*"이 기억을 지울까요\?"/);
  assert.match(memorySource, /Alert\.alert\(\s*"이 범위의 기억을 초기화할까요\?"/);
  assert.match(memorySource, /action: "delete_memory"/);
  assert.match(memorySource, /action: "clear_scope"/);
});

test("mobile exports only the server-sanitized Amora memory payload after the owner and couple fence stays current", () => {
  assert.match(memorySource, /import \{[\s\S]*?Share,[\s\S]*?\} from "react-native"/u);
  assert.match(
    memorySource,
    /apiJsonForExpectedUser<MemoryExportResponse>\([\s\S]*?token\.ownerId,[\s\S]*?"\/api\/amora\/memory\?export=memory"/u,
  );
  assert.match(
    memorySource,
    /const sequence = loadSequenceRef\.current;[\s\S]*?await apiJsonForExpectedUser<MemoryExportResponse>[\s\S]*?await isLoadCommitCurrent\(sequence, token\)[\s\S]*?Share\.share/u,
  );
  assert.match(memorySource, /현재 계정에서 볼 수 있는 아모라 기억만 JSON으로 내보내요\./u);
  assert.match(memorySource, /채팅 원문·일정·예산은 포함하지 않아요\./u);
  assert.doesNotMatch(memorySource, /expo-file-system|WebView|Linking\.openURL/u);
});

test("native settings hides proactive-care opt-in while preserving legacy opt-out", () => {
  assert.doesNotMatch(settingsSource, /care_notifications_enabled: value/);
  assert.doesNotMatch(settingsSource, /care_notifications_enabled: true/);
  assert.match(settingsSource, /care_notifications_enabled: false/);
  assert.match(settingsSource, /legacyCareConsentActive \?/);
  assert.doesNotMatch(settingsSource, /아모라 먼저 챙기기/);
});
