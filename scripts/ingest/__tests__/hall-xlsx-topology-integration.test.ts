import assert from "node:assert/strict";
import test from "node:test";

import { decodeEvidenceQuote } from "../merge-evidence.js";
import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import { findCoverageGaps } from "../validate.js";

const SOURCE_FILE_ID = "a".repeat(64);

function extract(canonicalText: string) {
  return extractDisclosureFromLocalEvidence({
    canonicalName: "합성 예식장",
    regionCode: "synthetic",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: canonicalText }],
  });
}

test("canonical XLSX exact-hall topology becomes one review-only option with occurrence and condition evidence", () => {
  const result = extract([
    "## 시트: 가격표",
    "가격표!A1: ① 가격 / 단위 : 원",
    "가격표!A2: 2026년 7월~12월",
    "가격표!A3: 예식홀명",
    "가격표!B3: 항목",
    "가격표!C3: 선택품목 가격",
    "가격표!A5: 솔빛홀",
    "가격표!B5: 기본 패키지",
    "가격표!C5: 330,000",
  ].join("\n"));

  const hall = result.halls.find(({ hall_name: hallName }) => hallName === "솔빛홀");
  assert.ok(hall);
  assert.equal(hall.needs_review, true);
  assert.equal(hall.meal_price_min_krw, null);
  assert.equal(hall.venue_fee_min_krw, null);
  assert.equal(hall.decoration_fee_min_krw, null);
  assert.equal(hall.options.length, 1);
  assert.equal(hall.options[0]?.price_min_krw, 330_000);
  assert.match(hall.options[0]?.condition ?? "", /2026년 7월~12월/u);

  const ledger = result.money_occurrences.filter(({ amount_krw: amount }) => amount === 330_000);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.needs_review, true);
  const decoded = decodeEvidenceQuote(ledger[0]!.source_quote);
  assert.equal(decoded.kind, "merged");
  if (decoded.kind !== "merged") return;
  assert.ok(decoded.fragments.some(({ quote }) => quote === "가격표!C5: 330,000"));
  assert.ok(decoded.fragments.some(({ quote }) => quote === "가격표!A2: 2026년 7월~12월"));
});

test("a shared hall group remains three identity-only halls plus one explicit coverage gap", () => {
  const canonicalText = [
    "## 시트: 안내",
    "안내!A1: 공시자료",
    "안내!G2: 단위(원.VAT포함)",
    "안내!A3: 예식홀명",
    "안내!B3: 대관료",
    "안내!A5: 솔홀 / 달홀 / 별홀",
    "안내!B5: 220,000",
  ].join("\n");
  const result = extract(canonicalText);

  assert.deepEqual(
    result.halls.map(({ hall_name: hallName }) => hallName),
    ["솔홀", "달홀", "별홀"],
  );
  assert.ok(result.halls.every((hall) => (
    hall.options.length === 0
    && hall.meal_price_min_krw === null
    && hall.venue_fee_min_krw === null
    && hall.decoration_fee_min_krw === null
  )));
  const ledger = result.money_occurrences.filter(({ amount_krw: amount }) => amount === 220_000);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.kind, "other_money");
  assert.deepEqual(
    findCoverageGaps(canonicalText, result, { includeAuditLedger: false }),
    [{
      raw: "220,000",
      krw: 220_000,
      line_context: "안내!B5: 220,000",
      source_locator: "안내!B5",
    }],
  );
});
