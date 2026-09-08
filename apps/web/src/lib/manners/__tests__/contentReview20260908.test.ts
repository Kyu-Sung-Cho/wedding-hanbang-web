// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MANNERS_PARTS } from "../data";

function body(slug: string) {
  const part = MANNERS_PARTS.find((entry) => entry.slug === slug);
  expect(part, `안내가 없음: ${slug}`).toBeDefined();
  return JSON.stringify(part?.sections);
}

describe("예절 안내의 선택·안전·출처 경계", () => {
  it("모든 기존 편과 절·블록을 유지한다", () => {
    expect(MANNERS_PARTS).toHaveLength(25);
    expect(MANNERS_PARTS.flatMap((part) => part.sections)).toHaveLength(171);
    expect(MANNERS_PARTS.flatMap((part) => part.sections.flatMap((section) => section.blocks))).toHaveLength(594);
  });

  it("출처 없는 표가 선물·축의금·혼수의 권장 가격표로 돌아가지 않는다", () => {
    const tables = MANNERS_PARTS.flatMap((part) => part.sections.flatMap((section) => section.blocks))
      .filter((block) => block.kind === "table" && block.unsourced);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      if (table.kind !== "table") continue;
      expect(JSON.stringify(table.rows), table.title).not.toMatch(/\d[\d,.]*\s*(?:만|천|백)?\s*원|\d\s*%/u);
    }
    expect(body("shared-home-items")).not.toContain("1,456만원");
    expect(body("gift-money")).not.toContain("그만큼 돌려");
  });

  it("술 거절은 이유 공개나 상대의 허락을 조건으로 하지 않는다", () => {
    const visit = body("first-family-visit");
    expect(visit).toContain("이유를 설명하지 않아도 거절할 수 있습니다");
    expect(visit).not.toContain("더 권하지 않으십니다");
    expect(visit).not.toContain("90도까지 숙이는 사람이 많습니다");
    expect(visit).not.toContain("건강 상태를 미리 들어두기");
  });

  it("배우자에게 비밀이 없다는 명목으로 도움 요청·비밀번호 공개를 강요하지 않는다", () => {
    const digital = body("digital-manners");
    expect(digital).toContain("비밀번호나 사적인 대화를 공개할 의무는 없습니다");
    expect(digital).toContain("위협·폭력·통제가 있다면 믿을 만한 사람이나 전문기관에 도움을 요청");
    expect(digital).not.toContain("배우자가 알면 곤란할 대화를 숨기기");
    expect(digital).not.toContain("부부싸움을 양가에 전달하지 않기");
  });

  it("예식 계약 15일 기준을 150일 이전에만 해당한다고 축소하지 않는다", () => {
    const costs = body("cost-saving");
    expect(costs).toContain("계약 후 15일 이내 해제는 별도 분쟁유형");
    expect(costs).not.toContain("150일 이전");
    expect(costs).toContain("불공정하거나 법에 어긋나는 약관까지 유효하다는 뜻은 아닙니다");
  });

  it("대출·건강보험을 혼인만으로 자동 수급하거나 미확인 조건으로 확정하지 않는다", () => {
    expect(body("cost-saving")).toContain("대출 승인 전에 계약금부터 내지 않도록");
    expect(body("cost-saving")).not.toContain("6개월 이내 신청");
    expect(body("marriage-registration")).toContain("혼인신고만으로 피부양자 자격이 자동으로 생기지는 않습니다");
  });

  it("온열질환과 음식의 시간 기준을 안전 보증으로 쓰지 않는다", () => {
    const small = body("small-wedding");
    expect(small).toContain("의식이 없거나 삼키기 어렵다면 물이나 음료를 먹이지 않습니다");
    expect(small).toContain("특보가 없다고 야외 진행이 안전하다는 뜻은 아닙니다");
    expect(small).toContain("2시간 이내라는 말이 안전 보증이나 소비기한은 아닙니다");
    expect(body("return-gift")).toMatch(/기한을 임의로 정하지|보관 가능한 날짜를 임의로 정하지/u);
  });

  it("가족과 종교가 같은 것을 전제로 비용·참여 순서를 정하지 않는다", () => {
    expect(body("family-meeting")).toContain("성별이나 어느 집인지로 결제 담당을 정하지 않습니다");
    expect(body("religious-weddings")).toContain("참여하지 않는 동작과 대체 인사 방법");
    expect(body("home-conversation")).toContain("등기사항증명서만으로 보증금 반환이 안전하다고 판단하지 않습니다");
  });
});
