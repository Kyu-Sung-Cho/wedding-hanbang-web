import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(mobileRoot, relativePath), "utf8");
}

test("dashboard partner activity affordance opens the schedule", () => {
  const source = readSource("app/(tabs)/dashboard.tsx");
  const banner = source.match(/\{data\?\.partnerActivity && \([\s\S]*?\n\s*\)\}/)?.[0] ?? "";

  assert.match(banner, /<Pressable/);
  assert.match(banner, /onPress=\{\(\) => router\.push\("\/schedule"\)\}/);
  assert.match(banner, /accessibilityRole="button"/);
  assert.match(banner, /<ChevronRight/);
});

test("profile app version is static and can intentionally suppress the chevron", () => {
  const profile = readSource("app/(tabs)/profile.tsx");
  const appUi = readSource("src/components/ui/AppUI.tsx");
  const versionRow = profile.match(/<MenuItem\s+icon=\{Info\}[\s\S]*?\/>/)?.[0] ?? "";

  assert.doesNotMatch(versionRow, /onPress=/);
  assert.match(versionRow, /hideChevron/);
  assert.match(appUi, /right === undefined \? <ChevronRight/);
});

for (const [name, relativePath, retryMessage] of [
  ["budget", "app/budget/index.tsx", "예산 정보를 불러오지 못했어요"],
  ["schedule", "app/schedule/index.tsx", "체크리스트와 일정을 불러오지 못했어요"],
]) {
  test(`${name} distinguishes query failures from empty data`, () => {
    const source = readSource(relativePath);

    assert.match(source, /error: authError/);
    assert.match(source, /error: profileError/);
    assert.match(source, /error: journeyError/);
    assert.match(source, /setLoadError\(true\)/);
    assert.match(source, /loadError && !hasLoadedData/);
    assert.match(source, new RegExp(retryMessage));
    assert.match(source, /loadError && hasLoadedData/);
    assert.match(source, /최신 .*불러오지 못했어요/);
  });
}

test("vendor favorites never fail as a silent empty set", () => {
  const source = readSource("app/vendors/index.tsx");

  assert.match(source, /setFavoriteError\(true\)/);
  assert.match(source, /favoriteError && !loading && !error/);
  assert.match(source, /저장된 즐겨찾기를 불러오지 못했어요/);
  assert.match(source, /Alert\.alert\("즐겨찾기를 저장하지 못했어요"/);
});
