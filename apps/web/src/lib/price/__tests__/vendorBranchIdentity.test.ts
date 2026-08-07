import { describe, expect, it } from "vitest";

import {
  SAME_BUSINESS_DIFFERENT_NAME,
  VENDOR_BRANCHES,
  VENDOR_BRANCH_AMBIGUOUS,
  canonicalVendorName,
  hasUnverifiedBranch,
  normalizeVendorName,
  vendorBranchOf,
  vendorIdentityGroup,
  vendorIdentityKey,
  vendorIdentityLikePattern,
  vendorRegionCodeOverride,
} from "@/lib/price/vendorIdentity";

/**
 * 지점 신원 규칙이 지켜야 할 성질을 잠근다.
 *
 * 두 방향으로 틀릴 수 있고 피해가 서로 다르다.
 *   과병합 — 다른 지점 가격이 한 카드에 섞인다(소비자에게 틀린 정보).
 *   과분리 — 같은 지점이 여러 장으로 갈려 더 싼 경로가 숨는다.
 * 실측 근거: 같은 대행사·같은 base_spec인 `바시움` 154만 ↔ `바시움 삼성점` 132만.
 */
describe("VENDOR_BRANCHES 대응표", () => {
  it("키는 정규화형이어야 한다 — 아니면 조회가 영원히 빗나간다", () => {
    for (const [key, branch] of VENDOR_BRANCHES) {
      const [category, variant] = key.split("|");
      expect(category, `카테고리 없음: ${key}`).toBeTruthy();
      expect(
        normalizeVendorName(variant),
        `키가 정규화형이 아니다: ${key}`,
      ).toBe(variant);
      expect(
        normalizeVendorName(branch.brand),
        `브랜드가 정규화형이 아니다: ${branch.brand}`,
      ).toBe(branch.brand);
      expect(branch.branch, `지점 라벨이 비었다: ${key}`).toBeTruthy();
    }
  });

  it("지점 항목이 병합 대응표와 충돌하지 않는다", () => {
    // 한 이름이 '같은 업체로 흡수'와 '별개 지점'을 동시에 주장하면
    // 목록과 상세가 어느 쪽을 먼저 보느냐로 결과가 갈린다.
    for (const key of VENDOR_BRANCHES.keys()) {
      expect(
        SAME_BUSINESS_DIFFERENT_NAME.has(key),
        `같은 이름이 병합과 지점 양쪽에 있다: ${key}`,
      ).toBe(false);
    }
  });

  it("브랜드 자신을 지점으로 등록하지 않는다", () => {
    // `헤움` 자체가 지점 항목이 되면 맨이름 카드가 사라진다.
    for (const [key, branch] of VENDOR_BRANCHES) {
      const [category, variant] = key.split("|");
      expect(variant, `브랜드가 자기 지점이다: ${key}`).not.toBe(branch.brand);
      expect(vendorBranchOf(category, branch.brand), `브랜드에 지점이 붙었다: ${branch.brand}`).toBeNull();
    }
  });

  it("지역코드는 알려진 값이거나 null이다", () => {
    const known = new Set([
      "seoul_gangnam3", "seoul_etc", "gyeonggi", "incheon", "gangwon",
      "chungcheong", "daejeon", "jeolla", "gwangju", "gyeongsang",
      "busan", "daegu", "ulsan", "jeju",
    ]);
    for (const [key, branch] of VENDOR_BRANCHES) {
      if (branch.regionCode === null) continue;
      expect(known.has(branch.regionCode), `모르는 지역코드: ${key} → ${branch.regionCode}`).toBe(true);
    }
  });
});

describe("표기 위치가 달라 갈린 같은 지점을 묶는다", () => {
  it("[수원] 헤움 과 헤움_수원점 은 한 카드다", () => {
    // 대괄호가 정규화에서 안 지워지면 `수원헤움` ≠ `헤움수원점`으로 갈린다.
    const left = vendorIdentityKey("makeup", "[수원] 헤움", "slug-a");
    const right = vendorIdentityKey("makeup", "헤움_수원점", "slug-b");
    expect(left).toBe(right);
  });

  it("그래도 맨이름 헤움과는 갈린다 — 다른 지점이다", () => {
    expect(vendorIdentityKey("makeup", "헤움", "slug-c"))
      .not.toBe(vendorIdentityKey("makeup", "[수원] 헤움", "slug-a"));
  });

  it("형제 지점이 없는 '본점'은 그냥 그 가게다", () => {
    // 알루는 6행 중 라벨이 웨딩두잇 1행뿐 — 라벨 1종은 구분자가 아니라 주석이다.
    expect(vendorIdentityKey("makeup", "알루 (본점)", "slug-a"))
      .toBe(vendorIdentityKey("makeup", "알루", "slug-b"));
  });

  it("형제 지점이 실재하는 '본점'은 반대로 갈린다", () => {
    // 꼼나나는 본점·청담·수원이 실재한다. 알루와 정반대 결론이어야 한다.
    expect(vendorIdentityKey("makeup", "꼼나나(본점)", "slug-a"))
      .not.toBe(vendorIdentityKey("makeup", "꼼나나", "slug-b"));
    expect(vendorIdentityKey("makeup", "꼼나나(본점)", "slug-a"))
      .not.toBe(vendorIdentityKey("makeup", "꼼나나(청담)", "slug-c"));
  });

  it("표기가 달라도 같은 지점이면 묶인다 — 꼼나나(청담) 과 꼼나나청담", () => {
    expect(vendorIdentityKey("makeup", "꼼나나(청담)", "slug-a"))
      .toBe(vendorIdentityKey("makeup", "꼼나나청담", "slug-b"));
  });

  it("지점은 병합되지 않는다 — 바시움 실측 22만원 차이", () => {
    expect(vendorIdentityKey("studio", "바시움", "slug-a"))
      .not.toBe(vendorIdentityKey("studio", "바시움 삼성점", "slug-b"));
  });
});

describe("목록과 상세가 같은 규칙을 쓴다", () => {
  it("vendorIdentityKey 는 vendorIdentityGroup 위에 세워진다", () => {
    // 한쪽만 지점을 알면 '카드엔 대행사 4곳인데 눌러 보니 1곳'이 다시 생긴다.
    const cases: Array<[string, string]> = [
      ["makeup", "[수원] 헤움"],
      ["makeup", "헤움_수원점"],
      ["makeup", "꼼나나(청담)"],
      ["studio", "바시움 삼성점"],
      ["studio", "가을스튜디오"],
      ["dress", "죠슈아벨브라이덜"],
    ];
    for (const [category, name] of cases) {
      expect(vendorIdentityKey(category as never, name, "slug"))
        .toBe(`${category}|${vendorIdentityGroup(category, name)}`);
    }
  });

  it("형제 조회 패턴은 지점 표기 위치가 달라도 서로를 잡는다", () => {
    // `[수원] 헤움`으로 만든 패턴이 글자 순서 때문에 `헤움_수원점`을 놓치면
    // 상세가 형제를 못 본다. 패턴은 브랜드로 만들어야 한다.
    const pattern = vendorIdentityLikePattern("[수원] 헤움", "makeup");
    expect(pattern).toBeTruthy();
    const regex = new RegExp(pattern!.replace(/%/g, ".*"));
    expect(regex.test("헤움_수원점")).toBe(true);
    expect(regex.test("[수원] 헤움")).toBe(true);
  });

  it("동명이업은 지점 규칙이 붙어도 계속 분리된다", () => {
    // 랑게(광주/서울)는 이름만 같고 다른 업체다.
    expect(vendorIdentityKey("studio", "랑게", "slug-a"))
      .not.toBe(vendorIdentityKey("studio", "랑게", "slug-b"));
  });
});

describe("지점 라벨은 샵 소재지로 승격된다", () => {
  it("이름에 지역이 있으면 대행사 지역을 이긴다", () => {
    expect(vendorRegionCodeOverride("makeup", "[강릉] 더페트라")).toBe("gangwon");
    expect(vendorRegionCodeOverride("studio", "[천안] 아우라")).toBe("chungcheong");
    expect(vendorRegionCodeOverride("makeup", "헤움_수원점")).toBe("gyeonggi");
  });

  it("지역이 아닌 지점 라벨은 지역을 바꾸지 않는다", () => {
    // '본점'·'청담'·'인스타점'은 광역 지역이 아니다.
    expect(vendorRegionCodeOverride("makeup", "꼼나나(본점)")).toBeNull();
    expect(vendorRegionCodeOverride("makeup", "조이187 인스타점")).toBeNull();
    expect(vendorRegionCodeOverride("studio", "바시움 삼성점")).toBeNull();
  });

  it("지점이 아닌 업체는 지역을 덮어쓰지 않는다", () => {
    expect(vendorRegionCodeOverride("studio", "가을")).toBeNull();
  });
});

describe("맨이름이 어느 지점인지 모르는 경우를 드러낸다", () => {
  it("형제 지점이 실재하면 맨이름 카드에 표시가 붙는다", () => {
    // 실측: 꼼나나 맨이름 4행 중 (주)블랑드봄은 본점 행과, 세인트플래닝은 청담
    // 행과 가격이 일치한다 — 지금 화면의 55만~178만은 서로 다른 가게의 혼합값이다.
    expect(hasUnverifiedBranch("makeup", "꼼나나")).toBe(true);
    expect(hasUnverifiedBranch("studio", "바시움")).toBe(true);
  });

  it("지점 자신에는 붙지 않는다 — 어느 지점인지 아는 카드다", () => {
    expect(hasUnverifiedBranch("makeup", "꼼나나(청담)")).toBe(false);
    expect(hasUnverifiedBranch("studio", "바시움 삼성점")).toBe(false);
  });

  it("형제 지점이 없는 업체에는 붙지 않는다", () => {
    expect(hasUnverifiedBranch("studio", "가을")).toBe(false);
    expect(hasUnverifiedBranch("makeup", "알루")).toBe(false);
  });

  it("표시 대상은 실제로 지점을 가진 브랜드여야 한다", () => {
    // 목록에 없는 브랜드를 넣어두면 아무 근거 없이 '확인 안 됨'을 띄우게 된다.
    const brandsWithBranches = new Set(
      [...VENDOR_BRANCHES].map(([key, branch]) => `${key.split("|")[0]}|${branch.brand}`),
    );
    for (const key of VENDOR_BRANCH_AMBIGUOUS) {
      expect(brandsWithBranches.has(key), `지점이 없는데 '확인 안 됨'으로 표시된다: ${key}`).toBe(true);
    }
  });
});

describe("3차 병합 항목", () => {
  it("철자 흔들림·로마자·약칭·상호변경이 한 카드로 묶인다", () => {
    const pairs: Array<[string, string, string]> = [
      ["dress", "시그니쳐엘리자베스", "시그니처엘리자베스"],
      ["dress", "죠슈아벨브라이덜", "조슈아벨브라이덜"],
      ["makeup", "컬쳐앤네이쳐", "컬처앤네이처"],
      ["makeup", "로쉬(rosh)", "로쉬"],
      ["makeup", "밈(MIMM)", "밈"],
      ["makeup", "정남(Jungnam)", "정남"],
      ["studio", "바로오늘이그날(바오그)", "바로오늘이그날"],
      ["dress", "레이첼웨딩", "르네아뜰리에"],
      ["dress", "마틴드아뜰리에", "마틴드마리에"],
      ["dress", "컬렉트비", "이브스더데이"],
    ];
    for (const [category, variant, canonical] of pairs) {
      expect(
        canonicalVendorName(category, variant),
        `${variant} 가 ${canonical} 로 안 묶인다`,
      ).toBe(normalizeVendorName(canonical));
    }
  });

  it("엘리자베스 상품 라인은 뭉개지 않는다", () => {
    // 시그니처·더화이트·럭스는 같은 브랜드의 다른 라인이고 가격이 다르다.
    const keys = [
      canonicalVendorName("dress", "시그니처엘리자베스"),
      canonicalVendorName("dress", "더화이트엘리자베스"),
      canonicalVendorName("dress", "엘리자베스럭스"),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it("마틴드세븐은 마틴드마리에로 빨려들지 않는다", () => {
    // 상호변경 병합이 접두가 같은 남남까지 끌어오면 안 된다.
    expect(canonicalVendorName("dress", "마틴드세븐"))
      .not.toBe(canonicalVendorName("dress", "마틴드마리에"));
  });
});
