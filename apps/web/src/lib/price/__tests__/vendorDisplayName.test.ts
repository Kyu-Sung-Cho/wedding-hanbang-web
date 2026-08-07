import { describe, expect, it } from "vitest";

import { vendorDisplayName, vendorSearchTerms } from "@/lib/price/vendorDisplayName";

/**
 * 실측(2026-08-08 운영 v_public_vendors 1,053곳) 기준으로 잠근다.
 * 떼야 할 21건은 전부 떼고, 상호의 일부인 괄호는 하나도 건드리지 않아야 한다.
 */
describe("파일명 찌꺼기를 뗀다", () => {
  it("문서 꼬리표 _예식장 (운영 9건)", () => {
    const cases = [
      "베로나지디_예식장", "더시그너스웨딩_예식장", "더 퀸_예식장",
      "안동 그랜드호텔웨딩_예식장", "유탑 마리나호텔_예식장",
      "마리나웨딩홀여수_예식장", "MBC컨벤션진주_예식장", "소풍컨벤션웨딩_예식장",
    ];
    for (const raw of cases) {
      expect(vendorDisplayName(raw).name, raw).toBe(raw.replace("_예식장", ""));
    }
  });

  it("괄호 뒤에 꼬리표가 붙은 것도 둘 다 뗀다", () => {
    const result = vendorDisplayName("웨스턴라이프호텔&컨벤션(㈜디에스에이치글로벌 익산지점)_예식장");
    expect(result.name).toBe("웨스턴라이프호텔&컨벤션");
    expect(result.disclosureEntity).toBe("㈜디에스에이치글로벌 익산지점");
  });

  it("법인 괄호는 떼되 버리지 않는다 (운영 10건)", () => {
    const cases: Array<[string, string, string]> = [
      ["빌라드지디 논현(라비에벨(주))", "빌라드지디 논현", "라비에벨(주)"],
      ["힐스코트(태성산업(주))", "힐스코트", "태성산업(주)"],
      ["PJ호텔 웨딩홀(오일관광(주))", "PJ호텔 웨딩홀", "오일관광(주)"],
      ["화목원 웨딩홀(농업회사법인마중물(주))", "화목원 웨딩홀", "농업회사법인마중물(주)"],
      ["더파티 센텀점(더리본㈜더파티센텀)", "더파티 센텀점", "더리본㈜더파티센텀"],
      ["W웨딩 마리나컨벤션웨딩홀(더리본(주)마리나웨딩지점)", "W웨딩 마리나컨벤션웨딩홀", "더리본(주)마리나웨딩지점"],
      ["목화웨딩컨벤션(더리본㈜더파티아이목화점)", "목화웨딩컨벤션", "더리본㈜더파티아이목화점"],
    ];
    for (const [raw, name, entity] of cases) {
      const result = vendorDisplayName(raw);
      expect(result.name, raw).toBe(name);
      expect(result.disclosureEntity, raw).toBe(entity);
    }
  });

  it("문서 양식어와 사본 표시", () => {
    expect(vendorDisplayName("스카이나인스 표준양식").name).toBe("스카이나인스");
    expect(vendorDisplayName("셀레네하우스웨딩(천안, 청주점) (1)").name)
      .toBe("셀레네하우스웨딩(천안, 청주점)");
  });
});

describe("상호의 일부는 절대 건드리지 않는다", () => {
  it("법인격이 없는 끝 괄호는 그대로 둔다", () => {
    // 지점·구성·별칭 표기다. 떼면 서로 다른 업체가 같은 이름이 된다.
    const keep = [
      "셀레네하우스웨딩(천안, 청주점)",
      "오라카이호텔웨딩(3층 테라스 야외홀)",
      "웨딩스퀘어 강변(티엠 웨딩스퀘어)",
      "디엘픽쳐스(무하,달리야,힌)",
      "어반스튜디오 (어센틱러브)",
      "빌라드지디 수서(더그레이스켈리수서)",
      "W웨딩(웨딩파티플랜 울산)",
    ];
    for (const raw of keep) {
      expect(vendorDisplayName(raw).name, raw).toBe(raw);
      expect(vendorDisplayName(raw).disclosureEntity, raw).toBeNull();
    }
  });

  it("이름 **앞**의 법인격은 상호의 일부다", () => {
    for (const raw of ["(유)아름다운컨벤션", "(주)라비돌", "(주)플로팅아일랜드"]) {
      expect(vendorDisplayName(raw).name, raw).toBe(raw);
      expect(vendorDisplayName(raw).disclosureEntity, raw).toBeNull();
    }
  });

  it("꼬리표를 닮았지만 아닌 것은 두고, 이름이 통째로 사라지지 않는다", () => {
    expect(vendorDisplayName("예식장").name).toBe("예식장");
    expect(vendorDisplayName("(주)해라").name).toBe("(주)해라");
    expect(vendorDisplayName("").name).toBe("");
  });

  it("두 번 돌려도 같다 (멱등)", () => {
    for (const raw of ["베로나지디_예식장", "힐스코트(태성산업(주))", "셀레네하우스웨딩(천안, 청주점)"]) {
      const once = vendorDisplayName(raw).name;
      expect(vendorDisplayName(once).name, raw).toBe(once);
    }
  });
});

describe("검색은 떼어낸 말로도 찾힌다", () => {
  it("법인명으로 찾던 사람이 못 찾게 되지 않는다", () => {
    const terms = vendorSearchTerms("빌라드지디 논현(라비에벨(주))");
    expect(terms.some((value) => value.includes("라비에벨"))).toBe(true);
    expect(terms.some((value) => value.includes("빌라드지디 논현"))).toBe(true);
  });

  it("원본 이름도 검색 대상에 남는다", () => {
    expect(vendorSearchTerms("베로나지디_예식장")).toContain("베로나지디_예식장");
    expect(vendorSearchTerms("베로나지디_예식장")).toContain("베로나지디");
  });
});
