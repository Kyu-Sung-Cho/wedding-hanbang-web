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

test("native settings opts into proactive care only through the gated control while preserving legacy opt-out", () => {
  // 2026-11-13 10장 P1: 켜기는 `/api/amora/care-preferences` 를 쓰는 새 칸만 한다. 설정 화면이
  // 예전 프로필 경로로 직접 켜는 일은 여전히 없어야 한다.
  assert.doesNotMatch(settingsSource, /care_notifications_enabled: value/);
  assert.doesNotMatch(settingsSource, /care_notifications_enabled: true/);
  assert.match(settingsSource, /care_notifications_enabled: false/);
  assert.match(settingsSource, /legacyCareConsentActive && !careControlAvailable \?/);
  assert.doesNotMatch(settingsSource, /아모라 먼저 챙기기/);
});
