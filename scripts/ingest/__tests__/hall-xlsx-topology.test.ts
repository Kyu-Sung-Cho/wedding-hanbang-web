import assert from "node:assert/strict";
import test from "node:test";

import { extractHallXlsxTopology } from "../hall-xlsx-topology.js";

function extract(canonicalText: string, sourceFileId = "source-a") {
  return extractHallXlsxTopology({ canonicalText, sourceFileId });
}

test("peer hall headers close the previous block and coalesce one hall without losing conditions or locators", () => {
  const result = extract([
    "## 시트: 가격",
    "가격!A1: ① 가격(VAT 포함)",
    "가격!G2: 단위(원.VAT포함)",
    "가격!A3: 2026년 7월~12월",
    "가격!A4: 예식홀명",
    "가격!B4: 대관+장식",
    "가격!C4: 식대",
    "가격!D4: 지불보증인원",
    "가격!A5: 그랜드홀",
    "가격!B5: 5,200,000",
    "가격!C5: 65,000",
    "가격!D5: 250명",
    "가격!A8: 2027년 1월~6월",
    "가격!A9: 예식홀명",
    "가격!B9: 대관+장식",
    "가격!C9: 식대",
    "가격!A10: 그랜드홀",
    "가격!B10: 4,200,000",
    "가격!C10: 60,000",
  ].join("\n"));

  assert.equal(result.hall_components.length, 1);
  assert.deepEqual(result.hall_components[0]?.source_locators, ["가격!A5", "가격!A10"]);
  assert.equal(result.money_occurrences.length, 4);
  assert.ok(result.money_occurrences.every((entry) => entry.hall_ids.length === 1));
  assert.ok(result.money_occurrences.every((entry) => entry.unit_source_locator === "가격!G2"));
  assert.deepEqual(
    new Set(result.conditions.map(({ text }) => text)),
    new Set(["2026년 7월~12월", "2027년 1월~6월"]),
  );
  assert.ok(result.money_occurrences.every(({ raw_text }) => raw_text !== "250"));
  assert.ok(result.review_notices.some(({ code }) => code === "repeated_hall_coalesced"));
});

test("a companion price sheet stays review-only and never becomes a hall aggregate", () => {
  const result = extract([
    "## 시트: 홀가격 정보",
    "홀가격 정보!A1: ① 가격(VAT 포함)",
    "홀가격 정보!A3: 예식홀명",
    "홀가격 정보!B3: 식대",
    "홀가격 정보!A5: 더펄홀",
    "홀가격 정보!B5: 45,000원",
    "## 시트: 패키지",
    "패키지!A1: ITEM(항목)",
    "패키지!B1: PRICE(가격)",
    "패키지!A2: 촬영 패키지",
    "패키지!B2: 2,400,000원",
    "패키지!A3: 야간 추가",
    "패키지!B3: 330,000원",
    "패키지!A4: 유아(5~7세)",
    "패키지!B4: 10,000원",
  ].join("\n"));

  const companion = result.money_occurrences.filter(
    ({ relation_kind }) => relation_kind === "companion_sheet",
  );
  assert.equal(companion.length, 3);
  assert.ok(companion.every(({ hall_ids }) => hall_ids.length === 0));
  assert.ok(companion.every(({ needs_review }) => needs_review));
  assert.ok(result.review_notices.some(({ code }) => code === "companion_sheet_review"));
});

test("mode-bound annex rows inherit an exact vertical parent and use same-row descriptions", () => {
  const result = extract([
    "## 시트: 기본",
    "기본!A1: ① 가격(VAT 포함)",
    "기본!A3: 예식홀명",
    "기본!B3: 식대",
    "기본!A5: 실내홀 (실내예식)",
    "기본!B5: 65,000원",
    "기본!A7: 잔디광장 (야외예식)",
    "기본!B7: 75,000원",
    "## 시트: 야외 Price List",
    "야외 Price List!A23: ITEM / 항목",
    "야외 Price List!D23: PRICE / 가격",
    "야외 Price List!F23: 구성",
    "야외 Price List!A24: 본식 DVD",
    "야외 Price List!D24: 600,000원",
    "야외 Price List!F24: 1인 1캠",
    "야외 Price List!D25: 750,000원",
    "야외 Price List!F25: 1인 2캠",
    "야외 Price List!D26: 1,100,000원",
    "야외 Price List!F26: 2인 촬영",
    "병합 범위 A24:C26 · 좌상단 A24",
  ].join("\n"));

  const annex = result.money_occurrences.filter(({ relation_kind }) => relation_kind === "annex");
  assert.equal(annex.length, 3);
  assert.ok(annex.every(({ hall_ids }) => hall_ids.length === 1));
  const outdoor = result.hall_components.find(({ hall_name }) => /잔디광장/u.test(hall_name));
  assert.ok(outdoor);
  assert.ok(annex.every(({ hall_ids }) => hall_ids[0] === outdoor.hall_id));
  assert.deepEqual(
    result.price_options
      .filter(({ relation_kind }) => relation_kind === "annex")
      .map(({ name }) => name),
    ["본식 DVD · 1인 1캠", "본식 DVD · 1인 2캠", "본식 DVD · 2인 촬영"],
  );
});

test("mode annex binds only one exact mode hall and never fans out across zero or many matches", () => {
  const ambiguous = extract([
    "## 시트: 기본",
    "기본!A1: ① 가격(VAT 포함)",
    "기본!A3: 예식홀명",
    "기본!B3: 식대",
    "기본!A5: 실내홀 (실내예식)",
    "기본!B5: 65,000원",
    "기본!A7: 정원홀 (야외예식)",
    "기본!B7: 75,000원",
    "기본!A9: 잔디홀 (야외예식)",
    "기본!B9: 85,000원",
    "## 시트: 야외 Price List",
    "야외 Price List!A1: ITEM / 항목",
    "야외 Price List!D1: PRICE / 가격",
    "야외 Price List!A2: 본식 DVD",
    "야외 Price List!D2: 600,000원",
  ].join("\n"), "ambiguous-mode");
  const ambiguousAnnex = ambiguous.money_occurrences.find(
    ({ source_locator }) => source_locator === "야외 Price List!D2",
  );
  assert.equal(ambiguousAnnex?.relation_kind, "unbound_review");
  assert.deepEqual(ambiguousAnnex?.hall_ids, []);
  assert.ok(ambiguous.review_notices.some(({ code }) => code === "ambiguous_mode_annex"));

  const missing = extract([
    "## 시트: 기본",
    "기본!A1: ① 가격(VAT 포함)",
    "기본!A3: 예식홀명",
    "기본!B3: 식대",
    "기본!A5: 실내홀 (실내예식)",
    "기본!B5: 65,000원",
    "## 시트: 야외 Price List",
    "야외 Price List!A1: ITEM / 항목",
    "야외 Price List!D1: PRICE / 가격",
    "야외 Price List!A2: 본식 DVD",
    "야외 Price List!D2: 600,000원",
  ].join("\n"), "missing-mode");
  const missingAnnex = missing.money_occurrences.find(
    ({ source_locator }) => source_locator === "야외 Price List!D2",
  );
  assert.equal(missingAnnex?.relation_kind, "unbound_review");
  assert.deepEqual(missingAnnex?.hall_ids, []);
  assert.ok(missing.review_notices.some(({ code }) => code === "ambiguous_mode_annex"));
});

test("merged price headers and row-local explicit won siblings ground bounded bare prices", () => {
  const result = extract([
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!B3: 예식홀명",
    "Sheet1!C3: 식대",
    "Sheet1!D3: 대관료",
    "Sheet1!E3: 선택 옵션",
    "Sheet1!E4: 드레스",
    "Sheet1!F4: 헤어메이크업",
    "Sheet1!B5: 그랜드/아트/아모르",
    "Sheet1!C5: 64,000원/인",
    "Sheet1!D5: 5,400,000원",
    "Sheet1!E5: 1,000,000~",
    "Sheet1!F5: 200,000~",
    "병합 범위 E3:F3 · 좌상단 E3",
  ].join("\n"));

  const bounded = result.money_occurrences.filter(({ bounded_bare }) => bounded_bare);
  assert.deepEqual(bounded.map(({ amount_krw }) => amount_krw), [1_000_000, 200_000]);
  assert.ok(bounded.every(({ unit_source_locator }) => unit_source_locator === "Sheet1!C5"));
  assert.ok(bounded.every(({ relation_kind }) => relation_kind === "shared_hall_group"));
  assert.deepEqual(
    result.hall_components.map(({ hall_name }) => hall_name),
    ["그랜드", "아트", "아모르"],
  );
});

test("malformed money contacts accounts counts dates and percentages fail closed", () => {
  const result = extract([
    "## 시트: 공개자료",
    "공개자료!A1: ① 가격 / 단위 : 원",
    "공개자료!A3: 예식홀명",
    "공개자료!B3: 선택품목 가격",
    "공개자료!A5: 검수홀",
    "공개자료!B5: 330,000",
    "공개자료!B6: 75.000원",
    "공개자료!B7: 5,500,00원",
    "공개자료!B8: 연락처 010,123,4567",
    "공개자료!B9: 계좌 100,503,922,013",
    "공개자료!B10: 보증인원 250,000명",
    "공개자료!B11: 작성일 2026,070,101",
    "공개자료!B12: 할인율 10%",
  ].join("\n"));

  assert.deepEqual(result.money_occurrences.map(({ amount_krw }) => amount_krw), [330_000]);
  assert.ok(result.review_notices.some(({ code }) => code === "malformed_money_quarantined"));
  assert.ok(result.review_notices.some(({ code }) => code === "non_price_number_quarantined"));
});

test("same-row merged-parent and column contexts fence non-price numbers before unitless scanning", () => {
  const result = extract([
    "## 시트: 공개자료",
    "공개자료!A1: 가격 / 단위 : 원",
    "공개자료!A3: 예식홀명",
    "공개자료!C3: 가격",
    "공개자료!D3: 가격",
    "공개자료!F3: 가격",
    "공개자료!G3: 가격",
    "공개자료!D4: 보증인원",
    "공개자료!A5: 문맥홀",
    "공개자료!B5: 식대",
    "공개자료!C5: 55,000",
    "공개자료!D5: 250,000",
    "공개자료!E5: 계좌번호",
    "공개자료!G5: 330,000",
    "공개자료!B6: 연락처",
    "공개자료!C6: 010,123,4567",
    "공개자료!F6: 100,503,922,013",
    "공개자료!B7: 계좌번호",
    "공개자료!C7: 100,503,922,013",
    "공개자료!B8: 작성일",
    "공개자료!C8: 202,607,220",
    "공개자료!B9: 인원",
    "공개자료!C9: 250,000",
    "공개자료!B10: 예식시간",
    "공개자료!C10: 120,000",
    "공개자료!B11: 수량",
    "공개자료!C11: 300,000",
    "공개자료!B12: 위약금율",
    "공개자료!C12: 10,000%",
    "병합 범위 A5:A12 · 좌상단 A5",
    "병합 범위 E5:E6 · 좌상단 E5",
  ].join("\n"), "context-fence");

  assert.deepEqual(result.money_occurrences.map(({ amount_krw }) => amount_krw), [55_000, 330_000]);
  assert.ok(result.review_notices.some(({ code }) => code === "non_price_number_quarantined"));
});

test("hall splitting requires exact delimiters or repeated complete hall suffixes", () => {
  const result = extract([
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!A5: 2F 링크홀 3F 베일리홀 4F 플라자홀 5F 가든홀 7F 화이트홀",
    "Sheet1!B5: 100,000원",
    "Sheet1!A8: 예식홀명",
    "Sheet1!A10: 컨벤션홀/파티움홀",
    "Sheet1!B10: 200,000원",
    "Sheet1!A13: 예식홀명",
    "Sheet1!A15: 봄날 홀 (단독홀)",
    "Sheet1!B15: 300,000원",
    "Sheet1!A18: 예식홀명",
    "Sheet1!A20: 그랜드볼룸홀",
    "Sheet1!B20: 400,000원",
    "Sheet1!A23: 예식홀명",
    "Sheet1!A25: 셀레네 하우스웨딩홀 (천안점) 단독홀",
    "Sheet1!B25: 500,000원",
    "Sheet1!A28: 예식홀명",
    "Sheet1!A30: 4F, 루프탑 홀",
    "Sheet1!B30: 600,000원",
    "Sheet1!A33: 예식홀명",
    "Sheet1!A35: 그랜드볼룸홀<br>스텔라홀",
    "Sheet1!B35: 700,000원",
  ].join("\n"));

  assert.equal(result.hall_components.length, 12);
  assert.ok(result.hall_components.some(({ hall_name }) => hall_name === "봄날 홀 (단독홀)"));
  assert.ok(result.hall_components.some(({ hall_name }) => hall_name === "그랜드볼룸홀"));
  assert.ok(result.hall_components.some(
    ({ hall_name }) => hall_name === "셀레네 하우스웨딩홀 (천안점) 단독홀",
  ));
  assert.ok(result.hall_components.some(({ hall_name }) => hall_name === "4F, 루프탑 홀"));
  assert.ok(result.hall_components.some(({ hall_name }) => hall_name === "그랜드볼룸홀"));
  assert.ok(result.hall_components.some(({ hall_name }) => hall_name === "스텔라홀"));
  assert.ok(!result.hall_components.some(({ hall_name }) => hall_name === "단독홀"));
  assert.ok(result.money_occurrences.every(
    ({ relation_kind }) => relation_kind === "shared_hall_group" || relation_kind === "exact_hall",
  ));
});

test("mixed suffix shorthand stays unsplit and accessory spaces never become hall components", () => {
  const result = extract([
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 가격",
    "Sheet1!A5: 그랜드볼룸홀/신관",
    "Sheet1!B5: 100,000원",
    "Sheet1!A8: 예식홀명",
    "Sheet1!A10: 신부대기룸",
    "Sheet1!B10: 200,000원",
    "Sheet1!A13: 예식홀명",
    "Sheet1!A15: 폐백실",
    "Sheet1!B15: 300,000원",
    "Sheet1!A18: 예식홀명",
    "Sheet1!A20: 연회장",
    "Sheet1!B20: 400,000원",
    "Sheet1!A23: 예식홀명",
    "Sheet1!A25: 귀빈실",
    "Sheet1!B25: 500,000원",
    "Sheet1!A28: 예식홀명",
    "Sheet1!A30: 객실",
    "Sheet1!B30: 600,000원",
  ].join("\n"), "accessory-fence");

  assert.deepEqual(result.hall_components.map(({ hall_name }) => hall_name), ["그랜드볼룸홀/신관"]);
  assert.ok(!result.hall_components.some(({ hall_name }) => (
    /(?:신부대기룸|폐백실|연회장|귀빈실|객실)/u.test(hall_name)
  )));
});

test("narrow outdoor-other and English Ballroom identities survive while alphabet placeholders do not", () => {
  const result = extract([
    "## 시트: 공개자료",
    "공개자료!A1: ① 가격(VAT 포함)",
    "공개자료!A3: 예식홀명",
    "공개자료!A5: 야외예식장(기타)",
    "공개자료!A6: Grand Ballroom",
    "공개자료!A7: ASEM Ballroom",
    "공개자료!A8: B홀",
  ].join("\n"), "identity-boundary");

  assert.deepEqual(
    result.hall_components.map(({ hall_name }) => hall_name),
    ["야외예식장(기타)", "Grand Ballroom", "ASEM Ballroom"],
  );
});

test("dual-unit ranges keep one exact option and a specific merged header beats the hall anchor", () => {
  const result = extract([
    "## 시트: 공개자료",
    "공개자료!A1: ① 가격(VAT 포함)",
    "공개자료!A3: 예식홀명",
    "공개자료!B3: 가격",
    "공개자료!B4: 대관 및 장식",
    "공개자료!A5: Grand Ballroom",
    "공개자료!D5: 220,000원 ~ 330,000원",
    "병합 범위 B4:D4 · 좌상단 B4",
  ].join("\n"), "dual-unit-range");

  assert.deepEqual(
    result.money_occurrences.map(({ amount_krw }) => amount_krw),
    [220_000, 330_000],
  );
  assert.equal(result.price_options.length, 1);
  assert.equal(result.price_options[0]?.name, "대관 및 장식");
  assert.equal(result.price_options[0]?.price_min_krw, 220_000);
  assert.equal(result.price_options[0]?.price_max_krw, 330_000);
  assert.deepEqual(result.price_options[0]?.label_locators, ["공개자료!B4"]);
});

test("fragment-local upper and lower open ranges preserve the correct nullable bound", () => {
  const result = extract([
    "## 시트: 공개자료",
    "공개자료!A1: ① 가격(VAT 포함)",
    "공개자료!A3: 예식홀명",
    "공개자료!B3: 선택품목 가격",
    "공개자료!A5: 오픈레인지홀",
    "공개자료!B5: 현수막 ~440,000원 / 깃발 220,000원~",
  ].join("\n"), "fragment-open-range");

  assert.deepEqual(
    result.price_options.map(({ name, raw_text, price_min_krw, price_max_krw }) => ({
      name,
      raw_text,
      price_min_krw,
      price_max_krw,
    })),
    [
      {
        name: "현수막",
        raw_text: "현수막 ~440,000원",
        price_min_krw: null,
        price_max_krw: 440_000,
      },
      {
        name: "깃발",
        raw_text: "깃발 220,000원~",
        price_min_krw: 220_000,
        price_max_krw: null,
      },
    ],
  );
});

test("same-cell slash bullet and br fragments use occurrence-local labels and inherit a moneyless line parent", () => {
  const result = extract([
    "## 시트: 공개자료",
    "공개자료!A1: ① 가격(VAT 포함)",
    "공개자료!A3: 예식홀명",
    "공개자료!B3: 선택품목 가격",
    "공개자료!A5: 프래그먼트홀",
    "공개자료!B5: 혼주 헤어&메이크업<br>여 200,000원 / 남 200,000원",
    "공개자료!B6: 현수막 550,000원 • 깃발 550,000원",
    "병합 범위 A5:A6 · 좌상단 A5",
  ].join("\n"), "same-cell-fragments");

  const options = result.price_options.map((option) => ({
    name: option.name,
    raw_text: option.raw_text,
    amount: option.price_min_krw,
    condition_ids: option.condition_ids,
  }));
  assert.deepEqual(options.map(({ name }) => name), ["여", "남", "현수막", "깃발"]);
  assert.deepEqual(options.map(({ raw_text }) => raw_text), [
    "여 200,000원",
    "남 200,000원",
    "현수막 550,000원",
    "깃발 550,000원",
  ]);
  assert.deepEqual(options.map(({ amount }) => amount), [200_000, 200_000, 550_000, 550_000]);
  const parent = result.conditions.find(({ text }) => text === "혼주 헤어&메이크업");
  assert.ok(parent);
  assert.deepEqual(options[0]?.condition_ids, [parent.condition_id]);
  assert.deepEqual(options[1]?.condition_ids, [parent.condition_id]);
  assert.deepEqual(options[2]?.condition_ids, []);
  assert.deepEqual(options[3]?.condition_ids, []);
});

test("an exact sample sheet is always quarantined including when it is the only sheet", () => {
  const result = extract([
    "## 시트: 샘플",
    "샘플!A1: ① 가격(단위:만원)",
    "샘플!A3: 예식홀명",
    "샘플!A5: 예시홀",
    "샘플!B5: 999만원",
    "샘플!A8: 환불기준 예시 위약금 50만원",
    "## 시트: 실제",
    "실제!A1: ① 가격(VAT 포함)",
    "실제!A3: 예식홀명",
    "실제!B3: 식대",
    "실제!A5: 실제홀",
    "실제!B5: 55,000원",
  ].join("\n"));

  assert.deepEqual(result.hall_components.map(({ hall_name }) => hall_name), ["실제홀"]);
  assert.deepEqual(result.money_occurrences.map(({ amount_krw }) => amount_krw), [55_000]);
  assert.ok(result.review_notices.some(({ code, sheet }) => (
    code === "sample_sheet_excluded" && sheet === "샘플"
  )));
  assert.ok(result.policy_evidence.every(({ source_locator }) => !source_locator.startsWith("샘플!")));

  const sampleOnly = extract([
    "## 시트: sample",
    "sample!A1: ① 가격(단위:만원)",
    "sample!A3: 예식홀명",
    "sample!A5: 예시홀",
    "sample!B5: 999만원",
  ].join("\n"), "sample-only");
  assert.deepEqual(sampleOnly.hall_components, []);
  assert.deepEqual(sampleOnly.money_occurrences, []);
  assert.ok(sampleOnly.review_notices.some(({ code }) => code === "sample_sheet_excluded"));
});

test("sample example room-rate and discount-amount contexts are not offer prices", () => {
  const result = extract([
    "## 시트: 실제",
    "실제!A1: 가격 / 단위 : 원",
    "실제!A3: 예식홀명",
    "실제!C3: 가격",
    "실제!A5: 문맥홀",
    "실제!B5: 샘플 가격",
    "실제!C5: 1,000,000",
    "실제!B6: 객실가",
    "실제!C6: 2,000,000",
    "실제!B7: 할인액",
    "실제!C7: 300,000",
    "실제!B8: 할인가",
    "실제!C8: 400,000",
    "실제!B9: 최종가",
    "실제!C9: 500,000",
    "실제!B10: 프로모션가",
    "실제!C10: 600,000",
    "실제!B11: 비고",
    "실제!C11: 예시 700,000원",
    "실제!B12: template",
    "실제!C12: 800,000원",
    "병합 범위 A5:A12 · 좌상단 A5",
  ].join("\n"), "offer-context");

  assert.deepEqual(
    result.money_occurrences.map(({ amount_krw }) => amount_krw),
    [400_000, 500_000, 600_000],
  );
});

test("policy and pricing-basis evidence remain exact and bracketed won policy money is scanned", () => {
  const result = extract([
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식대",
    "Sheet1!A5: 정책홀",
    "Sheet1!B5: 77,000원",
    "Sheet1!A8: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
    "Sheet1!A9: 계약해제 시 제공 서비스 대금 [550,000]원을 공제할 수 있음",
  ].join("\n"));

  assert.equal(result.pricing_basis_evidence.length, 1);
  assert.equal(result.policy_evidence.length, 2);
  const policyMoney = result.money_occurrences.find(({ relation_kind }) => relation_kind === "policy");
  assert.equal(policyMoney?.amount_krw, 550_000);
  assert.equal(policyMoney?.source_locator, "Sheet1!A9");
});

test("the audited eight-unit price regression matrix preserves all 227 exact occurrences", () => {
  const counts = [89, 48, 15, 15, 42, 15, 2, 1];
  const actual = counts.map((count, unitIndex) => {
    const rows = Array.from({ length: count }, (_, index) => (
      `U${unitIndex}!B${index + 5}: ${(index + 1).toLocaleString("en-US")}만원`
    ));
    return extract([
      `## 시트: U${unitIndex}`,
      `U${unitIndex}!A1: ① 가격(VAT 포함)`,
      `U${unitIndex}!A3: 예식홀명`,
      `U${unitIndex}!B3: 선택품목 가격`,
      `U${unitIndex}!A5: 회귀홀${unitIndex}`,
      ...rows,
      `병합 범위 A5:A${count + 4} · 좌상단 A5`,
    ].join("\n"), `source-${unitIndex}`).money_occurrences.length;
  });

  assert.deepEqual(actual, counts);
  assert.equal(actual.reduce((sum, count) => sum + count, 0), 227);
});

test("the audited Dongseoul table keeps all 42 declared-won price cells and rejects guarantee counts", () => {
  const lines = [
    "## 시트: 예식비용안내",
    "예식비용안내!G2: 단위(원.VAT포함)",
  ];
  for (let period = 0; period < 3; period += 1) {
    const offset = period * 11;
    lines.push(
      `예식비용안내!A${3 + offset}: 예식홀명`,
      `예식비용안내!B${4 + offset}: 성수기 (골든_최대가)`,
      `예식비용안내!C${4 + offset}: 성수기 (골든_최대가)`,
      `예식비용안내!E${4 + offset}: 비수기(골든외_최소가)`,
      `예식비용안내!F${4 + offset}: 비수기(골든외_최소가)`,
      `예식비용안내!A${5 + offset}: 그랜드볼룸`,
      `예식비용안내!B${5 + offset}: 5,200,000`,
      `예식비용안내!C${5 + offset}: 65,000`,
      `예식비용안내!D${5 + offset}: 250명`,
      `예식비용안내!E${5 + offset}: 3,300,000`,
      `예식비용안내!F${5 + offset}: 55,000`,
      `예식비용안내!A${6 + offset}: 그랜드볼룸`,
      `예식비용안내!B${6 + offset}: 4,200,000`,
      `예식비용안내!C${6 + offset}: 60,000`,
      `예식비용안내!D${6 + offset}: 250명`,
      `예식비용안내!E${6 + offset}: 3,300,000`,
      `예식비용안내!F${6 + offset}: 55,000`,
      `예식비용안내!A${8 + offset}: 예식홀명`,
      `예식비용안내!B${9 + offset}: 본식촬영`,
      `예식비용안내!C${9 + offset}: 전문사회`,
      `예식비용안내!D${9 + offset}: 부케`,
      `예식비용안내!E${9 + offset}: 본식DVD`,
      `예식비용안내!F${9 + offset}: 전문축가`,
      `예식비용안내!G${9 + offset}: 포토부스`,
      `예식비용안내!A${10 + offset}: 그랜드볼룸`,
      `예식비용안내!B${10 + offset}: 750,000`,
      `예식비용안내!C${10 + offset}: 270,000`,
      `예식비용안내!D${10 + offset}: 220,000~`,
      `예식비용안내!E${10 + offset}: 400,000`,
      `예식비용안내!F${10 + offset}: 220,000`,
      `예식비용안내!G${10 + offset}: 420,000`,
    );
  }
  const result = extract(lines.join("\n"), "dongseoul");
  assert.equal(result.money_occurrences.length, 42);
  assert.ok(result.money_occurrences.every(({ relation_kind }) => relation_kind === "exact_hall"));
  assert.ok(result.money_occurrences.every(({ amount_krw }) => amount_krw !== 250));
});

test("an exact declared-won price zero is retained without admitting unbounded integers", () => {
  const result = extract([
    "## 시트: 공개자료",
    "공개자료!A1: 단위 : 원",
    "공개자료!A3: 예식홀명",
    "공개자료!B3: 선택품목 가격",
    "공개자료!A5: 제로홀",
    "공개자료!B5: 0",
    "공개자료!C5: 2026",
    "공개자료!D5: 7",
  ].join("\n"), "zero-price");
  assert.deepEqual(result.money_occurrences.map(({ amount_krw }) => amount_krw), [0]);
});

test("fourteen audited split units produce 38 components and fourteen repeated units coalesce losslessly", () => {
  const componentCounts = [2, 2, 3, 2, 2, 4, 2, 3, 5, 2, 3, 3, 3, 2];
  const splitTotal = componentCounts.reduce((total, count, unitIndex) => {
    const names = Array.from({ length: count }, (_, index) => `공간${unitIndex}_${index}홀`);
    const result = extract([
      `## 시트: S${unitIndex}`,
      `S${unitIndex}!A1: ① 가격(VAT 포함)`,
      `S${unitIndex}!A3: 예식홀명`,
      `S${unitIndex}!A5: ${names.join(" / ")}`,
      `S${unitIndex}!B5: 100,000원`,
    ].join("\n"), `split-${unitIndex}`);
    assert.equal(result.money_occurrences[0]?.relation_kind, "shared_hall_group");
    return total + result.hall_components.length;
  }, 0);
  assert.equal(splitTotal, 38);

  for (let unitIndex = 0; unitIndex < 14; unitIndex += 1) {
    const result = extract([
      `## 시트: R${unitIndex}`,
      `R${unitIndex}!A1: ① 가격(VAT 포함)`,
      `R${unitIndex}!A2: 2026년`,
      `R${unitIndex}!A3: 예식홀명`,
      `R${unitIndex}!B3: 식대`,
      `R${unitIndex}!A5: 반복${unitIndex}홀`,
      `R${unitIndex}!B5: 50,000원`,
      `R${unitIndex}!A8: 2027년`,
      `R${unitIndex}!A9: 예식홀명`,
      `R${unitIndex}!B9: 식대`,
      `R${unitIndex}!A11: 반복${unitIndex}홀`,
      `R${unitIndex}!B11: 60,000원`,
    ].join("\n"), `repeat-${unitIndex}`);
    assert.equal(result.hall_components.length, 1);
    assert.deepEqual(result.hall_components[0]?.source_locators, [
      `R${unitIndex}!A5`,
      `R${unitIndex}!A11`,
    ]);
    assert.equal(result.money_occurrences.length, 2);
  }
});
