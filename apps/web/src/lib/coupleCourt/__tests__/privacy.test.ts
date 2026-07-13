import { describe, expect, it } from "vitest";
import {
  buildPublicCourtSnapshot,
  extractCourtKnownEntities,
  hashPublicCourtSnapshot,
  redactCourtText,
  sanitizePrivateCourtVerdict,
} from "@/lib/coupleCourt/privacy";
import { makeValidCourtVerdict } from "@/lib/coupleCourt/__tests__/fixtures";

describe("couple-court privacy boundary", () => {
  it("sanitizes known entities across private verdict fields, not just public cards", () => {
    const verdict = makeValidCourtVerdict();
    verdict.caseSummary = "민수와 라라의 예산 결정을 정리했습니다.";
    verdict.conversationScript.opening = "민수에게 라라 업체 이야기를 다시 물어볼까요?";
    verdict.missions[0].title = "라라에 민수와 연락하기";
    const sanitized = sanitizePrivateCourtVerdict(verdict, ["민수", "라라"]);
    expect(JSON.stringify(sanitized)).not.toContain("민수");
    expect(JSON.stringify(sanitized)).not.toContain("라라");
    expect(sanitized.caseSummary).toContain("[고유명사 삭제]");
  });

  it("returns findings and a blocked signal while removing common Korean PII", () => {
    const result = redactCourtText(
      "예약자: 김민수, 010-1234-5678, minsu@example.com, 서울 강남구 테헤란로 123",
    );
    expect(result.blocked).toBe(true);
    expect(result.findings).toEqual(expect.arrayContaining([
      "named_person",
      "phone",
      "email",
      "address",
    ]));
    expect(result.text).not.toContain("김민수");
    expect(result.text).not.toContain("010-1234-5678");
    expect(result.text).not.toContain("minsu@example.com");
    expect(result.text).not.toContain("테헤란로 123");
  });

  it("redacts known people and vendor names supplied by the server", () => {
    const result = redactCourtText("민수와 라라웨딩 실장에게 연락했어요.", {
      knownEntities: ["민수", "라라웨딩"],
    });
    expect(result.blocked).toBe(true);
    expect(result.findings).toContain("known_entity");
    expect(result.text).toBe("[고유명사 삭제]와 [고유명사 삭제] 실장에게 연락했어요.");
  });

  it("blocks common vendor/venue brand forms and extracts labeled private entities", () => {
    const branded = redactCourtText("라라웨딩에서 받은 견적을 비교했어요.");
    expect(branded.findings).toContain("vendor_or_venue");
    expect(branded.text).not.toContain("라라웨딩");
    expect(extractCourtKnownEntities("예식장은 더채플, 업체명: 모모컴퍼니예요.")).toEqual(
      expect.arrayContaining(["더채플", "모모컴퍼니"]),
    );
  });

  it("extracts and redacts family names supplied in relationship context", () => {
    const text = "엄마 김영희 님과 동생 민수 의견이 달랐어요.";
    expect(extractCourtKnownEntities(text)).toEqual(expect.arrayContaining(["김영희", "민수"]));
    const redacted = redactCourtText(text, { knownEntities: extractCourtKnownEntities(text) });
    expect(redacted.findings).toContain("named_person");
    expect(redacted.text).not.toContain("김영희");
    expect(redacted.text).not.toContain("민수");
  });

  it.each([
    "엄마 의견 때문에 일정이 미뤄졌어요.",
    "부모님 뜻이 달라요.",
    "친구 생각도 궁금해요.",
    "호텔은 너무 비싸요.",
    "예식장은 마음에 들지만 거리가 멀어요.",
  ])("does not mistake ordinary Korean context words for names or vendors: %s", (text) => {
    expect(extractCourtKnownEntities(text)).toEqual([]);
    const redacted = redactCourtText(text);
    expect(redacted.text).toBe(text);
    expect(redacted.findings).not.toContain("named_person");
    expect(redacted.findings).not.toContain("known_entity");
  });

  it("blocks exact currency amounts from public and share-card copy", () => {
    for (const privateAmount of [
      "드레스 추가금 80만 원을 결제했어요",
      "총액은 1200000원이었어요",
      "총액은 1,200,000원이었어요",
      "계약금은 ₩350000이었어요",
    ]) {
      expect(redactCourtText(privateAmount, {
        blockCurrencyAmounts: true,
      }), privateAmount).toMatchObject({
        blocked: true,
        findings: ["currency_amount"],
      });
    }
    expect(redactCourtText("드레스 추가금 80만 원을 결제했어요").blocked).toBe(false);
  });

  it("blocks exact schedules and financial or reservation identifiers", () => {
    const result = redactCourtText(
      "2027년 5월 12일 오후 3시 30분, 계좌번호 110-123-456789, 예약번호 AB-12345",
    );
    expect(result.findings).toEqual(expect.arrayContaining([
      "exact_date_time",
      "account_or_card",
      "contract_identifier",
    ]));
    expect(result.text).not.toContain("2027년 5월 12일");
    expect(result.text).not.toContain("110-123-456789");
    expect(result.text).not.toContain("AB-12345");
  });

  it("redacts a detailed Korean month/day schedule even when the year is omitted", () => {
    const result = redactCourtText("예식은 7월 13일 오후 2시에 시작해요.");
    expect(result.findings).toContain("exact_date_time");
    expect(result.text).not.toContain("7월 13일");
    expect(result.text).not.toContain("오후 2시");
  });

  it("builds deterministic enum-only public copy and hashes it consistently", () => {
    const verdict = makeValidCourtVerdict();
    const snapshot = buildPublicCourtSnapshot({
      mode: "couple",
      tone: "gentle",
      category: "budget",
      verdict,
    });
    expect(snapshot).toEqual({
      snapshotVersion: "1.0",
      category: "budget",
      mode: "couple",
      tone: "gentle",
      provisional: false,
      safeTitle: "예산 및 추가금에 관한 한방 판결",
      oneLine: "두 사람의 독립 진술을 바탕으로 다음 합의를 위한 쟁점을 정리했어요.",
      resultLabel: "대화와 합의 권고",
      hashtags: ["웨딩한방", "커플재판소", "예산및추가금"],
    });
    expect(snapshot).not.toHaveProperty("caseSummary");
    expect(snapshot).not.toHaveProperty("differentViews");
    expect(snapshot).not.toHaveProperty("missions");
    expect(hashPublicCourtSnapshot(snapshot!)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPublicCourtSnapshot(snapshot!)).toBe(hashPublicCourtSnapshot({ ...snapshot! }));
  });

  it("never copies provider-authored PII into a public snapshot", () => {
    const verdict = makeValidCourtVerdict();
    verdict.publicCard = {
      safeTitle: "김민수와 더채플앳청담 사건",
      oneLine: "문의는 010-2222-3333으로 주세요.",
      resultLabel: "보테가마지오 판결",
      hashtags: ["실명노출"],
    };
    const snapshot = buildPublicCourtSnapshot({
      mode: "couple",
      tone: "gentle",
      category: "budget",
      verdict,
    });
    expect(snapshot).not.toBeNull();
    expect(JSON.stringify(snapshot)).not.toMatch(
      /김민수|더채플앳청담|010-2222-3333|보테가마지오|실명노출/u,
    );
  });

  it("never creates a public snapshot for sensitive or high-risk verdicts", () => {
    const verdict = makeValidCourtVerdict();
    verdict.safety.level = "sensitive";
    verdict.safety.publicEligible = false;
    verdict.safety.disablePlayfulVerdict = true;
    verdict.publicCard = null;
    expect(buildPublicCourtSnapshot({
      mode: "couple",
      tone: "gentle",
      category: "budget",
      verdict,
    })).toBeNull();
  });
});
