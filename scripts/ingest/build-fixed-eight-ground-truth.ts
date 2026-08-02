import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { readJsonFile, sha256File, writeJsonFile } from "./io.js";

const BASE_SHA256 = "17a927f52d51774c9f3e149a3dba6fb3acfa0c5f79587d010089a00ac1988d75";
const LEGACY_OVERLAY_SHA256 = "f2537c397b6d12a5965eceb35fea7a728e0a7962e979cf7eb963c9a1b9183ef6";
const CREATED_AT = "2026-07-20T00:00:00.000Z";

const IDS = {
  direct: "7f21b5176a0063d2746ce81345d347d4e2218081c19c540be722e9505eecb587",
  blanc: "0a7e35c83b56423e27308887c63be675f2d24123941d53b620d315c9f7fec89c",
  kate: "fb24bede2e46a3ee18a1426f7f6c0d4a82b0b069a17bee736339f89a4d0d2f00",
  eileen: "467af65b41d314bbce9fddd38bff84961d33700d5e7da17f04e337afaa212ead",
  floating: "0aea5091993fbb729d4c746d0e31ecb26ef40c7c44030349c2e255f2a0d4ee38",
  noble: "9cd5e12d7941a7175b2388164081bb1c3886ea4b2badee4c80fff0ea18f9831c",
  mattimo: "cb0858314e9ea894d1cb90fb213cdda0d8aa00b2b6cd5b7839b5b96b07480e29",
  may: "9bd413d45460d6f9e754a39d57592b25c1dc5adec8ea86bba0e432c83dce16a7",
} as const;

interface MoneyOccurrence {
  raw: string;
  krw: number;
  line_context: string;
  source_locator: string;
}

interface InventoryUnit {
  unit_id: string;
  candidates: MoneyOccurrence[];
}

interface Inventory {
  units: InventoryUnit[];
}

interface ManifestUnit {
  unit_id: string;
  conversion?: { text_artifacts: string[] };
}

interface Manifest {
  units: ManifestUnit[];
}

interface OverlayUnit {
  unit_id: string;
  readable_occurrences: MoneyOccurrence[];
  unreadable_cells: Array<{
    source_locator: string;
    visible_amounts_krw: number[];
    estimated_content: string;
    reason: string;
  }>;
  expectations: Record<string, unknown>;
}

interface Overlay {
  schema_version: 1;
  created_at: string;
  units: OverlayUnit[];
}

type StableReference = {
  unit_id: string;
  source_locator: string;
  raw: string;
  ordinal: number;
};

type Decision = {
  decision_id: string;
  action: "exclude_non_money" | "merge_components" | "add_missing" | "quarantine_source_anomaly";
  verification: "verified" | "human_required";
  references: StableReference[];
  result?: MoneyOccurrence & { unit_id: string; ordinal: number };
  reason: string;
  reviewed_by?: string;
  reviewed_at?: string;
};

async function main(): Promise<void> {
const stateDir = path.resolve(process.argv[2] ?? path.join(
  process.cwd(),
  "scripts",
  "ingest",
  ".state",
  "reprocess-20260719-poppler5",
));
const basePath = path.join(stateDir, "manual-pilot-source-money-inventory.json");
const legacyOverlayPath = path.join(stateDir, "fixed-eight-ground-truth-overlay.json");
const correctedOverlayPath = path.join(stateDir, "fixed-eight-ground-truth-overlay-v2.json");
const adjudicationPath = path.join(stateDir, "fixed-eight-ground-truth-adjudication-v1.json");
const buildReportPath = path.join(stateDir, "fixed-eight-ground-truth-build-report.json");

assert.equal((await sha256File(basePath)).sha256, BASE_SHA256, "immutable base GT hash drifted");
assert.equal(
  (await sha256File(legacyOverlayPath)).sha256,
  LEGACY_OVERLAY_SHA256,
  "immutable legacy overlay hash drifted",
);

const inventory = await readJsonFile(basePath) as Inventory;
const manifest = await readJsonFile(path.join(stateDir, "manifest.json")) as Manifest;
const legacyOverlay = await readJsonFile(legacyOverlayPath) as Overlay;
const inventoryById = new Map(inventory.units.map((unit) => [unit.unit_id, unit]));
const manifestById = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));

function unit(unitId: string): InventoryUnit {
  const found = inventoryById.get(unitId);
  assert.ok(found, `inventory unit missing: ${unitId}`);
  return found;
}

function reference(unitId: string, sourceLocator: string, raw: string, ordinal = 1): StableReference {
  const matches = unit(unitId).candidates.filter((candidate) =>
    candidate.source_locator === sourceLocator && candidate.raw === raw
  );
  assert.ok(matches[ordinal - 1], `base occurrence missing: ${unitId}/${sourceLocator}/${raw}#${ordinal}`);
  return { unit_id: unitId, source_locator: sourceLocator, raw, ordinal };
}

const sourceTextByUnit = new Map<string, string>();
async function sourceCellLine(unitId: string, locator: string): Promise<string> {
  let sourceText = sourceTextByUnit.get(unitId);
  if (!sourceText) {
    const manifestUnit = manifestById.get(unitId);
    assert.ok(manifestUnit?.conversion?.text_artifacts.length, `converted text missing: ${unitId}`);
    sourceText = (await Promise.all(
      manifestUnit.conversion.text_artifacts.map((artifact) => readFile(artifact, "utf8")),
    )).join("\n");
    sourceTextByUnit.set(unitId, sourceText);
  }
  const prefix = `${locator}:`;
  const lines = sourceText.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  assert.equal(lines.length, 1, `expected exactly one converted source cell for ${unitId}/${locator}`);
  assert.ok(lines[0] && lines[0].length <= 1_000, `source cell exceeds adjudication evidence limit: ${locator}`);
  return lines[0]!;
}

const decisions: Decision[] = [];
const resultIdentityCounts = new Map<string, number>();
function nextResultOrdinal(unitId: string, locator: string, raw: string): number {
  const key = JSON.stringify([unitId, locator, raw]);
  const existing = resultIdentityCounts.get(key)
    ?? unit(unitId).candidates.filter((candidate) =>
      candidate.source_locator === locator && candidate.raw === raw
    ).length;
  const next = existing + 1;
  resultIdentityCounts.set(key, next);
  return next;
}

function reviewed(decision: Omit<Decision, "reviewed_by" | "reviewed_at">): Decision {
  return {
    ...decision,
    ...(decision.verification === "verified"
      ? { reviewed_by: "Codex source audit", reviewed_at: CREATED_AT }
      : {}),
  };
}

decisions.push(reviewed({
  decision_id: "direct-non-money-counts-times-and-clauses",
  action: "exclude_non_money",
  verification: "verified",
  references: [
    reference(IDS.direct, "스튜디오!D31", "00~15"),
    reference(IDS.direct, "스튜디오!D31", "10"),
    reference(IDS.direct, "스튜디오!D32", "1"),
    reference(IDS.direct, "스튜디오!D35", "1"),
    reference(IDS.direct, "스튜디오!D40", "1"),
    reference(IDS.direct, "스튜디오!A58", "2"),
    ...["1", "2", "3", "4", "5", "6"].map((raw) =>
      reference(IDS.direct, "스튜디오!A59", raw)
    ),
    reference(IDS.direct, "메이크업!A21", "187"),
  ],
  reason: "원문 대조 결과 시간, 선택 수량, 조항 번호, 업체명 일부이며 금액이 아니다.",
}));

async function addCompoundMerges(unitId: string, locator: string, count: number): Promise<void> {
  const lineContext = unit(unitId).candidates.find((candidate) => candidate.source_locator === locator)?.line_context;
  assert.ok(lineContext, `compound source context missing: ${unitId}/${locator}`);
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    decisions.push(reviewed({
      decision_id: `merge-${unitId.slice(0, 8)}-${locator.replace(/[^A-Za-z0-9가-힣]+/gu, "-")}-${ordinal}`,
      action: "merge_components",
      verification: "verified",
      references: [
        reference(unitId, locator, "5만", ordinal),
        reference(unitId, locator, "5천원", ordinal),
      ],
      result: {
        unit_id: unitId,
        raw: "5만5천원",
        krw: 55_000,
        line_context: lineContext,
        source_locator: locator,
        ordinal: nextResultOrdinal(unitId, locator, "5만5천원"),
      },
      reason: "한 원문 토큰 5만5천원을 5만원과 5천원으로 이중 분리한 기존 채점표를 55,000원 1건으로 병합한다.",
    }));
  }
}

await addCompoundMerges(IDS.blanc, "드레스!G6", 2);
for (const locator of ["드레스!K71", "드레스!K95", "드레스!K125", "드레스!K137"]) {
  await addCompoundMerges(IDS.kate, locator, 2);
}
await addCompoundMerges(IDS.kate, "계약서!B18", 1);

async function addMissing(
  decisionId: string,
  unitId: string,
  locator: string,
  raw: string,
  krw: number,
  verification: "verified" | "human_required" = "verified",
): Promise<void> {
  const lineContext = await sourceCellLine(unitId, locator);
  assert.ok(lineContext.includes(raw), `new occurrence raw text absent from source cell: ${locator}/${raw}`);
  decisions.push(reviewed({
    decision_id: decisionId,
    action: "add_missing",
    verification,
    references: [],
    result: {
      unit_id: unitId,
      raw,
      krw,
      line_context: lineContext,
      source_locator: locator,
      ordinal: nextResultOrdinal(unitId, locator, raw),
    },
    reason: verification === "verified"
      ? "변환된 원본 셀 전수 대조에서 확인된 기존 채점표 누락 금액이다."
      : "숫자는 보이지만 적용 단위 선언이 없어 사람이 원본 의미를 확정해야 한다.",
  }));
}

await addMissing("blanc-makeup-d6-165k", IDS.blanc, "메이크업!D6", "16.5만원", 165_000);
await addMissing("blanc-makeup-d6-110k", IDS.blanc, "메이크업!D6", "11만원", 110_000);

const repeatedKateCells: Array<[string, Array<[string, number]>]> = [
  ["드레스!K11", [
    ["5만5천원", 55_000], ["11만원", 110_000], ["22만원", 220_000],
    ["55,000원", 55_000], ["33만원", 330_000], ["55만원", 550_000], ["5만5천원", 55_000],
  ]],
  ["드레스!K17", [
    ["5만5천원", 55_000], ["11만원", 110_000], ["22만원", 220_000],
    ["55,000원", 55_000], ["33만원", 330_000], ["55만원", 550_000], ["5만5천원", 55_000],
  ]],
  ["드레스!K29", [
    ["22만원", 220_000], ["5.5만원", 55_000], ["11만원", 110_000],
    ["44만원", 440_000], ["44만원", 440_000], ["-11만원", 110_000],
    ["176만원", 1_760_000], ["165만원", 1_650_000],
  ]],
];
for (const [locator, occurrences] of repeatedKateCells) {
  for (const [index, [raw, krw]] of occurrences.entries()) {
    await addMissing(
      `kate-${locator.replace(/[^A-Za-z0-9가-힣]+/gu, "-")}-${index + 1}`,
      IDS.kate,
      locator,
      raw,
      krw,
    );
  }
}
await addMissing("kate-terms-a35-deposit", IDS.kate, "약관!A35", "50만원", 500_000);
await addMissing("kate-snapshot-d90-unit-unknown", IDS.kate, "본식 스냅!D90", "10", 100_000, "human_required");

for (const [decisionId, unitId, refs, reason] of [
  [
    "direct-source-typos",
    IDS.direct,
    [reference(IDS.direct, "스튜디오!E30", "5.5천원"), reference(IDS.direct, "스튜디오!E40", "16,500")],
    "원문 표기와 시트 단위/상품 문맥이 충돌하여 금액을 자동 확정할 수 없다.",
  ],
  [
    "blanc-source-typos",
    IDS.blanc,
    [reference(IDS.blanc, "메이크업!B16", "120원"), reference(IDS.blanc, "메이크업!B18", "110원")],
    "원문은 원 단위로 쓰였지만 주변 가격 문맥상 만원 오기 가능성이 있어 사람이 확인해야 한다.",
  ],
  [
    "kate-source-typos",
    IDS.kate,
    [reference(IDS.kate, "드레스!B89", "382,5만원"), reference(IDS.kate, "메이크업!F23", "330.000원")],
    "쉼표/마침표 표기가 비표준이고 문맥상 다른 금액일 가능성이 있어 사람이 확인해야 한다.",
  ],
] as const) {
  decisions.push({
    decision_id: decisionId,
    action: "quarantine_source_anomaly",
    verification: "human_required",
    references: [...refs],
    reason,
  });
}

function imageOccurrence(raw: string, krw: number, lineContext: string, locator: string): MoneyOccurrence {
  return { raw, krw, line_context: lineContext, source_locator: locator };
}

const mayReadable: MoneyOccurrence[] = [
  imageOccurrence("600,000원", 600_000, "액자촬영(H10) 600,000원", "image:1/리허설촬영구성/액자촬영"),
  imageOccurrence("1,100,000원", 1_100_000, "세미 10P(H10) 1,100,000원", "image:1/리허설촬영구성/세미10P"),
  imageOccurrence("1,600,000원", 1_600_000, "웨딩 20P(H15) 1,600,000원", "image:1/리허설촬영구성/웨딩20P"),
  imageOccurrence("2,100,000원", 2_100_000, "웨딩 30P(H15) 2,100,000원", "image:1/리허설촬영구성/웨딩30P"),
  imageOccurrence("15만원", 150_000, "선택사항 메이킹필름 추가 15만원", "image:1/리허설촬영구성/선택사항/메이킹필름"),
  imageOccurrence("30만원", 300_000, "선택사항 기본앨범 추가 30만원", "image:1/리허설촬영구성/선택사항/기본앨범"),
  imageOccurrence("16.5만원", 165_000, "드레스 추가시 1벌당 16.5만원", "image:1/리허설촬영구성/드레스추가"),
  imageOccurrence("3.3만원", 33_000, "개인의상 추가시 1벌당 3.3만원", "image:1/리허설촬영구성/개인의상"),
  imageOccurrence("5.5만원", 55_000, "셀렉드레스 포함 의상시 1벌당 5.5만원", "image:1/리허설촬영구성/콘셉트의상"),
  imageOccurrence("각 10만원", 100_000, "야간·로드촬영 추가시 각 10만원", "image:1/리허설촬영구성/야간·로드촬영"),
  imageOccurrence("330,000원", 330_000, "원본과 수정본 330,000원", "image:1/리허설촬영구성/원본수정본"),
  imageOccurrence("1P당 3.3만원", 33_000, "사진 추가 1P당 3.3만원", "image:1/리허설촬영구성/사진추가"),
  imageOccurrence("1컷당 2.2만원", 22_000, "무료 수정 이후 1컷당 2.2만원", "image:1/리허설촬영구성/추가수정"),
  imageOccurrence("15만원", 150_000, "액자 사양 변경 추가금 15만원", "image:1/리허설촬영구성/액자변경/15"),
  imageOccurrence("20만원", 200_000, "캔버스 38 사양 변경 추가금 20만원", "image:1/리허설촬영구성/액자변경/캔버스38"),
  imageOccurrence("20만원", 200_000, "20×24 액자 변경 추가금 20만원", "image:1/리허설촬영구성/액자변경/20x24"),
  imageOccurrence("25만원", 250_000, "24×32 액자 변경 추가금 25만원", "image:1/리허설촬영구성/액자변경/24x32"),
  imageOccurrence("5.5만원", 55_000, "아크릴 액자 변경시 5.5만원 추가", "image:1/리허설촬영구성/액자변경/아크릴"),
  imageOccurrence("16.5만원", 165_000, "메이크업 추가비용 16.5만원", "image:1/리허설촬영구성/메이크업추가/16.5"),
  imageOccurrence("27.5만원", 275_000, "메이크업 추가비용 27.5만원", "image:1/리허설촬영구성/메이크업추가/27.5"),
  imageOccurrence("35만원", 350_000, "메이크업 추가비용 35만원", "image:1/리허설촬영구성/메이크업추가/35"),
  imageOccurrence("3.3만원", 33_000, "이른 시간 메이크업 추가비용 3.3만원", "image:1/리허설촬영구성/메이크업추가/이른시간3.3"),
  imageOccurrence("5.5만원", 55_000, "오전 6시 메이크업 추가비용 5.5만원", "image:1/리허설촬영구성/메이크업추가/오전6시"),
  imageOccurrence("100,000원", 100_000, "헬퍼비 별도 100,000원~150,000원", "image:1/리허설촬영구성/헬퍼비최저"),
  imageOccurrence("150,000원", 150_000, "헬퍼비 별도 100,000원~150,000원", "image:1/리허설촬영구성/헬퍼비최고"),
  imageOccurrence("5만원", 50_000, "야간·로드촬영시 헬퍼비 5만원 추가", "image:1/리허설촬영구성/헬퍼추가"),
  imageOccurrence("1,600,000~", 1_600_000, "웨딩 구성 1,600,000~", "image:1/웨딩구성"),
  imageOccurrence("110만원", 1_100_000, "수입 드레스와 국내 명품 드레스 110만원", "image:1/웨딩구성/드레스"),
  imageOccurrence("55만원", 550_000, "신랑 신부 본식 헤어 메이크업 55만원", "image:1/웨딩구성/헤어메이크업"),
  imageOccurrence("22만원", 220_000, "계절꽃 부케 제작 22만원", "image:1/웨딩구성/부케"),
  imageOccurrence("8.8만원", 88_000, "커스텀 부케 제작 추가 8.8만원", "image:1/웨딩구성/부케추가"),
  imageOccurrence("0", 0, "신상 드레스 추가금액 국내 0~최대 120만원", "image:1/웨딩구성/각주/신상드레스최저"),
  imageOccurrence("120만원", 1_200_000, "신상 드레스 추가금액 국내 0~최대 120만원", "image:1/웨딩구성/각주/신상드레스최고"),
  imageOccurrence("11만원", 110_000, "드레스 관련 추가품목 11만원", "image:1/웨딩구성/각주/드레스추가품목"),
  imageOccurrence("5.5만원", 55_000, "드레스 관련 추가품목 5.5만원", "image:1/웨딩구성/각주/드레스소품"),
  imageOccurrence("3.3만원", 33_000, "수입 드레스 추가금 3.3만원부터", "image:1/웨딩구성/각주/수입드레스"),
  imageOccurrence("165,000원", 165_000, "추가 헤어 메이크업 여자 165,000원", "image:1/웨딩구성/각주/추가헤어여자"),
  imageOccurrence("55,000원", 55_000, "추가 헤어 메이크업 남자 55,000원", "image:1/웨딩구성/각주/추가헤어남자"),
  imageOccurrence("275,000원", 275_000, "추가 헤어 메이크업 여자·남자 동시 275,000원", "image:1/웨딩구성/각주/추가헤어동시여자"),
  imageOccurrence("88,000원", 88_000, "추가 헤어 메이크업 여자·남자 동시 88,000원", "image:1/웨딩구성/각주/추가헤어동시남자"),
  imageOccurrence("22만원", 220_000, "출장 메이크업 추가 22만원", "image:1/웨딩구성/각주/출장메이크업"),
  imageOccurrence("15만원", 150_000, "출장 관련 추가비 15만원", "image:1/웨딩구성/각주/출장추가비"),
  imageOccurrence("600,000원", 600_000, "본식 원판 600,000원", "image:1/본식원판스냅/원판"),
  imageOccurrence("800,000원", 800_000, "본식 스냅 800,000원", "image:1/본식원판스냅/스냅"),
  imageOccurrence("1,300,000원", 1_300_000, "원판과 스냅 1,300,000원", "image:1/본식원판스냅/원판+스냅"),
];
assert.equal(mayReadable.length, 45, "May Bride strict readable occurrence count drifted");

const overlayUnits = legacyOverlay.units.map((overlayUnit) => overlayUnit.unit_id === IDS.may
  ? {
      ...overlayUnit,
      readable_occurrences: mayReadable,
      unreadable_cells: [
        {
          source_locator: "image:1/리허설촬영구성/메이크업추가/기본추가",
          visible_amounts_krw: [33_000],
          estimated_content: "메이크업 기본 추가로 보이는 '3.3' 표기",
          reason: "해당 숫자에 원/만원 단위가 직접 또는 상속 가능한 형태로 인쇄되어 있지 않아 금액을 확정할 수 없음",
        },
        {
          source_locator: "image:1/리허설촬영구성/메이크업추가/헤어피스",
          visible_amounts_krw: [66_000],
          estimated_content: "헤어피스 대여 또는 반납 조건으로 보이는 '6.6' 표기",
          reason: "해당 숫자에 원/만원 단위가 직접 또는 상속 가능한 형태로 인쇄되어 있지 않아 금액을 확정할 수 없음",
        },
      ],
    }
  : overlayUnit);
assert.equal(overlayUnits.length, 8, "fixed-eight overlay must contain exactly eight units");
assert.ok(overlayUnits.some((unit) => unit.unit_id === IDS.eileen && unit.readable_occurrences.length === 22));
assert.ok(overlayUnits.some((unit) => unit.unit_id === IDS.may && unit.readable_occurrences.length === 45));

const correctedOverlay: Overlay = {
  schema_version: 1,
  created_at: CREATED_AT,
  units: overlayUnits,
};
await writeJsonFile(correctedOverlayPath, correctedOverlay);
await writeJsonFile(adjudicationPath, {
  schema_version: 1,
  created_at: CREATED_AT,
  base_ground_truth_sha256: BASE_SHA256,
  decisions,
});

const baseCount = inventory.units.reduce((sum, item) => sum + item.candidates.length, 0);
const verifiedRemoved = decisions
  .filter((decision) => decision.verification === "verified")
  .reduce((sum, decision) => sum + (
    decision.action === "exclude_non_money" || decision.action === "merge_components"
      ? decision.references.length
      : 0
  ), 0);
const allQuarantined = decisions
  .filter((decision) => decision.action === "quarantine_source_anomaly")
  .reduce((sum, decision) => sum + decision.references.length, 0);
const verifiedAdded = decisions.filter((decision) =>
  decision.verification === "verified" && Boolean(decision.result)
).length;
const effectiveTextCount = baseCount - verifiedRemoved - allQuarantined + verifiedAdded;
assert.equal(baseCount, 2_342);
assert.equal(verifiedRemoved, 35);
assert.equal(allQuarantined, 6);
assert.equal(verifiedAdded, 36);
assert.equal(effectiveTextCount, 2_337);

const correctedOverlayHash = await sha256File(correctedOverlayPath);
const adjudicationHash = await sha256File(adjudicationPath);
const report = {
  schema_version: 1,
  generated_at: CREATED_AT,
  immutable_inputs: {
    base_ground_truth: { path: basePath, sha256: BASE_SHA256, occurrences: baseCount },
    legacy_overlay: { path: legacyOverlayPath, sha256: LEGACY_OVERLAY_SHA256 },
  },
  outputs: {
    corrected_overlay: {
      path: correctedOverlayPath,
      sha256: correctedOverlayHash.sha256,
      eileen_readable_occurrences: 22,
      may_readable_occurrences: 45,
      may_human_required_occurrences: 2,
    },
    adjudication: {
      path: adjudicationPath,
      sha256: adjudicationHash.sha256,
      decisions: decisions.length,
      verified_removed_occurrences: verifiedRemoved,
      verified_added_occurrences: verifiedAdded,
      human_required_quarantined_occurrences: allQuarantined + 1,
    },
  },
  gate_counts: {
    effective_text_occurrences: effectiveTextCount,
    image_readable_occurrences: 67,
    fixed_eight_readable_occurrences: effectiveTextCount + 67,
  },
};
assert.equal(report.gate_counts.fixed_eight_readable_occurrences, 2_404);
await writeJsonFile(buildReportPath, report);
process.stdout.write(`${JSON.stringify({
  status: "fixed_eight_ground_truth_built",
  schema_version: report.schema_version,
  output_count: Object.keys(report.outputs).length,
  adjudication_decisions: report.outputs.adjudication.decisions,
  gate_counts: report.gate_counts,
}, null, 2)}\n`);
}

void main().catch(() => {
  process.stderr.write("FIXED_EIGHT_GROUND_TRUTH_BUILD_BLOCKED [BUILD_FAILED]\n");
  process.exitCode = 1;
});
