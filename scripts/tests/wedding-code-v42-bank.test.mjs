import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { generateBankModule } from "../build-wedding-code-v40-bank.mjs";
import { lintBank } from "../lib/wedding-code-v40-bank-lint.mjs";

const root = join(import.meta.dirname, "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const v41 = JSON.parse(read("docs/wedding-code/2026-10-04_v41_items.json"));
const v42 = JSON.parse(read("docs/wedding-code/2026-10-06_v42_items.json"));
const arrangement = (item) => ({
  id: item.id, axis: item.axis, facet: item.facet, section: item.section, screen: item.screen,
  fmt: item.fmt, kind: item.kind, key: item.key, highPole: item.highPole,
  poles: (item.cards ?? item.options ?? item.entries ?? []).map(({ pole, strength }) => [pole, strength]),
});

test("v4.2의 새 원문은 68개 모두 검수됐고 기존 답의 형식과 방향은 바꾸지 않는다", () => {
  assert.equal(v42.version, "v4.2-depth");
  assert.equal(v42.placeholder, false);
  assert.equal(v42.items.length, 68);
  assert.deepEqual(v42.items.map(arrangement), v41.items.map(arrangement));
  assert.equal(v42.items.filter((item, index) => JSON.stringify(item) !== JSON.stringify(v41.items[index])).length, 68);
  const revisions = ["money_process", "scope_support", "self"].flatMap((part) => JSON.parse(read(`docs/wedding-code/2026-10-06_v42_${part}_revisions.json`)).items);
  const byId = new Map(revisions.map((item) => [item.id, item]));
  assert.equal(byId.size, 68);
  assert.deepEqual(v42.items, v41.items.map((item) => byId.get(item.id)));
});

test("새판 전체의 문안·배치·극 균형에 오류나 경고가 없다", () => {
  const report = lintBank({ ...v42, version: "v4.0-tendency" });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test("런타임 원문은 작성 gate를 거친 새판 원본과 같다", () => {
  const expected = generateBankModule(v42, {
    sourceLabel: "docs/wedding-code/2026-10-06_v42_items.json", bankPrefix: "V42",
    versionSymbol: "WEDDING_CODE_V42_VERSION", versionModule: "@/constants/weddingCodeV42",
    generatorLabel: "scripts/build-wedding-code-v42-bank.mjs",
  });
  assert.equal(read("apps/web/src/constants/weddingCodeV42Bank.ts"), expected);
  assert.match(read("docs/wedding-code/2026-10-06_v42_item_copy_gate.md"), /사람 검증 및 공개 배포 승인 아님/);
});

test("기존 v4.1 런타임 원문은 새판을 만들면서 교체되지 않았다", () => {
  const expected = generateBankModule(v41, {
    sourceLabel: "docs/wedding-code/2026-10-04_v41_items.json", bankPrefix: "V41",
    versionSymbol: "WEDDING_CODE_V41_VERSION", versionModule: "@/constants/weddingCodeV41",
    generatorLabel: "scripts/build-wedding-code-v41-bank.mjs",
  });
  assert.equal(read("apps/web/src/constants/weddingCodeV41Bank.ts"), expected);
});

test("8개 회상 질문은 결혼 준비가 아닌 최근 실제 일상 경험도 답할 수 있다", () => {
  const recalls = v42.items.filter((item) => item.fmt === "recall");
  assert.equal(recalls.length, 8);
  for (const item of recalls) {
    assert.match(item.stem, /최근|떠올려/);
    assert.doesNotMatch(item.stem, /최근 결혼|최근 준비/);
    assert.equal(item.options.length, 4);
  }
});
