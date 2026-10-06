import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { generateBankModule } from "../build-wedding-code-v40-bank.mjs";
import { lintBank } from "../lib/wedding-code-v40-bank-lint.mjs";

const root = join(import.meta.dirname, "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const v41 = JSON.parse(read("docs/wedding-code/2026-10-04_v41_items.json"));
const v42 = JSON.parse(read("docs/wedding-code/2026-10-06_v42_items.json"));
const v43 = JSON.parse(read("docs/wedding-code/2026-10-06_v43_items.json"));
const v43ChangedIds = [
  "money.moment.1", "money.worth.2", "money.check.2", "money.limit.3", "money.check.3",
  "process.search.1", "process.detail.1", "process.owner.2", "process.detail.2", "process.report.2",
  "process.detail.3", "process.search.3", "process.owner.3", "process.owner.4", "process.search.4",
  "scope.circle.1", "scope.final.2", "scope.timing.2", "scope.circle.2", "scope.timing.3",
  "scope.final.3", "scope.final.4", "scope.circle.4", "scope.form.4",
  "support.give.1", "support.recover.1", "support.give.2", "support.fight.2", "support.recover.2",
  "support.recover.3", "support.vent.4", "support.fight.4", "self.support",
].sort();
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
  assert.equal(v43.version, "v4.3-depth");
  assert.equal(v43.placeholder, false);
  assert.equal(v43.items.length, 68);
  assert.deepEqual(v43.items.map(arrangement), v42.items.map(arrangement));
  const changed = v43.items.filter((item, index) => JSON.stringify(item) !== JSON.stringify(v42.items[index]));
  assert.deepEqual(changed.map((item) => item.id).sort(), v43ChangedIds);
});

test("새판 전체의 문안·배치·극 균형에 오류나 경고가 없다", () => {
  const report = lintBank({ ...v42, version: "v4.0-tendency" });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  const revisedReport = lintBank({ ...v43, version: "v4.0-tendency" });
  assert.deepEqual(revisedReport.errors, []);
  assert.deepEqual(revisedReport.warnings, []);
});

test("런타임 원문은 작성 gate를 거친 새판 원본과 같다", () => {
  const expected = generateBankModule(v42, {
    sourceLabel: "docs/wedding-code/2026-10-06_v42_items.json", bankPrefix: "V42",
    versionSymbol: "WEDDING_CODE_V42_VERSION", versionModule: "@/constants/weddingCodeV42",
    generatorLabel: "scripts/build-wedding-code-v42-bank.mjs",
  });
  assert.equal(read("apps/web/src/constants/weddingCodeV42Bank.ts"), expected);
  assert.match(read("docs/wedding-code/2026-10-06_v42_item_copy_gate.md"), /사람 검증 및 공개 배포 승인 아님/);
  const revisedExpected = generateBankModule(v43, {
    sourceLabel: "docs/wedding-code/2026-10-06_v43_items.json", bankPrefix: "V43",
    versionSymbol: "WEDDING_CODE_V43_VERSION", versionModule: "@/constants/weddingCodeV43",
    generatorLabel: "scripts/build-wedding-code-v43-bank.mjs",
  });
  assert.equal(read("apps/web/src/constants/weddingCodeV43Bank.ts"), revisedExpected);
  assert.match(read("docs/wedding-code/2026-10-06_v43_meeting_item_audit.md"), /운영 배포 영수증 아님/);
});

test("기존 v4.1 런타임 원문은 새판을 만들면서 교체되지 않았다", () => {
  const expected = generateBankModule(v41, {
    sourceLabel: "docs/wedding-code/2026-10-04_v41_items.json", bankPrefix: "V41",
    versionSymbol: "WEDDING_CODE_V41_VERSION", versionModule: "@/constants/weddingCodeV41",
    generatorLabel: "scripts/build-wedding-code-v41-bank.mjs",
  });
  assert.equal(read("apps/web/src/constants/weddingCodeV41Bank.ts"), expected);
  assert.equal(createHash("sha256").update(read("docs/wedding-code/2026-10-06_v42_items.json")).digest("hex"), "a48c3c02847959ffdb009edb86c30e13cdeb6fe3ef40ad9e5ccea4bea3da6ca0");
  assert.equal(read("apps/web/src/constants/weddingCodeV42Bank.ts"), generateBankModule(v42, {
    sourceLabel: "docs/wedding-code/2026-10-06_v42_items.json", bankPrefix: "V42",
    versionSymbol: "WEDDING_CODE_V42_VERSION", versionModule: "@/constants/weddingCodeV42",
    generatorLabel: "scripts/build-wedding-code-v42-bank.mjs",
  }));
});

test("8개 회상 질문은 결혼 준비가 아닌 최근 실제 일상 경험도 답할 수 있다", () => {
  const recalls = v42.items.filter((item) => item.fmt === "recall");
  assert.equal(recalls.length, 8);
  for (const item of recalls) {
    assert.match(item.stem, /최근|떠올려/);
    assert.doesNotMatch(item.stem, /최근 결혼|최근 준비/);
    assert.equal(item.options.length, 4);
  }
  const revisedRecalls = v43.items.filter((item) => item.fmt === "recall");
  assert.equal(revisedRecalls.length, 8);
  for (const item of revisedRecalls) {
    assert.match(item.stem, /최근|떠올려/);
    assert.doesNotMatch(item.stem, /최근 결혼|최근 준비/);
    assert.equal(item.options.length, 4);
  }
});
