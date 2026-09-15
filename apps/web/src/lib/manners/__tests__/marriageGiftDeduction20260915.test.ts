// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MANNERS_PARTS } from "../data";
import type { MannersBlock, MannersPart } from "../types";

/**
 * 혼인·출산 증여재산 공제 안내 (2026-09-15).
 *
 * 결혼 비용 절약 가이드의 세금 표에 결혼세액공제만 있고, 부모님 지원을 받는 커플이 가장
 * 먼저 물어보는 혼인·출산 증여재산 공제가 빠져 있었다. 표에 줄을 더하고 조문·국세청 상담
 * 안내·기획재정부 발표를 출처로 붙였다. 신혼집 논의 편에는 "증여 전에 확인하라" 는 한 줄과
 * 표로 가는 안내를 붙였다.
 *
 * 이 검사는 그 줄이 **출처와 함께** 남아 있는지를 본다. 출처 번호는 1부터 세는
 * `part.sources` 위치라, 출처 목록 순서가 바뀌면 표가 엉뚱한 문서를 가리키게 된다 —
 * 그래서 번호가 아니라 번호가 가리키는 URL 로 확인한다.
 */

const LAW_URL = "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1017648003";
const NTS_QNA_URL = "https://call.nts.go.kr/call/qna/selectQnaInfo.do?mi=2787&ctgId=CTG12222";
const BRIEFING_URL = "https://www.korea.kr/news/policyNewsView.do?newsId=148924238";
const MARRIAGE_TAX_CREDIT_NTS_URL = "https://www.nts.go.kr/nts/na/ntt/selectNttInfo.do?nttSn=1339712&mi=2201";

type TableBlock = Extract<MannersBlock, { kind: "table" }>;

function part(slug: string): MannersPart {
  const found = MANNERS_PARTS.find((item) => item.slug === slug);
  expect(found, `manners part ${slug}`).toBeDefined();
  return found!;
}

function taxTable(costSaving: MannersPart): { table: TableBlock; heading: string } {
  for (const section of costSaving.sections) {
    for (const block of section.blocks) {
      if (block.kind === "table" && block.rows.some((row) => row[0] === "혼인·출산 증여재산 공제")) {
        return { table: block, heading: section.heading };
      }
    }
  }
  throw new Error("결혼 비용 절약 가이드에 혼인·출산 증여재산 공제 줄이 없다");
}

describe("결혼 비용 절약 가이드 — 혼인·출산 증여재산 공제", () => {
  const costSaving = part("cost-saving");

  it("세금 공제 표에 공제 줄이 있고 기간·한도·적용 시작·한계를 함께 말한다", () => {
    const { table, heading } = taxTable(costSaving);
    expect(heading).toBe("6. 지원·공제·대출 — 자격과 조건부터 확인하기");
    expect(table.title).toBe("세금 공제와 주거 금융에서 확인할 것");
    expect(table.columns).toEqual(["제도", "내용", "확인처"]);
    // 기존 줄은 그대로 남는다.
    expect(table.rows.map((row) => row[0])).toEqual([
      "결혼세액공제",
      "혼인·출산 증여재산 공제",
      "신혼부부전용 전세자금",
    ]);

    const [, content, checkWith] = table.rows.find((row) => row[0] === "혼인·출산 증여재산 공제")!;
    for (const claim of [
      "직계존속",
      "혼인신고일 전후 각 2년 이내",
      "출생일이나 입양신고일부터 2년 이내",
      "직계존속 5천만원",
      "1억원",
      "혼인과 출산을 합쳐",
      "2024년 1월 1일 이후",
      "모든 증여재산에 적용되지는 않습니다",
      "증여세가 없어지는 제도가 아니며",
    ]) {
      expect(content, claim).toContain(claim);
    }
    expect(checkWith).toBe("상속세 및 증여세법 제53조의2·국세청 국세상담센터·기획재정부 발표");

    // 기준 시점과 한계가 표 안에 공제를 따로 적는다.
    expect(table.asOf).toContain("혼인·출산 증여재산 공제는 2026년 9월 15일 검토");
    expect(table.caption).toContain("2026년 9월 15일 확인한 혼인·출산 증여재산 공제");
    expect(table.limits).toContain("증여재산 공제");
  });

  it("공제 줄의 출처 번호가 조문·국세청 상담 안내·정책브리핑을 가리킨다", () => {
    const { table } = taxTable(costSaving);
    expect(table.unsourced).toBeUndefined();
    expect(table.sourceRefs).toEqual([9, 10, 11, 12, 13, 14]);

    const referenced = (table.sourceRefs ?? []).map((ref) => costSaving.sources[ref - 1]);
    expect(referenced.every(Boolean), "sourceRefs 가 출처 목록 밖을 가리킨다").toBe(true);
    const urls = referenced.map((source) => source.url);
    for (const url of [LAW_URL, NTS_QNA_URL, BRIEFING_URL, MARRIAGE_TAX_CREDIT_NTS_URL]) {
      expect(urls, url).toContain(url);
    }

    const law = costSaving.sources.find((source) => source.url === LAW_URL)!;
    expect(law.label).toBe("국가법령정보센터 — 상속세 및 증여세법 제53조의2(혼인ㆍ출산 증여재산 공제)");
    expect(law.checkedAt).toBe("2026-09-15");
    const qna = costSaving.sources.find((source) => source.url === NTS_QNA_URL)!;
    expect(qna.label).toBe("국세청 국세상담센터 — 혼인·출산 증여재산공제 자주묻는 Q&A");
    expect(qna.checkedAt).toBe("2026-09-15");
    const briefing = costSaving.sources.find((source) => source.url === BRIEFING_URL)!;
    expect(briefing.checkedAt).toBe("2026-09-15");
    // 시행 전 발표라는 한계를 스스로 적는다.
    expect(briefing.supports).toContain("시행 전 발표 자료");
  });

  it("2년을 예식일이 아니라 혼인신고일로 센다고 경고한다", () => {
    const warnings = costSaving.sections
      .flatMap((section) => section.blocks)
      .filter((block): block is Extract<MannersBlock, { kind: "warning" }> => block.kind === "warning")
      .flatMap((block) => block.items);
    expect(warnings.some((item) => item.includes("증여재산 공제의 2년은 예식일이 아니라")
      && item.includes("혼인신고일"))).toBe(true);
  });
});

describe("신혼집 논의 예절 — 증여 전에 확인하라는 안내", () => {
  const home = part("home-conversation");

  it("분담을 정할 때 팁에 증여 전 확인과 절약 가이드 표로 가는 안내가 남아 있다", () => {
    const tips = home.sections
      .flatMap((section) => section.blocks)
      .filter((block): block is Extract<MannersBlock, { kind: "tip" }> => block.kind === "tip" && block.title === "분담을 정할 때");
    expect(tips).toHaveLength(1);
    const guidance = tips[0].items.find((item) => item.includes("혼인·출산 증여재산 공제"));
    expect(guidance, "신혼집 논의 편의 증여재산 공제 안내가 사라졌다").toBeDefined();
    expect(guidance).toContain("증여 전에 국세청 안내로 확인합니다");
    expect(guidance).toContain("결혼 비용 절약 가이드의 세금 공제 표");
    // 기존 팁 항목은 지워지지 않는다.
    expect(tips[0].items[0]).toBe("도움을 청하기 전에 지원을 거절해도 된다고 명확히 말합니다.");
    expect(tips[0].items).toContain("세금·대출·반환보증 조건은 계약 시점의 기관 안내로 확인하고 상담 답변을 보관합니다.");
  });

  it("안내가 가리키는 곳이 실제로 있다 — 절약 가이드 제목과 세금 공제 표", () => {
    const costSaving = part("cost-saving");
    expect(costSaving.title).toBe("결혼 비용 절약 가이드");
    expect(taxTable(costSaving).table.title).toContain("세금 공제");
  });

  it("국세청 상담 안내를 이 편의 출처로도 둔다", () => {
    const qna = home.sources.find((source) => source.url === NTS_QNA_URL);
    expect(qna).toMatchObject({ checkedAt: "2026-09-15" });
    expect(qna?.supports).toContain("과세 결론은 아닙니다");
  });
});
