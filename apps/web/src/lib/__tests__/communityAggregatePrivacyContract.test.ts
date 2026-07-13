import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const vendorTagsListRoute = source(
  "src/app/api/community/vendor-tags/route.ts"
);
const vendorTagDetailRoute = source(
  "src/app/api/community/vendor-tags/[name]/route.ts"
);
const cohortContractsRoute = source(
  "src/app/api/community/cohort/[id]/contracts/route.ts"
);
const cohortPage = source(
  "src/app/(community)/community/cohort/[id]/page.tsx"
);
const cohortProfileRoute = source(
  "src/app/api/community/profiles/[userId]/route.ts"
);
const vendorPage = source(
  "src/app/(community)/community/vendor/[name]/page.tsx"
);

describe("public community exposure boundaries", () => {
  it("keeps same-cohort profile responses to a pseudonymous author card", () => {
    expect(cohortProfileRoute).toContain("checkRateLimitPersistent");
    expect(cohortProfileRoute).toContain("isUuid(userId)");
    expect(cohortProfileRoute).toContain("isUuid(roomId)");
    expect(cohortProfileRoute).toContain(
      '.select("user_id, nickname, avatar_url, badge, rank")'
    );
    expect(cohortProfileRoute).not.toMatch(
      /wedding_year|wedding_month|wedding_completed|total_upvotes_received/
    );
    expect(cohortProfileRoute).toContain("if (membershipError)");
    expect(cohortProfileRoute).toContain("if (postsError)");
  });

  it("publishes only bounded vendor-tag discovery fields", () => {
    expect(vendorTagsListRoute).toContain("checkRateLimitPersistent");
    expect(vendorTagDetailRoute).toContain("checkRateLimitPersistent");
    expect(vendorTagsListRoute).toContain(
      '.select("id, vendor_name, category, region, mention_count")'
    );
    expect(vendorTagDetailRoute).toContain(
      '.select("id, vendor_name, category, region, mention_count")'
    );
    expect(vendorTagsListRoute).not.toContain('.select("*")');
    expect(vendorTagDetailRoute).not.toContain('.select("*")');

    for (const aggregate of [
      "avg_rating",
      "avg_base_price",
      "avg_extra_price",
      "extra_rate",
    ]) {
      expect(vendorTagsListRoute).toContain(`${aggregate}: null`);
      expect(vendorTagDetailRoute).toContain(`${aggregate}: null`);
    }
  });

  it("links only the exact approved vendor without internal commerce data", () => {
    expect(vendorTagDetailRoute).toContain('.eq("name", name)');
    expect(vendorTagDetailRoute).toContain('.eq("status", "approved")');
    expect(vendorTagDetailRoute).toContain("if (!tag)");
    expect(vendorTagDetailRoute).toContain("{ status: 404 }");
    expect(vendorTagDetailRoute).not.toContain("fuzzyVendor");
    expect(vendorTagDetailRoute).not.toContain('.ilike("name"');
    expect(vendorTagDetailRoute).toContain(
      '.select("id, name, category, region, address, thumbnail_url, description")'
    );

    for (const table of [
      "vendor_products",
      "vendor_staff",
      "vendor_timeslots",
      "staff_timeslots",
    ]) {
      expect(vendorTagDetailRoute).not.toContain(`.from("${table}")`);
    }
    expect(vendorTagDetailRoute).not.toContain("discount_price");
    expect(vendorTagDetailRoute).not.toContain("is_popular");
    expect(vendorTagDetailRoute).not.toMatch(/products:|staff:|vendorSlots:|staffSlots:/);
    expect(vendorTagDetailRoute).toContain("if (tagError)");
    expect(vendorTagDetailRoute).toContain("if (postsError)");
    expect(vendorTagDetailRoute).toContain("if (vendorError)");
  });

  it("renders vendor evidence honestly and keeps lookup failures distinguishable", () => {
    expect(vendorPage).toContain('type LoadState = "loading" | "ready" | "not_found" | "error"');
    expect(vendorPage).toContain("if (res.status === 404)");
    expect(vendorPage).toContain('setLoadState("not_found")');
    expect(vendorPage).toContain('setLoadState("error")');
    expect(vendorPage).toContain("업체 태그를 찾을 수 없어요.");
    expect(vendorPage).toContain("업체 정보를 불러오지 못했어요.");
    expect(vendorPage).toContain("다시 불러오기");
    expect(vendorPage).toContain("setReloadKey((key) => key + 1)");

    expect(vendorPage).toContain("고유 참여자 수·수집 기간·산정 근거가 확인되지 않아");
    expect(vendorPage).toContain("평균 가격과 추가금 비율을 공개하지 않습니다");
    expect(vendorPage).toContain("품질·인기·예약 가능성을 뜻하지 않습니다");
    expect(vendorPage).not.toContain('<Stat');
    expect(vendorPage).not.toContain('value="-"');

    for (const deadBookingSymbol of [
      "function Stat(",
      "function BookingSection(",
      "VendorProductLite",
      "StaffLite",
      "DaySlotGroup",
      "selectedProductId",
      "selectedStaffId",
      "dayGroups",
      "vendor_products",
      "vendor_staff",
      "vendor_timeslots",
      "staff_timeslots",
    ]) {
      expect(vendorPage).not.toContain(deadBookingSymbol);
    }
    expect(vendorPage).toContain("function NoBookingFallback(");
    expect(vendorPage).toContain("현재 웨딩한방에서는 상담 요청이나 예약을 업체에 전송하지 않습니다");
    expect(vendorPage).toContain("관련 게시글");
  });
});

describe("cohort price anonymity boundary", () => {
  it("reads raw contracts only through the user-scoped RLS client", () => {
    expect(cohortContractsRoute).toMatch(
      /const \{ data: myContracts,[\s\S]*?await supabase[\s\S]*?\.from\("cohort_contracts"\)/
    );
    expect(cohortContractsRoute).not.toContain("rawContracts");
    expect(cohortContractsRoute).not.toContain("contracts,");
    expect(cohortContractsRoute).toContain('from("cohort_stats")');
    expect(cohortContractsRoute).toContain(
      'from("cohort_room_contributor_stats")'
    );
    expect(cohortContractsRoute).toContain(
      'select("category, sample_size, avg_base_price, avg_extra_price, avg_total")'
    );
    expect(cohortContractsRoute).toContain(
      "total_contributor_count_suppressed"
    );
  });

  it("fails closed for fewer than five distinct contributors", () => {
    expect(cohortContractsRoute).toContain("MIN_DISTINCT_CONTRIBUTORS = 5");
    expect(cohortContractsRoute).toContain(
      "sampleSize === null || averageBasePrice === null"
    );
    expect(cohortContractsRoute).toContain(
      "MAX_TOTAL_PRICE_MANWON = MAX_PRICE_MANWON * 2"
    );
    expect(cohortContractsRoute).toMatch(
      /authorizedAverage\(\s*rawStat\.avg_total,\s*1,\s*MAX_TOTAL_PRICE_MANWON\s*\)/
    );
    expect(cohortContractsRoute).not.toContain("sample_size: 0");
    expect(cohortPage).not.toContain("NATIONAL_AVG");
    expect(cohortPage).not.toContain("contracts.length");
    expect(cohortPage).toContain("5명 미만 비공개");
    expect(cohortPage).toContain(
      "5개가 모이기 전에는 정확한 숫자를 공개하지 않아요"
    );
    expect(cohortPage).toContain(
      "한 계정의 같은 카테고리에서는 최신 1건만 반영"
    );
    expect(cohortPage).toContain("가격 평균을 불러오지 못했어요.");
    expect(cohortPage).toContain("표본 부족으로 표시하지 않고");
    expect(cohortPage).toContain("다시 불러오기");
    expect(cohortPage).toContain("useAccessibleDialog({ isOpen: true, onClose })");
    expect(cohortPage).toContain('aria-labelledby="cohort-contract-dialog-title"');
    expect(cohortPage).toContain('data-dialog-initial-focus');
    for (const controlId of [
      "cohort-contract-vendor",
      "cohort-contract-category",
      "cohort-contract-base-price",
      "cohort-contract-extra-price",
      "cohort-contract-notes",
    ]) {
      expect(cohortPage).toContain(`htmlFor="${controlId}"`);
      expect(cohortPage).toContain(`id="${controlId}"`);
    }
  });

  it("bounds and validates contract submissions before an RLS write", () => {
    expect(cohortContractsRoute).toContain("MAX_BODY_BYTES = 8 * 1024");
    expect(cohortContractsRoute).toContain("await reader.read()");
    expect(cohortContractsRoute).toContain("totalBytes > maxBytes");
    expect(cohortContractsRoute).toContain("cleanOptionalEnum");
    expect(cohortContractsRoute).toContain("cleanIntegerInRange");
    expect(cohortContractsRoute).toContain("cleanOptionalText");
    expect(cohortContractsRoute).toContain(
      'rateLimitKey("community:cohort-contracts:read", req, user.id)'
    );
    expect(cohortContractsRoute).toContain(
      'rateLimitKey("community:cohort-contracts:create", req, user.id)'
    );
    expect(cohortContractsRoute).toMatch(
      /checkRateLimitPersistent\([\s\S]*?user\.id\s*\)/
    );
    expect(cohortContractsRoute).toMatch(
      /const \{ data, error \} = await supabase[\s\S]*?\.from\("cohort_contracts"\)[\s\S]*?\.insert\(/
    );
    expect(cohortContractsRoute).not.toMatch(
      /createAdminClient\(\)[\s\S]{0,100}\.from\("cohort_contracts"\)/
    );
  });
});
