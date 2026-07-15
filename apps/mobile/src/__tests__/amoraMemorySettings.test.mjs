import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const settingsSource = readFileSync(new URL("../../app/settings/index.tsx", import.meta.url), "utf8");
const memorySource = readFileSync(new URL("../../app/settings/amora-memory.tsx", import.meta.url), "utf8");

test("native settings exposes Amora memory controls without a sessionless WebView", () => {
  assert.match(settingsSource, /router\.push\("\/settings\/amora-memory"/);
  assert.match(memorySource, /apiJson<MemoryResponse>\("\/api\/amora\/memory"\)/);
  assert.doesNotMatch(memorySource, /WebView|Linking\.openURL/);
});

test("mobile memory deletion and full reset require explicit confirmation", () => {
  assert.match(memorySource, /Alert\.alert\(\s*"이 기억을 지울까요\?"/);
  assert.match(memorySource, /Alert\.alert\(\s*"이 범위의 기억을 초기화할까요\?"/);
  assert.match(memorySource, /action: "delete_memory"/);
  assert.match(memorySource, /action: "clear_scope"/);
});

test("native proactive-care switch persists explicit server consent", () => {
  assert.match(settingsSource, /care_notifications_enabled: value/);
  assert.match(settingsSource, /apiFetch\("\/api\/profile"/);
});
