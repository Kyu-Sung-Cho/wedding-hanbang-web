import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { generateBankModule } from "../build-wedding-code-v40-bank.mjs";
import { lintBank } from "../lib/wedding-code-v40-bank-lint.mjs";

const root = join(import.meta.dirname, "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const v40 = JSON.parse(read("docs/wedding-code/2026-09-29_v40_items.json"));
const v41 = JSON.parse(read("docs/wedding-code/2026-10-04_v41_items.json"));

const arrangement = (item) => ({
  id: item.id,
  axis: item.axis,
  facet: item.facet,
  section: item.section,
  screen: item.screen,
  fmt: item.fmt,
  kind: item.kind,
  key: item.key,
  highPole: item.highPole,
  poles: (item.cards ?? item.options ?? item.entries ?? []).map(({ pole, strength }) => [pole, strength]),
});

test("v4.1 문항은 별도 판의 68개 원본이고 v4.0의 배치와 응답 부호를 보존한다", () => {
  assert.equal(v40.version, "v4.0-tendency");
  assert.equal(v41.version, "v4.1-depth");
  assert.equal(v41.placeholder, false);
  assert.equal(v41.items.length, 68);
  assert.deepEqual(v41.items.map(arrangement), v40.items.map(arrangement));
  const changed = v41.items.filter((item, index) => JSON.stringify(item) !== JSON.stringify(v40.items[index]));
  assert.equal(changed.length, 67);
  assert.deepEqual(v41.items.filter((item, index) => JSON.stringify(item) === JSON.stringify(v40.items[index])).map(({ id }) => id), ["support.vent.4"]);
});

test("v4.1 문안은 전체 은행 정적 검사에서 오류와 경고가 없다", () => {
  // 공통 검사기의 버전 고정만 검사 입력에서 치환한다. 실제 원본은 v4.1로 유지한다.
  const report = lintBank({ ...v41, version: v40.version });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test("v4.1 생성 파일은 고정 원본과 같은 해시와 내용을 담는다", () => {
  const expected = generateBankModule(v41, {
    sourceLabel: "docs/wedding-code/2026-10-04_v41_items.json",
    bankPrefix: "V41",
    versionSymbol: "WEDDING_CODE_V41_VERSION",
    versionModule: "@/constants/weddingCodeV41",
    generatorLabel: "scripts/build-wedding-code-v41-bank.mjs",
  });
  assert.equal(read("apps/web/src/constants/weddingCodeV41Bank.ts"), expected);
  assert.match(expected, /export const V41_BANK_SOURCE_SHA256 = "[0-9a-f]{64}";/);
});

test("v4.1 회상 보기는 과거 행동 한 가지씩만 묻는다", () => {
  const recalls = v41.items.filter(({ fmt }) => fmt === "recall");
  assert.equal(recalls.length, 8);
  for (const item of recalls) {
    assert.equal(item.options.length, 4, item.id);
    for (const option of item.options) {
      assert.equal((option.text.match(/요\./g) ?? []).length, 1, `${item.id}: ${option.text}`);
      assert.doesNotMatch(option.text, /후회|그사이|하지만|다만|느꼈|표정이|마음이 풀|그 뒤로/, `${item.id}: ${option.text}`);
    }
  }
});
