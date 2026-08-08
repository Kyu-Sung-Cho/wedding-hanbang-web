import { describe, expect, it } from "vitest";
import { findObviousPublicPersonalInfo } from "@/lib/community/publicPersonalInfo";

describe("findObviousPublicPersonalInfo", () => {
  it.each([
    ["test@example.com", "email"],
    ["연락처 010-1234-5678", "phone"],
    ["전화 0212345678", "phone"],
    ["주민번호 990101-2123456", "resident_registration"],
    ["입금 계좌 110-123-456789", "bank_account"],
    [
      "제 이름은 김민지이고 생년월일은 1993년 4월 2일이에요.",
      "name_birth_date",
    ],
    ["김민지 (1993.04.02생)", "name_birth_date"],
    ["성명 김민지, 생년월일 930402", "name_birth_date"],
    [
      "신혼집 주소는 서울특별시 강남구 테헤란로 123, 101동 1203호예요.",
      "precise_address",
    ],
    ["당뇨 진단을 받아 인슐린을 복용 중이에요.", "health"],
    ["현재 난임 치료로 시험관 시술 중이에요.", "reproductive"],
    ["성생활 문제로 상담을 받고 있어요.", "sexual_life"],
    ["부모님이 이혼한 뒤 서로 연락을 끊으셨어요.", "family_relationship"],
    ["시어머니 성함은 김영희예요.", "family_relationship"],
    ["웨딩홀 계약번호 VENU-2026-0042", "vendor_contract_identifier"],
    ["예약자명: 김민지", "vendor_contract_identifier"],
  ])("detects %s without returning the sensitive value", (value, kind) => {
    expect(findObviousPublicPersonalInfo(value)).toContain(kind);
  });

  it("decodes common email entities used inside sanitized HTML", () => {
    expect(
      findObviousPublicPersonalInfo("<p>test&#64;example.com</p>")
    ).toEqual(["email"]);
  });

  it.each([
    ['<a href="mailto:victim@example.com">문의</a>', "email"],
    ['<a href="tel:010-1234-5678">전화</a>', "phone"],
    ['<img src="/safe/image.jpg" alt="010-1234-5678">', "phone"],
    ['<img src="https://example.com/010-1234-5678.jpg" title="사진">', "phone"],
    ['<a href="mailto:test&#64;example.com">문의</a>', "email"],
  ])("detects PII hidden in sanitized HTML attributes: %s", (value, kind) => {
    expect(findObviousPublicPersonalInfo(value)).toContain(kind);
  });

  it("does not mistake ordinary wedding prices and dates for identifiers", () => {
    expect(
      findObviousPublicPersonalInfo(
        "2026년 10월 예식이고 총액은 21,390,000원이에요."
      )
    ).toEqual([]);
  });

  it.each([
    [
      "이\u200B름은 김민지, 생\u2060년월일은 １９９３&#46;０４&#46;０２예요.",
      "name_birth_date",
    ],
    [
      "신혼집 <b>주소</b> 서울 강남구 역삼동 １２３－４５",
      "precise_address",
    ],
    ["현재 &#45212;&#51076; 치&#료 중이에요.", "reproductive"],
    ["계\u200B약\u2060번\uFEFF호：ＶＥＮＵ－２０２６－００４２", "vendor_contract_identifier"],
    ["부모님이 재\u200B혼 후 가족과 절연했어요.", "family_relationship"],
    ["이·름 김민지 / 생·년·월·일 930402", "name_birth_date"],
    ["신혼집은 테·헤·란·로 123이에요.", "precise_address"],
    ["부·모·님이 이·혼 후 절·연했어요.", "family_relationship"],
    ["계·약·번·호 VENU-2026-0042", "vendor_contract_identifier"],
  ])("blocks common encoding and invisible-character bypasses: %s", (value, kind) => {
    expect(findObviousPublicPersonalInfo(value)).toContain(kind);
  });

  it.each([
    "김민지·박준호는 2026년 10월 10일에 결혼해요.",
    "부모님 선물과 시댁 예절이 궁금해요.",
    "건강하고 즐거운 결혼 준비를 하고 싶어요.",
    "임신한 하객을 위한 편한 좌석 배치가 궁금해요.",
    "강남구 예식장 위치와 주차 정보를 알려주세요.",
    "웨딩홀 계약금은 300만원이고 잔금일은 10월 1일이에요.",
  ])("allows ordinary non-identifying wedding discussion: %s", (value) => {
    expect(findObviousPublicPersonalInfo(value)).toEqual([]);
  });
});
