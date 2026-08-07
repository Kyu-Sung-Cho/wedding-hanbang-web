import { describe, expect, it } from "vitest";

import { filterPriceCatalog, type PriceVendor } from "@/lib/price/catalog";
import { vendorDisplayName } from "@/lib/price/vendorDisplayName";
import { vendorIdentityKey } from "@/lib/price/vendorIdentity";

/**
 * 파일명 찌꺼기 정리가 화면·검색·신원에 **끝까지** 반영되는지 본다.
 *
 * `vendorDisplayName` 단위 테스트만으로는, 목록 로더가 그 함수를 안 쓰거나
 * 검색이 정리 전 이름만 보게 되면 조용히 틀린다. 실측(2026-08-08 운영) 21곳이
 * 대상이고 그 중 `베로나지디_예식장`은 라이브에 그대로 노출돼 있었다.
 */
/** 목록 로더(`publicListData`)가 하는 일과 같은 방식으로 vendor를 만든다. */
function vendor(overrides: Partial<PriceVendor> & Pick<PriceVendor, "id" | "name">): PriceVendor {
  const { name: rawName, ...rest } = overrides;
  const display = vendorDisplayName(rawName);
  return {
    slug: `slug-${overrides.id}`,
    aliases: [],
    category: "hall",
    regionCode: "gangwon",
    regionCodes: ["gangwon"],
    offers: [],
    ...rest,
    name: display.name,
    disclosureEntity: display.disclosureEntity,
  } as PriceVendor;
}

describe("정리한 이름이 목록까지 간다", () => {
  it("문서 꼬리표가 카드 이름에서 사라진다", () => {
    expect(vendor({ id: "1", name: "베로나지디_예식장" }).name).toBe("베로나지디");
  });

  it("법인명은 이름에서 빠지고 공시주체로 남는다", () => {
    const value = vendor({ id: "2", name: "빌라드지디 논현(라비에벨(주))" });
    expect(value.name).toBe("빌라드지디 논현");
    expect(value.disclosureEntity).toBe("라비에벨(주)");
  });
});

describe("검색이 좁아지지 않는다", () => {
  const rows = [
    vendor({ id: "1", name: "베로나지디_예식장" }),
    vendor({ id: "2", name: "빌라드지디 논현(라비에벨(주))" }),
  ];

  it("정리한 이름으로 찾힌다", () => {
    expect(filterPriceCatalog(rows, { search: "베로나지디" }).map((v) => v.id)).toEqual(["1"]);
  });

  it("법인명으로도 계속 찾힌다 — 정리가 손해가 되면 안 된다", () => {
    expect(filterPriceCatalog(rows, { search: "라비에벨" }).map((v) => v.id)).toEqual(["2"]);
  });

  it("없는 말로는 안 찾힌다", () => {
    expect(filterPriceCatalog(rows, { search: "존재하지않는이름" })).toHaveLength(0);
  });
});

describe("같은 파일을 두 번 받은 사본은 한 카드다", () => {
  it("셀레네하우스웨딩 (1) 이 원본과 같은 신원 키를 갖는다", () => {
    // 두 원본 파일의 sha256이 완전히 같다(0afd7d0a…). 예식장 카드가 두 장이었다.
    const copy = vendorIdentityKey("hall", "셀레네하우스웨딩(천안, 청주점) (1)", "slug-copy");
    const original = vendorIdentityKey("hall", "셀레네하우스웨딩(천안, 청주점)", "slug-original");
    expect(copy).toBe(original);
  });

  it("사본 표시는 화면 이름에서도 사라진다", () => {
    expect(vendorDisplayName("셀레네하우스웨딩(천안, 청주점) (1)").name)
      .toBe("셀레네하우스웨딩(천안, 청주점)");
  });

  it("지점 표기까지 지우지는 않는다", () => {
    // `(천안, 청주점)`은 상호의 일부다. 이걸 떼면 다른 업체와 섞인다.
    expect(vendorDisplayName("셀레네하우스웨딩(천안, 청주점)").name)
      .toContain("천안, 청주점");
  });
});
