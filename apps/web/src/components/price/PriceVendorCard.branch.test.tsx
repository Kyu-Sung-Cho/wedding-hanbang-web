import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
vi.mock("./vendorOptionsClient", () => ({ loadVendorOptions: vi.fn() }));
vi.mock("./VendorAvatar", () => ({ VendorAvatar: () => <span /> }));

import { PriceVendorCard } from "./PriceVendorCard";
import type { PriceOffer, PriceVendor } from "@/lib/price/catalog";

/**
 * 지점이 여럿인데 대행사가 지점을 안 적은 카드에 그 사실이 실제로 그려지는지 본다.
 *
 * `hasUnverifiedBranch`는 단위 테스트로 잠갔지만, 카드가 그 값을 안 쓰거나 조건을
 * 뒤집어 붙이면 단위 테스트는 통과한 채 화면만 조용히 틀린다. 실측상 이 문구가
 * 빠지면 `꼼나나 55만~178만`이 한 가게의 가격 범위로 읽힌다(실제로는 본점과 청담이
 * 섞인 값이다).
 */
function offer(overrides: Partial<PriceOffer> = {}): PriceOffer {
  return {
    id: "offer-1",
    itemName: null,
    agencyId: "agency-1",
    agencyName: "어느대행사",
    minimumKrw: 550_000,
    maximumKrw: 1_780_000,
    priceNote: null,
    baseSpec: null,
    options: [],
    ...overrides,
  } as PriceOffer;
}

function vendor(overrides: Partial<PriceVendor> & Pick<PriceVendor, "name" | "category">): PriceVendor {
  return {
    id: "vendor-1",
    slug: "vendor-1",
    aliases: [],
    regionCode: "seoul_gangnam3",
    regionCodes: ["seoul_gangnam3"],
    offers: [offer()],
    ...overrides,
  } as PriceVendor;
}

const NOTICE = "공시에 지점이 안 적혀 있어";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(value: PriceVendor): string {
  act(() => {
    root.render(
      <PriceVendorCard
        vendor={value}
        preview
        isWishlisted={false}
        onToggleWishlist={() => {}}
      />,
    );
  });
  return host.textContent ?? "";
}

describe("지점 미확인 표시", () => {
  it("형제 지점이 실재하는 맨이름 카드에는 문구가 뜬다", () => {
    const text = render(vendor({ name: "꼼나나", category: "makeup" }));
    expect(text).toContain(NOTICE);
    expect(text).toContain("꼼나나");
  });

  it("지점 카드에는 뜨지 않는다 — 어느 지점인지 아는 카드다", () => {
    expect(render(vendor({ name: "꼼나나(청담)", category: "makeup" }))).not.toContain(NOTICE);
  });

  it("형제 지점이 없는 업체에는 뜨지 않는다", () => {
    expect(render(vendor({ name: "가을", category: "studio" }))).not.toContain(NOTICE);
    expect(render(vendor({ name: "알루", category: "makeup" }))).not.toContain(NOTICE);
  });

  it("카테고리가 다르면 뜨지 않는다 — 이름만 같은 남을 잡지 않는다", () => {
    expect(render(vendor({ name: "꼼나나", category: "studio" }))).not.toContain(NOTICE);
  });

  it("문구가 판정이 아니라 관찰로 쓰여 있다", () => {
    // "견적·시세에 판정 금지" 원칙 — 좋다/나쁘다·주의·위험 같은 말을 넣지 않는다.
    const text = render(vendor({ name: "바시움", category: "studio" }));
    expect(text).toContain(NOTICE);
    for (const judgement of ["주의", "위험", "안전", "비추천", "조심"]) {
      expect(text, `판정 어휘가 들어갔다: ${judgement}`).not.toContain(judgement);
    }
  });
});
